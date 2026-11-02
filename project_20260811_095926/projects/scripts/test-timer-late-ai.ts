import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { resolve } from 'node:path';
import {
  createProjectOneState,
  PROJECT_TIMER_DURATION_MS,
  synchronizeProjectTimer,
  type GameRuntimeState,
} from '../src/lib/game/state';

/**
 * Calls the real App Router handlers with local model, identity, and repository
 * doubles. Run with `node -r tsx/cjs scripts/test-timer-late-ai.ts` from
 * projects/. No provider, Supabase client, or network connection is used.
 */

const SESSION_ID = 'timer-late-test-session';
const USER_ID = 'timer-late-test-user';
const NPC_ID = 'P1-001';
const START_TIME = Date.parse('2026-10-12T01:00:00.000Z');
const TIMER_CHECKPOINT_MS = 18 * 60 * 1000;
const EXPECTED_AP_AFTER_FINAL_CHECKPOINT = 14;

let fakeNow = START_TIME;
let activeState: GameRuntimeState;
let timerCommits: Array<{ state: GameRuntimeState; expired: boolean }> = [];
type MemoryCommit = {
  sessionId: string;
  expectedVersion: number;
  state: GameRuntimeState;
  commandType: string;
  result?: Record<string, unknown>;
  chatMessages?: unknown[];
  [key: string]: unknown;
};
let businessCommits: MemoryCommit[] = [];
let modelCalls = { plan: 0, messageDecision: 0, stream: 0, evaluator: 0 };
let clockAdvance = { plan: 0, messageDecision: 0, stream: 0 };

function resetSession(options: { pausedVisit?: boolean } = {}) {
  const state = createProjectOneState();
  state.actionPoints = 9;
  state.projectTimer = {
    durationMs: PROJECT_TIMER_DURATION_MS,
    elapsedMs: TIMER_CHECKPOINT_MS,
    lastResumedAt: options.pausedVisit ? null : new Date(fakeNow).toISOString(),
    recoveredIntervals: 3,
    visitPaused: Boolean(options.pausedVisit),
  };

  const contact = state.npcContacts[NPC_ID];
  state.npcContacts = {
    ...state.npcContacts,
    [NPC_ID]: {
      ...contact,
      status: 'online',
      initialChannel: 'email',
      hasReplied: true,
    },
  };

  if (options.pausedVisit) {
    state.projectTimer.elapsedMs = 19 * 60 * 1000 + 40_000;
    state.activeMeeting = {
      id: 'meeting-final-reply',
      npcId: NPC_ID,
      actionId: 'visit',
      appointmentId: 'appointment-final-reply',
      visitType: 'formal',
      turnCount: 1,
      maxTurns: 20,
      durationMinutes: 40,
      startedAt: new Date(fakeNow).toISOString(),
      workTopicOpenedBy: null,
      usedPreparationIds: [],
      completedTasks: [],
      awaitingFinalReplyFrom: 'player',
    };
  }

  activeState = state;
  timerCommits = [];
  businessCommits = [];
  modelCalls = { plan: 0, messageDecision: 0, stream: 0, evaluator: 0 };
  clockAdvance = { plan: 0, messageDecision: 0, stream: 0 };
}

function synchronizeMemoryTimer(): GameRuntimeState {
  const next = synchronizeProjectTimer(activeState, fakeNow, false);
  if (next !== activeState) {
    activeState = { ...next, version: activeState.version + 1 };
    timerCommits.push({
      state: activeState,
      expired: activeState.status !== 'playing',
    });
  }
  return activeState;
}

function evaluationStub() {
  modelCalls.evaluator += 1;
  return {
    affinityDelta: 1,
    affinityReason: '本地计时测试模型评价',
    pleasureDelta: 1,
    supportDelta: 1,
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
    workTopicOpenedBy: 'none',
    semanticFlags: {
      negativeInformation: false,
      negativeInformationType: 'none',
      riskyConduct: false,
      giftMentioned: false,
      explicitQuidProQuo: false,
      repeatedPressure: false,
    },
    giftAssessment: {
      giftType: 'none',
      outcome: 'not_applicable',
      riskLevel: 'none',
      riskReason: '本轮未涉及礼品',
    },
    handoff: null,
    emotion: 'thinking',
  };
}

