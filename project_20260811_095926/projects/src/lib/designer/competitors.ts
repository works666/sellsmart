import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isLegacyCompetitorPlaceholder } from '@/lib/contracts/competitors';
import { PROJECT_ONE_COMPETITORS } from '@/lib/game/project-one';
import { createServerClient } from '@/storage/database/supabase-client';

/**
 * Competitors are part of the existing scenario_templates document.  Keep
 * the project whitelist deliberately narrow until the other projects have a
 * persisted scenario contract of their own.
 */
export const COMPETITOR_PROJECT_IDS = [1] as const;
export type CompetitorProjectId = (typeof COMPETITOR_PROJECT_IDS)[number];
export const PROJECT_ONE_SCENARIO_TEMPLATE_CODE = 'project-1';
export const MAX_COMPETITORS_PER_PROJECT = 50;
export const MAX_COMPETITOR_CONFIG_BYTES = 128 * 1024;

const UUID = z.string().uuid();
const projectIdSchema = z.literal(1);

export const competitorRecordSchema = z.object({
  id: UUID,
  project_id: projectIdSchema,
  company_name: z.string().trim().min(1).max(64),
  features: z.string().trim().min(1).max(2_000),
  more_info: z.string().trim().min(1).max(4_000),
  industry: z.string().trim().max(120).default(''),
  solution_summary: z.string().trim().max(1_500).default(''),
  representative_experience: z.string().trim().max(2_000).default(''),
  service_support: z.string().trim().max(1_500).default(''),
}).strict();

export const competitorListSchema = z.array(competitorRecordSchema).max(MAX_COMPETITORS_PER_PROJECT);

export const competitorCreateSchema = z.object({
  project_id: projectIdSchema,
  expected_revision: z.number().int().min(0),
  company_name: z.string().trim().min(1).max(64),
  features: z.string().trim().min(1).max(2_000),
  more_info: z.string().trim().min(1).max(4_000),
  industry: z.string().trim().max(120).optional(),
  solution_summary: z.string().trim().max(1_500).optional(),
  representative_experience: z.string().trim().max(2_000).optional(),
  service_support: z.string().trim().max(1_500).optional(),
}).strict();

export const competitorUpdateSchema = z.object({
  id: UUID,
  project_id: projectIdSchema,
  expected_revision: z.number().int().min(0),
  company_name: z.string().trim().min(1).max(64),
  features: z.string().trim().min(1).max(2_000),
  more_info: z.string().trim().min(1).max(4_000),
  industry: z.string().trim().max(120).optional(),
  solution_summary: z.string().trim().max(1_500).optional(),
  representative_experience: z.string().trim().max(2_000).optional(),
  service_support: z.string().trim().max(1_500).optional(),
}).strict();

export const competitorDeleteSchema = z.object({
  id: UUID,
  project_id: projectIdSchema,
  expected_revision: z.number().int().min(0),
}).strict();

export type CompetitorRecord = z.infer<typeof competitorRecordSchema>;
export type CompetitorCreate = z.infer<typeof competitorCreateSchema>;
export type CompetitorUpdate = z.infer<typeof competitorUpdateSchema>;
export type CompetitorDelete = z.infer<typeof competitorDeleteSchema>;

const DEFAULT_SIMULATED_COMPETITORS = [
  {
    company_name: '北辰数科（模拟企业）',
    features: '数据治理与系统集成方案成熟，适合复杂存量系统环境。',
    more_info: '纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。',
    industry: '政务数字化与数据治理（模拟设定）',
    solution_summary: '强调跨系统数据整合、统一身份与分阶段迁移，具体接口和验收方案需结合招标要求核实。',
    representative_experience: '模拟设定：曾参与多源数据整合类项目；未提供可核验的真实客户或合同案例。',
    service_support: '模拟设定：可提供本地实施团队与上线后运维响应；服务网点和响应时限尚未核验。',
  },
  {
    company_name: '云桥协同（模拟企业）',
    features: '协同办公产品覆盖较完整，部署选择灵活，强调易用性。',
    more_info: '纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。',
    industry: '协同办公与政企软件（模拟设定）',
    solution_summary: '侧重统一门户、流程协同和分层部署，可按需求讨论模块组合；与现有系统的兼容性需要进一步确认。',
    representative_experience: '模拟设定：具有中型组织协同平台交付经验；未提供可核验的真实客户或合同案例。',
    service_support: '模拟设定：提供远程培训、知识库和上线辅导；具体服务范围与响应等级尚未核验。',
  },
];

