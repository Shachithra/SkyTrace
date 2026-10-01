import { COMPASS_8 } from '../utils/degrees.ts';
import { clear, h, s } from './dom.ts';
import { group, tickScale } from './controls.ts';

export interface SightingChoice {
  time: number;
  direction: number | null;
  label: string;
}

type Preset = 'now' | '5' | '10' | '30' | 'custom';

/**
 * "What did I just see?" — approximate observation time + remembered movement
 * direction. The trace then uses the current pointing direction.
 */
export class SightingPanel {
  private body: HTMLElement;
  private preset: Preset = 'now';
  private direction: number | null = null;
  private custom = '';
  private onRun: (c: SightingChoice) => void;

  constructor(body: HTMLElement, onRun: (c: SightingChoice) => void) {
    this.body = body;
    this.onRun = onRun;
  }

  render(): void {
    clear(this.body);
    const customInput = h('input', { type: 'time', 'aria-label': 'Observation time', value: this.custom || nowHHMM() }) as HTMLInputElement;
    const customRow = h('div', { class: 'custom-time', hidden: this.preset !== 'custom' }, h('span', { class: 'set-help' }, 'Seen at'), customInput);
    customInput.addEventListener('change', () => (this.custom = customInput.value));

    const time = tickScale<Preset>('Observation time', [
      { value: 'now', label: 'JUST NOW' },
      { value: '5', label: '5 MIN', sub: 'AGO' },
      { value: '10', label: '10 MIN', sub: 'AGO' },
      { value: '30', label: '30 MIN', sub: 'AGO' },
      { value: 'custom', label: 'CUSTOM' },
    ], this.preset, (v) => {
      this.preset = v;
      customRow.hidden = v !== 'custom';
    });

    // Direction ring: where the light was moving toward.
    const ring = h('div', { class: 'dir-ring', role: 'radiogroup', 'aria-label': 'Direction the light was moving' });
    const svg = s('svg', { viewBox: '0 0 196 196', 'aria-hidden': 'true' }, s('circle', { cx: 98, cy: 98, r: 74 }), s('circle', { cx: 98, cy: 98, r: 40, 'stroke-dasharray': '2 4' }));
    ring.append(svg);
    const buttons: HTMLButtonElement[] = [];
    const pick = (v: number | null, b: HTMLButtonElement): void => {
      this.direction = v;
      buttons.forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
    };
    COMPASS_8.forEach((label, i) => {
      const a = (i * 45 * Math.PI) / 180;
      const b = h('button', { role: 'radio', type: 'button', 'aria-checked': String(this.direction === i * 45), 'aria-label': `Moving toward ${label}`, style: `left:${98 + Math.sin(a) * 74}px;top:${98 - Math.cos(a) * 74}px` }, label) as HTMLButtonElement;
      b.addEventListener('click', () => pick(i * 45, b));
      buttons.push(b);
      ring.append(b);
    });
    const unsure = h('button', { role: 'radio', type: 'button', class: 'dir-center', 'aria-checked': String(this.direction === null) }, 'NOT SURE') as HTMLButtonElement;
    unsure.addEventListener('click', () => pick(null, unsure));
    buttons.push(unsure);
    ring.append(unsure);

    const run = h('button', { class: 'btn btn-primary', type: 'button' }, 'TRACE SIGHTING');
    run.addEventListener('click', () => this.onRun(this.choice()));

    this.body.append(
      group('WHEN DID YOU SEE IT?', null, time, customRow),
      group('WHICH WAY WAS IT MOVING?', null, h('p', { class: 'set-help' }, 'Optional. Choose the direction it was heading.'), ring),
      group('POINT, THEN TRACE', null, h('p', { class: 'set-help' }, 'Aim the reticle where you saw the light, then trace. Results are ranked as possible matches, never certainties.'), run),
    );
  }

  private choice(): SightingChoice {
    const now = Date.now();
    let time = now;
    let label = 'JUST NOW';
    if (this.preset === '5') {
      time = now - 5 * 60_000;
      label = '5 MIN AGO';
    } else if (this.preset === '10') {
      time = now - 10 * 60_000;
      label = '10 MIN AGO';
    } else if (this.preset === '30') {
      time = now - 30 * 60_000;
      label = '30 MIN AGO';
    } else if (this.preset === 'custom' && this.custom) {
      const [hh, mm] = this.custom.split(':').map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() > now) d.setDate(d.getDate() - 1);
      time = d.getTime();
      label = this.custom;
    }
    return { time, direction: this.direction, label };
  }
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
