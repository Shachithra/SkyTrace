import { DEG, compass8 } from '../utils/degrees.ts';
import type { AllSkyProjector, Projector } from '../sky/skyProjection.ts';
import { azElToVector } from '../astronomy/angularDistance.ts';
import type { Palette } from './palette.ts';
import { rgb } from './palette.ts';

/** Horizon with atmospheric glow and cardinal markers; ground below is shaded. */
export function drawHorizonArc(ctx: CanvasRenderingContext2D, proj: Projector, w: number, h: number, pal: Palette, cameraOn: boolean): void {
  if (proj.kind === 'allsky') return drawAllSkyHorizon(ctx, proj as AllSkyProjector, pal);
  // In the gnomonic view the horizon is a great circle → sample and draw a polyline.
  const pts: { x: number; y: number }[] = [];
  for (let az = 0; az <= 360; az += 2) {
    const p = proj.project(azElToVector(az, 0));
    if (p.front) pts.push(p);
  }
  if (pts.length < 2) return;
  pts.sort((a, b) => a.x - b.x);
  const y0 = pts[0].y;
  // ground
  ctx.fillStyle = cameraOn ? `rgba(${rgb(pal.ground)},0.25)` : `rgba(${rgb(pal.ground)},0.78)`;
  ctx.beginPath();
  ctx.moveTo(-10, y0);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(w + 10, pts[pts.length - 1].y);
  ctx.lineTo(w + 10, h + 10);
  ctx.lineTo(-10, h + 10);
  ctx.closePath();
  ctx.fill();
  // glow above the horizon
  const midY = pts[Math.floor(pts.length / 2)].y;
  const g = ctx.createLinearGradient(0, midY - 90, 0, midY);
  g.addColorStop(0, `rgba(${rgb(pal.constellation)},0)`);
  g.addColorStop(1, `rgba(${rgb(pal.constellation)},${0.12 * pal.brightness})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, midY - 90, w, 90);
  ctx.strokeStyle = `rgba(${rgb(pal.text)},${0.32 * pal.brightness})`;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let az = 0; az < 360; az += 45) {
    const p = proj.project(azElToVector(az, 0));
    if (!p.front || p.x < 10 || p.x > w - 10) continue;
    ctx.fillStyle = az === 0 ? `rgba(${rgb(pal.solar)},${0.85 * pal.brightness})` : `rgba(${rgb(pal.text)},${0.55 * pal.brightness})`;
    ctx.fillText(compass8(az), p.x, p.y + 6);
  }
}

function drawAllSkyHorizon(ctx: CanvasRenderingContext2D, p: AllSkyProjector, pal: Palette): void {
  ctx.strokeStyle = `rgba(${rgb(pal.text)},${0.38 * pal.brightness})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.R, 0, Math.PI * 2);
  ctx.stroke();
  // altitude rings
  ctx.strokeStyle = `rgba(${rgb(pal.grid)},${0.08 * pal.brightness})`;
  for (const alt of [30, 60]) {
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R * Math.tan(((90 - alt) * DEG) / 2), 0, Math.PI * 2);
    ctx.stroke();
  }
  // azimuth ticks + N E S W (east on the left when looking up)
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 10) {
    const a = p.project(azElToVector(az, 0));
    const b = p.project(azElToVector(az, az % 90 === 0 ? 4 : 1.5));
    ctx.strokeStyle = `rgba(${rgb(pal.text)},${0.35 * pal.brightness})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const [az, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) {
    const v = azElToVector(az, 0);
    const q = p.project(v);
    const dx = q.x - p.cx;
    const dy = q.y - p.cy;
    const n = Math.hypot(dx, dy) || 1;
    ctx.fillStyle = l === 'N' ? `rgba(${rgb(pal.solar)},${0.9 * pal.brightness})` : `rgba(${rgb(pal.text)},${0.7 * pal.brightness})`;
    ctx.fillText(l, p.cx + (dx / n) * (p.R + 14), p.cy + (dy / n) * (p.R + 14));
  }
}
