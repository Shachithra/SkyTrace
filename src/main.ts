import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/typography.css';
import './styles/layout.css';
import './styles/animations.css';
import './styles/scanner.css';
import './styles/live.css';

import gsap from 'gsap';
import { generateSimulatedOrbits } from './astronomy/demoData.ts';
import type { Crossing, SightingQuery, TraceRequest, TraceResult } from './astronomy/types.ts';
import { playIntro } from './animations/introSequence.ts';
import { revealTimeline } from './animations/timelineMotion.ts';
import { coordinateFlashes, launchRing } from './animations/traceSequence.ts';
import { TrajectoryReplay } from './animations/trajectoryReplay.ts';
import { cacheSummary, clearOrbitCache, loadOrbits } from './data/orbitalCache.ts';
import { satelliteMetadata } from './data/satcat.ts';
import { prefersReducedMotion, settings } from './data/settings.ts';
import { initInstall, maybeOfferInstall } from './pwa/install.ts';
import { onConnectivity, orbitStatusText, type OrbitDataState } from './pwa/offline.ts';
import { initUpdates, offerIfIdle } from './pwa/update.ts';
import { camera, location, observer, orbit, orientation, passes, refreshActiveLocation, refreshAlerts, satMeta, setRecords, sky, skyDatasets, skyDataSync } from './app/services.ts';
import { router, type NavParams, type ScreenId } from './app/router.ts';
import { savedLocations, savedSatellites } from './sync/favorites.ts';
import { observations } from './history/observations.ts';
import { traces } from './history/traces.ts';
import { userStore } from './data/userStore.ts';
import { scheduleSync, syncAll } from './sync/historySync.ts';
import { onSession, currentSession } from './sync/supabase.ts';
import { LiveSkyScreen } from './screens/liveSky.ts';
import { HomeScreen } from './screens/home.ts';
import { PassesScreen } from './screens/passes.ts';
import { SavedScreen } from './screens/saved.ts';
import { HistoryScreen, type ReplayRequest } from './screens/history.ts';
import { closeSheet, openSheet } from './ui/sheets.ts';
import { applyNightMode, nightModeButton } from './ui/NightModeControl.ts';
import { renderPassAlertControl } from './ui/PassAlertControl.ts';
import { $, $$, clear, h, hydrateIcons, s, setIcon, setText } from './ui/dom.ts';
import { SatelliteDetail } from './ui/SatelliteDetail.ts';
import { SettingsPanel } from './ui/SettingsPanel.ts';
import { SightingPanel, type SightingChoice } from './ui/SightingPanel.ts';
import { SkyScanner } from './ui/SkyScanner.ts';
import { toast } from './ui/Toast.ts';
import { renderTimeline, type SortMode } from './ui/TraceTimeline.ts';
import { haptic } from './utils/haptics.ts';
import { debounce } from './utils/throttle.ts';
import { fmtWindow, utcClock, zulu } from './utils/format.ts';

/* ───────────────────────── state ───────────────────────── */

interface TraceSession {
  traceId: string;
  request: TraceRequest;
  result: TraceResult;
  sighting: SightingChoice | null;
  windowMin: number;
}

const UPCOMING_MS = 2 * 60 * 60 * 1000;

const app = {
  screen: 'splash' as ScreenId,
  replayReturn: null as ScreenId | null,
  orbit: { count: 0, fetchedAt: null, source: 'none' } as OrbitDataState,
  orbitsLoading: null as Promise<void> | null,
  tracing: null as string | null,
  session: null as TraceSession | null,
  list: 'past' as 'past' | 'upcoming',
  sort: 'recent' as SortMode,
  selected: null as Crossing | null,
  replay: null as TrajectoryReplay | null,
  calibrationDismissedAt: 0,
  sightingQueued: null as SightingChoice | null,
  silentWarned: false,
};

const client = orbit;
const scanner = new SkyScanner($('#screen-scanner'), $<HTMLCanvasElement>('#sky'), orientation, location);
const detail = new SatelliteDetail($('#screen-detail'));
const settingsPanel = new SettingsPanel($('[data-settings-body]'), {
  refreshOrbits: () => refreshOrbits(true),
  clearCache: async () => {
    await clearOrbitCache();
    toast('ORBIT CACHE CLEARED', 'ok');
  },
  datasetsChanged: debounce(() => void refreshOrbits(false), 600),
  orbitInfo: () => ({ count: app.orbit.count, oldestFetch: app.orbit.fetchedAt, simulated: app.orbit.source === 'simulated' }),
  starVersion: () => skyDataSync()?.stars.version ?? null,
});
const live = new LiveSkyScreen();
const home2 = new HomeScreen();
const passesScreen = new PassesScreen();
const savedScreen = new SavedScreen();
const historyScreen = new HistoryScreen();
const sightingPanel = new SightingPanel($('[data-sighting-body]'), (choice) => {
  closeSheet('#sheet-sighting');
  app.sightingQueued = choice;
  setText($('[data-trace-label]'), 'TRACE SIGHTING');
  $('[data-action="sighting"]').setAttribute('aria-pressed', 'true');
  toast(`AIM WHERE YOU SAW IT · ${choice.label}`, 'info');
});

const reduce = (): boolean => prefersReducedMotion();

/* ───────────────────────── boot ───────────────────────── */

