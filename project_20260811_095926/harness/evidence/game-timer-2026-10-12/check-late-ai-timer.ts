import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAdminClient } from '../../../projects/src/storage/database/supabase-client';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evidenceDir, '../../..');
const projectRoot = path.join(repoRoot, 'projects');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const dotenv = projectRequire('dotenv') as { config: (options: Record<string, unknown>) => unknown };
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: false, quiet: true });

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const admin = createAdminClient();
const durationMs = 20 * 60 * 1_000;
const recoveryIntervalMs = 5 * 60 * 1_000;
const seededRemainingMs = 1_800;
const temporaryUserIds: string[] = [];

type JsonRecord = Record<string, any>;
type ApiResult = { response: Response; payload: JsonRecord; rawText: string };

function safeCode(payload: JsonRecord | undefined) {
  const candidate = payload?.details?.code ?? payload?.error;
  return typeof candidate === 'string' && /^[A-Z0-9_:-]{1,100}$/.test(candidate)
    ? candidate
    : candidate
      ? 'UNCLASSIFIED_API_ERROR'
      : 'NONE';
}

async function request(pathname: string, init: RequestInit = {}, sessionToken?: string): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(300_000),
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'x-session': sessionToken } : {}),
      ...init.headers,
    },
  });
  const rawText = await response.text();
  let payload: JsonRecord = {};
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as JsonRecord;
  } catch {
    // A successful chat response may be SSE; callers inspect only event names.
  }
  return { response, payload, rawText };
}

function sseEventTypes(rawText: string) {
  return rawText.split(/\r?\n/)
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .flatMap((line) => {
      try {
        const item = JSON.parse(line.slice(6)) as JsonRecord;
        return typeof item.type === 'string' ? [item.type] : [];
      } catch {
        return [];
      }
    });
}

async function createEphemeralGame(label: string) {
  const username = `late_ai_${label}_${randomUUID().replaceAll('-', '')}`;
  const userId = `u_${username}`;
  temporaryUserIds.push(userId);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username, password: `test-${randomUUID()}` }),
  });
  assert.equal(login.response.status, 200, `temporary ${label} account login should succeed (code=${safeCode(login.payload)})`);
  const loginToken = String(login.payload.loginToken ?? '');
  assert.ok(loginToken, `temporary ${label} account should receive a login proof`);

  const selected = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'select_role', loginToken, role: 'player', subRole: 'paid_individual' }),
  });
  assert.equal(selected.response.status, 200, `temporary ${label} role selection should succeed (code=${safeCode(selected.payload)})`);
  const token = String(selected.payload.token ?? '');
  assert.ok(token && selected.payload.session?.role === 'player', `temporary ${label} player session should be returned`);

  const created = await request('/api/game/sessions', {
    method: 'POST',
    body: JSON.stringify({ scenarioCode: 'project-1', replaceExisting: false }),
  }, token);
  assert.equal(created.response.status, 200, `temporary ${label} game should be created (code=${safeCode(created.payload)})`);
  const gameSession = created.payload.gameSession as JsonRecord | undefined;
  assert.ok(gameSession?.id && gameSession.state, `temporary ${label} game should expose its id and initial state`);
  return { userId, token, sessionId: String(gameSession.id), initialState: gameSession.state as JsonRecord };
}

async function readRuntime(sessionId: string) {
  const { data, error } = await admin.from('game_runtime_states')
    .select('session_id, version, action_points, simulation_state')
    .eq('session_id', sessionId)
    .maybeSingle();
  assert.equal(error, null, 'runtime row must be readable through the admin client');
  assert.ok(data, 'temporary game runtime row must exist');
  return data as JsonRecord;
}

