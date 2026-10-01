/**
 * Canvas colour palettes (V2 colour system). Night modes transition slowly by
 * mixing palettes over ~1.4 s — never a bright flash.
 */
export type NightMode = 'off' | 'dim' | 'red';
type RGB = [number, number, number];

export interface Palette {
  bg: RGB;
  text: RGB;
  muted: RGB;
  satellite: RGB;
  star: RGB;
  constellation: RGB;
  visible: RGB;
  solar: RGB;
  grid: RGB;
  ground: RGB;
  /** overall brightness multiplier */
  brightness: number;
  /** keep star B−V tints? (off in red mode) */
  tint: number;
}

const NORMAL: Palette = {
  bg: [5, 7, 11],
  text: [238, 244, 250],
  muted: [142, 154, 170],
  satellite: [112, 215, 255],
  star: [232, 237, 242],
  constellation: [116, 137, 158],
  visible: [119, 230, 167],
  solar: [255, 202, 115],
  grid: [238, 244, 250],
  ground: [3, 4, 7],
  brightness: 1,
  tint: 1,
};

const DIM: Palette = { ...NORMAL, brightness: 0.55 };

const RED: Palette = {
  bg: [2, 2, 2],
  text: [226, 75, 75],
  muted: [127, 42, 42],
  satellite: [226, 75, 75],
  star: [214, 70, 70],
  constellation: [127, 42, 42],
  visible: [240, 96, 96],
  solar: [200, 60, 60],
  grid: [127, 42, 42],
  ground: [2, 2, 2],
  brightness: 0.7,
  tint: 0,
};

export const PALETTES: Record<NightMode, Palette> = { off: NORMAL, dim: DIM, red: RED };

const mixRgb = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export function mixPalette(a: Palette, b: Palette, k: number): Palette {
  const out = { ...b };
  for (const key of Object.keys(a) as (keyof Palette)[]) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb)) (out[key] as RGB) = mixRgb(va as RGB, vb as RGB, k);
    else (out[key] as number) = (va as number) + ((vb as number) - (va as number)) * k;
  }
  return out;
}

export const rgb = (c: RGB): string => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;

/** Animated palette holder used by every canvas renderer. */
export class PaletteState {
  private from: Palette = NORMAL;
  private to: Palette = NORMAL;
  private start = 0;
  private duration = 1400;
  current: Palette = NORMAL;
  mode: NightMode = 'off';

  set(mode: NightMode, immediate = false): void {
    if (mode === this.mode && !immediate) return;
    this.mode = mode;
    this.from = this.current;
    this.to = PALETTES[mode];
    this.start = performance.now();
    if (immediate) this.current = this.to;
  }

  tick(now: number): Palette {
    const k = Math.min(1, (now - this.start) / this.duration);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    this.current = k >= 1 ? this.to : mixPalette(this.from, this.to, e);
    return this.current;
  }
}
