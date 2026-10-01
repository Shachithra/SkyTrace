import { wrap360 } from '../utils/degrees.ts';

export const J2000 = 2451545.0;

/** Julian centuries since J2000.0 (TT ≈ UT for this precision). */
export const centuries = (jd: number): number => (jd - J2000) / 36525;

/** Greenwich mean sidereal time in degrees (IAU 1982, Meeus 12.4). */
export function gmstDeg(jd: number): number {
  const T = centuries(jd);
  return wrap360(280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/** Local mean sidereal time in degrees; longitude east-positive. */
export const lstDeg = (jd: number, lonDeg: number): number => wrap360(gmstDeg(jd) + lonDeg);

/** Sidereal time formatted as hours and minutes ("5h 35m"). */
export function fmtHours(deg: number): string {
  const h = wrap360(deg) / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}
