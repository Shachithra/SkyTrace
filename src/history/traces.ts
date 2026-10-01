import type { TraceRecord } from '../data/indexedDb.ts';
import { userStore } from '../data/userStore.ts';

/** Trace history: every trace gets an ID; position is stored only if the user opted in. */
export const traces = {
  async list(): Promise<TraceRecord[]> {
    return (await userStore.list<TraceRecord>('traces')).sort((a, b) => b.trace_time.localeCompare(a.trace_time));
  },
  add(t: Omit<TraceRecord, 'id' | 'created_at' | 'updated_at'>): Promise<TraceRecord> {
    return userStore.put<TraceRecord>('traces', t);
  },
  async select(traceId: string, noradId: number): Promise<void> {
    const all = await userStore.list<TraceRecord>('traces');
    const t = all.find((x) => x.trace_id === traceId);
    if (t && t.selected_norad_id !== noradId) await userStore.put<TraceRecord>('traces', { ...t, selected_norad_id: noradId });
  },
  remove: (id: string): Promise<void> => userStore.remove('traces', id),
};
