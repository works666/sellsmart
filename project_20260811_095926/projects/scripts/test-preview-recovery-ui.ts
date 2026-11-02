import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(source, '预览页缺少应用脚本');
const end = source.lastIndexOf('})();');
assert.notEqual(end, -1, '预览页 IIFE 不完整');

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

type RecoveryMeeting = {
  npcId: string; turn: number; completedTasks: string[]; ended: boolean;
  endReason?: string; awaitingFinalReplyFrom?: 'player'; historyMessageIds?: string[];
};
type RecoveryDto = {
  previewSessionId: string; version: number; conversations: Record<string, Array<Record<string, unknown>>>;
  appointments: Array<Record<string, unknown>>; wechat: Record<string, string | null>;
  activeMeeting: RecoveryMeeting | null; customerActivities: { version: 1; serverNow: number; tasks: Array<Record<string, unknown>> };
  npcTestStates: Array<Record<string, unknown>>; approvedVisitPreparationNpcIds: string[];
};

const npcIds = ['P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005'];
const sessionA = '701f74b4-dd93-4eec-9325-83fd9fd6a6f1';
const sessionB = '802f85c5-eea4-4f0d-a346-94ef00e7b7a2';
const appointmentId = '8e17f119-c320-4835-8579-232a9329e1ad';

function recoveryDto(sessionId: string, version: number, activeMeeting: RecoveryMeeting | null, tasks: Array<Record<string, unknown>> = []): RecoveryDto {
  const conversations: RecoveryDto['conversations'] = Object.fromEntries(npcIds.map((npcId) => [npcId, []]));
  conversations['P1-001'] = [
    { messageId: 'previous-visit-npc', role: 'npc', channel: 'visit', text: '上一次拜访的客户发言。', at: 0 },
    { messageId: 'previous-visit-player', role: 'player', channel: 'visit', text: '上一场拜访的玩家发言。', at: 0.5 },
    ...(activeMeeting?.turn ? [
      { messageId: 'visit-npc-1', role: 'npc', channel: 'visit', text: '这次拜访先介绍一下需求。', at: 1 },
      { messageId: 'visit-player-1', role: 'player', channel: 'visit', text: '我先概述一下项目背景。', at: 2 },
    ] : []),
    { messageId: 'email-player-1', role: 'player', channel: 'email', text: '发一份概要。', at: 3, delivery: { responseAction: 'read_no_reply', readStatus: 'read' } },
    { messageId: 'phone-npc-1', role: 'npc', channel: 'work_phone', text: '电话中确认了时间。', at: 4 },
    { messageId: 'wechat-player-1', role: 'player', channel: 'wechat', text: '后续微信联系。', at: 5 },
    { messageId: 'wechat-request-player-1', role: 'player', channel: 'wechat_request', text: '申请添加工作微信。', at: 5.5 },
    { messageId: 'wechat-request-npc-1', role: 'npc', channel: 'wechat_request', text: '我同意添加工作微信。', at: 5.75 },
    { messageId: 'email-player-2', role: 'player', channel: 'email', text: '附件在这里。', at: 6, attachment: { title: '项目概要.pdf', viewed: true, impact: '已查看' } },
  ];
  return {
    previewSessionId: sessionId,
    version,
    conversations,
    appointments: [{ id: appointmentId, npcId: 'P1-001', status: 'accepted', timeWindow: '本周', location: '客户会议室', agenda: '项目需求确认' }],
    wechat: { 'P1-001': 'accepted' },
    activeMeeting: activeMeeting ? { ...activeMeeting, historyMessageIds: activeMeeting.historyMessageIds ?? (activeMeeting.turn ? ['visit-npc-1', 'visit-player-1'] : []) } : null,
    customerActivities: { version: 1, serverNow: Date.now(), tasks },
    npcTestStates: npcIds.map((npcId) => ({ npcId, support: 42, pleasantness: 60, effectiveContactCount: 2, node: 'N2' })),
    approvedVisitPreparationNpcIds: ['P1-001'],
  };
}

