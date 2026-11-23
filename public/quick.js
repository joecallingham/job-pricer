// Quick quote (the Pricer in the MacBook notch): a description or a dropped brief in, a rough
// price and a short breakdown out. "Open in Pricer" saves it as a draft and opens the full app.
import { compute, newQuote, rowLabel, range, blankTasks } from '/src/pricing.js';
import { setProduct, productLabel } from '/src/catalogue.js';
import { roughPick } from '/src/rough.js';

const $ = id => document.getElementById(id);
const DRAFT = 'pricer:quick';
let cat = { groups: [], products: [], kickoff: {} };
let q = null, docName = '', timer;

const brief = $('brief');

function build(text) {
  const quote = newQuote();
  quote.brief = text;
  if (docName) quote.project = docName.replace(/\.[a-z0-9]+$/i, '');
  const pick = roughPick(text, cat);
  for (const p of pick.products) setProduct(quote, cat, p.id, p.size);
  quote.productReasons = Object.fromEntries(pick.products.map(p => [p.id, `Matched "${p.why}"`]));
  if (!quote.products.length) quote.tasks = blankTasks();   // no product recognised: a general job
  quote.addons.rush = pick.rush;
  if (pick.rush) quote.addons.rushReason = 'The description sounds urgent';
  quote.totals = compute(quote);
  return quote;
}

function draw() {
  const text = brief.value.trim();
  $('clearBtn').hidden = !text;
  if (!text) {
    q = null;
    $('label').textContent = 'Rough quote';
    $('fig').textContent = '£0';
    $('days').textContent = 'Nothing to price yet';
    $('lines').replaceChildren();
    $('openBtn').disabled = true;
    return;
  }
  q = build(text);
  const c = q.totals;
  const names = Object.fromEntries(q.products.map(p => [p.id, productLabel(cat, p.id, p.size)]));
  $('label').textContent = q.products.length ? 'Rough quote' : 'Rough quote · no products recognised, a general job';
  $('fig').textContent = range(c.low, c.high).replace(' – £', '–');
  const lo = Math.round(c.days.low * 2) / 2, hi = Math.round(c.days.high * 2) / 2;
  $('days').textContent = `${lo === hi ? lo : `${lo}–${hi}`} days at £${c.dayRate} a day${c.monthly ? `, plus £${c.monthly} a month` : ''}`;
  const rows = c.rows.filter(r => r.kind !== 'pass');
  const shown = rows.length > 5 ? rows.slice(0, 4) : rows;
  const items = shown.map(r => {
    const li = document.createElement('li');
    const a = document.createElement('span'); a.textContent = rowLabel(r, names);
    const b = document.createElement('span'); b.textContent = range(r.low, r.high).replace(' – £', '–');
    li.append(a, b);
    return li;
  });
  if (rows.length > shown.length) {
    const li = document.createElement('li'); li.className = 'more';
    li.textContent = `and ${rows.length - shown.length} more`;
    items.push(li);
  }
  $('lines').replaceChildren(...items);
  $('openBtn').disabled = false;
}

function changed() {
  try { localStorage.setItem(DRAFT, JSON.stringify({ text: brief.value, doc: docName })); } catch {}
  clearTimeout(timer);
  timer = setTimeout(draw, 200);
}

function showDoc() {
  const hint = $('hint');
  if (!docName) { hint.replaceChildren('A rough price from the description'); return; }
  const chip = document.createElement('span'); chip.className = 'doc';
  const name = document.createElement('span'); name.textContent = docName;
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Forget the document');
  x.addEventListener('click', () => { docName = ''; showDoc(); changed(); });
  chip.append(name, x);
  hint.replaceChildren(chip);
}

brief.addEventListener('input', changed);
$('clearBtn').addEventListener('click', () => { brief.value = ''; docName = ''; showDoc(); changed(); brief.focus(); });

// The notch hands over the text of a dropped document.
window.notchBrief = (text, name) => {
  brief.value = String(text || '').trim();
  docName = name || '';
  showDoc(); changed(); draw();
};

$('openBtn').addEventListener('click', async () => {
  if (!q) return;
  const btn = $('openBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    q.updatedAt = new Date().toISOString();
    const r = await fetch(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Not saved');
    window.open(`/?quote=${encodeURIComponent(q.id)}#tasks`, '_blank');   // the notch opens it in the browser
    btn.textContent = 'Opened in your browser';
    brief.value = ''; docName = ''; showDoc();
    try { localStorage.removeItem(DRAFT); } catch {}
    setTimeout(() => { btn.textContent = 'Open in Pricer'; draw(); }, 2500);
  } catch (e) {
    btn.textContent = e.message || 'Not saved';
    setTimeout(() => { btn.textContent = 'Open in Pricer'; btn.disabled = false; }, 2500);
  }
});

(async () => {
  try { cat = await (await fetch('/api/catalogue')).json(); } catch { $('days').textContent = 'Could not load the products'; }
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d) { brief.value = d.text || ''; docName = d.doc || ''; showDoc(); } } catch {}
  draw();
})();
