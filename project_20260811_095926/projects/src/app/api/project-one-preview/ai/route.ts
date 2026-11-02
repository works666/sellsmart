import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { previewAiRequestSchema } from '@/lib/contracts/project-one-preview-ai';
import { PreviewAiError, previewAiService } from '@/lib/game/project-one-preview-ai';
import { previewSessionRepository } from '@/lib/game/project-one-preview-session-repository';
import { isFastDebugEnabled, runWithFastTestObservability } from '@/lib/testing/fast-test-observability';
import { DEFAULT_PROJECT_ONE_PROMPT_CONFIG } from '@/lib/designer/prompt-config';
import { loadProjectOnePromptConfig } from '@/lib/designer/prompt-config-repository';
import { loadActivityDecisionConfigForMatching as loadActivityDecisionConfig } from '@/lib/designer/customer-activity-config-repository';
import { DEFAULT_ACTIVITY_DECISION_CONFIG } from '@/lib/game/customer-activities';
import { previewErrorDiagnosticFields, type PreviewErrorDiagnosticContext } from '@/lib/game/preview-error-diagnostics';
import { getPreviewRecoveryResponse } from './handler';

export const runtime = 'nodejs';

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

export function previewErrorResponse(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof PreviewAiError || (error instanceof Error && ['protocol', 'unavailable', 'conflict', 'not_found', 'limit'].includes(String((error as PreviewAiError).kind))))) return null;
  const previewError = error as PreviewAiError;
  const status = previewError.kind === 'unavailable' ? 503 : previewError.kind === 'conflict' ? 409 : previewError.kind === 'not_found' ? 404 : previewError.kind === 'limit' ? 429 : 502;
  const message = previewError.kind === 'unavailable'
    ? 'AI 服务暂时不可用，请稍后重试。'
    : previewError.kind === 'conflict'
      ? '当前预览会话正在处理上一条操作，请勿重复提交。'
      : previewError.kind === 'not_found'
        ? '预览会话不存在或已过期，请重新开始。'
        : previewError.kind === 'limit'
          ? '预览会话或 AI 请求过于繁忙，请稍后重试。'
          : 'AI 返回结果不符合预览协议，请重试。';
  return { status, message };
}

export function streamPreviewResponse(
  run: () => ReturnType<typeof previewAiService.execute>,
  diagnosticContext: PreviewErrorDiagnosticContext = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      try {
        send({ type: 'status', status: 'thinking' });
        const response = await run();
        const content = typeof response.content === 'string' ? response.content : '';
        const characters = Array.from(content);
        const chunkSize = Math.max(1, Math.ceil(characters.length / 60));
        for (let index = 0; index < characters.length; index += chunkSize) {
          send({ type: 'delta', content: characters.slice(index, index + chunkSize).join('') });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        send({ type: 'result', data: response });
        send({ type: 'done' });
      } catch (error) {
        const known = previewErrorResponse(error);
        if (known) {
          console.error('Project one preview AI stream failed', {
            status: known.status,
            ...previewErrorDiagnosticFields(error, diagnosticContext),
          });
          send({ type: 'error', status: known.status, error: known.message });
        } else {
          console.error('Project one preview AI stream failed unexpectedly', {
            status: 503,
            ...previewErrorDiagnosticFields(error, diagnosticContext),
          });
          send({ type: 'error', status: 503, error: '五人预览 AI 服务暂时不可用，请稍后重试。' });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function consumeRequest(userId: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 1_000) {
    for (const [id, candidate] of rateBuckets) {
      if (now - candidate.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(id);
    }
    if (rateBuckets.size > 1_000 && !rateBuckets.has(userId)) return false;
  }
  const bucket = rateBuckets.get(userId);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok) return guard.response!;
  if (guard.session?.role !== 'platform_designer') return NextResponse.json({ error: '权限不足' }, { status: 403 });
  if (!consumeRequest(guard.session!.userId)) {
    return NextResponse.json({ error: '操作过于频繁，请稍后再试。' }, { status: 429 });
  }

  let diagnosticContext: PreviewErrorDiagnosticContext = {};
  try {
    const rawBody = await request.text();
    // Activity drafts may contain up to 12k characters and JSON escaping can
    // expand that payload. Keep the ordinary field schemas as the real limits.
    if (rawBody.length > 80_000) return NextResponse.json({ error: '五人预览 AI 请求过大' }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: '五人预览 AI 请求不是有效 JSON' }, { status: 400 }); }
    const parsed = previewAiRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '五人预览 AI 请求字段无效', details: parsed.error.flatten() }, { status: 400 });
    }
    diagnosticContext = {
      action: parsed.data.action,
      npcId: 'npcId' in parsed.data ? parsed.data.npcId : undefined,
      commandId: parsed.data.commandId,
    };
    if (['test_adjust_npcs', 'test_adjust_appointments'].includes(parsed.data.action) && !isFastDebugEnabled()) {
      return NextResponse.json({ error: '测试调节仅在测试环境开放' }, { status: 403 });
    }
    const promptConfig = await loadProjectOnePromptConfig()
      .then((stored) => stored.config)
      .catch(() => DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
    const closesCustomerActivityConversation = parsed.data.action === 'phone_connect'
      || parsed.data.action === 'visit_turn'
      || parsed.data.action === 'end_visit'
      || parsed.data.action === 'customer_activity_end_conversation'
      || (parsed.data.action === 'message' && ['email', 'wechat'].includes(parsed.data.channel));
    const activityDecisionConfig = closesCustomerActivityConversation
      ? (await loadActivityDecisionConfig()).config
      : DEFAULT_ACTIVITY_DECISION_CONFIG;
    const execute = () => runWithFastTestObservability(
      guard.session!.userId,
      () => previewAiService.executePersistent(guard.session!.userId, parsed.data, previewSessionRepository, promptConfig, activityDecisionConfig),
    );
    const acceptsStream = request.headers.get('accept')?.includes('text/event-stream');
    const streamableAction = parsed.data.action === 'phone_connect'
      || parsed.data.action === 'visit_turn'
      || (parsed.data.action === 'message' && parsed.data.channel === 'work_phone');
    if (acceptsStream && streamableAction) return streamPreviewResponse(execute, diagnosticContext);
    const response = await execute();
    return NextResponse.json({ success: true, previewSessionId: response.previewSessionId, version: response.version, data: response });
  } catch (error) {
    const known = previewErrorResponse(error);
    if (known) {
      console.error('Project one preview AI request failed', {
        status: known.status,
        ...previewErrorDiagnosticFields(error, diagnosticContext),
      });
      return NextResponse.json({ error: known.message }, { status: known.status });
    }
    console.error('Project one preview AI request failed unexpectedly', {
      status: 503,
      ...previewErrorDiagnosticFields(error, diagnosticContext),
    });
    return NextResponse.json({ error: '五人预览 AI 服务暂时不可用，请稍后重试。' }, { status: 503 });
  }
}

/** Restore only designer-preview state; formal player DTOs never use this route. */
export async function GET(request: NextRequest) {
  return getPreviewRecoveryResponse(request, {
    load: (userId, previewSessionId) => previewSessionRepository.load(userId, previewSessionId),
    syncCustomerActivities: async (userId, state) => {
      const syncRequest = previewAiRequestSchema.parse({
        action: 'customer_activity_sync',
        previewSessionId: state.previewSessionId,
        commandId: randomUUID(),
        expectedVersion: state.version,
      });
      await previewAiService.executePersistent(userId, syncRequest, previewSessionRepository);
    },
  });
}
