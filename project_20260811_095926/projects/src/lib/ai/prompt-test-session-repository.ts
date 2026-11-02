import { createHash } from 'node:crypto';
import { createServerClient } from '@/storage/database/supabase-client';
import {
  promptTestMessageSchema,
  promptTestResponseSchema,
  promptTestRuntimeSchema,
  promptTestTurnRecordSchema,
  type PromptTestMessage,
  type PromptTestProvider,
  type PromptTestRequest,
  type PromptTestResponse,
  type PromptTestRuntime,
  type PromptTestTurnRecord,
} from '@/lib/contracts/prompt-test';

export type PromptTestPersistentState = {
  runtime: PromptTestRuntime;
  history: PromptTestMessage[];
  records: PromptTestTurnRecord[];
};

export type PromptTestCommandLease = {
  sessionId: string;
  version: number;
  state: PromptTestPersistentState;
  leaseToken: string;
};

export type PromptTestAcquireResult = PromptTestCommandLease | { replay: PromptTestResponse };

export interface PromptTestSessionPersistence {
  acquire(args: {
    userId: string;
    provider: PromptTestProvider;
    request: PromptTestRequest;
    initialState: PromptTestPersistentState;
  }): Promise<PromptTestAcquireResult>;
  renew(args: { userId: string; provider: PromptTestProvider; sessionId: string; commandId: string; leaseToken: string }): Promise<void>;
  commit(args: {
    userId: string;
    provider: PromptTestProvider;
    sessionId: string;
    commandId: string;
    expectedVersion: number;
    leaseToken: string;
    state: PromptTestPersistentState;
    response: PromptTestResponse;
  }): Promise<PromptTestResponse>;
  abandon(args: { userId: string; provider: PromptTestProvider; sessionId: string; commandId: string; leaseToken: string }): Promise<void>;
}

export class PromptTestRepositoryError extends Error {
  constructor(public readonly kind: 'not_found' | 'conflict' | 'unavailable', message: string) {
    super(message);
  }
}

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
 * A retry can legitimately gain its server-issued session id or see a newer
 * version. Neither changes the command itself; every other client field does.
 */
export function getPromptTestRequestHash(request: PromptTestRequest): string {
  const command = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'sessionId' && key !== 'expectedVersion'));
  return createHash('sha256').update(JSON.stringify(canonicalRequestValue(command))).digest('hex');
}

function repositoryError(error: unknown): PromptTestRepositoryError {
  const message = error instanceof Error ? error.message : String(error ?? 'PROMPT_TEST_PERSISTENCE_FAILED');
  if (/PROMPT_TEST_SESSION_NOT_FOUND|PROMPT_TEST_COMMAND_SESSION_MISMATCH|invalid input syntax/i.test(message)) {
    return new PromptTestRepositoryError('not_found', 'PROMPT_TEST_SESSION_NOT_FOUND');
  }
  if (/PROMPT_TEST_VERSION_CONFLICT|PROMPT_TEST_COMMAND_BUSY|PROMPT_TEST_COMMAND_LEASE_LOST|PROMPT_TEST_COMMAND_PAYLOAD_MISMATCH/i.test(message)) {
    return new PromptTestRepositoryError('conflict', /BUSY|LEASE_LOST/i.test(message) ? 'PROMPT_TEST_SESSION_BUSY' : 'PROMPT_TEST_VERSION_CONFLICT');
  }
  return new PromptTestRepositoryError('unavailable', 'PROMPT_TEST_PERSISTENCE_UNAVAILABLE');
}

function parseState(value: unknown): PromptTestPersistentState {
  if (!isRecord(value)) throw new PromptTestRepositoryError('unavailable', 'PROMPT_TEST_PERSISTENCE_INVALID_STATE');
  const runtime = promptTestRuntimeSchema.safeParse(value.runtime);
  const history = promptTestMessageSchema.array().max(40).safeParse(value.history);
  const records = promptTestTurnRecordSchema.array().max(100).safeParse(value.records);
  if (!runtime.success || !history.success || !records.success) {
    throw new PromptTestRepositoryError('unavailable', 'PROMPT_TEST_PERSISTENCE_INVALID_STATE');
  }
  return { runtime: runtime.data, history: history.data, records: records.data };
}