export interface StoredCompetitorConfig {
  competitors: CompetitorRecord[];
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  persisted: boolean;
}

const defaultCompetitorIdBase = 0x101;

export const DEFAULT_PROJECT_ONE_COMPETITORS: CompetitorRecord[] = [
  ...PROJECT_ONE_COMPETITORS,
  ...DEFAULT_SIMULATED_COMPETITORS.map((competitor) => ({ ...competitor, project_id: 1 })),
].map((competitor, index) =>
  competitorRecordSchema.parse({
    // Keep stable, distinct fallback IDs as the simulated default list grows.
    id: `10000000-0000-4000-8000-${(defaultCompetitorIdBase + index).toString(16).padStart(12, '0')}`,
    project_id: 1,
    company_name: competitor.company_name,
    features: competitor.features,
    more_info: competitor.more_info,
    industry: 'industry' in competitor ? competitor.industry : undefined,
    solution_summary: 'solution_summary' in competitor ? competitor.solution_summary : undefined,
    representative_experience: 'representative_experience' in competitor ? competitor.representative_experience : undefined,
    service_support: 'service_support' in competitor ? competitor.service_support : undefined,
  }),
).filter((competitor) => !isLegacyCompetitorPlaceholder(competitor));

function validateUniqueCompetitors(competitors: CompetitorRecord[]): CompetitorRecord[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const competitor of competitors) {
    if (ids.has(competitor.id)) throw new Error('COMPETITOR_CONFIG_INVALID');
    const normalizedName = competitor.company_name.trim().toLocaleLowerCase('zh-CN');
    if (names.has(normalizedName)) throw new Error('COMPETITOR_DUPLICATE_NAME');
    ids.add(competitor.id);
    names.add(normalizedName);
  }
  return competitors;
}

export function parseCompetitorList(value: unknown): CompetitorRecord[] {
  const parsed = competitorListSchema.safeParse(value);
  if (!parsed.success) throw new Error('COMPETITOR_CONFIG_INVALID');
  return validateUniqueCompetitors(parsed.data);
}

export function applyCompetitorUpdate(existing: CompetitorRecord, input: CompetitorUpdate): CompetitorRecord {
  return competitorRecordSchema.parse({
    ...existing,
    id: input.id,
    project_id: input.project_id,
    company_name: input.company_name,
    features: input.features,
    more_info: input.more_info,
    industry: input.industry ?? existing.industry,
    solution_summary: input.solution_summary ?? existing.solution_summary,
    representative_experience: input.representative_experience ?? existing.representative_experience,
    service_support: input.service_support ?? existing.service_support,
  });
}

function normalizeStoredRow(row: Record<string, unknown>): StoredCompetitorConfig {
  const revision = row.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new Error('COMPETITOR_CONFIG_INVALID');
  }
  return {
    competitors: parseCompetitorList(row.competitors),
    revision,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    persisted: true,
  };
}

export async function loadProjectOneCompetitorConfig(): Promise<StoredCompetitorConfig> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('scenario_templates')
    .select('competitors, revision, updated_at, updated_by')
    .eq('code', PROJECT_ONE_SCENARIO_TEMPLATE_CODE)
    .maybeSingle();
  if (error) throw new Error(`COMPETITOR_CONFIG_READ_FAILED:${error.code || 'unknown'}`);
  if (!data) {
    return {
      competitors: structuredClone(DEFAULT_PROJECT_ONE_COMPETITORS),
      revision: 0,
      updatedAt: null,
      updatedBy: null,
      persisted: false,
    };
  }
  return normalizeStoredRow(data as Record<string, unknown>);
}

