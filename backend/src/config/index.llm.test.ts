import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function readModels(overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of ['PRIMARY_LLM_PROVIDER', 'PRIMARY_LLM_MODEL', 'FALLBACK_LLM_PROVIDER', 'FALLBACK_LLM_MODEL', 'EMBEDDING_MODEL']) delete env[key];
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import { config } from './src/config/index.ts';
    process.stdout.write(JSON.stringify({
      primary: { provider: config.llm.primary.provider, model: config.llm.primary.model },
      fallback: config.llm.fallback,
      embedding: config.gemini.embeddingModel,
    }));
  `], {
    cwd: process.cwd(),
    env: { ...env, DOTENV_CONFIG_PATH: '__llm_test_no_dotenv__', ...overrides },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('generation defaults to Luna with Flash-Lite fallback while embeddings remain unchanged', () => {
  assert.deepEqual(readModels(), {
    primary: { provider: 'openai', model: 'gpt-6-luna' },
    fallback: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
    embedding: 'gemini-embedding-001',
  });
});

test('explicit primary and fallback model overrides remain supported', () => {
  const models = readModels({ PRIMARY_LLM_MODEL: 'configured-openai-model', FALLBACK_LLM_MODEL: 'configured-gemini-model' });
  assert.equal(models.primary.model, 'configured-openai-model');
  assert.equal(models.fallback.model, 'configured-gemini-model');
});
