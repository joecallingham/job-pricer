// Job Pricer: the pricing engine. Pure functions, no DOM, no network.
// Used by the browser (public/app.js) and by the tests (test/pricing.test.mjs).
// The rules come from the "Job Pricer — Pricing Logic" Claude Doc plus Joe's
// answers of 7 Nov 2026 (see README.md, "Pricing decisions").

export const RULES = {
  dayRate: 350,            // £ per day; half days pro rata (£175 inside a job)
  minJob: 200,             // £ minimum charge for any job
  hourly: 50,              // £ per hour for small add-ons (shown, not used in totals yet)
  highFactor: 1.3,         // high estimate = low × 1.3, rounded up to the half day
  majorRoundsIncluded: 2,
  majorAmendsPct: 0.25,    // the 2 included major rounds = 25% of design + production days
  minorTweaksIncluded: 10,
  minorBatchSize: 4,
  minorBatchPrice: 50,
  extraRoundMin: 350,
  extraRoundMax: 700,
  pmPct: 0.10,             // of task days + major amends days
  contingencyPct: 0.10,    // high estimate only
  rushPct: 0.25,           // under 5 working days
  outOfHoursPct: 0.5,      // weekend or evening days
  sourceFilesPct: 0.10,
  usagePcts: [0, 20, 30, 40, 50],
  extraFormatPrice: 50,
  passThroughMarkup: 0.10, // at cost + 10%, never uplifted by rush or usage
  roundTo: 50,
  designStages: ['concept', 'design'],
};

export const STAGES = [
  { id: 'discovery', name: 'Discovery' },
  { id: 'concept', name: 'Concept' },
  { id: 'design', name: 'Design and production' },
  { id: 'artwork', name: 'Artwork and handover' },
];

export const STAGE_IDS = STAGES.map(s => s.id);

const EPS = 1e-9;
export const halfUp = x => Math.ceil(x * 2 - EPS) / 2;           // 1.3 → 1.5, 2.0 → 2.0
export const toHalf = x => Math.max(0.5, Math.round((Number(x) || 0) * 2) / 2);
export const roundTo = (x, step) => Math.round(x / step) * step;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

export const highDays = (task, rules = RULES) =>
  task.highDays != null ? Math.max(toHalf(task.highDays), toHalf(task.lowDays)) : halfUp(toHalf(task.lowDays) * rules.highFactor);

// Suggested price of one extra major round: half of the included 25% (one round's
// share), clamped to £350–700 and rounded to £50. Joe can override per quote.
export function suggestExtraRound(designDaysLow, rules = RULES) {
  const oneRound = (designDaysLow * rules.majorAmendsPct / rules.majorRoundsIncluded) * rules.dayRate;
  return clamp(roundTo(oneRound, rules.roundTo), rules.extraRoundMin, rules.extraRoundMax);
}

export function emptyAddons() {
  return {
    rush: false, rushReason: '',
    outOfHoursDays: 0,
    usagePct: 0, usageReason: '',
    sourceFiles: false,
    extraMajorRounds: 0, extraRoundPrice: null, // null = use the suggestion
    extraMinorBatches: 0,
    extraFormats: 0,
    passThrough: [],                              // [{ item, cost }]
  };
}

