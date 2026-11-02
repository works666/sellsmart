import {
  beginFastAiTrace,
  finishFastAiTrace,
  truncateRawProviderText,
  type FastAiTrace,
} from '@/lib/testing/fast-test-observability';
import { loadAiProviderSelection, selectedAiProvider } from '@/lib/ai/provider-selection';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Named server-side providers used by tools that compare model behaviour. */
export type AiProvider = 'default' | 'deepseek' | 'doubao' | 'qwen';

export type InvokeOptions = {
  provider?: AiProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  thinking?: 'enabled' | 'disabled';
};

export interface AiProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const PROVIDER_ENV: Record<AiProvider, {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout?: string;
}> = {
  default: {
    baseUrl: 'AI_BASE_URL',
    apiKey: 'AI_API_KEY',
    model: 'AI_MODEL',
    timeout: 'AI_REQUEST_TIMEOUT_MS',
  },
  deepseek: {
    baseUrl: 'DEEPSEEK_AI_BASE_URL',
    apiKey: 'DEEPSEEK_AI_API_KEY',
    model: 'DEEPSEEK_AI_MODEL',
    timeout: 'DEEPSEEK_AI_REQUEST_TIMEOUT_MS',
  },
  doubao: {
    baseUrl: 'DOUBAO_AI_BASE_URL',
    apiKey: 'DOUBAO_AI_API_KEY',
    model: 'DOUBAO_AI_MODEL',
    timeout: 'DOUBAO_AI_REQUEST_TIMEOUT_MS',
  },
  qwen: {
    baseUrl: 'QWEN_AI_BASE_URL',
    apiKey: 'QWEN_AI_API_KEY',
    model: 'QWEN_AI_MODEL',
    timeout: 'QWEN_AI_REQUEST_TIMEOUT_MS',
  },
};

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
}

/**
 * Resolve one provider from server environment variables.
 *
 * Named providers intentionally do not fall back to AI_*: otherwise a
 * comparison track could silently test the default model twice.
 */
export function getAiProviderConfig(provider: AiProvider = 'default'): AiProviderConfig {
  const env = PROVIDER_ENV[provider];
  const baseUrl = process.env[env.baseUrl]?.trim();
  const apiKey = process.env[env.apiKey]?.trim();
  const model = process.env[env.model]?.trim();
  if (!baseUrl) throw new Error(`${env.baseUrl}_NOT_SET`);
  if (!apiKey) throw new Error(`${env.apiKey}_NOT_SET`);
  if (!model) throw new Error(`${env.model}_NOT_SET`);
  const configuredTimeout = Number(process.env[env.timeout || 'AI_REQUEST_TIMEOUT_MS'] || process.env.AI_REQUEST_TIMEOUT_MS || 60_000);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 60_000,
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function extractText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => block.type === 'text' ? (block.text || '') : '').join('');
}

async function requestCompletion(
  messages: ChatMessage[],
  options: InvokeOptions | undefined,
  stream: boolean,
): Promise<{ response: Response; trace: FastAiTrace | null }> {
  const provider = options?.provider ?? selectedAiProvider((await loadAiProviderSelection()).config);
  const config = getAiProviderConfig(provider);
  const requestBody = {
    model: options?.model || config.model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens,
    ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(options?.thinking && provider === 'qwen'
      ? { enable_thinking: options.thinking === 'enabled' }
      : options?.thinking && (
        provider === 'doubao' || /(^|\.)deepseek\.com$/i.test(new URL(config.baseUrl).hostname)
      )
        ? { thinking: { type: options.thinking } }
        : {}),
    stream,
  };
  const trace = beginFastAiTrace({
    providerUrl: chatCompletionsUrl(config.baseUrl),
    model: requestBody.model,
    messages,
    options: { provider, temperature: requestBody.temperature, maxTokens: options?.maxTokens, jsonMode: Boolean(options?.jsonMode), thinking: options?.thinking },
    stream,
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (cause) {
      const error = new Error(cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)
        ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_NETWORK_ERROR');
      if (attempt === 0) {
        console.warn('AI provider request retry', { provider, code: error.message, attempt: 1 });
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      finishFastAiTrace(trace, { error });
      throw error;
    }
    if (response.ok) return { response, trace };
    const error = new Error(`AI_PROVIDER_HTTP_${response.status}`);
    await response.body?.cancel().catch(() => undefined);
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      console.warn('AI provider request retry', { provider, code: error.message, attempt: 1 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    finishFastAiTrace(trace, { error });
    throw error;
  }
  throw new Error('AI_PROVIDER_NETWORK_ERROR');
}

export async function invokeLLM(
  messages: ChatMessage[],
  options?: InvokeOptions,
): Promise<string> {
  const { response, trace } = await requestCompletion(messages, options, false);
  try {
    const payload = await response.json() as ChatCompletionResponse;
    // Keep diagnostic metadata (including finish_reason and usage) available
    // even when the provider returns a valid JSON envelope with no text.
    finishFastAiTrace(trace, { rawResponse: payload });
    const content = extractText(payload.choices?.[0]?.message?.content);
    if (!content.trim()) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
    return content;
  } catch (error) {
    finishFastAiTrace(trace, { error });
    throw error;
  }
}

export async function* streamLLM(
  messages: ChatMessage[],
  options?: InvokeOptions,
): AsyncGenerator<string, void, undefined> {
  const { response, trace } = await requestCompletion(messages, options, true);
  if (!response.body) {
    const error = new Error('AI_PROVIDER_STREAM_UNAVAILABLE');
    finishFastAiTrace(trace, { error });
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parseLine = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return '';
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return '';
    try {
      const chunk = JSON.parse(data) as ChatCompletionChunk & { error?: unknown };
      if (!chunk || typeof chunk !== 'object' || chunk.error) throw new Error('AI_PROVIDER_STREAM_PROTOCOL');
      return extractText(chunk.choices?.[0]?.delta?.content);
    } catch {
      throw new Error('AI_PROVIDER_STREAM_PROTOCOL');
    }
  };
  let rawResponse = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      rawResponse = truncateRawProviderText(rawResponse + decoded);
      buffer += decoded;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const content = parseLine(line);
        if (content) yield content;
      }
    }
    const finalDecoded = decoder.decode();
    rawResponse += finalDecoded;
    buffer += finalDecoded;
    const finalContent = parseLine(buffer);
    if (finalContent) yield finalContent;
    finishFastAiTrace(trace, { rawResponse: truncateRawProviderText(rawResponse) });
  } catch (error) {
    finishFastAiTrace(trace, { error });
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
