import { createServerClient } from '@/storage/database/supabase-client';
import { parseCustomerActivityDecisionConfigWrite } from '@/lib/designer/customer-activity-decision-form';
import {
  DEFAULT_ACTIVITY_DECISION_CONFIG,
  parseActivityDecisionConfig,
  type ActivityDecisionConfig,
} from '@/lib/game/customer-activities';

export const CUSTOMER_ACTIVITY_DECISION_CONFIG_ID = 'customer-activities';

export interface StoredActivityDecisionConfig {
  config: ActivityDecisionConfig;
  updatedAt: string | null;
  updatedBy: string | null;
  persisted: boolean;
}

type DatabaseError = { code?: string };
type DatabaseRow = {
  config?: unknown;
  revision?: unknown;
  updated_at?: unknown;
  updated_by?: unknown;
} | null;
type QueryResult = { data: DatabaseRow; error: DatabaseError | null };

interface ConfigQuery {
  select(columns: string): ConfigQuery;
  eq(column: string, value: string | number): ConfigQuery;
  update(values: Record<string, unknown>): ConfigQuery;
  insert(values: Record<string, unknown>): ConfigQuery;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

interface ConfigDatabase {
  from(table: string): ConfigQuery;
}

type ConfigDatabaseFactory = () => ConfigDatabase;

function normalizedConfig(value: unknown, revision: number): ActivityDecisionConfig {
  const parsed = parseActivityDecisionConfig({
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    revision,
  });
  if (!parsed) throw new Error('CUSTOMER_ACTIVITY_CONFIG_INVALID');
  return parsed;
}

function storedRow(row: Exclude<DatabaseRow, null>): StoredActivityDecisionConfig {
  const revision = typeof row.revision === 'number' && Number.isInteger(row.revision) && row.revision >= 0
    ? row.revision
    : 0;
  return {
    config: normalizedConfig(row.config, revision),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    persisted: true,
  };
}

/** Database access is injectable so the row-version CAS and absent-row path can be tested without a live Supabase instance. */
export function createActivityDecisionConfigRepository(createClient: ConfigDatabaseFactory) {
  async function load(): Promise<StoredActivityDecisionConfig> {
    const { data, error } = await createClient()
      .from('designer_prompt_configs')
      .select('config, revision, updated_at, updated_by')
      .eq('id', CUSTOMER_ACTIVITY_DECISION_CONFIG_ID)
      .maybeSingle();
    if (error) throw new Error(`CUSTOMER_ACTIVITY_CONFIG_READ_FAILED:${error.code || 'unknown'}`);
    if (!data) {
      return {
        config: structuredClone(DEFAULT_ACTIVITY_DECISION_CONFIG),
        updatedAt: null,
        updatedBy: null,
        persisted: false,
      };
    }
    return storedRow(data);
  }

  async function save(
    requestedConfig: Pick<ActivityDecisionConfig, 'mode' | 'thresholds'>,
    expectedRevision: number,
    userId: string,
  ): Promise<StoredActivityDecisionConfig> {
    const writeConfig = parseCustomerActivityDecisionConfigWrite(requestedConfig);
    if (!writeConfig) throw new Error('CUSTOMER_ACTIVITY_CONFIG_INVALID');
    const revision = expectedRevision + 1;
    const config = normalizedConfig(writeConfig, revision);
    const values = {
      mode: config.mode,
      thresholds: config.thresholds,
    };
    const updatedAt = new Date().toISOString();
    const db = createClient();

    if (expectedRevision === 0) {
      const { data, error } = await db.from('designer_prompt_configs').insert({
        id: CUSTOMER_ACTIVITY_DECISION_CONFIG_ID,
        config: values,
        revision,
        updated_by: userId,
        updated_at: updatedAt,
      }).select('config, revision, updated_at, updated_by').single();
      if (error?.code === '23505') throw new Error('CUSTOMER_ACTIVITY_CONFIG_VERSION_CONFLICT');
      if (error) throw new Error(`CUSTOMER_ACTIVITY_CONFIG_WRITE_FAILED:${error.code || 'unknown'}`);
      if (!data) throw new Error('CUSTOMER_ACTIVITY_CONFIG_WRITE_FAILED:empty');
      return storedRow(data);
    }

    const { data, error } = await db.from('designer_prompt_configs').update({
      config: values,
      revision,
      updated_by: userId,
      updated_at: updatedAt,
    }).eq('id', CUSTOMER_ACTIVITY_DECISION_CONFIG_ID)
      .eq('revision', expectedRevision)
      .select('config, revision, updated_at, updated_by')
      .maybeSingle();
    if (error) throw new Error(`CUSTOMER_ACTIVITY_CONFIG_WRITE_FAILED:${error.code || 'unknown'}`);
    if (!data) throw new Error('CUSTOMER_ACTIVITY_CONFIG_VERSION_CONFLICT');
    return storedRow(data);
  }

  async function loadForMatching(): Promise<StoredActivityDecisionConfig> {
    const stored = await load();
    if (stored.config.mode === 'numeric'
      && !parseCustomerActivityDecisionConfigWrite({ mode: stored.config.mode, thresholds: stored.config.thresholds })) {
      throw new Error('CUSTOMER_ACTIVITY_CONFIG_REQUIRES_ORGANIZATION');
    }
    return stored;
  }

  return { load, loadForMatching, save };
}

const repository = createActivityDecisionConfigRepository(
  () => createServerClient() as unknown as ConfigDatabase,
);

/** Only a genuinely absent row gets the recommended defaults; database and parse failures propagate. */
export const loadActivityDecisionConfig = repository.load;
export const saveActivityDecisionConfig = repository.save;
/** Matching must fail closed on legacy numeric rules instead of applying single-person thresholds. */
export const loadActivityDecisionConfigForMatching = repository.loadForMatching;
