import assert from 'node:assert/strict';
import {
  customerActivityReplyInstruction,
  generateNpcReplyWithCustomerActivityGuard,
} from '../src/lib/ai/customer-activity-reply';
import {
  CUSTOMER_ACTIVITY_PLANNING_MS,
  CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
  DEFAULT_ACTIVITY_DECISION_CONFIG,
  RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS,
  decideOrganizationActivityThreshold,
  createEmptyCustomerActivityState,
  finalizeExpiredCustomerActivities,
  getPublicCustomerActivityOutcome,
  parseCustomerActivityState,
  recordCustomerActivityProposalDecision,
  saveCustomerActivityDraft,
  startCustomerActivityPlanning,
  submitCustomerActivityPlan,
  toPublicCustomerActivityTask,
  type CustomerActivityFeasibilityDecision,
  type CustomerActivityConversationMessage,
  type CustomerActivityOrganizationMember,
  type CustomerActivityProposalCandidate,
  type CustomerActivityRelationshipSnapshot,
  type ActivityDecisionConfig,
  type OrganizationActivityThreshold,
} from '../src/lib/game/customer-activities';
import { CustomerActivityDecisionError, CustomerActivityDetectionError, decideCustomerActivityFeasibility, detectCustomerActivityProposals } from '../src/lib/ai/customer-activities';
import { processPendingCustomerActivityDetections } from '../src/lib/game/repository';
import {
  applyCustomerActivityEvaluation,
  appendCustomerActivityDiagnostic,
  completeCustomerActivityProposalDetection,
  createProjectOneState,
  executeGameCommand,
  normalizeProjectOneState,
  pauseProjectTimerForCustomerActivity,
  queueCustomerActivityDetection,
  resumeProjectTimerAfterCustomerActivity,
  submitGame,
  synchronizeProjectTimer,
  toPlayerVisibleGameState,
} from '../src/lib/game/state';

const messages = [
  { messageId: 'sales-1', speaker: 'sales' as const, text: '我们可以安排一次技术交流会。' },
  { messageId: 'customer-1', speaker: 'customer' as const, text: '这类活动还得和项目同事商量。' },
];
const candidate: CustomerActivityProposalCandidate = {
  conversationId: 'email:conversation-1',
  npcId: 'P1-001',
  sourceConversation: messages,
  type: 'technical_meeting',
  initiator: 'sales',
  proposalMessageId: 'sales-1',
  responseMessageId: 'customer-1',
  finalOutcomeMessageId: 'customer-1',
  responseKind: 'ambiguous',
  finalStatus: 'active',
  evidence: [
    { messageId: 'sales-1', speaker: 'sales', kind: 'proposal', quote: '安排一次技术交流会' },
    { messageId: 'customer-1', speaker: 'customer', kind: 'response', quote: '和项目同事商量' },
    { messageId: 'customer-1', speaker: 'customer', kind: 'final_outcome', quote: '这类活动还得和项目同事商量。' },
  ],
  summary: '安排一次技术交流会',
  requiresFeasibility: true,
};
const snapshot: CustomerActivityRelationshipSnapshot = {
  npcId: 'P1-001',
  role: '高层',
  title: '主管副总经理',
  context: '关注项目价值和组织协同。',
  stage: '项目限时推进',
  support: 55,
  pleasantness: 60,
  dimensions: {
    decisionAnalysis: 51,
    relationshipBuilding: 52,
    valuePresentation: 53,
    objectionHandling: 54,
    informationDiscovery: 55,
  },
  organization: {
    members: [
      { npcId: 'P1-001', support: 20, pleasantness: 50 },
      { npcId: 'P1-002', support: 35, pleasantness: 50 },
      { npcId: 'P1-003', support: 40, pleasantness: 50 },
      { npcId: 'P1-004', support: 30, pleasantness: 50 },
      { npcId: 'P1-005', support: 35, pleasantness: 50 },
    ],
  },
};
const allowedDecision: CustomerActivityFeasibilityDecision = {
  decision: 'allow',
  mode: 'numeric',
  configRevision: DEFAULT_ACTIVITY_DECISION_CONFIG.revision,
  reason: '测试冻结关系快照允许推进。',
};
const evaluation = {
  supportDelta: 2,
  pleasureDelta: 3,
  dimensionDeltas: {
    decisionAnalysis: 1,
    relationshipBuilding: 1,
    valuePresentation: 2,
    objectionHandling: 0,
    informationDiscovery: 1,
  },
  overallEvaluation: '议题与客户关切相符，建议补齐参会岗位、讨论范围和会后责任人。',
};

const secondCandidate: CustomerActivityProposalCandidate = {
  ...candidate,
  type: 'case_site_visit',
  proposalMessageId: 'sales-2',
  responseMessageId: 'customer-2',
  finalOutcomeMessageId: 'customer-2',
  sourceConversation: [
    { messageId: 'sales-2', speaker: 'sales', text: '可以安排您参观一个过往项目现场。' },
    { messageId: 'customer-2', speaker: 'customer', text: '我需要和项目负责人商量一下。' },
  ],
  evidence: [
    { messageId: 'sales-2', speaker: 'sales', kind: 'proposal', quote: '参观一个过往项目现场' },
    { messageId: 'customer-2', speaker: 'customer', kind: 'response', quote: '和项目负责人商量' },
    { messageId: 'customer-2', speaker: 'customer', kind: 'final_outcome', quote: '我需要和项目负责人商量一下。' },
  ],
  summary: '参观一个过往项目现场',
};

function stateWithAllowedTask() {
  const initialState = createProjectOneState();
  const allowedTeamNpcIds = ['P1-002', 'P1-004'];
  const state = {
    ...initialState,
    npcAttitudes: Object.fromEntries(Object.entries(initialState.npcAttitudes).map(([npcId, attitude]) => [
      npcId,
      allowedTeamNpcIds.includes(npcId) ? { ...attitude, pleasantness: 55 } : attitude,
    ])),
  };
  const queued = queueCustomerActivityDetection(state, {
    conversationId: candidate.conversationId,
    npcId: candidate.npcId,
    messages,
    relationshipSnapshot: snapshot,
    decisionConfig: DEFAULT_ACTIVITY_DECISION_CONFIG,
  });
  const queuedSnapshot = queued.customerActivityDetectionQueue[0].relationshipSnapshot;
  const recorded = completeCustomerActivityProposalDetection(queued, candidate.conversationId, [
    { candidate, decision: allowedDecision },
  ], 50_000);
  assert.equal(recorded.customerActivityDetectionQueue.length, 0);
  assert.equal(recorded.customerActivities.decisions.length, 1);
  assert.equal(recorded.customerActivities.tasks.length, 1);
  return { state: recorded, queuedSnapshot, task: recorded.customerActivities.tasks[0] };
}