function parseResponse(value: unknown): PromptTestResponse {
  const result = promptTestResponseSchema.safeParse(value);
  if (!result.success) throw new PromptTestRepositoryError('unavailable', 'PROMPT_TEST_PERSISTENCE_INVALID_RESPONSE');
  return result.data;
}

/** Durable state for the two-provider prompt workbench, deliberately isolated from game saves. */
export class PromptTestSessionRepository implements PromptTestSessionPersistence {
  async acquire(args: {
    userId: string;
    provider: PromptTestProvider;
    request: PromptTestRequest;
    initialState: PromptTestPersistentState;
  }): Promise<PromptTestAcquireResult> {
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('acquire_prompt_test_command', {
        p_user_id: args.userId,
        p_provider: args.provider,
        p_session_id: args.request.sessionId ?? null,
        p_command_id: args.request.commandId,
        p_request_hash: getPromptTestRequestHash(args.request),
        p_expected_version: args.request.expectedVersion,
        p_initial_state: args.initialState,
      });
      if (error) throw error;
      if (!isRecord(data)) throw new Error('PROMPT_TEST_PERSISTENCE_INVALID_ACQUIRE');
      const envelope = data as AcquireEnvelope;
      if (envelope.kind === 'replay') return { replay: parseResponse(envelope.response) };
      if (envelope.kind !== 'lease'
        || typeof envelope.session_id !== 'string'
        || typeof envelope.version !== 'number'
        || typeof envelope.lease_token !== 'string') {
        throw new Error('PROMPT_TEST_PERSISTENCE_INVALID_ACQUIRE');
      }
      return {
        sessionId: envelope.session_id,
        version: envelope.version,
        state: parseState(envelope.state),
        leaseToken: envelope.lease_token,
      };
    } catch (error) {
      if (error instanceof PromptTestRepositoryError) throw error;
      throw repositoryError(error);
    }
  }

  async renew(args: { userId: string; provider: PromptTestProvider; sessionId: string; commandId: string; leaseToken: string }): Promise<void> {
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('renew_prompt_test_command_lease', {
        p_user_id: args.userId,
        p_provider: args.provider,
        p_session_id: args.sessionId,
        p_command_id: args.commandId,
        p_lease_token: args.leaseToken,
      });
      if (error) throw error;
      if (data !== true) throw new Error('PROMPT_TEST_COMMAND_LEASE_LOST');
    } catch (error) {
      if (error instanceof PromptTestRepositoryError) throw error;
      throw repositoryError(error);
    }
  }

  async commit(args: {
    userId: string;
    provider: PromptTestProvider;
    sessionId: string;
    commandId: string;
    expectedVersion: number;
    leaseToken: string;
    state: PromptTestPersistentState;
    response: PromptTestResponse;
  }): Promise<PromptTestResponse> {
    try {
      const supabase = createServerClient();
      const { data, error } = await supabase.rpc('commit_prompt_test_command', {
        p_user_id: args.userId,
        p_provider: args.provider,
        p_session_id: args.sessionId,
        p_command_id: args.commandId,
        p_expected_version: args.expectedVersion,
        p_lease_token: args.leaseToken,
        p_state: args.state,
        p_response: args.response,
      });
      if (error) throw error;
      return parseResponse(data);
    } catch (error) {
      if (error instanceof PromptTestRepositoryError) throw error;
      throw repositoryError(error);
    }
  }

  async abandon(args: { userId: string; provider: PromptTestProvider; sessionId: string; commandId: string; leaseToken: string }): Promise<void> {
    try {
      const supabase = createServerClient();
      const { error } = await supabase.rpc('abandon_prompt_test_command', {
        p_user_id: args.userId,
        p_provider: args.provider,
        p_session_id: args.sessionId,
        p_command_id: args.commandId,
        p_lease_token: args.leaseToken,
      });
      if (error) throw error;
    } catch (error) {
      if (error instanceof PromptTestRepositoryError) throw error;
      throw repositoryError(error);
    }
  }
}

export const promptTestSessionRepository = new PromptTestSessionRepository();
