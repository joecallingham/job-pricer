// Invoices from a quote. Pure: no DOM, no network, no files.
// Used by the server (to issue and freeze an invoice) and by the page (live preview).
//
// Decided with Joe, 16 Nov 2026:
// - Priced from the days actually worked: each task's `actualDays` (falls back to
//   the quoted low days), with the same rules as the quote's low side.
// - One figure, no range, no contingency (contingency covers quote uncertainty).
// - Not VAT registered: no VAT lines.
// - Per job: one full invoice, or a deposit (a % of the quoted low total) then a
//   final invoice (actual total less the deposits already invoiced).
// - Monthly figures are billed separately, never on these invoices.
// Lines are whole pounds and the total is their sum, so the PDF always adds up.
import { compute, rowLabel, toHalf, RULES } from './pricing.js';

export const KINDS = ['full', 'deposit', 'final'];
export const KIND_TITLE = { full: 'Invoice', deposit: 'Deposit invoice', final: 'Final invoice' };

const pounds = x => Math.round(Number(x) || 0);

// The quote with each task's days replaced by the days actually worked.
export function actualQuote(quote) {
  return {
    ...quote,
    tasks: (quote.tasks || []).map(t => ({ ...t, lowDays: t.actualDays != null ? toHalf(t.actualDays) : toHalf(t.lowDays), highDays: null })),
  };
}

// names: { [productId]: 'Brand Guidelines, Identity' }
// opts: { kind, depositPct, deposits: [{ id, total }] }
export function invoiceLines(quote, names = {}, opts = {}, rules = RULES) {
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'full';

  if (kind === 'deposit') {
    const pct = Math.min(100, Math.max(1, Number(opts.depositPct) || 50));
    const quoted = compute(quote, rules).low;
    const amount = pounds(quoted * pct / 100);
    return { kind, lines: [{ label: `Deposit, ${pct}% of the quoted £${quoted.toLocaleString('en-GB')}`, detail: '', amount }], subtotal: amount, less: [], total: amount, depositPct: pct };
  }

  const c = compute(actualQuote(quote), rules);
  const lines = c.rows
    .map(r => ({
      label: rowLabel(r, names),
      detail: r.kind === 'pass' ? 'At cost + 10%' : r.days ? dayWords(r.days[0]) : r.reason || '',
      amount: pounds(r.low),
    }))
    .filter(l => l.amount > 0);
  let subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (subtotal < rules.minJob) {
    lines.push({ label: 'Minimum charge', detail: '', amount: rules.minJob - subtotal });
    subtotal = rules.minJob;
  }
  const less = kind === 'final'
    ? (opts.deposits || []).filter(d => pounds(d.total) > 0).map(d => ({ label: `Less deposit, ${d.id}`, amount: pounds(d.total) }))
    : [];
  const total = Math.max(0, subtotal - less.reduce((s, l) => s + l.amount, 0));
  return { kind, lines, subtotal, less, total, days: c.days.low };
}

const dayWords = d => { const n = Math.round(d * 10 + 1e-9) / 10; return `${n} ${n === 1 ? 'day' : 'days'}`; };

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export const longDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const invoiceId = n => `INV-${String(n).padStart(4, '0')}`;
export const INVOICE_ID = /^INV-[0-9]{4,6}$/;
