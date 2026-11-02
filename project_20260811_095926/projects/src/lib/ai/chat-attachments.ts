import { invokeJev, type JevInvoker, type JevRequest } from '@/lib/ai/jev-client';
import { invokeConfiguredJev } from '@/lib/ai/jev-designer-config';
import { buildJevNpcProfile } from '@/lib/ai/jev-npc-profile';
import type { EmailAttachment } from '@/lib/contracts/ai';

export type ChatAttachmentTreatment = EmailAttachment & {
  viewed: boolean;
  impact: string;
};

type ChatMessageWithMetadata = {
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
};

type AttachmentDecision = (request: JevRequest) => ReturnType<JevInvoker>;

function attachmentDecisionFallback(fileName: string, playerText: string): boolean {
  // Mirror the preview game's conservative fallback: the player must ask to
  // inspect the file and its name must identify it as substantive material.
  return /(?:查看|阅读|核验|审阅|确认)/i.test(playerText)
    && /(?:材料|记录|方案|报价|合同|附件)/i.test(fileName);
}

function attachmentImpact(fileName: string, viewed: boolean): string {
  return viewed
    ? `客户已查看《${fileName}》，本轮可参考附件说明。`
    : `客户已收到《${fileName}》，但本轮未查看；附件正文未参与判断。`;
}

/**
 * Decide whether the NPC reads each attachment. The configured Jev decision
 * receives the file name and conversation context, never the attachment body.
 */
export async function decideChatAttachments(
  input: {
    npcId: string;
    channel: 'email' | 'online';
    playerText: string;
    attachments: EmailAttachment[];
  },
  dependencies: { decisionInvoker?: AttachmentDecision } = {},
): Promise<ChatAttachmentTreatment[]> {
  const profile = buildJevNpcProfile(input.npcId);
  const treatments: ChatAttachmentTreatment[] = [];
  const decisionInvoker = dependencies.decisionInvoker
    ?? ((request: JevRequest) => invokeConfiguredJev('preview_attachment', request, invokeJev));

  for (const attachment of input.attachments) {
    const fallback = attachmentDecisionFallback(attachment.fileName, input.playerText);
    let viewed = fallback;
    try {
      const response = await decisionInvoker({
        state: {
          npcId: input.npcId,
          ...(profile ? { npcProfile: profile } : {}),
          attachmentTitle: attachment.fileName,
          playerText: input.playerText,
          channel: input.channel,
        },
        questions: {
          viewed: {
            type: 'noul',
            criteria: { true: '查看附件正文', false: '不查看附件正文' },
            instructions: 'NPC 本轮是否查看附件正文。只根据附件标题和当前沟通场景判断，不能臆测正文内容。',
          },
        },
      });
      const answer = response.answers.viewed;
      if (answer?.type === 'noul' && Number.isFinite(answer.noul)) viewed = answer.noul >= 0.5;
    } catch {
      // Use the same conservative, deterministic fallback as the preview.
    }
    treatments.push({
      ...attachment,
      viewed,
      impact: attachmentImpact(attachment.fileName, viewed),
    });
  }
  return treatments;
}

/** Format current and historical attachments for the NPC's untrusted context. */
export function attachmentsForNpcContext(attachments: ChatAttachmentTreatment[]): EmailAttachment[] {
  return attachments.map(({ fileName, description, viewed }) => ({
    fileName,
    description: viewed ? description : '客户已收到但本轮未查看；附件正文对客户不可见。',
  }));
}

function parseAttachmentList(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.fileName !== 'string' || typeof record.description !== 'string') return [];
    return [{ fileName: record.fileName.slice(0, 160), description: record.description.slice(0, 1_000) }];
  }).slice(0, 8);
}

function parseTreatments(value: unknown): ChatAttachmentTreatment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.fileName !== 'string'
      || typeof record.description !== 'string'
      || typeof record.viewed !== 'boolean'
      || typeof record.impact !== 'string') return [];
    return [{
      fileName: record.fileName.slice(0, 160),
      description: record.description.slice(0, 1_000),
      viewed: record.viewed,
      impact: record.impact.slice(0, 300),
    }];
  }).slice(0, 8);
}

/**
 * Strip storage metadata before it reaches the NPC or Jev evaluator. A newly
 * sent attachment's body is reintroduced only when its durable viewed flag is
 * true. Historical legacy emailAttachments are treated as viewed because the
 * old formal game passed all of them into NPC context at send time.
 */
export function npcHistoryWithViewedAttachments(messages: ChatMessageWithMetadata[]) {
  return messages.map(({ role, content, metadata }) => {
    const treatments = parseTreatments(metadata?.attachments);
    const attachments = treatments.length > 0
      ? treatments
      : parseAttachmentList(metadata?.emailAttachments).map((attachment) => ({
        ...attachment,
        viewed: true,
        impact: `客户已查看《${attachment.fileName}》，本轮可参考附件说明。`,
      }));
    if (attachments.length === 0) return { role, content };

    const context = attachments.map((attachment) => attachment.viewed
      ? `已查看附件《${attachment.fileName}》：${attachment.description}`
      : `收到附件《${attachment.fileName}》，未查看正文；正文不在已知信息中。`).join('\n');
    return { role, content: `${content}\n[附件处理记录]\n${context}` };
  });
}

/** Include only content actually viewed by the NPC in the evaluator input. */
export function appendViewedAttachmentsToPlayerMessage(
  playerMessage: string,
  attachments: ChatAttachmentTreatment[],
): string {
  const viewed = attachments.filter((attachment) => attachment.viewed);
  if (viewed.length === 0) return playerMessage;
  const context = viewed.map(({ fileName, description }) => `《${fileName}》：${description}`).join('\n');
  return `${playerMessage}\n[本轮客户已查看附件说明]\n${context}`;
}
