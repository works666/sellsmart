import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGuard } from '@/lib/auth/guard';
import { parseCustomerActivityDecisionConfigWrite } from '@/lib/designer/customer-activity-decision-form';
import {
  loadActivityDecisionConfig,
  saveActivityDecisionConfig,
} from '@/lib/designer/customer-activity-config-repository';

export const runtime = 'nodejs';

const requestSchema = z.object({
  expectedRevision: z.number().int().min(0),
  config: z.unknown(),
}).strict();

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    return NextResponse.json({ success: true, ...(await loadActivityDecisionConfig()) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown';
    console.error('Customer activity config read failed', { code: code.slice(0, 96) });
    return NextResponse.json({ error: '客户活动判定配置暂时无法读取。' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await request.text();
    if (raw.length > 32_000) return NextResponse.json({ error: '客户活动配置过大。' }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: '客户活动配置不是合法 JSON。' }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: '客户活动配置字段无效。', details: parsed.error.flatten() }, { status: 400 });
    const config = parseCustomerActivityDecisionConfigWrite(parsed.data.config);
    if (!config) return NextResponse.json({ error: '客户活动配置无效；请完整设置饭局的目标客户门槛，以及数值模式下三项团队活动的规则。' }, { status: 400 });
    const saved = await saveActivityDecisionConfig(config, parsed.data.expectedRevision, guard.session.userId);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown';
    if (code === 'CUSTOMER_ACTIVITY_CONFIG_VERSION_CONFLICT') {
      return NextResponse.json({ error: '客户活动配置已被其他设计师更新，请刷新后再保存。' }, { status: 409 });
    }
    if (code === 'CUSTOMER_ACTIVITY_CONFIG_INVALID') {
      return NextResponse.json({ error: '客户活动配置字段无效。' }, { status: 400 });
    }
    console.error('Customer activity config write failed', { code: code.slice(0, 96) });
    return NextResponse.json({ error: '客户活动配置保存失败。' }, { status: 503 });
  }
}
