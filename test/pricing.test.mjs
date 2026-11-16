// Hand-worked cases. Each expected figure is worked out in the comment beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, halfUp, toHalf, suggestExtraRound, blankTasks, newQuote, quoteText, RULES } from '../src/pricing.js';

const q = (over = {}) => ({ ...newQuote(), tasks: blankTasks(), ...over });
const line = (c, key) => c.lines.find(l => l.key === key);

test('half-day rounding', () => {
  assert.equal(halfUp(1.3), 1.5);
  assert.equal(halfUp(2.0), 2.0);   // exact stays put
  assert.equal(halfUp(2.6), 3.0);
  assert.equal(halfUp(0.65), 1.0);
  assert.equal(halfUp(1.5 * 1.3), 2.0);
  assert.equal(toHalf(0.2), 0.5);   // never below half a day
  assert.equal(toHalf(1.74), 1.5);
});

test('base quote: blank tasks, no add-ons', () => {
  // Low: 0.5 + 1 + 2 + 0.5 = 4 task days; design days 3 → major 0.75; PM 10% of 4.75 = 0.475
  //      5.225 days × £350 = £1,828.75 → £1,850
  // High: 1 + 1.5 + 3 + 1 = 6.5; design 4.5 → major 1.125; PM 0.7625; 8.3875 × 350 = £2,935.63
  //       + 10% contingency £293.56 = £3,229.19 → £3,250
  const c = compute(q());
  assert.equal(c.raw.low, 1828.75);
  assert.ok(Math.abs(c.raw.high - 3229.1875) < 1e-6);
  assert.equal(c.low, 1850);
  assert.equal(c.high, 3250);
  assert.equal(line(c, 'major').low, 262.5);       // 0.75 × 350
  assert.equal(line(c, 'contingency').low, 0);     // high only
  assert.equal(line(c, 'minor').high, 0);          // pool is included, no charge
});

test('percentage add-ons apply to both ends; pass-through is not uplifted', () => {
  // Low: 1,828.75 × (1 + 0.25 rush + 0.10 source) = 2,468.81; + £100 × 1.1 = 2,578.81 → £2,600
  // High: 3,229.19 × 1.35 = 4,359.40; + 110 = 4,469.40 → £4,450
  const c = compute(q({ addons: { rush: true, sourceFiles: true, passThrough: [{ item: 'Stock photos', cost: 100 }] } }));
  assert.equal(c.low, 2600);
  assert.equal(c.high, 4450);
  assert.ok(Math.abs(line(c, 'pass:0').low - 110) < 1e-9);   // £100 at cost + 10%
  assert.equal(line(c, 'rush').low, 1828.75 * 0.25);          // rush on the fee, not on pass-through
});

test('usage uplift only accepts the set levels', () => {
  const ok = compute(q({ addons: { usagePct: 30 } }));
  assert.equal(line(ok, 'usage').low, 1828.75 * 0.3);
  const bad = compute(q({ addons: { usagePct: 35 } }));
  assert.equal(line(bad, 'usage'), undefined);
});

test('fixed add-ons: out of hours, extra rounds, extra tweaks, formats', () => {
  // OOH 2 days × 350 × 50% = 350; 1 extra round at suggested price (design low 3 → £131 → clamped £350);
  // 2 batches × £50; 3 formats × £50. Fixed extras = 350 + 350 + 100 + 150 = 950
  // Low: 1,828.75 + 950 = 2,778.75 → £2,800
  const c = compute(q({ addons: { outOfHoursDays: 2, extraMajorRounds: 1, extraMinorBatches: 2, extraFormats: 3 } }));
  assert.equal(c.raw.low, 2778.75);
  assert.equal(c.low, 2800);
  assert.equal(c.extraRoundPrice, 350);
  // contingency covers the fixed extras too on the high side: (2,935.625 + 950) × 1.1 = 4,274.19 → £4,250
  assert.equal(c.high, 4250);
});

test('extra round price: suggestion clamps to £350–700, override wins', () => {
  assert.equal(suggestExtraRound(3), 350);   // £131 → 350
  assert.equal(suggestExtraRound(10), 450);  // £437.50 → 450
  assert.equal(suggestExtraRound(20), 700);  // £875 → 700
  const c = compute(q({ addons: { extraMajorRounds: 2, extraRoundPrice: 600 } }));
  assert.equal(line(c, 'extraRounds').low, 1200);
});

test('job minimum £200, and high never below low', () => {
  const tiny = q({ tasks: [{ id: 'a', stage: 'discovery', name: 'Call', lowDays: 0.5 }] });
  // Low 0.55 days × 350 = 192.50 → £200 (rounding) and the minimum agrees
  assert.equal(compute(tiny).low, 200);
  const strict = { ...RULES, minJob: 500 };
  const c = compute(tiny, strict);
  assert.equal(c.low, 500);
  assert.equal(c.high, 500);   // raw high £423.50 lifts to the low/minimum
});

test('manual high override is respected but never below low', () => {
  const c = compute(q({ tasks: [{ id: 'a', stage: 'design', name: 'Logo', lowDays: 2, highDays: 4 }] }));
  assert.equal(c.lines.find(l => l.key === 'stage:design').high, 1400);
  const d = compute(q({ tasks: [{ id: 'a', stage: 'design', name: 'Logo', lowDays: 2, highDays: 1 }] }));
  assert.equal(d.lines.find(l => l.key === 'stage:design').high, 700);
});

test('empty quote still prices at the minimum', () => {
  const c = compute(q({ tasks: [] }));
  assert.equal(c.low, 200);
  assert.equal(c.high, 200);
});

test('plain-text quote carries the range and the amends terms', () => {
  const t = quoteText(q({ client: 'Acme', project: 'Spring campaign', deliverables: ['Key visual'] }));
  assert.match(t, /From £1,850 to £3,250/);
  assert.match(t, /2 major amend rounds and 10 minor tweaks/);
  assert.match(t, /- Key visual/);
});
