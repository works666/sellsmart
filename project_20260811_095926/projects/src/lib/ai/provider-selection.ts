import { z } from 'zod';
import { createServerClient } from '@/storage/database/supabase-client';

/**
 * `default` deliberately remains selectable. It routes to the legacy AI_*
 * variables and lets an administrator undo a named-provider selection.
 */
export const AI_PROVIDER_SELECTION_ID = 'global-ai-provider';

export const aiProviderSelectionSchema = z.object({
  provider: z.enum(['default', 'deepseek', 'doubao', 'qwen']),
}).strict();

export type SelectedAiProvider = z.infer<typeof aiProviderSelectionSchema>['provider'];

export interface AiProviderSelection {
  provider: SelectedAiProvider;
}

export interface StoredAiProviderSelection {
  config: AiProviderSelection;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  persisted: boolean;
}

export interface AiProviderAvailability {
  configured: boolean;
  model: string | null;
}

export type AiProviderAvailabilityMap = Record<SelectedAiProvider, AiProviderAvailability>;

const PROVIDER_ENV: Record<SelectedAiProvider, { baseUrl: string; apiKey: string; model: string }> = {
  default: { baseUrl: 'AI_BASE_URL', apiKey: 'AI_API_KEY', model: 'AI_MODEL' },
  deepseek: { baseUrl: 'DEEPSEEK_AI_BASE_URL', apiKey: 'DEEPSEEK_AI_API_KEY', model: 'DEEPSEEK_AI_MODEL' },
  doubao: { baseUrl: 'DOUBAO_AI_BASE_URL', apiKey: 'DOUBAO_AI_API_KEY', model: 'DOUBAO_AI_MODEL' },
  qwen: { baseUrl: 'QWEN_AI_BASE_URL', apiKey: 'QWEN_AI_API_KEY', model: 'QWEN_AI_MODEL' },
};

const DEFAULT_AI_PROVIDER_SELECTION: AiProviderSelection = { provider: 'default' };

export function parseAiProviderSelection(value: unknown): AiProviderSelection | null {
  const parsed = aiProviderSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A pure accessor used by the AI client when no per-call provider is given. */
export function selectedAiProvider(selection: AiProviderSelection): SelectedAiProvider {
  return selection.provider;
}

/**
 * This intentionally exposes no URL or credential. The designer UI uses it
 * only to decide which choices can safely be selected and to show model names.
 */
export function getAiProviderAvailability(): AiProviderAvailabilityMap {
  return Object.fromEntries(
    Object.entries(PROVIDER_ENV).map(([provider, env]) => {
      const baseUrl = process.env[env.baseUrl]?.trim();
      const apiKey = process.env[env.apiKey]?.trim();
      const model = process.env[env.model]?.trim();
      let validUrl = false;
      try {
        const parsedUrl = new URL(baseUrl || '');
        validUrl = (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:')
          && Boolean(parsedUrl.hostname)
          && !/[{}]|%7[bd]/i.test(baseUrl || '');
      } catch { /* An example placeholder or malformed URL is not configured. */ }
      return [provider, { configured: Boolean(validUrl && apiKey && model), model: model || null }];
    }),
  ) as AiProviderAvailabilityMap;
}

export async function loadAiProviderSelection(): Promise<StoredAiProviderSelection> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('designer_prompt_configs')
    .select('config, revision, updated_at, updated_by')
    .eq('id', AI_PROVIDER_SELECTION_ID)
    .maybeSingle();
  if (error) throw new Error(`AI_PROVIDER_SELECTION_READ_FAILED:${error.code || 'unknown'}`);
  if (!data) {
    return {
      config: { ...DEFAULT_AI_PROVIDER_SELECTION },
      revision: 0,
      updatedAt: null,
      updatedBy: null,
      persisted: false,
    };
  }
  const config = parseAiProviderSelection(data.config);
  if (!config) throw new Error('AI_PROVIDER_SELECTION_INVALID');
  return {
    config,
    revision: typeof data.revision === 'number' ? data.revision : 0,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
    updatedBy: typeof data.updated_by === 'string' ? data.updated_by : null,
    persisted: true,
  };
}

/**
 * Save through the same insert/update CAS pattern as the other designer
 * configs. A missing row uses the legacy AI_* selection until it is saved.
 */
export async function saveAiProviderSelection(
  config: AiProviderSelection,
  expectedRevision: number,
  userId: string,
): Promise<StoredAiProviderSelection> {
  const current = await loadAiProviderSelection();
  if (current.revision !== expectedRevision) throw new Error('AI_PROVIDER_SELECTION_VERSION_CONFLICT');

  const supabase = createServerClient();
  const revision = expectedRevision + 1;
  const updatedAt = new Date().toISOString();
  if (!current.persisted) {
    const { data, error } = await supabase.from('designer_prompt_configs').insert({
      id: AI_PROVIDER_SELECTION_ID,
      config,
      revision,
      updated_by: userId,
      updated_at: updatedAt,
    }).select('config, revision, updated_at, updated_by').maybeSingle();
    if (error || !data) {
      if (error?.code === '23505') throw new Error('AI_PROVIDER_SELECTION_VERSION_CONFLICT');
      throw new Error(`AI_PROVIDER_SELECTION_WRITE_FAILED:${error?.code || 'unknown'}`);
    }
    const savedConfig = parseAiProviderSelection(data.config);
    if (!savedConfig) throw new Error('AI_PROVIDER_SELECTION_INVALID');
    return {
      config: savedConfig,
      revision: data.revision,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
      persisted: true,
    };
  }

  const { data, error } = await supabase.from('designer_prompt_configs')
    .update({ config, revision, updated_by: userId, updated_at: updatedAt })
    .eq('id', AI_PROVIDER_SELECTION_ID)
    .eq('revision', expectedRevision)
    .select('config, revision, updated_at, updated_by')
    .maybeSingle();
  if (error) throw new Error(`AI_PROVIDER_SELECTION_WRITE_FAILED:${error.code || 'unknown'}`);
  if (!data) throw new Error('AI_PROVIDER_SELECTION_VERSION_CONFLICT');
  const savedConfig = parseAiProviderSelection(data.config);
  if (!savedConfig) throw new Error('AI_PROVIDER_SELECTION_INVALID');
  return {
    config: savedConfig,
    revision: data.revision,
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
    persisted: true,
  };
}
