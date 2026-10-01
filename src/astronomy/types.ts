/** Shared data contracts between the main thread and the trace worker. */

export interface Observer {
  latitude: number; // degrees
  longitude: number; // degrees
  altitudeKm: number;
  accuracyM?: number;
}

export interface SkyTarget {
  azimuth: number; // degrees, 0 = N, 90 = E
  elevation: number; // degrees above horizon
  radius: number; // angular radius of the field, degrees
}

/** Normalised OMM (CCSDS Orbit Mean-Elements Message) record, as served by CelesTrak GP JSON. */
export interface OrbitRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  /** CelesTrak groups this object was loaded from. */
  groups?: string[];
  /** True for locally generated demonstration orbits. */
  simulated?: boolean;
}

export interface PathPoint {
  t: number; // epoch ms
  az: number;
  el: number;
}

export type VisibilityLabel = 'LIKELY_VISIBLE' | 'CROSSED_FIELD';
export type VisibilityReason = 'DARK_SKY_SUNLIT' | 'DAYLIGHT_SKY' | 'TWILIGHT_SKY' | 'EARTH_SHADOW' | 'FAINT_RANGE' | 'LOW_ELEVATION';

export interface Crossing {
  satelliteId: string;
  name: string;
  catalogId: number;
  intlDesignator: string;
  simulated: boolean;
  kind: 'past' | 'upcoming';

  closestTime: number;
  entryTime: number;
  exitTime: number;
  /** True when the object was already inside the field at the start of the search window. */
  inFieldAtStart: boolean;
  /** True when the object was still inside the field at the end of the search window. */
  inFieldAtEnd: boolean;

  minAngularDistance: number;

  startAzimuth: number;
  startElevation: number;
  closestAzimuth: number;
  closestElevation: number;
  endAzimuth: number;
  endElevation: number;

  rangeKm: number;
  directionLabel: string;
  /** Direction of travel across the sky at the crossing, as a compass bearing. */
  travelBearing: number;

  passRiseAzimuth: number | null;
  passSetAzimuth: number | null;
  passMaxElevation: number;

  visibility: VisibilityLabel;
  visibilityReason: VisibilityReason;
  sunElevation: number;
  illuminated: boolean;

  durationS: number;
  path: PathPoint[];
  score: number;
  /** Sighting mode only: qualitative match tier. */
  matchTier?: 'BEST MATCH' | 'LIKELY MATCH' | 'POSSIBLE MATCH';
  matchScore?: number;
}

export interface SightingQuery {
  time: number; // when the light was seen (epoch ms)
  toleranceS: number; // +/- seconds
  /** Compass bearing of the light's motion across the sky, or null if not remembered. */
  direction: number | null;
}

export interface TraceRequest {
  requestId: string;
  observer: Observer;
  target: SkyTarget;
  startTime: number;
  endTime: number;
  /** End of the look-ahead window for upcoming crossings (null to skip). */
  upcomingEnd: number | null;
  now: number;
  sighting?: SightingQuery;
}

export interface TraceResult {
  requestId: string;
  past: Crossing[];
  upcoming: Crossing[];
  checked: number;
  propagated: number;
  elapsedMs: number;
  oldestEpochDays: number;
  medianEpochDays: number;
}

export interface SatelliteInfo {
  catalogId: number;
  name: string;
  intlDesignator: string;
  epoch: number;
  epochAgeDays: number;
  inclination: number;
  eccentricity: number;
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
  meanAltitudeKm: number;
  semiMajorKm: number;
  latitude: number | null;
  longitude: number | null;
  altitudeKm: number | null;
  speedKms: number | null;
  azimuth: number | null;
  elevation: number | null;
  rangeKm: number | null;
  simulated: boolean;
  groups: string[];
}

export type WorkerInbound =
  | { type: 'LOAD_ORBITS'; records: OrbitRecord[] }
  | { type: 'TRACE_REQUEST'; request: TraceRequest }
  | { type: 'CANCEL'; requestId: string }
  | { type: 'SAT_INFO'; catalogId: number; observer: Observer | null; time: number };

export type WorkerOutbound =
  | { type: 'ORBITS_READY'; count: number; rejected: number }
  | { type: 'TRACE_PROGRESS'; requestId: string; checked: number; total: number }
  | { type: 'TRACE_COMPLETE'; result: TraceResult }
  | { type: 'TRACE_ERROR'; requestId: string; message: string }
  | { type: 'SAT_INFO_RESULT'; info: SatelliteInfo | null };
