import { shadowFraction, sunPos } from 'satellite.js';
import { RAD } from '../utils/degrees.ts';
import type { Vec3 } from '../utils/math.ts';
import { ecfToEciVec, eciToEcfVec, type Instant, type ObserverFrame } from './propagator.ts';
import type { OrbitRecord, VisibilityLabel, VisibilityReason } from './types.ts';

const AU_KM = 149_597_870.7;

/** Three-tier status used by live sky + pass predictions (blueprint V2 §11). */
export type VisibilityStatus = 'LIKELY_VISIBLE' | 'POSSIBLY_VISIBLE' | 'NOT_EXPECTED';

export const STATUS_TEXT: Record<VisibilityStatus, string> = {
  LIKELY_VISIBLE: 'LIKELY VISIBLE',
  POSSIBLY_VISIBLE: 'POSSIBLY VISIBLE',
  NOT_EXPECTED: 'NOT EXPECTED TO BE VISIBLE',
};

export interface VisibilityAssessment {
  label: VisibilityLabel;
  status: VisibilityStatus;
  reason: VisibilityReason;
  sunElevation: number;
  illuminated: boolean;
  /** Estimated apparent magnitude (null when not sunlit). */
  estMagnitude: number | null;
}

export function sunElevation(frame: ObserverFrame, at: Instant): number {
  const s = sunPos(at.jd).rsun;
  const ecf = eciToEcfVec([s.x, s.y, s.z], at);
  return Math.asin(Math.max(-1, Math.min(1, frame.direction(ecf)[2]))) * RAD;
}

/**
 * Standard (intrinsic) magnitude at 1000 km range and 90° phase. Known values for
 * a few bright objects; otherwise a conservative estimate from the object type.
 */
export function standardMagnitude(rec: Pick<OrbitRecord, 'NORAD_CAT_ID' | 'OBJECT_NAME'>): number {
  const known: Record<number, number> = {
    25544: -1.8, // ISS
    48274: -0.6, // Tianhe (CSS)
    20580: 2.2, // Hubble
    25994: 3.0, // Terra
    27424: 3.0, // Aqua
    43013: 4.5, // NOAA 20
    33591: 4.0, // NOAA 19
  };
  if (known[rec.NORAD_CAT_ID] !== undefined) return known[rec.NORAD_CAT_ID];
  const n = rec.OBJECT_NAME.toUpperCase();
  if (n.includes(' DEB')) return 7.5;
  if (n.includes('R/B')) return 3.5;
  if (n.startsWith('STARLINK')) return 5.0;
  if (n.startsWith('ONEWEB')) return 7.5;
  if (n.startsWith('IRIDIUM')) return 6.0;
  if (n.startsWith('COSMOS')) return 4.5;
  return 5.0;
}

