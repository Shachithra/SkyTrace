import { cross, dot, norm, type Vec3 } from '../utils/math.ts';
import { DEG, RAD } from '../utils/degrees.ts';

/** Local East-North-Up unit vector for an azimuth/elevation pair (degrees). */
export function azElToVector(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  const c = Math.cos(el);
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(el)];
}

export function vectorToAzEl(v: Vec3): { az: number; el: number } {
  const n = norm(v) || 1;
  let az = Math.atan2(v[0], v[1]) * RAD;
  if (az < 0) az += 360;
  const el = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) * RAD;
  return { az, el };
}

/**
 * Spherical angular separation between two unit vectors, in degrees.
 * atan2(|a×b|, a·b) stays accurate for both tiny and near-180° separations.
 */
export function separation(a: Vec3, b: Vec3): number {
  return Math.atan2(norm(cross(a, b)), dot(a, b)) * RAD;
}

/** Angular separation between two sky positions given as az/el in degrees. */
export function angularDistance(az1: number, el1: number, az2: number, el2: number): number {
  return separation(azElToVector(az1, el1), azElToVector(az2, el2));
}

/**
 * Minimum angular distance (degrees) from `t` to the great-circle arc p0→p1.
 * Used by the coarse pass so fast objects that jump across the field between
 * two samples are never missed.
 */
export function distanceToArc(t: Vec3, p0: Vec3, p1: Vec3): number {
  const n = cross(p0, p1);
  const nl = norm(n);
  const d0 = separation(t, p0);
  const d1 = separation(t, p1);
  if (nl < 1e-9) return Math.min(d0, d1);
  const nn: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
  const tn = dot(t, nn);
  // Projection of t onto the great circle plane.
  const q: Vec3 = [t[0] - tn * nn[0], t[1] - tn * nn[1], t[2] - tn * nn[2]];
  const ql = norm(q);
  if (ql < 1e-12) return Math.min(d0, d1);
  const qn: Vec3 = [q[0] / ql, q[1] / ql, q[2] / ql];
  const arc = separation(p0, p1);
  const within = Math.abs(separation(p0, qn) + separation(qn, p1) - arc) < 1e-6;
  return within ? Math.asin(Math.min(1, Math.abs(tn))) * RAD : Math.min(d0, d1);
}
