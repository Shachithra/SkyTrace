import gsap from 'gsap';
import { prefersReducedMotion } from '../data/settings.ts';
import { $ } from './dom.ts';

/** Bottom sheet (side panel on wide screens) that rises in and slides away. */
export function openSheet(sel: string): void {
  const reduce = prefersReducedMotion();
  const el = $(sel);
  const wasHidden = el.hidden;
  el.hidden = false;
  if (wasHidden) {
    const wide = window.innerWidth >= 760;
    gsap.fromTo(
      el,
      wide ? { xPercent: reduce ? 0 : 100, opacity: reduce ? 0 : 1 } : { yPercent: reduce ? 0 : 100, opacity: reduce ? 0 : 1 },
      { xPercent: 0, yPercent: 0, opacity: 1, duration: reduce ? 0.2 : 0.55, ease: 'power3.out' },
    );
  }
  el.focus({ preventScroll: true });
}

export function closeSheet(sel: string, then?: () => void): void {
  const reduce = prefersReducedMotion();
  const el = $(sel);
  if (el.hidden) return then?.();
  const wide = window.innerWidth >= 760;
  gsap.to(el, {
    ...(wide ? { xPercent: reduce ? 0 : 100 } : { yPercent: reduce ? 0 : 100 }),
    opacity: reduce ? 0 : 1,
    duration: reduce ? 0.15 : 0.35,
    ease: 'power2.in',
    onComplete: () => {
      el.hidden = true;
      gsap.set(el, { clearProps: 'transform,opacity' });
      then?.();
    },
  });
}

export const isOpen = (sel: string): boolean => !$(sel).hidden;
