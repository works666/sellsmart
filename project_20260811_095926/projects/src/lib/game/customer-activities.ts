import { z } from 'zod';

export const CUSTOMER_ACTIVITY_TYPES = [
  'technical_meeting',
  'case_site_visit',
  'company_visit',
  'hospitality',
] as const;

export const ORGANIZATION_CUSTOMER_ACTIVITY_TYPES = [
  'technical_meeting',
  'case_site_visit',
  'company_visit',
] as const;

export const HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD = {
  supportMin: 15,
  pleasantnessMin: 55,
} as const;

export type CustomerActivityType = (typeof CUSTOMER_ACTIVITY_TYPES)[number];
export type CustomerActivitySpeaker = 'sales' | 'customer';
export type CustomerActivityStatus = 'pending' | 'planning' | 'submitted';

export const CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS = [
  'P1-001',
  'P1-002',
  'P1-003',
  'P1-004',
  'P1-005',
] as const;

export type CustomerActivityOrganizationNpcId = (typeof CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS)[number];

export const customerActivityOrganizationMemberSchema = z.object({
  npcId: z.enum(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS),
  support: z.number().int().min(0).max(100),
  pleasantness: z.number().int().min(0).max(100),
}).strict();

export const customerActivityOrganizationSnapshotSchema = z.object({
  members: z.array(customerActivityOrganizationMemberSchema).length(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.length),
}).strict().superRefine((organization, context) => {
  const ids = organization.members.map((member) => member.npcId);
  if (new Set(ids).size !== CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.length
    || CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.some((npcId) => !ids.includes(npcId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['members'], message: 'organization snapshot must include every NPC exactly once' });
  }
});

export const customerActivityDimensionSnapshotSchema = z.object({
  decisionAnalysis: z.number().int().min(0).max(100),
  relationshipBuilding: z.number().int().min(0).max(100),
  valuePresentation: z.number().int().min(0).max(100),
  objectionHandling: z.number().int().min(0).max(100),
  informationDiscovery: z.number().int().min(0).max(100),
}).strict();

export const customerActivityRelationshipSnapshotSchema = z.object({
  npcId: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(240),
  title: z.string().trim().max(240).optional(),
  context: z.string().trim().max(8_000).optional(),
  stage: z.union([z.string().trim().max(160), z.number().int(), z.null()]),
  support: z.number().int().min(0).max(100),
  pleasantness: z.number().int().min(0).max(100),
  dimensions: customerActivityDimensionSnapshotSchema,
  organization: customerActivityOrganizationSnapshotSchema.optional(),
}).strict();

export const organizationActivityThresholdConditionSchema = z.object({
  npcIds: z.array(z.enum(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS))
    .min(1)
    .max(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.length)
    .refine((npcIds) => new Set(npcIds).size === npcIds.length, 'condition NPC IDs must be unique'),
  minCount: z.number().int().min(1).max(CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.length),
  supportMin: z.number().int().min(0).max(100),
  pleasantnessMin: z.number().int().min(0).max(100),
}).strict().superRefine((condition, context) => {
  if (condition.minCount > condition.npcIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['minCount'], message: 'minCount cannot exceed the configured NPC count' });
  }
});

export const organizationActivityThresholdPathSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  conditions: z.array(organizationActivityThresholdConditionSchema).min(1).max(10),
}).strict();

export const organizationActivityThresholdSchema = z.object({
  minimumPleasantness: z.number().int().min(0).max(100),
  paths: z.array(organizationActivityThresholdPathSchema).min(1).max(20),
}).strict().superRefine((threshold, context) => {
  const ids = threshold.paths.map((path) => path.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['paths'], message: 'path IDs must be unique' });
  }
});

export const customerActivityThresholdSchema = z.object({
  supportMin: z.number().int().min(0).max(100).optional(),
  pleasantnessMin: z.number().int().min(0).max(100).optional(),
  organization: organizationActivityThresholdSchema.optional(),
}).strict();

export const activityDecisionConfigSchema = z.object({
  revision: z.number().int().nonnegative(),
  mode: z.enum(['ai', 'numeric']),
  thresholds: z.object({
    technical_meeting: customerActivityThresholdSchema.optional(),
    case_site_visit: customerActivityThresholdSchema.optional(),
    company_visit: customerActivityThresholdSchema.optional(),
    hospitality: customerActivityThresholdSchema.optional(),
  }).strict(),
}).strict().superRefine((config, context) => {
  const hospitality = config.thresholds.hospitality;
  if (hospitality && (hospitality.organization
    || hospitality.supportMin === undefined
    || hospitality.pleasantnessMin === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['thresholds', 'hospitality'],
      message: 'hospitality requires paired single-customer support and pleasantness thresholds',
    });
  }
  if (config.mode !== 'numeric') return;
  for (const type of ORGANIZATION_CUSTOMER_ACTIVITY_TYPES) {
    const threshold = config.thresholds[type];
    if (!threshold?.organization && (threshold?.supportMin === undefined || threshold.pleasantnessMin === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['thresholds', type], message: 'numeric mode requires organization thresholds or both legacy thresholds for every activity type' });
    }
    if ((threshold?.supportMin === undefined) !== (threshold?.pleasantnessMin === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['thresholds', type], message: 'legacy thresholds must be configured together' });
    }
  }
});

export type CustomerActivityRelationshipSnapshot = z.infer<typeof customerActivityRelationshipSnapshotSchema>;
export type CustomerActivityThreshold = z.infer<typeof customerActivityThresholdSchema>;
export type CustomerActivityOrganizationMember = z.infer<typeof customerActivityOrganizationMemberSchema>;
export type CustomerActivityOrganizationSnapshot = z.infer<typeof customerActivityOrganizationSnapshotSchema>;
export type OrganizationActivityThresholdCondition = z.infer<typeof organizationActivityThresholdConditionSchema>;
export type OrganizationActivityThresholdPath = z.infer<typeof organizationActivityThresholdPathSchema>;
export type OrganizationActivityThreshold = z.infer<typeof organizationActivityThresholdSchema>;
export type OrganizationActivityThresholdDecision = {
  decision: 'allow' | 'reject';
  reason: string;
};
export type ActivityDecisionConfig = z.infer<typeof activityDecisionConfigSchema>;
export type CustomerActivityDecisionConfigSnapshot = ActivityDecisionConfig;
export type CustomerActivityDecisionMode = 'customer_confirmed' | 'ai' | 'numeric';
export type CustomerActivityFeasibilityOutcome = 'allow' | 'reject' | 'need_more';

