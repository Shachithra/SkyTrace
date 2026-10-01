import { DEG, RAD, wrap360 } from '../utils/degrees.ts';
import type { Vec3 } from '../utils/math.ts';
import { centuries } from './siderealTime.ts';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Equatorial unit vector (x → RA 0h, z → north celestial pole). */
export function raDecToVec(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  const c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}

export function vecToRaDec(v: Vec3): { ra: number; dec: number } {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return { ra: wrap360(Math.atan2(v[1], v[0]) * RAD), dec: Math.asin(Math.max(-1, Math.min(1, v[2] / n))) * RAD };
}

/**
 * IAU 1976 precession matrix, J2000 mean equator → mean equator of date.
 * (Lieske 1979; Meeus ch. 21.) Nutation and aberration (< 40") are ignored —
 * far below phone-compass accuracy.
 */
export function precessionMatrix(jd: number): Mat3 {
  const T = centuries(jd);
  const as = DEG / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * as;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * as;
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(th), st = Math.sin(th);
  return [
    cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ,
    cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ,
    cz * st, -sz * st, ct,
  ];
}

export const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** Transpose = inverse for rotation matrices (date → J2000). */
export const mulT = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/**
 * Observer frame for RA/Dec ↔ Alt/Az. Equatorial (of date) vector → local
 * East-North-Up via local sidereal time (hour angle H = LST − RA) and latitude.
 */
export class HorizonFrame {
  readonly cl: number;
  readonly sl: number;
  readonly cp: number;
  readonly sp: number;
  constructor(lstDegrees: number, latDeg: number) {
    this.cl = Math.cos(lstDegrees * DEG);
    this.sl = Math.sin(lstDegrees * DEG);
    this.cp = Math.cos(latDeg * DEG);
    this.sp = Math.sin(latDeg * DEG);
  }

  /** equatorial-of-date unit vector → ENU unit vector */
  toEnu(v: Vec3): Vec3 {
    const xm = v[0] * this.cl + v[1] * this.sl; // toward the meridian (H = 0)
    const ye = -v[0] * this.sl + v[1] * this.cl; // toward the east (−cosδ·sinH)
    return [ye, v[2] * this.cp - xm * this.sp, v[2] * this.sp + xm * this.cp];
  }

  /** ENU unit vector → equatorial-of-date unit vector */
  fromEnu(e: Vec3): Vec3 {
    const xm = e[2] * this.cp - e[1] * this.sp;
    const z = e[2] * this.sp + e[1] * this.cp;
    const ye = e[0];
    return [xm * this.cl - ye * this.sl, xm * this.sl + ye * this.cl, z];
  }
}

/** Classic closed-form RA/Dec → Alt/Az (degrees), used to cross-check the vector path. */
export function raDecToAltAz(raDeg: number, decDeg: number, latDeg: number, lstDegrees: number): { az: number; alt: number } {
  const H = (lstDegrees - raDeg) * DEG;
  const d = decDeg * DEG;
  const p = latDeg * DEG;
  const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(H) * Math.sin(p));
  return { az: wrap360(az * RAD), alt: alt * RAD };
}

/**
 * Atmospheric refraction (Bennett 1982), degrees to add to the true altitude.
 * Lifts objects near the horizon by up to ~0.5°.
 */
export function refraction(altDeg: number): number {
  if (altDeg < -1.5) return 0;
  const h = Math.max(altDeg, -1);
  return 1 / Math.tan((h + 7.31 / (h + 4.4)) * DEG) / 60;
}

/** Apply refraction to an ENU unit vector (raises the Up component). */
export function refractEnu(e: Vec3): Vec3 {
  const alt = Math.asin(Math.max(-1, Math.min(1, e[2]))) * RAD;
  const r = refraction(alt);
  if (r === 0) return e;
  const na = (alt + r) * DEG;
  const h = Math.hypot(e[0], e[1]) || 1;
  const c = Math.cos(na) / h;
  return [e[0] * c, e[1] * c, Math.sin(na)];
}
