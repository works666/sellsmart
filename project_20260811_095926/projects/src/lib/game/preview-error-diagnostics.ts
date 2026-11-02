export type PreviewErrorDiagnosticContext = {
  action?: unknown;
  npcId?: unknown;
  commandId?: unknown;
};

type PreviewErrorKind = 'protocol' | 'unavailable' | 'conflict' | 'not_found' | 'limit';

const ERROR_KINDS = new Set<PreviewErrorKind>(['protocol', 'unavailable', 'conflict', 'not_found', 'limit']);

const SAFE_ERROR_CODES_BY_KIND: Record<PreviewErrorKind, Set<string>> = {
  protocol: new Set([
    'APPOINTMENT_NOT_FOUND',
    'VISIT_PREPARATION_REQUIRED',
    'NO_ACTIVE_VISIT_FOR_NPC',
    'FINAL_PLAYER_REPLY_REQUIRED',
    'UNSUPPORTED_PREVIEW_ACTION',
  ]),
  unavailable: new Set([
    'AI_BASE_URL_NOT_SET',
    'AI_API_KEY_NOT_SET',
    'AI_MODEL_NOT_SET',
    'PREVIEW_PERSISTENCE_UNAVAILABLE',
    'PREVIEW_PERSISTENCE_INVALID_RESPONSE',
  ]),
  conflict: new Set([
    'PREVIEW_SESSION_VERSION_CONFLICT',
    'PREVIEW_SESSION_BUSY',
    'APPOINTMENT_ACTIVE_VISIT',
    'VISIT_ALREADY_ACTIVE',
    'CUSTOMER_ACTIVITY_NOT_NEXT',
    'CUSTOMER_ACTIVITY_NOT_EDITABLE',
    'CUSTOMER_ACTIVITY_CALL_MISMATCH',
  ]),
  not_found: new Set(['PREVIEW_SESSION_NOT_FOUND', 'CUSTOMER_ACTIVITY_NOT_FOUND']),
  limit: new Set([
    'PREVIEW_USER_SESSION_LIMIT',
    'PREVIEW_AI_CONCURRENCY_LIMIT',
    'CUSTOMER_ACTIVITY_DETECTION_QUEUE_FULL',
  ]),
};

function previewErrorKind(error: unknown): PreviewErrorKind | null {
  if (!(error instanceof Error)) return null;
  const kind = (error as Error & { kind?: unknown }).kind;
  return typeof kind === 'string' && ERROR_KINDS.has(kind as PreviewErrorKind)
    ? kind as PreviewErrorKind
    : null;
}

function safeErrorCode(error: Error, kind: PreviewErrorKind): string {
  const message = error.message;
  if (kind === 'protocol' && message.startsWith('AI_PROTOCOL_INVALID:')) return 'AI_PROTOCOL_INVALID';
  if (SAFE_ERROR_CODES_BY_KIND[kind].has(message)) return message;

  if (kind === 'unavailable') {
    if (message === 'AI_PROVIDER_NETWORK_ERROR') return 'AI_PROVIDER_NETWORK_ERROR';
    if (message === 'AI_PROVIDER_TIMEOUT') return 'AI_PROVIDER_TIMEOUT';
    if (message === 'AI_PROVIDER_EMPTY_RESPONSE') return 'AI_PROVIDER_EMPTY_RESPONSE';
    if (message === 'AI_PROVIDER_STREAM_PROTOCOL') return 'AI_PROVIDER_STREAM_PROTOCOL';
    if (message === 'AI_PROVIDER_STREAM_UNAVAILABLE') return 'AI_PROVIDER_STREAM_UNAVAILABLE';
    if (/^AI_PROVIDER_HTTP_\d{3}$/.test(message)) return 'AI_PROVIDER_HTTP_ERROR';
    if (/^AI_PROVIDER_[A-Z0-9_]+$/.test(message)) return 'AI_PROVIDER_UNAVAILABLE';
    if (/AI_REQUEST|fetch|timeout/i.test(message)) return 'AI_TRANSPORT_UNAVAILABLE';
    return 'PREVIEW_SERVICE_UNAVAILABLE';
  }

  if (kind === 'protocol') return 'PREVIEW_PROTOCOL_ERROR';
  if (kind === 'conflict') return 'PREVIEW_CONFLICT';
  if (kind === 'not_found') return 'PREVIEW_NOT_FOUND';
  return 'PREVIEW_LIMIT_REACHED';
}

function safeContext(context: PreviewErrorDiagnosticContext) {
  const action = typeof context.action === 'string' && /^[a-z_]{1,64}$/.test(context.action)
    ? context.action
    : undefined;
  const npcId = typeof context.npcId === 'string' && /^P1-00[1-5]$/.test(context.npcId)
    ? context.npcId
    : undefined;
  const commandId = typeof context.commandId === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(context.commandId)
    ? context.commandId
    : undefined;
  return {
    ...(action ? { action } : {}),
    ...(npcId ? { npcId } : {}),
    ...(commandId ? { commandId } : {}),
  };
}

/** Returns only fixed, non-sensitive identifiers suitable for server logs. */
export function previewErrorDiagnosticFields(error: unknown, context: PreviewErrorDiagnosticContext = {}) {
  const fields = safeContext(context);
  const kind = previewErrorKind(error);
  if (!kind) return { code: 'PREVIEW_UNEXPECTED_ERROR', ...fields };
  return {
    code: safeErrorCode(error as Error, kind),
    kind,
    ...fields,
  };
}
