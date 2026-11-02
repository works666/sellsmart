/**
 * Small server-side client for TypeSafe's Jev/System One API.
 *
 * Jev makes typed decisions; it is intentionally separate from the
 * OpenAI-compatible chat client in `client.ts`.  Keep the key in the server
 * environment and inject a `JevInvoker` into business code so that decisions
 * can be replaced with deterministic mocks in tests.
 */

export const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_JEV_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_JEV_MAX_RETRIES = 2;
export const DEFAULT_JEV_RETRY_DELAY_MS = 250;

export type JevJsonValue =
  | null
  | boolean
  | number
  | string
  | JevJsonValue[]
  | { [key: string]: JevJsonValue };

/** State may be text or any JSON-compatible object/array. Runtime validation
 * still rejects undefined, functions, bigint, and non-finite numbers. Using
 * `object` here lets callers pass their existing typed context interfaces
 * without first adding an index signature solely for this boundary. */
export type JevState = string | object;

/** TypeSafe accepts structured instructions in addition to plain text. */
export type JevInstructions = string | JevJsonValue[] | { [key: string]: JevJsonValue };

export type JevChoiceQuestion = {
  type: 'choice';
  instructions: JevInstructions;
  /** Option key to a description (or null when the key is self-describing). */
  criteria: Record<string, string | null>;
};

export type JevScoreQuestion = {
  type: 'score';
  instructions: JevInstructions;
  /** Ordered level descriptions. TypeSafe accepts 2–10 levels. */
  criteria: [string, string, ...string[]];
};

export type JevNoulQuestion = {
  type: 'noul';
  instructions: JevInstructions;
  criteria?: {
    true: string;
    false: string;
  };
};

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export type JevRequest = {
  state: JevState;
  questions: JevQuestions;
  /** Optional per-call model override; otherwise JEV_MODEL is used. */
  model?: string;
};

export type JevChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevScoreAnswer = {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevNoulAnswer = {
  type: 'noul';
  noul: number;
  /** Accepted for forward compatibility with early Jev response examples. */
  confidence?: number;
};

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

export type JevUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type JevResponse = {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: JevUsage;
};

/** A business-layer dependency that can be replaced with a mock in tests. */
export type JevInvoker = (request: JevRequest) => Promise<JevResponse>;

export type JevErrorCode =
  | 'JEV_API_KEY_NOT_SET'
  | 'JEV_API_URL_INVALID'
  | 'JEV_CONFIG_INVALID'
  | 'JEV_FETCH_UNAVAILABLE'
  | 'JEV_REQUEST_INVALID'
  | 'JEV_TIMEOUT'
  | 'JEV_NETWORK_ERROR'
  | 'JEV_RESPONSE_INVALID'
  | (string & {});

export class JevError extends Error {
  readonly code: JevErrorCode;
  readonly cause?: unknown;

  constructor(code: JevErrorCode, message = code, cause?: unknown) {
    super(message);
    this.name = 'JevError';
    this.code = code;
    this.cause = cause;
  }
}

export class JevHttpError extends JevError {
  readonly status: number;

  constructor(status: number) {
    super(`JEV_HTTP_${status}`, `JEV_HTTP_${status}`);
    this.name = 'JevHttpError';
    this.status = status;
  }
}

export class JevRequestError extends JevError {
  constructor(message: string) {
    super('JEV_REQUEST_INVALID', `JEV_REQUEST_INVALID: ${message}`);
    this.name = 'JevRequestError';
  }
}

export class JevResponseError extends JevError {
  constructor(message: string) {
    super('JEV_RESPONSE_INVALID', `JEV_RESPONSE_INVALID: ${message}`);
    this.name = 'JevResponseError';
  }
}

export type JevClientOptions = {
  /** Overrides JEV_API_URL. */
  apiUrl?: string;
  /** Overrides JEV_API_KEY. */
  apiKey?: string;
  /** Overrides JEV_MODEL. */
  model?: string;
  /** Overrides JEV_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Number of retries after the first request. Defaults to 2. */
  maxRetries?: number;
  /** Base delay between retry attempts. Defaults to 250 ms. */
  retryDelayMs?: number;
  /** Injectable fetch implementation for HTTP tests. */
  fetch?: typeof fetch;
  /** Injectable delay implementation for fast deterministic tests. */
  sleep?: (milliseconds: number) => Promise<void>;
};

export type JevConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
};

