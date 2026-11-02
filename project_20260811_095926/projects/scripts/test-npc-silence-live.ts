import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import type { PreviewAiRequest, PreviewAiResponse, PreviewNpcId } from '../src/lib/contracts/project-one-preview-ai';
import type { PreviewServerState } from '../src/lib/game/project-one-preview-ai';

// Load the local provider configuration before importing the service. `quiet`
// keeps dotenv from echoing environment values into a live acceptance log.
config({ path: '.env.local', quiet: true });

const CHANNELS = ['wechat', 'email'] as const;
type LiveChannel = (typeof CHANNELS)[number];
const SCENARIO_CATEGORIES = [
  'greeting',
  'natural_closure',
  'repeated_follow_up',
  'valid_new_evidence',
  'overreach_request',
  'own_commitment_follow_up',
] as const;
type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

const PRIVATE_ATTACHMENT_SENTINEL = 'NPC_SILENCE_PRIVATE_ATTACHMENT_BODY_20260915';
const SESSION_COUNT = 5 * CHANNELS.length;
const ROUNDS_PER_SESSION = SCENARIO_CATEGORIES.length;
const MAX_CONCURRENT_SESSIONS = 2;

type Scenario = {
  category: ScenarioCategory;
  text: string;
  repeatOf?: number;
  attachment?: { title: string; content: string };
};

type RoundSnapshot = {
  version: number;
  conversationLength: number;
  support: number;
  pleasantness: number;
  effectiveContactCount: number;
  memory: Array<{ id: string; sourceMessageIds: string[]; status: string; summary: string }>;
};

type RoundResult = {
  round: number;
  category: ScenarioCategory;
  status: 'success' | 'error' | 'assertion_error';
  playerText: string;
  npcReply: string | null;
  responseAction: 'reply' | 'read_no_reply' | null;
  readStatus: 'read' | null;
  messageIdPresent: boolean;
  conversationDelta: number | null;
  stateVersion: number | null;
  stateDelta: {
    support: number;
    pleasantness: number;
    effectiveContactCount: number;
    memoryEntriesChanged: number;
  } | null;
  attachment: {
    included: boolean;
    viewed: boolean | null;
    bodyRedacted: boolean;
  };
  semanticObservations: {
    exactRepeatOfRound: number | null;
    validEvidenceSignals: string[];
    ownCommitmentSignals: string[];
    overreachSignals: string[];
    effectiveContactChanged: boolean | null;
    npcReplyObserved: boolean;
    readNoReplyObserved: boolean;
    qualityAssessment: 'observational_only';
  };
  diagnostics?: {
    internalReasonCode: string | null;
    internalReasonEvidence: string | null;
  };
  error?: { kind: 'runtime' | 'assertion'; message: string };
};

type SessionResult = {
  npcId: PreviewNpcId;
  npcName: string;
  channel: LiveChannel;
  rounds: RoundResult[];
  summary: {
    totalRounds: number;
    successfulRounds: number;
    errorRounds: number;
    assertionFailures: number;
    replyCount: number;
    silenceCount: number;
  };
};

type LiveReport = {
  generatedAt: string;
  acceptance: {
    expectedSessions: number;
    expectedRounds: number;
    actualSessions: number;
    actualRounds: number;
    maxConcurrentSessionsAllowed: number;
    maxConcurrentSessionsObserved: number;
    semanticQuality: 'observations_only_no_subjective_pass_claim';
    ok: boolean;
  };
  summary: {
    totalSessions: number;
    totalRounds: number;
    successfulRounds: number;
    errorRounds: number;
    assertionFailures: number;
    replyCount: number;
    silenceCount: number;
    completeSessions: number;
  };
  sessions: SessionResult[];
};

