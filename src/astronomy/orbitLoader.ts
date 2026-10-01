import type { OrbitRecord } from './types.ts';
import { parseOmmEpoch } from './time.ts';

const NUMERIC_FIELDS = [
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'NORAD_CAT_ID',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

const toNum = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

/** Strip control characters and cap length: catalogue names are external data. */
export function sanitizeText(v: unknown, max = 64): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

/**
 * Validate an untrusted OMM JSON payload (CelesTrak GP FORMAT=json) and return
 * normalised records. Anything malformed is dropped rather than trusted.
 */
export function parseOmmPayload(payload: unknown, group?: string): { records: OrbitRecord[]; rejected: number } {
  if (!Array.isArray(payload)) throw new Error('Orbital data is not an OMM JSON array');
  const records: OrbitRecord[] = [];
  let rejected = 0;
  for (const raw of payload) {
    const rec = normaliseOmm(raw, group);
    if (rec) records.push(rec);
    else rejected++;
  }
  return { records, rejected };
}

export function normaliseOmm(raw: unknown, group?: string): OrbitRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const nums: Record<string, number> = {};
  for (const k of NUMERIC_FIELDS) {
    const n = toNum(o[k]);
    if (!Number.isFinite(n)) return null;
    nums[k] = n;
  }
  const epoch = typeof o.EPOCH === 'string' ? o.EPOCH : '';
  if (!Number.isFinite(parseOmmEpoch(epoch))) return null;
  const ephem = o.EPHEMERIS_TYPE === undefined ? 0 : toNum(o.EPHEMERIS_TYPE);
  if (ephem !== 0) return null; // SGP4 elements only
  if (nums.MEAN_MOTION <= 0 || nums.ECCENTRICITY < 0 || nums.ECCENTRICITY >= 1) return null;
  if (!Number.isInteger(nums.NORAD_CAT_ID) || nums.NORAD_CAT_ID <= 0) return null;

  const name = sanitizeText(o.OBJECT_NAME) || `NORAD ${nums.NORAD_CAT_ID}`;
  return {
    OBJECT_NAME: name,
    OBJECT_ID: sanitizeText(o.OBJECT_ID, 16),
    EPOCH: epoch,
    MEAN_MOTION: nums.MEAN_MOTION,
    ECCENTRICITY: nums.ECCENTRICITY,
    INCLINATION: nums.INCLINATION,
    RA_OF_ASC_NODE: nums.RA_OF_ASC_NODE,
    ARG_OF_PERICENTER: nums.ARG_OF_PERICENTER,
    MEAN_ANOMALY: nums.MEAN_ANOMALY,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: o.CLASSIFICATION_TYPE === 'C' ? 'C' : 'U',
    NORAD_CAT_ID: nums.NORAD_CAT_ID,
    ELEMENT_SET_NO: Number.isFinite(toNum(o.ELEMENT_SET_NO)) ? toNum(o.ELEMENT_SET_NO) : 999,
    REV_AT_EPOCH: Number.isFinite(toNum(o.REV_AT_EPOCH)) ? toNum(o.REV_AT_EPOCH) : 0,
    BSTAR: nums.BSTAR,
    MEAN_MOTION_DOT: nums.MEAN_MOTION_DOT,
    MEAN_MOTION_DDOT: nums.MEAN_MOTION_DDOT,
    groups: group ? [group] : [],
  };
}

/** Merge several groups, de-duplicating by NORAD id and keeping the freshest epoch. */
export function mergeRecords(lists: OrbitRecord[][]): OrbitRecord[] {
  const byId = new Map<number, OrbitRecord>();
  for (const list of lists) {
    for (const r of list) {
      const prev = byId.get(r.NORAD_CAT_ID);
      if (!prev) {
        byId.set(r.NORAD_CAT_ID, { ...r, groups: [...(r.groups ?? [])] });
        continue;
      }
      const groups = Array.from(new Set([...(prev.groups ?? []), ...(r.groups ?? [])]));
      const newer = parseOmmEpoch(r.EPOCH) > parseOmmEpoch(prev.EPOCH) ? r : prev;
      byId.set(r.NORAD_CAT_ID, { ...newer, groups });
    }
  }
  return Array.from(byId.values());
}