type Environment = Record<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new JevRequestError(`${label} has unknown field "${key}"`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isJsonValue(value: unknown): value is JevJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isInstructions(value: unknown): value is JevInstructions {
  return typeof value === 'string'
    || Array.isArray(value)
    || isRecord(value);
}

function assertInstructions(value: unknown, label: string): void {
  if (!isInstructions(value) || !isJsonValue(value)) {
    throw new JevRequestError(`${label} must be a JSON string, array, or object`);
  }
}

function assertProbability(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    throw new JevResponseError(`${label} must be a number between 0 and 1`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  for (const key of expected) {
    if (!hasOwn(value, key)) throw new JevResponseError(`${label} is missing "${key}"`);
  }
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) throw new JevResponseError(`${label} has unknown field "${key}"`);
  }
}

function assertProbabilityMap(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, number> {
  if (!isRecord(value)) throw new JevResponseError(`${label} must be an object`);
  assertExactKeys(value, expectedKeys, label);
  const probabilities: Record<string, number> = {};
  let total = 0;
  for (const key of expectedKeys) {
    const probability = value[key];
    assertProbability(probability, `${label}.${key}`);
    probabilities[key] = probability;
    total += probability;
  }
  // Distributions from a provider should sum to one. A small tolerance avoids
  // rejecting normal floating-point serialization noise.
  if (Math.abs(total - 1) > 0.02) {
    throw new JevResponseError(`${label} probabilities must sum to 1`);
  }
  return probabilities;
}

function assertRequestState(state: unknown): asserts state is JevState {
  if (typeof state !== 'string' && !Array.isArray(state) && !isRecord(state)) {
    throw new JevRequestError('state must be a string, array, or object');
  }
  if (!isJsonValue(state)) throw new JevRequestError('state must contain JSON-compatible values');
}

function assertQuestionInstructions(question: Record<string, unknown>, label: string): void {
  if (!hasOwn(question, 'instructions')) throw new JevRequestError(`${label}.instructions is required`);
  assertInstructions(question.instructions, `${label}.instructions`);
}

function validateChoiceQuestion(question: Record<string, unknown>, label: string): void {
  assertKnownKeys(question, ['type', 'instructions', 'criteria'], label);
  assertQuestionInstructions(question, label);
  if (!isRecord(question.criteria)) throw new JevRequestError(`${label}.criteria must be an object`);
  const options = Object.keys(question.criteria);
  if (options.length < 2 || options.length > 255) {
    throw new JevRequestError(`${label}.criteria must contain 2 to 255 options`);
  }
  for (const option of options) {
    if (!option.trim()) throw new JevRequestError(`${label}.criteria contains an empty option`);
    const description = question.criteria[option];
    if (description !== null && typeof description !== 'string') {
      throw new JevRequestError(`${label}.criteria.${option} must be a string or null`);
    }
  }
}

function validateScoreQuestion(question: Record<string, unknown>, label: string): void {
  assertKnownKeys(question, ['type', 'instructions', 'criteria'], label);
  assertQuestionInstructions(question, label);
  if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) {
    throw new JevRequestError(`${label}.criteria must contain 2 to 10 ordered levels`);
  }
  for (const [index, criterion] of question.criteria.entries()) {
    if (typeof criterion !== 'string' || !criterion.trim()) {
      throw new JevRequestError(`${label}.criteria[${index}] must be a non-empty string`);
    }
  }
}