function baseLocalState(meeting: RecoveryMeeting | null = { npcId: 'P1-001', turn: 1, completedTasks: [], ended: false }, elapsedMs = 60_000, includeRetry = true) {
  const conversations: Record<string, { email: Array<Record<string, unknown>>; work_phone: Array<Record<string, unknown>>; wechat: Array<Record<string, unknown>>; meeting: Array<Record<string, unknown>>; postal: Array<Record<string, unknown>> }> = Object.fromEntries(npcIds.map((npcId) => [npcId, { email: [], work_phone: [], wechat: [], meeting: [], postal: [] }]));
  conversations['P1-001'].meeting.push({ role: 'player', channel: '拜访', text: '上次本地未确认的一句', messageId: 'failed-player', pending: false, failed: true });
  return {
    screen: 'game', playMode: 'solo', actionPoints: 24, totalSpent: 4,
    timer: { elapsedMs, lastResumedAt: null as number | null, paused: Boolean(meeting), refillsApplied: 0, expired: false, settled: false, started: true, customerActivityTaskId: null, customerActivityPhase: null },
    selectedNpcId: 'P1-001', workspaceMode: 'overview', channel: null, phoneActive: false,
    conversations, wechat: {}, appointments: [], meeting, meetingDraft: '可重新输入的拜访内容',
    visitPreparations: { 'P1-001': '已完成原有拜访准备' }, completedVisits: [],
    previewSessionId: null, previewVersion: 0,
    aiRetry: includeRetry ? { action: 'visit_turn', commandId: 'failed-visit-command', payload: { npcId: 'P1-001', text: '可重新输入的拜访内容' }, kind: 'visit_turn', meta: null } : null,
  };
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createHarness(options: {
  state?: ReturnType<typeof baseLocalState>; sessionId?: string; version?: number;
  initialDto?: RecoveryDto; postResult?: (request: Record<string, unknown>) => Record<string, unknown>;
} = {}) {
  const userA = 'recovery-user-a';
  const state = options.state || baseLocalState();
  const sessionId = options.sessionId || sessionA;
  let currentDto = options.initialDto || recoveryDto(sessionId, 3, { npcId: 'P1-001', turn: 1, completedTasks: [], ended: false });
  let nextGetResponse: { status: number; body: unknown } | null = null;
  let deferNextGet = false;
  let resolveDeferredGet: ((value: ReturnType<typeof response>) => void) | null = null;
  const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const testInputs = new Map<string, { value: string; addEventListener?: () => void }>();
  testInputs.set('meeting-input', { value: '', addEventListener: () => undefined });
  const app = { innerHTML: '' };
  const modalRoot = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const toastRoot = { appendChild: () => undefined };
  const document = {
    hidden: false,
    body: { appendChild: () => undefined },
    getElementById(id: string) { return testInputs.get(id) ?? (id === 'app' ? app : id === 'modal-root' ? modalRoot : id === 'toast-root' ? toastRoot : null); },
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
    addEventListener: () => undefined,
  };
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const controlledNow = Date.now();
  class ControlledDate extends Date { static now() { return controlledNow; } }
  const setUser = (userId: string, token: string, id: string, version: number, savedState = baseLocalState(null)) => {
    localStorage.setItem('weixun_identity', JSON.stringify({ userId }));
    localStorage.setItem('weixun_session', token);
    const suffix = encodeURIComponent(userId);
    sessionStorage.setItem(`project1_interactive_prototype_v10:user:${suffix}`, JSON.stringify({ ownerId: userId, state: savedState }));
    sessionStorage.setItem(`weixun_project1_preview_session_v1:user:${suffix}`, JSON.stringify({ ownerId: userId, id, version }));
  };
  setUser(userA, 'recovery-token-a', sessionId, options.version ?? 2, state);
  let commandCounter = 0;
  let timerCounter = 0;
  const scheduleVmTimer = (callback: (...args: unknown[]) => void, delay = 0) => {
    const id = ++timerCounter;
    if (delay > 0 && delay <= 650) queueMicrotask(callback);
    return id;
  };
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input), method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, method, body });
    if (url.startsWith('/api/project-one-preview/ai?') && method === 'GET') {
      if (deferNextGet) {
        deferNextGet = false;
        return await new Promise<ReturnType<typeof response>>((resolve) => { resolveDeferredGet = resolve; });
      }
      if (nextGetResponse) {
        const next = nextGetResponse; nextGetResponse = null;
        return response(next.status, next.body);
      }
      return response(200, { success: true, data: currentDto });
    }
    if (url === '/api/project-one-preview/ai' && method === 'POST') {
      if (!body) return response(400, { error: 'missing request' });
      const data = options.postResult?.(body) || {
        previewSessionId: sessionId,
        version: Number(body.expectedVersion || 0) + 1,
        action: body.action,
        content: '收到，我再补充说明一下。',
        meeting: { meetingEnded: false, turn: 2, completedTasks: [] },
        npcTestStates: npcIds.map((npcId) => ({ npcId, support: 42, pleasantness: 60, effectiveContactCount: 2, node: 'N2' })),
        customerActivities: { version: 1, serverNow: Date.now(), tasks: [] },
      };
      const event = { type: 'result', data };
      const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
      let read = false;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: encoded }) }) } };
    }
    if (url === '/api/project-one-preview/ai' && method === 'GET') return response(404, { error: 'missing recovery id' });
    if (url === '/api/designer/image-assets') return response(404, { error: 'not configured for unit test' });
    if (url === '/api/game-data/competitor-profiles?project_id=1') return response(404, { error: 'not configured for unit test' });
    return response(404, { error: 'not found' });
  };
  const injected = `${source!.slice(0, end)}
globalThis.__previewRecoveryHooks={
 wait:()=>previewRecoveryPromise,
 refresh:()=>refreshPreview(),
 send:()=>meetingSend(),
 end:()=>endVisit(),
 syncIdentity:()=>syncIdentitySnapshot(),
 setDraft:text=>{state.meetingDraft=text;save()},
 setMeeting:value=>{state.meeting=value;save()},
setVisitMessages:messages=>{state.conversations['P1-001'].meeting=messages;save()},
 recoveryReady:()=>previewRecoveryIsReady(),
 recoveryError:()=>previewRecoveryError,
 renderMeeting:()=>renderMeeting(),
 snapshot:()=>JSON.parse(JSON.stringify({owner:stateOwnerUserId,id:state.previewSessionId,version:state.previewVersion,meeting:state.meeting,draft:state.meetingDraft,timer:state.timer,conversations:state.conversations,appointments:state.appointments,wechat:state.wechat,activities:state.customerActivities,completedVisits:state.completedVisits,retry:state.aiRetry,requestBusy,previewRecoveryPending,previewRecoveryError,screen:state.screen,workspaceMode:state.workspaceMode,selectedNpcId:state.selectedNpcId})),
};
})();`;
  const context = vm.createContext({
    console, document, localStorage, sessionStorage, fetch,
    window: { matchMedia: () => ({ matches: false }), addEventListener: () => undefined },
    AbortController, TextDecoder, TextEncoder, URL, Event, Math, Date: ControlledDate,
    crypto: { randomUUID: () => `recovery-command-${++commandCounter}` },
    setTimeout: scheduleVmTimer, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined,
    requestAnimationFrame: () => 0, performance: { now: () => 0 },
  });
  vm.runInContext(injected, context, { filename: 'project1-prototype-v9.recovery.js' });
  const hooks = vm.runInContext('globalThis.__previewRecoveryHooks', context) as {
    wait: () => Promise<unknown> | null; refresh: () => Promise<boolean>; send: () => Promise<unknown>; end: () => Promise<unknown>;
    syncIdentity: () => boolean; setDraft: (text: string) => void; setMeeting: (meeting: unknown) => void; setVisitMessages: (messages: Array<Record<string, unknown>>) => void;
    recoveryReady: () => boolean; recoveryError: () => string; renderMeeting: () => string;
    snapshot: () => { owner: string; id: string | null; version: number; meeting: null | { npcId: string; turn: number; awaitingFinalReplyFrom?: string; historyMessageIds?: string[] }; draft: string; timer: { elapsedMs: number; paused: boolean }; conversations: Record<string, Record<string, Array<Record<string, unknown>>>>; appointments: Array<Record<string, unknown>>; wechat: Record<string, unknown>; activities: { tasks: Array<Record<string, unknown>> }; completedVisits: Array<Record<string, unknown>>; retry: unknown; requestBusy: boolean; previewRecoveryPending: boolean; previewRecoveryError: string; screen: string; workspaceMode: string; selectedNpcId: string | null };
  };
  return {
    hooks, requests, localStorage, sessionStorage, setUser,
    setDto(dto: RecoveryDto) { currentDto = dto; },
    setGetFailure(status: number, body: unknown = { error: 'temporary recovery failure' }) { nextGetResponse = { status, body }; },
    deferGet() { deferNextGet = true; },
    resolveDeferredGet(dto: RecoveryDto) { assert.ok(resolveDeferredGet, '没有挂起中的恢复 GET'); resolveDeferredGet(response(200, { success: true, data: dto })); resolveDeferredGet = null; },
    input: testInputs.get('meeting-input')!,
    app,
  };
}

