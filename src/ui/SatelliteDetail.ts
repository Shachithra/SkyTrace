import type { Crossing, SatelliteInfo } from '../astronomy/types.ts';
import { VISIBILITY_NOTE } from '../astronomy/visibility.ts';
import type { SatelliteMetadata } from '../data/indexedDb.ts';
import { ago, fmtDistance, fmtLatLon, fmtSpeed, inTime, localClock, type DistanceUnit } from '../utils/format.ts';
import { $, clear, h, s, setText } from './dom.ts';

export interface DetailModel {
  crossing: Crossing;
  info: SatelliteInfo | null;
  meta: SatelliteMetadata | null;
  lastCrossing: Crossing | null;
  nextCrossing: Crossing | null;
  isClosest: boolean;
  units: DistanceUnit;
  now: number;
}

/** Satellite detail: instrument readouts on thin rules, plus an animated orbital diagram. */
export class SatelliteDetail {
  private root: HTMLElement;
  private raf = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  render(m: DetailModel, reduceMotion: boolean): void {
    const c = m.crossing;
    const i = m.info;
    const kicker = c.matchTier ?? (m.isClosest ? 'CLOSEST TRACKED CROSSING' : c.kind === 'upcoming' ? 'PREDICTED CROSSING' : 'TRACKED CROSSING');
    setText($('[data-detail-kicker]', this.root), kicker);
    setText($('[data-detail-name]', this.root), c.name);
    setText(
      $('[data-detail-ids]', this.root),
      [`NORAD ${c.catalogId}`, c.intlDesignator && `INTL ${c.intlDesignator}`, c.simulated && 'SIMULATED ORBIT — NOT A REAL OBJECT'].filter(Boolean).join(' · '),
    );

    const rows: [string, string, string?][] = [];
    const add = (k: string, v: string | null | undefined, cls?: string): void => {
      rows.push([k, v && v.length ? v : '—', cls]);
    };
    add('Closest to field', `${c.minAngularDistance.toFixed(2)}° at ${localClock(c.closestTime, true)}`, 'accent');
    add('Object type', m.meta?.objectType ?? (c.simulated ? 'Simulated' : null));
    add('Operator / owner', m.meta?.owner);
    add('Altitude', i?.altitudeKm != null ? fmtDistance(i.altitudeKm, m.units) : i ? `~${fmtDistance(i.meanAltitudeKm, m.units)}` : null);
    add('Velocity', i?.speedKms != null ? fmtSpeed(i.speedKms, m.units) : null);
    add('Inclination', i ? `${i.inclination.toFixed(2)}°` : null);
    add('Period', i ? `${i.periodMin.toFixed(1)} min` : null);
    add('Perigee / apogee', i ? `${fmtDistance(i.perigeeKm, m.units)} / ${fmtDistance(i.apogeeKm, m.units)}` : null);
    add('Current position', i?.latitude != null && i.longitude != null ? fmtLatLon(i.latitude, i.longitude) : null);
    add('From you now', i?.azimuth != null && i.elevation != null ? `AZ ${i.azimuth.toFixed(1)}° · EL ${i.elevation.toFixed(1)}°${i.elevation < 0 ? ' (below horizon)' : ''}` : null);
    add('Last crossing', m.lastCrossing ? `${localClock(m.lastCrossing.closestTime)} · ${ago(m.lastCrossing.closestTime, m.now)}` : 'None in window');
    add('Next crossing', m.nextCrossing ? `${localClock(m.nextCrossing.entryTime)} · ${inTime(m.nextCrossing.entryTime, m.now)}` : 'None predicted in look-ahead');
    add('Direction', `${c.directionLabel} · max el ${c.passMaxElevation.toFixed(0)}°`);
    add('Range at closest', fmtDistance(c.rangeKm, m.units));
    add('Visibility', `${c.visibility === 'LIKELY_VISIBLE' ? 'LIKELY VISIBLE' : 'CROSSED FIELD'} — ${VISIBILITY_NOTE[c.visibilityReason]}`);
    if (m.meta?.launchDate) add('Launch', `${m.meta.launchDate}${m.meta.launchSite ? ` · ${m.meta.launchSite}` : ''}`);
    add('Element set age', i ? `${i.epochAgeDays.toFixed(1)} days` : null);

    const dl = $('[data-readout]', this.root);
    clear(dl);
    for (const [k, v, cls] of rows) {
      const wide = k === 'Visibility' || k === 'From you now' || k === 'Closest to field' || k === 'Direction';
      dl.append(h('div', { class: wide ? 'wide' : '' }, h('dt', {}, k), h('dd', { class: cls ?? '' }, v)));
    }

    const ageNote = i && i.epochAgeDays > 3 ? ' Elements are several days old — positions may be off by tens of km.' : '';
    setText(
      $('[data-detail-note]', this.root),
      `BEST MATCH, NOT CERTAINTY. Predicted from public orbital elements with SGP4; compass, GPS and element age all add uncertainty.${ageNote}`,
    );

    this.drawDiagram(i, reduceMotion);
  }

