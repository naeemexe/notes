import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, newId, type PageMeta } from './api';
import { PageView } from './PageEditor';
import { canUndo, onUndoChange, undo } from './ink/drawStore';
import { installStylusGuard } from './ink/session';
import { inkColor, toggleTheme, useTheme } from './theme';
import {
  HL_COLORS, HL_SIZES, PEN_COLORS, PEN_SIZES, setTools, useTools, type Tool,
} from './ink/tools';

installStylusGuard();

const LAST_KEY = 'notes.lastPage';
const EXPANDED_KEY = 'notes.expanded';
const idFromHash = () => (location.hash.match(/^#\/p\/([\w-]+)/) || [])[1] || '';

export default function App() {
  const [pages, setPages] = useState<PageMeta[] | null>(null);
  const [current, setCurrent] = useState<string>(() => idFromHash() || localStorage.getItem(LAST_KEY) || '');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listPages();
      setPages(list);
      setOffline(false);
      return list;
    } catch {
      setOffline(true);
      return null;
    }
  }, []);

  // initial load + poll for changes from other devices
  useEffect(() => {
    refresh().then(async (list) => {
      if (!list) return;
      if (!list.length) {
        const id = newId();
        const meta = await api.savePage(id, { title: 'My first note', parentId: null, order: Date.now(), blocks: [] });
        setPages([meta]);
        open(id);
      } else if (!list.some((p) => p.id === current)) {
        open([...list].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
      } else {
        open(current);
      }
    });
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 4000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const onHash = () => { const id = idFromHash(); if (id) setCurrent(id); };
    window.addEventListener('hashchange', onHash);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); window.removeEventListener('hashchange', onHash); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => {
    setCurrent(id);
    localStorage.setItem(LAST_KEY, id);
    if (idFromHash() !== id) history.replaceState(null, '', `#/p/${id}`);
    if (window.innerWidth <= 900) setSidebar(false);
  };

  const createPage = async (parentId: string | null) => {
    const id = newId();
    const meta = await api.savePage(id, { title: '', parentId, order: Date.now(), blocks: [] });
    setPages((ps) => [...(ps || []), meta]);
    open(id);
    setTimeout(() => document.querySelector<HTMLInputElement>('.page-title')?.focus(), 50);
  };

  const deletePage = async (p: PageMeta) => {
    if (!confirm(`Delete “${p.title || 'Untitled'}” and its sub-pages?`)) return;
    const { deleted } = await api.deletePage(p.id);
    const rest = (pages || []).filter((x) => !deleted.includes(x.id));
    setPages(rest);
    if (deleted.includes(current)) {
      if (rest.length) open(rest[0].id);
      else createPage(null);
    }
  };

  const onTitle = useCallback((id: string, title: string) => {
    setPages((ps) => ps && ps.map((p) => (p.id === id ? { ...p, title } : p)));
  }, []);

  // keyboard shortcuts (only when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      if (e.key === 'Escape') { setTools({ tool: 'type' }); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, Tool> = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'type' };
      if (map[e.key]) { setTools({ tool: map[e.key] }); e.preventDefault(); }
      if (e.key === 'z' || e.key === 'u') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const currentMeta = pages?.find((p) => p.id === current);

  return (
    <div className={`app ${sidebar ? 'with-sidebar' : ''}`}>
      {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">✏️ Notes</span>
          <button className="icon-btn" onClick={() => setSidebar(false)} title="Hide sidebar">«</button>
        </div>
        <PageTree pages={pages || []} current={current} onOpen={open} onAdd={createPage} onDelete={deletePage} />
        <button className="new-page" onClick={() => createPage(null)}>＋ New page</button>
      </aside>
      <main className="main">
        <Toolbar sidebar={sidebar} onSidebar={() => setSidebar((s) => !s)} offline={offline} />
        <div className="scroller">
          {current && pages && currentMeta && (
            <PageView pageId={current} remoteRev={currentMeta.rev} onTitle={onTitle} />
          )}
          {!pages && !offline && <div className="page-msg">Loading…</div>}
          {offline && !pages && <div className="page-msg">Can’t reach the notes server. Is it running on your Mac?</div>}
        </div>
      </main>
    </div>
  );
}

function PageTree({ pages, current, onOpen, onAdd, onDelete }: {
  pages: PageMeta[];
  current: string;
  onOpen: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onDelete: (p: PageMeta) => void;
}) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) || '{}'); } catch { return {}; }
  });
  const toggle = (id: string) => setExpanded((x) => {
    const n = { ...x, [id]: !x[id] };
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(n));
    return n;
  });

  const children = useMemo(() => {
    const m = new Map<string | null, PageMeta[]>();
    const ids = new Set(pages.map((p) => p.id));
    for (const p of pages) {
      const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
      if (!m.has(parent)) m.set(parent, []);
      m.get(parent)!.push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.order - b.order);
    return m;
  }, [pages]);

  // keep ancestors of the current page expanded
  const ancestors = useMemo(() => {
    const s = new Set<string>();
    const byId = new Map(pages.map((p) => [p.id, p]));
    let p = byId.get(current);
    while (p?.parentId && !s.has(p.parentId)) { s.add(p.parentId); p = byId.get(p.parentId); }
    return s;
  }, [pages, current]);

  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    const hits = pages.filter((p) => (p.title || 'untitled').toLowerCase().includes(needle));
    return (
      <div className="tree">
        <input className="search" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} />
        {hits.map((p) => (
          <div key={p.id} className={`row ${p.id === current ? 'active' : ''}`} onClick={() => onOpen(p.id)}>
            <span className="row-title">{p.title || 'Untitled'}</span>
          </div>
        ))}
      </div>
    );
  }

  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) || []).map((p) => {
      const kids = children.get(p.id);
      const open = expanded[p.id] || ancestors.has(p.id);
      return (
        <div key={p.id}>
          <div
            className={`row ${p.id === current ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onOpen(p.id)}
          >
            <span
              className={`chev ${kids ? '' : 'empty'} ${open ? 'open' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggle(p.id); }}
            >›</span>
            <span className="row-title">{p.title || 'Untitled'}</span>
            <span className="row-actions">
              <button title="Add sub-page" onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [p.id]: true })); onAdd(p.id); }}>＋</button>
              <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(p); }}>🗑</button>
            </span>
          </div>
          {kids && open && render(p.id, depth + 1)}
        </div>
      );
    });

  return (
    <div className="tree">
      <input className="search" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} />
      {render(null, 0)}
    </div>
  );
}

