import { createHash } from 'node:crypto';
import { createServerClient } from '@/storage/database/supabase-client';
import {
  CustomerActivityDecisionError,
  CustomerActivityDetectionError,
  decideCustomerActivityFeasibility,
  detectCustomerActivityProposals,
  evaluateCustomerActivityPlan,
  type CustomerActivityDiagnostic,
} from '@/lib/ai/customer-activities';
import { getProgressionMultiplier } from '@/lib/game/acceptance-mode';
import { assertMultiplayerRoomRunning } from '@/lib/game/multiplayer';
import { getProjectOneNpc } from '@/lib/game/project-one';
import { appendCustomerActivityDiagnostic, applyCustomerActivityEvaluation, completeCustomerActivityProposalDetection, createProjectOneState, getGameOutcome, normalizeProjectOneState, synchronizeProjectTimer, toPlayerVisibleGameOutcome, type GameOutcome, type GameRuntimeState } from '@/lib/game/state';
import type { GameReview } from '@/lib/contracts/game';
import {
  finalizeExpiredCustomerActivities,
  type CustomerActivityFeasibilityDecision,
  type CustomerActivityProposalCandidate,
} from '@/lib/game/customer-activities';
import { resumeProjectTimerAfterCustomerActivity } from '@/lib/game/state';

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  round?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/** Chat history returned to a player contains delivery details only. */
export interface PlayerVisibleChatMessage extends Omit<StoredChatMessage, 'metadata'> {
  metadata?: Record<string, unknown>;
}

export interface NpcInboxItem {
  sourceNpcId: string;
  summary: string;
  round: number;
}

