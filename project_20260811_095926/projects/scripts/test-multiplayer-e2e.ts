import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createAdminClient } from '../src/storage/database/supabase-client';

dotenv.config({ path: '.env.local', override: false, quiet: true });

type JsonObject = Record<string, unknown>;
type HttpResult = { status: number; payload: JsonObject };
type Account = { userId: string; token: string };
type RoomSnapshot = {
  id: string;
  /** Legacy DB metadata is read only; room operations no longer advance it. */
  currentStage: number;
  stageVersion: number;
  status: string;
  raw: JsonObject;
};

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const runTag = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
const usernames = {
  coach: `multi_e2e_coach_${runTag}`,
  playerA: `multi_e2e_player_a_${runTag}`,
  playerB: `multi_e2e_player_b_${runTag}`,
};
const userIds = Object.values(usernames).map((username) => `u_${username}`);

let roomId = '';
let roomCode = '';
const sessionIds = new Set<string>();

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  throw new Error(`missing string field: ${keys.join('/')}`);
}

function numberField(record: JsonObject, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key])) return record[key];
  }
  throw new Error(`missing number field: ${keys.join('/')}`);
}

function payloadError(payload: JsonObject): string {
  return typeof payload.error === 'string' ? payload.error : JSON.stringify(payload);
}

async function request(path: string, init: RequestInit = {}, token?: string): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session': token } : {}),
      ...init.headers,
    },
  });
  const raw = await response.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }
  return { status: response.status, payload: isRecord(parsed) ? parsed : { data: parsed } };
}

function expectStatus(result: HttpResult, expected: number | number[], label: string): JsonObject {
  const statuses = Array.isArray(expected) ? expected : [expected];
  assert(statuses.includes(result.status), `${label}: HTTP ${result.status}: ${payloadError(result.payload)}`);
  return result.payload;
}

function extractObject(payload: JsonObject, ...keys: string[]): JsonObject {
  for (const key of keys) {
    const value = payload[key];
    if (isRecord(value)) return value;
  }
  throw new Error(`missing object field: ${keys.join('/')}`);
}

function parseRoom(payload: JsonObject): RoomSnapshot {
  const data = isRecord(payload.data) ? payload.data : null;
  const candidate = isRecord(payload.room)
    ? payload.room
    : data && isRecord(data.room)
      ? data.room
      : data;
  if (!candidate) throw new Error(`room missing in response: ${JSON.stringify(payload)}`);
  return {
    id: stringField(candidate, 'id', 'roomId'),
    currentStage: numberField(candidate, 'current_stage', 'currentStage'),
    stageVersion: numberField(candidate, 'stage_version', 'stageVersion'),
    status: stringField(candidate, 'status'),
    raw: candidate,
  };
}

function parseSessionId(payload: JsonObject): string {
  const gameSession = extractObject(payload, 'gameSession');
  const id = stringField(gameSession, 'id');
  sessionIds.add(id);
  return id;
}

async function authenticate(username: string, role: 'player' | 'trainer'): Promise<Account> {
  const login = expectStatus(await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username, password: 'e2e-test-password' }),
  }), 200, `${role} login`);
  const loginToken = stringField(login, 'loginToken');
  const selected = expectStatus(await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      action: 'select_role',
      loginToken,
      role,
      ...(role === 'player' ? { subRole: 'paid_individual' } : {}),
    }),
  }), 200, `${role} role selection`);
  return { userId: `u_${username}`, token: stringField(selected, 'token') };
}

async function createRoom(coach: Account): Promise<RoomSnapshot> {
  const payload = expectStatus(await request('/api/coach/rooms', {
    method: 'POST',
    body: JSON.stringify({
      companies: [
        { id: 'e2e-player-company', name: 'E2E 甲公司' },
        { id: 'e2e-abc-company', name: 'E2E 乙公司' },
      ],
    }),
  }, coach.token), 201, 'room creation');
  const data = extractObject(payload, 'data');
  roomCode = stringField(data, 'room_code', 'roomCode');
  const room = parseRoom(payload);
  roomId = room.id;
  return room;
}

