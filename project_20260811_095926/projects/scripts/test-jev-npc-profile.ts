import assert from 'node:assert/strict';
import { evaluateGiftDecision, evaluateNpcTurn } from '../src/lib/ai/npc-evaluation';
import { buildJevCandidateNpcProfiles, buildJevCandidateNpcSummaries, buildJevNpcProfile } from '../src/lib/ai/jev-npc-profile';
import { createPreviewAiService } from '../src/lib/game/project-one-preview-ai';
import { createPromptTestService } from '../src/lib/ai/prompt-test';
import { serializeUntrustedPromptData } from '../src/lib/ai/prompt-data';
import type { JevInvoker, JevRequest } from '../src/lib/ai/jev-client';

function untrustedJson(state: unknown): Record<string, unknown> {
  if (typeof state !== 'string') throw new Error('preview Jev state must be serialized text');
  const match = state.match(/^<untrusted_data[^>]*>\n([\s\S]*?)\n<\/untrusted_data>/);
  assert.ok(match, 'preview Jev state retains a complete untrusted JSON envelope');
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function choiceResponse(request: JevRequest) {
  return {
    answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      if (question.type === 'noul') {
        const noul = id.startsWith('match_') && id === 'match_P1-003' ? 1 : 0;
        return [id, { type: 'noul' as const, noul, confidence: 1 }];
      }
      const criteria = question.criteria ?? { true: '是', false: '否' };
      const choice = id === 'responseAction' ? 'reply'
        : id === 'invitationStatus' ? 'none'
          : id.startsWith('blocker:') ? 'none'
            : Object.keys(criteria)[0]!;
      return [id, { type: 'choice' as const, choice, probabilities: { [choice]: 1 }, confidence: 1 }];
    })),
  };
}

