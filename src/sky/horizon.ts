import { DEG, RAD, wrap360 } from '../utils/degrees.ts';
import { HorizonFrame, raDecToVec } from './raDecToAltAz.ts';
import { J2000, lstDeg } from './siderealTime.ts';

export type TwilightState = 'DAY' | 'CIVIL TWILIGHT' | 'NAUTICAL TWILIGHT' | 'ASTRONOMICAL TWILIGHT' | 'NIGHT';

/** Low-precision solar position (Astronomical Almanac, ~0.01°). */
export function sunRaDec(jd: number): { ra: number; dec: number } {
  const n = jd - J2000;
  const L = wrap360(280.46 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return { ra: wrap360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * RAD), dec: Math.asin(Math.sin(eps) * Math.sin(lam)) * RAD };
}

export function sunAltitude(jd: number, latDeg: number, lonDeg: number): number {
  const s = sunRaDec(jd);
  const e = new HorizonFrame(lstDeg(jd, lonDeg), latDeg).toEnu(raDecToVec(s.ra, s.dec));
  return Math.asin(Math.max(-1, Math.min(1, e[2]))) * RAD;
}

export function twilightState(sunAlt: number): TwilightState {
  if (sunAlt > -0.833) return 'DAY';
  if (sunAlt > -6) return 'CIVIL TWILIGHT';
  if (sunAlt > -12) return 'NAUTICAL TWILIGHT';
  if (sunAlt > -18) return 'ASTRONOMICAL TWILIGHT';
  return 'NIGHT';
}

/** Approximate naked-eye limiting magnitude for the sky brightness (suburban baseline). */
export function limitingMagnitude(sunAlt: number): number {
  if (sunAlt > -0.833) return -1.5;
  if (sunAlt > -3) return 0.5;
  if (sunAlt > -6) return 2;
  if (sunAlt > -12) return 3.5;
  if (sunAlt > -18) return 4.5;
  return 5.2;
}

/** Find the next time (after `from`) the Sun crosses `alt` going down / up, scanning in 5-min steps. */
export function nextSunCrossing(from: number, latDeg: number, lonDeg: number, alt: number, direction: 'down' | 'up', limitHours = 36): number | null {
  const jdOf = (t: number): number => t / 86_400_000 + 2440587.5;
  const step = 5 * 60_000;
  let prev = sunAltitude(jdOf(from), latDeg, lonDeg) - alt;
  for (let t = from + step; t <= from + limitHours * 3_600_000; t += step) {
    const cur = sunAltitude(jdOf(t), latDeg, lonDeg) - alt;
    if ((direction === 'down' && prev > 0 && cur <= 0) || (direction === 'up' && prev < 0 && cur >= 0)) {
      let a = t - step;
      let b = t;
      for (let i = 0; i < 12; i++) {
        const m = (a + b) / 2;
        const v = sunAltitude(jdOf(m), latDeg, lonDeg) - alt;
        if ((direction === 'down' ? v > 0 : v < 0)) a = m;
        else b = m;
      }
      return b;
    }
    prev = cur;
  }
  return null;
}

/** "Tonight": from now (or this evening's dusk) until next dawn, using civil twilight. */
export function tonightWindow(now: number, latDeg: number, lonDeg: number): { start: number; end: number } {
  const jd = now / 86_400_000 + 2440587.5;
  const alt = sunAltitude(jd, latDeg, lonDeg);
  const start = alt < -6 ? now : nextSunCrossing(now, latDeg, lonDeg, -6, 'down') ?? now;
  const end = nextSunCrossing(start, latDeg, lonDeg, -6, 'up') ?? start + 12 * 3_600_000;
  return { start, end };
}
