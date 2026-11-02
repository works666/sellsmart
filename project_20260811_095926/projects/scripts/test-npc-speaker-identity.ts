import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateNpcReplyWithIdentityGuard,
  hasNpcSpeakerIdentityViolation,
  npcSpeakerIdentityInstruction,
} from '../src/lib/ai/npc-speaker-identity';

const zhang = { id: 'P1-001', name: '张建国', title: '业务分管副总' };
const li = { id: 'P1-002', name: '李明辉', title: '项目经理' };

assert.equal(
  hasNpcSpeakerIdentityViolation(zhang, '你好，张总。我们是专注政企数字化交付的团队，想和您确认后续合作。'),
  true,
  'supplier self-identification plus addressing the target NPC as the player must be rejected',
);
assert.equal(
  hasNpcSpeakerIdentityViolation(zhang, '张建国您好，我们是乙方销售团队，今天想向您汇报。'),
  true,
  'addressing the target NPC as the player must be rejected even without a title',
);
assert.equal(
  hasNpcSpeakerIdentityViolation(zhang, '我们是专注政企数字化交付的团队，已经做过两个同类项目。'),
  true,
  'vendor identity is rejected even when the model omits the NPC salutation',
);
assert.equal(
  hasNpcSpeakerIdentityViolation(zhang, '您好，我是张建国。现在方便说话吗？'),
  false,
  'a normal NPC phone self-introduction remains valid',
);
assert.equal(hasNpcSpeakerIdentityViolation(zhang, '张建国：您好，您先说来意。'), true, 'a speaker-name prefix is not spoken NPC dialogue');
assert.equal(hasNpcSpeakerIdentityViolation(zhang, '林先生您好，您请讲。'), false, 'the actual visitor may be addressed normally');
assert.equal(
  hasNpcSpeakerIdentityViolation(li, '张建国只负责方向判断，技术问题请先和我核对数据。'),
  false,
  'a normal mention of another NPC remains valid',
);
assert.equal(
  hasNpcSpeakerIdentityViolation(li, '我已收到方案，需要再核验技术参数和验收口径。'),
  false,
  'ordinary first-person NPC reply remains valid',
);

async function main() {
  const correctedPrompts: Array<string | undefined> = [];
  const corrected = await generateNpcReplyWithIdentityGuard(zhang, 'work_phone', async (retryInstruction) => {
    correctedPrompts.push(retryInstruction);
    return retryInstruction
      ? '我先听一下，请说明这次想确认的验收口径和依据。'
      : '你好，张总。我们是专注政企数字化交付的团队。';
  });
  assert.equal(corrected.source, 'repaired');
  assert.equal(corrected.reply, '我先听一下，请说明这次想确认的验收口径和依据。');
  assert.equal(correctedPrompts.length, 2, 'a role reversal receives exactly one targeted regeneration');
  assert.match(correctedPrompts[1] ?? '', /发言身份校验失败/);
  assert.match(correctedPrompts[1] ?? '', /电话中“我是张建国”是允许/);

  let fallbackCalls = 0;
  const fallback = await generateNpcReplyWithIdentityGuard(zhang, 'work_phone', async () => {
    fallbackCalls += 1;
    return '你好，张总。我们是乙方服务商。';
  });
  assert.equal(fallbackCalls, 2, 'repeated role reversals stop after one retry');
  assert.equal(fallback.source, 'fallback');
  assert.equal(fallback.reply, '抱歉，这件事我暂时不便答复。');

  await assert.rejects(
    generateNpcReplyWithIdentityGuard(zhang, 'work_phone', async () => ' \n\t '),
    /AI_PROVIDER_EMPTY_RESPONSE/,
    'whitespace from a streamed generation must never be accepted or persisted as NPC speech',
  );

  const route = readFileSync(resolve(process.cwd(), 'src/app/api/chat/stream/route.ts'), 'utf8');
  assert.match(route, /generateNpcReplyWithIdentityGuard\(npc, channel/);
  assert.match(route, /npcSpeakerIdentityInstruction\(npc, channel\)/);
  assert.match(route, /const assessment = await evaluateNpcTurn/);
  assert.ok(
    route.indexOf('generateNpcReplyWithIdentityGuard(npc, channel') < route.indexOf('const assessment = await evaluateNpcTurn'),
    'only a valid repaired reply may reach evaluation and persistence',
  );
  assert.match(npcSpeakerIdentityInstruction(zhang, 'work_phone'), /张建国/);
  assert.match(npcSpeakerIdentityInstruction(zhang, 'work_phone'), /销售方/);

  console.log('formal NPC speaker identity guard tests passed');
}

void main();
