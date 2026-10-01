import gsap from 'gsap';

/**
 * Result reveal: the timeline line grows vertically and each event appears
 * exactly when the line reaches it; labels slide 8–12 px into place.
 */
export function revealTimeline(root: HTMLElement, reduce: boolean): void {
  const axis = root.querySelector<HTMLElement>('.tl-axis');
  const events = Array.from(root.querySelectorAll<HTMLElement>('[data-y]'));
  const caps = Array.from(root.querySelectorAll<HTMLElement>('.tl-cap, .tl-tick, .tl-tick-label'));
  if (reduce || !axis) {
    gsap.fromTo([axis, ...events, ...caps].filter(Boolean), { opacity: 0 }, { opacity: 1, duration: 0.25 });
    return;
  }
  const total = Math.max(1, root.clientHeight);
  const duration = gsap.utils.clamp(0.7, 1.4, total / 700);
  gsap.fromTo(axis, { scaleY: 0 }, { scaleY: 1, duration, ease: 'power2.inOut' });
  gsap.fromTo(caps, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.02 });
  let lastDelay = -1;
  for (const el of events) {
    const y = Number(el.dataset.y) || 0;
    // Proportional delay so the marker appears as the line reaches it; ≥60 ms stagger.
    let delay = (y / total) * duration;
    if (delay < lastDelay + 0.06) delay = lastDelay + 0.06;
    lastDelay = delay;
    const body = el.querySelector('.tl-body');
    const dot = el.querySelector('.tl-dot') ?? el;
    gsap.fromTo(dot, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, delay, ease: 'back.out(2.2)' });
    if (body) gsap.fromTo(body, { x: 10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.42, delay: delay + 0.04, ease: 'power3.out' });
    const time = el.querySelector('.tl-time');
    if (time) gsap.fromTo(time, { opacity: 0 }, { opacity: 1, duration: 0.3, delay });
  }
}
