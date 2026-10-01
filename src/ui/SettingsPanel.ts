import { DATASETS, MIN_REFRESH_MS } from '../data/datasets.ts';
import { settings, type FieldRadius, type Settings, type WindowMinutes, readHistory, clearHistory } from '../data/settings.ts';
import { cacheSummary, nextAllowedRefresh } from '../data/orbitalCache.ts';
import { ago, fmtInt, relativeMinutes } from '../utils/format.ts';
import { clear, h } from './dom.ts';
import { group, tickScale, toggleRow } from './controls.ts';

export interface SettingsActions {
  refreshOrbits: () => Promise<void>;
  clearCache: () => Promise<void>;
  datasetsChanged: () => void;
  orbitInfo: () => { count: number; oldestFetch: number | null; simulated: boolean };
}

export class SettingsPanel {
  private body: HTMLElement;
  private actions: SettingsActions;

  constructor(body: HTMLElement, actions: SettingsActions) {
    this.body = body;
    this.actions = actions;
  }

  async render(): Promise<void> {
    const st = settings.get();
    const set = (p: Partial<Settings>): void => settings.set(p);
    clear(this.body);

    this.body.append(
      group(
        'SEARCH WINDOW',
        null,
        tickScale<WindowMinutes>('Search window', [
          { value: 15, label: '15', sub: 'MIN' },
          { value: 30, label: '30', sub: 'MIN' },
          { value: 60, label: '60', sub: 'MIN' },
          { value: 180, label: '3', sub: 'HOURS' },
        ], st.windowMin, (v) => set({ windowMin: v })),
      ),
      group(
        'ANGULAR FIELD',
        null,
        tickScale<FieldRadius>('Field radius', [
          { value: 3, label: '3°', sub: 'NARROW' },
          { value: 6, label: '6°', sub: 'STANDARD' },
          { value: 12, label: '12°', sub: 'WIDE' },
        ], st.fieldRadius, (v) => set({ fieldRadius: v })),
        h('p', { class: 'set-help' }, 'Radius of the patch of sky searched around the reticle centre.'),
      ),
      group(
        'DISPLAY UNITS',
        null,
        tickScale<'km' | 'mi'>('Distance units', [
          { value: 'km', label: 'KM' },
          { value: 'mi', label: 'MILES' },
        ], st.units, (v) => set({ units: v })),
      ),
      group(
        'SCANNER',
        null,
        toggleRow('Camera background', st.camera, (v) => set({ camera: v }), 'Rear camera as a visual backdrop only. Never recorded or uploaded.'),
        toggleRow('Vibration feedback', st.haptics, (v) => set({ haptics: v })),
        h('label', { class: 'set-help', for: 'star-range' }, 'Star-field intensity'),
        this.range(st.starIntensity),
      ),
      group(
        'MOTION & CONTRAST',
        null,
        tickScale<'system' | 'on' | 'off'>('Reduce motion', [
          { value: 'system', label: 'SYSTEM' },
          { value: 'on', label: 'REDUCE' },
          { value: 'off', label: 'FULL' },
        ], st.reduceMotion, (v) => set({ reduceMotion: v })),
        tickScale<'standard' | 'high'>('Theme contrast', [
          { value: 'standard', label: 'STANDARD', sub: 'CONTRAST' },
          { value: 'high', label: 'HIGH', sub: 'CONTRAST' },
        ], st.contrast, (v) => set({ contrast: v })),
      ),
      this.datasetGroup(st),
      await this.cacheGroup(st),
      await this.privacyGroup(st),
    );
  }

  private range(v: number): HTMLElement {
    const r = h('input', { id: 'star-range', class: 'range', type: 'range', min: 0, max: 100, value: Math.round(v * 100) }) as HTMLInputElement;
    r.addEventListener('input', () => settings.set({ starIntensity: Number(r.value) / 100 }));
    return r;
  }

