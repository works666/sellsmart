import assert from 'node:assert/strict';
import {
  customerActivityReplyInstruction,
  customerActivityReplySignals,
  generateNpcReplyWithCustomerActivityGuard,
  hasCustomerActivityDisposition,
  hasCustomerActivityReferral,
  safeAmbiguousCustomerActivityReply,
} from '../src/lib/ai/customer-activity-reply';
import { isCustomerActivityReplyContext, isHospitalityCustomerActivityContext, isNaturalLanguageCustomerActivityInvitation, isNaturalLanguageInvitation } from '../src/lib/game/invitation-intent';

const positiveExamples = [
  '您好，希望围绕一线流程安排一次正式沟通，方便和您见面吗？',
  '这周能否约个时间到贵司当面交流？',
  '我们想和您安排一次技术交流。',
  'Could we schedule a meeting next week?',
];
const negativeExamples = [
  '上次见面后您提到的材料我已经发到邮箱了。',
  '见面后我们再发材料，先把现有数据核对一下。',
  '之前拜访的纪要已经整理完成。',
  '谢谢您回复，我继续补充项目资料。',
];

for (const example of positiveExamples) assert.equal(isNaturalLanguageInvitation(example), true, example);
for (const example of negativeExamples) assert.equal(isNaturalLanguageInvitation(example), false, example);

const existingActivityInvitations = [
  '我们想和您安排一次技术交流会。',
  '方便带您去我们之前的案例现场参观吗？',
  '想邀请贵司团队来我们公司参观。',
];
for (const example of existingActivityInvitations) {
  assert.equal(isNaturalLanguageInvitation(example), true, example);
  assert.equal(isNaturalLanguageCustomerActivityInvitation(example), true, example);
}

const activityOnlyProposals = [
  '赵老师您好，我觉得咱们可以办一个技术交流会，贵单位提具体需求，我们来提供技术方案，您看能不能安排一下？',
  '咱们下周开个技术交流会吧。',
  '技术交流会可以安排一下吗？',
];
for (const example of activityOnlyProposals) assert.equal(isNaturalLanguageCustomerActivityInvitation(example), true, example);
assert.equal(isNaturalLanguageCustomerActivityInvitation('你们有技术交流会吗？'), false);
assert.equal(isNaturalLanguageCustomerActivityInvitation('有没有类似案例可以参观？'), false);
assert.equal(isNaturalLanguageCustomerActivityInvitation('上次技术交流会已经开过了，会议纪要我发到邮箱了。'), false);
assert.equal(isNaturalLanguageCustomerActivityInvitation('这次不能安排技术交流会。'), false);
assert.equal(isNaturalLanguageCustomerActivityInvitation('我们取消这次技术交流会。'), false);
assert.equal(isNaturalLanguageCustomerActivityInvitation('不是不能安排技术交流会。'), true,
  'double negation stays an invitation signal rather than a cancellation');
assert.equal(isNaturalLanguageCustomerActivityInvitation('方便不方便安排一次技术交流会？'), true,
  'a question using a negative form remains an invitation signal');
for (const example of ['明晚一起吃个饭吧', '周末要不要喝酒？', '我想请您吃顿饭', '下周安排个饭局方便吗？']) {
  assert.equal(isNaturalLanguageInvitation(example), true, `hospitality invitation is separated from ordinary appointments: ${example}`);
  assert.equal(isNaturalLanguageCustomerActivityInvitation(example), true, example);
  assert.equal(isCustomerActivityReplyContext(example), true, `${example} receives customer-activity reply guidance`);
}
assert.equal(isNaturalLanguageCustomerActivityInvitation('上次饭局聊得很愉快，材料我已发您。'), false,
  'historical dinners remain ordinary conversation');
assert.equal(isNaturalLanguageCustomerActivityInvitation('这次先不安排饭局了。'), false,
  'a withdrawn dinner suggestion is not opened as a new event');
