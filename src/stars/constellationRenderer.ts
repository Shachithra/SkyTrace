import type { ScreenPoint } from '../sky/skyProjection.ts';

export interface ConstellationDraw {
  id: string;
  name: string;
  /** projected endpoints per segment */
  segments: [ScreenPoint, ScreenPoint][];
  /** BFS depth of each segment from the anchor (brightest) star, for the reveal */
  depth: number[];
  maxDepth: number;
  label: ScreenPoint | null;
  focused: boolean;
}

export interface ConstellationStyle {
  line: string; // rgb triplet "116,137,158"
  label: string;
  /** 0..1 reveal progress for the layer */
  reveal: number;
  focusId: string | null;
  showLabels: boolean;
}

/**
 * Thin, subtle, low-opacity stick figures (no glow). During the reveal, lines
 * resolve outward from each figure's anchor star; then the name fades in.
 * With a focused constellation, unrelated figures stay muted.
 */
export function drawConstellations(ctx: CanvasRenderingContext2D, items: ConstellationDraw[], st: ConstellationStyle): void {
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (const c of items) {
    const muted = st.focusId !== null && !c.focused;
    const alpha = c.focused ? 0.75 : muted ? 0.12 : 0.26;
    ctx.strokeStyle = `rgba(${st.line},${alpha})`;
    ctx.lineWidth = c.focused ? 1.3 : 1;
    ctx.beginPath();
    c.segments.forEach(([a, b], i) => {
      if (!a.front || !b.front) return;
      // stagger by depth: each ring of segments draws after the previous one
      const span = 0.55 / Math.max(1, c.maxDepth + 1);
      const t0 = 0.25 + c.depth[i] * span;
      const k = Math.max(0, Math.min(1, (st.reveal - t0) / Math.max(0.08, span * 1.6)));
      if (k <= 0) return;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    });
    ctx.stroke();
    if (st.showLabels && c.label?.front) {
      const la = Math.max(0, Math.min(1, (st.reveal - 0.8) / 0.2)) * (c.focused ? 0.95 : muted ? 0.25 : 0.55);
      if (la > 0) {
        ctx.fillStyle = `rgba(${st.label},${la})`;
        ctx.font = `${c.focused ? 500 : 400} 10px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.name.toUpperCase().split('').join(' '), c.label.x, c.label.y);
      }
    }
  }
}

/** BFS depth of each segment from the brightest star in the figure. */
export function segmentDepths(lines: [number, number][], anchor: number): { depth: number[]; max: number } {
  const adj = new Map<number, number[]>();
  for (const [a, b] of lines) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const dist = new Map<number, number>([[anchor, 0]]);
  const q = [anchor];
  while (q.length) {
    const n = q.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!dist.has(m)) {
        dist.set(m, dist.get(n)! + 1);
        q.push(m);
      }
    }
  }
  let max = 0;
  const depth = lines.map(([a, b]) => {
    const d = Math.min(dist.get(a) ?? 6, dist.get(b) ?? 6);
    max = Math.max(max, d);
    return d;
  });
  return { depth, max };
}
