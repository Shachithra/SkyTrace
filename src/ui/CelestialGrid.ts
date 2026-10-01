import type { GridLine } from '../sky/celestialGrid.ts';
import type { Projector } from '../sky/skyProjection.ts';
import type { Palette } from './palette.ts';
import { rgb } from './palette.ts';

/** Faint alt-azimuth + equatorial coordinate grids. */
export function drawCelestialGrid(ctx: CanvasRenderingContext2D, proj: Projector, altaz: GridLine[], equatorial: GridLine[] | null, pal: Palette, opacity = 0.07): void {
  ctx.lineWidth = 1;
  const draw = (line: GridLine, alpha: number, dash: number[]): void => {
    ctx.strokeStyle = `rgba(${rgb(pal.grid)},${alpha * pal.brightness})`;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (const v of line.points) {
      const p = proj.project(v);
      if (!p.front || (proj.kind === 'allsky' && v[2] < -0.01)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  };
  for (const l of altaz) if (l.kind !== 'horizon') draw(l, opacity * (l.kind === 'az' && l.value % 45 === 0 ? 1.5 : 1), []);
  if (equatorial) for (const l of equatorial) draw(l, l.kind === 'equator' ? opacity * 1.6 : opacity * 0.8, [1, 4]);
  ctx.setLineDash([]);
}
