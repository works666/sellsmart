import type { EmailAttachment, NpcTurnEvaluation } from '@/lib/contracts/ai';
import type { ProjectOneVisitTask } from '@/lib/designer/project-one-five-person';
import { PROJECT_ONE_FIVE_PERSON_NPCS } from '@/lib/designer/project-one-five-person';
import { verifyNpcEvaluationSources } from '@/lib/ai/npc-evaluation-sources';
import type { GameCommand } from '@/lib/contracts/game';
import {
  CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH,
  CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES,
  CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
  customerActivityConversationMessageSchema,
  customerActivityOrganizationSnapshotSchema,
  customerActivityRelationshipSnapshotSchema,
  createEmptyCustomerActivityState,
  DEFAULT_ACTIVITY_DECISION_CONFIG,
  parseActivityDecisionConfig,
  recordCustomerActivityProposalDecision,
  recordCustomerActivityEvaluation,
  readCustomerActivityState,
  toPublicCustomerActivityTask,
  type ActivityDecisionConfig,
  type CustomerActivityConversationMessage,
  type CustomerActivityEvaluation,
  type CustomerActivityFeasibilityDecision,
  type CustomerActivityProposalCandidate,
  type CustomerActivityRelationshipSnapshot,
  type CustomerActivityState,
  type PublicCustomerActivityTask,
} from '@/lib/game/customer-activities';
import {
  PROJECT_ONE_ACTION_POINT_CAP,
  PROJECT_ONE_CODE,
  PROJECT_ONE_COMMUNICATION_MINUTES,
  PROJECT_ONE_COMMUNICATION_POINTS,
  PROJECT_ONE_COMPANY_PERSONAL_INFO,
  PROJECT_ONE_DAY_START_MINUTE,
  PROJECT_ONE_EVENING_END_MINUTE,
  PROJECT_ONE_INITIAL_ACTION_POINTS,
  PROJECT_ONE_MAX_ROUNDS,
  PROJECT_ONE_NPCS,
  PROJECT_ONE_OVERTIME_END_MINUTE,
  PROJECT_ONE_PHASE_NAMES,
  PROJECT_ONE_PREPARATION_RULES,
  PROJECT_ONE_PREPARATION_TITLES,
  PROJECT_ONE_PUBLIC_PROFILES,
  PROJECT_ONE_PUBLIC_RESEARCH_RULE,
  PROJECT_ONE_STANDARD_DAY_MINUTES,
  PROJECT_ONE_VISIT_RULES,
  PROJECT_ONE_WORK_END_MINUTE,
  getProjectOneNpc,
  PROJECT_ONE_SUPPLIERS,
  type ContactChannel,
  type BidRule,
  type OverallSupportState,
  type SupplierAdvantageType,
  type ProjectOneClue,
} from '@/lib/game/project-one';
import { BID_RULES, BID_RULE_PROPOSAL_COST, calculateOverallSupportState as getOverallSupportBand, calculateWeightedSupport, getProcurementRuleAccess, getRuleFit, getRuleMatchScore, interpretBidRuleProposal } from '@/lib/game/bid-rules';
import type { FormalBriefVisitEvaluation, FormalPlanEvaluation, FormalVisitPreparationEvaluation } from '@/lib/ai/formal-workflow';

export const GAME_DIMENSIONS = [
  'decisionAnalysis',
  'relationshipBuilding',
  'valuePresentation',
  'objectionHandling',
  'informationDiscovery',
] as const;

export type GameDimension = (typeof GAME_DIMENSIONS)[number];
export type GameDimensions = Record<GameDimension, number>;
export type CommunicationChannel = Exclude<ContactChannel, 'offline'>;
export type VisitType = keyof typeof PROJECT_ONE_VISIT_RULES;
export type InvitationMethod = 'dedicated' | 'drop_in';
export type AppointmentStatus =
  | 'pending'
  | 'accepted'
  | 'countered'
  | 'rejected'
  | 'cancelled'
  | 'missed'
  | 'active'
  | 'completed';
export type PreparationType = keyof typeof PROJECT_ONE_PREPARATION_RULES;
export type SupplierId = (typeof PROJECT_ONE_SUPPLIERS)[number]['id'];

export const SUPPORT_STATE_LABELS: Record<OverallSupportState, string> = {
  HIGH: '高支持',
  MID_HIGH: '中高支持',
  MID: '中等支持',
  LOW: '低支持',
};

export interface RuleProposalRecord {
  id: string;
  supplierId: SupplierId;
  npcId: string;
  bidRule: BidRule;
  /** Player-entered wording. Kept internally for a traceable procurement audit. */
  proposalText: string;
  round: number;
  accepted: boolean;
  reason: string;
}

export interface SupplierPublicProfile {
  id: SupplierId;
  name: string;
  advantageType: SupplierAdvantageType;
  coreAdvantage: string;
  preferredBidRule: BidRule;
}

export interface SupplierOutcomeSummary {
  supplierId: SupplierId;
  name: string;
  coreAdvantage: string;
  overallSupportState: OverallSupportState;
  ruleFit: 'strong' | 'neutral' | 'weak';
  rank: number;
  reason: string;
}

export const PREPARATION_SEMANTIC_TAGS = [
  'target_person',
  'customer_problem',
  'solution_or_dimension',
  'evidence',
  'next_step',
] as const;

export type PreparationSemanticTag = (typeof PREPARATION_SEMANTIC_TAGS)[number];

export interface PreparationBrief {
  /** Canonical target from the server-side npcId, optionally plus the player's audience note. */
  audience: string;
  problem: string;
  dimensions: string;
  evidence: string;
  nextStep: string;
  /** Deterministic labels found in the submitted free text. */
  semanticTags?: PreparationSemanticTag[];
}

export interface ConversationMemory {
  summary: string;
  summarizedMessageCount: number;
  confirmedFacts?: string[];
  commitments?: string[];
}

export interface NpcContactState {
  status: 'known' | 'connected' | 'online';
  initialChannel: Extract<ContactChannel, 'email' | 'work_phone'>;
  onlineRequestedRound: number | null;
  unansweredRound: number | null;
  outboundCount: number;
  hasReplied: boolean;
  lastContactRound: number | null;
  lastContactMinute: number | null;
  channelCooldownUntil: Partial<Record<CommunicationChannel, number>>;
  wechatStatus: 'not_requested' | 'pending' | 'accepted' | 'rejected' | 'later';
  lastPhoneOutcome: 'connected' | 'unanswered' | 'declined' | 'call_later' | null;
}

export interface AttitudeHistoryItem {
  round: number;
  minute: number;
  pleasantnessDelta: number;
  supportDelta: number;
  reason: string;
  source: string;
}

export interface NpcAttitudeState {
  pleasantness: number;
  support: number;
  unmetImpression: number;
  complianceAwareness: number;
  history: AttitudeHistoryItem[];
}

export interface GameAppointment {
  id: string;
  npcId: string;
  invitationMethod: InvitationMethod;
  visitType: VisitType;
  venue: string;
  purpose: string;
  scheduledRound: number;
  startMinute: number;
  durationMinutes: number;
  maxTurns: number;
  status: AppointmentStatus;
  conditions: string[];
  reservedMinutes: number;
  workTopicOpenedBy: 'player' | 'npc' | null;
  invitationCommandId: string;
  invitationText?: string;
  extractedFields?: string[];
  defaultedFields?: string[];
  /** Player-described files sent with an email invitation. */
  emailAttachments?: EmailAttachment[];
  /** Legacy preparation references retained for old saves/commands only. */
  attachmentIds?: string[];
}

export interface GamePreparation {
  id: string;
  npcId: string;
  appointmentId: string | null;
  type: PreparationType;
  title: string;
  content: string;
  brief?: PreparationBrief;
  /** Server-evaluated guidance for the current visit-preparation workflow. */
  feedback?: { strengths: string[]; risks: string[]; nextStep: string };
  status: 'ready' | 'used';
  costPoints: number;
  timeMinutes: number;
  reusable: boolean;
  usedCount: number;
  createdRound: number;
}

export interface GameWorkPlanRecord {
  id: string;
  scope: 'global' | 'npc';
  npcId: string | null;
  content: string;
  recommendations: string[];
  disclosures: Array<{ npcId: string; facts: string[]; clues: string[] }>;
  costPoints: number;
  createdRound: number;
}

export interface GamePostalRecord {
  id: string;
  npcId: string;
  content: string;
  attachment?: { title: string; content: string };
  costPoints: number;
  createdRound: number;
}

/** Advisory feedback only. It never represents an actual completed visit. */
export interface GameVisitBriefRecord {
  id: string;
  npcId: string;
  content: string;
  strengths: string[];
  risks: string[];
  nextStep: string;
  costPoints: number;
  createdRound: number;
}

export type NotificationKind =
  | 'appointment'
  | 'commitment'
  | 'handoff'
  | 'project'
  | 'follow_up'
  | 'compliance';

export interface GameNotification {
  id: string;
  npcId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  round: number;
  minute: number;
  isRead: boolean;
  targetId: string | null;
}

export interface OutcomeEvidenceItem {
  id: string;
  npcId: string;
  statement: string;
  strength: number;
  source: 'ai_confirmed' | 'material' | 'commitment' | 'system';
  confirmedRound: number;
}

export interface OutcomeEvidenceLedger {
  publicValue: OutcomeEvidenceItem[];
  personalBenefit: OutcomeEvidenceItem[];
}

export type GiftDisposition =
  | 'delighted_acceptance'
  | 'cautious_acceptance'
  | 'polite_decline'
  | 'firm_rejection'
  | 'reported';

export interface ComplianceRiskEvent {
  id: string;
  npcId: string;
  preparationId: string | null;
  kind: 'boundary_gift' | 'explicit_bribe' | 'audit' | 'report';
  severity: number;
  status: 'latent' | 'triggered' | 'resolved';
  penalty: number;
  reason: string;
  createdRound: number;
  triggerRound: number | null;
  outcome: GiftDisposition | null;
}

export interface ActiveMeeting {
  id: string;
  npcId: string;
  actionId: string;
  appointmentId: string;
  visitType: VisitType;
  turnCount: number;
  maxTurns: number;
  durationMinutes: number;
  startedAt: string;
  workTopicOpenedBy: 'player' | 'npc' | null;
  usedPreparationIds: string[];
  /**
   * Tasks completed during this actual visit. These are produced by the
   * server-side evaluator and checked against the NPC's configured task list;
   * client commands never carry them.
   */
  completedTasks?: ProjectOneVisitTask[];
  /** NPC has made a normal farewell; one player acknowledgement is still due. */
  awaitingFinalReplyFrom?: 'player';
}

export interface GameMeetingMinutes {
  id: string;
  appointmentId: string;
  npcId: string;
  visitType: VisitType;
  summary: string;
  confirmedItems: string[];
  npcCommitments: string[];
  playerCommitments: string[];
  pendingMaterials: string[];
  nextStep: string;
  nextStepRound: number;
  nextStepMinute: number;
  /** Persisted end cause lets a restored formal visit explain why it stopped. */
  endReason: 'completed' | 'player' | 'npc_left' | 'npc_farewell' | 'turn_limit';
  /** Completed server-validated visit tasks, retained for the meeting audit. */
  completedTasks: ProjectOneVisitTask[];
  owner: string;
  createdRound: number;
  createdMinute: number;
  original?: {
    summary: string;
    confirmedItems: string[];
    npcCommitments: string[];
    playerCommitments: string[];
    nextStep: string;
  };
  revisionCount?: number;
  lastEditedRound?: number;
  lastEditedMinute?: number;
}

export type CompetitivePosition = 'lagging' | 'close' | 'leading';

export const COMPETITOR_TARGET_NPC_IDS = [
  'P1-001',
  'P1-002',
  'P1-003',
  'P1-004',
  'P1-005',
] as const;

export type CompetitorTargetNpcId = (typeof COMPETITOR_TARGET_NPC_IDS)[number];
export type CompetitorActionKind = 'relationship' | 'price' | 'case' | 'executive';

export interface CompetitorActionRecord {
  id: string;
  round: number;
  targetNpcId: string;
  kind: CompetitorActionKind;
  title: string;
  summary: string;
  pressureDelta: number;
  supportImpact: number;
  mitigated: boolean;
}

/**
 * A server-validated, model-proposed competitor action.  It deliberately
 * excludes support impact and mitigation: both are derived from authoritative
 * game state after this candidate passes validation.
 */
export interface CompetitorStageActionCandidate {
  round: number;
  targetNpcId: CompetitorTargetNpcId;
  kind: CompetitorActionKind;
  title: string;
  summary: string;
  pressureDelta: number;
}

export interface CompetitorRuntimeState {
  name: string;
  pressureScore: number;
  position: CompetitivePosition;
  actions: CompetitorActionRecord[];
}

export interface CompetitorClaimRecord {
  id: string;
  npcId: string;
  stage: number;
  statement: string;
  truthStatus: 'unverified' | 'corroborated' | 'contradicted' | 'false';
}

export interface GamePublicResearchRecord {
  npcId: string;
  facts: string[];
  weakSignals: string[];
  sourceNote: string;
  completedRound: number;
  completedMinute: number;
  costPoints: number;
}

/**
 * Server-owned wall-clock budget for the project. `elapsedMs` only advances
 * while `visitPaused` is false; it is materialised by repository reads and
 * commits rather than by a browser interval.
 */
export interface ProjectTimerState {
  durationMs: number;
  elapsedMs: number;
  lastResumedAt: string | null;
  recoveredIntervals: number;
  visitPaused: boolean;
}

export interface PendingCustomerActivityDetection {
  conversationId: string;
  npcId: string;
  messages: CustomerActivityConversationMessage[];
  /** Frozen at the interaction boundary so detector retries never see newer metrics/config. */
  relationshipSnapshot: CustomerActivityRelationshipSnapshot;
  decisionConfig: ActivityDecisionConfig;
}

/** Bounded server-only trace of the formal activity matching pipeline. */
export interface CustomerActivityDiagnosticRecord {
  at: number;
  event: string;
  conversationId?: string;
  npcId?: string;
  activityType?: string;
  messageId?: string;
  reason?: string;
  details?: Record<string, string | number | boolean | null>;
  /** Present on queue events so later reviews can see the exact decision inputs. */
  relationshipSnapshot?: CustomerActivityRelationshipSnapshot;
  decisionConfig?: ActivityDecisionConfig;
}

export interface PlayerVisibleProjectTimer extends ProjectTimerState {
  remainingMs: number;
  expiresAt: string | null;
  isPaused: boolean;
  serverNow: string;
}

export const PROJECT_TIMER_DURATION_MS = 20 * 60 * 1000;
export const PROJECT_TIMER_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
export const PROJECT_TIMER_RECOVERY_ACTION_POINTS = 5;

export interface GameRuntimeState {
  scenarioCode: string;
  progressionMultiplier: number;
  currentRound: number;
  maxRounds: number;
  /** Authoritative names for the five-stage rules; round fields are save aliases. */
  currentStage: number;
  maxStages: number;
  gameMode: 'solo' | 'multiplayer';
  companyId: string;
  /** Shared-room concurrency token; distinct from the personal runtime version. */
  roomStageVersion?: number;
  knownPersonalInfo: Record<string, string[]>;
  actionPoints: number;
  status: 'playing' | 'won' | 'lost';
  dimensions: GameDimensions;
  /** Legacy mirror of npcAttitudes[npcId].support. */
  npcAffinity: Record<string, number>;
  unlockedNpcIds: string[];
  unlockedClues: ProjectOneClue[];
  conversationMemories: Record<string, ConversationMemory>;

  simulatedClockMinutes: number;
  dayAvailableMinutes: number;
  overtimeMinutes: number;
  cumulativeTimeMinutes: number;
  cumulativeSpentPoints: number;
  appointments: GameAppointment[];
  preparations: GamePreparation[];
  workPlans: GameWorkPlanRecord[];
  postalRecords: GamePostalRecord[];
  visitBriefs: GameVisitBriefRecord[];
  meetingMinutes: GameMeetingMinutes[];
  notifications: GameNotification[];
  npcAttitudes: Record<string, NpcAttitudeState>;
  /** Internal customer support matrix. Rival values are stripped from public snapshots. */
  supplierSupport: Partial<Record<SupplierId, Record<string, number>>>;
  /** Current procurement rule, shared by the game state and final outcome. */
  bidRule: BidRule;
  ruleProposalHistory: RuleProposalRecord[];
  overallSupportState: OverallSupportState;
  /** Safe supplier descriptions for player-facing screens. */
  supplierProfiles?: SupplierPublicProfile[];
  outcomeEvidence: OutcomeEvidenceLedger;
  complianceRisks: ComplianceRiskEvent[];
  publicResearch: Record<string, GamePublicResearchRecord>;
  competitorState: CompetitorRuntimeState;
  competitorClaims: CompetitorClaimRecord[];
  submissionReady: boolean;
  processedCommandIds: string[];
  projectTimer: ProjectTimerState;
  /** Internal activity evidence, drafts and numeric assessment; public snapshots project this separately. */
  customerActivities: CustomerActivityState;
  /** Ended conversations await authoritative AI detection; never exposed to the player. */
  customerActivityDetectionQueue: PendingCustomerActivityDetection[];
  /** Internal bounded diagnostic only; player projections must always strip it. */
  customerActivityDiagnostics?: CustomerActivityDiagnosticRecord[];

  /** Deprecated wall-clock fields retained while old persisted rows migrate. */
  phaseStartedAt: string;
  phaseEndsAt: string;
  pausedAt: string | null;
  pausedRemainingMs: number | null;
  npcContacts: Record<string, NpcContactState>;
  /** Server-owned active telephone conversation; never inferred from a client flag. */
  activePhoneCall?: { npcId: string; startedRound: number; startedAt: string } | null;
  activeMeeting: ActiveMeeting | null;
  lastAction: string | null;
  version: number;
}

export interface RelationshipAction {
  id: string;
  cost: number;
  affinityGain: number;
}

export interface RelationshipActionEffect {
  baseAffinityDelta: number;
  preferenceAffinityDelta: number;
  totalAffinityDelta: number;
}

export interface GameOutcome {
  fiveDimensionScore: number;
  publicValueScore: number;
  personalBenefitScore: number;
  decisionChainSupportScore: number;
  /** Compatibility alias for early UI work. */
  decisionChainSupport: number;
  baseScore: number;
  compliancePenalty: number;
  finalScore: number;
  won: boolean;
  eligible: boolean;
  supportByNpc: Record<string, number>;
  overallSupportState: OverallSupportState;
  supportBySupplier: Record<SupplierId, OverallSupportState>;
  bidRule: BidRule;
  ruleProposalHistory: RuleProposalRecord[];
  supplierResults: SupplierOutcomeSummary[];
  winnerSupplierId: SupplierId;
  winnerSupplierName: string;
  winnerReason: string;
  /** Legacy internal competitor pressure metric; deliberately omitted from JSON/player views. */
  competitorScore?: number;
  competitivePosition: CompetitivePosition;
}

/**
 * The procurement calculation deliberately remains server-owned.  A player
 * can see the winning supplier and each supplier's public core advantage, but
 * not the evaluation rule, rule-fit signal, private relationship scores, or
 * their derived support bands.
 */
export type PlayerVisibleSupplierOutcomeSummary = Pick<
  SupplierOutcomeSummary,
  'supplierId' | 'name' | 'coreAdvantage' | 'rank'
>;

export type PlayerVisibleGameOutcome = Omit<
  GameOutcome,
  | 'supportByNpc'
  | 'overallSupportState'
  | 'supportBySupplier'
  | 'decisionChainSupportScore'
  | 'decisionChainSupport'
  | 'supplierResults'
  | 'ruleProposalHistory'
  | 'bidRule'
> & {
  supplierResults: PlayerVisibleSupplierOutcomeSummary[];
};

/** Public session shape. Private relationship data never crosses a player API boundary. */
export type PlayerVisibleNpcExpression = 'angry' | 'serious' | 'calm' | 'pleasant' | 'very_happy';

export type PlayerVisibleGameState = Omit<
  GameRuntimeState,
  | 'npcAffinity'
  | 'npcAttitudes'
  | 'supplierSupport'
  | 'overallSupportState'
  | 'bidRule'
  | 'ruleProposalHistory'
  | 'customerActivities'
  | 'customerActivityDetectionQueue'
  | 'customerActivityDiagnostics'
> & {
  /** Five player-facing expressions derived from hidden relationship values. */
  npcExpressions: Record<string, PlayerVisibleNpcExpression>;
  projectTimer: PlayerVisibleProjectTimer;
  customerActivities: PublicCustomerActivityTask[];
};

export interface ExecuteGameCommandResult {
  state: GameRuntimeState;
  result: Record<string, unknown>;
  eventType: string;
  eventPayload: Record<string, unknown>;
}

/** Trusted server-side AI assessment for a gift command. Never accept it from client JSON. */
export interface GiftCommandEvaluation {
  disposition: GiftDisposition;
  pleasureDelta?: number;
  pleasantnessDelta?: number;
  supportDelta: number;
  severity: number;
  reason: string;
  riskReason: string;
  npcResponse: string;
  source: string;
}

export interface ExecuteGameCommandOptions {
  giftEvaluation?: GiftCommandEvaluation;
  /** Trusted server-side competitor proposal; invalid values use the normal deterministic fallback. */
  competitorStageAction?: CompetitorStageActionCandidate;
  competitorStageSource?: 'model' | 'fallback';
  /** Server-generated AI feedback; player input never supplies this. */
  workPlanEvaluation?: FormalPlanEvaluation;
  briefVisitEvaluation?: FormalBriefVisitEvaluation;
  visitPreparationEvaluation?: FormalVisitPreparationEvaluation;
}

/**
 * Internal result of the visit decision evaluator. It is deliberately not a
 * GameCommand payload: the active meeting identifies the NPC and state.ts
 * verifies that the evaluator can only complete an allowed, unfinished task.
 */
