import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const validationScript = `
  import { validateProductionConfig } from './src/config/index.ts';
  try {
    validateProductionConfig();
    process.stdout.write(JSON.stringify({ ok: true }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'Unknown error' }));
  }
`;

const validProductionEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://configured.example/database',
  SESSION_SECRET: 'valid-production-session-secret-1234567890',
  FRONTEND_URL: 'https://frontend.example',
  DASHBOARD_ORIGIN: 'https://dashboard.example',
  WIDGET_BASE_URL: 'https://widget.example',
  CORS_ORIGIN: 'https://dashboard.example',
  PRIMARY_LLM_PROVIDER: 'openai',
  PRIMARY_LLM_MODEL: 'configured-openai-model',
  OPENAI_API_KEY: 'configured-openai-key',
  FALLBACK_LLM_PROVIDER: 'gemini',
  FALLBACK_LLM_MODEL: 'configured-gemini-model',
  GEMINI_API_KEY: 'configured-gemini-key',
  EMBEDDING_MODEL: 'configured-embedding-model',
  KNOWLEDGE_STORAGE: 'local',
};

function validate(overrides: NodeJS.ProcessEnv = {}): { ok: boolean; message?: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', validationScript], {
    cwd: process.cwd(),
    env: { ...validProductionEnv, ...overrides },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { ok: boolean; message?: string };
}

test('valid OpenAI and Gemini API keys pass production missing-variable validation', () => {
  assert.deepEqual(validate(), { ok: true });
});

test('valid OpenAI API key is not reported missing when Gemini key is absent', () => {
  const result = validate({ GEMINI_API_KEY: '' });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /GEMINI_API_KEY/);
  assert.doesNotMatch(result.message ?? '', /OPENAI_API_KEY/);
});

test('valid Gemini API key is not reported missing when OpenAI key is absent', () => {
  const result = validate({ OPENAI_API_KEY: '' });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /OPENAI_API_KEY/);
  assert.doesNotMatch(result.message ?? '', /GEMINI_API_KEY/);
});

test('missing required OpenAI and Gemini API keys are rejected', () => {
  const result = validate({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /OPENAI_API_KEY/);
  assert.match(result.message ?? '', /GEMINI_API_KEY/);
});

test('whitespace-only required API keys are rejected', () => {
  const result = validate({ OPENAI_API_KEY: '   ', GEMINI_API_KEY: '\t' });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /OPENAI_API_KEY/);
  assert.match(result.message ?? '', /GEMINI_API_KEY/);
});

test('unrelated required-variable and origin validation remains intact', () => {
  const missingDatabase = validate({ DATABASE_URL: '' });
  assert.equal(missingDatabase.ok, false);
  assert.match(missingDatabase.message ?? '', /DATABASE_URL/);
  assert.doesNotMatch(missingDatabase.message ?? '', /OPENAI_API_KEY|GEMINI_API_KEY/);

  const wildcardCors = validate({ CORS_ORIGIN: '*' });
  assert.equal(wildcardCors.ok, false);
  assert.match(wildcardCors.message ?? '', /Invalid production environment variables: CORS_ORIGIN/);
});
