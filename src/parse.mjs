// Brief → products, sizes and extras, via the Claude API. Server side only (holds the API key).
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { STAGES, STAGE_IDS, RULES, toHalf } from './pricing.js';
import { SIZES, catalogueForPrompt } from './catalogue.js';

const CATALOGUE = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const PRODUCT_IDS = CATALOGUE.products.map(p => p.id);

export const MODEL = 'claude-opus-5-5';

const str = { type: 'string' };
const strs = { type: 'array', items: str };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'client', 'project', 'deadline', 'deliverables', 'products', 'extraTasks', 'assumptions', 'exclusions', 'addons'],
  properties: {
    summary: str, client: str, project: str, deadline: str,
    deliverables: strs,
    products: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'size', 'reason'],
        properties: { id: { type: 'string', enum: PRODUCT_IDS }, size: { type: 'string', enum: SIZES }, reason: str },
      },
    },
    extraTasks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['stage', 'name', 'lowDays'],
        properties: { stage: { type: 'string', enum: STAGE_IDS }, name: str, lowDays: { type: 'number' } },
      },
    },
    assumptions: strs,
    exclusions: strs,
    addons: {
      type: 'object', additionalProperties: false,
      required: ['rush', 'rushReason', 'outOfHoursDays', 'usagePct', 'usageReason', 'sourceFiles', 'extraFormats', 'passThrough'],
      properties: {
        rush: { type: 'boolean' }, rushReason: str,
        outOfHoursDays: { type: 'number' },
        usagePct: { type: 'integer', enum: RULES.usagePcts }, usageReason: str,
        sourceFiles: { type: 'boolean' },
        extraFormats: { type: 'integer' },
        passThrough: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['item', 'cost'], properties: { item: str, cost: { type: 'number' } } },
        },
      },
    },
  },
};

const SYSTEM = `You price freelance design jobs for Joe Callingham (Average Joe studio), a UK designer and art director. You are given a brief, a client conversation or a list of demands. Return the job as structured data; Joe edits it before anything goes to the client.

Products
Joe sells these products, each in three sizes (s, m, l). The id comes first:
${catalogueForPrompt(CATALOGUE)}

- products: every product the brief needs, with the size that fits best and a one-line reason pointing to the brief. Pick the smaller size when the brief sits between two. A product's price already covers its own planning, design, artwork, amends, project management and contingency, and the tool adds one kick-off per job, so never add those separately.
- extraTasks: only work that no product covers (for example a one-off illustration inside a deck that's bigger than the size allows). Stages: ${STAGES.map(s => `${s.id} (${s.name})`).join(', ')}. lowDays is the honest time if everything goes smoothly, in half days. Usually empty.
- Name extra tasks in a few plain words a client understands.

Deliverables, assumptions and exclusions
- deliverables: what the client receives, one line each.
- assumptions: anything implied but not stated (social crops, print-ready files, who supplies copy and photos, number of routes, file formats). Short lines.
- exclusions: what is not in the price (copywriting, photography, printing, media buying, web build) when the brief could be read to include it.

Add-ons: set only when the brief calls for them, with a one-line reason quoting or pointing to the brief.
- rush: true if the deadline leaves under 5 working days.
- outOfHoursDays: days the client needs worked at weekends or evenings; 0 otherwise.
- usagePct: advertising usage. 0 for no paid advertising use, 20 local, 30 regional, 40 national, 50 global or multi-market.
- sourceFiles: true if the client asks for working or source files (layered PSD, AI, Figma, open files).
- extraFormats: extra formats or sizes beyond the main set, only if the brief lists them as extras.
- passThrough: stock, fonts, printing, travel the job needs, with your best estimate of cost in pounds; empty if none.

Other fields: summary is one sentence of the job as you understand it. client and project are names from the brief, or "". deadline is the deadline as written, or "".

Be realistic, not generous: Joe tends to under-price. If the brief is too thin to price, still pick your best products and say what you assumed.`;

let client;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export class ParseError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export async function parseBrief(brief) {
  if (!brief || !brief.trim()) throw new ParseError('Paste a brief first', 400);
  if (!hasKey()) throw new ParseError('No API key. Add ANTHROPIC_API_KEY to .env and restart', 503);

  let res;
  try {
    res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      // The date goes in the message, not the system prompt, so rush can be judged against the deadline.
      messages: [{ role: 'user', content: `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.\n\n${brief}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ParseError('The API key was rejected', 401);
    if (err instanceof Anthropic.RateLimitError) throw new ParseError('Rate limited. Try again in a minute', 429);
    if (err instanceof Anthropic.APIConnectionError) throw new ParseError('Could not reach Claude', 502);
    if (err instanceof Anthropic.APIError && /credit balance/i.test(err.message)) throw new ParseError('The Anthropic account is out of credit. Top up in the Console', 402);
    if (err instanceof Anthropic.APIError) throw new ParseError(`Claude error ${err.status}: ${err.message}`, 502);
    throw err;
  }

  if (res.stop_reason === 'refusal') throw new ParseError('Claude declined this brief', 422);
  if (res.stop_reason === 'max_tokens') throw new ParseError('The answer was cut off. Try a shorter brief', 502);

  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new ParseError('Claude returned something unreadable', 502); }

  return { ...clean(data), usage: res.usage, model: res.model };
}

// Never trust model output blindly: fix units and drop anything off-schema.
function clean(d) {
  const s = x => (typeof x === 'string' ? x.trim() : '');
  const list = x => (Array.isArray(x) ? x.map(s).filter(Boolean) : []);
  const a = d.addons || {};
  return {
    summary: s(d.summary), client: s(d.client), project: s(d.project), deadline: s(d.deadline),
    deliverables: list(d.deliverables),
    products: (Array.isArray(d.products) ? d.products : [])
      .filter((p, i, all) => PRODUCT_IDS.includes(p.id) && SIZES.includes(p.size) && all.findIndex(x => x.id === p.id) === i)
      .map(p => ({ id: p.id, size: p.size, reason: s(p.reason) })),
    extraTasks: (Array.isArray(d.extraTasks) ? d.extraTasks : [])
      .filter(t => STAGE_IDS.includes(t.stage) && s(t.name))
      .map((t, i) => ({ id: `x${i + 1}`, stage: t.stage, name: s(t.name), lowDays: Math.min(60, toHalf(t.lowDays)), highDays: null })),
    assumptions: list(d.assumptions),
    exclusions: list(d.exclusions),
    addons: {
      rush: a.rush === true, rushReason: s(a.rushReason),
      outOfHoursDays: Math.max(0, toHalf(a.outOfHoursDays) * (Number(a.outOfHoursDays) > 0 ? 1 : 0)),
      usagePct: RULES.usagePcts.includes(a.usagePct) ? a.usagePct : 0, usageReason: s(a.usageReason),
      sourceFiles: a.sourceFiles === true,
      extraMajorRounds: 0, extraRoundPrice: null, extraMinorBatches: 0,
      extraFormats: Math.max(0, Math.floor(Number(a.extraFormats) || 0)),
      passThrough: (Array.isArray(a.passThrough) ? a.passThrough : [])
        .filter(p => s(p.item) && Number(p.cost) > 0).map(p => ({ item: s(p.item), cost: Math.round(Number(p.cost)) })),
    },
  };
}