function validateNoulQuestion(question: Record<string, unknown>, label: string): void {
  assertKnownKeys(question, ['type', 'instructions', 'criteria'], label);
  assertQuestionInstructions(question, label);
  if (!hasOwn(question, 'criteria')) return;
  if (!isRecord(question.criteria)) throw new JevRequestError(`${label}.criteria must be an object`);
  assertKnownKeys(question.criteria, ['true', 'false'], `${label}.criteria`);
  for (const value of ['true', 'false']) {
    if (typeof question.criteria[value] !== 'string') {
      throw new JevRequestError(`${label}.criteria.${value} must be a string`);
    }
  }
}

/** Validate a request before any network call is made. */
export function validateJevRequest(request: unknown): asserts request is JevRequest {
  if (!isRecord(request)) throw new JevRequestError('request must be an object');
  assertKnownKeys(request, ['state', 'questions', 'model'], 'request');
  if (!hasOwn(request, 'state')) throw new JevRequestError('state is required');
  assertRequestState(request.state);
  if (!isRecord(request.questions)) throw new JevRequestError('questions must be an object');
  const questionIds = Object.keys(request.questions);
  if (questionIds.length === 0) throw new JevRequestError('questions must not be empty');
  for (const id of questionIds) {
    if (!id.trim()) throw new JevRequestError('question IDs must not be empty');
    const question = request.questions[id];
    if (!isRecord(question) || typeof question.type !== 'string') {
      throw new JevRequestError(`questions.${id} must contain a type`);
    }
    if (question.type === 'choice') validateChoiceQuestion(question, `questions.${id}`);
    else if (question.type === 'score') validateScoreQuestion(question, `questions.${id}`);
    else if (question.type === 'noul') validateNoulQuestion(question, `questions.${id}`);
    else throw new JevRequestError(`questions.${id}.type is unsupported`);
  }
  if (hasOwn(request, 'model') && (typeof request.model !== 'string' || !request.model.trim())) {
    throw new JevRequestError('model must be a non-empty string when provided');
  }
}

function validateResponseChoice(
  answer: Record<string, unknown>,
  question: JevChoiceQuestion,
  label: string,
): JevChoiceAnswer {
  assertExactKeys(answer, ['type', 'choice', 'probabilities', 'confidence'], label);
  if (answer.type !== 'choice') throw new JevResponseError(`${label}.type must be choice`);
  if (typeof answer.choice !== 'string' || !hasOwn(question.criteria, answer.choice)) {
    throw new JevResponseError(`${label}.choice must be one of the declared options`);
  }
  const probabilities = assertProbabilityMap(answer.probabilities, Object.keys(question.criteria), `${label}.probabilities`);
  assertProbability(answer.confidence, `${label}.confidence`);
  return { type: 'choice', choice: answer.choice, probabilities, confidence: answer.confidence };
}

