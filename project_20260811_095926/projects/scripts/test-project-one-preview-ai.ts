import assert from 'node:assert/strict';
import {
  PREVIEW_NPC_IDS, PREVIEW_NPCS, PreviewAiError, PreviewSessionStore, createPreviewAiService as createPreviewAiServiceBase, createPreviewServerState, fromPersistedPreviewServerState,
  getAllowedTasks, resolvePreviewNpcExpression, resolvePreviewNode, toPersistedPreviewServerState, toPreviewRecoveryDto, type PreviewSessionPersistence,
} from '../src/lib/game/project-one-preview-ai';
import { previewAiRequestSchema, previewAiResponseSchema, previewNpcEvaluationAiOutputSchema } from '../src/lib/contracts/project-one-preview-ai';
import { PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS } from '../src/lib/designer/project-one-five-person';
import { getPreviewRequestHash } from '../src/lib/game/project-one-preview-session-repository';
import type { JevInvoker, JevQuestion } from '../src/lib/ai/jev-client';
import { DEFAULT_PROJECT_ONE_PROMPT_CONFIG } from '../src/lib/designer/prompt-config';

const json = (value: unknown) => JSON.stringify(value);
let commandIndex = 0;
function commandId(): string { commandIndex += 1; return ('command-' + commandIndex).padEnd(24, 'x'); }
function withMeta<T extends object>(request: T, version: number, previewSessionId?: string) {
  return { ...request, commandId: commandId(), expectedVersion: version, ...(previewSessionId ? { previewSessionId } : {}) };
}
const emptyEvaluation = {
  pleasureDelta: 0, supportDelta: 0,
  dimensionDeltas: { decisionAnalysis: 0, relationshipBuilding: 0, valuePresentation: 0, objectionHandling: 0, informationDiscovery: 0 },
  effectiveContact: false, memoryUpdates: [], blockerUpdates: [],
};
const reply = (content: string, invitationStatus: 'none' | 'accepted' | 'rejected' | 'later' = 'none') => ({ responseAction: 'reply' as const, content, invitationStatus });
const readNoReply = (reasonCode: 'natural_closure' | 'no_new_value' | 'repeated_follow_up' | 'not_responsible' | 'current_priority_low' | 'unwilling_to_advance' = 'natural_closure') => ({
  responseAction: 'read_no_reply' as const, content: null, invitationStatus: 'none' as const, reasonCode, reasonEvidence: '当前消息没有需要立即答复的新事项。',
});

function choiceFor(id: string, question: Extract<JevQuestion, { type: 'choice' }>, state: string): string {
  const keys = Object.keys(question.criteria);
  if (id === 'responseAction') return /TEST_READ_NO_REPLY|"playerText":"(?:验收记录已补齐|补充同一份验收记录|收到，谢谢)|不需要立即答复/.test(state) && keys.includes('read_no_reply') ? 'read_no_reply' : 'reply';
  if (id === 'invitationStatus') return /(?:邀请|拜访|见面|明天|下周)/.test(state) && keys.includes('accepted') ? 'accepted' : 'none';
  if (id === 'completedTask') return 'none';
  if (id === 'playerDialogueSignal') return /"playerText":"[^"]*(?:告辞|再见|今天先到这)/.test(state) ? 'farewell' : 'continue';
  if (id === 'npcDialogueSignal') return /(?:马上还有会|我得赶会)/.test(state) ? 'forced_exit'
    : /(?:今天先这样|再见|改天再聊)/.test(state) ? 'farewell' : 'continue';
  if (id === 'memoryType') return /last_commitment_or_feedback/.test(state) ? 'commitment' : /verified_improvement|key_fulfillment|player_report/.test(state) ? 'evidence' : 'none';
  if (id === 'memoryStatus') return 'active';
  if (id === 'blockerAction') return 'none';
  if (id === 'supportDelta') return '2';
  if (id === 'pleasureDelta' || id === 'decisionAnalysis') return '1';
  if (['relationshipBuilding', 'valuePresentation', 'objectionHandling', 'informationDiscovery'].includes(id)) return '0';
  return keys.includes('none') ? 'none' : keys[0];
}

const testJevInvoker: JevInvoker = async (request) => {
  const state = typeof request.state === 'string' ? request.state : JSON.stringify(request.state);
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'choice') {
      const choice = choiceFor(id, question, state);
      return [id, { type: 'choice' as const, choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])), confidence: 1 }];
    }
    if (question.type === 'noul') {
      const yes = id === 'effectiveContact' || id === 'accepted'
        || (id === 'viewed' && /验收记录/.test(state))
        || (id.startsWith('match_') && state.includes(id.slice('match_'.length)));
      return [id, { type: 'noul' as const, noul: yes ? 1 : 0 }];
    }
    const wanted = id === 'supportDelta' ? '2' : id === 'pleasureDelta' || id === 'decisionAnalysis' ? '1' : '0';
    const index = Math.max(0, question.criteria.findIndex((item) => item === wanted));
    return [id, { type: 'score' as const, score: index, legend: Object.fromEntries(question.criteria.map((item, itemIndex) => [String(itemIndex), item])), probabilities: Object.fromEntries(question.criteria.map((_, itemIndex) => [String(itemIndex), itemIndex === index ? 1 : 0])), confidence: 1 }];
  }));
  return { answers };
};

const createPreviewAiService = (deps: Parameters<typeof createPreviewAiServiceBase>[0] = {}) =>
  createPreviewAiServiceBase({
    ...deps,
    ...(deps.invoker ? { invoker: async (messages, options) =>
      messages.some((message) => message.content.includes('活动提议语义识别器') || message.content.includes('只判断这段已经结束的客户销售对话'))
        ? json({ activities: [] })
        : deps.invoker!(messages, options) } : {}),
    jevInvoker: deps.jevInvoker ?? testJevInvoker,
  });