async function waitForBoot(harness: ReturnType<typeof createHarness>) {
  const pending = harness.hooks.wait();
  if (pending) await pending;
}

async function testVersionRecoveryAndVisitFlow() {
  let serverMeeting: RecoveryMeeting = { npcId: 'P1-001', turn: 1, completedTasks: [], ended: false };
  const harness = createHarness({
    postResult: (request) => {
      const text = String(request.text || '');
      const ending = text.startsWith('谢谢您的时间');
      serverMeeting = { npcId: 'P1-001', turn: ending ? 3 : 2, completedTasks: [], ended: ending, ...(ending ? { endReason: 'player_farewell' } : {}) };
      const data = { previewSessionId: sessionA, version: ending ? 5 : 4, action: request.action, content: ending ? '' : '收到，我再补充说明一下。', meeting: { meetingEnded: ending, turn: serverMeeting.turn, completedTasks: [], ...(ending ? { endReason: 'player_farewell' } : {}) }, appointment: ending ? { id: appointmentId, npcId: 'P1-001', status: 'completed', timeWindow: '本周', location: '客户会议室', agenda: '项目需求确认' } : undefined, npcTestStates: npcIds.map((npcId) => ({ npcId, support: 42, pleasantness: 60, effectiveContactCount: 2, node: 'N2' })), customerActivities: { version: 1, serverNow: Date.now(), tasks: [] } };
      return data;
    },
  });
  await waitForBoot(harness);
  const restored = harness.hooks.snapshot();
  assert.equal(restored.id, sessionA, 'GET 恢复保持原预览会话 ID');
  assert.equal(restored.version, 3, '旧版 v2 在 GET 后更新为服务端 v3');
  assert.equal(restored.meeting?.turn, 1, '活动拜访轮次以服务端状态恢复');
  assert.equal(restored.meeting?.npcId, 'P1-001', '活动拜访人物恢复');
  assert.equal(restored.appointments[0]?.location, '客户会议室', '服务端预约地点恢复');
  assert.equal(restored.wechat['P1-001'], 'accepted', '服务端微信状态恢复');
  assert.equal(restored.conversations['P1-001'].meeting.length, 4, '服务端恢复保留完整拜访历史供记录使用');
  assert.deepEqual(Array.from(restored.meeting?.historyMessageIds || []), ['visit-npc-1', 'visit-player-1'], '恢复状态仅标出本次拜访的真实消息 ID');
  assert.match(harness.hooks.renderMeeting(), /这次拜访先介绍一下需求/, '恢复后显示本次拜访客户发言');
  assert.match(harness.hooks.renderMeeting(), /我先概述一下项目背景/, '恢复后显示本次拜访玩家发言');
  assert.doesNotMatch(harness.hooks.renderMeeting(), /上一次拜访|上一场拜访/, '恢复后的拜访界面隐藏上一场双方发言');
  assert.equal(restored.conversations['P1-001'].email.length, 2, 'email channel 仍写入 email 列表');
  assert.equal(restored.conversations['P1-001'].work_phone.length, 1, 'work_phone channel 仍写入 work_phone 列表');
  assert.equal(restored.conversations['P1-001'].wechat.length, 3, 'wechat 与 wechat_request channel 都写入 wechat 列表');
  assert.equal(restored.conversations['P1-001'].wechat[1]?.messageId, 'wechat-request-player-1', '微信申请记录按真实 DTO channel 恢复');
  assert.equal(restored.conversations['P1-001'].wechat[2]?.messageId, 'wechat-request-npc-1', '微信申请回复按真实 DTO channel 恢复');
  assert.equal(restored.conversations['P1-001'].email[0]?.responseAction, 'read_no_reply', '恢复已读不回标记，不补造 NPC 回复');
  assert.equal(restored.conversations['P1-001'].email[1]?.attachment, '项目概要.pdf · 对方已查看；影响：已查看', '附件恢复成可读文字而非对象占位符');
  assert.equal(restored.draft, '可重新输入的拜访内容', '未确认玩家输入保留为可重输草稿');
  assert.equal(restored.retry, null, '恢复后清除可能过期的自动重试动作');
  assert.equal(harness.requests.filter((request) => request.url === '/api/project-one-preview/ai' && request.method === 'POST').length, 0, 'boot 恢复不重放 POST 或 reset');
  assert.equal(harness.hooks.recoveryReady(), true, '服务端快照应用后允许继续操作');
  assert.match(harness.app.innerHTML, /同步预览会话/, '沉浸拜访页面始终可见手动同步按钮');

  harness.setGetFailure(404, { error: 'missing session' });
  await harness.hooks.refresh();
  const failed = harness.hooks.snapshot();
  assert.equal(failed.id, sessionA, '404 恢复失败保留原会话 ID');
  assert.equal(failed.meeting?.turn, 1, '恢复失败不覆盖本地拜访进度');
  assert.equal(failed.draft, '可重新输入的拜访内容', '恢复失败仍保留拜访草稿');
  assert.equal(failed.retry, null, '恢复失败不会保留自动重放指令');
  assert.match(failed.previewRecoveryError, /本地会话编号和进度已保留/, '404 错误提供可见保留提示');
  assert.match(harness.hooks.renderMeeting(), /同步未完成/, '沉浸页面显示失败状态和再次同步入口');
  assert.equal(harness.requests.filter((request) => request.url === '/api/project-one-preview/ai' && request.method === 'POST').length, 0, '恢复失败不触发 POST');

  harness.setDto(recoveryDto(sessionA, 4, serverMeeting));
  harness.input.value = '我再补充一项实际需求。';
  await harness.hooks.refresh();
  assert.equal(harness.hooks.snapshot().version, 4, '显式同步后采用最新服务端版本');
  await harness.hooks.send();
  assert.equal(harness.requests.filter((request) => request.url === '/api/project-one-preview/ai' && request.method === 'POST').at(-1)?.body?.expectedVersion, 4, '后续拜访回复使用 GET 更新后的版本');
  assert.equal(harness.hooks.snapshot().meeting?.turn, 2, '恢复的拜访仍可继续回复');
  assert.match(harness.hooks.renderMeeting(), /我再补充一项实际需求/, '发送后本地玩家消息仍显示在本场对话');
  assert.match(harness.hooks.renderMeeting(), /收到，我再补充说明一下/, '发送后流式回应仍显示在本场对话');
  assert.doesNotMatch(harness.hooks.renderMeeting(), /上一次拜访|上一场拜访/, '本地新消息不会让旧拜访历史重新出现');
  await harness.hooks.end();
  const ended = harness.hooks.snapshot();
  assert.equal(ended.meeting, null, '主动告辞正常结束恢复后的拜访');
  assert.equal(ended.timer.paused, false, '结束拜访后倒计时恢复');
  assert.equal(ended.timer.elapsedMs, 105_000, '三轮对话只扣一次 45 秒');
  const completedCount = ended.completedVisits.length;
  const elapsedAfterEnd = ended.timer.elapsedMs;
  await harness.hooks.refresh();
  await harness.hooks.refresh();
  assert.equal(harness.hooks.snapshot().timer.elapsedMs, elapsedAfterEnd, '重复读取 ended 会话不重复扣时');
  assert.equal(harness.hooks.snapshot().completedVisits.length, completedCount, '重复读取 ended 会话不重复记完成拜访');
  assert.equal(harness.requests.filter((request) => request.url === '/api/project-one-preview/ai' && request.method === 'POST').length, 2, '仅显式发送回复与告辞各提交一次');
}

