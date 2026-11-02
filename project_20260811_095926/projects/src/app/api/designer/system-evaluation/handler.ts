import { NextRequest, NextResponse } from 'next/server';
import { authGuard, type AuthGuardResult } from '@/lib/auth/guard';
import { systemEvaluationRequestSchema, type SystemEvaluationSnapshotMetadata } from '@/lib/contracts/system-evaluation';
import { PreviewAiError } from '@/lib/game/project-one-preview-ai';
import { createServerClient } from '@/storage/database/supabase-client';
import { SystemEvaluationError, runSystemEvaluation, type SystemEvaluationDeps } from '@/lib/testing/system-evaluation';

const MAX_BODY_CHARS = 16_000;
const RATE_WINDOW_MS = 60_000;
const MAX_RUNS_PER_USER_PER_WINDOW = 2;
const MAX_CONCURRENT_GLOBAL = 2;
const activeUsers = new Set<string>();
let activeRuns = 0;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

export type SystemEvaluationHandlerDeps = SystemEvaluationDeps & {
  auth?: (request: NextRequest, requiredPermission?: string) => AuthGuardResult;
  listSnapshots?: (userId: string) => Promise<SystemEvaluationSnapshotMetadata[]>;
};

function responseError(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { ...(code ? { code } : {}), message } }, { status });
}

function consumeRate(userId: string, now = Date.now()): boolean {
  for (const [id, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(id);
  }
  if (rateBuckets.size >= 1_000 && !rateBuckets.has(userId)) return false;
  const current = rateBuckets.get(userId);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_RUNS_PER_USER_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function beginRun(userId: string): boolean {
  if (activeRuns >= MAX_CONCURRENT_GLOBAL || activeUsers.has(userId)) return false;
  activeRuns += 1;
  activeUsers.add(userId);
  return true;
}

function finishRun(userId: string) {
  if (activeUsers.delete(userId)) activeRuns = Math.max(0, activeRuns - 1);
}

function requireDesigner(request: NextRequest, deps: SystemEvaluationHandlerDeps): AuthGuardResult | NextResponse {
  const guard = (deps.auth ?? authGuard)(request);
  if (!guard.ok || !guard.session) return guard.response!;
  if (guard.session.role !== 'platform_designer') return responseError('权限不足', 403, 'forbidden');
  return guard;
}

function knownError(error: unknown): { status: number; message: string; code: string } | null {
  if (error instanceof SystemEvaluationError) {
    const status = error.kind === 'not_found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'invalid' ? 400 : 503;
    return { status, message: error.message, code: error.kind };
  }
  if (error instanceof PreviewAiError) {
    const status = error.kind === 'not_found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'protocol' ? 400 : 503;
    return { status, message: error.kind === 'not_found' ? '预览快照不存在或不属于当前用户。' : '系统评测暂时不可用。', code: error.kind };
  }
  return null;
}

async function defaultListSnapshots(userId: string): Promise<SystemEvaluationSnapshotMetadata[]> {
  const { data, error } = await createServerClient()
    .from('project_one_preview_sessions')
    .select('id,version,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(8);
  if (error) throw new Error(`PREVIEW_SESSION_LIST_FAILED:${error.code || 'unknown'}`);
  return (data ?? []).map((item) => ({
    previewSessionId: String(item.id),
    version: Number(item.version),
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : null,
  }));
}

export async function getSystemEvaluationResponse(request: NextRequest, deps: SystemEvaluationHandlerDeps = {}) {
  const guard = requireDesigner(request, deps);
  if (guard instanceof NextResponse) return guard;
  try {
    const sessions = await (deps.listSnapshots ?? defaultListSnapshots)(guard.session!.userId);
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error('System evaluation snapshot list failed', { code: error instanceof Error ? error.message : 'SYSTEM_EVALUATION_LIST_FAILED' });
    return responseError('预览快照列表暂时不可用。', 503, 'unavailable');
  }
}

export async function postSystemEvaluationResponse(request: NextRequest, deps: SystemEvaluationHandlerDeps = {}) {
  const guard = requireDesigner(request, deps);
  if (guard instanceof NextResponse) return guard;

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return responseError('无法读取请求内容。', 400, 'invalid');
  }
  if (rawBody.length > MAX_BODY_CHARS) return responseError('系统评测请求过大。', 413, 'payload_too_large');
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return responseError('系统评测请求不是有效 JSON。', 400, 'invalid');
  }
  const parsed = systemEvaluationRequestSchema.safeParse(body);
  if (!parsed.success) return responseError('系统评测请求字段无效。', 400, 'invalid');
  if (!consumeRate(guard.session!.userId)) return responseError('系统评测请求过于频繁，请稍后再试。', 429, 'rate_limited');
  if (!beginRun(guard.session!.userId)) return responseError('已有系统评测正在运行，请等待完成后再试。', 429, 'concurrency_limited');

  try {
    const report = await runSystemEvaluation(guard.session!.userId, parsed.data, deps);
    return NextResponse.json({ success: true, report });
  } catch (error) {
    const known = knownError(error);
    if (known) return responseError(known.message, known.status, known.code);
    console.error('System evaluation failed', { code: error instanceof Error ? error.message : 'SYSTEM_EVALUATION_UNEXPECTED' });
    return responseError('系统评测服务暂时不可用。', 503, 'unavailable');
  } finally {
    finishRun(guard.session!.userId);
  }
}
