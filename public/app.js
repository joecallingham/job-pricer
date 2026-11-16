// Job Pricer UI. All maths lives in /src/pricing.js; this file only edits the
// quote object and draws it.
import { compute, newQuote, emptyAddons, quoteText, rowLabel, highDays, toHalf, RULES, money, range, dayText } from '/src/pricing.js';
import { setProduct, ensureKickoff, productLabel } from '/src/catalogue.js';

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};

const VIEWS = ['brief', 'tasks', 'quote', 'saved'];
let q = newQuote();
let claudeOn = false;
let cat = { groups: [], products: [], kickoff: {} };   // filled from /api/catalogue at start
let dirty = false;

/* ---------- frame ---------- */
const island = $('island'), msg = $('islandMsg'); let sayT;
function say(text, hold = false) {
  msg.textContent = text; $('srSay').textContent = text; island.classList.add('say'); clearTimeout(sayT);
  if (!hold) sayT = setTimeout(() => island.classList.remove('say'), 2200);
}
const arrow = $('arrowBtn');
arrow.addEventListener('click', () => (arrow.classList.contains('up') ? scrollTo({ top: 0, behavior: 'smooth' }) : document.querySelector('.view:not([hidden])').scrollIntoView({ behavior: 'smooth' })));
addEventListener('scroll', () => { const up = scrollY > innerHeight * 0.5; arrow.classList.toggle('up', up); arrow.setAttribute('aria-label', up ? 'Back to the top' : 'Jump to the content'); }, { passive: true });

