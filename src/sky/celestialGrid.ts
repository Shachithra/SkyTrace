import type { Vec3 } from '../utils/math.ts';
import { azElToVector } from '../astronomy/angularDistance.ts';
import { HorizonFrame, raDecToVec } from './raDecToAltAz.ts';

export interface GridLine {
  kind: 'alt' | 'az' | 'ra' | 'dec' | 'horizon' | 'equator';
  value: number;
  points: Vec3[]; // ENU unit vectors
}

/** Alt-azimuth grid: altitude circles every 15°, azimuth lines every 15° (ENU polylines). */
export function altAzGrid(): GridLine[] {
  const out: GridLine[] = [];
  for (let el = 0; el <= 75; el += 15) {
    const pts: Vec3[] = [];
    for (let az = 0; az <= 360; az += 2) pts.push(azElToVector(az, el));
    out.push({ kind: el === 0 ? 'horizon' : 'alt', value: el, points: pts });
  }
  for (let az = 0; az < 360; az += 15) {
    const pts: Vec3[] = [];
    for (let el = -8; el <= 88; el += 2) pts.push(azElToVector(az, el));
    out.push({ kind: 'az', value: az, points: pts });
  }
  return out;
}

/** Equatorial grid of date: RA every 2h, Dec every 15°, plus the celestial equator. */
export function equatorialGrid(frame: HorizonFrame): GridLine[] {
  const out: GridLine[] = [];
  for (let dec = -75; dec <= 75; dec += 15) {
    const pts: Vec3[] = [];
    for (let ra = 0; ra <= 360; ra += 3) pts.push(frame.toEnu(raDecToVec(ra, dec)));
    out.push({ kind: dec === 0 ? 'equator' : 'dec', value: dec, points: pts });
  }
  for (let h = 0; h < 24; h += 2) {
    const pts: Vec3[] = [];
    for (let dec = -88; dec <= 88; dec += 3) pts.push(frame.toEnu(raDecToVec(h * 15, dec)));
    out.push({ kind: 'ra', value: h, points: pts });
  }
  return out;
}
