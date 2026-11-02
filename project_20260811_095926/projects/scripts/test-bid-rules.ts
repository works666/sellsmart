import assert from 'node:assert/strict';
import { gameCommandSchema } from '../src/lib/contracts/game';
import {
  applyNpcAttitudeDelta,
  calculateSupplierOverallSupportState,
  createProjectOneState,
  executeGameCommand,
  getGameOutcome,
  normalizeProjectOneState,
  toPlayerVisibleGameCommandResult,
  toPlayerVisibleGameOutcome,
  toPlayerVisibleGameState,
  type GameRuntimeState,
} from '../src/lib/game/state';
import { calculateOverallSupportState, interpretBidRuleProposal } from '../src/lib/game/bid-rules';
import { PROJECT_ONE_NPCS } from '../src/lib/game/project-one';

function setPlayerSupport(state: GameRuntimeState, value: number, overrides: Record<string, number> = {}): GameRuntimeState {
  const supports = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, overrides[npc.id] ?? value]));
  const npcAttitudes = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, {
    ...state.npcAttitudes[npc.id],
    support: supports[npc.id],
  }]));
  return normalizeProjectOneState({
    ...state,
    npcAttitudes,
    npcAffinity: supports,
    supplierSupport: { ...state.supplierSupport, 'player-company': supports },
    bidRule: 'balanced',
  });
}

function contactNpc(state: GameRuntimeState, npcId: string): GameRuntimeState {
  return {
    ...state,
    npcContacts: {
      ...state.npcContacts,
      [npcId]: { ...state.npcContacts[npcId], status: 'online', hasReplied: true },
    },
  };
}

function propose(state: GameRuntimeState, targetContactId: string, proposalText: string, commandId: string) {
  const command = gameCommandSchema.parse({
    commandId,
    expectedVersion: state.version,
    type: 'propose_bid_rule',
    payload: { targetContactId, proposalText },
  });
  return executeGameCommand(state, command);
}

// The bands retain the existing 0–100 support scale. A single high score is
// insufficient for HIGH because broad decision-weight support is also needed.
assert.equal(calculateOverallSupportState([{ support: 85, weight: 1 }, { support: 20, weight: 1 }]), 'MID_HIGH');
assert.equal(calculateOverallSupportState([{ support: 90, weight: 1 }, { support: 80, weight: 1 }]), 'HIGH');
assert.equal(calculateOverallSupportState([{ support: 55, weight: 1 }]), 'MID_HIGH');
assert.equal(calculateOverallSupportState([{ support: 40, weight: 1 }]), 'MID');
assert.equal(calculateOverallSupportState([{ support: 20, weight: 1 }]), 'LOW');

// Natural-language proposals must carry one explicit, player-chosen direction.
assert.equal(interpretBidRuleProposal('不要最低价优先，建议将技术精度作为核心评分项。')?.bidRule, 'technical_accuracy');
assert.equal(interpretBidRuleProposal('建议以技术精度为核心，价格只满足基本要求。')?.bidRule, 'technical_accuracy');
assert.equal(interpretBidRuleProposal('价格、技术精度都很重要，请综合考虑。'), null, 'ambiguous proposals are not coerced into a direction');
assert.equal(interpretBidRuleProposal('请在评审时多关照我们。'), null, 'a non-specific request is not a procurement proposal');

const initial = createProjectOneState();
assert.equal(initial.bidRule, 'balanced');
assert.equal(initial.overallSupportState, 'LOW');
assert.equal(initial.supplierSupport?.['abc-company']?.['P1-001'], 52);
assert.equal(initial.supplierSupport?.['xyz-company']?.['P1-001'], 46);

// HIGH support changes the internal rule automatically. It does not create a
// player-facing system notification; an authorised NPC may disclose it later.
let high = setPlayerSupport(initial, 70);
assert.equal(high.overallSupportState, 'HIGH');
assert.equal(high.bidRule, 'technical_accuracy');
assert.equal(high.notifications.filter((item) => item.title === '招标评价规则已调整').length, 0);
high = normalizeProjectOneState(high);
assert.equal(high.notifications.filter((item) => item.title === '招标评价规则已调整').length, 0, 'normalization does not manufacture a rule event');
assert.equal(calculateSupplierOverallSupportState(high, 'player-company'), 'HIGH');