async function testSnapshotFreezeAndQueueDecision() {
  const { state, queuedSnapshot, task } = stateWithAllowedTask();
  const allowedTeamNpcIds = ['P1-002', 'P1-004'];
  assert.equal(task.status, 'pending');
  assert.equal(task.relationshipSnapshot?.support, snapshot.support);
  assert.deepEqual(task.decisionConfig, DEFAULT_ACTIVITY_DECISION_CONFIG);
  assert.equal(queuedSnapshot.support, snapshot.support);
  assert.deepEqual(queuedSnapshot.organization?.members
    .filter((member) => allowedTeamNpcIds.includes(member.npcId))
    .map((member) => member.pleasantness), [55, 55],
  'the task fixture passes the recommended technical path by improving two relevant relationships');

  const existing = parseCustomerActivityState({ version: 1, tasks: [] });
  assert.deepEqual(existing.decisions, [], 'legacy activity state upgrades without dropping tasks');

  const denied = completeCustomerActivityProposalDetection(
    queueCustomerActivityDetection(createProjectOneState(), {
      conversationId: candidate.conversationId,
      npcId: candidate.npcId,
      messages,
      relationshipSnapshot: snapshot,
      decisionConfig: { revision: 1, mode: 'ai', thresholds: {} },
    }),
    candidate.conversationId,
    [{ candidate, decision: { ...allowedDecision, decision: 'reject', mode: 'ai', configRevision: 1, reason: '测试不允许推进。' } }],
    50_000,
  );
  assert.equal(denied.customerActivities.tasks.length, 0, 'reject decisions never create an activity task');
  assert.equal(denied.customerActivities.decisions.length, 1, 'normal reject decisions are consumed and audited');

  const laterCandidate = { ...candidate, conversationId: 'email:conversation-2' };
  const duplicateProposalQueue = queueCustomerActivityDetection(denied, {
    conversationId: laterCandidate.conversationId,
    npcId: laterCandidate.npcId,
    messages,
    relationshipSnapshot: { ...snapshot, support: 100, pleasantness: 100 },
    decisionConfig: DEFAULT_ACTIVITY_DECISION_CONFIG,
  });
  const noRevival = completeCustomerActivityProposalDetection(
    duplicateProposalQueue,
    laterCandidate.conversationId,
    [{ candidate: laterCandidate, decision: allowedDecision }],
    60_000,
  );
  assert.equal(noRevival.customerActivities.tasks.length, 0,
    'a previously rejected source proposal cannot revive under a later transcript/snapshot');
  assert.equal(noRevival.customerActivities.decisions.length, 1);

  const numericConfig = {
    revision: 3,
    mode: 'numeric' as const,
    thresholds: {
      technical_meeting: { supportMin: 50, pleasantnessMin: 50 },
      case_site_visit: { supportMin: 50, pleasantnessMin: 50 },
      company_visit: { supportMin: 50, pleasantnessMin: 50 },
    },
  };
  const numericAllow = await decideCustomerActivityFeasibility(candidate, snapshot, numericConfig);
  assert.equal(numericAllow.decision, 'allow');
  assert.equal(numericAllow.mode, 'numeric');
  const numericRecorded = recordCustomerActivityProposalDecision(
    createEmptyCustomerActivityState(), candidate, snapshot, numericConfig, numericAllow, 60_000,
  );
  assert.equal(numericRecorded.recorded, true);
  assert.equal(numericRecorded.state.tasks.length, 1, 'numeric allow records a task from the frozen snapshot');
  const numericReject = await decideCustomerActivityFeasibility(candidate, { ...snapshot, pleasantness: 49 }, numericConfig);
  assert.equal(numericReject.decision, 'reject');
  const numericRejected = recordCustomerActivityProposalDecision(
    createEmptyCustomerActivityState(), candidate, { ...snapshot, pleasantness: 49 }, numericConfig, numericReject, 60_000,
  );
  assert.equal(numericRejected.recorded, true);
  assert.equal(numericRejected.state.tasks.length, 0, 'numeric reject is audited without creating a task');

  const changedMetrics = {
    ...state,
    npcAttitudes: {
      ...state.npcAttitudes,
      [candidate.npcId]: { ...state.npcAttitudes[candidate.npcId], support: 99, pleasantness: 98 },
    },
  };
  const normalized = normalizeProjectOneState(changedMetrics);
  assert.deepEqual(normalized.customerActivities.tasks[0].relationshipSnapshot, queuedSnapshot,
    'the persisted decision snapshot does not change when current metrics later change');
}

