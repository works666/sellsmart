import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGuard } from '@/lib/auth/guard';
import { projectOnePromptConfigSchema, type NpcRolePrompt } from '@/lib/designer/prompt-config';
import {
  PROJECT_ONE_CHANNEL_MODIFIERS,
  PROJECT_ONE_FIVE_PERSON_IDS,
  type ProjectOneChannelId,
} from '@/lib/designer/project-one-five-person';
import {
  loadProjectOnePromptConfig,
  saveProjectOnePromptConfig,
} from '@/lib/designer/prompt-config-repository';

export const runtime = 'nodejs';

const saveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  config: projectOnePromptConfigSchema,
}).strict();

const REGISTERED_CHANNEL_IDS = Object.keys(PROJECT_ONE_CHANNEL_MODIFIERS) as ProjectOneChannelId[];

function hasOwn<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Merge the only designer-editable part of the prompt configuration.
 *
 * The request still carries the legacy full config shape, but the server must
 * treat every field outside the two person-scoped maps as read-only.  Building
 * fresh maps from the registries also prevents stale or client-invented IDs
 * from being persisted.  An explicitly empty prompt is retained so a designer
 * can clear a person or person/channel exception; omitted entries keep the
 * currently saved value for backwards-compatible partial payloads.
 */
export function mergeEditablePromptConfig(
  current: z.infer<typeof projectOnePromptConfigSchema>,
  requested: z.infer<typeof projectOnePromptConfigSchema>,
): z.infer<typeof projectOnePromptConfigSchema> {
  const npcRolePrompts: Record<string, NpcRolePrompt> = {};
  const npcChannelExceptions: Record<string, Record<string, string>> = {};

  for (const npcId of PROJECT_ONE_FIVE_PERSON_IDS) {
    if (hasOwn(current.npcRolePrompts, npcId)) {
      npcRolePrompts[npcId] = current.npcRolePrompts[npcId];
    }
    if (hasOwn(requested.npcRolePrompts, npcId)) {
      npcRolePrompts[npcId] = requested.npcRolePrompts[npcId];
    }

    const currentExceptions = current.npcChannelExceptions[npcId];
    const requestedExceptions = requested.npcChannelExceptions[npcId];
    const mergedExceptions: Record<string, string> = {};
    for (const channelId of REGISTERED_CHANNEL_IDS) {
      if (hasOwn(currentExceptions, channelId)) {
        mergedExceptions[channelId] = currentExceptions[channelId];
      }
      if (hasOwn(requestedExceptions, channelId)) {
        mergedExceptions[channelId] = requestedExceptions[channelId];
      }
    }
    if (Object.keys(mergedExceptions).length > 0) {
      npcChannelExceptions[npcId] = mergedExceptions;
    }
  }

  return {
    ...current,
    // Thresholds are a designer-controlled deterministic rule. All other
    // workflow fields remain protected from this page's write request.
    supportTierThresholds: requested.supportTierThresholds ?? current.supportTierThresholds,
    npcRolePrompts,
    npcChannelExceptions,
  };
}

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    return NextResponse.json({ success: true, ...(await loadProjectOnePromptConfig()) });
  } catch (error) {
    console.error('Prompt config read failed', { code: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: '提示词配置暂时无法读取，请确认数据库迁移已执行。' }, { status: 503 });
  }
}
export async function PUT(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await request.text();
    if (raw.length > 200_000) return NextResponse.json({ error: '提示词配置过大。' }, { status: 413 });
    const parsed = saveSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: '提示词配置字段无效。', details: parsed.error.flatten() }, { status: 400 });
    const current = await loadProjectOnePromptConfig();
    const editableConfig = mergeEditablePromptConfig(current.config, parsed.data.config);
    const saved = await saveProjectOnePromptConfig(editableConfig, parsed.data.expectedRevision, guard.session.userId);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown';
    if (code === 'PROMPT_CONFIG_VERSION_CONFLICT') {
      return NextResponse.json({ error: '提示词已被其他设计师更新，请刷新后再保存。' }, { status: 409 });
    }
    console.error('Prompt config write failed', { code });
    return NextResponse.json({ error: '提示词保存失败，请确认数据库迁移已执行。' }, { status: 503 });
  }
}
