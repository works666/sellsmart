import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length, 'preview HTML should contain its application script');
const inlineScript = scripts.at(-1)![1];
const iifeClose = inlineScript.lastIndexOf('})();');
assert.notEqual(iifeClose, -1, 'preview application script should end with its IIFE');

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  keys() {
    return [...this.values.keys()];
  }
}

type FetchCall = { url: string; init?: RequestInit };
type FetchHandler = (url: string, init?: RequestInit) => Promise<unknown>;
type StubEvent = { key?: string | null };
type StubListener = (event?: StubEvent) => void;
type PreviewState = {
  actionPoints: number;
  totalSpent: number;
  workPlans: { global: string; byNpc: Record<string, string> };
  publicIntel: Record<string, string[]>;
  npcTestStates: Record<string, { support: number; pleasantness: number; effectiveContactCount: number; node: string }>;
  infoUpdates: Array<{ created: string; body: string }>;
  previewSessionId: string | null;
  conversations: Record<string, Record<string, unknown[]>>;
};
type PreviewTestHooks = {
  snapshot: () => PreviewState;
  setState: (patch: Partial<PreviewState>) => void;
  fireStorage: (key: string) => void;
  apiCall: (...args: unknown[]) => Promise<unknown>;
  sendMessage: (options: { payload: Record<string, unknown> }) => Promise<unknown>;
  isInvalidated: (value: unknown) => boolean;
  getActiveUserId: () => string | null;
  getAuthTransitionPending: () => boolean;
};

