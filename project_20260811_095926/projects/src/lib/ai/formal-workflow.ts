import { z } from 'zod';
import { invokeLLM } from '@/lib/ai/client';
import { invokeJev, type JevInvoker } from '@/lib/ai/jev-client';
import { invokeConfiguredJev } from '@/lib/ai/jev-designer-config';
import { buildJevNpcProfile } from '@/lib/ai/jev-npc-profile';
import { parseAiJsonObject } from '@/lib/ai/json';
import { serializeUntrustedPromptData } from '@/lib/ai/prompt-data';
import { PROJECT_ONE_NPCS, PROJECT_ONE_PUBLIC_PROFILES, getProjectOneNpc } from '@/lib/game/project-one';
import { PROJECT_ONE_FIVE_PERSON_NPCS, PROJECT_ONE_FIVE_PERSON_IDS, type ProjectOneFivePersonId } from '@/lib/designer/project-one-five-person';

const planSchema = z.object({
  recommendations: z.array(z.string().trim().min(1).max(300)).min(1).max(20).transform((items) => items.slice(0, 5)),
});
const briefSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(300)).max(20).transform((items) => items.slice(0, 4)),
  risks: z.array(z.string().trim().min(1).max(300)).max(20).transform((items) => items.slice(0, 4)),
  nextStep: z.string().trim().min(1).max(300),
});
export type FormalPlanEvaluation = { needsDetail?: boolean; recommendations: string[]; disclosures: Array<{ npcId: string; facts: string[]; clues: string[] }> };
export type FormalBriefVisitEvaluation = z.infer<typeof briefSchema>;
export type FormalVisitPreparationEvaluation = FormalBriefVisitEvaluation & { needsDetail: boolean };

type WorkflowDependencies = { llmInvoker?: typeof invokeLLM; jevInvoker?: JevInvoker };

async function needsMoreDetail(
  task: 'preview_plan' | 'preview_visit',
  label: string,
  data: Record<string, unknown>,
  instructions: string,
  fallback: boolean,
  dependencies: WorkflowDependencies,
): Promise<boolean> {
  const request = {
    state: serializeUntrustedPromptData(label, data, { maxStringLength: 4_000, maxTotalLength: 12_000 }),
    questions: { needsDetail: { type: 'noul' as const, instructions } },
  };
  try {
    const response = dependencies.jevInvoker
      ? await dependencies.jevInvoker(request)
      : await invokeConfiguredJev(task, request, invokeJev);
    const answer = response.answers.needsDetail;
    if (answer?.type === 'noul' && Number.isFinite(answer.noul)) return answer.noul >= 0.5;
  } catch {
    // Match the actual-test workspace's bounded fallback if Jev is unavailable.
  }
  return fallback;
}

function publicPeople(scope: 'global' | 'npc', npcId?: string) {
  const ids = scope === 'npc' && npcId ? [npcId] : PROJECT_ONE_NPCS.map((npc) => npc.id);
  return ids.flatMap((id) => {
    const npc = getProjectOneNpc(id);
    const profile = PROJECT_ONE_PUBLIC_PROFILES[id];
    return npc && profile ? [{ id, name: npc.name, title: npc.title, publicFacts: profile.facts.slice(0, 2) }] : [];
  });
}

/** Mirrors the preview's server whitelist: only keyword-matched master facts/clues may be revealed. */
function matchedPlanDisclosures(scope: 'global' | 'npc', npcId: string | undefined, content: string): FormalPlanEvaluation['disclosures'] {
  const normalized = content.toLowerCase();
  const ids: readonly ProjectOneFivePersonId[] = scope === 'npc' && npcId && npcId in PROJECT_ONE_FIVE_PERSON_NPCS
    ? [npcId as ProjectOneFivePersonId]
    : PROJECT_ONE_FIVE_PERSON_IDS;
  return ids.flatMap((id) => {
    const npc = PROJECT_ONE_FIVE_PERSON_NPCS[id];
    const facts = npc.facts.filter((_, index) => (npc.factKeywords[index] ?? npc.clueKeywords).some((keyword) => normalized.includes(keyword.toLowerCase()))).slice(0, 2);
    const clues = npc.clues.filter(() => npc.clueKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()))).slice(0, 2);
    return facts.length || clues.length ? [{ npcId: id, facts: [...facts], clues: [...clues] }] : [];
  });
}

