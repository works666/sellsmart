import assert from 'node:assert/strict';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function main() {
  const { createPreviewAiService } = await import('../src/lib/game/project-one-preview-ai');
  const service = createPreviewAiService();
  const cases = [
    {
      id: 'general', npcId: 'P1-002' as const,
      text: '李经理您好，我想先了解一下项目目前的总体进度，看看我们的方案有没有可以配合的地方。',
    },
    {
      id: 'strong', npcId: 'P1-002' as const,
      text: '李经理您好，针对您关注的里程碑和验收，我们建议分三步：两周完成现状基线，第六周完成核心流程试点，第十周按双方确认的准确率、处理时间和异常闭环率验收。每周提供书面风险清单，未达标不进入下一阶段。想请您确认，这三项指标是否足以支撑项目组验收和向上汇报？',
    },
    {
      id: 'worst', npcId: 'P1-003' as const,
      text: '王主任，流程不用那么复杂。我们可以私下给您现金回扣，您帮忙规避采购程序并保证中标，价格和材料后面再补。',
    },
  ];
  const results = [];
  for (const testCase of cases) {
    const userId = `real-ai-smoke-${testCase.id}`;
    const response = await service.execute(userId, {
      action: 'message', commandId: `real-ai-smoke-command-${testCase.id}`, expectedVersion: 0,
      npcId: testCase.npcId, channel: 'email', text: testCase.text,
    });
    assert.equal(response.action, 'message');
    assert.ok(response.content && response.content.length > 0);
    const state = service.store.get(userId, response.previewSessionId);
    assert.ok(state);
    const npcState = state.npcStates[testCase.npcId];
    assert.equal(state.conversations[testCase.npcId].length, 2);
    assert.ok(npcState.pleasantness >= 0 && npcState.pleasantness <= 100);
    assert.ok(npcState.support >= 0 && npcState.support <= 100);
    if (testCase.id === 'worst') {
      assert.ok(npcState.activeBlockers.includes('compliance_redline'));
      assert.equal(npcState.support, 0);
      assert.ok(npcState.pleasantness <= 42);
      assert.equal(npcState.effectiveContactCount, 0);
    }
    results.push({ case: testCase.id, replyLength: response.content.length, support: npcState.support,
      pleasantness: npcState.pleasantness, effectiveContactCount: npcState.effectiveContactCount,
      workingMemoryCount: npcState.workingMemory.length, blockers: npcState.activeBlockers });
  }
  console.log(JSON.stringify({ ok: true, results }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