// compute(quote) → { lines, low, high, days, raw }
// Every line has low and high in £ (unrounded). Totals are rounded to £50 and
// never below the £200 job minimum.
export function compute(quote, baseRules = RULES) {
  // A quote can carry its own day rate; half days are always half of it.
  const R = num(quote.dayRate) > 0 ? num(quote.dayRate) : baseRules.dayRate;
  const rules = { ...baseRules, dayRate: R };
  const tasks = (quote.tasks || []).filter(t => STAGE_IDS.includes(t.stage));
  const a = { ...emptyAddons(), ...(quote.addons || {}) };

  const side = which => {
    const d = t => (which === 'low' ? toHalf(t.lowDays) : highDays(t, rules));
    const byStage = Object.fromEntries(STAGE_IDS.map(id => [id, 0]));
    for (const t of tasks) byStage[t.stage] += d(t);
    const taskDays = Object.values(byStage).reduce((s, x) => s + x, 0);
    const designDays = rules.designStages.reduce((s, id) => s + byStage[id], 0);
    const majorDays = designDays * rules.majorAmendsPct;
    const pmDays = (taskDays + majorDays) * rules.pmPct;
    return { byStage, taskDays, designDays, majorDays, pmDays };
  };
  const L = side('low'), H = side('high');

  const lines = [];
  const add = (key, label, low, high, extra = {}) => lines.push({ key, label, low, high, ...extra });

  for (const s of STAGES) {
    if (L.byStage[s.id] || H.byStage[s.id]) {
      add(`stage:${s.id}`, s.name, L.byStage[s.id] * R, H.byStage[s.id] * R,
        { group: 'work', days: [L.byStage[s.id], H.byStage[s.id]] });
    }
  }
  add('major', `${rules.majorRoundsIncluded} major amend rounds`, L.majorDays * R, H.majorDays * R,
    { group: 'included', days: [L.majorDays, H.majorDays] });
  add('minor', `${rules.minorTweaksIncluded} minor tweaks`, 0, 0, { group: 'included', note: 'Included' });
  add('pm', 'Project management', L.pmDays * R, H.pmDays * R, { group: 'included', days: [L.pmDays, H.pmDays] });

  const ooh = num(a.outOfHoursDays) * R * rules.outOfHoursPct;
  if (ooh) add('ooh', `Weekend or evening, ${num(a.outOfHoursDays)} days`, ooh, ooh, { group: 'addon' });

  const roundPrice = a.extraRoundPrice != null && a.extraRoundPrice !== ''
    ? clamp(num(a.extraRoundPrice), 0, 100000) : suggestExtraRound(L.designDays, rules);
  const rounds = Math.max(0, Math.floor(num(a.extraMajorRounds)));
  if (rounds) add('extraRounds', `Extra major rounds × ${rounds}`, rounds * roundPrice, rounds * roundPrice, { group: 'addon', unit: roundPrice });

  const batches = Math.max(0, Math.floor(num(a.extraMinorBatches)));
  if (batches) add('extraMinor', `Extra tweaks × ${batches * rules.minorBatchSize}`, batches * rules.minorBatchPrice, batches * rules.minorBatchPrice, { group: 'addon' });

  const formats = Math.max(0, Math.floor(num(a.extraFormats)));
  if (formats) add('formats', `Extra formats × ${formats}`, formats * rules.extraFormatPrice, formats * rules.extraFormatPrice, { group: 'addon' });

  const sum = (ls, k) => ls.reduce((s, l) => s + l[k], 0);
  const baseLow = sum(lines, 'low'), baseHigh = sum(lines, 'high');

  const cont = baseHigh * rules.contingencyPct;
  add('contingency', 'Contingency', 0, cont, { group: 'included', note: 'High only' });

  const preLow = baseLow, preHigh = baseHigh + cont;
  const pct = (key, label, p, reason) => { if (p) add(key, label, preLow * p, preHigh * p, { group: 'addon', reason }); };
  pct('rush', 'Rush, under 5 working days', a.rush ? rules.rushPct : 0, a.rushReason);
  const usage = rules.usagePcts.includes(num(a.usagePct)) ? num(a.usagePct) : 0;
  pct('usage', `Advertising usage, ${usage}%`, usage / 100, a.usageReason);
  pct('source', 'Source files', a.sourceFiles ? rules.sourceFilesPct : 0);

  const pass = (a.passThrough || []).filter(p => num(p.cost) > 0);
  for (const [i, p] of pass.entries()) {
    const v = num(p.cost) * (1 + rules.passThroughMarkup);
    add(`pass:${i}`, p.item || 'Pass-through cost', v, v, { group: 'pass' });
  }

  const rawLow = sum(lines, 'low'), rawHigh = sum(lines, 'high');
  const low = Math.max(rules.minJob, roundTo(rawLow, rules.roundTo));
  const high = Math.max(low, rules.minJob, roundTo(rawHigh, rules.roundTo));

  // Rows for the quote: one per product (its work, its share of amends, PM and
  // contingency, its pass-through), then other work, extras and uplifts.
  // Amends, PM and contingency are linear in days, so the rows add up exactly to the total.
  const products = (quote.products || []).filter(p => p && p.id && p.size);
  const groupIds = [...products.map(p => p.id), ''];
  const passTagged = (a.passThrough || []).filter(p => num(p.cost) > 0);
  const rows = [];
  for (const gid of groupIds) {
    const owner = t => (t.product && products.some(p => p.id === t.product) ? t.product : '');
    const ts = tasks.filter(t => owner(t) === gid);
    const pass = gid ? passTagged.filter(p => p.product === gid).reduce((s, p) => s + num(p.cost) * (1 + rules.passThroughMarkup), 0) : 0;
    if (!ts.length && gid === '') continue;
    const side = which => {
      let task = 0, design = 0;
      for (const t of ts) { const d = which === 'low' ? toHalf(t.lowDays) : highDays(t, rules); task += d; if (rules.designStages.includes(t.stage)) design += d; }
      const amends = design * rules.majorAmendsPct;
      return task + amends + (task + amends) * rules.pmPct;
    };
    const dl = side('low'), dh = side('high');
    const p = products.find(x => x.id === gid);
    rows.push({ kind: gid ? 'product' : 'other', id: gid, size: p?.size ?? null, monthly: num(p?.monthly),
      low: dl * R + pass, high: dh * R * (1 + rules.contingencyPct) + pass, days: [dl, dh] });
  }
  for (const l of lines) {
    if (['ooh', 'extraRounds', 'extraMinor', 'formats'].includes(l.key)) rows.push({ kind: 'extra', id: l.key, label: l.label, low: l.low, high: l.high * (1 + rules.contingencyPct) });
  }
  for (const p of passTagged.filter(p => !p.product || !products.some(x => x.id === p.product))) {
    const v = num(p.cost) * (1 + rules.passThroughMarkup);
    rows.push({ kind: 'pass', id: 'pass', label: p.item || 'Pass-through cost', low: v, high: v });
  }
  for (const l of lines) {
    if (['rush', 'usage', 'source'].includes(l.key)) rows.push({ kind: 'uplift', id: l.key, label: l.label, reason: l.reason, low: l.low, high: l.high });
  }
  const monthly = products.reduce((s, p) => s + Math.max(0, num(p.monthly)), 0);

  return {
    lines, rows, low, high, monthly, dayRate: R,
    days: { low: L.taskDays + L.majorDays + L.pmDays, high: H.taskDays + H.majorDays + H.pmDays },
    designDays: [L.designDays, H.designDays],
    extraRoundPrice: roundPrice,
    raw: { low: rawLow, high: rawHigh },
  };
}