async function testFrozenWholeOrganizationGate() {
  const threshold: OrganizationActivityThreshold = {
    minimumPleasantness: 20,
    paths: [
      {
        id: 'two-person',
        label: '关键两人路径',
        conditions: [
          { npcIds: ['P1-002'], minCount: 1, supportMin: 80, pleasantnessMin: 50 },
          { npcIds: ['P1-004'], minCount: 1, supportMin: 70, pleasantnessMin: 50 },
        ],
      },
      {
        id: 'three-person',
        label: '团队三人路径',
        conditions: [
          { npcIds: [...CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS], minCount: 3, supportMin: 60, pleasantnessMin: 50 },
          { npcIds: ['P1-002', 'P1-004'], minCount: 1, supportMin: 60, pleasantnessMin: 50 },
        ],
      },
    ],
  };
  const organizationConfig: ActivityDecisionConfig = {
    revision: 7,
    mode: 'numeric' as const,
    thresholds: {
      technical_meeting: { organization: threshold },
      case_site_visit: { organization: threshold },
      company_visit: { organization: threshold },
    },
  };

  const initialQueue = queueCustomerActivityDetection(createProjectOneState(), {
    conversationId: 'baseline-organization-snapshot',
    npcId: candidate.npcId,
    messages,
  });
  const initialTeamSnapshot = initialQueue.customerActivityDetectionQueue[0].relationshipSnapshot;
  for (const activityType of ['technical_meeting', 'case_site_visit', 'company_visit'] as const) {
    assert.equal(
      decideOrganizationActivityThreshold(
        initialTeamSnapshot,
        RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[activityType],
      ).decision,
      'reject',
      `the formal opening team state cannot pass the recommended ${activityType} gate`,
    );
  }

  const oneRelationshipImproved = initialTeamSnapshot.organization!.members.map((member) => member.npcId === 'P1-001'
    ? { ...member, pleasantness: 55 }
    : member);
  const onePersonSnapshot = {
    ...initialTeamSnapshot,
    organization: { members: oneRelationshipImproved },
  };
  for (const activityType of ['technical_meeting', 'case_site_visit', 'company_visit'] as const) {
    assert.equal(
      decideOrganizationActivityThreshold(
        onePersonSnapshot,
        RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[activityType],
      ).decision,
      'reject',
      `improving one person's pleasantness alone cannot pass ${activityType}`,
    );
  }

  const recommendedTwoPersonTeam = initialTeamSnapshot.organization!.members.map((member) =>
    ['P1-002', 'P1-004'].includes(member.npcId) ? { ...member, pleasantness: 55 } : member);
  assert.equal(
    decideOrganizationActivityThreshold(
      { ...initialTeamSnapshot, organization: { members: recommendedTwoPersonTeam } },
      RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting,
    ).decision,
    'allow',
    'the recommended two-person route passes after both relevant relationships reach 55 pleasantness',
  );

  const recommendedThreePersonTeam = initialTeamSnapshot.organization!.members.map((member) =>
    ['P1-002', 'P1-003', 'P1-005'].includes(member.npcId) ? { ...member, pleasantness: 55 } : member);
  assert.equal(
    decideOrganizationActivityThreshold(
      { ...initialTeamSnapshot, organization: { members: recommendedThreePersonTeam } },
      RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting,
    ).decision,
    'allow',
    'the recommended three-person route passes without satisfying either two-person path',
  );
  const baseTeam: CustomerActivityOrganizationMember[] = CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) => ({
    npcId,
    support: 10,
    pleasantness: 55,
  }));
  const teamSnapshot = (members: CustomerActivityOrganizationMember[], npcId = candidate.npcId) => ({
    ...snapshot,
    npcId,
    organization: { members },
  });
  const oneHigh = baseTeam.map((member) => member.npcId === 'P1-002'
    ? { ...member, support: 100 }
    : member);
  assert.equal(decideOrganizationActivityThreshold(teamSnapshot(oneHigh), threshold).decision, 'reject',
    'one high-scoring teammate is insufficient');

  const twoRouteTeam = baseTeam.map((member) => member.npcId === 'P1-002'
    ? { ...member, support: 80 }
    : member.npcId === 'P1-004' ? { ...member, support: 70 } : member);
  assert.equal(decideOrganizationActivityThreshold(teamSnapshot(twoRouteTeam), threshold).decision, 'allow',
    'the configured two-person path passes');

  const threeRouteTeam = baseTeam.map((member) => ['P1-001', 'P1-002', 'P1-003'].includes(member.npcId)
    ? { ...member, support: 60 }
    : member);
  assert.equal(decideOrganizationActivityThreshold(teamSnapshot(threeRouteTeam), threshold).decision, 'allow',
    'the configured three-person path passes');

  const nonTargetLow = twoRouteTeam.map((member) => member.npcId === 'P1-005'
    ? { ...member, pleasantness: 19 }
    : member);
  assert.equal(decideOrganizationActivityThreshold(teamSnapshot(nonTargetLow), threshold).decision, 'reject',
    'a non-target teammate can affect the whole-team result');

  const targetIndependentDecisions = await Promise.all(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) =>
    decideCustomerActivityFeasibility(
      { ...candidate, npcId },
      teamSnapshot(twoRouteTeam, npcId),
      organizationConfig,
    )));
  assert.deepEqual(targetIndependentDecisions.map((item) => item.decision), ['allow', 'allow', 'allow', 'allow', 'allow'],
    'the same frozen team produces the same gate result regardless of the conversation target');

  const confirmedCustomerProposal: CustomerActivityProposalCandidate = {
    ...candidate,
    initiator: 'customer',
    proposalMessageId: 'customer-proposal',
    responseMessageId: 'sales-confirmation',
    finalOutcomeMessageId: 'sales-confirmation',
    responseKind: 'explicit_acceptance',
    requiresFeasibility: false,
    sourceConversation: [
      { messageId: 'customer-proposal', speaker: 'customer', text: '能安排一次技术交流会吗？' },
      { messageId: 'sales-confirmation', speaker: 'sales', text: '可以，我来协调技术交流会。' },
    ],
    evidence: [
      { messageId: 'customer-proposal', speaker: 'customer', kind: 'proposal', quote: '安排一次技术交流会' },
      { messageId: 'sales-confirmation', speaker: 'sales', kind: 'response', quote: '我来协调技术交流会' },
      { messageId: 'sales-confirmation', speaker: 'sales', kind: 'final_outcome', quote: '可以，我来协调技术交流会。' },
    ],
  };
  const customerProposalDecision = await decideCustomerActivityFeasibility(
    confirmedCustomerProposal,
    teamSnapshot(oneHigh),
    organizationConfig,
  );
  assert.equal(customerProposalDecision.decision, 'reject',
    'numeric whole-team gates also apply when the customer proposed and sales confirmed');

  const teamState = createProjectOneState();
  const npcAttitudes = { ...teamState.npcAttitudes };
  for (const member of twoRouteTeam) {
    npcAttitudes[member.npcId] = { ...npcAttitudes[member.npcId], support: member.support, pleasantness: member.pleasantness };
  }
  const endedState = { ...teamState, npcAttitudes };
  const queued = queueCustomerActivityDetection(endedState, {
    conversationId: candidate.conversationId,
    npcId: candidate.npcId,
    messages,
    decisionConfig: organizationConfig,
  });
  const frozen = queued.customerActivityDetectionQueue[0].relationshipSnapshot;
  assert.deepEqual(frozen.organization?.members, twoRouteTeam,
    'end-of-conversation queueing freezes the full server-side team');
  assert.deepEqual(frozen.organization?.members.map((member) => member.npcId), CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
    'the frozen organization contains each of the five NPCs exactly once');
  const updatedAttitudes = Object.fromEntries(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) => [
    npcId,
    { ...queued.npcAttitudes[npcId], support: 100, pleasantness: 0 },
  ]));
  const afterRelationshipChange = normalizeProjectOneState({
    ...queued,
    npcAttitudes: updatedAttitudes,
    npcAffinity: Object.fromEntries(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) => [npcId, 100])),
  });
  assert.deepEqual(afterRelationshipChange.customerActivityDetectionQueue[0].relationshipSnapshot, frozen,
    'reloading after metrics change keeps the original end-of-conversation snapshot for retry');
  const firstDecision = await decideCustomerActivityFeasibility(candidate, frozen, organizationConfig);
  const retryDecision = await decideCustomerActivityFeasibility(
    candidate,
    afterRelationshipChange.customerActivityDetectionQueue[0].relationshipSnapshot,
    organizationConfig,
  );
  assert.equal(firstDecision.decision, 'allow');
  assert.equal(retryDecision.decision, firstDecision.decision,
    'later team improvements cannot change the frozen decision on retry');

  const legacySnapshot = { ...frozen };
  delete legacySnapshot.organization;
  const legacyState = normalizeProjectOneState({
    ...queued,
    customerActivityDetectionQueue: [{
      ...queued.customerActivityDetectionQueue[0],
      relationshipSnapshot: legacySnapshot,
    }],
  });
  assert.equal(legacyState.customerActivityDetectionQueue[0].relationshipSnapshot.organization, undefined,
    'legacy snapshots without an organization are not backfilled from current team metrics');
  const legacyDecision = await decideCustomerActivityFeasibility(
    candidate,
    legacyState.customerActivityDetectionQueue[0].relationshipSnapshot,
    organizationConfig,
  );
  assert.equal(legacyDecision.decision, 'reject', 'numeric organization gates fail closed for legacy snapshots');
}

