import { COMPASS_8, wrap360 } from '../utils/degrees.ts';
import { clear, h, s } from './dom.ts';

const PX_PER_DEG = 4.2;

/**
 * Local compass arc around the current heading (not a full compass rose).
 * The strip repeats every 360°, so translating by heading mod 360 is seamless
 * and, fed by a shortest-angle tracker, never jumps from 359° to 0°.
 */
export class CompassArc {
  private strip: SVGSVGElement;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    clear(host);
    const from = -90;
    const to = 450;
    const width = (to - from) * PX_PER_DEG;
    this.strip = s('svg', { width, height: 38, viewBox: `0 0 ${width} 38` });
    for (let d = from; d <= to; d += 5) {
      const x = (d - from) * PX_PER_DEG;
      const w = wrap360(d);
      const major = w % 45 === 0;
      const mid = w % 15 === 0;
      this.strip.append(s('line', { x1: x, x2: x, y1: 24, y2: major ? 36 : mid ? 32 : 29, class: major ? 'major' : '' }));
      if (major) {
        const label = COMPASS_8[w / 45];
        const cls = label === 'N' ? 'cardinal north' : label.length === 1 ? 'cardinal' : '';
        this.strip.append(s('text', { x, y: 15, class: cls }, label));
      } else if (w % 15 === 0) {
        this.strip.append(s('text', { x, y: 15, style: 'font-size:8.5px;opacity:.7' }, String(w)));
      }
    }
    host.append(this.strip);
    host.after(h('div', { class: 'compass-needle', 'aria-hidden': 'true' }));
    this.offsetFrom = from;
  }

  private offsetFrom: number;

  /** heading: continuous (unwrapped) degrees */
  update(heading: number): void {
    const width = this.host.clientWidth || 340;
    const x = -((wrap360(heading) - this.offsetFrom) * PX_PER_DEG) + width / 2;
    this.strip.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
  }
}
