import { z } from 'zod';

/** Shared scenario preset shown in the workbench and supplied to both model tracks. */
export const PROMPT_TEST_SCENARIO = {
  npc: { id: 'P1-001', name: '张建国', title: '主管副总经理' },
  familiarity: '中',
  mode: '实际当面拜访',
  relationshipSummary: '双方已有基础工作关系，张建国愿意继续听取方案，但尚未形成明确推进承诺。',
  priorContacts: [
    '第一次接触：完成项目背景和决策角色的初步沟通；张建国明确重大决策必须有可验证的业务价值，不能只讲产品能力。',
    '第二次接触：围绕实施与协同风险做了初步交流；张建国重点追问跨部门落地、升级责任和未达标时的闭环方式。',
  ],
  rememberedFacts: [
    '玩家此前表达过愿意用阶段性验证和书面留痕降低项目风险。',
    '张建国关注投入产出、实施风险、责任边界和跨部门落地，并会持续核对承诺是否兑现。',
    '当前仍缺少足够具体的责任人、验收证据和异常升级机制，不能视为已经解决。',
  ],
  currentFocus: '本次拜访需要把价值、责任、风险闭环或正式下一步说具体；空泛宣传不会显著提升支持度。',
  informationBoundary: '张建国不披露内部评审倾向、底价或其他供应商信息，不承诺中标，也不接受私下利益或绕开程序。',
  // This is the only initial verified improvement. It is evidence-backed and formally authorized for N3 discussion.
  verifiedImprovement: {
    id: 'verified_improvement_huadong_escalation',
    category: 'P005',
    value: '华东试点的异常升级闭环已完成两周复核，平均升级时长由 6 小时降至 2 小时。',
    evidence: '业务、采购共同签字的阶段验收单和两周复核记录。',
    isReal: true,
    isVerified: true,
    isFormallyAuthorized: true,
  },
  initialState: { support: 55, pleasantness: 52, effectiveContactCount: 2, node: 'N3', conversationStage: '开场' },
} as const;

/** The prompt test intentionally exposes one fixed NPC and one contact mode. */
export const promptTestProviderSchema = z.enum(['deepseek', 'doubao']);
export type PromptTestProvider = z.infer<typeof promptTestProviderSchema>;

export const promptTestNpcIdSchema = z.literal('P1-001');
export type PromptTestNpcId = z.infer<typeof promptTestNpcIdSchema>;

export const promptTestVisitModeSchema = z.literal('in_person');
export type PromptTestVisitMode = z.infer<typeof promptTestVisitModeSchema>;

/**
 * Designer-owned adjustments for the Zhang Jianguo test prompt. They are sent
 * with every request rather than stored on the server, so a local draft can be
 * tested immediately without changing the shared scenario or another user's
 * test session. The AI service still applies its safety, information and state
 * rules ahead of these editorial settings.
 */
export const promptTestNpcPromptConfigSchema = z.object({
  rolePositioning: z.string().trim().max(1_200, '角色定位不能超过 1200 字'),
  responsibilityBoundary: z.string().trim().max(1_500, '职责边界不能超过 1500 字'),
  replyStyle: z.string().trim().max(1_500, '回复长度与风格不能超过 1500 字'),
  allowedActions: z.string().trim().max(1_500, '允许动作不能超过 1500 字'),
  additionalInstructions: z.string().trim().max(2_000, '附加提示词不能超过 2000 字'),
}).strict();
export type PromptTestNpcPromptConfig = z.infer<typeof promptTestNpcPromptConfigSchema>;

