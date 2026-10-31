import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor,
  withMultiColumn,
} from '@blocknote/xl-multi-column';
import { api, knownRev, newId, type PageFull } from './api';
import { DrawingBlock } from './ink/DrawingBlock';
import {
  controllers, createDrawing, DEFAULT_H, flushDrawings, hasPendingDrawings, pageCtx, refreshDrawings,
} from './ink/drawStore';
import { startInk } from './ink/session';
import { inkToolFor } from './ink/tools';
import { useTheme } from './theme';

const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, drawing: DrawingBlock() },
  }),
);
type Editor = typeof schema.BlockNoteEditor;
type Block = Editor['document'][number];

function mergeByGroup(items: Omit<DefaultReactSuggestionItem, 'key'>[]) {
  const order: string[] = [];
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const g = it.group || '';
    if (!groups.has(g)) { groups.set(g, []); order.push(g); }
    groups.get(g)!.push(it);
  }
  return order.flatMap((g) => groups.get(g)!);
}

function drawingIds(blocks: Block[], out: string[] = []) {
  for (const b of blocks) {
    if (b.type === 'drawing') out.push((b.props as { drawingId: string }).drawingId || b.id);
    if (b.children?.length) drawingIds(b.children as Block[], out);
  }
  return out;
}

const isEmptyParagraph = (b: Block | undefined) =>
  !!b && b.type === 'paragraph' && (!Array.isArray(b.content) || b.content.length === 0) && !b.children?.length;

const waitFor = <T,>(fn: () => T | undefined, frames = 90) =>
  new Promise<T | undefined>((resolve) => {
    let n = 0;
    const tick = () => {
      const v = fn();
      if (v || n++ > frames) resolve(v);
      else requestAnimationFrame(tick);
    };
    tick();
  });

export function PageView({ pageId, remoteRev, onTitle }: {
  pageId: string;
  remoteRev: number;
  onTitle: (id: string, title: string) => void;
}) {
  const [page, setPage] = useState<PageFull | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setPage(null);
    setError('');
    pageCtx.pageId = pageId;
    api.getPage(pageId).then((p) => alive && setPage(p)).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [pageId]);

  if (error) return <div className="page-msg">Couldn’t load this page. {error}</div>;
  if (!page) return <div className="page-msg">Loading…</div>;
  return <PageEditor key={page.id} page={page} remoteRev={remoteRev} onTitle={onTitle} />;
}

