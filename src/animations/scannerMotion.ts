import { separation, vectorToAzEl } from '../astronomy/angularDistance.ts';
import { shortestDelta } from '../utils/degrees.ts';
import { clamp, damp, normalize, type Vec3 } from '../utils/math.ts';

/**
 * Smooths raw orientation vectors. Filtering happens on unit vectors, never on
 * angles, so azimuth wrap-around (359° → 0°) can't produce a jump.
 */
export class PointingFilter {
  vector: Vec3 | null = null;
  /** Angular speed of the smoothed direction, deg/s. */
  speed = 0;
  private stillSince = 0;

  update(raw: Vec3, dt: number, now: number): void {
    if (!this.vector) {
      this.vector = raw;
      this.stillSince = now;
      return;
    }
    // Responsive when moving fast, calm when holding still.
    const gap = separation(this.vector, raw);
    const k = damp(gap > 6 ? 16 : gap > 1.5 ? 10 : 5, dt);
    const next = normalize([
      this.vector[0] + (raw[0] - this.vector[0]) * k,
      this.vector[1] + (raw[1] - this.vector[1]) * k,
      this.vector[2] + (raw[2] - this.vector[2]) * k,
    ]);
    const inst = dt > 0 ? separation(this.vector, next) / dt : 0;
    this.speed += (inst - this.speed) * damp(6, dt);
    this.vector = next;
    if (this.speed > 2.2) this.stillSince = now;
  }

  /** Held steady for long enough to call the field stable. */
  stableFor(now: number): number {
    return this.vector ? now - this.stillSince : 0;
  }

  azEl(): { az: number; el: number } | null {
    return this.vector ? vectorToAzEl(this.vector) : null;
  }
}

/** Continuous (unwrapped) angle that always rotates the short way round. */
export class AngleTracker {
  value: number | null = null;
  update(target: number, dt: number, lambda = 12): number {
    if (this.value === null) this.value = target;
    else this.value += shortestDelta(this.value, target) * damp(lambda, dt);
    return this.value;
  }
}

/**
 * Physical inertia for the reticle's outer rings: the centre responds at once,
 * the rings trail slightly behind movement and settle back with a spring.
 */
export class RingLag {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;

  update(moveX: number, moveY: number, dt: number): void {
    // Impulse opposite to the movement on screen, then a damped spring home.
    this.vx += -moveX * 22;
    this.vy += -moveY * 22;
    const stiffness = 90;
    const damping = 14;
    this.vx += (-stiffness * this.x - damping * this.vx) * dt;
    this.vy += (-stiffness * this.y - damping * this.vy) * dt;
    this.x = clamp(this.x + this.vx * dt, -14, 14);
    this.y = clamp(this.y + this.vy * dt, -14, 14);
  }
}
