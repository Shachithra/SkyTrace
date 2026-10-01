import { LEAD_OPTIONS, alertRules } from '../alerts/alertRules.ts';
import { notificationsSupported, requestPermission } from '../alerts/notifications.ts';
import type { PassAlertRecord, SavedLocation } from '../data/indexedDb.ts';
import { savedSatellites } from '../sync/favorites.ts';
import { clear, h } from './dom.ts';
import { group, tickScale, toggleRow } from './controls.ts';
import { toast } from './Toast.ts';

/**
 * Pass alert for one satellite: lead time, location, minimum elevation and
 * visibility requirement. Example: "ISS VISIBLE IN 12 MIN · SW → NE".
 */
export async function renderPassAlertControl(host: HTMLElement, sat: { id: number; name: string }, locations: SavedLocation[], onDone: () => void): Promise<void> {
  clear(host);
  const existing = await alertRules.forSatellite(sat.id);
  const draft: Omit<PassAlertRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string } = existing
    ? { ...existing }
    : { norad_id: sat.id, satellite_name: sat.name, location_id: null, minimum_elevation: 15, visibility_only: true, notify_minutes_before: 10, enabled: true };

  const perm = notificationsSupported() ? Notification.permission : 'denied';
  const permNote = !notificationsSupported()
    ? 'This browser cannot show notifications. Alerts will appear inside SkyTrace only.'
    : perm === 'denied'
      ? 'Notifications are blocked for SkyTrace in your browser settings.'
      : 'Alerts are delivered while SkyTrace is open or in the background. With sync + push enabled, they also arrive when it is closed.';

  host.append(
    group(
      'ALERT ME BEFORE VISIBLE PASSES',
      sat.name,
      toggleRow('Alert enabled', draft.enabled, (v) => (draft.enabled = v)),
      h('p', { class: 'set-help' }, permNote),
    ),
    group(
      'NOTIFY BEFORE',
      null,
      tickScale('Lead time', LEAD_OPTIONS.map((m) => ({ value: m, label: `${m}`, sub: 'MIN' })), draft.notify_minutes_before, (v) => (draft.notify_minutes_before = v)),
    ),
    group(
      'CONDITIONS',
      null,
      tickScale('Minimum elevation', [10, 20, 30, 45].map((e) => ({ value: e, label: `${e}°`, sub: 'MIN EL' })), [10, 20, 30, 45].includes(draft.minimum_elevation) ? draft.minimum_elevation : 20, (v) => (draft.minimum_elevation = v)),
      toggleRow('Only likely / possibly visible passes', draft.visibility_only, (v) => (draft.visibility_only = v)),
    ),
    group(
      'LOCATION',
      null,
      tickScale<string>(
        'Alert location',
        [{ value: '', label: 'CURRENT' }, ...locations.slice(0, 4).map((l) => ({ value: l.id, label: l.name.toUpperCase().slice(0, 12) }))],
        draft.location_id ?? '',
        (v) => (draft.location_id = v || null),
      ),
      locations.length ? null : h('p', { class: 'set-help' }, 'Save locations under SAVED to set alerts per location.'),
    ),
  );
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, existing ? 'UPDATE ALERT' : 'SET ALERT');
  save.addEventListener('click', async () => {
    if (draft.enabled && notificationsSupported() && Notification.permission === 'default') await requestPermission();
    await alertRules.upsert(draft);
    await savedSatellites.setAlerts(sat.id, sat.name, draft.enabled);
    toast(draft.enabled ? `ALERT SET · ${draft.notify_minutes_before} MIN BEFORE` : 'ALERT OFF', 'ok');
    onDone();
  });
  const actions = h('div', { class: 'set-actions' }, save);
  if (existing) {
    const del = h('button', { class: 'btn btn-quiet', type: 'button' }, 'REMOVE ALERT');
    del.addEventListener('click', async () => {
      await alertRules.remove(existing.id);
      await savedSatellites.setAlerts(sat.id, sat.name, false);
      toast('ALERT REMOVED', 'ok');
      onDone();
    });
    actions.append(del);
  }
  host.append(h('section', { class: 'set-group' }, actions));
}
