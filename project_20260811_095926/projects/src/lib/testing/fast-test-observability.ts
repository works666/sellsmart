import { AsyncLocalStorage } from 'node:async_hooks';
import { FAST_ACCEPTANCE_ACCOUNT, isFastAcceptanceUser } from '@/lib/game/acceptance-mode';

/**
 * Fast acceptance is intentionally an opt-in diagnostic mode.  The traces
 * live only in this Node process and are never attached to normal API output.
 */
export const FAST_TEST_USER_ID = `u_${FAST_ACCEPTANCE_ACCOUNT.username}`;
const TRACE_CAPACITY = 80;
const MESSAGE_LIMIT = 24;
const TEXT_LIMIT = 6_000;
const RAW_RESPONSE_LIMIT = 16_000;

export type FastAiTrace = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'pending' | 'success' | 'error';
  stream: boolean;
  providerUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  options: Record<string, unknown>;
  rawResponse?: unknown;
  error?: string;
};

type FastTestContext = { userId: string; traces: FastAiTrace[] };

const asyncContext = new AsyncLocalStorage<FastTestContext>();
const runtime = globalThis as typeof globalThis & { __weixunFastTestTraces?: Map<string, FastAiTrace[]> };
const traceStore = runtime.__weixunFastTestTraces ?? (runtime.__weixunFastTestTraces = new Map());

export function isFastTestUser(userId: string): boolean {
  return isFastAcceptanceUser(userId);
}

/** Production is deny-by-default even for the publicly documented fast account. */
export function isFastDebugEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_FAST_DEBUG === 'true';
}

export function runWithFastTestObservability<T>(userId: string, work: () => T): T {
  if (!isFastDebugEnabled() || !isFastTestUser(userId)) return work();
  return asyncContext.run({ userId, traces: tracesFor(userId) }, work);
}

export function currentFastTestUserId(): string | null {
  return asyncContext.getStore()?.userId ?? null;
}

function tracesFor(userId: string): FastAiTrace[] {
  const existing = traceStore.get(userId);
  if (existing) return existing;
  const created: FastAiTrace[] = [];
  traceStore.set(userId, created);
  return created;
}

function limitText(value: string, limit = TEXT_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit)}\n…[truncated]` : value;
}

function redactText(value: string, limit = TEXT_LIMIT): string {
  return limitText(value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"'}]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|AIza)[_-][A-Za-z0-9_-]{10,}\b/g, '[REDACTED_API_KEY]'), limit);
}

export function redactFastTestValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redactFastTestValue(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [
    key,
    /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|(?:^|[_-])token$|secret|password|cookie)/i.test(key)
      ? '[REDACTED]'
      : redactFastTestValue(item, depth + 1),
  ]));
}

export function beginFastAiTrace(input: {
  providerUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  stream: boolean;
}): FastAiTrace | null {
  const context = asyncContext.getStore();
  if (!context) return null;
  const trace: FastAiTrace = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    status: 'pending',
    stream: input.stream,
    providerUrl: redactText(input.providerUrl, 500),
    model: redactText(input.model, 200),
    messages: input.messages.slice(-MESSAGE_LIMIT).map((message) => ({ role: message.role, content: redactText(message.content) })),
    options: redactFastTestValue(input.options ?? {}) as Record<string, unknown>,
  };
  context.traces.push(trace);
  if (context.traces.length > TRACE_CAPACITY) context.traces.splice(0, context.traces.length - TRACE_CAPACITY);
  return trace;
}

export function finishFastAiTrace(trace: FastAiTrace | null, result: { rawResponse?: unknown; error?: unknown }): void {
  if (!trace) return;
  trace.finishedAt = new Date().toISOString();
  trace.durationMs = Math.max(0, Date.parse(trace.finishedAt) - Date.parse(trace.startedAt));
  if (result.error !== undefined) {
    trace.status = 'error';
    trace.error = redactText(result.error instanceof Error ? result.error.message : String(result.error), 1_000);
    return;
  }
  trace.status = 'success';
  if (result.rawResponse !== undefined) trace.rawResponse = redactFastTestValue(result.rawResponse);
}

export function getFastAiTraces(userId: string, limit = 40): FastAiTrace[] {
  if (!isFastDebugEnabled() || !isFastTestUser(userId)) return [];
  return tracesFor(userId).slice(-Math.max(1, Math.min(limit, TRACE_CAPACITY))).reverse().map((trace) => redactFastTestValue(trace) as FastAiTrace);
}

export function truncateRawProviderText(value: string): string {
  return redactText(value, RAW_RESPONSE_LIMIT);
}

/** Test-only reset; not exported from an HTTP endpoint. */
export function __resetFastTestObservabilityForTests(): void {
  traceStore.clear();
}
