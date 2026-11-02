import assert from 'node:assert/strict';
import { CUSTOMER_CONTEXT } from '../src/lib/ai/prompts/customer';
import { emailAttachmentSchema, npcChatRequestSchema } from '../src/lib/contracts/ai';
import { gameCommandSchema } from '../src/lib/contracts/game';
import { connectNpc, createProjectOneState, executeGameCommand } from '../src/lib/game/state';

const attachment = { fileName: '实施方案.pdf', description: '包含分阶段实施计划、交付责任人和验收口径。' };

const parsedAttachment = emailAttachmentSchema.parse(attachment);
assert.deepEqual(parsedAttachment, attachment, 'an attachment requires a file name and natural-language description');
assert.equal(emailAttachmentSchema.safeParse({ fileName: '实施方案.pdf' }).success, false);
assert.equal(emailAttachmentSchema.safeParse({ description: '只有内容描述，没有文件名。' }).success, false);

const chatRequest = npcChatRequestSchema.parse({
  gameSessionId: 'session-1',
  scenarioId: 'project-1',
  npcId: 'P1-004',
  message: '请查收附件，里面是本次项目的实施方案。',
  commandId: 'email-attachment-command-1',
  expectedVersion: 1,
  channel: 'email',
  emailAttachments: [attachment],
});
assert.deepEqual(chatRequest.emailAttachments, [attachment]);
assert.equal('attachmentIds' in chatRequest, false, 'chat requests no longer accept preparation inventory IDs');

const promptContext = CUSTOMER_CONTEXT({
  gameSessionId: 'session-1',
  scenarioId: 'project-1',
  npc: {
    name: '赵晓晨',
    title: '业务负责人',
    category: 'frontline',
    personality: '务实',
    weakness: '关注落地',
  },
  round: 1,
  maxRounds: 5,
  affinity: 35,
  emailAttachments: [attachment],
  canRevealPersonalInterest: false,
  canRevealKeyContact: false,
  lastAction: null,
});
assert.match(promptContext, /实施方案\.pdf/);
assert.match(promptContext, /分阶段实施计划/);

const baseState = connectNpc(createProjectOneState(), 'P1-004');
const invite = gameCommandSchema.parse({
  commandId: 'email-invite-attachment-1',
  expectedVersion: baseState.version,
  type: 'invite',
  payload: {
    npcId: 'P1-004',
    channel: 'email',
    rawText: '希望围绕实施计划安排一次正式沟通。',
    emailAttachments: [attachment],
  },
});
const invited = executeGameCommand(baseState, invite);
const appointment = invited.result.appointment as { emailAttachments?: unknown; attachmentIds?: unknown };
assert.deepEqual(appointment.emailAttachments, [attachment], 'email invitation keeps described attachments on the appointment');
assert.deepEqual(appointment.attachmentIds, [], 'new email attachments do not become preparation IDs');
assert.equal(invited.state.preparations.length, 0, 'described email files do not create or consume preparation inventory');

const nonEmail = gameCommandSchema.parse({
  commandId: 'phone-invite-attachment-1',
  expectedVersion: baseState.version,
  type: 'invite',
  payload: {
    npcId: 'P1-004',
    channel: 'work_phone',
    rawText: '希望安排一次沟通。',
    emailAttachments: [attachment],
  },
});
assert.throws(
  () => executeGameCommand(baseState, nonEmail),
  /EMAIL_ATTACHMENT_NOT_AVAILABLE/,
  'described attachments are only accepted on email invitations',
);

console.log('email attachment contract tests passed');
