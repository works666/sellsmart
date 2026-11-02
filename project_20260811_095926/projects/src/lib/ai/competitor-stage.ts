import { z } from 'zod';
import { invokeLLM, type ChatMessage } from '@/lib/ai/client';
import { parseAiJsonObject } from '@/lib/ai/json';
import { invokeJev, type JevAnswer, type JevInvoker, type JevQuestions } from '@/lib/ai/jev-client';
import { invokeConfiguredJev } from '@/lib/ai/jev-designer-config';
import { serializeUntrustedPromptData } from '@/lib/ai/prompt-data';
import { COMPETITOR_PROMPT } from '@/lib/ai/prompts/competitor';
import {
  COMPETITOR_TARGET_NPC_IDS,
  isCompetitorStageActionCandidate,
  type CompetitorStageActionCandidate,
  type GameRuntimeState,
} from '@/lib/game/state';
import { PROJECT_ONE_COMPETITORS, PROJECT_ONE_NPCS } from '@/lib/game/project-one';

const competitorStageDecisionSchema = z.object({
  round: z.number().int().min(1).max(5),
  targetNpcId: z.enum([
    'P1-001',
    'P1-002',
    'P1-003',
    'P1-004',
    'P1-005',
  ]),
  kind: z.enum(['relationship', 'price', 'case', 'executive']),
  pressureDelta: z.number().int().min(1).max(6),
}).strict();

const competitorStageNarrativeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(320),
});

export type CompetitorStageInvoker = (
  messages: ChatMessage[],
  options: {
    temperature: number;
    maxTokens: number;
    jsonMode: boolean;
    thinking: 'disabled';
  },
) => Promise<string>;

export interface CompetitorStageAiDecision {
  candidate?: CompetitorStageActionCandidate;
  source: 'model' | 'fallback' | 'cached' | 'existing';
  validationErrors: string[];
}

interface CachedDecision {
  expiresAt: number;
  decision: CompetitorStageAiDecision;
}

const CACHE_TTL_MS = 60_000;
const completedDecisions = new Map<string, CachedDecision>();
const inFlightDecisions = new Map<string, Promise<CompetitorStageAiDecision>>();

function defaultInvoker(messages: ChatMessage[], options: Parameters<CompetitorStageInvoker>[1]): Promise<string> {
  return invokeLLM(messages, options);
}

function stageDecisionQuestions(state: GameRuntimeState): JevQuestions {
  const allowedKinds = state.currentRound === 1 ? ['relationship']
    : state.currentRound === 2 ? ['relationship', 'price']
      : state.currentRound === 3 ? ['price', 'case']
        : state.currentRound === 4 ? ['case', 'executive']
          : ['price', 'case', 'executive'];
  return {
    targetNpcId: {
      type: 'choice',
      instructions: '选择本阶段竞品最应施压的关键人物。',
      criteria: Object.fromEntries(COMPETITOR_TARGET_NPC_IDS.map((id) => [id, id])) as Record<string, string>,
    },
    kind: {
      type: 'choice',
      instructions: '选择竞品本阶段的竞争动作类型；不得选择未列出的动作。',
      criteria: Object.fromEntries(allowedKinds.map((kind) => [kind, kind])) as Record<string, string>,
    },
    pressureDelta: {
      type: 'choice',
      instructions: '选择竞品动作的压力强度；结果必须是 1 到 6 之间的离散整数。',
      criteria: {
        '1': '轻微试探，仅造成 1 点压力',
        '2': '有限推进，造成 2 点压力',
        '3': '常规竞争，造成 3 点压力',
        '4': '明显施压，造成 4 点压力',
        '5': '强力推进，造成 5 点压力',
        '6': '本阶段最高强度，造成 6 点压力',
      },
    },
  };
}

function decisionKey(sessionId: string, state: GameRuntimeState): string {
  return `${sessionId}:${state.scenarioCode}:${state.currentRound}`;
}

function cleanupExpiredDecisions(now = Date.now()): void {
  for (const [key, value] of completedDecisions) {
    if (value.expiresAt <= now) completedDecisions.delete(key);
  }
}

export function clearCompetitorStageDecisionCache(): void {
  completedDecisions.clear();
  inFlightDecisions.clear();
}

function buildStageContext(state: GameRuntimeState) {
  return {
    scenarioCode: state.scenarioCode,
    stage: state.currentRound,
    totalStages: state.maxRounds,
    companyId: state.companyId,
    competitorProfiles: PROJECT_ONE_COMPETITORS.map((competitor) => ({
      companyName: competitor.company_name,
      publicAdvantages: competitor.features,
      publicNotes: competitor.more_info,
    })),
    targetPeople: PROJECT_ONE_NPCS.map((npc) => ({
      id: npc.id,
      name: npc.name,
      title: npc.title,
      category: npc.category,
      publicConcern: npc.weakness,
      playerSignals: {
        publicResearchCompleted: Boolean(state.publicResearch[npc.id]),
        completedVisit: state.appointments.some((item) => item.npcId === npc.id && item.status === 'completed'),
        targetedMaterialUsed: state.preparations.some((item) => item.npcId === npc.id && item.usedCount > 0),
      },
    })),
    allowedTargetIds: COMPETITOR_TARGET_NPC_IDS,
  };
}

