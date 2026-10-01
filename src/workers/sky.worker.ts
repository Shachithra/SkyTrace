/// <reference lib="webworker" />
import { azElToVector, separation, vectorToAzEl } from '../astronomy/angularDistance.ts';
import { sunAltitude, twilightState } from '../sky/horizon.ts';
import { mul, mulT, vecToRaDec } from '../sky/raDecToAltAz.ts';
import { ConstellationIndex, riseSet } from '../stars/constellationData.ts';
import type { StarCatalogData } from '../stars/starCatalog.ts';
import { starLabel } from '../stars/starCatalog.ts';
import { catalogVectors, computeStarField, j2000ToEnu, skyFrame } from '../stars/starPosition.ts';
import { compass8 } from '../utils/degrees.ts';
import type { Observer } from '../astronomy/types.ts';
import type { PatternResult, SkyInbound, SkyOutbound } from './skyTypes.ts';

/**
 * SKY WORKER: star coordinate conversion (RA/Dec → Alt/Az), star filtering,
 * constellation visibility, pattern identification and constellation lookups.
 */
declare const self: DedicatedWorkerGlobalScope;

let cat: StarCatalogData | null = null;
let vecs: Float64Array = new Float64Array(0);
let mags: Float32Array = new Float32Array(0);
let index: ConstellationIndex | null = null;
let figureIdx: Uint16Array = new Uint16Array(0);

const post = (m: SkyOutbound, transfer: Transferable[] = []): void => self.postMessage(m, transfer);
const jdOf = (t: number): number => t / 86_400_000 + 2440587.5;
const frameFor = (o: Observer, t: number) => skyFrame(jdOf(t), o.latitude, o.longitude);

/** ENU (apparent, of date) → J2000 vector, for catalogue lookups. */
function enuToJ2000(e: [number, number, number], f: ReturnType<typeof frameFor>): [number, number, number] {
  return mulT(f.precession, f.horizon.fromEnu(e)) as [number, number, number];
}

self.onmessage = (ev: MessageEvent<SkyInbound>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'LOAD': {
        cat = m.stars;
        vecs = catalogVectors(cat);
        mags = Float32Array.from(cat.stars.map((s) => s[3]));
        index = new ConstellationIndex(m.constellations, cat);
        figureIdx = Uint16Array.from(Array.from(new Set(m.constellations.constellations.flatMap((c) => c.lines.flat()))));
        post({ type: 'READY', stars: cat.stars.length, constellations: index.list.length, version: cat.version });
        break;
      }
      case 'FIELD': {
        if (!cat || !index) throw new Error('Star data not loaded');
        const f = frameFor(m.observer, m.time);
        const sunAlt = sunAltitude(f.jd, m.observer.latitude, m.observer.longitude);
        const { index: idx, enu } = computeStarField(vecs, mags, f, m.limitMag);
        const figureEnu = new Float32Array(figureIdx.length * 3);
        figureIdx.forEach((si, k) => {
          const e = j2000ToEnu([vecs[si * 3], vecs[si * 3 + 1], vecs[si * 3 + 2]], f);
          figureEnu.set(e, k * 3);
        });
        const constellations = index.list.map((p) => {
          const e = j2000ToEnu(p.labelVec, f);
          return { id: p.def.id, enu: [e[0], e[1], e[2]] as [number, number, number], alt: (Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180) / Math.PI };
        });
        const fi = Uint16Array.from(figureIdx);
        post(
          { type: 'FIELD', id: m.id, field: { time: m.time, lst: f.lst, sunAlt, twilight: twilightState(sunAlt), limitMag: m.limitMag, index: idx, enu, figureIndex: fi, figureEnu, constellations } },
          [idx.buffer, enu.buffer, fi.buffer, figureEnu.buffer],
        );
        break;
      }
      case 'LOOKUP': {
        if (!index) throw new Error('Constellations not loaded');
        const f = frameFor(m.observer, m.time);
        const ids = m.points.map(([az, el]) => index!.find(enuToJ2000(azElToVector(az, el), f))?.def.id ?? null);
        post({ type: 'LOOKUP', id: m.id, ids });
        break;
      }
      case 'PATTERN': {
        post({ type: 'PATTERN', id: m.id, result: pattern(m.observer, m.time, m.az, m.el, m.fovDeg, m.accuracyDeg) });
        break;
      }
      case 'CONSTELLATION_INFO': {
        if (!cat || !index) throw new Error('Constellations not loaded');
        const p = index.byId.get(m.constellation);
        if (!p) {
          post({ type: 'CONSTELLATION_INFO', id: m.id, info: null });
          break;
        }
        const f = frameFor(m.observer, m.time);
        const e = j2000ToEnu(p.labelVec, f);
        const { az, el } = vectorToAzEl(e);
        const ofDate = vecToRaDec(mul(f.precession, p.labelVec));
        const rs = riseSet(ofDate.ra, ofDate.dec, m.observer.latitude, f.lst, m.time);
        const status = el > 15 ? 'VISIBLE' : el > 0 ? 'LOW' : 'BELOW HORIZON';
        const best = el > 0 ? compass8(az) : compass8(rs.transitAzimuth);
        post({
          type: 'CONSTELLATION_INFO',
          id: m.id,
          info: {
            id: p.def.id,
            name: p.def.name,
            alt: el,
            az,
            status,
            bestDirection: best,
            riseSet: rs,
            majorStars: p.starIdx.slice(0, 8).map((i) => ({ name: starLabel(cat!.stars[i][0], cat!.info[String(cat!.stars[i][0])]), mag: cat!.stars[i][3] })),
          },
        });
        break;
      }
    }
  } catch (err) {
    post({ type: 'ERROR', id: (m as { id?: number }).id ?? -1, message: err instanceof Error ? err.message : String(err) });
  }
};

/**
 * Star-pattern identification: which constellation the pointing direction falls
 * in (IAU boundaries), and how much of its figure is inside the field of view
 * and above the horizon. Qualitative levels only — no fake percentages.
 */
function pattern(o: Observer, t: number, az: number, el: number, fovDeg: number, accuracyDeg: number): PatternResult {
  if (!cat || !index) throw new Error('Constellations not loaded');
  const f = frameFor(o, t);
  const centre = azElToVector(az, el);
  const j = enuToJ2000(centre, f);
  const { ra, dec } = vecToRaDec(mul(f.precession, j));
  const p = index.find(j);
  if (!p) return { id: null, name: null, level: null, mainStars: [], inView: 0, total: 0, ra, dec };
  let inView = 0;
  for (const si of p.starIdx) {
    const e = j2000ToEnu([vecs[si * 3], vecs[si * 3 + 1], vecs[si * 3 + 2]], f);
    if (e[2] > 0 && separation(centre, e) <= fovDeg / 2) inView++;
  }
  const total = p.starIdx.length || 1;
  const share = inView / total;
  const above = el > 3;
  let level: PatternResult['level'] = 'MATCH LOW';
  if (above && share >= 0.6 && accuracyDeg <= 8) level = 'MATCH HIGH';
  else if (above && (share >= 0.3 || accuracyDeg <= 15)) level = 'MATCH MEDIUM';
  return {
    id: p.def.id,
    name: p.def.name,
    level,
    mainStars: p.starIdx.slice(0, 7).map((i) => ({ name: starLabel(cat!.stars[i][0], cat!.info[String(cat!.stars[i][0])]), mag: cat!.stars[i][3] })),
    inView,
    total,
    ra,
    dec,
  };
}
