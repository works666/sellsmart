import assert from 'node:assert/strict';
import { evaluateFormalVisitPreparation, evaluateFormalWorkPlan } from '../src/lib/ai/formal-workflow';
import type { JevInvoker } from '../src/lib/ai/jev-client';
import type { invokeLLM } from '../src/lib/ai/client';

const narrative: typeof invokeLLM = async () => JSON.stringify({ strengths: ['目标清楚。'], risks: ['需核验验收依据。'], nextStep: '确认材料来源和下一步安排。' });
const decision = (needsDetail: boolean): JevInvoker => async () => ({ answers: { needsDetail: { type: 'noul', noul: needsDetail ? 1 : 0 } } });
const detailed = { npcId: 'P1-002', content: '本次目标是向李明辉确认交付问题，带验收证据逐项核验风险，下一步确认各岗位负责人。' };

async function main() {
  const approved = await evaluateFormalVisitPreparation(detailed, { llmInvoker: narrative, jevInvoker: decision(false) });
  assert.equal(approved.needsDetail, false);
  assert.deepEqual(approved.strengths, ['目标清楚。']);
  const rejected = await evaluateFormalVisitPreparation(detailed, { llmInvoker: narrative, jevInvoker: decision(true) });
  assert.equal(rejected.needsDetail, true, 'a fluent narrative cannot override the independent preparation gate');

  const unavailable: JevInvoker = async () => { throw new Error('JEV_UNAVAILABLE'); };
  const sparse = await evaluateFormalVisitPreparation({ npcId: 'P1-002', content: '到办公室找人聊聊，介绍一下我们的公司。' }, { llmInvoker: narrative, jevInvoker: unavailable });
  assert.equal(sparse.needsDetail, true, 'unavailable decisions do not make generic preparation ready');
  const fallback = await evaluateFormalVisitPreparation(detailed, { llmInvoker: narrative, jevInvoker: unavailable });
  assert.equal(fallback.needsDetail, false, 'bounded fallback preserves the actual-test detailed preparation path');
  await assert.rejects(evaluateFormalVisitPreparation({ npcId: 'unknown', content: detailed.content }, { llmInvoker: narrative, jevInvoker: decision(false) }), /NPC_UNKNOWN/);
  await assert.rejects(evaluateFormalVisitPreparation(detailed, { llmInvoker: async () => '{"strengths":"invalid"}', jevInvoker: decision(false) }), /invalid|array|expected/i);

  const plan = await evaluateFormalWorkPlan({ scope: 'global', content: '向李明辉确认项目预算、验收证据和下一步时间安排。' }, { llmInvoker: async () => '{"recommendations":["核实验收依据。"]}', jevInvoker: decision(true) });
  assert.equal(plan.needsDetail, true);
  assert.deepEqual(plan.disclosures, [], 'an inadequate plan does not disclose matched master facts');
  const boundedPlan = await evaluateFormalWorkPlan({ scope: 'global', content: detailed.content }, { llmInvoker: async () => JSON.stringify({ recommendations: Array.from({ length: 6 }, (_, i) => `建议${i + 1}。`) }), jevInvoker: decision(false) });
  assert.equal(boundedPlan.recommendations.length, 5, 'a valid model list is bounded before saving instead of rejecting useful feedback');
  console.log('formal preparation and independent plan gates passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