export const DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG: PromptTestNpcPromptConfig = {
  rolePositioning: '张建国是主管副总经理。作为高层领导，他判断方向、边界和是否进入正式流程，不代替业务、采购或项目团队讨论执行细节。',
  responsibilityBoundary: '面对指标、验收、责任人、SLA、实施方案等细节，张建国只简短接收并转交相关部门核验或对接；不在现场逐项追问、共同设计或给出执行承诺。',
  replyStyle: '原则上 1—2 句，不超过 180 字。开门见山、职业克制，先给判断或边界，再给一个正式的后续方向；避免长篇解释、细节争论和反复追问。',
  allowedActions: '可以简短确认材料已收到、指出是否值得进入正式流程、要求交相关部门核验或对接、说明授权边界、结束本轮沟通。',
  additionalInstructions: '',
};

const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'sessionId 格式无效').optional();
const commandIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12,128}$/, 'commandId 格式无效');
const playerTextSchema = z.string().trim().min(1, '请输入玩家话术').max(2_000, '玩家话术不能超过 2000 字');
const expectedVersionSchema = z.number().int().min(0).max(10_000);

const commonRequestSchema = z.object({
  sessionId: sessionIdSchema,
  provider: promptTestProviderSchema,
  npcId: promptTestNpcIdSchema,
  visitMode: promptTestVisitModeSchema,
  commandId: commandIdSchema,
  expectedVersion: expectedVersionSchema,
  npcPromptConfig: promptTestNpcPromptConfigSchema.optional(),
}).strict();

export const promptTestRequestSchema = z.discriminatedUnion('action', [
  commonRequestSchema.extend({ action: z.literal('run'), text: playerTextSchema }),
  commonRequestSchema.extend({ action: z.literal('reset') }),
  commonRequestSchema.extend({ action: z.literal('end_visit') }),
]);
export type PromptTestRequest = z.infer<typeof promptTestRequestSchema>;

const dimensionNames = [
  'decisionAnalysis',
  'relationshipBuilding',
  'valuePresentation',
  'objectionHandling',
  'informationDiscovery',
] as const;

export const promptTestDimensionDeltasSchema = z.object(Object.fromEntries(
  dimensionNames.map((name) => [name, z.number().int().min(-3).max(3)]),
) as Record<(typeof dimensionNames)[number], z.ZodNumber>).strict();
export type PromptTestDimensionDeltas = z.infer<typeof promptTestDimensionDeltasSchema>;

export const promptTestDimensionScoresSchema = z.object(Object.fromEntries(
  dimensionNames.map((name) => [name, z.number().int().min(0).max(100)]),
) as Record<(typeof dimensionNames)[number], z.ZodNumber>).strict();
export type PromptTestDimensionScores = z.infer<typeof promptTestDimensionScoresSchema>;

export const promptTestClueSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(300),
  sourceQuote: z.string().trim().min(1).max(500),
  novel: z.boolean(),
  actionable: z.boolean(),
}).strict();
export type PromptTestClue = z.infer<typeof promptTestClueSchema>;

export const promptTestBlockerUpdateSchema = z.object({
  action: z.enum(['add', 'remove']),
  id: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(300),
}).strict();

/** Evaluator output is intentionally deltas-only; it cannot write state fields. */
export const promptTestEvaluatorSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  supportDelta: z.number().int().min(-8).max(6),
  pleasantnessDelta: z.number().int().min(-8).max(6),
  dimensionDeltas: promptTestDimensionDeltasSchema,
  effectiveContact: z.boolean(),
  newClues: z.array(promptTestClueSchema).max(5),
  blockerUpdates: z.array(promptTestBlockerUpdateSchema).max(4),
}).strict();
export type PromptTestEvaluator = z.infer<typeof promptTestEvaluatorSchema>;

export const promptTestNodeSchema = z.enum(['N1', 'N2', 'N3', 'N4', 'BLOCKED']);
export type PromptTestNode = z.infer<typeof promptTestNodeSchema>;

/** Deterministic five-step dialogue state, exposed to the test workbench. */
export const promptTestConversationStageSchema = z.enum(['开场', '提问', '回应', '异议', '结尾']);
export type PromptTestConversationStage = z.infer<typeof promptTestConversationStageSchema>;