async function testDecisionCheckpointAndCasMemo() {
  const allMessages = [...messages, ...secondCandidate.sourceConversation];
  const candidates = [
    { ...candidate, sourceConversation: allMessages },
    { ...secondCandidate, sourceConversation: allMessages },
  ];
  const checkpointInitialState = createProjectOneState();
  const checkpointEligibleState = {
    ...checkpointInitialState,
    npcAttitudes: Object.fromEntries(Object.entries(checkpointInitialState.npcAttitudes).map(([npcId, attitude]) => [
      npcId,
      ['P1-002', 'P1-004'].includes(npcId) ? { ...attitude, pleasantness: 55 } : attitude,
    ])),
  };
  const checkpointDecisionConfig: ActivityDecisionConfig = { revision: 1, mode: 'ai', thresholds: {} };
  const queuedState = queueCustomerActivityDetection(checkpointEligibleState, {
    conversationId: candidate.conversationId,
    npcId: candidate.npcId,
    messages: allMessages,
    relationshipSnapshot: snapshot,
    decisionConfig: checkpointDecisionConfig,
  });
  const decideCalls = new Map<string, number>();
  let failSecond = true;
  const decide = async (item: CustomerActivityProposalCandidate) => {
    const calls = (decideCalls.get(item.proposalMessageId) ?? 0) + 1;
    decideCalls.set(item.proposalMessageId, calls);
    if (item.proposalMessageId === 'sales-2' && failSecond) throw new CustomerActivityDecisionError('provider_unavailable');
    return {
      ...allowedDecision,
      mode: 'ai' as const,
      configRevision: checkpointDecisionConfig.revision,
      decision: item.proposalMessageId === 'sales-1' ? 'reject' as const : 'allow' as const,
      reason: item.proposalMessageId === 'sales-1' ? '首次判定拒绝。' : '重试后允许。',
    };
  };
  let storedState = queuedState;
  const firstRun = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: storedState }),
    detect: async () => candidates,
    decide,
    now: () => 70_000,
    commit: async (args) => {
      assert.equal(args.expectedVersion, storedState.version);
      storedState = { ...args.state, version: storedState.version + 1 };
      return { state: storedState, result: args.result ?? {}, replayed: false };
    },
  });
  assert.equal(firstRun.state.customerActivityDetectionQueue.length, 1, 'partial checkpoint keeps the detection retryable');
  assert.equal(firstRun.state.customerActivities.decisions[0].decision, 'reject');
  assert.equal(firstRun.state.customerActivities.tasks.length, 0);

  failSecond = false;
  const retry = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: storedState }),
    detect: async () => candidates,
    decide,
    now: () => 80_000,
    commit: async (args) => {
      assert.equal(args.expectedVersion, storedState.version);
      storedState = { ...args.state, version: storedState.version + 1 };
      return { state: storedState, result: args.result ?? {}, replayed: false };
    },
  });
  assert.equal(decideCalls.get('sales-1'), 1, 'a checkpointed rejection cannot be re-evaluated into an allow');
  assert.equal(decideCalls.get('sales-2'), 2, 'the failed candidate can be retried once the provider recovers');
  assert.equal(retry.state.customerActivityDetectionQueue.length, 0);
  assert.equal(retry.state.customerActivities.tasks.length, 1, 'only the later allowed candidate creates a task');
  assert.equal(retry.state.customerActivities.tasks[0].type, 'case_site_visit');

  const casCalls = new Map<string, number>();
  const casDecide = async (item: CustomerActivityProposalCandidate) => {
    casCalls.set(item.proposalMessageId, (casCalls.get(item.proposalMessageId) ?? 0) + 1);
    return {
      ...allowedDecision,
      mode: 'ai' as const,
      configRevision: checkpointDecisionConfig.revision,
      reason: 'CAS conflict retry keeps this result.',
    };
  };
  let casState = queuedState;
  let casCommitCalls = 0;
  const casRun = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: casState }),
    detect: async () => candidates,
    decide: casDecide,
    now: () => 90_000,
    commit: async (args) => {
      casCommitCalls += 1;
      if (casCommitCalls === 1) {
        casState = { ...casState, version: casState.version + 1 };
        throw new Error('STATE_VERSION_CONFLICT');
      }
      assert.equal(args.expectedVersion, casState.version);
      casState = { ...args.state, version: casState.version + 1 };
      return { state: casState, result: args.result ?? {}, replayed: false };
    },
  });
  assert.equal(casCommitCalls, 2, 'CAS conflict retries the atomic commit');
  assert.deepEqual([...casCalls.values()], [1, 1], 'CAS retry does not re-run any successful AI gate');
  assert.equal(casRun.state.customerActivities.tasks.length, 2);

  let switchedState = queuedState;
  let detectionCalls = 0;
  let switchCommits = 0;
  const otherConversation = queueCustomerActivityDetection(createProjectOneState(), {
    conversationId: 'email:conversation-B',
    npcId: candidate.npcId,
    messages,
    relationshipSnapshot: snapshot,
    decisionConfig: DEFAULT_ACTIVITY_DECISION_CONFIG,
  });
  const switched = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: switchedState }),
    detect: async () => { detectionCalls += 1; return candidates; },
    decide: casDecide,
    commit: async () => {
      switchCommits += 1;
      switchedState = { ...otherConversation, version: switchedState.version + 1 };
      throw new Error('STATE_VERSION_CONFLICT');
    },
  });
  assert.equal(detectionCalls, 1);
  assert.equal(switchCommits, 1);
  assert.equal(switched.state.customerActivityDetectionQueue[0]?.conversationId, 'email:conversation-B');
  assert.equal(switched.state.customerActivities.decisions.length, 0, 'a newly headed conversation never receives stale candidates');
}

