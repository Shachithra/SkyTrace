import { DEFAULT_DATASETS } from './datasets.ts';
import { getMeta, setMeta } from './indexedDb.ts';
import type { MagnitudeFilter } from '../stars/visibility.ts';
import type { NightMode } from '../ui/palette.ts';

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
  /** V2 */
  nightMode: NightMode;
  magnitudeFilter: MagnitudeFilter;
  layers: { satellites: boolean; stars: boolean; constellations: boolean; labels: boolean; trajectories: boolean };
  satFilter: 'ALL' | 'VISIBLE' | 'STATIONS' | 'STARLINK' | 'WEATHER' | 'NAVIGATION' | 'SCIENCE';
  /** camera vertical field of view for the AR overlay, degrees */
  arFov: number;
  /** store latitude/longitude with trace & observation history (off by default) */
  storeLocationHistory: boolean;
  passMinElevation: number;
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
  keepHistory: true,
  onboarded: false,
  installDismissed: false,
  savedSatellites: [],
  nightMode: 'off',
  magnitudeFilter: 'STANDARD',
  layers: { satellites: true, stars: true, constellations: true, labels: true, trajectories: true },
  satFilter: 'ALL',
  arFov: 36,
  storeLocationHistory: false,
  passMinElevation: 10,
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