async function joinRoom(account: Account, companyId: string): Promise<string> {
  const payload = expectStatus(await request('/api/multiplayer/join', {
    method: 'POST',
    body: JSON.stringify({ roomCode, companyId }),
  }, account.token), 200, `${companyId} join`);
  const data = extractObject(payload, 'data');
  const joinedRoomId = stringField(data, 'roomId');
  assert.equal(joinedRoomId, roomId);
  const sessionId = stringField(data, 'sessionId');
  sessionIds.add(sessionId);
  return sessionId;
}

async function fetchRoom(coach: Account): Promise<RoomSnapshot> {
  const payload = expectStatus(await request(`/api/coach/rooms/${roomId}`, {}, coach.token), 200, 'room recovery');
  const room = parseRoom(payload);
  assert.equal(room.id, roomId);
  return room;
}

async function requestLegacyReady(account: Account, version: number): Promise<HttpResult> {
  return request(`/api/multiplayer/rooms/${roomId}/ready`, {
    method: 'POST',
    body: JSON.stringify({ expectedStage: 1, expectedVersion: version }),
  }, account.token);
}

async function readGameSession(account: Account, sessionId: string): Promise<JsonObject> {
  const payload = expectStatus(await request(`/api/game/sessions/${sessionId}`, {}, account.token), 200, 'game session recovery');
  return extractObject(payload, 'gameSession');
}

function readState(session: JsonObject): JsonObject {
  return extractObject(session, 'state');
}

