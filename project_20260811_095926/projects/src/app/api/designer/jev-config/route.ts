import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import {
  JEV_DESIGNER_TASK_CATALOG,
  loadJevDesignerConfig,
  parseJevDesignerConfig,
  saveJevDesignerConfig,
} from '@/lib/ai/jev-designer-config';
import { buildJevCandidateNpcProfiles, buildJevCandidateNpcSummaries } from '@/lib/ai/jev-npc-profile';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    const stored = await loadJevDesignerConfig();
    return NextResponse.json({
      success: true,
      catalog: JEV_DESIGNER_TASK_CATALOG,
      npcProfiles: buildJevCandidateNpcProfiles(),
      candidateNpcProfiles: buildJevCandidateNpcSummaries(),
      ...stored,
    });
  } catch (error) {
    console.error('Jev designer config read failed', { code: error instanceof Error ? error.message.slice(0, 96) : 'unknown' });
    return NextResponse.json({ error: 'Jev 决策配置暂时无法读取。' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await request.text();
    if (raw.length > 120_000) return NextResponse.json({ error: 'Jev 决策配置过大。' }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Jev 决策配置不是合法 JSON。' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Jev 决策配置字段无效。' }, { status: 400 });
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Object.prototype.hasOwnProperty.call(record, 'expectedRevision') || !Object.prototype.hasOwnProperty.call(record, 'config')
      || !Number.isInteger(record.expectedRevision) || (record.expectedRevision as number) < 0) {
      return NextResponse.json({ error: 'Jev 决策配置字段无效。' }, { status: 400 });
    }
    const config = parseJevDesignerConfig(record.config);
    if (!config) return NextResponse.json({ error: 'Jev 决策任务、问题或文本长度无效。' }, { status: 400 });
    const saved = await saveJevDesignerConfig(config, record.expectedRevision as number, guard.session.userId);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown';
    if (code === 'JEV_DESIGNER_CONFIG_VERSION_CONFLICT') {
      return NextResponse.json({ error: 'Jev 决策配置已被其他设计师更新，请刷新后再保存。' }, { status: 409 });
    }
    console.error('Jev designer config write failed', { code: code.slice(0, 96) });
    return NextResponse.json({ error: 'Jev 决策配置保存失败。' }, { status: 503 });
  }
}
