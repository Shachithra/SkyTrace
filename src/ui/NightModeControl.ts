import type { NightMode } from './palette.ts';
import { h } from './dom.ts';

const NEXT: Record<NightMode, NightMode> = { off: 'dim', dim: 'red', red: 'off' };
const LABEL: Record<NightMode, string> = { off: 'NIGHT', dim: 'DIM', red: 'RED' };

/**
 * Night-vision control: OFF → DIM → RED LIGHT. Applied by the caller through
 * html[data-night] (DOM) and the canvas palette (slow cross-fade, no flashes).
 */
export function nightModeButton(current: NightMode, onChange: (m: NightMode) => void): HTMLButtonElement {
  const b = h('button', { class: 'night-btn', type: 'button', 'aria-label': 'Night vision mode' }) as HTMLButtonElement;
  const set = (m: NightMode): void => {
    b.dataset.mode = m;
    b.textContent = '';
    b.append(h('span', { class: 'night-dot', 'aria-hidden': 'true' }), LABEL[m]);
    b.setAttribute('aria-label', `Night vision: ${m === 'off' ? 'off' : m === 'dim' ? 'dimmed' : 'red light'}. Tap to change.`);
  };
  set(current);
  b.addEventListener('click', () => {
    const m = NEXT[(b.dataset.mode as NightMode) ?? 'off'];
    set(m);
    onChange(m);
  });
  return b;
}

export function applyNightMode(m: NightMode): void {
  document.documentElement.dataset.night = m;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', m === 'red' ? '#020202' : '#05070B');
}
