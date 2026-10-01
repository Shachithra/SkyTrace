import type { SavedLocation, SavedSatellite } from '../data/indexedDb.ts';
import { userStore, validLatLon, validName } from '../data/userStore.ts';
import { getMeta, setMeta } from '../data/indexedDb.ts';

/** Saved satellites ("MY SATELLITES") — local-first, synced when signed in. */
export const savedSatellites = {
  list: (): Promise<SavedSatellite[]> => userStore.list<SavedSatellite>('savedSatellites'),
  async find(noradId: number): Promise<SavedSatellite | undefined> {
    return (await this.list()).find((s) => s.norad_id === noradId);
  },
  async toggle(noradId: number, name: string): Promise<boolean> {
    const cur = await this.find(noradId);
    if (cur) {
      await userStore.remove('savedSatellites', cur.id);
      return false;
    }
    await userStore.put<SavedSatellite>('savedSatellites', { norad_id: noradId, satellite_name: validName(name, 64), alerts_enabled: false });
    return true;
  },
  async setAlerts(noradId: number, name: string, on: boolean): Promise<void> {
    const cur = await this.find(noradId);
    if (cur) await userStore.put<SavedSatellite>('savedSatellites', { ...cur, alerts_enabled: on });
    else await userStore.put<SavedSatellite>('savedSatellites', { norad_id: noradId, satellite_name: validName(name, 64), alerts_enabled: on });
  },
};

/**
 * Saved observing locations. Storing an exact location is always an explicit
 * user action; SkyTrace never tracks position in the background.
 */
export const savedLocations = {
  list: (): Promise<SavedLocation[]> => userStore.list<SavedLocation>('savedLocations'),
  async add(name: string, latitude: number, longitude: number, altitude = 0): Promise<SavedLocation> {
    validLatLon(latitude, longitude);
    return userStore.put<SavedLocation>('savedLocations', {
      name: validName(name),
      latitude: Math.round(latitude * 1e5) / 1e5,
      longitude: Math.round(longitude * 1e5) / 1e5,
      altitude: Number.isFinite(altitude) ? Math.round(altitude) : 0,
    });
  },
  remove: (id: string): Promise<void> => userStore.remove('savedLocations', id),
  async active(): Promise<string | null> {
    return (await getMeta<string | null>('activeLocation')) ?? null;
  },
  async setActive(id: string | null): Promise<void> {
    await setMeta('activeLocation', id);
  },
};
