import { vectorToAzEl } from '../astronomy/angularDistance.ts';
import { AngleTracker, PointingFilter, RingLag } from '../animations/scannerMotion.ts';
import type { LocationSensor } from '../sensors/location.ts';
import type { OrientationSensor } from '../sensors/orientation.ts';
import { ConfidenceModel, type ConfidenceReading } from '../sensors/calibration.ts';
import { DEG, shortestDelta } from '../utils/degrees.ts';
import { fmtAz, utcClock } from '../utils/format.ts';
import { clamp } from '../utils/math.ts';
import { CompassArc } from './CompassArc.ts';
import { $, setText } from './dom.ts';
import { ElevationScale } from './ElevationScale.ts';
import { ManualSkyMap } from './ManualSkyMap.ts';
import { SensorStatus, type SensorStatusModel } from './SensorStatus.ts';
import { SkyRenderer, type GhostPath, type ReplayDraw } from './SkyRenderer.ts';
import { SkyReticle, type ReticleState } from './SkyReticle.ts';

export type ScannerMode = 'live' | 'locked' | 'manual' | 'replay';

/**
 * The hero experience. One rAF loop:
 *   sensor event → latest orientation state → requestAnimationFrame → render
 * Raw sensor events never touch the DOM directly.
 */
export class SkyScanner {
  readonly root: HTMLElement;
  readonly renderer: SkyRenderer;
  readonly reticle: SkyReticle;
  readonly manual: ManualSkyMap;
  mode: ScannerMode = 'live';
  /** The mode to return to after a lock/replay ends. */
  baseMode: 'live' | 'manual' = 'live';
  confidence: ConfidenceReading = { grade: 'FAIR', accuracyDeg: 8 };
  active = false;
  /** pause all drawing (another full-screen renderer is in front) */
  suspended = false;

  private filter = new PointingFilter();
  private heading = new AngleTracker();
  private lag = new RingLag();
  private conf = new ConfidenceModel();
  private compass: CompassArc;
  private elev: ElevationScale;
  private status: SensorStatus;
  private frozen: { az: number; el: number } | null = null;
  private view = { az: 180, el: 45 };
  private lastFrame = 0;
  private lastText = 0;
  private lastPointing: { az: number; el: number } | null = null;
  private stableAnnounced = false;
  private raf = 0;
  private sheetOpen = false;
  private radiusDeg = 6;
  private lastSensorEvent = 0;

  onStableLock: (() => void) | null = null;
  onCalibration: ((needed: boolean) => void) | null = null;

