import { createServerClient } from '@/storage/database/supabase-client';
import {
  DEFAULT_PROJECT_ONE_PROMPT_CONFIG,
  normalizeProjectOnePromptConfig,
  type ProjectOnePromptConfig,
} from '@/lib/designer/prompt-config';

export const PROJECT_ONE_PROMPT_CONFIG_ID = 'project-one';

export interface StoredProjectOnePromptConfig {
  config: ProjectOnePromptConfig;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  persisted: boolean;
}

export async function loadProjectOnePromptConfig(): Promise<StoredProjectOnePromptConfig> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('designer_prompt_configs')
    .select('config, revision, updated_at, updated_by')
    .eq('id', PROJECT_ONE_PROMPT_CONFIG_ID)
    .maybeSingle();
  if (error) throw new Error(`PROMPT_CONFIG_READ_FAILED:${error.code || 'unknown'}`);
  if (!data) {
    return {
      config: structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG),
      revision: 0,
      updatedAt: null,
      updatedBy: null,
      persisted: false,
    };
  }
  return {
    config: normalizeProjectOnePromptConfig(data.config),
    revision: typeof data.revision === 'number' ? data.revision : 0,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
    updatedBy: typeof data.updated_by === 'string' ? data.updated_by : null,
    persisted: true,
  };
}

export async function saveProjectOnePromptConfig(
  config: ProjectOnePromptConfig,
  expectedRevision: number,
  userId: string,
): Promise<StoredProjectOnePromptConfig> {
  const supabase = createServerClient();
  const current = await loadProjectOnePromptConfig();
  if (current.revision !== expectedRevision) throw new Error('PROMPT_CONFIG_VERSION_CONFLICT');
  const revision = current.revision + 1;
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('designer_prompt_configs')
    .upsert({
      id: PROJECT_ONE_PROMPT_CONFIG_ID,
      config,
      revision,
      updated_by: userId,
      updated_at: updatedAt,
    }, { onConflict: 'id' })
    .select('config, revision, updated_at, updated_by')
    .single();
  if (error) throw new Error(`PROMPT_CONFIG_WRITE_FAILED:${error.code || 'unknown'}`);
  return {
    config: normalizeProjectOnePromptConfig(data.config),
    revision: data.revision,
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
    persisted: true,
  };
}
