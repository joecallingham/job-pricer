// Job Pricer local server. Binds to 127.0.0.1 only: quotes hold client details
// and the Nuckle desktop licence rules out serving the fonts publicly.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readdirSync, existsSync, mkdirSync, cpSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env yet: parsing stays off */ }

const { parseBrief, hasKey, ParseError, MODEL } = await import('./src/parse.mjs');
import { invoiceLines, addDays, invoiceId, INVOICE_ID, KINDS } from './src/invoice.js';
import { invoiceHtml, printPdf, loadLogo } from './src/invoice-pdf.mjs';
import { productLabel } from './src/catalogue.js';

const PORT = Number(process.env.PORT) || 4350;
const HOST = '127.0.0.1';
// Quotes, invoices and settings live in Google Drive (My Drive/06_Claude_Work/Job Pricer) on any
// Mac with Drive, so every Mac shares the same jobs. Without Drive they stay in this folder.
const DATA = dataDir();
const QUOTES = join(DATA, 'quotes');
const INVOICES = join(DATA, 'invoices');      // client details and bank details: never in git
const SETTINGS = join(DATA, 'settings.json');  // Joe's business and bank details: never in git
adoptLocalData();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ID = /^q-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]{3,12}$/;
await loadLogo(ROOT);

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const cloud = join(homedir(), 'Library', 'CloudStorage');
  let drives = [];
  try { drives = readdirSync(cloud).filter(d => d.startsWith('GoogleDrive-')).sort(); } catch { /* no Drive */ }
  // the account that already has the folder, else the one with Joe's 06_Claude_Work (not a work Drive)
  const work = d => join(cloud, d, 'My Drive', '06_Claude_Work');
  const pick = drives.find(d => existsSync(join(work(d), 'Job Pricer'))) || drives.find(d => existsSync(work(d)));
  return pick ? join(work(pick), 'Job Pricer') : ROOT;
}

// Anything this Mac saved locally before (quotes/, invoices/, settings.json) is copied into the
// shared folder once, never over a file already there. The local copies are left as they are.
function adoptLocalData() {
  mkdirSync(DATA, { recursive: true });
  if (DATA === ROOT) return;
  for (const name of ['quotes', 'invoices', 'settings.json']) {
    const from = join(ROOT, name);
    if (existsSync(from)) cpSync(from, join(DATA, name), { recursive: true, force: false, errorOnExist: false });
  }
}

const writeJson = async (file, data) => { const tmp = `${file}.tmp`; await writeFile(tmp, JSON.stringify(data, null, 2)); await rename(tmp, file); };
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

/* ---------- settings (business details for invoices) ---------- */
const SETTING_TEXT = ['name', 'tradingName', 'address', 'email', 'accountName', 'sortCode', 'accountNumber'];
const DEFAULT_SETTINGS = { name: '', tradingName: 'Average Joe', address: '', email: '', accountName: '', sortCode: '', accountNumber: '', termsDays: 14, nextNumber: 1 };
const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS, {})) });
function cleanSettings(s, prev) {
  const out = { ...prev };
  for (const k of SETTING_TEXT) if (k in s) out[k] = String(s[k] ?? '').slice(0, 400);
  if ('termsDays' in s) out.termsDays = Math.min(120, Math.max(0, Math.round(Number(s.termsDays) || 0)));
  if ('nextNumber' in s) out.nextNumber = Math.min(999999, Math.max(1, Math.round(Number(s.nextNumber) || 1)));
  return out;
}

/* ---------- invoices ---------- */
async function listInvoices() {
  await mkdir(INVOICES, { recursive: true });
  const out = [];
  for (const f of (await readdir(INVOICES)).filter(f => f.endsWith('.json'))) {
    const inv = await readJson(join(INVOICES, f), null);
    if (inv) out.push({ id: inv.id, number: inv.number, kind: inv.kind, quoteId: inv.quoteId, client: inv.to?.client, project: inv.project, issuedAt: inv.issuedAt, dueAt: inv.dueAt, status: inv.status, total: inv.total });
  }
  return out.sort((a, b) => b.number - a.number);
}

