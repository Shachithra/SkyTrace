/**
 * Engine self-test (no browser needed):  npm run test:engine
 * Verifies look angles against satellite.js, spherical separation, and that the
 * crossing detector recovers a crossing planted at a known time and place.
 */
import * as sat from 'satellite.js';
import { angularDistance } from '../src/astronomy/angularDistance.ts';
import { runTrace } from '../src/astronomy/crossingDetector.ts';
import { generateSimulatedOrbits } from '../src/astronomy/demoData.ts';
import { lookAt } from '../src/astronomy/lookAngles.ts';
import { createBody, instant, ObserverFrame, type Body } from '../src/astronomy/propagator.ts';
import type { OrbitRecord, TraceRequest } from '../src/astronomy/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const now = Date.UTC(2026, 9, 1, 14, 0, 0);
const observer = { latitude: 6.9271, longitude: 79.8612, altitudeKm: 0.01 };

// ISS-like elements with an epoch one hour before "now".
const iss: OrbitRecord = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: new Date(now - 3_600_000).toISOString().replace('Z', ''),
  MEAN_MOTION: 15.4977, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: 200, ARG_OF_PERICENTER: 90,
  MEAN_ANOMALY: 10, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 1, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0, groups: ['stations'],
};
const body = createBody(iss)!;
check('createBody from OMM', !!body);

// 1. Look angles agree with satellite.js reference pipeline.
const frame = new ObserverFrame(observer);
let maxErr = 0;
for (let k = 0; k < 200; k++) {
  const t = now + k * 47_000;
  const mine = lookAt(body, frame, instant(t))!;
  const pv = sat.propagate(body.satrec, new Date(t))!;
  const gmst = sat.gstime(new Date(t));
  const ecf = sat.eciToEcf(pv.position, gmst);
  const ref = sat.ecfToLookAngles(
    { latitude: sat.degreesToRadians(observer.latitude), longitude: sat.degreesToRadians(observer.longitude), height: observer.altitudeKm },
    ecf,
  );
  const d = angularDistance(mine.az, mine.el, sat.radiansToDegrees(ref.azimuth), sat.radiansToDegrees(ref.elevation));
  maxErr = Math.max(maxErr, d);
}
check('look angles match satellite.js', maxErr < 0.01, `max error ${maxErr.toExponential(2)}°`);

// 2. Spherical separation handles azimuth wrap.
check('359° vs 1° azimuth at el 0 is 2°', Math.abs(angularDistance(359, 0, 1, 0) - 2) < 1e-9);
check('azimuth irrelevant at zenith', angularDistance(10, 90, 250, 90) < 1e-6);

// 3. Plant a target where the ISS will be, find it again.
let plantT = 0;
let planted = { az: 0, el: 0 };
for (let t = now - 3_600_000; t < now; t += 10_000) {
  const l = lookAt(body, frame, instant(t))!;
  if (l.el > 35) {
    plantT = t;
    planted = { az: l.az, el: l.el };
    break;
  }
}
// Fall back to any above-horizon moment in a 24 h span, then trace around it.
if (!plantT) {
  for (let t = now - 86_400_000; t < now; t += 10_000) {
    const l = lookAt(body, frame, instant(t))!;
    if (l.el > 35) { plantT = t; planted = { az: l.az, el: l.el }; break; }
  }
}
check('found an ISS pass to plant', plantT > 0, new Date(plantT).toISOString());

const req: TraceRequest = {
  requestId: 't1', observer, target: { azimuth: planted.az, elevation: planted.el, radius: 6 },
  startTime: plantT - 30 * 60_000, endTime: plantT + 30 * 60_000, upcomingEnd: null, now: plantT + 30 * 60_000,
};
const res = await runTrace([body], req);
const c = res.past[0];
check('planted crossing detected', !!c, c ? `${c.name} at ${new Date(c.closestTime).toISOString()}` : 'none');
if (c) {
  check('closest time within 2 s of plant', Math.abs(c.closestTime - plantT) < 2000, `${(c.closestTime - plantT) / 1000}s`);
  check('min separation ≈ 0', c.minAngularDistance < 0.05, `${c.minAngularDistance.toFixed(4)}°`);
  check('entry < closest < exit', c.entryTime < c.closestTime && c.closestTime < c.exitTime, `duration ${c.durationS.toFixed(1)}s`);
  check('path has points', c.path.length > 20, `${c.path.length} points, ${c.directionLabel}, ${c.visibility}/${c.visibilityReason}`);
}

