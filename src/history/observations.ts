import type { ObservationRecord } from '../data/indexedDb.ts';
import { userStore, validNote } from '../data/userStore.ts';

/** Observation history: satellites the user confirmed seeing. */
export const observations = {
  async list(): Promise<ObservationRecord[]> {
    return (await userStore.list<ObservationRecord>('observations')).sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  },
  add(o: Omit<ObservationRecord, 'id' | 'created_at' | 'updated_at' | 'notes'> & { notes?: string }): Promise<ObservationRecord> {
    return userStore.put<ObservationRecord>('observations', { ...o, notes: validNote(o.notes ?? '') });
  },
  remove: (id: string): Promise<void> => userStore.remove('observations', id),
};
