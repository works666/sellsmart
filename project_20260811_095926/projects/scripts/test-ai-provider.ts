import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import {
  __resetFastTestObservabilityForTests,
  FAST_TEST_USER_ID,
  getFastAiTraces,
  runWithFastTestObservability,
} from '../src/lib/testing/fast-test-observability';

async function main() {
  const attempts = new Map<string, number>();
  let selectionUnavailable = false;
  const requestPayloads: Array<{
    model: string;
    thinking?: { type?: string };
    enable_thinking?: boolean;
  }> = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/rest/v1/designer_prompt_configs?')) {
      if (selectionUnavailable) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: 'TEST_DB_UNAVAILABLE', message: 'unavailable' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ config: { provider: 'qwen' }, revision: 1, updated_at: null, updated_by: null }));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }

    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body) as {
        stream?: boolean;
        model: string;
        response_format?: { type?: string };
        thinking?: { type?: string };
        enable_thinking?: boolean;
      };
      requestPayloads.push(payload);
      const count = (attempts.get(payload.model) ?? 0) + 1;
      attempts.set(payload.model, count);
      const expectedPath = payload.model === 'qwen-local-model'
        ? '/qwen/v1/chat/completions'
        : '/v1/chat/completions';
      if (request.url !== expectedPath) {
        response.writeHead(404).end();
        return;
      }
      const expectedApiKey = payload.model === 'qwen-local-model' ? 'qwen-test-key' : 'local-test-key';
      if (request.headers.authorization !== `Bearer ${expectedApiKey}`) {
        response.writeHead(401).end();
        return;
      }
      if (payload.model === 'always-unauthorized') { response.writeHead(401).end('sensitive-provider-body'); return; }
      if (payload.model === 'always-unavailable' || (payload.model === 'retry-once' && count === 1)) {
        response.writeHead(503).end('sensitive-provider-body'); return;
      }
      if (payload.model === 'broken-stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"sensitive-provider-body"}}\n\n');
        return;
      }
      if (!payload.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        if (payload.model === 'blank-response') {
          response.end(JSON.stringify({
            choices: [{ message: { content: '                     ' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
          }));
          return;
        }
        if (payload.model === 'empty-string-response') {
          response.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
          return;
        }
        if (payload.model === 'missing-content-response') {
          response.end(JSON.stringify({ choices: [{ message: {} }] }));
          return;
        }
        if (payload.model === 'spaced-json-response') {
          response.end(JSON.stringify({ choices: [{ message: { content: ' \n{"ok":true}\t ' } }] }));
          return;
        }
        response.end(JSON.stringify({ choices: [{ message: { content: payload.response_format ? '{"ok":true}' : '普通响应通过' } }] }));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"流式"}}]}\n\n');
      response.end('data: {"choices":[{"delta":{"content":"响应通过"}}]}');
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('MOCK_SERVER_ADDRESS_FAILED');

  process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.AI_API_KEY = 'local-test-key';
  process.env.AI_MODEL = 'local-test-model';
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_ANON_KEY = 'local-test-key';

  try {
    const { invokeLLM, streamLLM } = await import('../src/lib/ai/client');
    const response = await invokeLLM([{ role: 'user', content: 'test' }], { provider: 'default' });
    if (response !== '普通响应通过') throw new Error(`INVOKE_MISMATCH: ${response}`);
    const defaultThinkingResponse = await invokeLLM([{ role: 'user', content: 'default thinking test' }], { provider: 'default', thinking: 'disabled' });
    assert.equal(defaultThinkingResponse, '普通响应通过');
    assert.equal(requestPayloads[requestPayloads.length - 1].thinking, undefined, 'Default provider must not forward thinking');

    process.env.DOUBAO_AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.DOUBAO_AI_API_KEY = 'local-test-key';
    process.env.DOUBAO_AI_MODEL = 'doubao-local-model';
    const doubaoThinkingResponse = await invokeLLM(
      [{ role: 'user', content: 'doubao thinking test' }],
      { provider: 'doubao', thinking: 'disabled' },
    );
    assert.equal(doubaoThinkingResponse, '普通响应通过');
    assert.deepEqual(requestPayloads[requestPayloads.length - 1].thinking, { type: 'disabled' });

    process.env.QWEN_AI_BASE_URL = `http://127.0.0.1:${address.port}/qwen/v1`;
    process.env.QWEN_AI_API_KEY = 'qwen-test-key';
    process.env.QWEN_AI_MODEL = 'qwen-local-model';
    const qwenThinkingResponse = await invokeLLM(
      [{ role: 'user', content: 'qwen thinking test' }],
      { provider: 'qwen', thinking: 'disabled' },
    );
    assert.equal(qwenThinkingResponse, '普通响应通过');
    assert.equal(requestPayloads[requestPayloads.length - 1].model, 'qwen-local-model');
    const requestCountBeforeUnavailable = requestPayloads.length;
    selectionUnavailable = true;
    await assert.rejects(invokeLLM([{ role: 'user', content: 'config unavailable' }]), /AI_PROVIDER_SELECTION_READ_FAILED/);
    assert.equal(requestPayloads.length, requestCountBeforeUnavailable, 'Configuration read failure must not send an AI request');
    selectionUnavailable = false;
    assert.equal(requestPayloads[requestPayloads.length - 1].enable_thinking, false);
    assert.equal(requestPayloads[requestPayloads.length - 1].thinking, undefined);
    const selectedResponse = await invokeLLM([{ role: 'user', content: 'selected qwen test' }]);
    assert.equal(selectedResponse, '普通响应通过');
    assert.equal(requestPayloads[requestPayloads.length - 1].model, 'qwen-local-model');

    const jsonResponse = await invokeLLM([{ role: 'user', content: 'json test' }], { provider: 'default', jsonMode: true });
    if (jsonResponse !== '{"ok":true}') throw new Error(`JSON_MODE_MISMATCH: ${jsonResponse}`);
    const spacedJsonResponse = await invokeLLM(
      [{ role: 'user', content: 'spaced json test' }],
      { provider: 'default', model: 'spaced-json-response', jsonMode: true },
    );
    assert.equal(spacedJsonResponse, ' \n{"ok":true}\t ', 'nonempty response content is returned without trimming');

    __resetFastTestObservabilityForTests();
    await runWithFastTestObservability(FAST_TEST_USER_ID, async () => {
      await assert.rejects(
        invokeLLM([{ role: 'user', content: 'blank response test' }], { provider: 'default', model: 'blank-response' }),
        /^Error: AI_PROVIDER_EMPTY_RESPONSE$/,
      );
      await assert.rejects(
        invokeLLM([{ role: 'user', content: 'empty response test' }], { provider: 'default', model: 'empty-string-response' }),
        /^Error: AI_PROVIDER_EMPTY_RESPONSE$/,
      );
      await assert.rejects(
        invokeLLM([{ role: 'user', content: 'missing response test' }], { provider: 'default', model: 'missing-content-response' }),
        /^Error: AI_PROVIDER_EMPTY_RESPONSE$/,
      );
    });
    for (const model of ['blank-response', 'empty-string-response', 'missing-content-response']) {
      assert.equal(attempts.get(model), 1, `${model} is not retried as a generic provider failure`);
    }
    const blankResponseTrace = getFastAiTraces(FAST_TEST_USER_ID, 3).find((trace) => trace.model === 'blank-response');
    assert.equal(blankResponseTrace?.status, 'error');
    assert.equal(blankResponseTrace?.error, 'AI_PROVIDER_EMPTY_RESPONSE');
    const blankTracePayload = blankResponseTrace?.rawResponse as {
      choices?: Array<{ finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    } | undefined;
    assert.equal(blankTracePayload?.choices?.[0]?.finish_reason, 'length', 'empty-response diagnostics retain finish_reason');
    assert.deepEqual(
      blankTracePayload?.usage,
      { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
      'empty-response diagnostics retain usage',
    );

    let streamed = '';
    for await (const chunk of streamLLM([{ role: 'user', content: 'test stream' }], { provider: 'default' })) {
      streamed += chunk;
    }
    if (streamed !== '流式响应通过') throw new Error(`STREAM_MISMATCH: ${streamed}`);
    assert.equal(await invokeLLM([{ role: 'user', content: 'retry' }], { provider: 'default', model: 'retry-once' }), '普通响应通过');
    assert.equal(attempts.get('retry-once'), 2);
    await assert.rejects(invokeLLM([], { provider: 'default', model: 'always-unavailable' }), /^Error: AI_PROVIDER_HTTP_503$/);
    assert.equal(attempts.get('always-unavailable'), 2, 'Retries must be bounded');
    await assert.rejects(invokeLLM([], { provider: 'default', model: 'always-unauthorized' }), /^Error: AI_PROVIDER_HTTP_401$/);
    assert.equal(attempts.get('always-unauthorized'), 1, 'Invalid credentials must not retry');
    await assert.rejects(async () => {
      for await (const chunk of streamLLM([], { provider: 'default', model: 'broken-stream' })) { assert.equal(chunk, 'partial'); }
    }, /^Error: AI_PROVIDER_STREAM_PROTOCOL$/);
    assert.equal(attempts.get('broken-stream'), 1, 'Never replay a stream after output starts');
    console.log('AI Provider 普通响应与流式响应测试通过。');
  } finally {
    server.close();
    await once(server, 'close');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