async function main() {
  assert.deepEqual(PREVIEW_NPC_IDS, ['P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005']);
  assert.deepEqual(getAllowedTasks('P1-001'), ['提问', '质疑']);
  assert.match(PREVIEW_NPCS['P1-001'].personality, /一两句/);
  assert.equal(PREVIEW_NPCS['P1-001'].informationBoundary.some((item) => item.includes('技术参数') && item.includes('SLA')), true);
  assert.equal(PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS['P1-001']?.visit?.includes('不追问技术参数'), true);
  assert.match(PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS['P1-001']?.direct_visit ?? '', /不讨论技术参数、验收、SLA/);
  assert.equal(PREVIEW_NPCS['P1-002'].personality.length > 0, true);
  assert.equal(PREVIEW_NPCS['P1-003'].taboos.includes('现金回扣'), true);
  assert.equal(PREVIEW_NPCS['P1-004'].parentId, 'P1-002', '赵晓晨直属项目经理李明辉');
  assert.equal(PREVIEW_NPCS['P1-004'].title, '项目执行人员');
  assert.equal(PREVIEW_NPCS['P1-004'].category, '项目执行');
  assert.match(PREVIEW_NPCS['P1-004'].organization, /直属下属.*具体执行/);
  assert.equal(PREVIEW_NPCS['P1-004'].facts.some((item) => item.includes('材料') && item.includes('进度')), true, '赵晓晨主档覆盖材料与进度执行职责');
  assert.equal(previewAiRequestSchema.safeParse(withMeta({ action: 'message', npcId: 'P1-001', text: '您好', channel: 'email', profile: { hidden: true } }, 0)).success, false);
  assert.equal(previewAiRequestSchema.safeParse(withMeta({ action: 'test_adjust_npcs', adjustments: [{ npcId: 'P1-001', support: 101, pleasantness: 50, effectiveContactCount: 0 }] }, 0)).success, false, 'NPC test values enforce server bounds');
  assert.equal(previewAiRequestSchema.safeParse(withMeta({ action: 'test_adjust_npcs', adjustments: [{ npcId: 'P1-001', support: 10, pleasantness: 50, effectiveContactCount: 1 }, { npcId: 'P1-001', support: 20, pleasantness: 60, effectiveContactCount: 2 }] }, 0)).success, false, 'NPC test adjustments reject duplicate people');
  assert.equal(previewAiRequestSchema.safeParse(withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: 'yes' }, 0)).success, false, 'skip preparation must be an explicit boolean');
  assert.equal(previewAiResponseSchema.safeParse({ previewSessionId: 'x'.repeat(20), version: 1, action: 'reset' }).success, true);
  assert.deepEqual([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(resolvePreviewNpcExpression), ['angry', 'angry', 'serious', 'serious', 'calm', 'calm', 'pleasant', 'pleasant', 'very_happy', 'very_happy'], 'pleasantness boundaries map to safe display expressions');
  assert.equal(previewNpcEvaluationAiOutputSchema.safeParse({ ...emptyEvaluation, blockerUpdates: [{ action: 'add', value: 'model_invented_blocker' }] }).success, false, 'blocker IDs are a server-controlled enum');

  const prompts: string[] = [];
  let evaluationTurn = 0;
  const service = createPreviewAiService({ invoker: async (messages, options) => {
    assert.equal(options?.thinking, 'disabled', 'preview structured calls disable model thinking');
    const prompt = messages.map((message) => message.content).join('\n');
    prompts.push(prompt);
    if (prompt.includes('判断是否查看已收到的附件')) return json({ viewed: false, impact: '已收到，待有空查看。' });
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) {
      evaluationTurn += 1;
      const tag = evaluationTurn === 1 ? 'last_commitment_or_feedback' : evaluationTurn === 2 ? 'verified_improvement' : 'key_fulfillment';
      return json({ ...emptyEvaluation, supportDelta: 4, effectiveContact: true,
        dimensionDeltas: { ...emptyEvaluation.dimensionDeltas, decisionAnalysis: 1 },
        memoryUpdates: [{ type: evaluationTurn === 1 ? 'commitment' : 'evidence', summary: tag, status: 'active', tags: [tag], mustMention: true }] });
    }
    return json(reply('请补充可验证的里程碑。'));
  } });
  const first = await service.execute('user-a', withMeta({ action: 'message', npcId: 'P1-002', channel: 'email', text: '确认里程碑并按约给出反馈', attachment: { title: '项目里程碑清单', content: 'SECRET_ATTACHMENT_BODY_SHOULD_NOT_LEAK' } }, 0));
  const sessionId = first.previewSessionId;
  const state = service.store.get('user-a', sessionId)!;
  assert.equal(first.npcTestStates?.length, 5, 'every preview AI response includes the five-person designer test snapshot');
  assert.deepEqual(first.npcTestStates?.map((item) => item.npcId), PREVIEW_NPC_IDS, 'designer test snapshots use the canonical NPC order');
  assert.equal(state.npcStates['P1-001'].pleasantness, 50, 'pleasantness starts from the current-system neutral midpoint');
  state.npcStates['P1-002'].support = 30;
  assert.equal(state.npcStates['P1-002'].effectiveContactCount, 1);
  assert.equal(state.npcStates['P1-002'].dimensionScores.decisionAnalysis, 1);
  assert.equal(resolvePreviewNode(state.npcStates['P1-002']), 'N2');
  assert.equal(prompts[0].includes('人物基础规则：'), true);
  const messagePrompt = prompts.find((prompt) => prompt.includes('请通过邮件回复'))!;
  for (const section of ['人物基础规则：', '状态节点与披露：', '状态：', '高价值工作记忆：', '最近有限历史：', '渠道通用修饰器：', '人物×渠道例外：']) assert.equal(messagePrompt.includes(section), true);
  assert.equal(messagePrompt.indexOf('人物基础规则：') < messagePrompt.indexOf('状态节点与披露：'), true);
  assert.equal(messagePrompt.indexOf('状态节点与披露：') < messagePrompt.indexOf('渠道通用修饰器：'), true);
  assert.equal(prompts.some((prompt) => prompt.includes('SECRET_ATTACHMENT_BODY_SHOULD_NOT_LEAK')), false, 'unviewed attachment content never enters model context');
  assert.equal(state.conversations['P1-002'][0].attachment?.viewed, false, 'attachment viewing state is retained');

  // The preview takes its support snapshot before every narrative generation,
  // then uses the same configurable thresholds as formal chat. Only the chosen
  // body is exposed to the model.
  const tierPromptConfig = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  tierPromptConfig.supportTierThresholds = { mediumMin: 40, highMin: 80 };
  tierPromptConfig.npcRolePrompts['P1-001'] = {
    base: 'PREVIEW_TIER_BASE', low: 'PREVIEW_TIER_LOW', medium: 'PREVIEW_TIER_MEDIUM', high: 'PREVIEW_TIER_HIGH',
  };
  const tierPrompts: string[] = [];
  const tierService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    tierPrompts.push(prompt);
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    return json(reply('请补充可核验材料。'));
  } });
  let tierResult = await tierService.execute('user-preview-tier', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请确认。' }, 0), tierPromptConfig);
  const tierState = tierService.store.get('user-preview-tier', tierResult.previewSessionId)!;
  tierState.npcStates['P1-001'].support = 39;
  tierResult = await tierService.execute('user-preview-tier', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请再次确认。' }, tierResult.version, tierResult.previewSessionId), tierPromptConfig);
  tierState.npcStates['P1-001'].support = 40;
  tierResult = await tierService.execute('user-preview-tier', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请补充下一步。' }, tierResult.version, tierResult.previewSessionId), tierPromptConfig);
  tierState.npcStates['P1-001'].support = 80;
  await tierService.execute('user-preview-tier', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请安排正式下一步。' }, tierResult.version, tierResult.previewSessionId), tierPromptConfig);
  const tierNarratives = tierPrompts.filter((prompt) => prompt.includes('请通过邮件回复'));
  assert.equal(tierNarratives.length, 4, 'every boundary value generates one preview narrative');
  for (const [prompt, expected, excluded] of [
    [tierNarratives[0], 'PREVIEW_TIER_LOW', 'PREVIEW_TIER_MEDIUM|PREVIEW_TIER_HIGH'],
    [tierNarratives[1], 'PREVIEW_TIER_LOW', 'PREVIEW_TIER_MEDIUM|PREVIEW_TIER_HIGH'],
    [tierNarratives[2], 'PREVIEW_TIER_MEDIUM', 'PREVIEW_TIER_LOW|PREVIEW_TIER_HIGH'],
    [tierNarratives[3], 'PREVIEW_TIER_HIGH', 'PREVIEW_TIER_LOW|PREVIEW_TIER_MEDIUM'],
  ] as const) {
    assert.match(prompt, new RegExp(expected));
    assert.doesNotMatch(prompt, new RegExp(excluded));
    assert.doesNotMatch(prompt, /"support"\s*:|mediumMin|highMin|档位来源/, 'preview runtime context must not expose support values, thresholds, or tier decisions');
  }

  const readPrompts: string[] = [];
  const readService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    readPrompts.push(prompt);
    if (prompt.includes('判断是否查看已收到的附件')) return json({ viewed: true, impact: '材料已查看，作为后续核验依据。' });
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json({
      ...emptyEvaluation,
      supportDelta: 2,
      effectiveContact: true,
      memoryUpdates: [
        { type: 'commitment', summary: 'NPC 不应在沉默中作出的承诺', status: 'active', tags: ['last_commitment_or_feedback'], mustMention: true },
        { type: 'evidence', summary: '玩家报告已完成验收记录，仍待 NPC 核验。', status: 'active', tags: ['last_commitment_or_feedback', 'player_report'], mustMention: true },
      ],
    });
    return json(readNoReply('current_priority_low'));
  } });
  const initialReadRequest = {
    action: 'message' as const, npcId: 'P1-001' as const, channel: 'wechat' as const, text: '验收记录已补齐，预算边界仍请您确认。',
    attachment: { title: '验收记录', content: 'VIEWED_ATTACHMENT_BODY_MAY_REACH_CONTEXT' }, commandId: 'initial-read-command'.padEnd(24, 'x'), expectedVersion: 0,
  };
  const read = await readService.execute('user-read', initialReadRequest);
  assert.equal(read.responseAction, 'read_no_reply');
  assert.equal(read.readStatus, 'read');
  assert.equal(read.content, null);
  assert.equal(read.invitationStatus, 'none');
  assert.equal(read.appointment, undefined);
  assert.equal(typeof read.playerMessageId, 'string');
  const readState = readService.store.get('user-read', read.previewSessionId)!;
  assert.equal(readState.conversations['P1-001'].length, 1, 'a read-without-reply stores no fabricated NPC message');
  assert.equal(readState.conversations['P1-001'][0]?.delivery?.reasonCode, 'current_priority_low', 'the internal diagnostic reason is retained with the real player message');
  assert.equal(readState.conversations['P1-001'][0]?.attachment?.viewed, true, 'attachment viewing remains independent from replying');
  assert.equal(readPrompts.some((prompt) => prompt.includes('VIEWED_ATTACHMENT_BODY_MAY_REACH_CONTEXT')), true, 'viewed attachment content can inform the NPC handling');
  assert.equal(readState.npcStates['P1-001'].support, 2, 'valuable player content remains scoreable without a reply');
  assert.equal(readState.npcStates['P1-001'].effectiveContactCount, 1, 'valuable player content remains an effective contact without a reply');
  assert.equal(readState.npcStates['P1-001'].workingMemory.some((entry) => entry.type === 'commitment' || entry.tags.includes('last_commitment_or_feedback')), false, 'silence cannot create commitments or node-unlocking memory');
  assert.equal(readState.npcStates['P1-001'].workingMemory.every((entry) => entry.sourceMessageIds.length === 1 && entry.sourceMessageIds[0] === read.playerMessageId), true, 'silent-turn memories cite only the real player message');
  const replayedInitialRead = await readService.execute('user-read', initialReadRequest);
  assert.deepEqual(replayedInitialRead, read, 'a lost initial response replays from the same command without a session id');
  readState.conversations['P1-001'].push({ messageId: 'prior-npc-evidence', role: 'npc', channel: 'wechat', text: '此前已收到的核验口径。', at: Date.now() });
  readState.npcStates['P1-001'].workingMemory.push({
    id: 'prior-npc-evidence-memory', type: 'evidence', summary: 'NPC 已确认的旧核验事实', status: 'active', tags: ['player_report'], mustMention: true, sourceMessageIds: ['prior-npc-evidence'],
  });
  const laterRead = await readService.execute('user-read', withMeta({ action: 'message', npcId: 'P1-001', channel: 'wechat', text: '补充同一份验收记录，请您有空核验。' }, read.version, read.previewSessionId));
  const preservedNpcEvidence = readState.npcStates['P1-001'].workingMemory.find((entry) => entry.id === 'prior-npc-evidence-memory')!;
  assert.equal(laterRead.responseAction, 'read_no_reply');
  assert.equal(preservedNpcEvidence.summary, 'NPC 已确认的旧核验事实', 'silence cannot rewrite an existing NPC-sourced evidence record');
  assert.deepEqual(preservedNpcEvidence.sourceMessageIds, ['prior-npc-evidence']);

  const badReadService = createPreviewAiService({ invoker: async (messages) => messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))
    ? json(emptyEvaluation)
    : json({ responseAction: 'read_no_reply', content: null, invitationStatus: 'none' }) });
  const badReadState = badReadService.store.create('user-bad-read');
  const badRead = await badReadService.execute('user-bad-read', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '收到，谢谢。' }, 0, badReadState.previewSessionId));
  assert.equal(badRead.responseAction, 'read_no_reply', 'LLM responseAction fields are ignored because Jev owns the silence decision');
  assert.equal(badReadState.conversations['P1-001'].length, 1, 'the Jev decision commits exactly the real player message');

  const whitespaceReplyService = createPreviewAiService({ invoker: async () => json({ responseAction: 'reply', content: '   ', invitationStatus: 'none' }) });
  const whitespaceReplyState = whitespaceReplyService.store.create('user-whitespace-reply');
  await assert.rejects(
    whitespaceReplyService.execute('user-whitespace-reply', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请确认。' }, 0, whitespaceReplyState.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol',
  );
  assert.equal(whitespaceReplyState.conversations['P1-001'].length, 0, 'blank reply output cannot leave a partial message');

  const appointmentSilenceService = createPreviewAiService({ invoker: async () => json({ ...readNoReply(), appointment: { timeWindow: '明天', location: '会议室', agenda: '错误预约' } }) });
  const appointmentSilenceState = appointmentSilenceService.store.create('user-silent-appointment');
  await assert.rejects(
    appointmentSilenceService.execute('user-silent-appointment', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '明天方便吗？' }, 0, appointmentSilenceState.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol',
  );
  assert.equal(appointmentSilenceState.conversations['P1-001'].length, 0, 'silent output cannot carry an appointment');

  const silentEvaluationFailureService = createPreviewAiService({ invoker: async (messages) => messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))
    ? json({ pleasureDelta: 99 })
    : json(readNoReply()) });
  const silentEvaluationFailureState = silentEvaluationFailureService.store.create('user-silent-evaluation-failure');
  const silentEvaluationResult = await silentEvaluationFailureService.execute('user-silent-evaluation-failure', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '验收记录已补齐。' }, 0, silentEvaluationFailureState.previewSessionId));
  assert.equal(silentEvaluationResult.responseAction, 'read_no_reply');
  assert.equal(silentEvaluationFailureState.version, 1, 'malformed non-authoritative prose cannot block a valid Jev evaluation');
  assert.equal(silentEvaluationFailureState.conversations['P1-001'].length, 1, 'the Jev-controlled read receipt is committed');
  assert.equal(silentEvaluationFailureState.npcStates['P1-001'].support, 2, 'Jev scoring remains authoritative when prose suggestions are malformed');

  const emailSilencePrompts: string[] = [];
  const emailSilenceService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    emailSilencePrompts.push(prompt);
    if (prompt.includes('判断是否查看已收到的附件')) return json({ viewed: false, impact: '暂未查看附件。' });
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    return json(readNoReply('natural_closure'));
  } });
  const emailSilence = await emailSilenceService.execute('user-email-silence', withMeta({ action: 'message', npcId: 'P1-002', channel: 'email', text: '收到，谢谢。', attachment: { title: '未读附件', content: 'EMAIL_UNVIEWED_ATTACHMENT_MUST_NOT_LEAK' } }, 0));
  assert.equal(emailSilence.responseAction, 'read_no_reply');
  assert.equal(emailSilence.readStatus, 'read');
  assert.equal(emailSilence.attachment?.viewed, false, 'email silence can retain an unviewed attachment');
  assert.equal(emailSilencePrompts.some((prompt) => prompt.includes('EMAIL_UNVIEWED_ATTACHMENT_MUST_NOT_LEAK')), false, 'unviewed email attachment content cannot enter a silent decision or evaluation');

  const phoneService = createPreviewAiService({ invoker: async (messages) => messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))
    ? json(emptyEvaluation)
    : json({ content: '请通过电话先说明具体事项。', invitationStatus: 'none' }) });
  const phone = await phoneService.execute('user-phone', withMeta({ action: 'phone_connect', npcId: 'P1-001', text: '请确认技术验收口径。' }, 0));
  assert.equal(phone.responseAction, undefined, 'phone retains its legacy public reply contract');
  assert.equal(phone.readStatus, undefined, 'phone does not expose asynchronous read status');
  assert.equal(phone.content, '请通过电话先说明具体事项。');
  const legacyWorkPhone = await phoneService.execute('user-phone', withMeta({ action: 'message', npcId: 'P1-001', channel: 'work_phone', text: '请确认技术验收口径。' }, phone.version, phone.previewSessionId));
  assert.equal(legacyWorkPhone.responseAction, undefined, 'work_phone message cannot enter the read_no_reply contract');
  assert.equal(legacyWorkPhone.readStatus, undefined, 'work_phone message remains a legacy synchronous reply');
  assert.equal(legacyWorkPhone.content, '请通过电话先说明具体事项。');

  const roleReversedReply = '您好，张总。我们是专注政企数字化交付的团队，刚中标了省里两个同类项目。';
  let labelledDrafts = 0;
  const labelledService = createPreviewAiService({ invoker: async (messages) => {
    if (messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))) return json(emptyEvaluation);
    labelledDrafts += 1;
    return json({ content: labelledDrafts === 1 ? '张建国：您好，您先说来意。' : '林先生您好，您请讲。' });
  } });
  const labelledState = labelledService.store.create('user-labelled-role-repair');
  const labelledResult = await labelledService.execute('user-labelled-role-repair', withMeta({
    action: 'phone_connect', npcId: 'P1-001', text: '您好，我是林先生。',
  }, 0, labelledState.previewSessionId));
  assert.equal(labelledDrafts, 2, 'an NPC speaker label is repaired before persistence');
  assert.equal(labelledResult.content, '林先生您好，您请讲。');
  assert.equal(labelledState.conversations['P1-001'].at(-1)?.text, labelledResult.content);
  const correctedReply = '我在听，请先用一句话说明要点。';
  const correctedPrompts: string[] = [];
  const correctedEvaluationPrompts: string[] = [];
  const correctedJevStates: string[] = [];
  let correctedGenerationCount = 0;
  const correctedPhoneService = createPreviewAiService({
    invoker: async (messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('独立评估刚刚完成的 NPC 正文')) {
        correctedEvaluationPrompts.push(prompt);
        return json(emptyEvaluation);
      }
      correctedPrompts.push(prompt);
      correctedGenerationCount += 1;
      if (messages.some((message) => message.content.includes('发言身份校验失败'))) return json({ content: correctedReply });
      return json({ content: roleReversedReply });
    },
    jevInvoker: async (request) => {
      correctedJevStates.push(typeof request.state === 'string' ? request.state : JSON.stringify(request.state));
      return testJevInvoker(request);
    },
  });
  const correctedState = correctedPhoneService.store.create('user-phone-role-repair');
  const oldBadNpcMessageId = 'prior-role-reversal';
  correctedState.conversations['P1-001'].push({
    messageId: oldBadNpcMessageId, role: 'npc', channel: 'work_phone', text: roleReversedReply, at: Date.now(),
  });
  const correctedPhone = await correctedPhoneService.execute('user-phone-role-repair', withMeta({
    action: 'phone_connect', npcId: 'P1-001', text: '请确认技术验收口径。',
  }, 0, correctedState.previewSessionId));
  assert.equal(correctedPhone.content, correctedReply, 'one role-reversed phone reply is regenerated as the target NPC');
  assert.equal(correctedGenerationCount, 2, 'the invalid first phone response triggers exactly one regenerated response');
  assert.equal(correctedPrompts.length, 2, 'the role quality gate makes only one targeted retry');
  assert.equal(correctedPrompts[1].includes('发言身份校验失败'), true, 'the retry explains the target NPC identity error');
  assert.equal(correctedPrompts[0].includes(roleReversedReply), false, 'a known role-reversed history entry is excluded from the generation context');
  assert.equal(correctedEvaluationPrompts.length, 1);
  assert.equal(correctedEvaluationPrompts[0].includes(roleReversedReply), false, 'the rejected first draft never reaches NPC evaluation');
  assert.equal(correctedEvaluationPrompts[0].includes(correctedReply), true, 'NPC evaluation receives only the repaired reply');
  assert.equal(correctedJevStates.some((value) => value.includes(roleReversedReply)), false, 'Jev evaluation and memory processing never receive the rejected draft');
  assert.equal(correctedState.conversations['P1-001'].find((message) => message.messageId === oldBadNpcMessageId)?.text, roleReversedReply, 'raw historical transcript remains available for audit');
  assert.equal(correctedState.conversations['P1-001'].filter((message) => message.messageId !== oldBadNpcMessageId).some((message) => message.text === roleReversedReply), false, 'the rejected draft is not saved as a new conversation message');
  assert.equal(JSON.stringify(correctedState.npcStates['P1-001'].workingMemory).includes(roleReversedReply), false, 'the rejected draft cannot enter working memory');

  const fallbackPrompts: string[] = [];
  const supplierSelfIdentification = '我是乙方，负责方案交付。';
  let fallbackGenerationCount = 0;
  const fallbackPhoneService = createPreviewAiService({
    invoker: async (messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
      fallbackPrompts.push(prompt);
      fallbackGenerationCount += 1;
      return json({ content: supplierSelfIdentification });
    },
  });
  const fallbackState = fallbackPhoneService.store.create('user-phone-role-fallback');
  const fallbackPhone = await fallbackPhoneService.execute('user-phone-role-fallback', withMeta({
    action: 'phone_connect', npcId: 'P1-001', text: '请确认技术验收口径。',
  }, 0, fallbackState.previewSessionId));
  assert.equal(fallbackGenerationCount, 2, 'two role-invalid phone responses stop after one retry');
  assert.equal(fallbackPrompts.length, 2);
  assert.equal(fallbackPrompts[1].includes('发言身份校验失败'), true, 'the only retry is targeted at the role reversal');
  assert.equal(fallbackPhone.content, '我在听，请先用一句话说明要点。', 'a repeated role error returns a short phone-safe NPC fallback');
  assert.equal(fallbackState.conversations['P1-001'].at(-1)?.text, fallbackPhone.content, 'only the safe fallback is saved to the session');
  assert.equal(fallbackState.conversations['P1-001'].some((message) => message.text === roleReversedReply), false, 'neither invalid generation is saved to conversation history');

  const nameMentionService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    return prompt.includes('独立评估刚刚完成的 NPC 正文') ? json(emptyEvaluation)
      : json({ content: '张建国只负责方向判断，技术问题请先和我核对数据。' });
  } });
  const legitimateNameMention = await nameMentionService.execute('user-phone-name-mention', withMeta({
    action: 'phone_connect', npcId: 'P1-002', text: '张总关心哪些技术依据？',
  }, 0));
  assert.equal(legitimateNameMention.content, '张建国只负责方向判断，技术问题请先和我核对数据。', 'the identity gate preserves a valid reference to another person and a business topic');

  let normalPhoneIntroCalls = 0;
  const normalPhoneIntroService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    normalPhoneIntroCalls += 1;
    return json({ content: '喂，您好，我是张建国，现在方便说话吗？' });
  } });
  const normalPhoneIntro = await normalPhoneIntroService.execute('user-phone-normal-intro', withMeta({
    action: 'phone_connect', npcId: 'P1-001', text: '您好，请问是张总吗？',
  }, 0));
  assert.equal(normalPhoneIntro.content, '喂，您好，我是张建国，现在方便说话吗？', 'first-person self-identification by the target NPC is valid');
  assert.equal(normalPhoneIntroCalls, 1, 'a normal phone introduction passes without regeneration');

  let validBusinessReplyCalls = 0;
  const validBusinessReplyService = createPreviewAiService({ invoker: async (messages) => {
    if (messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))) return json(emptyEvaluation);
    validBusinessReplyCalls += 1;
    return json({ content: '我们是要看你们的解决方案能否解决实际问题，请先说清可验证的结果。' });
  } });
  const validBusinessReply = await validBusinessReplyService.execute('user-phone-valid-business', withMeta({
    action: 'phone_connect', npcId: 'P1-001', text: '我们带来了方案。',
  }, 0));
  assert.match(validBusinessReply.content || '', /解决方案/);
  assert.equal(validBusinessReplyCalls, 1, 'business discussion is not mistaken for vendor self-identification');

  const reversedVisitReply = '您好，张总。我们是专注政企数字化交付的团队，刚中标了省里两个同类项目。';
  const repairedVisitReply = '我在听，请先用一句话说明要点。';
  const visitGenerationPrompts: string[] = [];
  const visitEvaluationPrompts: string[] = [];
  const visitJevStates: string[] = [];
  let visitGenerationCount = 0;
  const visitRoleService = createPreviewAiService({
    invoker: async (messages) => {
      const prompt = messages.map((message) => message.content).join('\n');
      if (prompt.includes('独立评估刚刚完成的 NPC 正文')) {
        visitEvaluationPrompts.push(prompt);
        return json(emptyEvaluation);
      }
      visitGenerationPrompts.push(prompt);
      visitGenerationCount += 1;
      return json({ content: messages.some((message) => message.content.includes('发言身份校验失败')) ? repairedVisitReply : reversedVisitReply });
    },
    jevInvoker: async (request) => {
      visitJevStates.push(typeof request.state === 'string' ? request.state : JSON.stringify(request.state));
      return testJevInvoker(request);
    },
  });
  const visitRoleStarted = await visitRoleService.execute('user-visit-role-repair', withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: true }, 0));
  const visitRoleState = visitRoleService.store.get('user-visit-role-repair', visitRoleStarted.previewSessionId)!;
  const repairedVisit = await visitRoleService.execute('user-visit-role-repair', withMeta({
    action: 'visit_turn', npcId: 'P1-001', text: '您好，请问您对方案有什么要求？',
  }, visitRoleStarted.version, visitRoleStarted.previewSessionId));
  assert.equal(repairedVisit.content, repairedVisitReply, 'a role-reversed in-person reply is regenerated as the target NPC');
  assert.equal(visitGenerationCount, 2, 'a role-reversed in-person reply triggers exactly one regeneration');
  assert.equal(visitGenerationPrompts[0].includes('发言身份锁定'), true, 'the actual visit prompt explicitly locks the NPC speaker identity');
  assert.equal(visitGenerationPrompts[1].includes('发言身份校验失败'), true, 'the actual visit retry identifies the role error');
  assert.equal(visitGenerationPrompts[1].includes(reversedVisitReply), false, 'the rejected draft is not echoed into the retry context');
  assert.equal(visitEvaluationPrompts.length, 1);
  assert.equal(visitEvaluationPrompts[0].includes(reversedVisitReply), false, 'the rejected in-person draft never reaches NPC evaluation');
  assert.equal(visitEvaluationPrompts[0].includes(repairedVisitReply), true, 'NPC evaluation receives only the repaired in-person reply');
  assert.equal(visitJevStates.some((value) => value.includes(reversedVisitReply)), false, 'Jev decision and evaluation never receive the rejected in-person draft');
  assert.equal(visitRoleState.conversations['P1-001'].some((message) => message.text === reversedVisitReply), false, 'the rejected in-person draft is never saved to conversation history');
  assert.equal(visitRoleState.conversations['P1-001'].at(-1)?.text, repairedVisitReply, 'the repaired in-person reply is saved');

  let visitNameMentionCalls = 0;
  const visitNameMentionService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    visitNameMentionCalls += 1;
    return json({ content: '张建国负责方向判断，技术问题请先和我核对数据。' });
  } });
  const visitNameMentionStarted = await visitNameMentionService.execute('user-visit-name-mention', withMeta({ action: 'start_visit', npcId: 'P1-002', skipPreparation: true }, 0));
  const visitNameMention = await visitNameMentionService.execute('user-visit-name-mention', withMeta({
    action: 'visit_turn', npcId: 'P1-002', text: '张总关心哪些技术依据？',
  }, visitNameMentionStarted.version, visitNameMentionStarted.previewSessionId));
  assert.equal(visitNameMention.content, '张建国负责方向判断，技术问题请先和我核对数据。', 'the visit identity gate allows a normal reference to another person');
  assert.equal(visitNameMentionCalls, 1, 'a valid visit reply mentioning another person passes without regeneration');

  const wechatRolePrompts: string[] = [];
  const wechatRoleService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    wechatRolePrompts.push(prompt);
    return json({ content: messages.some((message) => message.content.includes('发言身份校验失败')) ? repairedVisitReply : reversedVisitReply });
  } });
  const repairedWechat = await wechatRoleService.execute('user-wechat-role-repair', withMeta({
    action: 'wechat_request', npcId: 'P1-001', text: '申请工作微信，后续方便沟通验收资料。',
  }, 0));
  assert.equal(repairedWechat.content, repairedVisitReply, 'a role-reversed work-WeChat response is regenerated as the target NPC');
  assert.equal(wechatRolePrompts.length, 2, 'a role-reversed work-WeChat response triggers exactly one regeneration');
  assert.equal(wechatRolePrompts[0].includes('发言身份锁定'), true, 'the work-WeChat prompt explicitly locks the NPC speaker identity');
  assert.equal(wechatRolePrompts[1].includes('发言身份校验失败'), true, 'the work-WeChat retry identifies the role error');

  const redlineReadService = createPreviewAiService({ invoker: async (messages) => messages.some((message) => message.content.includes('独立评估刚刚完成的 NPC 正文'))
    ? json(emptyEvaluation)
    : json(readNoReply('unwilling_to_advance')) });
  const forcedRedlineReply = await redlineReadService.execute('user-redline-read', withMeta({ action: 'message', npcId: 'P1-003', channel: 'wechat', text: '我们可以给现金回扣并保证中标。' }, 0));
  assert.equal(forcedRedlineReply.responseAction, 'reply', 'a compliance redline overrides a model read_no_reply decision');
  assert.equal(forcedRedlineReply.readStatus, 'read');
  assert.equal(forcedRedlineReply.invitationStatus, 'rejected');
  assert.match(forcedRedlineReply.content ?? '', /不能接受/);

  const adjusted = await service.execute('user-a', withMeta({ action: 'test_adjust_npcs', adjustments: [
    { npcId: 'P1-001', support: 35, pleasantness: 82, effectiveContactCount: 4 },
    { npcId: 'P1-005', support: 66, pleasantness: 21, effectiveContactCount: 7 },
  ] }, first.version, sessionId));
  assert.equal(adjusted.npcTestStates?.length, 5, 'test adjustment returns every current NPC metric, including unchanged people');
  assert.deepEqual(adjusted.npcTestStates?.filter((item) => item.npcId === 'P1-001' || item.npcId === 'P1-005'), [
    { npcId: 'P1-001', support: 35, pleasantness: 82, effectiveContactCount: 4, node: 'N1' },
    { npcId: 'P1-005', support: 66, pleasantness: 21, effectiveContactCount: 7, node: 'N1' },
  ], 'test adjustment returns the authoritative server values and computed nodes');
  assert.equal(state.npcStates['P1-001'].support, 35);
  assert.equal(state.npcStates['P1-001'].pleasantness, 82);
  assert.equal(state.npcStates['P1-001'].effectiveContactCount, 4);
  assert.equal(prompts.length, 3, 'test adjustment does not invoke the model');

  const appointmentService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    if (prompt.includes('这是实际拜访第')) return json({ content: '好，那今天先到这里。', completedTask: null, playerDialogueSignal: 'farewell', npcDialogueSignal: 'farewell' });
    return json({ responseAction: 'reply', content: '明天可以在办公室见面。', invitationStatus: 'accepted', appointment: { timeWindow: '明天 10:00', location: '客户办公室', agenda: '确认验收口径' } });
  } });
  const appointmentCreated = await appointmentService.execute('user-appointment', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '明天方便在办公室确认验收口径吗？' }, 0));
  assert(appointmentCreated.appointment, 'accepted invitation must create a server appointment');
  assert.equal(appointmentCreated.appointment.npcId, 'P1-001');
  const appointmentState = appointmentService.store.get('user-appointment', appointmentCreated.previewSessionId)!;
  assert.deepEqual(appointmentState.appointments['P1-001'], appointmentCreated.appointment, 'appointment is stored in the server preview session');
  appointmentState.conversations['P1-001'].push(...Array.from({ length: 150 }, (_, index) => ({
    messageId: `older-email-${index}`,
    role: 'player' as const,
    channel: 'email' as const,
    text: `旧邮件历史 ${index}`,
    at: index + 1,
  })));
  appointmentState.conversations['P1-001'].push(
    { messageId: 'previous-visit-npc', role: 'npc', channel: 'visit', text: '上一次拜访的客户结束语。', at: 1 },
    { messageId: 'previous-visit-player', role: 'player', channel: 'visit', text: '上一场的最后一句。', at: 2 },
  );
  const appointmentUpdated = await appointmentService.execute('user-appointment', withMeta({ action: 'test_adjust_appointments', appointments: [{
    npcId: 'P1-001', appointmentId: appointmentCreated.appointment.id, status: 'accepted', timeWindow: '明天 14:00', location: '客户办公室 4 楼', agenda: '复核上线与验收计划',
  }] }, appointmentCreated.version, appointmentCreated.previewSessionId));
  assert.deepEqual(appointmentUpdated.appointments, [{ ...appointmentCreated.appointment, timeWindow: '明天 14:00', location: '客户办公室 4 楼', agenda: '复核上线与验收计划' }], 'appointment test adjustment returns the authoritative server appointment');
  assert.deepEqual(appointmentState.appointments['P1-001'], appointmentUpdated.appointments[0]);
  appointmentState.approvedVisitPreparations['P1-001'] = '已准备拜访';
  const visitStarted = await appointmentService.execute('user-appointment', withMeta({ action: 'start_visit', npcId: 'P1-001' }, appointmentUpdated.version, appointmentCreated.previewSessionId));
  assert.equal(visitStarted.npcExpression, 'calm', 'start_visit returns a safe visible NPC expression');
  assert.deepEqual(visitStarted.meeting?.historyMessageIds, [], 'each newly started visit begins with an empty visit-only message history');
  assert.deepEqual(toPreviewRecoveryDto(appointmentState).activeMeeting?.historyMessageIds, [], 'recovery preserves the new visit boundary');
  assert.equal(toPreviewRecoveryDto(appointmentState).conversations['P1-001'].length, 100, 'recovery may truncate the conversation payload without changing its visit boundary');
  const farewell = await appointmentService.execute('user-appointment', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '感谢您的时间，今天先这样，改天再聊。' }, visitStarted.version, appointmentCreated.previewSessionId));
  assert.equal(farewell.npcExpression, 'calm', 'visit_turn returns the current safe visible NPC expression');
  assert.equal(farewell.meeting?.meetingEnded, true, 'farewell visit turn ends the active meeting');
  assert.equal(farewell.content, '好，那今天先到这里。', 'player farewell allows exactly one final NPC reply');
  assert.equal(farewell.meeting?.historyMessageIds?.length, 2, 'the active visit response returns only its own player and NPC message IDs');
  assert.equal(farewell.meeting?.historyMessageIds?.includes('previous-visit-npc'), false, 'prior visit message IDs are excluded');
  assert.deepEqual(farewell.appointment, { ...appointmentUpdated.appointments[0], status: 'completed' }, 'farewell visit turn completes the authoritative appointment');
  assert.equal(appointmentState.appointments['P1-001']?.status, 'completed');
  const appointmentVersion = appointmentState.version;
  await assert.rejects(
    appointmentService.execute('user-appointment', withMeta({ action: 'test_adjust_appointments', appointments: [{ npcId: 'P1-001', appointmentId: '00000000-0000-0000-0000-000000000001', location: '伪造地点' }] }, farewell.version, appointmentCreated.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol',
    'appointment IDs cannot be used across server appointments',
  );
  assert.equal(appointmentState.version, appointmentVersion, 'rejected appointment adjustment does not commit a version or state');
  const appointmentCleared = await appointmentService.execute('user-appointment', withMeta({ action: 'test_adjust_appointments', appointments: [{ npcId: 'P1-001', status: 'none' }] }, farewell.version, appointmentCreated.previewSessionId));
  assert.deepEqual(appointmentCleared.appointments, [], 'status none clears the server appointment');
  assert.equal(appointmentState.appointments['P1-001'], undefined);
  const secondVisit = await appointmentService.execute('user-appointment', withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: true }, appointmentCleared.version, appointmentCreated.previewSessionId));
  assert.deepEqual(secondVisit.meeting?.historyMessageIds, [], 'a second visit starts without showing the prior visit');
  const secondVisitTurn = await appointmentService.execute('user-appointment', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '我们再次见面，今天想补充一下项目情况。' }, secondVisit.version, appointmentCreated.previewSessionId));
  assert.equal(secondVisitTurn.meeting?.historyMessageIds?.length, 2, 'the second visit reveals its own new dialogue as it arrives');
  assert.equal(secondVisitTurn.meeting?.historyMessageIds?.some((messageId) => ['previous-visit-npc', 'previous-visit-player'].includes(messageId)), false, 'the second visit boundary remains isolated');
  const secondVisitRecovery = toPreviewRecoveryDto(appointmentState).activeMeeting;
  assert.deepEqual(secondVisitRecovery?.historyMessageIds, secondVisitTurn.meeting?.historyMessageIds, 'GET recovery restores the same current-visit message IDs');
  assert.ok(secondVisitRecovery?.historyMessageIds?.every((messageId) => toPreviewRecoveryDto(appointmentState).conversations['P1-001'].some((message) => message.messageId === messageId)), 'current visit IDs remain valid within a truncated recovery conversation');

  const skipService = createPreviewAiService({ invoker: async () => { throw new Error('skipping preparation must not call AI before the visit'); } });
  const skipAppointment = await skipService.execute('user-skip-preparation', withMeta({ action: 'test_adjust_appointments', appointments: [{ npcId: 'P1-002', status: 'accepted', location: '客户办公室' }] }, 0));
  await assert.rejects(
    skipService.execute('user-skip-preparation', withMeta({ action: 'start_visit', npcId: 'P1-002' }, skipAppointment.version, skipAppointment.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol',
    'ordinary visit start still requires approved preparation',
  );
  const skippedVisit = await skipService.execute('user-skip-preparation', withMeta({ action: 'start_visit', npcId: 'P1-002', skipPreparation: true }, skipAppointment.version, skipAppointment.previewSessionId));
  assert.equal(skippedVisit.meeting?.meetingEnded, false, 'skip preparation enters the actual visit');
  assert.equal(skipService.store.get('user-skip-preparation', skipAppointment.previewSessionId)?.approvedVisitPreparations['P1-002'], undefined, 'skipping does not create a fake preparation');

  let forcedExitCalls = 0;
  const forcedExitService = createPreviewAiService({ invoker: async (messages) => {
    forcedExitCalls += 1;
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    return json({ content: '我今天有些忙，后面还有个会。', completedTask: null });
  } });
  const forcedExitStarted = await forcedExitService.execute('user-forced-exit', withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: true }, 0));
  const forcedExit = await forcedExitService.execute('user-forced-exit', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '我想介绍一下项目方案。' }, forcedExitStarted.version, forcedExitStarted.previewSessionId));
  assert.equal(forcedExit.meeting?.meetingEnded, true, 'NPC time constraint immediately ends the visit');
  assert.equal(forcedExit.meeting?.endReason, 'npc_time_constraint');
  assert.equal(forcedExitCalls, 2, 'forced exit still evaluates the completed turn before ending');

  let npcFarewellCalls = 0;
  const npcFarewellService = createPreviewAiService({ invoker: async (messages) => {
    npcFarewellCalls += 1;
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    return json({ content: '今天就到这吧，再见。', completedTask: null });
  } });
  const npcFarewellStarted = await npcFarewellService.execute('user-npc-farewell', withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: true }, 0));
  const npcFarewell = await npcFarewellService.execute('user-npc-farewell', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '这是本轮新增的项目信息。' }, npcFarewellStarted.version, npcFarewellStarted.previewSessionId));
  assert.equal(npcFarewell.meeting?.meetingEnded, false, 'NPC farewell leaves room for one final player reply');
  assert.equal(npcFarewell.meeting?.awaitingFinalReplyFrom, 'player');
  await assert.rejects(
    npcFarewellService.execute('user-npc-farewell', withMeta({ action: 'end_visit', npcId: 'P1-001' }, npcFarewell.version, npcFarewellStarted.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol' && error.message === 'FINAL_PLAYER_REPLY_REQUIRED',
    'manual end cannot skip the required final player reply',
  );
  assert.equal(npcFarewellService.store.get('user-npc-farewell', npcFarewellStarted.previewSessionId)?.version, npcFarewell.version, 'rejected end_visit does not commit a version');
  const finalPlayerReply = await npcFarewellService.execute('user-npc-farewell', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '好的，谢谢，您先忙。' }, npcFarewell.version, npcFarewellStarted.previewSessionId));
  assert.equal(finalPlayerReply.content, undefined, 'final player reply does not trigger another NPC reply');
  assert.equal(finalPlayerReply.npcExpression, 'calm', 'the final visit_turn still returns the safe NPC expression');
  assert.equal(finalPlayerReply.meeting?.meetingEnded, true);
  assert.equal(finalPlayerReply.meeting?.endReason, 'npc_farewell');
  assert.equal(npcFarewellCalls, 2, 'final player reply closes without another model call');
  await assert.rejects(
    npcFarewellService.execute('user-npc-farewell', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '第三句话不应被接受。' }, finalPlayerReply.version, npcFarewellStarted.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol' && error.message === 'NO_ACTIVE_VISIT_FOR_NPC',
    'the meeting rejects any utterance after the single final reply',
  );

  const negatedTimeConstraintService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json(emptyEvaluation);
    return json({ content: '我今天不忙，也没有会，可以继续。', completedTask: null });
  } });
  const negatedStarted = await negatedTimeConstraintService.execute('user-negated-time', withMeta({ action: 'start_visit', npcId: 'P1-001', skipPreparation: true }, 0));
  const negatedReply = await negatedTimeConstraintService.execute('user-negated-time', withMeta({ action: 'visit_turn', npcId: 'P1-001', text: '那我们继续聊方案。' }, negatedStarted.version, negatedStarted.previewSessionId));
  assert.equal(negatedReply.meeting?.meetingEnded, false, 'negated busy and meeting phrases do not force an exit');
  assert.equal(negatedReply.meeting?.awaitingFinalReplyFrom, undefined);

  const second = await service.execute('user-a', withMeta({ action: 'message', npcId: 'P1-002', channel: 'email', text: '这里是已经验证的改进证据。' }, adjusted.version, sessionId));
  state.npcStates['P1-002'].support = 50;
  assert.equal(resolvePreviewNode(state.npcStates['P1-002']), 'N3');
  const third = await service.execute('user-a', withMeta({ action: 'message', npcId: 'P1-002', channel: 'email', text: '关键诉求已经按验收记录兑现。' }, second.version, sessionId));
  state.npcStates['P1-002'].support = 70;
  assert.equal(resolvePreviewNode(state.npcStates['P1-002']), 'N4');
  const messages = state.conversations['P1-002'];
  assert.equal(messages.every((message) => Boolean(message.messageId)), true);
  for (const memory of state.npcStates['P1-002'].workingMemory) {
    assert.equal(memory.sourceMessageIds.length > 0, true);
    assert.equal(memory.sourceMessageIds.every((id) => messages.some((message) => message.messageId === id)), true);
  }

  const incomplete = { ...state.npcStates['P1-002'], support: 100, effectiveContactCount: 3, activeBlockers: [], workingMemory: [] };
  assert.equal(resolvePreviewNode(incomplete), 'N1', 'support and contacts alone cannot upgrade without required evidence');

  const redlineService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) return json({ ...emptyEvaluation, pleasureDelta: 6, supportDelta: 4, effectiveContact: true });
    return json(reply('请按正式流程沟通。'));
  } });
  const redline = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '我们可以先给现金回扣，也保证中标。' }, 0));
  assert.match(redline.content ?? '', /不能接受/);
  assert.equal(redline.invitationStatus, 'rejected');
  const redlineState = redlineService.store.get('user-red', redline.previewSessionId)!;
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), true);
  assert.equal(redlineState.npcStates['P1-003'].support, 0, 'hard redline cannot create positive support');
  assert.equal(redlineState.npcStates['P1-003'].pleasantness, 42, 'hard redline enforces a negative pleasantness outcome');
  assert.equal(redlineState.npcStates['P1-003'].effectiveContactCount, 0, 'hard redline is not an effective contact');
  assert.equal(resolvePreviewNode(redlineState.npcStates['P1-003']), 'BLOCKED', 'deterministic redline blocks node promotion');

  const unresolved = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '请继续按正式流程沟通。' }, redline.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), true, 'a generic formal-process statement cannot remove a blocker');
  assert.equal(resolvePreviewNode(redlineState.npcStates['P1-003']), 'BLOCKED');

  const negatedWithdrawal = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '我们不会撤回现金回扣，但会走正式采购流程。' }, unresolved.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), true, 'negating a withdrawal cannot remove a blocker');

  const residualRedline = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '我们撤回现金回扣，但仍要求保证中标，并改走正式采购流程。' }, negatedWithdrawal.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), true, 'withdrawing one redline while retaining another cannot remove a blocker');

  const thirdPartyRepair = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '王主任已经撤回现金回扣，并会走正式采购流程。' }, residualRedline.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), true, 'a third-party withdrawal cannot remove the player blocker');

  const repaired = await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '我们撤回现金回扣提议，改走正式采购流程并提交书面澄清留痕。' }, thirdPartyRepair.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].activeBlockers.includes('compliance_redline'), false, 'an explicit withdrawal plus formal remedy deterministically removes the blocker');
  assert.notEqual(resolvePreviewNode(redlineState.npcStates['P1-003']), 'BLOCKED');
  const blockerMemory = redlineState.npcStates['P1-003'].workingMemory.find((entry) => entry.type === 'blocker' && entry.tags.includes('compliance_redline'));
  assert.equal(blockerMemory?.status, 'resolved', 'removing a blocker resolves its linked working-memory record');
  assert.equal(blockerMemory?.mustMention, false);
  assert.equal(blockerMemory?.sourceMessageIds.includes(redlineState.conversations['P1-003'].at(-2)!.messageId), true, 'repair memory links to the actual player message');

  redlineState.npcStates['P1-003'].support = 99;
  redlineState.npcStates['P1-003'].pleasantness = 99;
  await redlineService.execute('user-red', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '请确认合规的书面验收流程。' }, repaired.version, redline.previewSessionId));
  assert.equal(redlineState.npcStates['P1-003'].support, 100, 'support is clamped to 100');
  assert.equal(redlineState.npcStates['P1-003'].pleasantness, 100, 'pleasantness is clamped to 100');

  const failedService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    return prompt.includes('独立评估刚刚完成的 NPC 正文') ? json({ pleasureDelta: 99 }) : json(reply('请说明。'));
  } });
  const failedState = failedService.store.create('user-failure');
  const ignoredDecisionFields = await failedService.execute('user-failure', withMeta({ action: 'message', npcId: 'P1-001', channel: 'email', text: '请确认下一步。' }, 0, failedState.previewSessionId));
  assert.equal(ignoredDecisionFields.content, '请说明。');
  assert.equal(failedState.conversations['P1-001'].length, 2, 'valid prose is committed even when its legacy decision fields are malformed');
  assert.equal(failedState.npcStates['P1-001'].support, 2, 'Jev scoring replaces malformed LLM decision fields');

  const modelBlockerMemoryService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('独立评估刚刚完成的 NPC 正文')) {
      return json({ ...emptyEvaluation, blockerUpdates: [{ action: 'add', value: 'compliance_redline' }], memoryUpdates: [{ type: 'blocker', summary: 'model_invented_blocker', status: 'active', tags: ['blocker', 'compliance_redline'], mustMention: true }] });
    }
    return json(reply('请按正式流程沟通。'));
  } });
  const modelBlockerMemory = await modelBlockerMemoryService.execute('user-memory', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '请说明正式验收口径。' }, 0));
  const modelBlockerMemoryState = modelBlockerMemoryService.store.get('user-memory', modelBlockerMemory.previewSessionId)!;
  assert.deepEqual(modelBlockerMemoryState.npcStates['P1-003'].activeBlockers, [], 'model output cannot activate a blocker');
  assert.equal(modelBlockerMemoryState.npcStates['P1-003'].workingMemory.some((entry) => entry.type === 'blocker'), false, 'model memory cannot forge blocker status');

  const staleMemoryPrompts: string[] = [];
  const staleMemoryService = createPreviewAiService({ invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    staleMemoryPrompts.push(prompt);
    return prompt.includes('独立评估刚刚完成的 NPC 正文') ? json(emptyEvaluation) : json(reply('请说明正式验收口径。'));
  } });
  const staleMemoryState = staleMemoryService.store.create('user-stale-memory');
  staleMemoryState.npcStates['P1-003'].workingMemory.push({ id: 'stale-memory', type: 'commitment', summary: 'STALE_MEMORY_MUST_NOT_REACH_PROMPT', status: 'superseded', tags: ['stale'], mustMention: true, sourceMessageIds: [] });
  staleMemoryState.npcStates['P1-003'].workingMemory.push({ id: 'resolved-memory', type: 'evidence', summary: 'RESOLVED_MEMORY_MUST_NOT_REACH_PROMPT', status: 'resolved', tags: ['resolved'], mustMention: true, sourceMessageIds: [] });
  await staleMemoryService.execute('user-stale-memory', withMeta({ action: 'message', npcId: 'P1-003', channel: 'email', text: '请说明正式验收口径。' }, 0, staleMemoryState.previewSessionId));
  assert.equal(staleMemoryPrompts.some((prompt) => /(?:STALE|RESOLVED)_MEMORY_MUST_NOT_REACH_PROMPT/.test(prompt)), false, 'superseded/resolved must-mention memory cannot enter the high-value prompt context');

  await service.execute('user-a', withMeta({ action: 'reset' }, third.version, sessionId));
  assert.equal(state.npcStates['P1-002'].support, 0);
  assert.equal(state.npcStates['P1-002'].workingMemory.length, 0);
  assert.equal(state.conversations['P1-002'].length, 0);

  const replayService = createPreviewAiService({ invoker: async () => json({ needsDetail: false, matchedNpcIds: [], recommendations: [] }) });
  const replayRequest = withMeta({ action: 'plan' as const, text: '先确认目标、决策链和下一步安排。' }, 0);
  const replayFirst = await replayService.execute('user-r', replayRequest);
  const replaySecond = await replayService.execute('user-r', { ...replayRequest, previewSessionId: replayFirst.previewSessionId });
  assert.deepEqual(replaySecond, replayFirst, 'same commandId replays cached response');
  await assert.rejects(
    replayService.execute('user-r', withMeta({ action: 'plan', text: '另一份计划。' }, 0, replayFirst.previewSessionId)),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'conflict',
  );

  let now = 0;
  const store = new PreviewSessionStore({ capacity: 2, ttlMs: 10, now: () => now });
  const one = store.create('user-one');
  const two = store.create('user-two');
  one.wechat['P1-001'] = 'accepted';
  assert.equal(two.wechat['P1-001'], undefined);
  now = 20;
  assert.equal(store.size(), 0, 'expired sessions are cleaned up');

  const hashRequest = withMeta({ action: 'plan' as const, text: '确认验收边界和下一步。' }, 0);
  assert.equal(
    getPreviewRequestHash({ ...hashRequest, previewSessionId: '00000000-0000-4000-8000-000000000014', expectedVersion: 9 }),
    getPreviewRequestHash(hashRequest),
    'a first-command retry may add the server session id and observe a later version',
  );
  assert.notEqual(
    getPreviewRequestHash({ ...hashRequest, text: '改写后的正文不应重放。' }),
    getPreviewRequestHash(hashRequest),
    'reusing a command id with changed content must be rejected by the database hash check',
  );

  // Production persistence adapter: a command lease owns the pre-state, and
  // only a fully validated result can replace it. This deliberately exercises
  // no PreviewSessionStore fallback.
  const durableState = createPreviewServerState('durable-user', '00000000-0000-4000-8000-000000000010');
  let durableResponse: unknown;
  let durableCommits = 0;
  let durableAbandons = 0;
  const durablePersistence: PreviewSessionPersistence = {
    acquire: async () => ({
      previewSessionId: durableState.previewSessionId,
      version: durableState.version,
      state: fromPersistedPreviewServerState(toPersistedPreviewServerState(durableState), durableState.userId, durableState.previewSessionId, durableState.version),
      leaseToken: '00000000-0000-4000-8000-000000000011',
    }),
    commit: async ({ state, response }) => {
      durableCommits += 1;
      Object.assign(durableState, state);
      durableResponse = response;
      return response;
    },
    renew: async () => undefined,
    abandon: async () => { durableAbandons += 1; },
  };
  const durableService = createPreviewAiService({ invoker: async () => json({ needsDetail: false, matchedNpcIds: ['P1-001'], recommendations: ['先确认验收边界。'] }) });
  const durableResult = await durableService.executePersistent('durable-user', withMeta({ action: 'plan', text: '确认验收边界和下一步。' }, 0), durablePersistence);
  assert.equal(durableCommits, 1, 'persistent execution commits exactly once after a valid result');
  assert.equal(durableAbandons, 0, 'successful persistent execution does not abandon its lease');
  assert.equal(durableState.version, 1, 'persistent state advances only at commit');
  assert.equal(durableResponse, durableResult, 'persistent commit returns the public response');

  const failedDurableState = createPreviewServerState('durable-failure', '00000000-0000-4000-8000-000000000012');
  const failedDurablePersistence: PreviewSessionPersistence = {
    acquire: async () => ({ previewSessionId: failedDurableState.previewSessionId, version: 0, state: failedDurableState, leaseToken: '00000000-0000-4000-8000-000000000013' }),
    commit: async () => { throw new Error('commit must not run for an invalid model result'); },
    renew: async () => undefined,
    abandon: async () => { durableAbandons += 1; },
  };
  const failedDurableService = createPreviewAiService({ invoker: async () => 'not json' });
  await assert.rejects(
    failedDurableService.executePersistent('durable-failure', withMeta({ action: 'plan', text: '确认验收边界和下一步。' }, 0), failedDurablePersistence),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'protocol',
  );
  assert.equal(failedDurableState.version, 0, 'failed persistent execution cannot mutate durable state');
  assert.equal(durableAbandons, 1, 'failed persistent execution releases its command lease');

  const renewingState = createPreviewServerState('durable-renew', '00000000-0000-4000-8000-000000000015');
  let renewCalls = 0;
  const renewingPersistence: PreviewSessionPersistence = {
    acquire: async () => ({ previewSessionId: renewingState.previewSessionId, version: 0, state: renewingState, leaseToken: '00000000-0000-4000-8000-000000000016' }),
    renew: async () => { renewCalls += 1; },
    commit: async ({ state, response }) => { Object.assign(renewingState, state); return response; },
    abandon: async () => undefined,
  };
  const renewingService = createPreviewAiService({
    leaseRenewIntervalMs: 1,
    invoker: async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return json({ needsDetail: false, matchedNpcIds: [], recommendations: [] });
    },
  });
  await renewingService.executePersistent('durable-renew', withMeta({ action: 'plan', text: '确认验收边界和下一步。' }, 0), renewingPersistence);
  assert.ok(renewCalls > 0, 'long-lived persistent commands renew their lease before commit');

  const renewalFailureState = createPreviewServerState('durable-renew-failure', '00000000-0000-4000-8000-000000000017');
  let renewalFailureCommitted = false;
  const renewalFailurePersistence: PreviewSessionPersistence = {
    acquire: async () => ({ previewSessionId: renewalFailureState.previewSessionId, version: 0, state: renewalFailureState, leaseToken: '00000000-0000-4000-8000-000000000018' }),
    renew: async () => { throw new PreviewAiError('conflict', 'PREVIEW_COMMAND_LEASE_LOST'); },
    commit: async () => { renewalFailureCommitted = true; throw new Error('commit must not run after lease renewal fails'); },
    abandon: async () => undefined,
  };
  const renewalFailureService = createPreviewAiService({
    leaseRenewIntervalMs: 1,
    invoker: async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return json({ needsDetail: false, matchedNpcIds: [], recommendations: [] });
    },
  });
  await assert.rejects(
    renewalFailureService.executePersistent('durable-renew-failure', withMeta({ action: 'plan', text: '确认验收边界和下一步。' }, 0), renewalFailurePersistence),
    (error: unknown) => error instanceof PreviewAiError && error.kind === 'conflict',
  );
  assert.equal(renewalFailureCommitted, false, 'a lost lease can never commit a finished model response');
  assert.equal(renewalFailureState.version, 0, 'a lost lease leaves durable state untouched');

  durableState.conversations['P1-001'].push({
    messageId: 'recovery-message', role: 'player', channel: 'wechat', text: '请确认验收记录。', at: Date.now(),
    attachment: { title: '验收记录', content: 'PRIVATE_ATTACHMENT_CONTENT', viewed: false, impact: '尚未查看' },
    delivery: { responseAction: 'read_no_reply', readStatus: 'read', reasonCode: 'current_priority_low', reasonEvidence: 'internal only' },
  });
  durableState.npcStates['P1-001'].support = 88;
  durableState.npcStates['P1-001'].activeBlockers.push('compliance_redline');
  durableState.npcStates['P1-001'].workingMemory.push({ id: 'internal-memory', type: 'fact', summary: '内部评估', sourceMessageIds: ['recovery-message'], status: 'active', tags: ['internal'], mustMention: true });
  const recovery = toPreviewRecoveryDto(durableState);
  const recoveryJson = JSON.stringify(recovery);
  assert.match(recoveryJson, /请确认验收记录/, 'recovery includes player-visible conversation data');
  assert.equal(recoveryJson.includes('PRIVATE_ATTACHMENT_CONTENT'), false, 'recovery never exposes attachment content');
  assert.equal(recoveryJson.includes('reasonCode'), false, 'recovery never exposes internal silence diagnostics');
  assert.equal(recoveryJson.includes('support'), false, 'recovery never exposes scoring state');
  assert.equal(recoveryJson.includes('activeBlockers'), false, 'recovery never exposes blockers');
  assert.equal(recoveryJson.includes('workingMemory'), false, 'recovery never exposes working memory');
  const designerRecovery = toPreviewRecoveryDto(durableState, { includeNpcTestStates: true });
  assert.deepEqual(designerRecovery.npcTestStates, [{
    npcId: 'P1-001', support: 88, pleasantness: 50, effectiveContactCount: 0, node: 'BLOCKED',
  },
  ...PREVIEW_NPC_IDS.slice(1).map((npcId) => ({ npcId, support: 0, pleasantness: 50, effectiveContactCount: 0, node: 'N1' as const }))], 'designer recovery restores the full committed metric snapshot without exposing internal evaluator fields');
  assert.equal(JSON.stringify(designerRecovery).includes('workingMemory'), false, 'designer recovery still excludes internal working memory');
  console.log('project-one preview AI tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
