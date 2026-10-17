// Notes server: serves the built app + a tiny JSON-file API.
// Zero dependencies. Data lives in ./data (pages, drawings, uploaded files).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 5180);

for (const d of ['pages', 'drawings', 'files']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

const INDEX_FILE = path.join(DATA, 'index.json');
/** @type {Record<string, {id:string,title:string,parentId:string|null,order:number,rev:number,updatedAt:number}>} */
let index = {};
try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { index = {}; }

// Serialize writes per file so concurrent saves never interleave.
const queues = new Map();
function writeAtomic(file, data) {
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.then(async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
  }).catch((e) => console.error('write failed', file, e));
  queues.set(file, next);
  return next;
}
const saveIndex = () => writeAtomic(INDEX_FILE, JSON.stringify(index));

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

async function serveFile(res, file, cache) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  } catch { return false; }
}

async function api(req, res, parts) {
  const [kind, id] = parts;

  if (kind === 'pages' && !id) {
    if (req.method === 'GET') return send(res, 200, Object.values(index));
  }

  if (kind === 'pages' && id) {
    if (!safeId(id)) return send(res, 400, { error: 'bad id' });
    const file = path.join(DATA, 'pages', `${id}.json`);
    if (req.method === 'GET') {
      const meta = index[id];
      if (!meta) return send(res, 404, { error: 'not found' });
      let blocks = [];
      try { blocks = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* empty page */ }
      return send(res, 200, { ...meta, blocks });
    }
    if (req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const prev = index[id];
      const meta = {
        id,
        title: typeof body.title === 'string' ? body.title : prev?.title ?? '',
        parentId: body.parentId !== undefined ? body.parentId : prev?.parentId ?? null,
        order: typeof body.order === 'number' ? body.order : prev?.order ?? Date.now(),
        icon: body.icon !== undefined ? body.icon : prev?.icon ?? '',
        rev: (prev?.rev || 0) + 1,
        updatedAt: Date.now(),
      };
      index[id] = meta;
      if (Array.isArray(body.blocks)) await writeAtomic(file, JSON.stringify(body.blocks));
      else if (!prev) await writeAtomic(file, '[]');
      await saveIndex();
      return send(res, 200, meta);
    }
    if (req.method === 'DELETE') {
      // delete page and all descendants
      const doomed = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of Object.values(index)) if (p.parentId && doomed.has(p.parentId) && !doomed.has(p.id)) { doomed.add(p.id); grew = true; }
      }
      for (const d of doomed) {
        delete index[d];
        await fsp.rm(path.join(DATA, 'pages', `${d}.json`), { force: true });
      }
      await saveIndex();
      return send(res, 200, { deleted: [...doomed] });
    }
  }

  if (kind === 'drawings' && id) {
    if (!safeId(id)) return send(res, 400, { error: 'bad id' });
    const file = path.join(DATA, 'drawings', `${id}.json`);
    if (req.method === 'GET') {
      try { return send(res, 200, await fsp.readFile(file, 'utf8'), { 'content-type': 'application/json' }); }
      catch { return send(res, 404, { error: 'not found' }); }
    }
    if (req.method === 'PUT') {
      const raw = (await readBody(req)).toString('utf8');
      const parsed = JSON.parse(raw); // validate
      await writeAtomic(file, raw);
      // bump the owning page's rev so other devices know to refresh
      if (parsed.pageId && index[parsed.pageId]) {
        index[parsed.pageId].rev += 1;
        index[parsed.pageId].updatedAt = Date.now();
        await saveIndex();
      }
      return send(res, 200, { ok: true, rev: parsed.pageId ? index[parsed.pageId]?.rev : undefined });
    }
  }

  if (kind === 'files' && req.method === 'POST') {
    const buf = await readBody(req);
    const orig = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    const ext = path.extname(orig).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const name = `${crypto.randomBytes(10).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(DATA, 'files', name), buf);
    return send(res, 200, { url: `/files/${name}` });
  }

  return send(res, 404, { error: 'unknown route' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, p.slice(5).split('/').filter(Boolean));
    if (p.startsWith('/files/')) {
      const name = path.basename(p);
      if (await serveFile(res, path.join(DATA, 'files', name), true)) return;
      return send(res, 404, 'not found');
    }
    // static app
    const rel = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    if (rel !== '/' && await serveFile(res, path.join(DIST, rel), rel.startsWith('/assets/'))) return;
    if (await serveFile(res, path.join(DIST, 'index.html'), false)) return;
    send(res, 503, 'App not built yet. Run: npm run build');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  Notes running`);
  console.log(`  Mac:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  iPad:  http://${ip}:${PORT}`);
  console.log(`  Data:  ${DATA}\n`);
});
