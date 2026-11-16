// Product catalogue helpers. Pure: the catalogue object is passed in
// (the browser fetches /api/catalogue, the server and tests read data/catalogue.json).
export const SIZES = ['s', 'm', 'l'];

let seq = 0;
const uid = p => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export const findProduct = (cat, id) => cat.products.find(p => p.id === id);

export function productTasks(cat, id, size) {
  const s = findProduct(cat, id)?.sizes?.[size];
  if (!s) return [];
  return s.tasks.map(([stage, name, days]) => ({ id: uid('t'), stage, name, lowDays: days, highDays: null, product: id }));
}

// Switch a product on (size 's' | 'm' | 'l') or off (null). Replaces that product's
// tasks, pass-through costs and monthly figure with the catalogue's for that size.
// Edits Joe made to that product's tasks are reset by a size change, on purpose:
// the size is the template.
export function setProduct(quote, cat, id, size) {
  const p = findProduct(cat, id);
  if (!p) return quote;
  quote.tasks = (quote.tasks || []).filter(t => t.product !== id);
  quote.addons.passThrough = (quote.addons.passThrough || []).filter(x => x.product !== id);
  quote.products = (quote.products || []).filter(x => x.id !== id);
  if (size && p.sizes[size]) {
    const s = p.sizes[size];
    quote.tasks.push(...productTasks(cat, id, size));
    quote.addons.passThrough.push(...(s.pass || []).map(([item, cost]) => ({ item, cost, product: id })));
    quote.products.push({ id, size, monthly: s.monthly || 0 });
    // keep catalogue order so quotes always read the same way
    const order = cat.products.map(x => x.id);
    quote.products.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  ensureKickoff(quote, cat);
  return quote;
}

// One kick-off per job, added when the first product goes on. Joe can edit or remove it.
export function ensureKickoff(quote, cat) {
  const k = cat.kickoff;
  const has = quote.tasks.some(t => t.kickoff);
  if (!has && quote.products.length) {
    quote.tasks.unshift({ id: uid('k'), stage: k.stage, name: k.name, lowDays: k.days, highDays: null, kickoff: true });
  }
  const kt = quote.tasks.find(t => t.kickoff && !t.edited);
  if (kt) kt.lowDays = quote.products.length >= 3 ? k.daysIfThreePlusProducts : k.days;
  return quote;
}

export const productLabel = (cat, id, size) => {
  const p = findProduct(cat, id);
  return p ? `${p.name}${size && p.sizes[size] ? `, ${p.sizes[size].label}` : ''}` : id;
};

// Short text version of the catalogue for the brief-reading prompt.
export function catalogueForPrompt(cat) {
  return cat.products.map(p => `- ${p.id} (${p.name}${p.summary ? `: ${p.summary.replace(/^GUESS: /, '')}` : ''}): `
    + SIZES.map(k => `${k} = ${p.sizes[k].label}, ${p.sizes[k].summary}`).join('; ')).join('\n');
}
