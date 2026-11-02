import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { DEFAULT_ACTIVITY_DECISION_CONFIG } from '@/lib/game/customer-activities';
import { DEFAULT_PROJECT_ONE_PROMPT_CONFIG } from '@/lib/designer/prompt-config';
import { DEFAULT_JEV_DESIGNER_CONFIG } from '@/lib/ai/jev-designer-config';
import { PreviewAiError, createPreviewServerState, type PreviewServerState } from '@/lib/game/project-one-preview-ai';
import { postSystemEvaluationResponse } from '@/app/api/designer/system-evaluation/handler';
import { SystemEvaluationError, runSystemEvaluation, type SystemEvaluationDeps } from '@/lib/testing/system-evaluation';

const promptStored = {
  config: DEFAULT_PROJECT_ONE_PROMPT_CONFIG,
  revision: 9,
  updatedAt: null,
  updatedBy: null,
  persisted: false,
};
const activityStored = {
  config: DEFAULT_ACTIVITY_DECISION_CONFIG,
  updatedAt: null,
  updatedBy: null,
  persisted: false,
};
const providerStored = {
  config: { provider: 'default' as const },
  revision: 3,
  updatedAt: null,
  updatedBy: null,
  persisted: false,
};

let observedJudgeInput: Parameters<NonNullable<SystemEvaluationDeps['judge']>>[0] | null = null;
const judge: SystemEvaluationDeps['judge'] = async (input) => {
  observedJudgeInput = input;
  return {
  engine: 'deepeval',
  metrics: [{ key: 'role_consistency', name: '角色一致性', score: 0.9, reason: 'test', passed: true }],
  passed: true,
  total100: 90,
  };
};

const deps: SystemEvaluationDeps = {
  loadPromptConfig: async () => promptStored,
  loadActivityConfig: async () => activityStored,
  loadProviderConfig: async () => providerStored,
  judge,
  now: () => 1_750_000_000_000,
  createRunId: () => 'system-evaluation-test-run',
  jevInvoker: async () => { throw new Error('offline Jev fallback'); },
  invoker: async (messages) => {
    const prompt = messages.map((message) => message.content).join('\n');
    if (prompt.includes('memorySuggestions')) return JSON.stringify({ memorySuggestions: [] });
    return JSON.stringify({ content: '感谢你的说明。请先把可验证的材料发给我，我会结合当前安排判断下一步。' });
  },
};

const deterministicPreviewJev: NonNullable<SystemEvaluationDeps['jevInvoker']> = async (request) => ({
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'choice') {
      const choice = Object.keys(question.criteria ?? {})[0] ?? '';
      return [id, { type: 'choice' as const, choice, probabilities: { [choice]: 1 }, confidence: 1 }];
    }
    if (question.type === 'score') {
      return [id, { type: 'score' as const, score: 0, legend: {}, probabilities: { 0: 1 }, confidence: 1 }];
    }
    return [id, { type: 'noul' as const, noul: 0 }];
  })),
});

async function expectReject(action: () => Promise<unknown>, expected: unknown) {
  await assert.rejects(action, (error: unknown) => error === expected || (error instanceof Error && error.message === (expected as Error).message));
}

