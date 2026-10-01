import type { Observer } from '../astronomy/types.ts';

export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'manual';

/**
 * One-shot geolocation. SkyTrace never watches position continuously and never
 * stores it unless the user explicitly saves a location — it lives in memory only.
 */
export class LocationSensor {
  status: LocationStatus = 'idle';
  observer: Observer | null = null;
  fixedAt = 0;
  error = '';
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  /** Permission state without prompting (where the Permissions API exists). */
  async peek(): Promise<PermissionState | 'unknown'> {
    try {
      const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      return p?.state ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Must be called from a user gesture the first time. */
  request(): Promise<Observer> {
    if (!this.supported) {
      this.status = 'unavailable';
      this.emit();
      return Promise.reject(new Error('Geolocation is not available in this browser'));
    }
    this.status = 'requesting';
    this.emit();
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.observer = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitudeKm: (pos.coords.altitude ?? 0) / 1000,
            accuracyM: pos.coords.accuracy,
          };
          this.fixedAt = Date.now();
          this.status = 'granted';
          this.error = '';
          this.emit();
          resolve(this.observer);
        },
        (err) => {
          this.status = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
          this.error = err.message;
          this.emit();
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
      );
    });
  }

  /** Coordinates typed by the user (fallback for desktops / denied permission). */
  setManual(lat: number, lon: number, altitudeKm = 0): void {
    this.observer = { latitude: lat, longitude: lon, altitudeKm, accuracyM: undefined };
    this.fixedAt = Date.now();
    this.status = 'manual';
    this.emit();
  }

  /** Re-fix if the position is older than maxAgeMs (only when already permitted). */
  async refreshIfStale(maxAgeMs = 30 * 60_000): Promise<void> {
    if (this.status !== 'granted' || Date.now() - this.fixedAt < maxAgeMs) return;
    try {
      await this.request();
    } catch {
      /* keep the previous fix */
    }
  }
}
