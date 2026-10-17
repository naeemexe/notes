export type PageMeta = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  icon?: string;
  rev: number;
  updatedAt: number;
};

export type PageFull = PageMeta & { blocks: unknown[] };

// crypto.randomUUID needs a secure context (not available over LAN http on iPad)
export function newId(len = 16) {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

/** Highest rev this device has seen/written per page; used to detect edits from other devices. */
export const knownRev = new Map<string, number>();
const bumpRev = (id: string, rev?: number) => {
  if (rev && rev > (knownRev.get(id) || 0)) knownRev.set(id, rev);
};

export const api = {
  listPages: () => fetch('/api/pages').then((r) => json<PageMeta[]>(r)),
  getPage: async (id: string) => {
    const p = await fetch(`/api/pages/${id}`).then((r) => json<PageFull>(r));
    bumpRev(id, p.rev);
    return p;
  },
  savePage: async (id: string, body: Partial<Omit<PageFull, 'id' | 'rev' | 'updatedAt'>>, keepalive = false) => {
    const meta = await fetch(`/api/pages/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    }).then((r) => json<PageMeta>(r));
    bumpRev(id, meta.rev);
    return meta;
  },
  deletePage: (id: string) => fetch(`/api/pages/${id}`, { method: 'DELETE' }).then((r) => json<{ deleted: string[] }>(r)),
  getDrawing: async (id: string) => {
    const r = await fetch(`/api/drawings/${id}`);
    if (r.status === 404) return null;
    return json<unknown>(r);
  },
  saveDrawing: async (id: string, body: string, pageId: string, keepalive = false) => {
    const res = await fetch(`/api/drawings/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive,
    }).then((r) => json<{ rev?: number }>(r));
    bumpRev(pageId, res.rev);
  },
  upload: async (file: File) => {
    const r = await fetch('/api/files', {
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' },
      body: file,
    }).then((res) => json<{ url: string }>(res));
    return r.url;
  },
};
