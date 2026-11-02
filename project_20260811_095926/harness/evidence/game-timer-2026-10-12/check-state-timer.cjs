const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const Module = require('node:module');

const evidenceDir = __dirname;
const repoRoot = path.resolve(evidenceDir, '../../..');
const projectRoot = path.join(repoRoot, 'projects');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
projectRequire('tsx/cjs/api').register();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveProjectAlias(request, parent, ...args) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(projectRoot, 'src', request.slice(2))
    : request;
  return resolveFilename.call(this, resolvedRequest, parent, ...args);
};

const {
  createProjectOneState,
  executeGameCommand,
  getPlayerVisibleProjectTimer,
  normalizeProjectOneState,
  recordMeetingTurn,
  synchronizeProjectTimer,
  PROJECT_TIMER_DURATION_MS,
  PROJECT_TIMER_RECOVERY_INTERVAL_MS,
  PROJECT_TIMER_RECOVERY_ACTION_POINTS,
} = projectRequire(path.join(projectRoot, 'src/lib/game/state.ts'));

const BASE_MS = Date.parse('2026-10-12T00:00:00.000Z');
const MINUTE_MS = 60_000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function stateAt({ actionPoints = 28, elapsedMs = 0, recoveredIntervals = 0 } = {}) {
  const state = createProjectOneState();
  return {
    ...state,
    actionPoints,
    projectTimer: {
      ...state.projectTimer,
      elapsedMs,
      recoveredIntervals,
      lastResumedAt: iso(BASE_MS),
      visitPaused: false,
    },
  };
}

function command(state, type, payload, commandId) {
  return executeGameCommand(state, {
    commandId,
    expectedVersion: state.version,
    type,
    payload,
  }).state;
}

function testInitialTwentyMinuteProjection() {
  assert.equal(PROJECT_TIMER_DURATION_MS, 20 * MINUTE_MS, 'the formal game budget is 20 minutes');
  assert.equal(PROJECT_TIMER_RECOVERY_INTERVAL_MS, 5 * MINUTE_MS, 'recovery is evaluated every five minutes');
  assert.equal(PROJECT_TIMER_RECOVERY_ACTION_POINTS, 5, 'each elapsed interval restores five action points');

  const initial = stateAt();
  const visible = getPlayerVisibleProjectTimer(initial, BASE_MS);
  assert.equal(visible.remainingMs, 20 * MINUTE_MS, 'new game projects a full 20-minute timer');
  assert.equal(visible.elapsedMs, 0);
  assert.equal(visible.isPaused, false);
}

function testRecoveryBoundariesAndCap() {
  let state = stateAt({ actionPoints: 18 });
  state = synchronizeProjectTimer(state, BASE_MS + 5 * MINUTE_MS);
  assert.equal(state.actionPoints, 23, 'five minutes restores five action points');
  assert.equal(state.projectTimer.recoveredIntervals, 1);

  state = synchronizeProjectTimer(state, BASE_MS + 10 * MINUTE_MS);
  assert.equal(state.actionPoints, 28, 'the second interval restores action points up to the cap');
  assert.equal(state.projectTimer.recoveredIntervals, 2);

  state = synchronizeProjectTimer(state, BASE_MS + 15 * MINUTE_MS);
  assert.equal(state.actionPoints, 28, 'later intervals never exceed the 28-point cap');
  assert.equal(state.projectTimer.recoveredIntervals, 3);

  const nearCap = synchronizeProjectTimer(stateAt({ actionPoints: 27 }), BASE_MS + 5 * MINUTE_MS);
  assert.equal(nearCap.actionPoints, 28, 'a partial refill is clipped to the cap');
}

function testVisitPauseAndTwentyTurnCharge() {
  let state = stateAt({ actionPoints: 20 });
  state = command(state, 'start_visit', { npcId: 'P1-001', skipPreparation: true }, 'timer-start-visit');
  assert.ok(state.activeMeeting, 'the test enters an actual visit through the production reducer');
  assert.equal(state.projectTimer.visitPaused, true, 'starting an actual visit pauses the project clock');

  const paused = synchronizeProjectTimer(state, BASE_MS + 12 * MINUTE_MS);
  assert.equal(paused.projectTimer.elapsedMs, 0, 'wall-clock time during the visit does not advance the project clock');
  assert.equal(paused.actionPoints, state.actionPoints, 'paused time does not grant action-point refills');
  assert.equal(paused.activeMeeting?.turnCount, 0, 'timer synchronization preserves the active visit');

  for (let turn = 0; turn < 20; turn += 1) state = recordMeetingTurn(state);
  assert.equal(state.activeMeeting?.turnCount, 20, 'the production visit reducer records twenty dialogue turns');

  state = command(state, 'end_visit', {
    appointmentId: state.activeMeeting.appointmentId,
    reason: 'player',
    summary: '',
  }, 'timer-end-visit');
  assert.equal(state.activeMeeting, null, 'ending the visit clears the active meeting');
  assert.equal(state.projectTimer.visitPaused, false, 'ending the visit resumes the project clock');
  assert.equal(state.projectTimer.elapsedMs, 20 * 15_000, 'twenty visit turns consume five project minutes');
  assert.equal(state.projectTimer.recoveredIntervals, 1, 'the visit charge participates in the five-minute refill schedule');
  assert.equal(state.actionPoints, 22, 'the visit costs three points and its elapsed interval restores five');
}

function testTimeoutIsStableAcrossRefresh() {
  const almostExpired = stateAt({ actionPoints: 9, elapsedMs: PROJECT_TIMER_DURATION_MS - 1_000, recoveredIntervals: 3 });
  const timedOut = synchronizeProjectTimer(almostExpired, BASE_MS + 1_000);
  assert.notEqual(timedOut.status, 'playing', 'reaching zero automatically settles the current project');
  assert.equal(timedOut.projectTimer.elapsedMs, PROJECT_TIMER_DURATION_MS, 'timeout is persisted at exactly the budget boundary');
  assert.equal(timedOut.activeMeeting, null, 'settlement leaves no active visit lock');

  const restored = normalizeProjectOneState(JSON.parse(JSON.stringify(timedOut)));
  assert.equal(restored.projectTimer.elapsedMs, PROJECT_TIMER_DURATION_MS, 'refresh normalization preserves the expired timer');
  const refreshed = synchronizeProjectTimer(restored, BASE_MS + 5 * MINUTE_MS);
  assert.equal(refreshed.status, timedOut.status, 'refresh does not settle an expired game a second time');
  assert.deepEqual(refreshed.notifications, timedOut.notifications, 'refresh does not duplicate timeout outcome notifications');
  assert.equal(getPlayerVisibleProjectTimer(refreshed, BASE_MS + 5 * MINUTE_MS).remainingMs, 0);
}

testInitialTwentyMinuteProjection();
testRecoveryBoundariesAndCap();
testVisitPauseAndTwentyTurnCharge();
testTimeoutIsStableAcrossRefresh();
console.log('Formal timer reducer acceptance passed: 20-minute default, 5-minute recovery/cap, paused visit, 20-turn charge, timeout and refresh idempotency.');
