import { settings } from '../data/settings.ts';

/** Tiny, purposeful vibrations only: target lock, successful trace, timeline selection. */
export function haptic(kind: 'lock' | 'success' | 'select'): void {
  if (!settings.get().haptics || typeof navigator.vibrate !== 'function') return;
  const pattern = kind === 'lock' ? 12 : kind === 'success' ? [10, 60, 18] : 6;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
