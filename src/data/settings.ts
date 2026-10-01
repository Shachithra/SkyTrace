import { DEFAULT_DATASETS } from './datasets.ts';
import { getMeta, setMeta } from './indexedDb.ts';

export type WindowMinutes = 15 | 30 | 60 | 180;
export type FieldRadius = 3 | 6 | 12;

export interface Settings {
  windowMin: WindowMinutes;
  fieldRadius: FieldRadius;
  units: 'km' | 'mi';
  camera: boolean;
  reduceMotion: 'system' | 'on' | 'off';
  starIntensity: number;
  haptics: boolean;
  datasets: string[];
  contrast: 'standard' | 'high';
  refreshHours: 2 | 6 | 12 | 24;
  keepHistory: boolean;
  onboarded: boolean;
  installDismissed: boolean;
  savedSatellites: number[];
}

export const DEFAULT_SETTINGS: Settings = {
  windowMin: 60,
  fieldRadius: 6,
  units: 'km',
  camera: false,
  reduceMotion: 'system',
  starIntensity: 0.7,
  haptics: true,
  datasets: [...DEFAULT_DATASETS],
  contrast: 'standard',
  refreshHours: 6,
  keepHistory: false,
  onboarded: false,
  installDismissed: false,
  savedSatellites: [],
};

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

class SettingsStore {
  private state: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();

  async load(): Promise<Settings> {
    const saved = await getMeta<Partial<Settings>>('settings');
    if (saved && typeof saved === 'object') this.state = { ...DEFAULT_SETTINGS, ...saved };
    return this.state;
  }

  get(): Settings {
    return this.state;
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== this.state[k]);
    if (!changed.length) return;
    this.state = { ...this.state, ...patch };
    void setMeta('settings', this.state);
    for (const l of this.listeners) l(this.state, changed);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settings = new SettingsStore();

export function prefersReducedMotion(): boolean {
  const m = settings.get().reduceMotion;
  if (m === 'on') return true;
  if (m === 'off') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Trace history is opt-in and never stores the observer's position. */
export interface HistoryEntry {
  traceId: string;
  time: number;
  azimuth: number;
  elevation: number;
  radius: number;
  windowMin: number;
  matches: { name: string; catalogId: number; closestTime: number }[];
}

export async function appendHistory(e: HistoryEntry): Promise<void> {
  if (!settings.get().keepHistory) return;
  const list = (await getMeta<HistoryEntry[]>('history')) ?? [];
  list.unshift(e);
  await setMeta('history', list.slice(0, 50));
}

export async function readHistory(): Promise<HistoryEntry[]> {
  return (await getMeta<HistoryEntry[]>('history')) ?? [];
}

export async function clearHistory(): Promise<void> {
  await setMeta('history', []);
}