async function boot(): Promise<void> {
  await settings.load();
  applyAppearance();
  hydrateIcons();
  buildHomeReticle();
  initInstall();
  initUpdates(() => !!app.tracing || scanner.mode === 'replay');
  onConnectivity(() => updateOrbitStatus());
  wireActions();
  settings.subscribe(onSettingsChanged);
  scanner.setRadius(settings.get().fieldRadius);
  scanner.onCalibration = showCalibration;
  scanner.onStableLock = () => {
    /* status text already reads TARGET FIELD STABLE; no extra noise */
  };
  orientation.onChange(onOrientationChange);
  location.onChange(updatePermissionStates);
  location.onChange(() => passes.invalidate());
  applyNightMode(settings.get().nightMode);
  renderHeadTools();
  router.set((sc, p) => show(sc, p));
  router.provide('alert', (id: number, name: string) => void openAlertSheet(id, name));
  router.provide('replayPath', (r: ReplayRequest) => startReplayPath(r));
  router.provide('orbitFetchedAt', () => app.orbit.fetchedAt);
  router.provide('retryOrbits', () => refreshOrbits(true));
  router.provide('useSimulated', () => useSimulated());
  void refreshActiveLocation();
  void skyDatasets();
  // Optional account sync (no-op in guest mode).
  userStore.setSyncHook(scheduleSync);
  onSession((sess) => {
    if (sess) void syncAll();
  });
  void currentSession().then((sess) => sess && syncAll());
  window.addEventListener('online', () => void syncAll());
  setInterval(() => void refreshAlerts(), 5 * 60_000);
  setInterval(() => void feedScannerSky(), 30_000);

  const utcTimer = setInterval(() => $$('[data-utc]').forEach((el) => setText(el, utcClock())), 1000);
  $$('[data-utc]').forEach((el) => setText(el, utcClock()));

  // Orbital data loads in the background from cache first; network only when due.
  app.orbitsLoading = refreshOrbits(false).then(migrateV1Favourites);

  await playIntro(reduce());
  clearInterval(utcTimer);
  $('#screen-splash').hidden = true;

  // App shortcuts (manifest) and deep links: ?view=sky|trace|passes|sighting|saved|history
  const view = new URLSearchParams(window.location.search).get('view');
  if (!settings.get().onboarded && !view) {
    show('home');
    return;
  }
  // Returning / installed users launch almost directly into the instrument.
  const geo = await location.peek();
  if (geo === 'granted') {
    await location.request().catch(() => undefined);
    if (!orientation.needsPermission) void orientation.request();
  }
  if (!observer()) {
    show('permissions');
    return;
  }
  settings.set({ onboarded: true });
  const target: Record<string, ScreenId> = { sky: 'live', trace: 'scanner', passes: 'passes', sighting: 'scanner', saved: 'saved', history: 'history' };
  if (view && target[view]) {
    if (target[view] === 'scanner') openScanner();
    else show(target[view]);
    if (view === 'sighting') {
      sightingPanel.render();
      openSheet('#sheet-sighting');
    }
  } else show('home2');
}

function applyAppearance(): void {
  const st = settings.get();
  document.documentElement.dataset.contrast = st.contrast;
  document.documentElement.classList.toggle('reduce-motion', reduce());
  document.documentElement.classList.toggle('motion-forced', st.reduceMotion === 'off');
  scanner.renderer.reduceMotion = reduce();
  scanner.renderer.starIntensity = st.starIntensity;
  scanner.renderer.invalidateTheme();
}

function onSettingsChanged(st: ReturnType<typeof settings.get>, changed: string[]): void {
  if (changed.includes('nightMode')) {
    applyNightMode(st.nightMode);
    live.setNight();
    renderHeadTools();
  }
  if (changed.includes('passMinElevation')) {
    passes.invalidate();
    void passes.next24h(true);
  }
  if (changed.some((k) => ['contrast', 'reduceMotion', 'starIntensity'].includes(k))) applyAppearance();
  if (changed.includes('fieldRadius')) scanner.setRadius(st.fieldRadius);
  if (changed.includes('camera')) void setCamera(st.camera);
}

/* ───────────────────────── screens ───────────────────────── */

const SCREENS: Record<string, string> = {
  splash: '#screen-splash',
  home: '#screen-home',
  permissions: '#screen-permissions',
  scanner: '#screen-scanner',
  home2: '#screen-home2',
  live: '#screen-live',
  passes: '#screen-passes',
  saved: '#screen-saved',
  history: '#screen-history',
};
const NAV_SCREENS: ScreenId[] = ['home2', 'live', 'scanner', 'passes', 'saved', 'history'];

function show(screen: ScreenId, params?: NavParams): void {
  if (screen === 'scanner' && app.screen !== 'scanner' && !params) return openScanner();
  const prev = app.screen;
  for (const sel of ['#sheet-object', '#sheet-pass', '#sheet-alert']) if (!$(sel).hidden) $(sel).hidden = true;
  if (prev === 'live' && screen !== 'live') live.close();
  if (prev === 'home2' && screen !== 'home2') home2.close();
  if (prev === 'passes' && screen !== 'passes') passesScreen.close();
  for (const [k, sel] of Object.entries(SCREENS)) {
    const el = $(sel);
    if (k === screen) {
      el.hidden = false;
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: reduce() ? 0.15 : 0.45, ease: 'power2.out' });
    } else el.hidden = true;
  }
  app.screen = screen;
  scanner.active = screen === 'scanner';
  scanner.suspended = screen === 'live';
  const nav = $('[data-nav]');
  nav.hidden = !NAV_SCREENS.includes(screen);
  $$('[data-nav-to]', nav).forEach((b) => (b.dataset.navTo === screen ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (screen === 'permissions') updatePermissionStates();
  if (screen === 'scanner') void feedScannerSky();
  if (screen === 'home') animateHome();
  if (screen === 'live') void live.open({ focusSatellite: params?.focusSatellite });
  if (screen === 'home2') void home2.open();
  if (screen === 'passes') void passesScreen.open({ constellation: params?.constellation });
  if (screen === 'saved') void savedScreen.open();
  if (screen === 'history') void historyScreen.open();
}

/** Secondary navigation (HISTORY, SETTINGS) + night-vision control in page headers. */
function renderHeadTools(): void {
  for (const host of $$('[data-head-tools], [data-live-tools]')) {
    clear(host);
    const hist = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'History', 'data-action': 'go-history', 'data-icon': 'history' });
    const set = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', 'data-action': 'settings', 'data-icon': 'settings' });
    host.append(nightModeButton(settings.get().nightMode, (m) => settings.set({ nightMode: m })), hist, set);
    hydrateIcons(host);
  }
}

async function openAlertSheet(id: number, name: string): Promise<void> {
  await renderPassAlertControl($('[data-alert-body]'), { id, name }, await savedLocations.list(), () => closeSheet('#sheet-alert'));
  openSheet('#sheet-alert');
}

function buildHomeReticle(): void {
  const g = $('#screen-home .r-ticks');
  for (let a = 0; a < 360; a += 10) {
    const r = (a * Math.PI) / 180;
    const r0 = 112;
    const r1 = a % 30 === 0 ? 104 : 108;
    g.append(s('line', { x1: Math.sin(r) * r0, y1: -Math.cos(r) * r0, x2: Math.sin(r) * r1, y2: -Math.cos(r) * r1 }));
  }
}

