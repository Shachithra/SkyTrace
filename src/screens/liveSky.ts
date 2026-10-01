import { azElToVector, separation } from '../astronomy/angularDistance.ts';
import { AngleTracker, PointingFilter } from '../animations/scannerMotion.ts';
import { camera, location, observer, orbit, orientation, passes, satMeta, sky, skyDatasets, skyDataSync } from '../app/services.ts';
import { router } from '../app/router.ts';
import { alertRules } from '../alerts/alertRules.ts';
import { settings, prefersReducedMotion } from '../data/settings.ts';
import { ConfidenceModel } from '../sensors/calibration.ts';
import { fmtHours } from '../sky/siderealTime.ts';
import { limitingMagnitude, sunAltitude } from '../sky/horizon.ts';
import { effectiveLimit } from '../stars/visibility.ts';
import { savedSatellites } from '../sync/favorites.ts';
import { ago, fmtAz, fmtDistance, utcClock } from '../utils/format.ts';
import { haptic } from '../utils/haptics.ts';
import { clamp } from '../utils/math.ts';
import { CompassArc } from '../ui/CompassArc.ts';
import { $, clear, h, setIcon, setText } from '../ui/dom.ts';
import { ElevationScale } from '../ui/ElevationScale.ts';
import { renderChoiceStrip, renderLayerControl } from '../ui/LayerControl.ts';
import { SensorStatus } from '../ui/SensorStatus.ts';
import { SAT_FILTERS, SkyView, type SatFilter } from '../ui/SkyView.ts';
import { closeSheet } from '../ui/sheets.ts';
import { toast } from '../ui/Toast.ts';
import { visibilityIndicator } from '../ui/VisibilityIndicator.ts';
import type { PatternResult } from '../workers/skyTypes.ts';
import type { TrajectoryPoint } from '../workers/orbitTypes.ts';
import { showConstellation, showSatellite, showStar } from './objectSheet.ts';

const STATUS: ('NOT_EXPECTED' | 'POSSIBLY_VISIBLE' | 'LIKELY_VISIBLE')[] = ['NOT_EXPECTED', 'POSSIBLY_VISIBLE', 'LIKELY_VISIBLE'];

/**
 * LIVE SKY MODE — the main V2 experience: the sky in the direction the phone
 * points (or an all-sky map), with real stars, constellation figures, live
 * satellites and their trajectories.
 */
export class LiveSkyScreen {
  readonly root = $('#screen-live');
  readonly view: SkyView;
  private compass: CompassArc;
  private elev: ElevationScale;
  private sensors: SensorStatus;
  private filter = new PointingFilter();
  private heading = new AngleTracker();
  private conf = new ConfidenceModel();
  private active = false;
  private raf = 0;
  private last = 0;
  private lastText = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private manualAim = false;
  private pattern: PatternResult | null = null;
  private contextKey = '';
  private trajFor = -1;
  private trajAt = 0;
  private ctxTraj = new Map<number, { at: number; pts: TrajectoryPoint[] }>();
  private lastSensor = 0;

  constructor() {
    this.view = new SkyView($<HTMLCanvasElement>('[data-live-canvas]', this.root));
    this.compass = new CompassArc($('[data-live-compass]', this.root));
    this.elev = new ElevationScale($('[data-live-elev]', this.root));
    this.sensors = new SensorStatus($('[data-live-sensors]', this.root));
    const st = settings.get();
    this.view.layers = { ...st.layers };
    this.view.filter = st.satFilter;
    this.view.meta = satMeta;
    this.view.palette.set(st.nightMode, true);
    renderLayerControl($('[data-layers]', this.root), this.view.layers, (k, on) => {
      this.view.layers[k] = on;
      settings.set({ layers: { ...this.view.layers } });
      if (k === 'constellations' && on) this.view.revealConstellations();
    });
    renderChoiceStrip<SatFilter>($('[data-sat-filter]', this.root), 'Satellite filter', SAT_FILTERS, this.view.filter, (f) => {
      this.view.filter = f;
      settings.set({ satFilter: f });
      if (f === 'STARLINK' && !settings.get().datasets.includes('starlink') && !settings.get().datasets.includes('active')) toast('STARLINK DATASET IS OFF · ENABLE IT IN SETTINGS', 'warn', 4200);
    });
    this.bindPointer();
    window.addEventListener('resize', () => this.view.resize());
    $('[data-live-pattern]', this.root).addEventListener('click', () => {
      if (this.pattern?.id) void showConstellation(this.pattern.id, (id) => this.focus(id));
    });
    $('[data-live-context]', this.root).addEventListener('click', () => {
      const id = Number(($('[data-live-context]', this.root) as HTMLElement).dataset.sat);
      if (id) this.selectSatellite(id);
    });
  }