async function testNewVisitBoundaryDoesNotRestoreOldDraft() {
  const state = baseLocalState({ npcId: 'P1-001', turn: 0, completedTasks: [], ended: false, historyMessageIds: [] }, 60_000, false);
  state.meetingDraft = '';
  state.conversations['P1-001'].meeting = [{ messageId: 'stale-failed-player', role: 'player', channel: '拜访', text: '上一场失败的玩家草稿', pending: false, failed: true }];
  const harness = createHarness({
    state,
    initialDto: recoveryDto(sessionA, 3, { npcId: 'P1-001', turn: 0, completedTasks: [], ended: false, historyMessageIds: [] }),
  });
  await waitForBoot(harness);
  const restored = harness.hooks.snapshot();
  assert.equal(restored.meeting?.turn, 0, '新拜访在首轮前仍处于 turn 0');
  assert.deepEqual(Array.from(restored.meeting?.historyMessageIds || []), [], '新拜访服务端边界为空');
  assert.equal(restored.draft, '', '恢复不会从上一场失败消息提取旧草稿');
  assert.equal(restored.conversations['P1-001'].meeting.length, 2, '旧拜访历史仍保留在完整记录中');
  assert.match(harness.hooks.renderMeeting(), /正在等你开场/, '新拜访首轮显示开场提示');
  assert.doesNotMatch(harness.hooks.renderMeeting(), /上一次拜访|上一场拜访|失败的玩家草稿/, '新拜访首轮不显示旧客户、玩家台词或草稿');

  harness.hooks.setVisitMessages([
    { messageId: 'visit-player-local-1', role: 'player', channel: '拜访', text: '本场新的玩家发言。' },
    { messageId: 'visit-npc-local-1', role: 'npc', channel: '拜访', text: '本场新的客户回应。' },
  ]);
  harness.hooks.setMeeting({ ...restored.meeting, turn: 1, historyMessageIds: ['visit-player-local-1', 'visit-npc-local-1'] });
  assert.match(harness.hooks.renderMeeting(), /本场新的玩家发言/, '新发出的本地玩家消息按本场边界显示');
  assert.match(harness.hooks.renderMeeting(), /本场新的客户回应/, '新到达的本地客户回应按本场边界显示');
  assert.doesNotMatch(harness.hooks.renderMeeting(), /上一场拜访/, '本地消息不污染本场边界');
}