function animateHome(): void {
  const root = $('#screen-home');
  const trace = $<SVGPathElement>('.r-trace', root);
  const sat = $<SVGCircleElement>('.r-sat', root);
  const len = trace.getTotalLength();
  const p = { t: 0 };
  gsap.killTweensOf(p);
  if (reduce()) {
    trace.style.strokeDashoffset = '0';
    const pt = trace.getPointAtLength(len * 0.55);
    sat.setAttribute('cx', String(pt.x));
    sat.setAttribute('cy', String(pt.y));
    return;
  }
  gsap.set(trace, { strokeDasharray: len, strokeDashoffset: len });
  gsap.to(p, {
    t: 1,
    duration: 4.2,
    ease: 'none',
    repeat: -1,
    repeatDelay: 1.4,
    onUpdate: () => {
      const pt = trace.getPointAtLength(p.t * len);
      sat.setAttribute('cx', pt.x.toFixed(2));
      sat.setAttribute('cy', pt.y.toFixed(2));
      trace.style.strokeDashoffset = String(len * (1 - p.t));
    },
  });
  gsap.from($$('.seq-step', root), { opacity: 0, x: 10, duration: 0.5, stagger: 0.12, delay: 0.3, ease: 'power2.out' });
  // Interactive: the crosshair follows the pointer inside the ring and the readout responds.
  const svg = $<SVGSVGElement>('.home-reticle', root);
  const cross = $$<SVGLineElement>('.r-cross', svg);
  svg.parentElement!.onpointermove = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width - 0.5) * 2;
    const y = ((ev.clientY - r.top) / r.height - 0.5) * 2;
    const k = Math.min(1, Math.hypot(x, y));
    const ox = x * 60 * k;
    const oy = y * 60 * k;
    cross.forEach((l) => l.setAttribute('transform', `translate(${ox.toFixed(1)} ${oy.toFixed(1)})`));
    setText($('[data-home-az]', root), `AZ ${(247.3 + x * 18).toFixed(1)}°`);
    setText($('[data-home-el]', root), `EL ${(61.8 - y * 14).toFixed(1)}°`);
  };
}

/* ───────────────────────── permissions ───────────────────────── */

function setPermState(name: string, text: string, tone: '' | 'ok' | 'warn' | 'error'): void {
  const el = $(`[data-perm="${name}"] [data-state]`);
  setText(el, text);
  el.dataset.tone = tone;
}

function updatePermissionStates(): void {
  const loc = location;
  if (loc.status === 'granted') {
    const acc = loc.observer?.accuracyM;
    setPermState('location', `ACQUIRED${acc ? ` ±${Math.round(acc)}M` : ''}`, 'ok');
  } else if (loc.status === 'manual') setPermState('location', 'MANUAL COORDINATES', 'ok');
  else if (loc.status === 'requesting') setPermState('location', 'LOCATING…', '');
  else if (loc.status === 'denied') setPermState('location', 'DENIED', 'error');
  else if (loc.status === 'unavailable') setPermState('location', 'UNAVAILABLE', 'warn');
  else setPermState('location', 'REQUIRED', '');

  const locBtn = $('[data-action="perm-location"]');
  locBtn.dataset.state = loc.observer ? 'done' : '';
  const locText = $('[data-perm="location"] p');
  setText(
    locText,
    loc.status === 'denied'
      ? 'SkyTrace needs your approximate position to calculate satellite paths from your point of view. Allow location in your browser settings, or enter coordinates.'
      : 'Required to calculate the sky as seen from your position.',
  );

  const o = orientation.status;
  const map: Record<string, [string, '' | 'ok' | 'warn' | 'error']> = {
    idle: ['REQUIRED', ''],
    requesting: ['WAITING FOR SENSOR', ''],
    live: ['LIVE', 'ok'],
    denied: ['DENIED · MANUAL MODE AVAILABLE', 'error'],
    unsupported: ['UNAVAILABLE · MANUAL MODE', 'warn'],
    silent: ['NO SENSOR DATA · MANUAL MODE', 'warn'],
  };
  setPermState('orientation', ...map[o]);
  $('[data-perm="orientation"] .btn').dataset.state = o === 'live' ? 'done' : '';

  const c = camera.status;
  setPermState('camera', c === 'on' ? 'ON' : c === 'denied' ? 'NOT ALLOWED' : c === 'unsupported' ? 'UNAVAILABLE' : 'OPTIONAL', c === 'on' ? 'ok' : c === 'denied' ? 'warn' : '');
  $('[data-perm="camera"] .btn').dataset.state = c === 'on' ? 'done' : '';

  ($('[data-action="open-scanner"]') as HTMLButtonElement).disabled = !loc.observer;
}

async function requestLocation(): Promise<void> {
  try {
    await location.request();
    haptic('select');
  } catch {
    if (location.status === 'denied') toast('LOCATION DENIED · ENTER COORDINATES INSTEAD', 'warn', 4200);
    else toast('COULD NOT GET A POSITION FIX', 'warn');
  }
  updatePermissionStates();
}

function requestOrientation(): void {
  // Must run synchronously inside the click for iOS motion permission.
  void orientation.request().then(() => {
    updatePermissionStates();
    onOrientationChange();
  });
}

async function setCamera(on: boolean): Promise<void> {
  const btn = $('[data-action="camera"]');
  if (on) {
    const ok = await camera.start();
    if (!ok) {
      toast('NO PROBLEM · SCANNER RUNS ON THE ASTRONOMY BACKGROUND', 'info', 4200);
      if (settings.get().camera) settings.set({ camera: false });
    }
  } else camera.stop();
  const live = camera.status === 'on';
  document.body.classList.toggle('camera-on', live);
  scanner.renderer.cameraOn = live;
  btn.setAttribute('aria-pressed', String(live));
  updatePermissionStates();
}

/* ───────────────────────── scanner ───────────────────────── */

