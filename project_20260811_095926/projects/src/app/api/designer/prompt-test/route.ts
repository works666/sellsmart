import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { promptTestRequestSchema } from '@/lib/contracts/prompt-test';
import { PromptTestError, promptTestService } from '@/lib/ai/prompt-test';
import { DEFAULT_PROJECT_ONE_PROMPT_CONFIG } from '@/lib/designer/prompt-config';
import { loadProjectOnePromptConfig } from '@/lib/designer/prompt-config-repository';

export const runtime = 'nodejs';

const buckets = new Map<string, { startedAt: number; count: number }>();
function consume(userId: string): boolean {
  const now = Date.now();
  for (const [id, bucket] of buckets) {
    if (now - bucket.startedAt >= 60_000) buckets.delete(id);
  }
  if (buckets.size >= 1_000 && !buckets.has(userId)) return false;
  const current = buckets.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    buckets.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  if (!consume(guard.session.userId)) return NextResponse.json({ error: '测试请求过于频繁，请稍后再试。' }, { status: 429 });
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ error: '测试请求过大。' }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: '请求不是有效 JSON。' }, { status: 400 }); }
    const parsed = promptTestRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: '测试请求字段无效。', details: parsed.error.flatten() }, { status: 400 });
    const promptConfig = await loadProjectOnePromptConfig()
      .then((stored) => stored.config)
      .catch(() => DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
    const result = await promptTestService.execute(guard.session.userId, parsed.data, {
      npcPromptConfig: promptConfig.promptTestNpcPrompt,
      evaluatorInstructions: promptConfig.promptTestEvaluatorPrompt,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PromptTestError) {
      const status = error.kind === 'not_found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'protocol' ? 502 : 503;
      const message = error.kind === 'not_found' ? '测试会话已过期，请重置。'
        : error.kind === 'conflict' ? '测试会话版本冲突，请重置后重试。'
          : error.kind === 'protocol' ? '模型输出不符合测试协议，请重试。'
            : '提示词测试服务暂时不可用，请检查模型与状态存储配置。';
      console.error('Prompt test failed', { kind: error.kind });
      return NextResponse.json({ error: message }, { status });
    }
    console.error('Prompt test failed unexpectedly', { code: 'PROMPT_TEST_UNEXPECTED_ERROR' });
    return NextResponse.json({ error: '提示词测试服务暂时不可用。' }, { status: 503 });
  }
}