function show(view) {
  for (const b of $('tabs').children) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  if (view === 'quote') drawQuote();
  if (view === 'saved') drawSaved();
  if (view === 'tasks') drawTasks();
  history.replaceState(null, '', `#${view}`);
  scrollTo({ top: 0 });
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

/* ---------- toggles (kit) ---------- */
function toggle(options, value, onPick, label, tint = 'var(--lav)') {
  const track = el('div', { class: 'track', role: 'group', 'aria-label': label });
  const set = v => {
    const i = Math.max(0, options.findIndex(o => o.value === v));
    track.style.setProperty('--n', options.length); track.style.setProperty('--i', i);
    [...track.children].forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  };
  for (const o of options) track.append(el('button', { type: 'button', onclick: () => { set(o.value); onPick(o.value); } }, o.label));
  set(value);
  const t = el('div', { class: 'tog' }, track); t.style.setProperty('--tog', tint);
  return t;
}
const onOff = (value, onPick, label) => toggle([{ label: 'Off', value: false }, { label: 'On', value: true }], value, onPick, label);

function stepper(value, onChange, label, { step = 0.5, min = 0, max = 60, fmt = v => v } = {}) {
  const out = el('output', { 'aria-live': 'polite' }, fmt(value));
  let v = value;
  const go = d => { v = Math.min(max, Math.max(min, Math.round((v + d) / step) * step)); out.textContent = fmt(v); onChange(v); };
  return el('span', { class: 'step', role: 'group', 'aria-label': label },
    el('button', { type: 'button', 'aria-label': `Less ${label}`, onclick: () => go(-step) }, '−'), out,
    el('button', { type: 'button', 'aria-label': `More ${label}`, onclick: () => go(step) }, '+'));
}

/* ---------- change + autosave ---------- */
let saveT;
function changed() {
  dirty = true; q.updatedAt = new Date().toISOString();
  drawTotals();
  clearTimeout(saveT); saveT = setTimeout(save, 900);
}
async function save(loud = false) {
  if (!q.tasks.length && !q.brief.trim()) return;
  q.totals = (({ low, high, days }) => ({ low, high, days }))(compute(q));
  try {
    const r = await fetch(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    if (!r.ok) throw new Error((await r.json()).error);
    dirty = false; say('Saved');
    try { localStorage.setItem('pricer:last', q.id); } catch {}
  } catch (e) { say(`Not saved: ${e.message}`); }
  if (loud) say('Saved');
}

/* ---------- brief ---------- */
for (const f of ['client', 'project', 'deadline']) $(f).addEventListener('input', e => { q[f] = e.target.value; changed(); });
$('brief').addEventListener('input', e => { q.brief = e.target.value; changed(); });

$('blankBtn').addEventListener('click', () => show('tasks'));

$('parseBtn').addEventListener('click', async () => {
  if (!q.brief.trim()) { say('Paste a brief first'); $('brief').focus(); return; }
  if ((q.tasks.length || q.products.length) && !confirm('Replace the current products and tasks with fresh ones from the brief?')) return;
  const btn = $('parseBtn'); btn.disabled = true; $('glow').classList.add('on'); say('Reading the brief', true);
  try {
    const r = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: q.brief }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    Object.assign(q, {
      summary: d.summary, deliverables: d.deliverables, assumptions: d.assumptions, exclusions: d.exclusions,
      addons: { ...emptyAddons(), ...d.addons }, products: [], tasks: [],
      productReasons: Object.fromEntries(d.products.map(p => [p.id, p.reason])),
      client: q.client || d.client, project: q.project || d.project, deadline: q.deadline || d.deadline,
    });
    for (const p of d.products) setProduct(q, cat, p.id, p.size);
    q.tasks.push(...d.extraTasks.map(t => ({ ...t, id: `t${nextId++}` })));
    fillBrief(); changed(); show('tasks'); say('Priced');
  } catch (e) { say(e.message || 'That failed'); }
  finally { btn.disabled = !claudeOn; $('glow').classList.remove('on'); }
});

function fillBrief() { for (const f of ['client', 'project', 'deadline', 'brief']) $(f).value = q[f] || ''; }

/* ---------- job: products and tasks ---------- */
let nextId = 1000;
const SIZE_OPTS = [{ label: 'Off', value: null }, { label: 'S', value: 's' }, { label: 'M', value: 'm' }, { label: 'L', value: 'l' }];
const names = () => Object.fromEntries((q.products || []).map(p => [p.id, productLabel(cat, p.id, p.size)]));
const owned = t => t.product && q.products.some(p => p.id === t.product);

function taskRow(t) {
  return el('div', { class: 'task' },
    el('input', { class: 'name', value: t.name, placeholder: 'Task', 'aria-label': 'Task name', oninput: e => { t.name = e.target.value; changed(); } }),
    stepper(toHalf(t.lowDays), v => { t.lowDays = v; t.highDays = null; if (t.kickoff) t.edited = true; drawHigh(t); changed(); }, 'days', { step: 0.5, min: 0.5, fmt: v => v.toFixed(1) }),
    el('span', { class: 'hi', 'data-hi': t.id }, `to ${highDays(t).toFixed(1)}`),
    el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${t.name || 'task'}`, onclick: () => { q.tasks = q.tasks.filter(x => x !== t); drawTasks(); changed(); } }, '×'));
}
function addTask(product) {
  q.tasks.push({ id: `t${nextId++}`, stage: 'design', name: '', lowDays: 1, highDays: null, ...(product ? { product } : {}) });
  drawTasks(); changed();
  const box = product ? document.querySelector(`[data-prod-box="${product}"]`) : $('stages');
  const inputs = box.querySelectorAll('input.name'); inputs[inputs.length - 1]?.focus();
}

function drawTasks() {
  $('dayRate').value = q.dayRate || RULES.dayRate;
  const box = $('products'); box.replaceChildren();
  for (const g of cat.groups) {
    box.append(el('div', { class: 'group' }, el('span', { class: 'pill' }, g),
      cat.products.filter(p => p.group === g).map(p => {
        const sel = q.products.find(x => x.id === p.id);
        const s = sel && p.sizes[sel.size];
        const blurb = s ? `${s.label}: ${s.summary}` : (p.summary || '').replace(/^GUESS: /, '');
        const reason = sel && q.productReasons?.[p.id];
        return el('div', { class: `prod${sel ? ' on' : ''}`, 'data-prod-box': p.id },
          el('div', { class: 'prod-head' },
            el('span', { class: 'n' }, p.name, blurb ? el('small', {}, blurb) : null, reason ? el('small', { class: 'why' }, reason) : null),
            toggle(SIZE_OPTS, sel?.size ?? null, v => { setProduct(q, cat, p.id, v); drawTasks(); changed(); }, `${p.name} size`, '#fff'),
            el('span', { class: 'v', 'data-prod': p.id })),
          sel ? el('div', { class: 'prod-body' },
            q.tasks.filter(t => t.product === p.id).map(taskRow),
            el('div', { class: 'prod-foot' },
              el('button', { type: 'button', class: 'btn add', onclick: () => addTask(p.id) }, 'Add task'),
              el('label', { class: 'monthly' }, el('span', {}, 'Monthly £'),
                el('input', { type: 'number', min: 0, step: 5, inputmode: 'numeric', value: sel.monthly || '', placeholder: '0', 'aria-label': `${p.name}, monthly £`,
                  oninput: e => { sel.monthly = Math.max(0, Number(e.target.value) || 0); changed(); } })))) : null);
      })));
  }
  const other = q.tasks.filter(t => !owned(t));
  $('stages').replaceChildren(el('div', { class: 'stage' },
    el('div', { class: 'head' }, el('span', { class: 'pill' }, 'Kick-off and other work'), el('span', { class: 'm', 'data-other': '' })),
    other.map(taskRow),
    el('button', { type: 'button', class: 'btn add', onclick: () => addTask(null) }, 'Add task')));
  drawAddons();
  for (const f of ['deliverables', 'assumptions', 'exclusions']) $(f).value = q[f].join('\n');
  drawPass();
  drawTotals();
}
const drawHigh = t => { const n = document.querySelector(`[data-hi="${t.id}"]`); if (n) n.textContent = `to ${highDays(t).toFixed(1)}`; };

$('dayRate').addEventListener('input', e => {
  const v = Number(e.target.value);
  q.dayRate = v >= 50 ? v : RULES.dayRate;
  changed();
});

for (const f of ['deliverables', 'assumptions', 'exclusions']) {
  $(f).addEventListener('input', e => { q[f] = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); changed(); });
}

function drawAddons() {
  const a = q.addons;
  const opt = (label, control, reason) => el('div', { class: 'opt' }, el('span', {}, label), control, reason ? el('p', { class: 'reason' }, reason) : null);
  $('uplifts').replaceChildren(
    opt('Rush', onOff(a.rush, v => { a.rush = v; changed(); }, 'Rush'), a.rushReason),
    opt('Advertising usage', toggle(RULES.usagePcts.map(p => ({ label: p ? `${p}` : 'Off', value: p })), a.usagePct, v => { a.usagePct = v; changed(); }, 'Usage percent'), a.usageReason),
    opt('Source files', onOff(a.sourceFiles, v => { a.sourceFiles = v; changed(); }, 'Source files')),
  );
  const price = el('input', { class: 'price', type: 'number', min: 0, step: 50, 'aria-label': 'Price per extra round', value: a.extraRoundPrice ?? '', oninput: e => { a.extraRoundPrice = e.target.value === '' ? null : Number(e.target.value); changed(); } });
  price.placeholder = String(compute(q).extraRoundPrice);
  $('extras').replaceChildren(
    opt('Weekend or evening days', stepper(a.outOfHoursDays, v => { a.outOfHoursDays = v; changed(); }, 'out of hours days', { step: 0.5 })),
    opt('Extra major rounds', el('span', { class: 'btns' }, price, stepper(a.extraMajorRounds, v => { a.extraMajorRounds = v; changed(); }, 'extra rounds', { step: 1, max: 10 }))),
    opt(`Extra tweaks, per ${RULES.minorBatchSize}`, stepper(a.extraMinorBatches, v => { a.extraMinorBatches = v; changed(); }, 'tweak batches', { step: 1, max: 50 })),
    opt('Extra formats', stepper(a.extraFormats, v => { a.extraFormats = v; changed(); }, 'extra formats', { step: 1, max: 100 })),
  );
}

function drawPass() {
  const list = $('passList'); list.replaceChildren();
  q.addons.passThrough.forEach((p, i) => list.append(el('div', { class: 'pass' },
    el('input', { value: p.item, placeholder: 'Stock, fonts, print', 'aria-label': 'Cost item', oninput: e => { p.item = e.target.value; changed(); } }),
    el('input', { type: 'number', min: 0, step: 1, value: p.cost || '', placeholder: '£', 'aria-label': 'Cost in pounds', oninput: e => { p.cost = Number(e.target.value) || 0; changed(); } }),
    el('button', { type: 'button', class: 'x', 'aria-label': 'Remove cost', onclick: () => { q.addons.passThrough.splice(i, 1); drawPass(); changed(); } }, '×'))));
}
$('addPass').addEventListener('click', () => {
  q.addons.passThrough.push({ item: '', cost: 0 }); drawPass();
  $('passList').querySelector('.pass:last-child input')?.focus();
});

/* ---------- totals (hero on the Job view) ---------- */
function heroLines(c) {
  const max = Math.max(c.days.high, 1);
  const line = (label, value, frac) => el('div', { class: 'line' }, el('div', { class: 'lv' }, el('span', {}, label), el('span', {}, value)), el('span', { class: 'bar' }, el('b', { style: `width:${Math.max(2, frac * 100)}%` })));
  return [
    line('Low', dayText(c.days.low), c.days.low / max),
    line('High', dayText(c.days.high), 1),
    c.monthly ? el('div', { class: 'lv' }, el('span', {}, 'Monthly'), el('span', {}, `${money(c.monthly)} a month`)) : null,
  ].filter(Boolean);
}
const rowValue = r => (r.low === 0 && r.high === 0 && r.monthly ? `${money(r.monthly)} a month` : range(r.low, r.high));
function drawTotals() {
  const c = compute(q);
  if ($('view-tasks').hidden) return;
  $('heroLines').replaceChildren(...heroLines(c));
  $('heroFig').replaceChildren(rangeFig(c));
  for (const n of document.querySelectorAll('[data-prod]')) {
    const r = c.rows.find(x => x.kind === 'product' && x.id === n.dataset.prod);
    n.textContent = r ? rowValue(r) : '';
  }
  const o = c.rows.find(x => x.kind === 'other'), on = document.querySelector('[data-other]');
  if (on) on.textContent = o ? range(o.low, o.high) : '';
}
const rangeFig = c => el('div', {}, c.low === c.high ? money(c.low) : `${money(c.low)}–${money(c.high).slice(1)}`, el('small', {}, 'Rounded to £50'));
const daysRange = d => (Math.abs(d[0] - d[1]) < 1e-9 ? dayText(d[0]) : `${+d[0].toFixed(1)}–${dayText(+d[1].toFixed(1))}`);

/* ---------- quote ---------- */
const STATUS = [{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' }, { label: 'Agreed', value: 'agreed' }];
function drawQuote() {
  const c = compute(q);
  $('qTitle').textContent = q.project || 'Quote';
  $('statusTog').replaceChildren(toggle(STATUS, q.status, v => { q.status = v; changed(); }, 'Status', 'var(--mint)'));
  const lines = [];
  if (q.client) lines.push(el('p', {}, q.client));
  if (q.summary) lines.push(el('p', {}, q.summary));
  lines.push(...heroLines(c));
  $('qLines').replaceChildren(...lines);
  $('qFig').replaceChildren(rangeFig(c));

  const nm = names();
  const meta = r => [r.days && (r.days[1] > 0) ? daysRange(r.days) : '', r.kind === 'pass' ? 'At cost + 10%' : '', r.monthly && (r.low || r.high) ? `+ ${money(r.monthly)} a month` : ''].filter(Boolean).join(' · ');
  $('qRows').replaceChildren(...c.rows.map(r => el('div', { class: 'row' },
    el('span', { class: 'n' }, rowLabel(r, nm), r.reason ? el('small', {}, r.reason) : null),
    el('span', { class: 'm' }, meta(r)),
    el('span', { class: 'v' }, rowValue(r)))),
    el('div', { class: 'row total' }, el('span', { class: 'n' }, 'Total'), el('span', { class: 'm' }, 'Rounded to £50'), el('span', { class: 'v' }, range(c.low, c.high))),
    c.monthly ? el('div', { class: 'row total' }, el('span', { class: 'n' }, 'Monthly'), el('span', { class: 'm' }, 'Billed separately'), el('span', { class: 'v' }, `${money(c.monthly)} a month`)) : null);

  $('qIncluded').replaceChildren(el('ul', { class: 'plain' },
    q.deliverables.map(d => el('li', {}, d)),
    el('li', {}, `${RULES.majorRoundsIncluded} major amend rounds`),
    el('li', {}, `${RULES.minorTweaksIncluded} minor tweaks`),
    q.assumptions.map(d => el('li', {}, d))));
  $('qExcluded').replaceChildren(el('ul', { class: 'plain' },
    q.exclusions.length ? q.exclusions.map(d => el('li', {}, d)) : el('li', {}, 'Nothing listed'),
    el('li', {}, `Extra major rounds £${RULES.extraRoundMin}–${RULES.extraRoundMax}`),
    el('li', {}, `Extra tweaks £${RULES.minorBatchPrice} per ${RULES.minorBatchSize}`)));
}

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(quoteText(q, undefined, names())); say('Copied'); }
  catch { say('Copy blocked by the browser'); }
});
$('saveBtn').addEventListener('click', () => save(true));

/* ---------- saved ---------- */
async function drawSaved() {
  const box = $('savedRows');
  try {
    const items = await (await fetch('/api/quotes')).json();
    box.replaceChildren(...(items.length ? items.map(it => el('div', {
      class: 'row', role: 'button', tabindex: 0,
      onclick: () => load(it.id), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(it.id); } },
    },
    el('span', { class: 'n' }, [it.project || 'Untitled', it.client].filter(Boolean).join(', ')),
    el('span', { class: `chip ${it.status}` }, STATUS.find(s => s.value === it.status)?.label || 'Draft'),
    el('span', { class: 'v' }, it.low != null ? range(it.low, it.high) : '—'))) : [el('p', { class: 'empty' }, 'No saved quotes')]));
  } catch { box.replaceChildren(el('p', { class: 'empty' }, 'Could not load quotes')); }
}
async function load(id) {
  if (dirty) await save();
  try {
    const r = await fetch(`/api/quotes/${id}`); if (!r.ok) throw new Error();
    q = { ...newQuote(), ...(await r.json()) }; q.addons = { ...emptyAddons(), ...q.addons };
    dirty = false; fillBrief(); show('quote');
    try { localStorage.setItem('pricer:last', q.id); } catch {}
  } catch { say('Could not open that quote'); }
}
$('newBtn').addEventListener('click', async () => { if (dirty) await save(); q = newQuote(); dirty = false; fillBrief(); show('brief');
  try { localStorage.removeItem('pricer:last'); } catch {} });
addEventListener('beforeunload', e => { if (dirty) { save(); e.preventDefault(); } });

/* ---------- start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async () => {
  try { const s = await (await fetch('/api/status')).json(); claudeOn = s.claude; } catch { claudeOn = false; }
  try { cat = await (await fetch('/api/catalogue')).json(); } catch { say('Could not load the products'); }
  const p = $('parseBtn');
  p.disabled = !claudeOn;
  if (!claudeOn) { p.title = 'Add an Anthropic API key to .env to switch this on'; p.classList.remove('primary'); $('blankBtn').classList.add('primary'); }
  // Reopen the quote you were last on (per device; the quote itself lives on the server).
  let last = null; try { last = localStorage.getItem('pricer:last'); } catch {}
  if (last) {
    try { const r = await fetch(`/api/quotes/${last}`); if (r.ok) { q = { ...newQuote(), ...(await r.json()) }; q.addons = { ...emptyAddons(), ...q.addons }; fillBrief(); } } catch {}
  }
  const v = location.hash.slice(1);
  show(VIEWS.includes(v) ? v : 'brief');
})();
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && $(`view-${v}`).hidden) show(v); });
