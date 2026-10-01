import { azElToVector, separation, vectorToAzEl } from '../astronomy/angularDistance.ts';
import { altAzGrid, equatorialGrid, type GridLine } from '../sky/celestialGrid.ts';
import { HorizonFrame } from '../sky/raDecToAltAz.ts';
import { AllSkyProjector, PointingProjector, type Projector, type ScreenPoint } from '../sky/skyProjection.ts';
import { drawConstellations, segmentDepths, type ConstellationDraw } from '../stars/constellationRenderer.ts';
import type { ConstellationData, StarCatalogData } from '../stars/starCatalog.ts';
import { clamp, normalize, type Vec3 } from '../utils/math.ts';
import type { LiveFrame, TrajectoryPoint } from '../workers/orbitTypes.ts';
import type { SkyField } from '../workers/skyTypes.ts';
import { drawCelestialGrid } from './CelestialGrid.ts';
import { drawHorizonArc } from './HorizonArc.ts';
import { PaletteState, rgb } from './palette.ts';
import { drawSatellite } from './SatelliteMarker.ts';
import { drawStarLabels, drawStars, type DrawnStar } from './StarRenderer.ts';
import { drawTrajectory } from './TrajectoryPath.ts';

export interface Layers {
  satellites: boolean;
  stars: boolean;
  constellations: boolean;
  labels: boolean;
  trajectories: boolean;
}

export type SatFilter = 'ALL' | 'VISIBLE' | 'STATIONS' | 'STARLINK' | 'WEATHER' | 'NAVIGATION' | 'SCIENCE';
export const SAT_FILTERS: SatFilter[] = ['ALL', 'VISIBLE', 'STATIONS', 'STARLINK', 'WEATHER', 'NAVIGATION', 'SCIENCE'];
const FILTER_GROUP: Partial<Record<SatFilter, string>> = { STATIONS: 'stations', STARLINK: 'starlink', WEATHER: 'weather', NAVIGATION: 'gnss', SCIENCE: 'science' };

export interface SatMeta {
  name: string;
  groups: string[];
}

export type Selection = { kind: 'sat'; id: number } | { kind: 'star'; idx: number } | { kind: 'con'; id: string } | null;

export interface LiveSat {
  id: number;
  enu: Vec3;
  next: Vec3;
  status: number;
  range: number;
  mag: number;
}

interface PreparedCon {
  id: string;
  name: string;
  lines: [number, number][];
  depth: number[];
  maxDepth: number;
  stars: Set<number>;
  rank: number;
}

/**
 * SkyView — the live sky renderer. One canvas, two projections:
 *  • pointing: gnomonic view that follows the phone (or drag when sensors are off)
 *  • allsky:   circular all-sky map, zenith centre, horizon edge (drag, zoom, select)
 * Layers: satellites, stars, constellations, labels, trajectories.
 */
