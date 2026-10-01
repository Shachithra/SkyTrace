export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const toRad = (d: number): number => d * DEG;
export const toDeg = (r: number): number => r * RAD;

/** Normalise any angle to [0, 360). */
export function wrap360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Normalise any angle to (-180, 180]. */
export function wrap180(d: number): number {
  const r = wrap360(d);
  return r > 180 ? r - 360 : r;
}

/** Signed shortest rotation from `from` to `to`, in degrees. Never jumps 359 → 0. */
export const shortestDelta = (from: number, to: number): number => wrap180(to - from);

const POINTS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Compass8 = (typeof POINTS_8)[number];
export const COMPASS_8 = POINTS_8;

export function compass8(az: number): Compass8 {
  return POINTS_8[Math.round(wrap360(az) / 45) % 8];
}
