import type { ScreenPoint } from '../sky/skyProjection.ts';
import type { Palette } from './palette.ts';
import { rgb } from './palette.ts';

export interface SatMarkerStyle {
  status: number; // 0 not expected, 1 possibly, 2 likely visible
  selected: boolean;
  label: string | null;
  /** screen-space direction of motion (px), drawn as a short vector */
  dir: { x: number; y: number } | null;
  pulse: number; // 0..1, for alert/visible-pass emphasis
}

/** Satellite marker: small dot, optional short label, direction vector. */
export function drawSatellite(ctx: CanvasRenderingContext2D, p: ScreenPoint, st: SatMarkerStyle, pal: Palette): void {
  const col = st.status === 2 ? pal.visible : pal.satellite;
  const a = (st.status === 0 ? 0.55 : 0.95) * pal.brightness;
  if (st.dir) {
    ctx.strokeStyle = `rgba(${rgb(col)},${a * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + st.dir.x, p.y + st.dir.y);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(${rgb(col)},${a})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, st.selected ? 3.6 : st.status ? 2.4 : 1.8, 0, Math.PI * 2);
  ctx.fill();
  if (st.status === 1 || st.selected) {
    ctx.strokeStyle = `rgba(${rgb(col)},${st.selected ? 0.9 : 0.45})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, st.selected ? 8 : 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (st.pulse > 0) {
    ctx.strokeStyle = `rgba(${rgb(col)},${0.5 * (1 - st.pulse)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 + st.pulse * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (st.label) {
    ctx.font = `${st.selected ? 500 : 400} 10px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${rgb(st.selected ? col : pal.text)},${0.9 * pal.brightness})`;
    ctx.fillText(st.label, p.x + 9, p.y - 8);
  }
}