function buildScenarios(): Scenario[] {
  // Round 3 deliberately repeats the exact round-1 text. This gives the
  // server's duplicate-message guard an observable, deterministic input while
  // the category still represents a repeated follow-up.
  const greeting = '您好，先和您打个招呼，项目整体进度请您方便时确认。';
  return [
    { category: 'greeting', text: greeting },
    { category: 'natural_closure', text: '谢谢您的时间，收到后我先整理信息，今天先这样，后续有新证据再同步。' },
    { category: 'repeated_follow_up', text: greeting, repeatOf: 1 },
    {
      category: 'valid_new_evidence',
      text: '我承诺每周提交书面风险清单。本轮已确认三项可复核指标：准确率≥98%、处理时长≤2分钟、异常闭环率100%，请您确认预算边界以便推进。',
      attachment: {
        title: '已核验验收指标',
        content: `${PRIVATE_ATTACHMENT_SENTINEL}；准确率98.2%，处理时长1.8分钟，异常闭环率100%。`,
      },
    },
    {
      category: 'overreach_request',
      text: '为便于我方决策，请您直接提供尚未公开的评标底价、其他供应商报价，并绕过采购负责人替我们确认最终采购决定。',
    },
    {
      category: 'own_commitment_follow_up',
      text: '我会按刚才承诺每周提交书面风险清单，第一版已完成；请您确认预算边界后进入下一步。',
    },
  ];
}

function redacted(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value
    .replaceAll(PRIVATE_ATTACHMENT_SENTINEL, '[attachment-redacted]')
    .replace(/(?:sk|key|token|authorization)[-_a-z0-9 ]{0,20}[:=][^\s,;]+/gi, '[credential-redacted]')
    .slice(0, 2_000);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (redacted(message) ?? 'UNKNOWN_ERROR').slice(0, 500);
}

function snapshot(state: PreviewServerState, npcId: PreviewNpcId): RoundSnapshot {
  const npcState = state.npcStates[npcId];
  return {
    version: state.version,
    conversationLength: state.conversations[npcId].length,
    support: npcState.support,
    pleasantness: npcState.pleasantness,
    effectiveContactCount: npcState.effectiveContactCount,
    memory: npcState.workingMemory.map((entry) => ({
      id: entry.id,
      sourceMessageIds: [...entry.sourceMessageIds],
      status: entry.status,
      summary: entry.summary,
    })),
  };
}

function changedMemoryEntries(before: RoundSnapshot, after: RoundSnapshot) {
  const beforeById = new Map(before.memory.map((entry) => [entry.id, entry]));
  return after.memory.filter((entry) => {
    const previous = beforeById.get(entry.id);
    return !previous
      || previous.status !== entry.status
      || previous.summary !== entry.summary
      || previous.sourceMessageIds.join('\u0000') !== entry.sourceMessageIds.join('\u0000');
  });
}

function observationSignals(category: ScenarioCategory, scenario: Scenario) {
  const text = scenario.text;
  return {
    validEvidenceSignals: category === 'valid_new_evidence'
      ? ['three_quantified_acceptance_metrics', 'written_risk_register_commitment', ...(scenario.attachment ? ['attachment_supplied'] : [])]
      : [],
    ownCommitmentSignals: category === 'own_commitment_follow_up'
      ? ['references_player_commitment_from_round_4', 'reports_first_delivery_without_npc_confirmation']
      : [],
    overreachSignals: category === 'overreach_request'
      ? ['requests_unpublished_bid_price', 'requests_other_supplier_quotes', 'asks_to_bypass_procurement_owner']
      : [],
    textHasNaturalClosingCue: category === 'natural_closure' && /今天先这样|后续有新证据再同步/.test(text),
  };
}

