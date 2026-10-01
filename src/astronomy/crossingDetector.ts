import { clamp, type Vec3 } from '../utils/math.ts';
import { azElToVector, distanceToArc, separation, vectorToAzEl } from './angularDistance.ts';
import { directionLabel, travelBearing } from './direction.ts';
import { lookAt, type LookSample } from './lookAngles.ts';
import { instant, ObserverFrame, type Body, type Instant } from './propagator.ts';
import type { Crossing, PathPoint, SightingQuery, TraceRequest, TraceResult } from './types.ts';
import { assessVisibility } from './visibility.ts';
import { MS_PER_DAY } from './time.ts';

export interface DetectorOptions {
  /** Coarse sampling interval for the historical window (s). Blueprint: 15–30 s. */
  coarseStepS?: number;
  /** Coarse sampling interval for the look-ahead window (s). */
  upcomingStepS?: number;
  /** Local refinement interval around candidate segments (s). Blueprint: 1–2 s. */
  refineStepS?: number;
  /** Bodies processed between cooperative yields (lets the worker receive CANCEL). */
  chunkSize?: number;
  onProgress?: (checked: number, total: number) => void;
  isCancelled?: () => boolean;
}

interface Grid {
  instants: Instant[];
}

function makeGrid(start: number, end: number, stepS: number): Grid {
  const step = stepS * 1000;
  const instants: Instant[] = [];
  for (let t = start; t < end; t += step) instants.push(instant(t));
  instants.push(instant(end));
  return { instants };
}

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * The trace engine. For every orbital object it:
 *  1. samples look vectors on a coarse time grid,
 *  2. flags grid segments whose great-circle arc passes near the target field,
 *  3. refines those segments at 1 s, then bisects entry/exit and golden-sections the closest approach,
 *  4. describes the crossing (direction, pass geometry, visibility) and scores it.
 */
export async function runTrace(bodies: Body[], req: TraceRequest, opts: DetectorOptions = {}): Promise<TraceResult> {
  const t0 = Date.now();
  const coarse = opts.coarseStepS ?? 20;
  const coarseUp = opts.upcomingStepS ?? 30;
  const refine = opts.refineStepS ?? 1;
  const chunk = opts.chunkSize ?? 150;

  const frame = new ObserverFrame(req.observer);
  const target = azElToVector(req.target.azimuth, req.target.elevation);
  const radius = req.target.radius;

  const pastGrid = makeGrid(req.startTime, req.endTime, coarse);
  const upGrid = req.upcomingEnd && req.upcomingEnd > req.endTime ? makeGrid(req.endTime, req.upcomingEnd, coarseUp) : null;

  const past: Crossing[] = [];
  const upcoming: Crossing[] = [];
  const counter = { propagated: 0 };

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    past.push(...scanBody(body, frame, target, radius, pastGrid, req.startTime, req.endTime, refine, 'past', counter));
    if (upGrid) {
      for (const c of scanBody(body, frame, target, radius, upGrid, req.endTime, req.upcomingEnd!, refine, 'upcoming', counter)) {
        // Already inside the field "now": it belongs to the recent list, not the next list.
        if (!c.inFieldAtStart) upcoming.push(c);
      }
    }
    if ((i + 1) % chunk === 0) {
      opts.onProgress?.(i + 1, bodies.length);
      await yieldToEventLoop();
      if (opts.isCancelled?.()) throw new Error('CANCELLED');
    }
  }
  opts.onProgress?.(bodies.length, bodies.length);

  const windowMs = Math.max(1, req.endTime - req.startTime);
  for (const c of past) c.score = relevance(c, radius, req.now, windowMs);
  for (const c of upcoming) c.score = relevance(c, radius, req.now, Math.max(1, (req.upcomingEnd ?? req.now) - req.now));

  if (req.sighting) {
    for (const c of past) scoreSighting(c, radius, req.sighting);
    past.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    assignTiers(past);
  } else {
    past.sort((a, b) => b.closestTime - a.closestTime);
  }
  upcoming.sort((a, b) => a.entryTime - b.entryTime);

  // Element-set age is part of the uncertainty story shown to the user.
  const ages = bodies.map((b) => (req.now - b.epochMs) / MS_PER_DAY).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    requestId: req.requestId,
    past,
    upcoming,
    checked: bodies.length,
    propagated: counter.propagated,
    elapsedMs: Date.now() - t0,
    oldestEpochDays: ages.length ? ages[ages.length - 1] : 0,
    medianEpochDays: ages.length ? ages[Math.floor(ages.length / 2)] : 0,
  };
}