async function testEndedRecoveryDebitsOnce() {
  const ended: RecoveryMeeting = { npcId: 'P1-001', turn: 2, completedTasks: ['提问'], ended: true, endReason: 'player_farewell' };
  const harness = createHarness({ initialDto: recoveryDto(sessionA, 3, ended), state: baseLocalState({ npcId: 'P1-001', turn: 1, completedTasks: [], ended: false }, 60_000) });
  await waitForBoot(harness);
  const restored = harness.hooks.snapshot();
  assert.equal(restored.meeting, null, '服务端已结束的拜访恢复到工作台');
  assert.equal(restored.workspaceMode, 'overview', '已结束拜访退出沉浸视图');
  assert.equal(restored.timer.elapsedMs, 90_000, '已结束拜访按服务端两轮只扣 30 秒');
  assert.equal(restored.timer.paused, false, '已结束拜访恢复倒计时');
  assert.equal(restored.completedVisits.length, 1, '已结束拜访记录一次');
  await harness.hooks.refresh();
  assert.equal(harness.hooks.snapshot().timer.elapsedMs, 90_000, '后续重复恢复不会再次扣除两轮时间');
  assert.equal(harness.hooks.snapshot().completedVisits.length, 1, '后续重复恢复不会重复完成记录');
}

async function testActiveRecoveryKeepsTimerPausedDuringSubmittedActivity() {
  const submittedAt = Date.now() - 10_000;
  const submitted = { id: 'activity-submitted', conversationId: 'conversation-1', npcId: 'P1-001', type: 'technical_meeting', summary: '活动提议已匹配', basis: ['双方同意'], status: 'submitted', createdAt: submittedAt - 50_000, startedAt: submittedAt - 40_000, deadlineAt: submittedAt - 10_000, draft: '策划方案', submittedAt, submitReason: 'manual', evaluation: { overallEvaluation: '方案整体匹配' }, evaluatedAt: submittedAt };
  const state = baseLocalState(null, 120_000);
  state.timer.paused = false;state.timer.lastResumedAt = Date.now() - 60_000;
  const harness = createHarness({ state, initialDto: recoveryDto(sessionA, 3, { npcId: 'P1-001', turn: 1, completedTasks: [], ended: false }, [submitted]) });
  await waitForBoot(harness);
  assert.equal(harness.hooks.snapshot().meeting?.turn, 1, '无本地会面时可按服务端活动会面恢复');
  assert.equal(harness.hooks.snapshot().timer.paused, true, '活动会面恢复后仍暂停项目倒计时');
  assert.equal(harness.hooks.snapshot().timer.elapsedMs, 120_000, '历史已提交活动不会补算拜访期间时间');
}