export interface StoredGameEvent {
  id: string;
  npcId: string | null;
  round: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * A review needs the tail of the raw transcript, not the oldest page of it.
 * Durable memory and event ledgers carry the older high-value facts, while
 * this bounded window preserves the latest conversational context.
 */
export const REVIEW_RECENT_MESSAGE_LIMIT = 32;
export const REVIEW_KEY_EVENT_LIMIT = 256;
// Bump when the player-visible review privacy boundary changes so cached prose
// produced from older, richer context is regenerated before being returned.
export const REVIEW_CONTEXT_VERSION = 3;

const REVIEW_EVENT_TYPES = [
  'npc.turn.completed',
  'npc.message.unanswered',
  'npc.call.unanswered',
  'npc.call.connected',
  'npc.call.ended',
  'npc.handoff.promised',
  'npc.handoff.sent',
  'npc.handoff.received',
  'contact.completed',
  'wechat.accepted',
  'wechat.rejected',
  'wechat.pending',
  'wechat.later',
  'appointment.pending',
  'appointment.accepted',
  'appointment.countered',
  'appointment.cancelled',
  'appointment.missed',
  'preparation.completed',
  'preparation.delivered',
  'visit.started',
  'visit.completed',
  'gift.delivered',
  'meeting_minutes.updated',
  'follow_up.sent',
  'phase.advanced',
  'session.finished',
  'session.submitted',
  'public_info.researched',
] as const;

type ReviewMemory = {
  summary: string;
  summarizedMessageCount: number;
  confirmedFacts: string[];
  commitments: string[];
};

export interface ReviewContextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  round?: number;
  createdAt: string;
  npcId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewContextEvent {
  id: string;
  npcId: string | null;
  round: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewContext {
  /** Per-NPC rolling memory. No NPC receives another NPC's transcript here. */
  npcMemories: Record<string, ReviewMemory>;
  /** State fields selected for review; hidden competitor state is intentionally absent. */
  persistentState: Record<string, unknown>;
  /** Allowlisted durable events, ordered oldest to newest. */
  keyEvents: ReviewContextEvent[];
  /** The newest bounded raw message tail. */
  recentMessages: ReviewContextMessage[];
}

interface RuntimeStateRow {
  scenario_code: string;
  action_points: number;
  dimensions: GameRuntimeState['dimensions'];
  npc_affinity: GameRuntimeState['npcAffinity'];
  unlocked_npc_ids: string[];
  unlocked_clues: GameRuntimeState['unlockedClues'];
  conversation_memories: GameRuntimeState['conversationMemories'];
  phase_started_at?: string | null;
  phase_ends_at?: string | null;
  paused_at?: string | null;
  paused_remaining_ms?: number | null;
  npc_contacts?: GameRuntimeState['npcContacts'] | null;
  active_meeting?: GameRuntimeState['activeMeeting'];
  simulation_state?: Partial<GameRuntimeState> | null;
  last_action: string | null;
  version: number;
}

export interface OwnedGameSession {
  id: string;
  userId: string;
  state: GameRuntimeState;
}

/**
 * Multiplayer state is coordinated by the room, not merely by a session row.
 * The subsequent commit still carries a runtime version precondition, so a
 * concurrent coach start/end cannot race past this read and write stale state.
 */
export async function assertOwnedMultiplayerRoomRunning(
  sessionId: string,
  state: GameRuntimeState,
  allowFinished = false,
): Promise<void> {
  if (state.gameMode !== 'multiplayer') return;
  const supabase = createServerClient();
  const { data: slot, error: slotError } = await supabase
    .from('multiplayer_company_slots')
    .select('room_id')
    .eq('game_session_id', sessionId)
    .maybeSingle();
  if (slotError || !slot?.room_id) throw new Error('MULTIPLAYER_ROOM_NOT_RUNNING');
  const { data: room, error: roomError } = await supabase
    .from('multiplayer_rooms')
    .select('status')
    .eq('id', slot.room_id)
    .maybeSingle();
  if (roomError) throw new Error('MULTIPLAYER_ROOM_NOT_RUNNING');
  if (allowFinished && room?.status === 'finished') return;
  assertMultiplayerRoomRunning(state.gameMode, room?.status);
}

export interface GameSaveSummary {
  id: string;
  scenarioCode: string;
  currentRound: number;
  maxRounds: number;
  updatedAt: string;
  startedAt: string;
}

export const MAX_ACTIVE_GAME_SAVES = 1;

function toState(session: Record<string, unknown>, runtime: RuntimeStateRow): GameRuntimeState {
  const rawStatus = String(session.status);
  const status: GameRuntimeState['status'] =
    rawStatus === 'won' || rawStatus === 'lost' ? rawStatus : 'playing';
  const legacyState = {
    scenarioCode: runtime.scenario_code,
    progressionMultiplier: 1,
    currentRound: Number(session.current_round),
    maxRounds: Number(session.max_round),
    actionPoints: runtime.action_points,
    status,
    dimensions: runtime.dimensions,
    npcAffinity: runtime.npc_affinity,
    unlockedNpcIds: runtime.unlocked_npc_ids,
    unlockedClues: runtime.unlocked_clues,
    conversationMemories: runtime.conversation_memories,
    phaseStartedAt: runtime.phase_started_at ?? '',
    phaseEndsAt: runtime.phase_ends_at ?? '',
    pausedAt: runtime.paused_at ?? null,
    pausedRemainingMs: runtime.paused_remaining_ms ?? null,
    npcContacts: runtime.npc_contacts ?? {},
    activeMeeting: runtime.active_meeting ?? null,
    lastAction: runtime.last_action,
    version: runtime.version,
  };
  return normalizeProjectOneState({
    ...legacyState,
    ...(runtime.simulation_state ?? {}),
    // The relational version is the concurrency authority even if an older JSON
    // snapshot contains a stale value.
    version: runtime.version,
  });
}

export async function createGameSession(
  userId: string,
  displayName: string,
  scenarioCode: string,
  progressionMultiplier = 1,
  replaceExisting = false,
) {
  if (scenarioCode !== 'project-1') throw new Error('SCENARIO_NOT_SUPPORTED');
  const supabase = createServerClient();
  const { data: scenario, error: scenarioError } = await supabase
    .from('project_scenarios')
    .select('id, difficulty')
    .eq('code', scenarioCode)
    .single();
  // Project one is a fixed, bundled scenario. The explicit fallback preserves
  // playable sessions on databases where RLS temporarily hides seed rows from
  // the server client; the UUID is the idempotent seed value in seed.sql.
  const resolvedScenario = scenario ?? (scenarioError
    ? { id: '10000000-0000-4000-8000-000000000001', difficulty: 1 }
    : null);
  if (!resolvedScenario) throw new Error('SCENARIO_NOT_CONFIGURED');

  const initialState = createProjectOneState(progressionMultiplier);
  const { data, error } = await supabase.rpc('create_or_replace_game_session', {
    p_user_id: userId,
    p_user_name: displayName,
    p_scenario_id: resolvedScenario.id,
    p_difficulty: resolvedScenario.difficulty,
    p_state: initialState,
    p_total_score: Math.round(getGameOutcome(initialState).finalScore),
    p_replace_existing: replaceExisting,
  });
  if (error || !data || typeof data !== 'object') {
    const message = error?.message ?? '';
    if (message.includes('SAVE_LIMIT_REACHED') || error?.code === '23505') throw new Error('SAVE_LIMIT_REACHED');
    console.error('atomic game session create failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
    });
    throw new Error('SESSION_CREATE_FAILED');
  }
  const envelope = data as { id?: unknown };
  if (typeof envelope.id !== 'string') throw new Error('SESSION_CREATE_FAILED');
  return { id: envelope.id, state: initialState };
}

export async function listOwnedActiveGameSaves(userId: string, scenarioCode?: string): Promise<GameSaveSummary[]> {
  const supabase = createServerClient();
  let query = supabase
    .from('game_sessions')
    .select('id, current_round, max_round, started_at, created_at, game_runtime_states!inner(scenario_code, updated_at)')
    .eq('user_id', userId)
    .eq('status', 'playing')
    .eq('multiplayer', false)
    .order('created_at', { ascending: false })
    .limit(MAX_ACTIVE_GAME_SAVES);
  if (scenarioCode) query = query.eq('game_runtime_states.scenario_code', scenarioCode);
  const { data, error } = await query;
  if (error) throw new Error('SAVE_LIST_UNAVAILABLE');
  return (data ?? []).map((row) => {
    const runtime = Array.isArray(row.game_runtime_states) ? row.game_runtime_states[0] : row.game_runtime_states;
    return {
      id: String(row.id),
      scenarioCode: String(runtime?.scenario_code ?? scenarioCode ?? 'project-1'),
      currentRound: Number(row.current_round),
      maxRounds: Number(row.max_round),
      updatedAt: String(runtime?.updated_at ?? row.created_at ?? row.started_at),
      startedAt: String(row.started_at ?? row.created_at),
    };
  });
}

export async function deleteOwnedActiveGameSave(sessionId: string, userId: string): Promise<void> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('game_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
    .eq('status', 'playing')
    .select('id')
    .maybeSingle();
  if (error) throw new Error('SAVE_DELETE_FAILED');
  if (!data) throw new Error('SAVE_NOT_DELETABLE');
}

export async function getOwnedGameSession(
  sessionId: string,
  userId: string,
  options: { materializeTimer?: boolean } = {},
): Promise<OwnedGameSession> {
  const supabase = createServerClient();
  const { data: session, error: sessionError } = await supabase
    .from('game_sessions')
    .select('id, user_id, current_round, max_round, status')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .in('status', ['playing', 'won', 'lost'])
    .single();
  if (sessionError || !session) throw new Error('SESSION_NOT_FOUND');

  const { data: runtime, error: runtimeError } = await supabase
    .from('game_runtime_states')
    .select('*')
    .eq('session_id', sessionId)
    .single();
  if (runtimeError || !runtime) throw new Error('RUNTIME_STATE_NOT_FOUND');
  const needsContactMigration = !Object.keys((runtime as RuntimeStateRow).npc_contacts ?? {}).length;
  let state = {
    ...toState(session, runtime as RuntimeStateRow),
    progressionMultiplier: getProgressionMultiplier(userId),
  };
  if (needsContactMigration) {
    const { data: priorReplies } = await supabase
      .from('chat_messages')
      .select('metadata')
      .eq('session_id', sessionId)
      .eq('sender', 'assistant');
    const repliedNpcIds = new Set((priorReplies ?? []).map((row) => String((row.metadata as Record<string, unknown> | null)?.npcId ?? '')).filter(Boolean));
    state = {
      ...state,
      npcContacts: Object.fromEntries(Object.entries(state.npcContacts).map(([npcId, contact]) => [
        npcId,
        repliedNpcIds.has(npcId) ? { ...contact, status: 'online' as const } : contact,
      ])),
    };
  }
  // The low-level loader is side-effect free. Callers that expose a live game
  // use synchronizeOwnedGameTimer to persist recovery/expiry checkpoints.
  return {
    id: session.id as string,
    userId: session.user_id as string,
    // Mutating commands/chat must checkpoint elapsed time before they freeze a
    // visit or spend points. Read-only timer polls keep the persisted anchor
    // untouched unless a five-minute recovery or expiry is reached.
    state: options.materializeTimer === false ? state : synchronizeProjectTimer(state, Date.now(), true),
  };
}

/**
 * Persist only timer recovery/expiry/migration edges. Consecutive polls in a
 * sub-five-minute interval return the same version, while a CAS retry safely
 * reloads a simultaneous player command.
 */
export async function synchronizeOwnedGameTimer(sessionId: string, userId: string): Promise<OwnedGameSession> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await getOwnedGameSession(sessionId, userId, { materializeTimer: false });
    // A completed multiplayer runtime keeps its frozen timer snapshot. Do not
    // install a fresh room-start anchor on every result-page poll.
    if (loaded.state.status !== 'playing') return loaded;
    let timerBase = loaded.state;
    if (loaded.state.gameMode === 'multiplayer') {
      const supabase = createServerClient();
      const { data: slot } = await supabase
        .from('multiplayer_company_slots')
        .select('room_id')
        .eq('game_session_id', sessionId)
        .maybeSingle();
      const { data: room } = slot?.room_id
        ? await supabase.from('multiplayer_rooms').select('status').eq('id', slot.room_id).maybeSingle()
        : { data: null };
      // Companies can be prepared while a room waits, but their twenty minute
      // budget starts only when the room runs. New room-start SQL stamps the
      // same anchor into each runtime atomically; an older running save with
      // no timer anchor begins at this migration boundary.
      if (room?.status !== 'running') return loaded;
      if (!timerBase.projectTimer.lastResumedAt && !timerBase.projectTimer.visitPaused) {
        timerBase = { ...timerBase, projectTimer: { ...timerBase.projectTimer, lastResumedAt: new Date().toISOString() } };
      }
    }
    const planningTask = timerBase.customerActivities.tasks.find((task) => task.status === 'planning');
    if (planningTask) {
      const nowMs = Date.now();
      if (planningTask.deadlineAt === undefined || nowMs < planningTask.deadlineAt) return loaded;
      const finalizedActivities = finalizeExpiredCustomerActivities(timerBase.customerActivities, nowMs);
      const resumedAtDeadline = resumeProjectTimerAfterCustomerActivity({
        ...timerBase,
        customerActivities: finalizedActivities,
      }, planningTask.deadlineAt);
      const next = synchronizeProjectTimer(resumedAtDeadline, nowMs, true);
      try {
        const committed = await commitGameCommand({
          sessionId,
          commandId: `customer-activity-timeout:${loaded.state.version}:${planningTask.deadlineAt}`,
          commandType: 'customer_activity.timeout_submit',
          expectedVersion: loaded.state.version,
          state: next,
          eventType: 'customer_activity.plan_auto_submitted',
          eventPayload: {
            taskId: planningTask.id,
            submittedAt: planningTask.deadlineAt,
            submitReason: 'timeout',
            projectTimerExpired: next.status !== 'playing',
          },
          result: { activityTaskId: planningTask.id, submitReason: 'timeout' },
        });
        return { ...loaded, state: committed.state };
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'STATE_VERSION_CONFLICT' || attempt === 2) throw error;
        continue;
      }
    }
    const next = synchronizeProjectTimer(timerBase);
    if (next === loaded.state) return loaded;
    try {
      const expired = next.status !== 'playing';
      const committed = await commitGameCommand({
        sessionId,
        commandId: `timer:${loaded.state.version}:${next.projectTimer.recoveredIntervals}:${expired ? 'expired' : 'checkpoint'}`,
        commandType: 'timer.sync',
        expectedVersion: loaded.state.version,
        state: next,
        eventType: expired ? 'project_timer.expired' : 'project_timer.recovered',
        eventPayload: {
          elapsedMs: next.projectTimer.elapsedMs,
          recoveredIntervals: next.projectTimer.recoveredIntervals,
          actionPoints: next.actionPoints,
          expired,
        },
        result: { expired },
      });
      return { ...loaded, state: committed.state };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'STATE_VERSION_CONFLICT' || attempt === 2) throw error;
    }
  }
  throw new Error('STATE_VERSION_CONFLICT');
}