function scanBody(
  body: Body,
  frame: ObserverFrame,
  target: Vec3,
  radius: number,
  grid: Grid,
  windowStart: number,
  windowEnd: number,
  refineS: number,
  kind: 'past' | 'upcoming',
  counter: { propagated: number },
): Crossing[] {
  const n = grid.instants.length;
  const looks: (LookSample | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    looks[i] = lookAt(body, frame, grid.instants[i]);
    counter.propagated++;
  }

  // Coarse pass: flag segments whose arc comes near the field.
  const flagged: boolean[] = new Array(Math.max(0, n - 1)).fill(false);
  const floor = Math.min(-2, vectorToAzEl(target).el - radius - 2);
  let any = false;
  for (let i = 0; i < n - 1; i++) {
    const a = looks[i];
    const b = looks[i + 1];
    if (!a || !b) continue;
    // Both well below the horizon and below the field: cannot be in the field.
    if (a.el < floor && b.el < floor) continue;
    const move = separation(a.enu, b.enu);
    const margin = 0.5 + 0.15 * move; // apparent paths curve; stay generous
    if (distanceToArc(target, a.enu, b.enu) <= radius + margin) {
      flagged[i] = true;
      any = true;
    }
  }
  if (!any) return [];

  // Merge flagged segments into intervals, padded by one coarse step either side.
  const intervals: [number, number][] = [];
  let i = 0;
  while (i < flagged.length) {
    if (!flagged[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < flagged.length && flagged[j + 1]) j++;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, j + 2);
    const prev = intervals[intervals.length - 1];
    if (prev && grid.instants[a].t <= prev[1]) prev[1] = grid.instants[b].t;
    else intervals.push([grid.instants[a].t, grid.instants[b].t]);
    i = j + 1;
  }

  const out: Crossing[] = [];
  for (const [ta, tb] of intervals) {
    out.push(...refineInterval(body, frame, target, radius, ta, tb, windowStart, windowEnd, refineS, kind, counter));
  }
  return out;
}

