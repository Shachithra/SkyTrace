import { DEG, wrap180 } from '../utils/degrees.ts';
import type { Vec3 } from '../utils/math.ts';

export type OrientationStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'silent';

interface IOSOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}
type PermissionAware = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Camera pointing direction in local East-North-Up coordinates, from W3C
 * device orientation Euler angles (Z-X'-Y'' intrinsic: alpha, beta, gamma).
 * The rear camera looks along the device's −Z axis, so the result is the
 * negated third column of R = Rz(α)·Rx(β)·Ry(γ). Screen rotation (portrait vs
 * landscape) spins the device about Z, which leaves −Z unchanged.
 */
export function pointingVector(alphaDeg: number, betaDeg: number, gammaDeg: number): Vec3 {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);
  return [-(ca * sg + sa * sb * cg), -(sa * sg - ca * sb * cg), -(cb * cg)];
}

export interface OrientationReading {
  vector: Vec3;
  /** Reported compass accuracy in degrees (iOS only), else null. */
  compassAccuracy: number | null;
  /** Whether alpha is referenced to north. */
  absolute: boolean;
  t: number;
}

export class OrientationSensor {
  status: OrientationStatus = 'idle';
  latest: OrientationReading | null = null;
  private iosOffset: number | null = null;
  private listeners = new Set<() => void>();
  private bound = false;
  private silentTimer: ReturnType<typeof setTimeout> | null = null;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** iOS 13+ requires an explicit permission request from a user gesture. */
  get needsPermission(): boolean {
    return this.supported && typeof (DeviceOrientationEvent as unknown as PermissionAware).requestPermission === 'function';
  }

  /** Call from a button handler ("ENABLE SKY SENSORS"). Never called automatically. */
  async request(): Promise<OrientationStatus> {
    if (!this.supported) {
      this.status = 'unsupported';
      this.emit();
      return this.status;
    }
    this.status = 'requesting';
    this.emit();
    try {
      const ask = (DeviceOrientationEvent as unknown as PermissionAware).requestPermission;
      if (typeof ask === 'function') {
        const res = await ask.call(DeviceOrientationEvent);
        if (res !== 'granted') {
          this.status = 'denied';
          this.emit();
          return this.status;
        }
        // Motion permission is requested alongside where the platform separates it.
        const askMotion = (globalThis.DeviceMotionEvent as unknown as PermissionAware | undefined)?.requestPermission;
        if (typeof askMotion === 'function') await askMotion.call(DeviceMotionEvent).catch(() => undefined);
      }
    } catch {
      this.status = 'denied';
      this.emit();
      return this.status;
    }
    this.start();
    return this.status;
  }

  private start(): void {
    if (!this.bound) {
      this.bound = true;
      const absolute = 'ondeviceorientationabsolute' in window;
      window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', this.onEvent as EventListener, { passive: true });
    }
    // Laptops expose the API but never fire events: report "silent" after a grace period.
    this.status = 'requesting';
    this.emit();
    if (this.silentTimer) clearTimeout(this.silentTimer);
    this.silentTimer = setTimeout(() => {
      if (!this.latest) {
        this.status = 'silent';
        this.emit();
      }
    }, 1800);
  }

  private onEvent = (e: IOSOrientationEvent): void => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    let alpha = e.alpha;
    let absolute = e.absolute === true || e.type === 'deviceorientationabsolute';
    let accuracy: number | null = null;

    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: alpha is relative to an arbitrary start; webkitCompassHeading is north-referenced.
      // Track the offset between them on the circle with light smoothing to avoid jitter.
      const offset = wrap180(e.webkitCompassHeading - (360 - alpha));
      this.iosOffset = this.iosOffset === null ? offset : this.iosOffset + wrap180(offset - this.iosOffset) * 0.15;
      alpha = alpha - this.iosOffset;
      absolute = true;
      accuracy = typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
    }

    this.latest = { vector: pointingVector(alpha, e.beta, e.gamma), compassAccuracy: accuracy, absolute, t: performance.now() };
    if (this.status !== 'live') {
      this.status = 'live';
      if (this.silentTimer) clearTimeout(this.silentTimer);
      this.emit();
    }
  };
}