async function testStaleGetCannotCrossIdentityGeneration() {
  const harness = createHarness();
  await waitForBoot(harness);
  const stateB = baseLocalState(null, 0);
  stateB.conversations['P1-001'].email.push({ role: 'player', channel: '邮件', text: 'B account local state' });
  harness.setUser('recovery-user-b', 'recovery-token-b', sessionB, 7, stateB);
  // Switch back to A for the pending GET, then use a second account in storage while it is in flight.
  harness.localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'recovery-user-a' }));
  harness.localStorage.setItem('weixun_session', 'recovery-token-a');
  harness.hooks.syncIdentity();
  harness.deferGet();
  const staleRefresh = harness.hooks.refresh();
  assert.equal(harness.hooks.snapshot().previewRecoveryPending, true, '手动同步期间 GET 标记为 pending');
  harness.localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'recovery-user-b' }));
  harness.localStorage.setItem('weixun_session', 'recovery-token-b');
  assert.equal(harness.hooks.syncIdentity(), true, '账号切换使旧请求代际失效');
  harness.resolveDeferredGet(recoveryDto(sessionA, 99, { npcId: 'P1-001', turn: 99, completedTasks: [], ended: false }));
  await staleRefresh;
  const current = harness.hooks.snapshot();
  assert.equal(current.owner, 'recovery-user-b', '状态仍属于新账号');
  assert.equal(current.id, sessionB, '旧账号 GET 不覆盖新账号会话 ID');
  assert.equal(current.version, 7, '旧账号 GET 不覆盖新账号的本地版本');
  assert.equal(current.meeting, null, '旧账号 GET 不覆盖新账号页面状态');
  assert.equal(current.conversations['P1-001'].email[0]?.text, 'B account local state', '旧账号 GET 不污染新账号对话');
}