const stubRepo = {
  async synchronizeOwnedGameTimer() {
    return { state: synchronizeMemoryTimer() };
  },
  async getCommittedGameCommand() {
    return null;
  },
  async commitGameCommand(args: MemoryCommit) {
    assert.equal(args.sessionId, SESSION_ID);
    assert.equal(args.expectedVersion, activeState.version, 'business commit uses the current state version');
    assert.equal(args.state.version, activeState.version, 'route cannot submit a stale state snapshot');
    const committed = synchronizeProjectTimer(args.state, fakeNow, true);
    activeState = { ...committed, version: activeState.version + 1 };
    businessCommits.push(args);
    return { state: activeState, result: args.result ?? {}, replayed: false };
  },
  async assertOwnedMultiplayerRoomRunning() {},
  async deliverPendingNpcHandoffs() {},
  async appendGameEvent() {},
  async appendCompetitorClaim() {},
  async getNpcConversation() {
    return [];
  },
  async getNpcInbox() {
    return [];
  },
};

const fakePromptConfig = {
  liveCustomerPrompt: '',
  liveEvaluatorPrompt: '',
  npcRolePrompts: {},
  supportTierThresholds: {},
};

const moduleMocks: Record<string, unknown> = {
  '@/lib/ai/client': {
    async *streamLLM() {
      modelCalls.stream += 1;
      fakeNow += clockAdvance.stream;
      yield '我会按公开项目要求核对验收范围和材料节点。';
    },
  },
  '@/lib/ai/formal-workflow': {
    async evaluateFormalWorkPlan() {
      modelCalls.plan += 1;
      fakeNow += clockAdvance.plan;
      return {
        needsDetail: false,
        recommendations: ['形成核对清单，并确认对应责任人与时间点。'],
        disclosures: [],
      };
    },
    async evaluateFormalVisitPreparation() {
      throw new Error('unexpected preparation evaluator call');
    },
    async evaluateFormalBriefVisit() {
      throw new Error('unexpected brief visit evaluator call');
    },
  },
  '@/lib/ai/npc-evaluation': {
    async evaluateNpcTurn() {
      return { evaluation: evaluationStub(), source: 'local_test_stub', validationErrors: [] };
    },
    sanitizeReadNoReplyEvaluation(value: unknown) {
      return value;
    },
    async evaluateGiftDecision() {
      throw new Error('unexpected gift evaluator call');
    },
  },
  '@/lib/ai/npc-speaker-identity': {
    npcSpeakerIdentityInstruction: () => 'local test identity prompt',
    async generateNpcReplyWithIdentityGuard(_npc: unknown, _channel: unknown, generate: () => Promise<string>) {
      return { reply: await generate() };
    },
  },
  '@/lib/ai/formal-visit-decision': {
    async decideFormalMessageResponse() {
      modelCalls.messageDecision += 1;
      fakeNow += clockAdvance.messageDecision;
      return { responseAction: 'reply' };
    },
    async evaluateFormalVisitTurn() {
      return { completedTask: null, playerFarewell: false, npcFarewell: false, npcLeft: false };
    },
  },
  '@/lib/auth/guard': {
    authGuard: () => ({ ok: true, session: { userId: USER_ID } }),
  },
  '@/lib/game/repository': stubRepo,
  '@/lib/game/server-random': {
    createServerProbabilitySeed: (parts: string[]) => parts.join(':'),
  },
  '@/lib/game/memory': {
    async refreshConversationMemory(_sessionId: string, _npcId: string, state: GameRuntimeState) {
      return state;
    },
  },
  '@/lib/testing/fast-test-observability': {
    runWithFastTestObservability: (_userId: string, work: () => unknown) => work(),
  },
  '@/lib/designer/prompt-config': {
    DEFAULT_PROJECT_ONE_PROMPT_CONFIG: fakePromptConfig,
    composeNpcRolePrompt: () => 'local test role prompt',
  },
  '@/lib/designer/prompt-config-repository': {
    async loadProjectOnePromptConfig() {
      return { config: fakePromptConfig };
    },
  },
};

