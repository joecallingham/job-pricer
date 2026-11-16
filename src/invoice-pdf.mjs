// Invoice page (HTML) and its PDF. Server only.
// The PDF is printed by headless Chrome from the server's own invoice page, so the
// Nuckle fonts load from the same place as the app and never leave the Mac mini.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIND_TITLE, longDate } from './invoice.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = s => esc(s).split('\n').map(x => x.trim()).filter(Boolean).join('<br>');
const gbp = n => `£${Number(n).toLocaleString('en-GB')}`;

let logo = '';
export async function loadLogo(root) {
  const html = await readFile(join(root, 'public', 'index.html'), 'utf8');
  logo = (html.match(/<svg class="avgjoe"[\s\S]*?<\/svg>/) || [''])[0];
}

export function invoiceHtml(inv) {
  const f = inv.from || {}, t = inv.to || {}, p = inv.payment || {};
  const who = [f.tradingName ? `${esc(f.name)}<br>trading as ${esc(f.tradingName)}` : esc(f.name), lines(f.address), esc(f.email)].filter(Boolean).join('<br>');
  const bank = [p.accountName && `<div><span>Account name</span>${esc(p.accountName)}</div>`, p.sortCode && `<div><span>Sort code</span>${esc(p.sortCode)}</div>`, p.accountNumber && `<div><span>Account number</span>${esc(p.accountNumber)}</div>`, `<div><span>Reference</span>${esc(inv.id)}</div>`].filter(Boolean).join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(inv.id)} ${esc(t.client)}</title>
<style>
@font-face { font-family: Nuckle; src: url("/fonts/Nuckle-Medium.woff2") format("woff2"); font-weight: 500; font-display: block; }
@font-face { font-family: Nuckle; src: url("/fonts/Nuckle-Semibold.woff2") format("woff2"); font-weight: 600; font-display: block; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; color: #111; font-family: Nuckle, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 500; font-size: 10.5pt; line-height: 1.45; letter-spacing: -.01em; }
.sheet { width: 210mm; min-height: 297mm; padding: 16mm 16mm 14mm; display: flex; flex-direction: column; gap: 9mm; }
header { display: flex; justify-content: space-between; align-items: flex-start; }
header svg { height: 15mm; width: auto; color: #000; display: block; }
header .t { text-align: right; }
h1 { margin: 0; font-size: 34pt; line-height: .9; letter-spacing: -.055em; font-weight: 500; }
.num { margin-top: 2.5mm; font-size: 12pt; letter-spacing: -.02em; }
.pill { display: inline-block; border: 1.2px solid currentColor; border-radius: 999px; padding: .5mm 3mm; font-size: 8.5pt; letter-spacing: 0; }
.meta { display: grid; grid-template-columns: 1fr 1fr 1.15fr; gap: 6mm; }
.meta .dates div { white-space: nowrap; }
.meta h2, .pay h2 { margin: 0 0 2mm; font-size: 8.5pt; font-weight: 500; color: rgba(17,17,17,.6); letter-spacing: 0; }
.meta .dates div { display: flex; justify-content: space-between; gap: 4mm; }
.meta .dates span { color: rgba(17,17,17,.6); }
.project { font-size: 17pt; line-height: 1.05; letter-spacing: -.04em; padding-bottom: 4mm; box-shadow: inset 0 -1.2px 0 rgba(17,17,17,.18); }
.project small { display: block; margin-top: 1.5mm; font-size: 9pt; letter-spacing: 0; color: rgba(17,17,17,.6); }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
td { padding: 2.6mm 0; vertical-align: baseline; }
td.n { font-size: 12pt; letter-spacing: -.03em; line-height: 1.1; }
td.n small { display: block; margin-top: .8mm; font-size: 8.5pt; letter-spacing: 0; color: rgba(17,17,17,.6); }
td.v { text-align: right; font-size: 12pt; letter-spacing: -.03em; white-space: nowrap; padding-left: 8mm; }
tr.sub td { color: rgba(17,17,17,.7); font-size: 10.5pt; }
tr.rule td { padding: 0; height: 0; box-shadow: inset 0 -1.2px 0 rgba(17,17,17,.18); }
.due { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding: 8mm 9mm; border-radius: 7mm; background: linear-gradient(165deg, #e3eadf 0%, #DCE5D8 55%, #cfd8cb 100%); }
.due .fig { font-size: 40pt; line-height: .85; letter-spacing: -.06em; font-variant-numeric: tabular-nums; }
.due .when { font-size: 10pt; }
.pay { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.pay .bank div { display: flex; justify-content: space-between; gap: 4mm; font-variant-numeric: tabular-nums; }
.pay .bank span { color: rgba(17,17,17,.6); }
.paid { color: #2f6b45; }
footer { margin-top: auto; font-size: 8.5pt; color: rgba(17,17,17,.6); display: flex; justify-content: space-between; gap: 6mm; }
</style></head><body><div class="sheet">
<header>${logo}<div class="t"><h1>${esc(KIND_TITLE[inv.kind] || 'Invoice')}</h1><div class="num">${esc(inv.id)}</div></div></header>
<section class="meta">
  <div><h2>From</h2>${who}</div>
  <div><h2>Bill to</h2>${[esc(t.client), lines(t.address)].filter(Boolean).join('<br>')}</div>
  <div class="dates"><h2>Dates</h2>
    <div><span>Issued</span>${esc(longDate(inv.issuedAt))}</div>
    <div><span>Due</span>${esc(longDate(inv.dueAt))}</div>
    ${inv.poRef ? `<div><span>PO</span>${esc(inv.poRef)}</div>` : ''}
  </div>
</section>
<div class="project">${esc(inv.project || 'Design work')}${inv.kind === 'deposit' ? '<small>Deposit to start the work</small>' : ''}</div>
<table>
${inv.lines.map(l => `<tr><td class="n">${esc(l.label)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</td><td class="v">${gbp(l.amount)}</td></tr>`).join('')}
${inv.less.length ? `<tr class="rule"><td></td><td></td></tr><tr class="sub"><td class="n">Subtotal</td><td class="v">${gbp(inv.subtotal)}</td></tr>${inv.less.map(l => `<tr class="sub"><td class="n">${esc(l.label)}</td><td class="v">−${gbp(l.amount)}</td></tr>`).join('')}` : ''}
</table>
<div class="due"><div><span class="pill">${inv.status === 'paid' ? 'Paid' : 'Total due'}</span><div class="when" style="margin-top:3mm">${inv.status === 'paid' ? 'Thank you' : `By ${esc(longDate(inv.dueAt))}`}</div></div><div class="fig">${gbp(inv.total)}</div></div>
<section class="pay">
  <div><h2>Pay by bank transfer</h2><div class="bank">${bank}</div></div>
  <div><h2>Terms</h2>Payment within ${esc(p.termsDays)} days of the invoice date. Please quote ${esc(inv.id)} as the reference.</div>
</section>
<footer><span>${esc(f.tradingName || f.name)}</span><span>${esc(f.email)}</span></footer>
</div></body></html>`;
}

// Prints `url` to `out` with headless Chrome. Its own throwaway profile, so it never
// touches a Chrome window Joe has open.
export async function printPdf(url, out) {
  const profile = await mkdtemp(join(tmpdir(), 'pricer-chrome-'));
  try {
    await new Promise((resolve, reject) => {
      execFile(CHROME, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer',
        `--user-data-dir=${profile}`, `--print-to-pdf=${out}`, '--virtual-time-budget=4000', url],
      { timeout: 60_000 }, err => (err ? reject(err) : resolve()));
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
