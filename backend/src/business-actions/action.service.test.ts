import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBusinessActions } from './action.service.js';
import type { BusinessActionConfig } from './action.types.js';

function action(actionId: string, destination = `https://example.test/${actionId}`, enabled = true): BusinessActionConfig {
  return {
    actionId,
    label: actionId,
    destinationType: 'URL',
    destination,
    enabled,
  };
}

test('mergeBusinessActions keeps manual actions and fills gaps from discovered actions', () => {
  const manual = [action('contact_sales'), action('pricing', 'https://example.test/manual-pricing')];
  const discovered = [action('pricing', 'https://example.test/discovered-pricing'), action('support')];

  const merged = mergeBusinessActions(manual, discovered);

  assert.deepEqual(merged.map((item) => item.actionId), ['contact_sales', 'pricing', 'support']);
  assert.equal(merged.find((item) => item.actionId === 'pricing')?.destination, 'https://example.test/manual-pricing');
});

test('mergeBusinessActions skips disabled actions', () => {
  const merged = mergeBusinessActions([action('contact_sales', 'https://example.test/contact', false)], [action('support')]);

  assert.deepEqual(merged.map((item) => item.actionId), ['support']);
});