  /** Plan-view orbit (true eccentricity, scaled to Earth) + inclination gauge + local horizon curve. */
  private drawDiagram(info: SatelliteInfo | null, reduceMotion: boolean): void {
    cancelAnimationFrame(this.raf);
    const host = $('[data-orbit-diagram]', this.root);
    clear(host);
    if (!info) return;
    const W = 360;
    const H = 190;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Orbital diagram' });

    // --- plan view
    const cx = 100;
    const cy = 92;
    const Re = 6378.137;
    const a = info.semiMajorKm;
    const e = info.eccentricity;
    const maxR = a * (1 + e);
    const k = 78 / Math.max(maxR, Re * 1.05);
    const rx = a * k;
    const ry = a * Math.sqrt(1 - e * e) * k;
    const focusOffset = a * e * k; // Earth sits at a focus
    svg.append(
      s('circle', { class: 'od-earth', cx, cy, r: Re * k }),
      s('ellipse', { class: 'od-orbit', cx: cx - focusOffset, cy, rx, ry }),
    );
    const active = s('path', { class: 'od-orbit-active', d: '' });
    const sat = s('circle', { class: 'od-sat', r: 3 });
    svg.append(active, sat);
    svg.append(s('text', { class: 'od-label', x: cx, y: H - 8, 'text-anchor': 'middle' }, `PERIOD ${info.periodMin.toFixed(1)} MIN`));

    // --- inclination gauge
    const gx = 252;
    const gy = 70;
    const incl = info.inclination;
    const rad = (incl * Math.PI) / 180;
    svg.append(
      s('line', { class: 'od-orbit', x1: gx - 70, y1: gy, x2: gx + 70, y2: gy }),
      s('line', { class: 'od-orbit-active', x1: gx - 70 * Math.cos(rad), y1: gy + 70 * Math.sin(rad), x2: gx + 70 * Math.cos(rad), y2: gy - 70 * Math.sin(rad) }),
      s('path', { class: 'od-incl', d: `M ${gx + 30} ${gy} A 30 30 0 0 0 ${gx + 30 * Math.cos(rad)} ${gy - 30 * Math.sin(rad)}` }),
      s('text', { class: 'od-label', x: gx + 36, y: gy - 8 }, `i ${incl.toFixed(1)}°`),
      s('text', { class: 'od-label', x: gx - 70, y: gy + 14 }, 'EQUATOR'),
    );

    // --- local horizon curve with altitude marker
    const hy = 168;
    const alt = info.altitudeKm ?? info.meanAltitudeKm;
    const altPx = Math.min(46, 10 + Math.log10(Math.max(100, alt)) * 9);
    svg.append(
      s('path', { class: 'od-horizon', d: `M ${gx - 80} ${hy} Q ${gx} ${hy - 14} ${gx + 80} ${hy}` }),
      s('line', { class: 'od-orbit', x1: gx, y1: hy - 7, x2: gx, y2: hy - 7 - altPx }),
      s('circle', { class: 'od-sat', cx: gx, cy: hy - 7 - altPx, r: 2.2 }),
      s('text', { class: 'od-label', x: gx + 6, y: hy - 7 - altPx / 2 }, `${Math.round(alt).toLocaleString('en-US')} KM`),
    );
    host.append(svg);

    // Keplerian motion of the dot around the ellipse (one revolution ≈ 7 s of diagram time).
    const posAt = (M: number): { x: number; y: number } => {
      let E = M;
      for (let it = 0; it < 8; it++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      return { x: cx - focusOffset + rx * Math.cos(E), y: cy - ry * Math.sin(E) };
    };
    const start = performance.now();
    const tick = (now: number): void => {
      const M = reduceMotion ? 0.9 : (((now - start) / 7000) * Math.PI * 2) % (Math.PI * 2);
      const p = posAt(M);
      sat.setAttribute('cx', p.x.toFixed(2));
      sat.setAttribute('cy', p.y.toFixed(2));
      // short active arc behind the satellite
      const pts: string[] = [];
      for (let j = 0; j <= 16; j++) {
        const q = posAt(M - (j / 16) * 0.9);
        pts.push(`${j ? 'L' : 'M'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
      }
      active.setAttribute('d', pts.join(' '));
      if (!reduceMotion && this.root.isConnected && !this.root.hidden) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