function openScanner(manual = false): void {
  if (!settings.get().onboarded) settings.set({ onboarded: true });
  show('scanner', {});
  const useManual = manual || orientation.status === 'unsupported' || orientation.status === 'silent' || orientation.status === 'denied';
  scanner.setMode(useManual ? 'manual' : 'live');
  $('[data-action="manual"]').setAttribute('aria-pressed', String(useManual));
  if (settings.get().camera) void setCamera(true);
  onOrientationChange();
  updateOrbitStatus();
  if (useManual) setTimeout(() => scanner.manual.focusMap(), 400);
}

function onOrientationChange(): void {
  if (app.screen !== 'scanner') return;
  const prompt = $('[data-sensor-prompt]');
  const st = orientation.status;
  const inLive = scanner.mode === 'live';
  if ((st === 'silent' || st === 'unsupported') && inLive) {
    if (!app.silentWarned) {
      app.silentWarned = true;
      toast('ORIENTATION UNAVAILABLE · MANUAL SKY SELECTOR ENABLED', 'warn', 4500);
    }
    scanner.setMode('manual');
    $('[data-action="manual"]').setAttribute('aria-pressed', 'true');
    prompt.hidden = true;
    return;
  }
  if (inLive && st !== 'live' && st !== 'requesting') {
    prompt.hidden = false;
    const denied = st === 'denied';
    setText($('[data-sensor-title]', prompt), denied ? 'ORIENTATION UNAVAILABLE' : 'SKY SENSORS OFF');
    setText(
      $('[data-sensor-text]', prompt),
      denied ? 'Your browser cannot provide reliable orientation data. Use the manual sky selector.' : 'Orientation sensors are needed to follow where your phone points.',
    );
    const b = $('.btn', prompt);
    setText(b, denied ? 'USE MANUAL SELECTOR' : 'ENABLE SKY SENSORS');
    b.dataset.action = denied ? 'manual' : 'perm-orientation';
  } else prompt.hidden = true;
}

function showCalibration(needed: boolean): void {
  const el = $('[data-calibration]');
  const recentlyDismissed = Date.now() - app.calibrationDismissedAt < 60_000;
  const want = needed && !recentlyDismissed && !app.tracing;
  if (el.hidden === !want) return;
  el.hidden = !want;
}

function toggleManual(): void {
  if (scanner.mode === 'manual') {
    if (orientation.status !== 'live') {
      requestOrientation();
      if (orientation.status === 'denied' || orientation.status === 'unsupported' || orientation.status === 'silent') {
        toast('ORIENTATION SENSORS UNAVAILABLE ON THIS DEVICE', 'warn');
        return;
      }
    }
    scanner.setMode('live');
  } else {
    const p = scanner.currentPointing();
    scanner.manual.set(p.az, Math.max(0, p.el), true);
    scanner.setMode('manual');
    setTimeout(() => scanner.manual.focusMap(), 50);
  }
  $('[data-action="manual"]').setAttribute('aria-pressed', String(scanner.mode === 'manual'));
  onOrientationChange();
}

/* ───────────────────────── orbital data ───────────────────────── */

async function refreshOrbits(force: boolean): Promise<void> {
  const st = settings.get();
  setText($('[data-orbit-status]'), 'LOADING ORBITS');
  try {
    const res = await loadOrbits(st.datasets, st.refreshHours * 3_600_000, { force });
    if (res.records.length) {
      const ready = await client.load(res.records);
      setRecords(res.records);
      app.orbit = { count: ready.count, fetchedAt: res.oldestFetch, source: res.source };
      if (res.errors.length && res.source === 'cache' && navigator.onLine && force) toast('ORBIT REFRESH FAILED · USING LOCAL ORBIT CACHE', 'warn');
      if (force && res.source !== 'cache') toast(`ORBITS UPDATED · ${ready.count.toLocaleString('en-US')} OBJECTS`, 'ok');
    } else if (app.orbit.source !== 'simulated') {
      app.orbit = { count: 0, fetchedAt: null, source: 'none' };
    }
  } catch {
    if (app.orbit.source !== 'simulated') app.orbit = { count: 0, fetchedAt: null, source: 'none' };
  }
  updateOrbitStatus();
}

/** Real stars + constellation figures behind the trace scanner (V2). */
async function feedScannerSky(): Promise<void> {
  if (app.screen !== 'scanner') return;
  const o = observer();
  const d = await skyDatasets();
  if (!o || !d) return;
  try {
    const field = await sky.field(o, Date.now(), 4.5);
    scanner.renderer.realSky = { field, cat: d.stars, lines: d.constellations.constellations.flatMap((c) => c.lines) };
  } catch {
    /* sky worker not ready */
  }
}

/** V1 kept saved satellite IDs in settings; move them into the V2 local-first store once. */
async function migrateV1Favourites(): Promise<void> {
  const ids = settings.get().savedSatellites;
  if (!ids.length) return;
  for (const id of ids) if (!(await savedSatellites.find(id))) await savedSatellites.toggle(id, satMetaName(id));
  settings.set({ savedSatellites: [] });
}
const satMetaName = (id: number): string => satMeta.get(id)?.name ?? `NORAD ${id}`;

async function useSimulated(): Promise<void> {
  const recs = generateSimulatedOrbits(Date.now());
  const ready = await client.load(recs);
  setRecords(recs);
  app.orbit = { count: ready.count, fetchedAt: Date.now(), source: 'simulated' };
  updateOrbitStatus();
  toast('SIMULATED ORBITS LOADED · NOT REAL OBJECTS', 'warn', 4200);
}

async function useAllCached(): Promise<void> {
  const sum = await cacheSummary();
  const groups = sum.groups.map((g) => g.group);
  if (!groups.length) return;
  const res = await loadOrbits(groups, Number.MAX_SAFE_INTEGER, { online: false });
  if (res.records.length) {
    const ready = await client.load(res.records);
    setRecords(res.records);
    app.orbit = { count: ready.count, fetchedAt: res.oldestFetch, source: 'cache' };
    updateOrbitStatus();
  }
}

function updateOrbitStatus(): void {
  const st = orbitStatusText(app.orbit);
  const el = $('[data-orbit-status]');
  setText(el, st.text);
  el.dataset.tone = st.tone;
}

/* ───────────────────────── trace ───────────────────────── */