async function main() {
  const fresh = await runSystemEvaluation('designer-a', {
    source: { kind: 'fresh', support: 18, pleasantness: 46, effectiveContactCount: 2 },
    npcId: 'P1-001',
    channel: 'email',
    salesTurns: ['王总您好，我们整理了可验证的同类案例和落地计划，想请您确认是否值得安排二十分钟交流。'],
    expectation: 'NPC 应保持审慎，但以真实关系和上下文回应。',
    threshold: 0.7,
  }, deps);
  assert.equal(fresh.phase, 'completed');
  assert.equal(fresh.initialState.support, 18);
  assert.equal(fresh.initialState.effectiveContactCount, 2);
  assert.equal(fresh.rounds.length, 1);
  assert.ok(fresh.rounds[0].generationRequests.length >= 2, 'must trace production prose and state evaluation calls');
  assert.ok(fresh.rounds[0].generationRequests.every((entry) => entry.rawResponse.length > 0));
  assert.ok(observedJudgeInput?.rounds[0]?.generationRequests[0]?.messages.some((message) => message.role === 'system'), 'judge must receive the real composed generation context');
  assert.equal(fresh.sourceVersion, null);
  assert.equal(fresh.requestCounts.decision.provider, 'injected');
  assert.ok(fresh.requestCounts.decision.requests > 0);

  const original = createPreviewServerState('designer-a', '11111111-1111-4111-8111-111111111111', 123);
  original.npcStates['P1-001'].support = 31;
  original.npcStates['P1-001'].workingMemory.push({
    id: 'memory-1', type: 'evidence', summary: '已经给过案例材料', sourceMessageIds: [], status: 'active', tags: ['案例'], mustMention: true,
  });
  const before = structuredClone(original) as PreviewServerState;
  const snapshot = await runSystemEvaluation('designer-a', {
    source: { kind: 'snapshot', previewSessionId: original.previewSessionId },
    npcId: 'P1-001', channel: 'visit', salesTurns: ['我补充了案例中的上线周期和验收方式，想听听您的顾虑。'],
    expectation: '基于已有材料继续回应。', threshold: 0.7,
  }, { ...deps, loadSnapshot: async (owner, id) => {
    assert.equal(owner, 'designer-a');
    assert.equal(id, original.previewSessionId);
    return original;
  } });
  assert.equal(snapshot.initialState.support, 31);
  assert.equal(snapshot.sourceVersion, 0);
  assert.deepEqual(original, before, 'snapshot source must remain immutable');
  assert.equal(snapshot.rounds[0].beforeState.activeMeeting !== null, true, 'visit starts only in transient snapshot');

  const endingSource = createPreviewServerState('designer-a', '44444444-4444-4444-8444-444444444444', 123);
  endingSource.npcStates['P1-001'].support = 20;
  endingSource.npcStates['P1-001'].pleasantness = 50;
  const endingSourceBefore = structuredClone(endingSource) as PreviewServerState;
  const endingVisitCalls: number[] = [];
  let endingJudgeCalls = 0;
  let endingJudgeRoundCount = 0;
  const endedVisit = await runSystemEvaluation('designer-a', {
    source: { kind: 'snapshot', previewSessionId: endingSource.previewSessionId },
    npcId: 'P1-001', channel: 'visit',
    salesTurns: ['想进一步了解您当前最关心的问题。', '我可以补充项目的可验证材料。', '我们再确认一下后续安排。'],
    expectation: '客户如因时间限制结束拜访，应按实际对话评测。', threshold: 0.7,
  }, {
    ...deps,
    jevInvoker: deterministicPreviewJev,
    loadSnapshot: async () => endingSource,
    invoker: async (messages) => {
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      const visitTurn = system.match(/这是实际拜访第\s*(\d+)\s*轮/);
      if (visitTurn) {
        endingVisitCalls.push(Number(visitTurn[1]));
        return JSON.stringify({ content: '我这会儿有点忙，后面还有会，今天先这样吧。' });
      }
      if (system.includes('memorySuggestions')) return JSON.stringify({ memorySuggestions: [] });
      return JSON.stringify({ content: '请先说明具体问题和对应的依据。' });
    },
    judge: async (input) => {
      endingJudgeCalls += 1;
      endingJudgeRoundCount = input.rounds.length;
      return {
        engine: 'deepeval',
        metrics: [{ key: 'role_consistency', name: '角色一致性', score: 0.9, reason: 'test', passed: true }],
        passed: true,
        total100: 90,
      };
    },
  });
  assert.deepEqual(endingVisitCalls, [1], 'production preview service ends the meeting after the actual NPC time-constraint reply');
  assert.equal(endedVisit.phase, 'completed', 'normal meeting end still proceeds to DeepEval');
  assert.equal(endedVisit.rounds.length, 1, 'do not submit another visit turn after the meeting ended');
  assert.equal(endedVisit.rounds[0].error, undefined, 'normal meeting end must not create a synthetic empty error round');
  assert.equal(endingJudgeCalls, 1, 'judge still scores the actual completed dialogue');
  assert.equal(endingJudgeRoundCount, 1);
  assert.deepEqual(endedVisit.termination, {
    reason: 'npc_time_constraint', completedTurns: 1, plannedTurns: 3, skippedTurns: 2,
  });
  assert.deepEqual(endingSource, endingSourceBefore, 'early termination must leave the snapshot source unchanged');

  const completeVisitCalls: number[] = [];
  const completeVisit = await runSystemEvaluation('designer-a', {
    source: { kind: 'fresh', support: 30, pleasantness: 55, effectiveContactCount: 1 },
    npcId: 'P1-001', channel: 'visit',
    salesTurns: ['请说明您最关心的问题。', '我可以补充对应的材料。', '下一步我们可以按正式流程确认。'],
    expectation: '在会面仍进行时完成全部计划轮次。', threshold: 0.7,
  }, {
    ...deps,
    jevInvoker: deterministicPreviewJev,
    invoker: async (messages) => {
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      const visitTurn = system.match(/这是实际拜访第\s*(\d+)\s*轮/);
      if (visitTurn) {
        completeVisitCalls.push(Number(visitTurn[1]));
        return JSON.stringify({ content: '请具体说说项目的验收依据和目前遇到的问题。' });
      }
      if (system.includes('memorySuggestions')) return JSON.stringify({ memorySuggestions: [] });
      return JSON.stringify({ content: '请先说明具体问题和对应的依据。' });
    },
  });
  assert.deepEqual(completeVisitCalls, [1, 2, 3]);
  assert.equal(completeVisit.phase, 'completed');
  assert.equal(completeVisit.rounds.length, 3);
  assert.equal(completeVisit.termination, undefined, 'an active meeting after all planned turns is not an early termination');

  const unrelatedMeeting = createPreviewServerState('designer-a', '33333333-3333-4333-8333-333333333333');
  unrelatedMeeting.activeMeeting = { npcId: 'P1-002', ended: false } as never;
  await expectReject(() => runSystemEvaluation('designer-a', {
    source: { kind: 'snapshot', previewSessionId: unrelatedMeeting.previewSessionId }, npcId: 'P1-001', channel: 'email',
    salesTurns: ['请确认材料是否有进一步问题。'], expectation: '不应执行。', threshold: 0.7,
  }, { ...deps, loadSnapshot: async () => unrelatedMeeting }), new SystemEvaluationError('conflict', '该快照正在与另一位 NPC 会面，不能在评测中伪造重置会面。'));

  const blocked = createPreviewServerState('designer-a', '22222222-2222-4222-8222-222222222222');
  blocked.customerActivities.tasks.push({ status: 'pending' } as never);
  await expectReject(() => runSystemEvaluation('designer-a', {
    source: { kind: 'snapshot', previewSessionId: blocked.previewSessionId }, npcId: 'P1-001', channel: 'email',
    salesTurns: ['请确认材料是否有进一步问题。'], expectation: '不应执行。', threshold: 0.7,
  }, { ...deps, loadSnapshot: async () => blocked }), new SystemEvaluationError('conflict', '该快照包含待处理或规划中的客户活动；请先在预览中完成活动后再评测。'));

  const unauthorized = await postSystemEvaluationResponse(new NextRequest('http://localhost/api/designer/system-evaluation', {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
  }));
  assert.equal(unauthorized.status, 401, 'auth must happen before parsing or storage access');

  const designerSession = { userId: 'designer-a', role: 'platform_designer' as const, displayName: '测试', permissions: [], expiresAt: Date.now() };
  const invalid = await postSystemEvaluationResponse(new NextRequest('http://localhost/api/designer/system-evaluation', {
    method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
  }), { ...deps, auth: () => ({ ok: true, session: designerSession }) });
  assert.equal(invalid.status, 400, 'invalid JSON must be rejected before evaluation');
  const forbidden = await postSystemEvaluationResponse(new NextRequest('http://localhost/api/designer/system-evaluation', {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
  }), { ...deps, auth: () => ({ ok: true, session: { ...designerSession, role: 'player' } }) });
  assert.equal(forbidden.status, 403, 'only designers can run system evaluations');

  const foreignRequest = new NextRequest('http://localhost/api/designer/system-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      source: { kind: 'snapshot', previewSessionId: original.previewSessionId }, npcId: 'P1-001', channel: 'email',
      salesTurns: ['请确认下一步。'], expectation: '应安全失败。', threshold: 0.7,
    }), headers: { 'content-type': 'application/json' },
  });
  const foreign = await postSystemEvaluationResponse(foreignRequest, {
    ...deps,
    auth: () => ({ ok: true, session: designerSession }),
    loadSnapshot: async () => { throw new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND'); },
  });
  assert.equal(foreign.status, 404, 'foreign snapshots must not be distinguishable from missing snapshots');

  let invocationCount = 0;
  const partial = await runSystemEvaluation('designer-a', {
    source: { kind: 'fresh', support: 0, pleasantness: 50, effectiveContactCount: 0 }, npcId: 'P1-001', channel: 'email',
    salesTurns: ['第一轮请确认项目范围。', '第二轮请确认决策流程。'], expectation: '失败时保留首轮。', threshold: 0.7,
  }, { ...deps, invoker: async (messages) => {
    invocationCount += 1;
    if (invocationCount > 2) throw new Error('SIMULATED_MODEL_FAILURE');
    return messages.some((message) => message.content.includes('memorySuggestions'))
      ? JSON.stringify({ memorySuggestions: [] })
      : JSON.stringify({ content: '请先把材料发我。' });
  } });
  assert.equal(partial.phase, 'partial');
  assert.equal(partial.rounds.length, 2);
  assert.equal(partial.judge?.passed, false);
  assert.equal(partial.termination, undefined, 'model failures must not be treated as normal meeting termination');

  let failedTurnJudgeCalls = 0;
  const failedFirstVisitTurn = await runSystemEvaluation('designer-a', {
    source: { kind: 'fresh', support: 20, pleasantness: 50, effectiveContactCount: 0 },
    npcId: 'P1-001', channel: 'visit', salesTurns: ['请允许我简要说明来意。'],
    expectation: '生成失败不能报告正常结束。', threshold: 0.7,
  }, {
    ...deps,
    invoker: async () => { throw new Error('SIMULATED_FIRST_TURN_FAILURE'); },
    judge: async () => {
      failedTurnJudgeCalls += 1;
      return {
        engine: 'deepeval',
        metrics: [{ key: 'role_consistency', name: '角色一致性', score: 0.9, reason: 'test', passed: true }],
        passed: true,
        total100: 90,
      };
    },
  });
  assert.equal(failedFirstVisitTurn.phase, 'error');
  assert.equal(failedFirstVisitTurn.rounds.length, 1);
  assert.equal(failedFirstVisitTurn.rounds[0].npcResponse, null);
  assert.equal(failedFirstVisitTurn.termination, undefined, 'a zero-reply error is never a normal termination');
  assert.equal(failedTurnJudgeCalls, 0, 'a zero-reply error skips DeepEval');

  const mutableDecisionConfig = structuredClone(DEFAULT_JEV_DESIGNER_CONFIG);
  mutableDecisionConfig.decisionProvider = 'llm';
  let decisionConfigLoads = 0;
  let llmDecisionCalls = 0;
  const frozenDecisionRun = await runSystemEvaluation('designer-a', {
    source: { kind: 'fresh', support: 0, pleasantness: 50, effectiveContactCount: 0 }, npcId: 'P1-001', channel: 'email',
    salesTurns: ['请基于当前材料说明您最关心的验收风险。'], expectation: '决策配置在本次运行中固定。', threshold: 0.7,
  }, {
    ...deps,
    jevInvoker: undefined,
    loadDecisionConfig: async () => {
      decisionConfigLoads += 1;
      return { config: mutableDecisionConfig, revision: 7, updatedAt: null, updatedBy: null, persisted: true };
    },
    invoker: async (messages) => {
      const system = messages.find((message) => message.role === 'system')?.content ?? '';
      if (system.includes('constrained decision engine')) {
        llmDecisionCalls += 1;
        // Simulate a concurrent designer save after the first decision. The
        // active run must retain the cloned LLM configuration.
        if (llmDecisionCalls === 1) mutableDecisionConfig.decisionProvider = 'jev';
        const raw = messages.find((message) => message.role === 'user')?.content ?? '';
        const payload = JSON.parse(raw.slice(raw.indexOf('{'))) as { questions: Record<string, { type: string; criteria?: Record<string, unknown> }> };
        return JSON.stringify({ answers: Object.fromEntries(Object.entries(payload.questions).map(([id, question]) => {
          if (question.type === 'choice') return [id, { type: 'choice', choice: Object.keys(question.criteria ?? {})[0] }];
          if (question.type === 'score') return [id, { type: 'score', score: 0 }];
          return [id, { type: 'noul', noul: false }];
        })) });
      }
      return system.includes('memorySuggestions')
        ? JSON.stringify({ memorySuggestions: [] })
        : JSON.stringify({ content: '请先把关键验收证据发我。' });
    },
  });
  assert.equal(decisionConfigLoads, 1, 'decision config is loaded once per production run');
  assert.ok(llmDecisionCalls >= 2, 'later decisions retain the frozen LLM provider after config mutation');
  assert.equal(frozenDecisionRun.configRevisions.decision.revision, 7);
  assert.equal(frozenDecisionRun.requestCounts.decision.provider, 'llm');
  assert.ok(frozenDecisionRun.rounds[0].generationRequests.some((entry) => entry.messages[0]?.content.includes('constrained decision engine')));

  console.log('system evaluation contracts: passed');
}

void main();
