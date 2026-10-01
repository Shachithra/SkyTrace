/** Julian date helpers. JD of the Unix epoch is 2440587.5. */
export const MS_PER_DAY = 86_400_000;
export const julianDate = (ms: number): number => ms / MS_PER_DAY + 2440587.5;
export const msFromJulian = (jd: number): number => (jd - 2440587.5) * MS_PER_DAY;

/** Parse an OMM epoch (ISO 8601 without zone, always UTC) to epoch ms. */
export function parseOmmEpoch(epoch: string): number {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? epoch : `${epoch}Z`;
  return Date.parse(iso);
}

export const minutes = (n: number): number => n * 60_000;
export const seconds = (n: number): number => n * 1000;