function refineInterval(
  body: Body,
  frame: ObserverFrame,
  target: Vec3,
  radius: number,
  ta: number,
  tb: number,
  windowStart: number,
  windowEnd: number,
  refineS: number,
  kind: 'past' | 'upcoming',
  counter: { propagated: number },
): Crossing[] {
  const step = refineS * 1000;
  const times: number[] = [];
  for (let t = ta; t < tb; t += step) times.push(t);
  times.push(tb);

  const dist = (t: number): { d: number; look: LookSample } | null => {
    const look = lookAt(body, frame, instant(t));
    counter.propagated++;
    if (!look) return null;
    return { d: separation(target, look.enu), look };
  };

  const samples = times.map((t) => ({ t, r: dist(t) }));
  const inside = samples.map((s) => !!s.r && s.r.d <= radius);

  const out: Crossing[] = [];
  let k = 0;
  while (k < samples.length) {
    if (!inside[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < samples.length && inside[e + 1]) e++;

    // Entry: bisect between the last outside sample and the first inside sample.
    const inFieldAtStart = k === 0 && samples[0].t <= windowStart;
    const inFieldAtEnd = e === samples.length - 1 && samples[e].t >= windowEnd;
    const entryTime = k === 0 ? samples[0].t : bisectBoundary(dist, samples[k - 1].t, samples[k].t, radius);
    const exitTime = e === samples.length - 1 ? samples[e].t : bisectBoundary(dist, samples[e + 1].t, samples[e].t, radius);

    // Closest approach: best fine sample, then golden-section between its neighbours.
    let best = k;
    for (let m = k; m <= e; m++) if (samples[m].r!.d < samples[best].r!.d) best = m;
    const lo = samples[Math.max(0, best - 1)].t;
    const hi = samples[Math.min(samples.length - 1, best + 1)].t;
    const closest = goldenMin(dist, lo, hi) ?? { t: samples[best].t, d: samples[best].r!.d, look: samples[best].r!.look };

    const crossing = describe(body, frame, kind, entryTime, exitTime, closest, inFieldAtStart, inFieldAtEnd, counter);
    if (crossing) out.push(crossing);
    k = e + 1;
  }
  return out;
}

/** Find the time where the angular distance crosses `radius`, between an outside and an inside instant. */
function bisectBoundary(
  dist: (t: number) => { d: number } | null,
  outsideT: number,
  insideT: number,
  radius: number,
): number {
  let a = outsideT;
  let b = insideT;
  for (let it = 0; it < 14 && Math.abs(b - a) > 40; it++) {
    const m = (a + b) / 2;
    const r = dist(m);
    if (r && r.d <= radius) b = m;
    else a = m;
  }
  return b;
}

function goldenMin(
  dist: (t: number) => { d: number; look: LookSample } | null,
  lo: number,
  hi: number,
): { t: number; d: number; look: LookSample } | null {
  const g = 0.6180339887;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = dist(c);
  let fd = dist(d);
  if (!fc || !fd) return null;
  for (let it = 0; it < 18 && b - a > 30; it++) {
    if (fc!.d < fd!.d) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = dist(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = dist(d);
    }
    if (!fc || !fd) return null;
  }
  const t = (a + b) / 2;
  const r = dist(t);
  return r ? { t, d: r.d, look: r.look } : null;
}

function describe(
  body: Body,
  frame: ObserverFrame,
  kind: 'past' | 'upcoming',
  entryTime: number,
  exitTime: number,
  closest: { t: number; d: number; look: LookSample },
  inFieldAtStart: boolean,
  inFieldAtEnd: boolean,
  counter: { propagated: number },
): Crossing | null {
  const durationMs = Math.max(0, exitTime - entryTime);

  // Replay path: the field crossing plus a little context either side.
  const pad = clamp(durationMs * 0.6, 3000, 60000);
  const p0 = entryTime - pad;
  const p1 = exitTime + pad;
  const count = clamp(Math.round((p1 - p0) / 250), 24, 90);
  const path: PathPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = p0 + ((p1 - p0) * i) / count;
    const l = lookAt(body, frame, instant(t));
    counter.propagated++;
    if (l) path.push({ t, az: l.az, el: l.el });
  }
  if (path.length < 2) return null;

  const entryLook = lookAt(body, frame, instant(entryTime));
  const exitLook = lookAt(body, frame, instant(exitTime));
  if (!entryLook || !exitLook) return null;

  // Full-pass context: walk outward from the closest point until the object sets / rises.
  const step = 30_000;
  const maxSpan = 25 * 60_000;
  let riseAz: number | null = null;
  let setAz: number | null = null;
  let maxEl = closest.look.el;
  for (let t = closest.t - step; t >= closest.t - maxSpan; t -= step) {
    const l = lookAt(body, frame, instant(t));
    counter.propagated++;
    if (!l) break;
    if (l.el < 0) {
      riseAz = l.az;
      break;
    }
    maxEl = Math.max(maxEl, l.el);
  }
  for (let t = closest.t + step; t <= closest.t + maxSpan; t += step) {
    const l = lookAt(body, frame, instant(t));
    counter.propagated++;
    if (!l) break;
    if (l.el < 0) {
      setAz = l.az;
      break;
    }
    maxEl = Math.max(maxEl, l.el);
  }

  const first = path[0];
  const last = path[path.length - 1];
  const motionDeg = separation(azElToVector(first.az, first.el), azElToVector(last.az, last.el));
  const bearing = travelBearing(first.az, first.el, last.az, last.el);
  const startAz = riseAz ?? (motionDeg < 0.5 ? null : first.az);
  const endAz = setAz ?? (motionDeg < 0.5 ? null : last.az);

  const vis = assessVisibility(frame, instant(closest.t), closest.look.eci, closest.look.el, closest.look.rangeKm, body.rec);

  return {
    satelliteId: body.id,
    name: body.rec.OBJECT_NAME,
    catalogId: body.rec.NORAD_CAT_ID,
    intlDesignator: body.rec.OBJECT_ID,
    simulated: !!body.rec.simulated,
    kind,
    closestTime: closest.t,
    entryTime,
    exitTime,
    inFieldAtStart,
    inFieldAtEnd,
    minAngularDistance: closest.d,
    startAzimuth: entryLook.az,
    startElevation: entryLook.el,
    closestAzimuth: closest.look.az,
    closestElevation: closest.look.el,
    endAzimuth: exitLook.az,
    endElevation: exitLook.el,
    rangeKm: closest.look.rangeKm,
    directionLabel: directionLabel(startAz, endAz, motionDeg, bearing),
    travelBearing: bearing,
    passRiseAzimuth: riseAz,
    passSetAzimuth: setAz,
    passMaxElevation: maxEl,
    visibility: vis.label,
    visibilityReason: vis.reason,
    sunElevation: vis.sunElevation,
    illuminated: vis.illuminated,
    estMagnitude: vis.estMagnitude,
    durationS: durationMs / 1000,
    path,
    score: 0,
  };
}