const promptTestDisclosureCategorySchema = z.enum([
  'P001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008', 'P009', 'P010',
  'P011', 'P012', 'P013', 'P014', 'P015', 'P016', 'P017', 'P018', 'P019', 'P020',
  'P021', 'P022', 'P023', 'P024', 'P025', 'P026', 'P027', 'P028', 'P029', 'P030',
]);
export const promptTestVerifiedImprovementSchema = z.object({
  id: z.string().trim().min(1).max(80),
  category: promptTestDisclosureCategorySchema,
  value: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(500),
  isReal: z.literal(true),
  isVerified: z.literal(true),
  isFormallyAuthorized: z.literal(true),
}).strict();
export type PromptTestVerifiedImprovement = z.infer<typeof promptTestVerifiedImprovementSchema>;

export const promptTestEndReasonSchema = z.enum(['player_farewell', 'manual_end']);
export type PromptTestEndReason = z.infer<typeof promptTestEndReasonSchema>;

export const promptTestRuntimeSchema = z.object({
  turn: z.number().int().min(0).max(100),
  support: z.number().int().min(0).max(100),
  pleasantness: z.number().int().min(0).max(100),
  effectiveContactCount: z.number().int().min(0).max(100),
  node: promptTestNodeSchema,
  conversationStage: promptTestConversationStageSchema,
  verifiedImprovement: promptTestVerifiedImprovementSchema,
  dimensionScores: promptTestDimensionScoresSchema,
  clues: z.array(promptTestClueSchema).max(50),
  activeBlockers: z.array(z.string().min(1).max(80)).max(20),
  ended: z.boolean(),
  endReason: promptTestEndReasonSchema.optional(),
}).strict();
export type PromptTestRuntime = z.infer<typeof promptTestRuntimeSchema>;

export const promptTestMessageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(['player', 'npc']),
  text: z.string().min(1).max(2_000),
  turn: z.number().int().min(1).max(100),
}).strict();
export type PromptTestMessage = z.infer<typeof promptTestMessageSchema>;

export const promptTestChangesSchema = z.object({
  supportDelta: z.number().int().min(-8).max(6),
  pleasantnessDelta: z.number().int().min(-8).max(6),
  effectiveContact: z.boolean(),
  acceptedClueIds: z.array(z.string().min(1).max(80)).max(5),
  blockerChanges: z.array(promptTestBlockerUpdateSchema).max(4),
}).strict();
export type PromptTestChanges = z.infer<typeof promptTestChangesSchema>;

/** A durable, export-ready snapshot of one completed dialogue turn. */
export const promptTestTurnRecordSchema = z.object({
  recordId: z.string().min(1).max(100),
  turn: z.number().int().min(1).max(100),
  createdAt: z.string().datetime(),
  playerText: z.string().min(1).max(2_000),
  npcText: z.string().min(1).max(2_000),
  evaluator: promptTestEvaluatorSchema,
  stateBefore: promptTestRuntimeSchema,
  stateAfter: promptTestRuntimeSchema,
  changes: promptTestChangesSchema,
}).strict();
export type PromptTestTurnRecord = z.infer<typeof promptTestTurnRecordSchema>;

export const promptTestResponseSchema = z.object({
  success: z.literal(true),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
  version: z.number().int().min(0).max(10_000),
  provider: promptTestProviderSchema,
  npcId: promptTestNpcIdSchema,
  visitMode: promptTestVisitModeSchema,
  action: z.enum(['run', 'reset', 'end_visit']),
  npcText: z.string().max(2_000).optional(),
  evaluator: promptTestEvaluatorSchema.optional(),
  stateBefore: promptTestRuntimeSchema,
  state: promptTestRuntimeSchema,
  changes: promptTestChangesSchema,
  history: z.array(promptTestMessageSchema).max(40),
  records: z.array(promptTestTurnRecordSchema).max(100),
}).strict();
export type PromptTestResponse = z.infer<typeof promptTestResponseSchema>;