export async function saveGameState(sessionId: string, state: GameRuntimeState): Promise<GameRuntimeState> {
  const supabase = createServerClient();
  const nextVersion = state.version + 1;
  const { data: runtime, error: runtimeError } = await supabase
    .from('game_runtime_states')
    .update({
      action_points: state.actionPoints,
      dimensions: state.dimensions,
      npc_affinity: state.npcAffinity,
      unlocked_npc_ids: state.unlockedNpcIds,
      unlocked_clues: state.unlockedClues,
      conversation_memories: state.conversationMemories,
      phase_started_at: state.phaseStartedAt,
      phase_ends_at: state.phaseEndsAt,
      paused_at: state.pausedAt,
      paused_remaining_ms: state.pausedRemainingMs,
      npc_contacts: state.npcContacts,
      active_meeting: state.activeMeeting,
      simulation_state: { ...state, version: nextVersion },
      last_action: state.lastAction,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)
    .eq('version', state.version)
    .select('version')
    .single();
  if (runtimeError || !runtime) throw new Error('STATE_VERSION_CONFLICT');

  const outcome = getGameOutcome(state);
  const totalScore = Math.round(outcome.finalScore);
  const { error: sessionError } = await supabase
    .from('game_sessions')
    .update({
      current_round: state.currentRound,
      max_round: state.maxRounds,
      total_score: totalScore,
      win_probability: totalScore,
      status: state.status,
      won: state.status === 'playing' ? null : state.status === 'won',
      final_report: state.status === 'playing' ? null : {
        status: state.status,
        totalScore,
        dimensions: state.dimensions,
        npcAffinity: state.npcAffinity,
        unlockedClues: state.unlockedClues,
        outcome,
      },
      finished_at: state.status === 'playing' ? null : new Date().toISOString(),
    })
    .eq('id', sessionId);
  if (sessionError) throw new Error('SESSION_STATE_UPDATE_FAILED');
  return { ...state, version: nextVersion };
}

export interface GameCommandCommitResult {
  state: GameRuntimeState;
  result: Record<string, unknown>;
  replayed: boolean;
}

export async function getCommittedGameCommand(
  sessionId: string,
  commandId: string,
): Promise<GameCommandCommitResult | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('game_command_records')
    .select('status, response')
    .eq('session_id', sessionId)
    .eq('command_id', commandId)
    .maybeSingle();
  if (error) throw new Error('GAME_COMMAND_LOOKUP_FAILED');
  if (!data || data.status !== 'completed' || !data.response) return null;
  const response = data.response as { state?: GameRuntimeState; result?: Record<string, unknown> };
  if (!response.state) throw new Error('GAME_COMMAND_RESPONSE_INVALID');
  return {
    state: normalizeProjectOneState(response.state),
    result: response.result ?? {},
    replayed: true,
  };
}

/**
 * Atomically commits a deterministic game command and its audit event. The
 * database owns idempotency by (session_id, command_id), so retries and double
 * clicks return the original response without charging time or points twice.
 */
export async function commitGameCommand(args: {
  sessionId: string;
  commandId: string;
  commandType: string;
  expectedVersion: number;
  state: GameRuntimeState;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  chatMessages?: Array<{
    round: number;
    role: 'user' | 'assistant';
    content: string;
    affinityDelta?: number;
    scoreDelta?: number;
    metadata?: Record<string, unknown>;
  }>;
}): Promise<GameCommandCommitResult> {
  const supabase = createServerClient();
  // Every successful game command already creates one new version, so it is a
  // safe place to checkpoint sub-interval wall time and install a post-visit
  // resume anchor without creating a separate poll write.
  const committedState = synchronizeProjectTimer(args.state, Date.now(), true);
  const { data, error } = await supabase.rpc('commit_game_command', {
    p_session_id: args.sessionId,
    p_command_id: args.commandId,
    p_command_type: args.commandType,
    p_expected_version: args.expectedVersion,
    p_state: committedState,
    p_total_score: Math.round(getGameOutcome(committedState).finalScore),
    p_event_type: args.eventType,
    p_event_payload: args.eventPayload ?? {},
    p_result: args.result ?? {},
    p_chat_messages: args.chatMessages ?? [],
  });
  if (error || !data || typeof data !== 'object') {
    const message = error?.message ?? '';
    if (message.includes('STATE_VERSION_CONFLICT')) throw new Error('STATE_VERSION_CONFLICT');
    if (message.includes('COMMAND_IN_PROGRESS')) throw new Error('COMMAND_IN_PROGRESS');
    throw new Error('GAME_COMMAND_COMMIT_FAILED');
  }
  const envelope = data as { replayed?: boolean; response?: { state?: GameRuntimeState; result?: Record<string, unknown> } };
  if (!envelope.response?.state) throw new Error('GAME_COMMAND_RESPONSE_INVALID');
  return {
    state: normalizeProjectOneState(envelope.response.state),
    result: envelope.response.result ?? {},
    replayed: Boolean(envelope.replayed),
  };
}

function customerActivityDetectionCommandId(conversationId: string): string {
  const hash = createHash('sha256').update(conversationId).digest('hex').slice(0, 32);
  return `customer-activity-detect:${hash}`;
}

function customerActivityDecisionKey(candidate: CustomerActivityProposalCandidate): string {
  return `${candidate.npcId}\u0000${candidate.type}\u0000${candidate.proposalMessageId}`;
}

