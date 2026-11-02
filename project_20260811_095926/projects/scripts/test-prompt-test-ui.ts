import assert from 'node:assert/strict';
import {
  clearLegacyPromptTestSnapshot,
  getPromptTestNpcPromptDraftStorageKey,
  getPromptTestRetryText,
  getPromptTestStorageKey,
  getPromptTestUserId,
  parsePromptTestNpcPromptDraft,
  PROMPT_TEST_LEGACY_STORAGE_KEY,
  reusePromptTestAttempt,
  shouldClearPromptTestInput,
  type PromptTestRetryAttempt,
} from '../src/lib/designer/prompt-test-storage';
import { DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG, promptTestRequestSchema } from '../src/lib/contracts/prompt-test';

const userAKey = getPromptTestStorageKey('u_13800138000');
const userBKey = getPromptTestStorageKey('u_13900139000');
assert.ok(userAKey);
assert.ok(userBKey);
assert.notEqual(userAKey, userBKey, 'different users receive isolated snapshot keys');
assert.match(userAKey, /v3/);
assert.match(userAKey, /u_13800138000/);
assert.equal(getPromptTestStorageKey(null), null, 'an unknown user never gets a shared fallback key');
const userADraftKey = getPromptTestNpcPromptDraftStorageKey('u_13800138000');
const userBDraftKey = getPromptTestNpcPromptDraftStorageKey('u_13900139000');
assert.ok(userADraftKey);
assert.ok(userBDraftKey);
assert.notEqual(userADraftKey, userBDraftKey, 'different users receive isolated prompt draft keys');
assert.equal(getPromptTestNpcPromptDraftStorageKey(null), null, 'an unknown user never gets a prompt draft key');
const validDraft = parsePromptTestNpcPromptDraft({
  ...DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG,
  replyStyle: '通常只用两句，先判断，再说明正式转交方向。',
});
assert.equal(validDraft.replyStyle, '通常只用两句，先判断，再说明正式转交方向。');
assert.deepEqual(parsePromptTestNpcPromptDraft({ replyStyle: '缺少其余字段' }), DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG, 'stale partial drafts fall back safely');
const validConfiguredRequest = promptTestRequestSchema.safeParse({
  action: 'run',
  provider: 'doubao',
  npcId: 'P1-001',
  visitMode: 'in_person',
  commandId: 'prompt-test-command-config-001',
  expectedVersion: 0,
  text: '请把材料转交相关部门核验。',
  npcPromptConfig: DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG,
});
assert.equal(validConfiguredRequest.success, true, 'the API contract accepts a complete designer prompt configuration');
const oversizedConfiguredRequest = promptTestRequestSchema.safeParse({
  action: 'run',
  provider: 'doubao',
  npcId: 'P1-001',
  visitMode: 'in_person',
  commandId: 'prompt-test-command-config-002',
  expectedVersion: 0,
  text: '请把材料转交相关部门核验。',
  npcPromptConfig: { ...DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG, additionalInstructions: 'x'.repeat(2_001) },
});
assert.equal(oversizedConfiguredRequest.success, false, 'the API contract rejects oversized designer prompt content');
assert.equal(getPromptTestUserId(JSON.stringify({ userId: 'u_13800138000' })), 'u_13800138000');
assert.equal(getPromptTestUserId(JSON.stringify({ userId: '' })), null);
assert.equal(getPromptTestUserId('invalid json'), null);

const removed: string[] = [];
clearLegacyPromptTestSnapshot({ removeItem: (key) => removed.push(key) });
assert.deepEqual(removed, [PROMPT_TEST_LEGACY_STORAGE_KEY]);

assert.equal(shouldClearPromptTestInput([true, true], '  本轮话术  ', '本轮话术'), true);
assert.equal(shouldClearPromptTestInput([true, false], '本轮话术', '本轮话术'), false, 'partial failure keeps the input for retry');
assert.equal(shouldClearPromptTestInput([true], '已提交', '用户已改写'), false, 'new input is never cleared by an older request');

const failedRun: PromptTestRetryAttempt = {
  action: 'run',
  commandId: 'prompt-test-command-failed-001',
  expectedVersion: 4,
  sessionId: 'session-for-retry-0000001',
  playerText: '失败轨原始话术',
};
assert.equal(getPromptTestRetryText(failedRun, '用户后来改写的话术'), '失败轨原始话术');
assert.deepEqual(reusePromptTestAttempt(failedRun, 'run'), failedRun, 'retry keeps command id, expected version, session and text');
assert.equal(reusePromptTestAttempt(failedRun, 'reset'), undefined, 'a run failure is not reused for reset');

console.log('prompt test UI helpers passed');
