import { separation } from '../astronomy/angularDistance.ts';
import { normalize, type Vec3 } from '../utils/math.ts';

export type Confidence = 'GOOD' | 'FAIR' | 'POOR';

export interface ConfidenceReading {
  grade: Confidence;
  /** Estimated pointing uncertainty, degrees. */
  accuracyDeg: number;
}

/**
 * Sensor-confidence model. Combines the platform's compass accuracy (iOS),
 * whether the heading is north-referenced at all, and short-term heading noise.
 * Grades follow the blueprint: GOOD ±3°, FAIR ±8°, POOR ±15°.
 */
export class ConfidenceModel {
  private samples: { v: Vec3; t: number }[] = [];
  private smoothed = 6;

  push(v: Vec3, t: number): void {
    this.samples.push({ v, t });
    while (this.samples.length && t - this.samples[0].t > 700) this.samples.shift();
  }

  /** Pointing noise over the last ~0.7 s, degrees (RMS around the mean direction). */
  jitter(): number {
    if (this.samples.length < 4) return 0;
    let m: Vec3 = [0, 0, 0];
    for (const s of this.samples) m = [m[0] + s.v[0], m[1] + s.v[1], m[2] + s.v[2]];
    m = normalize(m);
    let acc = 0;
    for (const s of this.samples) acc += separation(m, s.v) ** 2;
    return Math.sqrt(acc / this.samples.length);
  }

  read(platformAccuracy: number | null, absolute: boolean): ConfidenceReading {
    const base = platformAccuracy ?? (absolute ? 4 : 20);
    const raw = base + Math.min(10, this.jitter() * 0.6);
    this.smoothed += (raw - this.smoothed) * 0.08;
    const a = this.smoothed;
    const grade: Confidence = a <= 4.5 ? 'GOOD' : a <= 10 ? 'FAIR' : 'POOR';
    return { grade, accuracyDeg: a };
  }
}
