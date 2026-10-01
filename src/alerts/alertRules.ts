import type { SatellitePass } from './passPrediction.ts';
import { getMeta, nowIso, setMeta, type NotificationPrefs, type PassAlertRecord } from '../data/indexedDb.ts';
import { userStore } from '../data/userStore.ts';
import { localClock } from '../utils/format.ts';

export const LEAD_OPTIONS = [5, 10, 15, 30] as const;

export const alertRules = {
  list: (): Promise<PassAlertRecord[]> => userStore.list<PassAlertRecord>('alerts'),
  async forSatellite(noradId: number): Promise<PassAlertRecord | undefined> {
    return (await this.list()).find((a) => a.norad_id === noradId);
  },
  async upsert(a: Omit<PassAlertRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<PassAlertRecord> {
    if (!LEAD_OPTIONS.includes(a.notify_minutes_before)) throw new Error('Invalid lead time');
    const minEl = Math.max(0, Math.min(80, Math.round(a.minimum_elevation)));
    return userStore.put<PassAlertRecord>('alerts', { ...a, minimum_elevation: minEl });
  },
  remove: (id: string): Promise<void> => userStore.remove('alerts', id),
};

export const DEFAULT_PREFS: NotificationPrefs = {
  id: 'prefs',
  created_at: '1970-01-01T00:00:00Z',
  updated_at: '1970-01-01T00:00:00Z',
  push_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  visible_pass_only: true,
};

export async function readPrefs(): Promise<NotificationPrefs> {
  return { ...DEFAULT_PREFS, ...((await getMeta<NotificationPrefs>('notificationPrefs')) ?? {}) };
}
export async function writePrefs(p: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const next = { ...(await readPrefs()), ...p, updated_at: nowIso() };
  await setMeta('notificationPrefs', next);
  return next;
}

/** Is a local time inside the quiet-hours window (which may wrap past midnight)? */
export function inQuietHours(t: number, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

export interface ScheduledAlert {
  key: string;
  fireAt: number;
  passStart: number;
  catalogId: number;
  title: string;
  body: string;
}

/**
 * Turn alert rules + predicted passes into notifications to schedule.
 * Conditions: satellite, location, minimum elevation, visibility requirement,
 * global "visible passes only" and quiet hours.
 */
export function evaluateAlerts(
  rules: PassAlertRecord[],
  passesByLocation: Map<string | null, SatellitePass[]>,
  prefs: NotificationPrefs,
  now: number,
): ScheduledAlert[] {
  const out: ScheduledAlert[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const passes = passesByLocation.get(r.location_id) ?? passesByLocation.get(null) ?? [];
    for (const p of passes) {
      if (p.catalogId !== r.norad_id || p.max.el < r.minimum_elevation) continue;
      const needVisible = r.visibility_only || prefs.visible_pass_only;
      if (needVisible && p.status === 'NOT_EXPECTED') continue;
      const start = needVisible && p.visibleFrom ? p.visibleFrom : p.rise.t;
      const fireAt = start - r.notify_minutes_before * 60_000;
      if (fireAt < now - 60_000) continue;
      if (inQuietHours(fireAt, prefs.quiet_hours_start, prefs.quiet_hours_end)) continue;
      const vis = p.status === 'LIKELY_VISIBLE' ? 'VISIBLE' : p.status === 'POSSIBLY_VISIBLE' ? 'POSSIBLY VISIBLE' : 'PASSING';
      out.push({
        key: `${r.id}:${p.key}`,
        fireAt,
        passStart: start,
        catalogId: p.catalogId,
        title: `${p.name} ${vis} IN ${r.notify_minutes_before} MIN`,
        body: `${p.directionLabel}\nMaximum elevation: ${Math.round(p.max.el)}° at ${localClock(p.max.t)}`,
      });
      break; // next qualifying pass per rule
    }
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}
