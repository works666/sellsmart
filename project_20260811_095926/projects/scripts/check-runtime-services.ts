import { createServerClient } from '../src/storage/database/supabase-client';

const MAX_ATTEMPTS = 4;
const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

type QueryError = {
  code?: string;
  message?: string;
  details?: string;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'SUPABASE_CONNECT_TIMEOUT';
  }

  const queryError = error as QueryError | null;
  const explicitCode = queryError?.code?.trim();
  if (explicitCode) return explicitCode;

  const description = `${queryError?.message ?? ''} ${queryError?.details ?? ''}`;
  if (/abort|timeout/i.test(description)) return 'SUPABASE_CONNECT_TIMEOUT';
  if (/fetch failed|econn|enotfound|eai_again|network|socket|tls/i.test(description)) {
    return 'SUPABASE_NETWORK_ERROR';
  }

  return error instanceof Error ? 'SUPABASE_CONNECT_FAILED' : 'SUPABASE_QUERY_FAILED';
}

function isRetryable(error: unknown): boolean {
  const queryError = error as QueryError | null;
  const code = queryError?.code?.trim() ?? '';

  // PostgREST/database errors are deterministic. Retrying them only delays a
  // useful failure such as a missing table, invalid key, or denied access.
  if (/^(PGRST|22|23|28|42)/.test(code)) return false;

  return true;
}

async function main() {
  let lastError: unknown;
  let didRetry = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const supabase = createServerClient();
      const { error } = await supabase
        .from('health_check')
        .select('id')
        .limit(1)
        .abortSignal(controller.signal);

      if (!error) {
        console.log(attempt === 1
          ? 'Database connectivity check passed.'
          : `Database connectivity check passed after ${attempt} attempts.`);
        return;
      }

      lastError = error;
      if (!isRetryable(error)) break;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!;
      didRetry = true;
      console.warn(
        `Database is temporarily unavailable (${describeError(lastError)}); `
        + `retrying in ${delay / 1_000}s (${attempt}/${MAX_ATTEMPTS})...`,
      );
      await wait(delay);
    }
  }

  console.error(`Database connectivity check failed (${describeError(lastError)}).`);
  console.error(didRetry
    ? 'Transient failures were retried. Check the network connection and SUPABASE_* values in projects\\.env.local.'
    : 'Check the database schema and SUPABASE_* values in projects\\.env.local.');
  process.exitCode = 1;
}

void main();