async function testFinalPlayerReplyRestores() {
  const finalReplyMeeting = { npcId: 'P1-001', turn: 1, completedTasks: ['提问'], ended: false, awaitingFinalReplyFrom: 'player' as const };
  const harness = createHarness({
    initialDto: recoveryDto(sessionA, 3, finalReplyMeeting),
    postResult: (request) => ({ previewSessionId: sessionA, version: 4, action: request.action, content: '', meeting: { meetingEnded: true, endReason: 'npc_farewell', turn: 2, completedTasks: ['提问'] }, appointment: { id: appointmentId, npcId: 'P1-001', status: 'completed', timeWindow: '本周', location: '客户会议室', agenda: '项目需求确认' }, npcTestStates: npcIds.map((npcId) => ({ npcId, support: 42, pleasantness: 60, effectiveContactCount: 2, node: 'N2' })), customerActivities: { version: 1, serverNow: Date.now(), tasks: [] } }),
  });
  await waitForBoot(harness);
  assert.equal(harness.hooks.snapshot().meeting?.awaitingFinalReplyFrom, 'player', '恢复最终回复状态');
  assert.match(harness.hooks.renderMeeting(), /最后回应一次/, '拜访页提示玩家可以最后回应');
  harness.input.value = '好的，我确认后今天发您邮件。';
  await harness.hooks.send();
  assert.equal(harness.requests.filter((request) => request.url === '/api/project-one-preview/ai' && request.method === 'POST').length, 1, '最终回复提交一次');
  assert.equal(harness.hooks.snapshot().meeting, null, '最终回复后回到工作台');
  assert.equal(harness.hooks.snapshot().timer.elapsedMs, 90_000, '最终回复按服务端两轮只扣一次 30 秒');
}

async function main() {
  let currentTest = '版本恢复与拜访流程';
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await testVersionRecoveryAndVisitFlow();
        currentTest = '新拜访消息边界';
        await testNewVisitBoundaryDoesNotRestoreOldDraft();
        currentTest = '已结束拜访恢复';
        await testEndedRecoveryDebitsOnce();
        currentTest = '活动拜访与倒计时';
        await testActiveRecoveryKeepsTimerPausedDuringSubmittedActivity();
        currentTest = '身份切换隔离';
        await testStaleGetCannotCrossIdentityGeneration();
        currentTest = 'NPC 最终回复恢复';
        await testFinalPlayerReplyRestores();
      })(),
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error(`测试等待未结束（${currentTest}）`)), 15_000);
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
  console.log('预览会话恢复 GET、分渠道拜访恢复、失败保留、身份隔离与倒计时幂等回归通过');
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
