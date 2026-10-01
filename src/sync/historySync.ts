import { db, getMeta, setMeta, type NotificationPrefs, type UserStore } from '../data/indexedDb.ts';
import { userStore } from '../data/userStore.ts';
import { debounce } from '../utils/throttle.ts';
import { currentSession, supabase } from './supabase.ts';

/** Local store → Supabase table, and the columns that are allowed to leave the device. */
const TABLES: Record<UserStore, { table: string; columns: string[] }> = {
  savedSatellites: { table: 'saved_satellites', columns: ['id', 'norad_id', 'satellite_name', 'alerts_enabled', 'created_at', 'updated_at', 'deleted'] },
  savedLocations: { table: 'saved_locations', columns: ['id', 'name', 'latitude', 'longitude', 'altitude', 'created_at', 'updated_at', 'deleted'] },
  observations: {
    table: 'observation_history',
    columns: ['id', 'norad_id', 'satellite_name', 'observed_at', 'latitude', 'longitude', 'azimuth', 'elevation', 'match_confidence', 'notes', 'created_at', 'updated_at', 'deleted'],
  },
  traces: {
    table: 'trace_history',
    columns: ['id', 'trace_id', 'trace_time', 'latitude', 'longitude', 'target_azimuth', 'target_elevation', 'field_radius', 'time_window', 'match_count', 'selected_norad_id', 'sensor_accuracy', 'created_at', 'updated_at', 'deleted'],
  },
  alerts: {
    table: 'pass_alerts',
    columns: ['id', 'norad_id', 'satellite_name', 'location_id', 'minimum_elevation', 'visibility_only', 'notify_minutes_before', 'enabled', 'created_at', 'updated_at', 'deleted'],
  },
};

export type SyncState = 'guest' | 'idle' | 'syncing' | 'error' | 'offline';
let state: SyncState = 'guest';
let lastError = '';
const listeners = new Set<(s: SyncState) => void>();
const setState = (s: SyncState): void => {
  state = s;
  for (const l of listeners) l(s);
};
export const syncState = (): { state: SyncState; error: string } => ({ state, error: lastError });
export const onSyncState = (fn: (s: SyncState) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const pick = (rec: Record<string, unknown>, cols: string[]): Record<string, unknown> => Object.fromEntries(cols.map((c) => [c, rec[c] ?? null]));

/**
 * Two-way sync (account mode only): push the local outbox, then pull rows
 * changed since the last pull. Last write wins on updated_at.
 * Guest mode never touches the network.
 */
export async function syncAll(): Promise<void> {
  const cP = supabase();
  if (!cP) return setState('guest');
  const session = await currentSession();
  if (!session) return setState('guest');
  if (!navigator.onLine) return setState('offline');
  setState('syncing');
  try {
    const c = await cP;
    const d = await db();
    const userId = session.user.id;

    // push
    const items = await d.getAll('outbox');
    const latest = new Map<string, (typeof items)[number]>();
    for (const it of items) latest.set(`${it.table}:${it.recordId}`, it);
    for (const it of latest.values()) {
      const def = TABLES[it.table as UserStore];
      if (!def) continue;
      const rec = (await d.get(it.table as UserStore, it.recordId)) as unknown as Record<string, unknown> | undefined;
      if (rec) {
        const row = { ...pick(rec, def.columns), user_id: userId };
        const { error } = await c.from(def.table).upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await d.put(it.table as UserStore, { ...(rec as object), synced: true } as never);
      }
    }
    for (const it of items) if (it.key !== undefined) await d.delete('outbox', it.key);

    // pull
    for (const [store, def] of Object.entries(TABLES) as [UserStore, (typeof TABLES)[UserStore]][]) {
      const since = (await getMeta<string>(`pull:${def.table}`)) ?? '1970-01-01T00:00:00Z';
      const { data, error } = await c.from(def.table).select(def.columns.join(',')).gt('updated_at', since).order('updated_at').limit(1000);
      if (error) throw error;
      let max = since;
      let changed = false;
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        if (await userStore.mergeRemote(store, row as never)) changed = true;
        if (String(row.updated_at) > max) max = String(row.updated_at);
      }
      await setMeta(`pull:${def.table}`, max);
      if (changed) userStore.notify(store);
    }

    // notification preferences (one row per user)
    const prefs = await getMeta<NotificationPrefs>('notificationPrefs');
    if (prefs) {
      const { error } = await c
        .from('notification_preferences')
        .upsert({ user_id: userId, push_enabled: prefs.push_enabled, quiet_hours_start: prefs.quiet_hours_start, quiet_hours_end: prefs.quiet_hours_end, visible_pass_only: prefs.visible_pass_only, updated_at: prefs.updated_at }, { onConflict: 'user_id' });
      if (error) throw error;
    }
    lastError = '';
    setState('idle');
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    setState('error');
  }
}

export const scheduleSync = debounce(() => void syncAll(), 2500);

/** Read-only public metadata (satellite_metadata / dataset_versions) when sync is configured. */
export async function remoteDatasetVersions(): Promise<{ dataset_name: string; version: string; last_updated: string }[]> {
  const cP = supabase();
  if (!cP || !navigator.onLine) return [];
  try {
    const { data } = await (await cP).from('dataset_versions').select('dataset_name,version,last_updated').limit(50);
    return (data ?? []) as { dataset_name: string; version: string; last_updated: string }[];
  } catch {
    return [];
  }
}