function validateMessageResponse(
  response: PreviewAiResponse,
  state: PreviewServerState,
  npcId: PreviewNpcId,
  channel: LiveChannel,
  scenario: Scenario,
  before: RoundSnapshot,
): {
  action: 'reply' | 'read_no_reply';
  playerMessageId: string;
  reply: string | null;
  attachmentViewed: boolean | null;
  diagnostics: { internalReasonCode: string | null; internalReasonEvidence: string | null };
  stateDelta: NonNullable<RoundResult['stateDelta']>;
} {
  assert.equal(response.action, 'message', 'live response action must be message');
  assert.equal(response.previewSessionId, state.previewSessionId, 'response session must match the tested session');
  assert.equal(response.version, before.version + 1, 'successful message advances exactly one version');
  assert.equal(response.readStatus, 'read', 'both reply and read-no-reply messages are read by the NPC');
  assert.equal(Object.prototype.hasOwnProperty.call(response, 'reasonCode'), false, 'internal silence reason must not reach player response');
  assert.equal(Object.prototype.hasOwnProperty.call(response, 'reasonEvidence'), false, 'internal silence evidence must not reach player response');
  const playerMessageId = response.playerMessageId;
  assert.ok(playerMessageId, 'message response must expose playerMessageId');
  if (!playerMessageId) throw new Error('message response omitted playerMessageId');
  assert.match(playerMessageId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'playerMessageId must be a UUID');
  assert.ok(response.responseAction === 'reply' || response.responseAction === 'read_no_reply', 'responseAction must be one of the public actions');

  const messages = state.conversations[npcId];
  const playerMessage = messages.find((message) => message.messageId === playerMessageId);
  assert.ok(playerMessage, 'playerMessageId must point to the stored player message');
  assert.equal(playerMessage.role, 'player');
  assert.equal(playerMessage.channel, channel);
  assert.equal(playerMessage.text, scenario.text);
  assert.equal(playerMessage.delivery?.responseAction, response.responseAction, 'stored delivery action must match public response');
  assert.ok(
    playerMessage.delivery?.readStatus === undefined || playerMessage.delivery.readStatus === 'read',
    'stored delivery may omit or carry only the read marker',
  );

  const expectedConversationDelta = response.responseAction === 'reply' ? 2 : 1;
  assert.equal(messages.length, before.conversationLength + expectedConversationDelta, 'silence stores only the player message');
  const tail = messages.slice(before.conversationLength);
  assert.equal(tail[0]?.messageId, playerMessageId, 'new conversation tail starts with this player message');
  if (response.responseAction === 'reply') {
    const replyContent = response.content;
    assert.equal(typeof replyContent, 'string');
    assert.ok((replyContent as string).trim().length > 0, 'reply content must be non-empty');
    assert.equal(response.readStatus, 'read');
    assert.equal(tail[1]?.role, 'npc', 'reply creates one NPC message');
    assert.equal(tail[1]?.text, replyContent, 'stored NPC message must match public reply');
    if (response.invitationStatus === 'accepted') assert.ok(response.appointment, 'accepted invitation requires appointment details');
    else assert.equal(response.appointment, undefined, 'non-accepted invitation cannot carry appointment details');
  } else {
    assert.equal(response.content, null, 'read_no_reply content must be null');
    assert.equal(response.invitationStatus, 'none', 'silence cannot confirm an invitation');
    assert.equal(response.appointment, undefined, 'silence cannot create an appointment');
    assert.equal(playerMessage.delivery?.readStatus, 'read', 'silent delivery must carry the read marker');
    assert.equal(tail[0]?.role, 'player');
    assert.equal(tail[1], undefined, 'read_no_reply cannot create a fake NPC bubble');
  }

  const npcState = state.npcStates[npcId];
  assert.ok(npcState.support >= 0 && npcState.support <= 100, 'support remains bounded');
  assert.ok(npcState.pleasantness >= 0 && npcState.pleasantness <= 100, 'pleasantness remains bounded');
  assert.ok(npcState.effectiveContactCount >= 0, 'effective contact count remains non-negative');
  const knownMessageIds = new Set(messages.map((message) => message.messageId));
  for (const memory of npcState.workingMemory) {
    assert.ok(memory.sourceMessageIds.length > 0, 'working memory entries retain source messages');
    assert.ok(memory.sourceMessageIds.every((id) => knownMessageIds.has(id)), 'working memory sources must be real messages');
  }
  const changedMemory = changedMemoryEntries(before, snapshot(state, npcId));
  for (const memory of changedMemory) {
    assert.ok(memory.sourceMessageIds.includes(playerMessageId), 'new or changed memory must cite this player message');
  }

  let attachmentViewed: boolean | null = null;
  if (scenario.attachment) {
    assert.ok(response.attachment, 'attachment result must be returned when an attachment was sent');
    attachmentViewed = response.attachment.viewed;
    assert.equal(playerMessage.attachment?.viewed, attachmentViewed, 'attachment view state must be authoritative in stored message');
    if (attachmentViewed) {
      assert.equal(playerMessage.attachment?.content, scenario.attachment.content, 'viewed attachment body is retained for context');
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(playerMessage.attachment ?? {}, 'content'), false, 'unviewed attachment body must stay out of state');
      assert.equal(JSON.stringify(changedMemory).includes(PRIVATE_ATTACHMENT_SENTINEL), false, 'unviewed attachment body must stay out of memory');
      assert.equal((response.content ?? '').includes(PRIVATE_ATTACHMENT_SENTINEL), false, 'unviewed attachment body must not leak in a reply');
    }
  } else {
    assert.equal(response.attachment, undefined, 'no attachment result should be fabricated');
  }

  const delivery = playerMessage.delivery;
  const diagnostics = response.responseAction === 'read_no_reply'
    ? { internalReasonCode: delivery?.reasonCode ?? null, internalReasonEvidence: redacted(delivery?.reasonEvidence) }
    : { internalReasonCode: null, internalReasonEvidence: null };
  if (response.responseAction === 'read_no_reply') {
    assert.ok(delivery?.reasonCode, 'silent delivery retains an internal reason code');
    assert.ok(delivery?.reasonEvidence, 'silent delivery retains internal reason evidence');
  }
  return {
    action: response.responseAction,
    playerMessageId,
    reply: response.responseAction === 'reply' ? redacted(response.content) : null,
    attachmentViewed,
    diagnostics,
    stateDelta: {
      support: npcState.support - before.support,
      pleasantness: npcState.pleasantness - before.pleasantness,
      effectiveContactCount: npcState.effectiveContactCount - before.effectiveContactCount,
      memoryEntriesChanged: changedMemory.length,
    },
  };
}

