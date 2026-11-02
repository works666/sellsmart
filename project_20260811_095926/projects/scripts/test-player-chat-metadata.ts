import assert from 'node:assert/strict';
import { toPlayerVisibleChatMessages } from '../src/lib/game/repository';

const restored = toPlayerVisibleChatMessages([{
  id: 'attachment-recovery',
  role: 'assistant',
  content: '我已收到材料。',
  createdAt: '2026-09-28T01:00:00.000Z',
  metadata: {
    channel: 'email',
    deliveryStatus: 'replied',
    supportDelta: 8,
    evaluation: { score: 99, privateReason: 'HIDDEN' },
    attachments: [
      { fileName: '方案.pdf', description: '精度验证材料', viewed: true, impact: '已查看，等待补充验收口径。', supportDelta: 6 },
      { fileName: '案例.pdf', description: '同行业案例', viewed: false, impact: '尚未查看，已收悉。', evaluation: { affinityDelta: 9 } },
      { fileName: '', description: '无效附件', viewed: true, impact: '不应出现' },
      { fileName: '无状态.pdf', description: '无效附件', viewed: 'yes', impact: '不应出现' },
      { fileName: '超长.pdf'.repeat(40), description: 'd'.repeat(1_100), viewed: true, impact: 'i'.repeat(450) },
    ],
  },
}]);

assert.deepEqual(restored[0]?.metadata, {
  channel: 'email',
  deliveryStatus: 'replied',
  attachments: [
    { fileName: '方案.pdf', description: '精度验证材料', viewed: true, impact: '已查看，等待补充验收口径。' },
    { fileName: '案例.pdf', description: '同行业案例', viewed: false, impact: '尚未查看，已收悉。' },
    { fileName: '超长.pdf'.repeat(40).slice(0, 160), description: 'd'.repeat(1_000), viewed: true, impact: 'i'.repeat(400) },
  ],
});
const serialized = JSON.stringify(restored);
assert.equal(serialized.includes('supportDelta'), false);
assert.equal(serialized.includes('privateReason'), false);
assert.equal(serialized.includes('affinityDelta'), false);

console.log('player chat metadata tests passed');
