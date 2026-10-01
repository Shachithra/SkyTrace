/** Magnitude filter presets (blueprint §46) and star drawing helpers. */
export type MagnitudeFilter = 'BRIGHT' | 'STANDARD' | 'DEEP';

export const MAG_LIMIT: Record<MagnitudeFilter, number> = { BRIGHT: 2.0, STANDARD: 4.0, DEEP: 6.0 };

/**
 * Effective limit = min(user filter, what the sky brightness allows).
 * In daylight a few of the brightest stars are still drawn faintly as a guide.
 */
export function effectiveLimit(filter: MagnitudeFilter, skyLimit: number): number {
  return Math.max(1.0, Math.min(MAG_LIMIT[filter], skyLimit + 0.5));
}

/** Radius in CSS px: bright stars larger, dim stars smaller. */
export function starRadius(mag: number, scale = 1): number {
  return Math.max(0.45, Math.min(3.6, 2.7 - 0.42 * mag)) * scale;
}

export function starAlpha(mag: number, limit: number): number {
  return Math.max(0.18, Math.min(1, 1 - (mag - Math.min(1, limit)) / (limit + 2.5)));
}

/** Very subtle colour tint from the B−V index (never saturated). */
export function starTint(bv: number | null): [number, number, number] {
  if (bv === null) return [232, 237, 242];
  if (bv < 0) return [214, 226, 255];
  if (bv < 0.4) return [232, 237, 242];
  if (bv < 0.8) return [246, 240, 226];
  if (bv < 1.3) return [255, 228, 196];
  return [255, 210, 180];
}
