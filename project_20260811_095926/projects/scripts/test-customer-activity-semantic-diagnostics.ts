import assert from 'node:assert/strict';
import {
  appendCustomerActivityDiagnostic,
  createProjectOneState,
  normalizeProjectOneState,
  toPlayerVisibleGameState,
} from '../src/lib/game/state';

let state = appendCustomerActivityDiagnostic(createProjectOneState(), {
  event: 'semantic_review_completed',
  npcId: 'P1-004',
  messageId: 'sales-proposal-1',
  details: {
    signal: 'refusal', result: 'allowed', violation: 'none', evidence_valid: true,
    evidence_digest: '012345abcdef', evidence_start: 0, evidence_end: 10, attempt: 0,
    model_classification: 'active', withdrawal_message_count: 0,
    withdrawal_message_id: 'sales-withdrawal-2',
    rawModelOutput: 'must not persist', reply: 'must not persist',
  },
});
state = normalizeProjectOneState(state);
const details = state.customerActivityDiagnostics?.at(-1)?.details;
assert.deepEqual(details, {
  signal: 'refusal', result: 'allowed', violation: 'none', evidence_valid: true,
  evidence_digest: '012345abcdef', evidence_start: 0, evidence_end: 10, attempt: 0,
  model_classification: 'active', withdrawal_message_count: 0,
  withdrawal_message_id: 'sales-withdrawal-2',
});
state = appendCustomerActivityDiagnostic(state, {
  event: 'semantic_review_completed',
  details: {
    signal: 'arbitrary transcript text', result: 'bogus', violation: 'bogus',
    evidence_valid: 'true', evidence_digest: 'full reply text', evidence_start: -1,
    evidence_end: 60_001, attempt: 2, model_classification: 'arbitrary reasoning',
    withdrawal_message_count: 1.5,
    withdrawal_message_id: 'x'.repeat(161),
  },
});
assert.equal(state.customerActivityDiagnostics?.at(-1)?.details, undefined,
  'invalid semantic diagnostic values must not persist as arbitrary text');
for (let index = 0; index < 105; index += 1) {
  state = appendCustomerActivityDiagnostic(state, { event: 'semantic_review_started', details: { attempt: 0 } });
}
assert.equal(state.customerActivityDiagnostics?.length, 100, 'private semantic traces remain bounded');
const publicState = toPlayerVisibleGameState(state);
assert.equal('customerActivityDiagnostics' in publicState, false,
  'internal semantic judgments and evidence never reach player state');
console.log('Semantic diagnostic persistence, bounded storage, source metadata and player privacy tests passed.');
