// Products, per-product costs, day rate and monthly lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compute, newQuote, quoteText } from '../src/pricing.js';
import { setProduct, productTasks, catalogueForPrompt, SIZES } from '../src/catalogue.js';

const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const sumRows = (c, k) => c.rows.reduce((s, r) => s + r[k], 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('catalogue is well formed', () => {
  const ids = new Set();
  for (const p of cat.products) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`); ids.add(p.id);
    assert.ok(cat.groups.includes(p.group), `${p.id} group`);
    for (const k of SIZES) {
      const s = p.sizes[k]; assert.ok(s, `${p.id} ${k}`);
      for (const [stage, name, days] of s.tasks) {
        assert.ok(['discovery', 'concept', 'design', 'artwork'].includes(stage), `${p.id} ${name} stage`);
        assert.ok(days > 0 && Math.round(days * 2) === days * 2, `${p.id} ${name} half days`);
      }
    }
  }
  assert.match(catalogueForPrompt(cat), /brand-guidelines/);
});

test('switching a product on adds its tasks, kick-off, pass-through and monthly', () => {
  const q = newQuote();
  setProduct(q, cat, 'website', 's');
  assert.equal(q.products.length, 1);
  assert.equal(q.products[0].monthly, 25);
  assert.equal(q.tasks.filter(t => t.product === 'website').length, 4);
  assert.equal(q.tasks.filter(t => t.kickoff).length, 1);
  setProduct(q, cat, 'photoshoot', 'm');
  assert.equal(q.addons.passThrough.filter(p => p.product === 'photoshoot').length, 2);
  assert.equal(q.tasks.filter(t => t.kickoff).length, 1, 'still one kick-off');
});

test('changing size replaces the tasks; off removes everything for that product', () => {
  const q = newQuote();
  setProduct(q, cat, 'brand-guidelines', 's');
  setProduct(q, cat, 'brand-guidelines', 'l');
  assert.equal(q.tasks.filter(t => t.product === 'brand-guidelines').length, productTasks(cat, 'brand-guidelines', 'l').length);
  setProduct(q, cat, 'brand-guidelines', null);
  assert.equal(q.tasks.filter(t => t.product).length, 0);
  assert.equal(q.products.length, 0);
});

test('kick-off grows to a day with three or more products', () => {
  const q = newQuote();
  for (const id of ['website', 'social-templates', 'presentations']) setProduct(q, cat, id, 's');
  assert.equal(q.tasks.find(t => t.kickoff).lowDays, 1);
});

test('product rows plus extras and uplifts add up exactly to the total', () => {
  const q = newQuote();
  setProduct(q, cat, 'brand-guidelines', 'm');
  setProduct(q, cat, 'photoshoot', 'm');
  setProduct(q, cat, 'website', 's');
  q.tasks.push({ id: 'x', stage: 'design', name: 'Custom bit', lowDays: 1 });
  Object.assign(q.addons, { rush: true, usagePct: 30, sourceFiles: true, outOfHoursDays: 1, extraFormats: 2 });
  q.addons.passThrough.push({ item: 'Fonts', cost: 120 });
  const c = compute(q);
  close(sumRows(c, 'low'), c.raw.low);
  close(sumRows(c, 'high'), c.raw.high);
  assert.equal(c.rows.filter(r => r.kind === 'product').length, 3);
  assert.equal(c.monthly, 25);
});

test('one product on its own: hand-worked', () => {
  // Social Templates S: design 1.5, artwork 0.5. Kick-off 0.5 (discovery).
  // Product low: 2 task days, design 1.5 → amends 0.375, PM 0.2375 → 2.6125 × 350 = £914.38
  // Kick-off low: 0.5 + PM 0.05 = 0.55 × 350 = £192.50. Total £1,106.88 → £1,100
  const q = newQuote();
  setProduct(q, cat, 'social-templates', 's');
  const c = compute(q);
  close(c.rows.find(r => r.id === 'social-templates').low, 914.375);
  close(c.rows.find(r => r.kind === 'other').low, 192.5);
  assert.equal(c.low, 1100);
});

test('day rate is editable per quote and scales everything', () => {
  const q = newQuote();
  setProduct(q, cat, 'social-templates', 's');
  const at350 = compute(q).raw.low;
  q.dayRate = 400;
  close(compute(q).raw.low, at350 * 400 / 350);
  q.dayRate = 0; // nonsense falls back to the default rate
  close(compute(q).raw.low, at350);
});

test('a product\'s edited days change only its row', () => {
  const q = newQuote();
  setProduct(q, cat, 'website', 's');
  setProduct(q, cat, 'presentations', 's');
  const before = compute(q);
  q.tasks.find(t => t.product === 'website').lowDays += 1;
  const after = compute(q);
  const row = (c, id) => c.rows.find(r => r.id === id);
  close(row(after, 'presentations').low, row(before, 'presentations').low);
  assert.ok(row(after, 'website').low > row(before, 'website').low);
});

test('retainer is monthly only', () => {
  const q = newQuote();
  setProduct(q, cat, 'retainer', 'm');
  const c = compute(q);
  assert.equal(c.monthly, 1250);
  assert.equal(c.rows.find(r => r.id === 'retainer').low, 0);
});

test('text quote lists products and the monthly line', () => {
  const q = newQuote();
  setProduct(q, cat, 'website', 'm');
  const t = quoteText(q, undefined, { website: 'Website, 5 pages' });
  assert.match(t, /- Website, 5 pages: £/);
  assert.match(t, /Plus £40 a month/);
});
