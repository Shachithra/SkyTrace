import { mergeRecords, parseOmmPayload } from '../astronomy/orbitLoader.ts';
import type { OrbitRecord } from '../astronomy/types.ts';
import { DATASET_VERSION, db, getMeta, setMeta, type OrbitGroupEntry } from './indexedDb.ts';
import { CELESTRAK_ORIGIN, FAILURE_BACKOFF_MS, MIN_REFRESH_MS, gpUrl } from './datasets.ts';

export type OrbitSource = 'network' | 'cache' | 'mixed' | 'none';

export interface OrbitLoadResult {
  records: OrbitRecord[];
  source: OrbitSource;
  /** Oldest download time among the groups in use. */
  oldestFetch: number | null;
  missingGroups: string[];
  errors: string[];
}

async function readGroup(group: string): Promise<OrbitGroupEntry | undefined> {
  try {
    const e = await (await db()).get('orbitData', group);
    return e && e.datasetVersion === DATASET_VERSION ? e : undefined;
  } catch {
    return undefined;
  }
}

async function fetchGroup(group: string): Promise<OrbitRecord[]> {
  const attempt = async (url: string): Promise<OrbitRecord[]> => {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // CelesTrak answers repeated downloads with a plain-text notice instead of JSON.
      throw new Error(text.slice(0, 120) || 'Unexpected response');
    }
    const { records } = parseOmmPayload(json, group);
    if (!records.length) throw new Error('Empty dataset');
    return records;
  };
  try {
    return await attempt(gpUrl(group, CELESTRAK_ORIGIN));
  } catch (err) {
    // In local development, retry through Vite's same-origin proxy (CORS / network quirks).
    if (import.meta.env?.DEV) return attempt(gpUrl(group, '/celestrak'));
    throw err;
  }
}

/**
 * Cache policy (blueprint §38):
 *   no cached data          → fetch
 *   cache older than policy → fetch, but never more often than MIN_REFRESH_MS
 *   otherwise               → use cache
 * Failures are remembered so a broken network can't turn into a refresh loop.
 */
export async function loadOrbits(groups: string[], refreshMs: number, opts: { force?: boolean; online?: boolean } = {}): Promise<OrbitLoadResult> {
  const now = Date.now();
  const online = opts.online ?? navigator.onLine;
  const lists: OrbitRecord[][] = [];
  const errors: string[] = [];
  const missing: string[] = [];
  let usedNetwork = false;
  let usedCache = false;
  let oldest: number | null = null;

  for (const group of groups) {
    const cached = await readGroup(group);
    const age = cached ? now - cached.fetchedAt : Infinity;
    const lastFail = (await getMeta<number>(`fail:${group}`)) ?? 0;
    const policyAge = Math.max(MIN_REFRESH_MS, refreshMs);
    const due = !cached || age > policyAge || (opts.force && age > MIN_REFRESH_MS);
    const backoff = now - lastFail < FAILURE_BACKOFF_MS && !opts.force;

    if (due && online && !(backoff && cached)) {
      try {
        const records = await fetchGroup(group);
        const entry: OrbitGroupEntry = { group, records, fetchedAt: now, datasetVersion: DATASET_VERSION };
        try {
          await (await db()).put('orbitData', entry);
        } catch {
          /* quota / private mode: still usable for this session */
        }
        lists.push(records);
        usedNetwork = true;
        oldest = oldest === null ? now : Math.min(oldest, now);
        continue;
      } catch (err) {
        await setMeta(`fail:${group}`, now);
        errors.push(`${group}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (cached) {
      lists.push(cached.records);
      usedCache = true;
      oldest = oldest === null ? cached.fetchedAt : Math.min(oldest, cached.fetchedAt);
    } else {
      missing.push(group);
    }
  }

  if (usedNetwork) await setMeta('lastUpdated', now);
  const records = mergeRecords(lists);
  const source: OrbitSource = !records.length ? 'none' : usedNetwork && usedCache ? 'mixed' : usedNetwork ? 'network' : 'cache';
  return { records, source, oldestFetch: oldest, missingGroups: missing, errors };
}

export async function cacheSummary(): Promise<{ groups: { group: string; count: number; fetchedAt: number }[]; usageBytes: number | null }> {
  let groups: { group: string; count: number; fetchedAt: number }[] = [];
  try {
    const all = await (await db()).getAll('orbitData');
    groups = all.map((e) => ({ group: e.group, count: e.records.length, fetchedAt: e.fetchedAt }));
  } catch {
    /* ignore */
  }
  let usageBytes: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    usageBytes = est?.usage ?? null;
  } catch {
    /* ignore */
  }
  return { groups, usageBytes };
}

/** Earliest time any of the given groups may be re-downloaded under the provider policy. */
export async function nextAllowedRefresh(groups: string[]): Promise<number> {
  let next = 0;
  for (const g of groups) {
    const c = await readGroup(g);
    if (c) next = Math.max(next, c.fetchedAt + MIN_REFRESH_MS);
  }
  return next;
}

export async function clearOrbitCache(): Promise<void> {
  try {
    const d = await db();
    await d.clear('orbitData');
    await d.clear('satelliteMetadata');
    const keys = await d.getAllKeys('meta');
    for (const k of keys) if (String(k).startsWith('fail:') || k === 'lastUpdated') await d.delete('meta', k);
  } catch {
    /* ignore */
  }
}
