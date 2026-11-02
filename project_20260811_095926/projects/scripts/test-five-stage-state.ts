import assert from 'node:assert/strict';
import { gameCommandSchema } from '../src/lib/contracts/game';
import {
  applyNpcEvaluation,
  applyPreparationAttachments,
  advanceRound,
  connectNpc,
  createProjectOneState,
  executeGameCommand,
  extractPreparationBrief,
  hasReliablePreparationSemantics,
  isCurrentPreparationType,
  normalizeProjectOneState,
  toPlayerVisibleGameState,
} from '../src/lib/game/state';
import {
  assertMultiplayerRoomRunning,
} from '../src/lib/game/multiplayer';

let state = createProjectOneState();
assert.equal(state.currentStage, 1);
assert.equal(state.maxStages, 1, 'new games no longer have stage progression');
assert.equal(state.dayAvailableMinutes, 0);
assert.equal(state.projectTimer.durationMs, 20 * 60 * 1000);

const command = (
  type: Parameters<typeof executeGameCommand>[1]['type'],
  payload: Record<string, unknown>,
  id: string,
  options: Parameters<typeof executeGameCommand>[2] = {},
) => {
  const result = executeGameCommand(state, { commandId: id, expectedVersion: state.version, type, payload } as Parameters<typeof executeGameCommand>[1], options);
  state = result.state;
  return result;
};

const firstResearch = command('research_public_info', { npcId: 'P1-004' }, 'research-1');
assert.equal(firstResearch.result.publicResearch && typeof firstResearch.result.publicResearch, 'object');
assert.equal(state.actionPoints, 26);
assert.equal(state.publicResearch['P1-004']?.facts.length, 3, 'completed public search persists for player recovery');
const visibleResearch = toPlayerVisibleGameState(state).publicResearch;
assert.equal(visibleResearch['P1-004']?.weakSignals.length, 1, 'the public snapshot retains only obtained research');
assert.equal(visibleResearch['P1-001'], undefined, 'unsearched NPC profiles are not synthesized into the player snapshot');
assert.equal('timeMinutes' in firstResearch.eventPayload, false, 'public search events use action points, not time metrics');
assert.equal(firstResearch.eventPayload.costPoints, 2);
command('research_public_info', { npcId: 'P1-004' }, 'research-2');
assert.equal(state.actionPoints, 24, 'repeat search charges action points again');

const phone = command('contact', { npcId: 'P1-004', channel: 'work_phone', content: '您好，想沟通项目。' }, 'phone-1');
assert.ok(['connected', 'unanswered', 'declined', 'call_later'].includes(String(phone.result.outcome)));
assert.equal(state.actionPoints, 23, 'failed or successful phone attempt has the same point cost');

command('prepare', {
  npcId: 'P1-004',
  preparationType: 'visit_preparation',
  title: '拜访前准备',
  content: '目标人物：赵晓晨；客户问题：一线重复录入与跨部门确认成本；方案维度：流程和交付；证据：同类案例和可验证的交付记录；下一步：确认技术交流和责任人。',
}, 'prepare-1', { visitPreparationEvaluation: { needsDetail: false, strengths: ['目标明确'], risks: [], nextStep: '确认责任人' } });
assert.equal(state.preparations.at(-1)?.type, 'visit_preparation');
assert.equal(state.preparations.at(-1)?.timeMinutes, 0);
assert.ok(state.preparations.at(-1)?.brief);
assert.equal(state.preparations.at(-1)?.brief?.audience.includes('赵晓晨'), true);
assert.equal(state.preparations.at(-1)?.brief?.problem.includes('重复录入'), true);
assert.equal(state.preparations.at(-1)?.brief?.dimensions.includes('流程'), true);
assert.equal(state.preparations.at(-1)?.brief?.evidence.includes('案例'), true);
assert.equal(state.preparations.at(-1)?.brief?.nextStep.includes('技术交流'), true);
assert.deepEqual(new Set(state.preparations.at(-1)?.brief?.semanticTags), new Set([
  'target_person',
  'customer_problem',
  'solution_or_dimension',
  'evidence',
  'next_step',
]));
assert.equal(hasReliablePreparationSemantics(state.preparations.at(-1)?.brief ?? extractPreparationBrief('', 'P1-004')), true);
assert.throws(
  () => command('prepare', {
    npcId: 'P1-004',
    preparationType: 'visit_preparation',
    content: '随便写一点拜访内容，没有具体标签。',
  }, 'prepare-invalid', { visitPreparationEvaluation: { needsDetail: true, strengths: [], risks: ['缺少具体目标'], nextStep: '补充信息' } }),
  /PREPARATION_NEEDS_DETAIL/,
  'server assessment rejects an insufficient visit preparation before it becomes usable',
);
const preparationId = state.preparations.at(-1)?.id;
assert.ok(preparationId);
const attached = applyPreparationAttachments(state, 'P1-004', [preparationId]);
assert.equal(attached.preparations.at(-1)?.usedCount, 1, 'email attachment increments preparation usage');
assert.equal(attached.preparations.at(-1)?.status, 'ready', 'reusable preparation remains ready after email delivery');
assert.equal(state.preparations.at(-1)?.usedCount, 0, 'attachment application is pure');
assert.throws(
  () => applyPreparationAttachments(state, 'P1-004', ['missing-preparation']),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'unknown preparation cannot be attached',
);
assert.throws(
  () => applyPreparationAttachments(state, 'P1-003', [preparationId]),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'another NPC preparation cannot be attached',
);

