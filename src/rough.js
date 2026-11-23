// A rough quote from a description, with no AI: the words are matched to the catalogue's
// products, and numbers or scale words pick the size. Used by the quick quote in the
// MacBook notch (/quick). Good enough for a ballpark; the full Pricer does it properly.

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 };

// Phrases that point at each product. Matched as whole words, case-insensitive.
const WORDS = {
  'brand-guidelines': ['brand guidelines', 'guidelines', 'brand book', 'brand identity', 'visual identity', 'identity', 'logo', 'logos', 'rebrand', 'branding', 'wordmark'],
  'brand-portal': ['brand portal', 'brand hub', 'asset library', 'brand site'],
  'social-templates': ['social templates', 'templates', 'instagram', 'posts', 'stories', 'carousel', 'carousels', 'social assets', 'social graphics'],
  'social-strategy': ['social strategy', 'social media strategy', 'content plan', 'content pillars', 'content calendar', 'channel audit', 'content strategy'],
  presentations: ['presentation', 'presentations', 'deck', 'decks', 'pitch deck', 'slides', 'keynote', 'powerpoint'],
  photoshoot: ['photoshoot', 'photo shoot', 'photography', 'photographer', 'product shots', 'lifestyle shots', 'photos'],
  videoshoot: ['videoshoot', 'video shoot', 'filming', 'film shoot', 'videographer', 'video'],
  packaging: ['packaging', 'pack design', 'label', 'labels', 'box design', 'sku', 'skus', 'bottle', 'can design'],
  '3d-visuals': ['3d', 'cgi', 'renders', 'render', '3d visuals', 'product visuals'],
  'motion-films': ['motion', 'animation', 'animated', 'launch film', 'explainer', 'motion graphics', 'sizzle'],
  'ai-imagery': ['ai imagery', 'ai images', 'ai image', 'ai video', 'ai campaign', 'ai stills', 'generative', 'ai generated'],
  website: ['website', 'web site', 'landing page', 'webpage', 'web pages', 'shopify', 'webflow', 'squarespace', 'ecommerce', 'e-commerce', 'online shop', 'site'],
  apps: ['app', 'apps', 'dashboard', 'dashboards', 'web app', 'tool', 'platform', 'portal'],
  'house-style': ['house style', 'brand file', 'brand space', 'living brand'],
  'house-rules': ['house rules', 'brand check', 'brand checker', 'brand checks', 'compliance'],
  housekeeping: ['housekeeping', 'automation', 'automate', 'automated', 'workflow', 'workflows', 'ai agents', 'agents'],
  retainer: ['retainer', 'monthly support', 'ongoing support', 'days a month', 'per month', 'each month'],
};

// When two products match the same words, the more specific one wins.
const BEATS = { 'brand-portal': ['apps'], 'house-style': ['brand-portal', 'brand-guidelines'], 'ai-imagery': ['videoshoot'], 'motion-films': ['videoshoot'] };

const SMALL = /\b(small|simple|quick|basic|tidy|light|refresh|minor|one-off|single|essentials?)\b/;
const LARGE = /\b(full|complete|comprehensive|large|extensive|big|entire|whole|system|campaign|range|global|national|multi-?page|everything)\b/;
const RUSH = /\b(asap|urgent(ly)?|rush|tomorrow|this week|end of (the )?week|in (a|two|2|three|3|four|4) days|next few days|by (monday|tuesday|wednesday|thursday|friday))\b/;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, phrase) => new RegExp(`(^|[^a-z0-9])${esc(phrase)}([^a-z0-9]|$)`).test(text);

// The first number (digits or a word) before one of the given nouns: "12 slides", "three SKUs".
function countOf(text, nouns) {
  const n = `(\\d+|${Object.keys(NUM_WORDS).join('|')})`;
  const m = text.match(new RegExp(`${n}\\s*(?:[a-z-]+\\s+){0,2}(?:${nouns})\\b`));
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
}
const bySize = (n, small, medium) => (n == null ? null : n <= small ? 's' : n <= medium ? 'm' : 'l');

// Size from what the description says about this product, else from scale words, else medium.
function sizeFor(id, text) {
  const specific = {
    'social-templates': () => bySize(countOf(text, 'templates?|posts?|assets?|designs?'), 8, 16),
    presentations: () => (/\btemplate\b/.test(text) ? 'l' : bySize(countOf(text, 'slides?|pages?'), 15, 30)),
    photoshoot: () => (/\bhalf[- ]day\b/.test(text) ? 's' : /\b(two|2)[- ]days?\b/.test(text) ? 'l' : /\b(full|one|1)[- ]day\b/.test(text) ? 'm' : null),
    videoshoot: () => (/\b(two|2)[- ]days?\b|\bcampaign\b/.test(text) ? 'l' : /\bcuts?\b|\bedits\b/.test(text) ? 'm' : null),
    packaging: () => (/\brange\b/.test(text) ? 'l' : bySize(countOf(text, 'skus?|products?|flavours?|flavors?|labels?|boxes'), 1, 4)),
    '3d-visuals': () => (/\binteractive\b|\b3d (for the )?web\b/.test(text) ? 'l' : bySize(countOf(text, 'products?|models?'), 1, 4)),
    website: () => (/\b(cms|shop|shopify|ecommerce|e-commerce|online shop)\b/.test(text) ? 'l'
      : /\b(one[- ]page|landing page|single page)\b/.test(text) ? 's' : bySize(countOf(text, 'pages?'), 1, 6)),
    retainer: () => bySize(countOf(text, 'days?'), 2, 4),
    'motion-films': () => (/\blaunch pack\b|\bvoice-?over\b/.test(text) ? 'l' : /\bcuts?\b/.test(text) ? 'm' : null),
    'ai-imagery': () => (/\bclips?\b|\bvideo\b/.test(text) ? 'm' : bySize(countOf(text, 'stills?|images?'), 10, 20)),
  }[id];
  const s = specific?.();
  if (s) return s;
  if (LARGE.test(text)) return 'l';
  if (SMALL.test(text)) return 's';
  return 'm';
}

/** Products and sizes for a description: [{ id, size, why }] in catalogue order, and rush. */
export function roughPick(description, cat) {
  const text = ` ${String(description || '').toLowerCase().replace(/[’']/g, '')} `;
  const hits = {};
  for (const [id, phrases] of Object.entries(WORDS)) {
    const found = phrases.filter(p => has(text, p));
    if (found.length && cat.products.some(p => p.id === id)) hits[id] = found;
  }
  for (const [winner, losers] of Object.entries(BEATS)) {
    if (!hits[winner]) continue;
    for (const l of losers) if (hits[l] && hits[l].every(w => hits[winner].some(x => x.includes(w) || w.includes(x)))) delete hits[l];
  }
  const order = cat.products.map(p => p.id);
  const products = Object.keys(hits).sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(id => ({ id, size: sizeFor(id, text), why: hits[id].slice(0, 2).join(', ') }));
  return { products, rush: RUSH.test(text) };
}
