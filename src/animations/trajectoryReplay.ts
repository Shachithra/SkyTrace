import gsap from 'gsap';
import type { PathPoint } from '../astronomy/types.ts';

export interface ReplayFrame {
  drawIn: number;
  time: number;
  progress: number;
  playing: boolean;
}

/**
 * Trajectory replay: the satellite dot travels the path it actually took across
 * the selected field. 2.5–4 s per run; play / pause / scrub.
 */
export class TrajectoryReplay {
  readonly path: PathPoint[];
  readonly t0: number;
  readonly t1: number;
  private state = { drawIn: 0, progress: 0 };
  private tween: gsap.core.Tween | null = null;
  playing = false;
  private onFrame: (f: ReplayFrame) => void;
  readonly duration: number;

  constructor(path: PathPoint[], onFrame: (f: ReplayFrame) => void, reduce: boolean) {
    this.path = path;
    this.onFrame = onFrame;
    this.t0 = path[0].t;
    this.t1 = path[path.length - 1].t;
    // Longer real crossings get a little more replay time, within 2.5–4 s.
    this.duration = gsap.utils.clamp(2.5, 4, 2.5 + (this.t1 - this.t0) / 60000);
    if (reduce) {
      this.state.drawIn = 1;
      this.state.progress = 1;
      this.emit();
    } else {
      // orbit path transforms into the scanner trajectory, then the dot runs
      gsap.to(this.state, { drawIn: 1, duration: 0.6, ease: 'power2.out', onUpdate: () => this.emit(), onComplete: () => this.play(true) });
    }
  }

  private emit(): void {
    this.onFrame({ drawIn: this.state.drawIn, progress: this.state.progress, time: this.t0 + (this.t1 - this.t0) * this.state.progress, playing: this.playing });
  }

  play(fromStart = false): void {
    if (fromStart || this.state.progress >= 1) this.state.progress = 0;
    this.tween?.kill();
    this.playing = true;
    this.tween = gsap.to(this.state, {
      progress: 1,
      duration: this.duration * (1 - this.state.progress),
      ease: 'none',
      onUpdate: () => this.emit(),
      onComplete: () => {
        this.playing = false;
        this.emit();
      },
    });
    this.emit();
  }

  pause(): void {
    this.tween?.kill();
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  scrub(progress: number): void {
    this.tween?.kill();
    this.playing = false;
    this.state.drawIn = 1;
    this.state.progress = Math.min(1, Math.max(0, progress));
    this.emit();
  }

  destroy(): void {
    this.tween?.kill();
    gsap.killTweensOf(this.state);
  }
}