export interface TrustedMeetingTurnProgress {
  completedTask?: ProjectOneVisitTask | null;
  /** A validated explicit player farewell from the current dialogue turn. */
  playerFarewell?: boolean;
  /** A normal NPC farewell permits exactly one final player acknowledgement. */
  npcFarewell?: boolean;
  /** A validated immediate departure from the NPC's actual reply. */
  npcLeft?: boolean;
}

export const FORMAL_WORKFLOW_ACTION_POINTS = {
  workPlan: 1,
  postal: 2,
  briefVisit: 2,
  directVisit: 3,
  skipPreparationRisk: 0,
} as const;
export const FORMAL_ACTUAL_VISIT_MAX_TURNS = 20;

export const RELATIONSHIP_ACTIONS: Record<string, RelationshipAction> = {
  gift: { id: 'gift', cost: 5, affinityGain: 3 },
  dinner: { id: 'dinner', cost: 8, affinityGain: 5 },
  tea: { id: 'tea', cost: 6, affinityGain: 4 },
  festival: { id: 'festival', cost: 3, affinityGain: 2 },
  roadshow: { id: 'roadshow', cost: 10, affinityGain: 6 },
  visit: { id: 'visit', cost: 12, affinityGain: 7 },
  sample: { id: 'sample', cost: 4, affinityGain: 2 },
  video: { id: 'video', cost: 7, affinityGain: 4 },
};

export const OFFLINE_ACTION_IDS = new Set(['dinner', 'tea', 'roadshow', 'visit']);
const LEGACY_SIMULATION_MARKER = '2000-01-01T00:00:00.000Z';

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const clampDelta = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundScore = (value: number) => Math.round(clamp(value) * 10) / 10;

const DEFAULT_COMPETITOR_STATE: CompetitorRuntimeState = {
  name: 'ABC竞品',
  pressureScore: 52,
  position: 'close',
  actions: [],
};

const COMPETITOR_STAGE_ACTION_KINDS: Readonly<Record<number, readonly CompetitorActionKind[]>> = {
  1: ['relationship'],
  2: ['relationship', 'price'],
  3: ['price', 'case'],
  4: ['case', 'executive'],
  5: ['price', 'case', 'executive'],
};

const COMPETITOR_TARGETS_BY_KIND: Readonly<Record<CompetitorActionKind, readonly CompetitorTargetNpcId[]>> = {
  relationship: COMPETITOR_TARGET_NPC_IDS,
  price: ['P1-003', 'P1-002'],
  case: ['P1-004', 'P1-002', 'P1-001'],
  executive: ['P1-002', 'P1-001'],
};

const COMPETITOR_ACTIONS: CompetitorStageActionCandidate[] = [
  { round: 1, targetNpcId: 'P1-004', kind: 'relationship', title: '竞品正在接触项目执行人员', summary: '公开迹象显示，竞品正在强调既有合作经验并争取一线执行反馈。', pressureDelta: 3 },
  { round: 2, targetNpcId: 'P1-003', kind: 'price', title: '竞品释放价格攻势信号', summary: '招采侧出现竞品可能下调报价、强化商务条件的消息。', pressureDelta: 4 },
  { round: 3, targetNpcId: 'P1-002', kind: 'case', title: '竞品补充同类项目案例', summary: '竞品正在用同类案例证明交付确定性，项目经理可能重新比较方案风险。', pressureDelta: 4 },
  { round: 4, targetNpcId: 'P1-001', kind: 'executive', title: '竞品尝试推进高层沟通', summary: '竞品正在从组织成果和重点项目角度争取高层关注。', pressureDelta: 5 },
  { round: 5, targetNpcId: 'P1-003', kind: 'price', title: '竞品进入最终商务冲刺', summary: '临近决策，竞品正在集中强化价格、交付承诺与内部支持。', pressureDelta: 5 },
];

/**
 * Validate the small action protocol at the state boundary as well as in the
 * AI adapter.  This keeps direct reducer callers safe if they accidentally
 * pass an untrusted object instead of going through the API orchestration.
 */
export function isCompetitorStageActionCandidate(
  value: unknown,
  round?: number,
): value is CompetitorStageActionCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CompetitorStageActionCandidate>;
  const candidateRound = candidate.round;
  const candidateTarget = candidate.targetNpcId;
  const candidateKind = candidate.kind;
  const pressureDelta = candidate.pressureDelta;
  if (typeof candidateRound !== 'number' || !Number.isInteger(candidateRound) || candidateRound < 1 || candidateRound > PROJECT_ONE_MAX_ROUNDS) return false;
  if (round !== undefined && candidateRound !== round) return false;
  if (typeof candidateTarget !== 'string' || !COMPETITOR_TARGET_NPC_IDS.includes(candidateTarget as CompetitorTargetNpcId)) return false;
  if (typeof pressureDelta !== 'number' || !Number.isInteger(pressureDelta) || pressureDelta < 1 || pressureDelta > 6) return false;
  if (typeof candidate.title !== 'string' || candidate.title.trim().length < 1 || candidate.title.trim().length > 120) return false;
  if (typeof candidate.summary !== 'string' || candidate.summary.trim().length < 1 || candidate.summary.trim().length > 320) return false;
  if (typeof candidateKind !== 'string' || !Object.prototype.hasOwnProperty.call(COMPETITOR_TARGETS_BY_KIND, candidateKind)) return false;
  if (!COMPETITOR_STAGE_ACTION_KINDS[candidateRound]?.includes(candidateKind)) return false;
  return COMPETITOR_TARGETS_BY_KIND[candidateKind].includes(candidateTarget as CompetitorTargetNpcId);
}

function normalizeCompetitorState(value?: Partial<CompetitorRuntimeState>): CompetitorRuntimeState {
  return {
    ...DEFAULT_COMPETITOR_STATE,
    ...value,
    pressureScore: clamp(value?.pressureScore ?? DEFAULT_COMPETITOR_STATE.pressureScore),
    actions: value?.actions ?? [],
  };
}

function getPlayerSupplierId(state: Pick<GameRuntimeState, 'companyId'>): SupplierId {
  return PROJECT_ONE_SUPPLIERS.some((supplier) => supplier.id === state.companyId)
    ? state.companyId as SupplierId
    : 'player-company';
}

function normalizeSupplierSupport(
  existing: GameRuntimeState['supplierSupport'] | undefined,
  npcAttitudes: Record<string, NpcAttitudeState>,
  companyId: string,
): GameRuntimeState['supplierSupport'] {
  const playerSupplierId = getPlayerSupplierId({ companyId });
  return Object.fromEntries(PROJECT_ONE_SUPPLIERS.map((supplier) => [supplier.id,
    Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [
      npc.id,
      supplier.id === playerSupplierId
        ? npcAttitudes[npc.id]?.support ?? npc.initialSupport
        : clamp(existing?.[supplier.id]?.[npc.id] ?? supplier.initialSupportByNpc[npc.id] ?? 35),
    ])),
  ])) as GameRuntimeState['supplierSupport'];
}

function getSupplierSupportValues(
  state: Pick<GameRuntimeState, 'companyId' | 'npcAttitudes' | 'npcAffinity' | 'supplierSupport'>,
  supplierId: SupplierId,
) {
  const supplier = PROJECT_ONE_SUPPLIERS.find((item) => item.id === supplierId);
  return PROJECT_ONE_NPCS.map((npc) => ({
    support: supplierId === getPlayerSupplierId(state)
      ? state.npcAttitudes[npc.id]?.support ?? state.npcAffinity[npc.id] ?? npc.initialSupport
      : state.supplierSupport?.[supplierId]?.[npc.id] ?? supplier?.initialSupportByNpc[npc.id] ?? 35,
    weight: npc.decisionWeight,
  }));
}

export function calculateSupplierOverallSupportState(
  state: Pick<GameRuntimeState, 'companyId' | 'npcAttitudes' | 'npcAffinity' | 'supplierSupport'>,
  supplierId: SupplierId,
): OverallSupportState {
  return getOverallSupportBand(getSupplierSupportValues(state, supplierId));
}

function getSupplierAverageSupport(
  state: Pick<GameRuntimeState, 'companyId' | 'npcAttitudes' | 'npcAffinity' | 'supplierSupport'>,
  supplierId: SupplierId,
): number {
  return calculateWeightedSupport(getSupplierSupportValues(state, supplierId));
}

function applySupplierSupportDelta(
  state: GameRuntimeState,
  supplierId: SupplierId,
  npcId: string,
  delta: number,
): GameRuntimeState {
  const current = state.supplierSupport?.[supplierId]?.[npcId]
    ?? PROJECT_ONE_SUPPLIERS.find((supplier) => supplier.id === supplierId)?.initialSupportByNpc[npcId]
    ?? 35;
  return reconcileAutomaticBidRule({
    ...state,
    supplierSupport: {
      ...state.supplierSupport,
      [supplierId]: { ...state.supplierSupport?.[supplierId], [npcId]: clamp(current + delta) },
    },
  });
}

function reconcileAutomaticBidRule(state: GameRuntimeState): GameRuntimeState {
  const highSuppliers = PROJECT_ONE_SUPPLIERS
    .filter((supplier) => calculateSupplierOverallSupportState(state, supplier.id) === 'HIGH')
    .sort((left, right) => getSupplierAverageSupport(state, right.id) - getSupplierAverageSupport(state, left.id)
      || left.id.localeCompare(right.id));
  const playerSupplierId = getPlayerSupplierId(state);
  const playerSupportState = calculateSupplierOverallSupportState(state, playerSupplierId);
  if (!highSuppliers.length) {
    return state.overallSupportState === playerSupportState
      ? state
      : { ...state, overallSupportState: playerSupportState };
  }

  const leadingSupplier = highSuppliers[0];
  const nextState: GameRuntimeState = state.overallSupportState === playerSupportState
    ? state
    : { ...state, overallSupportState: playerSupportState };
  if (nextState.bidRule === leadingSupplier.preferredBidRule) return nextState;

  // This is internal project state.  Do not create a notification: the
  // direction may be disclosed only by an authorised NPC in a conversation.
  return {
    ...nextState,
    bidRule: leadingSupplier.preferredBidRule,
  };
}

function positionFromScores(playerScore: number, competitorScore: number): CompetitivePosition {
  const gap = playerScore - competitorScore;
  return gap >= 6 ? 'leading' : gap <= -6 ? 'lagging' : 'close';
}

function deriveUnlockedNpcIds(_unlockedClues: ProjectOneClue[]): string[] {
  // Project one exposes all five formal stakeholders from the beginning.
  // Keep the field for save compatibility, but it no longer represents a
  // narrative unlock gate.
  return PROJECT_ONE_NPCS.map((npc) => npc.id);
}

function defaultContact(npcId: string): NpcContactState {
  const npc = getProjectOneNpc(npcId);
  if (!npc) throw new Error('NPC_UNKNOWN');
  return {
    status: 'known',
    initialChannel: npc.initialContactChannel,
    onlineRequestedRound: null,
    unansweredRound: null,
    outboundCount: 0,
    hasReplied: false,
    lastContactRound: null,
    lastContactMinute: null,
    channelCooldownUntil: {},
    wechatStatus: 'not_requested',
    lastPhoneOutcome: null,
  };
}

function defaultAttitude(support = 35): NpcAttitudeState {
  return {
    pleasantness: 50,
    support: clamp(support),
    unmetImpression: 0,
    complianceAwareness: 0,
    history: [],
  };
}

/** Preserve only records produced by a completed public-search command. */
function normalizePublicResearchRecords(value: unknown): Record<string, GamePublicResearchRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, GamePublicResearchRecord>>((records, [npcId, raw]) => {
    if (!getProjectOneNpc(npcId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return records;
    const item = raw as Record<string, unknown>;
    const completedRound = item.completedRound;
    const completedMinute = item.completedMinute;
    const costPoints = item.costPoints;
    if (item.npcId !== npcId || !Array.isArray(item.facts) || !Array.isArray(item.weakSignals)
      || typeof item.sourceNote !== 'string' || typeof completedRound !== 'number' || !Number.isFinite(completedRound)
      || typeof completedMinute !== 'number' || !Number.isFinite(completedMinute)
      || typeof costPoints !== 'number' || !Number.isFinite(costPoints)) return records;
    records[npcId] = {
      npcId,
      facts: item.facts.filter((fact): fact is string => typeof fact === 'string').map((fact) => fact.slice(0, 500)).slice(0, 12),
      weakSignals: item.weakSignals.filter((signal): signal is string => typeof signal === 'string').map((signal) => signal.slice(0, 500)).slice(0, 12),
      sourceNote: item.sourceNote.slice(0, 500),
      completedRound: Math.max(1, Math.floor(completedRound)),
      completedMinute: Math.max(0, Math.floor(completedMinute)),
      costPoints: Math.max(0, Math.floor(costPoints)),
    };
    return records;
  }, {});
}

/** Competitor claims are player-heard NPC statements, never hidden actions. */
function normalizePlayerVisibleCompetitorClaims(value: unknown): CompetitorClaimRecord[] {
  if (!Array.isArray(value)) return [];
  const statuses = new Set<CompetitorClaimRecord['truthStatus']>(['unverified', 'corroborated', 'contradicted', 'false']);
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.npcId !== 'string' || typeof item.statement !== 'string'
      || typeof item.stage !== 'number' || !statuses.has(item.truthStatus as CompetitorClaimRecord['truthStatus'])
      || !getProjectOneNpc(item.npcId) || !item.id.trim() || !item.statement.trim()) return [];
    return [{
      id: item.id.slice(0, 160),
      npcId: item.npcId,
      stage: Math.max(1, Math.floor(item.stage)),
      statement: item.statement.slice(0, 500),
      truthStatus: item.truthStatus as CompetitorClaimRecord['truthStatus'],
    }];
  }).slice(-80);
}

type ProjectOneStateInput = Partial<GameRuntimeState> & Pick<
  GameRuntimeState,
  | 'scenarioCode'
  | 'currentRound'
  | 'maxRounds'
  | 'actionPoints'
  | 'status'
  | 'dimensions'
  | 'npcAffinity'
  | 'unlockedClues'
  | 'conversationMemories'
  | 'lastAction'
  | 'version'
>;

function normalizeProjectTimer(value: Partial<ProjectTimerState> | null | undefined): ProjectTimerState {
  return {
    durationMs: PROJECT_TIMER_DURATION_MS,
    elapsedMs: Math.min(PROJECT_TIMER_DURATION_MS, Math.max(0, Math.floor(value?.elapsedMs ?? 0))),
    lastResumedAt: typeof value?.lastResumedAt === 'string' && Number.isFinite(Date.parse(value.lastResumedAt))
      ? value.lastResumedAt
      : null,
    recoveredIntervals: Math.max(0, Math.floor(value?.recoveredIntervals ?? 0)),
    visitPaused: Boolean(value?.visitPaused),
  };
}

function freezeRelationshipSnapshot(
  npcId: string,
  npcAttitudes: Record<string, NpcAttitudeState>,
  npcAffinity: Record<string, number>,
  dimensions: GameDimensions,
  currentRound: number,
): CustomerActivityRelationshipSnapshot {
  const npc = getProjectOneNpc(npcId);
  if (!npc) throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
  const attitude = npcAttitudes[npcId];
  return {
    npcId,
    role: npc.category,
    title: npc.title,
    context: `${npc.personality}；主要关切：${npc.weakness}`.slice(0, 1_000),
    stage: getPhaseName(currentRound),
    support: Math.max(0, Math.min(100, Math.round(attitude?.support ?? npcAffinity[npcId] ?? npc.initialSupport))),
    pleasantness: Math.max(0, Math.min(100, Math.round(attitude?.pleasantness ?? 50))),
    dimensions: Object.fromEntries(GAME_DIMENSIONS.map((dimension) => [
      dimension,
      Math.max(0, Math.min(100, Math.round(dimensions[dimension]))),
    ])) as GameDimensions,
    organization: {
      members: CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((memberNpcId) => {
        const member = getProjectOneNpc(memberNpcId);
        if (!member) throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
        const memberAttitude = npcAttitudes[memberNpcId];
        return {
          npcId: memberNpcId,
          support: Math.max(0, Math.min(100, Math.round(
            memberAttitude?.support ?? npcAffinity[memberNpcId] ?? member.initialSupport,
          ))),
          pleasantness: Math.max(0, Math.min(100, Math.round(memberAttitude?.pleasantness ?? 50))),
        };
      }),
    },
  };
}

function normalizeRelationshipSnapshot(
  value: unknown,
  npcId: string,
  fallback: CustomerActivityRelationshipSnapshot,
): CustomerActivityRelationshipSnapshot {
  const legacyFallback = { ...fallback };
  delete legacyFallback.organization;
  if (value === undefined || value === null) return legacyFallback;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
  const item = value as Record<string, unknown>;
  const dimensions = item.dimensions;
  const organization = item.organization === undefined
    ? undefined
    : customerActivityOrganizationSnapshotSchema.safeParse(item.organization);
  if (item.npcId !== npcId || typeof item.role !== 'string' || !item.role.trim() || item.role.length > 200
    || (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 200))
    || (item.context !== undefined && (typeof item.context !== 'string' || item.context.length > 1_000))
    || !(item.stage === null || typeof item.stage === 'string' || (typeof item.stage === 'number' && Number.isFinite(item.stage)))
    || !Number.isInteger(item.support) || Number(item.support) < 0 || Number(item.support) > 100
    || !Number.isInteger(item.pleasantness) || Number(item.pleasantness) < 0 || Number(item.pleasantness) > 100
    || !dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)
    || (organization !== undefined && !organization.success)) {
    throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
  }
  const dimensionRecord = dimensions as Record<string, unknown>;
  const normalizedDimensions = {} as GameDimensions;
  for (const key of GAME_DIMENSIONS) {
    const score = dimensionRecord[key];
    if (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100) {
      throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
    }
    normalizedDimensions[key] = Number(score);
  }
  return {
    npcId,
    role: item.role,
    ...(typeof item.title === 'string' ? { title: item.title } : {}),
    ...(typeof item.context === 'string' ? { context: item.context } : {}),
    stage: item.stage as string | number | null,
    support: Number(item.support),
    pleasantness: Number(item.pleasantness),
    dimensions: normalizedDimensions,
    ...(organization?.success ? { organization: organization.data } : {}),
  };
}

function normalizeActivityDecisionConfig(value: unknown): ActivityDecisionConfig {
  if (value === undefined || value === null) return structuredClone(DEFAULT_ACTIVITY_DECISION_CONFIG);
  const parsed = parseActivityDecisionConfig(value);
  if (!parsed) throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
  return parsed;
}

function normalizeCustomerActivityDetectionQueue(
  value: unknown,
  fallbackForNpc: (npcId: string) => CustomerActivityRelationshipSnapshot,
): PendingCustomerActivityDetection[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
    }
    const item = candidate as Record<string, unknown>;
    if (typeof item.conversationId !== 'string' || !item.conversationId.trim() || item.conversationId.length > 200
      || typeof item.npcId !== 'string' || !getProjectOneNpc(item.npcId)
      || !Array.isArray(item.messages) || item.messages.length < 1
      || item.messages.length > CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES) {
      throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
    }
    const messageIds = new Set<string>();
    let totalLength = 0;
    const messages = item.messages.map((message) => {
      const parsed = customerActivityConversationMessageSchema.safeParse(message);
      if (!parsed.success || typeof (message as CustomerActivityConversationMessage)?.text !== 'string'
        || (message as CustomerActivityConversationMessage).text.length > 4_000
        || messageIds.has(parsed.data.messageId)) {
        throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
      }
      messageIds.add(parsed.data.messageId);
      totalLength += (message as CustomerActivityConversationMessage).text.length;
      // Keep source text byte-for-byte so detector quotes can be checked against
      // the actual transcript instead of a normalized copy.
      return { ...parsed.data, text: (message as CustomerActivityConversationMessage).text };
    });
    if (totalLength > CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH
      || !messages.some((message) => message.speaker === 'sales')) {
      throw new Error('INVALID_CUSTOMER_ACTIVITY_DETECTION_QUEUE');
    }
    return {
      conversationId: item.conversationId,
      npcId: item.npcId,
      messages,
      relationshipSnapshot: normalizeRelationshipSnapshot(item.relationshipSnapshot, item.npcId, fallbackForNpc(item.npcId)),
      decisionConfig: normalizeActivityDecisionConfig(item.decisionConfig),
    };
  });
}

const CUSTOMER_ACTIVITY_DIAGNOSTICS_LIMIT = 100;
const CUSTOMER_ACTIVITY_DIAGNOSTIC_DETAIL_KEYS = new Set([
  'detection_source', 'model_skipped_reason', 'response_kind', 'confidence', 'final_status',
  'candidate_count', 'threshold_decision', 'config_revision', 'provider', 'parse_code',
  'detection_error_code', 'decision_error_code', 'task_count', 'decision_mode', 'message_count', 'initiator',
  // AI callback fields are camel-cased; keep these explicit scalar fields while
  // continuing to reject arbitrary payload keys and transcript/model text.
  'responseKind', 'finalStatus',
]);

// Semantic review traces retain only fixed classifications and source offsets,
// never the reviewed reply, transcript, prompt, or arbitrary model reasoning.
const CUSTOMER_ACTIVITY_SEMANTIC_DETAIL_ENUMS: Record<string, ReadonlySet<string>> = {
  signal: new Set(['refusal', 'referral', 'commitment', 'disposition', 'appointment']),
  result: new Set(['allowed', 'violation', 'unclear', 'unavailable']),
  violation: new Set(['none', 'refusal', 'referral', 'commitment', 'missing_disposition', 'compliance', 'identity']),
  model_classification: new Set(['active', 'not_proposed', 'withdrawn', 'unclear']),
};
const CUSTOMER_ACTIVITY_SEMANTIC_DETAIL_INTEGERS = new Set([
  'evidence_start', 'evidence_end', 'withdrawal_message_count',
]);

