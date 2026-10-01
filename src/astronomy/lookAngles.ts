import type { Vec3 } from '../utils/math.ts';
import { vectorToAzEl } from './angularDistance.ts';
import { eciToEcfVec, propagateEci, type Body, type Instant, type ObserverFrame } from './propagator.ts';

export interface LookSample {
  enu: Vec3;
  az: number;
  el: number;
  rangeKm: number;
  eci: Vec3;
}

/** Observer look angles (azimuth, elevation, range) of a body at an instant. */
export function lookAt(body: Body, frame: ObserverFrame, at: Instant): LookSample | null {
  const st = propagateEci(body, at);
  if (!st) return null;
  const { enu, rangeKm } = frame.look(eciToEcfVec(st.pos, at));
  const { az, el } = vectorToAzEl(enu);
  return { enu, az, el, rangeKm, eci: st.pos };
}
