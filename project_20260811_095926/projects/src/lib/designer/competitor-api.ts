import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authGuard, type AuthGuardResult } from '@/lib/auth/guard';
import { isLegacyCompetitorPlaceholder, type CompetitorProfile } from '@/lib/contracts/competitors';
import {
  COMPETITOR_PROJECT_IDS,
  MAX_COMPETITOR_CONFIG_BYTES,
  competitorCreateSchema,
  competitorDeleteSchema,
  competitorUpdateSchema,
  createProjectOneCompetitor,
  deleteProjectOneCompetitor,
  loadProjectOneCompetitorConfig,
  updateProjectOneCompetitor,
} from '@/lib/designer/competitors';

export const runtime = 'nodejs';

const projectIdSchema = z.number().int().refine(
  (value): value is 1 => (COMPETITOR_PROJECT_IDS as readonly number[]).includes(value),
  '当前仅支持项目一竞品配置',
);

function designerGuard(request: NextRequest): AuthGuardResult {
  // Keep both permissions explicit.  The current role matrix grants both to
  // platform designers, while this also supports a future narrowly scoped
  // designer role without weakening the API to any authenticated user.
  const workflowGuard = authGuard(request, '工作流编辑');
  if (workflowGuard.ok) return workflowGuard;
  const dataGuard = authGuard(request, '数据表编辑');
  if (dataGuard.ok) return dataGuard;
  return workflowGuard.response?.status === 401 ? workflowGuard : dataGuard;
}

function projectIdFromQuery(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('project_id') ?? '1';
  const parsed = projectIdSchema.safeParse(Number(raw));
  if (!parsed.success) throw new Error('COMPETITOR_PROJECT_INVALID');
  return parsed.data;
}

export function toCompetitorProfiles(config: Awaited<ReturnType<typeof loadProjectOneCompetitorConfig>>, projectId: number): CompetitorProfile[] {
  return config.competitors
    .filter((competitor) => competitor.project_id === projectId && !isLegacyCompetitorPlaceholder(competitor))
    .map((competitor) => ({
      id: competitor.id,
      project_id: competitor.project_id,
      company_name: competitor.company_name,
      features: competitor.features,
      more_info: competitor.more_info,
      industry: competitor.industry,
      solution_summary: competitor.solution_summary,
      representative_experience: competitor.representative_experience,
      service_support: competitor.service_support,
    }));
}

async function parseJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_COMPETITOR_CONFIG_BYTES) {
    throw new Error('COMPETITOR_REQUEST_TOO_LARGE');
  }
  const raw = await request.text();
  if (raw.length > MAX_COMPETITOR_CONFIG_BYTES) throw new Error('COMPETITOR_REQUEST_TOO_LARGE');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('COMPETITOR_REQUEST_INVALID_JSON');
  }
}

function parseErrorResponse(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'unknown';
  switch (code) {
    case 'COMPETITOR_PROJECT_INVALID':
      return NextResponse.json({ error: '项目不受支持，目前仅可配置项目一。' }, { status: 400 });
    case 'COMPETITOR_REQUEST_TOO_LARGE':
      return NextResponse.json({ error: '竞品配置请求过大。' }, { status: 413 });
    case 'COMPETITOR_REQUEST_INVALID_JSON':
      return NextResponse.json({ error: '竞品配置请求不是有效 JSON。' }, { status: 400 });
    case 'COMPETITOR_CONFIG_VERSION_CONFLICT':
      return NextResponse.json({ error: '竞品配置已被其他设计师更新，请刷新后重试。' }, { status: 409 });
    case 'COMPETITOR_DUPLICATE_NAME':
      return NextResponse.json({ error: '竞品名称不能重复。' }, { status: 409 });
    case 'COMPETITOR_NOT_FOUND':
      return NextResponse.json({ error: '竞品不存在或已被删除。' }, { status: 404 });
    case 'COMPETITOR_CONFIG_NOT_INITIALIZED':
      return NextResponse.json({ error: '竞品配置尚未完成数据库迁移，未保存任何修改。' }, { status: 503 });
    case 'COMPETITOR_CONFIG_INVALID':
      return NextResponse.json({ error: '数据库中的竞品配置无效，未保存任何修改。' }, { status: 503 });
    default:
      if (code.startsWith('COMPETITOR_CONFIG_READ_FAILED')) {
        return NextResponse.json({ error: '竞品配置暂时无法读取，请确认数据库迁移已执行。' }, { status: 503 });
      }
      if (code.startsWith('COMPETITOR_CONFIG_WRITE_FAILED')) {
        return NextResponse.json({ error: '竞品配置保存失败，请确认数据库迁移已执行。' }, { status: 503 });
      }
      return NextResponse.json({ error: '竞品配置请求失败。' }, { status: 503 });
  }
}

