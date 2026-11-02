import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGuard } from '@/lib/auth/guard';
import {
  getAiProviderAvailability,
  loadAiProviderSelection,
  saveAiProviderSelection,
  type StoredAiProviderSelection,
} from '@/lib/ai/provider-selection';

export const runtime = 'nodejs';

const saveSchema = z.object({
  provider: z.enum(['default', 'deepseek', 'doubao', 'qwen']),
  revision: z.number().int().min(0),
}).strict();

function selectionResponse(stored: StoredAiProviderSelection) {
  return {
    provider: stored.config.provider,
    revision: stored.revision,
    persisted: stored.persisted,
    providers: getAiProviderAvailability(),
  };
}

async function conflictResponse(): Promise<NextResponse> {
  try {
    const current = await loadAiProviderSelection();
    return NextResponse.json({
      error: 'AI Provider 配置已被其他设计师更新，请刷新后再保存。',
      code: 'REVISION_CONFLICT',
      current: selectionResponse(current),
    }, { status: 409 });
  } catch {
    return NextResponse.json({
      error: 'AI Provider 配置已被其他设计师更新，请刷新后再保存。',
      code: 'REVISION_CONFLICT',
    }, { status: 409 });
  }
}

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    return NextResponse.json({ success: true, ...selectionResponse(await loadAiProviderSelection()) });
  } catch (error) {
    console.error('AI provider selection read failed', { code: error instanceof Error ? error.message.slice(0, 96) : 'unknown' });
    return NextResponse.json({ error: 'AI Provider 配置暂时无法读取。' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return NextResponse.json({ error: 'AI Provider 配置请求过大。' }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'AI Provider 配置不是合法 JSON。' }, { status: 400 }); }
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'AI Provider 配置字段无效。' }, { status: 400 });
    }

    if (!getAiProviderAvailability()[parsed.data.provider].configured) {
      return NextResponse.json({ error: '所选 AI Provider 尚未完成服务端配置。' }, { status: 400 });
    }
    const saved = await saveAiProviderSelection({ provider: parsed.data.provider }, parsed.data.revision, guard.session.userId);
    return NextResponse.json({ success: true, ...selectionResponse(saved) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown';
    if (code === 'AI_PROVIDER_SELECTION_VERSION_CONFLICT') return conflictResponse();
    console.error('AI provider selection write failed', { code: code.slice(0, 96) });
    return NextResponse.json({ error: 'AI Provider 配置保存失败。' }, { status: 503 });
  }
}
