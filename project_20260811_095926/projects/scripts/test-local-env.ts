import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectDir = path.resolve(__dirname, '..');
const temporaryCwd = mkdtempSync(path.join(os.tmpdir(), 'weixun-local-env-'));
const required = [
  'AI_BASE_URL',
  'AI_API_KEY',
  'AI_MODEL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEEPSEEK_AI_BASE_URL',
  'DEEPSEEK_AI_API_KEY',
  'DEEPSEEK_AI_MODEL',
  'DOUBAO_AI_BASE_URL',
  'DOUBAO_AI_API_KEY',
  'DOUBAO_AI_MODEL',
];
const fakeValues: Record<string, string> = {
  AI_BASE_URL: 'https://ai.example.test',
  AI_API_KEY: 'default-secret',
  AI_MODEL: 'default-model',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
  DEEPSEEK_AI_BASE_URL: 'https://deepseek.example.test',
  DEEPSEEK_AI_API_KEY: 'deepseek-secret',
  DEEPSEEK_AI_MODEL: 'deepseek-model',
  DOUBAO_AI_BASE_URL: 'https://doubao.example.test',
  DOUBAO_AI_API_KEY: 'doubao-secret',
  DOUBAO_AI_MODEL: 'doubao-model',
};
const tsxCli = path.join(projectDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const checkScript = path.join(projectDir, 'scripts', 'check-local-env.ts');

function run(values: Record<string, string | undefined>, mode: 'default' | 'prompt-test' = 'prompt-test') {
  const env = { ...process.env };
  for (const name of required) delete env[name];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const result = spawnSync(process.execPath, [tsxCli, checkScript, ...(mode === 'prompt-test' ? ['prompt-test'] : [])], {
    cwd: temporaryCwd,
    env,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

try {
  const regular = run(Object.fromEntries(required.map((name) => [name, fakeValues[name]]).filter(([name]) => !name.startsWith('DEEPSEEK_') && !name.startsWith('DOUBAO_'))), 'default');
  assert.equal(regular.status, 0, regular.output);
  assert.doesNotMatch(regular.output, /DEEPSEEK|DOUBAO/);

  const missing = run({ ...fakeValues, DOUBAO_AI_MODEL: undefined });
  assert.equal(missing.status, 1);
  assert.match(missing.output, /DOUBAO_AI_MODEL/);
  assert.doesNotMatch(missing.output, /doubao-secret|default-secret/);

  const invalidUrl = run({ ...fakeValues, DEEPSEEK_AI_BASE_URL: 'ftp://not-http.example.test' });
  assert.equal(invalidUrl.status, 1);
  assert.match(invalidUrl.output, /DEEPSEEK_AI_BASE_URL/);
  assert.doesNotMatch(invalidUrl.output, /deepseek-secret/);

  const valid = run(fakeValues);
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /prompt-test/);
  assert.doesNotMatch(valid.output, /default-secret|deepseek-secret|doubao-secret/);
  console.log('local environment prompt-test preflight tests passed');
} finally {
  rmSync(temporaryCwd, { recursive: true, force: true });
}
