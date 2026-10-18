import { api } from '../api';

/**
 * One ink stroke, in the drawing's base coordinates. Points are flat [x, y, pressure, ...].
 * A few strokes saved by a short-lived version have v: 2 and [x, y, ...] with no pressure.
 */
export type Stroke = {
  k: 'pen' | 'hl';
  c: string; // color
  s: number; // size (base units)
  pr: 0 | 1; // real pressure (Apple Pencil) vs simulated
  v?: 2;
  p: number[];
};

/** Numbers per point in s.p. */
export const stride = (s: Pick<Stroke, 'v'>) => (s.v === 2 ? 2 : 3);

export type Drawing = {
  id: string;
  pageId: string;
  /** base width: coordinates are stored relative to this, then scaled to the block's real width */
  w: number;
  h: number;
  strokes: Stroke[];
};

export type DrawingController = {
  el: HTMLElement;
  scale(): number;
  /** add a stroke given client-space points (flat x,y,p) */
  commitClient(points: number[], meta: Omit<Stroke, 'p'>): void;
};

export const DEFAULT_H = 260;

const cache = new Map<string, Drawing>();
const loading = new Map<string, Promise<Drawing | null>>();
const listeners = new Map<string, Set<() => void>>();
export const controllers = new Map<string, DrawingController>();

const bboxCache = new WeakMap<Stroke, [number, number, number, number]>();
export function bbox(s: Stroke) {
  let b = bboxCache.get(s);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = stride(s);
    for (let i = 0; i < s.p.length; i += n) {
      const x = s.p[i], y = s.p[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = s.s;
    b = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    bboxCache.set(s, b);
  }
  return b;
}

function notify(id: string) {
  listeners.get(id)?.forEach((l) => l());
}

export function subscribe(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export function getDrawing(id: string) {
  return cache.get(id);
}

export function loadDrawing(id: string, pageId: string): Promise<Drawing | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(id);
  if (!p) {
    p = api.getDrawing(id).then((raw) => {
      loading.delete(id);
      if (cache.has(id)) return cache.get(id)!; // created locally meanwhile
      const d: Drawing = raw
        ? (raw as Drawing)
        : { id, pageId, w: 0, h: DEFAULT_H, strokes: [] }; // w filled in by the view on first layout
      cache.set(id, d);
      notify(id);
      return d;
    }).catch((e) => { loading.delete(id); console.error(e); return null; });
    loading.set(id, p);
  }
  return p;
}

export function createDrawing(d: Drawing) {
  cache.set(d.id, d);
  dirty.add(d.id);
  scheduleSave();
  notify(d.id);
}

// ---- undo (ink only; text undo is the editor's Cmd+Z) ----
type UndoEntry = { id: string; strokes: Stroke[]; h: number };
const undoStack: UndoEntry[] = [];
const undoListeners = new Set<() => void>();
export const onUndoChange = (fn: () => void) => { undoListeners.add(fn); return () => undoListeners.delete(fn); };
export const canUndo = () => undoStack.length > 0;

/** Replace a drawing immutably. `undoable` snapshots the previous state. */
export function updateDrawing(id: string, next: Partial<Drawing>, opts: { undoable?: boolean; save?: boolean } = {}) {
  const d = cache.get(id);
  if (!d) return;
  if (opts.undoable) {
    undoStack.push({ id, strokes: d.strokes, h: d.h });
    if (undoStack.length > 200) undoStack.shift();
    undoListeners.forEach((l) => l());
  }
  cache.set(id, { ...d, ...next });
  if (opts.save !== false) { dirty.add(id); scheduleSave(); }
  notify(id);
}

export function undo() {
  const e = undoStack.pop();
  undoListeners.forEach((l) => l());
  if (!e) return;
  updateDrawing(e.id, { strokes: e.strokes, h: e.h });
}

/** Re-fetch drawings (changed on another device). */
export async function refreshDrawings(ids: string[]) {
  await Promise.all(ids.map(async (id) => {
    if (dirty.has(id)) return; // local edits win
    const raw = await api.getDrawing(id).catch(() => null);
    if (raw && !dirty.has(id)) { cache.set(id, raw as Drawing); notify(id); }
  }));
}

// ---- saving ----
const dirty = new Set<string>();
let timer: number | undefined;
export const hasPendingDrawings = () => dirty.size > 0;

function scheduleSave() {
  clearTimeout(timer);
  timer = window.setTimeout(() => flushDrawings(), 700);
}

export function flushDrawings(keepalive = false) {
  clearTimeout(timer);
  const ids = [...dirty];
  dirty.clear();
  return Promise.all(ids.map((id) => {
    const d = cache.get(id);
    if (!d) return;
    return api.saveDrawing(id, JSON.stringify(d), d.pageId, keepalive).catch((e) => {
      console.error('drawing save failed', e);
      dirty.add(id);
      scheduleSave();
    });
  }));
}

/** The page currently open (new drawings belong to it). */
export const pageCtx = { pageId: '' };
