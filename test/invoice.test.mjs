// Invoices: hand-worked cases at £350 a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQuote } from '../src/pricing.js';
import { invoiceLines, addDays, invoiceId, INVOICE_ID } from '../src/invoice.js';

function quote() {
  const q = newQuote();
  q.tasks = [
    { id: 'a', stage: 'concept', name: 'Concept', lowDays: 1, actualDays: 2 },
    { id: 'b', stage: 'design', name: 'Design', lowDays: 2, actualDays: 2 },
    { id: 'c', stage: 'artwork', name: 'Artwork', lowDays: 0.5 },          // no actual: uses quoted
  ];
  return q;
}

test('full invoice is priced from actual days, no contingency, whole pounds', () => {
  // tasks 2 + 2 + 0.5 = 4.5; amends 25% of 4 design days = 1; PM 10% of 5.5 = 0.55
  // 6.05 days × £350 = £2,117.50 → £2,118
  const inv = invoiceLines(quote(), {}, { kind: 'full' });
  assert.equal(inv.lines.length, 1);
  assert.equal(inv.lines[0].label, 'Kick-off and other work');
  assert.equal(inv.lines[0].detail, '6.1 days');
  assert.equal(inv.lines[0].amount, 2118);
  assert.equal(inv.total, 2118);
});

test('uplifts and pass-through carry over; total is the sum of the lines', () => {
  const q = quote();
  q.addons.rush = true;                                       // 25% of £2,117.50 = £529.38 → £529
  q.addons.passThrough = [{ item: 'Stock', cost: 100 }];      // £110
  const inv = invoiceLines(q, {}, { kind: 'full' });
  assert.deepEqual(inv.lines.map(l => l.amount), [2118, 110, 529]);
  assert.equal(inv.lines[1].detail, 'At cost + 10%');
  assert.equal(inv.total, 2757);
});

test('deposit is a % of the quoted low total; final takes it off', () => {
  const q = quote();
  q.addons.rush = true;
  // Quoted low: 3.5 task days + 0.75 amends + 0.425 PM = 4.675 days = £1,636.25; rush £409.06 → £2,045.31 → £2,050
  const dep = invoiceLines(q, {}, { kind: 'deposit', depositPct: 50 });
  assert.equal(dep.total, 1025);
  assert.match(dep.lines[0].label, /50% of the quoted £2,050/);
  const fin = invoiceLines(q, {}, { kind: 'final', deposits: [{ id: 'INV-0001', total: 1025 }] });
  assert.equal(fin.subtotal, 2647);                           // 2118 + 529
  assert.deepEqual(fin.less, [{ label: 'Less deposit, INV-0001', amount: 1025 }]);
  assert.equal(fin.total, 1622);
});

test('a tiny job is topped up to the £200 minimum', () => {
  const q = newQuote();
  q.tasks = [{ id: 'a', stage: 'discovery', name: 'Call', lowDays: 0.5 }];  // 0.55 days = £192.50 → £193
  const inv = invoiceLines(q, {}, { kind: 'full' });
  assert.deepEqual(inv.lines.map(l => l.amount), [193, 7]);
  assert.equal(inv.total, 200);
});

test('product rows use the names given; dates and ids', () => {
  const q = quote();
  q.products = [{ id: 'brand-guidelines', size: 's', monthly: 0 }];
  q.tasks.forEach(t => { t.product = 'brand-guidelines'; });
  const inv = invoiceLines(q, { 'brand-guidelines': 'Brand Guidelines, Essentials' }, { kind: 'full' });
  assert.equal(inv.lines[0].label, 'Brand Guidelines, Essentials');
  assert.equal(addDays('2026-11-16', 14), '2026-11-30');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(invoiceId(7), 'INV-0007');
  assert.ok(INVOICE_ID.test('INV-0007') && !INVOICE_ID.test('INV-7/../x'));
});
