import assert from 'node:assert/strict';
import {
  clearCompetitorStageDecisionCache,
  evaluateCompetitorStageAction,
  type CompetitorStageInvoker,
} from '../src/lib/ai/competitor-stage';
import type { JevInvoker } from '../src/lib/ai/jev-client';
import {
  createProjectOneState,
  isCompetitorStageActionCandidate,
  synchronizeProjectTimer,
  toPlayerVisibleGameState,
  type CompetitorStageActionCandidate,
  type GameRuntimeState,
} from '../src/lib/game/state';

const validCandidate: CompetitorStageActionCandidate = {
  round: 1,
  targetNpcId: 'P1-004',
  kind: 'relationship',
  title: '竞品强化一线关系',
  summary: '竞品尝试利用既有合作经验争取一线反馈。',
  pressureDelta: 4,
};

const json = (value: unknown) => JSON.stringify(value);
const competitorJev: JevInvoker = async () => ({
  answers: {
    targetNpcId: { type: 'choice', choice: 'P1-004', probabilities: {}, confidence: 1 },
    kind: { type: 'choice', choice: 'relationship', probabilities: {}, confidence: 1 },
    pressureDelta: { type: 'choice', choice: '4', probabilities: {}, confidence: 1 },
  },
});
async function main() {
  const state = createProjectOneState();
  let invocations = 0;
  const validInvoker: CompetitorStageInvoker = async () => {
    invocations += 1;
    // LLM may try to supply state fields, but only its prose is consumed.
    return json({ ...validCandidate, targetNpcId: 'P1-001', kind: 'price', pressureDelta: 1 });
  };

  clearCompetitorStageDecisionCache();
  const generated = await evaluateCompetitorStageAction({
  sessionId: 'competitor-ai-idempotent',
  state,
  invoker: validInvoker,
  jevInvoker: competitorJev,
});
  const cached = await evaluateCompetitorStageAction({
  sessionId: 'competitor-ai-idempotent',
  state,
  invoker: validInvoker,
  jevInvoker: competitorJev,
});
assert.equal(generated.source, 'model');
assert.deepEqual(generated.candidate, validCandidate);
assert.equal(generated.candidate?.targetNpcId, 'P1-004', 'Jev decision wins over LLM-supplied target');
assert.equal(generated.candidate?.pressureDelta, 4, 'Jev choice controls persisted pressure');
assert.equal(cached.source, 'cached', 'the same session/stage reuses one decision');
assert.equal(invocations, 1, 'same-stage retries do not invoke the model twice');
assert.equal(isCompetitorStageActionCandidate(generated.candidate, 1), true);

// The hidden rival simulation advances at each timer checkpoint. Stage fields
// stay fixed for compatibility; the elapsed timer selects the world time index.
const timerStart = Date.parse('2026-10-12T00:00:00.000Z');
let checkpointState: GameRuntimeState = {
  ...createProjectOneState(),
  actionPoints: 26,
  projectTimer: {
    durationMs: 20 * 60_000,
    elapsedMs: 0,
    lastResumedAt: new Date(timerStart).toISOString(),
    recoveredIntervals: 0,
    visitPaused: false,
  },
};
checkpointState = synchronizeProjectTimer(checkpointState, timerStart + 5 * 60_000);
assert.equal(checkpointState.projectTimer.recoveredIntervals, 1);
assert.equal(checkpointState.actionPoints, 28, 'timer recovery is capped at 28 action points');
assert.equal(checkpointState.currentRound, 1, 'timer checkpoint does not advance round metadata');
assert.equal(checkpointState.competitorState.actions.length, 1, 'the first five-minute checkpoint advances the hidden rival world');
assert.equal(checkpointState.competitorState.actions[0]?.round, 1);
assert.equal(toPlayerVisibleGameState(checkpointState).competitorState.actions.length, 0);

checkpointState = synchronizeProjectTimer(checkpointState, timerStart + 10 * 60_000);
assert.equal(checkpointState.projectTimer.recoveredIntervals, 2);
assert.equal(checkpointState.currentRound, 1);
assert.equal(checkpointState.competitorState.actions.length, 2, 'each elapsed five-minute checkpoint advances the rival world once');
assert.equal(checkpointState.competitorState.actions[1]?.round, 2, 'the second timer checkpoint uses world time index two');

  clearCompetitorStageDecisionCache();
  let invalidInvocations = 0;
  const invalidInvoker: CompetitorStageInvoker = async () => {
    invalidInvocations += 1;
    return json({ ...validCandidate, round: 2, pressureDelta: 99 });
  };
  const invalid = await evaluateCompetitorStageAction({
  sessionId: 'competitor-ai-invalid',
  state,
  invoker: invalidInvoker,
  jevInvoker: competitorJev,
});
assert.deepEqual(invalid.candidate, validCandidate, 'invalid LLM prose falls back without replacing Jev choice');
assert.equal(invalid.source, 'model');
assert.equal(invalidInvocations, 1);
  let multiplayerInvocations = 0;
  const multiplayer = await evaluateCompetitorStageAction({
  sessionId: 'competitor-ai-multiplayer',
  state: { ...state, gameMode: 'multiplayer' },
  invoker: async () => {
    multiplayerInvocations += 1;
    return json(validCandidate);
  },
  jevInvoker: competitorJev,
});
assert.equal(multiplayer.source, 'existing');
assert.equal(multiplayer.validationErrors[0], 'MULTIPLAYER_DEFERRED');
assert.equal(multiplayerInvocations, 0, 'multiplayer stage transitions do not call solo competitor AI');

  clearCompetitorStageDecisionCache();
  console.log('competitor timer checkpoint AI contracts passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