async function issueInvoice({ quoteId, kind, depositPct }) {
  if (!ID.test(String(quoteId))) throw new ParseError('Bad quote id', 400);
  if (!KINDS.includes(kind)) throw new ParseError('Bad invoice type', 400);
  const q = await readJson(join(QUOTES, `${quoteId}.json`), null);
  if (!q) throw new ParseError('Save the quote first', 404);
  const settings = await getSettings();
  if (!settings.name.trim()) throw new ParseError('Add your name in Your details first', 400);
  const cat = await readJson(join(ROOT, 'data', 'catalogue.json'), { products: [] });
  const names = Object.fromEntries((q.products || []).map(p => [p.id, productLabel(cat, p.id, p.size)]));
  const all = await listInvoices();
  const deposits = all.filter(i => i.quoteId === quoteId && i.kind === 'deposit').sort((a, b) => a.number - b.number);
  const body = invoiceLines(q, names, { kind, depositPct, deposits });
  if (body.total <= 0) throw new ParseError('Nothing left to invoice', 400);

  // Next free number: never reuse one, even if settings were set back by hand.
  let n = settings.nextNumber;
  while (all.some(i => i.number === n)) n++;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const inv = {
    version: 1, id: invoiceId(n), number: n, kind, quoteId, status: 'unpaid', paidAt: null,
    issuedAt: today, dueAt: addDays(today, settings.termsDays),
    from: { name: settings.name, tradingName: settings.tradingName, address: settings.address, email: settings.email },
    to: { client: q.client || '', address: q.clientAddress || '' },
    project: q.project || '', poRef: q.poRef || '',
    payment: { accountName: settings.accountName, sortCode: settings.sortCode, accountNumber: settings.accountNumber, termsDays: settings.termsDays },
    ...body,
  };
  await mkdir(INVOICES, { recursive: true });
  await writeJson(join(INVOICES, `${inv.id}.json`), inv);
  await writeJson(SETTINGS, { ...settings, nextNumber: n + 1 });
  await renderPdf(inv.id);
  return inv;
}

const renderPdf = id => printPdf(`http://${HOST}:${PORT}/api/invoices/${id}/html`, join(INVOICES, `${id}.pdf`));

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
    : urlPath === '/quick' ? '/public/quick.html'
    : ['/src/pricing.js', '/src/catalogue.js', '/src/invoice.js', '/src/rough.js'].includes(urlPath) ? urlPath
    : `/public${urlPath}`;
  const file = normalize(join(ROOT, map));
  if (!file.startsWith(join(ROOT, 'public')) && ![join(ROOT, 'src', 'pricing.js'), join(ROOT, 'src', 'catalogue.js'), join(ROOT, 'src', 'invoice.js'), join(ROOT, 'src', 'rough.js')].includes(file)) return send(res, 404, { error: 'Not found' });
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

    if (p === '/api/settings') {
      if (req.method === 'GET') return send(res, 200, await getSettings());
      if (req.method === 'PUT') { const s = cleanSettings(await body(req), await getSettings()); await writeJson(SETTINGS, s); return send(res, 200, s); }
    }

    if (p === '/api/invoices') {
      if (req.method === 'GET') return send(res, 200, await listInvoices());
      if (req.method === 'POST') { const inv = await issueInvoice(await body(req)); return send(res, 200, { id: inv.id, total: inv.total }); }
    }

    const iv = p.match(/^\/api\/invoices\/([^/]+)(\/html|\/pdf)?$/);
    if (iv) {
      const [, id, part] = iv;
      if (!INVOICE_ID.test(id)) return send(res, 400, { error: 'Bad id' });
      const file = join(INVOICES, `${id}.json`);
      const inv = await readJson(file, null);
      if (!inv) return send(res, 404, { error: 'Not found' });
      if (req.method === 'GET' && part === '/html') return send(res, 200, invoiceHtml(inv), 'text/html; charset=utf-8');
      if (req.method === 'GET' && part === '/pdf') {
        const pdf = join(INVOICES, `${id}.pdf`);
        try { await stat(pdf); } catch { await renderPdf(id); }
        const name = `${id} ${inv.to?.client || ''}`.trim().replace(/[^A-Za-z0-9 ._-]/g, '');
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"`, 'cache-control': 'no-store' });
        return res.end(await readFile(pdf));
      }
      if (req.method === 'GET' && !part) return send(res, 200, inv);
      if (req.method === 'PUT' && !part) {   // only the status changes after issue; the rest is a frozen record
        const { status } = await body(req);
        if (!['unpaid', 'paid'].includes(status)) return send(res, 400, { error: 'Bad status' });
        inv.status = status; inv.paidAt = status === 'paid' ? new Date().toISOString().slice(0, 10) : null;
        await writeJson(file, inv);
        await renderPdf(id);
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
  console.log(`Job Pricer data: ${DATA}`);
  console.log(`Job Pricer on http://${HOST}:${PORT}  (Claude parsing ${hasKey() ? 'on' : 'off: no ANTHROPIC_API_KEY in .env'})`);
});
