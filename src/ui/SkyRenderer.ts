import { azElToVector } from '../astronomy/angularDistance.ts';
import type { PathPoint } from '../astronomy/types.ts';
import { DEG, compass8 } from '../utils/degrees.ts';
import { localClock } from '../utils/format.ts';
import { clamp, cross, dot, type Vec3 } from '../utils/math.ts';

export interface GhostPath {
  id: string;
  path: PathPoint[];
  highlight: boolean;
}

export interface ReplayDraw {
  path: PathPoint[];
  /** 0–1 share of the path already drawn (draw-in transition). */
  drawIn: number;
  /** Current replay time (ms epoch). */
  time: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  depth: number;
  tw: number;
  phase: number;
}

interface Sweep {
  angle: number;
  bend: number;
  born: number;
  dur: number;
}

const COLORS = {
  star: '238,244,250',
  cyan: '112,215,255',
  amber: '255,202,115',
};

/**
 * Canvas renderer for the scanner's sky: procedural stars (with 2–8 px parallax),
 * a true alt-azimuth coordinate grid in gnomonic projection around the pointing
 * direction, the horizon glow, scanning sweeps, crossing paths and replay.
 * DOM is reserved for labels, buttons and telemetry.
 */
export class SkyRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;

  mode: 'ambient' | 'scanner' = 'ambient';
  center = { az: 0, el: 30 };
  radiusDeg = 6;
  ringPx = 90;
  cyFrac = 0.42;
  cxShift = 0;
  gridVisible = true;
  starIntensity = 0.7;
  cameraOn = false;
  reduceMotion = false;
  dim = 0;
  scanning = false;
  ghosts: GhostPath[] = [];
  replay: ReplayDraw | null = null;
  /** Pointing-driven parallax target in px (clamped to ±8). */
  parallaxTarget = { x: 0, y: 0 };

  private parallax = { x: 0, y: 0 };
  private stars: Star[] = [];
  private starLayer: HTMLCanvasElement | null = null;
  private twinklers: Star[] = [];
  private sweeps: Sweep[] = [];
  private lastSweep = 0;
  private pulseStart = 0;
  private f: Vec3 = [0, 1, 0];
  private r: Vec3 = [1, 0, 0];
  private u: Vec3 = [0, 0, 1];
  private focal = 1;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.buildStars();
  }

  get cx(): number {
    return this.w / 2 + this.cxShift;
  }
  get cy(): number {
    return this.h * this.cyFrac;
  }

  private buildStars(): void {
    // Seeded so the star field is the same on every launch.
    let seed = 1337;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const count = Math.round(clamp((this.w * this.h) / 2600, 120, 520));
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const bright = rnd() > 0.93;
      this.stars.push({
        x: rnd() * (this.w + 20) - 10,
        y: rnd() * (this.h + 20) - 10,
        r: bright ? 0.8 + rnd() * 0.6 : 0.35 + rnd() * 0.5,
        a: bright ? 0.55 + rnd() * 0.35 : 0.12 + rnd() * 0.38,
        depth: 0.35 + rnd() * 0.65,
        tw: rnd() < 0.05 ? 0.08 + rnd() * 0.18 : 0, // only a few stars, low frequency
        phase: rnd() * Math.PI * 2,
      });
    }
    this.twinklers = this.stars.filter((s) => s.tw > 0);
    const layer = document.createElement('canvas');
    layer.width = Math.round((this.w + 20) * this.dpr);
    layer.height = Math.round((this.h + 20) * this.dpr);
    const c = layer.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    for (const s of this.stars) {
      if (s.tw) continue;
      c.fillStyle = `rgba(${COLORS.star},${s.a})`;
      c.beginPath();
      c.arc(s.x + 10, s.y + 10, s.r, 0, Math.PI * 2);
      c.fill();
    }
    this.starLayer = layer;
  }

  /** Update the projection basis for the current view centre. */
  private basis(): void {
    const az = this.center.az * DEG;
    this.f = azElToVector(this.center.az, this.center.el);
    this.r = [Math.cos(az), -Math.sin(az), 0];
    this.u = cross(this.r, this.f);
    this.focal = this.ringPx / Math.tan(Math.max(0.5, this.radiusDeg) * DEG);
  }

  /** Gnomonic projection of a sky position into screen pixels. */
  project(az: number, el: number): { x: number; y: number; front: boolean } {
    const p = azElToVector(az, el);
    return this.projectVec(p);
  }

  private projectVec(p: Vec3): { x: number; y: number; front: boolean } {
    const z = dot(p, this.f);
    if (z <= 0.05) return { x: 0, y: 0, front: false };
    return {
      x: this.cx + (dot(p, this.r) / z) * this.focal,
      y: this.cy - (dot(p, this.u) / z) * this.focal,
      front: true,
    };
  }

  /** Pixels per degree near the centre of view. */
  get pxPerDeg(): number {
    return this.focal * DEG;
  }

  startScanSweeps(now: number): void {
    this.scanning = true;
    this.pulseStart = now;
    this.lastSweep = 0;
  }
  stopScanSweeps(): void {
    this.scanning = false;
  }

  draw(now: number, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // Parallax eases toward its target; disabled for reduced motion.
    const k = 1 - Math.exp(-4 * dt);
    const tx = this.reduceMotion ? 0 : this.parallaxTarget.x;
    const ty = this.reduceMotion ? 0 : this.parallaxTarget.y;
    this.parallax.x += (tx - this.parallax.x) * k;
    this.parallax.y += (ty - this.parallax.y) * k;

    this.drawBackground(ctx);
    this.drawStars(ctx, now);
    if (this.mode === 'scanner') {
      this.basis();
      if (this.gridVisible) {
        this.drawGrid(ctx);
        this.drawHorizon(ctx);
      }
      this.drawGhosts(ctx);
      if (this.scanning) this.drawScan(ctx, now);
      if (this.replay) this.drawReplay(ctx, this.replay);
    } else {
      this.drawAmbientHorizon(ctx);
    }
    if (this.dim > 0) {
      ctx.fillStyle = `rgba(5,7,11,${this.dim * 0.45})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    if (!this.cameraOn) {
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // Extremely subtle radial luminance — depth without colourful blobs.
    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.32, 0, this.w * 0.5, this.h * 0.32, Math.max(this.w, this.h) * 0.8);
    g.addColorStop(0, this.cameraOn ? 'rgba(16,23,33,0.10)' : 'rgba(18,27,40,0.55)');
    g.addColorStop(0.55, 'rgba(9,13,20,0.18)');
    g.addColorStop(1, this.cameraOn ? 'rgba(5,7,11,0.55)' : 'rgba(5,7,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawStars(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.starLayer || this.starIntensity <= 0) return;
    const alpha = this.starIntensity * (this.cameraOn ? 0.45 : 1);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.starLayer, -10 + this.parallax.x, -10 + this.parallax.y, this.w + 20, this.h + 20);
    for (const s of this.twinklers) {
      const tw = this.reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(now * 0.001 * s.tw * Math.PI * 2 + s.phase);
      ctx.fillStyle = `rgba(${COLORS.star},${s.a * tw})`;
      ctx.beginPath();
      ctx.arc(s.x + this.parallax.x * s.depth, s.y + this.parallax.y * s.depth, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private gridAlpha(): number {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-opacity')) || 0.08;
    return v;
  }

  private cachedGridAlpha = -1;
  private polyline(ctx: CanvasRenderingContext2D, pts: Vec3[]): void {
    let pen = false;
    ctx.beginPath();
    for (const p of pts) {
      const z = dot(p, this.f);
      if (z < 0.3) {
        pen = false;
        continue;
      }
      const x = this.cx + (dot(p, this.r) / z) * this.focal;
      const y = this.cy - (dot(p, this.u) / z) * this.focal;
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }

  /** Faint celestial coordinate grid: altitude circles every 15°, azimuth lines every 15°. */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    if (this.cachedGridAlpha < 0) this.cachedGridAlpha = this.gridAlpha();
    const a = this.cachedGridAlpha;
    ctx.lineWidth = 1;
    // Altitude circles
    for (let el = 15; el <= 75; el += 15) {
      const pts: Vec3[] = [];
      for (let az = 0; az <= 360; az += 2) pts.push(azElToVector(az, el));
      ctx.strokeStyle = `rgba(${COLORS.star},${a})`;
      this.polyline(ctx, pts);
    }
    // Azimuth meridians
    for (let az = 0; az < 360; az += 15) {
      const pts: Vec3[] = [];
      for (let el = -10; el <= 88; el += 2) pts.push(azElToVector(az, el));
      ctx.strokeStyle = `rgba(${COLORS.star},${az % 45 === 0 ? a * 1.6 : a})`;
      this.polyline(ctx, pts);
    }
    // Labels: altitude values along the centre meridian, cardinal points on the horizon.
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${COLORS.star},${Math.min(0.5, a * 4)})`;
    for (let el = 15; el <= 75; el += 15) {
      const p = this.project(this.center.az + 0.0, el);
      if (p.front && Math.abs(p.y - this.cy) > this.ringPx + 12 && p.y > 40 && p.y < this.h - 40) ctx.fillText(`${el}°`, p.x + 6, p.y - 6);
    }
  }

  /** The horizon projects to a straight horizontal line in this projection. */
  private drawHorizon(ctx: CanvasRenderingContext2D): void {
    const el0 = this.center.el;
    if (el0 >= 80) return;
    const y = this.cy + Math.tan(el0 * DEG) * this.focal;
    if (y > this.h + 80) return;
    const glow = ctx.createLinearGradient(0, y - 90, 0, y);
    glow.addColorStop(0, 'rgba(112,160,200,0)');
    glow.addColorStop(1, 'rgba(112,160,200,0.10)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - 90, this.w, 90);
    if (y < this.h) {
      ctx.fillStyle = this.cameraOn ? 'rgba(5,7,11,0.25)' : 'rgba(3,4,7,0.72)';
      ctx.fillRect(0, y, this.w, this.h - y);
    }
    ctx.strokeStyle = 'rgba(238,244,250,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.w, y);
    ctx.stroke();
    // cardinal labels along the horizon
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let az = 0; az < 360; az += 45) {
      const p = this.project(az, 0);
      if (!p.front || p.x < 12 || p.x > this.w - 12) continue;
      ctx.fillStyle = az === 0 ? 'rgba(255,202,115,0.8)' : 'rgba(238,244,250,0.55)';
      ctx.fillText(compass8(az), p.x, y + 6);
    }
  }

  private drawAmbientHorizon(ctx: CanvasRenderingContext2D): void {
    // slight atmospheric glow rising from the bottom edge
    const top = this.h * 0.78 + this.parallax.y;
    const glow = ctx.createLinearGradient(0, top, 0, this.h);
    glow.addColorStop(0, 'rgba(112,160,200,0)');
    glow.addColorStop(1, 'rgba(112,160,200,0.075)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, top, this.w, this.h - top);
  }

  private pathPoints(path: PathPoint[], upto = 1): { x: number; y: number; front: boolean }[] {
    const n = Math.max(2, Math.ceil(path.length * upto));
    return path.slice(0, n).map((p) => this.project(p.az, p.el));
  }

  private strokePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number; front: boolean }[]): void {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p.front) {
        pen = false;
        continue;
      }
      if (!pen) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  }

  /** Paths of traced crossings: the orbital path visibly intersects the reticle. */
  private drawGhosts(ctx: CanvasRenderingContext2D): void {
    if (!this.ghosts.length || this.replay) return;
    for (const g of this.ghosts) {
      ctx.lineWidth = g.highlight ? 1.4 : 1;
      ctx.strokeStyle = g.highlight ? `rgba(${COLORS.cyan},0.85)` : 'rgba(238,244,250,0.22)';
      this.strokePath(ctx, this.pathPoints(g.path));
      if (g.highlight) {
        const last = this.project(g.path[g.path.length - 1].az, g.path[g.path.length - 1].el);
        const prev = this.project(g.path[g.path.length - 2].az, g.path[g.path.length - 2].el);
        if (last.front && prev.front) this.arrow(ctx, prev, last, `rgba(${COLORS.cyan},0.85)`);
      }
    }
  }

  private arrow(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string): void {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 7 * Math.cos(ang - 0.4), b.y - 7 * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - 7 * Math.cos(ang + 0.4), b.y - 7 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  /** Scanning: concentric pulse from the field ring plus thin orbital arcs sweeping through the target. */
  private drawScan(ctx: CanvasRenderingContext2D, now: number): void {
    const cx = this.cx;
    const cy = this.cy;
    // concentric pulse
    const period = 1100;
    for (let i = 0; i < 2; i++) {
      const t = (((now - this.pulseStart) / period + i * 0.5) % 1 + 1) % 1;
      const r = this.ringPx * (1 + t * 1.3);
      ctx.strokeStyle = `rgba(${COLORS.amber},${0.35 * (1 - t)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.reduceMotion) return;
    // orbital sweeps
    if (now - this.lastSweep > 320) {
      this.lastSweep = now;
      this.sweeps.push({ angle: Math.random() * Math.PI, bend: (Math.random() - 0.5) * 0.9, born: now, dur: 900 + Math.random() * 500 });
    }
    const span = Math.hypot(this.w, this.h) * 0.6;
    this.sweeps = this.sweeps.filter((s) => now - s.born < s.dur + 400);
    for (const s of this.sweeps) {
      const t = clamp((now - s.born) / s.dur, 0, 1);
      const fade = 1 - clamp((now - s.born - s.dur) / 400, 0, 1);
      const dx = Math.cos(s.angle);
      const dy = Math.sin(s.angle);
      const nx = -dy;
      const ny = dx;
      const x0 = cx - dx * span;
      const y0 = cy - dy * span;
      const x1 = cx + dx * span;
      const y1 = cy + dy * span;
      // control point offset gives a gentle orbital curvature through the target
      const qx = cx + nx * s.bend * this.ringPx;
      const qy = cy + ny * s.bend * this.ringPx;
      ctx.strokeStyle = `rgba(${COLORS.star},${0.18 * fade})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      const steps = 40;
      const endStep = Math.round(steps * t);
      for (let i = 0; i <= endStep; i++) {
        const u = i / steps;
        const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * qx + u * u * x1;
        const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * qy + u * u * y1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (t < 1) {
        const u = t;
        const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * qx + u * u * x1;
        const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * qy + u * u * y1;
        ctx.fillStyle = `rgba(${COLORS.cyan},0.9)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawReplay(ctx: CanvasRenderingContext2D, rp: ReplayDraw): void {
    const pts = this.pathPoints(rp.path, rp.drawIn);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(238,244,250,0.30)';
    ctx.setLineDash([2, 4]);
    this.strokePath(ctx, pts);
    ctx.setLineDash([]);

    const t0 = rp.path[0].t;
    const t1 = rp.path[rp.path.length - 1].t;
    // endpoint time labels
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(238,244,250,0.6)';
    ctx.textBaseline = 'bottom';
    const a = this.project(rp.path[0].az, rp.path[0].el);
    const b = this.project(rp.path[rp.path.length - 1].az, rp.path[rp.path.length - 1].el);
    if (a.front && rp.drawIn > 0.05) {
      ctx.textAlign = 'center';
      ctx.fillText(localClock(t0, true), clamp(a.x, 40, this.w - 76), clamp(a.y - 8, 20, this.h - 20));
    }
    if (b.front && rp.drawIn >= 1) {
      ctx.textAlign = 'center';
      ctx.fillText(localClock(t1, true), clamp(b.x, 40, this.w - 76), clamp(b.y - 8, 20, this.h - 20));
    }
    if (rp.drawIn < 1) return;

    // travelled portion + faint fading trail + satellite dot
    const idx = this.indexAt(rp.path, rp.time);
    const travelled = rp.path.slice(0, idx.i + 1);
    const cur = this.interp(rp.path, idx);
    travelled.push(cur);
    const tp = travelled.map((p) => this.project(p.az, p.el));
    for (let i = 1; i < tp.length; i++) {
      if (!tp[i].front || !tp[i - 1].front) continue;
      const age = (tp.length - i) / Math.max(8, tp.length * 0.45);
      const alpha = clamp(1 - age, 0.12, 0.9);
      ctx.strokeStyle = `rgba(${COLORS.amber},${alpha})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(tp[i - 1].x, tp[i - 1].y);
      ctx.lineTo(tp[i].x, tp[i].y);
      ctx.stroke();
    }
    const c = this.project(cur.az, cur.el);
    if (c.front) {
      ctx.fillStyle = `rgba(${COLORS.amber},0.18)`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${COLORS.amber})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private indexAt(path: PathPoint[], t: number): { i: number; f: number } {
    if (t <= path[0].t) return { i: 0, f: 0 };
    for (let i = 0; i < path.length - 1; i++) {
      if (t <= path[i + 1].t) return { i, f: (t - path[i].t) / Math.max(1, path[i + 1].t - path[i].t) };
    }
    return { i: path.length - 1, f: 0 };
  }

  private interp(path: PathPoint[], idx: { i: number; f: number }): PathPoint {
    const a = path[idx.i];
    const b = path[Math.min(path.length - 1, idx.i + 1)];
    // interpolate on the sphere via vectors to avoid azimuth wrap
    const va = azElToVector(a.az, a.el);
    const vb = azElToVector(b.az, b.el);
    const v: Vec3 = [va[0] + (vb[0] - va[0]) * idx.f, va[1] + (vb[1] - va[1]) * idx.f, va[2] + (vb[2] - va[2]) * idx.f];
    const n = Math.hypot(v[0], v[1], v[2]);
    const el = Math.asin(v[2] / n) / DEG;
    let az = Math.atan2(v[0], v[1]) / DEG;
    if (az < 0) az += 360;
    return { t: a.t + (b.t - a.t) * idx.f, az, el };
  }

  invalidateTheme(): void {
    this.cachedGridAlpha = -1;
  }
}
