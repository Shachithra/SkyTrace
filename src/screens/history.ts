import { router } from '../app/router.ts';
import type { ObservationRecord, TraceRecord } from '../data/indexedDb.ts';
import { userStore } from '../data/userStore.ts';
import { observations } from '../history/observations.ts';
import { traces } from '../history/traces.ts';
import { localClock } from '../utils/format.ts';
import { $, clear, h, hydrateIcons, setText } from '../ui/dom.ts';
import { renderChoiceStrip } from '../ui/LayerControl.ts';
import { renderObservations, renderTraces } from '../ui/ObservationHistory.ts';
import { openSheet } from '../ui/sheets.ts';

type Tab = 'OBSERVATIONS' | 'TRACES';

export interface ReplayRequest {
  name: string;
  path: { t: number; az: number; el: number }[];
  target: { az: number; el: number };
  radius: number;
}

/** HISTORY: observation history + trace history, both replayable. */
export class HistoryScreen {
  readonly root = $('#screen-history');
  private tab: Tab = 'OBSERVATIONS';

  constructor() {
    renderChoiceStrip<Tab>($('[data-history-tabs]', this.root), 'History', ['OBSERVATIONS', 'TRACES'], this.tab, (t) => {
      this.tab = t;
      void this.render();
    });
    userStore.onChange((s) => !this.root.hidden && (s === 'observations' || s === 'traces') && void this.render());
  }

  async open(): Promise<void> {
    await this.render();
  }
  close(): void {}

  async render(): Promise<void> {
    const host = $('[data-history-list]', this.root);
    if (this.tab === 'OBSERVATIONS') {
      renderObservations(host, await observations.list(), (o) => this.replayObservation(o), (o) => void observations.remove(o.id));
    } else {
      renderTraces(host, await traces.list(), (t) => this.openTrace(t), (t) => void traces.remove(t.id));
    }
    hydrateIcons(host);
  }

  private replayObservation(o: ObservationRecord): void {
    if (!o.path?.length) return;
    router.call('replayPath', { name: o.satellite_name, path: o.path, target: { az: o.azimuth, el: o.elevation }, radius: o.field_radius ?? 6 } satisfies ReplayRequest);
  }

  /** Trace record → its matches, each replayable offline. */
  private openTrace(t: TraceRecord): void {
    setText($('[data-object-kicker]'), `TRACE · ${new Date(t.trace_time).toLocaleString()}`);
    setText($('[data-object-title]'), t.trace_id);
    const body = $('[data-object-body]');
    clear(body);
    body.append(
      h('p', { class: 'set-help' }, `Target AZ ${t.target_azimuth.toFixed(1)}° · EL ${t.target_elevation.toFixed(1)}° · field ${t.field_radius}° · window ${t.time_window} min${t.sensor_accuracy ? ` · pointing ±${t.sensor_accuracy.toFixed(0)}°` : ''}`),
    );
    if (!t.matches?.length) body.append(h('p', { class: 'set-help' }, t.match_count ? 'Matches were synced from another device; replay paths stay on the device that traced them.' : 'Clear field — no tracked objects crossed.'));
    for (const m of t.matches ?? []) {
      const b = h('button', { class: 'hist-main', type: 'button' }, h('span', { class: 'hist-name' }, `${m.norad_id === t.selected_norad_id ? '● ' : ''}${m.name}`), h('span', { class: 'hist-meta mono' }, `${localClock(m.closest, true)} · closest ${m.min_distance.toFixed(1)}° · REPLAY`));
      b.addEventListener('click', () => router.call('replayPath', { name: m.name, path: m.path, target: { az: t.target_azimuth, el: t.target_elevation }, radius: t.field_radius } satisfies ReplayRequest));
      body.append(h('div', { class: 'hist-row' }, b));
    }
    openSheet('#sheet-object');
  }
}