function normalizeCustomerActivityDiagnostics(value: unknown): CustomerActivityDiagnosticRecord[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('INVALID_CUSTOMER_ACTIVITY_DIAGNOSTICS');
  return value.slice(-CUSTOMER_ACTIVITY_DIAGNOSTICS_LIMIT).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.event !== 'string' || item.event.length < 1 || item.event.length > 80) return [];
    const stringField = (key: string, maxLength: number): string | undefined =>
      typeof item[key] === 'string' && (item[key] as string).length <= maxLength ? item[key] as string : undefined;
    const rawDetails = item.details;
    const details: CustomerActivityDiagnosticRecord['details'] = {};
    if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
      for (const [key, detail] of Object.entries(rawDetails as Record<string, unknown>)) {
        if (CUSTOMER_ACTIVITY_SEMANTIC_DETAIL_ENUMS[key]) {
          if (typeof detail === 'string' && CUSTOMER_ACTIVITY_SEMANTIC_DETAIL_ENUMS[key].has(detail)) details[key] = detail;
          continue;
        }
        if (CUSTOMER_ACTIVITY_SEMANTIC_DETAIL_INTEGERS.has(key)) {
          if (typeof detail === 'number' && Number.isSafeInteger(detail) && detail >= 0 && detail <= 60_000) details[key] = detail;
          continue;
        }
        if (key === 'evidence_valid') {
          if (typeof detail === 'boolean') details[key] = detail;
          continue;
        }
        if (key === 'attempt') {
          if (detail === 0 || detail === 1) details[key] = detail;
          continue;
        }
        if (key === 'evidence_digest') {
          if (typeof detail === 'string' && /^[a-f0-9]{12}$/.test(detail)) details[key] = detail;
          continue;
        }
        if (key === 'withdrawal_message_id') {
          if (typeof detail === 'string' && detail.trim().length > 0 && detail.length <= 160) details[key] = detail;
          continue;
        }
        if (!CUSTOMER_ACTIVITY_DIAGNOSTIC_DETAIL_KEYS.has(key)) continue;
        if (typeof detail === 'boolean' || detail === null
          || (typeof detail === 'number' && Number.isFinite(detail))) details[key] = detail;
        else if (typeof detail === 'string' && detail.length <= 120) details[key] = detail;
      }
    }
    const relationshipSnapshot = item.relationshipSnapshot === undefined
      ? undefined
      : customerActivityRelationshipSnapshotSchema.safeParse(item.relationshipSnapshot);
    const decisionConfig = item.decisionConfig === undefined
      ? undefined
      : parseActivityDecisionConfig(item.decisionConfig);
    return [{
      at: Number.isSafeInteger(item.at) && Number(item.at) >= 0 ? Number(item.at) : 0,
      event: item.event,
      ...(stringField('conversationId', 200) ? { conversationId: stringField('conversationId', 200) } : {}),
      ...(stringField('npcId', 80) ? { npcId: stringField('npcId', 80) } : {}),
      ...(stringField('activityType', 80) ? { activityType: stringField('activityType', 80) } : {}),
      ...(stringField('messageId', 160) ? { messageId: stringField('messageId', 160) } : {}),
      ...(stringField('reason', 160) ? { reason: stringField('reason', 160) } : {}),
      ...(Object.keys(details).length ? { details } : {}),
      ...(relationshipSnapshot?.success ? { relationshipSnapshot: relationshipSnapshot.data } : {}),
      ...(decisionConfig ? { decisionConfig } : {}),
    }];
  });
}

/** Append a compact, private event without retaining transcript text or raw model output. */
export function appendCustomerActivityDiagnostic(
  state: GameRuntimeState,
  diagnostic: Omit<CustomerActivityDiagnosticRecord, 'at'> & { at?: number },
): GameRuntimeState {
  const normalized = normalizeCustomerActivityDiagnostics([{
    ...diagnostic,
    at: diagnostic.at ?? Date.now(),
  }]);
  if (normalized.length !== 1) return state;
  return {
    ...state,
    customerActivityDiagnostics: [...normalizeCustomerActivityDiagnostics(state.customerActivityDiagnostics), normalized[0]]
      .slice(-CUSTOMER_ACTIVITY_DIAGNOSTICS_LIMIT),
  };
}

/** A pure projection; callers may safely render it without persisting. */
export function getPlayerVisibleProjectTimer(state: GameRuntimeState, nowMs = Date.now()): PlayerVisibleProjectTimer {
  const timer = state.projectTimer;
  const runningElapsed = !timer.visitPaused && timer.lastResumedAt
    ? Math.max(0, nowMs - Date.parse(timer.lastResumedAt))
    : 0;
  const elapsedMs = Math.min(timer.durationMs, timer.elapsedMs + runningElapsed);
  const remainingMs = Math.max(0, timer.durationMs - elapsedMs);
  return {
    ...timer,
    elapsedMs,
    remainingMs,
    expiresAt: timer.visitPaused || !timer.lastResumedAt ? null : new Date(nowMs + remainingMs).toISOString(),
    isPaused: timer.visitPaused || !timer.lastResumedAt || state.status !== 'playing',
    serverNow: new Date(nowMs).toISOString(),
  };
}

/**
 * Reconcile elapsed wall time at a trusted server boundary. It intentionally
 * does not write on every client tick: callers persist only when its returned
 * state differs (a recovery boundary, pause/resume anchor, or settlement).
 */
export function synchronizeProjectTimer(state: GameRuntimeState, nowMs = Date.now(), materializeElapsed = false): GameRuntimeState {
  if (state.status !== 'playing') return state;
  const timer = normalizeProjectTimer(state.projectTimer);
  if (timer.elapsedMs >= timer.durationMs && hasUnsettledCustomerActivityEvaluations(state)) return state;
  if (timer.visitPaused) return state;
  const elapsedMs = Math.min(
    timer.durationMs,
    timer.elapsedMs + (timer.lastResumedAt ? Math.max(0, nowMs - Date.parse(timer.lastResumedAt)) : 0),
  );
  const reachedIntervals = Math.floor(elapsedMs / PROJECT_TIMER_RECOVERY_INTERVAL_MS);
  const recoveredIntervals = Math.max(timer.recoveredIntervals, reachedIntervals);
  const gained = Math.max(0, recoveredIntervals - timer.recoveredIntervals) * PROJECT_TIMER_RECOVERY_ACTION_POINTS;
  // A regular timer poll projects time from the persisted anchor. It must not
  // create a new version every few seconds; materialise only recovery edges,
  // expiry, or the one resume/migration anchor.
  const needsAnchor = !timer.lastResumedAt;
  const needsCheckpoint = materializeElapsed || needsAnchor || gained > 0 || elapsedMs >= timer.durationMs;
  if (!needsCheckpoint) return state;
  let next: GameRuntimeState = {
    ...state,
    actionPoints: Math.min(PROJECT_ONE_ACTION_POINT_CAP, state.actionPoints + gained),
    projectTimer: { ...timer, elapsedMs, recoveredIntervals, lastResumedAt: new Date(nowMs).toISOString() },
  };
  if (gained > 0) next = applyProjectTimerCheckpoints(next, timer.recoveredIntervals, recoveredIntervals);
  if (elapsedMs >= timer.durationMs) {
    // A visit can only cross the deadline when it closes and its dialogue cost
    // is applied. Settlement must never retain an interaction lock.
    next = submitGame({ ...next, activeMeeting: null, activePhoneCall: null }, 'project-timer-expired');
    next = { ...next, projectTimer: { ...next.projectTimer, elapsedMs: timer.durationMs, lastResumedAt: null, visitPaused: false } };
  }
  return next;
}

function resumeProjectTimerAfterVisit(state: GameRuntimeState, turnCount: number): GameRuntimeState {
  const timer = normalizeProjectTimer(state.projectTimer);
  const elapsedMs = Math.min(timer.durationMs, timer.elapsedMs + Math.max(0, turnCount) * 15_000);
  const recoveredIntervals = Math.max(timer.recoveredIntervals, Math.floor(elapsedMs / PROJECT_TIMER_RECOVERY_INTERVAL_MS));
  let next: GameRuntimeState = {
    ...state,
    actionPoints: Math.min(PROJECT_ONE_ACTION_POINT_CAP, state.actionPoints + (recoveredIntervals - timer.recoveredIntervals) * PROJECT_TIMER_RECOVERY_ACTION_POINTS),
    projectTimer: {
      ...timer,
      elapsedMs,
      recoveredIntervals,
      visitPaused: false,
      // The repository installs the trusted resume anchor as part of the same
      // atomic command commit, so reducers remain deterministic.
      lastResumedAt: null,
    },
  };
  if (recoveredIntervals > timer.recoveredIntervals) {
    next = applyProjectTimerCheckpoints(next, timer.recoveredIntervals, recoveredIntervals);
  }
  if (elapsedMs >= timer.durationMs) {
    next = submitGame({ ...next, activeMeeting: null, activePhoneCall: null }, 'project-timer-expired');
    next = { ...next, projectTimer: { ...next.projectTimer, elapsedMs: timer.durationMs, lastResumedAt: null, visitPaused: false } };
  }
  return next;
}

/**
 * World consequences formerly advanced on stages now occur once for each
 * elapsed five-minute checkpoint.  Keep compatibility rounds local to the
 * deterministic policy calculation, then restore their inert save aliases.
 */
function applyProjectTimerCheckpoints(state: GameRuntimeState, fromExclusive: number, toInclusive: number): GameRuntimeState {
  let next = state;
  for (let index = fromExclusive + 1; index <= toInclusive; index += 1) {
    const timeIndex = Math.min(PROJECT_ONE_MAX_ROUNDS, index);
    const compat = { ...next, currentRound: timeIndex, currentStage: timeIndex };
    const competitor = processCompetitorAction(compat);
    next = {
      ...processComplianceRisks(competitor.state, false, `timer:${index}`),
      currentRound: 1,
      currentStage: 1,
      maxRounds: 1,
      maxStages: 1,
    };
  }
  return next;
}

/** Pure legacy migration: no Date.now() and no wall-clock phase advancement. */
export function normalizeProjectOneState(state: ProjectOneStateInput): GameRuntimeState {
  const contacts = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => {
    const existing = state.npcContacts?.[npc.id];
    return [npc.id, {
      ...defaultContact(npc.id),
      ...existing,
      hasReplied: existing?.hasReplied ?? (existing ? existing.status !== 'known' : false),
      lastContactRound: existing?.lastContactRound ?? null,
      lastContactMinute: existing?.lastContactMinute ?? null,
      channelCooldownUntil: existing?.channelCooldownUntil ?? {},
      wechatStatus: existing?.wechatStatus ?? (existing?.status === 'online' ? 'accepted' : 'not_requested'),
      lastPhoneOutcome: existing?.lastPhoneOutcome ?? null,
    } satisfies NpcContactState];
  }));
  const npcAttitudes = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => {
    const existing = state.npcAttitudes?.[npc.id];
    const fallback = defaultAttitude(state.npcAffinity[npc.id] ?? npc.initialSupport);
    return [npc.id, {
      ...fallback,
      ...existing,
      history: existing?.history ?? [],
    } satisfies NpcAttitudeState];
  }));
  const npcAffinity = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [
    npc.id,
    npcAttitudes[npc.id].support,
  ]));
  const companyId = state.companyId ?? 'player-company';
  const candidateBidRule = (state as Partial<GameRuntimeState>).bidRule;
  const customerActivities = readCustomerActivityState(state.customerActivities);
  const hasPlanningActivity = customerActivities.tasks.some((task) => task.status === 'planning');
  const customerActivityDetectionQueue = normalizeCustomerActivityDetectionQueue(
    state.customerActivityDetectionQueue,
    (npcId) => freezeRelationshipSnapshot(npcId, npcAttitudes, npcAffinity, state.dimensions, state.currentStage ?? state.currentRound),
  );
  const customerActivityDiagnostics = normalizeCustomerActivityDiagnostics(state.customerActivityDiagnostics);
  const normalized: GameRuntimeState = {
    ...state,
    progressionMultiplier: state.progressionMultiplier ?? 1,
    // Stage fields remain stable save/audit aliases. New progression is driven
    // exclusively by projectTimer, never by a client-controlled phase.
    currentRound: 1,
    maxRounds: 1,
    currentStage: 1,
    maxStages: 1,
    gameMode: state.gameMode ?? 'solo',
    companyId,
    roomStageVersion: state.gameMode === 'multiplayer'
      ? Math.max(1, Math.floor(state.roomStageVersion ?? 1))
      : undefined,
    knownPersonalInfo: state.knownPersonalInfo ?? PROJECT_ONE_COMPANY_PERSONAL_INFO[state.companyId ?? 'player-company'] ?? {},
    unlockedNpcIds: deriveUnlockedNpcIds(state.unlockedClues ?? []),
    simulatedClockMinutes: PROJECT_ONE_DAY_START_MINUTE,
    dayAvailableMinutes: 0,
    overtimeMinutes: 0,
    cumulativeTimeMinutes: 0,
    cumulativeSpentPoints: Math.max(0, state.cumulativeSpentPoints ?? 0),
    appointments: state.appointments ?? [],
    preparations: state.preparations ?? [],
    workPlans: state.workPlans ?? [],
    postalRecords: state.postalRecords ?? [],
    visitBriefs: state.visitBriefs ?? [],
    meetingMinutes: (state.meetingMinutes ?? []).map((minutes) => ({
      ...minutes,
      endReason: minutes.endReason ?? 'completed',
      completedTasks: minutes.completedTasks ?? [],
    })),
    notifications: state.notifications ?? [],
    npcAttitudes,
    npcAffinity,
    supplierSupport: normalizeSupplierSupport(state.supplierSupport, npcAttitudes, companyId),
    bidRule: candidateBidRule && Object.prototype.hasOwnProperty.call(BID_RULES, candidateBidRule) ? candidateBidRule : 'balanced',
    ruleProposalHistory: (state.ruleProposalHistory ?? []).map((record) => ({
      ...record,
      // Saves created before natural-language proposals retain their audit
      // record, without inventing player wording.
      proposalText: record.proposalText ?? '',
    })),
    overallSupportState: 'LOW',
    supplierProfiles: PROJECT_ONE_SUPPLIERS.map(({ id, name, advantageType, coreAdvantage, preferredBidRule }) => ({
      id: id as SupplierId,
      name,
      advantageType,
      coreAdvantage,
      preferredBidRule,
    })),
    outcomeEvidence: state.outcomeEvidence ?? { publicValue: [], personalBenefit: [] },
    complianceRisks: state.complianceRisks ?? [],
    publicResearch: normalizePublicResearchRecords(state.publicResearch),
    competitorState: normalizeCompetitorState(state.competitorState),
    competitorClaims: normalizePlayerVisibleCompetitorClaims(state.competitorClaims),
    submissionReady: false,
    processedCommandIds: state.processedCommandIds ?? [],
    customerActivities,
    customerActivityDetectionQueue,
    customerActivityDiagnostics,
    projectTimer: {
      ...normalizeProjectTimer(state.projectTimer),
      // A pre-timer save may already be inside a visit. Preserve that lock on
      // migration rather than silently starting the countdown on reload.
      visitPaused: state.status === 'playing' && (Boolean(state.activeMeeting) || hasPlanningActivity || Boolean(state.projectTimer?.visitPaused)),
      lastResumedAt: state.status !== 'playing' || state.activeMeeting || hasPlanningActivity ? null : normalizeProjectTimer(state.projectTimer).lastResumedAt,
    },
    phaseStartedAt: LEGACY_SIMULATION_MARKER,
    phaseEndsAt: LEGACY_SIMULATION_MARKER,
    pausedAt: null,
    pausedRemainingMs: null,
    npcContacts: contacts,
    // A legacy save could contain both modes. The active visit owns the
    // interaction boundary, so discard its stale phone flag during recovery.
    activePhoneCall: state.status === 'playing' && !state.activeMeeting && state.activePhoneCall && state.activePhoneCall.startedRound === (state.currentStage ?? state.currentRound)
      && getProjectOneNpc(state.activePhoneCall.npcId)
      ? state.activePhoneCall
      : null,
    activeMeeting: state.status === 'playing' && state.activeMeeting ? normalizeActiveMeeting(state.activeMeeting) : null,
  };
  return reconcileAutomaticBidRule(normalized);
}

function normalizeActiveMeeting(meeting: ActiveMeeting): ActiveMeeting {
  const legacyAction = meeting.actionId;
  const visitType: VisitType = meeting.visitType ?? (legacyAction === 'tea' || legacyAction === 'dinner' ? 'informal' : 'formal');
  const rules = PROJECT_ONE_VISIT_RULES[visitType];
  return {
    ...meeting,
    appointmentId: meeting.appointmentId ?? meeting.id,
    visitType,
    maxTurns: Math.max(FORMAL_ACTUAL_VISIT_MAX_TURNS, meeting.maxTurns ?? rules.maxTurns),
    durationMinutes: meeting.durationMinutes ?? rules.durationMinutes,
    workTopicOpenedBy: meeting.workTopicOpenedBy ?? null,
    usedPreparationIds: meeting.usedPreparationIds ?? [],
    completedTasks: meeting.completedTasks ?? [],
    awaitingFinalReplyFrom: meeting.awaitingFinalReplyFrom === 'player' ? 'player' : undefined,
  };
}

export function explicitlyRevealsMinister(replyContent: string): boolean {
  // Kept as a legacy export for callers that still use this helper name.  Its
  // semantic target is now the formal project manager, not the deleted person.
  if (!replyContent.includes('李明辉')) return false;
  return /项目.{0,8}李明辉.{0,4}经理|李明辉.{0,6}(项目|经理)|李经理|项目经理/.test(replyContent);
}

export function reconcileNarrativeDiscoveries(state: GameRuntimeState, assistantReplies: string[]): GameRuntimeState {
  // All five formal NPCs are visible from the beginning, so dialogue never
  // mutates the formal roster or replays a legacy discovery event.
  void assistantReplies;
  return { ...state, unlockedNpcIds: deriveUnlockedNpcIds(state.unlockedClues) };
}

export function createProjectOneState(progressionMultiplier = 1, _legacyNow?: number): GameRuntimeState {
  const initial: ProjectOneStateInput = {
    scenarioCode: PROJECT_ONE_CODE,
    progressionMultiplier,
    currentRound: 1,
    maxRounds: PROJECT_ONE_MAX_ROUNDS,
    actionPoints: PROJECT_ONE_INITIAL_ACTION_POINTS,
    status: 'playing',
    dimensions: {
      decisionAnalysis: 50,
      relationshipBuilding: 50,
      valuePresentation: 50,
      objectionHandling: 50,
      informationDiscovery: 50,
    },
    npcAffinity: Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, npc.initialSupport])),
    unlockedNpcIds: PROJECT_ONE_NPCS.map((npc) => npc.id),
    unlockedClues: [],
    conversationMemories: {},
    npcContacts: Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, defaultContact(npc.id)])),
    projectTimer: {
      durationMs: PROJECT_TIMER_DURATION_MS,
      elapsedMs: 0,
      lastResumedAt: new Date().toISOString(),
      recoveredIntervals: 0,
      visitPaused: false,
    },
    customerActivities: createEmptyCustomerActivityState(),
    customerActivityDetectionQueue: [],
    customerActivityDiagnostics: [],
    lastAction: null,
    version: 1,
  };
  return normalizeProjectOneState(initial);
}

/**
 * New saves have one free-text preparation type. These helpers deliberately
 * keep the old preparation types readable for migration, while making it
 * impossible for an old material or gift row to become a new interaction.
 */
export function isCurrentPreparationType(type: string): type is 'visit_preparation' {
  return type === 'visit_preparation';
}

function cleanPreparationText(value: string, maxLength = 500): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function labeledPreparationValue(text: string, labels: string[]): string | null {
  const pattern = new RegExp(`(?:${labels.join('|')})\\s*[：:]\\s*([^\\n。；;]+)`, 'i');
  const match = text.match(pattern);
  return match?.[1] ? cleanPreparationText(match[1]) : null;
}

function preparationSegments(text: string): string[] {
  return text
    .split(/[\n。；;！!？?]+/)
    .map((segment) => cleanPreparationText(segment))
    .filter(Boolean);
}

function findPreparationSegment(segments: string[], patterns: RegExp[]): string | null {
  return segments.find((segment) => patterns.some((pattern) => pattern.test(segment))) ?? null;
}

/**
 * Extracts the five preparation dimensions using deterministic labels and
 * keyword fallbacks. This is intentionally independent of the AI provider;
 * the resulting brief is only a structured explanation of the player's own
 * text and is never treated as an NPC fact.
 */