async function trace(opts: { reuseTarget?: boolean } = {}): Promise<void> {
  if (app.tracing) return;
  const obs = observer();
  if (!obs) {
    toast('LOCATION NEEDED TO CALCULATE YOUR SKY', 'warn');
    show('permissions');
    return;
  }
  if (app.orbitsLoading) await app.orbitsLoading;
  if (!app.orbit.count) {
    showNoOrbitData();
    return;
  }

  void location.refreshIfStale();
  const st = settings.get();
  const btn = $('[data-action="trace"]');
  const target = opts.reuseTarget && app.session ? { az: app.session.request.target.azimuth, el: app.session.request.target.elevation } : scanner.freeze();
  if (opts.reuseTarget && app.session) scanner.freeze();
  scanner.setMode('locked');
  haptic('lock');
  $('[data-calibration]').hidden = true;

  const now = Date.now();
  const sighting = app.sightingQueued;
  let startTime = now - st.windowMin * 60_000;
  let endTime = now;
  let upcomingEnd: number | null = now + UPCOMING_MS;
  let sq: SightingQuery | undefined;
  if (sighting) {
    startTime = sighting.time - 4 * 60_000;
    endTime = Math.min(now, sighting.time + 2 * 60_000);
    upcomingEnd = null;
    sq = { time: sighting.time, toleranceS: 240, direction: sighting.direction };
  }

  const requestId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const request: TraceRequest = {
    requestId,
    observer: obs,
    target: { azimuth: target.az, elevation: target.el, radius: st.fieldRadius },
    startTime,
    endTime,
    upcomingEnd,
    now,
    sighting: sq,
  };
  const traceId = `TRACE / ${target.az.toFixed(1)} / ${target.el >= 0 ? '+' : '−'}${Math.abs(target.el).toFixed(1)} / ${zulu(now)}`;

  // Scanning state: lock, ring flight, dim, sweeps, live counter.
  app.tracing = requestId;
  const sc = $('#screen-scanner');
  sc.dataset.busy = 'true';
  const overlay = $('[data-scan-overlay]');
  const count = $('[data-scan-count]');
  setText(count, '0');
  if (!opts.reuseTarget) await launchRing(btn, scanner.ringScreen(), reduce());
  overlay.hidden = false;
  gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  gsap.to(scanner.renderer, { dim: 1, duration: 0.5 });
  scanner.renderer.startScanSweeps(performance.now());
  const stopFlashes = coordinateFlashes($('[data-scan-flash]'), target, startTime, endTime);

  const started = performance.now();
  try {
    const result = await client.trace(request, (checked) => setText(count, checked.toLocaleString('en-US')));
    // Keep the sweep visible long enough to read; the counter shows real work, not fake progress.
    const elapsed = performance.now() - started;
    if (elapsed < 1100 && !reduce()) await new Promise((r) => setTimeout(r, 1100 - elapsed));
    setText(count, result.checked.toLocaleString('en-US'));

    app.session = { traceId, request, result, sighting, windowMin: st.windowMin };
    app.list = 'past';
    app.sort = 'recent';
    haptic('success');
    // Trace history (V2): ID, direction, time, matches, sensor accuracy; position only if opted in.
    if (st.keepHistory) {
      void traces.add({
        trace_id: traceId,
        trace_time: new Date(now).toISOString(),
        latitude: st.storeLocationHistory ? obs.latitude : null,
        longitude: st.storeLocationHistory ? obs.longitude : null,
        target_azimuth: target.az,
        target_elevation: target.el,
        field_radius: st.fieldRadius,
        time_window: sighting ? Math.round((endTime - startTime) / 60000) : st.windowMin,
        match_count: result.past.length,
        selected_norad_id: null,
        sensor_accuracy: scanner.mode === 'manual' ? null : scanner.confidence.accuracyDeg,
        matches: result.past.slice(0, 25).map((c) => ({ norad_id: c.catalogId, name: c.name, closest: c.closestTime, min_distance: c.minAngularDistance, path: c.path.filter((_, i) => i % 2 === 0) })),
      });
    }
    openResults();
    setTimeout(maybeOfferInstall, 2600);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== 'CANCELLED') toast(`TRACE FAILED · ${msg.toUpperCase()}`, 'error');
    unlock();
  } finally {
    stopFlashes();
    scanner.renderer.stopScanSweeps();
    gsap.to(scanner.renderer, { dim: 0, duration: 0.5 });
    overlay.hidden = true;
    sc.dataset.busy = 'false';
    app.tracing = null;
    app.sightingQueued = null;
    setText($('[data-trace-label]'), 'TRACE THIS SKY');
    $('[data-action="sighting"]').setAttribute('aria-pressed', 'false');
    offerIfIdle();
  }
}

function cancelTrace(): void {
  if (app.tracing) client.cancel(app.tracing);
}

function unlock(): void {
  scanner.unfreeze();
  scanner.setMode(scanner.baseMode);
  scanner.setGhosts([]);
}

/* ───────────────────────── results ───────────────────────── */

function openResults(): void {
  scanner.setSheetOpen(true);
  renderResults(true);
  openSheet('#sheet-results');
}

function closeResults(): void {
  closeSheet('#sheet-results', () => {
    scanner.setSheetOpen(false);
    unlock();
  });
}

