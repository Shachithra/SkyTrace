import gsap from 'gsap';
import { $ } from '../ui/dom.ts';

/**
 * App intro (1.2–1.8 s): black → a single satellite point → its orbital arc
 * draws behind it → SKYTRACE rises → UTC timestamp → hand-off.
 */
export function playIntro(reduce: boolean): Promise<void> {
  const root = $('#screen-splash');
  const arc = $<SVGPathElement>('#splash-arc', root);
  const sat = $<SVGCircleElement>('.splash-sat', root);
  const word = $('.splash-word', root);
  const utc = $('.splash-utc', root);

  if (reduce) {
    gsap.set([word, utc], { opacity: 1 });
    return new Promise((r) => setTimeout(r, 700));
  }

  const len = arc.getTotalLength();
  gsap.set(arc, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len });
  gsap.set(sat, { opacity: 0 });
  gsap.set(word, { opacity: 0, y: 10 });
  gsap.set(utc, { opacity: 0 });

  const p = { t: 0 };
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: () => resolve() })
      .to(sat, { opacity: 1, duration: 0.18 })
      .to(
        p,
        {
          t: 1,
          duration: 1.0,
          ease: 'power1.inOut',
          onUpdate: () => {
            const pt = arc.getPointAtLength(p.t * len);
            sat.setAttribute('cx', String(pt.x));
            sat.setAttribute('cy', String(pt.y));
            arc.style.strokeDashoffset = String(len * (1 - p.t));
          },
        },
        '<0.05',
      )
      .to(word, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, '<0.35')
      .to(utc, { opacity: 1, duration: 0.3 }, '<0.25')
      .to(root, { opacity: 0, duration: 0.3, delay: 0.15 });
  });
}
