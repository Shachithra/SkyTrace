import type { OrbitRecord } from './types.ts';

/**
 * Locally generated, clearly labelled SIMULATED orbits. Used only when no real
 * orbital data is available (first run offline, or the source is unreachable),
 * so the instrument can still be explored. Never presented as real objects.
 */
export function generateSimulatedOrbits(now: number, count = 1600): OrbitRecord[] {
  // Deterministic per UTC day so a demo session is reproducible.
  let seed = Math.floor(now / 86_400_000) * 2654435761;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const epoch = new Date(now - 3_600_000).toISOString().replace('Z', '');
  const shells = [
    { share: 0.55, mm: [15.05, 15.25], inc: [53, 53.2] }, // dense LEO shell
    { share: 0.2, mm: [14.1, 14.9], inc: [96.5, 99] }, // sun-synchronous
    { share: 0.2, mm: [14.5, 15.6], inc: [28, 75] }, // mixed LEO
    { share: 0.04, mm: [1.9, 2.1], inc: [54, 56] }, // MEO navigation
    { share: 0.01, mm: [1.0027, 1.0027], inc: [0, 0.1] }, // geostationary
  ];
  const out: OrbitRecord[] = [];
  for (let i = 0; i < count; i++) {
    let r = rand();
    let shell = shells[0];
    for (const s of shells) {
      if (r < s.share) {
        shell = s;
        break;
      }
      r -= s.share;
    }
    const pick = (lo: number, hi: number): number => lo + (hi - lo) * rand();
    out.push({
      OBJECT_NAME: `SIM-${String(i + 1).padStart(4, '0')}`,
      OBJECT_ID: 'SIMULATED',
      EPOCH: epoch,
      MEAN_MOTION: pick(shell.mm[0], shell.mm[1]),
      ECCENTRICITY: pick(0.0001, 0.002),
      INCLINATION: pick(shell.inc[0], shell.inc[1]),
      RA_OF_ASC_NODE: pick(0, 360),
      ARG_OF_PERICENTER: pick(0, 360),
      MEAN_ANOMALY: pick(0, 360),
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      NORAD_CAT_ID: 900000 + i,
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 1,
      BSTAR: 0,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
      groups: ['simulated'],
      simulated: true,
    });
  }
  return out;
}
