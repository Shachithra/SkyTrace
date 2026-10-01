import { DEG } from '../utils/degrees.ts';
import { azElToVector } from '../astronomy/angularDistance.ts';
import { cross, dot, normalize, type Vec3 } from '../utils/math.ts';

export interface ScreenPoint {
  x: number;
  y: number;
  front: boolean;
}

export interface Projector {
  readonly kind: 'pointing' | 'allsky';
  project(v: Vec3): ScreenPoint;
  unproject(x: number, y: number): Vec3 | null;
  /** Approximate pixels per degree at the view centre. */
  pxPerDeg: number;
}

/**
 * Gnomonic (rectilinear) projection about the pointing direction — what a camera
 * sees. Great circles (satellite paths, the horizon) project to straight lines.
 */
export class PointingProjector implements Projector {
  readonly kind = 'pointing';
  private f: Vec3;
  private r: Vec3;
  private u: Vec3;
  readonly focal: number;
  readonly cx: number;
  readonly cy: number;

  /** fovDeg spans the shorter screen dimension. */
  constructor(centerAz: number, centerEl: number, fovDeg: number, width: number, height: number, cx = width / 2, cy = height / 2) {
    const az = centerAz * DEG;
    this.f = azElToVector(centerAz, Math.max(-89.5, Math.min(89.5, centerEl)));
    this.r = [Math.cos(az), -Math.sin(az), 0];
    this.u = cross(this.r, this.f);
    this.focal = Math.min(width, height) / 2 / Math.tan((fovDeg / 2) * DEG);
    this.cx = cx;
    this.cy = cy;
  }

  get pxPerDeg(): number {
    return this.focal * DEG;
  }

  project(p: Vec3): ScreenPoint {
    const z = dot(p, this.f);
    if (z <= 0.08) return { x: 0, y: 0, front: false };
    return { x: this.cx + (dot(p, this.r) / z) * this.focal, y: this.cy - (dot(p, this.u) / z) * this.focal, front: true };
  }

  unproject(x: number, y: number): Vec3 {
    const a = (x - this.cx) / this.focal;
    const b = -(y - this.cy) / this.focal;
    return normalize([this.f[0] + a * this.r[0] + b * this.u[0], this.f[1] + a * this.r[1] + b * this.u[1], this.f[2] + a * this.r[2] + b * this.u[2]]);
  }
}

/**
 * Circular all-sky map: stereographic projection centred on the zenith,
 * horizon on the outer ring, north up and east on the LEFT (as seen looking up).
 */
export class AllSkyProjector implements Projector {
  readonly kind = 'allsky';
  readonly cx: number;
  readonly cy: number;
  readonly R: number;
  private rot: number;

  constructor(cx: number, cy: number, horizonRadiusPx: number, rotationDeg = 0) {
    this.cx = cx;
    this.cy = cy;
    this.R = horizonRadiusPx;
    this.rot = rotationDeg * DEG;
  }

  get pxPerDeg(): number {
    return (this.R * DEG) / 2;
  }

  project(v: Vec3): ScreenPoint {
    const zen = Math.acos(Math.max(-1, Math.min(1, v[2])));
    if (zen > 92 * DEG) return { x: 0, y: 0, front: false };
    const r = this.R * Math.tan(zen / 2); // tan(45°) = 1 at the horizon
    const az = Math.atan2(v[0], v[1]) - this.rot;
    return { x: this.cx - r * Math.sin(az), y: this.cy - r * Math.cos(az), front: v[2] > -0.02 };
  }

  unproject(x: number, y: number): Vec3 | null {
    const dx = this.cx - x;
    const dy = this.cy - y;
    const r = Math.hypot(dx, dy) / this.R;
    if (r > 1.02) return null;
    const zen = 2 * Math.atan(r);
    const az = Math.atan2(dx, dy) + this.rot;
    const s = Math.sin(zen);
    return [s * Math.sin(az), s * Math.cos(az), Math.cos(zen)];
  }
}
