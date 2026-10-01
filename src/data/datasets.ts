/** CelesTrak General Perturbations groups available to SkyTrace (OMM JSON). */
export interface DatasetDef {
  id: string;
  label: string;
  note: string;
  approxObjects: string;
  heavy?: boolean;
}

export const DATASETS: DatasetDef[] = [
  { id: 'stations', label: 'STATIONS', note: 'ISS, Tiangong and visiting vehicles', approxObjects: '~30' },
  { id: 'visual', label: 'VISUAL', note: 'The ~100 brightest objects', approxObjects: '~160' },
  { id: 'weather', label: 'WEATHER', note: 'Meteorological satellites', approxObjects: '~70' },
  { id: 'gnss', label: 'NAVIGATION', note: 'GPS, Galileo, GLONASS, BeiDou', approxObjects: '~130' },
  { id: 'science', label: 'SCIENCE', note: 'Space & Earth science missions', approxObjects: '~70' },
  { id: 'starlink', label: 'STARLINK', note: 'Large constellation — slower traces', approxObjects: '~9,000', heavy: true },
  { id: 'active', label: 'ALL ACTIVE', note: 'Every active payload — slowest traces', approxObjects: '~13,000', heavy: true },
];

export const DEFAULT_DATASETS = ['stations', 'visual', 'weather', 'gnss', 'science'];

export const CELESTRAK_ORIGIN = 'https://celestrak.org';
export const gpUrl = (group: string, origin = CELESTRAK_ORIGIN): string =>
  `${origin}/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
export const satcatUrl = (catnr: number, origin = CELESTRAK_ORIGIN): string =>
  `${origin}/satcat/records.php?CATNR=${catnr}&FORMAT=json`;

/**
 * CelesTrak updates GP data roughly every two hours and asks clients not to
 * download the same data more often than that. SkyTrace never refreshes a
 * group sooner than MIN_REFRESH_MS, and backs off after failures.
 */
export const MIN_REFRESH_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000;
export const FAILURE_BACKOFF_MS = 20 * 60 * 1000;
/** Element sets older than this make predictions noticeably less reliable. */
export const STALE_ELEMENTS_MS = 3 * 24 * 60 * 60 * 1000;
