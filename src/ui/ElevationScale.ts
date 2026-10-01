import { clamp } from '../utils/math.ts';
import { clear, s } from './dom.ts';

/** Vertical elevation scale, 0°–90°, with a live marker. */
export class ElevationScale {
  private marker: SVGGElement;
  private svg: SVGSVGElement;

  constructor(host: HTMLElement) {
    clear(host);
    this.svg = s('svg', { viewBox: '0 0 44 100', preserveAspectRatio: 'none' });
    // ticks are drawn in a non-scaling inner group sized via percentages
    for (let el = 0; el <= 90; el += 5) {
      const y = 100 - (el / 90) * 100;
      const major = el % 15 === 0;
      this.svg.append(s('line', { x1: major ? 30 : 35, x2: 44, y1: y, y2: y, 'vector-effect': 'non-scaling-stroke' }));
    }
    host.append(this.svg);
    // labels in a second, non-stretched svg overlay
    const labels = s('svg', { style: 'position:absolute;inset:0;width:100%;height:100%;overflow:visible' });
    for (let el = 0; el <= 90; el += 15) {
      labels.append(s('text', { x: '62%', y: `${100 - (el / 90) * 100}%` }, `${el}°`));
    }
    this.marker = s('g');
    this.marker.append(s('path', { class: 'el-marker', d: 'M 0 0 L -7 -4 L -7 4 Z', transform: 'translate(44 0)' }));
    labels.append(this.marker);
    host.style.position = 'absolute';
    host.append(labels);
  }

  update(elevation: number, heightPx: number): void {
    const y = heightPx * (1 - clamp(elevation, 0, 90) / 90);
    this.marker.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
  }
}