async function cleanup(): Promise<void> {
  try {
    const admin = createAdminClient();
    let targetRoomId = roomId;
    if (!targetRoomId && roomCode) {
      const roomLookup = await admin.from('multiplayer_rooms').select('id').eq('room_code', roomCode).maybeSingle();
      if (roomLookup.error) console.warn(`room lookup cleanup failed: ${roomLookup.error.message}`);
      targetRoomId = typeof roomLookup.data?.id === 'string' ? roomLookup.data.id : '';
    }

    if (targetRoomId) {
      const slots = await admin.from('multiplayer_company_slots').select('game_session_id').eq('room_id', targetRoomId);
      if (slots.error) console.warn(`slot lookup cleanup failed: ${slots.error.message}`);
      for (const slot of slots.data ?? []) {
        if (typeof slot.game_session_id === 'string') sessionIds.add(slot.game_session_id);
      }
    }

    const ownedSessions = await admin.from('game_sessions').select('id').in('user_id', userIds);
    if (ownedSessions.error) console.warn(`owned session lookup cleanup failed: ${ownedSessions.error.message}`);
    for (const row of ownedSessions.data ?? []) {
      if (typeof row.id === 'string') sessionIds.add(row.id);
    }

    if (sessionIds.size > 0) {
      const deletedSessions = await admin.from('game_sessions').delete().in('id', [...sessionIds]);
      if (deletedSessions.error) console.warn(`session cleanup failed: ${deletedSessions.error.message}`);
    }
    if (targetRoomId) {
      const deletedRoom = await admin.from('multiplayer_rooms').delete().eq('id', targetRoomId);
      if (deletedRoom.error) console.warn(`room cleanup failed: ${deletedRoom.error.message}`);
    }
  } catch (error) {
    console.warn(`multiplayer E2E cleanup unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const coach = await authenticate(usernames.coach, 'trainer');
  const playerA = await authenticate(usernames.playerA, 'player');
  const playerB = await authenticate(usernames.playerB, 'player');

  const removedStageConfig = await request('/api/coach/rooms', {
    method: 'POST',
    body: JSON.stringify({
      stageDurationSeconds: 60,
      companies: [
        { id: 'e2e-player-company', name: 'E2E 甲公司' },
        { id: 'e2e-abc-company', name: 'E2E 乙公司' },
      ],
    }),
  }, coach.token);
  expectStatus(removedStageConfig, 400, 'removed per-stage room configuration');
  assert.equal(removedStageConfig.payload.error, 'GAME_PHASE_DESIGN_REMOVED');

  const waitingRoom = await createRoom(coach);
  assert.equal(waitingRoom.currentStage, 1);
  assert.equal(waitingRoom.stageVersion, 1);
  assert.equal(waitingRoom.status, 'waiting');

  // A joined player cannot act before the coach starts the room. Removing a
  // lobby player invalidates the detached runtime version before clearing the
  // slot, so an in-flight command cannot revive an orphan session.
  const detachedPlayerASessionId = await joinRoom(playerA, 'e2e-player-company');
  const detachedState = readState(await readGameSession(playerA, detachedPlayerASessionId));
  const waitingTimer = extractObject(detachedState, 'projectTimer');
  assert.equal(waitingTimer.isPaused, true, 'a company room timer stays paused until the coach starts it');
  const preStartCommand = await request(`/api/game/sessions/${detachedPlayerASessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: `multi-prestart-${crypto.randomUUID()}`,
      expectedVersion: numberField(detachedState, 'version'),
      type: 'research_public_info',
      payload: { npcId: 'P1-004' },
    }),
  }, playerA.token);
  expectStatus(preStartCommand, 409, 'pre-start multiplayer command rejection');
  assert.equal(preStartCommand.payload.error, 'MULTIPLAYER_ROOM_NOT_RUNNING');

  const lobbyWithPlayerA = await fetchRoom(coach);
  const lobbySlots = lobbyWithPlayerA.raw.multiplayer_company_slots;
  assert(Array.isArray(lobbySlots));
  const detachedSlot = lobbySlots.find((slot) => isRecord(slot) && slot.player_user_id === playerA.userId);
  assert(isRecord(detachedSlot));
  const detachedSlotId = stringField(detachedSlot, 'id');
  const removed = expectStatus(await request(`/api/coach/rooms/${roomId}`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'remove_player', slotId: detachedSlotId, expectedVersion: lobbyWithPlayerA.stageVersion }),
  }, coach.token), 200, 'remove lobby player');
  const removedRoom = parseRoom(removed);
  assert.equal(removedRoom.stageVersion, lobbyWithPlayerA.stageVersion + 1);
  const adminAfterRemove = createAdminClient();
  const detachedRuntime = await adminAfterRemove.from('game_runtime_states').select('version').eq('session_id', detachedPlayerASessionId).single();
  assert.equal(detachedRuntime.error, null);
  assert.equal(detachedRuntime.data?.version, numberField(detachedState, 'version') + 1);
  const detachedSession = await adminAfterRemove.from('game_sessions').select('status').eq('id', detachedPlayerASessionId).single();
  assert.equal(detachedSession.error, null);
  assert.equal(detachedSession.data?.status, 'replaced');

  // Two independent player accounts now occupy the two company slots before
  // the coach starts the room. Rejoining creates a fresh attached runtime.
  const playerASessionId = await joinRoom(playerA, 'e2e-player-company');
  const playerBSessionId = await joinRoom(playerB, 'e2e-abc-company');
  const readyToStartRoom = await fetchRoom(coach);
  expectStatus(await request(`/api/coach/rooms/${roomId}/start`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion: readyToStartRoom.stageVersion }),
  }, coach.token), 200, 'room start');
  const startedRoom = await fetchRoom(coach);
  assert.equal(startedRoom.currentStage, 1);
  assert.equal(startedRoom.stageVersion, readyToStartRoom.stageVersion + 1);
  assert.equal(startedRoom.status, 'running');
  const initialVersion = startedRoom.stageVersion;
  const startedPlayerState = readState(await readGameSession(playerA, playerASessionId));
  const startedTimer = extractObject(startedPlayerState, 'projectTimer');
  assert.equal(startedTimer.isPaused, false, 'starting the room resumes each company timer');
  assert.equal(startedTimer.durationMs, 1_200_000, 'each company receives a twenty-minute timer');
  assert.equal(typeof startedTimer.lastResumedAt, 'string', 'room start persists the timer anchor');

  // Legacy phase commands and both ready routes are disabled. Each must leave
  // the running room and its player runtimes untouched.
  const initialSession = startedPlayerState;
  const genericAdvance = await request(`/api/game/sessions/${playerASessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: `multi-generic-advance-${crypto.randomUUID()}`,
      expectedVersion: numberField(initialSession, 'version'),
      type: 'advance_phase',
      payload: {},
    }),
  }, playerA.token);
  expectStatus(genericAdvance, [400, 409], 'generic multiplayer advance rejection');
  const unauthenticatedReady = await request(`/api/multiplayer/rooms/${roomId}/ready`, {
    method: 'POST',
    body: JSON.stringify({ expectedStage: 1, expectedVersion: initialVersion }),
  });
  expectStatus(unauthenticatedReady, 401, 'ready endpoint authentication');
  const playerReady = await requestLegacyReady(playerA, initialVersion);
  expectStatus(playerReady, 410, 'removed player phase-ready endpoint');
  assert.equal(playerReady.payload.error, 'GAME_PHASE_DESIGN_REMOVED');
  const startedSlots = startedRoom.raw.multiplayer_company_slots;
  assert(Array.isArray(startedSlots));
  const playerASlot = startedSlots.find((slot) => isRecord(slot) && slot.player_user_id === playerA.userId);
  assert(isRecord(playerASlot), 'player A slot must be recoverable');
  const unauthorizedCoachForceReady = await request(`/api/coach/rooms/${roomId}`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'force_ready', slotId: playerASlot.id, expectedVersion: initialVersion }),
  }, playerA.token);
  expectStatus(unauthorizedCoachForceReady, 403, 'coach force-ready authorization');
  const coachForceReady = await request(`/api/coach/rooms/${roomId}`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'force_ready', slotId: playerASlot.id, expectedVersion: initialVersion }),
  }, coach.token);
  expectStatus(coachForceReady, 410, 'removed coach force-ready endpoint');
  assert.equal(coachForceReady.payload.error, 'GAME_PHASE_DESIGN_REMOVED');
  const afterLegacyEndpoints = await fetchRoom(coach);
  assert.equal(afterLegacyEndpoints.currentStage, startedRoom.currentStage, 'legacy ready APIs cannot advance stage metadata');
  assert.equal(afterLegacyEndpoints.stageVersion, initialVersion, 'legacy ready APIs cannot mutate room version');
  const unchangedPlayerState = readState(await readGameSession(playerA, playerASessionId));
  assert.equal(numberField(unchangedPlayerState, 'version'), numberField(initialSession, 'version'), 'removed phase commands cannot mutate player runtime');
  assert.equal(numberField(unchangedPlayerState, 'actionPoints'), numberField(initialSession, 'actionPoints'), 'removed phase commands cannot grant action points');

  // Replacing a player's solo save must not touch the already-running room
  // runtime for that same user. Use two solo saves so this covers the actual
  // replace branch, not only the first solo creation.
  const soloFirst = expectStatus(await request('/api/game/sessions', {
    method: 'POST',
    body: JSON.stringify({ scenarioCode: 'project-1' }),
  }, playerA.token), 200, 'solo save creation beside room');
  const soloFirstId = parseSessionId(soloFirst);
  const soloReplacement = expectStatus(await request('/api/game/sessions', {
    method: 'POST',
    body: JSON.stringify({ scenarioCode: 'project-1', replaceExisting: true }),
  }, playerA.token), 200, 'solo save replacement beside room');
  const soloReplacementId = parseSessionId(soloReplacement);
  assert.notEqual(soloReplacementId, soloFirstId);

  const admin = createAdminClient();
  const rows = await admin.from('game_sessions').select('id,status,multiplayer').in('id', [playerASessionId, soloFirstId, soloReplacementId]);
  assert.equal(rows.error, null);
  const sessionRows = (rows.data ?? []) as unknown as Array<{ id: string; status: string; multiplayer: boolean }>;
  const rowById = new Map<string, { id: string; status: string; multiplayer: boolean }>(
    sessionRows.map((row): [string, { id: string; status: string; multiplayer: boolean }] => [String(row.id), row]),
  );
  assert.equal(rowById.get(playerASessionId)?.status, 'playing');
  assert.equal(rowById.get(playerASessionId)?.multiplayer, true);
  assert.equal(rowById.get(soloFirstId)?.status, 'replaced');
  assert.equal(rowById.get(soloReplacementId)?.status, 'playing');

  const roomAfterSoloReplace = await fetchRoom(coach);
  assert.equal(roomAfterSoloReplace.currentStage, startedRoom.currentStage);
  assert.equal(roomAfterSoloReplace.stageVersion, initialVersion);
  const slotsAfterSoloReplace = roomAfterSoloReplace.raw.multiplayer_company_slots;
  assert(Array.isArray(slotsAfterSoloReplace), 'room recovery after solo replace must include slots');
  const playerASlotAfterSoloReplace = slotsAfterSoloReplace.find((slot) => isRecord(slot) && slot.player_user_id === playerA.userId);
  assert(isRecord(playerASlotAfterSoloReplace), 'player A slot must survive solo replacement');
  assert.equal(playerASlotAfterSoloReplace.game_session_id, playerASessionId);
  const multiplayerAfterReplace = readState(await readGameSession(playerA, playerASessionId));
  assert.equal(numberField(multiplayerAfterReplace, 'version'), numberField(initialSession, 'version'));

  // Reproduce a company that completed before the coach ends the room. The
  // end RPC must preserve both its persisted status and runtime version.
  const completedRuntimeRead = await admin.from('game_runtime_states')
    .select('version,simulation_state')
    .eq('session_id', playerBSessionId)
    .single();
  assert.equal(completedRuntimeRead.error, null);
  assert(completedRuntimeRead.data);
  const completedRuntime = completedRuntimeRead.data as unknown as { version: number; simulation_state: JsonObject };
  const completedState = {
    ...(isRecord(completedRuntime.simulation_state) ? completedRuntime.simulation_state : {}),
    status: 'won',
  };
  const completedRuntimeWrite = await admin.from('game_runtime_states')
    .update({ simulation_state: completedState })
    .eq('session_id', playerBSessionId);
  assert.equal(completedRuntimeWrite.error, null);
  const completedSessionWrite = await admin.from('game_sessions')
    .update({ status: 'won', won: true, finished_at: new Date().toISOString() })
    .eq('id', playerBSessionId)
    .eq('status', 'playing');
  assert.equal(completedSessionWrite.error, null);

  // Seed a paused, active visit on the still-playing company. Forced room end
  // charges its four committed rounds, freezes the timer, and releases both
  // persisted interaction locks in one transaction.
  const playingRuntimeRead = await admin.from('game_runtime_states')
    .select('version,action_points,simulation_state')
    .eq('session_id', playerASessionId)
    .single();
  assert.equal(playingRuntimeRead.error, null);
  assert(playingRuntimeRead.data);
  const playingRuntime = playingRuntimeRead.data as unknown as { version: number; action_points: number; simulation_state: JsonObject };
  const playingState = isRecord(playingRuntime.simulation_state) ? playingRuntime.simulation_state : {};
  const priorTimer = isRecord(playingState.projectTimer) ? playingState.projectTimer : {};
  const meetingFixture = { turnCount: 4, maxTurns: 20 };
  const forcedEndTimerFixture = {
    ...priorTimer,
    durationMs: 1_200_000,
    elapsedMs: 260_000,
    recoveredIntervals: 0,
    visitPaused: true,
    lastResumedAt: null,
  };
  const forcedEndStateFixture = {
    ...playingState,
    actionPoints: 27,
    activeMeeting: meetingFixture,
    activePhoneCall: { npcId: 'P1-001', startedRound: 1, startedAt: new Date().toISOString() },
    projectTimer: forcedEndTimerFixture,
  };
  const forcedEndRuntimeWrite = await admin.from('game_runtime_states')
    .update({ action_points: 27, simulation_state: forcedEndStateFixture, active_meeting: meetingFixture })
    .eq('session_id', playerASessionId);
  assert.equal(forcedEndRuntimeWrite.error, null);

  const ended = expectStatus(await request(`/api/coach/rooms/${roomId}/end`, {
    method: 'POST',
    body: JSON.stringify({
      expectedVersion: roomAfterSoloReplace.stageVersion,
    }),
  }, coach.token), 200, 'room end');
  const finalRoom = parseRoom(ended);
  assert.equal(finalRoom.status, 'finished', 'coach can still end the room');

  const endedSessionRows = await admin.from('game_sessions')
    .select('id,status,won')
    .in('id', [playerASessionId, playerBSessionId]);
  assert.equal(endedSessionRows.error, null);
  const endedSessions = (endedSessionRows.data ?? []) as unknown as Array<{ id: string; status: string; won: boolean | null }>;
  const endedSessionById = new Map(endedSessions.map((row) => [row.id, row]));
  assert.equal(endedSessionById.get(playerASessionId)?.status, 'lost', 'coach end settles only the playing company');
  assert.equal(endedSessionById.get(playerASessionId)?.won, false);
  assert.equal(endedSessionById.get(playerBSessionId)?.status, 'won', 'completed company status survives room end');
  assert.equal(endedSessionById.get(playerBSessionId)?.won, true);

  const endedRuntimeRows = await admin.from('game_runtime_states')
    .select('session_id,version,action_points,simulation_state,active_meeting,phase_started_at,phase_ends_at,paused_at,paused_remaining_ms')
    .in('session_id', [playerASessionId, playerBSessionId]);
  assert.equal(endedRuntimeRows.error, null);
  const endedRuntimes = (endedRuntimeRows.data ?? []) as unknown as Array<{
    session_id: string;
    version: number;
    action_points: number;
    simulation_state: JsonObject;
    active_meeting: JsonObject | null;
    phase_started_at: string | null;
    phase_ends_at: string | null;
    paused_at: string | null;
    paused_remaining_ms: number | null;
  }>;
  const endedRuntimeBySession = new Map(endedRuntimes.map((row) => [row.session_id, row]));
  const endedPlayingRuntime = endedRuntimeBySession.get(playerASessionId);
  assert(endedPlayingRuntime);
  assert.equal(endedPlayingRuntime.version, playingRuntime.version + 1);
  assert.equal(endedPlayingRuntime.simulation_state.status, 'lost');
  assert.equal(endedPlayingRuntime.simulation_state.activeMeeting, null);
  assert.equal(endedPlayingRuntime.simulation_state.activePhoneCall, null);
  assert.equal(endedPlayingRuntime.active_meeting, null);
  assert.equal(endedPlayingRuntime.phase_started_at, null);
  assert.equal(endedPlayingRuntime.phase_ends_at, null);
  assert.equal(endedPlayingRuntime.paused_at, null);
  assert.equal(endedPlayingRuntime.paused_remaining_ms, null);
  assert.equal(endedPlayingRuntime.action_points, 28, 'crossed recovery interval grants five AP up to the cap');
  assert.equal(endedPlayingRuntime.simulation_state.actionPoints, 28, 'JSON and relational action points stay aligned');
  const frozenTimer = extractObject(endedPlayingRuntime.simulation_state, 'projectTimer');
  assert.equal(frozenTimer.elapsedMs, 320_000, 'forced end charges committed visit turns');
  assert.equal(frozenTimer.recoveredIntervals, 1, 'forced end records the crossed five-minute interval');
  assert.equal(frozenTimer.visitPaused, false, 'forced end clears the visit pause lock');
  assert.equal(frozenTimer.lastResumedAt, null, 'forced end freezes the project timer');

  const preservedCompletedRuntime = endedRuntimeBySession.get(playerBSessionId);
  assert(preservedCompletedRuntime);
  assert.equal(preservedCompletedRuntime.version, completedRuntime.version, 'completed company runtime version is untouched');
  assert.equal(preservedCompletedRuntime.simulation_state.status, 'won', 'completed company runtime status is untouched');

  const visibleEndedState = readState(await readGameSession(playerA, playerASessionId));
  assert.equal(visibleEndedState.status, 'lost');
  assert.equal(visibleEndedState.activeMeeting, null);
  assert.equal(visibleEndedState.activePhoneCall, null);

  console.log(`multiplayer dual-account e2e passed: room=${roomId}, sessions=${playerASessionId},${playerBSessionId}`);
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`multiplayer dual-account e2e failed: room=${roomId || 'not-created'}`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

void run();