function renderResults(animate: boolean): void {
  const ses = app.session;
  if (!ses) return;
  const root = $('#sheet-results');
  const { result, request } = ses;
  const sighting = !!ses.sighting;
  const list = app.list === 'past' ? result.past : result.upcoming;
  const windowText = fmtWindow(ses.windowMin).toLowerCase();

  $('.results-controls', root).hidden = false;
  $$('[data-list]', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.list === app.list)));
  $$('[data-sort]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sort === app.sort)));
  $('[data-sort-group]', root).hidden = sighting || app.list === 'upcoming';
  ($('[data-list="upcoming"]', root) as HTMLButtonElement).hidden = sighting;

  let title = 'TRACE COMPLETE';
  let sub = '';
  if (sighting) {
    title = list.length ? 'POSSIBLE MATCHES' : 'NO LIKELY MATCH';
    sub = list.length
      ? `${list.length} tracked object${list.length === 1 ? '' : 's'} crossed this field around ${ses.sighting!.label.toLowerCase()}. Ranked by closeness, timing and direction.`
      : 'No tracked object crossed this field around that time. It may have been an aircraft, a satellite outside the selected datasets, or the pointing was off.';
  } else if (app.list === 'past') {
    title = list.length ? 'TRACE COMPLETE' : 'CLEAR FIELD';
    sub = list.length
      ? `${list.length} tracked object${list.length === 1 ? '' : 's'} crossed this field during the previous ${windowText}.`
      : 'No tracked objects crossed the selected region during the current trace window.';
  } else {
    title = 'NEXT CROSSINGS';
    sub = list.length
      ? `${list.length} object${list.length === 1 ? '' : 's'} predicted to enter this field in the next 2 hours.`
      : 'No tracked objects are predicted to enter this field in the next 2 hours.';
  }
  setText($('[data-results-title]', root), title);
  setText($('[data-results-sub]', root), sub);
  setText($('[data-trace-id]', root), ses.traceId);

  const notes = [
    `${result.checked.toLocaleString('en-US')} OBJECTS CHECKED`,
    `ELEMENTS ~${result.medianEpochDays.toFixed(1)} D OLD`,
    `FIELD ${request.target.radius}°`,
    scanner.mode !== 'manual' && orientation.status === 'live' ? `POINTING ±${scanner.confidence.accuracyDeg.toFixed(0)}°` : 'MANUAL AIM',
    `${result.elapsedMs} MS`,
  ];
  if (app.orbit.source === 'simulated') notes.unshift('SIMULATED ORBITS — NOT REAL OBJECTS');
  else if (!navigator.onLine) notes.unshift('LOCAL ORBIT CACHE');
  setText($('[data-data-note]', root), notes.join(' · '));

  const host = $('[data-timeline]', root);
  if (!list.length || (app.sort === 'visible' && !list.some((c) => c.visibility === 'LIKELY_VISIBLE') && app.list === 'past' && !sighting)) {
    renderEmpty(host, app.sort === 'visible' && list.length > 0);
  } else {
    const tl = renderTimeline(host, list, {
      kind: app.list,
      windowStart: request.startTime,
      windowEnd: app.list === 'past' ? request.endTime : request.upcomingEnd ?? request.endTime,
      now: request.now,
      radius: request.target.radius,
      sort: app.sort,
      sighting,
      sightingTime: ses.sighting?.time,
      sightingDirection: ses.sighting?.direction ?? null,
      onSelect: (c, origin) => openDetail(c, origin),
    });
    if (animate) requestAnimationFrame(() => revealTimeline(tl, reduce()));
  }
  // Signature: traced orbital paths visibly intersect the reticle.
  scanner.setGhosts(list.slice(0, 40).map((c) => ({ id: c.satelliteId + c.closestTime, path: c.path, highlight: false })));
}

function renderEmpty(host: HTMLElement, visibleOnly: boolean): void {
  clear(host);
  const st = settings.get();
  const ses = app.session!;
  const svg = s(
    'svg',
    { viewBox: '0 0 160 120', 'aria-hidden': 'true' },
    s('circle', { class: 'e-ring', cx: 80, cy: 60, r: 26 }),
    s('path', { class: 'e-orbit', d: 'M 0 104 Q 60 96 160 20', id: 'e-orbit-path' }),
    s('circle', { class: 'e-sat', r: 2, style: "offset-path: path('M 0 104 Q 60 96 160 20'); animation: empty-orbit 6s linear infinite" }),
  );
  const actions = h('div', { class: 'empty-actions' });
  if (visibleOnly) {
    host.append(h('div', { class: 'empty' }, svg, h('p', { class: 'empty-title mono' }, 'NOTHING LIKELY VISIBLE'), h('p', {}, 'Objects crossed this field, but none were sunlit against a dark sky.')));
    return;
  }
  if (ses.request.target.radius < 12) {
    const b = h('button', { class: 'btn small' }, 'WIDEN FIELD');
    b.addEventListener('click', () => {
      settings.set({ fieldRadius: 12 });
      rerun();
    });
    actions.append(b);
  }
  if (st.windowMin < 180 && app.list === 'past' && !ses.sighting) {
    const b = h('button', { class: 'btn small' }, 'EXTEND TIME');
    b.addEventListener('click', () => {
      settings.set({ windowMin: 180 });
      rerun();
    });
    actions.append(b);
  }
  const hint =
    app.list === 'upcoming'
      ? 'Try a wider field, or point closer to the zenith where more orbits pass.'
      : ses.request.target.radius < 12 || st.windowMin < 180
        ? 'Widen the trace to 12° or search the previous 3 hours.'
        : 'Try another region of the sky, or add datasets in settings.';
  host.append(
    h('div', { class: 'empty' }, svg, h('p', { class: 'empty-title mono' }, app.list === 'upcoming' ? 'NO PREDICTED CROSSINGS' : 'NO TRACKED OBJECTS CROSSED THIS FIELD'), h('p', {}, hint), actions),
  );
}

function rerun(): void {
  closeSheet('#sheet-results', () => {
    scanner.setSheetOpen(false);
    void trace({ reuseTarget: true });
  });
}

function showNoOrbitData(): void {
  const root = $('#sheet-results');
  setText($('[data-results-title]', root), 'NO ORBIT DATA');
  setText($('[data-results-sub]', root), 'Orbital data is currently unavailable.');
  setText($('[data-trace-id]', root), '');
  setText($('[data-data-note]', root), navigator.onLine ? 'THE ORBITAL-DATA SOURCE COULD NOT BE REACHED.' : 'YOU ARE OFFLINE AND NO ORBITAL DATA IS CACHED YET.');
  $('.results-controls', root).hidden = true;
  const host = $('[data-timeline]', root);
  clear(host);
  const actions = h('div', { class: 'empty-actions' });
  const retry = h('button', { class: 'btn small' }, 'RETRY');
  retry.addEventListener('click', async () => {
    setText(retry, 'LOADING…');
    await refreshOrbits(true);
    if (app.orbit.count) closeSheet('#sheet-results', () => scanner.setSheetOpen(false));
    else setText(retry, 'RETRY');
  });
  actions.append(retry);
  void cacheSummary().then((sum) => {
    if (sum.groups.length) {
      const b = h('button', { class: 'btn small' }, 'USE CACHED DATA');
      b.addEventListener('click', async () => {
        await useAllCached();
        closeSheet('#sheet-results', () => scanner.setSheetOpen(false));
      });
      actions.prepend(b);
    }
  });
  const demo = h('button', { class: 'btn small btn-quiet' }, 'RUN SIMULATED DEMO');
  demo.addEventListener('click', async () => {
    await useSimulated();
    closeSheet('#sheet-results', () => scanner.setSheetOpen(false));
  });
  actions.append(demo);
  host.append(h('div', { class: 'empty' }, h('p', {}, 'SkyTrace needs published orbital elements to trace the sky. The demo uses simulated, clearly labelled orbits.'), actions));
  scanner.setSheetOpen(true);
  openSheet('#sheet-results');
}

