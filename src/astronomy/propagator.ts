import {
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  json2satrec,
  sgp4,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import { DEG, RAD } from '../utils/degrees.ts';
import { normalize, type Vec3 } from '../utils/math.ts';
import type { Observer, OrbitRecord } from './types.ts';
import { julianDate, parseOmmEpoch } from './time.ts';

export interface Body {
  id: string;
  rec: OrbitRecord;
  satrec: SatRec;
  epochMs: number;
}

/** Build an SGP4 satellite record from an OMM record. Returns null when the elements are unusable. */
export function createBody(rec: OrbitRecord): Body | null {
  try {
    const satrec = json2satrec(rec as unknown as OMMJsonObject);
    if (!satrec || satrec.error) return null;
    return { id: String(rec.NORAD_CAT_ID), rec, satrec, epochMs: parseOmmEpoch(rec.EPOCH) };
  } catch {
    return null;
  }
}

/** Precomputed sidereal rotation for one instant. Shared by every satellite at that instant. */
export interface Instant {
  t: number;
  jd: number;
  gmst: number;
  cosG: number;
  sinG: number;
}

export function instant(t: number): Instant {
  const jd = julianDate(t);
  const gmst = gstime(jd);
  return { t, jd, gmst, cosG: Math.cos(gmst), sinG: Math.sin(gmst) };
}

export interface StateEci {
  pos: Vec3; // km, TEME/ECI
  vel: Vec3; // km/s
}

/** Propagate a body to an instant. Returns null on SGP4 failure (e.g. decayed object). */
export function propagateEci(body: Body, at: Instant): StateEci | null {
  const tsince = (at.jd - body.satrec.jdsatepoch) * 1440;
  const pv = sgp4(body.satrec, tsince);
  if (!pv || !pv.position || body.satrec.error) {
    // sgp4 flags errors on the record; reset so later instants can still be tried.
    body.satrec.error = 0;
    return null;
  }
  const p = pv.position;
  const v = pv.velocity;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  return { pos: [p.x, p.y, p.z], vel: [v.x, v.y, v.z] };
}

export function eciToEcfVec(p: Vec3, at: Instant): Vec3 {
  return [p[0] * at.cosG + p[1] * at.sinG, -p[0] * at.sinG + p[1] * at.cosG, p[2]];
}

export function ecfToEciVec(p: Vec3, at: Instant): Vec3 {
  return [p[0] * at.cosG - p[1] * at.sinG, p[0] * at.sinG + p[1] * at.cosG, p[2]];
}

export function geodeticOf(pos: Vec3, at: Instant): { latitude: number; longitude: number; altitudeKm: number } {
  const g = eciToGeodetic({ x: pos[0], y: pos[1], z: pos[2] }, at.gmst);
  let lon = g.longitude * RAD;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { latitude: g.latitude * RAD, longitude: lon, altitudeKm: g.height };
}

/**
 * Observer-fixed topocentric frame. Turns Earth-fixed satellite positions into
 * East-North-Up look vectors without the per-call allocations of the generic API.
 */
export class ObserverFrame {
  readonly ecf: Vec3;
  readonly east: Vec3;
  readonly north: Vec3;
  readonly up: Vec3;
  readonly observer: Observer;

  constructor(observer: Observer) {
    this.observer = observer;
    const lat = observer.latitude * DEG;
    const lon = observer.longitude * DEG;
    const o = geodeticToEcf({ latitude: lat, longitude: lon, height: observer.altitudeKm || 0 });
    this.ecf = [o.x, o.y, o.z];
    const sl = Math.sin(lat);
    const cl = Math.cos(lat);
    const so = Math.sin(lon);
    const co = Math.cos(lon);
    this.east = [-so, co, 0];
    this.north = [-sl * co, -sl * so, cl];
    this.up = [cl * co, cl * so, sl];
  }

  /** Unit ENU look vector + slant range for an Earth-fixed position. */
  look(ecf: Vec3): { enu: Vec3; rangeKm: number } {
    const dx = ecf[0] - this.ecf[0];
    const dy = ecf[1] - this.ecf[1];
    const dz = ecf[2] - this.ecf[2];
    const e = dx * this.east[0] + dy * this.east[1] + dz * this.east[2];
    const n = dx * this.north[0] + dy * this.north[1] + dz * this.north[2];
    const u = dx * this.up[0] + dy * this.up[1] + dz * this.up[2];
    const r = Math.hypot(e, n, u);
    return { enu: [e / r, n / r, u / r], rangeKm: r };
  }

  /** ENU unit vector of an arbitrary Earth-fixed direction (e.g. the Sun). */
  direction(ecfDir: Vec3): Vec3 {
    const d = normalize(ecfDir);
    return [
      d[0] * this.east[0] + d[1] * this.east[1] + d[2] * this.east[2],
      d[0] * this.north[0] + d[1] * this.north[1] + d[2] * this.north[2],
      d[0] * this.up[0] + d[1] * this.up[1] + d[2] * this.up[2],
    ];
  }
}

export const EARTH_RADIUS_KM = 6378.137;
export const MU_KM3_S2 = 398600.4418;

export function orbitGeometry(rec: OrbitRecord) {
  const n = (rec.MEAN_MOTION * 2 * Math.PI) / 86400; // rad/s
  const a = Math.cbrt(MU_KM3_S2 / (n * n));
  const e = rec.ECCENTRICITY;
  return {
    semiMajorKm: a,
    periodMin: 1440 / rec.MEAN_MOTION,
    apogeeKm: a * (1 + e) - EARTH_RADIUS_KM,
    perigeeKm: a * (1 - e) - EARTH_RADIUS_KM,
  };
}
