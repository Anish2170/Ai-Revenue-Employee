import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getBusinessContext } from './provider.js';
import type { BusinessInstructions } from './types.js';

const tenantInstructions: BusinessInstructions = {
  businessName: 'Tenant Test Business',
  tone: 'Helpful and concise.',
  alwaysBookDemo: false,
  avoidDiscounts: true,
  language: 'English',
};

test('context provider: tenant requests never fall back to the global static business context', async () => {
  const context = await getBusinessContext({
    query: 'gift code',
    tenant: {
      websiteId: 'missing-tenant-snapshot',
      instructions: tenantInstructions,
    },
  });

  assert.equal(context.source, 'rag');
  assert.equal(context.business.name, tenantInstructions.businessName);
  assert.equal(context.instructions, tenantInstructions);
  assert.deepEqual(context.chunks, []);
  assert.equal(JSON.stringify(context).includes('Creovix AI'), false);
});
