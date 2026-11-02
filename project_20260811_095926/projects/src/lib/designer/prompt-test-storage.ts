import {
  DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG,
  promptTestNpcPromptConfigSchema,
  type PromptTestNpcPromptConfig,
} from '@/lib/contracts/prompt-test';

export const PROMPT_TEST_LEGACY_STORAGE_KEY = 'weixun:prompt-test:zhang-jianguo:in-person:v2';

const PROMPT_TEST_STORAGE_VERSION = 'v3';
const PROMPT_TEST_NPC_PROMPT_DRAFT_VERSION = 'v1';

export type PromptTestAction = 'run' | 'reset' | 'end_visit';

export type PromptTestRetryAttempt = {
  action: PromptTestAction;
  commandId: string;
  expectedVersion: number;
  sessionId?: string;
  playerText?: string;
};

/**
 * The prompt test snapshot is browser convenience state, not an auth boundary.
 * Keep the authenticated user and scenario/version in the key so a browser
 * switching accounts cannot accidentally render another user's snapshot.
 */
export function getPromptTestStorageKey(userId: string | null | undefined): string | null {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return null;
  return `weixun:prompt-test:${PROMPT_TEST_STORAGE_VERSION}:${encodeURIComponent(normalizedUserId)}:zhang-jianguo:in-person`;
}

/** A per-designer local draft; it deliberately never becomes shared scenario state. */
export function getPromptTestNpcPromptDraftStorageKey(userId: string | null | undefined): string | null {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return null;
  return `weixun:prompt-test:${PROMPT_TEST_NPC_PROMPT_DRAFT_VERSION}:${encodeURIComponent(normalizedUserId)}:zhang-jianguo:in-person:npc-prompt-draft`;
}

/** Invalid or stale local values must never be submitted as a prompt override. */
export function parsePromptTestNpcPromptDraft(raw: unknown): PromptTestNpcPromptConfig {
  const parsed = promptTestNpcPromptConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG };
}

export function getPromptTestUserId(rawIdentity: string | null | undefined): string | null {
  if (!rawIdentity) return null;
  try {
    const parsed: unknown = JSON.parse(rawIdentity);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const userId = (parsed as { userId?: unknown }).userId;
    return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  } catch {
    return null;
  }
}

export function clearLegacyPromptTestSnapshot(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(PROMPT_TEST_LEGACY_STORAGE_KEY);
}

export function shouldClearPromptTestInput(
  results: readonly boolean[],
  submittedText: string,
  currentText: string,
): boolean {
  return results.length > 0 && results.every(Boolean) && submittedText.trim() === currentText.trim();
}

export function reusePromptTestAttempt(
  attempt: PromptTestRetryAttempt | undefined,
  action: PromptTestAction,
): PromptTestRetryAttempt | undefined {
  return attempt?.action === action ? attempt : undefined;
}

export function getPromptTestRetryText(
  attempt: PromptTestRetryAttempt | undefined,
  currentText: string,
): string {
  return attempt?.action === 'run' && attempt.playerText?.trim()
    ? attempt.playerText
    : currentText.trim();
}