const ICONS: Record<Tool, React.ReactNode> = {
  type: <svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M9 19h6" /></svg>,
  pen: <svg viewBox="0 0 24 24"><path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4z" /></svg>,
  highlighter: <svg viewBox="0 0 24 24"><path d="M9 15l-4 4h5l2-2M9 15l7-10 4 3-7 10-4-3z" /></svg>,
  eraser: <svg viewBox="0 0 24 24"><path d="M8 20h12M4 15l8-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-7 8H8l-4-5z" /></svg>,
};
const LABELS: Record<Tool, string> = { type: 'Type (T / Esc)', pen: 'Pen (P)', highlighter: 'Highlighter (H)', eraser: 'Eraser (E)' };

function Toolbar({ sidebar, onSidebar, offline }: { sidebar: boolean; onSidebar: () => void; offline: boolean }) {
  const t = useTools();
  const undoable = useSyncExternalStore(onUndoChange, canUndo);
  const theme = useTheme();
  const isHl = t.tool === 'highlighter' || (t.tool === 'type' && t.lastInk === 'highlighter');
  const showInkOptions = t.tool === 'pen' || t.tool === 'highlighter';
  const colors = isHl ? HL_COLORS : PEN_COLORS;
  const sizes = isHl ? HL_SIZES : PEN_SIZES;
  const color = isHl ? t.hlColor : t.penColor;
  const size = isHl ? t.hlSize : t.penSize;

  return (
    <div className="toolbar">
      {!sidebar && <button className="icon-btn" onClick={onSidebar} title="Show pages">☰</button>}
      <div className="seg">
        {(['type', 'pen', 'highlighter', 'eraser'] as Tool[]).map((k) => (
          <button key={k} className={`tool ${t.tool === k ? 'on' : ''}`} title={LABELS[k]} onClick={() => setTools({ tool: k })}>
            {ICONS[k]}
          </button>
        ))}
      </div>
      {showInkOptions && (
        <>
          <div className="seg">
            {colors.map((c) => (
              <button
                key={c}
                className={`swatch ${c === color ? 'on' : ''}`}
                style={{ background: inkColor(c) }}
                onClick={() => setTools(isHl ? { hlColor: c } : { penColor: c })}
              />
            ))}
          </div>
          <div className="seg">
            {sizes.map((s, i) => (
              <button
                key={s}
                className={`size ${s === size ? 'on' : ''}`}
                onClick={() => setTools(isHl ? { hlSize: s } : { penSize: s })}
                title={['Fine', 'Medium', 'Thick'][i]}
              >
                <span style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
              </button>
            ))}
          </div>
        </>
      )}
      <button className="icon-btn" disabled={!undoable} onClick={undo} title="Undo ink (Z)">↶</button>
      <div className="spacer" />
      {offline && <span className="offline">offline – changes not saving</span>}
      <button
        className={`chip ${t.fingerDraw ? 'on' : ''}`}
        onClick={() => setTools({ fingerDraw: !t.fingerDraw })}
        title="Allow drawing with your finger (otherwise finger scrolls)"
      >☝️ <span className="chip-label">{t.fingerDraw ? 'Finger draws' : 'Finger scrolls'}</span></button>
      <button
        className="icon-btn"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >{theme === 'dark' ? '☀️' : '🌙'}</button>
    </div>
  );
}