const legacyState = normalizeProjectOneState({
  ...createProjectOneState(),
  publicResearch: {
    'P1-004': {
      npcId: 'P1-004',
      facts: ['旧资料'],
      weakSignals: [],
      sourceNote: '旧存档',
      completedRound: 1,
      completedMinute: 540,
      costPoints: 2,
    },
  },
  preparations: [
    {
      id: 'legacy-material',
      npcId: 'P1-004',
      appointmentId: null,
      type: 'materials',
      title: '历史项目材料',
      content: '旧版材料记录',
      status: 'ready',
      costPoints: 2,
      timeMinutes: 0,
      reusable: true,
      usedCount: 0,
      createdRound: 1,
    },
    {
      id: 'legacy-gift',
      npcId: 'P1-004',
      appointmentId: null,
      type: 'courtesy_gift',
      title: '历史礼品',
      content: '旧版礼品记录',
      status: 'ready',
      costPoints: 3,
      timeMinutes: 0,
      reusable: false,
      usedCount: 0,
      createdRound: 1,
    },
  ],
});
assert.equal(legacyState.publicResearch['P1-004']?.facts.length, 1, 'completed legacy public research is restored for recovery');
assert.equal(legacyState.preparations.length, 2, 'legacy preparation rows remain readable for archive compatibility');
assert.equal(isCurrentPreparationType('visit_preparation'), true);
assert.equal(isCurrentPreparationType('materials'), false);
assert.throws(
  () => applyPreparationAttachments(legacyState, 'P1-004', ['legacy-material']),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'legacy materials cannot become ordinary email attachments',
);
assert.throws(
  () => applyPreparationAttachments(legacyState, 'P1-004', ['legacy-gift']),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'legacy gifts cannot become ordinary email attachments',
);
const nonEmailInviteState = connectNpc(createProjectOneState(), 'P1-004');
for (const channel of ['email', 'work_phone', 'wechat'] as const) {
  const naturalLanguageInvite = gameCommandSchema.parse({
    commandId: `invite-channel-${channel}`,
    expectedVersion: 1,
    type: 'invite',
    payload: {
      npcId: 'P1-004',
      channel,
      rawText: '希望围绕当前客户问题和交付案例安排一次正式沟通。',
    },
  });
  assert.equal(naturalLanguageInvite.type, 'invite');
  assert.equal(naturalLanguageInvite.payload.channel, channel, `${channel} remains a natural-language invitation channel`);
}
assert.throws(
  () => gameCommandSchema.parse({
    commandId: 'legacy-online-request',
    expectedVersion: 1,
    type: 'request_online',
    payload: { npcId: 'P1-004', message: '旧式线上申请路径不应再存在。' },
  }),
  'legacy request_online must not be accepted as an independent invitation/contact command',
);
assert.throws(
  () => executeGameCommand(nonEmailInviteState, gameCommandSchema.parse({
    commandId: 'phone-attachment',
    expectedVersion: nonEmailInviteState.version,
    type: 'invite',
    payload: {
      npcId: 'P1-004',
      channel: 'work_phone',
      rawText: '想当面沟通方案。',
      attachmentIds: ['legacy-material'],
    },
  })),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'attachments are only accepted on ordinary email invitations',
);
assert.throws(
  () => executeGameCommand(nonEmailInviteState, gameCommandSchema.parse({
    commandId: 'phone-described-attachment',
    expectedVersion: nonEmailInviteState.version,
    type: 'invite',
    payload: {
      npcId: 'P1-004',
      channel: 'work_phone',
      rawText: '想当面沟通方案。',
      emailAttachments: [{ fileName: '方案.pdf', description: '包含实施计划和验收口径。' }],
    },
  })),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'natural-language file descriptions are email-only on invitations',
);
const describedEmailInvite = executeGameCommand(nonEmailInviteState, gameCommandSchema.parse({
  commandId: 'email-described-attachment',
  expectedVersion: nonEmailInviteState.version,
  type: 'invite',
  payload: {
    npcId: 'P1-004',
    channel: 'email',
    rawText: '想当面沟通方案，请查收附件。',
    emailAttachments: [{ fileName: '方案.pdf', description: '包含实施计划和验收口径。' }],
  },
}));
assert.deepEqual(describedEmailInvite.state.appointments[0]?.emailAttachments, [
  { fileName: '方案.pdf', description: '包含实施计划和验收口径。' },
]);

