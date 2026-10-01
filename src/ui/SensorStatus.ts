import { clear, h, setText } from './dom.ts';

export interface SensorStatusModel {
  gps: { label: string; value: string; level: 0 | 1 | 2 | 3; tone: 'good' | 'fair' | 'poor' | 'off' };
  compass: { label: string; value: string; level: 0 | 1 | 2 | 3; tone: 'good' | 'fair' | 'poor' | 'off' };
  orientation: { label: string; value: string; level: 0 | 1 | 2 | 3; tone: 'good' | 'fair' | 'poor' | 'off' };
}

/** Sensor quality, presented like instrument signal readouts — never by colour alone. */
export class SensorStatus {
  private rows: Record<keyof SensorStatusModel, { row: HTMLElement; val: HTMLElement; bars: HTMLElement }>;

  constructor(host: HTMLElement) {
    clear(host);
    const mk = (name: string) => {
      const val = h('span', { class: 'ss-val' });
      const bars = h('span', { class: 'ss-bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
      const row = h('div', { class: 'ss-row' }, h('span', {}, name), val, bars);
      host.append(row);
      return { row, val, bars };
    };
    this.rows = { gps: mk('GPS'), compass: mk('COMPASS'), orientation: mk('ORIENT') };
  }

  update(m: SensorStatusModel): void {
    for (const key of Object.keys(this.rows) as (keyof SensorStatusModel)[]) {
      const r = this.rows[key];
      const v = m[key];
      setText(r.val, v.value);
      r.bars.dataset.level = String(v.level);
      r.row.dataset.tone = v.tone;
      r.row.setAttribute('aria-label', `${v.label}: ${v.value}`);
    }
  }
}
