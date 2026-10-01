import type { SatellitePass } from '../alerts/passPrediction.ts';
import type { PassAlertRecord, SavedSatellite } from '../data/indexedDb.ts';
import { localClock } from '../utils/format.ts';
import { clear, h, s } from './dom.ts';

/**
 * MY SATELLITES as orbital timelines: each saved satellite gets a 24-hour strip
 * with its passes marked (height ∝ max elevation, filled when likely visible).
 */
export function renderSavedSatellites(
  host: HTMLElement,
  sats: SavedSatellite[],
  passes: SatellitePass[],
  alerts: PassAlertRecord[],
  now: number,
  onOpen: (s: SavedSatellite) => void,
): void {
  clear(host);
  if (!sats.length) {
    host.append(h('p', { class: 'set-help' }, 'No saved satellites yet. Tap ★ on a satellite in Live Sky, a pass, or a trace result.'));
    return;
  }
  const W = 300;
  const span = 24 * 3_600_000;
  for (const sat of sats) {
    const own = passes.filter((p) => p.catalogId === sat.norad_id && p.set.t > now);
    const nextVisible = own.find((p) => p.status === 'LIKELY_VISIBLE') ?? own.find((p) => p.status === 'POSSIBLY_VISIBLE');
    const next = own[0];
    const alert = alerts.find((a) => a.norad_id === sat.norad_id && a.enabled);
    const strip = s('svg', { class: 'orbit-strip', viewBox: `0 0 ${W} 26`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    strip.append(s('line', { x1: 0, x2: W, y1: 22, y2: 22, class: 'os-axis' }));
    for (let hr = 0; hr <= 24; hr += 3) strip.append(s('line', { x1: (hr / 24) * W, x2: (hr / 24) * W, y1: 22, y2: hr % 6 ? 25 : 26, class: 'os-tick' }));
    for (const p of own) {
      const x = ((p.max.t - now) / span) * W;
      if (x < 0 || x > W) continue;
      const hgt = 3 + (p.max.el / 90) * 17;
      strip.append(s('rect', { x: x - 1.5, y: 22 - hgt, width: 3, height: hgt, class: p.status === 'LIKELY_VISIBLE' ? 'os-pass vis' : p.status === 'POSSIBLY_VISIBLE' ? 'os-pass poss' : 'os-pass' }));
    }
    const line = nextVisible
      ? `NEXT VISIBLE PASS ${localClock(nextVisible.visibleFrom ?? nextVisible.rise.t)}`
      : next
        ? `NEXT PASS ${localClock(next.rise.t)}`
        : 'NO PASS IN THE NEXT 24 H';
    const row = h(
      'button',
      { class: 'saved-row', type: 'button', 'aria-label': `${sat.satellite_name}. ${line}${alert ? '. Alert on' : ''}` },
      h('span', { class: 'saved-name' }, sat.satellite_name),
      h('span', { class: 'saved-next mono' }, line, alert ? h('span', { class: 'saved-alert' }, ` · ALERT ${alert.notify_minutes_before} MIN`) : null),
      strip,
      h('span', { class: 'saved-axis mono', 'aria-hidden': 'true' }, h('span', {}, 'NOW'), h('span', {}, '+12 H'), h('span', {}, '+24 H')),
    );
    row.addEventListener('click', () => onOpen(sat));
    host.append(row);
  }
}