async function main() {
  const leader = buildJevNpcProfile('P1-001')!;
  const frontline = buildJevNpcProfile('P1-005')!;
  assert.notEqual(leader.personalityType, frontline.personalityType, 'P1-001 and P1-005 have materially different personality profiles');
  assert.notDeepEqual(leader.coreNeeds, frontline.coreNeeds, 'P1-001 and P1-005 retain distinct needs');
  assert.ok(leader.informationBoundary.length > 0 && frontline.taboos.length > 0);
  assert.equal(buildJevNpcProfile('unknown'), undefined, 'an unknown ID never falls through to another NPC');
  assert.equal(buildJevCandidateNpcProfiles().length, 5);
  assert.deepEqual(Object.keys(buildJevCandidateNpcSummaries()[0]!), ['id', 'name', 'title', 'category', 'personalityType', 'coreNeeds', 'contactPath']);

  const planEnvelope = serializeUntrustedPromptData('project_one_preview_plan', {
    plan: '确认流程并准备材料。',
    candidateNpcProfiles: buildJevCandidateNpcSummaries(),
  }, { maxStringLength: 2_000, maxTotalLength: 30_000 });
  const planState = untrustedJson(planEnvelope);
  assert.equal((planState.candidateNpcProfiles as unknown[]).length, 5, 'five compact candidate profiles fit without truncating Jev state JSON');

  const formalRequests: JevRequest[] = [];
  const captureInvalidJev: JevInvoker = async (request) => {
    formalRequests.push(request);
    return { answers: {} };
  };
  await evaluateNpcTurn({
    npcId: 'P1-001', npcName: '张建国', npcTitle: '主管副总经理', npcCategory: '高层', npcPersonality: '强势', npcConcern: '稳定性',
    affinity: 20, round: 1, playerMessage: '请先看一页风险边界。', npcReply: '请交给相关部门核验。', recentConversation: [], confirmedFacts: [], commitments: [],
  }, '', { jevInvoker: captureInvalidJev });
  await evaluateGiftDecision({
    commandId: 'gift-profile-check', npcId: 'P1-003', npcName: '王德福', npcTitle: '招采办主任', npcCategory: '采购', npcPersonality: '重视流程', npcConcern: '合规',
    complianceSensitivity: 80, giftPreference: 0, pleasure: 50, support: 40, attitudeHistory: [], giftType: 'compliant', giftDescription: '公开商务笔记本', setting: 'public', witnesses: ['同事'], priorBoundaryGiftCount: 0, round: 1, phaseName: '信息摸底', meetingType: 'formal', venue: '会议室', procurementSensitive: true, exchangeRequested: false,
  }, { jevInvoker: captureInvalidJev });
  const [turnRequest, giftRequest] = formalRequests;
  assert.equal((turnRequest.state as Record<string, unknown>).npcProfile && ((turnRequest.state as Record<string, unknown>).npcProfile as { id: string }).id, 'P1-001');
  assert.equal((giftRequest.state as Record<string, unknown>).npcProfile && ((giftRequest.state as Record<string, unknown>).npcProfile as { id: string }).id, 'P1-003');
  assert.deepEqual(Object.keys(turnRequest.questions), ['pleasureDelta', 'supportDelta', 'decisionAnalysis', 'relationshipBuilding', 'valuePresentation', 'objectionHandling', 'informationDiscovery', 'clue', 'workTopicOpenedBy', 'negativeInformation', 'negativeInformationType', 'riskyConduct', 'giftMentioned', 'explicitQuidProQuo', 'repeatedPressure', 'giftType', 'giftOutcome', 'giftRiskLevel', 'handoffTarget', 'emotion']);
  assert.deepEqual(Object.keys(giftRequest.questions), ['disposition', 'pleasureDelta', 'supportDelta']);

  const unknownRequests: JevRequest[] = [];
  await evaluateNpcTurn({
    npcId: 'unknown-npc', npcName: '未知人物', npcTitle: '未知', affinity: 20, round: 1, playerMessage: '测试', npcReply: '测试', recentConversation: [], confirmedFacts: [], commitments: [],
  }, '', { jevInvoker: async (request) => { unknownRequests.push(request); return { answers: {} }; } });
  assert.equal(Object.hasOwn(unknownRequests[0]!.state as object, 'npcProfile'), false, 'unknown formal NPC IDs omit the profile instead of serializing undefined or another profile');

  const previewRequests: JevRequest[] = [];
  const preview = createPreviewAiService({
    invoker: async (messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('工作计划建议撰写器')) return JSON.stringify({ recommendations: ['先确认职责和证据。'] });
      if (prompt.includes('判断是否查看已收到的附件已由 Jev 完成')) return JSON.stringify({ impact: '材料可作为后续核验依据。' });
      if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return JSON.stringify({ memorySuggestions: [] });
      if (prompt.includes('本次拜访准备的优点')) return JSON.stringify({ strengths: ['对象明确'], risks: [], nextStep: '按预约继续。' });
      return JSON.stringify({ content: '请先按职责范围补充可核验信息。' });
    },
    jevInvoker: async (request) => { previewRequests.push(request); return choiceResponse(request); },
  });
  const planResponse = await preview.execute('profile-user', { action: 'plan', text: '请王主任确认采购流程并准备可追溯材料。', commandId: 'profile-plan-command'.padEnd(24, 'x'), expectedVersion: 0 });
  const previewPlan = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_plan'))!;
  const previewPlanState = untrustedJson(previewPlan.state);
  assert.equal((previewPlanState.candidateNpcProfiles as unknown[]).length, 5);
  assert.equal(((previewPlanState.candidateNpcProfiles as Array<{ id: string }>)[2]).id, 'P1-003');
  assert.deepEqual(Object.keys(previewPlan.questions), ['needsDetail', 'match_P1-001', 'match_P1-002', 'match_P1-003', 'match_P1-004', 'match_P1-005']);

  const message = await preview.execute('profile-user', {
    action: 'message', npcId: 'P1-003', channel: 'email', text: '附件列明了采购流程与可追溯材料。', attachment: { title: '采购材料清单', content: '仅用于测试。' },
    commandId: 'profile-message-command'.padEnd(24, 'x'), expectedVersion: planResponse.version, previewSessionId: planResponse.previewSessionId,
  });
  const attachmentRequest = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_attachment'))!;
  const messageRequest = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_message'))!;
  for (const request of [attachmentRequest, messageRequest]) {
    assert.equal((untrustedJson(request.state).npcProfile as { id: string }).id, 'P1-003');
  }
  assert.deepEqual(Object.keys(attachmentRequest.questions), ['viewed']);
  assert.equal(attachmentRequest.questions.viewed?.type, 'noul');
  assert.deepEqual(Object.keys(messageRequest.questions), ['responseAction', 'invitationStatus']);
  assert.equal(messageRequest.questions.responseAction?.type, 'choice');

  const wechat = await preview.execute('profile-user', {
    action: 'wechat_request', npcId: 'P1-004', text: '希望申请工作微信，便于按任务同步材料。',
    commandId: 'profile-wechat-command'.padEnd(24, 'x'), expectedVersion: message.version, previewSessionId: message.previewSessionId,
  });
  const wechatRequest = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_wechat_request'))!;
  assert.equal((untrustedJson(wechatRequest.state).npcProfile as { id: string }).id, 'P1-004');
  assert.deepEqual(Object.keys(wechatRequest.questions), ['accepted']);
  assert.equal(wechatRequest.questions.accepted?.type, 'noul');

  const preparation = await preview.execute('profile-user', {
    action: 'visit_preparation', npcId: 'P1-002', text: '带着需求清单、验证范围和里程碑，确认李经理关心的技术风险。',
    commandId: 'profile-preparation-command'.padEnd(24, 'x'), expectedVersion: wechat.version, previewSessionId: wechat.previewSessionId,
  });
  const preparationRequest = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_visit_preparation'))!;
  assert.equal((untrustedJson(preparationRequest.state).npcProfile as { id: string }).id, 'P1-002');
  const visitStarted = await preview.execute('profile-user', {
    action: 'start_visit', npcId: 'P1-002',
    commandId: 'profile-start-visit-command'.padEnd(24, 'x'), expectedVersion: preparation.version, previewSessionId: preparation.previewSessionId,
  });
  await preview.execute('profile-user', {
    action: 'visit_turn', npcId: 'P1-002', text: '请先确认这次技术验证的边界和责任人。',
    commandId: 'profile-visit-turn-command'.padEnd(24, 'x'), expectedVersion: visitStarted.version, previewSessionId: visitStarted.previewSessionId,
  });
  const visitRequest = previewRequests.find((request) => typeof request.state === 'string' && request.state.includes('project_one_preview_visit_turn'))!;
  assert.equal((untrustedJson(visitRequest.state).npcProfile as { id: string }).id, 'P1-002');
  assert.deepEqual(Object.keys(visitRequest.questions), ['completedTask', 'playerDialogueSignal', 'npcDialogueSignal']);
  assert.equal(visitRequest.questions.completedTask?.type, 'choice');

  const promptTestRequests: JevRequest[] = [];
  const promptTest = createPromptTestService({
    invoker: async (_messages, options) => options.temperature === 0.7
      ? JSON.stringify({ content: '我先按职责范围核验后再答复。' })
      : JSON.stringify({ summary: '本轮暂未形成新的状态结论。', newClues: [] }),
    jevInvoker: async (request) => { promptTestRequests.push(request); return choiceResponse(request); },
  });
  await promptTest.execute('profile-user', {
    action: 'run', provider: 'deepseek', npcId: 'P1-001', visitMode: 'in_person', text: '请确认项目风险边界。', commandId: 'profile-prompt-test-command', expectedVersion: 0,
  });
  const promptTestState = JSON.parse(promptTestRequests[0]!.state as string) as { npcProfile?: { id?: string } };
  assert.equal(promptTestState.npcProfile?.id, 'P1-001', 'fixed prompt-test evaluator receives Zhang Jianguo\'s same profile');
}

main().then(() => console.log('Jev NPC profile tests passed.')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
