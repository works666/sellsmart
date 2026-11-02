import type { NpcTurnEvaluation } from '@/lib/contracts/ai';

const giftPattern = /礼物|礼品|伴手礼|纪念品|特产|心意|茶叶|名酒|购物卡|礼金|红包|名表|手机|电脑|黄金/;
const improperBenefitPattern = /现金|红包|回扣|返点|好处费|辛苦费|茶水费|购物卡|礼金/;
const publicValuePattern = /合规|风险|回报|成本|效率|落地|组织|预算|交付|绩效/;
const personalBenefitPattern = /减负|工作量|职业安全|专业声誉|声誉|成长|省事|个人绩效|重复录入/;
const valueAcknowledgementPattern = /认可|可行|有帮助|有用|确实|可以|能够|降低|提升|减少|支持|符合|值得|愿意|同意|改善/;
const commitmentPattern = /会在|会把|会给|将(?:会)?|安排|提供|发送|反馈|确认|跟进|联系|转告|尽快|稍后/;

function normalizeSourceText(value: string): string {
  return value
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLocaleLowerCase('zh-CN');
}

function replySentences(reply: string): string[] {
  return reply.split(/[。！？；\n]/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function findNpcReplySourceSentence(statement: string, reply: string): number {
  const normalizedStatement = normalizeSourceText(statement);
  if (normalizedStatement.length < 2) return -1;
  return replySentences(reply).findIndex((sentence) =>
    normalizeSourceText(sentence).includes(normalizedStatement));
}

function hasNpcReplySource(statement: string, reply: string): boolean {
  return findNpcReplySourceSentence(statement, reply) >= 0;
}

function hasUnnegatedSemanticToken(source: string, pattern: RegExp): boolean {
  const matches = source.matchAll(new RegExp(pattern.source, 'gu'));
  for (const match of matches) {
    const prefix = source.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    if (!/(?:不|未|无|难以|无法|不能|不可|没有|别|拒绝|否认)/u.test(prefix)) return true;
  }
  return false;
}

/**
 * Keep score-bearing memory traceable to the NPC's actual response. This
 * module is deliberately runtime-neutral because both server logic and the
 * browser-visible state helpers enforce the same persistence boundary.
 */
export function verifyNpcEvaluationSources(evaluation: NpcTurnEvaluation, npcReply: string): NpcTurnEvaluation {
  const confirmedFacts = evaluation.confirmedFacts.filter((fact) => hasNpcReplySource(fact, npcReply));
  const commitments = evaluation.commitments.filter((commitment) => {
    const sourceSentence = findNpcReplySourceSentence(commitment, npcReply);
    return sourceSentence >= 0 && hasUnnegatedSemanticToken(
      replySentences(npcReply)[sourceSentence] ?? '',
      commitmentPattern,
    );
  });
  const usedReplySentences = new Set<number>();
  const filterEvidence = (
    candidates: NpcTurnEvaluation['publicValueEvidence'],
    category: 'public' | 'personal',
  ) => candidates.filter((candidate) => {
    const sourceSentence = findNpcReplySourceSentence(candidate.statement, npcReply);
    if (sourceSentence < 0 || usedReplySentences.has(sourceSentence)) return false;
    const isPersonal = personalBenefitPattern.test(candidate.statement);
    const isPublic = publicValuePattern.test(candidate.statement);
    const source = replySentences(npcReply)[sourceSentence] ?? '';
    const isValidCategory = category === 'personal'
      ? isPersonal && !giftPattern.test(candidate.statement) && !improperBenefitPattern.test(candidate.statement)
      : isPublic && !isPersonal;
    if (!isValidCategory || !hasUnnegatedSemanticToken(source, valueAcknowledgementPattern)) return false;
    usedReplySentences.add(sourceSentence);
    return true;
  });

  return {
    ...evaluation,
    confirmedFacts,
    commitments,
    publicValueEvidence: filterEvidence(evaluation.publicValueEvidence, 'public'),
    personalBenefitEvidence: filterEvidence(evaluation.personalBenefitEvidence, 'personal'),
  };
}
