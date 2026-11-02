import assert from 'node:assert/strict';
import { gameCommandSchema } from '../src/lib/contracts/game';
import {
  createProjectOneState,
  executeGameCommand,
  getPlayerVisibleProjectTimer,
  normalizeProjectOneState,
  recordMeetingTurn,
  submitGame,
  synchronizeProjectTimer,
  type GameAppointment,
  type GameRuntimeState,
} from '../src/lib/game/state';

const MINUTE = 60_000;
const startMs = Date.parse('2026-10-12T00:00:00.000Z');
const startIso = new Date(startMs).toISOString();

function withClock(actionPoints = 20): GameRuntimeState {
  const state = createProjectOneState();
  return {
    ...state,
    actionPoints,
    projectTimer: {
      durationMs: 20 * MINUTE,
      elapsedMs: 0,
      lastResumedAt: startIso,
      recoveredIntervals: 0,
      visitPaused: false,
    },
  };
}

function startVisit(state: GameRuntimeState, id: string): GameRuntimeState {
  const appointment: GameAppointment = {
    id,
    npcId: 'P1-004',
    invitationMethod: 'dedicated',
    visitType: 'formal',
    venue: '客户办公室',
    purpose: '核对项目需求与验收安排',
    scheduledRound: 1,
    startMinute: 11 * 60,
    durationMinutes: 40,
    maxTurns: 20,
    status: 'accepted',
    conditions: [],
    reservedMinutes: 0,
    workTopicOpenedBy: null,
    invitationCommandId: `${id}:invite`,
  };
  const stateWithAppointment = { ...state, appointments: [...state.appointments, appointment] };
  const command = gameCommandSchema.parse({
    commandId: `${id}:start`,
    expectedVersion: stateWithAppointment.version,
    type: 'start_visit',
    payload: { appointmentId: id, preparationIds: [], skipPreparation: true },
  });
  return executeGameCommand(stateWithAppointment, command).state;
}

// Refill happens at every five-minute boundary and each checkpoint is
// idempotent, including when the same browser poll is repeated.
let timer = withClock(20);
timer = synchronizeProjectTimer(timer, startMs + 5 * MINUTE);
assert.equal(timer.projectTimer.elapsedMs, 5 * MINUTE);
assert.equal(timer.projectTimer.recoveredIntervals, 1);
assert.equal(timer.actionPoints, 25);
assert.deepEqual(synchronizeProjectTimer(timer, startMs + 5 * MINUTE), timer);

timer = synchronizeProjectTimer(timer, startMs + 10 * MINUTE);
assert.equal(timer.projectTimer.elapsedMs, 10 * MINUTE);
assert.equal(timer.projectTimer.recoveredIntervals, 2);
assert.equal(timer.actionPoints, 28, 'recovery cannot exceed the 28-point cap');
timer = synchronizeProjectTimer(timer, startMs + 15 * MINUTE);
assert.equal(timer.projectTimer.recoveredIntervals, 3);
assert.equal(timer.actionPoints, 28);

timer = synchronizeProjectTimer(timer, startMs + 20 * MINUTE);
assert.equal(timer.projectTimer.elapsedMs, 20 * MINUTE);
assert.equal(timer.projectTimer.recoveredIntervals, 4);
assert.notEqual(timer.status, 'playing', 'expiry settles the game from its current authoritative state');
assert.equal(getPlayerVisibleProjectTimer(timer, startMs + 25 * MINUTE).remainingMs, 0);
assert.equal(synchronizeProjectTimer(timer, startMs + 26 * MINUTE), timer, 'terminal state remains frozen after settlement');

// An active visit pauses wall time across reloads. Its final dialogue turn is
// charged at 15 seconds and can trigger expiry and settlement atomically.
const pausedVisit = startVisit(withClock(), 'timer-paused-visit');
assert.equal(pausedVisit.projectTimer.visitPaused, true);
assert.equal(pausedVisit.projectTimer.lastResumedAt, null);
assert.equal(synchronizeProjectTimer(pausedVisit, startMs + 20 * MINUTE), pausedVisit);
assert.equal(pausedVisit.status, 'playing');

const nearExpiry = {
  ...withClock(),
  projectTimer: {
    durationMs: 20 * MINUTE,
    elapsedMs: 19 * MINUTE + 45_000,
    lastResumedAt: startIso,
    recoveredIntervals: 3,
    visitPaused: false,
  },
};
const visitAtDeadline = startVisit(nearExpiry, 'timer-visit-expires');
const completedAtDeadline = recordMeetingTurn(visitAtDeadline, { playerFarewell: true });
assert.equal(completedAtDeadline.activeMeeting, null);
assert.equal(completedAtDeadline.projectTimer.elapsedMs, 20 * MINUTE);
assert.notEqual(completedAtDeadline.status, 'playing', 'a visit turn that reaches zero settles immediately');

// A full 20-round visit consumes exactly 300 seconds, irrespective of how
// long the visit is open in wall-clock time.
let twentyRoundVisit = startVisit(withClock(28), 'timer-twenty-round-visit');
for (let turn = 1; turn <= 20; turn += 1) {
  twentyRoundVisit = recordMeetingTurn(twentyRoundVisit, turn === 20 ? { playerFarewell: true } : {});
}
assert.equal(twentyRoundVisit.activeMeeting, null);
assert.equal(twentyRoundVisit.meetingMinutes.at(-1)?.endReason, 'player');
assert.equal(twentyRoundVisit.projectTimer.elapsedMs, 5 * MINUTE);
assert.equal(twentyRoundVisit.projectTimer.recoveredIntervals, 1);
assert.equal(twentyRoundVisit.actionPoints, 28, 'visit-crossed refill still respects the action-point cap');

// Older saves that contain an active meeting but no timer migrate to a paused
// 20-minute timer so reload cannot consume time during the visit.
const oldMeetingState = startVisit(withClock(), 'timer-legacy-active-meeting');
const { projectTimer: _discardedTimer, ...legacyMeetingSave } = oldMeetingState;
const migratedMeeting = normalizeProjectOneState(legacyMeetingSave);
assert.equal(migratedMeeting.activeMeeting?.id, oldMeetingState.activeMeeting?.id);
assert.equal(migratedMeeting.projectTimer.elapsedMs, 0);
assert.equal(migratedMeeting.projectTimer.visitPaused, true);
assert.equal(migratedMeeting.projectTimer.lastResumedAt, null);

// Manual submission stops the clock and freezes its displayed remaining time.
const fiveMinutesIn = synchronizeProjectTimer(withClock(), startMs + 5 * MINUTE);
const manuallySubmitted = submitGame(fiveMinutesIn);
const frozenBefore = getPlayerVisibleProjectTimer(manuallySubmitted, startMs + 5 * MINUTE);
const frozenLater = getPlayerVisibleProjectTimer(manuallySubmitted, startMs + 30 * MINUTE);
assert.equal(manuallySubmitted.status === 'playing', false);
assert.equal(frozenBefore.remainingMs, 15 * MINUTE);
assert.equal(frozenLater.remainingMs, frozenBefore.remainingMs);
assert.equal(frozenLater.isPaused, true);

console.log('project timer tests passed');