export class SkyView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;

  mode: 'pointing' | 'allsky' = 'pointing';
  view = { az: 180, el: 45, fov: 70 };
  map = { zoom: 1, panX: 0, panY: 0 };
  /** vertical offset of the pointing centre (fraction of height) */
  centreY = 0.46;
  layers: Layers = { satellites: true, stars: true, constellations: true, labels: true, trajectories: true };
  filter: SatFilter = 'ALL';
  selection: Selection = null;
  focusId: string | null = null;
  palette = new PaletteState();
  cameraOn = false;
  reduceMotion = false;
  showEquatorial = true;
  compact = false;

  cat: StarCatalogData | null = null;
  private cons: PreparedCon[] = [];
  field: SkyField | null = null;
  private figure = new Map<number, Vec3>();
  private conLabels = new Map<string, Vec3>();
  live: LiveFrame | null = null;
  meta = new Map<number, SatMeta>();
  trajectory: TrajectoryPoint[] = [];
  trajectoryPulse = false;
  private altaz: GridLine[] = altAzGrid();
  private equatorial: GridLine[] | null = null;
  private revealStart = 0;
  private drawnStars: DrawnStar[] = [];
  private drawnSats: { id: number; x: number; y: number }[] = [];
  proj: Projector;
  alertPulseIds = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    this.ctx = ctx;
    this.proj = new PointingProjector(180, 45, 70, 1, 1);
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  setData(cat: StarCatalogData, data: ConstellationData): void {
    this.cat = cat;
    this.cons = data.constellations.map((c) => {
      const anchor = Array.from(new Set(c.lines.flat())).sort((a, b) => cat.stars[a][3] - cat.stars[b][3])[0] ?? 0;
      const { depth, max } = segmentDepths(c.lines, anchor);
      return { id: c.id, name: c.name, lines: c.lines, depth, maxDepth: max, stars: new Set(c.lines.flat()), rank: c.rank };
    });
    this.revealConstellations();
  }

  setField(f: SkyField, lat: number): void {
    this.field = f;
    this.figure.clear();
    for (let k = 0; k < f.figureIndex.length; k++) this.figure.set(f.figureIndex[k], [f.figureEnu[k * 3], f.figureEnu[k * 3 + 1], f.figureEnu[k * 3 + 2]]);
    this.conLabels = new Map(f.constellations.map((c) => [c.id, c.enu]));
    this.equatorial = equatorialGrid(new HorizonFrame(f.lst, lat));
  }

  /** Constellation reveal: stars appear, lines resolve outward from anchor stars, then names. */
  revealConstellations(): void {
    this.revealStart = performance.now();
  }

  private makeProjector(): Projector {
    if (this.mode === 'allsky') {
      const R = (Math.min(this.w, this.h) / 2 - (this.compact ? 14 : 30)) * this.map.zoom;
      return new AllSkyProjector(this.w / 2 + this.map.panX, this.h * (this.compact ? 0.5 : 0.43) + this.map.panY, R);
    }
    return new PointingProjector(this.view.az, this.view.el, this.view.fov, this.w, this.h, this.w / 2, this.h * this.centreY);
  }

  /** Interpolated live satellite positions at time τ (frames arrive ~1 Hz). */
  liveSats(now: number): LiveSat[] {
    const f = this.live;
    if (!f) return [];
    const span = Math.max(1, f.t1 - f.t0);
    const k = clamp((now - f.t0) / span, -0.5, 2.5);
    const out: LiveSat[] = [];
    for (let i = 0; i < f.ids.length; i++) {
      const d = f.data;
      const o = i * 9;
      const v0: Vec3 = [d[o], d[o + 1], d[o + 2]];
      const v1: Vec3 = [d[o + 3], d[o + 4], d[o + 5]];
      const enu = normalize([v0[0] + (v1[0] - v0[0]) * k, v0[1] + (v1[1] - v0[1]) * k, v0[2] + (v1[2] - v0[2]) * k]);
      const next = normalize([enu[0] + (v1[0] - v0[0]) * 12, enu[1] + (v1[1] - v0[1]) * 12, enu[2] + (v1[2] - v0[2]) * 12]);
      out.push({ id: f.ids[i], enu, next, status: d[o + 7], range: d[o + 6], mag: d[o + 8] });
    }
    return out;
  }

  passesFilter(s: LiveSat): boolean {
    if (s.enu[2] < 0) return false;
    if (this.filter === 'ALL') return true;
    if (this.filter === 'VISIBLE') return s.status >= 1;
    const g = FILTER_GROUP[this.filter];
    return !!g && (this.meta.get(s.id)?.groups ?? []).includes(g);
  }

  draw(now: number): void {
    const ctx = this.ctx;
    const pal = this.palette.tick(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.cameraOn && !(this.compact && this.mode === 'allsky')) {
      ctx.fillStyle = `rgb(${rgb(pal.bg)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      const g = ctx.createRadialGradient(this.w / 2, this.h * 0.35, 0, this.w / 2, this.h * 0.35, Math.max(this.w, this.h) * 0.8);
      g.addColorStop(0, `rgba(${rgb(pal.constellation)},${0.1 * pal.brightness})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    } else if (this.cameraOn) {
      // AR: keep the camera feed slightly darkened under the overlay
      ctx.fillStyle = 'rgba(2,3,6,0.28)';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    const proj = this.makeProjector();
    this.proj = proj;
    if (this.mode === 'allsky') {
      // clip to the sky disc
      const p = proj as AllSkyProjector;
      if (this.compact) {
        ctx.fillStyle = `rgba(${rgb(pal.bg)},0.9)`;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, p.R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.R + 1, 0, Math.PI * 2);
      ctx.clip();
    }
    drawCelestialGrid(ctx, proj, this.altaz, this.showEquatorial ? this.equatorial : null, pal, this.mode === 'allsky' ? 0.06 : 0.07);

    const reveal = this.reduceMotion ? 1 : clamp((now - this.revealStart) / 1600, 0, 1);
    const focus = this.focusId ? this.cons.find((c) => c.id === this.focusId) ?? null : null;

    // constellations under the stars
    if (this.layers.constellations && this.field && this.cat) {
      const items: ConstellationDraw[] = [];
      for (const c of this.cons) {
        const segments: [ScreenPoint, ScreenPoint][] = c.lines.map(([a, b]) => {
          const va = this.figure.get(a);
          const vb = this.figure.get(b);
          if (!va || !vb || (va[2] < -0.02 && vb[2] < -0.02)) return [{ x: 0, y: 0, front: false }, { x: 0, y: 0, front: false }];
          return [proj.project(va), proj.project(vb)];
        });
        if (!segments.some(([a, b]) => a.front && b.front)) continue;
        const lv = this.conLabels.get(c.id);
        items.push({
          id: c.id,
          name: c.name,
          segments,
          depth: c.depth,
          maxDepth: c.maxDepth,
          label: lv && lv[2] > 0.02 && (this.mode === 'pointing' || c.rank === 1) ? offsetLabel(proj.project(lv)) : null,
          focused: c.id === this.focusId,
        });
      }
      drawConstellations(ctx, items, { line: rgb(pal.constellation), label: rgb(pal.muted), reveal, focusId: this.focusId, showLabels: this.layers.labels });
    }

    if (this.layers.stars && this.field && this.cat) {
      const starAlpha = this.layers.constellations ? clamp(reveal / 0.25, 0, 1) : 1;
      this.drawnStars = drawStars(ctx, proj, this.field, this.cat, pal, { w: this.w, h: this.h, alpha: starAlpha, dimExcept: focus ? focus.stars : null, scale: this.mode === 'allsky' ? 0.8 : 1 });
      if (this.layers.labels) drawStarLabels(ctx, this.drawnStars, this.cat, pal, this.mode === 'allsky' ? 1.0 : this.view.fov < 40 ? 2.6 : 1.6, this.compact ? 4 : 14);
    } else this.drawnStars = [];

    drawHorizonArc(ctx, proj, this.w, this.h, pal, this.cameraOn);

    // trajectories
    if (this.layers.trajectories && this.selection?.kind === 'sat' && this.trajectory.length) {
      const phase = this.trajectoryPulse && !this.reduceMotion ? ((now % 2600) / 2600) : null;
      drawTrajectory(ctx, proj, this.trajectory, Date.now(), pal, phase);
    }

    // satellites
    this.drawnSats = [];
    if (this.layers.satellites) {
      const sats = this.liveSats(Date.now()).filter((s) => this.passesFilter(s));
      const centre = this.mode === 'pointing' ? azElToVector(this.view.az, this.view.el) : ([0, 0, 1] as Vec3);
      // labels only for the nearest few (or the selected one)
      const nearest = new Set(
        [...sats]
          .sort((a, b) => separation(a.enu, centre) - separation(b.enu, centre))
          .slice(0, this.compact ? 1 : 3)
          .map((s) => s.id),
      );
      for (const s of sats) {
        const p = proj.project(s.enu);
        if (!p.front || p.x < -10 || p.y < -10 || p.x > this.w + 10 || p.y > this.h + 10) continue;
        const selected = this.selection?.kind === 'sat' && this.selection.id === s.id;
        if (this.layers.trajectories && !selected) {
          // short tail for every satellite (live trajectory hint)
          const tail = proj.project(normalize([s.enu[0] * 2 - s.next[0], s.enu[1] * 2 - s.next[1], s.enu[2] * 2 - s.next[2]]));
          if (tail.front) {
            const g = ctx.createLinearGradient(tail.x, tail.y, p.x, p.y);
            g.addColorStop(0, `rgba(${rgb(pal.satellite)},0)`);
            g.addColorStop(1, `rgba(${rgb(pal.satellite)},${0.35 * pal.brightness})`);
            ctx.strokeStyle = g;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(tail.x, tail.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        }
        const nx = proj.project(s.next);
        const dir = nx.front ? { x: clamp(nx.x - p.x, -22, 22), y: clamp(nx.y - p.y, -22, 22) } : null;
        const name = this.meta.get(s.id)?.name ?? String(s.id);
        const pulse = this.alertPulseIds.has(s.id) && !this.reduceMotion ? (now % 1800) / 1800 : 0;
        drawSatellite(ctx, p, { status: s.status, selected, label: this.layers.labels && (selected || nearest.has(s.id)) ? shortName(name) : null, dir, pulse }, pal);
        this.drawnSats.push({ id: s.id, x: p.x, y: p.y });
      }
    }

    if (this.mode === 'allsky') ctx.restore();
  }

  /** Hit test: satellites first, then stars; null means "empty sky" (constellation lookup). */
  hitTest(x: number, y: number): Selection {
    let best: Selection = null;
    let bd = 24;
    for (const s of this.drawnSats) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) [bd, best] = [d, { kind: 'sat', id: s.id }];
    }
    if (best) return best;
    bd = 18;
    for (const s of this.drawnStars) {
      const d = Math.hypot(s.x - x, s.y - y) + s.mag * 1.5;
      if (d < bd) [bd, best] = [d, { kind: 'star', idx: s.idx }];
    }
    return best;
  }

  /** Screen → sky direction (az/el), for constellation lookups on tap. */
  unproject(x: number, y: number): { az: number; el: number } | null {
    const v = this.proj.unproject(x, y);
    return v ? vectorToAzEl(v) : null;
  }

  /** Project an az/el for overlays (e.g. the context line anchor). */
  projectAzEl(az: number, el: number): ScreenPoint {
    return this.proj.project(azElToVector(az, el));
  }

  countAboveHorizon(): { total: number; visible: number; inView: number } {
    const sats = this.liveSats(Date.now()).filter((s) => s.enu[2] > 0);
    return { total: sats.length, visible: sats.filter((s) => s.status === 2).length, inView: this.drawnSats.length };
  }
}

function offsetLabel(p: ScreenPoint): ScreenPoint {
  return { ...p, y: p.y + 14 };
}

function shortName(n: string): string {
  const s = n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}
