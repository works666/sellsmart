import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createSession, signSession } from '../../../projects/src/lib/auth/identity';

const root = process.cwd();
const envPath = resolve(root, 'projects', '.env.local');
const requireFromProject = createRequire(resolve(root, 'projects', 'package.json'));
const dotenv = requireFromProject('dotenv') as { config: (options: { path: string; override: boolean; quiet?: boolean }) => { error?: Error } };
const envResult = dotenv.config({ path: envPath, override: false, quiet: true });
if (envResult.error) throw new Error('Unable to load projects/.env.local');

const endpoint = 'http://127.0.0.1:5010/api/designer/system-evaluation';
const runKey = randomUUID();
const designerToken = signSession(createSession(`system-eval-http-smoke-designer-${runKey}`, 'platform_designer'));
const playerToken = signSession(createSession(`system-eval-http-smoke-player-${runKey}`, 'player'));

async function request(label: string, method: 'GET' | 'POST', token?: string, body?: unknown) {
  const response = await fetch(endpoint, {
    method,
    headers: {
      ...(token ? { 'x-session': token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Keep only the HTTP status when a response is not JSON.
  }
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : undefined;
  const error = payload.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : undefined;
  return {
    check: label,
    status: response.status,
    ...(typeof payload.success === 'boolean' ? { success: payload.success } : {}),
    ...(sessions ? { sessionCount: sessions.length } : {}),
    ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
  };
}

const results = [
  await request('anonymous_get', 'GET'),
  await request('anonymous_post', 'POST', undefined, {}),
  await request('player_post', 'POST', playerToken, {}),
  await request('designer_get_own_list', 'GET', designerToken),
  await request('designer_post_missing_snapshot', 'POST', designerToken, {
    source: { kind: 'snapshot', previewSessionId: '00000000-0000-4000-8000-000000000001' },
    npcId: 'P1-001',
    channel: 'email',
    salesTurns: ['只读权限冒烟请求，不调用模型。'],
    expectation: '此请求应因不存在且不属于临时身份的快照而返回404。',
    threshold: 0.7,
  }),
];

const expectedStatuses: Record<string, number> = {
  anonymous_get: 401,
  anonymous_post: 401,
  player_post: 403,
  designer_get_own_list: 200,
  designer_post_missing_snapshot: 404,
};
const checks = results.map((result) => ({
  check: result.check,
  passed: result.status === expectedStatuses[result.check]
    && (result.check !== 'designer_get_own_list' || result.sessionCount === 0)
    && (result.check !== 'designer_post_missing_snapshot' || result.errorCode === 'not_found'),
}));
const report = {
  endpoint: '/api/designer/system-evaluation',
  checkedAt: new Date().toISOString(),
  environmentFile: 'projects/.env.local (loaded; values omitted)',
  results,
  checks,
  modelInvoked: false,
  note: 'POST used snapshot mode with a fabricated UUID and temporary designer identity. Handler loads read-only configs, then owner-scoped snapshot lookup fails before any LLM invocation.',
};

console.log(JSON.stringify(report, null, 2));
if (checks.some((check) => !check.passed)) process.exitCode = 1;
