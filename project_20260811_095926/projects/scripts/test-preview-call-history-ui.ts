import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length, 'preview HTML should contain its application script');
const inlineScript = scripts.at(-1)![1];
const bootTail = inlineScript.indexOf("window.addEventListener('storage'");
assert.notEqual(bootTail, -1, 'preview startup listeners should be present');

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

type RouteReply = (request: Record<string, unknown>) => unknown;
type PhoneCallRecord = { status: string };
type PreviewSnapshot = {
  phoneActive: boolean;
  phoneHistory: Record<string, PhoneCallRecord[]>;
  aiRetry: { kind: string; commandId: string } | null;
};

function sseResponse(data: Record<string, unknown>, delta = '') {
  const encoder = new TextEncoder();
  const events = [
    ...(delta ? [{ type: 'delta', content: delta }] : []),
    { type: 'result', data },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  });
  return { status: 200, ok: true, body };
}

function sseFailure(delta: string) {
  const encoder = new TextEncoder();
  const events = [
    { type: 'delta', content: delta },
    { type: 'error', status: 503, error: 'provider temporarily unavailable' },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(events));
      controller.close();
    },
  });
  return { status: 200, ok: true, body };
}

function createRuntime(sessionStorage = new MemoryStorage(), replies: RouteReply[] = []) {
  const localStorage = new MemoryStorage();
  localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'phone-history-test' }));
  localStorage.setItem('weixun_session', 'test-session-token');
  const app = { innerHTML: '' };
  const modal = { innerHTML: '' };
  const toast = { appendChild: (_element: unknown) => undefined };
  const document = {
    body: { appendChild: (_element: unknown) => undefined },
    getElementById(id: string) {
      if (id === 'app') return app;
      if (id === 'modal-root') return modal;
      if (id === 'toast-root') return toast;
      return null;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
  };
  let commandIndex = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    assert.equal(url, '/api/project-one-preview/ai', 'only the preview AI route is called');
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected preview request: ${String(request.action)}`);
    return reply(request);
  };
  const testHooksSource = `
    globalThis.__previewTestHooks={
      snapshot:()=>JSON.parse(JSON.stringify(state)),
      reloadFromStorage:()=>{state=loadState(activeUserId);activePhoneCallId=null},
      renderPhone:()=>renderPhone(),
      callNpc:()=>callNpc(),
      retry:()=>retryAiRequest(),
      phoneSay:options=>phoneSay(options),
      endCall:()=>{finishActivePhoneCall();save()},
      chooseWorkspace:mode=>chooseWorkspace(mode),
      activeCallId:()=>activePhoneCallId,
      setState:patch=>{state={...state,...patch};save()},
      storedState:()=>JSON.parse(sessionStorage.getItem('project1_interactive_prototype_v10:user:phone-history-test')||'null')?.state
    };
  `;
  const instrumentedScript = `${inlineScript.slice(0, bootTail)}${testHooksSource}\n})();`;
  const context = vm.createContext({
    console,
    document,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage,
    sessionStorage,
    fetch,
    AbortController,
    TextDecoder,
    TextEncoder,
    ReadableStream,
    URL,
    Event,
    Date,
    Math,
    crypto: { randomUUID: () => `call-command-${++commandIndex}` },
    setTimeout: (callback: () => void) => { callback(); return 0; },
    clearTimeout: () => undefined,
  });
  vm.runInContext(instrumentedScript, context, { filename: 'project1-prototype-v9.inline.js' });
  const hooks = vm.runInContext('globalThis.__previewTestHooks', context) as {
    snapshot: () => PreviewSnapshot;
    reloadFromStorage: () => void;
    renderPhone: () => string;
    callNpc: () => Promise<void>;
    retry: () => Promise<void>;
    phoneSay: (options: Record<string, unknown>) => Promise<void>;
    endCall: () => void;
    chooseWorkspace: (mode: string) => void;
    activeCallId: () => string | null;
    setState: (patch: Record<string, unknown>) => void;
    storedState: () => Pick<PreviewSnapshot, 'phoneActive' | 'phoneHistory'>;
  };
  const setReplies = (...items: RouteReply[]) => replies.push(...items);
  return { hooks, sessionStorage, setReplies };
}

async function main() {
  const sessionStorage = new MemoryStorage();
  sessionStorage.setItem('project1_interactive_prototype_v10:user:phone-history-test', JSON.stringify({
    ownerId: 'phone-history-test',
    state: {
      screen: 'game',
      selectedNpcId: 'P1-001',
      workspaceMode: 'work_phone',
      phoneActive: true,
      phoneAttempts: { 'P1-001': 2 },
      conversations: {
        'P1-001': {
          work_phone: [
            { role: 'player', channel: '电话', text: '旧玩家通话正文不应再出现' },
            { role: 'npc', channel: '电话', text: '旧 NPC 通话正文不应再出现' },
          ],
        },
      },
    },
  }));

  const runtime = createRuntime(sessionStorage);
  const { hooks } = runtime;
  const restored = hooks.snapshot();
  assert.equal(restored.phoneActive, false, 'refresh must not restore an active call');
  assert.equal(restored.phoneHistory['P1-001'].length, 2, 'legacy call counts migrate to metadata rows');
  assert.equal(restored.phoneHistory['P1-001'][0].status, 'legacy', 'legacy rows disclose no inferred transcript state');
  let phoneHtml = hooks.renderPhone();
  assert.match(phoneHtml, /历史通话记录/, 'the phone panel shows a call history section');
  assert.match(phoneHtml, /时间未记录/, 'legacy history is honest about unavailable timestamps');
  assert.doesNotMatch(phoneHtml, /旧玩家通话正文|旧 NPC 通话正文/, 'refresh does not reveal persisted call bodies');

  runtime.setReplies(request => {
    assert.equal(request.action, 'phone_connect');
    return sseFailure('失败流中的正文也不得作为历史内容展示');
  });
  await hooks.callNpc();
  let state = hooks.snapshot();
  assert.equal(state.phoneHistory['P1-001'][2].status, 'failed', 'failed connection is retained as metadata');
  phoneHtml = hooks.renderPhone();
  assert.match(phoneHtml, /连接失败/, 'failed call status remains visible');
  assert.doesNotMatch(phoneHtml, /失败流中的正文/, 'partial failed response stays hidden');
  const failedRetry = state.aiRetry;
  assert.ok(failedRetry, 'failed connection retains retry metadata');
  assert.equal(failedRetry.kind, 'phone_connect', 'failed dial keeps its idempotent retry');

  runtime.setReplies(request => {
    assert.equal(request.action, 'phone_connect');
    assert.equal(request.commandId, failedRetry.commandId, 'retry reuses the failed call command');
    return sseResponse({ connected: true, content: '本次接通开场内容' }, '本次实时流内容');
  });
  await hooks.retry();
  state = hooks.snapshot();
  assert.equal(state.phoneHistory['P1-001'][2].status, 'connected', 'successful retry updates the same history row');
  assert.ok(hooks.activeCallId(), 'a connected call has an in-memory call ID');
  phoneHtml = hooks.renderPhone();
  assert.match(phoneHtml, /本次接通开场内容/, 'the current call can show its live NPC dialogue');
  assert.doesNotMatch(phoneHtml, /第 3 次/, 'the active call is not listed as historical');
  assert.doesNotMatch(phoneHtml, /旧玩家通话正文|旧 NPC 通话正文/, 'old transcript remains hidden during a new call');

  runtime.setReplies(request => {
    assert.equal(request.action, 'message');
    return sseResponse({ content: '本次 NPC 回应', invitationStatus: 'none' }, '本次玩家内容');
  });
  await hooks.phoneSay({ payload: { npcId: 'P1-001', channel: 'work_phone', text: '本次玩家内容', phase: 1 } });
  phoneHtml = hooks.renderPhone();
  assert.match(phoneHtml, /本次玩家内容/, 'current player speech remains visible during the call');
  assert.match(phoneHtml, /本次 NPC 回应/, 'current NPC speech remains visible during the call');

  const savedWhileConnected = hooks.storedState();
  assert.equal(savedWhileConnected.phoneActive, false, 'the saved browser snapshot never records a live phone session');
  const refreshedDuringCall = createRuntime(sessionStorage);
  refreshedDuringCall.hooks.reloadFromStorage();
  assert.equal(refreshedDuringCall.hooks.snapshot().phoneActive, false, 'a page refresh drops the active phone state');
  assert.equal(refreshedDuringCall.hooks.snapshot().phoneHistory['P1-001'][2].status, 'interrupted', 'an in-progress persisted call is marked interrupted');
  const refreshedHtml = refreshedDuringCall.hooks.renderPhone();
  assert.doesNotMatch(refreshedHtml, /本次接通开场内容|本次实时流内容|本次玩家内容|本次 NPC 回应/, 'refresh never re-exposes any body from the interrupted call');

  hooks.endCall();
  state = hooks.snapshot();
  assert.equal(state.phoneHistory['P1-001'][2].status, 'ended', 'hang-up closes the metadata record');
  phoneHtml = hooks.renderPhone();
  assert.doesNotMatch(phoneHtml, /本次接通开场内容|本次玩家内容|本次 NPC 回应/, 'hang-up hides the completed call transcript');
  hooks.chooseWorkspace('email');
  hooks.chooseWorkspace('work_phone');
  assert.doesNotMatch(hooks.renderPhone(), /本次接通开场内容|本次玩家内容|本次 NPC 回应/, 'switching back to phone still shows metadata only');

  runtime.setReplies(request => {
    assert.equal(request.action, 'phone_connect');
    return sseResponse({ connected: false, content: '未接通回复正文' });
  });
  await hooks.callNpc();
  state = hooks.snapshot();
  assert.equal(state.phoneHistory['P1-001'][3].status, 'not_answered', 'unanswered dials get a visible metadata status');
  phoneHtml = hooks.renderPhone();
  assert.match(phoneHtml, /未接通/, 'unanswered call appears in history');
  assert.doesNotMatch(phoneHtml, /未接通回复正文/, 'unanswered call content is not displayed');

  console.log('Preview phone history UI behavior regression passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
