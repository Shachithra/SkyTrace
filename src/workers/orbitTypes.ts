import type { OrbitRecord, Observer, SatelliteInfo, TraceRequest, TraceResult } from '../astronomy/types.ts';
import type { VisibilityStatus } from '../astronomy/visibility.ts';
import type { SatellitePass } from '../alerts/passPrediction.ts';
import type { ConstellationData } from '../stars/starCatalog.ts';

export interface LiveFrame {
  requestId: number;
  t0: number;
  t1: number;
  /** NORAD ids of objects above (or just below) the horizon */
  ids: Int32Array;
  /** stride 9: E0,N0,U0, E1,N1,U1, rangeKm, status(0 not,1 possibly,2 likely), estMag (99 = unknown) */
  data: Float32Array;
  sunAlt: number;
}

export interface TrajectoryPoint {
  t: number;
  az: number;
  el: number;
  status: VisibilityStatus;
  /** constellation id containing this point (null below horizon / unknown) */
  con: string | null;
}

export interface PassRequest {
  requestId: number;
  observer: Observer;
  start: number;
  end: number;
  minElevation: number;
  /** restrict to these NORAD ids (null = all loaded objects) */
  catalogIds: number[] | null;
  /** always include these (favourites) even when the full set is capped */
  extraIds: number[];
}

export interface PassResult {
  requestId: number;
  passes: SatellitePass[];
  considered: number;
  limited: boolean;
  elapsedMs: number;
}

export type OrbitInbound =
  | { type: 'LOAD_ORBITS'; records: OrbitRecord[] }
  | { type: 'LOAD_CONSTELLATIONS'; data: ConstellationData }
  | { type: 'TRACE_REQUEST'; request: TraceRequest }
  | { type: 'CANCEL'; requestId: string }
  | { type: 'SAT_INFO'; catalogId: number; observer: Observer | null; time: number }
  | { type: 'LIVE'; requestId: number; observer: Observer; t0: number; t1: number; catalogIds: number[] | null }
  | { type: 'TRAJECTORY'; requestId: number; catalogId: number; observer: Observer; from: number; to: number; stepS: number }
  | { type: 'PASSES'; request: PassRequest };

export type OrbitOutbound =
  | { type: 'ORBITS_READY'; count: number; rejected: number }
  | { type: 'TRACE_PROGRESS'; requestId: string; checked: number; total: number }
  | { type: 'TRACE_COMPLETE'; result: TraceResult }
  | { type: 'TRACE_ERROR'; requestId: string; message: string }
  | { type: 'SAT_INFO_RESULT'; info: SatelliteInfo | null }
  | { type: 'LIVE'; frame: LiveFrame }
  | { type: 'TRAJECTORY'; requestId: number; points: TrajectoryPoint[] }
  | { type: 'PASS_PROGRESS'; requestId: number; done: number; total: number }
  | { type: 'PASSES'; result: PassResult }
  | { type: 'ERROR'; requestId: number; message: string };