function invalidRequestResponse(parsed: { error: z.ZodError }): NextResponse {
  return NextResponse.json({ error: '竞品配置字段无效。', details: parsed.error.flatten() }, { status: 400 });
}

function configResponse(config: Awaited<ReturnType<typeof loadProjectOneCompetitorConfig>>, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    success: true,
    data: config.competitors,
    revision: config.revision,
    persisted: config.persisted,
    ...extra,
  });
}

export async function handleCompetitorGet(request: NextRequest): Promise<NextResponse> {
  const guard = designerGuard(request);
  if (!guard.ok) return guard.response!;
  try {
    projectIdFromQuery(request);
    return configResponse(await loadProjectOneCompetitorConfig());
  } catch (error) {
    return parseErrorResponse(error);
  }
}

/** Public-in-game, authenticated read view. Designer CRUD remains permission-guarded. */
export async function handleCompetitorProfilesGet(request: NextRequest): Promise<NextResponse> {
  const guard = authGuard(request);
  if (!guard.ok) return noStoreResponse(guard.response!);
  try {
    const projectId = projectIdFromQuery(request);
    const config = await loadProjectOneCompetitorConfig();
    const data = toCompetitorProfiles(config, projectId);
    return NextResponse.json(
      { success: true, data, revision: config.revision },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return noStoreResponse(parseErrorResponse(error));
  }
}

function noStoreResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

export async function handleCompetitorPost(request: NextRequest): Promise<NextResponse> {
  const guard = designerGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await parseJsonBody(request);
    const parsed = competitorCreateSchema.safeParse(raw);
    if (!parsed.success) return invalidRequestResponse(parsed);
    const result = await createProjectOneCompetitor(parsed.data, guard.session.userId);
    return configResponse(result.config, { item: result.item });
  } catch (error) {
    return parseErrorResponse(error);
  }
}

export async function handleCompetitorPut(request: NextRequest, pathId?: string): Promise<NextResponse> {
  const guard = designerGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await parseJsonBody(request);
    const candidate = pathId ? { ...(raw && typeof raw === 'object' ? raw : {}), id: pathId } : raw;
    const parsed = competitorUpdateSchema.safeParse(candidate);
    if (!parsed.success) return invalidRequestResponse(parsed);
    const result = await updateProjectOneCompetitor(parsed.data, guard.session.userId);
    return configResponse(result.config, { item: result.item });
  } catch (error) {
    return parseErrorResponse(error);
  }
}

export async function handleCompetitorDelete(request: NextRequest, pathId?: string): Promise<NextResponse> {
  const guard = designerGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  try {
    const raw = await parseJsonBody(request);
    const candidate = pathId ? { ...(raw && typeof raw === 'object' ? raw : {}), id: pathId } : raw;
    const parsed = competitorDeleteSchema.safeParse(candidate);
    if (!parsed.success) return invalidRequestResponse(parsed);
    const config = await deleteProjectOneCompetitor(parsed.data, guard.session.userId);
    return configResponse(config);
  } catch (error) {
    return parseErrorResponse(error);
  }
}
