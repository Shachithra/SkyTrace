import type { Projector } from '../sky/skyProjection.ts';
import { azElToVector } from '../astronomy/angularDistance.ts';
import type { TrajectoryPoint } from '../workers/orbitTypes.ts';
import type { Palette } from './palette.ts';
import { rgb } from './palette.ts';

/**
 * Selected-satellite trajectory: past path at low opacity, future path slightly
 * brighter, and — for a likely-visible pass — a subtle pulse travelling along it.
 * Preview span: −5 min … NOW … +5 min.
 */
export function drawTrajectory(ctx: CanvasRenderingContext2D, proj: Projector, pts: TrajectoryPoint[], now: number, pal: Palette, pulsePhase: number | null): void {
  if (pts.length < 2) return;
  const sp = pts.map((p) => ({ ...proj.project(azElToVector(p.az, p.el)), t: p.t, el: p.el, status: p.status }));
  const seg = (from: number, to: number, alpha: number, dash: number[]): void => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = `rgba(${rgb(pal.satellite)},${alpha * pal.brightness})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let pen = false;
    for (let i = from; i <= to; i++) {
      const p = sp[i];
      if (!p.front || p.el < -1) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  };
  let split = sp.findIndex((p) => p.t >= now);
  if (split < 0) split = sp.length - 1;
  seg(0, Math.max(0, split), 0.28, [2, 3]); // past
  seg(Math.max(0, split - 1), sp.length - 1, 0.7, []); // future
  ctx.setLineDash([]);
  // time ticks at −5 / +5 min ends
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.fillStyle = `rgba(${rgb(pal.muted)},${0.8 * pal.brightness})`;
  const first = sp[0];
  const last = sp[sp.length - 1];
  if (first.front && first.el > 0) ctx.fillText('−5 MIN', first.x + 4, first.y + 10);
  if (last.front && last.el > 0) ctx.fillText('+5 MIN', last.x + 4, last.y + 10);
  if (pulsePhase !== null) {
    // pulse travels through the future part of the trajectory
    const fut = sp.slice(split);
    if (fut.length > 1) {
      const k = pulsePhase * (fut.length - 1);
      const i = Math.floor(k);
      const f = k - i;
      const a = fut[i];
      const b = fut[Math.min(fut.length - 1, i + 1)];
      if (a.front && b.front) {
        const x = a.x + (b.x - a.x) * f;
        const y = a.y + (b.y - a.y) * f;
        ctx.fillStyle = `rgba(${rgb(pal.visible)},${0.75 * (1 - pulsePhase * 0.6) * pal.brightness})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