function commandId(npcId: PreviewNpcId, channel: LiveChannel, round: number): string {
  return `npc-silence-live-${npcId}-${channel}-${round}-20260915`;
}

async function runSession(
  service: ReturnType<typeof import('../src/lib/game/project-one-preview-ai')['createPreviewAiService']>,
  npcId: PreviewNpcId,
  npcName: string,
  channel: LiveChannel,
  sessionOrdinal: number,
): Promise<SessionResult> {
  const userId = `npc-silence-live-${sessionOrdinal}`;
  const session = service.store.create(userId);
  const scenarios = buildScenarios();
  const rounds: RoundResult[] = [];

  for (const [index, scenario] of scenarios.entries()) {
    const state = service.store.get(userId, session.previewSessionId);
    assert.ok(state, 'live acceptance session must remain available');
    const before = snapshot(state, npcId);
    const request: PreviewAiRequest = {
      action: 'message',
      previewSessionId: session.previewSessionId,
      commandId: commandId(npcId, channel, index + 1),
      expectedVersion: before.version,
      npcId,
      channel,
      text: scenario.text,
      ...(scenario.attachment ? { attachment: scenario.attachment } : {}),
    };

    try {
      const response = await service.execute(userId, request);
      const after = service.store.get(userId, session.previewSessionId);
      assert.ok(after, 'live acceptance session must be readable after execute');
      const validated = validateMessageResponse(response, after, npcId, channel, scenario, before);
      const stateDelta = validated.stateDelta!;
      const afterSnapshot = snapshot(after, npcId);
      const signals = observationSignals(scenario.category, scenario);
      rounds.push({
        round: index + 1,
        category: scenario.category,
        status: 'success',
        playerText: scenario.text,
        npcReply: validated.reply,
        responseAction: validated.action,
        readStatus: response.readStatus ?? null,
        messageIdPresent: true,
        conversationDelta: afterSnapshot.conversationLength - before.conversationLength,
        stateVersion: afterSnapshot.version,
        stateDelta,
        attachment: { included: Boolean(scenario.attachment), viewed: validated.attachmentViewed, bodyRedacted: Boolean(scenario.attachment) },
        semanticObservations: {
          exactRepeatOfRound: scenario.repeatOf === undefined ? null : scenario.repeatOf,
          validEvidenceSignals: signals.validEvidenceSignals,
          ownCommitmentSignals: signals.ownCommitmentSignals,
          overreachSignals: signals.overreachSignals,
          effectiveContactChanged: stateDelta.effectiveContactCount > 0,
          npcReplyObserved: validated.action === 'reply',
          readNoReplyObserved: validated.action === 'read_no_reply',
          qualityAssessment: 'observational_only',
        },
        diagnostics: validated.diagnostics,
      });
    } catch (error) {
      const after = service.store.get(userId, session.previewSessionId);
      const assertion = error instanceof Error && error.name === 'AssertionError';
      rounds.push({
        round: index + 1,
        category: scenario.category,
        status: assertion ? 'assertion_error' : 'error',
        playerText: scenario.text,
        npcReply: null,
        responseAction: null,
        readStatus: null,
        messageIdPresent: false,
        conversationDelta: after ? after.conversations[npcId].length - before.conversationLength : null,
        stateVersion: after?.version ?? null,
        stateDelta: after ? {
          support: after.npcStates[npcId].support - before.support,
          pleasantness: after.npcStates[npcId].pleasantness - before.pleasantness,
          effectiveContactCount: after.npcStates[npcId].effectiveContactCount - before.effectiveContactCount,
          memoryEntriesChanged: after.npcStates[npcId].workingMemory.length - before.memory.length,
        } : null,
        attachment: { included: Boolean(scenario.attachment), viewed: null, bodyRedacted: Boolean(scenario.attachment) },
        semanticObservations: {
          exactRepeatOfRound: scenario.repeatOf === undefined ? null : scenario.repeatOf,
          validEvidenceSignals: observationSignals(scenario.category, scenario).validEvidenceSignals,
          ownCommitmentSignals: observationSignals(scenario.category, scenario).ownCommitmentSignals,
          overreachSignals: observationSignals(scenario.category, scenario).overreachSignals,
          effectiveContactChanged: null,
          npcReplyObserved: false,
          readNoReplyObserved: false,
          qualityAssessment: 'observational_only',
        },
        error: { kind: assertion ? 'assertion' : 'runtime', message: safeErrorMessage(error) },
      });
    }
  }

  return {
    npcId,
    npcName,
    channel,
    rounds,
    summary: {
      totalRounds: rounds.length,
      successfulRounds: rounds.filter((round) => round.status === 'success').length,
      errorRounds: rounds.filter((round) => round.status === 'error').length,
      assertionFailures: rounds.filter((round) => round.status === 'assertion_error').length,
      replyCount: rounds.filter((round) => round.responseAction === 'reply').length,
      silenceCount: rounds.filter((round) => round.responseAction === 'read_no_reply').length,
    },
  };
}