// The stored quote (JSON). Stable shape so the later "scope watch" can compare
// client messages against what was agreed: deliverables, included amends,
// usage, deadline and add-ons are all explicit fields.
export function newQuote() {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: `q-${now.slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now, updatedAt: now,
    status: 'draft',            // draft | sent | agreed
    client: '', project: '', deadline: '',
    brief: '', summary: '',
    dayRate: RULES.dayRate,     // editable per quote
    products: [],               // [{ id, size: 's'|'m'|'l', monthly }] from data/catalogue.json
    deliverables: [], tasks: [],// tasks carry `product` (catalogue id) or nothing for kick-off and other work
    assumptions: [], exclusions: [],
    addons: emptyAddons(),
    included: { majorRounds: RULES.majorRoundsIncluded, minorTweaks: RULES.minorTweaksIncluded },
    scopeLog: [],               // filled by scope watch later: [{ at, message, kind, suggestedExtra }]
    totals: null,               // snapshot of compute() at save time
  };
}

export function blankTasks() {
  let n = 0;
  const t = (stage, name, lowDays) => ({ id: `t${++n}`, stage, name, lowDays, highDays: null });
  return [
    t('discovery', 'Brief, kick-off call and references', 0.5),
    t('concept', 'Concept and art direction', 1),
    t('design', 'Design and production', 2),
    t('artwork', 'Artwork, exports and handover', 0.5),
  ];
}

const gbp = n => `£${Math.round(n).toLocaleString('en-GB')}`;
export const money = gbp;
export const range = (lo, hi) => (Math.round(lo) === Math.round(hi) ? gbp(lo) : `${gbp(lo)} – ${gbp(hi)}`);
export const dayText = d => `${+d.toFixed(2)} ${Math.abs(d - 1) < EPS ? 'day' : 'days'}`;

// Plain-text quote for email or WhatsApp.
export function quoteText(q, rules = RULES, names = {}) {
  const c = compute(q, rules);
  if (c.rows.some(r => r.kind === 'product')) return productQuoteText(q, c, rules, names);
  const out = [];
  if (q.project || q.client) out.push([q.project, q.client].filter(Boolean).join(' for '));
  if (q.summary) out.push(q.summary);
  out.push('', `From ${gbp(c.low)} to ${gbp(c.high)}`);
  if (q.deliverables.length) out.push('', 'Deliverables', ...q.deliverables.map(d => `- ${d}`));
  out.push('', 'Breakdown');
  for (const l of c.lines) {
    const days = l.days ? ` (${l.days[0] === l.days[1] ? dayText(l.days[0]) : `${+l.days[0].toFixed(2)}–${dayText(l.days[1])}`})` : '';
    out.push(`- ${l.label}${days}: ${l.note && !l.high ? l.note : range(l.low, l.high)}${l.reason ? `. ${l.reason}` : ''}`);
  }
  if (q.assumptions.length) out.push('', 'Assumptions', ...q.assumptions.map(x => `- ${x}`));
  if (q.exclusions.length) out.push('', 'Not included', ...q.exclusions.map(x => `- ${x}`));
  out.push('', `Includes ${rules.majorRoundsIncluded} major amend rounds and ${rules.minorTweaksIncluded} minor tweaks. Extra major rounds £${rules.extraRoundMin}–${rules.extraRoundMax} each; extra tweaks £${rules.minorBatchPrice} per ${rules.minorBatchSize}.`);
  return out.join('\n');
}

// names: { [productId]: 'Brand Guidelines, Identity' } supplied by the caller (catalogue lives outside this module).
export function rowLabel(r, names = {}) {
  if (r.kind === 'product') return names[r.id] || r.id;
  if (r.kind === 'other') return 'Kick-off and other work';
  return r.label;
}

function productQuoteText(q, c, rules, names) {
  const out = [];
  if (q.project || q.client) out.push([q.project, q.client].filter(Boolean).join(' for '));
  if (q.summary) out.push(q.summary);
  out.push('', `From ${gbp(c.low)} to ${gbp(c.high)}`);
  if (c.monthly) out.push(`Plus ${gbp(c.monthly)} a month`);
  out.push('', 'What it costs');
  for (const r of c.rows) out.push(`- ${rowLabel(r, names)}: ${range(r.low, r.high)}${r.reason ? `. ${r.reason}` : ''}`);
  const monthlyRows = c.rows.filter(r => r.monthly);
  if (monthlyRows.length) out.push('', 'Monthly', ...monthlyRows.map(r => `- ${rowLabel(r, names)}: ${gbp(r.monthly)} a month`));
  if (q.deliverables.length) out.push('', 'Deliverables', ...q.deliverables.map(d => `- ${d}`));
  if (q.assumptions.length) out.push('', 'Assumptions', ...q.assumptions.map(x => `- ${x}`));
  if (q.exclusions.length) out.push('', 'Not included', ...q.exclusions.map(x => `- ${x}`));
  out.push('', `Each product includes its share of ${rules.majorRoundsIncluded} major amend rounds, ${rules.minorTweaksIncluded} minor tweaks, project management and contingency. Extra major rounds £${rules.extraRoundMin}–${rules.extraRoundMax} each; extra tweaks £${rules.minorBatchPrice} per ${rules.minorBatchSize}.`);
  return out.join('\n');
}