  private datasetGroup(st: Settings): HTMLElement {
    const box = h('div', {});
    for (const d of DATASETS) {
      const input = h('input', { type: 'checkbox', checked: st.datasets.includes(d.id), 'aria-describedby': `ds-${d.id}` }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const cur = new Set(settings.get().datasets);
        if (input.checked) cur.add(d.id);
        else cur.delete(d.id);
        if (!cur.size) {
          input.checked = true;
          return;
        }
        settings.set({ datasets: DATASETS.map((x) => x.id).filter((id) => cur.has(id)) });
        this.actions.datasetsChanged();
      });
      box.append(
        h(
          'label',
          { class: 'dataset' },
          input,
          h('span', {}, h('span', { class: 'ds-name' }, d.label), h('span', { class: 'ds-note', id: `ds-${d.id}` }, d.note)),
          h('span', { class: 'ds-count' }, d.approxObjects),
        ),
      );
    }
    return group('ORBITAL DATASETS', 'CELESTRAK GP · OMM', box);
  }

  private async cacheGroup(st: Settings): Promise<HTMLElement> {
    const sum = await cacheSummary();
    const info = this.actions.orbitInfo();
    const table = h('div', { class: 'cache-table' });
    for (const g of sum.groups) table.append(h('div', {}, h('span', {}, g.group.toUpperCase()), h('span', {}, `${fmtInt(g.count)} · ${ago(g.fetchedAt)}`)));
    if (!sum.groups.length) table.append(h('div', {}, h('span', {}, 'NO ORBITAL DATA CACHED')));
    if (sum.usageBytes != null) table.append(h('div', {}, h('span', {}, 'STORAGE USED'), h('span', {}, `${(sum.usageBytes / 1048576).toFixed(1)} MB`)));
    if (info.simulated) table.append(h('div', {}, h('span', {}, 'IN USE'), h('span', {}, 'SIMULATED ORBITS')));
    else table.append(h('div', {}, h('span', {}, 'IN USE'), h('span', {}, `${fmtInt(info.count)} OBJECTS`)));

    const next = await nextAllowedRefresh(st.datasets);
    const wait = next - Date.now();
    const refresh = h('button', { class: 'btn small', type: 'button', disabled: wait > 0 }, wait > 0 ? `REFRESH IN ${relativeMinutes(wait).toUpperCase()}` : 'REFRESH ORBITS NOW');
    refresh.addEventListener('click', async () => {
      refresh.setAttribute('disabled', '');
      refresh.textContent = 'REFRESHING…';
      await this.actions.refreshOrbits();
      void this.render();
    });
    const clearBtn = h('button', { class: 'btn small btn-quiet', type: 'button' }, 'CLEAR ORBIT CACHE');
    clearBtn.addEventListener('click', async () => {
      await this.actions.clearCache();
      void this.render();
    });

    const interval = tickScale<2 | 6 | 12 | 24>('Refresh interval', [
      { value: 2, label: '2 H' },
      { value: 6, label: '6 H' },
      { value: 12, label: '12 H' },
      { value: 24, label: '24 H' },
    ], st.refreshHours, (v) => settings.set({ refreshHours: v }));

    return group(
      'CACHE MANAGEMENT',
      null,
      table,
      h('p', { class: 'set-help' }, `Refresh interval. SkyTrace never re-downloads a dataset within ${MIN_REFRESH_MS / 3_600_000} hours, out of respect for the data provider.`),
      interval,
      h('div', { class: 'set-actions' }, refresh, clearBtn),
    );
  }

  private async privacyGroup(st: Settings): Promise<HTMLElement> {
    const hist = await readHistory();
    const clearBtn = h('button', { class: 'btn small btn-quiet', type: 'button' }, `CLEAR HISTORY (${hist.length})`);
    clearBtn.addEventListener('click', async () => {
      await clearHistory();
      void this.render();
    });
    return group(
      'PRIVACY',
      null,
      h('p', { class: 'set-help' }, 'Your position is used only on this device for calculations. It is never uploaded or stored. Requests to the orbital-data source contain no location.'),
      toggleRow('Keep trace history', st.keepHistory, (v) => settings.set({ keepHistory: v }), 'Saves pointing direction and matches only — never your position.'),
      hist.length ? clearBtn : null,
    );
  }
}
