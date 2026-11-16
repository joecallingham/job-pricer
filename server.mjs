// Job Pricer local server. Binds to 127.0.0.1 only: quotes hold client details
// and the Nuckle desktop licence rules out serving the fonts publicly.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env yet: parsing stays off */ }

const { parseBrief, hasKey, ParseError, MODEL } = await import('./src/parse.mjs');

const PORT = Number(process.env.PORT) || 4350;
const HOST = '127.0.0.1';
const QUOTES = join(ROOT, 'quotes');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ID = /^q-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]{3,12}$/;

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function body(req, limit = 2_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new ParseError('Too large', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ParseError('Bad JSON', 400); }
}

async function staticFile(res, urlPath) {
  const map = urlPath === '/' ? '/public/index.html'
    : ['/src/pricing.js', '/src/catalogue.js'].includes(urlPath) ? urlPath
    : `/public${urlPath}`;
  const file = normalize(join(ROOT, map));
  if (!file.startsWith(join(ROOT, 'public')) && ![join(ROOT, 'src', 'pricing.js'), join(ROOT, 'src', 'catalogue.js')].includes(file)) return send(res, 404, { error: 'Not found' });
  try { send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream'); }
  catch { send(res, 404, { error: 'Not found' }); }
}

async function listQuotes() {
  await mkdir(QUOTES, { recursive: true });
  const files = (await readdir(QUOTES)).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const q = JSON.parse(await readFile(join(QUOTES, f), 'utf8'));
      out.push({ id: q.id, client: q.client, project: q.project, status: q.status, updatedAt: q.updatedAt, low: q.totals?.low ?? null, high: q.totals?.high ?? null });
    } catch { /* skip a broken file rather than break the list */ }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  try {
    // Only same-origin pages may write (stops another site in the browser posting to localhost).
    // Compares hosts, not schemes, so it also works behind `tailscale serve` (https in front, http here).
    if (req.method !== 'GET' && req.headers.origin) {
      let ok = false;
      try { ok = new URL(req.headers.origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch {}
      if (!ok) return send(res, 403, { error: 'Forbidden' });
    }

    if (p === '/api/status' && req.method === 'GET') return send(res, 200, { claude: hasKey(), model: MODEL });

    if (p === '/api/parse' && req.method === 'POST') {
      const { brief } = await body(req);
      return send(res, 200, await parseBrief(String(brief || '').slice(0, 60_000)));
    }

    if (p === '/api/catalogue' && req.method === 'GET') return send(res, 200, JSON.parse(await readFile(join(ROOT, 'data', 'catalogue.json'), 'utf8')));

    if (p === '/api/quotes' && req.method === 'GET') return send(res, 200, await listQuotes());

    const m = p.match(/^\/api\/quotes\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (!ID.test(id)) return send(res, 400, { error: 'Bad id' });
      const file = join(QUOTES, `${id}.json`);
      if (req.method === 'GET') {
        try { return send(res, 200, JSON.parse(await readFile(file, 'utf8'))); } catch { return send(res, 404, { error: 'Not found' }); }
      }
      if (req.method === 'PUT') {
        const q = await body(req);
        if (q.id !== id || q.version !== 1) return send(res, 400, { error: 'Bad quote' });
        await mkdir(QUOTES, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(q, null, 2));
        await rename(tmp, file);              // atomic: a crash never leaves half a quote
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && !p.startsWith('/api/')) return staticFile(res, p);
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof ParseError ? err.status : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Something broke on the server' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Job Pricer on http://${HOST}:${PORT}  (Claude parsing ${hasKey() ? 'on' : 'off: no ANTHROPIC_API_KEY in .env'})`);
});