function validateResponseScore(
  answer: Record<string, unknown>,
  question: JevScoreQuestion,
  label: string,
): JevScoreAnswer {
  assertExactKeys(answer, ['type', 'score', 'legend', 'probabilities', 'confidence'], label);
  if (answer.type !== 'score') throw new JevResponseError(`${label}.type must be score`);
  if (!isFiniteNumber(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1) {
    throw new JevResponseError(`${label}.score is outside the declared rubric`);
  }
  const indexes = question.criteria.map((_, index) => String(index));
  if (!isRecord(answer.legend)) throw new JevResponseError(`${label}.legend must be an object`);
  assertExactKeys(answer.legend, indexes, `${label}.legend`);
  const legend: Record<string, string> = {};
  for (const [index, criterion] of question.criteria.entries()) {
    const key = String(index);
    if (answer.legend[key] !== criterion) {
      throw new JevResponseError(`${label}.legend.${key} does not match the declared rubric`);
    }
    legend[key] = criterion;
  }
  const probabilities = assertProbabilityMap(answer.probabilities, indexes, `${label}.probabilities`);
  assertProbability(answer.confidence, `${label}.confidence`);
  return { type: 'score', score: answer.score, legend, probabilities, confidence: answer.confidence };
}

function validateResponseNoul(answer: Record<string, unknown>, label: string): JevNoulAnswer {
  assertExactKeys(answer, hasOwn(answer, 'confidence') ? ['type', 'noul', 'confidence'] : ['type', 'noul'], label);
  if (answer.type !== 'noul') throw new JevResponseError(`${label}.type must be noul`);
  assertProbability(answer.noul, `${label}.noul`);
  if (hasOwn(answer, 'confidence')) assertProbability(answer.confidence, `${label}.confidence`);
  return hasOwn(answer, 'confidence')
    ? { type: 'noul', noul: answer.noul, confidence: answer.confidence as number }
    : { type: 'noul', noul: answer.noul };
}

/** Validate and normalize a TypeSafe response against the submitted questions. */
export function validateJevResponse(payload: unknown, questions: JevQuestions): JevResponse {
  if (!isRecord(payload)) throw new JevResponseError('response must be an object');
  assertExactKeys(payload, ['model', 'answers', 'usage'], 'response');
  if (hasOwn(payload, 'model') && (typeof payload.model !== 'string' || !payload.model.trim())) {
    throw new JevResponseError('response.model must be a non-empty string');
  }
  if (!isRecord(payload.answers)) throw new JevResponseError('response.answers must be an object');
  const expectedIds = Object.keys(questions);
  assertExactKeys(payload.answers, expectedIds, 'response.answers');
  const answers: Record<string, JevAnswer> = {};
  for (const id of expectedIds) {
    const answer = payload.answers[id];
    if (!isRecord(answer)) throw new JevResponseError(`response.answers.${id} must be an object`);
    const question = questions[id];
    if (question.type === 'choice') answers[id] = validateResponseChoice(answer, question, `response.answers.${id}`);
    else if (question.type === 'score') answers[id] = validateResponseScore(answer, question, `response.answers.${id}`);
    else answers[id] = validateResponseNoul(answer, `response.answers.${id}`);
  }

  let usage: JevUsage | undefined;
  if (hasOwn(payload, 'usage')) {
    if (!isRecord(payload.usage)) throw new JevResponseError('response.usage must be an object');
    assertExactKeys(payload.usage, ['input_tokens', 'output_tokens'], 'response.usage');
    const inputTokens = payload.usage.input_tokens;
    const outputTokens = payload.usage.output_tokens;
    if (typeof inputTokens !== 'number' || !Number.isInteger(inputTokens) || inputTokens < 0) {
      throw new JevResponseError('response.usage.input_tokens must be a non-negative integer');
    }
    if (typeof outputTokens !== 'number' || !Number.isInteger(outputTokens) || outputTokens < 0) {
      throw new JevResponseError('response.usage.output_tokens must be a non-negative integer');
    }
    usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
  }

  return {
    ...(hasOwn(payload, 'model') ? { model: payload.model as string } : {}),
    answers,
    ...(usage ? { usage } : {}),
  };
}

function resolveUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new JevError('JEV_API_URL_INVALID', `${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new JevError('JEV_API_URL_INVALID', `${label} must use http or https`);
  }
  return value.replace(/\/+$/, '');
}

function resolvePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new JevError('JEV_CONFIG_INVALID', `${label} must be a positive integer`);
  }
  return parsed;
}

function resolveOptionInteger(value: number | undefined, fallback: number, label: string, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) {
    throw new JevError('JEV_CONFIG_INVALID', `${label} must be an integer >= ${minimum}`);
  }
  return value;
}

/** Resolve Jev settings without making a network request. */
export function getJevConfig(
  environment: Environment = process.env,
  overrides: JevClientOptions = {},
): JevConfig {
  const apiKey = (overrides.apiKey ?? environment.JEV_API_KEY)?.trim();
  if (!apiKey) throw new JevError('JEV_API_KEY_NOT_SET', 'JEV_API_KEY_NOT_SET');

  const apiUrl = resolveUrl(
    (overrides.apiUrl ?? environment.JEV_API_URL ?? DEFAULT_JEV_API_URL).trim(),
    'JEV_API_URL',
  );
  const model = (overrides.model ?? environment.JEV_MODEL ?? DEFAULT_JEV_MODEL).trim();
  if (!model) throw new JevError('JEV_CONFIG_INVALID', 'JEV_MODEL must be a non-empty string');
  const timeoutMs = overrides.timeoutMs ?? resolvePositiveInteger(
    environment.JEV_REQUEST_TIMEOUT_MS,
    DEFAULT_JEV_REQUEST_TIMEOUT_MS,
    'JEV_REQUEST_TIMEOUT_MS',
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new JevError('JEV_CONFIG_INVALID', 'timeoutMs must be a positive integer');
  }
  const maxRetries = resolveOptionInteger(overrides.maxRetries, DEFAULT_JEV_MAX_RETRIES, 'maxRetries', 0);
  const retryDelayMs = resolveOptionInteger(overrides.retryDelayMs, DEFAULT_JEV_RETRY_DELAY_MS, 'retryDelayMs', 0);
  return { apiUrl, apiKey, model, timeoutMs, maxRetries, retryDelayMs };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status <= 599);
}

function isTimeoutCause(cause: unknown): boolean {
  return cause instanceof JevError && cause.code === 'JEV_TIMEOUT'
    || (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError'));
}

async function fetchWithTimeout(
  fetchImplementation: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const fetchPromise = Promise.resolve().then(() => fetchImplementation(url, { ...init, signal: controller.signal }));
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new JevError('JEV_TIMEOUT', 'JEV_TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (cause) {
    if (isTimeoutCause(cause)) {
      if (cause instanceof JevError) throw cause;
      throw new JevError('JEV_TIMEOUT', 'JEV_TIMEOUT', cause);
    }
    throw new JevError('JEV_NETWORK_ERROR', 'JEV_NETWORK_ERROR', cause);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function requestJev(
  request: JevRequest,
  options: JevClientOptions,
): Promise<JevResponse> {
  validateJevRequest(request);
  const config = getJevConfig(process.env, options);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') throw new JevError('JEV_FETCH_UNAVAILABLE', 'JEV_FETCH_UNAVAILABLE');
  const sleep = options.sleep ?? defaultSleep;
  const body = JSON.stringify({
    model: request.model ?? config.model,
    state: request.state,
    questions: request.questions,
  });

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImplementation, config.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      }, config.timeoutMs);
    } catch (error) {
      const normalized = error instanceof JevError
        ? error
        : new JevError('JEV_NETWORK_ERROR', 'JEV_NETWORK_ERROR', error);
      const retryable = normalized.code === 'JEV_NETWORK_ERROR' || normalized.code === 'JEV_TIMEOUT';
      if (!retryable || attempt >= config.maxRetries) throw normalized;
      await sleep(config.retryDelayMs * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const error = new JevHttpError(response.status);
      if (!isRetryableStatus(response.status) || attempt >= config.maxRetries) throw error;
      await sleep(config.retryDelayMs * (attempt + 1));
      continue;
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch (cause) {
      const error = new JevError('JEV_NETWORK_ERROR', 'JEV_NETWORK_ERROR', cause);
      if (attempt >= config.maxRetries) throw error;
      await sleep(config.retryDelayMs * (attempt + 1));
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new JevResponseError('response body is not valid JSON');
    }
    return validateJevResponse(payload, request.questions);
  }
  throw new JevError('JEV_NETWORK_ERROR', 'JEV_NETWORK_ERROR');
}

/** Create a Jev invoker with optional configuration/fetch overrides. */
export function createJevInvoker(options: JevClientOptions = {}): JevInvoker {
  return (request) => requestJev(request, options);
}

/** Default server-side Jev invoker, resolving JEV_* variables at call time. */
export const invokeJev: JevInvoker = createJevInvoker();