const allOrganizationNpcIds: CustomerActivityOrganizationNpcId[] = [...CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS];

export const RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS: Record<typeof ORGANIZATION_CUSTOMER_ACTIVITY_TYPES[number], OrganizationActivityThreshold> = {
  technical_meeting: {
    minimumPleasantness: 20,
    paths: [
      { id: 'a', label: '技术负责人和实施负责人均支持', conditions: [
        { npcIds: ['P1-002'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
        { npcIds: ['P1-004'], minCount: 1, supportMin: 8, pleasantnessMin: 55 },
      ] },
      { id: 'b', label: '项目牵头人与技术负责人均支持', conditions: [
        { npcIds: ['P1-001'], minCount: 1, supportMin: 15, pleasantnessMin: 55 },
        { npcIds: ['P1-002'], minCount: 1, supportMin: 8, pleasantnessMin: 55 },
      ] },
      { id: 'c', label: '团队整体支持且关键负责人之一支持', conditions: [
        { npcIds: allOrganizationNpcIds, minCount: 3, supportMin: 8, pleasantnessMin: 55 },
        { npcIds: ['P1-002', 'P1-004'], minCount: 1, supportMin: 8, pleasantnessMin: 55 },
      ] },
    ],
  },
  case_site_visit: {
    minimumPleasantness: 20,
    paths: [
      { id: 'a', label: '技术负责人和实施负责人均支持', conditions: [
        { npcIds: ['P1-002'], minCount: 1, supportMin: 15, pleasantnessMin: 55 },
        { npcIds: ['P1-004'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
      ] },
      { id: 'b', label: '项目牵头人与技术负责人均支持', conditions: [
        { npcIds: ['P1-001'], minCount: 1, supportMin: 18, pleasantnessMin: 55 },
        { npcIds: ['P1-002'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
      ] },
      { id: 'c', label: '团队整体支持且关键负责人之一支持', conditions: [
        { npcIds: allOrganizationNpcIds, minCount: 3, supportMin: 12, pleasantnessMin: 55 },
        { npcIds: ['P1-002', 'P1-004'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
      ] },
    ],
  },
  company_visit: {
    minimumPleasantness: 20,
    paths: [
      { id: 'a', label: '项目牵头人与商务负责人均支持', conditions: [
        { npcIds: ['P1-001'], minCount: 1, supportMin: 18, pleasantnessMin: 55 },
        { npcIds: ['P1-003'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
      ] },
      { id: 'b', label: '技术、商务和综合负责人均支持', conditions: [
        { npcIds: ['P1-002'], minCount: 1, supportMin: 15, pleasantnessMin: 55 },
        { npcIds: ['P1-003'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
        { npcIds: ['P1-005'], minCount: 1, supportMin: 8, pleasantnessMin: 55 },
      ] },
      { id: 'c', label: '团队整体支持且项目或商务负责人之一支持', conditions: [
        { npcIds: allOrganizationNpcIds, minCount: 3, supportMin: 12, pleasantnessMin: 55 },
        { npcIds: ['P1-001', 'P1-003'], minCount: 1, supportMin: 12, pleasantnessMin: 55 },
      ] },
    ],
  },
};

export const DEFAULT_ACTIVITY_DECISION_CONFIG: ActivityDecisionConfig = {
  revision: 0,
  mode: 'numeric',
  thresholds: {
    technical_meeting: { organization: RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.technical_meeting },
    case_site_visit: { organization: RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.case_site_visit },
    company_visit: { organization: RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS.company_visit },
    hospitality: { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD },
  },
};

const invalidOrganizationDecision = (): OrganizationActivityThresholdDecision => ({
  decision: 'reject',
  reason: '团队关系信息不完整，当前不具备推进条件。',
});

/** Evaluates the frozen five-person team against an activity's OR-of-ANDs threshold paths. */
export function decideOrganizationActivityThreshold(
  snapshotInput: unknown,
  thresholdInput: unknown,
): OrganizationActivityThresholdDecision {
  const snapshot = customerActivityRelationshipSnapshotSchema.safeParse(snapshotInput);
  const threshold = organizationActivityThresholdSchema.safeParse(thresholdInput);
  if (!snapshot.success || !threshold.success || !snapshot.data.organization) return invalidOrganizationDecision();

  const members = snapshot.data.organization.members;
  if (members.some((member) => member.pleasantness < threshold.data.minimumPleasantness)) {
    return { decision: 'reject', reason: '团队当前关系状态尚未达到推进条件。' };
  }

  for (const path of threshold.data.paths) {
    const satisfiedMembers = new Set<CustomerActivityOrganizationNpcId>();
    let pathSatisfied = true;
    for (const condition of path.conditions) {
      const qualifyingMembers = members.filter((member) => condition.npcIds.includes(member.npcId)
        && member.support >= condition.supportMin
        && member.pleasantness >= condition.pleasantnessMin);
      if (qualifyingMembers.length < condition.minCount) {
        pathSatisfied = false;
        break;
      }
      qualifyingMembers.forEach((member) => satisfiedMembers.add(member.npcId));
    }
    if (pathSatisfied && satisfiedMembers.size >= 2) {
      return { decision: 'allow', reason: '团队当前关系状态支持推进该活动。' };
    }
  }

  return { decision: 'reject', reason: '团队当前关系状态尚未达到推进条件。' };
}

export function parseActivityDecisionConfig(value: unknown): ActivityDecisionConfig | null {
  const parsed = activityDecisionConfigSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    thresholds: {
      ...parsed.data.thresholds,
      hospitality: parsed.data.thresholds.hospitality ?? { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD },
    },
  };
}

export function isActivityDecisionConfig(value: unknown): value is ActivityDecisionConfig {
  return parseActivityDecisionConfig(value) !== null;
}

function hospitalityThreshold(config?: ActivityDecisionConfig): CustomerActivityThreshold {
  return config?.thresholds.hospitality ?? { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD };
}

function meetsHospitalityThreshold(
  snapshot: CustomerActivityRelationshipSnapshot | undefined,
  config: ActivityDecisionConfig | undefined,
): boolean {
  if (!snapshot) return false;
  const threshold = hospitalityThreshold(config);
  return snapshot.support >= threshold.supportMin! && snapshot.pleasantness >= threshold.pleasantnessMin!;
}

export const CUSTOMER_ACTIVITY_PLANNING_MS = 5 * 60 * 1000;
export const CUSTOMER_ACTIVITY_DRAFT_MAX_LENGTH = 12_000;
export const CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES = 120;
export const CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH = 60_000;

export const customerActivityConversationMessageSchema = z.object({
  messageId: z.string().trim().min(1).max(160),
  speaker: z.enum(['sales', 'customer']),
  text: z.string().trim().min(1).max(4000),
}).strict();

export type CustomerActivityDiagnostic = {
  event: string;
  reason?: string;
  activityType?: CustomerActivityType;
  messageId?: string;
  details?: Record<string, unknown>;
};

export const customerActivityEvidenceSchema = z.object({
  messageId: z.string().trim().min(1).max(160),
  speaker: z.enum(['sales', 'customer']),
  kind: z.enum(['proposal', 'acceptance', 'response', 'final_outcome']),
  quote: z.string().trim().min(2).max(400),
}).strict();

export const customerActivityProposalCandidateSchema = z.object({
  conversationId: z.string().trim().min(1).max(200),
  npcId: z.string().trim().min(1).max(128),
  sourceConversation: z.array(customerActivityConversationMessageSchema).min(1).max(CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES),
  type: z.enum(CUSTOMER_ACTIVITY_TYPES),
  initiator: z.enum(['sales', 'customer']),
  proposalMessageId: z.string().trim().min(1).max(160),
  responseMessageId: z.string().trim().min(1).max(160),
  finalOutcomeMessageId: z.string().trim().min(1).max(160),
  responseKind: z.enum(['explicit_acceptance', 'ambiguous', 'not_required']),
  finalStatus: z.literal('active'),
  evidence: z.array(customerActivityEvidenceSchema).min(1).max(3),
  summary: z.string().trim().min(1).max(300),
  requiresFeasibility: z.boolean(),
}).strict().superRefine((candidate, context) => {
  if (candidate.sourceConversation.reduce((length, item) => length + item.text.length, 0) > CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceConversation'], message: 'source conversation is too large' });
  }
});

export const customerActivityFeasibilityDecisionSchema = z.object({
  decision: z.enum(['allow', 'reject', 'need_more']),
  mode: z.enum(['customer_confirmed', 'ai', 'numeric']),
  configRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(300),
}).strict();

export type CustomerActivityProposalCandidate = z.infer<typeof customerActivityProposalCandidateSchema>;
export type CustomerActivityFeasibilityDecision = z.infer<typeof customerActivityFeasibilityDecisionSchema>;

export const customerActivityDimensionDeltasSchema = z.object({
  decisionAnalysis: z.number().int().min(-3).max(3),
  relationshipBuilding: z.number().int().min(-3).max(3),
  valuePresentation: z.number().int().min(-3).max(3),
  objectionHandling: z.number().int().min(-3).max(3),
  informationDiscovery: z.number().int().min(-3).max(3),
}).strict();

export const customerActivityEvaluationSchema = z.object({
  supportDelta: z.number().int().min(-5).max(4),
  pleasureDelta: z.number().int().min(-8).max(6),
  dimensionDeltas: customerActivityDimensionDeltasSchema,
  overallEvaluation: z.string().trim().min(1).max(600),
}).strict();

export const customerActivityAgreementSchema = z.object({
  conversationId: z.string().trim().min(1).max(200),
  npcId: z.string().trim().min(1).max(128),
  sourceConversation: z.array(customerActivityConversationMessageSchema).min(1).max(CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES),
  type: z.enum(CUSTOMER_ACTIVITY_TYPES),
  proposalMessageId: z.string().trim().min(1).max(160),
  agreementMessageId: z.string().trim().min(1).max(160),
  responseMessageId: z.string().trim().min(1).max(160).optional(),
  initiator: z.enum(['sales', 'customer']).optional(),
  responseKind: z.enum(['explicit_acceptance', 'ambiguous', 'not_required']).optional(),
  evidence: z.array(customerActivityEvidenceSchema).min(1).max(3),
  summary: z.string().trim().min(1).max(300),
  relationshipSnapshot: customerActivityRelationshipSnapshotSchema.optional(),
  decisionConfig: activityDecisionConfigSchema.optional(),
  decisionMode: z.enum(['customer_confirmed', 'ai', 'numeric']).optional(),
  decisionRevision: z.number().int().nonnegative().optional(),
  decisionReason: z.string().trim().min(1).max(300).optional(),
}).strict().superRefine((agreement, context) => {
  const totalLength = agreement.sourceConversation.reduce((length, item) => length + item.text.length, 0);
  if (totalLength > CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceConversation'], message: 'source conversation is too large' });
  }
  if (agreement.responseMessageId !== undefined && agreement.responseMessageId !== agreement.agreementMessageId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['responseMessageId'], message: 'responseMessageId must match agreementMessageId' });
  }
  if (agreement.relationshipSnapshot && agreement.relationshipSnapshot.npcId !== agreement.npcId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['relationshipSnapshot', 'npcId'], message: 'snapshot NPC does not match agreement NPC' });
  }
  if ((agreement.decisionMode === undefined) !== (agreement.decisionRevision === undefined)
    || (agreement.decisionMode === undefined) !== (agreement.decisionReason === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'decision metadata must be stored together' });
  }
  if (agreement.decisionConfig && agreement.decisionRevision !== undefined && agreement.decisionConfig.revision !== agreement.decisionRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decisionRevision'], message: 'decision revision must match frozen config' });
  }
  if (agreement.type === 'hospitality'
    && (agreement.decisionMode !== 'numeric'
      || !agreement.decisionConfig
      || !meetsHospitalityThreshold(agreement.relationshipSnapshot, agreement.decisionConfig))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decisionMode'], message: 'hospitality agreements require a qualifying numeric decision for the contacted customer' });
  }
});

export type CustomerActivityEvidence = z.infer<typeof customerActivityEvidenceSchema>;
export type CustomerActivityConversationMessage = z.infer<typeof customerActivityConversationMessageSchema>;
export type CustomerActivityEvaluation = z.infer<typeof customerActivityEvaluationSchema>;
export type CustomerActivityAgreement = z.infer<typeof customerActivityAgreementSchema>;

function requiresNumericCustomerActivityDecision(config: ActivityDecisionConfig, type: CustomerActivityType): boolean {
  return config.mode === 'numeric' || type === 'hospitality';
}

function thresholdForActivity(config: ActivityDecisionConfig, type: CustomerActivityType): CustomerActivityThreshold | undefined {
  if (type === 'hospitality') {
    return config.thresholds.hospitality ?? { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD };
  }
  return config.thresholds[type];
}

export const customerActivityTaskSchema = z.object({
  id: z.string().trim().min(1).max(512),
  idempotencyKey: z.string().trim().min(1).max(512),
  conversationId: z.string().trim().min(1).max(200),
  npcId: z.string().trim().min(1).max(128),
  sourceConversation: z.array(customerActivityConversationMessageSchema).min(1).max(CUSTOMER_ACTIVITY_CONVERSATION_MAX_MESSAGES),
  type: z.enum(CUSTOMER_ACTIVITY_TYPES),
  proposalMessageId: z.string().trim().min(1).max(160),
  agreementMessageId: z.string().trim().min(1).max(160),
  responseMessageId: z.string().trim().min(1).max(160).optional(),
  initiator: z.enum(['sales', 'customer']).optional(),
  responseKind: z.enum(['explicit_acceptance', 'ambiguous', 'not_required']).optional(),
  evidence: z.array(customerActivityEvidenceSchema).min(1).max(3),
  summary: z.string().trim().min(1).max(300),
  relationshipSnapshot: customerActivityRelationshipSnapshotSchema.optional(),
  decisionConfig: activityDecisionConfigSchema.optional(),
  decisionMode: z.enum(['customer_confirmed', 'ai', 'numeric']).optional(),
  decisionRevision: z.number().int().nonnegative().optional(),
  decisionReason: z.string().trim().min(1).max(300).optional(),
  status: z.enum(['pending', 'planning', 'submitted']),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  deadlineAt: z.number().int().nonnegative().optional(),
  draft: z.string().max(CUSTOMER_ACTIVITY_DRAFT_MAX_LENGTH),
  submittedAt: z.number().int().nonnegative().optional(),
  submitReason: z.enum(['manual', 'timeout', 'room_ended']).optional(),
  evaluation: customerActivityEvaluationSchema.optional(),
  evaluatedAt: z.number().int().nonnegative().optional(),
}).strict().superRefine((task, context) => {
  if (task.sourceConversation.reduce((length, item) => length + item.text.length, 0) > CUSTOMER_ACTIVITY_CONVERSATION_MAX_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceConversation'], message: 'source conversation is too large' });
  }
  if (task.status === 'pending' && (task.startedAt !== undefined || task.deadlineAt !== undefined || task.submittedAt !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'pending task cannot have planning timestamps' });
  }
  if (task.status === 'planning' && (task.startedAt === undefined || task.deadlineAt === undefined || task.submittedAt !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'planning task requires start and deadline only' });
  }
  if (task.status === 'submitted' && (task.startedAt === undefined || task.deadlineAt === undefined || task.submittedAt === undefined || task.submitReason === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'submitted task requires planning and submission timestamps' });
  }
  if ((task.evaluation === undefined) !== (task.evaluatedAt === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'evaluation and settlement timestamp must be stored together' });
  }
  if (task.responseMessageId !== undefined && task.responseMessageId !== task.agreementMessageId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['responseMessageId'], message: 'responseMessageId must match agreementMessageId' });
  }
  if (task.relationshipSnapshot && task.relationshipSnapshot.npcId !== task.npcId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['relationshipSnapshot', 'npcId'], message: 'snapshot NPC does not match task NPC' });
  }
  if ((task.decisionMode === undefined) !== (task.decisionRevision === undefined)
    || (task.decisionMode === undefined) !== (task.decisionReason === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'decision metadata must be stored together' });
  }
  if (task.decisionConfig && task.decisionRevision !== undefined && task.decisionConfig.revision !== task.decisionRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decisionRevision'], message: 'decision revision must match frozen config' });
  }
  if (task.type === 'hospitality'
    && (task.decisionMode !== 'numeric'
      || !task.decisionConfig
      || !meetsHospitalityThreshold(task.relationshipSnapshot, task.decisionConfig))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decisionMode'], message: 'hospitality tasks require a qualifying numeric decision for the contacted customer' });
  }
});

export const customerActivityDecisionRecordSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(512),
  conversationId: z.string().trim().min(1).max(200),
  npcId: z.string().trim().min(1).max(128),
  type: z.enum(CUSTOMER_ACTIVITY_TYPES),
  initiator: z.enum(['sales', 'customer']),
  proposalMessageId: z.string().trim().min(1).max(160),
  responseMessageId: z.string().trim().min(1).max(160),
  decision: z.enum(['allow', 'reject', 'need_more']),
  mode: z.enum(['customer_confirmed', 'ai', 'numeric']),
  configRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(300),
  decidedAt: z.number().int().nonnegative(),
  relationshipSnapshot: customerActivityRelationshipSnapshotSchema,
  decisionConfig: activityDecisionConfigSchema,
}).strict().superRefine((record, context) => {
  if (record.relationshipSnapshot.npcId !== record.npcId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['relationshipSnapshot', 'npcId'], message: 'snapshot NPC does not match decision NPC' });
  }
  if (record.decisionConfig.revision !== record.configRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['configRevision'], message: 'decision revision must match frozen config' });
  }
  if (record.mode === 'customer_confirmed' && record.initiator !== 'customer') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'only customer-initiated proposals can use direct confirmation' });
  }
  if (record.type === 'hospitality') {
    const expectedDecision = meetsHospitalityThreshold(record.relationshipSnapshot, record.decisionConfig) ? 'allow' : 'reject';
    if (record.mode !== 'numeric' || record.decision !== expectedDecision) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'hospitality decisions must match the contacted customer numeric threshold' });
    }
  }
  if (record.mode !== 'customer_confirmed'
    && record.decisionConfig.mode !== record.mode
    && !(record.type === 'hospitality' && record.mode === 'numeric')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mode'], message: 'decision mode must match frozen config' });
  }
});

