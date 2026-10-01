import type { SatellitePass } from '../alerts/passPrediction.ts';
import { localClock, inTime } from '../utils/format.ts';
import { clamp } from '../utils/math.ts';
import { clear, h, s } from './dom.ts';
import { visibilityIndicator } from './VisibilityIndicator.ts';

const ROW = 92;
const MAX_ROWS = 150;

/** Small altitude-profile arc for a pass (time → elevation). */
function passGlyph(p: SatellitePass): SVGSVGElement {
  const w = 54;
  const hgt = 20;
  const t0 = p.rise.t;
  const span = Math.max(1, p.set.t - p.rise.t);
  const d = p.path.map((pt, i) => `${i ? 'L' : 'M'} ${(((pt.t - t0) / span) * w).toFixed(1)} ${(hgt - (Math.max(0, pt.el) / 90) * hgt).toFixed(1)}`).join(' ');
  const vis = p.path.filter((pt) => pt.status !== 'NOT_EXPECTED');
  const dv = vis.map((pt, i) => `${i ? 'L' : 'M'} ${(((pt.t - t0) / span) * w).toFixed(1)} ${(hgt - (Math.max(0, pt.el) / 90) * hgt).toFixed(1)}`).join(' ');
  return s(
    'svg',
    { class: 'pass-glyph', viewBox: `0 -1 ${w} ${hgt + 2}`, width: w, height: hgt + 2, 'aria-hidden': 'true' },
    s('line', { x1: 0, x2: w, y1: hgt, y2: hgt, class: 'pg-horizon' }),
    s('path', { d, class: 'pg-arc' }),
    dv ? s('path', { d: dv, class: 'pg-vis' }) : null,
  );
}

/**
 * Upcoming passes on a time-proportional vertical axis (NOW at the top).
 * Each pass: time, name, direction, max elevation, visibility, altitude arc.
 */
export function renderPassTimeline(host: HTMLElement, all: SatellitePass[], opts: { start: number; end: number; now: number; onSelect: (p: SatellitePass, el: HTMLElement) => void; favourites: Set<number>; limit?: number; onMore?: () => void }): void {
  clear(host);
  if (!all.length) return;
  const limit = opts.limit ?? MAX_ROWS;
  const list = all.slice(0, limit);
  const span = Math.max(1, opts.end - opts.start);
  const H0 = clamp(list.length * ROW + 80, 360, 4200);
  const yOf = (t: number): number => clamp(((t - opts.start) / span) * H0, 0, H0);
  let prev = -Infinity;
  const rows = list.map((p) => {
    const y = yOf(Math.max(opts.start, p.visibleFrom ?? p.rise.t));
    const ly = Math.max(y, prev + ROW);
    prev = ly;
    return { p, y, ly };
  });
  const H = Math.max(H0, rows[rows.length - 1].ly + ROW);
  const root = h('div', { class: 'pt', role: 'list', style: `height:${H}px` });
  root.append(h('div', { class: 'tl-axis', 'aria-hidden': 'true' }));
  root.append(h('span', { class: 'tl-cap', style: 'top:0', 'aria-hidden': 'true' }, opts.start <= opts.now + 60_000 ? 'NOW' : localClock(opts.start)));
  // hour ticks with labels
  const first = Math.ceil(opts.start / 3_600_000) * 3_600_000;
  for (let t = first; t < opts.end; t += 3_600_000) {
    const y = yOf(t);
    root.append(h('span', { class: 'tl-tick pt-hour', style: `top:${y}px`, 'aria-hidden': 'true' }));
  }
  for (const r of rows) {
    const p = r.p;
    const visible = p.status !== 'NOT_EXPECTED';
    const t = Math.max(opts.start, p.visibleFrom ?? p.rise.t);
    const running = p.inProgress || (p.visibleFrom ?? p.rise.t) < opts.start;
    const btn = h(
      'button',
      {
        class: 'tl-event pt-event',
        role: 'listitem',
        style: `top:${r.ly - 9}px`,
        'data-y': String(r.y),
        'data-visible': String(p.status === 'LIKELY_VISIBLE'),
        'aria-label': `${p.name} at ${localClock(t)}, ${p.directionLabel}, maximum elevation ${Math.round(p.max.el)} degrees, ${p.status.replace(/_/g, ' ').toLowerCase()}`,
      },
      h('span', { class: 'tl-time' }, localClock(t)),
      h('span', { class: 'tl-marker' }, h('span', { class: 'tl-dot', style: `width:${5 + (p.max.el / 90) * 6}px;height:${5 + (p.max.el / 90) * 6}px` })),
      h(
        'span',
        { class: 'tl-body' },
        h('span', { class: 'tl-name' }, opts.favourites.has(p.catalogId) ? `★ ${p.name}` : p.name),
        h('span', { class: 'tl-meta' }, `${p.directionLabel.replace('→', '->')} · MAX EL ${Math.round(p.max.el)}°`),
        h('span', { class: 'pt-row' }, visibilityIndicator(p.status, true), passGlyph(p)),
        h(
          'span',
          { class: 'tl-flag', 'data-tone': running || t < opts.now ? 'match' : '' },
          [running || t < opts.now ? 'IN PROGRESS' : inTime(t, opts.now).toUpperCase(), p.constellations.length ? `THROUGH ${p.constellations.slice(0, 2).join(' · ').toUpperCase()}` : ''].filter(Boolean).join(' · '),
        ),
      ),
    );
    if (!visible) btn.classList.add('pt-dim');
    if (r.ly - r.y > 3 && list.length <= 60) root.append(h('span', { class: 'tl-true', style: `top:${r.y}px`, 'aria-hidden': 'true' }));
    btn.addEventListener('click', () => opts.onSelect(p, btn));
    root.append(btn);
  }
  host.append(root);
  if (all.length > list.length && opts.onMore) {
    const more = h('button', { class: 'btn small', type: 'button' }, `SHOW MORE (${all.length - list.length})`);
    more.addEventListener('click', opts.onMore);
    host.append(more);
  }
}