/** Real-AI planner, constrained to public project-one facts and bounded output. */
export async function evaluateFormalWorkPlan(args: { scope: 'global' | 'npc'; npcId?: string; content: string }, dependencies: WorkflowDependencies = {}): Promise<FormalPlanEvaluation> {
  const people = publicPeople(args.scope, args.npcId);
  const raw = await (dependencies.llmInvoker ?? invokeLLM)([
    { role: 'system', content: '你是销售训练中的工作计划教练。仅依据给定公开人物资料，给出可执行建议。不得判断或透露客户支持度、内部关系分、竞争对手后台信息，也不得编造事实。严格输出JSON：{recommendations:string[]}。' },
    { role: 'user', content: serializeUntrustedPromptData('formal_work_plan', { plan: args.content, scope: args.scope, people }, { maxStringLength: 4_000, maxTotalLength: 12_000 }) },
  ], { temperature: 0.2, maxTokens: 3000, jsonMode: true, thinking: 'disabled' });
  const parsed = planSchema.parse(parseAiJsonObject(raw));
  const needsDetail = await needsMoreDetail('preview_plan', 'formal_work_plan_decision', { plan: args.content, scope: args.scope, people },
    '计划是否仍缺少足够具体的目标、证据或下一步。',
    args.content.trim().length < 16 || !/(?:目标|验收|里程碑|证据|下一步|决策链|预算|风险|时间|安排|确认)/i.test(args.content), dependencies);
  return {
    needsDetail,
    recommendations: parsed.recommendations,
    disclosures: needsDetail ? [] : matchedPlanDisclosures(args.scope, args.npcId, args.content),
  };
}

/** Preparation is assessed independently, saved without AP, and gates a real visit. */
export async function evaluateFormalVisitPreparation(
  args: { npcId: string; content: string },
  dependencies: WorkflowDependencies = {},
): Promise<FormalVisitPreparationEvaluation> {
  const npc = getProjectOneNpc(args.npcId);
  if (!npc) throw new Error('NPC_UNKNOWN');
  const npcProfile = buildJevNpcProfile(args.npcId);
  const raw = await (dependencies.llmInvoker ?? invokeLLM)([
    { role: 'system', content: '你是销售拜访准备教练。只依据给定人物岗位和玩家准备，说明优点、风险和下一步建议，不判断是否足够具体，不声称拜访已经发生或客户已经同意，不披露内部关系数值。严格输出JSON：{strengths:string[],risks:string[],nextStep:string}。' },
    { role: 'user', content: serializeUntrustedPromptData('formal_visit_preparation', { npc: { id: npc.id, name: npc.name, title: npc.title }, visitPreparation: args.content }, { maxStringLength: 4_000, maxTotalLength: 8_000 }) },
  ], { temperature: 0.2, maxTokens: 3000, jsonMode: true, thinking: 'disabled' });
  const narrative = briefSchema.parse(parseAiJsonObject(raw));
  const needsDetail = await needsMoreDetail('preview_visit', 'formal_visit_preparation_decision', { text: args.content, npcProfile },
    '这次拜访准备是否仍缺少明确对象、问题、证据或下一步。',
    args.content.trim().length < 24 || !/(?:目标|问题|证据|验收|下一步|议题|对象|风险)/i.test(args.content), dependencies);
  return { ...narrative, needsDetail };
}

/** This evaluates a proposed visit; it never starts or completes a meeting. */
export async function evaluateFormalBriefVisit(args: { npcId: string; content: string }): Promise<FormalBriefVisitEvaluation> {
  const npc = getProjectOneNpc(args.npcId);
  const profile = PROJECT_ONE_PUBLIC_PROFILES[args.npcId];
  if (!npc || !profile) throw new Error('NPC_UNKNOWN');
  const raw = await invokeLLM([
    { role: 'system', content: '你是销售拜访方案教练。评估玩家的拜访简述，只输出方案优点、风险和下一步；这不是实际会面，不能声称客户已经同意、已拜访、已完成任务，也不得评价或透露支持度。严格输出JSON：{strengths:string[],risks:string[],nextStep:string}。' },
    { role: 'user', content: serializeUntrustedPromptData('formal_brief_visit', { npc: { id: npc.id, name: npc.name, title: npc.title, publicFacts: profile.facts.slice(0, 2) }, brief: args.content }, { maxStringLength: 4_000, maxTotalLength: 8_000 }) },
  ], { temperature: 0.2, maxTokens: 3000, jsonMode: true, thinking: 'disabled' });
  return briefSchema.parse(parseAiJsonObject(raw));
}
