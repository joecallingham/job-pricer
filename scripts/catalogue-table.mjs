// Prints the catalogue as a review table: each product and size priced on its own
// (its tasks + share of amends, PM, contingency, pass-through; no kick-off, no job minimum).
import { readFileSync, writeFileSync } from 'node:fs';
import { compute, newQuote, emptyAddons, RULES } from '../src/pricing.js';
const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const rules = { ...RULES, minJob: 0 };
const out = [`# Job Pricer product catalogue (draft)`, '', `${cat.status}. Each row is that product on its own: its days plus its share of amends, project management and contingency, plus pass-through at cost +10%. A job adds one kick-off (£175–350) and the £200 minimum. Prices rounded to £50. Correct the days, sizes or monthly figures here or in chat; the file the Pricer uses is ~/Projects/job-pricer/data/catalogue.json.`, ''];
for (const g of cat.groups) {
  out.push(`## ${g}`, '', '| Product | Size | What it includes | Low days | One-off £ | Monthly £ |', '|---|---|---|---|---|---|');
  for (const p of cat.products.filter(p => p.group === g)) {
    for (const [k, s] of Object.entries(p.sizes)) {
      const tasks = s.tasks.map(([stage, name, days], i) => ({ id: `t${i}`, stage, name, lowDays: days, highDays: null }));
      const q = { ...newQuote(), tasks, addons: { ...emptyAddons(), passThrough: (s.pass || []).map(([item, cost]) => ({ item, cost })) } };
      const c = tasks.length || s.pass ? compute(q, rules) : { low: 0, high: 0 };
      const days = tasks.reduce((a, t) => a + t.lowDays, 0);
      const name = k === 's' ? `**${p.name}**${p.note ? ` (${p.note})` : ''}${p.summary ? `<br>${p.summary}` : ''}` : '';
      out.push(`| ${name} | ${s.label} | ${s.summary} | ${days || '–'} | ${c.high ? `${c.low.toLocaleString('en-GB')}–${c.high.toLocaleString('en-GB')}` : '–'} | ${s.monthly ? s.monthly.toLocaleString('en-GB') : '–'} |`);
    }
  }
  out.push('');
}
const file = process.argv[2];
if (file) writeFileSync(file, out.join('\n')); else console.log(out.join('\n'));