function toStoredConfig(data: Record<string, unknown>): StoredCompetitorConfig {
  return normalizeStoredRow(data);
}

async function updateStoredConfig(
  nextCompetitors: CompetitorRecord[],
  expectedRevision: number,
  userId: string,
): Promise<StoredCompetitorConfig> {
  const current = await loadProjectOneCompetitorConfig();
  if (!current.persisted) throw new Error('COMPETITOR_CONFIG_NOT_INITIALIZED');
  if (current.revision !== expectedRevision) throw new Error('COMPETITOR_CONFIG_VERSION_CONFLICT');

  const competitors = validateUniqueCompetitors(parseCompetitorList(nextCompetitors));
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('scenario_templates')
    .update({
      competitors,
      revision: expectedRevision + 1,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('code', PROJECT_ONE_SCENARIO_TEMPLATE_CODE)
    .eq('revision', expectedRevision)
    .select('competitors, revision, updated_at, updated_by')
    .maybeSingle();
  if (error) throw new Error(`COMPETITOR_CONFIG_WRITE_FAILED:${error.code || 'unknown'}`);
  if (!data) throw new Error('COMPETITOR_CONFIG_VERSION_CONFLICT');
  return toStoredConfig(data as Record<string, unknown>);
}

export async function createProjectOneCompetitor(
  input: CompetitorCreate,
  userId: string,
): Promise<{ item: CompetitorRecord; config: StoredCompetitorConfig }> {
  const current = await loadProjectOneCompetitorConfig();
  if (!current.persisted) throw new Error('COMPETITOR_CONFIG_NOT_INITIALIZED');
  if (current.revision !== input.expected_revision) throw new Error('COMPETITOR_CONFIG_VERSION_CONFLICT');
  const item = competitorRecordSchema.parse({
    id: randomUUID(),
    project_id: input.project_id,
    company_name: input.company_name,
    features: input.features,
    more_info: input.more_info,
    industry: input.industry,
    solution_summary: input.solution_summary,
    representative_experience: input.representative_experience,
    service_support: input.service_support,
  });
  const config = await updateStoredConfig([...current.competitors, item], input.expected_revision, userId);
  return { item, config };
}

export async function updateProjectOneCompetitor(
  input: CompetitorUpdate,
  userId: string,
): Promise<{ item: CompetitorRecord; config: StoredCompetitorConfig }> {
  const current = await loadProjectOneCompetitorConfig();
  if (!current.persisted) throw new Error('COMPETITOR_CONFIG_NOT_INITIALIZED');
  if (current.revision !== input.expected_revision) throw new Error('COMPETITOR_CONFIG_VERSION_CONFLICT');
  if (!current.competitors.some((competitor) => competitor.id === input.id)) throw new Error('COMPETITOR_NOT_FOUND');
  const existing = current.competitors.find((competitor) => competitor.id === input.id)!;
  const item = applyCompetitorUpdate(existing, input);
  const config = await updateStoredConfig(
    current.competitors.map((competitor) => competitor.id === input.id ? item : competitor),
    input.expected_revision,
    userId,
  );
  return { item, config };
}

export async function deleteProjectOneCompetitor(
  input: CompetitorDelete,
  userId: string,
): Promise<StoredCompetitorConfig> {
  const current = await loadProjectOneCompetitorConfig();
  if (!current.persisted) throw new Error('COMPETITOR_CONFIG_NOT_INITIALIZED');
  if (current.revision !== input.expected_revision) throw new Error('COMPETITOR_CONFIG_VERSION_CONFLICT');
  if (!current.competitors.some((competitor) => competitor.id === input.id)) throw new Error('COMPETITOR_NOT_FOUND');
  return updateStoredConfig(
    current.competitors.filter((competitor) => competitor.id !== input.id),
    input.expected_revision,
    userId,
  );
}

