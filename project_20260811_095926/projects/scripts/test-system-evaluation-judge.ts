import assert from 'node:assert/strict';
import {
  judgeSystemEvaluation,
  type SystemEvaluationJudgeInput,
} from '../src/lib/testing/system-evaluation-judge';

process.env.DEEPEVAL_TELEMETRY_OPT_OUT = 'true';

const fixture: SystemEvaluationJudgeInput = {
  npcName: '张建国',
  expectation: '低支持度采购负责人可婉拒会议，不得无依据承诺。',
  threshold: 0.7,
  initialState: {
    npcId: 'P1-001',
    support: 24,
    pleasantness: 51,
    effectiveContactCount: 2,
    workingMemory: [{ type: 'fact', content: '销售人员两天前发过产品资料' }],
  },
  finalState: { support: 25, pleasantness: 52, effectiveContactCount: 2 },
  history: [{ role: 'user', content: '之前发过产品资料。' }, { role: 'assistant', content: '我先看看。' }],
  rounds: [{
    round: 1,
    salesMessage: '您好，明天下午能约时间介绍方案吗？',
    npcResponse: '明天下午安排不开，您先把资料发我看看。',
    responseAction: 'reply',
    beforeState: { support: 24, pleasantness: 51, effectiveContactCount: 2 },
    afterState: { support: 25, pleasantness: 52, effectiveContactCount: 2 },
    generationRequests: [{
      messages: [
        { role: 'system', content: '真实系统提示词专属标记：企业采购负责人低支持度。' },
        { role: 'user', content: '历史消息和本轮销售话术。' },
      ],
      options: { provider: 'default', temperature: 0.7 },
      rawResponse: '明天下午安排不开，您先把资料发我看看。',
    }],
  }],
};

async function main() {
  const prompts: string[] = [];
  const judge = async (scores: number[]) => judgeSystemEvaluation(fixture, {
    modelName: 'fake-current-model',
    invoker: async (messages, options) => {
      assert.equal(options?.jsonMode, true, 'DeepEval asks the shared app client for structured judge output');
      assert.equal(options?.temperature, 0, 'judge generation is deterministic where supported');
      const prompt = messages.map((message) => message.content).join('\n');
      prompts.push(prompt);
      const nextScore = scores[prompts.length - 1];
      return JSON.stringify({ score: nextScore, reason: `按实际状态打分 ${nextScore}，标记 NPC 提示词专属标记。` });
    },
  });

  const passing = await judge([8, 8, 8, 8]);
  assert.equal(passing.engine, 'deepeval');
  assert.equal(passing.metrics.length, 4);
  assert.equal(passing.total100, 80);
  assert.equal(passing.passed, true);
  assert.equal(prompts.length, 4, 'the four real DeepEval metrics each use the injected application AI client');
  for (const prompt of prompts) {
    assert.match(prompt, /真实系统提示词专属标记/u, 'judge context contains the actual generation system prompt');
    assert.match(prompt, /effectiveContactCount/u, 'judge context contains the real relationship contact count');
    assert.match(prompt, /beforeState/u, 'judge context contains per-round state before generation');
    assert.match(prompt, /销售人员两天前发过产品资料/u, 'judge context contains the exact saved conversation memory');
    assert.match(prompt, /不得从支持度推断熟悉度/u, 'judge is warned not to infer familiarity from support');
    assert.match(prompt, /采购负责人低支持度/u, 'the supplied NPC role and support context reaches the judge');
    assert.match(prompt, /JSON Schema/u, 'the judge adapter supplies the exact structured output schema');
    assert.match(prompt, /"score"/u, 'the output schema identifies the score field');
  }

  prompts.length = 0;
  const oneFail = await judge([9.8, 9.8, 2, 9.8]);
  assert.equal(oneFail.total100, 78.5, 'the average can be above threshold even when one metric fails');
  assert.equal(oneFail.passed, false, 'a passing average cannot hide a failed individual metric');
  assert.equal(oneFail.metrics[2].passed, false);

  prompts.length = 0;
  const malformed = await judge([8, 8, Number.NaN, 8]);
  assert.equal(malformed.passed, false, 'invalid score data never passes');
  assert.equal(malformed.total100, null, 'a failed metric has no aggregate score');
  assert.equal(malformed.metrics[2].score, null);
  assert.ok(malformed.metrics[2].error);

  const noNpcReply = await judgeSystemEvaluation({
    ...fixture,
    rounds: [{ ...fixture.rounds[0], npcResponse: null }],
  }, { invoker: async () => { throw new Error('must not score an unclassified null reply'); } });
  assert.equal(noNpcReply.passed, false);
  assert.equal(noNpcReply.total100, null);

  const emptyRound = await judgeSystemEvaluation({ ...fixture, rounds: [] }, {
    invoker: async () => { throw new Error('must not score an empty conversation'); },
  });
  assert.equal(emptyRound.passed, false);
  assert.equal(emptyRound.total100, null);

  const blankNpcReply = await judgeSystemEvaluation({
    ...fixture,
    rounds: [{ ...fixture.rounds[0], npcResponse: '  ' }],
  }, { invoker: async () => { throw new Error('must not score an empty NPC reply'); } });
  assert.equal(blankNpcReply.passed, false);
  assert.equal(blankNpcReply.total100, null);

  const oversized = await judgeSystemEvaluation({
    ...fixture,
    initialState: { fullContext: 'x'.repeat(200_001) },
  }, { invoker: async () => { throw new Error('must not judge incomplete oversized context'); } });
  assert.equal(oversized.passed, false);
  assert.equal(oversized.total100, null);
  assert.match(oversized.metrics[0].error || '', /超过200000字符上限/u);
  console.log('System evaluation DeepEval judge tests passed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