// MID_HIGH relationship alone cannot change the balanced rule.
const midHigh = setPlayerSupport(initial, 55);
assert.equal(midHigh.overallSupportState, 'MID_HIGH');
assert.equal(midHigh.bidRule, 'balanced');
assert.throws(
  () => propose(initial, 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-without-contact'),
  /NPC_NOT_CONNECTED/,
  'proposals require an established contact or an active visit',
);

// A connected decision influencer can explicitly propose the matching rule.
const midHighProposal = propose(contactNpc(midHigh, 'P1-003'), 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-midhigh');
assert.equal(midHighProposal.result.recorded, true);
assert.equal(midHighProposal.state.bidRule, 'technical_accuracy');
assert.equal(midHighProposal.state.actionPoints, midHigh.actionPoints - 2);
assert.equal(midHighProposal.state.ruleProposalHistory.at(-1)?.accepted, true);
assert.throws(
  () => propose(midHighProposal.state, 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-midhigh-repeat'),
  /RULE_PROPOSAL_ALREADY_MADE/,
  'the same NPC/rule pair cannot be farmed repeatedly',
);
const activeMeetingProposal = propose({
  ...midHigh,
  activeMeeting: {
    id: 'meeting:test',
    npcId: 'P1-003',
    actionId: 'formal',
    appointmentId: 'appointment:test',
    visitType: 'formal',
    turnCount: 0,
    maxTurns: 6,
    durationMinutes: 40,
    startedAt: 'stage:1',
    workTopicOpenedBy: null,
    usedPreparationIds: [],
  },
}, 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-active-meeting');
assert.equal(activeMeetingProposal.result.recorded, true, 'proposal works during the matching NPC visit');

const midHighCompetitiveFixture = {
  ...midHigh,
  dimensions: {
    decisionAnalysis: 100,
    relationshipBuilding: 100,
    valuePresentation: 100,
    objectionHandling: 100,
    informationDiscovery: 100,
  },
  outcomeEvidence: {
    publicValue: [{ id: 'bid-public', npcId: 'P1-002', statement: '可验证的公共价值', strength: 2, source: 'system' as const, confirmedRound: 1 }],
    personalBenefit: [{ id: 'bid-personal', npcId: 'P1-002', statement: '合理的个人收益', strength: 2, source: 'system' as const, confirmedRound: 1 }],
  },
  competitorState: { ...midHigh.competitorState, pressureScore: 65 },
};
const unproposedOutcome = getGameOutcome(midHighCompetitiveFixture);
assert.equal(unproposedOutcome.overallSupportState, 'MID_HIGH');
assert.equal(unproposedOutcome.bidRule, 'balanced');
assert.equal(unproposedOutcome.winnerSupplierId, 'abc-company', 'MID_HIGH relation alone does not protect the player');
const proposedFixture = propose(contactNpc(midHighCompetitiveFixture, 'P1-003'), 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-midhigh-calibrated');
assert.equal(proposedFixture.state.ruleProposalHistory.at(-1)?.accepted, true);
assert.equal(getGameOutcome(proposedFixture.state).winnerSupplierId, 'player-company', 'an accepted matching rule changes the calibrated result');

// MID can pass only through a highly supportive, sufficiently influential NPC.
const midInfluencer = setPlayerSupport(initial, 40, { 'P1-001': 75 });
assert.equal(midInfluencer.overallSupportState, 'MID');
const midAccepted = propose(contactNpc(midInfluencer, 'P1-001'), 'P1-001', '建议将技术精度作为核心评分项。', 'proposal-mid-accepted');
assert.equal(midAccepted.state.ruleProposalHistory.at(-1)?.accepted, true);
assert.equal(midAccepted.state.bidRule, 'technical_accuracy');
const midNonDecisionMaker = setPlayerSupport(initial, 40, { 'P1-005': 75 });
assert.throws(
  () => propose(contactNpc(midNonDecisionMaker, 'P1-005'), 'P1-005', '建议将技术精度作为核心评分项。', 'proposal-mid-rejected'),
  /NPC_RULE_AUTHORITY_REQUIRED/,
  'an execution contact cannot modify procurement criteria',
);

// LOW proposals fail even when targeted at an influential, contacted NPC.
const lowProposal = propose(contactNpc(initial, 'P1-003'), 'P1-003', '建议将技术精度作为核心评分项。', 'proposal-low');
assert.equal(lowProposal.result.recorded, true);
assert.equal(lowProposal.state.ruleProposalHistory.at(-1)?.accepted, false);
assert.match(String(lowProposal.state.ruleProposalHistory.at(-1)?.reason), /没有必要调整评价标准/);
const unsupportedProposal = propose(contactNpc(midHigh, 'P1-003'), 'P1-003', '建议采用最低价优先的方式评审。', 'proposal-wrong-advantage');
assert.equal(unsupportedProposal.state.ruleProposalHistory.at(-1)?.accepted, false, 'a rule that does not match the player profile is not adopted');
assert.equal(unsupportedProposal.state.bidRule, 'balanced');

// A HIGH rival can shape the rule and win; the player has no protected result.
const abcSupport = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, 85]));
const rivalHigh = normalizeProjectOneState({
  ...initial,
  dimensions: {
    decisionAnalysis: 0,
    relationshipBuilding: 0,
    valuePresentation: 0,
    objectionHandling: 0,
    informationDiscovery: 0,
  },
  supplierSupport: { ...initial.supplierSupport, 'abc-company': abcSupport },
});
assert.equal(rivalHigh.bidRule, 'lowest_price');
assert.equal(calculateSupplierOverallSupportState(rivalHigh, 'abc-company'), 'HIGH');
const outcome = getGameOutcome(rivalHigh);
assert.equal(outcome.winnerSupplierId, 'abc-company');
assert.equal(outcome.won, false);
assert.deepEqual(outcome.supplierResults.map((item) => item.rank), [1, 2, 3]);
assert.equal('score' in outcome.supplierResults[0], false, 'public result summaries omit numeric rival scores');
const visible = toPlayerVisibleGameState(rivalHigh);
assert.equal('supplierSupport' in visible, false, 'player snapshots never disclose competitor support numbers');
assert.equal('overallSupportState' in visible, false, 'player snapshots never disclose support bands');
assert.equal('npcAffinity' in visible, false, 'player snapshots never disclose NPC support numbers');
assert.equal('npcAttitudes' in visible, false, 'player snapshots never disclose private NPC attitudes');
assert.equal('bidRule' in visible, false, 'player snapshots never disclose the current procurement rule');
assert.equal('ruleProposalHistory' in visible, false, 'player snapshots never disclose proposal records');
assert.equal(visible.competitorState.pressureScore, 0);
const visibleOutcome = toPlayerVisibleGameOutcome(outcome);
assert.equal('bidRule' in visibleOutcome, false, 'settlement API does not bypass NPC-only procurement disclosure');
assert.equal('ruleProposalHistory' in visibleOutcome, false, 'settlement API does not expose proposal history');
assert.equal('supportByNpc' in visibleOutcome, false, 'final player outcome never discloses NPC support numbers');
assert.equal('overallSupportState' in visibleOutcome, false, 'final player outcome never discloses the player support band');
assert.equal('supportBySupplier' in visibleOutcome, false, 'final player outcome never discloses supplier support bands');
assert.equal('decisionChainSupport' in visibleOutcome, false, 'final player outcome never discloses the aggregate support score');
assert.ok(visibleOutcome.supplierResults.every((item) => !('overallSupportState' in item)), 'supplier result cards do not disclose support bands');
assert.ok(visibleOutcome.supplierResults.every((item) => !('ruleFit' in item)), 'supplier cards do not disclose rule-fit signals');
assert.ok(visibleOutcome.supplierResults.every((item) => !('reason' in item)), 'supplier cards do not expose evaluation-direction matching prose');
assert.doesNotMatch(visibleOutcome.winnerReason, /高支持|中高支持|中等支持|低支持/, 'winner explanation does not disclose a support band');
assert.doesNotMatch(visibleOutcome.winnerReason, /最低价优先|技术精度优先|功能完整度优先|综合评价/, 'winner explanation does not disclose the procurement rule');
const visibleProposalResult = toPlayerVisibleGameCommandResult({
  accepted: true,
  bidRule: 'technical_accuracy',
  reason: '客户已采纳',
  overallSupportState: 'HIGH',
});
assert.equal('overallSupportState' in visibleProposalResult, false, 'proposal responses do not disclose a support band');
assert.equal('accepted' in visibleProposalResult, false, 'proposal responses do not disclose adoption');
assert.equal('bidRule' in visibleProposalResult, false, 'proposal responses do not disclose the internal rule');

const tieSupport = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, 52]));
const tiedRivals = normalizeProjectOneState({
  ...initial,
  competitorState: { ...initial.competitorState, pressureScore: 51 },
  supplierSupport: {
    ...initial.supplierSupport,
    'abc-company': tieSupport,
    'xyz-company': tieSupport,
  },
});
const firstTieOutcome = getGameOutcome(tiedRivals).supplierResults;
const secondTieOutcome = getGameOutcome(tiedRivals).supplierResults;
assert.deepEqual(firstTieOutcome, secondTieOutcome, 'the same equal-score game state has a stable winner/order');
assert.equal(firstTieOutcome[0].supplierId, 'abc-company', 'equal rival support and rule fit use stable supplier id order');

// All support-changing paths pass through the same automatic-rule reconciler.
const supportChange = applyNpcAttitudeDelta(setPlayerSupport(initial, 58), 'P1-002', {
  supportDelta: 8,
  reason: '测试支持变化',
  source: 'test',
});
assert.equal(supportChange.overallSupportState, 'MID_HIGH');
assert.equal(supportChange.bidRule, 'balanced');
const crossingHigh = applyNpcAttitudeDelta(setPlayerSupport(initial, 64), 'P1-001', {
  supportDelta: 8,
  reason: '关键人物在拜访后认可方案',
  source: 'test_visit',
});
assert.equal(crossingHigh.overallSupportState, 'HIGH');
assert.equal(crossingHigh.bidRule, 'technical_accuracy', 'a support change automatically shapes the rule without a player proposal');
assert.equal(crossingHigh.ruleProposalHistory.length, 0);

console.log('Bid rule scenarios passed.');
