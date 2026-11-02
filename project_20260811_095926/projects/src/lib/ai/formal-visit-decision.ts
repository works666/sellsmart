import { invokeJev, type JevInvoker, type JevRequest } from '@/lib/ai/jev-client';
import { invokeConfiguredJev } from '@/lib/ai/jev-designer-config';
import { serializeUntrustedPromptData } from '@/lib/ai/prompt-data';
import {
  PROJECT_ONE_FIVE_PERSON_NPCS,
  type ProjectOneFivePersonId,
  type ProjectOneVisitTask,
} from '@/lib/designer/project-one-five-person';

export interface FormalVisitDecisionInput {
  /** The NPC from the active, server-persisted meeting. */
  npcId: string;
  /** Completed task IDs from the active, server-persisted meeting. */
  completedTasks: readonly ProjectOneVisitTask[];
  /** The server-persisted count before this dialogue turn. */
  turn: number;
  /** Current chat request text, passed only as untrusted decision context. */
  playerMessage: string;
  /** The generated NPC reply for this same turn. */
  npcReply: string;
}

export interface FormalVisitTurnDecision {
  completedTask: ProjectOneVisitTask | null;
  /** The player explicitly ended this conversation in their natural-language turn. */
  playerFarewell: boolean;
  /** The NPC offered a normal final farewell and awaits one player reply. */
  npcFarewell: boolean;
  /** True only when the evaluator confirms that the NPC must leave now. */
  npcLeft: boolean;
}

export interface FormalMessageDecisionInput {
  npcId: string;
  channel: 'email' | 'online';
  playerMessage: string;
}

export interface FormalMessageDecision {
  responseAction: 'reply' | 'read_no_reply';
}

export interface FormalVisitDecisionDependencies {
  /** Injectable for deterministic tests; production uses the configured Jev provider. */
  jevInvoker?: JevInvoker;
}

const NO_VISIT_PROGRESS: FormalVisitTurnDecision = {
  completedTask: null,
  playerFarewell: false,
  npcFarewell: false,
  npcLeft: false,
};

function isFivePersonId(value: string): value is ProjectOneFivePersonId {
  return Object.prototype.hasOwnProperty.call(PROJECT_ONE_FIVE_PERSON_NPCS, value);
}

function readChoice(response: Awaited<ReturnType<JevInvoker>>, key: string): string | undefined {
  const answer = response.answers[key];
  return answer?.type === 'choice' ? answer.choice : undefined;
}

/**
 * Decide formal-visit progress from server-owned meeting state and the actual
 * turn transcript. The browser never submits task IDs or exit flags. The
 * selected task is validated again against the NPC master record and the
 * unfinished task set before state.ts can persist it.
 */
export async function evaluateFormalVisitTurn(
  input: FormalVisitDecisionInput,
  dependencies: FormalVisitDecisionDependencies = {},
): Promise<FormalVisitTurnDecision> {
  if (!isFivePersonId(input.npcId)) throw new Error('NPC_UNKNOWN');
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[input.npcId];
  const allowedTasks: readonly ProjectOneVisitTask[] = npc.allowedTasks;
  const completed = new Set(input.completedTasks.filter((task) => allowedTasks.includes(task)));
  const remaining = allowedTasks.filter((task) => !completed.has(task));
  const request: JevRequest = {
    state: serializeUntrustedPromptData('formal_visit_turn', {
      npc: {
        id: npc.id,
        name: npc.name,
        title: npc.title,
        personality: npc.personality,
        allowedTasks: [...allowedTasks],
      },
      meeting: { turn: Math.max(0, Math.floor(input.turn)), completedTasks: [...completed], remainingTasks: remaining },
      playerMessage: input.playerMessage,
      npcReply: input.npcReply,
    }, { maxStringLength: 2_000, maxTotalLength: 16_000 }),
    questions: {
      completedTask: {
        type: 'choice',
        criteria: Object.fromEntries([
          ['none', '本轮未完成拜访任务'],
          ...remaining.map((task) => [task, '本轮确实完成该剩余拜访任务']),
        ]),
        instructions: '仅根据本轮双方已说出的内容选择一个确实完成的剩余任务；没有完成选择 none。',
      },
      npcDialogueSignal: {
        type: 'choice',
        criteria: {
          continue: 'NPC 可以继续交流',
          farewell: 'NPC 礼貌告辞，允许玩家再作一次最后回复',
          forced_exit: 'NPC 在实际回复中明确表示因时间或事务必须立刻离场',
        },
        instructions: '只根据 NPC 实际回复判断。只有明确、即时的离场约束才选择 forced_exit。',
      },
      playerDialogueSignal: {
        type: 'choice',
        criteria: {
          continue: '玩家没有明确结束本次交流',
          farewell: '玩家在本轮明确告辞或结束交流',
        },
        instructions: '仅根据玩家本轮实际文本判断是否明确告辞；普通感谢、确认或下一步安排不等于告辞。',
      },
    },
  };

  try {
    const response = dependencies.jevInvoker
      ? await dependencies.jevInvoker(request)
      : await invokeConfiguredJev('preview_visit', request, invokeJev);
    const proposedTask = readChoice(response, 'completedTask');
    const completedTask = proposedTask && proposedTask !== 'none' && remaining.includes(proposedTask as ProjectOneVisitTask)
      ? proposedTask as ProjectOneVisitTask
      : null;
    return {
      completedTask,
      playerFarewell: readChoice(response, 'playerDialogueSignal') === 'farewell',
      npcFarewell: readChoice(response, 'npcDialogueSignal') === 'farewell',
      npcLeft: readChoice(response, 'npcDialogueSignal') === 'forced_exit',
    };
  } catch {
    // Keep an unavailable decision service from fabricating visit progress.
    // The chat turn can still commit, while state.ts retains its hard limit.
    return NO_VISIT_PROGRESS;
  }
}