/** Relevance blends closeness, timing, crossing duration, elevation and likely visibility. */
function relevance(c: Crossing, radius: number, now: number, windowMs: number): number {
  const closeness = 1 - clamp(c.minAngularDistance / radius, 0, 1);
  const timing = 1 - clamp(Math.abs(now - c.closestTime) / windowMs, 0, 1);
  const duration = clamp(c.durationS / 30, 0, 1);
  const elevation = clamp(c.closestElevation / 90, 0, 1);
  const visible = c.visibility === 'LIKELY_VISIBLE' ? 1 : c.visibility === 'POSSIBLY_VISIBLE' ? 0.5 : 0;
  return 0.4 * closeness + 0.15 * timing + 0.1 * duration + 0.1 * elevation + 0.25 * visible;
}

function scoreSighting(c: Crossing, radius: number, s: SightingQuery): void {
  const closeness = 1 - clamp(c.minAngularDistance / radius, 0, 1);
  const timing = 1 - clamp(Math.abs(c.closestTime - s.time) / (s.toleranceS * 1000), 0, 1);
  const direction = s.direction === null ? 0.5 : (1 + Math.cos(((c.travelBearing - s.direction) * Math.PI) / 180)) / 2;
  const visible = c.visibility === 'LIKELY_VISIBLE' ? 1 : c.visibility === 'POSSIBLY_VISIBLE' ? 0.6 : 0.25;
  c.matchScore = 0.35 * closeness + 0.25 * timing + 0.25 * direction + 0.15 * visible;
}

function assignTiers(list: Crossing[]): void {
  list.forEach((c, i) => {
    const s = c.matchScore ?? 0;
    if (i === 0 && s >= 0.7) c.matchTier = 'BEST MATCH';
    else if (s >= 0.55) c.matchTier = 'LIKELY MATCH';
    else c.matchTier = 'POSSIBLE MATCH';
  });
}
