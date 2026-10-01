import { passes, observer, orbit, satMeta, sky, skyDataSync } from '../app/services.ts';
import { router } from '../app/router.ts';
import { VISIBILITY_NOTE } from '../astronomy/visibility.ts';
import type { SatellitePass } from '../alerts/passPrediction.ts';
import { tonightWindow } from '../sky/horizon.ts';
import { colourFromBv, describeSpectral, starLabel } from '../stars/starCatalog.ts';
import { savedSatellites } from '../sync/favorites.ts';
import { satelliteMetadata } from '../data/satcat.ts';
import { settings } from '../data/settings.ts';
import { compass8 } from '../utils/degrees.ts';
import { fmtDistance, fmtSpeed, inTime, localClock } from '../utils/format.ts';
import { $, clear, h, setText } from '../ui/dom.ts';
import { passSkyPlot } from '../ui/PassTimeline.ts';
import { openSheet } from '../ui/sheets.ts';
import { toast } from '../ui/Toast.ts';
import { visibilityIndicator } from '../ui/VisibilityIndicator.ts';
import { HorizonFrame, mul, precessionMatrix, raDecToVec } from '../sky/raDecToAltAz.ts';
import { lstDeg } from '../sky/siderealTime.ts';
import { vectorToAzEl } from '../astronomy/angularDistance.ts';

const readout = (rows: [string, string | Node, string?][]): HTMLElement => {
  const dl = h('dl', { class: 'readout' });
  for (const [k, v, cls] of rows) dl.append(h('div', { class: cls ?? '' }, h('dt', {}, k), typeof v === 'string' ? h('dd', {}, v) : h('dd', {}, v)));
  return dl;
};

function setHead(kicker: string, title: string): HTMLElement {
  setText($('[data-object-kicker]'), kicker);
  setText($('[data-object-title]'), title);
  const body = $('[data-object-body]');
  clear(body);
  return body;
}

/** Star details — deliberately short (not a star encyclopedia). */
export function showStar(idx: number): void {
  const d = skyDataSync();
  const o = observer();
  if (!d) return;
  const s = d.stars.stars[idx];
  const info = d.stars.info[String(s[0])];
  const name = starLabel(s[0], info);
  const con = info?.c ? d.constellations.constellations.find((c) => c.id === info.c)?.name ?? info.c : '—';
  let pos = '—';
  if (o) {
    const jd = Date.now() / 86_400_000 + 2440587.5;
    const e = new HorizonFrame(lstDeg(jd, o.longitude), o.latitude).toEnu(mul(precessionMatrix(jd), raDecToVec(s[1], s[2])));
    const { az, el } = vectorToAzEl(e);
    pos = `AZ ${az.toFixed(1)}° · EL ${el.toFixed(1)}°${el < 0 ? ' (below horizon)' : ''}`;
  }
  const body = setHead('STAR', name.toUpperCase());
  body.append(
    readout([
      ['Constellation', con],
      ['Magnitude', s[3].toFixed(2)],
      ['Distance', info?.ly ? `~${info.ly.toLocaleString('en-US')} ly` : '—'],
      ['Type', info?.sp ? `${describeSpectral(info.sp)} (${info.sp})` : `${colourFromBv(s[4])} (from colour index)`, 'wide'],
      ['Designation', [info?.d && `${info.d} ${info.c ?? ''}`, `HIP ${s[0]}`].filter(Boolean).join(' · '), 'wide'],
      ['Position now', pos, 'wide'],
    ]),
  );
  openSheet('#sheet-object');
}

/** Constellation details + focus / passes actions. */
export async function showConstellation(id: string, onFocus: (id: string) => void): Promise<void> {
  const o = observer();
  if (!o) return;
  const info = await sky.constellationInfo(o, Date.now(), id);
  if (!info) return;
  const tonight = tonightWindow(Date.now(), o.latitude, o.longitude);
  const crossings = (passes.result?.passes ?? []).filter((p) => p.constellations.includes(info.name) && p.rise.t < tonight.end && p.set.t > tonight.start);
  const rs = info.riseSet;
  const rsText = rs.circumpolar ? 'Circumpolar — never sets' : rs.neverRises ? 'Never rises at this latitude' : `Rises ${localClock(rs.rise!)} · sets ${localClock(rs.set!)}`;
  const body = setHead('CONSTELLATION', info.name.toUpperCase());
  body.append(
    readout([
      ['Status', info.status],
      ['Best direction', info.bestDirection],
      ['Altitude', `${info.alt.toFixed(0)}°`],
      ['Major stars', String(info.majorStars.length)],
      ['Rise / set', rsText, 'wide'],
      ['Highest', `${localClock(rs.transit)} at ${rs.transitAltitude.toFixed(0)}° toward ${compass8(rs.transitAzimuth)}`, 'wide'],
      ['Satellite crossings tonight', String(crossings.length), 'wide'],
    ]),
    h('p', { class: 'star-list mono' }, info.majorStars.map((s) => `${s.name} ${s.mag.toFixed(1)}`).join(' · ')),
  );
  const focus = h('button', { class: 'btn btn-primary', type: 'button' }, 'FOCUS');
  focus.addEventListener('click', () => onFocus(id));
  const view = h('button', { class: 'btn', type: 'button' }, 'VIEW PASSES');
  view.addEventListener('click', () => router.go('passes', { constellation: info.name }));
  body.append(h('div', { class: 'set-actions sheet-actions' }, focus, view));
  openSheet('#sheet-object');
}