function isNaturalClosure(playerMessage: string): boolean {
  return /^(?:收到|好的|好|谢谢|感谢|明白|了解)[，。！!、\s]*(?:谢谢|感谢)?[。！!]?$/iu.test(playerMessage.trim());
}

function requiresComplianceReply(playerMessage: string): boolean {
  return /现金|红包|回扣|返点|好处费|茶水费|购物卡|礼金|利益交换|绕过合规|规避审查/u.test(playerMessage);
}

/**
 * Use the same bounded decision contract as the designer's actual-test
 * workspace. Only asynchronous written channels may be read without a reply;
 * phone and in-person conversation remain reply-only in their own flows.
 */
export async function decideFormalMessageResponse(
  input: FormalMessageDecisionInput,
  dependencies: FormalVisitDecisionDependencies = {},
): Promise<FormalMessageDecision> {
  if (!isFivePersonId(input.npcId)) throw new Error('NPC_UNKNOWN');
  // Silence must never hide a deterministically required compliance response,
  // even if an untrusted decision service returns the wrong enum value.
  if (requiresComplianceReply(input.playerMessage)) return { responseAction: 'reply' };
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[input.npcId];
  const request: JevRequest = {
    state: serializeUntrustedPromptData('formal_message', {
      npc: { id: npc.id, name: npc.name, title: npc.title, personality: npc.personality },
      channel: input.channel,
      allowReadNoReply: true,
      playerText: input.playerMessage,
    }, { maxStringLength: 2_000, maxTotalLength: 8_000 }),
    questions: {
      responseAction: {
        type: 'choice',
        criteria: { reply: '回复正文', read_no_reply: '已读但不回复' },
        instructions: '邮件和工作微信可选择已读不回。合规红线必须回复；已读不回不能确认邀约、承诺、拒绝或披露新信息。',
      },
      invitationStatus: {
        type: 'choice',
        criteria: { none: '不涉及邀约', accepted: '接受邀约', rejected: '拒绝邀约', later: '稍后或改期' },
        instructions: '仅供与实际测试页相同的消息处理上下文使用；本路径只采纳 responseAction。',
      },
    },
  };
  try {
    const response = dependencies.jevInvoker
      ? await dependencies.jevInvoker(request)
      : await invokeConfiguredJev('preview_message', request, invokeJev);
    if (readChoice(response, 'responseAction') === 'read_no_reply') return { responseAction: 'read_no_reply' };
  } catch {
    // A normal closure is the only safe deterministic silent fallback. Other
    // unavailable decisions continue to a normal reply path.
    if (isNaturalClosure(input.playerMessage)) return { responseAction: 'read_no_reply' };
  }
  return { responseAction: 'reply' };
}
