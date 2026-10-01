import { observer, orbit, passes, satMeta, sky, skyDatasets } from '../app/services.ts';
import { router } from '../app/router.ts';
import { settings, prefersReducedMotion } from '../data/settings.ts';
import { limitingMagnitude, sunAltitude, twilightState } from '../sky/horizon.ts';
import { effectiveLimit } from '../stars/visibility.ts';
import { inTime, localClock } from '../utils/format.ts';
import { $, clear, h, setText } from '../ui/dom.ts';
import { SkyView } from '../ui/SkyView.ts';
import { visibilityIndicator } from '../ui/VisibilityIndicator.ts';

/**
 * V2 home: one dominant all-sky view of the sky above you right now, the next
 * visible pass, and OPEN LIVE SKY. Not a dashboard.
 */
export class HomeScreen {
  readonly root = $('#screen-home2');
  private view: SkyView;
  private active = false;
  private raf = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor() {
    this.view = new SkyView($<HTMLCanvasElement>('[data-home-canvas]', this.root));
    this.view.mode = 'allsky';
    this.view.compact = true;
    this.view.meta = satMeta;
    this.view.layers = { satellites: true, stars: true, constellations: true, labels: true, trajectories: true };
    this.view.canvas.addEventListener('click', () => router.go('live'));
    passes.onChange(() => this.renderNext());
  }

  async open(): Promise<void> {
    this.active = true;
    this.view.resize();
    this.view.reduceMotion = prefersReducedMotion();
    this.view.palette.set(settings.get().nightMode, true);
    const d = await skyDatasets();
    if (d && !this.view.cat) this.view.setData(d.stars, d.constellations);
    void this.tick(true);
    this.timers = [setInterval(() => void this.tick(false), 2000)];
    this.renderNext();
    void passes.next24h().then(() => this.renderNext());
    const loop = (t: number): void => {
      if (!this.active) return;
      this.view.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearInterval);
  }

  private fieldAt = 0;
  private async tick(force: boolean): Promise<void> {
    const o = observer();
    if (!o) {
      setText($('[data-home-caption]', this.root), 'SET YOUR LOCATION TO SEE YOUR SKY');
      return;
    }
    const jd = Date.now() / 86_400_000 + 2440587.5;
    const sunAlt = sunAltitude(jd, o.latitude, o.longitude);
    if (sky.loaded && (force || Date.now() - this.fieldAt > 30_000)) {
      this.fieldAt = Date.now();
      try {
        this.view.setField(await sky.field(o, Date.now(), effectiveLimit(settings.get().magnitudeFilter, limitingMagnitude(sunAlt))), o.latitude);
      } catch {
        /* not ready */
      }
    }
    if (orbit.loadedCount) {
      const t0 = Date.now() + 200;
      this.view.live = await orbit.live(o, t0, t0 + 2000).catch(() => null);
    }
    const c = this.view.countAboveHorizon();
    setText($('[data-home-caption]', this.root), `${c.total} OBJECTS ABOVE HORIZON · ${c.visible} LIKELY VISIBLE · ${twilightState(sunAlt)}`);
    setText($('[data-home-status]', this.root), navigator.onLine ? 'KNOW WHAT IS ABOVE YOU' : 'LOCAL SKY MODE');
  }

  private renderNext(): void {
    const host = $('[data-home-next]', this.root);
    clear(host);
    const now = Date.now();
    const list = passes.result?.passes.filter((p) => p.set.t > now) ?? [];
    const p = list.find((x) => x.status === 'LIKELY_VISIBLE') ?? list.find((x) => x.status === 'POSSIBLY_VISIBLE');
    host.append(h('p', { class: 'label' }, 'NEXT VISIBLE PASS'));
    if (!p) {
      const msg = !observer() ? 'Location needed for pass predictions.' : !orbit.loadedCount ? 'No orbital data loaded yet. Open Live Sky to retry or run the labelled demo.' : passes.result ? 'No visible passes predicted in the next 24 hours for the loaded datasets.' : 'Predicting passes…';
      host.append(h('p', { class: 'set-help' }, msg));
      return;
    }
    const t = p.visibleFrom ?? p.rise.t;
    const btn = h(
      'button',
      { class: 'next-pass', type: 'button', 'aria-label': `${p.name} at ${localClock(t)}, open in live sky` },
      h('span', { class: 'np-name' }, p.name),
      h('span', { class: 'np-time mono' }, localClock(t), h('small', {}, ` ${inTime(t, now).toUpperCase()}`)),
      h('span', { class: 'np-meta mono' }, `${p.directionLabel} · MAX EL ${Math.round(p.max.el)}°`),
      visibilityIndicator(p.status),
    );
    btn.addEventListener('click', () => router.go('live', { focusSatellite: p.catalogId }));
    host.append(btn);
  }
}
