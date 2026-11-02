export type NpcSpeakerIdentity = {
  id: string;
  name: string;
  title: string;
};

export type NpcSpeakerIdentityGuardResult = {
  reply: string;
  source: 'generated' | 'repaired' | 'fallback';
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function targetNpcAliases(npc: NpcSpeakerIdentity): string[] {
  const surname = npc.name.slice(0, 1);
  return [...new Set([
    npc.name,
    `${surname}总`,
    `${surname}先生`,
    `${surname}女士`,
    `${surname}${npc.title}`,
  ])].filter((alias) => alias.length > 1);
}

/**
 * Detect only high-confidence role reversals. A normal phone introduction such
 * as “我是张建国” must remain valid, as must mentioning a different NPC by name.
 */
export function hasNpcSpeakerIdentityViolation(npc: NpcSpeakerIdentity, reply: string): boolean {
  const content = reply.trim();
  if (!content) return false;
  const aliases = targetNpcAliases(npc).map(escapeRegExp).join('|');
  const labelsTargetNpc = new RegExp(`^(?:${aliases})\\s*[:：]`, 'i');
  const callsTargetNpcPlayer = new RegExp(
    `(?:^|[。！？!?]\\s*)` +
      `(?:(?:您好|你好|您|喂)\\s*[，,、]?\\s*(?:${aliases})|(?:${aliases})\\s*(?:您好|你好|[，,、。！？!?]))`,
    'i',
  );
  const claimsVendorIdentity = /(?:我(?:们)?(?:是|来自|这边是)|本公司|我们(?:团队|公司|这边)).{0,40}(?:供应商|乙方|销售(?:团队|人员)?|服务商|交付(?:团队|方)|厂商|解决方案(?:提供商|团队)|(?:政企数字化|数字化交付|软件开发|系统集成)[^。！？；\n]{0,8}(?:团队|公司|服务商))/i;
  return labelsTargetNpc.test(content) || callsTargetNpcPlayer.test(content) || claimsVendorIdentity.test(content);
}

export function npcSpeakerIdentityInstruction(npc: NpcSpeakerIdentity, channel: string): string {
  return `## 当前回合身份锁定（高优先级）
- 当前说话者只能是 ${npc.name}（${npc.title}，人物 ID ${npc.id}），正在通过 ${channel} 回复玩家。
- 玩家是向你沟通的销售方；你以该 NPC 的第一人称直接回复玩家。
- 你不是供应商、乙方、销售、服务商或交付团队；不得以这些身份自我介绍。
- 不得把“${npc.name}”或该人物职务称谓用于称呼玩家。电话中可以正常说“我是${npc.name}”。
- 不加姓名或职务前缀；只输出该 NPC 对玩家说的正文。`;
}

export function npcSpeakerIdentityRetryInstruction(npc: NpcSpeakerIdentity, channel: string): string {
  return `发言身份校验失败。当前你扮演的是 ${npc.name}（${npc.title}，人物 ID ${npc.id}），正在通过 ${channel} 回复玩家。请以该 NPC 的第一人称重写：不要把“${npc.name}”或该人物职务称谓用于称呼玩家；不要自称供应商、乙方、销售、服务商或交付团队。电话中“我是${npc.name}”是允许的正常自我介绍。不要添加姓名或职务前缀；只输出修正后的 NPC 正文。`;
}

export function safeNpcSpeakerReplyFallback(): string {
  return '抱歉，这件事我暂时不便答复。';
}

/** Run at most one targeted repair. Rejected drafts are never returned to the caller. */
export async function generateNpcReplyWithIdentityGuard(
  npc: NpcSpeakerIdentity,
  channel: string,
  generate: (retryInstruction?: string) => Promise<string>,
): Promise<NpcSpeakerIdentityGuardResult> {
  const first = (await generate()).trim();
  if (!first) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  if (!hasNpcSpeakerIdentityViolation(npc, first)) return { reply: first, source: 'generated' };

  const repaired = (await generate(npcSpeakerIdentityRetryInstruction(npc, channel))).trim();
  if (!repaired) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  if (!hasNpcSpeakerIdentityViolation(npc, repaired)) return { reply: repaired, source: 'repaired' };

  return { reply: safeNpcSpeakerReplyFallback(), source: 'fallback' };
}
