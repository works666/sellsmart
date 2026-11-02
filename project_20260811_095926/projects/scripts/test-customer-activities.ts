import assert from 'node:assert/strict';
import {
  CUSTOMER_ACTIVITY_PLANNING_MS,
  CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
  HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD,
  createResolvedCustomerActivityAgreement,
  createCustomerActivityTasks,
  createEmptyCustomerActivityState,
  DEFAULT_ACTIVITY_DECISION_CONFIG,
  RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS,
  customerActivityRelationshipSnapshotSchema,
  decideOrganizationActivityThreshold,
  finishCustomerActivityPlanningOnRoomEnd,
  finalizeExpiredCustomerActivities,
  isCustomerActivityState,
  parseActivityDecisionConfig,
  parseCustomerActivityState,
  readCustomerActivityState,
  recordCustomerActivityProposalDecision,
  recordCustomerActivityEvaluation,
  saveCustomerActivityDraft,
  startCustomerActivityPlanning,
  submitCustomerActivityPlan,
  toPublicCustomerActivityTask,
  type ActivityDecisionConfig,
  type CustomerActivityAgreement,
  type CustomerActivityEvaluation,
  type CustomerActivityProposalCandidate,
  type CustomerActivityRelationshipSnapshot,
} from '@/lib/game/customer-activities';
import {
  CustomerActivityDetectionError,
  CustomerActivityDecisionError,
  detectAgreedCustomerActivities,
  detectCustomerActivityProposals,
  decideCustomerActivityFeasibility,
  evaluateCustomerActivityPlan,
  type CustomerActivityInvoker,
} from '@/lib/ai/customer-activities';
import {
  generateNpcReplyWithCustomerActivityGuard,
  hasCustomerActivityDisposition,
  hasCustomerActivityComplianceRefusal,
  hasCustomerActivityRefusal,
} from '@/lib/ai/customer-activity-reply';

const sourceConversation = [
  { messageId: 'm1', speaker: 'sales' as const, text: '我们可以安排一次技术交流会，重点讲接口适配。' },
  { messageId: 'm2', speaker: 'customer' as const, text: '可以，安排技术团队参加。' },
];

const agreement: CustomerActivityAgreement = {
  conversationId: 'meeting-1',
  npcId: 'P1-002',
  sourceConversation,
  type: 'technical_meeting',
  proposalMessageId: 'm1',
  agreementMessageId: 'm2',
  evidence: [
    { messageId: 'm1', speaker: 'sales', kind: 'proposal', quote: '安排一次技术交流会' },
    { messageId: 'm2', speaker: 'customer', kind: 'acceptance', quote: '可以，安排技术团队参加。' },
    { messageId: 'm2', speaker: 'customer', kind: 'final_outcome', quote: '可以，安排技术团队参加。' },
  ],
  summary: '可以，安排技术团队参加。',
};

function makeAgreement(
  conversationId: string,
  type: CustomerActivityAgreement['type'],
  proposal: { messageId: string; speaker: 'sales' | 'customer'; text: string; quote: string },
  acceptance: { messageId: string; speaker: 'sales' | 'customer'; text: string; quote: string },
): CustomerActivityAgreement {
  return {
    conversationId,
    npcId: 'P1-002',
    sourceConversation: [
      { messageId: proposal.messageId, speaker: proposal.speaker, text: proposal.text },
      { messageId: acceptance.messageId, speaker: acceptance.speaker, text: acceptance.text },
    ],
    type,
    proposalMessageId: proposal.messageId,
    agreementMessageId: acceptance.messageId,
    evidence: [
      { messageId: proposal.messageId, speaker: proposal.speaker, kind: 'proposal', quote: proposal.quote },
      { messageId: acceptance.messageId, speaker: acceptance.speaker, kind: 'acceptance', quote: acceptance.quote },
      { messageId: acceptance.messageId, speaker: acceptance.speaker, kind: 'final_outcome', quote: acceptance.quote },
    ],
    summary: acceptance.quote,
  };
}

const evaluation: CustomerActivityEvaluation = {
  supportDelta: 2,
  pleasureDelta: 1,
  dimensionDeltas: {
    decisionAnalysis: 1,
    relationshipBuilding: 0,
    valuePresentation: 2,
    objectionHandling: 0,
    informationDiscovery: 1,
  },
  overallEvaluation: '客户对交流安排更有信心，愿意继续推进。',
};

function taskFrom(state: ReturnType<typeof createEmptyCustomerActivityState>) {
  assert.equal(state.tasks.length, 1);
  return state.tasks[0];
}

function proposalReviewInvoker(
  review: {
    proposalMessageId: string;
    type: CustomerActivityProposalCandidate['type'];
    classification: 'active' | 'not_proposed' | 'withdrawn' | 'unclear';
    proposalEvidence: { messageId: string; quote: string };
    withdrawalEvidence?: { messageId: string; quote: string };
  },
): CustomerActivityInvoker {
  return async (messages) => messages[0]?.content.includes('语义复核器')
    ? JSON.stringify({ reviews: [review] })
    : JSON.stringify({ activities: [] });
}