async function seedNearDeadline(sessionId: string) {
  const runtime = await readRuntime(sessionId);
  const state = runtime.simulation_state as JsonRecord;
  const timer = state.projectTimer as JsonRecord | undefined;
  assert.ok(timer, 'only the temporary runtime projectTimer is required for the boundary seed');
  assert.equal(Number(state.version), Number(runtime.version), 'runtime snapshot and row versions agree before seeding');
  const elapsedMs = durationMs - seededRemainingMs;
  const seedStartedAt = Date.now();
  const nextState = {
    ...state,
    projectTimer: {
      ...timer,
      durationMs,
      elapsedMs,
      lastResumedAt: new Date(seedStartedAt).toISOString(),
      recoveredIntervals: Math.floor(elapsedMs / recoveryIntervalMs),
      visitPaused: false,
    },
  };
  const { data, error } = await admin.from('game_runtime_states')
    .update({ simulation_state: nextState })
    .eq('session_id', sessionId)
    .eq('version', runtime.version)
    .select('session_id, version')
    .limit(1);
  assert.equal(error, null, 'admin timer seed for the temporary runtime row should succeed');
  assert.equal(data?.length, 1, 'admin timer seed must match exactly one temporary runtime row/version');

  const remainingAtDispatchMs = seededRemainingMs - (Date.now() - seedStartedAt);
  assert.ok(remainingAtDispatchMs >= 500 && remainingAtDispatchMs <= 2_000,
    `timer should still have 0.5–2 seconds when the API request is dispatched (remaining=${remainingAtDispatchMs}ms)`);
  return { runtime, baselineState: state, baselineActionPoints: Number(runtime.action_points), remainingAtDispatchMs };
}

async function inspectTerminalSave(args: {
  label: string;
  sessionId: string;
  baselineActionPoints: number;
  baselineWorkPlanCount: number;
  baselineChatCount: number;
  commandId: string;
}) {
  const [sessionResult, runtimeResult, eventResult, chatResult, commandResult] = await Promise.all([
    admin.from('game_sessions').select('id, status, final_report, finished_at').eq('id', args.sessionId).maybeSingle(),
    admin.from('game_runtime_states').select('session_id, version, action_points, simulation_state').eq('session_id', args.sessionId).maybeSingle(),
    admin.from('game_events').select('id, event_type, payload').eq('session_id', args.sessionId).order('created_at', { ascending: true }),
    admin.from('chat_messages').select('id').eq('session_id', args.sessionId),
    admin.from('game_command_records').select('command_id, command_type').eq('session_id', args.sessionId),
  ]);
  assert.equal(sessionResult.error, null, `${args.label} game session should be readable`);
  assert.equal(runtimeResult.error, null, `${args.label} runtime should be readable`);
  assert.equal(eventResult.error, null, `${args.label} timer events should be readable`);
  assert.equal(chatResult.error, null, `${args.label} chat rows should be readable`);
  assert.equal(commandResult.error, null, `${args.label} command records should be readable`);

  const session = sessionResult.data as JsonRecord | null;
  const runtime = runtimeResult.data as JsonRecord | null;
  assert.ok(session && runtime, `${args.label} persisted terminal session/runtime should exist`);
  const state = runtime.simulation_state as JsonRecord;
  const timer = state.projectTimer as JsonRecord | undefined;
  assert.ok(timer, `${args.label} terminal runtime must retain its project timer`);
  assert.notEqual(session.status, 'playing', `${args.label} deadline must settle the game`);
  assert.ok(session.final_report && typeof session.final_report === 'object', `${args.label} final_report must be persisted`);
  assert.equal((session.final_report as JsonRecord).status, session.status, `${args.label} final_report and session status must agree`);
  assert.equal(state.status, session.status, `${args.label} runtime and session status must agree`);
  assert.equal(runtime.version, state.version, `${args.label} runtime row and snapshot versions must agree`);
  assert.equal(timer.elapsedMs, durationMs, `${args.label} runtime timer must be settled at 20 minutes`);
  assert.equal(state.actionPoints, args.baselineActionPoints, `${args.label} timeout recovery must not turn the work-plan/message attempt into an AP charge`);
  assert.equal(runtime.action_points, args.baselineActionPoints, `${args.label} action points must match the runtime column`);
  assert.equal((state.workPlans as unknown[] | undefined)?.length ?? 0, args.baselineWorkPlanCount,
    `${args.label} must not add a work plan after the AI call crossed the deadline`);

  const events = (eventResult.data ?? []) as JsonRecord[];
  const deadlineEvents = events.filter((event) => event.event_type === 'project_timer.expired');
  assert.ok(deadlineEvents.length >= 1, `${args.label} must persist a project_timer.expired event`);
  assert.equal((deadlineEvents.at(-1)?.payload as JsonRecord | undefined)?.elapsedMs, durationMs,
    `${args.label} deadline event must record the same timer boundary as runtime`);
  assert.equal((deadlineEvents.at(-1)?.payload as JsonRecord | undefined)?.actionPoints, args.baselineActionPoints,
    `${args.label} deadline event must retain baseline action points`);
  assert.equal(events.some((event) => event.event_type === 'work_plan.completed'), false,
    `${args.label} must not persist a work_plan.completed event`);
  assert.equal((chatResult.data ?? []).length, args.baselineChatCount, `${args.label} must not write chat messages after timeout`);
  assert.equal((commandResult.data ?? []).some((record: JsonRecord) => record.command_id === args.commandId), false,
    `${args.label} must not commit the in-flight command`);
  assert.equal((commandResult.data ?? []).some((record: JsonRecord) => record.command_type === 'work_plan'), false,
    `${args.label} must not record a completed work-plan command`);

  return { status: String(session.status), actionPoints: Number(runtime.action_points), version: Number(runtime.version), workPlanCount: (state.workPlans as unknown[] | undefined)?.length ?? 0, deadlineEventCount: deadlineEvents.length };
}

