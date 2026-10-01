import type { Projector } from '../sky/skyProjection.ts';
import type { StarCatalogData } from '../stars/starCatalog.ts';
import { starLabel } from '../stars/starCatalog.ts';
import { starAlpha, starRadius, starTint } from '../stars/visibility.ts';
import type { SkyField } from '../workers/skyTypes.ts';
import type { Palette } from './palette.ts';
import { rgb } from './palette.ts';

export interface DrawnStar {
  idx: number;
  x: number;
  y: number;
  mag: number;
}

/**
 * Real stars at real positions. Size and brightness follow magnitude; only stars
 * inside the current view and above the magnitude limit are drawn.
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  proj: Projector,
  field: SkyField,
  cat: StarCatalogData,
  pal: Palette,
  opts: { w: number; h: number; alpha: number; dimExcept?: Set<number> | null; scale?: number },
): DrawnStar[] {
  const drawn: DrawnStar[] = [];
  const { index, enu } = field;
  const scale = opts.scale ?? 1;
  for (let k = 0; k < index.length; k++) {
    const p = proj.project([enu[k * 3], enu[k * 3 + 1], enu[k * 3 + 2]]);
    if (!p.front || p.x < -4 || p.y < -4 || p.x > opts.w + 4 || p.y > opts.h + 4) continue;
    const i = index[k];
    const s = cat.stars[i];
    const mag = s[3];
    const r = starRadius(mag, scale);
    let a = starAlpha(mag, field.limitMag) * opts.alpha * pal.brightness;
    if (opts.dimExcept && !opts.dimExcept.has(i)) a *= 0.45;
    const t = starTint(s[4]);
    const c = pal.tint > 0.5 ? `${t[0]},${t[1]},${t[2]}` : rgb(pal.star);
    ctx.fillStyle = `rgba(${c},${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    drawn.push({ idx: i, x: p.x, y: p.y, mag });
  }
  return drawn;
}

/** Labels for the brightest named stars in view (never every star). */
export function drawStarLabels(ctx: CanvasRenderingContext2D, drawn: DrawnStar[], cat: StarCatalogData, pal: Palette, maxMag: number, limit = 14): void {
  ctx.font = '9.5px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(${rgb(pal.muted)},${0.85 * pal.brightness})`;
  let n = 0;
  for (const d of drawn) {
    if (d.mag > maxMag || n >= limit) continue;
    const info = cat.info[String(cat.stars[d.idx][0])];
    if (!info?.n) continue;
    ctx.fillText(starLabel(cat.stars[d.idx][0], info), d.x + 6, d.y - 5);
    n++;
  }
}
