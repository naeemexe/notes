import { useSyncExternalStore } from 'react';
import { bbox, getDrawing, stride, updateDrawing, type Stroke } from './drawStore';

/**
 * Lasso selection: some strokes of one drawing. Held as stroke references, so an undo or a
 * remote refresh (new stroke objects) quietly empties it.
 */
export type Selection = { drawingId: string; strokes: Set<Stroke> };

let sel: Selection | null = null;
const listeners = new Set<() => void>();

export const getSelection = () => sel;
export function setSelection(next: Selection | null) {
  if (next && !next.strokes.size) next = null;
  if (next === sel) return;
  sel = next;
  listeners.forEach((l) => l());
}
export function clearSelection(drawingId?: string) {
  if (sel && (!drawingId || sel.drawingId === drawingId)) setSelection(null);
}
export function useSelection() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getSelection);
}

/** The selected strokes still present in the drawing. */
export function selectedStrokes(strokes: Stroke[], s: Selection | null, drawingId: string) {
  if (!s || s.drawingId !== drawingId) return [];
  return strokes.filter((k) => s.strokes.has(k));
}

export function unionBox(strokes: Stroke[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = bbox(s);
    if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1];
    if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
  }
  return [x0, y0, x1, y1] as const;
}

function inPolygon(x: number, y: number, poly: number[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Strokes with at least half their points inside the lasso (flat [x, y, ...] in base units). */
export function strokesInLasso(strokes: Stroke[], poly: number[]) {
  const out = new Set<Stroke>();
  if (poly.length < 6) return out;
  for (const s of strokes) {
    const n = stride(s);
    let inside = 0, total = 0;
    for (let i = 0; i < s.p.length; i += n, total++) if (inPolygon(s.p[i], s.p[i + 1], poly)) inside++;
    if (total && inside * 2 >= total) out.add(s);
  }
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** x' = x * f + ox, y' = y * f + oy; size scales with f. */
export function transformStroke(s: Stroke, f: number, ox: number, oy: number): Stroke {
  const n = stride(s);
  const p = s.p.slice();
  for (let i = 0; i < p.length; i += n) { p[i] = r1(p[i] * f + ox); p[i + 1] = r1(p[i + 1] * f + oy); }
  return { ...s, s: Math.round(s.s * f * 100) / 100, p };
}

/** Apply a move/resize to the selected strokes (one undo step) and keep them selected. */
export function transformSelection(drawingId: string, f: number, ox: number, oy: number) {
  const d = getDrawing(drawingId);
  if (!d || !sel || sel.drawingId !== drawingId) return;
  const moved = new Set<Stroke>();
  const strokes = d.strokes.map((s) => {
    if (!sel!.strokes.has(s)) return s;
    const t = transformStroke(s, f, ox, oy);
    moved.add(t);
    return t;
  });
  const bottom = unionBox([...moved])[3];
  updateDrawing(drawingId, { strokes, h: Math.max(d.h, Math.ceil(bottom + 40)) }, { undoable: true });
  setSelection({ drawingId, strokes: moved });
}

export function deleteSelection() {
  if (!sel) return false;
  const d = getDrawing(sel.drawingId);
  if (d) updateDrawing(sel.drawingId, { strokes: d.strokes.filter((s) => !sel!.strokes.has(s)) }, { undoable: true });
  setSelection(null);
  return true;
}
