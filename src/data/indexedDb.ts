import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OrbitRecord } from '../astronomy/types.ts';

export interface OrbitGroupEntry {
  group: string;
  records: OrbitRecord[];
  fetchedAt: number;
  datasetVersion: number;
}

export interface SatelliteMetadata {
  catalogId: number;
  owner: string;
  launchDate: string;
  launchSite: string;
  decayDate: string;
  objectType: string;
  fetchedAt: number;
}

/** Fields shared by every user-owned, syncable record (local-first). */
export interface SyncFields {
  id: string;
  updated_at: string;
  created_at: string;
  /** soft delete, so deletions can sync */
  deleted?: boolean;
  /** true once the server has the latest version */
  synced?: boolean;
}

export interface SavedSatellite extends SyncFields {
  norad_id: number;
  satellite_name: string;
  alerts_enabled: boolean;
}

export interface SavedLocation extends SyncFields {
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface ObservationRecord extends SyncFields {
  norad_id: number;
  satellite_name: string;
  observed_at: string;
  latitude: number | null;
  longitude: number | null;
  azimuth: number;
  elevation: number;
  match_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  /** replayable path across the field (local only) */
  path?: { t: number; az: number; el: number }[];
  trace_id?: string;
  field_radius?: number;
}

export interface TraceRecord extends SyncFields {
  trace_id: string;
  trace_time: string;
  latitude: number | null;
  longitude: number | null;
  target_azimuth: number;
  target_elevation: number;
  field_radius: number;
  time_window: number;
  match_count: number;
  selected_norad_id: number | null;
  sensor_accuracy: number | null;
  /** compact matches for offline replay (local only) */
  matches?: { norad_id: number; name: string; closest: number; min_distance: number; path: { t: number; az: number; el: number }[] }[];
}

export interface PassAlertRecord extends SyncFields {
  norad_id: number;
  satellite_name: string;
  location_id: string | null;
  minimum_elevation: number;
  visibility_only: boolean;
  notify_minutes_before: 5 | 10 | 15 | 30;
  enabled: boolean;
}

export interface NotificationPrefs extends SyncFields {
  push_enabled: boolean;
  quiet_hours_start: string | null; // "22:30"
  quiet_hours_end: string | null;
  visible_pass_only: boolean;
}

export interface OutboxItem {
  key?: number;
  table: string;
  recordId: string;
  op: 'upsert' | 'delete';
  queuedAt: number;
}

interface SkyTraceDB extends DBSchema {
  orbitData: { key: string; value: OrbitGroupEntry };
  satelliteMetadata: { key: number; value: SatelliteMetadata };
  meta: { key: string; value: { key: string; value: unknown } };
  skyData: { key: string; value: { key: string; value: unknown } };
  savedSatellites: { key: string; value: SavedSatellite };
  savedLocations: { key: string; value: SavedLocation };
  observations: { key: string; value: ObservationRecord };
  traces: { key: string; value: TraceRecord };
  alerts: { key: string; value: PassAlertRecord };
  outbox: { key: number; value: OutboxItem };
}

export type UserStore = 'savedSatellites' | 'savedLocations' | 'observations' | 'traces' | 'alerts';

export const DATASET_VERSION = 1;
let dbp: Promise<IDBPDatabase<SkyTraceDB>> | null = null;

export function db(): Promise<IDBPDatabase<SkyTraceDB>> {
  if (!dbp) {
    dbp = openDB<SkyTraceDB>('skytrace', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('orbitData', { keyPath: 'group' });
          d.createObjectStore('satelliteMetadata', { keyPath: 'catalogId' });
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          d.createObjectStore('skyData', { keyPath: 'key' });
          d.createObjectStore('savedSatellites', { keyPath: 'id' });
          d.createObjectStore('savedLocations', { keyPath: 'id' });
          d.createObjectStore('observations', { keyPath: 'id' });
          d.createObjectStore('traces', { keyPath: 'id' });
          d.createObjectStore('alerts', { keyPath: 'id' });
          d.createObjectStore('outbox', { keyPath: 'key', autoIncrement: true });
        }
      },
    });
  }
  return dbp;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get('meta', key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('meta', { key, value });
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

/** Cache adapter for the star catalogue / constellation datasets. */
export const skyCache = {
  async get(key: string): Promise<unknown> {
    try {
      return (await (await db()).get('skyData', key))?.value;
    } catch {
      return undefined;
    }
  },
  async put(key: string, value: unknown): Promise<void> {
    try {
      await (await db()).put('skyData', { key, value });
    } catch {
      /* ignore */
    }
  },
};

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