function response(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const npcIds = ['P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005'];
function recoveryResponse(sessionId: string, version: number) {
  return response(200, {
    success: true,
    data: {
      previewSessionId: sessionId,
      version,
      conversations: Object.fromEntries(npcIds.map(npcId => [npcId, []])),
      appointments: [],
      wechat: Object.fromEntries(npcIds.map(npcId => [npcId, null])),
      activeMeeting: null,
      customerActivities: { version: 1, tasks: [] },
      approvedVisitPreparationNpcIds: [],
    },
  });
}

function createRuntime(options: {
  userId?: string;
  token?: string;
  sessionStorage?: MemoryStorage;
  legacyCache?: boolean;
} = {}) {
  const localStorage = new MemoryStorage();
  const sessionStorage = options.sessionStorage ?? new MemoryStorage();
  if (options.userId) localStorage.setItem('weixun_identity', JSON.stringify({ userId: options.userId }));
  if (options.token) localStorage.setItem('weixun_session', options.token);
  if (options.legacyCache) {
    sessionStorage.setItem('project1_interactive_prototype_v10', JSON.stringify({ phase: 5, actionPoints: 0, workPlans: { global: 'unowned secret' } }));
    sessionStorage.setItem('project1_interactive_prototype_v9', JSON.stringify({ phase: 5, actionPoints: 0 }));
    sessionStorage.setItem('weixun_project1_preview_session_v1', JSON.stringify({ id: 'unowned-session', version: 9 }));
  }

  const windowListeners = new Map<string, StubListener[]>();
  const documentListeners = new Map<string, StubListener[]>();
  const calls: FetchCall[] = [];
  let routeFetch: FetchHandler = async () => response(200, {
    success: true,
    previewSessionId: 'server-session',
    version: 1,
    data: { value: 'ok' },
  });
  const app = { innerHTML: '' };
  const modalRoot = { innerHTML: '' };
  const toastRoot = { appendChild: (_child: unknown) => undefined };
  const document = {
    hidden: false,
    body: { appendChild: (_child: unknown) => undefined },
    getElementById(id: string) {
      if (id === 'app') return app;
      if (id === 'modal-root') return modalRoot;
      if (id === 'toast-root') return toastRoot;
      return null;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
    addEventListener(type: string, listener: StubListener) {
      const items = documentListeners.get(type) ?? [];
      items.push(listener);
      documentListeners.set(type, items);
    },
  };
  const window = {
    location: { reload: () => undefined },
    matchMedia: () => ({ matches: false }),
    addEventListener(type: string, listener: StubListener) {
      const items = windowListeners.get(type) ?? [];
      items.push(listener);
      windowListeners.set(type, items);
    },
  };
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/designer/image-assets') return new Promise(() => undefined);
    if (url.startsWith('/api/game-data/competitor-profiles?')) {
      return response(200, { success: true, data: [], revision: 0 });
    }
    return routeFetch(url, init);
  };

  const instrumentedScript = `${inlineScript.slice(0, iifeClose)}
 globalThis.__previewTestHooks={
  snapshot:()=>JSON.parse(JSON.stringify(state)),
  setState:patch=>{state={...state,...patch};save()},
  fireStorage:key=>handleIdentityStorageChange({key}),
  apiCall:(...args)=>accountScopedApiCall(...args),
  sendMessage:options=>sendMessage(options),
  isInvalidated:value=>value===INVALIDATED_REQUEST,
  getActiveUserId:()=>activeUserId,
  getAuthTransitionPending:()=>authTransitionPending,
 };
})();`;
  const context = vm.createContext({
    console,
    document,
    window,
    localStorage,
    sessionStorage,
    fetch,
    AbortController,
    TextDecoder,
    TextEncoder,
    URL,
    Event,
    Date,
    Math,
    setTimeout: (callback: () => void) => { callback(); return 0; },
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    crypto: { randomUUID: () => 'test-command-id' },
  });
  vm.runInContext(instrumentedScript, context, { filename: 'project1-prototype-v9.inline.js' });
  const hooks = vm.runInContext('globalThis.__previewTestHooks', context) as PreviewTestHooks;
  return {
    hooks,
    localStorage,
    sessionStorage,
    calls,
    setRouteFetch(handler: FetchHandler) { routeFetch = handler; },
    setAuth(userId: string, token: string, eventKey = 'weixun_identity') {
      localStorage.setItem('weixun_identity', JSON.stringify({ userId }));
      localStorage.setItem('weixun_session', token);
      hooks.fireStorage(eventKey);
    },
  };
}

function accountState(label: string) {
  return {
    actionPoints: 7,
    totalSpent: 21,
    workPlans: { global: `${label} plan`, byNpc: { 'P1-001': `${label} contact plan` } },
    publicIntel: { 'P1-001': [`${label} public fact`] },
    npcTestStates: {
      'P1-001': { support: 91, pleasantness: 82, effectiveContactCount: 6, node: 'N3' },
    },
    infoUpdates: [{ created: label, body: `${label} update` }],
    previewSessionId: `${label}-preview-session`,
    previewVersion: 6,
  };
}

function seedAccount(runtime: ReturnType<typeof createRuntime>, label: string) {
  runtime.hooks.setState(accountState(label));
}

async function testAccountSwitchAndRefresh() {
  const sessionStorage = new MemoryStorage();
  const runtime = createRuntime({ userId: 'user-A', token: 'token-A', sessionStorage });
  seedAccount(runtime, 'A');

  const refreshed = createRuntime({ userId: 'user-A', token: 'token-A', sessionStorage });
  assert.equal(refreshed.hooks.snapshot().workPlans.global, 'A plan', 'same-account refresh restores that account cache');
  assert.equal(refreshed.hooks.snapshot().previewSessionId, 'A-preview-session', 'same-account refresh restores only its preview session');

  runtime.localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'user-B' }));
  runtime.hooks.fireStorage('weixun_identity');
  assert.equal(runtime.hooks.getActiveUserId(), 'user-B');
  assert.equal(runtime.hooks.snapshot().actionPoints, 28, 'B starts with default action points');
  assert.equal(runtime.hooks.snapshot().workPlans.global, '', 'B cannot see A work plans');
  assert.equal(JSON.stringify(runtime.hooks.snapshot().publicIntel['P1-001'] ?? []), '[]', 'B cannot see A public information');
  assert.equal(runtime.hooks.snapshot().npcTestStates['P1-001'].support, 0, 'B cannot inherit A test controls');
  assert.equal(runtime.hooks.snapshot().previewSessionId, null, 'B never receives A preview session ID');
  assert.equal(runtime.hooks.getAuthTransitionPending(), true, 'B cannot use A token during the identity/session write gap');

  const beforeGapCalls = runtime.calls.filter(call => call.url === '/api/project-one-preview/ai').length;
  await runtime.hooks.apiCall('plan', { text: 'B plan' });
  assert.equal(runtime.calls.filter(call => call.url === '/api/project-one-preview/ai').length, beforeGapCalls, 'requests are blocked until B token replaces A token');

  runtime.localStorage.setItem('weixun_session', 'token-B');
  runtime.hooks.fireStorage('weixun_session');
  runtime.setRouteFetch(async () => response(200, {
    success: true,
    previewSessionId: 'B-preview-session',
    version: 2,
    data: { accepted: true },
  }));
  await runtime.hooks.apiCall('plan', { text: 'B plan' });
  const request = runtime.calls.filter(call => call.url === '/api/project-one-preview/ai').at(-1)!;
  const requestBody = JSON.parse(String(request.init?.body));
  assert.equal((request.init?.headers as Record<string, string>)['x-session'], 'token-B', 'B request uses B token');
  assert.equal(requestBody.previewSessionId, undefined, 'B request does not send A preview session');

  runtime.setAuth('user-A', 'token-A');
  assert.equal(runtime.hooks.snapshot().workPlans.global, 'A plan', 'switching back restores A scoped plan');
  assert.equal(runtime.hooks.snapshot().previewSessionId, 'A-preview-session', 'switching back restores A session');
}