// 4. Fast object between coarse samples is not missed (narrow 3° field, 30 s coarse step).
const res2 = await runTrace([body], { ...req, requestId: 't2', target: { ...req.target, radius: 3 } }, { coarseStepS: 30 });
check('narrow field + coarse 30 s still detects', res2.past.length === 1);

// 5. Performance on simulated catalogue.
const sims: Body[] = generateSimulatedOrbits(now, 1600).map(createBody).filter((b): b is Body => !!b);
const t0 = performance.now();
const res3 = await runTrace(sims, {
  requestId: 't3', observer, target: { azimuth: 247.3, elevation: 61.8, radius: 6 },
  startTime: now - 3_600_000, endTime: now, upcomingEnd: now + 2 * 3_600_000, now,
});
const ms = performance.now() - t0;
console.log(`      ${sims.length} simulated objects → ${res3.past.length} past, ${res3.upcoming.length} upcoming, ${res3.propagated.toLocaleString()} propagations in ${ms.toFixed(0)} ms`);
check('simulated catalogue trace < 8 s', ms < 8000);


// ───────────── V2: sky engine ─────────────
{
  const { readFileSync } = await import('node:fs');
  const { precessionMatrix, mul, raDecToVec, vecToRaDec, HorizonFrame, raDecToAltAz } = await import('../src/sky/raDecToAltAz.ts');
  const { lstDeg, gmstDeg } = await import('../src/sky/siderealTime.ts');
  const { sunAltitude } = await import('../src/sky/horizon.ts');
  const { ConstellationIndex } = await import('../src/stars/constellationData.ts');
  const { predictPasses } = await import('../src/alerts/passPrediction.ts');
  const jd = now / 86_400_000 + 2440587.5;

  // GMST at J2000.0 epoch (Meeus): 280.46061837°
  check('GMST at J2000.0', Math.abs(gmstDeg(2451545.0) - 280.46061837) < 1e-6);
  // Meeus example 12.a: 1987 Apr 10 0h UT → GMST 13h10m46.3668s = 197.693195°
  check('GMST Meeus 12.a', Math.abs(gmstDeg(2446895.5) - 197.693195) < 1e-4, gmstDeg(2446895.5).toFixed(6));

  const P = precessionMatrix(jd);
  const polaris = vecToRaDec(mul(P, raDecToVec(37.9546, 89.2641)));
  check('Polaris precessed to 2026 (RA 44–48°, Dec ≈ 89.37°)', polaris.ra > 44 && polaris.ra < 48 && Math.abs(polaris.dec - 89.37) < 0.04, `${polaris.ra.toFixed(2)}° ${polaris.dec.toFixed(3)}°`);
  const vega = vecToRaDec(mul(P, raDecToVec(279.2347, 38.7837)));
  check('Vega precessed to 2026 (RA ≈ 279.45°, Dec ≈ 38.80°)', Math.abs(vega.ra - 279.45) < 0.06 && Math.abs(vega.dec - 38.8) < 0.03, `${vega.ra.toFixed(3)}° ${vega.dec.toFixed(3)}°`);

  // vector path == closed form
  const lst = lstDeg(jd, observer.longitude);
  const hf = new HorizonFrame(lst, observer.latitude);
  let worst = 0;
  for (const [ra, dec] of [[88.79, 7.41], [101.29, -16.72], [279.23, 38.78], [10, -60]]) {
    const e = hf.toEnu(raDecToVec(ra, dec));
    const a = raDecToAltAz(ra, dec, observer.latitude, lst);
    worst = Math.max(worst, angularDistance(Math.atan2(e[0], e[1]) * 180 / Math.PI, Math.asin(e[2]) * 180 / Math.PI, a.az, a.alt));
    const back = vecToRaDec(hf.fromEnu(e));
    worst = Math.max(worst, Math.abs(((back.ra - ra + 540) % 360) - 180), Math.abs(back.dec - dec));
  }
  check('RA/Dec → Alt/Az vector path matches closed form + inverts', worst < 1e-6, worst.toExponential(2));

  // Polaris altitude ≈ latitude (northern observer)
  const north = new HorizonFrame(lstDeg(jd, 0), 51.48);
  const pAlt = Math.asin(north.toEnu(mul(P, raDecToVec(37.9546, 89.2641)))[2]) * 180 / Math.PI;
  check('Polaris altitude ≈ observer latitude', Math.abs(pAlt - 51.48) < 0.8, `${pAlt.toFixed(2)}° at 51.48°N`);

  // Sun: near-zenith at local noon on the equator at the equinox
  const eq = Date.UTC(2026, 2, 20, 12, 7, 0);
  const sAlt = sunAltitude(eq / 86_400_000 + 2440587.5, 0, 0);
  check('Sun altitude at equinox noon on the equator > 88°', sAlt > 88, `${sAlt.toFixed(2)}°`);

  // Constellation boundaries (real IAU data)
  const stars = JSON.parse(readFileSync(new URL('../public/data/stars.v1.json', import.meta.url), 'utf8'));
  const cons = JSON.parse(readFileSync(new URL('../public/data/constellations.v1.json', import.meta.url), 'utf8'));
  const idx = new ConstellationIndex(cons, stars);
  const cases: [string, number, number, string][] = [
    ['Betelgeuse', 88.7929, 7.4071, 'Ori'], ['Sirius', 101.2872, -16.7161, 'CMa'], ['Polaris', 37.9546, 89.2641, 'UMi'],
    ['Acrux', 186.6496, -63.0991, 'Cru'], ['σ Octantis', 317.195, -88.956, 'Oct'], ['Vega', 279.2347, 38.7837, 'Lyr'], ['Antares', 247.3519, -26.432, 'Sco'],
  ];
  for (const [n, ra, dec, want] of cases) {
    const got = idx.findRaDec(ra, dec)?.def.id;
    check(`${n} is in ${want}`, got === want, String(got));
  }
  const ori = idx.byId.get('Ori')!;
  check('Orion figure has Betelgeuse, Rigel, belt stars', ori.starIdx.length >= 7);

  // Pass prediction: compare with brute-force 1 s sampling
  const t0p = now;
  const passes = await predictPasses([body], frame, t0p, t0p + 24 * 3_600_000, { minElevation: 10 });
  check('ISS-like object has passes in 24 h', passes.length > 0, `${passes.length} passes`);
  if (passes.length) {
    const p = passes[0];
    let bf = { t: 0, el: -90 };
    for (let t = p.rise.t; t <= p.set.t; t += 1000) {
      const l = lookAt(body, frame, instant(t))!;
      if (l.el > bf.el) bf = { t, el: l.el };
    }
    check('pass max elevation matches brute force', Math.abs(bf.el - p.max.el) < 0.05 && Math.abs(bf.t - p.max.t) < 3000, `${p.max.el.toFixed(2)}° vs ${bf.el.toFixed(2)}°`);
    const rl = lookAt(body, frame, instant(p.rise.t))!;
    check('pass rise at the horizon', Math.abs(rl.el) < 0.2, `${rl.el.toFixed(3)}°`);
    console.log(`      first pass ${new Date(p.rise.t).toISOString()} ${p.directionLabel} max ${p.max.el.toFixed(0)}° ${p.status}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll engine checks passed');
process.exit(failures ? 1 : 0);