export const customerActivityStateSchema = z.object({
  version: z.literal(1),
  tasks: z.array(customerActivityTaskSchema).max(100),
  decisions: z.array(customerActivityDecisionRecordSchema).max(1_000).default([]),
}).strict();

export type CustomerActivityTask = z.infer<typeof customerActivityTaskSchema>;
export type CustomerActivityState = z.infer<typeof customerActivityStateSchema>;
export type CustomerActivityDecisionRecord = z.infer<typeof customerActivityDecisionRecordSchema>;

export type PublicCustomerActivityTask = Omit<CustomerActivityTask,
  | 'idempotencyKey'
  | 'proposalMessageId'
  | 'agreementMessageId'
  | 'responseMessageId'
  | 'initiator'
  | 'responseKind'
  | 'evidence'
  | 'sourceConversation'
  | 'relationshipSnapshot'
  | 'decisionConfig'
  | 'decisionMode'
  | 'decisionRevision'
  | 'decisionReason'
  | 'evaluation'
> & {
  basis: string[];
  evaluation?: Pick<CustomerActivityEvaluation, 'overallEvaluation'>;
};

export type CustomerActivityPlanningAction = 'manual' | 'timeout' | 'room_ended';

/** A short player-facing outcome, intentionally independent of model commentary. */
export function getPublicCustomerActivityOutcome(
  draft: string,
  evaluation: Pick<CustomerActivityEvaluation, 'supportDelta' | 'pleasureDelta'>,
): string {
  if (!draft.trim()) return '活动准备不充分，本次未能推进。';

  const { supportDelta, pleasureDelta } = evaluation;
  if (supportDelta === 0 && pleasureDelta === 0) return '本次方案暂未带来进一步推进。';
  if (supportDelta >= 0 && pleasureDelta >= 0) return '本次方案有助于推进后续活动沟通。';
  if (supportDelta <= 0 && pleasureDelta <= 0) return '本次方案未能推动后续活动沟通。';
  return '本次方案对后续活动沟通的推动作用有限。';
}

