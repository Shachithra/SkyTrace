import type { ObservationRecord, TraceRecord } from '../data/indexedDb.ts';
import { localClock } from '../utils/format.ts';
import { clear, h } from './dom.ts';

const day = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();

/** OBSERVATIONS grouped by night, e.g. "01 OCT · ISS · 19:42". Tap to replay. */
export function renderObservations(host: HTMLElement, list: ObservationRecord[], onOpen: (o: ObservationRecord) => void, onDelete: (o: ObservationRecord) => void): void {
  clear(host);
  if (!list.length) {
    host.append(h('p', { class: 'set-help' }, 'No observations yet. After a trace, open a satellite and choose LOG OBSERVATION.'));
    return;
  }
  let current = '';
  for (const o of list) {
    const d = day(o.observed_at);
    if (d !== current) {
      current = d;
      host.append(h('h3', { class: 'hist-day mono' }, d));
    }
    const row = h(
      'div',
      { class: 'hist-row' },
      h(
        'button',
        { class: 'hist-main', type: 'button', 'aria-label': `${o.satellite_name} at ${localClock(Date.parse(o.observed_at))}, replay` },
        h('span', { class: 'hist-name' }, o.satellite_name),
        h('span', { class: 'hist-meta mono' }, `${localClock(Date.parse(o.observed_at))} · AZ ${o.azimuth.toFixed(0)}° EL ${o.elevation.toFixed(0)}° · MATCH ${o.match_confidence}`),
      ),
      h('button', { class: 'icon-btn small hist-del', type: 'button', 'aria-label': `Delete observation of ${o.satellite_name}`, 'data-icon': 'x' }),
    );
    row.querySelector('.hist-main')!.addEventListener('click', () => onOpen(o));
    row.querySelector('.hist-del')!.addEventListener('click', () => onDelete(o));
    host.append(row);
  }
}

/** TRACE HISTORY: every trace ID with direction, time and matches. */
export function renderTraces(host: HTMLElement, list: TraceRecord[], onOpen: (t: TraceRecord) => void, onDelete: (t: TraceRecord) => void): void {
  clear(host);
  if (!list.length) {
    host.append(h('p', { class: 'set-help' }, 'No traces yet. Traces are kept on this device; your position is stored only if you allow it in settings.'));
    return;
  }
  for (const t of list) {
    const sel = t.matches?.find((m) => m.norad_id === t.selected_norad_id);
    const row = h(
      'div',
      { class: 'hist-row' },
      h(
        'button',
        { class: 'hist-main', type: 'button', 'aria-label': `${t.trace_id}, ${t.match_count} matches` },
        h('span', { class: 'hist-name mono' }, t.trace_id),
        h(
          'span',
          { class: 'hist-meta mono' },
          `${day(t.trace_time)} ${localClock(Date.parse(t.trace_time))} · ${t.match_count} MATCH${t.match_count === 1 ? '' : 'ES'} · FIELD ${t.field_radius}°${sel ? ` · ${sel.name}` : ''}${t.sensor_accuracy ? ` · ±${t.sensor_accuracy.toFixed(0)}°` : ''}`,
        ),
      ),
      h('button', { class: 'icon-btn small hist-del', type: 'button', 'aria-label': `Delete ${t.trace_id}`, 'data-icon': 'x' }),
    );
    row.querySelector('.hist-main')!.addEventListener('click', () => onOpen(t));
    row.querySelector('.hist-del')!.addEventListener('click', () => onDelete(t));
    host.append(row);
  }
}
