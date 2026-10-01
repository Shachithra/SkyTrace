import { COMPASS_8, wrap360 } from '../utils/degrees.ts';
import { clamp } from '../utils/math.ts';
import { clear, h, s } from './dom.ts';

const R = 100;

/**
 * Manual mode: drag the reticle over a circular sky map (zenith at centre,
 * horizon at the edge, north up). Works on laptops, desktops and phones
 * without orientation sensors. Fully keyboard-operable.
 */
export class ManualSkyMap {
  az = 180;
  el = 45;
  private radiusDeg = 6;
  private target: SVGCircleElement;
  private dot: SVGCircleElement;
  private focus: SVGCircleElement;
  private svg: SVGSVGElement;
  private desc: HTMLElement;
  private onChange: (az: number, el: number) => void;

  constructor(host: HTMLElement, onChange: (az: number, el: number) => void) {
    this.onChange = onChange;
    clear(host);
    this.svg = s('svg', {
      viewBox: '-118 -118 236 236',
      tabindex: 0,
      role: 'application',
      'aria-label': 'Manual sky selector. Use arrow keys: left and right change azimuth, up and down change elevation. Hold Shift for 5 degree steps.',
      'aria-describedby': 'manual-desc',
    });
    for (const el of [0, 15, 30, 45, 60, 75]) {
      this.svg.append(s('circle', { class: `mm-ring${el === 0 ? ' horizon' : ''}`, r: ((90 - el) / 90) * R }));
      if (el > 0) this.svg.append(s('text', { class: 'mm-el', x: 2, y: -((90 - el) / 90) * R - 2 }, `${el}°`));
    }
    for (let a = 0; a < 360; a += 45) {
      const rad = (a * Math.PI) / 180;
      this.svg.append(s('line', { class: 'mm-spoke', x1: 0, y1: 0, x2: Math.sin(rad) * R, y2: -Math.cos(rad) * R }));
      const lbl = COMPASS_8[a / 45];
      this.svg.append(s('text', { class: `mm-label${lbl === 'N' ? ' n' : ''}`, x: Math.sin(rad) * (R + 10), y: -Math.cos(rad) * (R + 10) }, lbl));
    }
    this.focus = s('circle', { class: 'mm-focus', r: R + 4 });
    this.target = s('circle', { class: 'mm-target', r: 6 });
    this.dot = s('circle', { class: 'mm-dot', r: 2.2 });
    this.svg.append(this.focus, this.target, this.dot);
    this.desc = h('p', { id: 'manual-desc', class: 'sr-only', 'aria-live': 'polite' });
    host.append(this.svg, this.desc);

    let dragging = false;
    const fromEvent = (ev: PointerEvent): void => {
      const rect = this.svg.getBoundingClientRect();
      const scale = 236 / rect.width;
      const x = (ev.clientX - rect.left) * scale - 118;
      const y = (ev.clientY - rect.top) * scale - 118;
      const r = Math.min(R, Math.hypot(x, y));
      this.set(wrap360((Math.atan2(x, -y) * 180) / Math.PI), 90 - (r / R) * 90);
    };
    this.svg.addEventListener('pointerdown', (ev) => {
      dragging = true;
      this.svg.setPointerCapture(ev.pointerId);
      fromEvent(ev);
    });
    this.svg.addEventListener('pointermove', (ev) => dragging && fromEvent(ev));
    this.svg.addEventListener('pointerup', () => (dragging = false));
    this.svg.addEventListener('pointercancel', () => (dragging = false));
    this.svg.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 5 : 1;
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const d = map[ev.key];
      if (!d) return;
      ev.preventDefault();
      this.set(wrap360(this.az + d[0]), this.el + d[1]);
    });
    this.place();
  }

  setRadius(deg: number): void {
    this.radiusDeg = deg;
    this.place();
  }

  set(az: number, el: number, silent = false): void {
    this.az = wrap360(az);
    this.el = clamp(el, 0, 90);
    this.place();
    if (!silent) this.onChange(this.az, this.el);
  }

  private place(): void {
    const r = ((90 - this.el) / 90) * R;
    const rad = (this.az * Math.PI) / 180;
    const x = Math.sin(rad) * r;
    const y = -Math.cos(rad) * r;
    this.dot.setAttribute('cx', x.toFixed(2));
    this.dot.setAttribute('cy', y.toFixed(2));
    this.target.setAttribute('cx', x.toFixed(2));
    this.target.setAttribute('cy', y.toFixed(2));
    this.target.setAttribute('r', ((this.radiusDeg / 90) * R).toFixed(2));
    this.desc.textContent = `Azimuth ${this.az.toFixed(0)} degrees, elevation ${this.el.toFixed(0)} degrees`;
  }

  focusMap(): void {
    this.svg.focus();
  }
}
