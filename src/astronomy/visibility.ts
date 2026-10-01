import { shadowFraction, sunPos } from 'satellite.js';
import { RAD } from '../utils/degrees.ts';
import type { Vec3 } from '../utils/math.ts';
import { eciToEcfVec, type Instant, type ObserverFrame } from './propagator.ts';
import type { VisibilityLabel, VisibilityReason } from './types.ts';

const AU_KM = 149_597_870.7;

export interface VisibilityAssessment {
  label: VisibilityLabel;
  reason: VisibilityReason;
  sunElevation: number;
  illuminated: boolean;
}

export function sunElevation(frame: ObserverFrame, at: Instant): number {
  const s = sunPos(at.jd).rsun;
  const ecf = eciToEcfVec([s.x, s.y, s.z], at);
  return Math.asin(Math.max(-1, Math.min(1, frame.direction(ecf)[2]))) * RAD;
}

/**
 * Conservative naked-eye visibility estimate. SkyTrace only claims LIKELY VISIBLE
 * when the sky is dark, the object is sunlit, reasonably high and reasonably near.
 * Brightness (standard magnitude) is not modelled, so this is never a certainty.
 */
export function assessVisibility(
  frame: ObserverFrame,
  at: Instant,
  satEci: Vec3,
  satElevation: number,
  rangeKm: number,
): VisibilityAssessment {
  const sunEl = sunElevation(frame, at);
  const s = sunPos(at.jd).rsun;
  let illuminated = true;
  try {
    illuminated = shadowFraction({ x: s.x, y: s.y, z: s.z }, { x: satEci[0], y: satEci[1], z: satEci[2] }) < 0.5;
  } catch {
    // Fallback: simple cylindrical shadow test.
    const sun: Vec3 = [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM];
    const sl = Math.hypot(...sun);
    const u: Vec3 = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
    const along = satEci[0] * u[0] + satEci[1] * u[1] + satEci[2] * u[2];
    const perp = Math.sqrt(Math.max(0, satEci[0] ** 2 + satEci[1] ** 2 + satEci[2] ** 2 - along * along));
    illuminated = along > 0 || perp > 6378;
  }

  let reason: VisibilityReason;
  if (sunEl > 0) reason = 'DAYLIGHT_SKY';
  else if (sunEl > -4) reason = 'TWILIGHT_SKY';
  else if (!illuminated) reason = 'EARTH_SHADOW';
  else if (satElevation < 10) reason = 'LOW_ELEVATION';
  else if (rangeKm > 3000) reason = 'FAINT_RANGE';
  else reason = 'DARK_SKY_SUNLIT';

  return {
    label: reason === 'DARK_SKY_SUNLIT' ? 'LIKELY_VISIBLE' : 'CROSSED_FIELD',
    reason,
    sunElevation: sunEl,
    illuminated,
  };
}

export const VISIBILITY_NOTE: Record<VisibilityReason, string> = {
  DARK_SKY_SUNLIT: 'Sunlit object against a dark sky',
  DAYLIGHT_SKY: 'Sky was in daylight',
  TWILIGHT_SKY: 'Sky too bright (early twilight)',
  EARTH_SHADOW: "Object was in Earth's shadow",
  LOW_ELEVATION: 'Low above the horizon',
  FAINT_RANGE: 'Too distant to see unaided',
};
