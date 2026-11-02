import assert from 'node:assert/strict';
import {
  decideFormalMessageResponse,
  evaluateFormalVisitTurn,
  type FormalVisitDecisionInput,
} from '../src/lib/ai/formal-visit-decision';
import type { JevInvoker, JevRequest } from '../src/lib/ai/jev-client';

const baseInput: FormalVisitDecisionInput = {
  npcId: 'P1-001',
  completedTasks: [],
  turn: 1,
  playerMessage: '请问您最关注项目推进中的哪些风险？',
  npcReply: '先把关键风险和收益说清楚，再按流程推进。',
};

function choices(completedTask: string, npcDialogueSignal = 'continue', playerDialogueSignal = 'continue'): JevInvoker {
  return async () => ({
    answers: {
      completedTask: { type: 'choice', choice: completedTask, probabilities: {}, confidence: 1 },
      npcDialogueSignal: { type: 'choice', choice: npcDialogueSignal, probabilities: {}, confidence: 1 },
      playerDialogueSignal: { type: 'choice', choice: playerDialogueSignal, probabilities: {}, confidence: 1 },
    },
  });
}

async function main() {
  let captured: JevRequest | undefined;
  const valid = await evaluateFormalVisitTurn(baseInput, {
    jevInvoker: async (request) => {
      captured = request;
      return choices('提问')({ state: {}, questions: {} });
    },
  });
  assert.deepEqual(valid, { completedTask: '提问', playerFarewell: false, npcFarewell: false, npcLeft: false });
  const taskQuestion = captured?.questions.completedTask;
  assert.equal(taskQuestion?.type, 'choice');
  assert.deepEqual(Object.keys(taskQuestion?.type === 'choice' ? taskQuestion.criteria : {}), ['none', '提问', '质疑']);
  assert.equal(typeof captured?.state, 'string', 'turn transcript is serialized as untrusted context');

  const repeatExcluded = await evaluateFormalVisitTurn({ ...baseInput, completedTasks: ['提问'], turn: 2 }, {
    jevInvoker: async (request) => {
      const task = request.questions.completedTask;
      assert.equal(task?.type, 'choice');
      assert.equal(task?.type === 'choice' && '提问' in task.criteria, false, 'already-completed tasks are not offered again');
      return choices('提问')({ state: {}, questions: {} });
    },
  });
  assert.deepEqual(repeatExcluded, { completedTask: null, playerFarewell: false, npcFarewell: false, npcLeft: false }, 'a provider cannot re-complete an existing task');

  const disallowed = await evaluateFormalVisitTurn(baseInput, { jevInvoker: choices('挖坑') });
  assert.deepEqual(disallowed, { completedTask: null, playerFarewell: false, npcFarewell: false, npcLeft: false }, 'a task outside the master allowlist is ignored');

  const immediateExit = await evaluateFormalVisitTurn(baseInput, { jevInvoker: choices('none', 'forced_exit') });
  assert.deepEqual(immediateExit, { completedTask: null, playerFarewell: false, npcFarewell: false, npcLeft: true });

  const playerFarewell = await evaluateFormalVisitTurn({ ...baseInput, playerMessage: '今天先到这，我先告辞，感谢您的时间。' }, { jevInvoker: choices('none', 'continue', 'farewell') });
  assert.deepEqual(playerFarewell, { completedTask: null, playerFarewell: true, npcFarewell: false, npcLeft: false }, 'the configured Jev decision recognizes a natural-language farewell');
  const noRemaining = await evaluateFormalVisitTurn({ ...baseInput, completedTasks: ['提问', '质疑'] }, { jevInvoker: choices('none', 'continue', 'farewell') });
  assert.deepEqual(noRemaining, { completedTask: null, playerFarewell: true, npcFarewell: false, npcLeft: false }, 'an already-complete task list still recognizes a player farewell');

  const npcFarewell = await evaluateFormalVisitTurn(baseInput, { jevInvoker: choices('none', 'farewell') });
  assert.deepEqual(npcFarewell, { completedTask: null, playerFarewell: false, npcFarewell: true, npcLeft: false }, 'a normal NPC farewell remains distinct from an immediate departure');

  const unavailable = await evaluateFormalVisitTurn(baseInput, { jevInvoker: async () => { throw new Error('JEV_OFFLINE'); } });
  assert.deepEqual(unavailable, { completedTask: null, playerFarewell: false, npcFarewell: false, npcLeft: false }, 'provider failure never fabricates task completion');
  const silent = await decideFormalMessageResponse({ npcId: 'P1-001', channel: 'email', playerMessage: '谢谢，今天先这样。' }, {
    jevInvoker: async () => ({ answers: { responseAction: { type: 'choice', choice: 'read_no_reply', probabilities: {}, confidence: 1 } } }),
  });
  assert.deepEqual(silent, { responseAction: 'read_no_reply' }, 'written channels can persist a read-without-reply decision');
  const reply = await decideFormalMessageResponse({ npcId: 'P1-001', channel: 'online', playerMessage: '请确认三个可核验的验收指标和下一步。' }, {
    jevInvoker: async () => ({ answers: { responseAction: { type: 'choice', choice: 'reply', probabilities: {}, confidence: 1 } } }),
  });
  assert.deepEqual(reply, { responseAction: 'reply' });
  const complianceReply = await decideFormalMessageResponse({ npcId: 'P1-001', channel: 'email', playerMessage: '能否用红包表达一下感谢？' }, {
    jevInvoker: async () => ({ answers: { responseAction: { type: 'choice', choice: 'read_no_reply', probabilities: {}, confidence: 1 } } }),
  });
  assert.deepEqual(complianceReply, { responseAction: 'reply' }, 'compliance redlines cannot be hidden by a silent decision');
  await assert.rejects(() => evaluateFormalVisitTurn({ ...baseInput, npcId: 'P1-999' }), /NPC_UNKNOWN/);

  console.log('formal visit decision tests passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
