import { wrap360 } from './degrees.ts';

const pad = (n: number, w = 2): string => String(Math.trunc(n)).padStart(w, '0');

export const fmtDeg = (d: number, digits = 1): string => `${d.toFixed(digits)}°`;
export const fmtAz = (d: number): string => `${wrap360(d).toFixed(1).padStart(5, '0')}°`;
export const fmtSignedDeg = (d: number, digits = 1): string => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}°`;

export function utcClock(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Compact Zulu stamp used in TRACE IDs, e.g. 061422Z */
export function zulu(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function localClock(t: number, seconds = false): string {
  const d = new Date(t);
  const s = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${s}:${pad(d.getSeconds())}` : s;
}

export function relativeMinutes(ms: number): string {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

export const ago = (t: number, now = Date.now()): string => `${relativeMinutes(now - t)} ago`;
export const inTime = (t: number, now = Date.now()): string => `in ${relativeMinutes(t - now)}`;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export type DistanceUnit = 'km' | 'mi';
export function fmtDistance(km: number, unit: DistanceUnit, digits = 0): string {
  const v = unit === 'km' ? km : km * 0.621371;
  return `${v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${unit}`;
}
export function fmtSpeed(kms: number, unit: DistanceUnit): string {
  const v = unit === 'km' ? kms : kms * 0.621371;
  return `${v.toFixed(2)} ${unit}/s`;
}

export function fmtWindow(minutes: number): string {
  if (minutes < 60) return `${minutes} MINUTES`;
  const h = minutes / 60;
  return h === 1 ? '60 MINUTES' : `${h} HOURS`;
}

export function fmtLatLon(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}