async function main() {
  assert.deepEqual(readCustomerActivityState(undefined), createEmptyCustomerActivityState());
  assert.throws(() => readCustomerActivityState({ version: 1, tasks: [{ id: 'corrupt' }] }), /INVALID_CUSTOMER_ACTIVITY_STATE/);
  assert.equal(isCustomerActivityState(createEmptyCustomerActivityState()), true);

  const created = createCustomerActivityTasks(createEmptyCustomerActivityState(), [agreement, agreement], 1_000);
  assert.equal(created.tasks.length, 1, 'duplicate detections in one ended conversation create one task');
  const sameAcceptanceDifferentConversation = {
    ...agreement,
    conversationId: 'late-rescan-conversation-id',
  };
  const deduped = createCustomerActivityTasks(created, [sameAcceptanceDifferentConversation], 2_000);
  assert.equal(deduped.tasks.length, 1, 'stable NPC/type/acceptance message dedupes across channel rescans');
  const sameProposalDifferentAcceptance = makeAgreement(
    'rescanned-email-thread',
    'technical_meeting',
    { messageId: 'm1', speaker: 'sales', text: sourceConversation[0].text, quote: '安排一次技术交流会' },
    { messageId: 'm3', speaker: 'customer', text: '好，就按这个安排。', quote: '好，就按这个安排。' },
  );
  assert.equal(createCustomerActivityTasks(created, [sameProposalDifferentAcceptance], 2_000).tasks.length, 1,
    'the same proposal cannot create a second task when a rescan cites another acceptance message');
  const restored = parseCustomerActivityState(JSON.parse(JSON.stringify(created)));
  assert.equal(restored.tasks[0].id, created.tasks[0].id, 'persisted JSON restores the same task ID');

  const task = taskFrom(created);
  const started = startCustomerActivityPlanning(created, task.id, 10_000);
  assert.equal(started.tasks[0].status, 'planning');
  assert.equal(started.tasks[0].deadlineAt, 10_000 + CUSTOMER_ACTIVITY_PLANNING_MS);
  const repeatedStart = startCustomerActivityPlanning(started, task.id, 50_000);
  assert.equal(repeatedStart.tasks[0].deadlineAt, started.tasks[0].deadlineAt, 'start retries cannot extend the timer');
  assert.deepEqual(startCustomerActivityPlanning(started, 'unknown', 50_000), started, 'another task cannot start while one is planning');

  const saved = saveCustomerActivityDraft(started, task.id, '准备接口适配议题，并邀请技术负责人参加。', 20_000);
  assert.equal(saved.accepted, true);
  const lateSave = saveCustomerActivityDraft(saved.state, task.id, '迟到的新草稿不能覆盖服务端已保存内容', 310_000);
  assert.equal(lateSave.accepted, false);
  assert.equal(lateSave.state.tasks[0].status, 'submitted');
  assert.equal(lateSave.state.tasks[0].draft, '准备接口适配议题，并邀请技术负责人参加。');
  assert.equal(lateSave.state.tasks[0].submittedAt, started.tasks[0].deadlineAt, 'timeout records the actual deadline');
  assert.equal(lateSave.state.tasks[0].submitReason, 'timeout');
  assert.deepEqual(finalizeExpiredCustomerActivities(lateSave.state, 400_000), lateSave.state, 'timeout finalization is idempotent');

  const recorded = recordCustomerActivityEvaluation(lateSave.state, task.id, evaluation, 311_000);
  assert.equal(recorded.applied, true);
  assert.deepEqual(recordCustomerActivityEvaluation(recorded.state, task.id, evaluation, 312_000), {
    state: recorded.state,
    applied: false,
  }, 'settlement marker prevents duplicate metric application');
  const publicTask = toPublicCustomerActivityTask(recorded.state.tasks[0]);
  assert.deepEqual(publicTask.basis, ['安排一次技术交流会', '可以，安排技术团队参加。']);
  assert.deepEqual(publicTask.evaluation, { overallEvaluation: '本次方案有助于推进后续活动沟通。' });
  assert.equal('evidence' in publicTask, false);
  assert.equal('sourceConversation' in publicTask, false);
  assert.equal('supportDelta' in (publicTask.evaluation ?? {}), false);
  const legacyCommentaryTask = toPublicCustomerActivityTask({
    ...recorded.state.tasks[0],
    evaluation: {
      ...evaluation,
      overallEvaluation: '客户支持度增加2分，愉悦度提升1分；建议补充会后跟进安排。',
    },
  });
  assert.equal(legacyCommentaryTask.evaluation?.overallEvaluation, '本次方案有助于推进后续活动沟通。',
    'legacy stored commentary and numeric values are replaced by a safe outcome in the public projection');
  assert.doesNotMatch(legacyCommentaryTask.evaluation?.overallEvaluation ?? '', /\d|支持度|愉悦度|建议/u);

  const caseAgreement = makeAgreement(
    'visit-and-cases', 'case_site_visit',
    { messageId: 'c1', speaker: 'customer', text: '能安排去看一下之前的项目现场吗？', quote: '安排去看一下之前的项目现场' },
    { messageId: 'c2', speaker: 'sales', text: '可以，我来协调案例现场参观。', quote: '可以，我来协调案例现场参观。' },
  );
  const companyAgreement = makeAgreement(
    'visit-and-cases', 'company_visit',
    { messageId: 'o1', speaker: 'sales', text: '欢迎您来我们公司参观。', quote: '来我们公司参观' },
    { messageId: 'o2', speaker: 'customer', text: '好，我安排时间过去。', quote: '好，我安排时间过去。' },
  );
  const queued = createCustomerActivityTasks(created, [caseAgreement, companyAgreement], 2_000);
  assert.deepEqual(queued.tasks.map(({ type }) => type), ['technical_meeting', 'case_site_visit', 'company_visit']);
  const firstQueueItem = queued.tasks[0];
  const secondQueueItem = queued.tasks[1];
  assert.deepEqual(startCustomerActivityPlanning(queued, secondQueueItem.id, 3_000), queued,
    'the second queued activity cannot start ahead of the first');
  const firstQueueStarted = startCustomerActivityPlanning(queued, firstQueueItem.id, 3_000);
  assert.deepEqual(startCustomerActivityPlanning(firstQueueStarted, secondQueueItem.id, 4_000), firstQueueStarted,
    'the second activity cannot start while the first timer is active');
  const firstQueueExpired = finalizeExpiredCustomerActivities(firstQueueStarted, firstQueueStarted.tasks[0].deadlineAt!);
  const secondQueueStarted = startCustomerActivityPlanning(firstQueueExpired, secondQueueItem.id, 900_000);
  assert.equal(secondQueueStarted.tasks[1].status, 'planning');
  assert.equal(secondQueueStarted.tasks[1].startedAt, 900_000, 'the next item starts a separate timer when activated');
  assert.equal(secondQueueStarted.tasks[1].deadlineAt, 900_000 + CUSTOMER_ACTIVITY_PLANNING_MS);
  assert.deepEqual(startCustomerActivityPlanning(secondQueueStarted, queued.tasks[2].id, 900_001), secondQueueStarted,
    'the third activity waits for the second timer');

  const manualStarted = startCustomerActivityPlanning(created, task.id, 1_000_000);
  const manualSubmitted = submitCustomerActivityPlan(manualStarted, task.id, 1_001_000);
  assert.equal(manualSubmitted.tasks[0].submitReason, 'manual');
  assert.deepEqual(submitCustomerActivityPlan(manualSubmitted, task.id, 1_002_000), manualSubmitted, 'manual submission is idempotent');

  const decisionSnapshot: CustomerActivityRelationshipSnapshot = {
    npcId: 'P1-002', role: '项目负责人', title: '技术负责人', context: '负责项目实施与集成', stage: 'N3',
    support: 70, pleasantness: 60,
    dimensions: { decisionAnalysis: 50, relationshipBuilding: 50, valuePresentation: 50, objectionHandling: 50, informationDiscovery: 50 },
  };
  const salesVagueConversation = [
    { messageId: 's1', speaker: 'sales' as const, text: '我们可以安排一次技术交流会，重点讲接口适配。' },
    { messageId: 's2', speaker: 'customer' as const, text: '技术细节我建议和项目负责人同事商量一下。' },
  ];
  let detectionCalls = 0;
  const detectionDiagnostics: Array<{ event: string; reason?: string; activityType?: string; messageId?: string; details?: Record<string, unknown> }> = [];
  const detectedProposals = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-2', npcId: 'P1-002', messages: salesVagueConversation,
  }, { onDiagnostic: (diagnostic) => detectionDiagnostics.push(diagnostic), invoker: async (_messages, options) => {
    detectionCalls += 1;
    throw new Error(`deterministic proposal must not depend on an LLM call (${String(options)} ${String(_messages)})`);
  } });
  assert.equal(detectionCalls, 1);
  assert.equal(detectedProposals.length, 1);
  assert.equal(detectedProposals[0].npcId, 'P1-002', 'NPC ownership comes from trusted caller context');
  assert.equal(detectedProposals[0].requiresFeasibility, true, 'sales proposals enter feasibility regardless of the customer reply');
  assert.equal(detectedProposals[0].responseKind, 'not_required');
  assert.deepEqual(detectedProposals[0].evidence.map(({ kind }) => kind), ['proposal'], 'no customer agreement or reply is fabricated');
  assert.ok(detectionDiagnostics.some(({ event, details }) => event === 'model_skipped' && details?.detection_source === 'deterministic_sales_proposal'));
  assert.ok(detectionDiagnostics.some(({ event, details }) => event === 'candidate_accepted' && details?.detection_source === 'deterministic_sales_proposal'));

  const exactPhoneConversations = [
    [
      '赵老师，您看我们下周要不要安排一个技术交流会，这样可以更好地交流技术上的问题，可以直接把需求交代清楚。',
      '嗯……技术交流会这个事我这边暂时定不了，得先跟李经理汇报一下，确认后再答复您。',
    ],
    [
      '赵老师您好，我想问问看能不能咱们下周召开一个技术交流会，正好也把您这边的需求和我们对一下，提高效率',
      '这类安排我需要先向上级汇报，确认后再答复。',
    ],
  ] as const;
  for (const [index, [salesText, customerText]] of exactPhoneConversations.entries()) {
    const phoneDiagnostics: Array<{ event: string; reason?: string }> = [];
    const candidates = await detectCustomerActivityProposals({
      conversationEnded: true,
      conversationId: `real-phone-phrase-${index}`,
      npcId: 'P1-002',
      messages: [
        { messageId: 'call-sales', speaker: 'sales', text: salesText },
        { messageId: 'call-customer', speaker: 'customer', text: customerText },
      ],
    }, { onDiagnostic: (diagnostic) => phoneDiagnostics.push(diagnostic), invoker: async () => { throw new Error('semantic fallback unavailable'); } });
    assert.equal(candidates.length, 1, `real phone example ${index + 1} must enter feasibility`);
    assert.equal(candidates[0].type, 'technical_meeting');
    assert.equal(candidates[0].responseKind, 'not_required');
    assert.deepEqual(candidates[0].evidence.map(({ kind }) => kind), ['proposal']);
    assert.ok(phoneDiagnostics.some(({ event }) => event === 'model_error'));
    assert.ok(phoneDiagnostics.some(({ event, reason }) => event === 'fallback_used' && reason?.includes('preserved_deterministic')));
  }

  const noReplyCandidate = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'proposal-with-no-customer-reply', npcId: 'P1-002',
    messages: [{ messageId: 'no-reply-sales', speaker: 'sales', text: '咱们下周开个技术交流会吧。' }],
  }, { invoker: async () => { throw new Error('no-reply sales proposal is deterministically recognized'); } });
  assert.equal(noReplyCandidate.length, 1, 'no NPC reply is not required to create a feasibility candidate');

  const malformedSemanticDiagnostics: Array<{ event: string; reason?: string }> = [];
  const deterministicWithMalformedSemantic = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'deterministic-with-malformed-semantic', npcId: 'P1-002',
    messages: [
      { messageId: 'malformed-sales', speaker: 'sales', text: '我们下周安排一次技术交流会。' },
      { messageId: 'malformed-customer', speaker: 'customer', text: '我需要向领导汇报后再答复。' },
    ],
  }, {
    onDiagnostic: (diagnostic) => malformedSemanticDiagnostics.push(diagnostic),
    invoker: async () => JSON.stringify({ activities: [
      { type: 'technical_meeting', initiator: 'sales', proposal: { messageId: 'malformed-sales', quote: '我们已确认安排技术交流会' } },
      {
        type: 'technical_meeting', initiator: 'customer',
        proposal: { messageId: 'malformed-customer', quote: '客户提出了技术交流会' },
        response: { messageId: 'malformed-sales', quote: '我们下周安排一次技术交流会。', kind: 'explicit_acceptance' },
        finalStatus: 'active', finalOutcome: { messageId: 'malformed-sales', quote: '我们下周安排一次技术交流会。' }, confidence: 0.99,
      },
    ] }),
  });
  assert.equal(deterministicWithMalformedSemantic.length, 1, 'a forged AI quote cannot discard a verified deterministic sales proposal');
  assert.equal(deterministicWithMalformedSemantic[0].proposalMessageId, 'malformed-sales');
  assert.ok(malformedSemanticDiagnostics.some(({ event, reason }) => event === 'candidate_filtered' && reason === 'source_quote_missing'));

  const semanticSalesText = '赵老师，下周找个时间把您这边的需求和我们这边的技术方案一起对一对，会更高效。';
  const semanticCustomerText = '嗯，技术交流会暂时定不了，我需要先向上级汇报。';
  const semanticFallbackDiagnostics: Array<{ event: string; reason?: string; activityType?: string; messageId?: string; details?: Record<string, unknown> }> = [];
  const semanticSalesCandidate = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'semantic-sales-proposal', npcId: 'P1-002',
    messages: [
      { messageId: 'semantic-sales', speaker: 'sales', text: semanticSalesText },
      { messageId: 'semantic-customer', speaker: 'customer', text: semanticCustomerText },
    ],
  }, {
    onDiagnostic: (diagnostic) => semanticFallbackDiagnostics.push(diagnostic),
    invoker: async () => JSON.stringify({ activities: [{
      type: 'technical_meeting', initiator: 'sales',
      proposal: { messageId: 'semantic-sales', quote: semanticSalesText },
      response: { messageId: 'semantic-customer', quote: semanticCustomerText, kind: 'rejected' },
      finalStatus: 'cancelled', finalOutcome: { messageId: 'semantic-customer', quote: semanticCustomerText }, confidence: 0.01,
    }] }),
  });
  assert.equal(semanticSalesCandidate.length, 1, 'LLM semantic fallback catches a real proposal without activity keywords');
  assert.equal(semanticSalesCandidate[0].responseKind, 'not_required', 'NPC status and low model confidence do not block sales proposals');
  assert.deepEqual(semanticSalesCandidate[0].evidence.map(({ kind }) => kind), ['proposal']);
  assert.ok(semanticFallbackDiagnostics.some(({ event, details }) => event === 'candidate_accepted' && details?.detection_source === 'llm_sales_semantic_fallback'));
  const semanticNumericDecision = await decideCustomerActivityFeasibility(semanticSalesCandidate[0], decisionSnapshot, {
    revision: 4, mode: 'numeric', thresholds: {
      technical_meeting: { supportMin: 70, pleasantnessMin: 60 },
      case_site_visit: { supportMin: 0, pleasantnessMin: 0 },
      company_visit: { supportMin: 100, pleasantnessMin: 100 },
    },
  });
  assert.equal(semanticNumericDecision.decision, 'allow', 'semantic fallback candidates still reach the numerical feasibility gate');
  assert.equal(semanticNumericDecision.mode, 'numeric');

  const activityDirections: Array<[string, string, CustomerActivityProposalCandidate['type']]> = [
    ['我们可以安排案例现场参观，看看已经落地的项目。', '案例现场参观', 'case_site_visit'],
    ['欢迎您下周来我们公司参观。', '来我们公司参观', 'company_visit'],
    ['赵老师，我想请您吃饭，顺便聊聊项目安排。', '请您吃饭', 'hospitality'],
    ['赵老师，不是不可以请您吃饭，我们改天约时间。', '请您吃饭', 'hospitality'],
    ['赵老师，周末要不要喝酒？', '喝酒', 'hospitality'],
  ];
  for (const [index, [salesText, quote, expectedType]] of activityDirections.entries()) {
    const candidates = await detectCustomerActivityProposals({
      conversationEnded: true, conversationId: `sales-activity-direction-${index}`, npcId: 'P1-002',
      messages: [{ messageId: 'direction-sales', speaker: 'sales', text: salesText }],
    }, { invoker: async () => { throw new Error('common proposal wording must be deterministic'); } });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].type, expectedType, 'activity directions map to the correct type');
    assert.equal(candidates[0].evidence[0].quote, quote);
  }

  const excludedHospitalityMentions = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'hospitality-exclusions', npcId: 'P1-002',
    messages: [
      { messageId: 'excluded-meal', speaker: 'sales', text: '我不想请您吃饭。' },
      { messageId: 'excluded-tea', speaker: 'sales', text: '平时我会请客户喝杯茶，但今天聊下项目。' },
      { messageId: 'excluded-water', speaker: 'sales', text: '我们可以一起喝杯水，先把项目问题说清楚。' },
      { messageId: 'excluded-history', speaker: 'sales', text: '我们上周参加过饭局，今天先聊下项目进度。' },
    ],
  }, { invoker: async (messages) => messages[0]?.content.includes('语义复核器')
    ? JSON.stringify({ reviews: [{
      proposalMessageId: 'excluded-meal', type: 'hospitality', classification: 'not_proposed',
      proposalEvidence: { messageId: 'excluded-meal', quote: '我不想请您吃饭。' },
    }] })
    : JSON.stringify({ activities: [] }) });
  assert.deepEqual(excludedHospitalityMentions, [], 'a negative, historical meal, tea, or water mention is not a hospitality proposal');

  const customerHospitalityConversation = [
    { messageId: 'customer-meal-proposal', speaker: 'customer' as const, text: '要不下周我们一起吃个饭，聊一下项目进展？' },
    { messageId: 'sales-meal-confirmation', speaker: 'sales' as const, text: '好，我来安排，之后和您确认。' },
  ];
  const customerHospitalityCandidates = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'customer-hospitality-confirmed', npcId: 'P1-002',
    messages: customerHospitalityConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'hospitality', initiator: 'customer',
    proposal: { messageId: 'customer-meal-proposal', quote: '我们一起吃个饭' },
    response: { messageId: 'sales-meal-confirmation', quote: '好，我来安排', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'sales-meal-confirmation', quote: '之后和您确认' }, confidence: 0.99,
  }] }) });
  assert.equal(customerHospitalityCandidates.length, 1, 'a customer hospitality proposal becomes a candidate only after sales confirmation');
  assert.equal(customerHospitalityCandidates[0].initiator, 'customer');
  assert.equal(customerHospitalityCandidates[0].requiresFeasibility, false);

  const notOurCompany = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'sales-visits-customer-company', npcId: 'P1-002',
    messages: [{ messageId: 'wrong-direction', speaker: 'sales', text: '我想去贵公司参观一下。' }],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.deepEqual(notOurCompany, [], 'a salesperson visiting the customer company is not a company_visit');

  const ambiguousCompanyDestinationDiagnostics: Array<{ event: string; activityType?: string; details?: Record<string, unknown> }> = [];
  const ambiguousCompanyDestination = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'ambiguous-company-destination', npcId: 'P1-002',
    messages: [{ messageId: 'ambiguous-company-sales', speaker: 'sales', text: '赵老师，下周我能不能到公司参观，您接待一下？' }],
  }, {
    onDiagnostic: (diagnostic) => ambiguousCompanyDestinationDiagnostics.push(diagnostic),
    invoker: async () => JSON.stringify({ activities: [] }),
  });
  assert.deepEqual(ambiguousCompanyDestination, [], 'an unspecified company destination is not deterministically assumed to be our company');
  assert.ok(!ambiguousCompanyDestinationDiagnostics.some(({ event, activityType }) => event === 'model_skipped' && activityType === 'company_visit'),
    'ambiguous visit direction is left to semantic detection instead of a deterministic company-visit candidate');

  const quotedExample = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'quoted-example', npcId: 'P1-002',
    messages: [{ messageId: 'quoted-sales', speaker: 'sales', text: '例如，“安排一次技术交流会”只是一个示例说法。' }],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.deepEqual(quotedExample, [], 'quoted examples are not live sales proposals');

  const asciiQuotedExample = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'ascii-quoted-example', npcId: 'P1-002',
    messages: [{ messageId: 'ascii-quoted-sales', speaker: 'sales', text: '例如，"安排一次技术交流会"只是一个示例说法。' }],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.deepEqual(asciiQuotedExample, [], 'ASCII quoted examples are also excluded');

  const negatedProposal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'negated-proposal', npcId: 'P1-002',
    messages: [{ messageId: 'negative-sales', speaker: 'sales', text: '我们不要安排技术交流会。' }],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'negative-sales', type: 'technical_meeting', classification: 'not_proposed',
    proposalEvidence: { messageId: 'negative-sales', quote: '我们不要安排技术交流会。' },
  }) });
  assert.deepEqual(negatedProposal, [], 'an explicit salesperson negative is not a proposal');

  const withdrawalReviewDiagnostics: Array<{ event: string; details?: Record<string, unknown> }> = [];
  const withdrawnProposal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'withdrawn-proposal', npcId: 'P1-002',
    messages: [
      { messageId: 'withdraw-sales-1', speaker: 'sales', text: '我们可以安排一次技术交流会。' },
      { messageId: 'withdraw-sales-2', speaker: 'sales', text: '我收回刚才的提议，技术交流会暂不安排。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'withdraw-sales-1', type: 'technical_meeting', classification: 'withdrawn',
    proposalEvidence: { messageId: 'withdraw-sales-1', quote: '我们可以安排一次技术交流会。' },
    withdrawalEvidence: { messageId: 'withdraw-sales-2', quote: '我收回刚才的提议，技术交流会暂不安排。' },
  }), onDiagnostic: (diagnostic) => withdrawalReviewDiagnostics.push(diagnostic) });
  assert.deepEqual(withdrawnProposal, [], 'salesperson withdrawal excludes their proposal');
  assert.ok(withdrawalReviewDiagnostics.some(({ event, details }) => event === 'proposal_semantic_review_completed'
    && details?.model_classification === 'withdrawn' && details.withdrawal_message_id === 'withdraw-sales-2'),
  'validated withdrawal diagnostics retain the exact withdrawal message ID');

  const conversationalWithdrawal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'conversational-withdrawal', npcId: 'P1-002',
    messages: [
      { messageId: 'conversational-proposal', speaker: 'sales', text: '我们建议安排一次技术交流会。' },
      { messageId: 'conversational-cancel', speaker: 'sales', text: '技术交流会算了，不办了。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'conversational-proposal', type: 'technical_meeting', classification: 'withdrawn',
    proposalEvidence: { messageId: 'conversational-proposal', quote: '我们建议安排一次技术交流会。' },
    withdrawalEvidence: { messageId: 'conversational-cancel', quote: '技术交流会算了，不办了。' },
  }) });
  assert.deepEqual(conversationalWithdrawal, [], 'colloquial “算了，不办了” is reviewed as a withdrawal');

  const ambiguousGenericWithdrawal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'ambiguous-generic-withdrawal', npcId: 'P1-002',
    messages: [
      { messageId: 'ambiguous-generic-meeting', speaker: 'sales', text: '我们可以安排一次技术交流会。' },
      { messageId: 'ambiguous-generic-visit', speaker: 'sales', text: '我们建议安排一次案例现场参观。' },
      { messageId: 'ambiguous-generic-retract', speaker: 'sales', text: '我收回刚才的提议。' },
    ],
  }, { invoker: async (messages) => messages[0]?.content.includes('语义复核器')
    ? JSON.stringify({ reviews: [{
      proposalMessageId: 'ambiguous-generic-meeting', type: 'technical_meeting', classification: 'withdrawn',
      proposalEvidence: { messageId: 'ambiguous-generic-meeting', quote: '我们可以安排一次技术交流会。' },
      withdrawalEvidence: { messageId: 'ambiguous-generic-retract', quote: '我收回刚才的提议。' },
    }] })
    : JSON.stringify({ activities: [] }) });
  assert.equal(ambiguousGenericWithdrawal.length, 2,
    'a generic withdrawal cannot identify one proposal when multiple activity proposals precede it');

  const negationReviewCases = [
    {
      id: 'double-negation',
      proposal: '赵老师，我觉得咱们不是不能安排技术交流会，不过时间还要再确认。',
      classification: 'active' as const,
      explanation: 'double negation is confirmed as an active proposal',
    },
    {
      id: 'time-undecided',
      proposal: '技术交流会的时间目前不能确定，不过我希望先安排交流。',
      classification: 'active' as const,
      explanation: 'uncertain timing does not negate the proposal',
    },
    {
      id: 'convenience-question',
      proposal: '我们可以安排一次技术交流会，您看时间方便不方便？',
      classification: 'active' as const,
      explanation: 'a convenience question is not an activity rejection',
    },
    {
      id: 'negated-cancellation',
      proposal: '我建议安排一次技术交流会，不是要取消这个活动。',
      classification: 'active' as const,
      explanation: 'denying an intention to cancel keeps the proposal active',
    },
  ];
  for (const { id, proposal, classification, explanation } of negationReviewCases) {
    const messages = [{ messageId: `${id}-sales`, speaker: 'sales' as const, text: proposal }];
    const reviewed = await detectCustomerActivityProposals({
      conversationEnded: true, conversationId: `review-${id}`, npcId: 'P1-002', messages,
    }, { invoker: proposalReviewInvoker({
      proposalMessageId: `${id}-sales`, type: 'technical_meeting', classification,
      proposalEvidence: { messageId: `${id}-sales`, quote: proposal },
    }) });
    assert.equal(reviewed.length, 1, explanation);
  }

  const validProposalQuoteWithUnrelatedWithdrawal = '我们建议安排一次技术交流会。';
  const unrelatedWithdrawal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'unrelated-activity-withdrawal', npcId: 'P1-002',
    messages: [
      { messageId: 'unrelated-proposal', speaker: 'sales', text: validProposalQuoteWithUnrelatedWithdrawal },
      { messageId: 'unrelated-cancel', speaker: 'sales', text: '我取消案例现场参观，这次技术交流会照常安排。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'unrelated-proposal', type: 'technical_meeting', classification: 'active',
    proposalEvidence: { messageId: 'unrelated-proposal', quote: validProposalQuoteWithUnrelatedWithdrawal },
  }) });
  assert.equal(unrelatedWithdrawal.length, 1, 'withdrawing another activity cannot cancel this proposal');

  const cancelledTimeButActiveMeeting = '我们建议安排一次技术交流会。';
  const cancelledTime = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'cancelled-time-keeps-activity', npcId: 'P1-002',
    messages: [
      { messageId: 'cancel-time-proposal', speaker: 'sales', text: cancelledTimeButActiveMeeting },
      { messageId: 'cancel-time-followup', speaker: 'sales', text: '原定时间取消，技术交流会仍按计划开展。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'cancel-time-proposal', type: 'technical_meeting', classification: 'active',
    proposalEvidence: { messageId: 'cancel-time-proposal', quote: cancelledTimeButActiveMeeting },
  }) });
  assert.equal(cancelledTime.length, 1, 'cancelling a time does not cancel the activity');

  const retainedProposal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'retained-proposal-time-change', npcId: 'P1-002',
    messages: [
      { messageId: 'retained-proposal-first', speaker: 'sales', text: '我建议下周安排一次技术交流会，讨论接口需求。' },
      { messageId: 'retained-proposal-time-change', speaker: 'sales', text: '取消刚才说的下周时间，技术交流会的提议仍然保留，时间另议。' },
    ],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.equal(retainedProposal.length, 1,
    'restating that the existing proposal remains while changing its time is not a second proposal');

  const customerRefusalDoesNotWithdraw = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'customer-refusal-not-withdrawal', npcId: 'P1-002',
    messages: [
      { messageId: 'customer-refusal-proposal', speaker: 'sales', text: '我们建议安排一次技术交流会。' },
      { messageId: 'customer-refusal-reply', speaker: 'customer', text: '这次先不安排。' },
    ],
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'technical_meeting', initiator: 'sales', proposal: { messageId: 'customer-refusal-proposal', quote: '我们建议安排一次技术交流会。' },
    response: { messageId: 'customer-refusal-reply', quote: '这次先不安排。', kind: 'rejected' },
    finalStatus: 'cancelled', finalOutcome: { messageId: 'customer-refusal-reply', quote: '这次先不安排。' }, confidence: 0.99,
  }] }) });
  assert.equal(customerRefusalDoesNotWithdraw.length, 1, 'a customer refusal cannot withdraw the salesperson proposal');

  const falseWithdrawalEvidence = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'false-withdrawal-evidence', npcId: 'P1-002',
    messages: [
      { messageId: 'false-evidence-proposal', speaker: 'sales', text: '我们建议安排一次技术交流会。' },
      { messageId: 'false-evidence-time', speaker: 'sales', text: '原定技术交流会时间取消，活动稍后再定。' },
      { messageId: 'false-evidence-customer', speaker: 'customer', text: '我收回刚才的提议。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'false-evidence-proposal', type: 'technical_meeting', classification: 'withdrawn',
    proposalEvidence: { messageId: 'false-evidence-proposal', quote: '我们建议安排一次技术交流会。' },
    withdrawalEvidence: { messageId: 'false-evidence-customer', quote: '我收回刚才的提议。' },
  }) });
  assert.equal(falseWithdrawalEvidence.length, 1, 'customer text cannot serve as salesperson withdrawal evidence');

  const timeOnlyWithdrawalEvidence = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'time-only-withdrawal-evidence', npcId: 'P1-002',
    messages: [
      { messageId: 'time-only-proposal', speaker: 'sales', text: '我们建议安排一次技术交流会。' },
      { messageId: 'time-only-cancel', speaker: 'sales', text: '原定技术交流会时间取消，活动稍后再定。' },
    ],
  }, { invoker: proposalReviewInvoker({
    proposalMessageId: 'time-only-proposal', type: 'technical_meeting', classification: 'withdrawn',
    proposalEvidence: { messageId: 'time-only-proposal', quote: '我们建议安排一次技术交流会。' },
    withdrawalEvidence: { messageId: 'time-only-cancel', quote: '原定技术交流会时间取消，活动稍后再定。' },
  }) });
  assert.equal(timeOnlyWithdrawalEvidence.length, 1,
    'a time-only cancellation cannot serve as evidence that the activity itself was withdrawn');

  const unavailableReviewStillKeepsProvenProposal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'review-unavailable-proven-proposal', npcId: 'P1-002',
    messages: [
      { messageId: 'proven-proposal', speaker: 'sales', text: '我们可以安排一次技术交流会。' },
      { messageId: 'withdrawal-signal', speaker: 'sales', text: '我收回刚才的提议，技术交流会暂不安排。' },
    ],
  }, { invoker: async (messages) => {
    if (messages[0]?.content.includes('语义复核器')) throw new Error('review unavailable');
    return JSON.stringify({ activities: [{
      type: 'technical_meeting', initiator: 'sales',
      proposal: { messageId: 'proven-proposal', quote: '我们可以安排一次技术交流会。' },
    }] });
  } });
  assert.equal(unavailableReviewStillKeepsProvenProposal.length, 1,
    'semantic review failure preserves a candidate the primary semantic detector verified');

  const explicitNegativeWithUnavailableReview = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'review-unavailable-negative', npcId: 'P1-002',
    messages: [{ messageId: 'unavailable-negative', speaker: 'sales', text: '我们不要安排技术交流会。' }],
  }, { invoker: async (messages) => {
    if (messages[0]?.content.includes('语义复核器')) throw new Error('review unavailable');
    return JSON.stringify({ activities: [] });
  } });
  assert.deepEqual(explicitNegativeWithUnavailableReview, [],
    'semantic review failure cannot turn a bare negative mention into a proposal');

  const notRecommendedWithUnavailableReview = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'review-unavailable-not-recommended', npcId: 'P1-002',
    messages: [{ messageId: 'not-recommended', speaker: 'sales', text: '我不建议安排技术交流会。' }],
  }, { invoker: async (messages) => {
    if (messages[0]?.content.includes('语义复核器')) throw new Error('review unavailable');
    return JSON.stringify({ activities: [] });
  } });
  assert.deepEqual(notRecommendedWithUnavailableReview, [],
    'a negated recommendation triggers review but cannot become a proposal when review is unavailable');

  const doubleNegationWithExplicitRefusalAndUnavailableReview = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'review-unavailable-double-negative-refusal', npcId: 'P1-002',
    messages: [{ messageId: 'double-negative-refusal', speaker: 'sales', text: '我们不是不能安排技术交流会，只是现在不想办。' }],
  }, { invoker: async (messages) => {
    if (messages[0]?.content.includes('语义复核器')) throw new Error('review unavailable');
    return JSON.stringify({ activities: [] });
  } });
  assert.deepEqual(doubleNegationWithExplicitRefusalAndUnavailableReview, [],
    'the affirmative opening of a double-negative sentence cannot override its later explicit refusal');

  const timeUncertainButAffirmativeWithUnavailableReview = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'review-unavailable-time-uncertain-proposal', npcId: 'P1-002',
    messages: [{ messageId: 'time-uncertain-proposal', speaker: 'sales', text: '技术交流会的时间目前不能确定，不过我希望先安排交流。' }],
  }, { invoker: async (messages) => {
    if (messages[0]?.content.includes('语义复核器')) throw new Error('review unavailable');
    return JSON.stringify({ activities: [] });
  } });
  assert.equal(timeUncertainButAffirmativeWithUnavailableReview.length, 1,
    'an independently clear proposal survives when only its time is uncertain and semantic review is unavailable');
  assert.equal(hasCustomerActivityRefusal('嗯……技术交流会这个事我这边暂时定不了，得先跟李经理汇报一下，确认后再答复您。'), false,
    'an ordinary report-up response is not misclassified as a refusal');
  const actualOverlyNegativeReply = '嗯……这个我这边暂时还没法安排，具体需求也不是我个人能定的。您看哈，先按正常流程来吧。';
  assert.equal(hasCustomerActivityRefusal(actualOverlyNegativeReply), true,
    'the real-world refusal and process-deflection reply is repaired even without an activity keyword');
  for (const reply of [
    '这个暂时还无法安排。',
    '目前没法安排。',
    '暂不安排。',
    '目前条件不成熟。',
    '您先按正常流程走。',
    '先按正常流程来吧。',
    '先按流程走吧。',
    '请先走流程。',
    '先走流程吧。',
    '等流程走完再说。',
  ]) {
    assert.equal(hasCustomerActivityRefusal(reply), true, `${reply} is recognized as a negative or process-deflecting activity reply`);
  }
  const middleLevelInternalReply = '这个建议我记下了，我先向上级汇报，再给您反馈。';
  const seniorInternalReply = '我先结合项目情况考虑，必要时和公司内部商量，再给您反馈。';
  assert.equal(hasCustomerActivityRefusal(middleLevelInternalReply), false);
  assert.equal(hasCustomerActivityDisposition(middleLevelInternalReply, '中层'), true,
    'middle and frontline customers report upward and promise a later reply');
  assert.equal(hasCustomerActivityDisposition('我需要先向上汇报，再给您反馈。', '中层'), true,
    'a natural upward-report phrase need not explicitly say “上级”');
  assert.equal(hasCustomerActivityDisposition(seniorInternalReply, '高层'), true,
    'senior customers consider or discuss internally before replying');
  assert.equal(hasCustomerActivityDisposition('知道了，按流程走。', '中层'), false,
    'generic acknowledgment and process wording do not satisfy the required handling disposition');
  const guardedNpc = { id: 'P1-004', name: '赵晓晨', title: '客户负责人', category: '一线' as const };
  const replyGuardContext = {
    playerMessage: '下周能不能安排一次技术交流会？',
    recentConversation: [{ speaker: 'sales' as const, text: '我们想和您讨论技术交流会。' }],
  };
  let replyGenerationAttempts = 0;
  let replyReviewAttempts = 0;
  const repairedActivityReply = await generateNpcReplyWithCustomerActivityGuard(guardedNpc, 'work_phone', async () => {
    replyGenerationAttempts += 1;
    return replyGenerationAttempts === 1 ? actualOverlyNegativeReply : middleLevelInternalReply;
  }, {
    context: replyGuardContext,
    invoker: async () => {
      replyReviewAttempts += 1;
      return replyReviewAttempts === 1
        ? JSON.stringify({ decision: 'violation', issue: 'ordinary_refusal', evidence: '先按正常流程来吧' })
        : JSON.stringify({ decision: 'allowed', issue: 'none' });
    },
  });
  assert.equal(replyGenerationAttempts, 2, 'a negative or process-deflecting activity reply receives one targeted retry');
  assert.equal(repairedActivityReply.source, 'repaired');
  assert.equal(repairedActivityReply.reply, middleLevelInternalReply);
  const fallbackActivityReply = await generateNpcReplyWithCustomerActivityGuard(guardedNpc, 'work_phone', async () => actualOverlyNegativeReply, {
    context: replyGuardContext,
    invoker: async () => JSON.stringify({ decision: 'violation', issue: 'ordinary_refusal', evidence: '先按正常流程来吧' }),
  });
  assert.equal(fallbackActivityReply.source, 'fallback');
  assert.equal(hasCustomerActivityDisposition(fallbackActivityReply.reply, '一线'), true,
    'the fallback uses internal reporting and a later reply instead of a refusal or process deflection');
  const complianceReply = '这涉及商业秘密，我不能接受这个提议。';
  assert.equal(hasCustomerActivityComplianceRefusal(complianceReply), true);
  let complianceReplyAttempts = 0;
  const guardedComplianceReply = await generateNpcReplyWithCustomerActivityGuard(guardedNpc, 'work_phone', async () => {
    complianceReplyAttempts += 1;
    return complianceReply;
  }, {
    context: replyGuardContext,
    invoker: async () => JSON.stringify({ decision: 'allowed', issue: 'compliance_refusal' }),
  });
  assert.equal(complianceReplyAttempts, 1, 'the existing compliance refusal path is not rewritten into a positive activity response');
  assert.equal(guardedComplianceReply.reply, complianceReply);
  assert.equal(hasCustomerActivityRefusal('我不安排这次技术交流会。'), true, 'an ordinary direct refusal is repairable');
  assert.equal(hasCustomerActivityRefusal('这次技术交流会涉及泄密，不能安排。'), false,
    'existing compliance-related refusals remain protected');
  const middleLevelConversation = [
    { messageId: 's1', speaker: 'sales' as const, text: '我们可以安排一次技术交流会，重点讲接口适配。' },
    { messageId: 's2', speaker: 'customer' as const, text: '我需要向上汇报，确认后再回复您。' },
  ];
  const middleLevelCandidate = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-middle-level', npcId: 'P1-003', messages: middleLevelConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'technical_meeting', initiator: 'sales',
    proposal: { messageId: 's1', quote: '安排一次技术交流会' },
    response: { messageId: 's2', quote: '向上汇报，确认后再回复您', kind: 'ambiguous' },
    finalStatus: 'active', finalOutcome: { messageId: 's2', quote: '向上汇报，确认后再回复您' }, confidence: 0.96,
  }] }) });
  assert.equal(middleLevelCandidate.length, 1, 'a middle-level report-up response is a feasibility candidate');

  const customerConversation = [
    { messageId: 'c1', speaker: 'customer' as const, text: '能安排去看一下之前的项目现场吗？' },
    { messageId: 'c2', speaker: 'sales' as const, text: '可以，我来协调案例现场参观。' },
  ];
  const customerInitiates = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'case-visit-1', npcId: 'P1-002', messages: customerConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'case_site_visit', initiator: 'customer',
    proposal: { messageId: 'c1', quote: '安排去看一下之前的项目现场' },
    response: { messageId: 'c2', quote: '可以，我来协调案例现场参观。', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'c2', quote: '可以，我来协调案例现场参观。' }, confidence: 0.96,
  }] }) });
  assert.equal(customerInitiates.length, 1, 'customer proposal plus explicit sales confirmation creates a candidate');
  assert.equal(customerInitiates[0].requiresFeasibility, false);

  let legacyCalls = 0;
  const legacyAdapter = await detectAgreedCustomerActivities({
    conversationEnded: true, conversationId: 'legacy-safe', npcId: 'P1-002', messages: salesVagueConversation,
  }, { invoker: async () => { legacyCalls += 1; return JSON.stringify({ activities: [] }); } });
  assert.deepEqual(legacyAdapter, [], 'legacy agreement adapter cannot bypass feasibility for sales proposals');
  assert.equal(legacyCalls, 1);
  const directNpcAgreement = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'npc-direct-agreement', npcId: 'P1-002', messages: sourceConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'technical_meeting', initiator: 'sales',
    proposal: { messageId: 'm1', quote: '安排一次技术交流会' },
    response: { messageId: 'm2', quote: '可以，安排技术团队参加。', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'm2', quote: '可以，安排技术团队参加。' }, confidence: 0.99,
  }] }) });
  assert.equal(directNpcAgreement.length, 1, 'customer acceptance is not required for a salesperson proposal');
  assert.equal(directNpcAgreement[0].responseKind, 'not_required', 'an NPC agreement is not recorded as customer consent');
  assert.deepEqual(directNpcAgreement[0].evidence.map(({ kind }) => kind), ['proposal']);

  const lowConfidence = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-low-confidence', npcId: 'P1-002', messages: customerConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'case_site_visit', initiator: 'customer',
    proposal: { messageId: 'c1', quote: '安排去看一下之前的项目现场' },
    response: { messageId: 'c2', quote: '可以，我来协调案例现场参观。', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'c2', quote: '可以，我来协调案例现场参观。' }, confidence: 0.7,
  }] }) });
  assert.deepEqual(lowConfidence, [], 'low confidence is a successful no-match rather than a retryable protocol error');

  const noLongerEnded = await detectCustomerActivityProposals({
    conversationEnded: false, conversationId: 'meeting-2', npcId: 'P1-002', messages: salesVagueConversation,
  }, { invoker: async () => { throw new Error('must not call'); } });
  assert.deepEqual(noLongerEnded, [], 'unfinished conversations are never scanned');

  await assert.rejects(detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-3', npcId: 'P1-002', messages: customerConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'case_site_visit', initiator: 'customer',
    proposal: { messageId: 'c1', quote: '项目现场并未被这样提及' },
    response: { messageId: 'c2', quote: '可以，我来协调案例现场参观。', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'c2', quote: '可以，我来协调案例现场参观。' }, confidence: 0.99,
  }] }) }), (error: unknown) => error instanceof CustomerActivityDetectionError && error.code === 'invalid_source',
  'model citations must be exact source text and protocol errors remain retryable');

  await assert.rejects(detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-4', npcId: 'P1-002', messages: customerConversation,
  }, { invoker: async () => JSON.stringify({ activities: [{
    type: 'case_site_visit', initiator: 'customer',
    proposal: { messageId: 'c1', quote: '安排去看一下之前的项目现场' },
    response: { messageId: 'c1', quote: '安排去看一下之前的项目现场', kind: 'explicit_acceptance' },
    finalStatus: 'active', finalOutcome: { messageId: 'c2', quote: '可以，我来协调案例现场参观。' }, confidence: 0.99,
  }] }) }), (error: unknown) => error instanceof CustomerActivityDetectionError && error.code === 'invalid_source',
  'the proposer cannot also be the responding party');

  const cancelled = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-5', npcId: 'P1-002',
    messages: [...salesVagueConversation, { messageId: 's3', speaker: 'customer' as const, text: '这次先取消，之后再商量。' }],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.equal(cancelled.length, 1, 'an NPC refusal/cancellation cannot block a salesperson proposal');

  await assert.rejects(detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'meeting-unavailable', npcId: 'P1-002', messages: customerConversation,
  }, { invoker: async () => { throw new Error('provider unavailable'); } }),
  (error: unknown) => error instanceof CustomerActivityDetectionError && error.code === 'provider_unavailable',
  'provider failures are distinguishable from successful no-match results');

  const aiConfig: ActivityDecisionConfig = { revision: 3, mode: 'ai', thresholds: {} };
  const jevResult = (choice: 'allow' | 'reject' | 'need_more') => ({
    answers: { decision: {
      type: 'choice' as const, choice,
      probabilities: { allow: choice === 'allow' ? 1 : 0, reject: choice === 'reject' ? 1 : 0, need_more: choice === 'need_more' ? 1 : 0 },
      confidence: 1,
    } },
  });
  for (const [candidate, snapshot] of [
    [detectedProposals[0], decisionSnapshot] as const,
    [middleLevelCandidate[0], { ...decisionSnapshot, npcId: 'P1-003', role: '中层采购负责人', title: '采购经理' }] as const,
  ]) for (const outcome of ['allow', 'reject', 'need_more'] as const) {
    let jevCalls = 0;
    const result = await decideCustomerActivityFeasibility(candidate, snapshot, aiConfig, {
      jevInvoker: async (request) => {
        jevCalls += 1;
        assert.equal(Object.keys(request.questions).join(','), 'decision');
        assert.match(String(request.questions.decision.instructions), /不可信数据/,
          'the feasibility decision treats source conversation as untrusted input');
        const frozen = (request.state as { relationshipSnapshot: CustomerActivityRelationshipSnapshot }).relationshipSnapshot;
        assert.equal(frozen.support, 70);
        assert.equal(frozen.role, snapshot.role, 'role-aware vague replies are evaluated against the frozen NPC role');
        return jevResult(outcome);
      },
    });
    assert.equal(jevCalls, 1);
    assert.equal(result.decision, outcome);
    assert.equal(result.mode, 'ai');
    const stored = recordCustomerActivityProposalDecision(createEmptyCustomerActivityState(), candidate, snapshot, aiConfig, result, 20_000);
    assert.equal(stored.recorded, true);
    assert.equal(stored.state.decisions.length, 1, 'all normal AI outcomes are recorded once');
    assert.equal(stored.state.tasks.length, outcome === 'allow' ? 1 : 0, 'only allow creates an activity task');
    if (outcome === 'allow') {
      const task = stored.state.tasks[0];
      assert.equal(task.relationshipSnapshot?.support, 70, 'the decision-time metric snapshot is stored on the task');
      assert.equal('relationshipSnapshot' in toPublicCustomerActivityTask(task), false, 'internal decision metrics are never public');
    }
  }

  const customerConfirmation = await decideCustomerActivityFeasibility(customerInitiates[0], decisionSnapshot, aiConfig, {
    jevInvoker: async () => { throw new Error('customer confirmation does not call Jev'); },
  });
  assert.equal(customerConfirmation.mode, 'customer_confirmed');
  assert.equal(customerConfirmation.decision, 'allow');
  assert.ok(createResolvedCustomerActivityAgreement(customerInitiates[0], decisionSnapshot, aiConfig, customerConfirmation));

  assert.deepEqual(HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD, { supportMin: 15, pleasantnessMin: 55 });
  const hospitalityBoundarySnapshot: CustomerActivityRelationshipSnapshot = {
    ...decisionSnapshot,
    support: 15,
    pleasantness: 55,
    organization: {
      members: CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) => ({
        npcId,
        support: npcId === 'P1-002' ? 15 : 0,
        pleasantness: npcId === 'P1-002' ? 55 : 0,
      })),
    },
  };
  let hospitalityJevCalls = 0;
  const hospitalityAtBoundary = await decideCustomerActivityFeasibility(
    customerHospitalityCandidates[0], hospitalityBoundarySnapshot, aiConfig,
    { jevInvoker: async () => { hospitalityJevCalls += 1; throw new Error('hospitality always uses its numeric gate'); } },
  );
  assert.equal(hospitalityAtBoundary.decision, 'allow', 'hospitality thresholds pass inclusively at 15/55');
  assert.equal(hospitalityAtBoundary.mode, 'numeric', 'customer confirmation does not bypass the hospitality threshold');
  assert.equal(hospitalityJevCalls, 0, 'global AI mode does not call Jev for hospitality');
  const hospitalityAgreement = createResolvedCustomerActivityAgreement(customerHospitalityCandidates[0],
    hospitalityBoundarySnapshot, aiConfig, hospitalityAtBoundary);
  assert.equal(hospitalityAgreement?.type, 'hospitality',
    'the verified hospitality decision creates an ordinary activity agreement');
  const hospitalityTaskState = createCustomerActivityTasks(
    createEmptyCustomerActivityState(), hospitalityAgreement ? [hospitalityAgreement] : [], 22_000,
  );
  assert.equal(hospitalityTaskState.tasks[0]?.decisionMode, 'numeric', 'hospitality task schema retains its numeric gate mode');
  assert.equal(readCustomerActivityState(JSON.parse(JSON.stringify(hospitalityTaskState))).tasks[0]?.type, 'hospitality',
    'hospitality tasks and frozen snapshots survive persisted-state readback');
  const hospitalityRecorded = recordCustomerActivityProposalDecision(
    createEmptyCustomerActivityState(), customerHospitalityCandidates[0], hospitalityBoundarySnapshot,
    aiConfig, hospitalityAtBoundary, 23_000,
  );
  assert.equal(hospitalityRecorded.recorded, true, 'hospitality numeric decisions persist under the normal record schema');
  assert.equal(readCustomerActivityState(JSON.parse(JSON.stringify(hospitalityRecorded.state))).decisions[0]?.mode, 'numeric',
    'hospitality numeric decision records survive persisted-state readback');
  const forgedHospitalityState = {
    ...hospitalityRecorded.state,
    decisions: [{ ...hospitalityRecorded.state.decisions[0], mode: 'ai' }],
  };
  assert.equal(isCustomerActivityState(forgedHospitalityState), false,
    'state schema rejects an AI-mode hospitality decision that bypasses its numeric gate');
  const hospitalityBelowSupport = await decideCustomerActivityFeasibility(
    customerHospitalityCandidates[0], { ...hospitalityBoundarySnapshot, support: 14 }, aiConfig,
  );
  const hospitalityBelowPleasantness = await decideCustomerActivityFeasibility(
    customerHospitalityCandidates[0], { ...hospitalityBoundarySnapshot, pleasantness: 54 }, aiConfig,
  );
  assert.equal(hospitalityBelowSupport.decision, 'reject', 'support below the hospitality threshold blocks the proposal');
  assert.equal(hospitalityBelowPleasantness.decision, 'reject', 'pleasantness below the hospitality threshold blocks the proposal');

  assert.equal(parseActivityDecisionConfig({ revision: 1, mode: 'numeric', thresholds: {} }), null,
    'numeric mode cannot be enabled before every activity threshold is configured');
  assert.ok(parseActivityDecisionConfig({ revision: 1, mode: 'ai', thresholds: { company_visit: { supportMin: 30 } } }),
    'AI mode persists partially configured numeric thresholds for later editing');
  const numericConfig: ActivityDecisionConfig = {
    revision: 8, mode: 'numeric', thresholds: {
      technical_meeting: { supportMin: 70, pleasantnessMin: 60 },
      case_site_visit: { supportMin: 0, pleasantnessMin: 0 },
      company_visit: { supportMin: 100, pleasantnessMin: 100 },
    },
  };
  let numericJevCalls = 0;
  const numericAtBoundary = await decideCustomerActivityFeasibility(detectedProposals[0], decisionSnapshot, numericConfig, {
    jevInvoker: async () => { numericJevCalls += 1; throw new Error('numeric mode cannot call Jev'); },
  });
  assert.equal(numericAtBoundary.decision, 'allow', 'support and pleasantness thresholds are inclusive');
  assert.equal(numericJevCalls, 0);
  const belowSupport = await decideCustomerActivityFeasibility(detectedProposals[0], { ...decisionSnapshot, support: 69 }, numericConfig);
  assert.equal(belowSupport.decision, 'reject', 'one metric below threshold blocks numeric eligibility');
  const belowPleasantness = await decideCustomerActivityFeasibility(detectedProposals[0], { ...decisionSnapshot, pleasantness: 59 }, numericConfig);
  assert.equal(belowPleasantness.decision, 'reject', 'both numeric conditions must pass');
  const zeroThreshold = await decideCustomerActivityFeasibility({ ...detectedProposals[0], type: 'case_site_visit' }, { ...decisionSnapshot, support: 0, pleasantness: 0 }, numericConfig);
  assert.equal(zeroThreshold.decision, 'allow', '0 is a valid inclusive threshold');
  const maxThreshold = await decideCustomerActivityFeasibility({ ...detectedProposals[0], type: 'company_visit' }, { ...decisionSnapshot, support: 100, pleasantness: 100 }, numericConfig);
  assert.equal(maxThreshold.decision, 'allow', '100 is a valid inclusive threshold');

  assert.equal(DEFAULT_ACTIVITY_DECISION_CONFIG.mode, 'numeric', 'recommended organization thresholds are the default decision mode');
  assert.ok(parseActivityDecisionConfig(DEFAULT_ACTIVITY_DECISION_CONFIG), 'the complete recommended organization config validates');
  assert.deepEqual(Object.keys(RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS).sort(),
    ['case_site_visit', 'company_visit', 'technical_meeting'], 'recommended thresholds cover all three activity types');
  const makeOrganizationSnapshot = (
    npcId: string,
    support: Partial<Record<(typeof CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS)[number], number>> = {},
    pleasantness: Partial<Record<(typeof CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS)[number], number>> = {},
  ): CustomerActivityRelationshipSnapshot => ({
    ...decisionSnapshot,
    npcId,
    organization: {
      members: CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((memberNpcId) => ({
        npcId: memberNpcId,
        support: support[memberNpcId] ?? 0,
        pleasantness: pleasantness[memberNpcId] ?? 55,
      })),
    },
  });
  const organizationConfig: ActivityDecisionConfig = { ...DEFAULT_ACTIVITY_DECISION_CONFIG, revision: 9 };
  const technicalTwoPersonTeam = makeOrganizationSnapshot('P1-002', { 'P1-002': 12, 'P1-004': 8 }, { 'P1-002': 55 });
  const technicalTwoPersonGate = decideOrganizationActivityThreshold(
    technicalTwoPersonTeam,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting,
  );
  assert.equal(technicalTwoPersonGate.decision, 'allow', 'the two-person technical path accepts inclusive support and pleasantness thresholds');
  assert.doesNotMatch(technicalTwoPersonGate.reason, /\d|路径|路线/u, 'organization explanations do not expose numbers or route names');
  const technicalOneBelowPathPleasantness = makeOrganizationSnapshot('P1-002',
    { 'P1-002': 12, 'P1-004': 8 }, { 'P1-002': 55, 'P1-004': 54 });
  assert.equal(decideOrganizationActivityThreshold(technicalOneBelowPathPleasantness,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'reject',
  'one point below an applicable member pleasantness threshold blocks the otherwise complete two-person path');

  const organizationJev = { jevInvoker: async () => { throw new Error('numeric mode must not call Jev'); } };
  const technicalAtEquality = await decideCustomerActivityFeasibility(detectedProposals[0], technicalTwoPersonTeam, organizationConfig, organizationJev);
  assert.equal(technicalAtEquality.decision, 'allow', 'the AI decision API applies the organization path at equality');
  assert.equal(technicalAtEquality.mode, 'numeric');
  const organizationAgreement = createResolvedCustomerActivityAgreement(detectedProposals[0], technicalTwoPersonTeam, organizationConfig, technicalAtEquality);
  assert.ok(organizationAgreement,
    'the agreement creator revalidates and accepts a qualifying frozen team');
  assert.deepEqual(organizationAgreement.relationshipSnapshot?.organization, technicalTwoPersonTeam.organization,
    'the full team snapshot is frozen with the resolved agreement');
  const organizationRecorded = recordCustomerActivityProposalDecision(createEmptyCustomerActivityState(),
    detectedProposals[0], technicalTwoPersonTeam, organizationConfig, technicalAtEquality, 20_000);
  assert.equal(organizationRecorded.recorded, true, 'the team decision can be recorded through the normal persistence path');
  assert.equal(organizationRecorded.state.decisions[0].relationshipSnapshot.organization?.members.length, 5,
    'the decision record keeps all five members for idempotent audit');
  assert.equal(organizationRecorded.task?.relationshipSnapshot?.organization?.members.length, 5,
    'the created task freezes the same full team snapshot');
  assert.equal('relationshipSnapshot' in toPublicCustomerActivityTask(organizationRecorded.task!), false,
    'the public task projection does not expose frozen team metrics');
  assert.equal('decisionConfig' in toPublicCustomerActivityTask(organizationRecorded.task!), false,
    'the public task projection does not expose configured paths or thresholds');

  const technicalThreePersonTeam = makeOrganizationSnapshot('P1-002', {
    'P1-001': 8, 'P1-002': 8, 'P1-003': 8, 'P1-005': 8,
  });
  assert.equal(decideOrganizationActivityThreshold(technicalThreePersonTeam,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'allow',
  'the three-person technical path accepts a qualifying team');
  assert.equal(decideOrganizationActivityThreshold(makeOrganizationSnapshot('P1-002', {
    'P1-001': 12, 'P1-002': 12, 'P1-004': 12,
  }, { 'P1-001': 55, 'P1-002': 55, 'P1-004': 55 }), RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.case_site_visit).decision, 'allow',
  'the three-person case path accepts its inclusive support/pleasantness thresholds');
  assert.equal(decideOrganizationActivityThreshold(makeOrganizationSnapshot('P1-002', {
    'P1-001': 12, 'P1-002': 12, 'P1-004': 12,
  }, { 'P1-001': 55, 'P1-002': 55, 'P1-004': 55 }),
  RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.company_visit).decision, 'allow',
  'the three-person company-visit path accepts its inclusive thresholds');

  const onePersonOnly = makeOrganizationSnapshot('P1-002', { 'P1-001': 100 });
  assert.equal(decideOrganizationActivityThreshold(onePersonOnly,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'reject',
  'one person at 100 cannot satisfy a team-level route');
  const otherMemberBlocks = makeOrganizationSnapshot('P1-002', { 'P1-002': 100 });
  assert.equal(decideOrganizationActivityThreshold(otherMemberBlocks,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'reject',
  'the contacted NPC alone cannot satisfy an organization-level route');
  const otherMemberUnlocks = makeOrganizationSnapshot('P1-002', { 'P1-002': 12, 'P1-004': 8 }, { 'P1-002': 55 });
  assert.equal(decideOrganizationActivityThreshold(otherMemberUnlocks,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'allow',
  'a second member can change the frozen team decision');
  const belowGlobalPleasantness = makeOrganizationSnapshot('P1-002', { 'P1-002': 12, 'P1-004': 8 }, { 'P1-002': 55, 'P1-005': 19 });
  assert.equal(decideOrganizationActivityThreshold(belowGlobalPleasantness,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'reject',
  'one member below the global pleasantness minimum blocks all routes');

  const missingOrganization = decideOrganizationActivityThreshold(decisionSnapshot,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting);
  assert.equal(missingOrganization.decision, 'reject', 'missing team context cannot allow a new organization threshold');
  const incompleteOrganization = {
    ...technicalTwoPersonTeam,
    organization: { members: technicalTwoPersonTeam.organization!.members.slice(0, 4) },
  };
  const duplicateOrganization = {
    ...technicalTwoPersonTeam,
    organization: { members: [
      ...technicalTwoPersonTeam.organization!.members.slice(0, 4),
      { ...technicalTwoPersonTeam.organization!.members[0] },
    ] },
  };
  assert.equal(customerActivityRelationshipSnapshotSchema.safeParse(incompleteOrganization).success, false,
    'a team snapshot must contain exactly five members');
  assert.equal(customerActivityRelationshipSnapshotSchema.safeParse(duplicateOrganization).success, false,
    'a team snapshot must contain each NPC exactly once');
  assert.equal(decideOrganizationActivityThreshold(duplicateOrganization,
    RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting).decision, 'reject',
  'an invalid team snapshot cannot pass a threshold');

  const customerInitiatedTechnical = {
    ...detectedProposals[0],
    npcId: 'P1-001',
    type: 'technical_meeting' as const,
    initiator: 'customer' as const,
    requiresFeasibility: false,
    responseKind: 'explicit_acceptance' as const,
    proposalMessageId: 'customer-tech-proposal',
    responseMessageId: 'sales-tech-confirmation',
    finalOutcomeMessageId: 'sales-tech-confirmation',
    sourceConversation: [
      { messageId: 'customer-tech-proposal', speaker: 'customer' as const, text: '建议下周安排一次技术交流会。' },
      { messageId: 'sales-tech-confirmation', speaker: 'sales' as const, text: '可以，我来安排技术交流会。' },
    ],
    evidence: [
      { messageId: 'customer-tech-proposal', speaker: 'customer' as const, kind: 'proposal' as const, quote: '安排一次技术交流会' },
      { messageId: 'sales-tech-confirmation', speaker: 'sales' as const, kind: 'response' as const, quote: '可以，我来安排技术交流会。' },
      { messageId: 'sales-tech-confirmation', speaker: 'sales' as const, kind: 'final_outcome' as const, quote: '可以，我来安排技术交流会。' },
    ],
  };
  const customerTechnicalDecision = await decideCustomerActivityFeasibility(customerInitiatedTechnical,
    { ...technicalTwoPersonTeam, npcId: 'P1-001' }, organizationConfig, organizationJev);
  assert.equal(customerTechnicalDecision.decision, technicalAtEquality.decision,
    'the same frozen team produces the same decision when the customer initiated the proposal');
  assert.equal(customerTechnicalDecision.mode, 'numeric', 'customer initiation does not bypass numeric organization gates');
  const customerTechnicalBlocked = await decideCustomerActivityFeasibility(customerInitiatedTechnical,
    { ...onePersonOnly, npcId: 'P1-001' }, organizationConfig, organizationJev);
  assert.equal(customerTechnicalBlocked.decision, 'reject', 'a customer confirmation cannot bypass an unmet organization gate');
  assert.equal(createResolvedCustomerActivityAgreement(customerInitiatedTechnical,
    { ...onePersonOnly, npcId: 'P1-001' }, organizationConfig,
    { ...customerTechnicalBlocked, decision: 'allow' }), null,
  'agreement creation independently rejects a forged allow decision for an unqualified team');

  const legacyNumericConfig = {
    revision: 10,
    mode: 'numeric' as const,
    thresholds: {
      technical_meeting: { supportMin: 70, pleasantnessMin: 60 },
      case_site_visit: { supportMin: 0, pleasantnessMin: 0 },
      company_visit: { supportMin: 100, pleasantnessMin: 100 },
    },
  };
  assert.ok(parseActivityDecisionConfig(legacyNumericConfig), 'legacy numeric configurations remain readable');
  const legacyCustomerDecision = await decideCustomerActivityFeasibility(customerInitiates[0], decisionSnapshot, legacyNumericConfig, organizationJev);
  assert.equal(legacyCustomerDecision.decision, 'allow', 'legacy snapshots and paired thresholds retain historical behavior');
  assert.equal(legacyCustomerDecision.mode, 'numeric', 'legacy customer proposals still pass the stored numeric gate');
  assert.deepEqual(parseActivityDecisionConfig(legacyNumericConfig)?.thresholds.hospitality,
    HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD, 'legacy configs receive the hospitality default threshold when loaded');
  const legacyHospitalityDecision = await decideCustomerActivityFeasibility(
    customerHospitalityCandidates[0], hospitalityBoundarySnapshot, legacyNumericConfig, organizationJev,
  );
  assert.equal(legacyHospitalityDecision.decision, 'allow', 'legacy configs still apply the default hospitality gate');
  assert.equal(legacyHospitalityDecision.mode, 'numeric');
  assert.equal(parseActivityDecisionConfig({
    revision: 11, mode: 'ai', thresholds: { hospitality: { supportMin: 20 } },
  }), null, 'hospitality thresholds must always be a complete support/pleasantness pair');

  await assert.rejects(decideCustomerActivityFeasibility(detectedProposals[0], decisionSnapshot, aiConfig, {
    jevInvoker: async () => { throw new Error('Jev unavailable'); },
  }), (error: unknown) => error instanceof CustomerActivityDecisionError && error.code === 'provider_unavailable',
  'provider failures do not become normal rejection decisions');

  for (const outcome of ['reject', 'need_more'] as const) {
    const frozenDecision = await decideCustomerActivityFeasibility(detectedProposals[0], decisionSnapshot, aiConfig, {
      jevInvoker: async () => jevResult(outcome),
    });
    const initial = recordCustomerActivityProposalDecision(createEmptyCustomerActivityState(), detectedProposals[0], decisionSnapshot, aiConfig, frozenDecision, 30_000);
    const laterRetryCandidate = { ...detectedProposals[0], conversationId: 'new-email-conversation' };
    const laterConfig = { ...aiConfig, revision: aiConfig.revision + 1 };
    const laterAllow = await decideCustomerActivityFeasibility(laterRetryCandidate, { ...decisionSnapshot, support: 100, pleasantness: 100 }, laterConfig, {
      jevInvoker: async () => jevResult('allow'),
    });
    const noResurrection = recordCustomerActivityProposalDecision(initial.state, laterRetryCandidate,
      { ...decisionSnapshot, support: 100, pleasantness: 100 }, laterConfig, laterAllow, 40_000);
    assert.equal(noResurrection.recorded, false, `a normal ${outcome} cannot be reconsidered under newer metrics/config or conversation IDs`);
    assert.equal(noResurrection.state.decisions[0].relationshipSnapshot.support, 70, 'the original metric snapshot remains frozen');
    assert.equal(noResurrection.state.decisions[0].configRevision, aiConfig.revision, 'the original config revision remains frozen');
    assert.equal(noResurrection.state.tasks.length, 0);
  }

  const noProposal = await detectCustomerActivityProposals({
    conversationEnded: true, conversationId: 'no-proposal', npcId: 'P1-002',
    messages: [
      { messageId: 'n1', speaker: 'sales', text: '我们的技术团队能力很强。' },
      { messageId: 'n2', speaker: 'customer', text: '我知道了，谢谢。' },
    ],
  }, { invoker: async () => JSON.stringify({ activities: [] }) });
  assert.deepEqual(noProposal, [], 'high metrics cannot create an activity without a real proposal');

  const roomStarted = startCustomerActivityPlanning(created, task.id, 500_000);
  const roomSaved = saveCustomerActivityDraft(roomStarted, task.id, '先联系项目负责人确认参加人员。', 510_000);
  const endedRoom = finishCustomerActivityPlanningOnRoomEnd(roomSaved.state, 520_000);
  assert.equal(endedRoom.tasks[0].submitReason, 'room_ended');
  assert.equal(endedRoom.tasks[0].submittedAt, 520_000);
  assert.equal(endedRoom.tasks[0].draft, '先联系项目负责人确认参加人员。');
  const endedAfterDeadline = finishCustomerActivityPlanningOnRoomEnd(roomStarted, roomStarted.tasks[0].deadlineAt! + 10);
  assert.equal(endedAfterDeadline.tasks[0].submitReason, 'timeout');
  assert.equal(endedAfterDeadline.tasks[0].submittedAt, roomStarted.tasks[0].deadlineAt);

  const emptyPlanEvaluation = {
    supportDelta: -2,
    pleasureDelta: -3,
    dimensionDeltas: {
      decisionAnalysis: -1,
      relationshipBuilding: 0,
      valuePresentation: -1,
      objectionHandling: 0,
      informationDiscovery: 0,
    },
    overallEvaluation: '活动准备不充分，本次未能推进。',
  };
  let blankPlanAiCalls = 0;
  for (const activityType of ['technical_meeting', 'case_site_visit', 'company_visit'] as const) {
    for (const draft of ['', '   \n\t ']) {
      const blankEvaluation = await evaluateCustomerActivityPlan({
        activityType, summary: '客户活动', conversation: sourceConversation, draft,
      }, { invoker: async () => { blankPlanAiCalls += 1; throw new Error('blank plan is deterministic'); } });
      assert.deepEqual(blankEvaluation, emptyPlanEvaluation,
        `${activityType} treats empty and whitespace-only plans as insufficient preparation`);
    }
  }
  const emptySubmissions = [
    submitCustomerActivityPlan(roomStarted, task.id, 515_000),
    finishCustomerActivityPlanningOnRoomEnd(roomStarted, 520_000),
    finishCustomerActivityPlanningOnRoomEnd(roomStarted, roomStarted.tasks[0].deadlineAt! + 10),
  ];
  for (const [index, submittedBlank] of emptySubmissions.entries()) {
    const blankTask = submittedBlank.tasks[0];
    assert.equal(blankTask.status, 'submitted');
    assert.equal(blankTask.draft, '', 'manual, room-end, and timeout submission preserve an empty draft');
    const blankEvaluation = await evaluateCustomerActivityPlan({
      activityType: blankTask.type, summary: blankTask.summary, conversation: sourceConversation, draft: blankTask.draft,
    }, { invoker: async () => { blankPlanAiCalls += 1; throw new Error('blank plan is deterministic'); } });
    assert.deepEqual(blankEvaluation, emptyPlanEvaluation, `empty submit path ${index} uses the common deterministic rule`);
  }
  assert.equal(blankPlanAiCalls, 0, 'empty activity plans are resolved without an LLM request');

  const validEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '围绕接口适配开展技术交流', conversation: sourceConversation,
    draft: '安排客户技术负责人参加，围绕接口适配准备技术演示和问答。',
  }, { invoker: async (messages, options) => {
    assert.equal(options?.jsonMode, true);
    assert.match(messages[0].content, /overallEvaluation只写一句简短的方案结果/u);
    assert.match(messages[0].content, /不作点评、不解释问题、不提供建议或改进项/u);
    assert.match(messages[0].content, /不要写任何数值、数量、日期、时长/u);
    return JSON.stringify(evaluation);
  } });
  assert.deepEqual(validEvaluation, evaluation);
  const metricLeakEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => JSON.stringify({
    ...evaluation,
    overallEvaluation: '准备充分，支持度增加2分，愉悦度-1，关系建立得分为0。',
  }) });
  assert.equal(metricLeakEvaluation, null, 'overall prose cannot disclose numeric existing-metric changes');
  const totalScoreLeakEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => JSON.stringify({
    ...evaluation,
    overallEvaluation: '总体方案评价为85分。',
  }) });
  assert.equal(totalScoreLeakEvaluation, null, 'overall prose cannot disclose a new total score');
  const businessNumbersEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => JSON.stringify({
    ...evaluation,
    overallEvaluation: '客户对安排有信心，愿意邀请3名技术负责人继续推进。',
  }) });
  assert.ok(businessNumbersEvaluation, 'non-metric wording in legacy/internal evaluation data remains accepted');
  const adviceEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => JSON.stringify({
    ...evaluation,
    overallEvaluation: '客户愿意继续沟通，建议补充参会人员和会后安排。',
  }) });
  assert.ok(adviceEvaluation, 'commentary in internal legacy/provider output does not block evaluation settlement');
  const invalidEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => JSON.stringify({ ...evaluation, totalScore: 100 }) });
  assert.equal(invalidEvaluation, null, 'unexpected scoring fields are rejected');
  const failedEvaluation = await evaluateCustomerActivityPlan({
    activityType: 'technical_meeting', summary: '技术交流会', conversation: sourceConversation, draft: '安排议题和人员。',
  }, { invoker: async () => { throw new Error('provider unavailable'); } });
  assert.equal(failedEvaluation, null, 'provider failures remain retryable without fabricated deltas');

  console.log('Customer activity contract, state transitions, idempotency, source validation and AI failure checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
