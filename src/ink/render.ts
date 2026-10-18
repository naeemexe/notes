import { stride, type Stroke } from './drawStore';

export const HL_ALPHA = 0.38;
const THINNING = 0.55; // how much pressure changes pen width
const NUDGE = 0.4; // max smoothing shift in px (iPad reports positions in 0.5 px steps)
const WINDOW = 4; // neighbours each side used for smoothing
const STRAIGHT = Math.cos((50 * Math.PI) / 180); // turns sharper than 50° are left exactly as drawn

/**
 * Smooth and densify a stroke without moving it. iPad Safari rounds pen positions to 0.5 px, so a
 * slanted line arrives as a tiny staircase. Each point becomes a weighted average of up to WINDOW
 * neighbours each side, moved by at most NUDGE px; the window shrinks near sharp turns so peaks stay
 * put. Then a centripetal Catmull-Rom curve through the points replaces the straight segments.
 * Only the last few points depend on samples still to come, so while drawing just the newest
 * bit of line adjusts, by under half a pixel.
 */
export function densify(x: number[], y: number[], r: number[], size: number) {
  const n = x.length;
  const sx = x.slice(), sy = y.slice();
  const max = NUDGE;
  const turnOk = (i: number, k: number) => {
    const ax = x[i] - x[i - k], ay = y[i] - y[i - k], bx = x[i + k] - x[i], by = y[i + k] - y[i];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    return la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) >= STRAIGHT;
  };
  for (let i = 1; i < n - 1; i++) {
    let k = Math.min(WINDOW, i, n - 1 - i);
    while (k > 0 && !turnOk(i, k)) k--;
    if (!k) continue;
    let wx = 0, wy = 0, ws = 0;
    for (let j = -k; j <= k; j++) {
      const w = Math.exp(-(j * j) / (k * 1.2));
      wx += x[i + j] * w; wy += y[i + j] * w; ws += w;
    }
    let dx = wx / ws - x[i], dy = wy / ws - y[i];
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    sx[i] += dx; sy[i] += dy;
  }
  const ox: number[] = [], oy: number[] = [], or: number[] = [];
  const step = Math.max(0.5, size * 0.35);
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
    const len = Math.hypot(sx[i + 1] - sx[i], sy[i + 1] - sy[i]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const [px, py] = catmullRom(sx[i0], sy[i0], sx[i], sy[i], sx[i + 1], sy[i + 1], sx[i3], sy[i3], t);
      ox.push(px); oy.push(py); or.push(r[i] + (r[i + 1] - r[i]) * t);
    }
  }
  ox.push(sx[n - 1]); oy.push(sy[n - 1]); or.push(r[n - 1]);
  return [ox, oy, or] as const;
}

/** Centripetal Catmull-Rom between p1 and p2 (no overshoot or loops at sharp turns). */
function catmullRom(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, t: number) {
  const d = (ax: number, ay: number, bx: number, by: number) => Math.max(1e-4, Math.sqrt(Math.hypot(bx - ax, by - ay)));
  const t1 = d(x0, y0, x1, y1), t2 = t1 + d(x1, y1, x2, y2), t3 = t2 + d(x2, y2, x3, y3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: number, b: number, ta: number, tb: number) => (ta === tb ? a : a + ((b - a) * (u - ta)) / (tb - ta));
  const ax1 = lerp(x0, x1, 0, t1), ay1 = lerp(y0, y1, 0, t1);
  const ax2 = lerp(x1, x2, t1, t2), ay2 = lerp(y1, y2, t1, t2);
  const ax3 = lerp(x2, x3, t2, t3), ay3 = lerp(y2, y3, t2, t3);
  const bx1 = lerp(ax1, ax2, 0, t2), by1 = lerp(ay1, ay2, 0, t2);
  const bx2 = lerp(ax2, ax3, t1, t3), by2 = lerp(ay2, ay3, t1, t3);
  return [lerp(bx1, bx2, t1, t2), lerp(by1, by2, t1, t2)];
}

/**
 * A stroke is a chain of round dots (radius from pressure) joined by their outer tangents, all in
 * one path filled with the nonzero rule. Nothing depends on far-later points, so ink doesn't move
 * after it appears: the live stroke is the final stroke, and peaks stay where the pen turned.
 */
export function inkPath(p: number[], n: number, size: number, pressure: boolean) {
  const path = new Path2D();
  const xs: number[] = [], ys: number[] = [], rs: number[] = [];
  for (let i = 0; i + 1 < p.length; i += n) {
    xs.push(p[i]); ys.push(p[i + 1]);
    rs.push(pressure ? Math.max(0.3, size * (0.5 - THINNING * (0.5 - p[i + 2]))) : size / 2);
  }
  if (!xs.length) return path;
  const [x, y, r] = xs.length > 2 ? densify(xs, ys, rs, size) : [xs, ys, rs];
  for (let i = 0; i < x.length; i++) {
    const ri = r[i];
    path.moveTo(x[i] + ri, y[i]);
    path.arc(x[i], y[i], ri, 0, Math.PI * 2);
    if (i + 1 >= x.length) break;
    const rj = r[i + 1];
    const dx = x[i + 1] - x[i], dy = y[i + 1] - y[i], d = Math.hypot(dx, dy);
    if (d <= Math.abs(ri - rj)) continue; // one dot covers the other
    // outer tangent lines of the two circles; same winding as the arcs so everything unions
    const ux = dx / d, uy = dy / d, a = (ri - rj) / d, b = Math.sqrt(1 - a * a);
    const lx = a * ux - b * uy, ly = a * uy + b * ux, rx = a * ux + b * uy, ry = a * uy - b * ux;
    path.moveTo(x[i] + rx * ri, y[i] + ry * ri);
    path.lineTo(x[i + 1] + rx * rj, y[i + 1] + ry * rj);
    path.lineTo(x[i + 1] + lx * rj, y[i + 1] + ly * rj);
    path.lineTo(x[i] + lx * ri, y[i] + ly * ri);
    path.closePath();
  }
  return path;
}

/** Path for points in screen or base units; highlighter is constant width. */
export function strokeShape(p: number[], n: number, k: Stroke['k'], size: number, pressure: boolean) {
  return inkPath(p, n, size, k === 'pen' && pressure);
}

const pathCache = new WeakMap<Stroke, Path2D>();
export function strokePath(s: Stroke) {
  let path = pathCache.get(s);
  if (!path) {
    const n = stride(s);
    path = strokeShape(s.p, n, s.k, s.s, n === 3 && !!s.pr);
    pathCache.set(s, path);
  }
  return path;
}

/** Draw strokes: highlighter under pen, like real paper. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.globalAlpha = HL_ALPHA;
  for (const s of strokes) if (s.k === 'hl') { ctx.fillStyle = s.c; ctx.fill(strokePath(s)); }
  ctx.globalAlpha = 1;
  for (const s of strokes) if (s.k === 'pen') { ctx.fillStyle = s.c; ctx.fill(strokePath(s)); }
}
