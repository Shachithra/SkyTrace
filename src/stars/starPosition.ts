import { HorizonFrame, mul, precessionMatrix, raDecToVec, refractEnu, type Mat3 } from '../sky/raDecToAltAz.ts';
import { lstDeg } from '../sky/siderealTime.ts';
import type { Vec3 } from '../utils/math.ts';
import type { StarCatalogData } from './starCatalog.ts';

/** J2000 unit vectors for every catalogue star, computed once. */
export function catalogVectors(cat: StarCatalogData): Float64Array {
  const out = new Float64Array(cat.stars.length * 3);
  cat.stars.forEach((s, i) => {
    const v = raDecToVec(s[1], s[2]);
    out[i * 3] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  });
  return out;
}

export interface SkyFrame {
  jd: number;
  lst: number;
  precession: Mat3;
  horizon: HorizonFrame;
}

export function skyFrame(jd: number, latDeg: number, lonDeg: number): SkyFrame {
  const lst = lstDeg(jd, lonDeg);
  return { jd, lst, precession: precessionMatrix(jd), horizon: new HorizonFrame(lst, latDeg) };
}

/** J2000 vector → apparent ENU vector (precession → horizon → refraction). */
export function j2000ToEnu(v: Vec3, f: SkyFrame, refract = true): Vec3 {
  const e = f.horizon.toEnu(mul(f.precession, v));
  return refract ? refractEnu(e) : e;
}

/**
 * Star field for an observer and instant: ENU vectors + magnitude for stars
 * above the horizon and brighter than the limit. Returns packed arrays.
 */
export function computeStarField(
  vecs: Float64Array,
  mags: Float32Array,
  f: SkyFrame,
  limitMag: number,
): { index: Uint16Array; enu: Float32Array } {
  const idx: number[] = [];
  const enu: number[] = [];
  const n = mags.length;
  for (let i = 0; i < n; i++) {
    if (mags[i] > limitMag) break; // catalogue is sorted bright → faint
    const e = j2000ToEnu([vecs[i * 3], vecs[i * 3 + 1], vecs[i * 3 + 2]], f);
    if (e[2] < -0.02) continue;
    idx.push(i);
    enu.push(e[0], e[1], e[2]);
  }
  return { index: Uint16Array.from(idx), enu: Float32Array.from(enu) };
}
