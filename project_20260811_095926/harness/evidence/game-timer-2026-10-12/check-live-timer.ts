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
const username = `game_timer_live_${randomUUID().replaceAll('-', '')}`;
const databaseUserId = `u_${username}`;
const password = `test-${randomUUID()}`;
const durationMs = 20 * 60 * 1000;
const admin = createAdminClient();
let sessionId = '';
let token = '';

async function request(pathname: string, init: RequestInit = {}, sessionToken?: string) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'x-session': sessionToken } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, payload };
}

function safeCode(payload: Record<string, any> | undefined) {
  const raw = payload?.details?.code ?? payload?.error;
  return typeof raw === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(raw) ? raw : raw ? 'unclassified_error' : 'none';
}

function safeKeys(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>).slice(0, 40) : [];
}

function timerOf(state: Record<string, any> | null | undefined, label = 'formal state') {
  assert.ok(state && typeof state === 'object', `${label} is missing; available keys=${safeKeys(state).join(',')}`);
  const timer = state.projectTimer as Record<string, any> | undefined;
  assert.ok(timer, `${label} must expose the player-safe projectTimer DTO; state keys=${safeKeys(state).join(',')}`);
  return timer;
}

async function executeCommand(
  type: string,
  payload: Record<string, unknown>,
  expectedVersion: number,
) {
  const command = await request(`/api/game/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: `timer-${type}-${randomUUID()}`,
      expectedVersion,
      type,
      payload,
    }),
  }, token);
  assert.equal(command.response.status, 200, `formal ${type} command should succeed (HTTP ${command.response.status})`);
  assert.ok(command.payload.state, `formal ${type} command should return state`);
  return command.payload.state as Record<string, any>;
}

async function cleanup() {
  const { error } = await admin.from('game_sessions').delete().eq('user_id', databaseUserId);
  if (error) throw new Error('ephemeral timer session cleanup failed');
  const { data, error: verifyError } = await admin.from('game_sessions').select('id').eq('user_id', databaseUserId).limit(1);
  if (verifyError || (data?.length ?? 0) > 0) throw new Error('ephemeral timer session remains after cleanup');
}

async function main() {
  // Establish read-only DB access before creating an isolated account/session.
  const { error: connectivityError } = await admin.from('game_sessions').select('id').limit(1);
  assert.equal(connectivityError, null, 'Supabase admin read must succeed before live timer setup');

  try {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username, password }),
    });
    assert.equal(login.response.status, 200, 'ephemeral login must succeed');
    const loginToken = String(login.payload.loginToken ?? '');
    assert.ok(loginToken, 'ephemeral login proof should be returned');

    const selection = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ action: 'select_role', loginToken, role: 'player', subRole: 'paid_individual' }),
    });
    assert.equal(selection.response.status, 200, 'individual player role selection must succeed');
    token = String(selection.payload.token ?? '');
    assert.ok(token && selection.payload.session?.role === 'player', 'signed player session should be returned');

    const created = await request('/api/game/sessions', {
      method: 'POST',
      body: JSON.stringify({ scenarioCode: 'project-1', replaceExisting: false }),
    }, token);
    assert.equal(created.response.status, 200, 'isolated formal timer session must be created');
    sessionId = String(created.payload.gameSession?.id ?? '');
    assert.ok(sessionId, 'formal API should return the created session id');

    const initialState = created.payload.gameSession?.state as Record<string, any>;
    const initialTimer = timerOf(initialState);
    assert.equal(initialTimer.durationMs, durationMs, 'new formal game starts with a 20-minute duration');
    assert.ok(Number(initialTimer.elapsedMs) >= 0 && Number(initialTimer.elapsedMs) <= 2_000, 'new formal game starts within two seconds of zero elapsed time');
    assert.ok(Number(initialTimer.remainingMs) <= durationMs && Number(initialTimer.remainingMs) >= durationMs - 2_000, 'new formal game exposes approximately the full 20 minutes');
    assert.equal(initialTimer.isPaused, false, 'new formal game clock starts running');
    const initialVersion = Number(initialState.version);

    const { data: beforeReads, error: beforeReadError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points, simulation_state')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(beforeReadError, null, 'timer runtime row should be readable');
    assert.ok(beforeReads, 'timer runtime row should exist');

    const firstRead = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(firstRead.response.status, 200, `first save GET should succeed (code=${safeCode(firstRead.payload)}, response keys=${safeKeys(firstRead.payload).join(',')})`);
    const firstReadState = firstRead.payload.gameSession?.state as Record<string, any> | undefined;
    assert.ok(firstReadState, `first save GET omitted gameSession.state (response keys=${safeKeys(firstRead.payload).join(',')}, gameSession keys=${safeKeys(firstRead.payload.gameSession).join(',')}, code=${safeCode(firstRead.payload)})`);
    const firstReadTimer = timerOf(firstReadState, 'save GET gameSession.state');
    assert.equal(firstReadTimer.durationMs, durationMs, 'save GET preserves the 20-minute timer DTO required by the formal frontend');
    const secondRead = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(secondRead.response.status, 200, 'second save GET should succeed');
    assert.equal(Number(secondRead.payload.gameSession.state.version), initialVersion, 'repeated GET does not increase the game version');

    const { data: afterReads, error: afterReadError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points, simulation_state')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(afterReadError, null);
    assert.equal(afterReads?.version, beforeReads.version, 'database runtime version is stable across GET reads');
    assert.equal(afterReads?.action_points, beforeReads.action_points, 'GET reads do not change action points');

    // Seed only the isolated runtime row just before the first five-minute
    // boundary. The API performs the actual refill and persists its result.
    const boundaryBase = (afterReads.simulation_state ?? {}) as Record<string, any>;
    const boundaryVersion = Number(afterReads.version);
    const { data: boundaryRows, error: boundaryError } = await admin
      .from('game_runtime_states')
      .update({
        action_points: 27,
        simulation_state: {
          ...boundaryBase,
          actionPoints: 27,
          projectTimer: {
            ...(boundaryBase.projectTimer ?? {}),
            durationMs,
            elapsedMs: 5 * 60 * 1000 - 1,
            lastResumedAt: new Date(Date.now() - 2_000).toISOString(),
            recoveredIntervals: 0,
            visitPaused: false,
          },
        },
      })
      .eq('session_id', sessionId)
      .eq('version', boundaryVersion)
      .select('session_id, version')
      .limit(1);
    assert.equal(boundaryError, null, 'admin test-only five-minute boundary adjustment must succeed');
    assert.equal(boundaryRows?.length, 1, 'boundary adjustment must match only the ephemeral runtime row/version');

    const firstBoundarySync = await request(`/api/game/sessions/${sessionId}/timer`, { method: 'POST' }, token);
    assert.equal(firstBoundarySync.response.status, 200, 'five-minute boundary timer sync should succeed');
    const boundaryState = firstBoundarySync.payload.state as Record<string, any>;
    assert.equal(boundaryState.actionPoints, 28, 'one five-minute interval restores five points but respects the 28-point cap');
    assert.equal(timerOf(boundaryState).recoveredIntervals, 1, 'the first five-minute interval is recorded once');
    assert.equal(boundaryState.status, 'playing', 'the refill boundary does not expire the project');
    const boundaryCommittedVersion = Number(boundaryState.version);

    const { data: afterBoundary, error: afterBoundaryError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points, simulation_state')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(afterBoundaryError, null);
    assert.equal(afterBoundary?.action_points, 28, 'the capped refill is persisted');
    assert.equal(Number(afterBoundary?.version), boundaryCommittedVersion, 'the first refill has a committed runtime version');

    const repeatedBoundarySync = await request(`/api/game/sessions/${sessionId}/timer`, { method: 'POST' }, token);
    assert.equal(repeatedBoundarySync.response.status, 200, 'repeated timer sync at the same boundary should succeed');
    assert.equal(repeatedBoundarySync.payload.state.actionPoints, 28, 'repeated sync does not grant duplicate action points');
    assert.equal(Number(repeatedBoundarySync.payload.state.version), boundaryCommittedVersion, 'repeated sync does not create another version');
    const { data: afterRepeatedBoundary, error: repeatedReadError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(repeatedReadError, null);
    assert.equal(afterRepeatedBoundary?.action_points, 28);
    assert.equal(Number(afterRepeatedBoundary?.version), boundaryCommittedVersion, 'the database version remains stable after repeated sync');

    // Exercise a real visit command without AI. The server itself pauses time;
    // repeated reads after refresh must retain that pause until end_visit.
    const visitStarted = await executeCommand('start_visit', {
      npcId: 'P1-001',
      preparationIds: [],
      skipPreparation: true,
    }, boundaryCommittedVersion);
    assert.ok(visitStarted.activeMeeting?.npcId === 'P1-001', 'the actual start_visit command creates the active meeting');
    assert.equal(visitStarted.actionPoints, 25, 'direct visit costs three action points');
    assert.equal(timerOf(visitStarted).isPaused, true, 'starting a real visit pauses the project timer');

    const pausedRead = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(pausedRead.response.status, 200, 'save GET during a visit should succeed');
    const pausedState = pausedRead.payload.gameSession?.state as Record<string, any> | undefined;
    assert.ok(pausedState, `save GET during a visit omitted gameSession.state (response keys=${safeKeys(pausedRead.payload).join(',')}, code=${safeCode(pausedRead.payload)})`);
    assert.equal(pausedState.activeMeeting?.npcId, 'P1-001', 'timer synchronization preserves the active meeting');
    assert.equal(timerOf(pausedState).isPaused, true, 'timer sync preserves the visit pause');
    const pausedRemainingMs = Number(timerOf(pausedState).remainingMs);

    const refreshedVisit = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(refreshedVisit.response.status, 200, 'save refresh during a visit should succeed');
    const refreshedVisitState = refreshedVisit.payload.gameSession.state as Record<string, any>;
    assert.equal(refreshedVisitState.activeMeeting?.npcId, 'P1-001', 'refresh restores the active visit');
    assert.equal(timerOf(refreshedVisitState).isPaused, true, 'refresh restores the paused timer state');
    assert.equal(Number(timerOf(refreshedVisitState).remainingMs), pausedRemainingMs, 'paused remaining time remains stable across refresh');

    const visitEnded = await executeCommand('end_visit', {
      appointmentId: refreshedVisitState.activeMeeting.appointmentId,
      reason: 'player',
      summary: '计时暂停与恢复验收',
    }, Number(refreshedVisitState.version));
    assert.equal(visitEnded.activeMeeting, null, 'end_visit clears the active meeting');
    assert.equal(timerOf(visitEnded).isPaused, false, 'ending a real visit resumes the project timer');

    const beforeTimeout = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(beforeTimeout.response.status, 200, 'save remains readable before deadline settlement');
    const { data: beforeTimeoutRuntime, error: beforeTimeoutReadError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points, simulation_state')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(beforeTimeoutReadError, null);
    assert.ok(beforeTimeoutRuntime, 'timeout test runtime row should exist');

    // Move this test-only runtime row to the deadline. The API still owns the
    // concurrent timer synchronization, outcome, and persisted settlement.
    const timeoutStored = (beforeTimeoutRuntime.simulation_state ?? {}) as Record<string, any>;
    const timeoutVersion = Number(beforeTimeoutRuntime.version);
    const { data: movedRows, error: moveError } = await admin
      .from('game_runtime_states')
      .update({
        action_points: 0,
        simulation_state: {
          ...timeoutStored,
          actionPoints: 0,
          projectTimer: {
            ...(timeoutStored.projectTimer ?? {}),
            durationMs,
            elapsedMs: 0,
            lastResumedAt: new Date(Date.now() - durationMs - 1_000).toISOString(),
            recoveredIntervals: 0,
            visitPaused: false,
          },
        },
      })
      .eq('session_id', sessionId)
      .eq('version', timeoutVersion)
      .select('session_id, version')
      .limit(1);
    assert.equal(moveError, null, 'admin test-only deadline adjustment must succeed');
    assert.equal(movedRows?.length, 1, 'deadline adjustment must match only the ephemeral runtime row/version');

    const concurrent = await Promise.all([
      request(`/api/game/sessions/${sessionId}/timer`, { method: 'POST' }, token),
      request(`/api/game/sessions/${sessionId}/timer`, { method: 'POST' }, token),
    ]);
    assert.ok(concurrent.some((item) => item.response.status === 200), 'at least one concurrent timer sync must settle successfully');
    for (const item of concurrent) {
      assert.ok([200, 409].includes(item.response.status), `timer sync may succeed or report a version conflict, got HTTP ${item.response.status}`);
      if (item.response.status === 409) {
        assert.equal(item.payload.error, 'STATE_VERSION_CONFLICT', 'a concurrent loser must report the version conflict');
      }
    }

    const finalSession = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(finalSession.response.status, 200, 'timed-out save remains readable after refresh');
    const finalState = finalSession.payload.gameSession?.state as Record<string, any>;
    assert.notEqual(finalState.status, 'playing', 'deadline automatically settles the project');
    const finalTimer = timerOf(finalState);
    assert.equal(finalTimer.elapsedMs, durationMs, 'settled timer remains at its exact deadline');
    assert.equal(finalTimer.remainingMs, 0, 'settled timer has no remaining time');
    assert.equal(finalTimer.isPaused, true, 'terminal timer projection is frozen after timeout');
    assert.equal(finalState.activeMeeting, null, 'timeout was not caused by an active visit pause');
    assert.equal(finalState.actionPoints, 20, 'four elapsed five-minute intervals grant only twenty points in total');

    const { data: finalRuntime, error: finalRuntimeError } = await admin
      .from('game_runtime_states')
      .select('session_id, version, action_points, simulation_state')
      .eq('session_id', sessionId)
      .maybeSingle();
    assert.equal(finalRuntimeError, null);
    assert.equal(finalRuntime?.action_points, 20, 'concurrent timer sync does not duplicate action-point refills');
    const finalSnapshot = (finalRuntime?.simulation_state ?? {}) as Record<string, any>;
    assert.equal(finalSnapshot.status, finalState.status, 'timed-out status is persisted in the runtime snapshot');
    assert.equal(finalSnapshot.projectTimer?.elapsedMs, durationMs, 'timed-out timer is persisted in the runtime snapshot');
    assert.equal(finalSnapshot.projectTimer?.visitPaused, false, 'timeout does not mark the timer as paused for a visit');
    assert.equal(finalSnapshot.projectTimer?.lastResumedAt, null, 'terminal timer clears its running anchor');
    assert.equal(finalSnapshot.activeMeeting, null, 'terminal runtime has no active visit');
    assert.equal(finalRuntime?.version, Number(finalState.version), 'timeout outcome and timer state share the committed runtime version');
    assert.equal(finalRuntime?.version, timeoutVersion + 1, 'concurrent deadline requests create one timer/outcome commit, not two');

    const refreshedAgain = await request(`/api/game/sessions/${sessionId}`, {}, token);
    assert.equal(refreshedAgain.response.status, 200);
    assert.equal(refreshedAgain.payload.gameSession.state.version, finalState.version, 'another refresh does not create a second timeout commit');
    assert.equal(refreshedAgain.payload.gameSession.state.status, finalState.status, 'another refresh preserves the same timeout outcome');
    console.log('Live timer acceptance passed: 20-minute persistence, GET stability, capped 5-minute refill, visit pause/resume, concurrent timeout settlement, and refresh. AI/model calls were not used.');
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
