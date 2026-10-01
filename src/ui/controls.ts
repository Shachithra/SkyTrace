import { h } from './dom.ts';

export interface TickOption<T> {
  value: T;
  label: string;
  sub?: string;
}

/** Ticks along an angular / temporal scale — used instead of generic select dropdowns. */
export function tickScale<T>(name: string, options: TickOption<T>[], current: T, onPick: (v: T) => void): HTMLElement {
  const root = h('div', { class: 'tick-scale', role: 'radiogroup', 'aria-label': name });
  const buttons = options.map((o) => {
    const b = h('button', { role: 'radio', 'aria-checked': String(o.value === current), type: 'button' }, o.label, o.sub ? h('small', {}, o.sub) : null);
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onPick(o.value);
    });
    b.addEventListener('keydown', (ev) => {
      const i = buttons.indexOf(b);
      const next = ev.key === 'ArrowRight' ? buttons[i + 1] : ev.key === 'ArrowLeft' ? buttons[i - 1] : null;
      if (next) {
        ev.preventDefault();
        next.focus();
        next.click();
      }
    });
    return b;
  });
  root.append(...buttons);
  return root;
}

export function toggleRow(label: string, on: boolean, onChange: (v: boolean) => void, help?: string): HTMLElement {
  const t = h('button', { class: 'toggle', role: 'switch', 'aria-checked': String(on), 'aria-label': label, type: 'button' });
  t.addEventListener('click', () => {
    const v = t.getAttribute('aria-checked') !== 'true';
    t.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  const row = h('div', { class: 'toggle-row' }, h('span', {}, label), t);
  return help ? h('div', {}, row, h('p', { class: 'set-help' }, help)) : row;
}

export function group(name: string, value: string | null, ...children: (Node | null)[]): HTMLElement {
  const g = h('section', { class: 'set-group' });
  g.append(h('div', { class: 'set-head' }, h('h3', { class: 'set-name' }, name), value ? h('span', { class: 'set-value' }, value) : null));
  for (const c of children) if (c) g.append(c);
  return g;
}