function customerActivityDecisionCheckpointCommandId(
  conversationId: string,
  resolutions: Array<{ candidate: CustomerActivityProposalCandidate; decision: CustomerActivityFeasibilityDecision }>,
  diagnosticVersion?: number,
): string {
  const checkpoint = resolutions
    .map(({ candidate, decision }) => ({
      key: customerActivityDecisionKey(candidate),
      decision: decision.decision,
      mode: decision.mode,
      configRevision: decision.configRevision,
      reason: decision.reason,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const hash = createHash('sha256').update(JSON.stringify({ checkpoint, diagnosticVersion })).digest('hex').slice(0, 32);
  const conversationHash = createHash('sha256').update(conversationId).digest('hex').slice(0, 16);
  return `customer-activity-checkpoint:${conversationHash}:${hash}`;
}

export async function resolveCustomerActivityProposalDecisions(args: {
  candidates: CustomerActivityProposalCandidate[];
  existingDecisionKeys: ReadonlySet<string>;
  resolutionCache: Map<string, {
    candidate: CustomerActivityProposalCandidate;
    decision: CustomerActivityFeasibilityDecision;
  }>;
  relationshipSnapshot: OwnedGameSession['state']['customerActivityDetectionQueue'][number]['relationshipSnapshot'];
  decisionConfig: OwnedGameSession['state']['customerActivityDetectionQueue'][number]['decisionConfig'];
  decide?: typeof decideCustomerActivityFeasibility;
}): Promise<{ resolutions: Array<{
  candidate: CustomerActivityProposalCandidate;
  decision: CustomerActivityFeasibilityDecision;
}>; decisionFailed: boolean; failureCode?: string }> {
  const decide = args.decide ?? decideCustomerActivityFeasibility;
  let decisionFailed = false;
  let failureCode: string | undefined;
  for (const candidate of args.candidates) {
    const decisionKey = customerActivityDecisionKey(candidate);
    // A proposal is globally consumed once, even if a later bounded transcript
    // happens to contain it again under a different boundary.
    if (args.existingDecisionKeys.has(decisionKey) || args.resolutionCache.has(decisionKey)) continue;
    try {
      const decision = await decide(candidate, args.relationshipSnapshot, args.decisionConfig);
      args.resolutionCache.set(decisionKey, { candidate, decision });
    } catch (error) {
      if (!(error instanceof CustomerActivityDecisionError)) throw error;
      decisionFailed = true;
      failureCode = error.code;
      break;
    }
  }
  return {
    resolutions: [...args.resolutionCache.entries()]
      .filter(([decisionKey]) => !args.existingDecisionKeys.has(decisionKey))
      .map(([, resolution]) => resolution),
    decisionFailed,
    ...(failureCode ? { failureCode } : {}),
  };
}

/** Retries ended-conversation detection from session reads and interaction commits. */
export async function processPendingCustomerActivityDetections(
  sessionId: string,
  userId: string,
  dependencies: {
    load?: typeof getOwnedGameSession;
    detect?: typeof detectCustomerActivityProposals;
    decide?: typeof decideCustomerActivityFeasibility;
    commit?: typeof commitGameCommand;
    now?: () => number;
  } = {},
): Promise<OwnedGameSession> {
  const load = dependencies.load ?? getOwnedGameSession;
  const detect = dependencies.detect ?? detectCustomerActivityProposals;
  const commit = dependencies.commit ?? commitGameCommand;
  const now = dependencies.now ?? Date.now;
  // Keep AI output and successful gate decisions across CAS retries. A conflict
  // must not allow a completed reject/need_more decision to be drawn again.
  let detectedCandidates: CustomerActivityProposalCandidate[] | null = null;
  let detectedConversationId: string | null = null;
  let detectionDiagnostics: CustomerActivityDiagnostic[] = [];
  const resolutionCache = new Map<string, {
    candidate: CustomerActivityProposalCandidate;
    decision: CustomerActivityFeasibilityDecision;
  }>();
  let decisionFailed = false;
  let decisionFailureCode: string | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await load(sessionId, userId, { materializeTimer: false });
    const request = loaded.state.customerActivityDetectionQueue[0];
    if (!request) return loaded;
    if (detectedConversationId !== null && request.conversationId !== detectedConversationId) return loaded;
    if (detectedCandidates === null) {
      detectionDiagnostics = [{ event: 'detection_started', reason: 'ended_conversation_queued' }];
      try {
        detectedCandidates = await detect({
          conversationEnded: true,
          conversationId: request.conversationId,
          npcId: request.npcId,
          messages: request.messages,
        }, { onDiagnostic: (diagnostic) => detectionDiagnostics.push(diagnostic) });
        detectedConversationId = request.conversationId;
      } catch (error) {
        const failureCode = error instanceof CustomerActivityDetectionError ? error.code : 'unexpected_detection_error';
        const failedState = detectionDiagnostics.reduce((state, diagnostic) => appendCustomerActivityDiagnostic(state, {
          at: now(), conversationId: request.conversationId, npcId: request.npcId,
          event: diagnostic.event, reason: diagnostic.reason, activityType: diagnostic.activityType,
          messageId: diagnostic.messageId,
          details: diagnostic.details as Record<string, string | number | boolean | null> | undefined,
        }), loaded.state);
        const auditedState = appendCustomerActivityDiagnostic(failedState, {
          at: now(), conversationId: request.conversationId, npcId: request.npcId,
          event: 'detection_failed', reason: failureCode, details: { detection_error_code: failureCode },
        });
        try {
          const committed = await commit({
            sessionId,
            commandId: customerActivityDecisionCheckpointCommandId(request.conversationId, [], loaded.state.version),
            commandType: 'customer_activity.detection_failed',
            expectedVersion: loaded.state.version,
            state: auditedState,
            eventType: 'customer_activity.detection_failed',
            eventPayload: { npcId: request.npcId, conversationId: request.conversationId, failureCode },
            result: { queueRetained: true },
          });
          return { ...loaded, state: committed.state };
        } catch (commitError) {
          if (!(commitError instanceof Error) || commitError.message !== 'STATE_VERSION_CONFLICT' || attempt === 2) throw commitError;
          continue;
        }
      }
    }
    const existingDecisionKeys = new Set(loaded.state.customerActivities.decisions.map((item) =>
      `${item.npcId}\u0000${item.type}\u0000${item.proposalMessageId}`));
    if (!decisionFailed) {
      const resolved = await resolveCustomerActivityProposalDecisions({
        candidates: detectedCandidates,
        existingDecisionKeys,
        resolutionCache,
        relationshipSnapshot: request.relationshipSnapshot,
        decisionConfig: request.decisionConfig,
        decide: dependencies.decide,
      });
      decisionFailed = resolved.decisionFailed;
      decisionFailureCode = resolved.failureCode;
    }

    // Persist normally completed decisions even when a later candidate fails.
    // The queue remains retryable, while the decision audit prevents the first
    // candidate from being re-evaluated or changing into an allow on retry.
    const resolutions = [...resolutionCache.entries()]
      .filter(([decisionKey]) => !existingDecisionKeys.has(decisionKey))
      .map(([, resolution]) => resolution);
    try {
      const beforeTaskCount = loaded.state.customerActivities.tasks.length;
      let nextState = completeCustomerActivityProposalDetection(
        loaded.state,
        request.conversationId,
        resolutions,
        now(),
        { keepQueue: decisionFailed },
      );
      const createdTaskCount = nextState.customerActivities.tasks.length - beforeTaskCount;
      const appendDiagnostic = (diagnostic: Omit<import('@/lib/game/state').CustomerActivityDiagnosticRecord, 'at'>) => {
        nextState = appendCustomerActivityDiagnostic(nextState, { ...diagnostic, at: now() });
      };
      for (const diagnostic of detectionDiagnostics) appendDiagnostic({
        conversationId: request.conversationId,
        npcId: request.npcId,
        event: diagnostic.event,
        reason: diagnostic.reason,
        activityType: diagnostic.activityType,
        messageId: diagnostic.messageId,
        details: diagnostic.details as Record<string, string | number | boolean | null> | undefined,
      });
      appendDiagnostic({
        conversationId: request.conversationId,
        npcId: request.npcId,
        event: 'candidate_count',
        reason: detectedCandidates.length ? 'candidates_returned' : 'no_candidate_returned',
        details: { candidate_count: detectedCandidates.length },
      });
      const resolutionByKey = new Map(resolutions.map((resolution) => [customerActivityDecisionKey(resolution.candidate), resolution.decision]));
      for (const candidate of detectedCandidates) {
        const proposalKey = customerActivityDecisionKey(candidate);
        if (existingDecisionKeys.has(proposalKey)) {
          appendDiagnostic({
            conversationId: request.conversationId, npcId: request.npcId, activityType: candidate.type,
            messageId: candidate.proposalMessageId, event: 'candidate_duplicate', reason: 'proposal_already_decided',
          });
          continue;
        }
        const decision = resolutionByKey.get(proposalKey);
        if (decision) {
          appendDiagnostic({
            conversationId: request.conversationId,
            npcId: request.npcId,
            activityType: candidate.type,
            messageId: candidate.proposalMessageId,
            event: 'threshold_decision',
            reason: decision.reason,
            details: { threshold_decision: decision.decision, config_revision: decision.configRevision, decision_mode: decision.mode },
          });
        }
      }
      if (decisionFailed) appendDiagnostic({
        conversationId: request.conversationId,
        npcId: request.npcId,
        event: 'feasibility_decision_failed',
        reason: decisionFailureCode ?? 'decision_provider_unavailable',
        details: { decision_error_code: decisionFailureCode ?? 'decision_provider_unavailable' },
      });
      appendDiagnostic({
        conversationId: request.conversationId,
        npcId: request.npcId,
        event: createdTaskCount ? 'task_created' : 'no_task_created',
        reason: createdTaskCount ? 'threshold_allowed' : detectedCandidates.length ? 'no_new_allowed_candidate' : 'no_candidate_returned',
        details: { task_count: createdTaskCount },
      });
      const committed = await commit({
        sessionId,
        commandId: decisionFailed
          ? customerActivityDecisionCheckpointCommandId(request.conversationId, resolutions, resolutions.length ? undefined : loaded.state.version)
          : customerActivityDetectionCommandId(request.conversationId),
        commandType: decisionFailed ? 'customer_activity.decision_checkpoint' : 'customer_activity.detect',
        expectedVersion: loaded.state.version,
        state: nextState,
        eventType: decisionFailed
          ? 'customer_activity.proposal_decisions_checkpointed'
          : 'customer_activity.match_completed',
        eventPayload: {
          npcId: request.npcId,
          conversationId: request.conversationId,
          proposalCount: detectedCandidates.length,
          decisionCount: resolutions.length,
          createdTaskCount,
          queueRetained: decisionFailed,
        },
        result: {
          proposalCount: detectedCandidates.length,
          decisionCount: resolutions.length,
          createdTaskCount,
          queueRetained: decisionFailed,
        },
      });
      return { ...loaded, state: committed.state };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'STATE_VERSION_CONFLICT' || attempt === 2) throw error;
    }
  }
  throw new Error('STATE_VERSION_CONFLICT');
}

function customerActivityEvaluationCommandId(taskId: string): string {
  const hash = createHash('sha256').update(taskId).digest('hex').slice(0, 32);
  return `customer-activity-eval:${hash}`;
}

/** Settles only submitted tasks; metric deltas and the idempotency marker share one CAS write. */
export async function processSubmittedCustomerActivityEvaluations(
  sessionId: string,
  userId: string,
): Promise<OwnedGameSession> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await getOwnedGameSession(sessionId, userId, { materializeTimer: false });
    const task = loaded.state.customerActivities.tasks.find((item) => item.status === 'submitted' && !item.evaluation);
    if (!task) return loaded;
    const npc = getProjectOneNpc(task.npcId);
    const evaluation = await evaluateCustomerActivityPlan({
      activityType: task.type,
      summary: task.summary,
      conversation: task.sourceConversation,
      draft: task.draft,
      customerContext: npc ? {
        name: npc.name,
        title: npc.title,
        personality: npc.personality,
        concern: npc.weakness,
        stage: '项目限时推进',
      } : null,
    });
    if (!evaluation) return loaded;
    const nextState = applyCustomerActivityEvaluation(loaded.state, task.id, evaluation, Date.now());
    try {
      const committed = await commitGameCommand({
        sessionId,
        commandId: customerActivityEvaluationCommandId(task.id),
        commandType: 'customer_activity.evaluate',
        expectedVersion: loaded.state.version,
        state: nextState,
        eventType: 'customer_activity.plan_evaluated',
        eventPayload: { taskId: task.id, npcId: task.npcId },
        result: { taskId: task.id },
      });
      return { ...loaded, state: committed.state };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'STATE_VERSION_CONFLICT' || attempt === 2) throw error;
    }
  }
  throw new Error('STATE_VERSION_CONFLICT');
}

