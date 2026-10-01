import { sanitizeText } from '../astronomy/orbitLoader.ts';
import { db, newId, nowIso, type SyncFields, type UserStore } from './indexedDb.ts';

type Listener = (store: UserStore) => void;
const listeners = new Set<Listener>();
let syncHook: (() => void) | null = null;

/** Local-first repository for user records. Every write lands in IndexedDB first, then queues for optional sync. */
export const userStore = {
  onChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Registered by the sync layer; called (debounced there) after local changes. */
  setSyncHook(fn: (() => void) | null): void {
    syncHook = fn;
  },

  async list<T extends SyncFields>(store: UserStore): Promise<T[]> {
    try {
      const all = (await (await db()).getAll(store)) as unknown as T[];
      return all.filter((r) => !r.deleted);
    } catch {
      return [];
    }
  },

  async listAll<T extends SyncFields>(store: UserStore): Promise<T[]> {
    try {
      return (await (await db()).getAll(store)) as unknown as T[];
    } catch {
      return [];
    }
  },

  async get<T extends SyncFields>(store: UserStore, id: string): Promise<T | undefined> {
    try {
      return (await (await db()).get(store, id)) as unknown as T | undefined;
    } catch {
      return undefined;
    }
  },

  async put<T extends SyncFields>(store: UserStore, rec: Omit<T, 'id' | 'created_at' | 'updated_at'> & Partial<SyncFields>): Promise<T> {
    const now = nowIso();
    const full = { ...rec, id: rec.id ?? newId(), created_at: rec.created_at ?? now, updated_at: now, synced: false, deleted: rec.deleted ?? false } as unknown as T;
    try {
      const d = await db();
      await d.put(store, full as never);
      await d.add('outbox', { table: store, recordId: full.id, op: 'upsert', queuedAt: Date.now() });
    } catch {
      /* private mode: in-memory only for this action */
    }
    for (const l of listeners) l(store);
    syncHook?.();
    return full;
  },

  async remove(store: UserStore, id: string): Promise<void> {
    try {
      const d = await db();
      const cur = await d.get(store, id);
      if (cur) {
        await d.put(store, { ...(cur as object), deleted: true, synced: false, updated_at: nowIso() } as never);
        await d.add('outbox', { table: store, recordId: id, op: 'delete', queuedAt: Date.now() });
      }
    } catch {
      /* ignore */
    }
    for (const l of listeners) l(store);
    syncHook?.();
  },

  /** Merge a record from the server (last-write-wins on updated_at). */
  async mergeRemote<T extends SyncFields>(store: UserStore, remote: T): Promise<boolean> {
    try {
      const d = await db();
      const cur = (await d.get(store, remote.id)) as unknown as T | undefined;
      if (cur && cur.updated_at >= remote.updated_at) return false;
      // keep local-only payloads (replay paths) when the server copy doesn't carry them
      await d.put(store, { ...(cur ?? {}), ...remote, synced: true } as never);
      return true;
    } catch {
      return false;
    }
  },

  notify(store: UserStore): void {
    for (const l of listeners) l(store);
  },
};

/* ───── validation of user-entered data (blueprint: validate all user data) ───── */

export function validName(v: string, max = 40): string {
  const s = sanitizeText(v, max);
  if (!s) throw new Error('Name required');
  return s;
}

export function validLatLon(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid coordinates');
}

export function validNote(v: string): string {
  return sanitizeText(v, 280);
}
