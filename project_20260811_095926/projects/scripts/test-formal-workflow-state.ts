import assert from 'node:assert/strict';
import { connectNpc, createProjectOneState, endPhoneCall, executeGameCommand, normalizeProjectOneState, recordMeetingTurn, startPhoneCall, toPlayerVisibleGameState } from '../src/lib/game/state';

let state = connectNpc(createProjectOneState(), 'P1-001');
function command(type: Parameters<typeof executeGameCommand>[1]['type'], payload: Record<string, unknown>, id: string, options: Parameters<typeof executeGameCommand>[2] = {}) {
  const result = executeGameCommand(state, { type, payload, commandId: id, expectedVersion: state.version } as Parameters<typeof executeGameCommand>[1], options);
  state = result.state;
  return result;
}

assert.throws(() => command('work_plan', { scope: 'global', content: '梳理五位关键人物、公开资料、客户问题与下一步拜访安排。' }, 'plan-missing'), /WORK_PLAN_AI_REQUIRED/);
const plan = command('work_plan', { scope: 'global', content: '梳理五位关键人物、公开资料、客户问题与下一步拜访安排。' }, 'plan-1', {
  workPlanEvaluation: { recommendations: ['先核实采购目标。'], disclosures: [{ npcId: 'P1-001', facts: ['负责整体业务方向与关键项目资源协调。'], clues: [] }] },
});
assert.equal(plan.result.workPlan && typeof plan.result.workPlan, 'object');
assert.equal(state.workPlans.length, 1);
assert.equal(state.actionPoints, 27);
command('work_plan', { scope: 'global', content: state.workPlans[0].content }, 'plan-same-content');
assert.equal(state.workPlans.length, 1, 'same-content plan reuses the saved record without another evaluation');
assert.equal(state.actionPoints, 27, 'same-content plan does not charge another action point');
assert.throws(() => command('work_plan', { scope: 'global', content: '先找客户聊聊，再看情况安排后续行动。' }, 'plan-too-vague', {
  workPlanEvaluation: { needsDetail: true, recommendations: ['补充目标与证据。'], disclosures: [] },
}), /WORK_PLAN_NEEDS_DETAIL/);
assert.equal(state.actionPoints, 27, 'an inadequate plan does not charge an action point');

command('postal', { npcId: 'P1-001', content: '邮寄项目简介。', attachment: { title: '项目简介', content: '技术能力与交付范围。' } }, 'postal-1');
assert.equal(state.postalRecords.length, 1);
assert.equal(state.actionPoints, 25);

const brief = command('brief_visit', { npcId: 'P1-001', content: '先确认业务目标，再演示精度指标和同类案例，最后约定技术交流负责人。' }, 'brief-1', {
  briefVisitEvaluation: { strengths: ['目标明确。'], risks: ['需要补充预算边界。'], nextStep: '确认技术交流时间。' },
});
assert.equal(brief.result.briefVisit && typeof brief.result.briefVisit, 'object');
assert.equal(state.visitBriefs.length, 1);
assert.equal(state.actionPoints, 23, 'brief visit feedback costs two AP to match the actual-test workflow');
assert.equal(state.activeMeeting, null, 'brief feedback must not create a meeting');
assert.equal(state.appointments.length, 0, 'brief feedback must not create an appointment');

