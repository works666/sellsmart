import assert from 'node:assert/strict';
import { attachmentsForNpcContext, appendViewedAttachmentsToPlayerMessage, decideChatAttachments, npcHistoryWithViewedAttachments } from '../src/lib/ai/chat-attachments';
import { npcChatRequestSchema } from '../src/lib/contracts/ai';
import type { JevRequest, JevResponse } from '../src/lib/ai/jev-client';

const attachment = { fileName: '技术方案.pdf', description: '正文含精度指标与现场验证计划。' };
const baseRequest = {
  gameSessionId: 'session-1',
  scenarioId: 'project-1',
  npcId: 'P1-004',
  message: '请查收附件。',
  commandId: 'attachment-command-0001',
  expectedVersion: 1,
};

assert.deepEqual(
  npcChatRequestSchema.parse({ ...baseRequest, channel: 'wechat', attachments: [attachment] }).attachments,
  [attachment],
  'WeChat accepts the canonical attachments field',
);
assert.deepEqual(
  npcChatRequestSchema.parse({ ...baseRequest, channel: 'email', emailAttachments: [attachment] }).emailAttachments,
  [attachment],
  'legacy emailAttachments remain compatible',
);
assert.equal(
  npcChatRequestSchema.safeParse({ ...baseRequest, channel: 'wechat', emailAttachments: [attachment] }).success,
  false,
  'legacy emailAttachments cannot be used on WeChat',
);
assert.equal(
  npcChatRequestSchema.safeParse({ ...baseRequest, channel: 'work_phone', attachments: [attachment] }).success,
  false,
  'attachments are rejected on phone calls',
);
assert.equal(
  npcChatRequestSchema.safeParse({ ...baseRequest, channel: 'email', attachments: [attachment], emailAttachments: [attachment] }).success,
  false,
  'clients cannot send duplicate attachment fields',
);

async function main() {
const calls: JevRequest[] = [];
const response = (viewed: boolean): JevResponse => ({
  answers: { viewed: { type: 'noul', noul: viewed ? 1 : 0, confidence: 1 } },
});
const treatments = await decideChatAttachments({
  npcId: 'P1-004',
  channel: 'online',
  playerText: '请查收附件。',
  attachments: [attachment, { fileName: '报价附件.xlsx', description: '报价正文不能进入查看决策输入。' }],
}, {
  decisionInvoker: async (request) => {
    calls.push(request);
    return response(calls.length === 1);
  },
});
assert.deepEqual(treatments.map((item) => item.viewed), [true, false]);
assert.equal(calls.length, 2, 'Jev decides each attachment separately');
assert.equal(JSON.stringify(calls).includes('正文不能进入查看决策输入'), false, 'view decisions never receive attachment bodies');
assert.match(treatments[0].impact, /已查看/);
assert.match(treatments[1].impact, /未查看/);

assert.deepEqual(attachmentsForNpcContext(treatments), [
  attachment,
  { fileName: '报价附件.xlsx', description: '客户已收到但本轮未查看；附件正文对客户不可见。' },
]);

const history = npcHistoryWithViewedAttachments([
  { role: 'user', content: '请查收', metadata: { attachments: treatments } },
  { role: 'user', content: '旧邮件', metadata: { emailAttachments: [attachment] } },
]);
assert.match(history[0].content, /正文含精度指标/);
assert.match(history[0].content, /未查看正文/);
assert.equal(history[0].content.includes('报价正文不能进入查看决策输入'), false, 'unviewed body is absent from later NPC history');
assert.match(history[1].content, /正文含精度指标/, 'legacy email attachment semantics remain visible to NPC history');
assert.equal(appendViewedAttachmentsToPlayerMessage('本轮消息', treatments).includes('正文含精度指标'), true);
assert.equal(appendViewedAttachmentsToPlayerMessage('本轮消息', [treatments[1]]), '本轮消息');

const fallbackTreatments = await decideChatAttachments({
  npcId: 'P1-004',
  channel: 'email',
  playerText: '请查看这份技术方案附件。',
  attachments: [attachment],
}, { decisionInvoker: async () => { throw new Error('provider unavailable'); } });
assert.equal(fallbackTreatments[0].viewed, true, 'fallback only views when the player asks to inspect substantive material');

console.log('formal chat attachment tests passed');
}

void main();