async function testLateWorkPlan() {
  const game = await createEphemeralGame('plan');
  const baselineState = game.initialState;
  const baselineWorkPlanCount = Array.isArray(baselineState.workPlans) ? baselineState.workPlans.length : 0;
  const { data: baselineChatRows, error: baselineChatError } = await admin.from('chat_messages').select('id').eq('session_id', game.sessionId);
  assert.equal(baselineChatError, null, 'work-plan baseline chat rows should be readable');
  const { baselineActionPoints, remainingAtDispatchMs } = await seedNearDeadline(game.sessionId);
  const commandId = `late-work-plan-${randomUUID()}`;
  const startedAt = Date.now();
  console.log(`Dispatching one valid work_plan request with approximately ${remainingAtDispatchMs}ms remaining; no token/account details are logged.`);
  const result = await request(`/api/game/sessions/${game.sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId,
      expectedVersion: Number(baselineState.version),
      type: 'work_plan',
      payload: {
        scope: 'global',
        content: '围绕招标决策链与验收指标制定推进计划：先确认预算边界、关键联系人和技术验收证据，再安排技术交流并明确负责人和时间节点。',
      },
    }),
  }, game.token);
  const elapsedMs = Date.now() - startedAt;
  const responseCode = safeCode(result.payload);
  if (responseCode.startsWith('AI_PROVIDER_')) {
    throw new Error(`work_plan real-model request failed at the provider boundary (HTTP ${result.response.status}, code=${responseCode}); this is not a late-AI timer pass`);
  }
  assert.equal(responseCode, 'GAME_ALREADY_FINISHED',
    `work_plan should finish AI evaluation then hit the server deadline guard (HTTP ${result.response.status}, code=${responseCode}, elapsed=${elapsedMs}ms)`);
  assert.ok(elapsedMs >= remainingAtDispatchMs, 'work_plan request should remain in flight across its seeded deadline');

  const persisted = await inspectTerminalSave({
    label: 'work_plan',
    sessionId: game.sessionId,
    baselineActionPoints,
    baselineWorkPlanCount,
    baselineChatCount: baselineChatRows?.length ?? 0,
    commandId,
  });
  console.log(`work_plan guard verified: response=${responseCode}, elapsed=${elapsedMs}ms, terminal=${persisted.status}, AP=${persisted.actionPoints}, plans=${persisted.workPlanCount}, deadlineEvents=${persisted.deadlineEventCount}.`);
  return { elapsedMs, responseCode, ...persisted };
}

async function testLateEmailChat() {
  const game = await createEphemeralGame('email');
  const baselineState = game.initialState;
  const baselineWorkPlanCount = Array.isArray(baselineState.workPlans) ? baselineState.workPlans.length : 0;
  const { data: baselineChatRows, error: baselineChatError } = await admin.from('chat_messages').select('id').eq('session_id', game.sessionId);
  assert.equal(baselineChatError, null, 'email-chat baseline rows should be readable');
  const { baselineActionPoints, remainingAtDispatchMs } = await seedNearDeadline(game.sessionId);
  const commandId = `late-email-chat-${randomUUID()}`;
  const startedAt = Date.now();
  console.log(`Dispatching one email outreach request with approximately ${remainingAtDispatchMs}ms remaining; this performs one real chat attempt.`);
  const result = await request('/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify({
      gameSessionId: game.sessionId,
      scenarioId: 'project-1',
      npcId: 'P1-002',
      message: '您好，我想确认当前招标项目的公开技术交流安排。建议先围绕验收指标、交付案例和时间节点沟通，并明确双方下一步负责人。',
      intent: 'outreach',
      channel: 'email',
      commandId,
      expectedVersion: Number(baselineState.version),
      contextType: 'online',
      attachments: [],
      emailAttachments: [],
      usedPreparationIds: [],
    }),
  }, game.token);
  const elapsedMs = Date.now() - startedAt;
  const responseCode = safeCode(result.payload);
  if (responseCode.startsWith('AI_PROVIDER_')) {
    throw new Error(`email real-model request failed at the provider boundary (HTTP ${result.response.status}, code=${responseCode}); this is not a late-AI timer pass`);
  }
  if (responseCode === 'CHAT_TURN_FAILED' || responseCode === 'UNCLASSIFIED_API_ERROR') {
    let persistedDiagnostic = 'terminal save inspection failed';
    try {
      const persisted = await inspectTerminalSave({
        label: 'email chat after ambiguous API error',
        sessionId: game.sessionId,
        baselineActionPoints,
        baselineWorkPlanCount,
        baselineChatCount: baselineChatRows?.length ?? 0,
        commandId,
      });
      persistedDiagnostic = `terminal=${persisted.status}, AP=${persisted.actionPoints}, plans=${persisted.workPlanCount}, deadlineEvents=${persisted.deadlineEventCount}`;
    } catch (inspectionError) {
      const errorType = inspectionError instanceof Error && /^[A-Za-z]+Error$/.test(inspectionError.name)
        ? inspectionError.name
        : 'unknown inspection error';
      persistedDiagnostic = `terminal inspection failed (${errorType})`;
    }
    throw new Error(`email request returned an ambiguous server error (HTTP ${result.response.status}, code=${responseCode}, elapsed=${elapsedMs}ms, SSE events=${sseEventTypes(result.rawText).join(',') || 'none'}; ${persistedDiagnostic}); do not claim model completion without server confirmation`);
  }
  assert.equal(responseCode, 'GAME_ALREADY_FINISHED',
    `email chat should finish its AI work then hit the server deadline guard (HTTP ${result.response.status}, code=${responseCode}, SSE events=${sseEventTypes(result.rawText).join(',')}, elapsed=${elapsedMs}ms)`);
  assert.ok(elapsedMs >= remainingAtDispatchMs, 'email request should remain in flight across its seeded deadline');

  const persisted = await inspectTerminalSave({
    label: 'email chat',
    sessionId: game.sessionId,
    baselineActionPoints,
    baselineWorkPlanCount,
    baselineChatCount: baselineChatRows?.length ?? 0,
    commandId,
  });
  console.log(`email chat guard verified: response=${responseCode}, elapsed=${elapsedMs}ms, terminal=${persisted.status}, AP=${persisted.actionPoints}, chat rows unchanged, deadlineEvents=${persisted.deadlineEventCount}.`);
  return { elapsedMs, responseCode, ...persisted };
}

async function cleanup() {
  for (const userId of temporaryUserIds) {
    const { error } = await admin.from('game_sessions').delete().eq('user_id', userId);
    if (error) throw new Error('late-AI temporary game-session cleanup failed');
    const { data, error: verifyError } = await admin.from('game_sessions').select('id').eq('user_id', userId).limit(1);
    if (verifyError || (data?.length ?? 0) > 0) throw new Error('late-AI temporary save remains after cleanup');
  }
}

async function main() {
  const { error: connectivityError } = await admin.from('game_sessions').select('id').limit(1);
  assert.equal(connectivityError, null, 'Supabase admin read must succeed before late-AI live checks');

  try {
    const failures: string[] = [];
    let workPlan: Awaited<ReturnType<typeof testLateWorkPlan>> | undefined;
    let email: Awaited<ReturnType<typeof testLateEmailChat>> | undefined;
    try {
      workPlan = await testLateWorkPlan();
    } catch (error) {
      failures.push(`work_plan: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
    // Run the one permitted email attempt even if work_plan had a provider or
    // assertion failure, so the two API paths remain independently observable.
    try {
      email = await testLateEmailChat();
    } catch (error) {
      failures.push(`email chat: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
    if (failures.length) throw new Error(`Late-AI timer acceptance failed: ${failures.join(' | ')}`);
    assert.ok(workPlan && email, 'both the work-plan and email timer cases must complete');
    console.log(`Late-AI timer acceptance passed: work_plan reached post-model expiry guard after ${workPlan.elapsedMs}ms and email chat reached its expiry guard after ${email.elapsedMs}ms; both persisted terminal reports/events with no command, plan, AP charge, or chat commit. One work-plan evaluation and one email attempt used the real configured model services.`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'late-AI timer acceptance failed');
  process.exitCode = 1;
});