/* ───────────────────────── detail & replay ───────────────────────── */

async function openDetail(c: Crossing, origin: HTMLElement): Promise<void> {
  haptic('select');
  app.selected = c;
  const ses = app.session!;
  scanner.setGhosts(
    (app.list === 'past' ? ses.result.past : ses.result.upcoming).slice(0, 40).map((x) => ({ id: x.satelliteId + x.closestTime, path: x.path, highlight: x === c })),
  );
  const past = ses.result.past.filter((x) => x.catalogId === c.catalogId).sort((a, b) => b.closestTime - a.closestTime);
  const next = ses.result.upcoming.filter((x) => x.catalogId === c.catalogId).sort((a, b) => a.entryTime - b.entryTime);
  const closest = [...ses.result.past].sort((a, b) => a.minAngularDistance - b.minAngularDistance)[0];
  const base = {
    crossing: c,
    info: null,
    meta: null,
    lastCrossing: past[0] ?? null,
    nextCrossing: next[0] ?? null,
    isClosest: c === closest,
    units: settings.get().units,
    now: Date.now(),
  };
  detail.render(base, reduce());
  const saveBtn = $('[data-action="save-sat"]');
  saveBtn.setAttribute('aria-pressed', String(!!(await savedSatellites.find(c.catalogId))));
  if (settings.get().keepHistory) void traces.select(ses.traceId, c.catalogId);

  // Transition: the selected timeline point expands into the detail view.
  const el = $('#screen-detail');
  const dot = origin.querySelector('.tl-dot')?.getBoundingClientRect() ?? origin.getBoundingClientRect();
  const x = dot.left + dot.width / 2;
  const y = dot.top + dot.height / 2;
  el.hidden = false;
  if (!reduce()) {
    gsap.fromTo(el, { clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(150% at ${x}px ${y}px)`, duration: 0.6, ease: 'power3.inOut', onComplete: () => gsap.set(el, { clearProps: 'clipPath' }) });
  }
  el.focus({ preventScroll: true });
  el.scrollTop = 0;

  const [info, meta] = await Promise.all([client.info(c.catalogId, observer()), c.simulated ? Promise.resolve(null) : satelliteMetadata(c.catalogId)]);
  if (app.selected !== c) return;
  detail.render({ ...base, info, meta, now: Date.now() }, reduce());
}

function closeDetail(): void {
  const el = $('#screen-detail');
  detail.stop();
  gsap.to(el, {
    opacity: 0,
    duration: reduce() ? 0.1 : 0.25,
    onComplete: () => {
      el.hidden = true;
      gsap.set(el, { clearProps: 'opacity' });
    },
  });
  app.selected = null;
  renderResults(false);
}

function startReplay(): void {
  const c = app.selected;
  if (!c || !app.session) return;
  detail.stop();
  $('#screen-detail').hidden = true;
  $('#sheet-results').hidden = true;
  scanner.setSheetOpen(false);
  scanner.setMode('replay');
  scanner.setGhosts([]);
  const bar = $('[data-replay]');
  bar.hidden = false;
  setText($('[data-replay-name]', bar), c.name);
  const scrub = $<HTMLInputElement>('[data-replay-scrub]', bar);
  const toggleBtn = $('[data-action="replay-toggle"]', bar);
  app.replay?.destroy();
  app.replay = new TrajectoryReplay(
    c.path,
    (f) => {
      scanner.setReplay({ path: c.path, drawIn: f.drawIn, time: f.time });
      setText($('[data-replay-start]', bar), utcLocal(c.path[0].t));
      setText($('[data-replay-end]', bar), utcLocal(c.path[c.path.length - 1].t));
      setText($('[data-replay-now]', bar), utcLocal(f.time));
      scrub.value = String(Math.round(f.progress * 1000));
      setIcon(toggleBtn, f.playing ? 'pause' : 'play');
      toggleBtn.setAttribute('aria-label', f.playing ? 'Pause replay' : 'Play replay');
    },
    reduce(),
  );
  gsap.fromTo(bar, { opacity: 0, y: reduce() ? 0 : 12 }, { opacity: 1, y: 0, duration: 0.4 });
}

function utcLocal(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function closeReplay(): void {
  app.replay?.destroy();
  app.replay = null;
  scanner.setReplay(null);
  $('[data-replay]').hidden = true;
  app.selected = null;
  if (app.replayReturn) {
    const back = app.replayReturn;
    app.replayReturn = null;
    scanner.unfreeze();
    scanner.setMode(scanner.baseMode);
    show(back);
    return;
  }
  scanner.setMode('locked');
  openResults();
}

/** Replay a stored path (observation / trace history) across its field, offline. */
function startReplayPath(r: ReplayRequest): void {
  if (r.path.length < 2) return;
  closeSheet('#sheet-object');
  app.replayReturn = app.screen;
  show('scanner', {});
  scanner.setRadius(r.radius);
  scanner.freezeTo(r.target);
  scanner.setMode('replay');
  scanner.setGhosts([]);
  const bar = $('[data-replay]');
  bar.hidden = false;
  setText($('[data-replay-name]', bar), r.name);
  const scrub = $<HTMLInputElement>('[data-replay-scrub]', bar);
  const toggleBtn = $('[data-action="replay-toggle"]', bar);
  app.replay?.destroy();
  app.replay = new TrajectoryReplay(
    r.path,
    (f) => {
      scanner.setReplay({ path: r.path, drawIn: f.drawIn, time: f.time });
      setText($('[data-replay-start]', bar), utcLocal(r.path[0].t));
      setText($('[data-replay-end]', bar), utcLocal(r.path[r.path.length - 1].t));
      setText($('[data-replay-now]', bar), utcLocal(f.time));
      scrub.value = String(Math.round(f.progress * 1000));
      setIcon(toggleBtn, f.playing ? 'pause' : 'play');
    },
    reduce(),
  );
}

/* ───────────────────────── actions ───────────────────────── */

function wireActions(): void {
  document.addEventListener('click', (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const a = el.dataset.action!;
    switch (a) {
      case 'begin':
        settings.set({ onboarded: true });
        show('permissions');
        break;
      case 'perm-location':
        void requestLocation();
        break;
      case 'perm-orientation':
        requestOrientation();
        break;
      case 'perm-camera':
        settings.set({ camera: true });
        void setCamera(true);
        break;
      case 'open-scanner':
        settings.set({ onboarded: true });
        show('live');
        break;
      case 'open-manual':
        if (!observer()) {
          toast('SET YOUR LOCATION FIRST', 'warn');
          return;
        }
        settings.set({ onboarded: true });
        openScanner(true);
        break;
      case 'trace':
        void trace();
        break;
      case 'cancel-trace':
        cancelTrace();
        break;
      case 'manual':
        toggleManual();
        break;
      case 'camera':
        settings.set({ camera: !(camera.status === 'on') });
        if (!settings.get().camera) void setCamera(false);
        break;
      case 'settings':
        void settingsPanel.render().then(() => openSheet('#sheet-settings'));
        break;
      case 'close-settings':
        closeSheet('#sheet-settings');
        break;
      case 'sighting':
        if (app.sightingQueued) {
          app.sightingQueued = null;
          setText($('[data-trace-label]'), 'TRACE THIS SKY');
          el.setAttribute('aria-pressed', 'false');
          break;
        }
        sightingPanel.render();
        openSheet('#sheet-sighting');
        break;
      case 'close-sighting':
        closeSheet('#sheet-sighting');
        break;
      case 'close-results':
        closeResults();
        break;
      case 'close-detail':
        closeDetail();
        break;
      case 'save-sat': {
        const c = app.selected;
        if (!c) break;
        void savedSatellites.toggle(c.catalogId, c.name).then((on) => {
          el.setAttribute('aria-pressed', String(on));
          toast(on ? 'SATELLITE SAVED' : 'SATELLITE REMOVED', 'ok', 1800);
        });
        break;
      }
      case 'log-observation': {
        const c = app.selected;
        const ses = app.session;
        if (!c || !ses) break;
        const st = settings.get();
        const o = ses.request.observer;
        const conf = c.matchTier === 'BEST MATCH' || c.minAngularDistance < ses.request.target.radius * 0.35 ? 'HIGH' : c.minAngularDistance < ses.request.target.radius * 0.7 ? 'MEDIUM' : 'LOW';
        void observations
          .add({
            norad_id: c.catalogId,
            satellite_name: c.name,
            observed_at: new Date(c.closestTime).toISOString(),
            latitude: st.storeLocationHistory ? o.latitude : null,
            longitude: st.storeLocationHistory ? o.longitude : null,
            azimuth: ses.request.target.azimuth,
            elevation: ses.request.target.elevation,
            match_confidence: conf,
            path: c.path,
            trace_id: ses.traceId,
            field_radius: ses.request.target.radius,
          })
          .then(() => toast(`OBSERVATION LOGGED · ${c.name}`, 'ok'));
        break;
      }
      case 'detail-alert':
        if (app.selected) void openAlertSheet(app.selected.catalogId, app.selected.name);
        break;
      case 'open-live':
        show('live');
        break;
      case 'go-history':
        show('history');
        break;
      case 'live-view':
        live.toggleView();
        break;
      case 'live-camera':
        void live.toggleCamera();
        break;
      case 'live-locate':
        live.recentre();
        break;
      case 'close-object':
        closeSheet('#sheet-object');
        break;
      case 'close-pass':
        closeSheet('#sheet-pass');
        break;
      case 'close-alert':
        closeSheet('#sheet-alert');
        break;
      case 'replay':
        startReplay();
        break;
      case 'replay-toggle':
        app.replay?.toggle();
        break;
      case 'replay-again':
        app.replay?.play(true);
        break;
      case 'replay-close':
        closeReplay();
        break;
      case 'dismiss-calibration':
        app.calibrationDismissedAt = Date.now();
        $('[data-calibration]').hidden = true;
        break;
    }
  });

  $('[data-nav]').addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLElement>('[data-nav-to]');
    if (!b) return;
    const to = b.dataset.navTo as ScreenId;
    if (to === 'scanner') openScanner();
    else show(to);
  });

  $('[data-replay-scrub]').addEventListener('input', (ev) => app.replay?.scrub(Number((ev.target as HTMLInputElement).value) / 1000));

  $('#sheet-results').addEventListener('click', (ev) => {
    const t = (ev.target as Element).closest<HTMLElement>('[data-list],[data-sort]');
    if (!t) return;
    if (t.dataset.list) app.list = t.dataset.list as 'past' | 'upcoming';
    if (t.dataset.sort) app.sort = t.dataset.sort as SortMode;
    renderResults(true);
  });

  $<HTMLFormElement>('[data-coord-form]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target as HTMLFormElement;
    const lat = Number((f.elements.namedItem('lat') as HTMLInputElement).value);
    const lon = Number((f.elements.namedItem('lon') as HTMLInputElement).value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('ENTER LATITUDE −90…90 AND LONGITUDE −180…180', 'warn');
      return;
    }
    location.setManual(lat, lon);
    updatePermissionStates();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#sheet-alert').hidden) closeSheet('#sheet-alert');
    else if (!$('#sheet-object').hidden) closeSheet('#sheet-object');
    else if (!$('#sheet-pass').hidden) closeSheet('#sheet-pass');
    else if (!$('#sheet-settings').hidden) closeSheet('#sheet-settings');
    else if (!$('#sheet-sighting').hidden) closeSheet('#sheet-sighting');
    else if (!$('#screen-detail').hidden) closeDetail();
    else if (scanner.mode === 'replay') closeReplay();
    else if (!$('#sheet-results').hidden) closeResults();
    else if (app.tracing) cancelTrace();
  });

  // Pause the render loop's camera when hidden; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) camera.stop();
    else if (settings.get().camera && app.screen === 'scanner') void setCamera(true);
  });
}

void boot();
