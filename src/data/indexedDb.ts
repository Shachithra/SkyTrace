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

interface SkyTraceDB extends DBSchema {
  orbitData: { key: string; value: OrbitGroupEntry };
  satelliteMetadata: { key: number; value: SatelliteMetadata };
  meta: { key: string; value: { key: string; value: unknown } };
}

export const DATASET_VERSION = 1;
let dbp: Promise<IDBPDatabase<SkyTraceDB>> | null = null;

export function db(): Promise<IDBPDatabase<SkyTraceDB>> {
  if (!dbp) {
    dbp = openDB<SkyTraceDB>('skytrace', 1, {
      upgrade(d) {
        d.createObjectStore('orbitData', { keyPath: 'group' });
        d.createObjectStore('satelliteMetadata', { keyPath: 'catalogId' });
        d.createObjectStore('meta', { keyPath: 'key' });
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
