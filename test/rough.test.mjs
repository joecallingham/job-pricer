import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roughPick } from '../src/rough.js';

const cat = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url)));
const pick = text => Object.fromEntries(roughPick(text, cat).products.map(p => [p.id, p.size]));

test('a rebrand with a site and social templates', () => {
  assert.deepEqual(pick('Full rebrand for a coffee roaster: new logo and guidelines, a 5 page website and 12 Instagram templates'),
    { 'brand-guidelines': 'l', 'social-templates': 'm', website: 'm' });
});

test('numbers pick the size', () => {
  assert.deepEqual(pick('A pitch deck, about 10 slides'), { presentations: 's' });
  assert.deepEqual(pick('Packaging for three SKUs'), { packaging: 'm' });
  assert.deepEqual(pick('Half day photoshoot of the new menu'), { photoshoot: 's' });
  assert.deepEqual(pick('Shopify site'), { website: 'l' });
});

test('the more specific product wins shared words', () => {
  assert.deepEqual(pick('A brand portal with an asset library'), { 'brand-portal': 'm' });
  assert.deepEqual(pick('AI video for the launch'), { 'ai-imagery': 'm' });
});

test('rush from the deadline words', () => {
  assert.equal(roughPick('Need a logo ASAP', cat).rush, true);
  assert.equal(roughPick('Need a logo by March', cat).rush, false);
});

test('nothing recognisable gives nothing', () => {
  assert.deepEqual(roughPick('Hello, can we have a chat?', cat).products, []);
});
