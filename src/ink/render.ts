import { getStroke } from 'perfect-freehand';
import type { Stroke } from './drawStore';

export const HL_ALPHA = 0.38;

function toTriples(p: number[]) {
  const out: number[][] = new Array(p.length / 3);
  for (let i = 0, j = 0; i < p.length; i += 3, j++) out[j] = [p[i], p[i + 1], p[i + 2]];
  return out;
}

export function outline(points: number[], k: Stroke['k'], size: number, pressure: boolean, last: boolean) {
  const pts = toTriples(points);
  if (k === 'hl') {
    return getStroke(pts, { size, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last });
  }
  return getStroke(pts, {
    size,
    thinning: pressure ? 0.55 : 0.45,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !pressure,
    last,
  });
}

export function pathFromOutline(o: number[][]) {
  const path = new Path2D();
  if (!o.length) return path;
  path.moveTo(o[0][0], o[0][1]);
  for (let i = 1; i < o.length; i++) {
    const [x0, y0] = o[i];
    const [x1, y1] = o[(i + 1) % o.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

const pathCache = new WeakMap<Stroke, Path2D>();
export function strokePath(s: Stroke) {
  let p = pathCache.get(s);
  if (!p) {
    p = pathFromOutline(outline(s.p, s.k, s.s, !!s.pr, true));
    pathCache.set(s, p);
  }
  return p;
}

/** Draw strokes: highlighter under pen, like real paper. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.globalAlpha = HL_ALPHA;
  for (const s of strokes) if (s.k === 'hl') { ctx.fillStyle = s.c; ctx.fill(strokePath(s)); }
  ctx.globalAlpha = 1;
  for (const s of strokes) if (s.k === 'pen') { ctx.fillStyle = s.c; ctx.fill(strokePath(s)); }
}