export function buildCompetitorStageMessages(
  state: GameRuntimeState,
  decision?: z.infer<typeof competitorStageDecisionSchema>,
): ChatMessage[] {
  const protocol = `
这是项目一单机五阶段的隐藏竞品动作文案。竞品已经由独立决策系统确定动作，绝不能选择或改写目标、类型、压力值。
只返回一个 JSON 对象，不要 Markdown、解释或额外字段：
{
  "title": "不超过120字的竞品动作标题",
  "summary": "不超过320字的竞品动作摘要"
}
只描述给定的竞品动作，不输出玩家、NPC支持度、竞品分数或其他隐藏数值。调研、已完成拜访和已使用材料只作为写作背景，是否对冲及实际 supportImpact 由服务端确定性计算。`;
  const basePrompt = COMPETITOR_PROMPT({ scenarioId: state.scenarioCode });
  return [
    { role: 'system', content: `${basePrompt}\n${protocol}` },
    {
      role: 'user',
      content: serializeUntrustedPromptData('competitor_stage_context', { ...buildStageContext(state), decision }, {
        maxStringLength: 500,
        maxTotalLength: 12_000,
      }),
    },
  ];
}

function validateNarrative(raw: string): { narrative?: z.infer<typeof competitorStageNarrativeSchema>; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = parseAiJsonObject(raw);
  } catch {
    return { errors: ['AI_JSON_OBJECT_INVALID'] };
  }
  const result = competitorStageNarrativeSchema.safeParse(parsed);
  return result.success ? { narrative: result.data, errors: [] } : { errors: ['COMPETITOR_STAGE_NARRATIVE_INVALID'] };
}

function readJevChoice(answer: JevAnswer): string | undefined {
  return answer.type === 'choice' ? answer.choice : undefined;
}

function fallbackNarrative(decision: z.infer<typeof competitorStageDecisionSchema>): z.infer<typeof competitorStageNarrativeSchema> {
  const label = { relationship: '关系推进', price: '价格施压', case: '案例背书', executive: '高层介入' }[decision.kind];
  return { title: `竞品正在开展${label}`, summary: `竞品围绕既定对象推进${label}，试图提升本阶段的竞争压力。` };
}

async function runDecision(
  state: GameRuntimeState,
  invoker: CompetitorStageInvoker,
  jevInvoker: JevInvoker,
): Promise<CompetitorStageAiDecision> {
  try {
    const stageContext = buildStageContext(state);
    const jev = await jevInvoker({ state: { ...stageContext, allowedTargetIds: [...stageContext.allowedTargetIds] }, questions: stageDecisionQuestions(state) });
    const targetNpcId = readJevChoice(jev.answers.targetNpcId);
    const kind = readJevChoice(jev.answers.kind);
    const pressureChoice = readJevChoice(jev.answers.pressureDelta);
    const decision = competitorStageDecisionSchema.safeParse({
      round: state.currentRound,
      targetNpcId,
      kind,
      pressureDelta: pressureChoice === undefined ? undefined : Number(pressureChoice),
    });
    if (!decision.success || !isCompetitorStageActionCandidate({ ...decision.data, ...fallbackNarrative(decision.data) }, state.currentRound)) {
      return { source: 'fallback', validationErrors: ['JEV_COMPETITOR_DECISION_INVALID'] };
    }
    let narrative = fallbackNarrative(decision.data);
    try {
      const raw = await invoker(buildCompetitorStageMessages(state, decision.data), {
      temperature: 0,
      maxTokens: 350,
      jsonMode: true,
      thinking: 'disabled',
      });
      const validated = validateNarrative(raw);
      if (validated.narrative) narrative = validated.narrative;
    } catch {
      // Text generation must never replace a Jev decision with an LLM decision.
    }
    return { candidate: { ...decision.data, ...narrative }, source: 'model', validationErrors: [] };
  } catch {
    console.warn('Competitor stage Jev fallback', { stage: state.currentRound, code: 'JEV_PROVIDER_FAILED' });
    return { source: 'fallback', validationErrors: ['JEV_PROVIDER_FAILED'] };
  }
}

/**
 * Generate one hidden stage action for a solo game. The cache is keyed by
 * session + stage so retries and concurrent requests cannot generate two
 * different actions for one committed stage. A missing/invalid model result
 * deliberately returns no candidate, leaving the pure deterministic reducer
 * to apply its existing fallback template.
 */
export async function evaluateCompetitorStageAction(args: {
  sessionId: string;
  state: GameRuntimeState;
  invoker?: CompetitorStageInvoker;
  jevInvoker?: JevInvoker;
}): Promise<CompetitorStageAiDecision> {
  const { sessionId, state, invoker = defaultInvoker } = args;
  const jevInvoker = args.jevInvoker ?? ((request) => invokeConfiguredJev('competitor_stage', request, invokeJev));
  if (state.gameMode !== 'solo') return { source: 'existing', validationErrors: ['MULTIPLAYER_DEFERRED'] };
  if (state.competitorState.actions.some((action) => action.round === state.currentRound)) {
    return { source: 'existing', validationErrors: [] };
  }

  cleanupExpiredDecisions();
  const key = decisionKey(sessionId, state);
  const cached = completedDecisions.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.decision, source: 'cached' };
  }
  const running = inFlightDecisions.get(key);
  if (running) {
    const decision = await running;
    return { ...decision, source: 'cached' };
  }

  const promise = runDecision(state, invoker, jevInvoker);
  inFlightDecisions.set(key, promise);
  try {
    const decision = await promise;
    completedDecisions.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, decision });
    return decision;
  } finally {
    inFlightDecisions.delete(key);
  }
}
