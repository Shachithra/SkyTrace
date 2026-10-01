import { compass8, wrap360 } from '../utils/degrees.ts';
import { azElToVector } from './angularDistance.ts';

/** "NW → SE" style label from the start / end azimuths of a pass. */
export function directionLabel(startAz: number | null, endAz: number | null, motionDeg: number, bearing: number): string {
  if (motionDeg < 0.5) return 'FIXED IN SKY';
  if (startAz === null || endAz === null) return `MOVING ${compass8(bearing)}`;
  const a = compass8(startAz);
  const b = compass8(endAz);
  // Low passes can rise and set within the same compass sector; describe motion instead.
  if (a === b) return `${a} · MOVING ${compass8(bearing)}`;
  return `${a} → ${b}`;
}

/**
 * Compass bearing of the apparent motion across the sky, measured in the
 * horizontal plane between two sky positions. A pass rising W and setting E
 * has a bearing near 90°.
 */
export function travelBearing(az0: number, el0: number, az1: number, el1: number): number {
  const a = azElToVector(az0, el0);
  const b = azElToVector(az1, el1);
  const de = b[0] - a[0];
  const dn = b[1] - a[1];
  if (Math.abs(de) < 1e-12 && Math.abs(dn) < 1e-12) return 0;
  return wrap360((Math.atan2(de, dn) * 180) / Math.PI);
}
