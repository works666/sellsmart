import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { invokeLLM } from '@/lib/ai/client';
import { parseAiJsonObject } from '@/lib/ai/json';
import { serializeUntrustedPromptData } from '@/lib/ai/prompt-data';
import { gameReviewSchema, type GameReview } from '@/lib/contracts/game';
import { getGameOutcome } from '@/lib/game/state';
import {
  buildReviewContext,
  getOwnedGameSession,
  getSessionReviewEvents,
  getSessionTranscript,
  getStoredReview,
  saveStoredReview,
  toReviewOutcome,
} from '@/lib/game/repository';

export const runtime = 'nodejs';

type UnknownRecord = Record<string, unknown>;

const dimensionLabels: Record<string, string> = {
  decisionAnalysis: '决策分析',
  relationshipBuilding: '关系建立',
  valuePresentation: '价值呈现',
  objectionHandling: '异议处理',
  informationDiscovery: '信息发现',
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function firstValue(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function outcomeNumber(outcome: UnknownRecord, keys: string[]): number | undefined {
  const candidates = [outcome, asRecord(outcome.scores), asRecord(outcome.breakdown), asRecord(outcome.components)];
  for (const candidate of candidates) {
    const value = firstValue(candidate, keys);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder}分钟`;
  return remainder ? `${hours}小时${remainder}分钟` : `${hours}小时`;
}

function extractGiftEvents(transcript: Array<{ metadata?: UnknownRecord }>): UnknownRecord[] {
  return transcript.flatMap((message) => {
    const metadata = asRecord(message.metadata);
    const assessment = asRecord(metadata.giftAssessment);
    return assessment.giftType && assessment.giftType !== 'none' ? [assessment] : [];
  });
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function extractStateGiftEvents(state: UnknownRecord): UnknownRecord[] {
  return asRecordArray(firstValue(state, ['preparations', 'giftRecords', 'giftEvents', 'giftInventory']))
    .filter((item) => item.type === 'courtesy_gift' || item.type === 'boundary_gift' || item.giftType === 'compliant' || item.giftType === 'boundary')
    .filter((item) => item.giftType !== undefined || item.status === 'used' || (typeof item.usedCount === 'number' && item.usedCount > 0))
    .map((item) => ({
      preparationId: item.id ?? item.preparationId,
      giftType: item.giftType ?? (item.type === 'boundary_gift' ? 'boundary' : 'compliant'),
      outcome: item.outcome,
      disposition: item.disposition,
      riskLevel: item.riskLevel,
      riskReason: item.riskReason,
    }));
}

function extractEventGiftEvents(
  events: Array<{ eventType: string; payload: UnknownRecord }>,
  state: UnknownRecord,
): UnknownRecord[] {
  const preparations = asRecordArray(state.preparations);
  const preparationTypes = new Map(preparations.map((item) => [String(item.id ?? item.preparationId ?? ''), item.type]));
  return events.flatMap((event) => {
    if (event.eventType !== 'gift.delivered') return [];
    const payload = event.payload;
    const preparationId = typeof payload.preparationId === 'string' ? payload.preparationId : undefined;
    const disposition = typeof payload.disposition === 'string' ? payload.disposition : undefined;
    const giftType = preparationTypes.get(preparationId ?? '') === 'boundary_gift' || Boolean(payload.riskId)
      ? 'boundary'
      : 'compliant';
    const outcome = disposition === 'delighted_acceptance'
      ? 'accepted'
      : disposition === 'cautious_acceptance'
        ? 'accepted_cautiously'
        : disposition === 'polite_decline'
          ? 'politely_refused'
          : disposition === 'firm_rejection'
            ? 'firmly_refused'
            : disposition === 'reported' ? 'refused_and_reported' : undefined;
    return [{ preparationId, giftType, outcome, disposition, riskId: payload.riskId }];
  });
}

function mergeGiftEvents(...groups: UnknownRecord[][]): UnknownRecord[] {
  const seen = new Set<string>();
  return groups.flatMap((group) => group.filter((event) => {
    const key = [event.preparationId, event.riskId, event.disposition, event.outcome, event.giftType].map((item) => String(item ?? '')).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function createDeterministicReview(args: {
  status: 'won' | 'lost';
  dimensions: UnknownRecord;
  state: UnknownRecord;
  outcome: UnknownRecord;
  giftEvents: UnknownRecord[];
}): GameReview {
  const dimensionEntries = Object.entries(args.dimensions)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort((left, right) => right[1] - left[1]);
  const strongest = dimensionEntries[0];
  const weakest = dimensionEntries.at(-1);
  const finalScore = outcomeNumber(args.outcome, ['finalScore', 'score', 'totalScore']);
  const publicValueScore = outcomeNumber(args.outcome, ['publicValueScore', 'corporateValueScore']);
  const personalBenefitScore = outcomeNumber(args.outcome, ['personalBenefitScore', 'personalValueScore']);
  const compliancePenalty = outcomeNumber(args.outcome, ['compliancePenalty', 'complianceRiskPenalty']) ?? 0;
  const investedMinutes = firstValue(args.state, [
    'cumulativeTimeMinutes',
    'totalInvestedMinutes',
    'cumulativeInvestedMinutes',
    'totalTimeSpentMinutes',
    'elapsedSimulationMinutes',
  ]);
  const spentPoints = firstValue(args.state, [
    'cumulativeSpentPoints',
    'totalActionPointsSpent',
    'cumulativeActionPointsSpent',
    'spentActionPoints',
  ]);
  const boundaryGifts = args.giftEvents.filter((gift) => gift.giftType === 'boundary');
  const acceptedCompliantGifts = args.giftEvents.filter((gift) =>
    gift.giftType === 'compliant' && (gift.outcome === 'accepted' || gift.outcome === 'accepted_cautiously'));
  const resourceText = [
    typeof investedMinutes === 'number' ? `累计投入${formatDuration(investedMinutes)}` : null,
    typeof spentPoints === 'number' ? `消耗${Math.round(spentPoints)}行动点` : null,
  ].filter(Boolean).join('、');

  const strengths: string[] = [];
  if (strongest) {
    strengths.push(`五维能力中“${dimensionLabels[strongest[0]] ?? strongest[0]}”表现最好（${Math.round(strongest[1])}分），这是本局最稳定的销售过程能力。`);
  }
  if (acceptedCompliantGifts.length) {
    strengths.push(`有${acceptedCompliantGifts.length}次合规伴手礼被接受，只形成小幅即时气氛收益，没有把礼品误算为个人合理收益。`);
  }
  const outcomeStrengths = [
    publicValueScore === undefined ? null : { label: '对公价值', score: publicValueScore },
    personalBenefitScore === undefined ? null : { label: '个人合理收益', score: personalBenefitScore },
  ].filter((item): item is { label: string; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score);
  if (outcomeStrengths[0] && outcomeStrengths[0].score >= 50) {
    strengths.push(`项目结果层中“${outcomeStrengths[0].label}”相对突出（${Math.round(outcomeStrengths[0].score)}分），说明部分客户选择理由已得到有效确认。`);
  }
  const outcomeSummary = `综合结算${finalScore === undefined ? '' : `为${Math.round(finalScore)}分`}：结合五维能力、对公价值、个人合理收益、合规风险和当前招标规则${resourceText ? `；本局${resourceText}` : ''}。`;
  if (args.status === 'won') {
    strengths.unshift(`${outcomeSummary}在本次三方比选中中标。`);
  }
  if (!strengths.length) strengths.push('完成了完整客户接触并留下了可复盘的对话记录，为下一次针对性改进提供了依据。');

  const improvements: string[] = [];
  if (args.status === 'lost') {
    improvements.push(`${outcomeSummary}本次未能中标，需要从最低的能力或结果指标补证。`);
  }
  if (compliancePenalty > 0) {
    improvements.push(`本局已触发${Math.round(compliancePenalty)}分合规扣分。任何短期好感或项目推进都不能抵消上报、审计或后续反噬，应避免违规利益交换。`);
  } else if (boundaryGifts.length) {
    improvements.push(`本局使用了${boundaryGifts.length}次高波动边界礼品；即使获得即时收益，仍可能留下审计、转述或竞品质疑的延迟代价，不能把它当作稳定推进方式。`);
  }
  if (weakest) {
    improvements.push(`优先改善“${dimensionLabels[weakest[0]] ?? weakest[0]}”（${Math.round(weakest[1])}分）；不要只追求关系变化，要在对话中留下可验证的信息、异议处理或价值证据。`);
  }
  const weakestOutcome = outcomeStrengths.at(-1);
  if (weakestOutcome && weakestOutcome.score < 60) {
    improvements.push(`“${weakestOutcome.label}”仅${Math.round(weakestOutcome.score)}分，是混合结算的主要缺口；玩家单方面陈述不算证据，需要NPC明确认可或材料验证。`);
  }
  if (!improvements.length) improvements.push('继续把沟通结果转成NPC明确认可的对公与个人收益证据，避免只有过程动作、没有客户确认。');

  const nextActions: string[] = [];
  if (weakest) {
    nextActions.push(`下一局围绕“${dimensionLabels[weakest[0]] ?? weakest[0]}”预设一个可验证目标，每次拜访结束前确认事实、责任人和下一步。`);
  }
  if ((publicValueScore ?? 100) < 60 || (personalBenefitScore ?? 100) < 60) {
    nextActions.push('准备一份同时覆盖组织回报/风险控制和岗位减负/绩效收益的材料，分别请对应NPC确认，形成两类独立证据。');
  }
  if (compliancePenalty > 0 || boundaryGifts.length) {
    nextActions.push('下次优先使用议程、PPT、案例和兑现承诺建立支持；礼品只选择公开、低价值且可解释的合规伴手礼。');
  } else if (resourceText) {
    nextActions.push(`复盘本局${resourceText}的证据产出，下一局优先安排能补齐最低结果指标的联系人和材料。`);
  }
  if (!nextActions.length) nextActions.push('下一局先明确关键决策人、对公目标和个人合理收益，再按“准备—拜访—纪要—兑现承诺”形成闭环。');

  return {
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 3),
    nextActions: nextActions.slice(0, 3),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;

  try {
    const gameSession = await getOwnedGameSession(id, guard.session.userId);
    if (gameSession.state.status === 'playing') {
      return NextResponse.json({ error: '对局尚未结束' }, { status: 409 });
    }
    const existing = await getStoredReview(id);
    if (existing) return NextResponse.json({ success: true, review: existing, cached: true });

    const [transcript, storedEvents] = await Promise.all([
      getSessionTranscript(id),
      getSessionReviewEvents(id),
    ]);
    const outcome = getGameOutcome(gameSession.state);
    const outcomeRecord = asRecord(outcome);
    const stateRecord = gameSession.state as unknown as UnknownRecord;
    const reviewContext = buildReviewContext({ state: gameSession.state, transcript, events: storedEvents });
    const transcriptGiftEvents = extractGiftEvents(reviewContext.recentMessages);
    const eventGiftEvents = extractEventGiftEvents(reviewContext.keyEvents, stateRecord);
    const giftEvents = mergeGiftEvents(transcriptGiftEvents, eventGiftEvents, extractStateGiftEvents(stateRecord));
    const reviewInput = serializeUntrustedPromptData('game_review_context', {
      result: outcome.won ? 'won' : 'lost',
      persistedLegacyResult: gameSession.state.status,
      formula: '最终结果由三家供应商的项目表现、已验证价值、合规风险、客户内部决策与当前招标规则共同决定；客户支持度及其分级为内部计算，不得展示或推断。',
      outcome: toReviewOutcome(outcome),
      npcMemories: reviewContext.npcMemories,
      persistentState: reviewContext.persistentState,
      keyEvents: reviewContext.keyEvents,
      recentMessages: reviewContext.recentMessages,
      transcriptGiftAssessments: giftEvents,
    }, { maxStringLength: 700, maxTotalLength: 32_000 });
    const systemPrompt = [
      '你是政企销售训练复盘教练。只能依据给定对局数据给出具体、可执行的中文复盘，不得编造对话外事实。',
      '必须结合五维销售能力、已验证的对公价值和个人合理收益、合规风险、招标规则及三方核心优势解释结果；不能只依据五维或最终胜负。不得展示、估算或推断任何客户支持度、支持分级或内部关系分数。',
      '如存在礼品记录，必须同时说明其即时收益与拒收、上报、审计、转述或后续反噬的实际/潜在代价；现金、回扣和利益交换不得评价为个人合理收益。没有礼品或风险记录时不得编造。',
      '结合累计模拟投入时间和累计行动点消耗评价资源效率；旧存档字段缺失时直接省略对应判断，不得自行推算。',
      '区分玩家主张与NPC确认：对公价值和个人合理收益只能引用已确认或已验证的证据。',
      '复盘上下文已剔除竞品后台分数、动作和隐藏主张；不得补写或推断任何竞品内部数据，只能复述对话中明确出现的竞品话术。',
      '只输出一个JSON对象，且必须恰好包含strengths、improvements、nextActions三个字段。',
      '每个字段必须是包含1到3个非空中文字符串的数组，每个字符串不超过300字。不得输出Markdown或其他字段。',
    ].join('');
    let review: GameReview | null = null;
    for (let attempt = 0; attempt < 2 && !review; attempt += 1) {
      try {
        const result = await invokeLLM([
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: attempt === 0
              ? reviewInput
              : `${reviewInput}\n上一次输出未通过字段或数组约束，请严格按指定JSON结构重新生成。`,
          },
        ], { temperature: attempt === 0 ? 0.2 : 0, maxTokens: 1500, jsonMode: true });
        const parsed = gameReviewSchema.safeParse(parseAiJsonObject(result));
        if (parsed.success) review = parsed.data;
      } catch {
        // Provider and schema failures both retry once, then use deterministic review.
      }
    }
    if (!review) {
      review = createDeterministicReview({
        status: outcome.won ? 'won' : 'lost',
        dimensions: gameSession.state.dimensions,
        state: stateRecord,
        outcome: outcomeRecord,
        giftEvents,
      });
    }
    await saveStoredReview(id, gameSession.state, review);
    return NextResponse.json({ success: true, review, cached: false });
  } catch {
    return NextResponse.json({ error: 'AI复盘服务暂时不可用' }, { status: 503 });
  }
}