function PageEditor({ page, remoteRev, onTitle }: {
  page: PageFull;
  remoteRev: number;
  onTitle: (id: string, title: string) => void;
}) {
  const id = page.id;
  const [title, setTitle] = useState(page.title);
  const tailRef = useRef<HTMLDivElement>(null);

  const editor = useCreateBlockNote({
    schema,
    initialContent: page.blocks.length ? (page.blocks as Block[]) : undefined,
    dropCursor: multiColumnDropCursor,
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    uploadFile: (file) => api.upload(file),
    trailingBlock: false,
  });

  // ---- saving ----
  const lastSaved = useRef(JSON.stringify(editor.document));
  const saveTimer = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);

  const saveNow = useCallback((keepalive = false) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const json = JSON.stringify(editor.document);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    inFlight.current = true;
    api.savePage(id, { blocks: editor.document }, keepalive)
      .catch((e) => { console.error(e); lastSaved.current = ''; saveTimer.current = window.setTimeout(() => saveNow(), 2000); })
      .finally(() => { inFlight.current = false; });
  }, [editor, id]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveNow(), 600);
  }, [saveNow]);

  useEffect(() => {
    const flush = () => { saveNow(true); flushDrawings(true); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [saveNow]);

  // title
  const titleTimer = useRef<number | undefined>(undefined);
  const changeTitle = (t: string) => {
    setTitle(t);
    onTitle(id, t);
    clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => api.savePage(id, { title: t }), 500);
  };

  // ---- pick up edits made on another device ----
  useEffect(() => {
    if (remoteRev <= (knownRev.get(id) || 0)) return;
    if (saveTimer.current || inFlight.current || hasPendingDrawings()) return; // local edits pending: ours win
    let alive = true;
    api.getPage(id).then((p) => {
      if (!alive || saveTimer.current || inFlight.current) return;
      const json = JSON.stringify(p.blocks);
      if (json !== lastSaved.current && json !== JSON.stringify(editor.document)) {
        lastSaved.current = json;
        editor.replaceBlocks(editor.document, p.blocks as Block[]);
        lastSaved.current = JSON.stringify(editor.document);
      }
      if (p.title !== title) setTitle(p.title);
      refreshDrawings(drawingIds(editor.document));
    });
    return () => { alive = false; };
  }, [remoteRev, id, editor, title]);

  // ---- the area below the last block: pen here starts / continues a drawing ----
  useEffect(() => {
    const tail = tailRef.current!;
    const onDown = (e: PointerEvent) => {
      const tool = inkToolFor(e.pointerType);
      if (!tool || tool === 'eraser' || tool === 'lasso') return;
      e.preventDefault();
      const lastBlock = () => editor.document[editor.document.length - 1];
      const lastDrawing = () => {
        const b = lastBlock();
        return b?.type === 'drawing' ? controllers.get((b.props as { drawingId: string }).drawingId || b.id) : undefined;
      };
      startInk(e, tool, {
        scale: () => lastDrawing()?.scale() || 1,
        commit: async (points, meta) => {
          const existing = lastDrawing();
          if (existing) { existing.commitClient(points, meta); return; }
          const did = newId();
          createDrawing({ id: did, pageId: id, w: 0, h: DEFAULT_H, strokes: [] });
          const block = { type: 'drawing' as const, props: { drawingId: did } };
          const last = lastBlock();
          if (isEmptyParagraph(last) && editor.document.length > 1) editor.replaceBlocks([last], [block]);
          else editor.insertBlocks([block], last, 'after');
          const ctrl = await waitFor(() => controllers.get(did));
          ctrl?.commitClient(points, meta);
        },
      });
    };
    tail.addEventListener('pointerdown', onDown);
    return () => tail.removeEventListener('pointerdown', onDown);
  }, [editor, id]);

  // click below the content in type mode → continue typing at the end
  const onTailClick = (e: React.MouseEvent) => {
    if (inkToolFor((e.nativeEvent as PointerEvent).pointerType || 'mouse')) return; // that was ink, not a click
    const doc = editor.document;
    const last = doc[doc.length - 1];
    if (isEmptyParagraph(last)) {
      editor.setTextCursorPosition(last, 'end');
    } else {
      const [inserted] = editor.insertBlocks([{ type: 'paragraph' }], last, 'after');
      editor.setTextCursorPosition(inserted, 'end');
    }
    editor.focus();
  };

  const theme = useTheme();

  const slashItems = useCallback(async (query: string) => {
    const items = mergeByGroup([
      ...getDefaultReactSlashMenuItems(editor),
      ...getMultiColumnSlashMenuItems(editor),
      {
        title: 'Drawing',
        subtext: 'Handwriting / sketch area that grows as you write',
        aliases: ['ink', 'draw', 'pencil', 'sketch', 'canvas', 'handwriting'],
        group: 'Basic blocks',
        icon: <span style={{ fontSize: 16 }}>✏️</span>,
        onItemClick: () => {
          insertOrUpdateBlockForSlashMenu(editor, { type: 'drawing', props: { drawingId: newId() } });
        },
      },
    ]);
    return filterSuggestionItems(items, query);
  }, [editor]);

  return (
    <div className="page">
      <input
        className="page-title"
        value={title}
        placeholder="Untitled"
        onChange={(e) => changeTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = editor.document[0];
            if (first) editor.setTextCursorPosition(first, 'start');
            editor.focus();
          }
        }}
      />
      <BlockNoteView editor={editor} theme={theme} slashMenu={false} onChange={scheduleSave}>
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
      </BlockNoteView>
      <div ref={tailRef} className="ink-surface page-tail" onClick={onTailClick} />
    </div>
  );
}