async function testSalesOnlyDetectionDiagnostics() {
  const salesOnlyMessage = {
    messageId: 'sales-only-proposal',
    speaker: 'sales' as const,
    text: '下周要不要开一次技术交流会，直接对接项目需求？',
  };
  const salesOnlyCandidate: CustomerActivityProposalCandidate = {
    conversationId: 'phone:sales-only',
    npcId: 'P1-001',
    sourceConversation: [salesOnlyMessage],
    type: 'technical_meeting',
    initiator: 'sales',
    proposalMessageId: salesOnlyMessage.messageId,
    responseMessageId: salesOnlyMessage.messageId,
    finalOutcomeMessageId: salesOnlyMessage.messageId,
    responseKind: 'not_required',
    finalStatus: 'active',
    evidence: [{ messageId: salesOnlyMessage.messageId, speaker: 'sales', kind: 'proposal', quote: '开一次技术交流会' }],
    summary: '安排技术交流会',
    requiresFeasibility: true,
  };
  const decisionConfig: ActivityDecisionConfig = { revision: 4, mode: 'ai', thresholds: {} };
  const initial = createProjectOneState();
  const queued = queueCustomerActivityDetection(initial, {
    conversationId: salesOnlyCandidate.conversationId,
    npcId: salesOnlyCandidate.npcId,
    messages: [salesOnlyMessage],
    relationshipSnapshot: snapshot,
    decisionConfig,
  });
  assert.equal(queued.customerActivityDetectionQueue[0]?.messages.length, 1,
    'a sales-only conversation is queued even without a customer response');
  const queueDiagnostics = queued.customerActivityDiagnostics ?? [];
  assert.equal(queueDiagnostics.at(-1)?.event, 'conversation_queued');
  assert.equal(queueDiagnostics.at(-1)?.decisionConfig?.revision, decisionConfig.revision);
  assert.equal(queueDiagnostics.at(-1)?.relationshipSnapshot?.organization?.members.length, 5,
    'queue logs retain the frozen organization-wide snapshot used by the gate');

  let storedState = queued;
  const allowed = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: storedState }),
    detect: async (args, dependencies) => {
      assert.deepEqual(args.messages, [salesOnlyMessage]);
      dependencies?.onDiagnostic?.({
        event: 'candidate_accepted',
        reason: 'sales_proposal_enters_feasibility_without_customer_response',
        activityType: 'technical_meeting',
        messageId: salesOnlyMessage.messageId,
        details: {
          detection_source: 'deterministic_sales_proposal',
          model_skipped_reason: 'sales_proposal_guaranteed_by_rule',
          confidence: 1,
          raw_output: 'must not be persisted',
        },
      });
      return [salesOnlyCandidate];
    },
    decide: async (_candidate, _snapshot, config) => ({
      decision: 'allow', mode: 'ai', configRevision: config.revision, reason: '整体条件允许继续。',
    }),
    now: () => 120_000,
    commit: async (args) => {
      storedState = { ...args.state, version: storedState.version + 1 };
      return { state: storedState, result: args.result ?? {}, replayed: false };
    },
  });
  assert.equal(allowed.state.customerActivityDetectionQueue.length, 0);
  assert.equal(allowed.state.customerActivities.tasks.length, 1, 'the sales proposal can create a task after the gate allows it');
  const events = allowed.state.customerActivityDiagnostics ?? [];
  assert.ok(events.some((item) => item.event === 'detection_started'));
  const accepted = events.find((item) => item.event === 'candidate_accepted');
  assert.equal(accepted?.details?.detection_source, 'deterministic_sales_proposal');
  assert.equal(accepted?.details?.model_skipped_reason, 'sales_proposal_guaranteed_by_rule');
  assert.equal('raw_output' in (accepted?.details ?? {}), false, 'diagnostics never store arbitrary model output');
  assert.ok(events.some((item) => item.event === 'candidate_count' && item.details?.candidate_count === 1));
  const allowDecision = events.find((item) => item.event === 'threshold_decision');
  assert.equal(allowDecision?.details?.threshold_decision, 'allow');
  assert.equal(allowDecision?.details?.config_revision, decisionConfig.revision);
  assert.equal(events.at(-1)?.event, 'task_created');
  const publicState = toPlayerVisibleGameState(allowed.state);
  assert.equal('customerActivityDiagnostics' in publicState, false, 'internal activity diagnostics never cross the player projection');

  const rejectedCandidate = {
    ...salesOnlyCandidate,
    conversationId: 'phone:sales-only-rejected',
    proposalMessageId: 'sales-only-proposal-rejected',
    responseMessageId: 'sales-only-proposal-rejected',
    finalOutcomeMessageId: 'sales-only-proposal-rejected',
    sourceConversation: [{ ...salesOnlyMessage, messageId: 'sales-only-proposal-rejected' }],
    evidence: [{ ...salesOnlyCandidate.evidence[0], messageId: 'sales-only-proposal-rejected' }],
  } satisfies CustomerActivityProposalCandidate;
  let rejectedState = queueCustomerActivityDetection(createProjectOneState(), {
    conversationId: rejectedCandidate.conversationId,
    npcId: rejectedCandidate.npcId,
    messages: rejectedCandidate.sourceConversation,
    relationshipSnapshot: snapshot,
    decisionConfig,
  });
  const rejected = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: rejectedState }),
    detect: async () => [rejectedCandidate],
    decide: async (_candidate, _snapshot, config) => ({
      decision: 'reject', mode: 'ai', configRevision: config.revision, reason: '组织整体支持条件未达到。',
    }),
    now: () => 130_000,
    commit: async (args) => {
      rejectedState = { ...args.state, version: rejectedState.version + 1 };
      return { state: rejectedState, result: args.result ?? {}, replayed: false };
    },
  });
  const rejectDecision = (rejected.state.customerActivityDiagnostics ?? []).find((item) => item.event === 'threshold_decision');
  assert.equal(rejectDecision?.details?.threshold_decision, 'reject');
  assert.equal(rejectDecision?.reason, '组织整体支持条件未达到。');
  assert.equal(rejected.state.customerActivities.tasks.length, 0);

  let failedState = queueCustomerActivityDetection(createProjectOneState(), {
    conversationId: 'phone:detection-failure',
    npcId: 'P1-001',
    messages: [salesOnlyMessage],
    relationshipSnapshot: snapshot,
    decisionConfig,
  });
  const failed = await processPendingCustomerActivityDetections('test-session', 'test-user', {
    load: async () => ({ id: 'test-session', userId: 'test-user', state: failedState }),
    detect: async (_args, dependencies) => {
      dependencies?.onDiagnostic?.({ event: 'model_error', reason: 'provider_unavailable' });
      throw new CustomerActivityDetectionError('provider_unavailable');
    },
    now: () => 140_000,
    commit: async (args) => {
      failedState = { ...args.state, version: failedState.version + 1 };
      return { state: failedState, result: args.result ?? {}, replayed: false };
    },
  });
  assert.equal(failed.state.customerActivityDetectionQueue.length, 1, 'failed detection remains retryable');
  const failureDiagnostics = failed.state.customerActivityDiagnostics ?? [];
  assert.ok(failureDiagnostics.some((item) => item.event === 'model_error'));
  assert.ok(failureDiagnostics.some((item) => item.event === 'detection_failed'));

  let bounded = createProjectOneState();
  for (let index = 0; index < 105; index += 1) {
    bounded = appendCustomerActivityDiagnostic(bounded, { event: `test_${index}`, at: index });
  }
  const boundedDiagnostics = bounded.customerActivityDiagnostics ?? [];
  assert.equal(boundedDiagnostics.length, 100, 'diagnostic history is bounded');
  assert.equal(boundedDiagnostics[0]?.event, 'test_5');
  const migrated = normalizeProjectOneState({ ...createProjectOneState(), customerActivityDiagnostics: undefined });
  assert.deepEqual(migrated.customerActivityDiagnostics, [], 'old saves restore without diagnostic history');
}

