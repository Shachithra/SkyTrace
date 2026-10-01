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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll engine checks passed');
process.exit(failures ? 1 : 0);
