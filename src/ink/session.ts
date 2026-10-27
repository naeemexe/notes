import type { Stroke } from './drawStore';
import { getTools, type InkTool } from './tools';
import { HL_ALPHA, strokeShape } from './render';
import { inkColor } from '../theme';

/** Something that can receive a stroke drawn in client (viewport) coordinates. */
export type InkTarget = {
  scale(): number;
  onMove?(clientX: number, clientY: number): void;
  commit(points: number[], meta: Omit<Stroke, 'p'>): void | Promise<void>;
  erase?(clientX: number, clientY: number, first: boolean): void;
};

// tip: the latest sample when it was too close to store; drawn live so the line always reaches the pen
type Live = { points: number[]; meta: Omit<Stroke, 'p'>; scale: number; tip?: number[] };

// ---- full-viewport overlay that shows the stroke while it's being drawn ----
let overlay: HTMLCanvasElement | null = null;
let octx: CanvasRenderingContext2D | null = null;
let live: Live | null = null;
const pending = new Set<Live>(); // strokes waiting for an async commit (e.g. new block being created)
let raf = 0;

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('canvas');
  overlay.className = 'ink-overlay';
  document.body.appendChild(overlay);
  octx = overlay.getContext('2d');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    overlay!.width = Math.round(window.innerWidth * dpr);
    overlay!.height = Math.round(window.innerHeight * dpr);
    overlay!.style.width = `${window.innerWidth}px`;
    overlay!.style.height = `${window.innerHeight}px`;
    paint();
  };
  window.addEventListener('resize', resize);
  resize();
}

function paintOne(l: Live) {
  const ctx = octx!;
  ctx.fillStyle = inkColor(l.meta.c);
  ctx.globalAlpha = l.meta.k === 'hl' ? HL_ALPHA : 1;
  const pts = l.tip ? l.points.concat(l.tip) : l.points;
  ctx.fill(strokeShape(pts, 3, l.meta.k, l.meta.s * l.scale, !!l.meta.pr));
}

function paint() {
  raf = 0;
  if (!overlay || !octx) return;
  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pending.forEach(paintOne);
  if (live) paintOne(live);
  octx.globalAlpha = 1;
}
const schedulePaint = () => { if (!raf) raf = requestAnimationFrame(paint); };

const MIN_DIST = 1; // screen px between stored points
const P_SMOOTH = 0.35; // weight of each new pressure sample

let activePointer: number | null = null;
export const isInking = () => activePointer !== null;

export function startInk(e: PointerEvent, tool: InkTool, target: InkTarget) {
  if (activePointer !== null) return; // one stroke at a time (palm etc.)
  ensureOverlay();
  activePointer = e.pointerId;
  const pressure = e.pointerType === 'pen';
  const t = getTools();
  const scale = target.scale() || 1;

  let move: (ev: PointerEvent) => void;
  let up: (ev: PointerEvent) => void;
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    activePointer = null;
  };

  if (tool === 'eraser') {
    target.erase?.(e.clientX, e.clientY, true);
    move = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointer) return;
      const evs = ev.getCoalescedEvents?.() || [ev];
      for (const c of evs.length ? evs : [ev]) target.erase?.(c.clientX, c.clientY, false);
    };
    up = (ev: PointerEvent) => { if (ev.pointerId === activePointer) end(); };
  } else {
    const meta: Omit<Stroke, 'p'> = tool === 'highlighter'
      ? { k: 'hl', c: t.hlColor, s: t.hlSize / scale, pr: 0 }
      : { k: 'pen', c: t.penColor, s: t.penSize / scale, pr: pressure ? 1 : 0 };
    const l: Live = { points: [], meta, scale };
    live = l;
    // Positions stay raw (no averaging, so nothing lags behind the pen); samples closer than
    // MIN_DIST px are skipped (sub-pixel noise), and only pressure is averaged so width doesn't flicker.
    let p = pressure ? e.pressure || 0.5 : 0.5;
    const push = (x: number, y: number, pr: number) => {
      l.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100) / 100);
    };
    // iPad Safari re-sends samples it already delivered in later coalesced batches. Each one is
    // a step backwards, which used to show as beads along the line.
    // They repeat an earlier position exactly, so skip any sample we've recently seen.
    const recent: number[] = [];
    const add = (ev: PointerEvent) => {
      const x = Math.round(ev.clientX * 10) / 10, y = Math.round(ev.clientY * 10) / 10;
      for (let i = 0; i < recent.length; i += 2) if (recent[i] === x && recent[i + 1] === y) return;
      recent.push(x, y);
      if (recent.length > 64) recent.splice(0, 2);
      if (pressure) p += P_SMOOTH * ((ev.pressure || p) - p);
      const n = l.points.length;
      const d = Math.hypot(x - l.points[n - 3], y - l.points[n - 2]);
      if (d >= MIN_DIST) { push(x, y, p); l.tip = undefined; }
      else l.tip = d > 0 ? [x, y, Math.round(p * 100) / 100] : undefined;
    };
    push(e.clientX, e.clientY, p);
    recent.push(l.points[0], l.points[1]);
    schedulePaint();
    move = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointer) return;
      const evs = ev.getCoalescedEvents?.() || [];
      for (const c of evs.length ? evs : [ev]) add(c);
      target.onMove?.(ev.clientX, ev.clientY);
      schedulePaint();
    };
    up = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointer) return;
      end();
      live = null;
      if (l.tip) l.points.push(...l.tip); // end exactly where the line was drawn
      l.tip = undefined;
      if (l.points.length === 3) l.points.push(l.points[0] + 0.5, l.points[1] + 0.5, l.points[2]); // a dot
      pending.add(l);
      Promise.resolve(target.commit(l.points, meta)).finally(() => {
        // let the committed stroke paint in its block before removing the preview
        requestAnimationFrame(() => requestAnimationFrame(() => { pending.delete(l); schedulePaint(); }));
      });
      schedulePaint();
    };
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/**
 * iPad: stop Apple Pencil from scrolling, selecting text, or triggering the magnifier
 * on ink surfaces, while a finger still scrolls normally. Also blocks pinch zoom everywhere.
 */
export function installStylusGuard() {
  const guard = (e: TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('.ink-surface')) return;
    for (const t of Array.from(e.touches)) {
      if ((t as Touch & { touchType?: string }).touchType === 'stylus' || isInking()) {
        e.preventDefault();
        return;
      }
    }
  };
  document.addEventListener('touchstart', guard, { passive: false });
  document.addEventListener('touchmove', guard, { passive: false });

  // No page zoom: Safari ignores user-scalable=no in a browser tab, and a zoomed page
  // makes the live stroke draw offset and at the wrong width until it's committed.
  const noZoom = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, noZoom, { passive: false });
  }
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}
