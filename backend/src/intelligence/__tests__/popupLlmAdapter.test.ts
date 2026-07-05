/** Tests for Sprint 4.2 component 5: provider-independent popup LLM adapter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generatePopupLanguage } from '../popupLlmAdapter.js';
import { popupJsonSchema } from '../../validation/popupSchema.js';
import type { BuiltPopupPrompt } from '../../prompts/popupPromptBuilder.js';
import type { PreLlmSafetyResult } from '../safetyLayer.js';
import type { StructuredRequest } from '../../llm/index.js';

function prompt(): BuiltPopupPrompt {
  return {
    version: 'popup-v1',
    system: 'system instructions',
    user: 'user prompt',
    schema: popupJsonSchema,
    sections: [],
  };
}

function safety(ok = true): PreLlmSafetyResult {
  return {
    ok,
    reasons: ok ? [] : ['missing_knowledge'],
    checked: {
      salesBrainSpeak: ok,
      confidenceOk: ok,
      strategyOk: ok,
      knowledgeOk: ok,
      ctaOk: ok,
      businessPolicyOk: ok,
    },
  };
}

test('popupLlmAdapter: does not call provider when safety rejects', async () => {
  let called = false;
  const result = await generatePopupLanguage(
    { prompt: prompt(), safety: safety(false) },
    {
      available: () => true,
      generateStructured: async () => {
        called = true;
        return {};
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'safety_rejected');
  assert.equal(result.promptVersion, 'popup-v1');
});

test('popupLlmAdapter: rejects when provider is unavailable', async () => {
  let called = false;
  const result = await generatePopupLanguage(
    { prompt: prompt(), safety: safety(true) },
    {
      available: () => false,
      generateStructured: async () => {
        called = true;
        return {};
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_unavailable');
});

test('popupLlmAdapter: calls provider with structured popup prompt', async () => {
  const seen: StructuredRequest[] = [];
  const raw = { title: 'Pricing help', body: 'Want help comparing plans?', cta: 'Discuss pricing', tone: 'reassuring', popupType: 'pricing' };

  const result = await generatePopupLanguage(
    { prompt: prompt(), safety: safety(true) },
    {
      available: () => true,
      generateStructured: async (req) => {
        seen.push(req);
        return raw;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.raw, raw);
  assert.equal(seen.length, 1);
  const req = seen[0];
  assert.equal(req.system, 'system instructions');
  assert.equal(req.user, 'user prompt');
  assert.deepEqual(req.schema, popupJsonSchema);
});

test('popupLlmAdapter: fails closed on timeout', async () => {
  const result = await generatePopupLanguage(
    { prompt: prompt(), safety: safety(true) },
    {
      available: () => true,
      timeoutMs: 1,
      generateStructured: () => new Promise((resolve) => setTimeout(() => resolve({}), 50)),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
});

test('popupLlmAdapter: fails closed on provider error', async () => {
  const result = await generatePopupLanguage(
    { prompt: prompt(), safety: safety(true) },
    {
      available: () => true,
      generateStructured: async () => {
        throw new Error('provider exploded');
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_error');
  assert.match(result.detail ?? '', /provider exploded/);
});