async function testUnownedLegacyCacheIsDiscarded() {
  const runtime = createRuntime({ userId: 'user-B', token: 'token-B', legacyCache: true });
  assert.equal(runtime.hooks.snapshot().actionPoints, 28, 'unowned legacy progress is not migrated into the current user');
  assert.equal(runtime.hooks.snapshot().workPlans.global, '', 'unowned plan is discarded');
  assert.equal(runtime.hooks.snapshot().previewSessionId, null, 'unowned legacy previewSessionId is discarded');
  assert.equal(runtime.sessionStorage.getItem('project1_interactive_prototype_v10'), null, 'old global v10 cache is removed');
  assert.equal(runtime.sessionStorage.getItem('project1_interactive_prototype_v9'), null, 'old global v9 cache is removed');
  assert.equal(runtime.sessionStorage.getItem('weixun_project1_preview_session_v1'), null, 'old global session pointer is removed');
  assert.equal(runtime.calls.filter(call => call.url === '/api/project-one-preview/ai').length, 0, 'discarding unowned browser cache never calls a server reset');
}

async function testInFlightAccountSwitchDoesNotMutateNewAccount() {
  const runtime = createRuntime({ userId: 'user-A', token: 'token-A' });
  seedAccount(runtime, 'A');
  let finishResponse!: (value: unknown) => void;
  runtime.setRouteFetch((_url, init) => init?.method === 'GET'
    ? Promise.resolve(recoveryResponse('A-preview-session', 6))
    : new Promise(resolve => { finishResponse = resolve; }));
  const pending = runtime.hooks.sendMessage({
    payload: { npcId: 'P1-001', channel: 'email', text: 'A private message' },
  });
  for (let attempt = 0; attempt < 10 && !finishResponse; attempt += 1) await Promise.resolve();
  const previewCalls = runtime.calls.filter(call => call.url.startsWith('/api/project-one-preview/ai'));
  assert.equal(previewCalls.filter(call => call.init?.method === 'GET').length, 1, 'A session is recovered before the message request');
  assert.equal(previewCalls.filter(call => call.init?.method === 'POST').length, 1, 'A message request started after recovery');
  assert.equal(typeof finishResponse, 'function', 'A POST is held open to exercise the account-switch race');

  runtime.setAuth('user-B', 'token-B');
  assert.equal(runtime.hooks.snapshot().workPlans.global, '', 'B state loaded before A response');
  finishResponse(response(200, {
    success: true,
    previewSessionId: 'late-A-session',
    version: 99,
    data: {
      content: 'late A response',
      responseAction: 'reply',
      invitationStatus: 'none',
      readStatus: 'read',
      playerMessageId: 'late-player-id',
    },
  }));
  const settled = await Promise.race([
    pending.then((value: unknown): { kind: 'settled'; value: unknown } => ({ kind: 'settled', value })),
    new Promise<{ kind: 'timeout' }>(resolve => setTimeout(() => resolve({ kind: 'timeout' }), 25)),
  ]);
  assert.equal(settled.kind, 'settled', 'invalidated caller settles after its cancellation guard');
  assert.equal(settled.value, undefined, 'sendMessage consumes the cancellation sentinel and returns without entering its failure branch');
  const stateB = runtime.hooks.snapshot();
  assert.equal(stateB.workPlans.global, '', 'late A result cannot replace B plans');
  assert.equal(JSON.stringify(stateB.conversations['P1-001'].email), '[]', 'late A result cannot append messages to B');
  assert.equal(stateB.previewSessionId, null, 'late A response cannot write its previewSessionId into B');
}