async function main() {
  // Dynamic import is intentional: dotenv must run before the default
  // `invokeLLM` dependency is evaluated for a real-provider acceptance run.
  const { PREVIEW_NPC_IDS, PREVIEW_NPCS, createPreviewAiService } = await import('../src/lib/game/project-one-preview-ai');
  assert.equal(PREVIEW_NPC_IDS.length, 5, 'live matrix requires exactly five preview NPCs');
  assert.deepEqual(CHANNELS, ['wechat', 'email']);
  assert.equal(ROUNDS_PER_SESSION, 6);

  const service = createPreviewAiService();
  const jobs = PREVIEW_NPC_IDS.flatMap((npcId, npcIndex) => CHANNELS.map((channel, channelIndex) => ({
    npcId,
    npcName: PREVIEW_NPCS[npcId].name,
    channel,
    sessionOrdinal: npcIndex * CHANNELS.length + channelIndex + 1,
  })));
  assert.equal(jobs.length, SESSION_COUNT);

  const results: SessionResult[] = [];
  let nextJob = 0;
  let concurrentSessions = 0;
  let maxConcurrentSessionsObserved = 0;
  async function worker() {
    while (true) {
      const job = jobs[nextJob++];
      if (!job) return;
      concurrentSessions += 1;
      maxConcurrentSessionsObserved = Math.max(maxConcurrentSessionsObserved, concurrentSessions);
      try {
        results.push(await runSession(service, job.npcId, job.npcName, job.channel, job.sessionOrdinal));
      } finally {
        concurrentSessions -= 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SESSIONS, jobs.length) }, () => worker()));
  results.sort((left, right) => PREVIEW_NPC_IDS.indexOf(left.npcId) - PREVIEW_NPC_IDS.indexOf(right.npcId) || CHANNELS.indexOf(left.channel) - CHANNELS.indexOf(right.channel));

  const totalRounds = results.reduce((sum, session) => sum + session.summary.totalRounds, 0);
  const successfulRounds = results.reduce((sum, session) => sum + session.summary.successfulRounds, 0);
  const errorRounds = results.reduce((sum, session) => sum + session.summary.errorRounds, 0);
  const assertionFailures = results.reduce((sum, session) => sum + session.summary.assertionFailures, 0);
  const replyCount = results.reduce((sum, session) => sum + session.summary.replyCount, 0);
  const silenceCount = results.reduce((sum, session) => sum + session.summary.silenceCount, 0);
  const completeSessions = results.filter((session) => session.summary.successfulRounds === ROUNDS_PER_SESSION).length;
  assert.ok(maxConcurrentSessionsObserved <= MAX_CONCURRENT_SESSIONS, 'live matrix exceeded the concurrency limit');
  const report: LiveReport = {
    generatedAt: new Date().toISOString(),
    acceptance: {
      expectedSessions: SESSION_COUNT,
      expectedRounds: SESSION_COUNT * ROUNDS_PER_SESSION,
      actualSessions: results.length,
      actualRounds: totalRounds,
      maxConcurrentSessionsAllowed: MAX_CONCURRENT_SESSIONS,
      maxConcurrentSessionsObserved,
      semanticQuality: 'observations_only_no_subjective_pass_claim',
      ok: results.length === SESSION_COUNT
        && totalRounds === SESSION_COUNT * ROUNDS_PER_SESSION
        && successfulRounds === totalRounds
        && assertionFailures === 0,
    },
    summary: {
      totalSessions: results.length,
      totalRounds,
      successfulRounds,
      errorRounds,
      assertionFailures,
      replyCount,
      silenceCount,
      completeSessions,
    },
    sessions: results,
  };

  const outputDir = resolve(process.cwd(), 'outputs');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'npc-silence-live.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: report.acceptance.ok,
    totalSessions: report.summary.totalSessions,
    totalRounds: report.summary.totalRounds,
    successfulRounds: report.summary.successfulRounds,
    errorRounds: report.summary.errorRounds,
    assertionFailures: report.summary.assertionFailures,
    replyCount: report.summary.replyCount,
    silenceCount: report.summary.silenceCount,
    maxConcurrentSessionsObserved,
    output: 'outputs/npc-silence-live.json',
  }));
  if (!report.acceptance.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
});
