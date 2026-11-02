import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createAdminClient } from '../src/storage/database/supabase-client';
import type { GameAppointment, GameRuntimeState } from '../src/lib/game/state';

dotenv.config({ path: '.env.local', override: false, quiet: true });

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const userId = `u_project_one_timer_e2e_${Date.now()}`;
let sessionId = '';
let currentState: GameRuntimeState;

function makeCommandId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function jsonRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session': token } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${payload.error || 'unknown error'}`);
  return payload;
}

async function command(
  token: string,
  type: string,
  payload: Record<string, unknown> = {},
  options?: { commandId?: string; expectedVersion?: number },
) {
  const commandId = options?.commandId ?? makeCommandId(type);
  const expectedVersion = options?.expectedVersion ?? currentState.version;
  const response = await jsonRequest<{
    state: GameRuntimeState;
    result: Record<string, unknown>;
    replayed: boolean;
  }>(`/api/game/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ commandId, expectedVersion, type, payload }),
  }, token);
  currentState = response.state;
  return { ...response, commandId, expectedVersion };
}

async function chatInvitation(token: string, message: string, channel: 'email' | 'work_phone' | 'online', attachmentIds: string[] = []) {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session': token },
    body: JSON.stringify({
      gameSessionId: sessionId,
      scenarioId: 'project-1',
      npcId: 'P1-004',
      message,
      intent: 'message',
      channel,
      commandId: makeCommandId('natural-invite'),
      expectedVersion: currentState.version,
      contextType: 'online',
      attachmentIds,
      usedPreparationIds: [],
    }),
  });
  const raw = await response.text();
  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  if (!response.ok) {
    const errorEvent = events.find((event) => event.type === 'error');
    throw new Error(`/api/chat/stream HTTP ${response.status}: ${String(errorEvent?.error ?? raw)}`);
  }
  const result = events.find((event) => event.type === 'result') as { state?: GameRuntimeState; [key: string]: unknown } | undefined;
  assert(result?.state, 'natural invitation chat should return a committed state');
  currentState = result.state;
  return { result, events };
}

async function cleanup() {
  if (!sessionId) return;
  const { error } = await createAdminClient().from('game_sessions').delete().eq('id', sessionId);
  if (error) console.warn(`E2E cleanup failed for ${sessionId}: ${error.message}`);
}

async function main() {
  const authenticated = await jsonRequest<{ userId: string; loginToken: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username: userId, password: 'e2e-test-password' }),
  });
  const login = await jsonRequest<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      action: 'select_role',
      loginToken: authenticated.loginToken,
      role: 'player',
      subRole: 'paid_individual',
    }),
  });
  assert(login.token);

  const created = await jsonRequest<{ gameSession: { id: string; state: GameRuntimeState } }>(
    '/api/game/sessions',
    { method: 'POST', body: JSON.stringify({ scenarioCode: 'project-1' }) },
    login.token,
  );
  sessionId = created.gameSession.id;
  currentState = created.gameSession.state;
  console.log(`project-one timer e2e started: session=${sessionId}`);

  // Progress now follows one 20-minute project timer; legacy round fields are
  // fixed compatibility metadata and no longer gate submission.
  assert.equal(currentState.currentStage, 1);
  assert.equal(currentState.maxStages, 1);
  assert.equal(currentState.currentRound, 1);
  assert.equal(currentState.maxRounds, 1);
  assert.equal(currentState.actionPoints, 28);
  assert.equal(currentState.projectTimer.durationMs, 20 * 60 * 1000);
  assert.equal(currentState.status, 'playing');

  const firstRead = await jsonRequest<{ gameSession: { state: GameRuntimeState } }>(
    `/api/game/sessions/${sessionId}`, {}, login.token,
  );
  assert.equal(firstRead.gameSession.state.version, currentState.version);
  assert.equal(firstRead.gameSession.state.actionPoints, currentState.actionPoints);

  const npcId = 'P1-004';
  const firstSearch = await command(login.token, 'research_public_info', { npcId });
  const firstResearch = firstSearch.result.publicResearch as { facts?: unknown[]; weakSignals?: unknown[]; costPoints?: number };
  assert(firstResearch && Array.isArray(firstResearch.facts));
  assert(Array.isArray(firstResearch.weakSignals));
  assert.equal(firstResearch.costPoints, 2);
  assert.equal(currentState.actionPoints, 26);
  assert.equal(Object.keys(currentState.publicResearch).length, 0, 'search result is not persisted on the contact card');
  assert.equal('timeMinutes' in firstSearch.result, false);
  assert.equal('timeMinutes' in firstSearch.state, false, 'player state does not retain the obsolete search time metric');

  const restoredAfterSearch = await jsonRequest<{ gameSession: { state: GameRuntimeState } }>(
    `/api/game/sessions/${sessionId}`, {}, login.token,
  );
  assert.equal(restoredAfterSearch.gameSession.state.version, currentState.version);
  assert.equal(Object.keys(restoredAfterSearch.gameSession.state.publicResearch).length, 0);

  // Re-searching is an independent paid action and returns a fresh temporary
  // result instead of opening a saved card.
  const secondSearch = await command(login.token, 'research_public_info', { npcId });
  assert(secondSearch.result.publicResearch);
  assert.equal(currentState.actionPoints, 24);
  assert.equal(Object.keys(currentState.publicResearch).length, 0);

  // A contact command is deterministic on the server but can model an
  // unanswered work phone. Retry with a fresh command until the two-way
  // contact needed by the invitation flow is established.
  let contactResult: { result: Record<string, unknown> } | null = null;
  for (let attempt = 0; attempt < 8 && currentState.npcContacts[npcId]?.status === 'known'; attempt += 1) {
    contactResult = await command(login.token, 'contact', {
      npcId,
      channel: 'work_phone',
      content: '您好，我想先了解一线流程和项目落地中的主要问题。',
    });
  }
  if (currentState.npcContacts[npcId]?.status === 'known') {
    // Keep the probability branch covered above, but use the guaranteed
    // formal channel as a bounded fallback so external randomness cannot make
    // the rest of the E2E flaky.
    contactResult = await command(login.token, 'contact', {
      npcId,
      channel: 'email',
      content: '您好，我想先了解一线流程和项目落地中的主要问题。',
    });
  }
  assert(contactResult, 'contact command should be attempted');
  assert.notEqual(currentState.npcContacts[npcId]?.status, 'known', 'eventual phone contact should connect');
  assert(['connected', 'unanswered', 'declined', 'call_later'].includes(String(contactResult.result.outcome)));
  assert.equal(currentState.npcContacts[npcId]?.hasReplied, true);

  const prepared = await command(login.token, 'prepare', {
    npcId,
    preparationType: 'visit_preparation',
    content: '目标人物：赵晓晨；客户问题：一线重复录入和跨部门确认成本；方案维度：流程、交付和实施；证据：同类案例、验收数据和可核验交付记录；下一步：确认技术交流和责任人。',
  });
  const preparation = prepared.result.preparation as GameRuntimeState['preparations'][number];
  assert(preparation?.id);
  assert.equal(preparation.type, 'visit_preparation');
  assert(preparation.brief, 'free-text preparation must produce a deterministic brief');
  assert.equal(preparation.brief?.audience.includes('赵晓晨'), true);
  assert.equal(preparation.brief?.problem.includes('重复录入'), true);
  assert.equal(preparation.brief?.dimensions.includes('流程'), true);
  assert.equal(preparation.brief?.evidence.includes('案例'), true);
  assert.equal(preparation.brief?.nextStep.includes('技术交流'), true);
  assert.deepEqual(new Set(preparation.brief?.semanticTags), new Set([
    'target_person',
    'customer_problem',
    'solution_or_dimension',
    'evidence',
    'next_step',
  ]));
  const preparationId = preparation.id;
  const invitationChannel = currentState.npcContacts[npcId].initialChannel;

  let appointment: GameAppointment | null = null;
  for (let attempt = 0; !appointment && attempt < 8; attempt += 1) {
    const pointsBeforeInvitation: number = currentState.actionPoints;
    const invited = await chatInvitation(
      login.token,
      '希望围绕一线流程、交付案例和实施风险安排一次正式沟通。',
      invitationChannel,
      invitationChannel === 'email' ? [preparationId] : [],
    );
    assert.equal(invited.result.invitation, true);
    assert.equal(currentState.actionPoints, pointsBeforeInvitation - 1, 'natural-language invitation charges exactly once');
    const candidate = invited.result.appointment as GameAppointment;
    assert(candidate?.status, 'invite should return a probability result');
    assert(['accepted', 'countered', 'rejected'].includes(candidate.status));
    assert.equal(candidate.invitationText, '希望围绕一线流程、交付案例和实施风险安排一次正式沟通。');
    assert.equal(candidate.invitationMethod, 'dedicated');
    if (candidate.status === 'countered') {
      const accepted = await command(login.token, 'update_appointment', {
        appointmentId: candidate.id,
        action: 'accept_counter',
      });
      appointment = accepted.result.appointment as GameAppointment;
    } else if (candidate.status === 'accepted') {
      appointment = candidate;
    }
  }
  assert(appointment, 'NPC should eventually accept or counter a formal appointment');
  assert.equal(appointment.npcId, npcId);
  assert.equal(appointment.visitType, 'formal');
  assert.equal(appointment.durationMinutes, 40);
  assert.equal(appointment.maxTurns, 6);

  const started = await command(login.token, 'start_visit', {
    appointmentId: appointment.id,
    preparationIds: [preparationId],
  });
  assert.equal(started.state.activeMeeting?.appointmentId, appointment.id);
  assert.equal(started.state.activeMeeting?.usedPreparationIds.includes(preparationId), true);
  assert.equal(started.state.activeMeeting?.visitType, 'formal');

  const ended = await command(login.token, 'end_visit', {
    appointmentId: appointment.id,
    reason: 'player',
    summary: '确认客户问题、方案维度、证据和下一步责任人。',
  });
  assert.equal(ended.state.activeMeeting, null);
  assert.equal(currentState.appointments.find((item) => item.id === appointment?.id)?.status, 'completed');
  assert.equal(currentState.meetingMinutes.some((item) => item.appointmentId === appointment?.id), true);

  const legacyPhaseResponse = await fetch(`${baseUrl}/api/game/sessions/${sessionId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session': login.token },
    body: JSON.stringify({
      commandId: makeCommandId('removed-phase'),
      expectedVersion: currentState.version,
      type: 'advance_phase',
      payload: {},
    }),
  });
  assert.equal(legacyPhaseResponse.status, 400, 'the formal command API rejects obsolete stage advancement');
  assert.equal((await legacyPhaseResponse.json() as { error?: string }).error, 'GAME_COMMAND_INVALID');

  // Fast-forward only this E2E fixture through the service-role test database,
  // then use the same authenticated timer endpoint the formal game polls.
  const supabase = createAdminClient();
  const { data: runtimeBeforeExpiry, error: runtimeReadError } = await supabase
    .from('game_runtime_states')
    .select('simulation_state')
    .eq('session_id', sessionId)
    .single();
  assert.equal(runtimeReadError, null);
  assert(runtimeBeforeExpiry);
  const persistedState = runtimeBeforeExpiry.simulation_state as GameRuntimeState;
  const elapsedBeforeExpiry = 20 * 60 * 1000 - 1_000;
  const checkpointedState = {
    ...persistedState,
    projectTimer: {
      ...persistedState.projectTimer,
      durationMs: 20 * 60 * 1000,
      elapsedMs: elapsedBeforeExpiry,
      lastResumedAt: new Date(Date.now() - 2_000).toISOString(),
      recoveredIntervals: 3,
      visitPaused: false,
    },
  };
  const { error: timerFixtureError } = await supabase
    .from('game_runtime_states')
    .update({ simulation_state: checkpointedState })
    .eq('session_id', sessionId);
  assert.equal(timerFixtureError, null);
  const actionPointsBeforeExpiry = currentState.actionPoints;
  const timerResult = await jsonRequest<{ state: GameRuntimeState & { projectTimer: GameRuntimeState['projectTimer'] & { remainingMs: number } } }>(
    `/api/game/sessions/${sessionId}/timer`, {}, login.token,
  );
  currentState = timerResult.state;
  assert.notEqual(currentState.status, 'playing', 'timer expiry settles the current game automatically');
  assert.equal(currentState.projectTimer.elapsedMs, 20 * 60 * 1000);
  assert.equal(timerResult.state.projectTimer.remainingMs, 0);
  assert.equal(currentState.actionPoints, Math.min(28, actionPointsBeforeExpiry + 5));

  const restored = await jsonRequest<{ gameSession: { state: GameRuntimeState } }>(
    `/api/game/sessions/${sessionId}`, {}, login.token,
  );
  assert.equal(restored.gameSession.state.version, currentState.version);
  assert.equal(restored.gameSession.state.status, currentState.status);
  assert.equal(restored.gameSession.state.currentStage, 1);
  assert.equal(restored.gameSession.state.actionPoints, currentState.actionPoints);

  const { data: observedEvents, error: observedEventError } = await createAdminClient()
    .from('game_events')
    .select('event_type, payload')
    .eq('session_id', sessionId);
  assert.equal(observedEventError, null);
  const events = (observedEvents ?? []) as Array<{ event_type: string; payload: unknown }>;
  const eventTypes = new Set(events.map((event) => event.event_type));
  for (const requiredType of [
    'session.created',
    'public_info.researched',
    'contact.completed',
    'preparation.completed',
    'visit.started',
    'visit.completed',
    'project_timer.expired',
  ]) {
    assert(eventTypes.has(requiredType), `missing observation event: ${requiredType}`);
  }
  const publicSearchEvents = events.filter((event) => event.event_type === 'public_info.researched');
  assert(publicSearchEvents.length >= 2, 'repeated searches must create separate observation events');
  for (const event of publicSearchEvents) {
    const payload = event.payload as Record<string, unknown>;
    assert.equal('timeMinutes' in payload, false, 'public search event must not use the obsolete time metric');
    assert.equal(payload.costPoints, 2);
  }
  const preparationEvent = events.find((event) => {
    const payload = event.payload as Record<string, unknown>;
    return event.event_type === 'preparation.completed' && payload.type === 'visit_preparation';
  })?.payload as Record<string, unknown> | undefined;
  assert(preparationEvent, 'missing free-text preparation observation');
  assert.equal(preparationEvent.hasPreparationBrief, true);
  assert.equal('content' in preparationEvent, false);

  console.log(`project-one timer e2e passed: session=${sessionId}, result=${currentState.status}`);
  await cleanup();
}

main().catch(async (error) => {
  console.error(`project-one timer e2e failed: session=${sessionId || 'not-created'}`);
  console.error(error instanceof Error ? error.message : error);
  await cleanup();
  process.exitCode = 1;
});