async function testErrorCleanupIsOwnerScoped() {
  const runtime = createRuntime({ userId: 'user-A', token: 'token-A' });
  seedAccount(runtime, 'A');
  runtime.setRouteFetch((_url, init) => init?.method === 'GET'
    ? Promise.resolve(recoveryResponse('A-preview-session', 6))
    : Promise.resolve(response(401, { error: 'expired' })));
  await runtime.hooks.apiCall('plan', { text: 'retry' });
  assert.equal(runtime.hooks.snapshot().workPlans.global, 'A plan', '401 retains the same owner local cache');
  assert.equal(runtime.hooks.snapshot().previewSessionId, 'A-preview-session', '401 does not detach or reset a potentially owned server session');

  runtime.setAuth('user-B', 'token-B');
  seedAccount(runtime, 'B');
  runtime.setAuth('user-A', 'token-A');

  const callsBeforeMissingSession = runtime.calls.length;
  runtime.setRouteFetch(async () => response(404, { error: 'missing' }));
  await runtime.hooks.apiCall('plan', { text: 'retry' });
  assert.equal(runtime.calls.length, callsBeforeMissingSession + 1, 'a missing session stops at the recovery GET without sending a POST');
  assert.equal(runtime.hooks.snapshot().actionPoints, 7, 'missing session preserves the active owner local progress');
  assert.equal(runtime.hooks.snapshot().workPlans.global, 'A plan', 'missing session preserves the active owner plan');
  assert.equal(JSON.stringify(runtime.hooks.snapshot().publicIntel['P1-001'] ?? []), '["A public fact"]', 'missing session preserves active owner public information');
  assert.equal(runtime.hooks.snapshot().npcTestStates['P1-001'].support, 91, 'missing session preserves active owner test adjustments');
  assert.equal(runtime.hooks.snapshot().previewSessionId, 'A-preview-session', 'missing session retains its pointer so recovery can be retried');
  runtime.setAuth('user-B', 'token-B');
  assert.equal(runtime.hooks.snapshot().workPlans.global, 'B plan', '404 cleanup leaves another account cached state intact');
}

async function main() {
  await testAccountSwitchAndRefresh();
  await testUnownedLegacyCacheIsDiscarded();
  await testInFlightAccountSwitchDoesNotMutateNewAccount();
  await testErrorCleanupIsOwnerScoped();
  console.log('Preview account isolation regression tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