export async function commitPhaseTransition(
  sessionId: string,
  state: GameRuntimeState,
  eventType: string,
  eventPayload: Record<string, unknown>,
): Promise<GameRuntimeState> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc('commit_game_phase_transition', {
    p_session_id: sessionId,
    p_expected_version: state.version,
    p_state: state,
    p_total_score: Math.round(getGameOutcome(state).finalScore),
    p_event_type: eventType,
    p_event_payload: eventPayload,
  });
  if (error || typeof data !== 'number') throw new Error(error?.message.includes('STATE_VERSION_CONFLICT') ? 'STATE_VERSION_CONFLICT' : 'PHASE_TRANSITION_FAILED');
  return { ...state, version: data };
}

export async function appendGameEvent(
  sessionId: string,
  round: number,
  eventType: string,
  payload: Record<string, unknown>,
  npcKey?: string,
) {
  const supabase = createServerClient();
  const { error } = await supabase.from('game_events').insert({
    session_id: sessionId,
    npc_key: npcKey ?? null,
    round,
    event_type: eventType,
    payload,
  });
  if (error) throw new Error('EVENT_APPEND_FAILED');
}

export async function appendCompetitorClaim(
  sessionId: string,
  companyId: string,
  npcId: string,
  stage: number,
  statement: string,
): Promise<void> {
  if (!/竞品|ABC|其他厂商/.test(statement)) return;
  const supabase = createServerClient();
  const { data: slot } = await supabase.from('multiplayer_company_slots').select('room_id').eq('game_session_id', sessionId).maybeSingle();
  const { error } = await supabase.from('competitor_claims').insert({
    room_id: slot?.room_id ?? null,
    session_id: sessionId,
    company_id: companyId,
    npc_key: npcId,
    stage,
    statement: statement.slice(0, 2000),
    truth_status: 'unverified',
  });
  if (error) throw new Error('COMPETITOR_CLAIM_SAVE_FAILED');
}

export async function deliverPendingNpcHandoffs(sessionId: string, currentRound: number) {
  const supabase = createServerClient();
  const { data: promised, error } = await supabase
    .from('game_events')
    .select('id, npc_key, round, payload')
    .eq('session_id', sessionId)
    .eq('event_type', 'npc.handoff.promised');
  if (error) throw new Error('HANDOFF_LOAD_FAILED');
  // npc.turn.completed is the durable recovery source. The explicit promised
  // event is written after the atomic command commit; if that best-effort write
  // fails, the completed event still lets delivery progress exactly once.
  const { data: completedTurns, error: completedError } = await supabase
    .from('game_events')
    .select('id, npc_key, round, payload')
    .eq('session_id', sessionId)
    .eq('event_type', 'npc.turn.completed');
  if (completedError) throw new Error('HANDOFF_SOURCE_LOAD_FAILED');
  const { data: sent, error: sentError } = await supabase
    .from('game_events')
    .select('id, npc_key, round, payload')
    .eq('session_id', sessionId)
    .eq('event_type', 'npc.handoff.sent');
  if (sentError) throw new Error('HANDOFF_SENT_LOAD_FAILED');
  const sentPromiseKeys = new Set((sent ?? []).map((event) => String((event.payload as Record<string, unknown>)?.promiseKey ?? '')));
  const explicitPromises = (promised ?? []).map((event) => {
    const payload = event.payload as Record<string, unknown>;
    return {
      ...event,
      promiseKey: String(payload.sourceCommandId ?? payload.commandId ?? event.id),
      sourceNpcId: String(payload.sourceNpcId ?? event.npc_key ?? ''),
      targetNpcId: payload.targetNpcId,
      summary: payload.summary,
    };
  });
  const explicitKeys = new Set(explicitPromises.map((event) => event.promiseKey));
  const recoveredPromises = (completedTurns ?? []).flatMap((event) => {
    const payload = event.payload as Record<string, unknown>;
    const handoff = payload.handoff;
    if (!handoff || typeof handoff !== 'object') return [];
    const value = handoff as Record<string, unknown>;
    const promiseKey = String(payload.commandId ?? event.id);
    if (explicitKeys.has(promiseKey)) return [];
    return [{
      ...event,
      promiseKey,
      sourceNpcId: String(payload.npcId ?? event.npc_key ?? ''),
      targetNpcId: value.targetNpcId,
      summary: value.summary,
    }];
  });
  for (const event of [...explicitPromises, ...recoveredPromises]) {
    if (sentPromiseKeys.has(event.promiseKey)) continue;
    if (typeof event.targetNpcId !== 'string' || typeof event.summary !== 'string') continue;
    await appendGameEvent(sessionId, currentRound, 'npc.handoff.sent', {
      sourceEventId: event.id,
      promiseKey: event.promiseKey,
      sourceNpcId: event.sourceNpcId,
      targetNpcId: event.targetNpcId,
      summary: event.summary,
    }, event.targetNpcId);
  }

  const { data: received, error: receivedError } = await supabase
    .from('game_events')
    .select('payload')
    .eq('session_id', sessionId)
    .eq('event_type', 'npc.handoff.received');
  if (receivedError) throw new Error('HANDOFF_RECEIVED_LOAD_FAILED');
  const receivedSentIds = new Set((received ?? []).map((event) => String((event.payload as Record<string, unknown>)?.sourceEventId ?? '')));
  for (const event of sent ?? []) {
    if (receivedSentIds.has(String(event.id))) continue;
    const payload = event.payload as Record<string, unknown>;
    await appendGameEvent(sessionId, currentRound, 'npc.handoff.received', {
      sourceEventId: event.id,
      sourceNpcId: payload.sourceNpcId ?? event.npc_key,
      targetNpcId: payload.targetNpcId,
      summary: payload.summary,
    }, String(payload.targetNpcId));
  }
}

export async function getNpcInbox(sessionId: string, npcId: string): Promise<NpcInboxItem[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('game_events')
    .select('npc_key, round, payload')
    .eq('session_id', sessionId)
    .eq('event_type', 'npc.handoff.received')
    .eq('npc_key', npcId)
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw new Error('NPC_INBOX_LOAD_FAILED');
  return (data ?? []).map((event) => {
    const payload = event.payload as Record<string, unknown>;
    return { sourceNpcId: String(payload.sourceNpcId ?? 'unknown'), summary: String(payload.summary ?? ''), round: Number(event.round) };
  });
}