const wechatPayload = gameCommandSchema.parse({
  commandId: 'wechat-contract-1',
  expectedVersion: 1,
  type: 'request_wechat',
  payload: { npcId: 'P1-004', message: '申请添加工作微信，方便后续沟通。' },
});
assert.equal(wechatPayload.type, 'request_wechat', 'wechat application uses the unified command contract');
const connectedWechatState = connectNpc(createProjectOneState(), 'P1-004');
let acceptedWechatResult: ReturnType<typeof executeGameCommand> | null = null;
for (let index = 0; index < 200 && !acceptedWechatResult; index += 1) {
  const candidate = executeGameCommand(connectedWechatState, {
    commandId: `wechat-state-${index}`,
    expectedVersion: connectedWechatState.version,
    type: 'request_wechat',
    payload: { npcId: 'P1-004', message: '申请添加工作微信，方便后续沟通。' },
  });
  if (candidate.result.status === 'accepted') acceptedWechatResult = candidate;
}
assert.ok(acceptedWechatResult, 'the unified wechat command can produce an accepted request');
assert.equal(acceptedWechatResult?.state.npcContacts['P1-004'].status, 'online');
assert.equal(acceptedWechatResult?.state.npcContacts['P1-004'].wechatStatus, 'accepted');
assert.equal(acceptedWechatResult?.state.actionPoints, connectedWechatState.actionPoints - 1, 'wechat request charges one action point once');
assert.equal(acceptedWechatResult?.state.npcContacts['P1-004'].onlineRequestedRound, 1);

const beforeCommand = state.actionPoints;
assert.equal(state.currentStage, 1, 'ordinary commands do not advance historical round aliases');
assert.equal(state.currentRound, 1);
assert.equal(state.actionPoints, beforeCommand, 'ordinary commands do not grant stage-based action points');
const visibleState = toPlayerVisibleGameState({ ...state, competitorClaims: [{ id: 'claim-1', npcId: 'P1-004', stage: 1, statement: '内部竞品主张', truthStatus: 'unverified' }] });
assert.deepEqual(visibleState.competitorClaims, [{ id: 'claim-1', npcId: 'P1-004', stage: 1, statement: '内部竞品主张', truthStatus: 'unverified' }], 'player state exposes only NPC statements already heard');
assert.equal(visibleState.competitorState.actions.length, 0, 'player state does not expose competitor actions');
assert.throws(() => advanceRound(state), /PHASE_CONTROLS_REMOVED/);
assert.equal(gameCommandSchema.safeParse({
  commandId: 'removed-phase-contract', expectedVersion: state.version, type: 'advance_phase', payload: {},
}).success, false, 'new clients cannot submit a stage advancement command');

// DATA-001 regression: an unverified competitor claim is evidence to review,
// not a command that can rewrite the server-authoritative ABC state. A long
// or persuasive lie remains unverified and leaves the hidden progress intact.
const claimState = createProjectOneState();
const competitorStateBeforeClaim = structuredClone(claimState.competitorState);
const unverifiedClaimEvaluation = {
  affinityDelta: 0,
  affinityReason: '仅记录待核验说法',
  pleasureDelta: 0,
  supportDelta: 0,
  dimensionDeltas: {
    decisionAnalysis: 0,
    relationshipBuilding: 0,
    valuePresentation: 0,
    objectionHandling: 0,
    informationDiscovery: 0,
  },
  cluesUnlocked: [],
  confirmedFacts: [],
  commitments: [],
  publicValueEvidence: [],
  personalBenefitEvidence: [],
  workTopicOpenedBy: 'none' as const,
  semanticFlags: {
    negativeInformation: false,
    negativeInformationType: 'none' as const,
    riskyConduct: false,
    giftMentioned: false,
    explicitQuidProQuo: false,
    repeatedPressure: false,
  },
  giftAssessment: {
    giftType: 'none' as const,
    outcome: 'not_applicable' as const,
    riskLevel: 'none' as const,
    riskReason: '本轮未涉及礼品',
  },
  handoff: null,
  emotion: 'thinking' as const,
} satisfies Parameters<typeof applyNpcEvaluation>[2];
const afterLiedClaim = applyNpcEvaluation(
  claimState,
  'P1-004',
  unverifiedClaimEvaluation,
  '据说ABC竞品已经拿到内部确定性支持，但这条消息尚未核实。',
);
assert.deepEqual(afterLiedClaim.competitorState, competitorStateBeforeClaim,
  'an NPC claim cannot mutate the backend competitor progress or actions');
assert.equal(afterLiedClaim.competitorClaims.at(-1)?.truthStatus, 'unverified',
  'competitor claims remain explicitly unverified until corroborated');

assert.throws(() => assertMultiplayerRoomRunning('multiplayer', 'waiting'), /MULTIPLAYER_ROOM_NOT_RUNNING/, 'multiplayer writes are blocked before room start');
assert.throws(() => assertMultiplayerRoomRunning('multiplayer', 'finished'), /MULTIPLAYER_ROOM_NOT_RUNNING/, 'multiplayer writes are blocked after room end');
assert.doesNotThrow(() => assertMultiplayerRoomRunning('multiplayer', 'running'));
assert.doesNotThrow(() => assertMultiplayerRoomRunning('solo', 'waiting'));

console.log('timer-based game state tests passed');
