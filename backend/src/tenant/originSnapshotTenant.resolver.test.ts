import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTenantFromRequestOrigin } from './originSnapshotTenant.resolver.js';

test('origin snapshot tenant resolver: resolves a unique tenant from the request origin host', async () => {
  const result = await resolveTenantFromRequestOrigin({
    siteId: 'site_test',
    origin: 'https://thecolourtrading.in',
  });

  assert.ok(result);
  assert.equal(result.matchedBy, 'origin');
  assert.equal(result.tenant.siteId, 'site_test');
  assert.equal(result.tenant.websiteUrl, 'https://thecolourtrading.in');
  assert.equal(result.tenant.websiteId, '921a02c4-ecf3-4183-b57d-25ea38f7887f');
  assert.equal(result.tenant.instructions.businessName.includes('Creovix'), false);
});

test('origin snapshot tenant resolver: fails closed when no request origin or referer matches a tenant snapshot', async () => {
  const missingHeaders = await resolveTenantFromRequestOrigin({ siteId: 'site_test' });
  const unknownOrigin = await resolveTenantFromRequestOrigin({
    siteId: 'site_test',
    origin: 'https://unknown.example',
  });

  assert.equal(missingHeaders, null);
  assert.equal(unknownOrigin, null);
});