  async open(params?: { focusSatellite?: number }): Promise<void> {
    this.active = true;
    document.body.classList.add('live-active');
    this.view.resize();
    this.view.reduceMotion = prefersReducedMotion();
    this.view.palette.set(settings.get().nightMode);
    const d = await skyDatasets();
    if (d && !this.view.cat) this.view.setData(d.stars, d.constellations);
    if (!d) toast('STAR CATALOGUE UNAVAILABLE · SATELLITES ONLY', 'warn');
    this.renderOrbitNotice();
    if (orientation.status === 'idle' && !orientation.needsPermission) void orientation.request();
    void this.refreshField();
    void this.refreshLive();
    void passes.next24h();
    this.timers = [
      setInterval(() => void this.refreshLive(), 1000),
      setInterval(() => void this.refreshField(), 20_000),
      setInterval(() => void this.refreshContext(), 2000),
      setInterval(() => void this.refreshPattern(), 1500),
      setInterval(() => void this.refreshSelection(), 1000),
    ];
    void this.updateAlertPulses();
    this.raf = requestAnimationFrame(this.frame);
    if (params?.focusSatellite) this.selectSatellite(params.focusSatellite, true);
  }

  close(): void {
    this.active = false;
    document.body.classList.remove('live-active');
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.view.cameraOn) this.toggleCamera(false);
  }

  /** No orbital data yet (first run offline / source unreachable): offer retry or the labelled demo. */
  renderOrbitNotice(): void {
    let n = this.root.querySelector<HTMLElement>('[data-orbit-notice]');
    if (orbit.loadedCount) {
      n?.remove();
      return;
    }
    if (!n) {
      n = h('div', { class: 'notice live-notice', 'data-orbit-notice': '', role: 'status' });
      this.root.append(n);
    }
    clear(n);
    const retry = h('button', { class: 'btn small', type: 'button' }, 'RETRY');
    retry.addEventListener('click', async () => {
      await router.call('retryOrbits');
      this.renderOrbitNotice();
    });
    const demo = h('button', { class: 'btn small btn-quiet', type: 'button' }, 'SIMULATED DEMO');
    demo.addEventListener('click', async () => {
      await router.call('useSimulated');
      this.renderOrbitNotice();
      void this.refreshLive();
    });
    n.append(h('div', {}, h('p', { class: 'mono notice-title' }, 'NO ORBIT DATA'), h('p', {}, 'Stars and constellations work offline. Satellites need orbital data.')), h('div', { class: 'set-actions' }, retry, demo));
  }

  setNight(): void {
    this.view.palette.set(settings.get().nightMode);
  }

  /* ───────────── data refresh ───────────── */

  private async refreshField(): Promise<void> {
    const o = observer();
    if (!o || !this.active || !sky.loaded) return;
    const jd = Date.now() / 86_400_000 + 2440587.5;
    const sunAlt = sunAltitude(jd, o.latitude, o.longitude);
    const limit = effectiveLimit(settings.get().magnitudeFilter, limitingMagnitude(sunAlt));
    try {
      const f = await sky.field(o, Date.now(), limit);
      this.view.setField(f, o.latitude);
      this.updateStatus();
    } catch {
      /* worker not ready yet */
    }
  }

  private async refreshLive(): Promise<void> {
    const o = observer();
    if (!o || !this.active || !orbit.loadedCount) return;
    const t0 = Date.now() + 250;
    try {
      this.view.live = await orbit.live(o, t0, t0 + 1000);
    } catch {
      /* ignore */
    }
  }

  private async updateAlertPulses(): Promise<void> {
    const rules = await alertRules.list();
    this.view.alertPulseIds = new Set(rules.filter((r) => r.enabled).map((r) => r.norad_id));
  }

  /* ───────────── pointing & interaction ───────────── */

  private sensorsLive(): boolean {
    return orientation.status === 'live' && !!orientation.latest && performance.now() - orientation.latest.t < 3000;
  }

  private bindPointer(): void {
    const c = this.view.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: number } | null = null;
    let moved = false;
    let pinch0 = 0;
    let fov0 = 70;
    let zoom0 = 1;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      moved = false;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        fov0 = this.view.view.fov;
        zoom0 = this.view.map.zoom;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) this.zoom(fov0, zoom0, d / pinch0);
        moved = true;
        return;
      }
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (start && Math.hypot(cur.x - start.x, cur.y - start.y) > 6) moved = true;
      if (!moved) return;
      if (this.view.mode === 'allsky') {
        this.view.map.panX += dx;
        this.view.map.panY += dy;
      } else if (!this.view.cameraOn) {
        // drag the sky (sensor-less devices, or manual aim on phones)
        this.manualAim = true;
        const k = 1 / Math.max(0.5, this.view.proj.pxPerDeg);
        this.view.view.az = (this.view.view.az - dx * k / Math.max(0.2, Math.cos((this.view.view.el * Math.PI) / 180)) + 360) % 360;
        this.view.view.el = clamp(this.view.view.el + dy * k, -10, 89);
      }
    });
    const end = (e: PointerEvent): void => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = 0;
      if (start && !moved && performance.now() - start.t < 600) void this.tap(e.offsetX, e.offsetY);
      start = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(this.view.view.fov, this.view.map.zoom, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      this.view.map = { zoom: 1, panX: 0, panY: 0 };
    });
    // keyboard: arrows aim / pan, +/- zoom
    this.root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('button, input')) return;
      const step = e.shiftKey ? 10 : 3;
      const v = this.view.view;
      if (e.key === 'ArrowLeft') v.az = (v.az - step + 360) % 360;
      else if (e.key === 'ArrowRight') v.az = (v.az + step) % 360;
      else if (e.key === 'ArrowUp') v.el = clamp(v.el + step, -10, 89);
      else if (e.key === 'ArrowDown') v.el = clamp(v.el - step, -10, 89);
      else if (e.key === '+' || e.key === '=') this.zoom(v.fov, this.view.map.zoom, 1.2);
      else if (e.key === '-') this.zoom(v.fov, this.view.map.zoom, 1 / 1.2);
      else return;
      this.manualAim = true;
      e.preventDefault();
    });
  }

  private zoom(fov0: number, zoom0: number, factor: number): void {
    if (this.view.mode === 'allsky') this.view.map.zoom = clamp(zoom0 * factor, 1, 8);
    else if (!this.view.cameraOn) this.view.view.fov = clamp(fov0 / factor, 15, 120);
  }

  private async tap(x: number, y: number): Promise<void> {
    const hit = this.view.hitTest(x, y);
    if (hit?.kind === 'sat') return this.selectSatellite(hit.id);
    if (hit?.kind === 'star') {
      haptic('select');
      return showStar(hit.idx);
    }
    // empty sky → which constellation is this?
    const dir = this.view.unproject(x, y);
    const o = observer();
    if (!dir || !o || dir.el < -2) {
      this.clearSelection();
      return;
    }
    const [id] = await sky.lookup(o, Date.now(), [[dir.az, dir.el]]);
    if (id) {
      haptic('select');
      this.focus(id);
      void showConstellation(id, (cid) => this.focus(cid));
    }
  }

  /** Constellation focus mode: other stars and figures dim; satellites stay visible. */
  focus(id: string | null): void {
    this.view.focusId = this.view.focusId === id ? null : id;
    if (this.view.focusId) {
      this.view.layers.constellations = true;
      this.view.revealConstellations();
    }
    closeSheet('#sheet-object');
  }

  selectSatellite(id: number, centre = false): void {
    haptic('select');
    this.view.selection = { kind: 'sat', id };
    this.trajFor = -1;
    void this.refreshTrajectory(true);
    void this.refreshSelection();
    if (centre) {
      // point the view at the satellite when coming from Passes / Saved
      const s = this.view.liveSats(Date.now()).find((x) => x.id === id);
      if (s && !this.sensorsLive()) {
        const az = (Math.atan2(s.enu[0], s.enu[1]) * 180) / Math.PI;
        this.view.view.az = (az + 360) % 360;
        this.view.view.el = clamp((Math.asin(s.enu[2]) * 180) / Math.PI, 0, 85);
      }
    }
  }

  private clearSelection(): void {
    this.view.selection = null;
    this.view.trajectory = [];
    $('[data-live-selection]', this.root).hidden = true;
  }

  private async refreshTrajectory(force = false): Promise<void> {
    const sel = this.view.selection;
    const o = observer();
    if (sel?.kind !== 'sat' || !o) return;
    if (!force && this.trajFor === sel.id && Date.now() - this.trajAt < 30_000) return;
    const now = Date.now();
    const pts = await orbit.trajectory(sel.id, o, now - 5 * 60_000, now + 5 * 60_000, 10);
    this.view.trajectory = pts;
    this.view.trajectoryPulse = pts.some((p) => p.t > now && p.status === 'LIKELY_VISIBLE' && p.el > 0);
    this.trajFor = sel.id;
    this.trajAt = now;
  }

  /** Compact instrument strip for the selected satellite (live-updating). */
  private async refreshSelection(): Promise<void> {
    const sel = this.view.selection;
    const host = $('[data-live-selection]', this.root);
    if (sel?.kind !== 'sat') {
      host.hidden = true;
      return;
    }
    void this.refreshTrajectory();
    const s = this.view.liveSats(Date.now()).find((x) => x.id === sel.id);
    const name = satMeta.get(sel.id)?.name ?? `NORAD ${sel.id}`;
    clear(host);
    host.hidden = false;
    const az = s ? ((Math.atan2(s.enu[0], s.enu[1]) * 180) / Math.PI + 360) % 360 : null;
    const el = s ? (Math.asin(s.enu[2]) * 180) / Math.PI : null;
    const next = passes.nextFor(sel.id);
    const saved = !!(await savedSatellites.find(sel.id));
    const close = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Clear selection', 'data-icon': 'x' });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.clearSelection());
    const star = h('button', { class: 'strip-btn', type: 'button', 'aria-pressed': String(saved) }, saved ? '★ SAVED' : '☆ SAVE');
    star.addEventListener('click', async () => {
      const on = await savedSatellites.toggle(sel.id, name);
      toast(on ? `${name} SAVED` : `${name} REMOVED`, 'ok', 1600);
      void this.refreshSelection();
    });
    const alert = h('button', { class: 'strip-btn', type: 'button' }, 'ALERT');
    alert.addEventListener('click', () => router.call('alert', sel.id, name));
    const more = h('button', { class: 'strip-btn', type: 'button' }, 'DETAILS');
    more.addEventListener('click', () => void showSatellite(sel.id, () => closeSheet('#sheet-object')));
    host.append(
      h('div', { class: 'sel-head' }, h('span', { class: 'sel-name' }, name), close),
      h(
        'p',
        { class: 'sel-tele mono' },
        s && el !== null && az !== null
          ? `AZ ${fmtAz(az)} · EL ${el.toFixed(1)}° · ${fmtDistance(s.range, settings.get().units)}${s.mag < 9 ? ` · MAG ~${s.mag.toFixed(1)}` : ''}`
          : next
            ? `BELOW HORIZON · NEXT PASS ${new Date(next.rise.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'BELOW HORIZON',
      ),
      h('div', { class: 'sel-row' }, s ? visibilityIndicator(STATUS[s.status] ?? 'NOT_EXPECTED', true) : h('span', {}), h('div', { class: 'sel-actions' }, star, alert, more)),
    );
  }

  /* ───────────── signature: satellite + constellation context ───────────── */

  private async contextTrajectory(id: number, o: NonNullable<ReturnType<typeof observer>>): Promise<TrajectoryPoint[]> {
    const c = this.ctxTraj.get(id);
    if (c && Date.now() - c.at < 30_000) return c.pts;
    const now = Date.now();
    const pts = await orbit.trajectory(id, o, now, now + 10 * 60_000, 10);
    this.ctxTraj.set(id, { at: now, pts });
    return pts;
  }

  private async refreshContext(): Promise<void> {
    const o = observer();
    const el = $('[data-live-context]', this.root) as HTMLButtonElement;
    const d = skyDataSync();
    if (!o || !d || !this.active) return;
    // candidate: selected satellite, else the best visible one near the view, else a visible pass starting soon
    const now = Date.now();
    const sats = this.view.liveSats(now).filter((s) => s.enu[2] > 0);
    const centre = azElToVector(this.view.view.az, this.view.view.el);
    let id: number | null = this.view.selection?.kind === 'sat' ? this.view.selection.id : null;
    if (id === null) {
      const vis = sats.filter((s) => s.status >= 1).sort((a, b) => b.status - a.status || separation(a.enu, centre) - separation(b.enu, centre));
      id = vis[0]?.id ?? null;
    }
    if (id === null) {
      const soon = passes.result?.passes.find((p) => p.status !== 'NOT_EXPECTED' && (p.visibleFrom ?? p.rise.t) > now && (p.visibleFrom ?? p.rise.t) - now < 10 * 60_000);
      id = soon?.catalogId ?? null;
    }
    if (id === null) {
      el.hidden = true;
      return;
    }
    const pts = await this.contextTrajectory(id, o);
    const name = (satMeta.get(id)?.name ?? `NORAD ${id}`).replace(/\s*\(.*?\)/, '');
    const conName = (cid: string | null): string | null => (cid ? d.constellations.constellations.find((c) => c.id === cid)?.name ?? cid : null);
    const here = pts[0];
    const target = this.pattern?.id ?? null;
    let text = '';
    let key = '';
    let event = false;
    if (here && here.el > 0 && here.con) {
      text = `${name} CROSSING ${conName(here.con)!.toUpperCase()}`;
      key = `${id}:in:${here.con}`;
    } else {
      const entry = pts.find((p) => p.el > 0 && p.con && (target ? p.con === target : true));
      if (entry) {
        const secs = Math.max(0, Math.round((entry.t - now) / 1000));
        const when = secs < 90 ? `${secs} SEC` : `${Math.round(secs / 60)} MIN`;
        const vis = entry.status !== 'NOT_EXPECTED';
        if (target && entry.con === target) {
          text = `${name} CROSSING ${conName(entry.con)!.toUpperCase()}\n${vis ? 'VISIBLE' : 'ARRIVES'} IN ${when}`;
          event = vis && secs < 120;
        } else text = `${name} ENTERING ${conName(entry.con)!.toUpperCase()} IN ${when}`;
        key = `${id}:enter:${entry.con}`;
      } else if (target) {
        // passing below the constellation you're looking at
        const lv = this.view.field?.constellations.find((c) => c.id === target);
        if (lv) {
          const min = Math.min(...pts.filter((p) => p.el > 0).map((p) => separation(azElToVector(p.az, p.el), lv.enu)));
          const below = pts.some((p) => p.el > 0 && p.el < lv.alt);
          if (Number.isFinite(min) && min < 15 && below) {
            text = `${name} PASSING BELOW ${conName(target)!.toUpperCase()}`;
            key = `${id}:below:${target}`;
          }
        }
      }
    }
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.sat = String(id);
    el.textContent = '';
    const [a, b] = text.split('\n');
    el.append(h('span', { class: 'ctx-main' }, a), b ? h('span', { class: 'ctx-sub' }, b) : '');
    if (key !== this.contextKey) {
      this.contextKey = key;
      if (event) haptic('lock'); // tiny haptic pulse for the signature moment
    }
  }

  /* ───────────── pattern identification ───────────── */

  private async refreshPattern(): Promise<void> {
    const o = observer();
    const chip = $('[data-live-pattern]', this.root);
    if (!o || !sky.loaded || !this.active) return;
    const v = this.view.view;
    try {
      this.pattern = await sky.pattern(o, Date.now(), v.az, v.el, v.fov, this.sensorsLive() && !this.manualAim ? this.conf.read(orientation.latest?.compassAccuracy ?? null, !!orientation.latest?.absolute).accuracyDeg : 2);
    } catch {
      return;
    }
    const show = this.view.mode === 'pointing' && this.view.layers.constellations && !!this.pattern.id && v.el > 0;
    chip.hidden = !show;
    if (show && this.pattern.name) {
      clear(chip);
      chip.append(
        h('span', { class: 'pm-k mono' }, 'PATTERN MATCH'),
        h('span', { class: 'pm-name' }, this.pattern.name.toUpperCase()),
        h('span', { class: 'pm-level mono', 'data-level': this.pattern.level ?? '' }, this.pattern.level ?? ''),
      );
      chip.setAttribute('aria-label', `Pattern match: ${this.pattern.name}, ${this.pattern.level}. Main stars: ${this.pattern.mainStars.map((s) => s.name).join(', ')}`);
    }
    this.renderInfo();
  }

  /** Compact SKY FIELD panel: AZ / EL / RA / DEC / constellation / satellites / visible. */
  private renderInfo(): void {
    const dl = $('[data-sky-info]', this.root);
    const v = this.view.view;
    const counts = this.view.countAboveHorizon();
    const p = this.pattern;
    const dec = p ? `${p.dec >= 0 ? '+' : '−'}${Math.floor(Math.abs(p.dec))}° ${String(Math.floor((Math.abs(p.dec) % 1) * 60)).padStart(2, '0')}'` : '—';
    const rows: [string, string][] =
      this.view.mode === 'allsky'
        ? [['UTC', utcClock()], ['ABOVE', String(counts.total)], ['VISIBLE', String(counts.visible)]]
        : [
            ['AZ', fmtAz(v.az)],
            ['EL', `${v.el.toFixed(1)}°`],
            ['RA', p ? fmtHours(p.ra) : '—'],
            ['DEC', dec],
            ['CONST', p?.name?.toUpperCase() ?? '—'],
            ['SATS', String(counts.inView)],
            ['VISIBLE', String(counts.visible)],
          ];
    clear(dl);
    for (const [k, val] of rows) dl.append(h('div', {}, h('dt', {}, k), h('dd', {}, val)));
    setText($('[data-live-counts]', this.root), `${counts.total} OBJECTS ABOVE HORIZON · ${counts.visible} LIKELY VISIBLE`);
  }

  updateStatus(): void {
    const f = this.view.field;
    const d = skyDataSync();
    const online = navigator.onLine;
    setText($('[data-live-mode]', this.root), !online ? 'LOCAL SKY MODE' : this.manualAim ? 'LIVE SKY · MANUAL AIM' : 'LIVE SKY');
    const orbitAge = router.callResult<number | null>('orbitFetchedAt');
    const parts = [f?.twilight ?? '', orbitAge ? `ORBITS ${ago(orbitAge).toUpperCase()}` : '', d ? `STARS ${d.stars.version.replace('stars-', '')}` : ''];
    setText($('[data-live-status]', this.root), parts.filter(Boolean).join(' · '));
  }

  toggleView(): void {
    this.view.mode = this.view.mode === 'pointing' ? 'allsky' : 'pointing';
    this.root.dataset.view = this.view.mode;
    const b = $('[data-action="live-view"]', this.root);
    b.setAttribute('aria-pressed', String(this.view.mode === 'allsky'));
    b.setAttribute('aria-label', this.view.mode === 'allsky' ? 'Switch to pointing view' : 'Switch to all-sky map');
    if (this.view.mode === 'allsky' && this.view.cameraOn) this.toggleCamera(false);
    this.view.revealConstellations();
  }

  async toggleCamera(on = !this.view.cameraOn): Promise<void> {
    const b = $('[data-action="live-camera"]', this.root);
    if (on) {
      if (this.view.mode === 'allsky') this.toggleView();
      const ok = await camera.start();
      if (!ok) {
        toast('CAMERA UNAVAILABLE · USING THE SKY BACKGROUND', 'info');
        return;
      }
      this.view.view.fov = settings.get().arFov;
      this.manualAim = false;
    } else camera.stop();
    this.view.cameraOn = on && camera.status === 'on';
    document.body.classList.toggle('camera-on', this.view.cameraOn);
    b.setAttribute('aria-pressed', String(this.view.cameraOn));
  }

  recentre(): void {
    this.manualAim = false;
    this.view.map = { zoom: 1, panX: 0, panY: 0 };
    if (!this.sensorsLive()) toast('NO ORIENTATION SENSOR · DRAG TO AIM', 'info');
  }

  /* ───────────── frame loop ───────────── */

  private frame = (now: number): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const r = orientation.latest;
    if (r && r.t !== this.lastSensor) {
      this.lastSensor = r.t;
      this.conf.push(r.vector, now);
    }
    if (r && this.sensorsLive() && !this.manualAim && this.view.mode === 'pointing') {
      this.filter.update(r.vector, dt, now);
      const p = this.filter.azEl();
      if (p) {
        this.view.view.az = p.az;
        this.view.view.el = p.el;
      }
    }
    this.view.draw(now);
    const hd = this.heading.update(this.view.view.az, dt, 12);
    this.compass.update(hd);
    const eh = this.root.querySelector<HTMLElement>('[data-live-elev]')?.clientHeight ?? 300;
    this.elev.update(this.view.view.el, eh);
    if (now - this.lastText > 250) {
      this.lastText = now;
      this.renderInfo();
      const conf = r ? this.conf.read(r.compassAccuracy, r.absolute) : null;
      const acc = location.observer?.accuracyM;
      this.sensors.update({
        gps: location.observer ? { label: 'GPS', value: location.status === 'manual' ? 'MANUAL' : acc ? `±${Math.round(acc)}m` : 'FIX', level: location.status === 'manual' ? 2 : 3, tone: 'good' } : { label: 'GPS', value: 'OFF', level: 0, tone: 'off' },
        compass: this.sensorsLive() && conf ? { label: 'COMPASS', value: `${conf.grade} ±${conf.accuracyDeg.toFixed(0)}°`, level: conf.grade === 'GOOD' ? 3 : conf.grade === 'FAIR' ? 2 : 1, tone: conf.grade === 'GOOD' ? 'good' : conf.grade === 'FAIR' ? 'fair' : 'poor' } : { label: 'COMPASS', value: 'OFF', level: 0, tone: 'off' },
        orientation: this.sensorsLive() ? { label: 'ORIENTATION', value: this.manualAim ? 'MANUAL' : 'LIVE', level: 3, tone: 'good' } : { label: 'ORIENTATION', value: 'DRAG', level: 1, tone: 'fair' },
      });
    }
  };
}
