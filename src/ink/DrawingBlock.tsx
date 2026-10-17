import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import {
  bbox, controllers, DEFAULT_H, getDrawing, loadDrawing, pageCtx, subscribe, updateDrawing,
  type Stroke,
} from './drawStore';
import { drawStrokes } from './render';
import { startInk } from './session';
import { inkToolFor, useTools } from './tools';

/** Height of one canvas tile in base units. Tiling keeps us under iPad canvas size limits for very long drawings. */
const TILE = 1024;
const GROW_TRIGGER = 140; // when ink gets this close to the bottom...
const GROW_TO = 320; // ...add this much room below it

export const DrawingBlock = createReactBlockSpec(
  {
    type: 'drawing',
    propSchema: { drawingId: { default: '' } },
    content: 'none',
  },
  {
    render: (props) => (
      <DrawingView
        id={props.block.props.drawingId || props.block.id}
        onDelete={() => props.editor.removeBlocks([props.block.id])}
      />
    ),
  },
);

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

function hits(s: Stroke, x: number, y: number, r: number) {
  const [x0, y0, x1, y1] = bbox(s);
  if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return false;
  const rr = r + s.s / 2;
  const p = s.p;
  if (p.length <= 3) return Math.hypot(p[0] - x, p[1] - y) < rr;
  for (let i = 3; i < p.length; i += 3) {
    if (distToSeg(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) < rr) return true;
  }
  return false;
}

function DrawingView({ id, onDelete }: { id: string; onDelete: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const d = useSyncExternalStore((cb) => subscribe(id, cb), () => getDrawing(id));
  const [width, setWidth] = useState(0);
  const [menu, setMenu] = useState(false);
  const tools = useTools();

  useEffect(() => { if (!getDrawing(id)) loadDrawing(id, pageCtx.pageId); }, [id]);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // pin the base width the first time we know it
  useEffect(() => {
    if (d && !d.w && width) updateDrawing(id, { w: width }, { save: false });
  }, [d, width, id]);

  const baseW = d?.w || width || 1;
  const scale = width ? width / baseW : 1;
  const h = d?.h ?? DEFAULT_H;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const el = wrapRef.current!;
    const toBase = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const s = scaleRef.current;
      return [(cx - r.left) / s, (cy - r.top) / s] as const;
    };
    const commitClient = (points: number[], meta: Omit<Stroke, 'p'>) => {
      const cur = getDrawing(id);
      if (!cur) return;
      const r = el.getBoundingClientRect();
      const s = scaleRef.current;
      const p = new Array<number>(points.length);
      let maxY = 0;
      for (let i = 0; i < points.length; i += 3) {
        p[i] = Math.round(((points[i] - r.left) / s) * 10) / 10;
        p[i + 1] = Math.round(((points[i + 1] - r.top) / s) * 10) / 10;
        p[i + 2] = points[i + 2];
        if (p[i + 1] > maxY) maxY = p[i + 1];
      }
      const nh = maxY > cur.h - GROW_TRIGGER ? Math.ceil(maxY + GROW_TO) : cur.h;
      updateDrawing(id, { strokes: [...cur.strokes, { ...meta, p }], h: nh, w: cur.w || r.width }, { undoable: true });
    };
    controllers.set(id, { el, scale: () => scaleRef.current, commitClient });

    let erasedThisGesture = false;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.ink-chrome')) return;
      const tool = inkToolFor(e.pointerType);
      if (!tool) return;
      e.preventDefault();
      e.stopPropagation();
      startInk(e, tool, {
        scale: () => scaleRef.current,
        onMove: (_cx, cy) => {
          const cur = getDrawing(id);
          if (!cur) return;
          const [, by] = toBase(0, cy);
          if (by > cur.h - GROW_TRIGGER) updateDrawing(id, { h: Math.ceil(by + GROW_TO) }, { save: false });
        },
        commit: commitClient,
        erase: (cx, cy, first) => {
          if (first) erasedThisGesture = false;
          const cur = getDrawing(id);
          if (!cur) return;
          const [x, y] = toBase(cx, cy);
          const r = 10 / scaleRef.current;
          const keep = cur.strokes.filter((s) => !hits(s, x, y, r));
          if (keep.length !== cur.strokes.length) {
            updateDrawing(id, { strokes: keep }, { undoable: !erasedThisGesture });
            erasedThisGesture = true;
          }
        },
      });
    };
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      if (controllers.get(id)?.el === el) controllers.delete(id);
    };
  }, [id]);

  // manual resize handle (drag the bar under the drawing)
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = getDrawing(id)?.h ?? DEFAULT_H;
    const move = (ev: PointerEvent) => {
      updateDrawing(id, { h: Math.max(80, Math.round(startH + (ev.clientY - startY) / scaleRef.current)) }, { save: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const cur = getDrawing(id);
      if (cur) updateDrawing(id, { h: cur.h });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const trim = () => {
    const cur = getDrawing(id);
    if (!cur) return;
    let maxY = 0;
    for (const s of cur.strokes) maxY = Math.max(maxY, bbox(s)[3]);
    updateDrawing(id, { h: Math.max(80, Math.ceil(maxY + 24)) }, { undoable: true });
    setMenu(false);
  };

  const tiles = Math.max(1, Math.ceil(h / TILE));
  const inking = tools.tool !== 'type';

  return (
    <div className={`ink-block ${inking ? 'inking' : ''}`} contentEditable={false}>
      <div
        ref={wrapRef}
        className={`ink-surface ${inking ? (tools.tool === 'eraser' ? 'cur-eraser' : 'cur-pen') : ''}`}
        style={{ height: h * scale }}
      >
        {width > 0 && d && Array.from({ length: tiles }, (_, i) => (
          <Tile key={i} index={i} strokes={d.strokes} scale={scale} width={width} tileH={Math.min(TILE, h - i * TILE)} />
        ))}
        {!d && <div className="ink-loading">Loading ink…</div>}
        {d && d.strokes.length === 0 && (
          <div className="ink-hint">{inking ? 'Draw here' : 'Pick the pen (or use Apple Pencil) to draw'}</div>
        )}
      </div>
      <div className="ink-chrome ink-menu-btn" onClick={() => setMenu((m) => !m)} title="Drawing options">⋯</div>
      {menu && (
        <div className="ink-chrome ink-menu" onMouseLeave={() => setMenu(false)}>
          <button onClick={trim}>Trim empty space</button>
          <button onClick={() => { updateDrawing(id, { strokes: [] }, { undoable: true }); setMenu(false); }}>Clear ink</button>
          <button className="danger" onClick={onDelete}>Delete drawing</button>
        </div>
      )}
      <div className="ink-chrome ink-resize" onPointerDown={onResizeDown} title="Drag to resize"><span /></div>
    </div>
  );
}

const Tile = memo(function Tile({ index, strokes, scale, width, tileH }: {
  index: number; strokes: Stroke[]; scale: number; width: number; tileH: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '800px 0px' });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current!;
    if (!visible) { c.width = 0; c.height = 0; return; } // free GPU memory off-screen
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.max(1, Math.round(tileH * scale * dpr));
    const ctx = c.getContext('2d')!;
    const top = index * TILE;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -top * dpr * scale);
    drawStrokes(ctx, strokes.filter((s) => { const b = bbox(s); return b[3] >= top && b[1] <= top + tileH; }));
  }, [visible, strokes, scale, width, tileH, index]);

  return (
    <canvas
      ref={ref}
      className="ink-tile"
      style={{ top: index * TILE * scale, height: tileH * scale }}
    />
  );
});
