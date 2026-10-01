/// <reference lib="webworker" />
import { runTrace } from '../astronomy/crossingDetector.ts';
import { lookAt } from '../astronomy/lookAngles.ts';
import { createBody, eciToEcfVec, geodeticOf, instant, ObserverFrame, orbitGeometry, propagateEci, type Body } from '../astronomy/propagator.ts';
import { MS_PER_DAY, parseOmmEpoch } from '../astronomy/time.ts';
import type { Observer, SatelliteInfo } from '../astronomy/types.ts';
import { assessVisibility, sunElevation, type VisibilityStatus } from '../astronomy/visibility.ts';
import { predictPasses } from '../alerts/passPrediction.ts';
import { azElToVector } from '../astronomy/angularDistance.ts';
import { mulT } from '../sky/raDecToAltAz.ts';
import { ConstellationIndex } from '../stars/constellationData.ts';
import { skyFrame } from '../stars/starPosition.ts';
import type { OrbitInbound, OrbitOutbound, TrajectoryPoint } from './orbitTypes.ts';

/**
 * ORBIT WORKER: satellite propagation (SGP4), live positions, trajectories,
 * pass prediction and historical crossing search. Keeps the UI thread free.
 */
declare const self: DedicatedWorkerGlobalScope;

let bodies: Body[] = [];
const byCatalog = new Map<number, Body>();
const cancelled = new Set<string>();
let constellations: ConstellationIndex | null = null;
const conNames = new Map<string, string>();
const STATUS_CODE: Record<VisibilityStatus, number> = { NOT_EXPECTED: 0, POSSIBLY_VISIBLE: 1, LIKELY_VISIBLE: 2 };
const LIGHT_GROUPS = ['stations', 'visual', 'weather', 'gnss', 'science'];

const post = (msg: OrbitOutbound, transfer: Transferable[] = []): void => self.postMessage(msg, transfer);
const jdOf = (t: number): number => t / 86_400_000 + 2440587.5;

/** Constellation containing an observer-relative az/el direction at time t. */
function constellationAt(o: Observer, t: number, az: number, el: number): string | null {
  if (!constellations || el < 0) return null;
  const f = skyFrame(jdOf(t), o.latitude, o.longitude);
  const j = mulT(f.precession, f.horizon.fromEnu(azElToVector(az, el)));
  return constellations.find(j)?.def.id ?? null;
}

