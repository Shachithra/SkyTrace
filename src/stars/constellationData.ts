import { DEG, RAD, wrap360 } from '../utils/degrees.ts';
import { dot, normalize, type Vec3 } from '../utils/math.ts';
import { separation } from '../astronomy/angularDistance.ts';
import { raDecToVec } from '../sky/raDecToAltAz.ts';
import type { ConstellationData, ConstellationDef, StarCatalogData } from './starCatalog.ts';

interface Prepared {
  def: ConstellationDef;
  ring: Vec3[];
  centre: Vec3;
  radius: number; // deg
  labelVec: Vec3;
  starIdx: number[]; // stars used by the stick figure, bright → faint
}

/**
 * Constellation index with spherical point-in-boundary tests. The test sums
 * the change in bearing from the point to each boundary vertex (winding number),
 * which works anywhere on the sphere — including polar constellations.
 */
export class ConstellationIndex {
  readonly list: Prepared[];
  readonly byId = new Map<string, Prepared>();

  constructor(data: ConstellationData, cat: StarCatalogData) {
    this.list = data.constellations.map((def) => {
      const ring = def.boundary.map(([ra, dec]) => raDecToVec(ra, dec));
      let c: Vec3 = [0, 0, 0];
      for (const v of ring) c = [c[0] + v[0], c[1] + v[1], c[2] + v[2]];
      const centre = normalize(c);
      let radius = 0;
      for (const v of ring) radius = Math.max(radius, separation(centre, v));
      const used = Array.from(new Set(def.lines.flat()));
      // the orbit worker builds an index without the star list (boundaries only)
      const starIdx = cat.stars.length ? used.sort((a, b) => cat.stars[a][3] - cat.stars[b][3]) : used;
      const p: Prepared = { def, ring, centre, radius, labelVec: raDecToVec(def.label[0], def.label[1]), starIdx };
      this.byId.set(def.id, p);
      return p;
    });
  }

  /** Constellation containing a J2000 direction. */
  find(v: Vec3): Prepared | null {
    let fallback: Prepared | null = null;
    let best = Infinity;
    for (const p of this.list) {
      const d = separation(p.centre, v);
      if (d > p.radius + 0.5) continue;
      if (contains(p.ring, v)) return p;
      if (d < best) {
        best = d;
        fallback = p;
      }
    }
    return fallback;
  }

  findRaDec(raDeg: number, decDeg: number): Prepared | null {
    return this.find(raDecToVec(raDeg, decDeg));
  }
}

function tangentBasis(p: Vec3): { east: Vec3; north: Vec3 } {
  let east: Vec3 = [-p[1], p[0], 0];
  if (Math.hypot(east[0], east[1]) < 1e-9) east = [0, 1, 0];
  east = normalize(east);
  const north: Vec3 = [p[1] * east[2] - p[2] * east[1], p[2] * east[0] - p[0] * east[2], p[0] * east[1] - p[1] * east[0]];
  return { east, north };
}

export function contains(ring: Vec3[], p: Vec3): boolean {
  const { east, north } = tangentBasis(p);
  let sum = 0;
  let prev = Math.atan2(dot(ring[ring.length - 1], east), dot(ring[ring.length - 1], north));
  for (const v of ring) {
    const b = Math.atan2(dot(v, east), dot(v, north));
    let d = b - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sum += d;
    prev = b;
  }
  return Math.abs(sum) > Math.PI;
}

export interface RiseSet {
  /** next rise / transit / set (epoch ms); null when circumpolar or never rises */
  rise: number | null;
  transit: number;
  set: number | null;
  circumpolar: boolean;
  neverRises: boolean;
  transitAltitude: number;
  transitAzimuth: number;
}

const SIDEREAL = 0.9972695663; // solar days per sidereal day

/** Rise/transit/set for a fixed RA/Dec (of date) seen from latitude, given current LST. */
export function riseSet(raDeg: number, decDeg: number, latDeg: number, lstDegNow: number, now: number, h0 = 0): RiseSet {
  const toMs = (deg: number): number => (wrap360(deg) / 360) * 86_400_000 * SIDEREAL;
  const transit = now + toMs(raDeg - lstDegNow);
  const phi = latDeg * DEG;
  const d = decDeg * DEG;
  const cosH0 = (Math.sin(h0 * DEG) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  const transitAltitude = 90 - Math.abs(latDeg - decDeg);
  const transitAzimuth = decDeg > latDeg ? 0 : 180;
  if (cosH0 < -1) return { rise: null, transit, set: null, circumpolar: true, neverRises: false, transitAltitude, transitAzimuth };
  if (cosH0 > 1) return { rise: null, transit, set: null, circumpolar: false, neverRises: true, transitAltitude, transitAzimuth };
  const H0 = Math.acos(cosH0) * RAD; // degrees of hour angle
  const halfMs = (H0 / 360) * 86_400_000 * SIDEREAL;
  const day = 86_400_000 * SIDEREAL;
  let rise = transit - halfMs;
  let set = transit + halfMs;
  // next occurrences after now
  while (rise < now) rise += day;
  while (set < now) set += day;
  return { rise, transit, set, circumpolar: false, neverRises: false, transitAltitude, transitAzimuth };
}

export type MatchLevel = 'MATCH HIGH' | 'MATCH MEDIUM' | 'MATCH LOW';
