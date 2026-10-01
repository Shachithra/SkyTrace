import type { Observer, OrbitRecord } from '../astronomy/types.ts';
import type { SatellitePass } from '../alerts/passPrediction.ts';
import { alertRules, evaluateAlerts, readPrefs } from '../alerts/alertRules.ts';
import { scheduleLocal } from '../alerts/notifications.ts';
import { skyCache, type SavedLocation } from '../data/indexedDb.ts';
import { settings } from '../data/settings.ts';
import { userStore } from '../data/userStore.ts';
import { CameraBackdrop } from '../sensors/camera.ts';
import { LocationSensor } from '../sensors/location.ts';
import { OrientationSensor } from '../sensors/orientation.ts';
import { loadSkyDatasets, type SkyDatasets } from '../stars/starCatalog.ts';
import { savedLocations, savedSatellites } from '../sync/favorites.ts';
import { $ } from '../ui/dom.ts';
import type { SatMeta } from '../ui/SkyView.ts';
import { OrbitClient } from '../workers/orbitClient.ts';
import { SkyClient } from '../workers/skyClient.ts';
import type { PassResult } from '../workers/orbitTypes.ts';

/** Shared, long-lived services used by every screen. */
export const location = new LocationSensor();
export const orientation = new OrientationSensor();
export const camera = new CameraBackdrop($<HTMLVideoElement>('#camera'));
export const orbit = new OrbitClient();
export const sky = new SkyClient();

export const satMeta = new Map<number, SatMeta>();
export function setRecords(records: OrbitRecord[]): void {
  satMeta.clear();
  for (const r of records) satMeta.set(r.NORAD_CAT_ID, { name: r.OBJECT_NAME, groups: r.groups ?? [] });
  passes.invalidate();
}

/* ───────── sky datasets (star catalogue + constellations) ───────── */

let skyData: SkyDatasets | null = null;
let skyLoading: Promise<SkyDatasets | null> | null = null;
export function skyDatasets(): Promise<SkyDatasets | null> {
  if (skyData) return Promise.resolve(skyData);
  skyLoading ??= loadSkyDatasets(skyCache)
    .then(async (d) => {
      skyData = d;
      await sky.load(d.stars, d.constellations);
      orbit.loadConstellations(d.constellations);
      return d;
    })
    .catch(() => null);
  return skyLoading;
}
export const skyDataSync = (): SkyDatasets | null => skyData;

/* ───────── observer: GPS / manual fix, or the active saved location ───────── */

let activeLocation: SavedLocation | null = null;
export async function refreshActiveLocation(): Promise<void> {
  const id = await savedLocations.active();
  activeLocation = id ? (await savedLocations.list()).find((l) => l.id === id) ?? null : null;
}
export function observer(): Observer | null {
  if (activeLocation) return { latitude: activeLocation.latitude, longitude: activeLocation.longitude, altitudeKm: (activeLocation.altitude ?? 0) / 1000 };
  return location.observer;
}
export const activeLocationName = (): string | null => activeLocation?.name ?? null;
export function observerFor(loc: SavedLocation | null): Observer | null {
  return loc ? { latitude: loc.latitude, longitude: loc.longitude, altitudeKm: (loc.altitude ?? 0) / 1000 } : location.observer;
}

/* ───────── pass predictions (cached) + alert scheduling ───────── */

type PassListener = (r: PassResult | null) => void;

class PassService {
  result: PassResult | null = null;
  private key = '';
  private computedAt = 0;
  private running: Promise<PassResult | null> | null = null;
  private listeners = new Set<PassListener>();
  progress = { done: 0, total: 0 };

  onChange(fn: PassListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  invalidate(): void {
    this.key = '';
    this.computedAt = 0;
  }

  /** Next 24 h of passes for the current observer (cached for 10 minutes). */
  async next24h(force = false): Promise<PassResult | null> {
    const o = observer();
    if (!o || !orbit.loadedCount) return null;
    const key = `${o.latitude.toFixed(2)},${o.longitude.toFixed(2)}:${settings.get().passMinElevation}`;
    if (!force && this.result && key === this.key && Date.now() - this.computedAt < 10 * 60_000) return this.result;
    if (this.running) return this.running;
    const favs = (await savedSatellites.list()).map((s) => s.norad_id);
    const now = Date.now() - 10 * 60_000; // include passes already under way
    const job = orbit.passes(
      { observer: o, start: now, end: now + 24.2 * 3_600_000, minElevation: settings.get().passMinElevation, catalogIds: null, extraIds: favs },
      (done, total) => {
        this.progress = { done, total };
      },
    );
    this.running = job.promise
      .then((r) => {
        this.result = r;
        this.key = key;
        this.computedAt = Date.now();
        for (const l of this.listeners) l(r);
        void refreshAlerts();
        return r;
      })
      .catch(() => null)
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  nextFor(catalogId: number, visibleOnly = false): SatellitePass | null {
    const now = Date.now();
    return this.result?.passes.find((p) => p.catalogId === catalogId && p.set.t > now && (!visibleOnly || p.status !== 'NOT_EXPECTED')) ?? null;
  }
}
export const passes = new PassService();

/** Re-evaluate alert rules and (re)schedule local notifications. */
export async function refreshAlerts(): Promise<number> {
  const rules = (await alertRules.list()).filter((r) => r.enabled);
  if (!rules.length) return scheduleLocal([]);
  const prefs = await readPrefs();
  const byLoc = new Map<string | null, SatellitePass[]>();
  byLoc.set(null, passes.result?.passes ?? []);
  // Alerts tied to other saved locations: predict just those satellites there.
  const locs = await savedLocations.list();
  for (const locId of new Set(rules.map((r) => r.location_id).filter((x): x is string => !!x))) {
    const loc = locs.find((l) => l.id === locId);
    const o = observerFor(loc ?? null);
    if (!o) continue;
    const ids = rules.filter((r) => r.location_id === locId).map((r) => r.norad_id);
    const res = await orbit.passes({ observer: o, start: Date.now(), end: Date.now() + 24 * 3_600_000, minElevation: 0, catalogIds: ids, extraIds: [] }).promise.catch(() => null);
    byLoc.set(locId, res?.passes ?? []);
  }
  return scheduleLocal(evaluateAlerts(rules, byLoc, prefs, Date.now()));
}

userStore.onChange((store) => {
  if (store === 'alerts') void refreshAlerts();
  if (store === 'savedLocations') void refreshActiveLocation();
});