export function extractPreparationBrief(content: string, npcId: string): PreparationBrief {
  const text = cleanPreparationText(content, 4000);
  const segments = preparationSegments(content);
  const npc = getProjectOneNpc(npcId);
  const explicitAudience = labeledPreparationValue(text, ['目标人物', '目标对象', '对象', '受众', '给谁看', '面向']);
  const audienceBase = npc ? `${npc.name}（${npc.title}）` : npcId;
  const audience = explicitAudience && !explicitAudience.includes(npc?.name ?? npcId)
    ? `${audienceBase}；玩家补充对象：${explicitAudience}`
    : audienceBase;

  const explicitProblem = labeledPreparationValue(text, ['客户问题', '问题', '痛点', '现状', '风险', '要解决']);
  const problemSource = explicitProblem ?? findPreparationSegment(segments, [
    /问题|痛点|现状|风险|困难|瓶颈|负担|顾虑|重复录入|确认成本/,
  ]);
  const problem = problemSource ?? '在会面中核实客户当前问题、风险与优先级';

  const explicitDimensions = labeledPreparationValue(text, ['解决方案', '方案', '维度', '重点', '方向', '措施']);
  const dimensionsSource = explicitDimensions ?? findPreparationSegment(segments, [
    /方案|维度|重点|方向|措施|价值|流程|实施|交付|技术|成本|报价|服务|系统/,
  ]);
  const dimensions = dimensionsSource ?? '围绕客户问题确认解决方案、实施与价值维度';

  const explicitEvidence = labeledPreparationValue(text, ['证据', '依据', '案例', '数据', '材料', '报告', '证明', '验证', '测算']);
  const evidenceSource = explicitEvidence ?? findPreparationSegment(segments, [
    /证据|依据|案例|数据|材料|报告|证明|验证|测算|清单|记录|测试|演示/,
  ]);
  const evidence = evidenceSource ?? '补充可核验的案例、数据、材料或交付记录';

  const explicitNextStep = labeledPreparationValue(text, ['下一步', '后续', '跟进', '行动', '安排', '确认', '引荐', '约定']);
  const nextStepSource = explicitNextStep ?? findPreparationSegment(segments, [
    /下一步|后续|跟进|行动|安排|确认|引荐|约定|回访|对接/,
  ]);
  const nextStep = nextStepSource ?? '确认责任人与下一步沟通安排';

  const semanticTags: PreparationSemanticTag[] = ['target_person'];
  if (problemSource) semanticTags.push('customer_problem');
  if (dimensionsSource) semanticTags.push('solution_or_dimension');
  if (evidenceSource) semanticTags.push('evidence');
  if (nextStepSource) semanticTags.push('next_step');

  return { audience, problem, dimensions, evidence, nextStep, semanticTags };
}

/** Require at least three independent semantic signals in addition to the
 * server-known target person before a new preparation becomes usable. */
export function hasReliablePreparationSemantics(brief: PreparationBrief): boolean {
  const contentTags = (brief.semanticTags ?? []).filter((tag) => tag !== 'target_person');
  return brief.audience.trim().length > 0 && new Set(contentTags).size >= 3;
}

export function calculateTotalScore(dimensions: GameDimensions): number {
  const total = GAME_DIMENSIONS.reduce((sum, key) => sum + dimensions[key], 0);
  return Math.round(total / GAME_DIMENSIONS.length);
}