export function createEmptyCustomerActivityState(): CustomerActivityState {
  return { version: 1, tasks: [], decisions: [] };
}

/** Safely upgrades missing or malformed optional activity JSON to a usable state. */
export function readCustomerActivityState(value: unknown): CustomerActivityState {
  if (value === null || value === undefined) return createEmptyCustomerActivityState();
  const parsed = customerActivityStateSchema.safeParse(value);
  if (!parsed.success) throw new Error('INVALID_CUSTOMER_ACTIVITY_STATE');
  return parsed.data;
}

export const parseCustomerActivityState = readCustomerActivityState;

export function isCustomerActivityState(value: unknown): value is CustomerActivityState {
  return customerActivityStateSchema.safeParse(value).success;
}

function makeActivityId(conversationId: string, type: CustomerActivityType): string {
  const identity = `${conversationId}\u0000${type}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `customer-activity:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}:${type}`;
}

function makeIdentityKey(...parts: string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

function validAgreement(value: CustomerActivityAgreement): CustomerActivityAgreement | null {
  const parsed = customerActivityAgreementSchema.safeParse(value);
  if (!parsed.success) return null;
  const agreement = parsed.data;
  const proposal = agreement.evidence.find((item) => item.kind === 'proposal');
  const acceptance = agreement.evidence.find((item) => item.kind === 'acceptance' || item.kind === 'response');
  const outcome = agreement.evidence.find((item) => item.kind === 'final_outcome');
  const salesProposalOnly = agreement.initiator === 'sales' && agreement.responseKind === 'not_required';
  if (!proposal || (salesProposalOnly ? (acceptance || outcome) : (!acceptance || !outcome))) return null;
  if (agreement.initiator === 'sales'
    && (!['ambiguous', 'not_required'].includes(agreement.responseKind ?? '') || agreement.decisionMode === undefined
      || agreement.decisionMode === 'customer_confirmed' || !agreement.relationshipSnapshot || !agreement.decisionConfig)) return null;
  if (agreement.initiator === 'customer' && agreement.responseKind !== undefined
    && agreement.responseKind !== 'explicit_acceptance') return null;
  if (proposal.messageId !== agreement.proposalMessageId) return null;
  if (salesProposalOnly) {
    const proposalSource = agreement.sourceConversation.find((message) => message.messageId === proposal.messageId);
    if (agreement.agreementMessageId !== proposal.messageId || agreement.responseMessageId !== undefined
      || agreement.evidence.length !== 1 || proposal.speaker !== 'sales' || !proposalSource
      || proposalSource.speaker !== 'sales' || !proposalSource.text.includes(proposal.quote)) return null;
    return agreement;
  }
  if (!acceptance || !outcome || proposal.messageId === agreement.agreementMessageId || acceptance.messageId !== agreement.agreementMessageId) return null;
  if (agreement.responseMessageId !== undefined && acceptance.messageId !== agreement.responseMessageId) return null;
  if (proposal.speaker === acceptance.speaker) return null;
  const messageIndexes = new Map(agreement.sourceConversation.map((message, index) => [message.messageId, index]));
  const sourceById = new Map(agreement.sourceConversation.map((message) => [message.messageId, message]));
  const proposalSource = sourceById.get(proposal.messageId);
  const acceptanceSource = sourceById.get(acceptance.messageId);
  const outcomeSource = sourceById.get(outcome.messageId);
  if (!proposalSource || !acceptanceSource || !outcomeSource) return null;
  if (proposalSource.speaker !== proposal.speaker || acceptanceSource.speaker !== acceptance.speaker || outcomeSource.speaker !== outcome.speaker) return null;
  if (!proposalSource.text.includes(proposal.quote) || !acceptanceSource.text.includes(acceptance.quote) || !outcomeSource.text.includes(outcome.quote)) return null;
  if ((messageIndexes.get(proposal.messageId) ?? Infinity) >= (messageIndexes.get(acceptance.messageId) ?? -1)) return null;
  if ((messageIndexes.get(outcome.messageId) ?? -1) < (messageIndexes.get(acceptance.messageId) ?? Infinity)) return null;
  if (outcome.messageId !== acceptance.messageId && outcome.speaker !== proposal.speaker && outcome.speaker !== acceptance.speaker) return null;
  return agreement;
}

function validCustomerActivityProposalCandidate(value: CustomerActivityProposalCandidate): CustomerActivityProposalCandidate | null {
  const parsed = customerActivityProposalCandidateSchema.safeParse(value);
  if (!parsed.success) return null;
  const candidate = parsed.data;
  if (candidate.requiresFeasibility !== (candidate.initiator === 'sales')) return null;
  if (candidate.initiator === 'customer' && candidate.responseKind !== 'explicit_acceptance') return null;
  if (candidate.initiator === 'sales' && !['ambiguous', 'not_required'].includes(candidate.responseKind)) return null;
  const proposal = candidate.evidence.find((item) => item.kind === 'proposal');
  const response = candidate.evidence.find((item) => item.kind === 'response');
  const finalOutcome = candidate.evidence.find((item) => item.kind === 'final_outcome');
  if (!proposal) return null;
  if (candidate.initiator === 'sales' && candidate.responseKind === 'not_required') {
    if (response || finalOutcome || candidate.evidence.length !== 1
      || candidate.responseMessageId !== proposal.messageId || candidate.finalOutcomeMessageId !== proposal.messageId
      || candidate.proposalMessageId !== proposal.messageId || proposal.speaker !== 'sales') return null;
    const original = candidate.sourceConversation.find((message) => message.messageId === proposal.messageId);
    return original && original.speaker === 'sales' && original.text.includes(proposal.quote) ? candidate : null;
  }
  if (!response || !finalOutcome) return null;
  if (proposal.messageId !== candidate.proposalMessageId || response.messageId !== candidate.responseMessageId
    || finalOutcome.messageId !== candidate.finalOutcomeMessageId) return null;
  if (proposal.speaker !== candidate.initiator || response.speaker === candidate.initiator) return null;
  const indexes = new Map(candidate.sourceConversation.map((message, index) => [message.messageId, index]));
  const source = new Map(candidate.sourceConversation.map((message) => [message.messageId, message]));
  for (const item of [proposal, response, finalOutcome]) {
    const original = source.get(item.messageId);
    if (!original || original.speaker !== item.speaker || !original.text.includes(item.quote)) return null;
  }
  const proposalIndex = indexes.get(proposal.messageId) ?? Infinity;
  const responseIndex = indexes.get(response.messageId) ?? -1;
  const outcomeIndex = indexes.get(finalOutcome.messageId) ?? -1;
  if (proposalIndex >= responseIndex || outcomeIndex < responseIndex) return null;
  if (finalOutcome.speaker !== candidate.initiator && finalOutcome.speaker !== response.speaker) return null;
  return candidate;
}

export function validateCustomerActivityProposalCandidate(value: unknown): CustomerActivityProposalCandidate | null {
  return validCustomerActivityProposalCandidate(value as CustomerActivityProposalCandidate);
}

/** Converts a source-verified proposal into a task agreement only after an allow decision. */
export function createResolvedCustomerActivityAgreement(
  candidateInput: CustomerActivityProposalCandidate,
  snapshotInput: CustomerActivityRelationshipSnapshot,
  configInput: ActivityDecisionConfig,
  decisionInput: CustomerActivityFeasibilityDecision,
): CustomerActivityAgreement | null {
  const candidate = validCustomerActivityProposalCandidate(candidateInput);
  const snapshot = customerActivityRelationshipSnapshotSchema.safeParse(snapshotInput);
  const config = parseActivityDecisionConfig(configInput);
  const decision = customerActivityFeasibilityDecisionSchema.safeParse(decisionInput);
  if (!candidate || !snapshot.success || !config || !decision.success || decision.data.decision !== 'allow') return null;
  if (snapshot.data.npcId !== candidate.npcId || decision.data.configRevision !== config.revision) return null;
  const numericDecisionRequired = requiresNumericCustomerActivityDecision(config, candidate.type);
  const expectedMode: CustomerActivityDecisionMode = numericDecisionRequired
    ? 'numeric'
    : candidate.requiresFeasibility ? config.mode : 'customer_confirmed';
  if (decision.data.mode !== expectedMode) return null;
  if (numericDecisionRequired) {
    const threshold = thresholdForActivity(config, candidate.type);
    if (!threshold) return null;
    if (threshold.organization) {
      if (decideOrganizationActivityThreshold(snapshot.data, threshold.organization).decision !== decision.data.decision) return null;
    } else {
      if (threshold.supportMin === undefined || threshold.pleasantnessMin === undefined) return null;
      const expectedDecision = snapshot.data.support >= threshold.supportMin && snapshot.data.pleasantness >= threshold.pleasantnessMin
        ? 'allow'
        : 'reject';
      if (decision.data.decision !== expectedDecision) return null;
    }
  }
  const salesProposalOnly = candidate.initiator === 'sales' && candidate.responseKind === 'not_required';
  const agreement = customerActivityAgreementSchema.safeParse({
    conversationId: candidate.conversationId,
    npcId: candidate.npcId,
    sourceConversation: candidate.sourceConversation,
    type: candidate.type,
    proposalMessageId: candidate.proposalMessageId,
    agreementMessageId: salesProposalOnly ? candidate.proposalMessageId : candidate.responseMessageId,
    ...(salesProposalOnly ? {} : { responseMessageId: candidate.responseMessageId }),
    initiator: candidate.initiator,
    responseKind: candidate.responseKind,
    evidence: candidate.evidence,
    summary: candidate.summary,
    relationshipSnapshot: snapshot.data,
    decisionConfig: config,
    decisionMode: decision.data.mode,
    decisionRevision: decision.data.configRevision,
    decisionReason: decision.data.reason,
  });
  return agreement.success && validAgreement(agreement.data) ? agreement.data : null;
}

/** Adds at most one activity of each type per ended conversation; safe to replay. */
export function createCustomerActivityTasks(
  stateInput: unknown,
  agreements: CustomerActivityAgreement[],
  serverNow: number,
): CustomerActivityState {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return state;
  const tasks = [...state.tasks];
  const keys = new Set(tasks.map((task) => task.idempotencyKey));
  const conversationTypes = new Set(tasks.map((task) => `${task.conversationId}\u0000${task.type}`));
  const acceptedMessages = new Set(tasks.map((task) => makeIdentityKey(task.npcId, task.type, task.agreementMessageId)));
  const proposalMessages = new Set(tasks.map((task) => makeIdentityKey(task.npcId, task.type, task.proposalMessageId)));
  for (const candidate of agreements) {
    const agreement = validAgreement(candidate);
    if (!agreement) continue;
    const idempotencyKey = makeIdentityKey(agreement.npcId, agreement.type, agreement.agreementMessageId);
    const activityKey = makeIdentityKey(agreement.npcId, agreement.type, agreement.proposalMessageId);
    const conversationTypeKey = makeIdentityKey(agreement.conversationId, agreement.type);
    if (keys.has(idempotencyKey) || acceptedMessages.has(idempotencyKey) || proposalMessages.has(activityKey) || conversationTypes.has(conversationTypeKey)) continue;
    const id = makeActivityId(agreement.conversationId, agreement.type);
    tasks.push({
      id,
      idempotencyKey,
      conversationId: agreement.conversationId,
      npcId: agreement.npcId,
      sourceConversation: agreement.sourceConversation,
      type: agreement.type,
      proposalMessageId: agreement.proposalMessageId,
      agreementMessageId: agreement.agreementMessageId,
      ...(agreement.responseMessageId === undefined ? {} : { responseMessageId: agreement.responseMessageId }),
      ...(agreement.initiator === undefined ? {} : { initiator: agreement.initiator }),
      ...(agreement.responseKind === undefined ? {} : { responseKind: agreement.responseKind }),
      evidence: agreement.evidence,
      summary: agreement.summary,
      ...(agreement.relationshipSnapshot === undefined ? {} : { relationshipSnapshot: agreement.relationshipSnapshot }),
      ...(agreement.decisionConfig === undefined ? {} : { decisionConfig: agreement.decisionConfig }),
      ...(agreement.decisionMode === undefined ? {} : { decisionMode: agreement.decisionMode }),
      ...(agreement.decisionRevision === undefined ? {} : { decisionRevision: agreement.decisionRevision }),
      ...(agreement.decisionReason === undefined ? {} : { decisionReason: agreement.decisionReason }),
      status: 'pending',
      createdAt: Math.floor(serverNow),
      draft: '',
    });
    keys.add(idempotencyKey);
    acceptedMessages.add(idempotencyKey);
    proposalMessages.add(activityKey);
    conversationTypes.add(conversationTypeKey);
  }
  return customerActivityStateSchema.parse({ version: 1, tasks, decisions: state.decisions });
}

function proposalDecisionKey(candidate: Pick<CustomerActivityProposalCandidate, 'npcId' | 'type' | 'proposalMessageId'>): string {
  return `proposal:${makeIdentityKey(candidate.npcId, candidate.type, candidate.proposalMessageId)}`;
}

/** Persists each normal decision once and creates a task only for allow. Provider errors must be handled before this call. */
export function recordCustomerActivityProposalDecision(
  stateInput: unknown,
  candidateInput: CustomerActivityProposalCandidate,
  snapshotInput: CustomerActivityRelationshipSnapshot,
  configInput: ActivityDecisionConfig,
  decisionInput: CustomerActivityFeasibilityDecision,
  serverNow: number,
): { state: CustomerActivityState; recorded: boolean; task?: CustomerActivityTask } {
  const state = readCustomerActivityState(stateInput);
  const candidate = validCustomerActivityProposalCandidate(candidateInput);
  const snapshot = customerActivityRelationshipSnapshotSchema.safeParse(snapshotInput);
  const config = parseActivityDecisionConfig(configInput);
  const decision = customerActivityFeasibilityDecisionSchema.safeParse(decisionInput);
  if (!Number.isFinite(serverNow) || serverNow < 0 || !candidate || !snapshot.success || !config || !decision.success) {
    return { state, recorded: false };
  }
  if (snapshot.data.npcId !== candidate.npcId || decision.data.configRevision !== config.revision) return { state, recorded: false };
  const numericDecisionRequired = requiresNumericCustomerActivityDecision(config, candidate.type);
  const expectedMode: CustomerActivityDecisionMode = numericDecisionRequired
    ? 'numeric'
    : candidate.requiresFeasibility ? config.mode : 'customer_confirmed';
  if (decision.data.mode !== expectedMode) return { state, recorded: false };
  if (!candidate.requiresFeasibility && !numericDecisionRequired && decision.data.decision !== 'allow') return { state, recorded: false };
  if (numericDecisionRequired) {
    const threshold = thresholdForActivity(config, candidate.type);
    if (!threshold) return { state, recorded: false };
    const expected = threshold.organization
      ? decideOrganizationActivityThreshold(snapshot.data, threshold.organization).decision
      : threshold.supportMin !== undefined && threshold.pleasantnessMin !== undefined
        && snapshot.data.support >= threshold.supportMin && snapshot.data.pleasantness >= threshold.pleasantnessMin ? 'allow' : 'reject';
    if (decision.data.decision !== expected) return { state, recorded: false };
  }

  const idempotencyKey = proposalDecisionKey(candidate);
  if (state.decisions.some((record) => record.idempotencyKey === idempotencyKey)) return { state, recorded: false };
  if (state.decisions.length >= 1_000) return { state, recorded: false };
  const record = customerActivityDecisionRecordSchema.safeParse({
    idempotencyKey,
    conversationId: candidate.conversationId,
    npcId: candidate.npcId,
    type: candidate.type,
    initiator: candidate.initiator,
    proposalMessageId: candidate.proposalMessageId,
    responseMessageId: candidate.responseMessageId,
    decision: decision.data.decision,
    mode: decision.data.mode,
    configRevision: decision.data.configRevision,
    reason: decision.data.reason,
    decidedAt: Math.floor(serverNow),
    relationshipSnapshot: snapshot.data,
    decisionConfig: config,
  });
  if (!record.success) return { state, recorded: false };
  const withRecord = customerActivityStateSchema.parse({
    version: 1,
    tasks: state.tasks,
    decisions: [...state.decisions, record.data],
  });
  if (decision.data.decision !== 'allow') return { state: withRecord, recorded: true };
  const agreement = createResolvedCustomerActivityAgreement(candidate, snapshot.data, config, decision.data);
  if (!agreement) return { state, recorded: false };
  const withTask = createCustomerActivityTasks(withRecord, [agreement], serverNow);
  const taskKey = makeIdentityKey(candidate.npcId, candidate.type, candidate.responseMessageId);
  const task = withTask.tasks.find((item) => item.idempotencyKey === taskKey);
  return { state: withTask, recorded: true, ...(task ? { task } : {}) };
}

/** Starts only the first pending task. Repeating the call never resets its server deadline. */
export function startCustomerActivityPlanning(
  stateInput: unknown,
  taskId: string,
  serverNow: number,
): CustomerActivityState {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0 || state.tasks.some((task) => task.status === 'planning')) return state;
  const nextPending = state.tasks.find((task) => task.status === 'pending');
  if (!nextPending || nextPending.id !== taskId) return state;
  const startedAt = Math.floor(serverNow);
  return {
    version: 1,
    decisions: state.decisions,
    tasks: state.tasks.map((task) => task.id === taskId
      ? { ...task, status: 'planning', startedAt, deadlineAt: startedAt + CUSTOMER_ACTIVITY_PLANNING_MS }
      : task),
  };
}

function markSubmitted(task: CustomerActivityTask, serverNow: number, reason: CustomerActivityPlanningAction): CustomerActivityTask {
  return { ...task, status: 'submitted', submittedAt: Math.floor(serverNow), submitReason: reason };
}

/** Commits any expired task using only the draft last saved by the server. */
export function finalizeExpiredCustomerActivities(stateInput: unknown, serverNow: number): CustomerActivityState {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return state;
  let changed = false;
  const tasks = state.tasks.map((task) => {
    if (task.status !== 'planning' || task.deadlineAt === undefined || serverNow < task.deadlineAt) return task;
    changed = true;
    return markSubmitted(task, task.deadlineAt, 'timeout');
  });
  return changed ? { version: 1, tasks, decisions: state.decisions } : state;
}

/** Saves drafts on the server; after deadline only the previous saved draft can be submitted. */
export function saveCustomerActivityDraft(
  stateInput: unknown,
  taskId: string,
  draft: string,
  serverNow: number,
): { state: CustomerActivityState; accepted: boolean } {
  let state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return { state, accepted: false };
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== 'planning') return { state, accepted: false };
  if (task.deadlineAt !== undefined && serverNow >= task.deadlineAt) {
    state = finalizeExpiredCustomerActivities(state, serverNow);
    return { state, accepted: false };
  }
  if (typeof draft !== 'string' || draft.length > CUSTOMER_ACTIVITY_DRAFT_MAX_LENGTH) return { state, accepted: false };
  const nextDraft = draft;
  return {
    state: {
      version: 1,
      decisions: state.decisions,
      tasks: state.tasks.map((item) => item.id === taskId ? { ...item, draft: nextDraft } : item),
    },
    accepted: true,
  };
}

/** Allows early submission; replay after submission is an idempotent no-op. */
export function submitCustomerActivityPlan(
  stateInput: unknown,
  taskId: string,
  serverNow: number,
): CustomerActivityState {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return state;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== 'planning') return state;
  if (task.deadlineAt !== undefined && serverNow >= task.deadlineAt) return finalizeExpiredCustomerActivities(state, serverNow);
  return {
    version: 1,
    decisions: state.decisions,
    tasks: state.tasks.map((item) => item.id === taskId ? markSubmitted(item, serverNow, 'manual') : item),
  };
}

/** Ends an active planning window with its server-saved draft when its room closes. */
export function finishCustomerActivityPlanningOnRoomEnd(stateInput: unknown, serverNow: number): CustomerActivityState {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return state;
  let changed = false;
  const now = Math.floor(serverNow);
  const tasks = state.tasks.map((task) => {
    if (task.status !== 'planning' || task.deadlineAt === undefined) return task;
    changed = true;
    if (now >= task.deadlineAt) return markSubmitted(task, task.deadlineAt, 'timeout');
    return markSubmitted(task, now, 'room_ended');
  });
  return changed ? { version: 1, tasks, decisions: state.decisions } : state;
}

/** Stores an evaluation marker exactly once, after submission. Apply the deltas in the same session transaction. */
export function recordCustomerActivityEvaluation(
  stateInput: unknown,
  taskId: string,
  evaluationInput: CustomerActivityEvaluation,
  serverNow: number,
): { state: CustomerActivityState; applied: boolean } {
  const state = readCustomerActivityState(stateInput);
  if (!Number.isFinite(serverNow) || serverNow < 0) return { state, applied: false };
  const evaluationResult = customerActivityEvaluationSchema.safeParse(evaluationInput);
  if (!evaluationResult.success) return { state, applied: false };
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== 'submitted' || task.evaluation) return { state, applied: false };
  return {
    state: {
      version: 1,
      decisions: state.decisions,
      tasks: state.tasks.map((item) => item.id === taskId
        ? { ...item, evaluation: evaluationResult.data, evaluatedAt: Math.floor(serverNow) }
        : item),
    },
    applied: true,
  };
}

export function toPublicCustomerActivityTask(taskInput: CustomerActivityTask): PublicCustomerActivityTask {
  const task = customerActivityTaskSchema.parse(taskInput);
  return {
    id: task.id,
    conversationId: task.conversationId,
    npcId: task.npcId,
    type: task.type,
    summary: task.summary,
    status: task.status,
    createdAt: task.createdAt,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.deadlineAt === undefined ? {} : { deadlineAt: task.deadlineAt }),
    draft: task.draft,
    ...(task.submittedAt === undefined ? {} : { submittedAt: task.submittedAt }),
    ...(task.submitReason === undefined ? {} : { submitReason: task.submitReason }),
    ...(task.evaluation === undefined ? {} : {
      evaluation: {
        overallEvaluation: getPublicCustomerActivityOutcome(task.draft, task.evaluation),
      },
    }),
    basis: task.evidence
      .filter((item) => item.kind === 'proposal' || item.kind === 'acceptance' || item.kind === 'response')
      .map((item) => item.quote),
  };
}
