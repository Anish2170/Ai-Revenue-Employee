import assert from 'node:assert/strict';
import test from 'node:test';
import { hasWidgetScript, buildScriptSnippet } from './widget.service.js';

test('installation requires an actual script with matching site ID and backend source', () => {
  const siteId = 'site_fixture', url = 'https://fitness.example.test/';
  assert.equal(hasWidgetScript(buildScriptSnippet(siteId), url, siteId), true);
  assert.equal(hasWidgetScript(buildScriptSnippet('site_other'), url, siteId), false);
  assert.equal(hasWidgetScript(`<div data-site-id="${siteId}"></div>`, url, siteId), false);
  assert.equal(hasWidgetScript(`<!-- ${buildScriptSnippet(siteId)} -->`, url, siteId), false);
  assert.equal(hasWidgetScript(`<pre>${buildScriptSnippet(siteId).replaceAll('<', '&lt;')}</pre>`, url, siteId), false);
  assert.equal(hasWidgetScript(`<script src="https://other.example/widget.js" data-site-id="${siteId}"></script>`, url, siteId), false);
});