function testServerClockDeadlineAndNoFreeProjectTime() {
  const { state, task } = stateWithAllowedTask();
  const startedAt = 100_000;
  const startWithTimer = {
    ...state,
    projectTimer: { ...state.projectTimer, lastResumedAt: new Date(startedAt - 30_000).toISOString() },
  };
  const activities = startCustomerActivityPlanning(startWithTimer.customerActivities, task.id, startedAt);
  const paused = pauseProjectTimerForCustomerActivity({ ...startWithTimer, customerActivities: activities }, startedAt);
  const planning = paused.customerActivities.tasks[0];
  assert.equal(planning.status, 'planning');
  assert.equal(planning.deadlineAt, startedAt + CUSTOMER_ACTIVITY_PLANNING_MS);
  assert.equal(paused.projectTimer.elapsedMs, 30_000, 'project clock is materialised up to the planning start');
  assert.equal(paused.projectTimer.visitPaused, true);

  const saved = saveCustomerActivityDraft(paused.customerActivities, task.id, '明确议题、参会角色、案例材料和会后责任人。', startedAt + 60_000);
  assert.equal(saved.accepted, true);
  const stillPaused = synchronizeProjectTimer({ ...paused, customerActivities: saved.state }, planning.deadlineAt! + 120_000, true);
  assert.equal(stillPaused.projectTimer.elapsedMs, 30_000, 'a closed browser does not let the paused project clock advance');
  assert.equal(stillPaused.actionPoints, paused.actionPoints, 'no AP recovers during the activity-planning window');

  const timedOut = finalizeExpiredCustomerActivities(saved.state, planning.deadlineAt! + 120_000);
  const submitted = timedOut.tasks[0];
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submitReason, 'timeout');
  assert.equal(submitted.submittedAt, planning.deadlineAt, 'timeout is anchored to the original server deadline');
  assert.equal(submitted.draft, '明确议题、参会角色、案例材料和会后责任人。', 'timeout submits the last server-saved draft');

  const resumed = resumeProjectTimerAfterCustomerActivity({ ...paused, customerActivities: timedOut }, planning.deadlineAt!);
  const afterDeadline = synchronizeProjectTimer(resumed, planning.deadlineAt! + 20_000, true);
  assert.equal(afterDeadline.projectTimer.elapsedMs, 50_000, 'only time after the exact activity deadline counts');
  assert.equal(afterDeadline.actionPoints, paused.actionPoints, 'short post-deadline time does not create an AP recovery');

  const submittedEarly = submitCustomerActivityPlan(saved.state, task.id, startedAt + 90_000);
  assert.equal(submittedEarly.tasks[0].submitReason, 'manual');
  assert.equal(submittedEarly.tasks[0].submittedAt, startedAt + 90_000);
  assert.deepEqual(submitCustomerActivityPlan(submittedEarly, task.id, startedAt + 100_000), submittedEarly,
    'manual submit replay does not alter the submitted plan');

  const blocked = { ...paused, customerActivities: activities };
  assert.throws(() => executeGameCommand(blocked, {
    commandId: 'activity-blocks-action',
    expectedVersion: blocked.version,
    type: 'research_public_info',
    payload: { npcId: 'P1-004' },
  }), /CUSTOMER_ACTIVITY_PLANNING_ACTIVE/u);
}

