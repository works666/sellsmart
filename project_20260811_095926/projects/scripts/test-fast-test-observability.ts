import assert from 'node:assert/strict';
import {
  __resetFastTestObservabilityForTests,
  beginFastAiTrace,
  finishFastAiTrace,
  getFastAiTraces,
  isFastDebugEnabled,
  isFastTestUser,
  redactFastTestValue,
  runWithFastTestObservability,
} from '../src/lib/testing/fast-test-observability';

__resetFastTestObservabilityForTests();

assert.equal(isFastTestUser('u_fast_acceptance'), true);
assert.equal(isFastTestUser('u_fast_acceptance_e2e_123'), true);
assert.equal(isFastTestUser('u_someone_else'), false);

const previousNodeEnv = process.env.NODE_ENV;
const previousFastDebug = process.env.ENABLE_FAST_DEBUG;
const mutableEnv = process.env as Record<string, string | undefined>;
mutableEnv.NODE_ENV = 'production';
delete mutableEnv.ENABLE_FAST_DEBUG;
assert.equal(isFastDebugEnabled(), false, 'production must default to disabled');
runWithFastTestObservability('u_fast_acceptance', () => {
  assert.equal(beginFastAiTrace({ providerUrl: 'https://example.test', model: 'blocked', messages: [], stream: false }), null);
});
mutableEnv.ENABLE_FAST_DEBUG = 'true';
assert.equal(isFastDebugEnabled(), true, 'explicit production opt-in should enable the diagnostics');
if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV; else mutableEnv.NODE_ENV = previousNodeEnv;
if (previousFastDebug === undefined) delete mutableEnv.ENABLE_FAST_DEBUG; else mutableEnv.ENABLE_FAST_DEBUG = previousFastDebug;

runWithFastTestObservability('u_someone_else', () => {
  const trace = beginFastAiTrace({ providerUrl: 'https://example.test/v1', model: 'test', messages: [], stream: false });
  assert.equal(trace, null, 'ordinary users must never collect traces');
});

runWithFastTestObservability('u_fast_acceptance', () => {
  const trace = beginFastAiTrace({
    providerUrl: 'https://example.test/v1/chat/completions',
    model: 'test-model',
    messages: [{ role: 'user', content: 'Authorization: Bearer secret-value' }],
    options: { apiKey: 'must-not-leak', temperature: 0.2 },
    stream: false,
  });
  finishFastAiTrace(trace, { rawResponse: { api_key: 'also-secret', value: 'Bearer another-secret' } });
});

const first = getFastAiTraces('u_fast_acceptance');
assert.equal(first.length, 1);
assert.equal(first[0].status, 'success');
assert.doesNotMatch(JSON.stringify(first[0]), /secret-value|must-not-leak|also-secret|another-secret/);
assert.match(JSON.stringify(first[0]), /REDACTED/);

runWithFastTestObservability('u_fast_acceptance', () => {
  for (let index = 0; index < 100; index += 1) {
    const trace = beginFastAiTrace({ providerUrl: 'https://example.test', model: `m-${index}`, messages: [], stream: false });
    finishFastAiTrace(trace, { rawResponse: { index } });
  }
});
const capped = getFastAiTraces('u_fast_acceptance', 999);
assert.equal(capped.length, 80, 'trace store must have a fixed upper bound');
assert.equal(capped[0].model, 'm-99');

const redacted = redactFastTestValue({ authorization: 'Bearer top-secret', nested: { password: 'p' }, content: 'sk-proj_abcdefghijklmnop' });
assert.doesNotMatch(JSON.stringify(redacted), /top-secret|"p"|sk-proj_abcdefghijklmnop/);

console.log('fast-test observability permissions, redaction and capacity tests passed');
