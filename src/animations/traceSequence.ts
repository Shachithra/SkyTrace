import gsap from 'gsap';
import { h } from '../ui/dom.ts';

/**
 * TRACE press: button compresses 2–3 %, the ring separates from the button and
 * travels to the scanner centre, where it settles onto the field ring (lock).
 */
export function launchRing(button: HTMLElement, target: { x: number; y: number; r: number }, reduce: boolean): Promise<void> {
  const ring = button.querySelector('.trace-ring') as SVGElement | null;
  if (!ring || reduce) return Promise.resolve();
  const b = ring.getBoundingClientRect();
  const ghost = h('div', { class: 'ring-ghost', 'aria-hidden': 'true' });
  const size = b.width * 0.92;
  Object.assign(ghost.style, { left: `${b.left + b.width / 2 - size / 2}px`, top: `${b.top + b.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.append(ghost);
  const dx = target.x - (b.left + b.width / 2);
  const dy = target.y - (b.top + b.height / 2);
  const finalScale = (target.r * 2) / size;
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: () => { ghost.remove(); resolve(); } })
      .to(ring, { scale: 0.972, duration: 0.09, ease: 'power2.out', transformOrigin: '50% 50%' })
      .to(ring, { scale: 1, duration: 0.25, ease: 'back.out(3)' })
      .fromTo(ghost, { opacity: 0.95 }, { x: dx, y: dy, scale: finalScale, duration: 0.55, ease: 'power3.inOut' }, 0.06)
      .to(ghost, { opacity: 0, duration: 0.22 }, '>-0.08');
  });
}

/** Brief coordinate flashes under the counter while orbits are traced. */
export function coordinateFlashes(el: HTMLElement, base: { az: number; el: number }, start: number, end: number): () => void {
  let i = 0;
  const id = setInterval(() => {
    const t = start + ((end - start) * ((i * 0.137) % 1));
    const d = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    el.textContent = `T ${hh}:${mm}:${ss}Z · AZ ${base.az.toFixed(1)}° · EL ${base.el.toFixed(1)}°`;
    i++;
  }, 140);
  return () => {
    clearInterval(id);
    el.textContent = '';
  };
}