function testEvaluationOnceAndPublicProjection() {
  const { state, task } = stateWithAllowedTask();
  const now = 200_000;
  const started = startCustomerActivityPlanning(state.customerActivities, task.id, now);
  const withPlan = saveCustomerActivityDraft(started, task.id,
    '围绕客户目标准备活动议题、参会角色和后续跟进安排。', now + 5_000);
  const submitted = submitCustomerActivityPlan(withPlan.state, task.id, now + 10_000);
  const beforeEvaluation = { ...state, customerActivities: submitted };
  const before = {
    support: beforeEvaluation.npcAttitudes[candidate.npcId].support,
    pleasantness: beforeEvaluation.npcAttitudes[candidate.npcId].pleasantness,
    dimensions: { ...beforeEvaluation.dimensions },
    actionPoints: beforeEvaluation.actionPoints,
    elapsedMs: beforeEvaluation.projectTimer.elapsedMs,
  };

  const evaluated = applyCustomerActivityEvaluation(beforeEvaluation, task.id, evaluation, now + 11_000);
  assert.equal(evaluated.npcAttitudes[candidate.npcId].support, before.support + evaluation.supportDelta);
  assert.equal(evaluated.npcAttitudes[candidate.npcId].pleasantness, before.pleasantness + evaluation.pleasureDelta);
  assert.equal(evaluated.dimensions.valuePresentation, before.dimensions.valuePresentation + 2);
  assert.equal(evaluated.actionPoints, before.actionPoints, 'activity scoring does not grant AP');
  assert.equal(evaluated.projectTimer.elapsedMs, before.elapsedMs, 'activity scoring does not add game time');
  assert.deepEqual(applyCustomerActivityEvaluation(evaluated, task.id, evaluation, now + 12_000), evaluated,
    'the evaluation marker and metric changes are idempotent');

  const publicTask = toPublicCustomerActivityTask(evaluated.customerActivities.tasks[0]);
  assert.deepEqual(Object.keys(publicTask.evaluation ?? {}), ['overallEvaluation']);
  assert.equal(publicTask.evaluation?.overallEvaluation, '本次方案有助于推进后续活动沟通。');
  assert.notEqual(publicTask.evaluation?.overallEvaluation, evaluation.overallEvaluation,
    'the player projection does not expose model-generated commentary');
  assert.deepEqual(evaluated.customerActivities.tasks[0].evaluation, evaluation,
    'the original internal evaluation remains stored unchanged');
  assert.equal(getPublicCustomerActivityOutcome('方案内容', { supportDelta: -1, pleasureDelta: 0 }),
    '本次方案未能推动后续活动沟通。');
  assert.equal(getPublicCustomerActivityOutcome('方案内容', { supportDelta: 0, pleasureDelta: 0 }),
    '本次方案暂未带来进一步推进。');
  assert.equal(getPublicCustomerActivityOutcome('方案内容', { supportDelta: 1, pleasureDelta: -1 }),
    '本次方案对后续活动沟通的推动作用有限。');
  assert.equal(getPublicCustomerActivityOutcome('  \n ', { supportDelta: 3, pleasureDelta: 4 }),
    '活动准备不充分，本次未能推进。');
  assert.equal(getPublicCustomerActivityOutcome('', { supportDelta: 3, pleasureDelta: 4 }),
    '活动准备不充分，本次未能推进。');
  assert.equal(/support|pleasure|支持度|愉悦度|\d/u.test(publicTask.evaluation?.overallEvaluation ?? ''), false,
    'the public result reveals neither metric labels nor numeric values');
  assert.equal('evidence' in publicTask, false);
  assert.equal('sourceConversation' in publicTask, false);
  const publicState = toPlayerVisibleGameState(evaluated);
  assert.equal(Array.isArray(publicState.customerActivities), true);
  assert.equal('customerActivityDetectionQueue' in publicState, false);
  assert.equal(JSON.stringify(publicState).includes('supportDelta'), false, 'numeric deltas stay server-side');

  const { state: blankState, task: blankTask } = stateWithAllowedTask();
  const lowBaseline = {
    ...blankState,
    npcAttitudes: {
      ...blankState.npcAttitudes,
      [candidate.npcId]: { ...blankState.npcAttitudes[candidate.npcId], support: 1, pleasantness: 2 },
    },
    dimensions: { ...blankState.dimensions, decisionAnalysis: 0, valuePresentation: 0 },
  };
  const blankSubmitted = submitCustomerActivityPlan(
    startCustomerActivityPlanning(lowBaseline.customerActivities, blankTask.id, now), blankTask.id, now + 10_000,
  );
  const blankBeforeEvaluation = { ...lowBaseline, customerActivities: blankSubmitted };
  const blankEvaluation = {
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
  const blankEvaluated = applyCustomerActivityEvaluation(blankBeforeEvaluation, blankTask.id, blankEvaluation, now + 11_000);
  assert.equal(blankEvaluated.npcAttitudes[candidate.npcId].support, 0, 'negative support effect clamps at its lower bound');
  assert.equal(blankEvaluated.npcAttitudes[candidate.npcId].pleasantness, 0, 'negative pleasure effect clamps at its lower bound');
  assert.equal(blankEvaluated.dimensions.decisionAnalysis, 0, 'negative dimension effect clamps at its lower bound');
  assert.equal(blankEvaluated.dimensions.valuePresentation, 0, 'all negative dimensions stay within their lower bounds');
  assert.equal(blankEvaluated.actionPoints, blankBeforeEvaluation.actionPoints, 'blank-plan scoring does not cost or grant AP');
  assert.equal(blankEvaluated.projectTimer.elapsedMs, blankBeforeEvaluation.projectTimer.elapsedMs, 'blank-plan scoring does not advance game time');
  assert.deepEqual(applyCustomerActivityEvaluation(blankEvaluated, blankTask.id, blankEvaluation, now + 12_000), blankEvaluated,
    'an empty-plan penalty is applied once even if evaluation recovery is replayed');
  const blankPublicTask = toPublicCustomerActivityTask(blankEvaluated.customerActivities.tasks[0]);
  assert.equal(blankPublicTask.evaluation?.overallEvaluation, '活动准备不充分，本次未能推进。');

  const unresolved = {
    ...state,
    customerActivities: submitCustomerActivityPlan(
      startCustomerActivityPlanning(state.customerActivities, task.id, now), task.id, now + 10_000,
    ),
  };
  assert.equal(submitGame(unresolved, 'activity-unsettled').status, 'playing',
    'submitGame cannot settle before activity evaluation');
  assert.throws(() => executeGameCommand(unresolved, {
    commandId: 'activity-evaluation-blocks-action',
    expectedVersion: unresolved.version,
    type: 'research_public_info',
    payload: { npcId: 'P1-004' },
  }), /CUSTOMER_ACTIVITY_EVALUATION_PENDING/u);
}

async function testRoleAwareActivityReplyGuard() {
  const senior = { id: 'P1-001', name: '张建国', title: '主管副总经理', category: '高层' as const };
  const context = {
    playerMessage: '下周三方便安排一次技术交流会吗？',
    recentConversation: [{ speaker: 'sales' as const, text: '我们想安排一次技术交流会。' }],
  };
  assert.match(customerActivityReplyInstruction(senior.category), /本人.*考虑|内部商量/u);
  let calls = 0;
  const ambiguous = await generateNpcReplyWithCustomerActivityGuard(senior, 'offline', async () => {
    calls += 1;
    return '我先结合项目情况考虑，必要时和公司内部商量，再给您反馈。';
  }, { context, invoker: async () => JSON.stringify({ decision: 'allowed', issue: 'none' }) });
  assert.equal(ambiguous.source, 'generated');
  assert.equal(calls, 1, 'valid role-aware ambiguity passes without repair');

  calls = 0;
  const corrected = await generateNpcReplyWithCustomerActivityGuard(senior, 'email', async () => {
    calls += 1;
    return calls === 1
      ? '可以安排技术交流会，不过价格暂时不能定。'
      : '我先结合项目情况考虑，必要时和公司内部商量，再给您反馈。';
  }, { context, invoker: async () => calls === 1
    ? JSON.stringify({ decision: 'violation', issue: 'premature_acceptance', evidence: '可以安排技术交流会' })
    : JSON.stringify({ decision: 'allowed', issue: 'none' }) });
  assert.equal(corrected.source, 'repaired');
  assert.equal(calls, 2, 'a definite agreement clause is corrected once despite a later caveat');
}

async function testHospitalityFormalServiceFlow() {
  const targetNpcId = 'P1-002' as const;
  const decisionConfig: ActivityDecisionConfig = { revision: 21, mode: 'ai', thresholds: {} };
  const plan = '先确认客户的用餐与饮酒偏好，选择安静合规的场合，控制交流时长；围绕项目问题交流，不劝酒、不作采购承诺，会后发送简短纪要并确认下一步。';
  const salesMessages: CustomerActivityConversationMessage[] = [
    { messageId: 'formal-hospitality-sales', speaker: 'sales', text: '赵老师，周末要不要喝酒？我也想听听您对项目安排的想法。' },
    { messageId: 'formal-hospitality-customer', speaker: 'customer', text: '我先结合工作安排考虑一下，之后再给您反馈。' },
  ];

  async function runDetection(
    key: string,
    messages: CustomerActivityConversationMessage[],
    support: number,
    pleasantness: number,
  ) {
    const initial = createProjectOneState();
    const npcAttitudes = Object.fromEntries(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((npcId) => [
      npcId,
      { ...initial.npcAttitudes[npcId], support: npcId === targetNpcId ? support : 0, pleasantness: npcId === targetNpcId ? pleasantness : 0 },
    ])) as typeof initial.npcAttitudes;
    const queued = queueCustomerActivityDetection({ ...initial, npcAttitudes }, {
      conversationId: `email:${key}`,
      npcId: targetNpcId,
      messages,
      decisionConfig,
    });
    let storedState = queued;
    let decisionCount = 0;
    const result = await processPendingCustomerActivityDetections(`session-${key}`, 'test-user', {
      load: async () => ({ id: `session-${key}`, userId: 'test-user', state: storedState }),
      detect: async (args) => detectCustomerActivityProposals(args, {
        invoker: async () => {
          if (messages === salesMessages) return JSON.stringify({ activities: [] });
          const customerProposal = messages.find((message) => message.speaker === 'customer' && /吃饭|聚餐|饭局|喝酒/u.test(message.text));
          const salesConfirmation = messages.find((message) => message.speaker === 'sales' && /吃饭|聚餐|饭局|喝酒/u.test(message.text));
          assert.ok(customerProposal && salesConfirmation, 'the customer proposal and sales confirmation are present in the ended conversation');
          return JSON.stringify({ activities: [{
            type: 'hospitality',
            initiator: 'customer',
            proposal: { messageId: customerProposal.messageId, quote: '一起吃个饭' },
            response: { messageId: salesConfirmation.messageId, quote: '可以，我愿意一起吃饭', kind: 'explicit_acceptance' },
            finalStatus: 'active',
            finalOutcome: { messageId: salesConfirmation.messageId, quote: salesConfirmation.text },
            confidence: 0.99,
          }] });
        },
      }),
      decide: async (candidate, frozenSnapshot, frozenConfig) => {
        decisionCount += 1;
        return decideCustomerActivityFeasibility(candidate, frozenSnapshot, frozenConfig, {
          invoker: async () => { throw new Error('hospitality uses its numeric gate under global AI mode'); },
          jevInvoker: async () => { throw new Error('hospitality must not use Jev'); },
        });
      },
      now: () => 310_000,
      commit: async (args) => {
        storedState = { ...args.state, version: storedState.version + 1 };
        return { state: storedState, result: args.result ?? {}, replayed: false };
      },
    });
    assert.equal(decisionCount, result.state.customerActivities.decisions.length,
      'each detected hospitality candidate records one authoritative numeric decision');
    return { result, get state() { return storedState; } };
  }

  const allowed = await runDetection('formal-hospitality-allowed', salesMessages, 15, 55);
  assert.equal(allowed.state.customerActivities.tasks.length, 1,
    'target metrics at 15/55 pass even when the other four organization members are 0/0');
  const task = allowed.state.customerActivities.tasks[0];
  assert.equal(task.type, 'hospitality');
  assert.equal(task.npcId, targetNpcId);
  assert.equal(task.decisionMode, 'numeric');
  assert.equal(allowed.state.customerActivities.decisions[0]?.mode, 'numeric',
    'global AI configuration cannot bypass the hospitality numeric gate');
  assert.equal(allowed.state.customerActivityDetectionQueue.length, 0,
    'the ended conversation is consumed after matching');

  let planning = startCustomerActivityPlanning(allowed.state.customerActivities, task.id, 311_000);
  const saved = saveCustomerActivityDraft(planning, task.id, plan, 312_000);
  assert.equal(saved.state.tasks[0]?.draft, plan, 'the player strategy draft is saved by the formal activity domain');
  const submitted = submitCustomerActivityPlan(saved.state, task.id, 313_000);
  assert.equal(submitted.tasks[0]?.status, 'submitted');
  assert.equal(submitted.tasks[0]?.draft, plan);
  const beforeEvaluation = { ...allowed.state, customerActivities: submitted };
  const evaluated = applyCustomerActivityEvaluation(beforeEvaluation, task.id, evaluation, 314_000);
  assert.equal(evaluated.customerActivities.tasks[0]?.evaluation?.overallEvaluation, evaluation.overallEvaluation);
  assert.deepEqual(applyCustomerActivityEvaluation(evaluated, task.id, evaluation, 315_000), evaluated,
    'formal activity settlement is idempotent');
  const publicState = toPlayerVisibleGameState(evaluated);
  assert.equal(JSON.stringify(publicState).includes('relationshipSnapshot'), false,
    'the formal player projection hides the frozen relationship snapshot');
  assert.equal(JSON.stringify(publicState).includes('supportMin'), false,
    'the formal player projection hides numeric hospitality thresholds');

  const belowSupport = await runDetection('formal-hospitality-low-support', salesMessages, 14, 55);
  assert.equal(belowSupport.state.customerActivities.tasks.length, 0);
  assert.equal(belowSupport.state.customerActivities.decisions[0]?.decision, 'reject',
    'a target support score below 15 blocks the hospitality event');
  const belowPleasantness = await runDetection('formal-hospitality-low-pleasantness', salesMessages, 15, 54);
  assert.equal(belowPleasantness.state.customerActivities.tasks.length, 0);
  assert.equal(belowPleasantness.state.customerActivities.decisions[0]?.decision, 'reject',
    'a target pleasantness score below 55 blocks the hospitality event');

  const customerMessages: CustomerActivityConversationMessage[] = [
    { messageId: 'formal-hospitality-customer-proposal', speaker: 'customer', text: '我们周五项目组聚餐，您要不要一起吃个饭？' },
    { messageId: 'formal-hospitality-sales-confirmation', speaker: 'sales', text: '可以，我愿意一起吃饭。' },
  ];
  const customerConfirmed = await runDetection('formal-hospitality-customer-confirmed', customerMessages, 15, 55);
  assert.equal(customerConfirmed.state.customerActivities.tasks.length, 1,
    'a customer-initiated proposal becomes an event after sales explicitly confirms');
  assert.equal(customerConfirmed.state.customerActivities.tasks[0]?.initiator, 'customer');
  assert.equal(customerConfirmed.state.customerActivities.tasks[0]?.responseKind, 'explicit_acceptance');
  assert.equal(customerConfirmed.state.customerActivities.tasks[0]?.decisionMode, 'numeric',
    'customer confirmation still runs the target-customer threshold');
  planning = startCustomerActivityPlanning(customerConfirmed.state.customerActivities, customerConfirmed.state.customerActivities.tasks[0].id, 320_000);
  assert.equal(planning.tasks[0]?.status, 'planning');
}

async function main() {
  await testSnapshotFreezeAndQueueDecision();
  await testFrozenWholeOrganizationGate();
  await testDecisionCheckpointAndCasMemo();
  await testSalesOnlyDetectionDiagnostics();
  testServerClockDeadlineAndNoFreeProjectTime();
  testEvaluationOnceAndPublicProjection();
  await testRoleAwareActivityReplyGuard();
  await testHospitalityFormalServiceFlow();
  console.log('Formal customer activity queue, snapshot gating, planning timer, settlement idempotency and privacy tests passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
