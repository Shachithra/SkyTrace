import { location, passes, refreshActiveLocation } from '../app/services.ts';
import { alertRules, readPrefs, writePrefs } from '../alerts/alertRules.ts';
import { disablePush, enablePush, pushSupported } from '../alerts/notifications.ts';
import { userStore } from '../data/userStore.ts';
import { savedLocations, savedSatellites } from '../sync/favorites.ts';
import { onSyncState, syncAll, syncState } from '../sync/historySync.ts';
import { cachedSession, currentSession, onSession, signInWithEmail, signOut, supabaseConfigured } from '../sync/supabase.ts';
import { fmtLatLon } from '../utils/format.ts';
import { $, clear, h, setText } from '../ui/dom.ts';
import { group, toggleRow } from '../ui/controls.ts';
import { renderSavedSatellites } from '../ui/SavedSatelliteList.ts';
import { toast } from '../ui/Toast.ts';
import { showSatellite } from './objectSheet.ts';

/** SAVED: my satellites (orbital timelines), saved locations, account & sync. */
export class SavedScreen {
  readonly root = $('#screen-saved');

  constructor() {
    userStore.onChange((s) => {
      if (!this.root.hidden && (s === 'savedSatellites' || s === 'savedLocations' || s === 'alerts')) void this.render();
    });
    passes.onChange(() => !this.root.hidden && void this.render());
    onSyncState(() => !this.root.hidden && void this.renderAccount());
    onSession(() => !this.root.hidden && void this.renderAccount());
    $<HTMLFormElement>('[data-loc-form]', this.root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = (e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
      const o = location.observer;
      if (!o) return toast('NO POSITION FIX TO SAVE · ENABLE LOCATION FIRST', 'warn');
      try {
        await savedLocations.add(input.value, o.latitude, o.longitude, (o.altitudeKm ?? 0) * 1000);
        input.value = '';
        toast('LOCATION SAVED', 'ok');
      } catch (err) {
        toast(String((err as Error).message).toUpperCase(), 'warn');
      }
    });
  }

  async open(): Promise<void> {
    await this.render();
    void passes.next24h();
  }

  close(): void {}

  async render(): Promise<void> {
    const [sats, alerts] = await Promise.all([savedSatellites.list(), alertRules.list()]);
    renderSavedSatellites($('[data-saved-sats]', this.root), sats, passes.result?.passes ?? [], alerts, Date.now(), (s) => void showSatellite(s.norad_id, () => undefined));
    await this.renderLocations();
    await this.renderAccount();
  }

