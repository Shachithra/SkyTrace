import gsap from 'gsap';
import { $, h } from './dom.ts';
import { prefersReducedMotion } from '../data/settings.ts';

export type Tone = 'info' | 'ok' | 'warn' | 'error';

export function toast(message: string, tone: Tone = 'info', ms = 3600): void {
  const host = $('[data-toasts]');
  const el = h('div', { class: 'toast', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' }, message);
  host.append(el);
  const reduce = prefersReducedMotion();
  gsap.fromTo(el, { opacity: 0, y: reduce ? 0 : -6 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
  setTimeout(() => {
    gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() });
  }, ms);
}

export interface BannerAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** Subtle instrument-style banner (install, update). Returns a dismiss function. */
export function banner(id: string, title: string, text: string, actions: BannerAction[]): () => void {
  const host = $('[data-banners]');
  host.querySelector(`[data-banner='${id}']`)?.remove();
  const el = h('div', { class: 'banner', 'data-banner': id, role: 'status' });
  const acts = h('div', { class: 'banner-actions' });
  const dismiss = (): void => {
    gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => el.remove() });
  };
  for (const a of actions) {
    const b = h('button', { class: `btn small${a.primary ? ' btn-primary' : ' btn-quiet'}` }, a.label);
    b.addEventListener('click', () => a.onClick());
    acts.append(b);
  }
  el.append(h('span', { class: 'banner-title' }, title), acts, h('p', {}, text));
  host.append(el);
  gsap.fromTo(el, { opacity: 0, y: prefersReducedMotion() ? 0 : 8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
  return dismiss;
}