self.onmessage = async (ev: MessageEvent<OrbitInbound>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'LOAD_ORBITS': {
      bodies = [];
      byCatalog.clear();
      let rejected = 0;
      for (const r of msg.records) {
        const b = createBody(r);
        if (!b) {
          rejected++;
          continue;
        }
        bodies.push(b);
        byCatalog.set(r.NORAD_CAT_ID, b);
      }
      post({ type: 'ORBITS_READY', count: bodies.length, rejected });
      break;
    }
    case 'LOAD_CONSTELLATIONS': {
      // Only boundaries/labels are needed here; the star list is not.
      constellations = new ConstellationIndex(msg.data, { version: '', epoch: 'J2000', source: '', stars: [], info: {} });
      for (const c of msg.data.constellations) conNames.set(c.id, c.name);
      break;
    }
    case 'CANCEL':
      cancelled.add(msg.requestId);
      break;
    case 'TRACE_REQUEST': {
      const id = msg.request.requestId;
      let last = 0;
      try {
        const result = await runTrace(bodies, msg.request, {
          onProgress: (checked, total) => {
            const now = Date.now();
            if (now - last > 50 || checked === total) {
              last = now;
              post({ type: 'TRACE_PROGRESS', requestId: id, checked, total });
            }
          },
          isCancelled: () => cancelled.has(id),
        });
        post({ type: 'TRACE_COMPLETE', result });
      } catch (err) {
        post({ type: 'TRACE_ERROR', requestId: id, message: err instanceof Error ? err.message : String(err) });
      } finally {
        cancelled.delete(id);
      }
      break;
    }
    case 'SAT_INFO':
      post({ type: 'SAT_INFO_RESULT', info: satInfo(msg.catalogId, msg.observer, msg.time) });
      break;
    case 'LIVE': {
      // Real-time positions at two instants; the UI interpolates between them each frame.
      const frame = new ObserverFrame(msg.observer);
      const a0 = instant(msg.t0);
      const a1 = instant(msg.t1);
      const list = msg.catalogIds ? msg.catalogIds.map((id) => byCatalog.get(id)).filter((b): b is Body => !!b) : bodies;
      const ids: number[] = [];
      const data: number[] = [];
      for (const b of list) {
        const s0 = propagateEci(b, a0);
        if (!s0) continue;
        const l0 = frame.look(eciToEcfVec(s0.pos, a0));
        if (l0.enu[2] < -0.035) continue; // horizon filtering
        const s1 = propagateEci(b, a1);
        if (!s1) continue;
        const l1 = frame.look(eciToEcfVec(s1.pos, a1));
        const el = (Math.asin(Math.max(-1, Math.min(1, l0.enu[2]))) * 180) / Math.PI;
        const v = assessVisibility(frame, a0, s0.pos, el, l0.rangeKm, b.rec);
        ids.push(b.rec.NORAD_CAT_ID);
        data.push(l0.enu[0], l0.enu[1], l0.enu[2], l1.enu[0], l1.enu[1], l1.enu[2], l0.rangeKm, STATUS_CODE[v.status], v.estMagnitude ?? 99);
      }
      const idArr = Int32Array.from(ids);
      const dataArr = Float32Array.from(data);
      post({ type: 'LIVE', frame: { requestId: msg.requestId, t0: msg.t0, t1: msg.t1, ids: idArr, data: dataArr, sunAlt: sunElevation(frame, a0) } }, [idArr.buffer, dataArr.buffer]);
      break;
    }
    case 'TRAJECTORY': {
      const body = byCatalog.get(msg.catalogId);
      const points: TrajectoryPoint[] = [];
      if (body) {
        const frame = new ObserverFrame(msg.observer);
        for (let t = msg.from; t <= msg.to; t += msg.stepS * 1000) {
          const at = instant(t);
          const l = lookAt(body, frame, at);
          if (!l) continue;
          const v = assessVisibility(frame, at, l.eci, l.el, l.rangeKm, body.rec);
          points.push({ t, az: l.az, el: l.el, status: v.status, con: constellationAt(msg.observer, t, l.az, l.el) });
        }
      }
      post({ type: 'TRAJECTORY', requestId: msg.requestId, points });
      break;
    }
    case 'PASSES': {
      const r = msg.request;
      const t0 = Date.now();
      try {
        let set: Body[];
        let limited = false;
        if (r.catalogIds) set = r.catalogIds.map((id) => byCatalog.get(id)).filter((b): b is Body => !!b);
        else if (bodies.length > 2500) {
          // Very large constellations would make 24 h prediction slow on phones:
          // predict for the lighter groups plus favourites.
          limited = true;
          const extra = new Set(r.extraIds);
          set = bodies.filter((b) => extra.has(b.rec.NORAD_CAT_ID) || (b.rec.groups ?? []).some((g) => LIGHT_GROUPS.includes(g)) || b.rec.simulated);
        } else set = bodies;
        const frame = new ObserverFrame(r.observer);
        let last = 0;
        const passes = await predictPasses(set, frame, r.start, r.end, {
          minElevation: r.minElevation,
          onProgress: (done, total) => {
            if (Date.now() - last > 80 || done === total) {
              last = Date.now();
              post({ type: 'PASS_PROGRESS', requestId: r.requestId, done, total });
            }
          },
          isCancelled: () => cancelled.has(String(r.requestId)),
        });
        // Satellite + constellation context: which figures the observable part of each pass crosses.
        if (constellations) {
          for (const p of passes) {
            const seen: string[] = [];
            for (const pt of p.path) {
              if (pt.el < 10) continue;
              const id = constellationAt(r.observer, pt.t, pt.az, pt.el);
              const name = id ? conNames.get(id) ?? id : null;
              if (name && !seen.includes(name)) seen.push(name);
            }
            p.constellations = seen;
          }
        }
        post({ type: 'PASSES', result: { requestId: r.requestId, passes, considered: set.length, limited, elapsedMs: Date.now() - t0 } });
      } catch (err) {
        post({ type: 'ERROR', requestId: r.requestId, message: err instanceof Error ? err.message : String(err) });
      } finally {
        cancelled.delete(String(r.requestId));
      }
      break;
    }
  }
};

function satInfo(catalogId: number, observer: Observer | null, time: number): SatelliteInfo | null {
  const body = byCatalog.get(catalogId);
  if (!body) return null;
  const at = instant(time);
  const geo = orbitGeometry(body.rec);
  const st = propagateEci(body, at);
  const g = st ? geodeticOf(st.pos, at) : null;
  const look = observer && st ? lookAt(body, new ObserverFrame(observer), at) : null;
  return {
    catalogId,
    name: body.rec.OBJECT_NAME,
    intlDesignator: body.rec.OBJECT_ID,
    epoch: parseOmmEpoch(body.rec.EPOCH),
    epochAgeDays: (time - parseOmmEpoch(body.rec.EPOCH)) / MS_PER_DAY,
    inclination: body.rec.INCLINATION,
    eccentricity: body.rec.ECCENTRICITY,
    periodMin: geo.periodMin,
    apogeeKm: geo.apogeeKm,
    perigeeKm: geo.perigeeKm,
    meanAltitudeKm: (geo.apogeeKm + geo.perigeeKm) / 2,
    semiMajorKm: geo.semiMajorKm,
    latitude: g?.latitude ?? null,
    longitude: g?.longitude ?? null,
    altitudeKm: g?.altitudeKm ?? null,
    speedKms: st ? Math.hypot(...st.vel) : null,
    azimuth: look?.az ?? null,
    elevation: look?.el ?? null,
    rangeKm: look?.rangeKm ?? null,
    simulated: !!body.rec.simulated,
    groups: body.rec.groups ?? [],
  };
}
