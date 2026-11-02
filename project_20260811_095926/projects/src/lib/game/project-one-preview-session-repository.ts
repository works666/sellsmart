import { createHash, randomUUID } from 'node:crypto';
import { createServerClient } from '@/storage/database/supabase-client';
import type { PreviewAiRequest, PreviewAiResponse } from '@/lib/contracts/project-one-preview-ai';
import {
  createPreviewServerState,
  fromPersistedPreviewServerState,
  PreviewAiError,
  toPersistedPreviewServerState,
  type PreviewPersistentCommandLease,
  type PreviewServerState,
  type PreviewSessionPersistence,
} from '@/lib/game/project-one-preview-ai';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AcquireEnvelope = {
  kind?: unknown;
  session_id?: unknown;
  version?: unknown;
  state?: unknown;
  lease_token?: unknown;
  response?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRequestValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalRequestValue(value[key])])) as Record<string, unknown>;
}

/**
 * Retries may gain a server-issued session id or observe a newer version. Those
 * are transport/concurrency fields, not command content; every other field is
 * hashed in a stable key order so a reused commandId cannot change its action.
 */
export function getPreviewRequestHash(request: PreviewAiRequest): string {
  const command: Record<string, unknown> = { ...request };
  delete command.previewSessionId;
  delete command.expectedVersion;
  return createHash('sha256').update(JSON.stringify(canonicalRequestValue(command))).digest('hex');
}

export function toPreviewPersistenceError(error: unknown): PreviewAiError {
  // Supabase/PostgREST returns RPC failures as a plain { code, message, details,
  // hint } object unless throwOnError() is enabled. Reading only its message
  // preserves the SQL error token without exposing database details to callers.
  const message = isRecord(error) && typeof error.message === 'string'
    ? error.message
    : error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'PREVIEW_PERSISTENCE_FAILED';
  if (message === 'PREVIEW_SESSION_NOT_FOUND'
    || message === 'PREVIEW_COMMAND_SESSION_MISMATCH'
    || /^invalid input syntax for type uuid(?:: .*)?$/i.test(message)) {
    return new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND');
  }
  if (message === 'PREVIEW_SESSION_VERSION_CONFLICT'
    || message === 'PREVIEW_COMMAND_BUSY'
    || message === 'PREVIEW_COMMAND_LEASE_LOST') {
    return new PreviewAiError(
      'conflict',
      message === 'PREVIEW_SESSION_VERSION_CONFLICT' ? 'PREVIEW_SESSION_VERSION_CONFLICT' : 'PREVIEW_SESSION_BUSY',
    );
  }
  return new PreviewAiError('unavailable', 'PREVIEW_PERSISTENCE_UNAVAILABLE');
}

function parseResponse(value: unknown): PreviewAiResponse {
  if (!isRecord(value)) throw new PreviewAiError('unavailable', 'PREVIEW_PERSISTENCE_INVALID_RESPONSE');
  // The service parses this again at its public boundary; retaining the cast
  // here avoids a repository dependency on the Zod response schema.
  return value as unknown as PreviewAiResponse;
}

/**
 * Durable backing for the five-person preview. The state is intentionally
 * separate from old `/game` tables; this prevents a partial five-person rollout
 * from mutating the still-supported four-person save format.
 */
export class PreviewSessionRepository implements PreviewSessionPersistence {
  async acquire(userId: string, request: PreviewAiRequest): Promise<PreviewPersistentCommandLease> {
    if (request.previewSessionId && !UUID_PATTERN.test(request.previewSessionId)) {
      throw new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND');
    }
    const initialSessionId = request.previewSessionId ?? randomUUID();
    const initialState = createPreviewServerState(userId, initialSessionId);
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('acquire_project_one_preview_command', {
        p_user_id: userId,
        p_preview_session_id: request.previewSessionId ?? null,
        p_command_id: request.commandId,
        p_request_hash: getPreviewRequestHash(request),
        p_expected_version: request.expectedVersion,
        p_initial_state: toPersistedPreviewServerState(initialState),
      });
      if (error) throw error;
      if (!isRecord(data)) throw new Error('PREVIEW_PERSISTENCE_INVALID_ACQUIRE');
      const envelope = data as AcquireEnvelope;
      if (envelope.kind === 'replay') return { replay: parseResponse(envelope.response) };
      if (envelope.kind !== 'lease'
        || typeof envelope.session_id !== 'string'
        || typeof envelope.version !== 'number'
        || typeof envelope.lease_token !== 'string') {
        throw new Error('PREVIEW_PERSISTENCE_INVALID_ACQUIRE');
      }
      return {
        previewSessionId: envelope.session_id,
        version: envelope.version,
        state: fromPersistedPreviewServerState(envelope.state, userId, envelope.session_id, envelope.version),
        leaseToken: envelope.lease_token,
      };
    } catch (error) {
      if (error instanceof PreviewAiError) throw error;
      throw toPreviewPersistenceError(error);
    }
  }

  async renew(args: { userId: string; previewSessionId: string; commandId: string; leaseToken: string }): Promise<void> {
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('renew_project_one_preview_command_lease', {
        p_user_id: args.userId,
        p_preview_session_id: args.previewSessionId,
        p_command_id: args.commandId,
        p_lease_token: args.leaseToken,
      });
      if (error) throw error;
      if (data !== true) throw new Error('PREVIEW_COMMAND_LEASE_LOST');
    } catch (error) {
      if (error instanceof PreviewAiError) throw error;
      throw toPreviewPersistenceError(error);
    }
  }

  async commit(args: {
    userId: string;
    previewSessionId: string;
    commandId: string;
    expectedVersion: number;
    leaseToken: string;
    state: PreviewServerState;
    response: PreviewAiResponse;
  }): Promise<PreviewAiResponse> {
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('commit_project_one_preview_command', {
        p_user_id: args.userId,
        p_preview_session_id: args.previewSessionId,
        p_command_id: args.commandId,
        p_expected_version: args.expectedVersion,
        p_lease_token: args.leaseToken,
        p_state: toPersistedPreviewServerState(args.state),
        p_response: args.response,
      });
      if (error) throw error;
      return parseResponse(data);
    } catch (error) {
      if (error instanceof PreviewAiError) throw error;
      throw toPreviewPersistenceError(error);
    }
  }

  async abandon(args: { userId: string; previewSessionId: string; commandId: string; leaseToken: string }): Promise<void> {
    try {
      const supabase = createServerClient();
      const { error } = await supabase.rpc('abandon_project_one_preview_command', {
        p_user_id: args.userId,
        p_preview_session_id: args.previewSessionId,
        p_command_id: args.commandId,
        p_lease_token: args.leaseToken,
      });
      if (error) throw error;
    } catch (error) {
      if (error instanceof PreviewAiError) throw error;
      throw toPreviewPersistenceError(error);
    }
  }

  async load(userId: string, previewSessionId: string): Promise<PreviewServerState> {
    if (!UUID_PATTERN.test(previewSessionId)) throw new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND');
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from('project_one_preview_sessions')
        .select('id,user_id,state,version')
        .eq('id', previewSessionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND');
      return fromPersistedPreviewServerState(data.state, userId, String(data.id), Number(data.version));
    } catch (error) {
      if (error instanceof PreviewAiError) throw error;
      throw toPreviewPersistenceError(error);
    }
  }
}

export const previewSessionRepository = new PreviewSessionRepository();
