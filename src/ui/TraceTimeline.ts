import type { Crossing } from '../astronomy/types.ts';
import { LABEL_TEXT, VISIBILITY_NOTE } from '../astronomy/visibility.ts';
import { inTime, localClock } from '../utils/format.ts';
import { clamp } from '../utils/math.ts';
import { clear, h } from './dom.ts';

export type SortMode = 'recent' | 'closest' | 'visible';

export interface TimelineOptions {
  kind: 'past' | 'upcoming';
  windowStart: number;
  windowEnd: number;
  now: number;
  radius: number;
  sort: SortMode;
  sighting: boolean;
  /** sighting mode: when the light was seen and which way it moved */
  sightingTime?: number;
  sightingDirection?: number | null;
  onSelect: (c: Crossing, origin: HTMLElement) => void;
}

const ROW = 64; // minimum vertical gap between labels (px)

/**
 * Semantic, time-proportional timeline — events on a line, not cards.
 * Markers sit at their true time; labels are nudged down only as much as
 * needed to stay legible, with a short leader back to the true marker.
 */
export function renderTimeline(host: HTMLElement, items: Crossing[], o: TimelineOptions): HTMLElement {
  clear(host);
  const proportional = o.sort === 'recent' && !o.sighting;
  const list = sortItems(items, o);

  const root = h('div', { class: `tl${proportional ? '' : ' ranked'}`, role: 'list' });
  host.append(root);

  if (proportional) {
    const span = Math.max(1, o.kind === 'past' ? o.now - o.windowStart : o.windowEnd - o.now);
    const H0 = clamp(list.length * ROW + 120, 340, 1600);
    const yOf = (t: number): number => clamp(((o.kind === 'past' ? o.now - t : t - o.now) / span) * H0, 0, H0);
    const placed = list.map((c) => ({ c, y: yOf(c.closestTime) })).sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    const rows = placed.map((p) => {
      const ly = Math.max(p.y, prev + ROW);
      prev = ly;
      return { ...p, ly };
    });
    const H = rows.length ? Math.max(H0, rows[rows.length - 1].ly + ROW) : H0;
    root.style.height = `${H}px`;
    root.append(h('div', { class: 'tl-axis', 'aria-hidden': 'true' }));

    // caps & ticks — the scale is spatially proportional to time
    const sign = o.kind === 'past' ? '−' : '+';
    const spanMin = Math.round(span / 60000);
    root.append(h('span', { class: 'tl-cap', style: 'top:0', 'aria-hidden': 'true' }, 'NOW'));
    root.append(h('span', { class: 'tl-cap end', style: `top:${H0}px`, 'aria-hidden': 'true' }, `${sign}${spanMin} MIN`));
    const tickEvery = spanMin <= 15 ? 5 : spanMin <= 60 ? 10 : 30;
    for (let m = tickEvery; m < spanMin; m += tickEvery) {
      const y = ((m * 60000) / span) * H0;
      root.append(h('span', { class: 'tl-tick', style: `top:${y}px`, 'aria-hidden': 'true' }));
    }

    for (const r of rows) {
      const ev = eventEl(r.c, o);
      ev.style.top = `${r.ly - 9}px`;
      ev.dataset.y = String(r.y);
      // When a label had to move down for legibility, a short tick on the axis
      // still marks the event's true time, so the scale stays proportional.
      if (r.ly - r.y > 3) {
        root.append(h('span', { class: 'tl-true', style: `top:${r.y}px`, 'aria-hidden': 'true' }));
      }
      root.append(ev);
    }
  } else {
    root.append(h('div', { class: 'tl-axis', 'aria-hidden': 'true' }));
    list.forEach((c, i) => {
      const ev = eventEl(c, o);
      ev.dataset.y = String(i * ROW);
      root.append(ev);
    });
  }
  return root;
}

function sortItems(items: Crossing[], o: TimelineOptions): Crossing[] {
  const list = [...items];
  if (o.sighting) return list; // already ordered by match score
  if (o.sort === 'closest') list.sort((a, b) => a.minAngularDistance - b.minAngularDistance);
  else if (o.sort === 'visible') return list.filter((c) => c.visibility === 'LIKELY_VISIBLE').sort((a, b) => b.score - a.score);
  else list.sort((a, b) => (o.kind === 'past' ? b.closestTime - a.closestTime : a.closestTime - b.closestTime));
  return list;
}

function eventEl(c: Crossing, o: TimelineOptions): HTMLElement {
  const closeness = 1 - clamp(c.minAngularDistance / o.radius, 0, 1);
  const size = 5 + 6 * closeness; // marker size depends subtly on closeness
  const visible = c.visibility === 'LIKELY_VISIBLE';

  const timeLabel = o.kind === 'upcoming' ? localClock(c.entryTime) : localClock(c.closestTime);
  let meta = `${c.directionLabel} · closest ${c.minAngularDistance.toFixed(1)}°`;
  if (o.sighting && o.sightingTime !== undefined) {
    // "closest path 1.8° · observed time difference 8 sec · direction match HIGH"
    const dt = Math.round(Math.abs(c.closestTime - o.sightingTime) / 1000);
    const dtText = dt < 120 ? `${dt} sec` : `${Math.round(dt / 60)} min`;
    let dir = 'n/a';
    if (o.sightingDirection !== null && o.sightingDirection !== undefined) {
      const diff = Math.abs(((c.travelBearing - o.sightingDirection + 540) % 360) - 180);
      dir = diff < 35 ? 'HIGH' : diff < 75 ? 'MEDIUM' : 'LOW';
    }
    meta = `closest path ${c.minAngularDistance.toFixed(1)}° · time difference ${dtText} · direction match ${dir}`;
  }
  const flagText = o.sighting && c.matchTier
    ? c.matchTier
    : o.kind === 'upcoming'
      ? `ENTERS ${inTime(c.entryTime, o.now).toUpperCase()}`
      : visible
        ? 'LIKELY VISIBLE'
        : LABEL_TEXT[c.visibility];
  const tone = o.sighting ? 'match' : visible ? 'visible' : c.visibility === 'POSSIBLY_VISIBLE' ? 'possible' : '';
  const glyph = visible ? '◆' : c.visibility === 'POSSIBLY_VISIBLE' ? '◇' : '○';
  const extras: string[] = [];
  if (c.inFieldAtStart && o.kind === 'past') extras.push('IN FIELD AT WINDOW START');
  if (c.inFieldAtEnd && o.kind === 'past') extras.push('STILL IN FIELD');
  if (c.simulated) extras.push('SIMULATED');

  const btn = h(
    'button',
    {
      class: 'tl-event',
      role: 'listitem',
      'data-visible': String(visible),
      'aria-label': `${c.name}, ${o.kind === 'upcoming' ? 'enters field' : 'closest'} at ${timeLabel}, ${meta}, ${flagText}${visible ? '' : `, ${VISIBILITY_NOTE[c.visibilityReason]}`}`,
    },
    h('span', { class: 'tl-time' }, timeLabel),
    h('span', { class: 'tl-marker' }, h('span', { class: 'tl-dot', style: `width:${size}px;height:${size}px` })),
    h(
      'span',
      { class: 'tl-body' },
      h('span', { class: 'tl-name' }, c.name),
      h('span', { class: 'tl-meta' }, meta),
      h('span', { class: 'tl-flag', 'data-tone': tone }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), [flagText, ...extras].join(' · ')),
    ),
  );
  btn.addEventListener('click', () => o.onSelect(c, btn));
  return btn;
}