/** Polar mini-map of a pass path (zenith centre, horizon edge, N up, E left). */
export function passSkyPlot(p: SatellitePass): SVGSVGElement {
  const R = 90;
  const pt = (az: number, el: number): [number, number] => {
    const r = R * Math.tan(((90 - Math.max(-2, el)) * Math.PI) / 360);
    const a = (az * Math.PI) / 180;
    return [-r * Math.sin(a), -r * Math.cos(a)];
  };
  const svg = s('svg', { viewBox: '-112 -112 224 224', class: 'pass-plot', role: 'img', 'aria-label': `Sky path of ${p.name}` });
  svg.append(s('circle', { r: R, class: 'pp-horizon' }), s('circle', { r: R * Math.tan((60 * Math.PI) / 360), class: 'pp-ring' }), s('circle', { r: R * Math.tan((30 * Math.PI) / 360), class: 'pp-ring' }));
  for (const [az, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) {
    const [x, y] = pt(az, -9);
    svg.append(s('text', { x, y, class: `pp-label${l === 'N' ? ' n' : ''}` }, l));
  }
  const d = p.path.map((q, i) => `${i ? 'L' : 'M'} ${pt(q.az, q.el).map((v) => v.toFixed(1)).join(' ')}`).join(' ');
  svg.append(s('path', { d, class: 'pp-path' }));
  const vis = p.path.filter((q) => q.status !== 'NOT_EXPECTED');
  if (vis.length > 1) svg.append(s('path', { d: vis.map((q, i) => `${i ? 'L' : 'M'} ${pt(q.az, q.el).map((v) => v.toFixed(1)).join(' ')}`).join(' '), class: 'pp-vis' }));
  const [mx, my] = pt(p.max.az, p.max.el);
  svg.append(s('circle', { cx: mx, cy: my, r: 3, class: 'pp-max' }));
  const [sx, sy] = pt(p.set.az, 0);
  const [px, py] = pt(p.path[p.path.length - 2]?.az ?? p.set.az, p.path[p.path.length - 2]?.el ?? 2);
  const ang = Math.atan2(sy - py, sx - px);
  svg.append(s('path', { d: `M ${sx} ${sy} L ${sx - 7 * Math.cos(ang - 0.4)} ${sy - 7 * Math.sin(ang - 0.4)} L ${sx - 7 * Math.cos(ang + 0.4)} ${sy - 7 * Math.sin(ang + 0.4)} Z`, class: 'pp-arrow' }));
  return svg;
}