assert.equal(isNaturalLanguageCustomerActivityInvitation('请您喝一杯茶吧。'), false,
  'a tea invitation is not classified as the hospitality dinner/drinks activity');
assert.equal(isCustomerActivityReplyContext('饭局已经办过了，挺愉快。'), false,
  'historical dinner references do not invoke the activity reply guard');
assert.equal(isHospitalityCustomerActivityContext('那下周三怎么样？', [
  { speaker: 'sales', text: '明晚一起吃个饭吧。' },
]), true, 'meal planning follow-ups retain hospitality context');
assert.equal(isHospitalityCustomerActivityContext('那下周三怎么样？', [
  { speaker: 'sales', text: '明晚一起吃个饭吧。' },
  { speaker: 'customer', text: '谢谢，我想想。' },
  { speaker: 'sales', text: '我们下周开个技术交流会吧。' },
]), false, 'the latest open organization activity determines follow-up handling');
assert.equal(isHospitalityCustomerActivityContext('我们下周开个技术交流会吧。', [
  { speaker: 'sales', text: '明晚一起吃个饭吧。' },
]), false, 'an explicit organization activity takes precedence over a prior dinner proposal');
assert.equal(isCustomerActivityReplyContext('下周三？', [
  { speaker: 'sales', text: '要不下周开个技术交流会？' },
  { speaker: 'customer', text: '我先向上级汇报，再给您反馈。' },
]), true, 'date-only follow-ups inherit the unresolved activity context');
assert.equal(isCustomerActivityReplyContext('下周三？', [
  { speaker: 'sales', text: '不是不能安排技术交流会。' },
]), true, 'double-negated activity proposals remain context for a later date follow-up');
assert.equal(isCustomerActivityReplyContext('技术交流会时间定不了，但我们可以先讨论需求。'), true,
  'an activity mentioned with a date uncertainty remains in context for semantic review');
assert.equal(isCustomerActivityReplyContext('上次技术交流会开完后，我把纪要发给您了。'), false,
  'a historical activity reference alone is not a live activity context');

