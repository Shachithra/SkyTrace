/// <reference lib="webworker" />
import { runTrace } from './crossingDetector.ts';
import { lookAt } from './lookAngles.ts';
import { createBody, geodeticOf, instant, ObserverFrame, orbitGeometry, propagateEci, type Body } from './propagator.ts';
import { MS_PER_DAY, parseOmmEpoch } from './time.ts';
import type { Observer, SatelliteInfo, WorkerInbound, WorkerOutbound } from './types.ts';

declare const self: DedicatedWorkerGlobalScope;

let bodies: Body[] = [];
const byCatalog = new Map<number, Body>();
const cancelled = new Set<string>();

const post = (msg: WorkerOutbound): void => self.postMessage(msg);

self.onmessage = async (ev: MessageEvent<WorkerInbound>) => {
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
    case 'SAT_INFO': {
      post({ type: 'SAT_INFO_RESULT', info: satInfo(msg.catalogId, msg.observer, msg.time) });
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
