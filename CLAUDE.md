# Notes

Block notes (Notion-style) + handwriting (OneNote-style). Typing on Mac, Apple Pencil on iPad.
Single user for now; a Node server on the Mac serves the app to both devices over Wi-Fi.

## Run
- `npm start` — build + serve app and API on :5180 (iPad uses http://<mac-ip>:5180)
- Dev: `npm run server` (API :5180) + `npm run dev` (Vite :5173, proxies /api and /files)
- `npx tsc -b` to typecheck. No tests yet.

## Stack
React 19 + TypeScript + Vite · BlockNote 0.56 (TipTap/ProseMirror) + @blocknote/xl-multi-column ·
Canvas ink (own renderer, no library) · `server.mjs`: zero-dependency Node http server · JSON files in `data/` (gitignored).

## Layout
- `server.mjs` — REST API + static `dist/`. Atomic, per-file queued writes.
- `src/api.ts` — all fetch calls, `knownRev` per page (sync), `newId()` (no crypto.randomUUID: iPad over http isn't a secure context).
- `src/App.tsx` — shell: sidebar page tree, toolbar, 4s polling of `/api/pages`, keyboard shortcuts.
- `src/PageEditor.tsx` — one page: title, BlockNote editor, debounced save, applies remote edits, the **tail zone**.
- `src/ink/` — ink engine, independent of the editor:
  - `tools.ts` — tool state; `inkToolFor(pointerType)` decides if a pointer inks (Pencil always; mouse in ink mode; finger only if fingerDraw).
  - `session.ts` — one live stroke on a fixed full-screen overlay canvas, then `target.commit(clientPoints)`. `installStylusGuard` stops Pencil scrolling on `.ink-surface`.
  - `DrawingBlock.tsx` — BlockNote block (`drawingId` prop only). Converts client→base coords, auto-grows, eraser hit-test, renders in 1024-unit canvas tiles (IntersectionObserver frees off-screen tiles).
  - `drawStore.ts` — drawing cache, ink undo stack, debounced saves, `controllers` registry of mounted drawings.
  - `render.ts` — points → chain of pressure-sized round dots joined by tangents → cached Path2D. Depends only on earlier points, so live ink never moves. Highlighter drawn under pen.

## Key design decisions
- Strokes are stored separately from the document (`data/drawings/<id>.json`); the doc only holds a `drawing` block with `drawingId`. Drawing never creates editor transactions.
- Stroke coords are base units relative to the drawing's `w`; rendered at `scale = actualWidth / w`.
- Strokes are captured in client coords and converted at commit, so they land where drawn even if a block was just inserted.
- Tail zone: pen below the last block extends the last drawing, or inserts a new one (replacing a trailing empty paragraph).
- Sync: every save bumps the page `rev` (drawing saves bump their page's rev). Clients reload the open page when the server rev is higher and they have no pending edits. Last write wins.

## Data (`data/`)
`index.json` (page metas: id, title, parentId, order, rev, updatedAt) · `pages/<id>.json` (BlockNote blocks) ·
`drawings/<id>.json` ({id, pageId, w, h, strokes:[{k:'pen'|'hl', c, s, pr, p:[x,y,pressure,...]}]}; a few strokes have `v:2` and [x,y,...] without pressure) · `files/` (uploads).

## Conventions
- Keep the server dependency-free. Colors/sizes are CSS variables in `src/index.css`.
- Ideas and bugs go in `BACKLOG.md`. One backlog item per session; commit after each working change.
- Known: `@blocknote/xl-multi-column` is GPL-3.0 (needs a commercial license or replacing before a closed-source launch).
