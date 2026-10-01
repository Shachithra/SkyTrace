import { ago } from '../utils/format.ts';

export interface OrbitDataState {
  count: number;
  fetchedAt: number | null;
  source: 'network' | 'cache' | 'mixed' | 'none' | 'simulated';
}

/**
 * Status line under the wordmark. Offline uses "LOCAL ORBIT CACHE" rather than a
 * generic offline badge, and always states the data's age.
 */
export function orbitStatusText(s: OrbitDataState, online = navigator.onLine): { text: string; tone: 'live' | 'cache' | 'sim' | 'none' } {
  if (s.source === 'simulated') return { text: 'SIMULATED ORBITS · DEMO ONLY', tone: 'sim' };
  if (s.source === 'none' || !s.count) return { text: online ? 'NO ORBIT DATA' : 'OFFLINE · NO ORBIT CACHE', tone: 'none' };
  const age = s.fetchedAt ? ago(s.fetchedAt).toUpperCase() : 'UNKNOWN AGE';
  if (!online) return { text: `LOCAL ORBIT CACHE · SAVED ${age}`, tone: 'cache' };
  return { text: `${s.count.toLocaleString('en-US')} OBJECTS · UPDATED ${age}`, tone: s.source === 'cache' ? 'live' : 'live' };
}

export function onConnectivity(fn: (online: boolean) => void): void {
  window.addEventListener('online', () => fn(true));
  window.addEventListener('offline', () => fn(false));
}
