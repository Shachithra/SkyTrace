# SkyTrace V2

**Find what crossed your sky.** · *Know what is above you.*

SkyTrace is a mobile-first PWA: a live satellite observatory plus a constellation guide. It has four core experiences:

- **WATCH** — Live Sky: real satellites, real stars and real constellation figures, following the direction the phone points.
- **TRACE** — the V1 instrument: point at a patch of sky and find what crossed it.
- **IDENTIFY** — star-pattern matching and "What did I just see?".
- **OBSERVE** — upcoming passes, saved satellites, alerts and history.

Everything runs locally on the device, with no account needed. Supabase sync and push alerts are optional extras.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (exposed on your LAN with --host)
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build (service worker active)
npm run test:engine  # astronomy engine self-test: SGP4, sky math, constellations, pass prediction
```

> Location, orientation and camera all need a **secure context**. Use `localhost` on desktop. To test on a phone, serve over **HTTPS**: deploy `dist/` to any static HTTPS host (Netlify, Vercel, Cloudflare Pages, GitHub Pages), or tunnel your dev server.

### Rebuilding the star / constellation data

```bash
npm pack d3-celestial && tar xzf d3-celestial-*.tgz
D3C_DIR=./package/data node scripts/build-star-data.mjs   # writes public/data/*.v1.json
```

### Regenerating icons

`public/icons/icon.svg` is the source icon: a satellite trace passing through a targeting circle. To re-render the PNG sizes (48, 96, 192, 512, maskable 512, Apple touch, favicon):

```bash
npm i -D playwright && npx playwright install chromium
npm run icons
```

---

## What's new in V2

| Blueprint section | Where it lives |
|---|---|
| Live Sky Mode: stars, constellations, satellites above the horizon, live paths, compass, elevation, horizon, UTC, sensor accuracy, "N OBJECTS ABOVE HORIZON · N LIKELY VISIBLE" | `screens/liveSky.ts`, `ui/SkyView.ts` |
| Live satellite layer: filters ALL / VISIBLE / STATIONS / STARLINK / WEATHER / NAVIGATION / SCIENCE; small dot, short label (nearest or selected only), direction vector | `ui/SatelliteMarker.ts` |
| Trajectories: −5 min … NOW … +5 min, dimmer past, brighter future, bright marker, pulse along visible passes | `ui/TrajectoryPath.ts`, orbit worker `TRAJECTORY` |
| Upcoming passes: TONIGHT / NEXT 24 HOURS / FAVORITES / VISIBLE ONLY on a time-proportional timeline, with a polar sky plot per pass | `screens/passes.ts`, `ui/PassTimeline.ts`, `alerts/passPrediction.ts` |
| Visibility model: sun altitude and twilight, Earth-shadow illumination, range, elevation, object type and known brightness, giving LIKELY / POSSIBLY / NOT EXPECTED TO BE VISIBLE | `astronomy/visibility.ts` |
| Pass alerts: 5 / 10 / 15 / 30 min lead time, location, minimum elevation, visibility requirement, quiet hours; local notifications, app badge, optional Web Push | `alerts/*`, `ui/PassAlertControl.ts`, `public/sw-push.js`, `supabase/functions/*` |
| What did I just see?: JUST NOW / 5 / 10 / 30 MIN AGO / CUSTOM, direction filter; reports closest path, time difference and direction match | `ui/SightingPanel.ts`, `ui/TraceTimeline.ts` |
| Real stars: 5,044 Hipparcos stars (mag ≤ 6), precessed J2000 → date, with sidereal time, hour angle, Alt/Az and refraction | `stars/*`, `sky/*`, `workers/sky.worker.ts` |
| Constellations: 89 IAU figures (733 segments) and real IAU boundaries; reveal animation, focus mode, labels, pattern match (MATCH HIGH / MEDIUM / LOW, no percentages) | `stars/constellationData.ts`, `stars/constellationRenderer.ts` |
| Satellite + constellation context: "ISS CROSSING ORION · VISIBLE IN 48 SEC", "ENTERING …", "PASSING BELOW …", with a haptic pulse | `screens/liveSky.ts` (`refreshContext`) |
| Sky info panel (AZ / EL / RA / DEC / constellation / satellites / visible); star and constellation details including rise/set and satellite crossings tonight | `screens/objectSheet.ts` |
| Interactive all-sky map: zenith at the centre, horizon at the edge, N/E/S/W marked; drag, zoom (wheel or pinch), tap to select | `sky/skyProjection.ts` (`AllSkyProjector`) |
| Layers strip (SATELLITES / STARS / CONSTELLATIONS / LABELS / TRAJECTORIES); magnitude filter BRIGHT / STANDARD / DEEP | `ui/LayerControl.ts`, `stars/visibility.ts` |
| Night vision: DIM and RED LIGHT modes with slow, flash-free cross-fades | `ui/palette.ts`, `ui/NightModeControl.ts`, `styles/live.css` |
| Camera AR overlay: darkened feed with constellations, labels, satellites and paths; field-of-view calibration | `screens/liveSky.ts` (`toggleCamera`), Settings → AR FIELD OF VIEW |
| Saved satellites shown as 24-hour orbital timelines; saved locations (explicit and optional); observation and trace history with offline replay | `screens/saved.ts`, `screens/history.ts`, `history/*`, `sync/favorites.ts` |
| Local-first IndexedDB (orbits, stars, constellations, settings, favourites, history, alerts, outbox) with optional Supabase sync (Auth + Postgres + RLS) | `data/indexedDb.ts`, `data/userStore.ts`, `sync/*`, `supabase/` |
| PWA V2: app shortcuts (LIVE SKY / TRACE SKY / UPCOMING PASSES / WHAT DID I SEE?), offline star data, push, badge, update flow; offline status shows **LOCAL SKY MODE** with orbit age and star data version | `manifest.webmanifest`, `vite.config.ts`, `public/sw-push.js` |
| Navigation: SKY / TRACE / PASSES / SAVED, with HISTORY and SETTINGS as secondary | `index.html` (`[data-nav]`), `main.ts` |
| Workers: **orbit.worker** (propagation, live positions, pass prediction, historical crossings) and **sky.worker** (star conversion, filtering, constellation visibility and pattern lookups) | `src/workers/*` |

Features deliberately held back for V3 (per blueprint §52): social feed, profiles, comments, photo uploads, gamification, AI chat, astrophotography tools.

### Optional: accounts and sync

See [`supabase/README.md`](supabase/README.md) for setup. Copy `.env.example` to `.env.local`, or set the same variables in Vercel. Without them, the SAVED screen shows **GUEST MODE**.

## How it works

```
sensor event → latest orientation state → requestAnimationFrame → render     (main thread)
TRACE_REQUEST → coarse sampling → arc test → 1 s refinement → TRACE_COMPLETE (web worker)
```

1. **Pointing.** `sensors/orientation.ts` turns W3C `alpha/beta/gamma` into the rear camera's direction in East-North-Up coordinates. That vector is the negated third column of `Rz(α)·Rx(β)·Ry(γ)`. Android uses `deviceorientationabsolute`. On iOS, `webkitCompassHeading` references alpha to north. Smoothing works on unit vectors, never on raw angles, so 359° → 0° never jumps.
2. **Target model.** `{ targetAzimuth, targetElevation, angularRadius }`. A satellite matches when the **spherical** separation `atan2(|a×b|, a·b)` is at most the radius. Azimuths are never subtracted directly.
3. **Trace engine** (`astronomy/crossingDetector.ts`, in a Web Worker):
   - samples every object on a coarse grid (20 s for the past window, 30 s for look-ahead)
   - flags segments whose **great-circle arc** passes near the field, so fast LEO objects can't slip between samples
   - refines at 1 s, bisects entry and exit, and golden-sections the closest approach
   - walks outward to find the pass's rise and set azimuths, which give the direction label (`NW → SE`)
   - estimates visibility from the Sun's elevation, Earth-shadow illumination, the object's elevation and its range
   - ranks results by closeness, timing, duration, elevation and likely visibility
4. **Orbital data.** CelesTrak GP data in **OMM JSON** (not legacy TLE), validated and de-duplicated, then cached in **IndexedDB**. A dataset is never re-downloaded within 2 hours. The default refresh interval is 6 hours, and failures back off for 20 minutes.

### Engine self-test results

`npm run test:engine` checks the following:

- Look angles match `satellite.js`'s reference pipeline (max error ~4×10⁻⁶°).
- Spherical separation handles the azimuth wrap and the zenith correctly.
- A crossing planted at a known time and place is recovered within 0 s, at ~0.000°.
- A 3° field with a 30 s coarse step still catches a 7.6 km/s pass.
- 1,600 objects × (60 min back + 2 h ahead) run in about 1 s on a desktop CPU.

---

## Project structure

```
skytrace/
├── index.html                 screens & semantic markup (CSP injected at build)
├── manifest.webmanifest       single source of truth for the PWA manifest
├── vite.config.ts             Vite + vite-plugin-pwa (Workbox) + CSP + dev proxy
├── public/icons|favicon|textures
├── scripts/engine-test.ts     Node self-test of the astronomy engine
├── scripts/make-icons.mjs     icon renderer
└── src/
    ├── main.ts                app orchestration / state machine
    ├── styles/                reset · tokens · typography · layout · animations · scanner
    ├── ui/                    SkyScanner, SkyRenderer, SkyReticle, CompassArc, ElevationScale,
    │                          SensorStatus, TraceTimeline, SatelliteDetail, ManualSkyMap,
    │                          SettingsPanel, SightingPanel, Toast, controls, dom
    ├── sensors/               location · orientation · calibration · camera
    ├── astronomy/             types · orbitLoader · propagator · lookAngles · angularDistance ·
    │                          crossingDetector · direction · visibility · time · demoData ·
    │                          trace.worker · traceClient
    ├── data/                  indexedDb · orbitalCache · datasets · settings · satcat
    ├── pwa/                   install · update · offline
    ├── animations/            introSequence · scannerMotion · traceSequence ·
    │                          timelineMotion · trajectoryReplay
    └── utils/                 math · degrees · throttle · format · haptics
```

---

## Blueprint coverage

| Area | Status |
|---|---|
| Splash / intro (1.2–1.8 s, single satellite on an arc, UTC stamp) | ✅ |
| Home + onboarding (one vertical ORIENT → TRACE → IDENTIFY sequence, no cards) | ✅ |
| Permissions: each requested only on its own button; never on load | ✅ |
| Live scanner: reticle with lagging rings, local compass arc, elevation scale, telemetry, sensor status, star field (2–8 px parallax), alt-az grid, horizon glow | ✅ |
| Scanning state: lock, ring flies from the button to the reticle, concentric pulse, orbital sweeps, real object counter, coordinate flashes. No spinner, no fake % | ✅ |
| Results: time-proportional vertical timeline, marker size by closeness, RECENT / CLOSEST / VISIBLE, PREVIOUS / NEXT | ✅ |
| Satellite detail: SATCAT owner and type, altitude, velocity, inclination, period, position, last and next crossing, animated orbit diagram, horizon curve | ✅ |
| Trajectory replay across the scanner: play, pause, scrub, fading trail | ✅ |
| Upcoming passes (next 2 h) | ✅ |
| Settings: window, field, units, camera, reduce motion, stars, haptics, datasets, contrast, cache | ✅ |
| "What did I just see?" (V1.5): time presets, direction ring, match tiers | ✅ |
| Manual mode: drag over a circular sky map, keyboard arrows (laptops and desktops) | ✅ |
| Calibration confidence (GOOD/FAIR/POOR) + figure-eight prompt | ✅ |
| Empty state (WIDEN FIELD / EXTEND TIME), error states (location, orientation, no orbit data, camera) | ✅ |
| PWA: manifest, icons incl. maskable, service worker, offline shell, update prompt, deferred install prompt, iOS meta | ✅ |
| Privacy: location stays in memory only; history is opt-in and never stores position | ✅ |
| Security: CSP, no `innerHTML` with external data, schema validation of OMM/SATCAT | ✅ |
| Accessibility: 44 px targets, tabular numerals, reduced motion, high-contrast theme, state never by colour alone, ARIA labels, keyboard manual mode | ✅ |

If no real orbital data can be loaded (first run offline, or the source is unreachable), the app offers a **simulated demo**. The demo orbits are clearly labelled `SIM-xxxx` / "SIMULATED ORBITS — NOT REAL OBJECTS" everywhere they appear.

---

## V2 verification

- **Engine test** (`npm run test:engine`) passes. In addition to the V1 checks, it covers:
  - GMST against Meeus' worked example to 10⁻⁴°.
  - Polaris and Vega precessed to 2026.
  - The Alt/Az vector path matching the closed form to 10⁻¹⁴.
  - Polaris altitude ≈ latitude, and the Sun at the zenith at an equinox noon.
  - Seven bright stars landing in the right IAU constellation, including the polar ones (UMi, Oct).
  - Pass maximum elevation matching brute force to 0.01°, and pass rise at 0.003°.
- **Browser walkthrough** (headless Chromium, synthetic orientation, simulated orbits) went through: Live Sky (pointing and all-sky), pattern match, constellation sheet, selection with trajectory and context line, passes with pass sheet, save and alert, saved locations, trace with LOG OBSERVATION, history, red-light mode and the V2 home. No console errors.

## Honest limitations and what still needs a real phone (Phase 12)

- **Supabase:** the SQL migration and Edge Functions are written but have **not** been run against a live Supabase project, and no Deno runtime was available to test them. Expect to fix small issues when you first deploy them.
- **Visibility estimates:** standard magnitudes are known for only a few objects. Everything else is estimated from the object type, so treat LIKELY / POSSIBLY as estimates.
- **AR overlay:** alignment depends on the phone's camera field of view and compass accuracy. Calibrate the field of view in Settings.
- **Local alerts:** browsers only fire timer-based alerts while SkyTrace is open or recently backgrounded. Alerts with the app closed need the Web Push setup.


- **Real-device testing is still to do.** The flows were verified in headless Chromium with synthetic orientation events and a mocked GPS. Compass behaviour, iOS `webkitCompassHeading`, Samsung Internet and sensor drift all need to be checked on actual phones.
- **CelesTrak CORS.** The app fetches `https://celestrak.org/NORAD/elements/gp.php?GROUP=…&FORMAT=json` directly from the browser. In development, a same-origin Vite proxy (`/celestrak`) is used as a fallback. If a production host hits CORS or rate limits, add the small caching backend described in the blueprint's V2 section.
- **Visibility is an estimate.** Brightness (standard magnitude) isn't modelled, so results say **LIKELY VISIBLE** or **CROSSED FIELD**, never "definitely".
- Every result is framed as **BEST MATCH / CLOSEST TRACKED CROSSING**. Compass error, GPS error, element age and manoeuvres all add uncertainty, and the UI says so.
- Large datasets (Starlink, All Active) work but are slower to trace. They're off by default.

---

## Data source and usage policy

Orbital data comes from [CelesTrak](https://celestrak.org) General Perturbations (GP) data. SkyTrace respects its usage guidance:

- it caches locally
- it never downloads the same group more than once every 2 hours
- it backs off after failures
- it sends no location or identifying data
