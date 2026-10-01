import type { Observer } from '../astronomy/types.ts';
import type { ConstellationData, StarCatalogData } from '../stars/starCatalog.ts';
import type { MatchLevel, RiseSet } from '../stars/constellationData.ts';
import type { TwilightState } from '../sky/horizon.ts';

export interface SkyField {
  time: number;
  lst: number;
  sunAlt: number;
  twilight: TwilightState;
  limitMag: number;
  /** stars brighter than the limit and above the horizon */
  index: Uint16Array;
  enu: Float32Array;
  /** every star used by a constellation figure (always provided, for line drawing) */
  figureIndex: Uint16Array;
  figureEnu: Float32Array;
  /** per-constellation label position + altitude */
  constellations: { id: string; enu: [number, number, number]; alt: number }[];
}

export interface PatternResult {
  id: string | null;
  name: string | null;
  level: 'MATCH HIGH' | 'MATCH MEDIUM' | 'MATCH LOW' | null;
  mainStars: { name: string; mag: number }[];
  inView: number;
  total: number;
  ra: number;
  dec: number;
}

export interface ConstellationInfo {
  id: string;
  name: string;
  alt: number;
  az: number;
  status: 'VISIBLE' | 'LOW' | 'BELOW HORIZON';
  bestDirection: string;
  riseSet: RiseSet;
  majorStars: { name: string; mag: number }[];
}

export type SkyInbound =
  | { type: 'LOAD'; stars: StarCatalogData; constellations: ConstellationData }
  | { type: 'FIELD'; id: number; observer: Observer; time: number; limitMag: number }
  | { type: 'LOOKUP'; id: number; observer: Observer; time: number; points: [number, number][] }
  | { type: 'PATTERN'; id: number; observer: Observer; time: number; az: number; el: number; fovDeg: number; accuracyDeg: number }
  | { type: 'CONSTELLATION_INFO'; id: number; observer: Observer; time: number; constellation: string };

export type SkyOutbound =
  | { type: 'READY'; stars: number; constellations: number; version: string }
  | { type: 'FIELD'; id: number; field: SkyField }
  | { type: 'LOOKUP'; id: number; ids: (string | null)[] }
  | { type: 'PATTERN'; id: number; result: PatternResult }
  | { type: 'CONSTELLATION_INFO'; id: number; info: ConstellationInfo | null }
  | { type: 'ERROR'; id: number; message: string };

export type { MatchLevel };
