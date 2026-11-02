import { z } from 'zod';
import { previewNpcIdSchema, type PreviewNpcId } from '@/lib/contracts/project-one-preview-ai';
import type { ChatMessage, InvokeOptions } from '@/lib/ai/client';

const evaluationTextSchema = z.string().trim().min(1).max(2_000);

export const systemEvaluationSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fresh'),
    support: z.number().int().min(0).max(100),
    pleasantness: z.number().int().min(0).max(100),
    effectiveContactCount: z.number().int().min(0).max(100),
  }).strict(),
  z.object({
    kind: z.literal('snapshot'),
    previewSessionId: z.string().uuid('previewSessionId 格式无效'),
  }).strict(),
]);

export const systemEvaluationRequestSchema = z.object({
  source: systemEvaluationSourceSchema,
  npcId: previewNpcIdSchema,
  channel: z.enum(['visit', 'email']),
  salesTurns: z.array(evaluationTextSchema).min(1).max(3),
  expectation: evaluationTextSchema,
  threshold: z.number().min(0).max(1).default(0.7),
}).strict();

export type SystemEvaluationRequest = z.infer<typeof systemEvaluationRequestSchema>;
export type SystemEvaluationSource = z.infer<typeof systemEvaluationSourceSchema>;

/** State deliberately keeps the production relationship context inspectable in the downloaded report. */
export type SystemEvaluationNpcState = {
  support: number;
  pleasantness: number;
  effectiveContactCount: number;
  node: string;
  activeBlockers: unknown;
  dimensionScores: unknown;
  workingMemory: unknown;
  history: unknown;
  activeMeeting: unknown;
};

export type SystemEvaluationGenerationRequest = {
  messages: ChatMessage[];
  options?: InvokeOptions;
  /** Exact raw result returned by the shared AI client; empty only when the request itself failed. */
  rawResponse: string;
  error?: string;
};

/** Shared structural contract for the DeepEval judge and designer UI. */
export type SystemEvalRound = {
  round: number;
  salesMessage: string;
  npcResponse: string | null;
  responseAction?: 'reply' | 'read_no_reply';
  beforeState: SystemEvaluationNpcState;
  afterState: SystemEvaluationNpcState;
  generationRequests: SystemEvaluationGenerationRequest[];
  error?: string;
};

export type SystemEvaluationJudge = {
  engine: 'deepeval';
  metrics: Array<{
    key: string;
    name: string;
    score: number | null;
    reason: string;
    passed: boolean;
    error?: string;
  }>;
  passed: boolean;
  total100: number | null;
};

export type SystemEvaluationReport = {
  runId: string;
  createdAt: string;
  pipeline: 'project-one-preview';
  source: SystemEvaluationSource;
  /** Persisted snapshot version that was read; fresh runs have no source version. */
  sourceVersion: number | null;
  npc: { id: PreviewNpcId; name: string; role: string };
  channel: 'visit' | 'email';
  expectation: string;
  threshold: number;
  phase: 'completed' | 'partial' | 'error';
  initialState: SystemEvaluationNpcState;
  finalState: SystemEvaluationNpcState;
  history: unknown;
  rounds: SystemEvalRound[];
  termination?: {
    reason: string;
    completedTurns: number;
    plannedTurns: number;
    skippedTurns: number;
  };
  judge: SystemEvaluationJudge | null;
  requestCounts: {
    previewLlm: number;
    judge: number;
    decision: { provider: 'jev' | 'llm' | 'injected'; requests: number };
  };
  configRevisions: {
    prompt: { revision: number; persisted: boolean };
    activity: { revision: number; persisted: boolean };
    provider: { revision: number; provider: string; configuredModel: string | null; persisted: boolean };
    decision: { revision: number | null; persisted: boolean | null; provider: 'jev' | 'llm' | 'injected' };
  };
  boundaries: string[];
  error?: { code: string; message: string };
};

export type SystemEvaluationSnapshotMetadata = {
  previewSessionId: string;
  version: number;
  updatedAt: string | null;
};
