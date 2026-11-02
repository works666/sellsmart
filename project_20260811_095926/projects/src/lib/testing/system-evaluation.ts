import { randomUUID } from 'node:crypto';
import { getAiProviderAvailability, loadAiProviderSelection } from '@/lib/ai/provider-selection';
import { invokeLLM, type ChatMessage, type InvokeOptions } from '@/lib/ai/client';
import { invokeJev, type JevInvoker } from '@/lib/ai/jev-client';
import { createLlmDecisionInvoker } from '@/lib/ai/llm-decision';
import {
  invokeSelectedDecisionProvider,
  loadJevDesignerConfig,
} from '@/lib/ai/jev-designer-config';
import { loadActivityDecisionConfigForMatching } from '@/lib/designer/customer-activity-config-repository';
import { loadProjectOnePromptConfig } from '@/lib/designer/prompt-config-repository';
import {
  PREVIEW_NPCS,
  PreviewAiError,
  PreviewSessionStore,
  createPreviewAiService,
  createPreviewServerState,
  hasCustomerActivitySettlementWork,
  previewTaskIdForRequest,
  resolvePreviewNode,
  type LlmInvoker,
  type PreviewJevInvoker,
  type PreviewServerState,
} from '@/lib/game/project-one-preview-ai';
import { previewSessionRepository } from '@/lib/game/project-one-preview-session-repository';
import { judgeSystemEvaluation } from '@/lib/testing/system-evaluation-judge';
import type {
  SystemEvalRound,
  SystemEvaluationGenerationRequest,
  SystemEvaluationJudge,
  SystemEvaluationNpcState,
  SystemEvaluationReport,
  SystemEvaluationRequest,
} from '@/lib/contracts/system-evaluation';