function phaseAngle(sat: Vec3, sun: Vec3, obs: Vec3): number {
  const a: Vec3 = [sun[0] - sat[0], sun[1] - sat[1], sun[2] - sat[2]];
  const b: Vec3 = [obs[0] - sat[0], obs[1] - sat[1], obs[2] - sat[2]];
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Diffuse-sphere phase function normalised to 1 at 90°. */
const phaseFactor = (phi: number): number => ((Math.sin(phi) + (Math.PI - phi) * Math.cos(phi)) / Math.PI) / (1 / Math.PI);

/** Rough naked-eye limiting magnitude from sun altitude (suburban sky). */
function skyLimit(sunEl: number): number {
  if (sunEl > -3) return 0;
  if (sunEl > -6) return 2.5;
  if (sunEl > -12) return 3.8;
  return 4.8;
}

/**
 * Visibility estimate: observer darkness (sun altitude), satellite illumination
 * (Earth-shadow fraction), range, elevation, and object type / known brightness.
 * "Above the horizon" is never treated as "visible".
 */
export function assessVisibility(
  frame: ObserverFrame,
  at: Instant,
  satEci: Vec3,
  satElevation: number,
  rangeKm: number,
  rec?: Pick<OrbitRecord, 'NORAD_CAT_ID' | 'OBJECT_NAME'>,
): VisibilityAssessment {
  const sunEl = sunElevation(frame, at);
  const s = sunPos(at.jd).rsun;
  const sunKm: Vec3 = [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM];
  let illuminated = true;
  try {
    illuminated = shadowFraction({ x: s.x, y: s.y, z: s.z }, { x: satEci[0], y: satEci[1], z: satEci[2] }) < 0.5;
  } catch {
    const sl = Math.hypot(...sunKm);
    const u: Vec3 = [sunKm[0] / sl, sunKm[1] / sl, sunKm[2] / sl];
    const along = satEci[0] * u[0] + satEci[1] * u[1] + satEci[2] * u[2];
    const perp = Math.sqrt(Math.max(0, satEci[0] ** 2 + satEci[1] ** 2 + satEci[2] ** 2 - along * along));
    illuminated = along > 0 || perp > 6378;
  }

  let estMagnitude: number | null = null;
  if (illuminated) {
    const obsEci = ecfToEciVec(frame.ecf, at);
    const phi = phaseAngle(satEci, sunKm, obsEci);
    const std = rec ? standardMagnitude(rec) : 5;
    estMagnitude = std + 5 * Math.log10(Math.max(100, rangeKm) / 1000) - 2.5 * Math.log10(Math.max(0.01, phaseFactor(phi)));
  }

  let reason: VisibilityReason;
  let status: VisibilityStatus;
  const limit = skyLimit(sunEl);
  if (sunEl > 0) [reason, status] = ['DAYLIGHT_SKY', 'NOT_EXPECTED'];
  else if (sunEl > -3) [reason, status] = ['TWILIGHT_SKY', 'NOT_EXPECTED'];
  else if (!illuminated) [reason, status] = ['EARTH_SHADOW', 'NOT_EXPECTED'];
  else if (satElevation < 5) [reason, status] = ['LOW_ELEVATION', 'NOT_EXPECTED'];
  else if (estMagnitude !== null && estMagnitude <= limit - 0.5 && satElevation >= 10) [reason, status] = ['DARK_SKY_SUNLIT', 'LIKELY_VISIBLE'];
  else if (estMagnitude !== null && estMagnitude <= limit + 1) [reason, status] = [satElevation < 10 ? 'LOW_ELEVATION' : sunEl > -6 ? 'TWILIGHT_SKY' : 'DARK_SKY_SUNLIT', 'POSSIBLY_VISIBLE'];
  else [reason, status] = [rangeKm > 3000 ? 'FAINT_RANGE' : 'TOO_FAINT', 'NOT_EXPECTED'];

  const label: VisibilityLabel = status === 'LIKELY_VISIBLE' ? 'LIKELY_VISIBLE' : status === 'POSSIBLY_VISIBLE' ? 'POSSIBLY_VISIBLE' : 'CROSSED_FIELD';
  return { label, status, reason, sunElevation: sunEl, illuminated, estMagnitude };
}

export const VISIBILITY_NOTE: Record<VisibilityReason, string> = {
  DARK_SKY_SUNLIT: 'Sunlit object against a dark sky',
  DAYLIGHT_SKY: 'Sky was in daylight',
  TWILIGHT_SKY: 'Sky too bright (twilight)',
  EARTH_SHADOW: "Object in Earth's shadow",
  LOW_ELEVATION: 'Low above the horizon',
  FAINT_RANGE: 'Too distant to see unaided',
  TOO_FAINT: 'Probably too faint to see unaided',
};

export const LABEL_TEXT: Record<VisibilityLabel, string> = {
  LIKELY_VISIBLE: 'LIKELY VISIBLE',
  POSSIBLY_VISIBLE: 'POSSIBLY VISIBLE',
  CROSSED_FIELD: 'CROSSED FIELD',
};
