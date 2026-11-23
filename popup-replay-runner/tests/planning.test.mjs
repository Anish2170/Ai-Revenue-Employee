import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseJourneyLinks, allowedDestination } from '../src/replay.mjs';
test('journeys prioritize real same-origin links, excluding unsafe destinations and mutations', () => {
  const links = [
    { href: 'https://example.test/about', text: 'About' },
    { href: 'https://example.test/pricing', text: 'Fees' },
    { href: 'https://evil.test/pricing', text: 'Pricing' },
    { href: 'javascript:alert(1)', text: 'Pricing' },
    { href: 'https://example.test/checkout', text: 'Pay' },
  ];
  const result = chooseJourneyLinks(links, 'https://example.test', 'pricing');
  assert.equal(result[0].href, 'https://example.test/pricing'); assert.equal(result.length, 2);
  assert.equal(allowedDestination('https://user:pass@example.test', 'https://example.test'), false);
});
