import {
  Bell,
  Bookmark,
  History,
  Map as MapIcon,
  Settings,
  Star,
  Camera,
  ChevronLeft,
  Crosshair,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  X,
  createElement,
  type IconNode,
} from 'lucide';

/** Icons are used only where they aid recognition (tool buttons, close/back, playback). */
const ICONS: Record<string, IconNode> = {
  bell: Bell,
  history: History,
  map: MapIcon,
  star: Star,
  sliders: Settings,
  bookmark: Bookmark,
  camera: Camera,
  'chevron-left': ChevronLeft,
  crosshair: Crosshair,
  pause: Pause,
  play: Play,
  'rotate-ccw': RotateCcw,
  settings: Settings2,
  x: X,
};

export function icon(name: string): SVGElement {
  const node = ICONS[name] ?? X;
  const el = createElement(node, { 'aria-hidden': 'true', focusable: 'false', 'stroke-width': '1.5' });
  return el;
}

export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon!));
}

export function setIcon(el: HTMLElement, name: string): void {
  el.dataset.icon = name;
  el.querySelector('svg')?.remove();
  el.prepend(icon(name));
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/** Safe element builder: text is always assigned as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
