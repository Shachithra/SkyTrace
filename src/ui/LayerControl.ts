import type { Layers } from './SkyView.ts';
import { clear, h } from './dom.ts';

const ORDER: [keyof Layers, string][] = [
  ['satellites', 'SATELLITES'],
  ['stars', 'STARS'],
  ['constellations', 'CONSTELLATIONS'],
  ['labels', 'LABELS'],
  ['trajectories', 'TRAJECTORIES'],
];

/** Compact instrument strip of layer toggles (not five big cards). */
export function renderLayerControl(host: HTMLElement, layers: Layers, onToggle: (k: keyof Layers, on: boolean) => void): void {
  clear(host);
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Sky layers');
  for (const [k, label] of ORDER) {
    const b = h('button', { class: 'strip-btn', type: 'button', 'aria-pressed': String(layers[k]) }, label);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      onToggle(k, on);
    });
    host.append(b);
  }
}

/** Single-choice strip (satellite filter, list ranges…). */
export function renderChoiceStrip<T extends string>(host: HTMLElement, label: string, options: T[], current: T, onPick: (v: T) => void, text: (v: T) => string = (v) => v): void {
  clear(host);
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-label', label);
  const btns = options.map((o) => {
    const b = h('button', { class: 'strip-btn', type: 'button', role: 'radio', 'aria-checked': String(o === current) }, text(o));
    b.addEventListener('click', () => {
      btns.forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onPick(o);
    });
    return b;
  });
  host.append(...btns);
}
