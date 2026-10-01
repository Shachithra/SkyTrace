import { s, clear } from './dom.ts';

export type ReticleState = 'searching' | 'stable' | 'locked' | 'low';

/**
 * Dynamic targeting reticle: centre target, field radius, sensor-confidence
 * halo and lock state. The centre point is fixed (it *is* the pointing
 * direction); the outer rings carry inertia and trail movement slightly.
 */
export class SkyReticle {
  state: ReticleState = 'searching';
  private host: HTMLElement;
  private svg: SVGSVGElement;
  private outerGroup: SVGGElement;
  private field: SVGCircleElement;
  private fieldDash: SVGCircleElement;
  private uncert: SVGCircleElement;
  private brackets: SVGGElement;
  private outer: SVGCircleElement;
  private scale: SVGGElement;
  private ringPx = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    clear(host);
    this.svg = s('svg', { width: 0, height: 0 });
    this.outerGroup = s('g');
    this.outer = s('circle', { class: 'ret-outer', cx: 0, cy: 0, r: 0 });
    this.scale = s('g', { class: 'ret-scale' });
    this.uncert = s('circle', { class: 'ret-uncert', cx: 0, cy: 0, r: 0 });
    this.fieldDash = s('circle', { class: 'ret-field-dash', cx: 0, cy: 0, r: 0 });
    this.field = s('circle', { class: 'ret-field', cx: 0, cy: 0, r: 0, 'stroke-dasharray': '' });
    this.brackets = s('g');
    this.outerGroup.append(this.outer, this.scale, this.fieldDash, this.brackets);
    const core = s('g', {},
      s('line', { class: 'ret-cross', x1: -14, x2: -5, y1: 0, y2: 0 }),
      s('line', { class: 'ret-cross', x1: 5, x2: 14, y1: 0, y2: 0 }),
      s('line', { class: 'ret-cross', y1: -14, y2: -5, x1: 0, x2: 0 }),
      s('line', { class: 'ret-cross', y1: 5, y2: 14, x1: 0, x2: 0 }),
      s('circle', { class: 'ret-core', r: 1.6, cx: 0, cy: 0 }),
    );
    this.svg.append(this.uncert, this.field, this.outerGroup, core);
    host.append(this.svg);
  }

  /** Field ring radius in px (the selected angular radius, projected). */
  setRing(px: number): void {
    if (Math.abs(px - this.ringPx) < 0.5) return;
    this.ringPx = px;
    const R = px * 1.55 + 10;
    this.svg.setAttribute('width', String(R * 2));
    this.svg.setAttribute('height', String(R * 2));
    this.svg.setAttribute('viewBox', `${-R} ${-R} ${R * 2} ${R * 2}`);
    this.svg.style.transform = `translate(${-R}px, ${-R}px)`;
    this.field.setAttribute('r', String(px));
    this.fieldDash.setAttribute('r', String(px + 7));
    this.outer.setAttribute('r', String(px * 1.55));
    // radial scale ticks on the outer ring: every 10°, longer every 30°, N-side marker
    clear(this.scale);
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const r0 = px * 1.55;
      const r1 = r0 - (a % 30 === 0 ? 7 : 3.5);
      this.scale.append(s('line', { x1: Math.sin(rad) * r0, y1: -Math.cos(rad) * r0, x2: Math.sin(rad) * r1, y2: -Math.cos(rad) * r1 }));
    }
    // corner brackets around the field
    clear(this.brackets);
    const b = px + 16;
    const L = Math.min(14, px * 0.3);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      this.brackets.append(
        s('path', { class: 'ret-bracket', d: `M ${sx * b} ${sy * (b - L)} L ${sx * b} ${sy * b} L ${sx * (b - L)} ${sy * b}` }),
      );
    }
    document.documentElement.style.setProperty('--ring-r', `${px}px`);
  }

  setUncertainty(px: number): void {
    this.uncert.setAttribute('r', String(Math.max(0, px)));
  }

  setState(state: ReticleState): void {
    if (state === this.state) return;
    this.state = state;
    this.host.dataset.state = state;
  }

  /** Inertial offset for the outer rings (px). */
  setLag(x: number, y: number): void {
    this.outerGroup.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
  }

  get element(): SVGSVGElement {
    return this.svg;
  }
}