export class SystemEvaluationError extends Error {
  constructor(
    readonly kind: 'not_found' | 'conflict' | 'invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

type StoredPromptConfig = Awaited<ReturnType<typeof loadProjectOnePromptConfig>>;
type StoredActivityConfig = Awaited<ReturnType<typeof loadActivityDecisionConfigForMatching>>;
type StoredProviderConfig = Awaited<ReturnType<typeof loadAiProviderSelection>>;
type StoredDecisionConfig = Awaited<ReturnType<typeof loadJevDesignerConfig>>;

export type SystemEvaluationDeps = {
  invoker?: (messages: ChatMessage[], options?: InvokeOptions) => Promise<string>;
  jevInvoker?: PreviewJevInvoker;
  loadSnapshot?: (userId: string, previewSessionId: string) => Promise<PreviewServerState>;
  loadPromptConfig?: () => Promise<StoredPromptConfig>;
  loadActivityConfig?: () => Promise<StoredActivityConfig>;
  loadProviderConfig?: () => Promise<StoredProviderConfig>;
  /** Omitted only when a deterministic Jev invoker is injected for offline tests. */
  loadDecisionConfig?: () => Promise<StoredDecisionConfig>;
  judge?: typeof judgeSystemEvaluation;
  createRunId?: () => string;
  now?: () => number;
};

function jsonClone<T>(value: T): T {
  return structuredClone(value);
}

function messageHistory(state: PreviewServerState, npcId: SystemEvaluationRequest['npcId']): unknown {
  return jsonClone(state.conversations[npcId]);
}

function targetState(state: PreviewServerState, npcId: SystemEvaluationRequest['npcId']): SystemEvaluationNpcState {
  const npcState = state.npcStates[npcId];
  return {
    support: npcState.support,
    pleasantness: npcState.pleasantness,
    effectiveContactCount: npcState.effectiveContactCount,
    node: resolvePreviewNode(npcState),
    activeBlockers: jsonClone(npcState.activeBlockers),
    dimensionScores: jsonClone(npcState.dimensionScores),
    workingMemory: jsonClone(npcState.workingMemory),
    history: messageHistory(state, npcId),
    activeMeeting: jsonClone(state.activeMeeting),
  };
}

function activityWouldSettle(state: PreviewServerState): boolean {
  return hasCustomerActivitySettlementWork(state)
    || state.customerActivities.tasks.some((task) => task.status === 'pending'
      || task.status === 'planning'
      || (task.status === 'submitted' && !task.evaluation));
}

/** Copy a persisted preview into a transient owner/session so execute() cannot commit it. */
function createTransientSnapshot(store: PreviewSessionStore, source: PreviewServerState, now: number): PreviewServerState {
  const transientOwner = `system-evaluation:${randomUUID()}`;
  const target = store.create(transientOwner);
  const clone = jsonClone(source);
  clone.userId = transientOwner;
  clone.previewSessionId = target.previewSessionId;
  clone.version = 0;
  clone.lastActiveAt = now;
  clone.completedCommands = new Map();
  Object.assign(target, clone);
  return target;
}

function createFreshSnapshot(
  store: PreviewSessionStore,
  request: Extract<SystemEvaluationRequest['source'], { kind: 'fresh' }>,
  npcId: SystemEvaluationRequest['npcId'],
  now: number,
): PreviewServerState {
  const transientOwner = `system-evaluation:${randomUUID()}`;
  const target = store.create(transientOwner);
  const fresh = createPreviewServerState(transientOwner, target.previewSessionId, now);
  fresh.npcStates[npcId].support = request.support;
  fresh.npcStates[npcId].pleasantness = request.pleasantness;
  fresh.npcStates[npcId].effectiveContactCount = request.effectiveContactCount;
  Object.assign(target, fresh);
  return target;
}

function serializableError(error: unknown): { code: string; message: string } {
  if (error instanceof SystemEvaluationError) return { code: error.kind, message: error.message };
  if (error instanceof PreviewAiError) return { code: error.kind, message: error.message };
  if (error instanceof Error) return { code: 'unavailable', message: error.message };
  return { code: 'unavailable', message: 'SYSTEM_EVALUATION_UNAVAILABLE' };
}

function failedJudge(reason: string): SystemEvaluationJudge {
  return {
    engine: 'deepeval',
    metrics: [{ key: 'judge_unavailable', name: 'DeepEval 评分未完成', score: null, reason, passed: false, error: reason }],
    passed: false,
    total100: null,
  };
}

/**
 * Runs production preview actions against a process-local session only. The
 * saved preview source is loaded read-only and neither executePersistent nor a
 * persistence adapter is involved.
 */
export async function runSystemEvaluation(
  userId: string,
  request: SystemEvaluationRequest,
  deps: SystemEvaluationDeps = {},
): Promise<SystemEvaluationReport> {
  const now = deps.now?.() ?? Date.now();
  const runId = deps.createRunId?.() ?? randomUUID();
  const [promptStored, activityStored, providerStored, decisionStored] = await Promise.all([
    (deps.loadPromptConfig ?? loadProjectOnePromptConfig)(),
    (deps.loadActivityConfig ?? loadActivityDecisionConfigForMatching)(),
    (deps.loadProviderConfig ?? loadAiProviderSelection)(),
    deps.jevInvoker ? Promise.resolve(null) : (deps.loadDecisionConfig ?? loadJevDesignerConfig)(),
  ]);
  const provider = providerStored.config.provider;
  const configuredModel = getAiProviderAvailability()[provider].model;
  const store = new PreviewSessionStore({ capacity: 4, perUserCapacity: 4, now: () => now });
  let state: PreviewServerState;
  let sourceVersion: number | null = null;
  if (request.source.kind === 'snapshot') {
    const persisted = await (deps.loadSnapshot ?? ((owner, id) => previewSessionRepository.load(owner, id)))(userId, request.source.previewSessionId);
    sourceVersion = persisted.version;
    if (activityWouldSettle(persisted)) {
      throw new SystemEvaluationError('conflict', '该快照包含待处理或规划中的客户活动；请先在预览中完成活动后再评测。');
    }
    if (persisted.activeMeeting && !persisted.activeMeeting.ended && persisted.activeMeeting.npcId !== request.npcId) {
      throw new SystemEvaluationError('conflict', '该快照正在与另一位 NPC 会面，不能在评测中伪造重置会面。');
    }
    state = createTransientSnapshot(store, persisted, now);
  } else {
    state = createFreshSnapshot(store, request.source, request.npcId, now);
  }

  const initialState = targetState(state, request.npcId);
  const initialHistory = messageHistory(state, request.npcId);
  const generationTrace: SystemEvaluationGenerationRequest[] = [];
  const baseInvoker = deps.invoker ?? invokeLLM;
  const configuredInvoker = (messages: ChatMessage[], options?: InvokeOptions) => baseInvoker(messages, {
    ...options,
    provider,
    ...(configuredModel ? { model: configuredModel } : {}),
  });
  const tracedInvoker: LlmInvoker = async (messages, options) => {
    const trace: SystemEvaluationGenerationRequest = {
      messages: jsonClone(messages),
      options: jsonClone({ ...options, provider, ...(configuredModel ? { model: configuredModel } : {}) }),
      rawResponse: '',
    };
    generationTrace.push(trace);
    try {
      const output = await configuredInvoker(messages, options);
      trace.rawResponse = output;
      return output;
    } catch (error) {
      trace.error = serializableError(error).message;
      throw error;
    }
  };
  let decisionRequestCount = 0;
  // Snapshot exactly once. A designer save during an evaluation must not
  // switch later decisions to another provider or prompt revision.
  const frozenDecisionConfig = decisionStored ? structuredClone(decisionStored.config) : null;
  const decisionProvider: 'jev' | 'llm' | 'injected' = deps.jevInvoker
    ? 'injected'
    : decisionStored!.config.decisionProvider;
  const decisionInvoker: JevInvoker = deps.jevInvoker
    ? async (request) => {
      decisionRequestCount += 1;
      return deps.jevInvoker!(request);
    }
    : async (request) => {
      decisionRequestCount += 1;
      const taskId = previewTaskIdForRequest(request)
        ?? (typeof request.state === 'object' ? 'customer_activity_feasibility' : undefined);
      if (!taskId) throw new SystemEvaluationError('invalid', 'PREVIEW_DECISION_TASK_UNKNOWN');
      return invokeSelectedDecisionProvider(
        taskId,
        request,
        frozenDecisionConfig!,
        invokeJev,
        createLlmDecisionInvoker(tracedInvoker),
      );
    };
  const service = createPreviewAiService({ invoker: tracedInvoker, jevInvoker: decisionInvoker, store });
  const rounds: SystemEvalRound[] = [];
  let phase: SystemEvaluationReport['phase'] = 'completed';
  let runError: { code: string; message: string } | undefined;
  let termination: SystemEvaluationReport['termination'];

  const execute = async (command: Parameters<typeof service.execute>[1]) => service.execute(state.userId, command, promptStored.config, activityStored.config);
  try {
    if (request.channel === 'visit' && (!state.activeMeeting || state.activeMeeting.ended)) {
      await execute({
        action: 'start_visit', npcId: request.npcId, skipPreparation: true,
        previewSessionId: state.previewSessionId, commandId: randomUUID(), expectedVersion: state.version,
      });
    }

    for (const [index, salesMessage] of request.salesTurns.entries()) {
      const beforeState = targetState(state, request.npcId);
      const traceStart = generationTrace.length;
      try {
        const response = request.channel === 'visit'
          ? await execute({ action: 'visit_turn', npcId: request.npcId, text: salesMessage, previewSessionId: state.previewSessionId, commandId: randomUUID(), expectedVersion: state.version })
          : await execute({ action: 'message', npcId: request.npcId, channel: 'email', text: salesMessage, previewSessionId: state.previewSessionId, commandId: randomUUID(), expectedVersion: state.version });
        rounds.push({
          round: index + 1,
          salesMessage,
          npcResponse: response.content ?? null,
          ...(response.responseAction ? { responseAction: response.responseAction } : response.content ? { responseAction: 'reply' } : {}),
          beforeState,
          afterState: targetState(state, request.npcId),
          generationRequests: generationTrace.slice(traceStart),
        });
        const meeting = state.activeMeeting;
        if (request.channel === 'visit' && meeting?.ended && meeting.npcId === request.npcId) {
          termination = {
            reason: meeting.endReason ?? 'meeting_ended',
            completedTurns: rounds.length,
            plannedTurns: request.salesTurns.length,
            skippedTurns: request.salesTurns.length - rounds.length,
          };
          break;
        }
      } catch (error) {
        const issue = serializableError(error);
        rounds.push({
          round: index + 1,
          salesMessage,
          npcResponse: null,
          responseAction: undefined,
          beforeState,
          afterState: targetState(state, request.npcId),
          generationRequests: generationTrace.slice(traceStart),
          error: issue.message,
        });
        phase = rounds.length > 1 ? 'partial' : 'error';
        runError = issue;
        break;
      }
    }
  } catch (error) {
    phase = rounds.length > 0 ? 'partial' : 'error';
    runError = serializableError(error);
  }

  let judge: SystemEvaluationJudge | null = null;
  let judgeRequestCount = 0;
  if (phase === 'completed') {
    try {
      const judgeInvoker = async (messages: ChatMessage[], options?: InvokeOptions) => {
        judgeRequestCount += 1;
        return configuredInvoker(messages, options);
      };
      judge = await (deps.judge ?? judgeSystemEvaluation)({
        npcName: PREVIEW_NPCS[request.npcId].name,
        expectation: request.expectation,
        threshold: request.threshold,
        rounds,
        initialState,
        finalState: targetState(state, request.npcId),
        history: initialHistory,
      }, { invoker: judgeInvoker, modelName: configuredModel ?? undefined });
    } catch (error) {
      const issue = serializableError(error);
      judge = failedJudge(issue.message);
      phase = 'partial';
      runError = issue;
    }
  } else {
    judge = failedJudge('NPC 生成未完整完成，未运行评分。');
  }
  if (phase === 'completed' && judge?.metrics.some((metric) => metric.error || metric.score === null)) {
    phase = 'partial';
    runError = { code: 'judge_partial', message: 'DeepEval 未完成全部指标评分。' };
  }

  return {
    runId,
    createdAt: new Date(now).toISOString(),
    pipeline: 'project-one-preview',
    source: request.source,
    sourceVersion,
    npc: { id: request.npcId, name: PREVIEW_NPCS[request.npcId].name, role: PREVIEW_NPCS[request.npcId].title },
    channel: request.channel,
    expectation: request.expectation,
    threshold: request.threshold,
    phase,
    initialState,
    finalState: targetState(state, request.npcId),
    history: initialHistory,
    rounds,
    ...(termination ? { termination } : {}),
    judge,
    requestCounts: { previewLlm: generationTrace.length, judge: judgeRequestCount, decision: { provider: decisionProvider, requests: decisionRequestCount } },
    configRevisions: {
      prompt: { revision: promptStored.revision, persisted: promptStored.persisted },
      activity: { revision: activityStored.config.revision, persisted: activityStored.persisted },
      provider: { revision: providerStored.revision, provider, configuredModel, persisted: providerStored.persisted },
      decision: decisionStored
        ? { revision: decisionStored.revision, persisted: decisionStored.persisted, provider: decisionProvider }
        : { revision: null, persisted: null, provider: 'injected' },
    },
    boundaries: [
      '评测仅使用 project-one-preview 五人链路和内存会话副本，不写入原预览会话或正式玩家存档。',
      '拜访首版自动跳过预约与拜访准备；此行为仅用于评测，不代表正常玩家流程。',
      '快照含待处理或规划中的客户活动时会拒绝运行，避免结算历史活动并产生额外模型请求。',
      '报告中的模型字段仅表示当前配置的 provider/model；供应商响应未声明时不将其伪称为实际模型身份。',
      'previewLlm 计数包含 NPC 正文、状态/记忆辅助调用及 LLM 决策模式调用；decision 请求数记录 Jev 或 LLM 决策适配器的实际调用次数。',
    ],
    ...(runError ? { error: runError } : {}),
  };
}