  private orientation: OrientationSensor;
  private location: LocationSensor;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, orientation: OrientationSensor, location: LocationSensor) {
    this.root = root;
    this.orientation = orientation;
    this.location = location;
    this.renderer = new SkyRenderer(canvas);
    this.reticle = new SkyReticle($('[data-reticle]', root));
    this.compass = new CompassArc($('[data-compass]', root));
    this.elev = new ElevationScale($('[data-elev]', root));
    this.status = new SensorStatus($('[data-sensor-status]', root));
    this.manual = new ManualSkyMap($('[data-manual-map]', root), (az, el) => {
      this.view = { az, el };
    });
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.layout();
    });
    this.layout();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Ring size and vertical centre depend on viewport and whether a sheet is open. */
  layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const wide = w >= 760;
    const cy = this.sheetOpen && !wide ? 0.19 : wide && this.sheetOpen ? 0.45 : h < 520 && w > h ? 0.5 : 0.42;
    const ring = this.sheetOpen && !wide ? clamp(h * 0.06, 36, 54) : clamp(Math.min(w, h) * 0.24, 64, 150);
    this.renderer.cyFrac = cy;
    this.renderer.ringPx = ring;
    const shift = wide && this.sheetOpen ? -220 : 0;
    this.renderer.cxShift = shift;
    this.root.style.setProperty('--cx-shift', `${shift}px`);
    this.root.style.setProperty('--cy', `${cy * 100}%`);
    this.reticle.setRing(ring);
  }

  setSheetOpen(open: boolean): void {
    this.sheetOpen = open;
    this.root.dataset.sheet = String(open);
    this.layout();
  }

  setRadius(deg: number): void {
    this.radiusDeg = deg;
    this.renderer.radiusDeg = deg;
    this.manual.setRadius(deg);
    setText($('[data-t-fov]', this.root), `${(deg * 2).toFixed(1)}°`);
  }

  setMode(mode: ScannerMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    const label = { live: 'LIVE TRACE', locked: 'TARGET LOCKED', manual: 'MANUAL TRACE', replay: 'TRAJECTORY REPLAY' }[mode];
    setText($('[data-scan-mode]', this.root), label);
    $('[data-manual-map]', this.root).hidden = mode !== 'manual';
    this.renderer.gridVisible = mode !== 'manual';
    if (mode === 'manual' || mode === 'live') this.baseMode = mode;
    if (mode === 'locked' || mode === 'replay') this.reticle.setState('locked');
  }

  /** Freeze the current pointing direction (orientation snapshot). */
  freeze(): { az: number; el: number } {
    const t = this.currentPointing();
    this.frozen = { ...t };
    this.view = { ...t };
    return this.frozen;
  }

  /** Freeze on a stored direction (history replay). */
  freezeTo(t: { az: number; el: number }): void {
    this.frozen = { ...t };
    this.view = { ...t };
  }

  unfreeze(): void {
    this.frozen = null;
    this.stableAnnounced = false;
  }

  get frozenTarget(): { az: number; el: number } | null {
    return this.frozen;
  }

  currentPointing(): { az: number; el: number } {
    if (this.frozen) return this.frozen;
    if (this.mode === 'manual') return { az: this.manual.az, el: this.manual.el };
    return this.filter.azEl() ?? this.view;
  }

  hasLiveSensors(): boolean {
    return this.orientation.status === 'live' && performance.now() - this.lastSensorEvent < 3000;
  }

  setGhosts(g: GhostPath[]): void {
    this.renderer.ghosts = g;
  }

  setReplay(r: ReplayDraw | null): void {
    this.renderer.replay = r;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.suspended) {
      this.lastFrame = now;
      return;
    }
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    const r = this.renderer;

    if (!this.active) {
      r.mode = 'ambient';
      r.draw(now, dt);
      return;
    }
    r.mode = 'scanner';

    // 1. Latest orientation state → smoothed pointing.
    const reading = this.orientation.latest;
    if (reading && reading.t !== this.lastSensorEvent) {
      this.lastSensorEvent = reading.t;
      this.conf.push(reading.vector, now);
    }
    if (reading && this.mode === 'live') this.filter.update(reading.vector, dt, now);
    if (reading) this.confidence = this.conf.read(reading.compassAccuracy, reading.absolute);

    // 2. Decide the view centre.
    let target: { az: number; el: number };
    if (this.frozen) target = this.frozen;
    else if (this.mode === 'manual') target = { az: this.manual.az, el: this.manual.el };
    else target = this.filter.azEl() ?? this.view;

    // Inertia: the centre is the pointing direction; rings lag behind screen motion.
    const prev = this.lastPointing ?? target;
    const moveX = shortestDelta(prev.az, target.az) * Math.cos(target.el * DEG) * r.pxPerDeg * 0.02;
    const moveY = -(target.el - prev.el) * r.pxPerDeg * 0.02;
    this.lastPointing = target;
    this.lag.update(this.mode === 'live' ? moveX : 0, this.mode === 'live' ? moveY : 0, dt);
    this.reticle.setLag(this.lag.x, this.lag.y);

    this.view = target;
    r.center = { az: target.az, el: clamp(target.el, -89.5, 89.5) };
    const h = this.heading.update(target.az, dt, this.mode === 'live' ? 14 : 8);
    this.compass.update(h);
    const elevHost = this.root.querySelector<HTMLElement>('[data-elev]');
    this.elev.update(target.el, elevHost?.clientHeight ?? 300);

    // star parallax: 2–8 px, bounded and continuous
    r.parallaxTarget = { x: Math.sin(target.az * DEG) * 7, y: Math.sin(target.el * DEG) * 5 };

    // 3. Reticle state & uncertainty halo.
    if (this.mode === 'live') {
      const stableMs = this.filter.stableFor(now);
      let st: ReticleState = 'searching';
      if (this.confidence.grade === 'POOR') st = 'low';
      else if (stableMs > 800) st = 'stable';
      this.reticle.setState(st);
      if (st === 'stable' && !this.stableAnnounced) {
        this.stableAnnounced = true;
        this.onStableLock?.();
      } else if (st !== 'stable') this.stableAnnounced = false;
      this.reticle.setUncertainty(Math.tan(Math.min(25, this.confidence.accuracyDeg) * DEG) * (r.ringPx / Math.tan(this.radiusDeg * DEG)));
    } else if (this.mode === 'manual') {
      this.reticle.setState('stable');
      this.reticle.setUncertainty(0);
    } else {
      this.reticle.setUncertainty(0);
    }

    r.draw(now, dt);

    // 4. Text telemetry at ~12 Hz — DOM is not rewritten on every frame.
    if (now - this.lastText > 80) {
      this.lastText = now;
      this.updateText(target);
    }
  };

  private updateText(t: { az: number; el: number }): void {
    const hasPointing = this.mode !== 'live' || !!this.filter.vector;
    setText($('[data-t-az]', this.root), hasPointing ? fmtAz(t.az) : '---.-°');
    setText($('[data-t-el]', this.root), hasPointing ? `${t.el >= 0 ? '' : '−'}${Math.abs(t.el).toFixed(1)}°` : '--.-°');
    setText($('[data-t-utc]', this.root), utcClock());

    const stateEl = $('[data-reticle-state]', this.root);
    const rs = this.reticle.state;
    let text = 'SEARCHING';
    let tone = '';
    if (this.mode === 'locked') [text, tone] = ['TARGET LOCKED', 'locked'];
    else if (this.mode === 'replay') [text, tone] = ['REPLAYING CROSSING', 'locked'];
    else if (this.mode === 'manual') [text, tone] = ['DRAG TO AIM · ARROW KEYS', ''];
    else if (!this.filter.vector) [text, tone] = ['WAITING FOR SENSORS', 'low'];
    else if (rs === 'low') [text, tone] = [`LOW ACCURACY ±${this.confidence.accuracyDeg.toFixed(0)}°`, 'low'];
    else if (rs === 'stable') [text, tone] = ['TARGET FIELD STABLE', 'stable'];
    setText(stateEl, text);
    stateEl.dataset.tone = tone;

    this.onCalibration?.(this.mode === 'live' && !!this.filter.vector && this.confidence.grade === 'POOR');
    this.status.update(this.statusModel());
  }

  private statusModel(): SensorStatusModel {
    const loc = this.location;
    const acc = loc.observer?.accuracyM;
    const gps: SensorStatusModel['gps'] =
      loc.status === 'granted'
        ? { label: 'GPS', value: acc != null ? `±${acc < 1000 ? Math.round(acc) + 'm' : (acc / 1000).toFixed(1) + 'km'}` : 'FIX', level: acc == null ? 2 : acc < 30 ? 3 : acc < 500 ? 2 : 1, tone: acc != null && acc < 500 ? 'good' : 'fair' }
        : loc.status === 'manual'
          ? { label: 'GPS', value: 'MANUAL', level: 2, tone: 'fair' }
          : { label: 'GPS', value: loc.status === 'requesting' ? 'FIXING' : 'OFF', level: 0, tone: 'off' };

    const live = this.orientation.status === 'live';
    const c = this.confidence;
    const compass: SensorStatusModel['compass'] = live && this.mode !== 'manual'
      ? { label: 'COMPASS', value: `${c.grade} ±${c.accuracyDeg.toFixed(0)}°`, level: c.grade === 'GOOD' ? 3 : c.grade === 'FAIR' ? 2 : 1, tone: c.grade === 'GOOD' ? 'good' : c.grade === 'FAIR' ? 'fair' : 'poor' }
      : { label: 'COMPASS', value: this.mode === 'manual' ? 'MANUAL' : 'OFF', level: 0, tone: 'off' };

    const orientation: SensorStatusModel['orientation'] =
      this.mode === 'locked' || this.mode === 'replay'
        ? { label: 'ORIENTATION', value: 'LOCKED', level: 3, tone: 'good' }
        : this.mode === 'manual'
          ? { label: 'ORIENTATION', value: 'MANUAL', level: 2, tone: 'fair' }
          : live
            ? { label: 'ORIENTATION', value: 'LIVE', level: 3, tone: 'good' }
            : { label: 'ORIENTATION', value: 'OFF', level: 0, tone: 'off' };
    return { gps, compass, orientation };
  }

  /** Screen position + radius of the field ring (for the trace-button ring flight). */
  ringScreen(): { x: number; y: number; r: number } {
    return { x: this.renderer.cx, y: this.renderer.cy, r: this.renderer.ringPx };
  }

  debugPointing(): { az: number; el: number } | null {
    return this.filter.vector ? vectorToAzEl(this.filter.vector) : null;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }
}