  private async renderLocations(): Promise<void> {
    const host = $('[data-saved-locs]', this.root);
    clear(host);
    const list = await savedLocations.list();
    const active = await savedLocations.active();
    const label = active ? list.find((l) => l.id === active)?.name ?? 'CURRENT POSITION' : 'CURRENT POSITION';
    setText($('[data-loc-active]', this.root), `USING ${label.toUpperCase()}`);
    const rows: [string | null, string, string][] = [[null, 'CURRENT POSITION', location.observer ? (location.status === 'manual' ? 'manual coordinates' : 'GPS fix, not stored') : 'no fix']];
    for (const l of list) rows.push([l.id, l.name.toUpperCase(), fmtLatLon(l.latitude, l.longitude)]);
    for (const [id, name, meta] of rows) {
      const use = h('button', { class: 'loc-main', type: 'button', 'aria-pressed': String((active ?? null) === id) }, h('span', { class: 'hist-name' }, name), h('span', { class: 'hist-meta mono' }, meta));
      use.addEventListener('click', async () => {
        await savedLocations.setActive(id);
        await refreshActiveLocation();
        passes.invalidate();
        void passes.next24h(true);
        toast(`USING ${name}`, 'ok', 1600);
        void this.renderLocations();
      });
      const row = h('div', { class: 'hist-row' }, use);
      if (id) {
        const del = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Delete ${name}` }, '×');
        del.addEventListener('click', async () => {
          await savedLocations.remove(id);
          if (active === id) await savedLocations.setActive(null);
          await refreshActiveLocation();
          void this.renderLocations();
        });
        row.append(del);
      }
      host.append(row);
    }
  }

  /** Account is optional: guest mode keeps everything in IndexedDB only. */
  private async renderAccount(): Promise<void> {
    const host = $('[data-account]', this.root);
    clear(host);
    const prefs = await readPrefs();
    const notif = group(
      'NOTIFICATIONS',
      null,
      toggleRow('Visible passes only', prefs.visible_pass_only, (v) => void writePrefs({ visible_pass_only: v })),
      this.quietHours(prefs.quiet_hours_start, prefs.quiet_hours_end),
    );
    if (!supabaseConfigured()) {
      host.append(
        h('div', { class: 'set-head' }, h('h3', { class: 'set-name' }, 'ACCOUNT & SYNC'), h('span', { class: 'set-value' }, 'GUEST MODE')),
        h('p', { class: 'set-help' }, 'Everything is stored on this device (IndexedDB). No account required. Cloud sync becomes available when this deployment is connected to Supabase.'),
        notif,
      );
      setText($('[data-saved-sync]', this.root), 'GUEST MODE · ON THIS DEVICE');
      return;
    }
    const session = cachedSession() ?? (await currentSession());
    const st = syncState();
    setText($('[data-saved-sync]', this.root), session ? `SYNC ${st.state.toUpperCase()}` : 'GUEST MODE · ON THIS DEVICE');
    host.append(h('div', { class: 'set-head' }, h('h3', { class: 'set-name' }, 'ACCOUNT & SYNC'), h('span', { class: 'set-value' }, session ? 'SIGNED IN' : 'GUEST MODE')));
    if (!session) {
      const form = h('form', { class: 'coord-form', novalidate: true });
      const input = h('input', { type: 'email', name: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true, style: 'width:220px' }) as HTMLInputElement;
      form.append(h('label', {}, 'EMAIL', input), h('button', { class: 'btn small', type: 'submit' }, 'EMAIL ME A SIGN-IN LINK'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await signInWithEmail(input.value.trim());
          toast('CHECK YOUR EMAIL FOR THE SIGN-IN LINK', 'ok', 5000);
        } catch (err) {
          toast(String((err as Error).message).toUpperCase(), 'warn');
        }
      });
      host.append(h('p', { class: 'set-help' }, 'Optional. Sign in to sync saved satellites, locations, alerts and history across devices. Your data is protected by row-level security — only you can read it.'), form);
    } else {
      const now = h('button', { class: 'btn small', type: 'button' }, 'SYNC NOW');
      now.addEventListener('click', () => void syncAll());
      const out = h('button', { class: 'btn small btn-quiet', type: 'button' }, 'SIGN OUT');
      out.addEventListener('click', async () => {
        await disablePush().catch(() => undefined);
        await signOut();
        toast('SIGNED OUT · DATA STAYS ON THIS DEVICE', 'ok');
      });
      host.append(
        h('p', { class: 'set-help' }, `${session.user.email ?? 'Signed in'}${st.state === 'error' ? ` · last sync failed: ${st.error}` : ''}`),
        h('div', { class: 'set-actions' }, now, out),
      );
      if (pushSupported()) {
        host.append(
          toggleRow('Push alerts when SkyTrace is closed', prefs.push_enabled, async (v) => {
            try {
              if (v) {
                const ok = await enablePush();
                if (!ok) throw new Error('Notifications not allowed');
              } else await disablePush();
              await writePrefs({ push_enabled: v });
              void syncAll();
            } catch (err) {
              toast(String((err as Error).message).toUpperCase(), 'warn');
            }
          }),
        );
      }
    }
    host.append(notif);
  }

  private quietHours(start: string | null, end: string | null): HTMLElement {
    const s = h('input', { type: 'time', value: start ?? '', 'aria-label': 'Quiet hours start' }) as HTMLInputElement;
    const e = h('input', { type: 'time', value: end ?? '', 'aria-label': 'Quiet hours end' }) as HTMLInputElement;
    const save = (): void => void writePrefs({ quiet_hours_start: s.value || null, quiet_hours_end: e.value || null });
    s.addEventListener('change', save);
    e.addEventListener('change', save);
    return h('div', { class: 'custom-time' }, h('span', { class: 'set-help' }, 'Quiet hours'), s, h('span', { class: 'set-help' }, 'to'), e);
  }
}