const moduleApi = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleApi._load;
moduleApi._load = function loadWithLocalDoubles(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(moduleMocks, request)) return moduleMocks[request];
  return originalLoad.call(this, request, parent, isMain);
};

const nodeRequire = createRequire(__filename);
const commandsRoute = nodeRequire(resolve(__dirname, '../src/app/api/game/sessions/[id]/commands/route.ts')) as {
  POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
};
const chatStreamRoute = nodeRequire(resolve(__dirname, '../src/app/api/chat/stream/route.ts')) as {
  POST: (request: Request) => Promise<Response>;
};

function requestWithJson(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function assertDeadlineWasPersistedWithoutBusinessEffects(label: string) {
  assert.notEqual(activeState.status, 'playing', `${label}: the persisted session is terminal`);
  assert.equal(activeState.projectTimer.elapsedMs, PROJECT_TIMER_DURATION_MS, `${label}: timer reached its deadline`);
  assert.equal(activeState.actionPoints, EXPECTED_AP_AFTER_FINAL_CHECKPOINT, `${label}: only the final passive +5 refill was applied`);
  assert.equal(activeState.workPlans.length, 0, `${label}: no late work plan was saved`);
  assert.equal(activeState.appointments.length, 0, `${label}: no late appointment was saved`);
  assert.equal(timerCommits.length, 1, `${label}: exactly one timer settlement was persisted`);
  assert.equal(timerCommits[0].expired, true, `${label}: the persisted timer commit is terminal`);
  assert.equal(businessCommits.length, 0, `${label}: no late business/chat command was committed`);
}

async function testLateWorkPlan() {
  resetSession();
  clockAdvance.plan = 3 * 60 * 1000;
  const response = await commandsRoute.POST(requestWithJson(
    `http://localhost/api/game/sessions/${SESSION_ID}/commands`,
    {
      commandId: 'late-work-plan-command',
      expectedVersion: activeState.version,
      type: 'work_plan',
      payload: {
        scope: 'global',
        content: '根据公开的项目验收要求列出核对事项，确认每项负责人和完成时间，再与客户核实决策流程。',
      },
    },
  ), { params: Promise.resolve({ id: SESSION_ID }) });

  assert.ok(response.status >= 400, `late work plan must be rejected; got ${response.status}`);
  assert.equal(modelCalls.plan, 1, `the local plan evaluator ran before the deadline guard; ${await response.clone().text()}`);
  assertDeadlineWasPersistedWithoutBusinessEffects('late work plan');
}

async function testExpiredEpochIsSettledBeforeModelCall() {
  resetSession();
  const staleVersion = activeState.version;
  activeState.projectTimer = {
    durationMs: PROJECT_TIMER_DURATION_MS,
    elapsedMs: 0,
    lastResumedAt: new Date(fakeNow - PROJECT_TIMER_DURATION_MS - 1).toISOString(),
    recoveredIntervals: 0,
    visitPaused: false,
  };
  const response = await commandsRoute.POST(requestWithJson(
    `http://localhost/api/game/sessions/${SESSION_ID}/commands`,
    {
      commandId: 'already-expired-work-plan',
      expectedVersion: staleVersion,
      type: 'work_plan',
      payload: {
        scope: 'global',
        content: '列出正式验收材料、责任人与核对时间，再通过公开流程确认下一步安排。',
      },
    },
  ), { params: Promise.resolve({ id: SESSION_ID }) });

  assert.ok(response.status >= 400, `an expired timer epoch must reject commands; got ${response.status}`);
  assert.equal(modelCalls.plan, 0, 'an already-expired session does not call the AI evaluator');
  assert.notEqual(activeState.status, 'playing');
  assert.equal(activeState.projectTimer.elapsedMs, PROJECT_TIMER_DURATION_MS);
  assert.equal(activeState.actionPoints, 28, 'all elapsed checkpoints restore points only up to the cap');
  assert.equal(timerCommits.length, 1, 'the old timer epoch is settled durably once');
  assert.equal(timerCommits[0].expired, true);
  assert.equal(businessCommits.length, 0);
}

async function postChat(message: string, commandId: string) {
  return chatStreamRoute.POST(requestWithJson('http://localhost/api/chat/stream', {
    gameSessionId: SESSION_ID,
    scenarioId: 'project-1',
    npcId: NPC_ID,
    message,
    commandId,
    expectedVersion: activeState.version,
    intent: 'message',
    channel: 'email',
  }));
}

async function testLateNaturalLanguageInvitation() {
  resetSession();
  clockAdvance.messageDecision = 3 * 60 * 1000;
  const response = await postChat(
    '您好，希望围绕一线流程安排一次正式沟通，方便和您见面吗？',
    'late-natural-invite',
  );

  assert.ok(response.status >= 400, `late natural-language invitation must be rejected; got ${response.status}`);
  assert.equal(modelCalls.messageDecision, 1, 'the local message classifier ran before the deadline guard');
  assert.equal(modelCalls.stream, 0, 'the deterministic invitation branch does not start a reply stream');
  assertDeadlineWasPersistedWithoutBusinessEffects('late natural-language invitation');
}

async function testLateOrdinaryEmailReply() {
  resetSession();
  clockAdvance.stream = 3 * 60 * 1000;
  const response = await postChat(
    '我已整理项目验收清单，请您核对正式流程和材料交接节点。',
    'late-ordinary-email',
  );

  assert.equal(response.status, 409, `late email reply must return a conflict; got ${response.status}`);
  assert.equal(modelCalls.messageDecision, 1, 'the local message classifier ran');
  assert.equal(modelCalls.stream, 1, 'the stub reply stream crossed the deadline');
  assert.equal(modelCalls.evaluator, 1, 'the local turn evaluator completed before the final guard');
  assertDeadlineWasPersistedWithoutBusinessEffects('late ordinary email');
}

async function testPausedVisitFinalReplyMaySettle() {
  resetSession({ pausedVisit: true });
  const response = await chatStreamRoute.POST(requestWithJson('http://localhost/api/chat/stream', {
    gameSessionId: SESSION_ID,
    scenarioId: 'project-1',
    npcId: NPC_ID,
    message: '好的，谢谢您。',
    commandId: 'paused-final-player-reply',
    expectedVersion: activeState.version,
    intent: 'message',
    channel: 'offline',
  }));

  assert.equal(response.status, 200, 'the paused visit may commit its final player reply at expiry');
  assert.equal(modelCalls.stream, 0, 'the final player acknowledgement does not invoke AI');
  assert.equal(modelCalls.evaluator, 0, 'the final player acknowledgement does not invoke evaluation AI');
  assert.equal(timerCommits.length, 0, 'the visit debit is committed with the final chat command');
  assert.equal(businessCommits.length, 1, 'the final reply and visit settlement are committed atomically');
  assert.equal(businessCommits[0].commandType, 'chat.final_player_reply');
  assert.equal((businessCommits[0].chatMessages as unknown[]).length, 1, 'only the final player line is saved');
  assert.equal(activeState.status === 'playing', false, 'the 2 dialogue turns debit 30 seconds and settle the game');
  assert.equal(activeState.projectTimer.elapsedMs, PROJECT_TIMER_DURATION_MS);
  assert.equal(activeState.actionPoints, EXPECTED_AP_AFTER_FINAL_CHECKPOINT, 'the 5-minute AP checkpoint still applies at settlement');
  assert.equal(activeState.activeMeeting, null, 'the visit lock clears when the final reply is committed');
  assert.equal(activeState.meetingMinutes.length, 1, 'the completed visit record is saved');
}

const originalDateNow = Date.now;
Date.now = () => fakeNow;

async function main() {
  try {
    await testLateWorkPlan();
    await testExpiredEpochIsSettledBeforeModelCall();
    await testLateNaturalLanguageInvitation();
    await testLateOrdinaryEmailReply();
    await testPausedVisitFinalReplyMaySettle();
    console.log('late AI deadline route tests passed');
  } finally {
    Date.now = originalDateNow;
    moduleApi._load = originalLoad;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