assert.throws(() => command('start_visit', { npcId: 'P1-001', preparationIds: [] }, 'drop-in-no-prep'), /VISIT_PREPARATION_REQUIRED/);
const direct = command('start_visit', { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, 'drop-in-skip');
assert.equal(direct.state.activeMeeting?.maxTurns, 20);
assert.equal(direct.state.appointments.at(-1)?.invitationMethod, 'drop_in');
assert.equal(state.actionPoints, 20, 'direct visit plus explicit skip-preparation risk costs three AP');

state = recordMeetingTurn(state, { completedTask: '提问' });
assert.deepEqual(state.activeMeeting?.completedTasks, ['提问']);
state = recordMeetingTurn(state, { completedTask: '提问' });
assert.equal(state.activeMeeting?.turnCount, 2, 'a repeated task classification still records the dialogue turn');
assert.deepEqual(state.activeMeeting?.completedTasks, ['提问'], 'a repeated task classification is idempotent');
assert.throws(() => recordMeetingTurn(state, { completedTask: '挖坑' }), /MEETING_TASK_NOT_ALLOWED/);
state = recordMeetingTurn(state, { completedTask: '质疑' });
assert.equal(state.activeMeeting, null, 'finishing every configured NPC task ends the visit early');
assert.equal(state.meetingMinutes.at(-1)?.endReason, 'completed');
assert.deepEqual(state.meetingMinutes.at(-1)?.completedTasks, ['提问', '质疑']);

const capped = command('start_visit', { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, 'drop-in-turn-cap');
assert.equal(capped.state.activeMeeting?.maxTurns, 20);
for (let turn = 0; turn < 20; turn += 1) state = recordMeetingTurn(state);
assert.equal(state.activeMeeting?.turnCount, 20, 'turn 20 remains available, matching the actual-test visit limit');
state = recordMeetingTurn(state);
assert.equal(state.activeMeeting, null, 'the twentieth actual visit turn ends the meeting');
assert.match(state.meetingMinutes.at(-1)?.summary ?? '', /上限/);
assert.equal(state.meetingMinutes.at(-1)?.endReason, 'turn_limit', 'the persisted minutes retain why the actual visit ended');

command('start_visit', { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, 'drop-in-npc-left');
state = recordMeetingTurn(state, { npcLeft: true });
assert.equal(state.activeMeeting, null);
assert.equal(state.meetingMinutes.at(-1)?.endReason, 'npc_left', 'a trusted immediate departure remains distinguishable from task completion');

command('start_visit', { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, 'drop-in-player-farewell');
state = { ...state, activeMeeting: { ...state.activeMeeting!, turnCount: 19 } };
state = recordMeetingTurn(state, { playerFarewell: true });
assert.equal(state.activeMeeting, null);
assert.equal(state.meetingMinutes.at(-1)?.endReason, 'player', 'an explicit farewell takes precedence over the turn cap');

command('start_visit', { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, 'drop-in-npc-farewell');
state = recordMeetingTurn(state, { npcFarewell: true });
assert.equal(state.activeMeeting?.awaitingFinalReplyFrom, 'player', 'NPC farewell waits for one player acknowledgement');
assert.throws(() => command('end_visit', { reason: 'player', summary: '' }, 'end-before-final-reply'), /FINAL_PLAYER_REPLY_REQUIRED/);
state = recordMeetingTurn(state);
assert.equal(state.activeMeeting, null, 'the final player acknowledgement closes the visit without another NPC turn');
assert.equal(state.meetingMinutes.at(-1)?.endReason, 'npc_farewell');

const phoneState = startPhoneCall(connectNpc(createProjectOneState(), 'P1-001'), 'P1-001');
assert.equal(phoneState.activePhoneCall?.npcId, 'P1-001');
assert.equal(phoneState.activePhoneCall?.startedRound, phoneState.currentRound);
assert.equal(Number.isNaN(Date.parse(phoneState.activePhoneCall?.startedAt ?? '')), false, 'the persisted phone timer marker is an ISO timestamp');
assert.throws(() => executeGameCommand(phoneState, {
  type: 'start_visit', payload: { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, commandId: 'phone-active-visit', expectedVersion: phoneState.version,
}), /PHONE_CALL_ACTIVE/, 'an active call cannot leak into a visit');
assert.equal(endPhoneCall(phoneState, 'P1-001').activePhoneCall, null, 'the server-owned hangup clears the persisted call');
const zeroPointPhoneInvite = { ...phoneState, actionPoints: 0 };
const zeroPointInvite = executeGameCommand(zeroPointPhoneInvite, {
  type: 'invite',
  payload: { npcId: 'P1-001', channel: 'work_phone', rawText: '希望本周安排一次正式沟通，确认项目目标和下一步。', attachmentIds: [], emailAttachments: [] },
  commandId: 'phone-active-invite', expectedVersion: zeroPointPhoneInvite.version,
} as Parameters<typeof executeGameCommand>[1]);
assert.equal(zeroPointInvite.state.actionPoints, 0, 'a same-NPC invitation during an active phone call is free');
assert.equal(zeroPointInvite.state.appointments.length, 1, 'a persisted active phone call still permits an invitation');

const meetingState = executeGameCommand(connectNpc(createProjectOneState(), 'P1-001'), {
  type: 'start_visit', payload: { npcId: 'P1-001', preparationIds: [], skipPreparation: true }, commandId: 'meeting-phone-conflict', expectedVersion: 1,
}).state;
assert.throws(() => startPhoneCall(meetingState, 'P1-001'), /MEETING_ALREADY_ACTIVE/);
const repairedLegacyDualMode = normalizeProjectOneState({
  ...meetingState,
  activePhoneCall: { npcId: 'P1-001', startedRound: meetingState.currentRound, startedAt: new Date().toISOString() },
});
assert.equal(repairedLegacyDualMode.activePhoneCall, null, 'a restored meeting clears a stale simultaneous phone flag');

const expressionState = createProjectOneState();
expressionState.npcAttitudes['P1-001'] = { ...expressionState.npcAttitudes['P1-001'], pleasantness: 19 };
expressionState.npcAttitudes['P1-002'] = { ...expressionState.npcAttitudes['P1-002'], pleasantness: 39 };
expressionState.npcAttitudes['P1-003'] = { ...expressionState.npcAttitudes['P1-003'], pleasantness: 59 };
expressionState.npcAttitudes['P1-004'] = { ...expressionState.npcAttitudes['P1-004'], pleasantness: 79 };
expressionState.npcAttitudes['P1-005'] = { ...expressionState.npcAttitudes['P1-005'], pleasantness: 80 };
const visibleExpressions = toPlayerVisibleGameState(expressionState);
assert.deepEqual(visibleExpressions.npcExpressions, {
  'P1-001': 'angry', 'P1-002': 'serious', 'P1-003': 'calm', 'P1-004': 'pleasant', 'P1-005': 'very_happy',
});
assert.equal('npcAttitudes' in visibleExpressions, false, 'the expression map does not expose hidden attitude values');

console.log('formal workflow state tests passed');
