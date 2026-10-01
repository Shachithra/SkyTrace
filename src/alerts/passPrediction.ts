import { clamp } from '../utils/math.ts';
import { directionLabel, travelBearing } from '../astronomy/direction.ts';
import { lookAt } from '../astronomy/lookAngles.ts';
import { instant, type Body, type ObserverFrame } from '../astronomy/propagator.ts';
import { assessVisibility, type VisibilityStatus } from '../astronomy/visibility.ts';

export interface PassPoint {
  t: number;
  az: number;
  el: number;
  status: VisibilityStatus;
}

export interface SatellitePass {
  key: string;
  catalogId: number;
  name: string;
  groups: string[];
  simulated: boolean;
  rise: { t: number; az: number };
  max: { t: number; az: number; el: number };
  set: { t: number; az: number };
  /** True when the pass was already under way at the start of the window. */
  inProgress: boolean;
  directionLabel: string;
  durationS: number;
  /** Best visibility reached during the pass. */
  status: VisibilityStatus;
  visibleFrom: number | null;
  visibleTo: number | null;
  brightestMagnitude: number | null;
  path: PassPoint[];
  /** Constellation names the visible part of the path crosses (filled when available). */
  constellations: string[];
}

export interface PassOptions {
  minElevation?: number;
  stepS?: number;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
  chunkSize?: number;
}

const RANK: Record<VisibilityStatus, number> = { NOT_EXPECTED: 0, POSSIBLY_VISIBLE: 1, LIKELY_VISIBLE: 2 };
const yieldNow = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Pass prediction: future propagation on a 60 s grid, horizon crossings refined
 * by bisection (≈1 s), maximum elevation by golden-section search, then a sampled
 * path with a visibility estimate at every point.
 */
export async function predictPasses(bodies: Body[], frame: ObserverFrame, start: number, end: number, opts: PassOptions = {}): Promise<SatellitePass[]> {
  const minEl = opts.minElevation ?? 10;
  const step = (opts.stepS ?? 60) * 1000;
  const chunk = opts.chunkSize ?? 60;
  const grid: number[] = [];
  for (let t = start; t <= end; t += step) grid.push(t);
  const insts = grid.map(instant);
  const out: SatellitePass[] = [];

  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    // Geostationary / very slow objects never "pass": they hang in the sky.
    if (body.rec.MEAN_MOTION < 1.5) continue;
    const el = (t: number): number => lookAt(body, frame, instant(t))?.el ?? -90;
    const els = insts.map((at) => lookAt(body, frame, at)?.el ?? -90);
    let i = 0;
    while (i < els.length) {
      if (els[i] <= 0) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < els.length && els[j + 1] > 0) j++;
      const inProgress = i === 0;
      const riseT = inProgress ? grid[0] : bisect(el, grid[i - 1], grid[i]);
      const setT = j === els.length - 1 ? grid[j] : bisect(el, grid[j + 1], grid[j]);
      i = j + 1;

      // maximum elevation
      let best = riseT;
      let bestEl = -90;
      for (let t = riseT; t <= setT; t += Math.max(5000, (setT - riseT) / 40)) {
        const e = el(t);
        if (e > bestEl) [bestEl, best] = [e, t];
      }
      const lo = Math.max(riseT, best - step / 2);
      const hi = Math.min(setT, best + step / 2);
      const maxT = golden(el, lo, hi);
      const maxLook = lookAt(body, frame, instant(maxT));
      if (!maxLook || maxLook.el < minEl) continue;

      const n = clamp(Math.round((setT - riseT) / 20000), 12, 48);
      const path: PassPoint[] = [];
      let status: VisibilityStatus = 'NOT_EXPECTED';
      let visFrom: number | null = null;
      let visTo: number | null = null;
      let brightest: number | null = null;
      for (let k = 0; k <= n; k++) {
        const t = riseT + ((setT - riseT) * k) / n;
        const at = instant(t);
        const l = lookAt(body, frame, at);
        if (!l) continue;
        const v = assessVisibility(frame, at, l.eci, l.el, l.rangeKm, body.rec);
        path.push({ t, az: l.az, el: l.el, status: v.status });
        if (RANK[v.status] > RANK[status]) status = v.status;
        if (v.status !== 'NOT_EXPECTED') {
          visFrom ??= t;
          visTo = t;
        }
        if (v.estMagnitude !== null && v.status !== 'NOT_EXPECTED') brightest = brightest === null ? v.estMagnitude : Math.min(brightest, v.estMagnitude);
      }
      if (path.length < 2) continue;
      const riseLook = path[0];
      const setLook = path[path.length - 1];
      const motion = 1; // passes always move across the sky
      out.push({
        key: `${body.rec.NORAD_CAT_ID}-${Math.round(riseT / 1000)}`,
        catalogId: body.rec.NORAD_CAT_ID,
        name: body.rec.OBJECT_NAME,
        groups: body.rec.groups ?? [],
        simulated: !!body.rec.simulated,
        rise: { t: riseT, az: riseLook.az },
        max: { t: maxT, az: maxLook.az, el: maxLook.el },
        set: { t: setT, az: setLook.az },
        inProgress,
        directionLabel: directionLabel(riseLook.az, setLook.az, motion, travelBearing(riseLook.az, riseLook.el, setLook.az, setLook.el)),
        durationS: (setT - riseT) / 1000,
        status,
        visibleFrom: visFrom,
        visibleTo: visTo,
        brightestMagnitude: brightest,
        path,
        constellations: [],
      });
    }
    if ((bi + 1) % chunk === 0) {
      opts.onProgress?.(bi + 1, bodies.length);
      await yieldNow();
      if (opts.isCancelled?.()) throw new Error('CANCELLED');
    }
  }
  opts.onProgress?.(bodies.length, bodies.length);
  return out.sort((a, b) => a.rise.t - b.rise.t);
}

/** time where elevation crosses 0 between a below-horizon and an above-horizon instant */
function bisect(el: (t: number) => number, below: number, above: number): number {
  let a = below;
  let b = above;
  for (let k = 0; k < 16 && Math.abs(b - a) > 1000; k++) {
    const m = (a + b) / 2;
    if (el(m) > 0) b = m;
    else a = m;
  }
  return b;
}

function golden(f: (t: number) => number, lo: number, hi: number): number {
  const g = 0.6180339887;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < 24 && b - a > 1000; k++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}