export async function saveChatMessage(args: {
  sessionId: string;
  npcId: string;
  round: number;
  role: 'user' | 'assistant';
  content: string;
  affinityDelta?: number;
  scoreDelta?: number;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServerClient();
  const { error } = await supabase.from('chat_messages').insert({
    session_id: args.sessionId,
    decision_maker_id: null,
    round: args.round,
    sender: args.role,
    content: args.content,
    affinity_delta: args.affinityDelta ?? null,
    score_delta: args.scoreDelta ?? null,
    metadata: { npcId: args.npcId, ...args.metadata },
  });
  if (error) throw new Error('CHAT_MESSAGE_SAVE_FAILED');
}

export async function getNpcConversation(sessionId: string, npcId: string, limit = 12): Promise<StoredChatMessage[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, content, round, created_at, metadata')
    .eq('session_id', sessionId)
    .contains('metadata', { npcId })
    .in('sender', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('CHAT_HISTORY_LOAD_FAILED');
  return (data ?? []).reverse().map((message) => ({
    id: String(message.id),
    role: message.sender as 'user' | 'assistant',
    content: String(message.content),
    round: Number(message.round),
    createdAt: String(message.created_at),
    metadata: (message.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}

/** Recent transcript for one channel, kept bounded for activity matching. */
export async function getNpcChannelConversation(
  sessionId: string,
  npcId: string,
  channel: string,
  limit = 120,
): Promise<StoredChatMessage[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, content, round, created_at, metadata')
    .eq('session_id', sessionId)
    .contains('metadata', { npcId, channel })
    .in('sender', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(120, limit)));
  if (error) throw new Error('CHAT_HISTORY_LOAD_FAILED');
  return (data ?? []).reverse().map((message) => ({
    id: String(message.id),
    role: message.sender as 'user' | 'assistant',
    content: String(message.content),
    round: Number(message.round),
    createdAt: String(message.created_at),
    metadata: (message.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}

/**
 * AI evaluation metadata is retained in the durable transcript for server
 * audit and later model work. Player history only needs transport details, so
 * this allowlist prevents score deltas or relationship assessments leaking
 * through the messages endpoint.
 */
export function toPlayerVisibleChatMessages(messages: StoredChatMessage[]): PlayerVisibleChatMessage[] {
  return messages.map((message) => {
    const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
      ? message.metadata
      : {};
    const publicMetadata: Record<string, unknown> = {};
    if (typeof metadata.channel === 'string' && metadata.channel.length <= 32) publicMetadata.channel = metadata.channel;
    if (typeof metadata.deliveryStatus === 'string' && metadata.deliveryStatus.length <= 32) publicMetadata.deliveryStatus = metadata.deliveryStatus;
    if (metadata.readStatus === 'read') publicMetadata.readStatus = 'read';
    if (Array.isArray(metadata.emailAttachments)) {
      const attachments = metadata.emailAttachments.flatMap((attachment) => {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return [];
        const item = attachment as Record<string, unknown>;
        if (typeof item.fileName !== 'string' || typeof item.description !== 'string') return [];
        return [{ fileName: item.fileName.slice(0, 160), description: item.description.slice(0, 1_000) }];
      }).slice(0, 8);
      if (attachments.length) publicMetadata.emailAttachments = attachments;
    }
    if (Array.isArray(metadata.attachments)) {
      // Attachment assessment data can be shown after a refresh, but this is a
      // narrow transport DTO: scores, evaluator payloads and arbitrary nested
      // metadata never cross the player API boundary.
      const attachments = metadata.attachments.flatMap((attachment) => {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return [];
        const item = attachment as Record<string, unknown>;
        if (typeof item.fileName !== 'string' || typeof item.description !== 'string'
          || typeof item.viewed !== 'boolean' || typeof item.impact !== 'string') return [];
        if (!item.fileName.trim() || !item.description.trim() || !item.impact.trim()) return [];
        return [{
          fileName: item.fileName.slice(0, 160),
          description: item.description.slice(0, 1_000),
          viewed: item.viewed,
          impact: item.impact.slice(0, 400),
        }];
      }).slice(0, 8);
      if (attachments.length) publicMetadata.attachments = attachments;
    }
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.round === undefined ? {} : { round: message.round }),
      createdAt: message.createdAt,
      ...(Object.keys(publicMetadata).length ? { metadata: publicMetadata } : {}),
    };
  });
}

export async function getNpcMessageCount(sessionId: string, npcId: string): Promise<number> {
  const supabase = createServerClient();
  const { count, error } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .contains('metadata', { npcId })
    .in('sender', ['user', 'assistant']);
  if (error) throw new Error('CHAT_COUNT_LOAD_FAILED');
  return count ?? 0;
}

export async function getNpcConversationRange(
  sessionId: string,
  npcId: string,
  offset: number,
  limit: number,
): Promise<StoredChatMessage[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, content, round, created_at, metadata')
    .eq('session_id', sessionId)
    .contains('metadata', { npcId })
    .in('sender', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error('CHAT_RANGE_LOAD_FAILED');
  return (data ?? []).map((message) => ({
    id: String(message.id),
    role: message.sender as 'user' | 'assistant',
    content: String(message.content),
    round: Number(message.round),
    createdAt: String(message.created_at),
    metadata: (message.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}

const REVIEW_EVENT_TYPE_SET = new Set<string>(REVIEW_EVENT_TYPES);
const REVIEW_CRITICAL_EVENT_TYPES = new Set<string>([
  'npc.handoff.promised',
  'npc.handoff.sent',
  'npc.handoff.received',
  'gift.delivered',
  'visit.completed',
  'meeting_minutes.updated',
  'session.finished',
  'session.submitted',
]);

const REVIEW_EVENT_FIELDS: Record<string, readonly string[]> = {
  'npc.turn.completed': [
    'npcId', 'channel', 'intent', 'evaluationSource', 'cluesUnlocked',
    'handoff', 'meetingEnded', 'emailAttachmentCount', 'semanticFlags', 'giftAssessment',
    'confirmedFacts', 'commitments', 'publicValueEvidence', 'personalBenefitEvidence',
    'workTopicOpenedBy',
  ],
  'npc.message.unanswered': ['npcId', 'channel', 'intent', 'responseChance', 'emailAttachmentCount'],
  'npc.call.unanswered': ['npcId', 'channel', 'outcome'],
  'npc.call.connected': ['npcId', 'channel', 'outcome'],
  'npc.call.ended': ['npcId'],
  'npc.handoff.promised': ['sourceCommandId', 'sourceNpcId', 'targetNpcId', 'summary'],
  'npc.handoff.sent': ['sourceEventId', 'promiseKey', 'sourceNpcId', 'targetNpcId', 'summary'],
  'npc.handoff.received': ['sourceEventId', 'sourceNpcId', 'targetNpcId', 'summary'],
  'contact.completed': ['npcId', 'channel', 'outcome'],
  'wechat.accepted': ['npcId', 'status'],
  'wechat.rejected': ['npcId', 'status'],
  'wechat.pending': ['npcId', 'status'],
  'wechat.later': ['npcId', 'status'],
  'appointment.pending': [
    'npcId', 'appointmentId', 'status', 'channel', 'extractedFields', 'defaultedFields', 'conditionCount',
  ],
  'appointment.accepted': [
    'npcId', 'appointmentId', 'action', 'conditionCount', 'conditionsSatisfied',
  ],
  'appointment.countered': [
    'npcId', 'appointmentId', 'status', 'channel', 'extractedFields', 'defaultedFields', 'conditionCount',
  ],
  'appointment.cancelled': ['npcId', 'appointmentId', 'action', 'conditionCount', 'conditionsSatisfied'],
  'appointment.missed': ['npcId', 'appointmentId', 'status'],
  'preparation.completed': [
    'npcId', 'appointmentId', 'preparationId', 'type', 'hasPreparationBrief', 'preparationBriefLength',
    'timeMinutes', 'costPoints',
  ],
  'preparation.delivered': ['npcId', 'appointmentId', 'preparationId', 'preparationType', 'deliveredDuringVisit'],
  'visit.started': [
    'npcId', 'appointmentId', 'visitType', 'scheduledRound', 'scheduledMinute', 'preparationCount', 'conditionCount',
  ],
  'visit.completed': [
    'npcId', 'appointmentId', 'visitType', 'reason', 'turnCount', 'maxTurns', 'usedPreparationCount', 'hasPlayerSummary',
  ],
  'gift.delivered': ['preparationId', 'disposition', 'riskId', 'reason', 'source'],
  'meeting_minutes.updated': ['minutesId', 'appointmentId', 'npcId', 'revisionCount'],
  'follow_up.sent': ['npcId', 'appointmentId', 'channel', 'preparationCount'],
  'phase.advanced': [
    'fromRound', 'toRound', 'status', 'pendingAppointmentCount', 'unreadNotificationCount', 'missedAppointmentCount',
    'finalScore', 'won', 'publicValueEvidenceCount', 'personalBenefitEvidenceCount', 'complianceRiskCount',
  ],
  'session.finished': [
    'fromRound', 'toRound', 'status', 'pendingAppointmentCount', 'unreadNotificationCount', 'missedAppointmentCount',
    'finalScore', 'won', 'publicValueEvidenceCount', 'personalBenefitEvidenceCount', 'complianceRiskCount',
  ],
  'session.submitted': [
    'submittedRound', 'earlySubmission', 'warningCodes', 'warningCount', 'publicValueEvidenceCount',
    'personalBenefitEvidenceCount', 'triggeredComplianceRiskCount', 'finalScore', 'won',
  ],
  'public_info.researched': ['npcId', 'factCount', 'weakSignalCount', 'costPoints'],
};

function reviewRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reviewText(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function reviewNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reviewBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function reviewTextList(value: unknown, maxItems = 12, maxLength = 300): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => reviewText(item, maxLength))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(items)).slice(-maxItems);
}

function reviewScalar(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === 'string') return reviewText(value);
  if (typeof value === 'number') return reviewNumber(value);
  if (typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

function reviewSemanticFlags(value: unknown): Record<string, unknown> | undefined {
  const flags = reviewRecord(value);
  const output: Record<string, unknown> = {};
  for (const key of ['negativeInformation', 'riskyConduct', 'giftMentioned', 'explicitQuidProQuo', 'repeatedPressure']) {
    const safe = reviewBoolean(flags[key]);
    if (safe !== undefined) output[key] = safe;
  }
  const type = reviewText(flags.negativeInformationType, 64);
  if (type) output.negativeInformationType = type;
  return Object.keys(output).length ? output : undefined;
}

function reviewGiftAssessment(value: unknown): Record<string, unknown> | undefined {
  const gift = reviewRecord(value);
  const output: Record<string, unknown> = {};
  for (const key of ['giftType', 'outcome', 'riskLevel']) {
    const safe = reviewText(gift[key], 64);
    if (safe) output[key] = safe;
  }
  const reason = reviewText(gift.riskReason, 180);
  if (reason) output.riskReason = reason;
  return Object.keys(output).length ? output : undefined;
}

function reviewHandoff(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  const handoff = reviewRecord(value);
  const targetNpcId = reviewText(handoff.targetNpcId, 128);
  const summary = reviewText(handoff.summary, 180);
  if (!targetNpcId || !summary) return undefined;
  return { targetNpcId, summary };
}

function sanitizeReviewMetadata(value: unknown): Record<string, unknown> | undefined {
  const metadata = reviewRecord(value);
  const output: Record<string, unknown> = {};
  for (const key of [
    'npcId', 'intent', 'channel', 'deliveryStatus', 'meetingId', 'meetingTurn', 'meetingType',
    'evaluationSource', 'protocolValid', 'workTopicOpenedBy',
  ]) {
    const safe = reviewScalar(metadata[key]);
    if (safe !== undefined) output[key] = safe;
  }
  for (const key of ['cluesUnlocked', 'confirmedFacts', 'commitments', 'publicValueEvidence', 'personalBenefitEvidence']) {
    const safe = reviewTextList(metadata[key], 4, 220);
    if (safe.length) output[key] = safe;
  }
  const semanticFlags = reviewSemanticFlags(metadata.semanticFlags);
  if (semanticFlags) output.semanticFlags = semanticFlags;
  const giftAssessment = reviewGiftAssessment(metadata.giftAssessment);
  if (giftAssessment) output.giftAssessment = giftAssessment;
  const handoff = reviewHandoff(metadata.handoff);
  if (handoff !== undefined) output.handoff = handoff;
  if (Array.isArray(metadata.emailAttachments)) output.emailAttachmentCount = metadata.emailAttachments.length;
  if (Array.isArray(metadata.usedPreparationIds)) output.usedPreparationCount = metadata.usedPreparationIds.length;
  return Object.keys(output).length ? output : undefined;
}

function sanitizeReviewEventPayload(eventType: string, value: unknown): Record<string, unknown> {
  const payload = reviewRecord(value);
  const output: Record<string, unknown> = {};
  for (const key of REVIEW_EVENT_FIELDS[eventType] ?? []) {
    if (key === 'semanticFlags') {
      const safe = reviewSemanticFlags(payload[key]);
      if (safe) output[key] = safe;
      continue;
    }
    if (key === 'giftAssessment') {
      const safe = reviewGiftAssessment(payload[key]);
      if (safe) output[key] = safe;
      continue;
    }
    if (key === 'handoff') {
      const safe = reviewHandoff(payload[key]);
      if (safe !== undefined) output[key] = safe;
      continue;
    }
    if (['cluesUnlocked', 'confirmedFacts', 'commitments', 'publicValueEvidence', 'personalBenefitEvidence', 'extractedFields', 'defaultedFields', 'warningCodes'].includes(key)) {
      const safe = reviewTextList(payload[key], 12, 220);
      if (safe.length) output[key] = safe;
      continue;
    }
    const safe = reviewScalar(payload[key]);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function eventHasCriticalReviewData(event: ReviewContextEvent): boolean {
  if (REVIEW_CRITICAL_EVENT_TYPES.has(event.eventType)) return true;
  const payload = event.payload;
  const flags = reviewRecord(payload.semanticFlags);
  return event.eventType === 'npc.turn.completed' && (
    flags.riskyConduct === true
    || flags.explicitQuidProQuo === true
    || flags.giftMentioned === true
    || reviewTextList(payload.commitments).length > 0
    || reviewTextList(payload.confirmedFacts).length > 0
    || reviewHandoff(payload.handoff) !== undefined
  );
}

function eventTimestamp(event: { createdAt: string; round: number; id: string }): number {
  const parsed = Date.parse(event.createdAt);
  return Number.isFinite(parsed) ? parsed : event.round;
}

function sortReviewEvents(events: ReviewContextEvent[]): ReviewContextEvent[] {
  return [...events].sort((left, right) =>
    eventTimestamp(left) - eventTimestamp(right)
    || left.round - right.round
    || left.id.localeCompare(right.id));
}

function sanitizeReviewEvents(events: StoredGameEvent[]): ReviewContextEvent[] {
  const candidates = sortReviewEvents(events.flatMap((event) => {
    if (!REVIEW_EVENT_TYPE_SET.has(event.eventType)) return [];
    const payload = sanitizeReviewEventPayload(event.eventType, event.payload);
    const rawNpcId = reviewText(event.npcId, 128) ?? reviewText(event.payload?.npcId, 128);
    return [{
      id: event.id,
      npcId: rawNpcId ?? null,
      round: Number.isFinite(event.round) ? event.round : 0,
      eventType: event.eventType,
      payload,
      createdAt: event.createdAt,
    } satisfies ReviewContextEvent];
  }));
  if (candidates.length <= REVIEW_KEY_EVENT_LIMIT) return candidates;
  const recent = candidates.slice(-REVIEW_KEY_EVENT_LIMIT);
  const critical = candidates.filter(eventHasCriticalReviewData).slice(-REVIEW_KEY_EVENT_LIMIT);
  return sortReviewEvents(Array.from(new Map([...critical, ...recent].map((event) => [event.id, event])).values()));
}

function sanitizeReviewMessages(transcript: StoredChatMessage[]): ReviewContextMessage[] {
  return transcript
    .slice(-REVIEW_RECENT_MESSAGE_LIMIT)
    .map((message) => {
      const metadata = sanitizeReviewMetadata(message.metadata);
      const npcId = reviewText(message.metadata?.npcId, 128);
      return {
        id: message.id,
        role: message.role,
        content: reviewText(message.content, 600) ?? '',
        ...(Number.isFinite(message.round) ? { round: message.round } : {}),
        createdAt: message.createdAt,
        ...(npcId ? { npcId } : {}),
        ...(metadata ? { metadata } : {}),
      } satisfies ReviewContextMessage;
    });
}

function sanitizeReviewEvidence(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const evidence = reviewRecord(item);
    const statement = reviewText(evidence.statement, 300);
    const npcId = reviewText(evidence.npcId, 128);
    if (!statement || !npcId) return [];
    return [{
      id: reviewText(evidence.id, 160) ?? `${npcId}:${statement.slice(0, 24)}`,
      npcId,
      statement,
      strength: reviewNumber(evidence.strength),
      source: reviewText(evidence.source, 64),
      confirmedRound: reviewNumber(evidence.confirmedRound),
    }];
  }).slice(-48);
}

function sanitizeReviewRisks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const risk = reviewRecord(item);
    const id = reviewText(risk.id, 160);
    const npcId = reviewText(risk.npcId, 128);
    const kind = reviewText(risk.kind, 64);
    const status = reviewText(risk.status, 32);
    if (!id || !npcId || !kind || !status) return [];
    return [{
      id,
      npcId,
      preparationId: reviewText(risk.preparationId, 160) ?? null,
      kind,
      severity: reviewNumber(risk.severity),
      status,
      penalty: reviewNumber(risk.penalty),
      reason: reviewText(risk.reason, 300),
      createdRound: reviewNumber(risk.createdRound),
      triggerRound: reviewNumber(risk.triggerRound),
      outcome: reviewText(risk.outcome, 64) ?? null,
    }];
  }).slice(-48);
}

function sanitizeReviewMemory(value: unknown): ReviewMemory {
  const memory = reviewRecord(value);
  return {
    summary: reviewText(memory.summary, 1200) ?? '',
    summarizedMessageCount: Math.max(0, Math.floor(reviewNumber(memory.summarizedMessageCount) ?? 0)),
    confirmedFacts: reviewTextList(memory.confirmedFacts, 12, 300),
    commitments: reviewTextList(memory.commitments, 12, 300),
  };
}

function sanitizeReviewState(state: GameRuntimeState): Record<string, unknown> {
  const dimensions = reviewRecord(state.dimensions);
  const safeDimensions = Object.fromEntries(Object.entries(dimensions).flatMap(([key, value]) => {
    const number = reviewNumber(value);
    return number === undefined ? [] : [[key, number]];
  }));
  const contacts = Object.fromEntries(Object.entries(state.npcContacts ?? {}).flatMap(([npcId, value]) => {
    const contact = reviewRecord(value);
    return [[npcId, {
      status: reviewText(contact.status, 32),
      wechatStatus: reviewText(contact.wechatStatus, 32),
      hasReplied: reviewBoolean(contact.hasReplied),
      outboundCount: reviewNumber(contact.outboundCount),
      lastContactRound: reviewNumber(contact.lastContactRound),
      lastPhoneOutcome: reviewText(contact.lastPhoneOutcome, 32),
    }]];
  }));
  const appointments = (state.appointments ?? []).slice(-32).map((appointment) => ({
    id: appointment.id,
    npcId: appointment.npcId,
    invitationMethod: appointment.invitationMethod,
    visitType: appointment.visitType,
    venue: reviewText(appointment.venue, 120),
    purpose: reviewText(appointment.purpose, 300),
    scheduledRound: appointment.scheduledRound,
    startMinute: appointment.startMinute,
    durationMinutes: appointment.durationMinutes,
    maxTurns: appointment.maxTurns,
    status: appointment.status,
    conditions: reviewTextList(appointment.conditions, 8, 180),
    reservedMinutes: appointment.reservedMinutes,
    workTopicOpenedBy: appointment.workTopicOpenedBy,
    emailAttachmentCount: appointment.emailAttachments?.length ?? 0,
  }));
  const preparations = (state.preparations ?? []).slice(-48).map((preparation) => ({
    id: preparation.id,
    npcId: preparation.npcId,
    appointmentId: preparation.appointmentId,
    type: preparation.type,
    title: preparation.title,
    status: preparation.status,
    costPoints: preparation.costPoints,
    timeMinutes: preparation.timeMinutes,
    reusable: preparation.reusable,
    usedCount: preparation.usedCount,
    createdRound: preparation.createdRound,
    hasContent: Boolean(preparation.content?.trim()),
    semanticTags: reviewTextList(preparation.brief?.semanticTags, 8, 64),
  }));
  const meetingMinutes = (state.meetingMinutes ?? []).slice(-24).map((minutes) => ({
    id: minutes.id,
    appointmentId: minutes.appointmentId,
    npcId: minutes.npcId,
    visitType: minutes.visitType,
    summary: reviewText(minutes.summary, 400),
    confirmedItems: reviewTextList(minutes.confirmedItems, 12, 300),
    npcCommitments: reviewTextList(minutes.npcCommitments, 12, 300),
    playerCommitments: reviewTextList(minutes.playerCommitments, 12, 300),
    pendingMaterials: reviewTextList(minutes.pendingMaterials, 12, 180),
    nextStep: reviewText(minutes.nextStep, 300),
    nextStepRound: minutes.nextStepRound,
    revisionCount: minutes.revisionCount ?? 0,
    original: minutes.original ? {
      summary: reviewText(minutes.original.summary, 400),
      confirmedItems: reviewTextList(minutes.original.confirmedItems, 12, 300),
      npcCommitments: reviewTextList(minutes.original.npcCommitments, 12, 300),
      playerCommitments: reviewTextList(minutes.original.playerCommitments, 12, 300),
      nextStep: reviewText(minutes.original.nextStep, 300),
    } : undefined,
  }));
  return {
    status: state.status,
    currentRound: state.currentRound,
    maxRounds: state.maxRounds,
    currentStage: state.currentStage,
    maxStages: state.maxStages,
    actionPoints: state.actionPoints,
    cumulativeTimeMinutes: state.cumulativeTimeMinutes,
    cumulativeSpentPoints: state.cumulativeSpentPoints,
    dimensions: safeDimensions,
    npcContacts: contacts,
    unlockedClues: reviewTextList(state.unlockedClues, 16, 64),
    outcomeEvidence: {
      publicValue: sanitizeReviewEvidence(state.outcomeEvidence?.publicValue),
      personalBenefit: sanitizeReviewEvidence(state.outcomeEvidence?.personalBenefit),
    },
    complianceRisks: sanitizeReviewRisks(state.complianceRisks),
    appointments,
    preparations,
    meetingMinutes,
    lastAction: reviewText(state.lastAction, 64) ?? null,
  };
}

/**
 * Build the bounded, model-facing review context without performing I/O.
 * Older turns survive through each NPC's rolling memory and durable state/event
 * ledgers; only the newest raw messages are retained for conversational nuance.
 */
export function buildReviewContext(args: {
  state: GameRuntimeState;
  transcript: StoredChatMessage[];
  events: StoredGameEvent[];
}): ReviewContext {
  const npcIds = new Set<string>([
    ...Object.keys(args.state.conversationMemories ?? {}),
    ...Object.keys(args.state.npcAttitudes ?? {}),
    ...Object.keys(args.state.npcAffinity ?? {}),
    ...Object.keys(args.state.npcContacts ?? {}),
  ]);
  const npcMemories = Object.fromEntries(Array.from(npcIds).sort().map((npcId) => [
    npcId,
    sanitizeReviewMemory(args.state.conversationMemories?.[npcId]),
  ]));
  return {
    npcMemories,
    persistentState: sanitizeReviewState(args.state),
    keyEvents: sanitizeReviewEvents(args.events),
    recentMessages: sanitizeReviewMessages(args.transcript),
  };
}

/**
 * Reviews are player-facing. Reuse the public settlement DTO so an LLM cannot
 * turn a private support score or band into prose in the final report.
 */
export function toReviewOutcome(outcome: GameOutcome): Record<string, unknown> {
  const playerOutcome = { ...toPlayerVisibleGameOutcome(outcome) } as Partial<ReturnType<typeof toPlayerVisibleGameOutcome>>;
  delete playerOutcome.competitivePosition;
  return playerOutcome;
}

export async function getSessionReviewEvents(sessionId: string, limit = REVIEW_KEY_EVENT_LIMIT): Promise<StoredGameEvent[]> {
  const supabase = createServerClient();
  const safeLimit = Math.max(1, Math.min(REVIEW_KEY_EVENT_LIMIT, Math.floor(limit)));
  const { data, error } = await supabase
    .from('game_events')
    .select('id, npc_key, round, event_type, payload, created_at')
    .eq('session_id', sessionId)
    .in('event_type', REVIEW_EVENT_TYPES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('SESSION_REVIEW_EVENTS_LOAD_FAILED');
  return (data ?? []).reverse().map((event) => ({
    id: String(event.id),
    npcId: event.npc_key ? String(event.npc_key) : null,
    round: Number(event.round),
    eventType: String(event.event_type),
    payload: reviewRecord(event.payload),
    createdAt: String(event.created_at),
  }));
}

export async function getSessionTranscript(sessionId: string, limit = REVIEW_RECENT_MESSAGE_LIMIT): Promise<StoredChatMessage[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender, content, round, created_at, metadata')
    .eq('session_id', sessionId)
    .in('sender', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(REVIEW_RECENT_MESSAGE_LIMIT, Math.floor(limit))));
  if (error) throw new Error('SESSION_TRANSCRIPT_LOAD_FAILED');
  return (data ?? []).reverse().map((message) => ({
    id: String(message.id),
    role: message.sender as 'user' | 'assistant',
    content: String(message.content),
    round: Number(message.round),
    createdAt: String(message.created_at),
    metadata: (message.metadata as Record<string, unknown> | null) ?? undefined,
  }));
}

export async function getStoredReview(sessionId: string): Promise<GameReview | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('game_sessions')
    .select('final_report')
    .eq('id', sessionId)
    .single();
  if (error || !data) throw new Error('FINAL_REPORT_LOAD_FAILED');
  const report = data.final_report as { review?: GameReview; reviewContextVersion?: number } | null;
  // Reviews written before the bounded context was introduced may have been
  // generated from the oldest transcript page. Regenerate those once so a
  // stale result cannot preserve an incomplete or unsafe review.
  return report?.reviewContextVersion === REVIEW_CONTEXT_VERSION ? report.review ?? null : null;
}

export async function saveStoredReview(sessionId: string, state: GameRuntimeState, review: GameReview) {
  const supabase = createServerClient();
  const outcome = getGameOutcome(state);
  const { error } = await supabase
    .from('game_sessions')
    .update({
      final_report: {
      ...state,
      totalScore: outcome.finalScore,
      outcome,
      reviewContextVersion: REVIEW_CONTEXT_VERSION,
      review,
      },
    })
    .eq('id', sessionId);
  if (error) throw new Error('FINAL_REVIEW_SAVE_FAILED');
}
