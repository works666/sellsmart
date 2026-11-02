import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import {
  createJevInvoker,
  JevHttpError,
  JevResponseError,
  type JevRequest,
} from '../src/lib/ai/jev-client';

const request: JevRequest = {
  state: { message: 'The customer asks for a project route.' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'Which team should handle this?',
      criteria: {
        sales: 'Commercial project work',
        support: 'Existing customer support',
      },
    },
    severity: {
      type: 'score',
      instructions: 'How urgent is the request?',
      criteria: ['low', 'medium', 'high'],
    },
    urgent: {
      type: 'noul',
      instructions: 'Does this require immediate attention?',
    },
  },
};

function makeResponse(payload: Record<string, unknown>) {
  return JSON.stringify({
    model: 'jev-test-model',
    answers: payload,
    usage: { input_tokens: 12, output_tokens: 4 },
  });
}

function validAnswers() {
  return {
    route: {
      type: 'choice',
      choice: 'sales',
      probabilities: { sales: 0.8, support: 0.2 },
      confidence: 0.8,
    },
    severity: {
      type: 'score',
      score: 1.2,
      legend: { '0': 'low', '1': 'medium', '2': 'high' },
      probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
      confidence: 0.7,
    },
    urgent: { type: 'noul', noul: 0.15 },
  };
}

async function main() {
  const attempts = new Map<string, number>();
  const received: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
  const server = createServer((incoming, response) => {
    if (incoming.method !== 'POST' || incoming.url !== '/v1/systemone') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk: string) => { body += chunk; });
    incoming.on('end', () => {
      const payload = JSON.parse(body) as Record<string, unknown>;
      const state = JSON.stringify(payload.state);
      const count = (attempts.get(state) ?? 0) + 1;
      attempts.set(state, count);
      received.push({ authorization: incoming.headers.authorization, body: payload });

      if (incoming.headers.authorization !== 'Bearer jev-test-key') {
        response.writeHead(401).end();
        return;
      }
      if (state === JSON.stringify('unauthorized')) {
        response.writeHead(401).end();
        return;
      }
      if (state === JSON.stringify('retry-429') && count === 1) {
        response.writeHead(429).end();
        return;
      }
      if (state === JSON.stringify('retry-529') && count === 1) {
        response.writeHead(529).end();
        return;
      }
      if (state === JSON.stringify('retry-503') && count === 1) {
        response.writeHead(503).end();
        return;
      }
      if (state === JSON.stringify('always-503')) {
        response.writeHead(503).end();
        return;
      }
      if (state === JSON.stringify('bad-json')) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('not-json');
        return;
      }
      if (state === JSON.stringify('bad-answer')) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(makeResponse({
          route: { type: 'choice', choice: 'not-declared', probabilities: { sales: 1, support: 0 }, confidence: 1 },
          severity: validAnswers().severity,
          urgent: validAnswers().urgent,
        }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(makeResponse(validAnswers()));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('MOCK_SERVER_ADDRESS_FAILED');

  const originalEnvironment = {
    JEV_API_URL: process.env.JEV_API_URL,
    JEV_API_KEY: process.env.JEV_API_KEY,
    JEV_MODEL: process.env.JEV_MODEL,
    JEV_REQUEST_TIMEOUT_MS: process.env.JEV_REQUEST_TIMEOUT_MS,
  };
  process.env.JEV_API_URL = `http://127.0.0.1:${address.port}/v1/systemone`;
  process.env.JEV_API_KEY = 'jev-test-key';
  process.env.JEV_MODEL = 'jev-test-model';
  process.env.JEV_REQUEST_TIMEOUT_MS = '1000';

  try {
    const invoke = createJevInvoker({ retryDelayMs: 0, sleep: async () => undefined });
    const result = await invoke(request);
    assert.equal(result.model, 'jev-test-model');
    assert.equal(result.answers.route.type, 'choice');
    assert.equal(result.answers.severity.type, 'score');
    assert.equal(result.answers.urgent.type, 'noul');
    assert.equal(received[0].authorization, 'Bearer jev-test-key');
    assert.equal(received[0].body.model, 'jev-test-model');
    assert.equal(received[0].body.questions && typeof received[0].body.questions, 'object');

    for (const transientState of ['retry-429', 'retry-529', 'retry-503']) {
      const retried = await invoke({ ...request, state: transientState });
      assert.equal(retried.answers.route.type, 'choice');
      assert.equal(attempts.get(JSON.stringify(transientState)), 2, `${transientState} should retry once`);
    }
    await assert.rejects(
      invoke({ ...request, state: 'always-503' }),
      (error: unknown) => error instanceof JevHttpError && error.status === 503,
    );
    assert.equal(attempts.get(JSON.stringify('always-503')), 3, '5xx retries must be bounded');
    await assert.rejects(
      invoke({ ...request, state: 'unauthorized' }),
      (error: unknown) => error instanceof JevHttpError && error.status === 401,
    );
    assert.equal(attempts.get(JSON.stringify('unauthorized')), 1, '401 must not retry');
    await assert.rejects(invoke({ ...request, state: 'bad-json' }), JevResponseError);
    await assert.rejects(invoke({ ...request, state: 'bad-answer' }), JevResponseError);

    const networkInvoker = createJevInvoker({
      apiKey: 'jev-test-key',
      apiUrl: 'http://127.0.0.1:1/v1/systemone',
      maxRetries: 1,
      retryDelayMs: 0,
      sleep: async () => undefined,
      fetch: async () => { throw new Error('offline'); },
    });
    await assert.rejects(networkInvoker(request), /JEV_NETWORK_ERROR/);

    const timeoutInvoker = createJevInvoker({
      apiKey: 'jev-test-key',
      apiUrl: 'http://jev.test/v1/systemone',
      timeoutMs: 10,
      maxRetries: 0,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });
    await assert.rejects(timeoutInvoker(request), /JEV_TIMEOUT/);
    console.log('Jev Provider mock HTTP、严格响应校验、网络/超时与有限重试测试通过。');
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    server.close();
    await once(server, 'close');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