async function testActivityReplyGuard() {
  const seniorInstruction = customerActivityReplyInstruction('高层');
  assert.match(seniorInstruction, /本人.*自行考虑.*内部商量/u);
  assert.match(seniorInstruction, /不得让客户\/销售去找.*负责人/u);
  assert.doesNotMatch(seniorInstruction, /建议找具体项目负责人/u);
  assert.match(customerActivityReplyInstruction('中层'), /以本人为主语.*向上级汇报/u);
  assert.match(customerActivityReplyInstruction('中层', true), /无需自动向上级汇报/u,
    'hospitality reply guidance does not require an organizational referral');
  assert.equal(customerActivityReplySignals('我先考虑一下，稍后再给您答复。', '中层', true).includes('disposition'), false,
    'a target customer can consider a hospitality invite personally');
  assert.equal(customerActivityReplySignals('我先考虑一下，稍后再给您答复。', '中层').includes('disposition'), true,
    'organizational activities keep the middle-level upward-reporting requirement');
  assert.equal(hasCustomerActivityReferral('您先联系项目负责人确认一下。'), true);
  assert.equal(hasCustomerActivityReferral('建议您先和实际负责项目的同事沟通，确认后再答复您。'), true,
    'a player-directed referral through a discussion is recognized');
  assert.equal(hasCustomerActivityReferral('您可以跟负责同事商量，或者去对接项目组。'), true,
    'an indirect instruction to consult or coordinate another person is recognized');
  assert.equal(hasCustomerActivityReferral('我会和项目同事商量后，再决定是否安排。'), false,
    'NPC-owned internal consultation remains acceptable');
  assert.equal(hasCustomerActivityReferral('我得先向上汇报，暂时不能确认安排。'), false,
    'middle-level NPC can report upward themselves');
  assert.equal(hasCustomerActivityReferral('我先内部考虑，不需要您联系项目负责人。'), false,
    'a negated referral is not treated as telling the player to contact someone');

  const highLevelNpc = { id: 'P1-001', name: '张建国', title: '主管副总经理', category: '高层' as const };
  const reviewContext = {
    playerMessage: '我们要不要安排一次技术交流会？',
    recentConversation: [{ speaker: 'sales' as const, text: '我们希望开技术交流会。' }],
  };
  const allowedReviewer = async (messages: Array<{ content: string }>) => {
    const reviewInput = messages.at(-1)?.content ?? '';
    assert.match(reviewInput, /我们要不要安排一次技术交流会/u, 'review receives the current player message');
    assert.match(reviewInput, /我们希望开技术交流会/u, 'review receives related dialogue history');
    return JSON.stringify({ decision: 'allowed', issue: 'none' });
  };
  const guardOptions = { context: reviewContext, invoker: allowedReviewer };
  const hospitalityContext = {
    playerMessage: '那周末方便吗？',
    recentConversation: [{ speaker: 'sales' as const, text: '明晚一起吃个饭吧。' }],
  };
  const politeHospitality = await generateNpcReplyWithCustomerActivityGuard({ ...highLevelNpc, category: '中层' }, 'email', async () => (
    '我会先结合工作安排考虑，之后再给您答复。'
  ), { context: hospitalityContext, invoker: async () => JSON.stringify({ decision: 'allowed', issue: 'none' }) });
  assert.equal(politeHospitality.source, 'generated', 'middle-level hospitality replies may use personal consideration without upward reporting');
  assert.equal(customerActivityReplySignals(politeHospitality.reply, '中层', true).includes('disposition'), false);

  const hospitalityFallback = await generateNpcReplyWithCustomerActivityGuard({ ...highLevelNpc, category: '中层' }, 'email', async () => (
    '我会先考虑，再给您反馈。'
  ), { context: hospitalityContext, invoker: async () => { throw new Error('mock reviewer unavailable'); } });
  assert.equal(hospitalityFallback.source, 'fallback');
  assert.doesNotMatch(hospitalityFallback.reply, /向上级汇报/u,
    'a review failure uses a hospitality-safe fallback at every NPC level');

  const reviewerSequence = (...answers: Array<Record<string, string>>) => {
    let index = 0;
    return async () => JSON.stringify(answers[Math.min(index++, answers.length - 1)]);
  };
  let attempts = 0;
  const repaired = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return attempts === 1
      ? '好的，下周安排技术团队参加。'
      : '我先结合目前项目情况自行考虑，必要时和公司内部商量，再给您反馈。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'premature_acceptance', evidence: '好的，下周安排技术团队参加。' },
    { decision: 'allowed', issue: 'none' },
  ) });
  assert.equal(repaired.source, 'repaired');
  assert.equal(attempts, 2, 'an explicit acceptance gets one targeted rewrite');
  assert.match(repaired.reply, /考虑/u);

  attempts = 0;
  const ambiguous = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return '我先结合目前项目情况自行考虑，必要时和公司内部商量，再给您反馈。';
  }, guardOptions);
  assert.equal(ambiguous.source, 'generated', 'a valid role-aware ambiguous reply is kept without needless repair');
  assert.equal(attempts, 1);

  attempts = 0;
  const seniorReferral = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return attempts === 1
      ? '建议您去联系具体项目负责人再确定。'
      : '我先结合目前项目情况自行考虑，必要时和公司内部商量，再给您反馈。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'player_referral', evidence: '建议您去联系具体项目负责人再确定。' },
    { decision: 'allowed', issue: 'none' },
  ) });
  assert.equal(seniorReferral.source, 'repaired');
  assert.equal(attempts, 2, 'a high-level NPC cannot send the player to another owner');
  assert.equal(hasCustomerActivityReferral(seniorReferral.reply), false);

  attempts = 0;
  const middleReferral = await generateNpcReplyWithCustomerActivityGuard({ ...highLevelNpc, category: '中层' }, 'email', async () => {
    attempts += 1;
    return attempts === 1
      ? '您联系一下项目领导，确认后告诉我。'
      : '我需要先向上级汇报，再给您反馈。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'player_referral', evidence: '您联系一下项目领导，确认后告诉我。' },
    { decision: 'allowed', issue: 'none' },
  ) });
  assert.equal(middleReferral.source, 'repaired');
  assert.equal(attempts, 2, 'a middle-level NPC reports upward themselves, without directing the player to a leader');
  assert.equal(hasCustomerActivityReferral(middleReferral.reply), false);

  attempts = 0;
  const unsafeRepair = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return '您先找项目负责人沟通一下。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'player_referral', evidence: '您先找项目负责人沟通一下。' },
    { decision: 'violation', issue: 'player_referral', evidence: '您先找项目负责人沟通一下。' },
  ) });
  assert.equal(unsafeRepair.source, 'fallback', 'a repeated referral falls back to a safe role reply');
  assert.equal(hasCustomerActivityReferral(unsafeRepair.reply), false);

  attempts = 0;
  const refusal = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return '这涉及商业秘密，我不能接受泄密要求。';
  }, { ...guardOptions, invoker: async () => JSON.stringify({ decision: 'allowed', issue: 'compliance_refusal' }) });
  assert.equal(refusal.source, 'generated', 'a compliance refusal is preserved');
  assert.equal(attempts, 1);

  attempts = 0;
  const mixedCommitment = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return attempts === 1
      ? '可以安排技术交流会，不过价格暂时不能定。'
      : '我先结合目前项目情况自行考虑，必要时和公司内部商量，再给您反馈。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'premature_acceptance', evidence: '可以安排技术交流会' },
    { decision: 'allowed', issue: 'none' },
  ) });
  assert.equal(mixedCommitment.source, 'repaired', 'a later caveat cannot hide an earlier explicit acceptance');
  assert.equal(attempts, 2);

  attempts = 0;
  const fallback = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'offline', async () => {
    attempts += 1;
    return '没问题安排一次技术交流会。';
  }, { ...guardOptions, invoker: reviewerSequence(
    { decision: 'violation', issue: 'premature_acceptance', evidence: '没问题安排一次技术交流会。' },
    { decision: 'violation', issue: 'premature_acceptance', evidence: '没问题安排一次技术交流会。' },
  ) });
  assert.equal(fallback.source, 'fallback');
  assert.equal(attempts, 2);
  assert.equal(fallback.reply, safeAmbiguousCustomerActivityReply('高层'));
  assert.equal(fallback.reply, '这个建议我先记下了，会结合项目情况考虑，必要时和公司内部商量，再给您反馈。');

  attempts = 0;
  const uncertainReview = await generateNpcReplyWithCustomerActivityGuard(highLevelNpc, 'email', async () => {
    attempts += 1;
    return '方便不方便还得我再看看，等我内部商量后给您回复。';
  }, { context: reviewContext, invoker: async () => { throw new Error('mock reviewer unavailable'); } });
  assert.equal(uncertainReview.source, 'fallback', 'review failure uses a neutral role-safe response');
  assert.equal(attempts, 1, 'review failure does not trigger an ungrounded rewrite');

  const midLevelNpc = { id: 'P1-002', name: '李明辉', title: '项目经理', category: '中层' as const };
  assert.equal(safeAmbiguousCustomerActivityReply(midLevelNpc.category), '这个建议我先记下了，会先向上级汇报，再给您反馈。');
  assert.match(safeAmbiguousCustomerActivityReply(midLevelNpc.category, true), /本人|我先记下了/u);
  assert.equal(hasCustomerActivityDisposition('我先考虑一下，稍后再给您答复。', '中层', true), true);
}

void testActivityReplyGuard().then(() => {
  console.log('invitation intent and activity reply guard tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