function appendEvidence(
  ledger: OutcomeEvidenceLedger,
  category: keyof OutcomeEvidenceLedger,
  items: OutcomeEvidenceItem[],
): OutcomeEvidenceLedger {
  // An NPC statement represents one outcome.  Prevent both historical saves
  // and a malformed evaluator payload from charging it to two score buckets.
  const existing = new Set(
    [...ledger.publicValue, ...ledger.personalBenefit]
      .map((item) => `${item.npcId}:${item.statement.trim()}`),
  );
  const additions = items.filter((item) => {
    const key = `${item.npcId}:${item.statement.trim()}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  return {
    ...ledger,
    [category]: [...ledger[category], ...additions].slice(-40),
  };
}

export interface NpcAttitudeDelta {
  pleasantnessDelta?: number;
  supportDelta?: number;
  unmetImpressionDelta?: number;
  complianceAwarenessDelta?: number;
  reason: string;
  source?: string;
  allowBoundaryGiftRange?: boolean;
}

export function applyNpcAttitudeDelta(
  state: GameRuntimeState,
  npcId: string,
  delta: NpcAttitudeDelta,
): GameRuntimeState {
  const current = state.npcAttitudes[npcId] ?? defaultAttitude(state.npcAffinity[npcId] ?? 35);
  const pleasantLimit = delta.allowBoundaryGiftRange ? 15 : 10;
  const supportLimit = delta.allowBoundaryGiftRange ? 10 : 8;
  const pleasantnessDelta = clampDelta(Math.round(delta.pleasantnessDelta ?? 0), -pleasantLimit, pleasantLimit);
  const supportDelta = clampDelta(Math.round(delta.supportDelta ?? 0), -supportLimit, supportLimit);
  const next: NpcAttitudeState = {
    pleasantness: clamp(current.pleasantness + pleasantnessDelta),
    support: clamp(current.support + supportDelta),
    unmetImpression: clamp(current.unmetImpression + clampDelta(Math.round(delta.unmetImpressionDelta ?? 0), -5, 5), -100, 100),
    complianceAwareness: clamp(current.complianceAwareness + clampDelta(Math.round(delta.complianceAwarenessDelta ?? 0), -10, 20)),
    history: [...current.history, {
      round: state.currentRound,
      minute: state.simulatedClockMinutes,
      pleasantnessDelta,
      supportDelta,
      reason: delta.reason,
      source: delta.source ?? 'system',
    }].slice(-40),
  };
  const playerSupplierId = getPlayerSupplierId(state);
  const nextState: GameRuntimeState = {
    ...state,
    npcAttitudes: { ...state.npcAttitudes, [npcId]: next },
    npcAffinity: { ...state.npcAffinity, [npcId]: next.support },
    supplierSupport: {
      ...state.supplierSupport,
      [playerSupplierId]: { ...state.supplierSupport?.[playerSupplierId], [npcId]: next.support },
    },
  };
  return reconcileAutomaticBidRule(nextState);
}

export function isCustomerActivityPlanning(state: GameRuntimeState): boolean {
  return readCustomerActivityState(state.customerActivities).tasks.some((task) => task.status === 'planning');
}

export function hasUnsettledCustomerActivityEvaluations(state: GameRuntimeState): boolean {
  return readCustomerActivityState(state.customerActivities).tasks.some((task) => task.status === 'submitted' && !task.evaluation);
}

export function isCustomerActivityBlockingGameActions(state: GameRuntimeState): boolean {
  return isCustomerActivityPlanning(state) || hasUnsettledCustomerActivityEvaluations(state);
}

/** Queue an ended conversation in the same versioned write that closes it. */
export function queueCustomerActivityDetection(
  state: GameRuntimeState,
  request: Omit<PendingCustomerActivityDetection, 'relationshipSnapshot' | 'decisionConfig'>
    & Partial<Pick<PendingCustomerActivityDetection, 'relationshipSnapshot' | 'decisionConfig'>>,
): GameRuntimeState {
  if (state.customerActivityDetectionQueue.some((item) => item.conversationId === request.conversationId)) {
    return appendCustomerActivityDiagnostic(state, {
      event: 'duplicate_queue', conversationId: request.conversationId, npcId: request.npcId,
      reason: 'conversation_already_queued',
    });
  }
  const fallbackForNpc = (npcId: string) => freezeRelationshipSnapshot(
    npcId,
    state.npcAttitudes,
    state.npcAffinity,
    state.dimensions,
    state.currentStage ?? state.currentRound,
  );
  const frozenSnapshot = fallbackForNpc(request.npcId);
  const queue = normalizeCustomerActivityDetectionQueue([...state.customerActivityDetectionQueue, {
    ...request,
    relationshipSnapshot: {
      ...(request.relationshipSnapshot ?? frozenSnapshot),
      // The organization-wide score is always captured from this authoritative
      // state at the conversation boundary, never trusted from a caller.
      organization: frozenSnapshot.organization,
    },
    decisionConfig: request.decisionConfig ?? DEFAULT_ACTIVITY_DECISION_CONFIG,
  }], fallbackForNpc);
  const next = { ...state, customerActivityDetectionQueue: queue };
  return appendCustomerActivityDiagnostic(next, {
    event: 'conversation_queued',
    conversationId: request.conversationId,
    npcId: request.npcId,
    relationshipSnapshot: queue.at(-1)!.relationshipSnapshot,
    decisionConfig: queue.at(-1)!.decisionConfig,
  });
}

/** Atomically records resolved proposals and clears the retryable ended-conversation queue item. */
export function completeCustomerActivityProposalDetection(
  state: GameRuntimeState,
  conversationId: string,
  resolutions: Array<{ candidate: CustomerActivityProposalCandidate; decision: CustomerActivityFeasibilityDecision }>,
  serverNow: number,
  options: { keepQueue?: boolean } = {},
): GameRuntimeState {
  const request = state.customerActivityDetectionQueue.find((item) => item.conversationId === conversationId);
  if (!request) return state;
  let customerActivities = readCustomerActivityState(state.customerActivities);
  for (const { candidate, decision } of resolutions) {
    if (candidate.conversationId !== request.conversationId || candidate.npcId !== request.npcId) {
      throw new Error('CUSTOMER_ACTIVITY_DECISION_SOURCE_MISMATCH');
    }
    if (customerActivities.decisions.some((item) => item.npcId === candidate.npcId
      && item.type === candidate.type && item.proposalMessageId === candidate.proposalMessageId)) continue;
    const recorded = recordCustomerActivityProposalDecision(
      customerActivities,
      candidate,
      request.relationshipSnapshot,
      request.decisionConfig,
      decision,
      serverNow,
    );
    if (!recorded.recorded) throw new Error('CUSTOMER_ACTIVITY_DECISION_INVALID');
    customerActivities = recorded.state;
  }
  return {
    ...state,
    customerActivities,
    customerActivityDetectionQueue: options.keepQueue
      ? state.customerActivityDetectionQueue
      : state.customerActivityDetectionQueue.filter((item) => item.conversationId !== conversationId),
  };
}

/** Freeze the project budget at the trusted server start of an activity plan. */
export function pauseProjectTimerForCustomerActivity(state: GameRuntimeState, nowMs = Date.now()): GameRuntimeState {
  const checkpointed = synchronizeProjectTimer(state, nowMs, true);
  if (checkpointed.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (checkpointed.activeMeeting || checkpointed.activePhoneCall) throw new Error('INTERACTION_ALREADY_ACTIVE');
  return {
    ...checkpointed,
    projectTimer: { ...checkpointed.projectTimer, visitPaused: true, lastResumedAt: null },
  };
}

/** Resume at the server submission/deadline timestamp, so time after timeout counts on reload. */
export function resumeProjectTimerAfterCustomerActivity(state: GameRuntimeState, resumedAtMs: number): GameRuntimeState {
  if (!Number.isFinite(resumedAtMs) || resumedAtMs < 0) throw new Error('ACTIVITY_TIMESTAMP_INVALID');
  return {
    ...state,
    projectTimer: {
      ...state.projectTimer,
      visitPaused: false,
      lastResumedAt: new Date(resumedAtMs).toISOString(),
    },
  };
}

/** Applies the existing relationship and five-dimension indicators once with the activity evaluation marker. */
export function applyCustomerActivityEvaluation(
  state: GameRuntimeState,
  taskId: string,
  evaluation: CustomerActivityEvaluation,
  serverNow: number,
): GameRuntimeState {
  const recorded = recordCustomerActivityEvaluation(state.customerActivities, taskId, evaluation, serverNow);
  if (!recorded.applied) return state;
  const task = recorded.state.tasks.find((item) => item.id === taskId);
  if (!task) return state;
  const dimensions = Object.fromEntries(GAME_DIMENSIONS.map((key) => [
    key,
    clamp(state.dimensions[key] + evaluation.dimensionDeltas[key] * state.progressionMultiplier),
  ])) as GameDimensions;
  return applyNpcAttitudeDelta({ ...state, dimensions, customerActivities: recorded.state }, task.npcId, {
    supportDelta: evaluation.supportDelta * state.progressionMultiplier,
    pleasantnessDelta: evaluation.pleasureDelta * state.progressionMultiplier,
    reason: evaluation.overallEvaluation,
    source: `customer_activity:${taskId}`,
  });
}

type ExtendedNpcEvaluation = NpcTurnEvaluation & {
  pleasureDelta?: number;
  pleasantnessDelta?: number;
  supportDelta?: number;
  unmetImpressionDelta?: number;
  complianceAwarenessDelta?: number;
  /** Accept pre-contract save data only at this in-memory compatibility edge. */
  publicValueEvidence?: Array<string | { statement: string; strength?: number }>;
  personalBenefitEvidence?: Array<string | { statement: string; strength?: number }>;
  workTopicOpenedBy?: 'none' | 'player' | 'npc' | null;
};

function normalizeEvidenceItems(
  npcId: string,
  round: number,
  category: 'public' | 'personal',
  raw: Array<string | { statement: string; strength?: number }>,
): OutcomeEvidenceItem[] {
  return raw.slice(0, 4).map((item, index) => {
    const statement = typeof item === 'string' ? item : item.statement;
    const strength = typeof item === 'string' ? 2 : clamp(Math.round(item.strength ?? 2), 1, 5);
    return {
      id: `${npcId}:${round}:${category}:${index}:${statement.slice(0, 24)}`,
      npcId,
      statement,
      strength,
      source: 'ai_confirmed' as const,
      confirmedRound: round,
    };
  }).filter((item) => item.statement.trim().length > 0);
}

export function applyNpcEvaluation(
  state: GameRuntimeState,
  npcId: string,
  evaluation: NpcTurnEvaluation,
  replyContent: string | null = null,
  channel?: ContactChannel,
): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (!state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_LOCKED');
  // Evaluation output is untrusted until each ledger-bearing claim is found
  // verbatim in the NPC reply generated for this command.  Keep this second
  // check here even though the evaluator parses it too: persistence is the
  // authority boundary and callers can invoke this function directly.
  const sourcedEvaluation = verifyNpcEvaluationSources(evaluation, replyContent ?? '');
  let next = state;
  const activePhoneTurn = channel === 'work_phone' && next.activePhoneCall?.npcId === npcId;
  if (channel && channel !== 'offline' && !activePhoneTurn) next = consumeCommunicationTime(next, channel);

  const dimensions = { ...next.dimensions };
  for (const key of GAME_DIMENSIONS) {
    dimensions[key] = clamp(dimensions[key] + sourcedEvaluation.dimensionDeltas[key] * next.progressionMultiplier);
  }

  const extended = sourcedEvaluation as ExtendedNpcEvaluation;
  const supportDelta = (extended.supportDelta ?? sourcedEvaluation.affinityDelta) * next.progressionMultiplier;
  const pleasantnessDelta = (extended.pleasureDelta ?? extended.pleasantnessDelta ?? sourcedEvaluation.affinityDelta) * next.progressionMultiplier;
  next = applyNpcAttitudeDelta({ ...next, dimensions }, npcId, {
    pleasantnessDelta,
    supportDelta,
    unmetImpressionDelta: extended.unmetImpressionDelta,
    complianceAwarenessDelta: extended.complianceAwarenessDelta,
    reason: sourcedEvaluation.affinityReason,
    source: 'ai_evaluation',
  });

  const acceptedClues: ProjectOneClue[] = sourcedEvaluation.cluesUnlocked.filter(
    (clue) => clue !== 'personal_interest' || (next.npcAttitudes[npcId]?.support ?? 0) >= 50,
  );
  // key_contact used to unlock Chen Jianguo. D-024 removes that gate; do not
  // let model text create a legacy unlock clue.
  void replyContent;
  const unlockedClues = Array.from(new Set([...next.unlockedClues, ...acceptedClues]));
  const memory = next.conversationMemories[npcId] ?? { summary: '', summarizedMessageCount: 0 };
  const confirmedFacts = Array.from(new Set([...(memory.confirmedFacts ?? []), ...sourcedEvaluation.confirmedFacts])).slice(-12);
  const commitments = Array.from(new Set([...(memory.commitments ?? []), ...sourcedEvaluation.commitments])).slice(-12);
  let outcomeEvidence = next.outcomeEvidence;
  const publicRaw = extended.publicValueEvidence ?? sourcedEvaluation.confirmedFacts
    .filter((fact) => /预算|回报|风险|合规|落地|效率|绩效|组织|成本/.test(fact));
  const personalRaw = extended.personalBenefitEvidence ?? sourcedEvaluation.confirmedFacts
    .filter((fact) => /减负|晋升|职业|声誉|成长|安全|个人绩效/.test(fact));
  outcomeEvidence = appendEvidence(outcomeEvidence, 'publicValue', normalizeEvidenceItems(npcId, next.currentRound, 'public', publicRaw));
  outcomeEvidence = appendEvidence(outcomeEvidence, 'personalBenefit', normalizeEvidenceItems(npcId, next.currentRound, 'personal', personalRaw));

  const activeMeeting = next.activeMeeting
    && next.activeMeeting.npcId === npcId
    && extended.workTopicOpenedBy
    && extended.workTopicOpenedBy !== 'none'
    ? { ...next.activeMeeting, workTopicOpenedBy: next.activeMeeting.workTopicOpenedBy ?? extended.workTopicOpenedBy }
    : next.activeMeeting;

  const competitorClaims = /竞品|ABC|其他厂商/.test(replyContent ?? '')
    ? [...next.competitorClaims, {
      id: `claim:${npcId}:${next.currentRound}:${next.competitorClaims.length + 1}`,
      npcId,
      stage: next.currentRound,
      statement: (replyContent ?? '').slice(0, 500),
      truthStatus: 'unverified' as const,
    }].slice(-80)
    : next.competitorClaims;
  return {
    ...next,
    unlockedClues,
    unlockedNpcIds: deriveUnlockedNpcIds(unlockedClues),
    conversationMemories: {
      ...next.conversationMemories,
      [npcId]: { ...memory, confirmedFacts, commitments },
    },
    outcomeEvidence,
    competitorClaims,
    activeMeeting,
  };
}

/** Applies a one-hop reputation handoff without exposing another NPC's chat. */
export function applyIndirectImpression(
  state: GameRuntimeState,
  targetNpcId: string,
  originalDelta: number,
  reason: string,
  sourceNpcId: string,
  sourceEventId: string,
): GameRuntimeState {
  const attitude = state.npcAttitudes[targetNpcId];
  if (!attitude) throw new Error('NPC_UNKNOWN');
  const sourceKey = `indirect:${sourceEventId}`;
  if (attitude.history.some((item) => item.source === sourceKey)) return state;
  const hasMet = state.appointments.some((appointment) =>
    appointment.npcId === targetNpcId && ['active', 'completed'].includes(appointment.status));
  return applyNpcAttitudeDelta(state, targetNpcId, {
    unmetImpressionDelta: hasMet ? 0 : clampDelta(Math.round(originalDelta * 0.5), -3, 3),
    supportDelta: hasMet ? clampDelta(Math.round(originalDelta * 0.25), -2, 2) : 0,
    reason: `${sourceNpcId}转述：${reason}`,
    source: sourceKey,
  });
}

export interface ConsumeGameTimeOptions {
  pointCost?: number;
  countAsInvested?: boolean;
  allowOvertime?: boolean;
  allowDuringMeeting?: boolean;
  ignoreAppointmentId?: string;
}

/**
 * Pure action-point charging. `minutes` remains in the signature so old
 * commands and saves can be migrated without making time a gameplay limit.
 */
export function consumeGameTime(
  state: GameRuntimeState,
  minutes: number,
  options: ConsumeGameTimeOptions = {},
): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (state.activeMeeting && !options.allowDuringMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('TIME_AMOUNT_INVALID');
  const pointCost = options.pointCost ?? 0;
  if (state.actionPoints < pointCost) throw new Error('ACTION_POINTS_INSUFFICIENT');

  return {
    ...state,
    simulatedClockMinutes: PROJECT_ONE_DAY_START_MINUTE,
    dayAvailableMinutes: 0,
    overtimeMinutes: 0,
    cumulativeTimeMinutes: 0,
    actionPoints: state.actionPoints - pointCost,
    cumulativeSpentPoints: state.cumulativeSpentPoints + pointCost,
  };
}

function chargeOvertimeMinutes(state: GameRuntimeState, minutes: number): GameRuntimeState {
  if (minutes <= 0) return state;
  const nextOvertime = state.overtimeMinutes + minutes;
  if (nextOvertime > PROJECT_ONE_OVERTIME_END_MINUTE - PROJECT_ONE_WORK_END_MINUTE) throw new Error('OVERTIME_LIMIT_EXCEEDED');
  const pointCost = Math.max(0, Math.ceil(nextOvertime / 30) - Math.ceil(state.overtimeMinutes / 30));
  if (state.actionPoints < pointCost) throw new Error('ACTION_POINTS_INSUFFICIENT');
  return {
    ...state,
    overtimeMinutes: nextOvertime,
    actionPoints: state.actionPoints - pointCost,
    cumulativeSpentPoints: state.cumulativeSpentPoints + pointCost,
  };
}

export function consumeCommunicationTime(state: GameRuntimeState, channel: CommunicationChannel): GameRuntimeState {
  return consumeGameTime(state, PROJECT_ONE_COMMUNICATION_MINUTES[channel], {
    pointCost: PROJECT_ONE_COMMUNICATION_POINTS[channel],
  });
}

/** Cost preflight for one written chat action; attachments cost once per send. */
export function consumeChatCommunicationTime(
  state: GameRuntimeState,
  channel: CommunicationChannel,
  hasAttachments: boolean,
): GameRuntimeState {
  const communicated = consumeCommunicationTime(state, channel);
  return hasAttachments ? consumeGameTime(communicated, 0, { pointCost: 1 }) : communicated;
}

function advanceClockWithoutInvestment(state: GameRuntimeState, minutes: number): GameRuntimeState {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('TIME_AMOUNT_INVALID');
  const nextMinute = state.simulatedClockMinutes + minutes;
  if (nextMinute > PROJECT_ONE_EVENING_END_MINUTE) throw new Error('DAY_CLOCK_LIMIT_EXCEEDED');
  return advanceIdleClockTo(state, nextMinute);
}

function getAppointmentTravelMinutes(): number {
  // Dedicated/drop-in describes the invitation posture, not a second activity
  // on the calendar. Visit duration is determined solely by visitType.
  return 0;
}

function getAppointmentDepartureMinute(appointment: Pick<GameAppointment, 'invitationMethod' | 'startMinute'>): number {
  return appointment.startMinute - getAppointmentTravelMinutes();
}

export function getAppointmentHospitalityCost(
  appointment: Pick<GameAppointment, 'visitType' | 'venue'>,
): number {
  if (appointment.visitType !== 'informal') return 0;
  return /餐|饭|酒|宴|dinner|banquet/i.test(appointment.venue) ? 8 : 6;
}

function advanceIdleClockTo(
  state: GameRuntimeState,
  targetMinute: number,
  ignoreAppointmentId?: string,
): GameRuntimeState {
  if (!Number.isInteger(targetMinute) || targetMinute < state.simulatedClockMinutes) throw new Error('TIME_AMOUNT_INVALID');
  if (targetMinute > PROJECT_ONE_EVENING_END_MINUTE) throw new Error('DAY_CLOCK_LIMIT_EXCEEDED');
  const reconciled = reconcileMissedAppointments(
    { ...state, simulatedClockMinutes: targetMinute },
    ignoreAppointmentId,
  );
  const skippedDaytimeMinutes = Math.max(0,
    Math.min(targetMinute, PROJECT_ONE_WORK_END_MINUTE)
    - Math.max(state.simulatedClockMinutes, PROJECT_ONE_DAY_START_MINUTE));
  return {
    ...reconciled,
    dayAvailableMinutes: Math.max(0, reconciled.dayAvailableMinutes - skippedDaytimeMinutes),
  };
}

function reconcileMissedAppointments(state: GameRuntimeState, ignoreAppointmentId?: string): GameRuntimeState {
  const missed = state.appointments.filter((appointment) =>
    appointment.id !== ignoreAppointmentId
    &&
    appointment.status === 'accepted'
    && appointment.scheduledRound === state.currentRound
    && getAppointmentDepartureMinute(appointment) < state.simulatedClockMinutes);
  if (!missed.length) return state;
  const missedIds = new Set(missed.map((appointment) => appointment.id));
  const releasedMinutes = missed.reduce((sum, appointment) => sum + appointment.reservedMinutes, 0);
  const notifications = [...state.notifications, ...missed.map((appointment) => ({
    id: `missed:${appointment.id}`,
    npcId: appointment.npcId,
    kind: 'appointment' as const,
    title: '已错过预约',
    body: '约定时间已经过去，本次拜访记为爽约。',
    round: state.currentRound,
    minute: state.simulatedClockMinutes,
    isRead: false,
    targetId: appointment.id,
  }))];
  let next = state;
  for (const appointment of missed) {
    next = applyNpcAttitudeDelta(next, appointment.npcId, {
      pleasantnessDelta: -5,
      supportDelta: -4,
      reason: '预约未赴约，客户对履约可靠性产生疑虑',
      source: `missed:${appointment.id}`,
    });
  }
  return {
    ...next,
    dayAvailableMinutes: Math.min(PROJECT_ONE_STANDARD_DAY_MINUTES, state.dayAvailableMinutes + releasedMinutes),
    appointments: next.appointments.map((appointment) => missedIds.has(appointment.id)
      ? { ...appointment, status: 'missed' as const, reservedMinutes: 0 }
      : appointment),
    notifications,
  };
}

export function applyRelationshipAction(state: GameRuntimeState, npcId: string, actionId: string): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (!state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_LOCKED');
  if (state.npcContacts[npcId]?.status !== 'online') throw new Error('ONLINE_CONTACT_REQUIRED');
  if (state.activeMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
  const action = RELATIONSHIP_ACTIONS[actionId];
  if (!action) throw new Error('ACTION_UNKNOWN');
  const offline = OFFLINE_ACTION_IDS.has(actionId);
  const visitType: VisitType = actionId === 'tea' || actionId === 'dinner' ? 'informal' : 'formal';
  const duration = offline ? PROJECT_ONE_VISIT_RULES[visitType].durationMinutes : 10;
  let next = consumeGameTime(state, duration, { pointCost: action.cost });
  const effect = getRelationshipActionEffect(npcId, actionId, state.progressionMultiplier);
  next = applyNpcAttitudeDelta(next, npcId, {
    pleasantnessDelta: effect.totalAffinityDelta,
    supportDelta: Math.round(effect.totalAffinityDelta / 2),
    reason: `兼容关系动作：${actionId}`,
    source: 'legacy_relationship_action',
  });
  if (!offline) return { ...next, lastAction: actionId };
  const id = `legacy:${npcId}:${state.currentRound}:${state.version + 1}`;
  const rules = PROJECT_ONE_VISIT_RULES[visitType];
  const appointment: GameAppointment = {
    id,
    npcId,
    invitationMethod: 'dedicated',
    visitType,
    venue: visitType === 'informal' ? '非正式场合' : '办公室',
    purpose: actionId,
    scheduledRound: state.currentRound,
    startMinute: state.simulatedClockMinutes,
    durationMinutes: rules.durationMinutes,
    maxTurns: rules.maxTurns,
    status: 'active',
    conditions: [],
    reservedMinutes: 0,
    workTopicOpenedBy: null,
    invitationCommandId: id,
  };
  return {
    ...next,
    appointments: [...next.appointments, appointment],
    activeMeeting: {
      id,
      npcId,
      actionId,
      appointmentId: id,
      visitType,
      turnCount: 0,
      maxTurns: FORMAL_ACTUAL_VISIT_MAX_TURNS,
      durationMinutes: rules.durationMinutes,
      startedAt: `round:${state.currentRound}:minute:${state.simulatedClockMinutes}`,
      workTopicOpenedBy: null,
      usedPreparationIds: [],
      completedTasks: [],
    },
    lastAction: actionId,
  };
}

export function replenishActionPoints(state: GameRuntimeState, amount: number): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (!Number.isInteger(amount) || amount < 1 || amount > 999) throw new Error('ACTION_POINTS_AMOUNT_INVALID');
  return { ...state, actionPoints: state.actionPoints + amount };
}

export function getRelationshipActionEffect(npcId: string, actionId: string, progressionMultiplier = 1): RelationshipActionEffect {
  const action = RELATIONSHIP_ACTIONS[actionId];
  if (!action) throw new Error('ACTION_UNKNOWN');
  const npc = getProjectOneNpc(npcId);
  if (!npc) throw new Error('NPC_UNKNOWN');
  const preferenceAffinityDelta = npc.actionPreferences[actionId] ?? 0;
  return {
    baseAffinityDelta: action.affinityGain * progressionMultiplier,
    preferenceAffinityDelta: preferenceAffinityDelta * progressionMultiplier,
    totalAffinityDelta: (action.affinityGain + preferenceAffinityDelta) * progressionMultiplier,
  };
}

export function getPhaseName(round: number): string {
  return PROJECT_ONE_PHASE_NAMES[Math.max(0, Math.min(PROJECT_ONE_PHASE_NAMES.length - 1, round - 1))];
}

function calculateEvidenceScore(items: OutcomeEvidenceItem[], multiplier: number): number {
  return roundScore(items.reduce((sum, item) => sum + clamp(item.strength, 1, 5) * multiplier, 0));
}

export function getGameOutcome(state: GameRuntimeState): GameOutcome {
  const fiveDimensionScore = calculateTotalScore(state.dimensions);
  const publicValueScore = calculateEvidenceScore(state.outcomeEvidence.publicValue, 12);
  const personalBenefitScore = calculateEvidenceScore(state.outcomeEvidence.personalBenefit, 15);
  const supportByNpc = Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [
    npc.id,
    state.npcAttitudes[npc.id]?.support ?? state.npcAffinity[npc.id] ?? 35,
  ]));
  const decisionChainSupportScore = roundScore(PROJECT_ONE_NPCS.reduce((sum, npc) =>
    sum + (state.npcAttitudes[npc.id]?.support ?? state.npcAffinity[npc.id] ?? 35) * npc.decisionWeight, 0));
  const baseScore = Math.round((
    fiveDimensionScore * 0.4
    + publicValueScore * 0.3
    + personalBenefitScore * 0.2
    + decisionChainSupportScore * 0.1
  ) * 10) / 10;
  const compliancePenalty = Math.min(30, state.complianceRisks
    .filter((risk) => risk.status === 'triggered')
    .reduce((sum, risk) => sum + Math.max(0, risk.penalty), 0));
  const finalScore = Math.max(0, Math.round((baseScore - compliancePenalty) * 10) / 10);
  const playerSupplierId = getPlayerSupplierId(state);
  const supportBySupplier = Object.fromEntries(PROJECT_ONE_SUPPLIERS.map((supplier) => [
    supplier.id,
    calculateSupplierOverallSupportState(state, supplier.id),
  ])) as Record<SupplierId, OverallSupportState>;
  const candidates = PROJECT_ONE_SUPPLIERS.map((supplier) => {
    const supportAverage = getSupplierAverageSupport(state, supplier.id);
    const isPlayer = supplier.id === playerSupplierId;
    // The player's established sales/value/compliance result remains its base.
    // Competitors use scenario competitiveness, with ABC stage pressure retained.
    const baseCompetitiveness = isPlayer
      ? finalScore
      : supplier.baseCompetitivenessScore + (supplier.id === 'abc-company'
        ? (state.competitorState?.pressureScore ?? DEFAULT_COMPETITOR_STATE.pressureScore) - DEFAULT_COMPETITOR_STATE.pressureScore
        : 0);
    const supportScore = (supportAverage - 50) * 0.3;
    const ruleMatchScore = getRuleMatchScore(supplier, state.bidRule);
    const score = roundScore(baseCompetitiveness + supportScore + ruleMatchScore);
    const ruleFit = getRuleFit(supplier, state.bidRule);
    const supportState = supportBySupplier[supplier.id];
    const reason = `${SUPPORT_STATE_LABELS[supportState]}；${BID_RULES[state.bidRule].label}与${supplier.coreAdvantage}的匹配度${ruleFit === 'strong' ? '高' : ruleFit === 'neutral' ? '一般' : '低'}`;
    return { supplier, supportAverage, supportState, ruleMatchScore, ruleFit, score, reason };
  }).sort((left, right) =>
    right.score - left.score
    || right.supportAverage - left.supportAverage
    || right.ruleMatchScore - left.ruleMatchScore
    || left.supplier.id.localeCompare(right.supplier.id));
  const winner = candidates[0];
  const won = winner.supplier.id === playerSupplierId;
  const playerCandidate = candidates.find((candidate) => candidate.supplier.id === playerSupplierId)!;
  const strongestCompetitor = candidates.find((candidate) => candidate.supplier.id !== playerSupplierId);
  const competitivePosition = strongestCompetitor
    ? positionFromScores(playerCandidate.score, strongestCompetitor.score)
    : 'leading';
  const supplierResults: SupplierOutcomeSummary[] = candidates.map((candidate, index) => ({
    supplierId: candidate.supplier.id as SupplierId,
    name: candidate.supplier.name,
    coreAdvantage: candidate.supplier.coreAdvantage,
    overallSupportState: candidate.supportState,
    ruleFit: candidate.ruleFit,
    rank: index + 1,
    reason: candidate.reason,
  }));
  const winnerReason = `综合基础竞争力、客户支持和规则匹配后，${winner.supplier.name}排名第一。其客户支持为${SUPPORT_STATE_LABELS[winner.supportState]}，最终规则为「${BID_RULES[state.bidRule].label}」，核心优势是${winner.supplier.coreAdvantage}。`;
  const outcome: GameOutcome = {
    fiveDimensionScore,
    publicValueScore,
    personalBenefitScore,
    decisionChainSupportScore,
    decisionChainSupport: decisionChainSupportScore,
    baseScore,
    compliancePenalty,
    finalScore,
    won,
    eligible: won,
    supportByNpc,
    overallSupportState: supportBySupplier[playerSupplierId],
    supportBySupplier,
    bidRule: state.bidRule,
    ruleProposalHistory: state.ruleProposalHistory,
    supplierResults,
    winnerSupplierId: winner.supplier.id as SupplierId,
    winnerSupplierName: winner.supplier.name,
    winnerReason,
    competitivePosition,
  };
  // Preserve the old in-process pressure value for server callers while keeping
  // it out of API JSON and player-visible result objects.
  Object.defineProperty(outcome, 'competitorScore', {
    value: roundScore(state.competitorState?.pressureScore ?? DEFAULT_COMPETITOR_STATE.pressureScore),
    enumerable: false,
  });
  return outcome;
}

function refreshCompetitivePosition(state: GameRuntimeState): GameRuntimeState {
  const position = getGameOutcome(state).competitivePosition;
  return state.competitorState.position === position
    ? state
    : { ...state, competitorState: { ...state.competitorState, position } };
}

function processCompetitorAction(
  state: GameRuntimeState,
  proposedAction?: CompetitorStageActionCandidate,
): { state: GameRuntimeState; action: CompetitorActionRecord | null } {
  const fallback = COMPETITOR_ACTIONS.find((item) => item.round === state.currentRound);
  const template = isCompetitorStageActionCandidate(proposedAction, state.currentRound) ? proposedAction : fallback;
  if (!template || state.competitorState.actions.some((item) => item.round === state.currentRound)) {
    return { state, action: null };
  }
  const researched = Boolean(state.publicResearch[template.targetNpcId]);
  const completedVisit = state.appointments.some((item) => item.npcId === template.targetNpcId && item.status === 'completed');
  const usedMaterial = state.preparations.some((item) => item.npcId === template.targetNpcId && item.usedCount > 0);
  const mitigationCount = Number(researched) + Number(completedVisit) + Number(usedMaterial);
  const supportImpact = -Math.max(0, 3 - mitigationCount);
  const pressureDelta = Math.max(1, template.pressureDelta - mitigationCount);
  const action: CompetitorActionRecord = {
    ...template,
    id: `competitor:${state.currentRound}:${template.kind}`,
    supportImpact,
    pressureDelta,
    mitigated: mitigationCount > 0,
  };
  let next = supportImpact === 0 ? state : applyNpcAttitudeDelta(state, template.targetNpcId, {
    supportDelta: supportImpact,
    reason: `竞品${template.title.replace('竞品', '')}`,
    source: action.id,
  });
  next = applySupplierSupportDelta(next, 'abc-company', template.targetNpcId, Math.max(0, 3 - mitigationCount));
  next = {
    ...next,
    competitorState: {
      ...next.competitorState,
      pressureScore: clamp(next.competitorState.pressureScore + pressureDelta),
      actions: [...next.competitorState.actions, action],
    },
  };
  return { state: refreshCompetitivePosition(next), action };
}

export function getWinConditions(state: GameRuntimeState) {
  const outcome = getGameOutcome(state);
  return {
    ...outcome,
    totalScore: outcome.finalScore,
    hasDecisionClue: state.unlockedClues.includes('decision_process'),
    keyAffinity: state.npcAttitudes['P1-001']?.support ?? state.npcAffinity['P1-001'] ?? 0,
  };
}

function playerVisibleNpcExpression(pleasantness: number): PlayerVisibleNpcExpression {
  if (pleasantness <= 19) return 'angry';
  if (pleasantness <= 39) return 'serious';
  if (pleasantness <= 59) return 'calm';
  if (pleasantness <= 79) return 'pleasant';
  return 'very_happy';
}

/** Never serialize hidden competitor progress or AI stage actions to a player. */
export function toPlayerVisibleGameState(state: GameRuntimeState): PlayerVisibleGameState {
  const playerState = { ...state } as Partial<GameRuntimeState>;
  delete playerState.npcAffinity;
  delete playerState.npcAttitudes;
  delete playerState.supplierSupport;
  delete playerState.overallSupportState;
  delete playerState.bidRule;
  delete playerState.ruleProposalHistory;
  delete playerState.customerActivities;
  delete playerState.customerActivityDetectionQueue;
  delete playerState.customerActivityDiagnostics;
  return {
    ...playerState,
    projectTimer: getPlayerVisibleProjectTimer(state),
    customerActivities: readCustomerActivityState(state.customerActivities).tasks.map(toPublicCustomerActivityTask),
    npcExpressions: Object.fromEntries(Object.entries(state.npcAttitudes)
      .map(([npcId, attitude]) => [npcId, playerVisibleNpcExpression(attitude.pleasantness)])),
    // These records represent public facts the player explicitly searched;
    // never synthesize profiles for people whose search was not completed.
    publicResearch: normalizePublicResearchRecords(state.publicResearch),
    // Claims are NPC statements already heard by the player. Hidden competitor
    // pressure, position and stage actions remain in competitorState/actions.
    competitorClaims: normalizePlayerVisibleCompetitorClaims(state.competitorClaims),
    supplierProfiles: PROJECT_ONE_SUPPLIERS.map(({ id, name, advantageType, coreAdvantage, preferredBidRule }) => ({
      id: id as SupplierId,
      name,
      advantageType,
      coreAdvantage,
      preferredBidRule,
    })),
    competitorState: {
      name: state.competitorState.name,
      pressureScore: 0,
      position: 'close',
      actions: [],
    },
  } as PlayerVisibleGameState;
}

/**
 * Final settlement still uses relationship support internally. This serializer
 * exposes the decision without exposing the internal procurement rule, any
 * support score/band, or proposal history. Rule detail is available only from
 * an authorised NPC conversation during the project.
 */
export function toPlayerVisibleGameOutcome(outcome: GameOutcome): PlayerVisibleGameOutcome {
  return {
    fiveDimensionScore: outcome.fiveDimensionScore,
    publicValueScore: outcome.publicValueScore,
    personalBenefitScore: outcome.personalBenefitScore,
    baseScore: outcome.baseScore,
    compliancePenalty: outcome.compliancePenalty,
    finalScore: outcome.finalScore,
    won: outcome.won,
    eligible: outcome.eligible,
    supplierResults: outcome.supplierResults.map(({ supplierId, name, coreAdvantage, rank }) => ({
      supplierId,
      name,
      coreAdvantage,
      rank,
    })),
    winnerSupplierId: outcome.winnerSupplierId,
    winnerSupplierName: outcome.winnerSupplierName,
    winnerReason: `综合方案表现、客户意见和最终评审方向后，${outcome.winnerSupplierName}排名第一。其核心优势是${outcome.supplierResults.find((item) => item.supplierId === outcome.winnerSupplierId)?.coreAdvantage ?? '已记录方案优势'}。`,
    competitivePosition: outcome.competitivePosition,
  };
}

/** Strip relationship-only fields from command responses before returning them to a player. */
export function toPlayerVisibleGameCommandResult(result: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...result };
  const outcome = rest.outcome;
  delete rest.overallSupportState;
  delete rest.supportByNpc;
  delete rest.supportBySupplier;
  delete rest.decisionChainSupport;
  delete rest.decisionChainSupportScore;
  // These are procurement-internal facts during play. The only player-facing
  // acknowledgement is that their wording has been recorded for the contact.
  delete rest.bidRule;
  delete rest.accepted;
  delete rest.reason;
  delete rest.proposalText;
  delete rest.outcome;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return rest;
  return { ...rest, outcome: toPlayerVisibleGameOutcome(outcome as GameOutcome) };
}

function proposeBidRule(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'propose_bid_rule' }>,
): { state: GameRuntimeState; result: Record<string, unknown> } {
  const { targetContactId: npcId, proposalText } = command.payload;
  const interpretation = interpretBidRuleProposal(proposalText);
  // Never silently select a direction for the player. Invalid or ambiguous
  // prose fails before any action point is consumed.
  if (!interpretation) throw new Error('PROPOSAL_DIRECTION_UNCLEAR');
  const { bidRule } = interpretation;
  if (!state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_LOCKED');
  const meetingTarget = state.activeMeeting?.npcId === npcId;
  if (state.activeMeeting && !meetingTarget) throw new Error('PROPOSAL_NPC_NOT_IN_MEETING');
  if (!meetingTarget && state.npcContacts[npcId]?.status === 'known') throw new Error('NPC_NOT_CONNECTED');
  const access = getProcurementRuleAccess(npcId);
  if (!access.canModify || !access.allowedRules.includes(bidRule)) throw new Error('NPC_RULE_AUTHORITY_REQUIRED');
  if (state.ruleProposalHistory.some((record) => record.npcId === npcId && record.bidRule === bidRule)) {
    throw new Error('RULE_PROPOSAL_ALREADY_MADE');
  }
  const npc = getProjectOneNpc(npcId);
  if (!npc) throw new Error('NPC_UNKNOWN');
  const playerSupplierId = getPlayerSupplierId(state);
  const playerProfile = PROJECT_ONE_SUPPLIERS.find((supplier) => supplier.id === playerSupplierId);
  if (!playerProfile) throw new Error('SUPPLIER_UNKNOWN');

  let next = consumeGameTime(state, 0, { pointCost: BID_RULE_PROPOSAL_COST, allowDuringMeeting: meetingTarget });
  const overallSupportState = calculateSupplierOverallSupportState(next, playerSupplierId);
  const targetSupport = next.npcAttitudes[npcId]?.support ?? next.npcAffinity[npcId] ?? npc.initialSupport;
  const averageSupport = getSupplierAverageSupport(next, playerSupplierId);
  const alignedWithAdvantage = bidRule === playerProfile.preferredBidRule;
  let accepted = false;
  let reason = '';
  if (overallSupportState === 'LOW') {
    reason = '对方认为当前没有必要调整评价标准，建议暂未被采纳。';
  } else if (!alignedWithAdvantage) {
    reason = `客户认为该建议与我方“${playerProfile.coreAdvantage}”的价值方向不够一致，暂未采纳。`;
  } else if (overallSupportState === 'HIGH') {
    accepted = targetSupport >= 50;
    reason = accepted
      ? '客户愿意沿着我方优势完善评价标准。'
      : '该关键人物仍需要更多合作证据，暂未支持这项建议。';
  } else if (overallSupportState === 'MID_HIGH') {
    accepted = npc.decisionWeight >= 0.18 && targetSupport >= 55 && averageSupport >= 50;
    reason = accepted
      ? '关键人物认可建议方向，客户决定将该项纳入本次招标评价标准。'
      : '关键人物认为还需要更多支持证据，暂未推动该建议进入招标标准。';
  } else {
    accepted = npc.decisionWeight >= 0.24 && targetSupport >= 72 && averageSupport >= 35;
    reason = accepted
      ? '关键决策人明确支持该建议，客户决定将该项纳入本次招标评价标准。'
      : '客户内部意见尚未统一，这项建议暂未通过。';
  }

  const record: RuleProposalRecord = {
    id: `bid-rule-proposal:${command.commandId}`,
    supplierId: playerSupplierId,
    npcId,
    bidRule,
    proposalText: interpretation.proposalText,
    round: next.currentRound,
    accepted,
    reason,
  };
  next = {
    ...next,
    ...(accepted ? { bidRule } : {}),
    ruleProposalHistory: [...next.ruleProposalHistory, record],
  };
  next = reconcileAutomaticBidRule(next);
  return {
    state: next,
    result: {
      // The UI may acknowledge receipt but cannot learn whether the rule was
      // accepted or what the active evaluation direction is.
      recorded: true,
    },
  };
}

function processComplianceRisks(state: GameRuntimeState, finalAudit = false, probabilitySeed = 'legacy-audit'): GameRuntimeState {
  let next = state;
  const risks = state.complianceRisks.map((risk) => {
    if (risk.status !== 'latent') return risk;
    const chance = Math.min(90, risk.severity * 12 + (finalAudit ? 15 : 0));
    if (!shouldNpcRespond(`${probabilitySeed}:${risk.id}:audit:${state.currentRound}:${finalAudit}`, chance)) return risk;
    next = applyNpcAttitudeDelta(next, risk.npcId, {
      pleasantnessDelta: -Math.min(10, risk.severity * 2),
      supportDelta: -Math.min(8, risk.severity * 2),
      complianceAwarenessDelta: 15,
      reason: '边界礼品风险暴露',
      source: 'compliance_audit',
      allowBoundaryGiftRange: true,
    });
    return { ...risk, status: 'triggered' as const, triggerRound: state.currentRound };
  });
  const newlyTriggered = risks.filter((risk, index) => risk.status === 'triggered' && state.complianceRisks[index]?.status === 'latent');
  return {
    ...next,
    complianceRisks: risks,
    notifications: [...next.notifications, ...newlyTriggered.map((risk) => ({
      id: `compliance:${risk.id}:${state.currentRound}`,
      npcId: risk.npcId,
      kind: 'compliance' as const,
      title: '合规风险暴露',
      body: risk.reason,
      round: state.currentRound,
      minute: state.simulatedClockMinutes,
      isRead: false,
      targetId: risk.id,
    }))],
  };
}

export function submitGame(state: GameRuntimeState, probabilitySeed = 'legacy-submit'): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  if (state.activeMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
  if (hasUnsettledCustomerActivityEvaluations(state)) return state;
  const audited = processComplianceRisks(state, true, probabilitySeed);
  const outcome = getGameOutcome(audited);
  return refreshCompetitivePosition({
    ...audited,
    status: outcome.eligible ? 'won' : 'lost',
    submissionReady: false,
    activeMeeting: null,
    activePhoneCall: null,
    projectTimer: { ...audited.projectTimer, visitPaused: false, lastResumedAt: null },
    lastAction: null,
  });
}

/** @deprecated Simulated time naturally stops when the player does not act. */
export function pauseGame(state: GameRuntimeState, _legacyNow?: number): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  return state;
}

/** @deprecated Simulated time naturally stops when the player does not act. */
export function resumeGame(state: GameRuntimeState, _legacyNow?: number): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  return state;
}

export function connectNpc(state: GameRuntimeState, npcId: string): GameRuntimeState {
  const contact = state.npcContacts[npcId];
  if (!contact) throw new Error('NPC_UNKNOWN');
  return {
    ...state,
    npcContacts: {
      ...state.npcContacts,
      [npcId]: {
        ...contact,
        status: contact.status === 'online' ? 'online' : 'connected',
        hasReplied: true,
        unansweredRound: null,
        lastContactRound: state.currentRound,
        lastContactMinute: state.simulatedClockMinutes,
      },
    },
  };
}

export function markNpcUnanswered(state: GameRuntimeState, npcId: string, channel?: CommunicationChannel): GameRuntimeState {
  const contact = state.npcContacts[npcId];
  if (!contact) throw new Error('NPC_UNKNOWN');
  const selectedChannel = channel ?? contact.initialChannel;
  const cooldownMinutes = PROJECT_ONE_COMMUNICATION_MINUTES[selectedChannel];
  return {
    ...state,
    npcContacts: {
      ...state.npcContacts,
      [npcId]: {
        ...contact,
        unansweredRound: state.currentRound,
        lastPhoneOutcome: selectedChannel === 'work_phone' ? 'unanswered' : contact.lastPhoneOutcome,
        outboundCount: contact.outboundCount + 1,
        channelCooldownUntil: {
          ...contact.channelCooldownUntil,
          [selectedChannel]: state.simulatedClockMinutes + Math.max(15, cooldownMinutes),
        },
      },
    },
  };
}

export function recordNpcOutbound(state: GameRuntimeState, npcId: string): GameRuntimeState {
  const contact = state.npcContacts[npcId];
  if (!contact) throw new Error('NPC_UNKNOWN');
  return {
    ...state,
    npcContacts: {
      ...state.npcContacts,
      [npcId]: {
        ...contact,
        outboundCount: contact.outboundCount + 1,
        lastContactRound: state.currentRound,
        lastContactMinute: state.simulatedClockMinutes,
      },
    },
  };
}

export function startPhoneCall(state: GameRuntimeState, npcId: string): GameRuntimeState {
  if (!getProjectOneNpc(npcId)) throw new Error('NPC_UNKNOWN');
  if (state.activeMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
  if (state.activePhoneCall && state.activePhoneCall.npcId !== npcId) throw new Error('PHONE_CALL_ACTIVE');
  return {
    ...state,
    // This is a server-generated wall-clock marker used only to restore the
    // visible call timer after refresh. Keep the authoritative phase boundary
    // separately in startedRound.
    activePhoneCall: { npcId, startedRound: state.currentRound, startedAt: new Date().toISOString() },
  };
}

export function endPhoneCall(state: GameRuntimeState, npcId?: string): GameRuntimeState {
  if (!state.activePhoneCall) return state;
  if (npcId && state.activePhoneCall.npcId !== npcId) throw new Error('PHONE_CALL_NPC_MISMATCH');
  return { ...state, activePhoneCall: null };
}

/**
 * Legacy preparation-ID attachment helper for archived commands/tests. New
 * chat emails use player-described `emailAttachments` and never call this
 * inventory transition; it remains only so old visit records can be read and
 * validated without weakening ownership or gift boundaries.
 */
export function applyPreparationAttachments(
  state: GameRuntimeState,
  npcId: string,
  attachmentIds: string[],
): GameRuntimeState {
  const ids = Array.from(new Set(attachmentIds));
  if (ids.length === 0) return state;
  const selected = state.preparations.filter((item) => ids.includes(item.id));
  if (selected.length !== ids.length || selected.some((item) =>
    item.npcId !== npcId
    || item.status !== 'ready'
    || !isCurrentPreparationType(item.type))) {
    throw new Error('EMAIL_ATTACHMENT_NOT_AVAILABLE');
  }
  const selectedIds = new Set(ids);
  return {
    ...state,
    preparations: state.preparations.map((item) => selectedIds.has(item.id)
      ? { ...item, usedCount: item.usedCount + 1, status: item.reusable ? 'ready' as const : 'used' as const }
      : item),
  };
}

export function shouldNpcRespond(seed: string, chancePercent: number): boolean {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < Math.max(0, Math.min(100, chancePercent));
}

function completeMeeting(state: GameRuntimeState, reason: GameMeetingMinutes['endReason'], summary = ''): GameRuntimeState {
  const meeting = state.activeMeeting;
  if (!meeting) return state;
  const appointment = state.appointments.find((item) => item.id === meeting.appointmentId);
  const memory = state.conversationMemories[meeting.npcId];
  const pendingMaterials = state.preparations
    .filter((item) =>
      item.npcId === meeting.npcId
      && (item.appointmentId === null || item.appointmentId === meeting.appointmentId)
      && ['ppt', 'materials'].includes(item.type)
      && item.status === 'ready'
      && !meeting.usedPreparationIds.includes(item.id))
    .map((item) => item.title);
  let simulatedClockMinutes = state.simulatedClockMinutes;
  let cumulativeTimeMinutes = state.cumulativeTimeMinutes;
  if (appointment && appointment.reservedMinutes > 0) {
    simulatedClockMinutes = Math.max(simulatedClockMinutes, appointment.startMinute) + appointment.durationMinutes;
    cumulativeTimeMinutes += appointment.durationMinutes;
  }
  const canFollowUpToday = simulatedClockMinutes + 30 <= PROJECT_ONE_EVENING_END_MINUTE;
  const hasNextRound = state.currentRound < state.maxRounds;
  const nextStepRound = canFollowUpToday || !hasNextRound ? state.currentRound : state.currentRound + 1;
  const nextStepMinute = canFollowUpToday
    ? simulatedClockMinutes + 30
    : hasNextRound ? PROJECT_ONE_DAY_START_MINUTE : PROJECT_ONE_EVENING_END_MINUTE;
  const normalizedSummary = summary.trim();
  const confirmedItems = Array.from(new Set([
    ...(memory?.confirmedFacts ?? []),
    ...(appointment?.purpose ? [`已围绕“${appointment.purpose}”完成沟通`] : []),
  ])).slice(-12);
  const playerCommitments = normalizedSummary
    ? [normalizedSummary]
    : [pendingMaterials.length > 0 ? '补发待补材料并确认会谈纪要' : '发送会谈纪要并确认下一步安排'];
  const minutes: GameMeetingMinutes = {
    id: `minutes:${meeting.appointmentId}`,
    appointmentId: meeting.appointmentId,
    npcId: meeting.npcId,
    visitType: meeting.visitType,
    summary: normalizedSummary || (reason === 'turn_limit' ? '会谈达到内容轮次上限后结束。' : '本次拜访已结束。'),
    confirmedItems,
    npcCommitments: Array.from(new Set(memory?.commitments ?? [])).slice(-12),
    playerCommitments,
    pendingMaterials,
    nextStep: pendingMaterials.length > 0 ? '补发材料、确认纪要并约定后续沟通' : '确认纪要并约定后续沟通',
    nextStepRound,
    nextStepMinute,
    endReason: reason,
    completedTasks: [...(meeting.completedTasks ?? [])],
    owner: `我方销售 / ${getProjectOneNpc(meeting.npcId)?.name ?? '客户联系人'}`,
    createdRound: state.currentRound,
    createdMinute: simulatedClockMinutes,
  };
  minutes.original = {
    summary: minutes.summary,
    confirmedItems: [...minutes.confirmedItems],
    npcCommitments: [...minutes.npcCommitments],
    playerCommitments: [...minutes.playerCommitments],
    nextStep: minutes.nextStep,
  };
  minutes.revisionCount = 0;
  return resumeProjectTimerAfterVisit({
    ...state,
    simulatedClockMinutes: Math.min(PROJECT_ONE_EVENING_END_MINUTE, simulatedClockMinutes),
    cumulativeTimeMinutes,
    appointments: state.appointments.map((item) => item.id === meeting.appointmentId
      ? { ...item, status: 'completed' as const, reservedMinutes: 0, workTopicOpenedBy: meeting.workTopicOpenedBy }
      : item),
    meetingMinutes: [...state.meetingMinutes.filter((item) => item.appointmentId !== meeting.appointmentId), minutes],
    notifications: [...state.notifications, {
      id: `follow-up:${meeting.appointmentId}`,
      npcId: meeting.npcId,
      kind: 'follow_up',
      title: '拜访后跟进',
      body: pendingMaterials.length > 0
        ? `纪要已生成，仍需补发${pendingMaterials.join('、')}并跟进承诺。`
        : reason === 'turn_limit' ? '会谈已达到内容轮次，纪要已生成，请跟进承诺。' : '拜访纪要已生成，请确认并完成后续跟进。',
      round: state.currentRound,
      minute: simulatedClockMinutes,
      isRead: false,
      targetId: meeting.appointmentId,
    }],
    activeMeeting: null,
    lastAction: null,
  }, meeting.turnCount);
}

function allowedMeetingTasks(npcId: string): readonly ProjectOneVisitTask[] {
  return PROJECT_ONE_FIVE_PERSON_NPCS[npcId as keyof typeof PROJECT_ONE_FIVE_PERSON_NPCS]?.allowedTasks ?? [];
}

/**
 * Persist one actual-visit turn and apply a trusted task/exit decision.
 * The chat service may call this only after its server-side evaluator has
 * produced `progress`; this reducer independently checks the configured task
 * allowlist and makes duplicate task completion idempotent before ending a
 * meeting.
 */
export function recordMeetingTurn(
  state: GameRuntimeState,
  progress: TrustedMeetingTurnProgress = {},
): GameRuntimeState {
  if (!state.activeMeeting) throw new Error('MEETING_NOT_ACTIVE');
  const meeting = state.activeMeeting;
  if (meeting.awaitingFinalReplyFrom === 'player') {
    // The NPC has already supplied its one permitted final statement. The
    // player acknowledgement is recorded as this turn, then the appointment
    // closes without another model invocation or NPC transcript row.
    return completeMeeting({
      ...state,
      activeMeeting: { ...meeting, turnCount: meeting.turnCount + 1 },
    }, 'npc_farewell');
  }
  const allowedTasks = allowedMeetingTasks(meeting.npcId);
  const completedTasks = meeting.completedTasks ?? [];
  const completedTask = progress.completedTask ?? null;
  if (completedTask && !allowedTasks.includes(completedTask)) throw new Error('MEETING_TASK_NOT_ALLOWED');
  // A later clarification may be classified as the same task. It remains a
  // dialogue turn, but does not make the chat transaction fail or add a task.
  const isNewCompletedTask = Boolean(completedTask && !completedTasks.includes(completedTask));
  const nextCompletedTasks = isNewCompletedTask && completedTask ? [...completedTasks, completedTask] : completedTasks;

  const nextMeeting: ActiveMeeting = {
    ...meeting,
    turnCount: meeting.turnCount + 1,
    completedTasks: nextCompletedTasks,
  };
  const next = { ...state, activeMeeting: nextMeeting };
  // Preserve an explicit player farewell as the end reason even on turn 20.
  // This must happen after incrementing the turn and before the hard limit.
  if (progress.playerFarewell) return completeMeeting(next, 'player');
  if (progress.npcLeft) return completeMeeting(next, 'npc_left');
  // A farewell is not a forced departure. The other party may acknowledge it
  // once, even where the task or content limit would otherwise close now.
  if (progress.npcFarewell) return {
    ...next,
    activeMeeting: { ...nextMeeting, awaitingFinalReplyFrom: 'player' },
  };
  if (allowedTasks.length > 0 && nextCompletedTasks.length >= allowedTasks.length) return completeMeeting(next, 'completed');
  // Actual-test semantics allow turn 20 and end only once the count exceeds it.
  if (nextMeeting.turnCount > nextMeeting.maxTurns) return completeMeeting(next, 'turn_limit');
  return next;
}

export function setMeetingWorkTopicOpenedBy(state: GameRuntimeState, by: 'player' | 'npc'): GameRuntimeState {
  if (!state.activeMeeting) throw new Error('MEETING_NOT_ACTIVE');
  if (state.activeMeeting.workTopicOpenedBy) return state;
  return { ...state, activeMeeting: { ...state.activeMeeting, workTopicOpenedBy: by } };
}

export function endMeeting(state: GameRuntimeState): GameRuntimeState {
  if (state.status !== 'playing') throw new Error('GAME_ALREADY_FINISHED');
  return completeMeeting(state, 'player');
}

export function advanceRound(
  _state: GameRuntimeState,
  _legacyNow?: number,
  _probabilitySeed = 'legacy-advance',
  _competitorStageAction?: CompetitorStageActionCandidate,
): GameRuntimeState {
  throw new Error('PHASE_CONTROLS_REMOVED');
}

/** Wall-clock reconciliation was removed; reads are now pure and time-neutral. */
export function reconcileExpiredPhases(state: GameRuntimeState, _legacyNow?: number): GameRuntimeState {
  return state;
}

function invitationChance(state: GameRuntimeState, command: Extract<GameCommand, { type: 'invite' }>): number {
  const { npcId, invitationMethod, visitType } = command.payload;
  const attitude = state.npcAttitudes[npcId] ?? defaultAttitude();
  let chance = 40 + (attitude.support - 35) * 0.45 + (attitude.pleasantness - 50) * 0.2;
  if (invitationMethod === 'drop_in' && visitType === 'short') chance += 15;
  if (invitationMethod === 'drop_in' && visitType !== 'short') chance -= 15;
  if (invitationMethod === 'dedicated' && visitType === 'formal') chance += 10;
  if (visitType === 'informal' && attitude.support < 45) chance -= 8;
  return clamp(chance, 10, 90);
}

function reserveAppointmentTime(state: GameRuntimeState, appointment: GameAppointment): GameRuntimeState {
  if (appointment.scheduledRound !== state.currentRound) return state;
  const overlapsExisting = state.appointments.some((item) =>
    item.id !== appointment.id
    && item.scheduledRound === appointment.scheduledRound
    && ['accepted', 'active'].includes(item.status)
    && getAppointmentDepartureMinute(item) < appointment.startMinute + appointment.durationMinutes
    && getAppointmentDepartureMinute(appointment) < item.startMinute + item.durationMinutes);
  if (overlapsExisting) throw new Error('APPOINTMENT_CONFLICT');
  if (state.dayAvailableMinutes < appointment.durationMinutes) throw new Error('DAY_TIME_INSUFFICIENT');
  return { ...state, dayAvailableMinutes: state.dayAvailableMinutes - appointment.durationMinutes };
}

function assertAppointmentSlotAvailable(
  state: GameRuntimeState,
  appointment: GameAppointment,
  excludingId?: string,
): void {
  const end = appointment.startMinute + appointment.durationMinutes;
  const departure = getAppointmentDepartureMinute(appointment);
  const overlapping = state.appointments.some((item) =>
    item.id !== excludingId
    && item.scheduledRound === appointment.scheduledRound
    && ['accepted', 'active'].includes(item.status)
    && departure < item.startMinute + item.durationMinutes
    && end > getAppointmentDepartureMinute(item));
  if (overlapping) throw new Error('APPOINTMENT_TIME_CONFLICT');
}

function assertEveningVisitLimit(state: GameRuntimeState, appointment: GameAppointment, excludingId?: string): void {
  if (appointment.visitType !== 'informal' || appointment.startMinute < 18 * 60) return;
  const alreadyScheduled = state.appointments.some((item) =>
    item.id !== excludingId
    && item.scheduledRound === appointment.scheduledRound
    && item.visitType === 'informal'
    && item.startMinute >= 18 * 60
    && ['accepted', 'active', 'completed'].includes(item.status));
  if (alreadyScheduled) throw new Error('EVENING_VISIT_LIMIT_REACHED');
}

function resolveInvitationPayload(
  state: GameRuntimeState,
  payload: Extract<GameCommand, { type: 'invite' }>['payload'],
) {
  const text = (payload.rawText || payload.purpose || '').trim();
  if (!text) throw new Error('INVITATION_TEXT_REQUIRED');
  const extractedFields: string[] = [];
  const defaultedFields: string[] = [];

  const invitationMethod = payload.invitationMethod
    ?? (/顺路|顺便|路过/.test(text) ? 'drop_in' : 'dedicated');
  (payload.invitationMethod || /顺路|顺便|路过/.test(text) ? extractedFields : defaultedFields).push('invitationMethod');

  const inferredVisitType: VisitType = /吃饭|晚餐|午餐|咖啡|茶|茶叙/.test(text)
    ? 'informal'
    : /正式|汇报|演示|方案|PPT|会议/.test(text) ? 'formal' : 'short';
  const visitType = payload.visitType ?? inferredVisitType;
  (payload.visitType || /吃饭|晚餐|午餐|咖啡|茶|茶叙|正式|汇报|演示|方案|PPT|会议/.test(text) ? extractedFields : defaultedFields).push('visitType');

  const roundMatch = text.match(/第\s*([1-5])\s*(?:阶段|天)/);
  const scheduledRound = state.currentRound;
  (payload.scheduledRound || roundMatch || /明天|次日/.test(text) ? extractedFields : defaultedFields).push('scheduledRound');

  const timeMatch = text.match(/(?:(上午|下午|晚上)\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?|(\d{1,2})[:：点时](\d{1,2})?)/);
  let startMinute = payload.startMinute;
  if (startMinute == null && timeMatch) {
    let hour = Number(timeMatch[2] || timeMatch[4]);
    const minute = Number(timeMatch[3] || timeMatch[5] || 0);
    const prefix = timeMatch[1] || '';
    if ((prefix.includes('下午') || prefix.includes('晚上')) && hour < 12) hour += 12;
    startMinute = hour * 60 + minute;
  }
  if (startMinute == null) startMinute = PROJECT_ONE_DAY_START_MINUTE;
  (payload.startMinute != null || timeMatch ? extractedFields : defaultedFields).push('startMinute');

  const venueMatch = text.match(/(?:在|到)([^，。；]{2,24}?)(?:见面|聊|碰面|会面|沟通|交流)/);
  const extractedVenue = venueMatch?.[1]?.trim().replace(/(?:正式|简单|当面)$/, '');
  const venue = payload.venue ?? extractedVenue ?? (visitType === 'informal' ? '客户附近的合适场所' : '客户办公室');
  (payload.venue || venueMatch ? extractedFields : defaultedFields).push('venue');

  return {
    invitationMethod,
    visitType,
    venue,
    purpose: payload.purpose?.trim() || text,
    scheduledRound,
    startMinute,
    invitationText: text,
    extractedFields,
    defaultedFields,
  };
}

function createAppointmentFromCommand(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'invite' }>,
): { state: GameRuntimeState; appointment: GameAppointment } {
  const { payload } = command;
  const attachmentIds = payload.attachmentIds ?? [];
  const emailAttachments = payload.emailAttachments ?? [];
  const resolved = resolveInvitationPayload(state, payload);
  const contact = state.npcContacts[payload.npcId];
  if (!contact || contact.status === 'known' || (!contact.hasReplied && contact.status !== 'online')) {
    throw new Error('TWO_WAY_CONTACT_REQUIRED');
  }
  if (!state.unlockedNpcIds.includes(payload.npcId)) throw new Error('NPC_LOCKED');
  if ((attachmentIds.length > 0 || emailAttachments.length > 0) && payload.channel !== 'email') {
    throw new Error('EMAIL_ATTACHMENT_NOT_AVAILABLE');
  }
  const rules = PROJECT_ONE_VISIT_RULES[resolved.visitType];
  const attachments = state.preparations.filter((item) => attachmentIds.includes(item.id));
  if (attachments.length !== attachmentIds.length || attachments.some((item) =>
    item.npcId !== payload.npcId
    || item.status !== 'ready'
    || !isCurrentPreparationType(item.type))) {
    throw new Error('EMAIL_ATTACHMENT_NOT_AVAILABLE');
  }
  const chance = invitationChance(state, command);
  const accepted = shouldNpcRespond(`${command.commandId}:accepted`, chance);
  const countered = !accepted && shouldNpcRespond(`${command.commandId}:countered`, 65);
  const status: AppointmentStatus = accepted ? 'accepted' : countered ? 'countered' : 'rejected';
  const counteredStartMinute = resolved.startMinute;
  const conditions = countered
    ? [resolved.visitType === 'formal' ? '请先发送议程或案例材料' : '请重新确认合适时间']
    : [];
  const appointment: GameAppointment = {
    id: `appointment:${command.commandId}`,
    npcId: payload.npcId,
    invitationMethod: resolved.invitationMethod,
    visitType: resolved.visitType,
    venue: resolved.venue,
    purpose: resolved.purpose,
    scheduledRound: resolved.scheduledRound,
    startMinute: counteredStartMinute,
    durationMinutes: rules.durationMinutes,
    maxTurns: rules.maxTurns,
    status,
    conditions,
    reservedMinutes: 0,
    workTopicOpenedBy: null,
    invitationCommandId: command.commandId,
    invitationText: resolved.invitationText,
    extractedFields: resolved.extractedFields,
    defaultedFields: resolved.defaultedFields,
    emailAttachments,
    attachmentIds,
  };
  let next = { ...state, appointments: [...state.appointments, appointment] };
  next = {
    ...next,
    notifications: [...next.notifications, {
      id: `invite-response:${appointment.id}`,
      npcId: payload.npcId,
      kind: 'appointment',
      title: accepted ? '邀约已接受' : countered ? 'NPC提出改期条件' : '邀约被拒绝',
      body: accepted
        ? `可以，本阶段可以直接安排一次${PROJECT_ONE_PREPARATION_TITLES.visit_preparation.replace('拜访前准备', '') || ''}${appointment.visitType === 'formal' ? '正式拜访' : appointment.visitType === 'informal' ? '非正式拜访' : '短时拜访'}，地点就按${appointment.venue}。`
        : countered
          ? `可以继续谈，但请先处理这个条件：${conditions[0]}。完成后本阶段即可拜访。`
          : '谢谢你的邀请，不过我目前暂时安排不开。等项目条件更明确一些，我们再找合适时间沟通。',
      round: state.currentRound,
      minute: next.simulatedClockMinutes,
      isRead: false,
      targetId: appointment.id,
    }],
  };
  return { state: next, appointment };
}

function prepareForVisit(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'prepare' }>,
  evaluation?: FormalVisitPreparationEvaluation,
): { state: GameRuntimeState; preparation: GamePreparation } {
  const { payload } = command;
  if (!state.unlockedNpcIds.includes(payload.npcId)) throw new Error('NPC_LOCKED');
  if (payload.appointmentId) {
    const appointment = state.appointments.find((item) => item.id === payload.appointmentId);
    if (!appointment || appointment.npcId !== payload.npcId) throw new Error('APPOINTMENT_NOT_FOUND');
  }
  if (payload.content.trim().length < 10) throw new Error('PREPARATION_BRIEF_REQUIRED');
  if (isCurrentPreparationType(payload.preparationType) && !evaluation) throw new Error('PREPARATION_AI_REQUIRED');
  if (isCurrentPreparationType(payload.preparationType) && evaluation?.needsDetail) throw new Error('PREPARATION_NEEDS_DETAIL');
  const brief = isCurrentPreparationType(payload.preparationType)
    ? extractPreparationBrief(payload.content, payload.npcId)
    : undefined;
  if (brief && !evaluation && !hasReliablePreparationSemantics(brief)) throw new Error('PREPARATION_BRIEF_REQUIRED');
  const rule = PROJECT_ONE_PREPARATION_RULES[payload.preparationType];
  const next = consumeGameTime(state, rule.timeMinutes, { pointCost: rule.costPoints });
  const preparation: GamePreparation = {
    id: `preparation:${command.commandId}`,
    npcId: payload.npcId,
    appointmentId: payload.appointmentId ?? null,
    type: payload.preparationType,
    // The client may submit a legacy title, but authoritative labels are fixed
    // server-side so player-controlled text cannot masquerade as system context.
    title: PROJECT_ONE_PREPARATION_TITLES[payload.preparationType],
    content: payload.content,
    brief,
    ...(evaluation ? { feedback: { strengths: evaluation.strengths.slice(0, 4), risks: evaluation.risks.slice(0, 4), nextStep: evaluation.nextStep } } : {}),
    status: 'ready',
    costPoints: rule.costPoints,
    timeMinutes: rule.timeMinutes,
    reusable: rule.reusable,
    usedCount: 0,
    createdRound: state.currentRound,
  };
  return { state: { ...next, preparations: [...next.preparations, preparation], lastAction: payload.preparationType }, preparation };
}

function startVisit(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'start_visit' }>,
): { state: GameRuntimeState; appointment: GameAppointment } {
  if (state.activeMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
  if (state.activePhoneCall) throw new Error('PHONE_CALL_ACTIVE');
  let appointment = command.payload.appointmentId
    ? state.appointments.find((item) => item.id === command.payload.appointmentId)
    : undefined;
  const isDirectVisit = !appointment;
  if (isDirectVisit) {
    const npcId = command.payload.npcId;
    if (!npcId || !state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_UNKNOWN');
    appointment = {
      id: `drop-in:${command.commandId}`,
      npcId,
      invitationMethod: 'drop_in',
      visitType: 'short',
      venue: '客户办公地点',
      purpose: '未预约直接登门沟通',
      scheduledRound: state.currentRound,
      startMinute: state.simulatedClockMinutes,
      durationMinutes: PROJECT_ONE_VISIT_RULES.short.durationMinutes,
      maxTurns: FORMAL_ACTUAL_VISIT_MAX_TURNS,
      status: 'accepted',
      conditions: [],
      reservedMinutes: 0,
      workTopicOpenedBy: null,
      invitationCommandId: command.commandId,
    };
  }
  if (!appointment || appointment.status !== 'accepted') throw new Error('APPOINTMENT_NOT_ACCEPTED');
  const next = consumeGameTime(state, 0, { pointCost: FORMAL_WORKFLOW_ACTION_POINTS.directVisit });
  const selectedPreparationIds = command.payload.preparationIds ?? [];
  const usable = new Set(next.preparations
    .filter((item) => item.npcId === appointment.npcId && item.status === 'ready' && isCurrentPreparationType(item.type))
    .map((item) => item.id));
  if (selectedPreparationIds.some((id) => !usable.has(id))) throw new Error('PREPARATION_NOT_AVAILABLE');
  if (selectedPreparationIds.length === 0 && !command.payload.skipPreparation) {
    throw new Error('VISIT_PREPARATION_REQUIRED');
  }
  const activeMeeting: ActiveMeeting = {
    id: `meeting:${appointment.id}`,
    npcId: appointment.npcId,
    actionId: appointment.visitType,
    appointmentId: appointment.id,
    visitType: appointment.visitType,
    turnCount: 0,
    maxTurns: FORMAL_ACTUAL_VISIT_MAX_TURNS,
    durationMinutes: appointment.durationMinutes,
    startedAt: `stage:${state.currentRound}`,
    workTopicOpenedBy: appointment.workTopicOpenedBy,
    usedPreparationIds: selectedPreparationIds,
    completedTasks: [],
  };
  return {
    state: {
      ...next,
      appointments: (isDirectVisit ? [...next.appointments, appointment] : next.appointments).map((item) => item.id === appointment.id ? { ...item, status: 'active' as const } : item),
      preparations: next.preparations.map((item) => selectedPreparationIds.includes(item.id) && item.type !== 'courtesy_gift' && item.type !== 'boundary_gift'
        ? { ...item, usedCount: item.usedCount + 1, status: item.reusable ? 'ready' as const : 'used' as const }
        : item),
      activeMeeting,
      projectTimer: { ...next.projectTimer, visitPaused: true, lastResumedAt: null },
      lastAction: `visit:${appointment.visitType}`,
    },
    appointment,
  };
}

/**
 * Compliance effects are policy-owned.  AI can supply a natural-language NPC
 * reply and, at most, a candidate disposition; it may not set a risk tier,
 * trigger state, or financial penalty on the persisted ledger.
 */
export function deriveBoundaryGiftRiskPolicy(
  disposition: GiftDisposition,
  priorAccepted: boolean,
  explicitBribe: boolean,
): Pick<ComplianceRiskEvent, 'severity' | 'status' | 'penalty'> {
  if (explicitBribe || disposition === 'reported') {
    return { severity: 5, status: 'triggered', penalty: 20 };
  }
  if (disposition === 'cautious_acceptance') {
    return { severity: 5, status: 'latent', penalty: 15 };
  }
  if (disposition === 'delighted_acceptance') {
    return { severity: 4, status: 'latent', penalty: 12 };
  }
  if (disposition === 'firm_rejection') {
    return { severity: priorAccepted ? 4 : 3, status: 'latent', penalty: priorAccepted ? 12 : 9 };
  }
  return { severity: priorAccepted ? 3 : 2, status: 'latent', penalty: priorAccepted ? 9 : 6 };
}

/**
 * The outcome class is server-owned as well: a model cannot manufacture an
 * immediate report (or erase one) by selecting a JSON enum.  The seed makes
 * the same command reproducible while the NPC profile and visit context keep
 * different people and settings meaningfully distinct.
 */
export function deriveBoundaryGiftDisposition(
  npcId: string,
  support: number,
  commandId: string,
  setting: 'public' | 'private',
  witnesses: string[],
  priorAccepted: boolean,
  explicitBribe: boolean,
): GiftDisposition {
  if (explicitBribe) return 'reported';
  const npc = getProjectOneNpc(npcId);
  if (!npc) throw new Error('NPC_UNKNOWN');
  const procurementSensitive = npcId === 'P1-003';
  let acceptChance = 55 - npc.complianceSensitivity * 0.4 + (support - 35) * 0.4;
  if (setting === 'private') acceptChance += 10;
  if (witnesses.length > 0) acceptChance -= 15;
  if (procurementSensitive) acceptChance -= 10;
  const accepted = !priorAccepted && shouldNpcRespond(`${commandId}:gift-accept`, clamp(acceptChance, 5, 70));
  const reported = shouldNpcRespond(`${commandId}:gift-report`, clamp(
    npc.complianceSensitivity * 0.45 + (priorAccepted ? 25 : 0) + (procurementSensitive ? 10 : 0),
    10,
    80,
  ));
  if (accepted) {
    return shouldNpcRespond(`${commandId}:gift-delighted`, 45)
      ? 'delighted_acceptance'
      : 'cautious_acceptance';
  }
  if (reported) return 'reported';
  return shouldNpcRespond(`${commandId}:gift-firm`, 45) ? 'firm_rejection' : 'polite_decline';
}

function giveGift(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'give_gift' }>,
  trustedEvaluation?: GiftCommandEvaluation,
): {
  state: GameRuntimeState;
  disposition: GiftDisposition;
  risk: ComplianceRiskEvent | null;
  message: string;
  evaluationSource: string;
  reason: string;
} {
  const preparation = state.preparations.find((item) => item.id === command.payload.preparationId);
  if (!preparation || preparation.status !== 'ready' || !['courtesy_gift', 'boundary_gift'].includes(preparation.type)) {
    throw new Error('GIFT_NOT_AVAILABLE');
  }
  const meeting = state.activeMeeting;
  if (!meeting || meeting.npcId !== preparation.npcId) throw new Error('GIFT_REQUIRES_ACTIVE_VISIT');
  if (command.payload.appointmentId && command.payload.appointmentId !== meeting.appointmentId) throw new Error('APPOINTMENT_NOT_ACTIVE');
  let next = state;
  let disposition: GiftDisposition;
  let risk: ComplianceRiskEvent | null = null;
  let message = trustedEvaluation?.npcResponse.trim() ?? '';
  let evaluationSource = trustedEvaluation?.source.trim() || 'deterministic_fallback';
  let decisionReason = trustedEvaluation?.reason.trim() ?? '';
  if (preparation.type === 'courtesy_gift') {
    const preference = getProjectOneNpc(preparation.npcId)?.actionPreferences.gift ?? 0;
    disposition = trustedEvaluation?.disposition ?? (preference < -1 ? 'polite_decline' : 'delighted_acceptance');
    let pleasantnessDelta = clampDelta(trustedEvaluation?.pleasureDelta ?? trustedEvaluation?.pleasantnessDelta ?? (2 + preference), -3, 4);
    let supportDelta = clampDelta(trustedEvaluation?.supportDelta ?? Math.max(0, Math.min(1, preference)), -2, 2);
    if (disposition !== 'delighted_acceptance' && disposition !== 'cautious_acceptance') {
      pleasantnessDelta = Math.min(0, pleasantnessDelta);
      supportDelta = Math.min(0, supportDelta);
    }
    decisionReason ||= disposition === 'polite_decline' ? '人物对商务礼品较为谨慎' : '合规伴手礼与场合匹配';
    message ||= disposition === 'delighted_acceptance' || disposition === 'cautious_acceptance'
      ? '谢谢，这份心意我收下了。'
      : '谢谢，不过这份礼物我不方便收。';
    next = applyNpcAttitudeDelta(next, preparation.npcId, {
      pleasantnessDelta,
      supportDelta,
      reason: decisionReason,
      source: evaluationSource,
    });
  } else {
    const priorAccepted = state.complianceRisks.some((item) =>
      item.npcId === preparation.npcId
      && item.kind === 'boundary_gift'
      && (item.outcome === 'delighted_acceptance' || item.outcome === 'cautious_acceptance'));
    const attitude = state.npcAttitudes[preparation.npcId] ?? defaultAttitude();
    const explicitBribe = command.payload.exchangeRequested;
    disposition = deriveBoundaryGiftDisposition(
      preparation.npcId,
      attitude.support,
      command.commandId,
      command.payload.setting,
      command.payload.witnesses,
      priorAccepted,
      explicitBribe,
    );
    const modelMatchesPolicy = trustedEvaluation?.disposition === disposition;
    if (explicitBribe) {
      decisionReason = '明确提出利益交换';
      evaluationSource = 'deterministic_compliance_rule';
      message = '这属于不合规的利益交换，我不能接受并会按流程上报。';
    } else if (!modelMatchesPolicy) {
      // Do not let a model-supplied reported/accepted enum change the policy
      // class.  Mismatches receive a canonical response and attitude change.
      decisionReason = `服务端合规策略判定：${disposition}`;
      evaluationSource = 'deterministic_compliance_rule';
      message = '';
    }
    const deltas: Record<GiftDisposition, [number, number]> = {
      delighted_acceptance: [12, 7],
      cautious_acceptance: [5, 3],
      polite_decline: [-2, -1],
      firm_rejection: [-7, -5],
      reported: [-12, -9],
    };
    let [pleasantnessDelta, supportDelta] = modelMatchesPolicy && !explicitBribe
      ? [
          clampDelta(trustedEvaluation.pleasureDelta ?? trustedEvaluation.pleasantnessDelta ?? 0, -12, 12),
          clampDelta(trustedEvaluation.supportDelta, -10, 7),
        ]
      : deltas[disposition];
    if (disposition !== 'delighted_acceptance' && disposition !== 'cautious_acceptance') {
      pleasantnessDelta = Math.min(0, pleasantnessDelta);
      supportDelta = Math.min(0, supportDelta);
    }
    decisionReason ||= command.payload.exchangeRequested ? '明确提出利益交换' : `高波动边界礼品：${disposition}`;
    message ||= disposition === 'delighted_acceptance' || disposition === 'cautious_acceptance'
      ? '我明白你的心意，这次收下。'
      : disposition === 'reported' ? '这件事我必须按规定上报。' : '这份礼物我不能接受。';
    next = applyNpcAttitudeDelta(next, preparation.npcId, {
      pleasantnessDelta,
      supportDelta,
      complianceAwarenessDelta: disposition === 'reported' ? 20 : 8,
      reason: decisionReason,
      source: evaluationSource,
      allowBoundaryGiftRange: true,
    });
    const compliancePolicy = deriveBoundaryGiftRiskPolicy(
      disposition,
      priorAccepted,
      command.payload.exchangeRequested,
    );
    risk = {
      id: `risk:${command.commandId}`,
      npcId: preparation.npcId,
      preparationId: preparation.id,
      kind: command.payload.exchangeRequested ? 'explicit_bribe' : 'boundary_gift',
      severity: compliancePolicy.severity,
      status: compliancePolicy.status,
      penalty: compliancePolicy.penalty,
      reason: command.payload.exchangeRequested
        ? '明确回扣或利益交换已被记录'
        : trustedEvaluation?.riskReason.trim() || '边界礼品可能在后续审计或转述中暴露',
      createdRound: state.currentRound,
      triggerRound: compliancePolicy.status === 'triggered' ? state.currentRound : null,
      outcome: disposition,
    };
    next = { ...next, complianceRisks: [...next.complianceRisks, risk] };
  }
  return {
    state: {
      ...next,
      preparations: next.preparations.map((item) => item.id === preparation.id
        ? { ...item, status: 'used' as const, usedCount: item.usedCount + 1 }
        : item),
      activeMeeting: next.activeMeeting ? {
        ...next.activeMeeting,
        usedPreparationIds: Array.from(new Set([...next.activeMeeting.usedPreparationIds, preparation.id])),
      } : null,
    },
    disposition,
    risk,
    message,
    evaluationSource,
    reason: decisionReason,
  };
}

function markProcessed(state: GameRuntimeState, commandId: string): GameRuntimeState {
  return { ...state, processedCommandIds: [...state.processedCommandIds, commandId].slice(-200) };
}

function researchPublicInfo(
  state: GameRuntimeState,
  npcId: string,
): { state: GameRuntimeState; record: GamePublicResearchRecord } {
  if (!state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_UNKNOWN');
  const profile = PROJECT_ONE_PUBLIC_PROFILES[npcId];
  if (!profile) throw new Error('PUBLIC_INFO_UNAVAILABLE');
  const next = consumeGameTime(state, PROJECT_ONE_PUBLIC_RESEARCH_RULE.timeMinutes, {
    pointCost: PROJECT_ONE_PUBLIC_RESEARCH_RULE.costPoints,
  });
  const record: GamePublicResearchRecord = {
    npcId,
    facts: [...profile.facts],
    weakSignals: [...profile.weakSignals],
    sourceNote: profile.sourceNote,
    completedRound: state.currentRound,
    completedMinute: next.simulatedClockMinutes,
    costPoints: PROJECT_ONE_PUBLIC_RESEARCH_RULE.costPoints,
  };
  return {
    state: {
      ...next,
      publicResearch: { ...next.publicResearch, [npcId]: record },
      lastAction: 'research_public_info',
    },
    record,
  };
}

function recordWorkPlan(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'work_plan' }>,
  evaluation: FormalPlanEvaluation | undefined,
): { state: GameRuntimeState; record: GameWorkPlanRecord } {
  if (command.payload.scope === 'npc' && (!command.payload.npcId || !state.unlockedNpcIds.includes(command.payload.npcId))) {
    throw new Error('NPC_UNKNOWN');
  }
  const duplicate = state.workPlans.find((item) => item.scope === command.payload.scope
    && item.npcId === (command.payload.npcId ?? null)
    && item.content.trim() === command.payload.content.trim());
  if (duplicate) return { state, record: duplicate };
  if (!evaluation) throw new Error('WORK_PLAN_AI_REQUIRED');
  if (evaluation.needsDetail) throw new Error('WORK_PLAN_NEEDS_DETAIL');
  const next = consumeGameTime(state, 0, { pointCost: FORMAL_WORKFLOW_ACTION_POINTS.workPlan });
  const record: GameWorkPlanRecord = {
    id: `work-plan:${command.commandId}`,
    scope: command.payload.scope,
    npcId: command.payload.npcId ?? null,
    content: command.payload.content,
    recommendations: evaluation.recommendations.slice(0, 5),
    disclosures: evaluation.disclosures.filter((item) => state.unlockedNpcIds.includes(item.npcId)).map((item) => ({ npcId: item.npcId, facts: item.facts.slice(0, 2), clues: item.clues.slice(0, 2) })).slice(0, 5),
    costPoints: FORMAL_WORKFLOW_ACTION_POINTS.workPlan,
    createdRound: state.currentRound,
  };
  return { state: { ...next, workPlans: [...next.workPlans, record], lastAction: 'work_plan' }, record };
}

function sendPostal(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'postal' }>,
): { state: GameRuntimeState; record: GamePostalRecord } {
  if (!state.unlockedNpcIds.includes(command.payload.npcId)) throw new Error('NPC_UNKNOWN');
  const next = consumeGameTime(state, 0, { pointCost: FORMAL_WORKFLOW_ACTION_POINTS.postal });
  const record: GamePostalRecord = {
    id: `postal:${command.commandId}`,
    npcId: command.payload.npcId,
    content: command.payload.content,
    ...(command.payload.attachment ? { attachment: { ...command.payload.attachment } } : {}),
    costPoints: FORMAL_WORKFLOW_ACTION_POINTS.postal,
    createdRound: state.currentRound,
  };
  return { state: { ...next, postalRecords: [...next.postalRecords, record], lastAction: 'postal' }, record };
}

function recordBriefVisit(
  state: GameRuntimeState,
  command: Extract<GameCommand, { type: 'brief_visit' }>,
  evaluation: FormalBriefVisitEvaluation | undefined,
): { state: GameRuntimeState; record: GameVisitBriefRecord } {
  if (!evaluation) throw new Error('BRIEF_VISIT_AI_REQUIRED');
  if (!state.unlockedNpcIds.includes(command.payload.npcId)) throw new Error('NPC_UNKNOWN');
  const next = consumeGameTime(state, 0, { pointCost: FORMAL_WORKFLOW_ACTION_POINTS.briefVisit });
  const record: GameVisitBriefRecord = {
    id: `brief-visit:${command.commandId}`,
    npcId: command.payload.npcId,
    content: command.payload.content,
    strengths: evaluation.strengths.slice(0, 4),
    risks: evaluation.risks.slice(0, 4),
    nextStep: evaluation.nextStep,
    costPoints: FORMAL_WORKFLOW_ACTION_POINTS.briefVisit,
    createdRound: state.currentRound,
  };
  return { state: { ...next, visitBriefs: [...next.visitBriefs, record], lastAction: 'brief_visit' }, record };
}

/**
 * Unified pure command reducer. Persistence/version increments remain the
 * repository's responsibility; this function validates expectedVersion.
 */
export function executeGameCommand(
  stateInput: GameRuntimeState,
  command: GameCommand,
  options: ExecuteGameCommandOptions = {},
): ExecuteGameCommandResult {
  let state = normalizeProjectOneState(stateInput);
  if (state.processedCommandIds.includes(command.commandId)) {
    return { state, result: { duplicate: true }, eventType: 'command.duplicate', eventPayload: { commandId: command.commandId } };
  }
  if (command.expectedVersion !== state.version) throw new Error('STATE_VERSION_CONFLICT');
  if (state.status !== 'playing' && command.type !== 'mark_notification_read') throw new Error('GAME_ALREADY_FINISHED');
  if (command.type !== 'mark_notification_read' && isCustomerActivityPlanning(state)) throw new Error('CUSTOMER_ACTIVITY_PLANNING_ACTIVE');
  if (command.type !== 'mark_notification_read' && hasUnsettledCustomerActivityEvaluations(state)) throw new Error('CUSTOMER_ACTIVITY_EVALUATION_PENDING');
  if (state.activePhoneCall) {
    const activePhoneAllowsCommand = command.type === 'end_phone_call'
      || command.type === 'mark_notification_read'
      || (command.type === 'invite'
        && command.payload.npcId === state.activePhoneCall.npcId
        && command.payload.channel === 'work_phone');
    if (!activePhoneAllowsCommand) throw new Error('PHONE_CALL_ACTIVE');
  }
  if (state.activeMeeting && !['end_visit', 'give_gift', 'follow_up', 'mark_notification_read', 'propose_bid_rule'].includes(command.type)) {
    throw new Error('MEETING_ALREADY_ACTIVE');
  }

  let result: Record<string, unknown> = {};
  let eventType = `game.${command.type}`;
  let eventPayload: Record<string, unknown> = { commandId: command.commandId };

  switch (command.type) {
    case 'contact': {
      if (!state.unlockedNpcIds.includes(command.payload.npcId)) throw new Error('NPC_LOCKED');
      state = consumeCommunicationTime(state, command.payload.channel);
      state = recordNpcOutbound(state, command.payload.npcId);
      let outcome: 'connected' | 'unanswered' | 'declined' | 'call_later' = 'connected';
      if (command.payload.channel === 'work_phone') {
        const contactChance = 58 + state.currentRound * 4 + Math.round(((state.npcAttitudes[command.payload.npcId]?.support ?? 35) - 35) / 3);
        if (!shouldNpcRespond(`${command.commandId}:phone`, contactChance)) {
          outcome = shouldNpcRespond(`${command.commandId}:declined`, 30) ? 'declined'
            : shouldNpcRespond(`${command.commandId}:later`, 35) ? 'call_later' : 'unanswered';
        }
      }
      if (outcome === 'connected') state = connectNpc(state, command.payload.npcId);
      state = {
        ...state,
        npcContacts: {
          ...state.npcContacts,
          [command.payload.npcId]: { ...state.npcContacts[command.payload.npcId], lastPhoneOutcome: command.payload.channel === 'work_phone' ? outcome : state.npcContacts[command.payload.npcId].lastPhoneOutcome },
        },
      };
      result = { npcId: command.payload.npcId, channel: command.payload.channel, outcome };
      eventType = 'contact.completed';
      eventPayload = { ...eventPayload, npcId: command.payload.npcId, channel: command.payload.channel, outcome };
      break;
    }
    case 'request_wechat': {
      const npcId = command.payload.npcId;
      if (!state.unlockedNpcIds.includes(npcId)) throw new Error('NPC_LOCKED');
      const contact = state.npcContacts[npcId];
      if (!contact || contact.status !== 'connected') throw new Error('NPC_NOT_CONNECTED');
      if (contact.wechatStatus === 'accepted') throw new Error('WECHAT_ALREADY_ADDED');
      state = consumeGameTime(state, 0, { pointCost: PROJECT_ONE_COMMUNICATION_POINTS.wechat });
      const support = state.npcAttitudes[npcId]?.support ?? 35;
      const accepted = shouldNpcRespond(`${command.commandId}:wechat`, 42 + Math.max(0, support - 35));
      const wechatStatus: NpcContactState['wechatStatus'] = accepted ? 'accepted'
        : shouldNpcRespond(`${command.commandId}:pending`, 35) ? 'pending'
          : shouldNpcRespond(`${command.commandId}:later`, 50) ? 'later' : 'rejected';
      // Connect exactly once on acceptance. The resulting snapshot is the
      // sole authority for both status and the request audit fields.
      const connectedState = accepted ? connectNpc(state, npcId) : state;
      state = {
        ...connectedState,
        npcContacts: {
          ...connectedState.npcContacts,
          [npcId]: {
            ...connectedState.npcContacts[npcId],
            status: accepted ? 'online' : connectedState.npcContacts[npcId].status,
            wechatStatus,
            onlineRequestedRound: state.currentRound,
          },
        },
      };
      result = { npcId, status: wechatStatus };
      eventType = `wechat.${wechatStatus}`;
      eventPayload = { ...eventPayload, npcId, status: wechatStatus };
      break;
    }
    case 'invite': {
      const continuingActivePhoneCall = command.payload.channel === 'work_phone'
        && state.activePhoneCall?.npcId === command.payload.npcId;
      if (!continuingActivePhoneCall) state = consumeCommunicationTime(state, command.payload.channel);
      const created = createAppointmentFromCommand(state, command);
      state = created.state;
      result = { appointment: created.appointment };
      eventType = `appointment.${created.appointment.status}`;
      eventPayload = {
        ...eventPayload,
        appointmentId: created.appointment.id,
        status: created.appointment.status,
        channel: command.payload.channel,
        extractedFields: created.appointment.extractedFields ?? [],
        defaultedFields: created.appointment.defaultedFields ?? [],
        conditionCount: created.appointment.conditions.length,
      };
      break;
    }
    case 'update_appointment': {
      const appointment = state.appointments.find((item) => item.id === command.payload.appointmentId);
      if (!appointment) throw new Error('APPOINTMENT_NOT_FOUND');
      if (command.payload.action === 'cancel') {
        if (!['accepted', 'countered', 'pending'].includes(appointment.status)) throw new Error('APPOINTMENT_CANNOT_CHANGE');
        state = {
          ...state,
          dayAvailableMinutes: appointment.status === 'accepted' && appointment.scheduledRound === state.currentRound
            ? Math.min(PROJECT_ONE_STANDARD_DAY_MINUTES, state.dayAvailableMinutes + appointment.reservedMinutes)
            : state.dayAvailableMinutes,
          appointments: state.appointments.map((item) => item.id === appointment.id
            ? { ...item, status: 'cancelled' as const, reservedMinutes: 0 }
            : item),
        };
      } else {
        if (appointment.status !== 'countered') throw new Error('APPOINTMENT_NOT_COUNTERED');
        const requiresMaterial = appointment.conditions.some((condition) => /议程|案例|材料/.test(condition));
        const hasRequiredMaterial = state.preparations.some((item) =>
          item.npcId === appointment.npcId
          && (item.appointmentId === null || item.appointmentId === appointment.id)
          && item.status === 'ready');
        if (requiresMaterial && !hasRequiredMaterial) throw new Error('APPOINTMENT_CONDITION_UNMET');
        const accepted = { ...appointment, status: 'accepted' as const, reservedMinutes: 0 };
        state = ({
          ...state,
          appointments: state.appointments.map((item) => item.id === appointment.id ? accepted : item),
        });
      }
      result = { appointment: state.appointments.find((item) => item.id === appointment.id) };
      eventType = command.payload.action === 'cancel' ? 'appointment.cancelled' : 'appointment.accepted';
      eventPayload = {
        ...eventPayload,
        npcId: appointment.npcId,
        appointmentId: appointment.id,
        action: command.payload.action,
        conditionCount: appointment.conditions.length,
        conditionsSatisfied: command.payload.action === 'accept_counter',
      };
      break;
    }
    case 'update_meeting_minutes': {
      const existing = state.meetingMinutes.find((item) => item.id === command.payload.minutesId);
      if (!existing) throw new Error('MEETING_MINUTES_NOT_FOUND');
      const original = existing.original ?? {
        summary: existing.summary,
        confirmedItems: [...existing.confirmedItems],
        npcCommitments: [...existing.npcCommitments],
        playerCommitments: [...existing.playerCommitments],
        nextStep: existing.nextStep,
      };
      const updated: GameMeetingMinutes = {
        ...existing,
        ...command.payload,
        original,
        revisionCount: (existing.revisionCount ?? 0) + 1,
        lastEditedRound: state.currentRound,
        lastEditedMinute: state.simulatedClockMinutes,
      };
      state = {
        ...state,
        meetingMinutes: state.meetingMinutes.map((item) => item.id === updated.id ? updated : item),
      };
      result = { minutes: updated };
      eventType = 'meeting_minutes.updated';
      eventPayload = {
        ...eventPayload,
        minutesId: updated.id,
        appointmentId: updated.appointmentId,
        npcId: updated.npcId,
        revisionCount: updated.revisionCount,
      };
      break;
    }
    case 'prepare': {
      const prepared = prepareForVisit(state, command, options.visitPreparationEvaluation);
      state = prepared.state;
      result = { preparation: prepared.preparation };
      eventType = 'preparation.completed';
      eventPayload = {
        ...eventPayload,
        npcId: prepared.preparation.npcId,
        appointmentId: prepared.preparation.appointmentId,
        preparationId: prepared.preparation.id,
        type: prepared.preparation.type,
        hasPreparationBrief: prepared.preparation.content.trim().length > 0,
        preparationBriefLength: prepared.preparation.content.trim().length,
        timeMinutes: prepared.preparation.timeMinutes,
        costPoints: prepared.preparation.costPoints,
      };
      break;
    }
    case 'work_plan': {
      const planned = recordWorkPlan(state, command, options.workPlanEvaluation);
      state = planned.state;
      result = { workPlan: planned.record };
      eventType = 'work_plan.completed';
      eventPayload = { ...eventPayload, scope: planned.record.scope, npcId: planned.record.npcId, costPoints: planned.record.costPoints, recommendationCount: planned.record.recommendations.length, disclosureCount: planned.record.disclosures.length };
      break;
    }
    case 'postal': {
      const postal = sendPostal(state, command);
      state = postal.state;
      result = { postal: postal.record };
      eventType = 'postal.sent';
      eventPayload = { ...eventPayload, npcId: postal.record.npcId, costPoints: postal.record.costPoints, hasAttachment: Boolean(postal.record.attachment) };
      break;
    }
    case 'brief_visit': {
      const brief = recordBriefVisit(state, command, options.briefVisitEvaluation);
      state = brief.state;
      result = { briefVisit: brief.record };
      eventType = 'brief_visit.evaluated';
      eventPayload = { ...eventPayload, npcId: brief.record.npcId, costPoints: brief.record.costPoints, strengthCount: brief.record.strengths.length, riskCount: brief.record.risks.length };
      break;
    }
    case 'start_visit': {
      const started = startVisit(state, command);
      state = started.state;
      result = { appointment: started.appointment, meeting: state.activeMeeting };
      eventType = 'visit.started';
      eventPayload = {
        ...eventPayload,
        npcId: started.appointment.npcId,
        appointmentId: started.appointment.id,
        visitType: started.appointment.visitType,
        scheduledRound: started.appointment.scheduledRound,
        scheduledMinute: started.appointment.startMinute,
        preparationCount: state.activeMeeting?.usedPreparationIds.length ?? 0,
        conditionCount: started.appointment.conditions.length,
      };
      break;
    }
    case 'end_visit': {
      if (!state.activeMeeting) throw new Error('MEETING_NOT_ACTIVE');
      if (command.payload.appointmentId && command.payload.appointmentId !== state.activeMeeting.appointmentId) throw new Error('APPOINTMENT_NOT_ACTIVE');
      if (command.payload.meetingId && command.payload.meetingId !== state.activeMeeting.id) throw new Error('MEETING_NOT_ACTIVE');
      if (state.activeMeeting.awaitingFinalReplyFrom === 'player') throw new Error('FINAL_PLAYER_REPLY_REQUIRED');
      const meeting = state.activeMeeting;
      state = completeMeeting(state, command.payload.reason, command.payload.summary);
      result = {
        appointmentId: meeting.appointmentId,
        summary: command.payload.summary,
        minutes: state.meetingMinutes.find((item) => item.appointmentId === meeting.appointmentId),
      };
      eventType = 'visit.completed';
      eventPayload = {
        ...eventPayload,
        npcId: meeting.npcId,
        appointmentId: meeting.appointmentId,
        visitType: meeting.visitType,
        reason: command.payload.reason,
        turnCount: meeting.turnCount,
        maxTurns: meeting.maxTurns,
        usedPreparationCount: meeting.usedPreparationIds.length,
        hasPlayerSummary: command.payload.summary.trim().length > 0,
      };
      break;
    }
    case 'end_phone_call': {
      const npcId = command.payload.npcId;
      state = endPhoneCall(state, npcId);
      result = { npcId: npcId ?? null, ended: true };
      eventType = 'npc.call.ended';
      eventPayload = { ...eventPayload, npcId: npcId ?? null };
      break;
    }
    case 'give_gift': {
      const gift = giveGift(state, command, options.giftEvaluation);
      state = gift.state;
      result = {
        disposition: gift.disposition,
        riskId: gift.risk?.id ?? null,
        message: gift.message,
        evaluationSource: gift.evaluationSource,
      };
      eventType = 'gift.delivered';
      eventPayload = {
        ...eventPayload,
        preparationId: command.payload.preparationId,
        disposition: gift.disposition,
        riskId: gift.risk?.id ?? null,
        reason: gift.reason,
        source: gift.evaluationSource,
      };
      break;
    }
    case 'follow_up': {
      const payload = command.payload;
      if (!state.unlockedNpcIds.includes(payload.npcId)) throw new Error('NPC_LOCKED');
      if (payload.action === 'deliver_preparation') {
        if (!state.activeMeeting || state.activeMeeting.npcId !== payload.npcId) throw new Error('MEETING_NOT_ACTIVE');
        if (payload.appointmentId && payload.appointmentId !== state.activeMeeting.appointmentId) throw new Error('APPOINTMENT_NOT_ACTIVE');
        const preparation = state.preparations.find((item) => item.id === payload.preparationId);
        if (!preparation || preparation.npcId !== payload.npcId || preparation.status !== 'ready' || !isCurrentPreparationType(preparation.type)) {
          throw new Error('PREPARATION_NOT_AVAILABLE');
        }
        state = {
          ...state,
          preparations: state.preparations.map((item) => item.id === preparation.id
            ? { ...item, usedCount: item.usedCount + 1, status: item.reusable ? 'ready' as const : 'used' as const }
            : item),
          activeMeeting: {
            ...state.activeMeeting,
            usedPreparationIds: Array.from(new Set([...state.activeMeeting.usedPreparationIds, preparation.id])),
          },
        };
        result = { npcId: payload.npcId, preparationIds: [preparation.id], deliveredDuringVisit: true };
        eventType = 'preparation.delivered';
        eventPayload = {
          ...eventPayload,
          npcId: payload.npcId,
          appointmentId: payload.appointmentId ?? preparation.appointmentId,
          preparationId: preparation.id,
          preparationType: preparation.type,
          deliveredDuringVisit: true,
        };
        break;
      }
      if (state.activeMeeting) throw new Error('MEETING_ALREADY_ACTIVE');
      const completedAppointment = state.appointments.find((item) => item.id === payload.appointmentId);
      if (!completedAppointment || completedAppointment.npcId !== payload.npcId) throw new Error('APPOINTMENT_NOT_FOUND');
      if (completedAppointment.status !== 'completed'
        || !state.meetingMinutes.some((item) => item.appointmentId === completedAppointment.id && item.npcId === payload.npcId)) {
        throw new Error('VISIT_NOT_COMPLETED');
      }
      const selected = state.preparations.filter((item) => payload.preparationIds.includes(item.id));
      if (selected.length !== payload.preparationIds.length || selected.some((item) =>
        item.npcId !== payload.npcId
        || (item.appointmentId !== null && item.appointmentId !== completedAppointment.id)
        || item.status !== 'ready'
        || !isCurrentPreparationType(item.type))) {
        throw new Error('PREPARATION_NOT_AVAILABLE');
      }
      state = consumeCommunicationTime(state, payload.channel);
      state = recordNpcOutbound(state, payload.npcId);
      state = {
        ...state,
        preparations: state.preparations.map((item) => payload.preparationIds.includes(item.id)
          ? { ...item, usedCount: item.usedCount + 1, status: item.reusable ? 'ready' as const : 'used' as const }
          : item),
      };
      result = { npcId: payload.npcId, preparationIds: payload.preparationIds };
      eventType = 'follow_up.sent';
      eventPayload = {
        ...eventPayload,
        npcId: payload.npcId,
        appointmentId: completedAppointment.id,
        channel: payload.channel,
        preparationCount: payload.preparationIds.length,
      };
      break;
    }
    case 'wait': {
      state = advanceClockWithoutInvestment(state, command.payload.minutes);
      result = { simulatedClockMinutes: state.simulatedClockMinutes };
      eventType = 'time.waited';
      break;
    }
    case 'submit': {
      const warningCodes = [
        ...(!state.unlockedClues.includes('decision_process') ? ['decision_chain_unconfirmed'] : []),
        ...(state.outcomeEvidence.publicValue.length === 0 ? ['public_value_missing'] : []),
        ...(state.outcomeEvidence.personalBenefit.length === 0 ? ['personal_benefit_missing'] : []),
        ...(state.complianceRisks.some((risk) => risk.status === 'latent' || risk.status === 'triggered') ? ['compliance_risk_present'] : []),
      ];
      state = submitGame(state, command.commandId);
      const outcome = getGameOutcome(state);
      result = { status: state.status, outcome, warningCodes };
      eventType = 'session.submitted';
      eventPayload = {
        ...eventPayload,
        submittedRound: state.currentRound,
        earlySubmission: state.currentRound < state.maxRounds,
        warningCodes,
        warningCount: warningCodes.length,
        publicValueEvidenceCount: state.outcomeEvidence.publicValue.length,
        personalBenefitEvidenceCount: state.outcomeEvidence.personalBenefit.length,
        triggeredComplianceRiskCount: state.complianceRisks.filter((risk) => risk.status === 'triggered').length,
        finalScore: outcome.finalScore,
        won: outcome.won,
      };
      break;
    }
    case 'mark_notification_read': {
      const exists = state.notifications.some((item) => item.id === command.payload.notificationId);
      if (!exists) throw new Error('NOTIFICATION_NOT_FOUND');
      state = {
        ...state,
        notifications: state.notifications.map((item) => item.id === command.payload.notificationId ? { ...item, isRead: true } : item),
      };
      result = { notificationId: command.payload.notificationId };
      eventType = 'notification.read';
      break;
    }
    case 'research_public_info': {
      const researched = researchPublicInfo(state, command.payload.npcId);
      state = researched.state;
      result = { publicResearch: researched.record };
      eventType = 'public_info.researched';
      eventPayload = {
        ...eventPayload,
        npcId: command.payload.npcId,
        factCount: researched.record.facts.length,
        weakSignalCount: researched.record.weakSignals.length,
        costPoints: researched.record.costPoints,
      };
      break;
    }
    case 'propose_bid_rule': {
      const proposal = proposeBidRule(state, command);
      state = proposal.state;
      result = proposal.result;
      // Event details are stored server-side for audit but the player API does
      // not reveal adoption, direction, or the customer's internal response.
      eventType = 'bid_rule.proposal_recorded';
      eventPayload = {
        ...eventPayload,
        targetContactId: command.payload.targetContactId,
      };
      break;
    }
  }

  state = markProcessed(refreshCompetitivePosition(state), command.commandId);
  return { state, result, eventType, eventPayload };
}