/** Satellite readout from Live Sky. */
export async function showSatellite(id: number, onShowPath: (id: number) => void): Promise<void> {
  const o = observer();
  const name = satMeta.get(id)?.name ?? `NORAD ${id}`;
  const body = setHead(`SATELLITE · NORAD ${id}`, name);
  body.append(h('p', { class: 'set-help' }, 'Calculating…'));
  openSheet('#sheet-object');
  const [info, meta] = await Promise.all([orbit.info(id, o), satelliteMetadata(id)]);
  const units = settings.get().units;
  const next = passes.nextFor(id);
  const nextVis = passes.nextFor(id, true);
  clear(body);
  body.append(
    readout([
      ['From you now', info?.elevation != null ? `AZ ${info.azimuth!.toFixed(1)}° · EL ${info.elevation.toFixed(1)}°` : '—', 'wide'],
      ['Range', info?.rangeKm != null ? fmtDistance(info.rangeKm, units) : '—'],
      ['Altitude', info?.altitudeKm != null ? fmtDistance(info.altitudeKm, units) : '—'],
      ['Velocity', info?.speedKms != null ? fmtSpeed(info.speedKms, units) : '—'],
      ['Inclination', info ? `${info.inclination.toFixed(1)}°` : '—'],
      ['Next pass', next ? `${localClock(next.rise.t)} · ${next.directionLabel} · MAX EL ${Math.round(next.max.el)}°` : 'None in 24 h', 'wide'],
      ['Next visible pass', nextVis ? `${localClock(nextVis.visibleFrom ?? nextVis.rise.t)} · ${inTime(nextVis.visibleFrom ?? nextVis.rise.t)}` : 'None predicted in 24 h', 'wide'],
      ['Type / owner', [meta?.objectType, meta?.owner].filter(Boolean).join(' · ') || '—', 'wide'],
      ['Element set age', info ? `${info.epochAgeDays.toFixed(1)} days` : '—'],
    ]),
  );
  body.append(satActions(id, name, onShowPath));
}

function satActions(id: number, name: string, onShowPath?: (id: number) => void): HTMLElement {
  const star = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false' }, '★ SAVE');
  void savedSatellites.find(id).then((s) => {
    star.setAttribute('aria-pressed', String(!!s));
    star.textContent = s ? '★ SAVED' : '☆ SAVE';
  });
  star.addEventListener('click', async () => {
    const on = await savedSatellites.toggle(id, name);
    star.setAttribute('aria-pressed', String(on));
    star.textContent = on ? '★ SAVED' : '☆ SAVE';
    toast(on ? `${name} SAVED` : `${name} REMOVED`, 'ok', 1800);
  });
  const alert = h('button', { class: 'btn', type: 'button' }, 'ALERT ME');
  alert.addEventListener('click', () => router.call('alert', id, name));
  const row = h('div', { class: 'set-actions sheet-actions' }, star, alert);
  if (onShowPath) {
    const path = h('button', { class: 'btn btn-primary', type: 'button' }, 'SHOW PATH');
    path.addEventListener('click', () => onShowPath(id));
    row.prepend(path);
  }
  return row;
}

/** Pass detail: polar sky plot, timings, visibility, constellations crossed. */
export function showPass(p: SatellitePass): void {
  setText($('[data-pass-kicker]'), `PASS · NORAD ${p.catalogId}`);
  setText($('[data-pass-title]'), p.name);
  const body = $('[data-pass-body]');
  clear(body);
  body.append(
    h('div', { class: 'pass-plot-wrap' }, passSkyPlot(p)),
    readout([
      ['Rises', `${localClock(p.rise.t, true)} · ${compass8(p.rise.az)}`],
      ['Sets', `${localClock(p.set.t, true)} · ${compass8(p.set.az)}`],
      ['Maximum elevation', `${p.max.el.toFixed(0)}° at ${localClock(p.max.t, true)}`, 'wide'],
      ['Direction', p.directionLabel],
      ['Duration', `${Math.round(p.durationS / 60)} min`],
      ['Visibility', visibilityIndicator(p.status), 'wide'],
      ['Visible window', p.visibleFrom ? `${localClock(p.visibleFrom, true)} – ${localClock(p.visibleTo!, true)}` : '—', 'wide'],
      ['Brightness (est.)', p.brightestMagnitude !== null ? `mag ${p.brightestMagnitude.toFixed(1)}` : '—'],
      ['Crosses', p.constellations.length ? p.constellations.join(' · ') : '—', 'wide'],
    ]),
    h('p', { class: 'data-note mono' }, `ESTIMATE · ${VISIBILITY_NOTE.DARK_SKY_SUNLIT.toUpperCase()} REQUIRED FOR NAKED-EYE VISIBILITY`),
  );
  const live = h('button', { class: 'btn btn-primary', type: 'button' }, 'SHOW IN LIVE SKY');
  live.addEventListener('click', () => router.go('live', { focusSatellite: p.catalogId }));
  const actions = satActions(p.catalogId, p.name);
  actions.prepend(live);
  body.append(actions);
  openSheet('#sheet-pass');
}
