import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import strictAssert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const route = readFileSync(resolve(process.cwd(), 'src/app/api/project-one-preview/ai/route.ts'), 'utf8');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(html.includes('data-action="test-controls"'), '顶部缺少测试调节入口');
assert(html.includes('data-action="skip-visit-prep"'), '拜访准备页缺少跳过准备直接拜访入口');
assert(html.includes("if(a==='skip-visit-prep')return startVisitSimulation({skipPreparation:true})"), '跳过准备入口没有进入实际拜访');
assert(html.includes('id="test-remaining-seconds" type="number" min="0" max="1200"'), '缺少倒计时范围控制');
assert(html.includes('id="test-action-points" type="number" min="0" max="28"'), '缺少行动点上限控制');
assert(html.includes('id="test-total-spent" type="number" min="0" max="9999"'), '缺少累计消耗范围控制');
assert(html.includes("[['','未添加'],['accepted','已添加'],['pending','待处理'],['rejected','已拒绝']]"), '微信测试状态选项不完整');
assert(html.includes('data-test-field="support" type="number" min="0" max="100"'), '缺少 NPC 支持度控制');
assert(html.includes('data-test-field="pleasantness" type="number" min="0" max="100"'), '缺少 NPC 愉悦度控制');
assert(html.includes('data-test-field="effectiveContactCount" type="number" min="0" max="100"'), '缺少 NPC 有效接触次数控制');
assert(html.includes('data-test-npc-enable='), '缺少逐 NPC 显式覆盖开关');
assert(html.includes("MockData.npcs.filter(person=>enabledNpcIds.has(person.id))"), '未勾选人物仍会被 NPC 测试调节覆盖');
assert(html.includes('data-test-appointment-enable='), '缺少逐联系人预约覆盖开关');
assert(html.includes('data-test-appointment-field="status"'), '缺少预约状态控制');
assert(!html.includes('data-test-appointment-field="phase"'), '预约不应再包含阶段控制');
assert(html.includes('data-test-appointment-field="location"'), '缺少预约地点控制');
assert(html.includes('test_adjust_appointments'), '缺少预约测试调节 action');
assert(html.includes('Array.isArray(response.appointments)'), '没有接收服务端返回的预约状态');
assert(html.includes('function parsePreviewNpcTestStates(value)'), '缺少严格校验的服务端 NPC 状态快照解析');
assert(html.includes('if(data.npcTestStates!==undefined)applyPreviewNpcTestStates(data.npcTestStates)'), '预览 AI 响应没有同步权威 NPC 状态');
assert(html.includes('/api/project-one-preview/ai?previewSessionId=${encodeURIComponent(sessionId)}'), '没有通过会话恢复接口读取 NPC 状态');
assert(html.includes("updateTestNpcStateUi('服务端没有提供完整的 NPC 状态快照；已隐藏本地缓存值。请确认设计师权限后重试。','unavailable')"), '服务端未返回 NPC 快照时未隐藏缓存值');
assert(html.includes('id="refresh-test-npc-states"'), '测试调节面板缺少刷新当前值入口');
assert(route.includes("['test_adjust_npcs', 'test_adjust_appointments'].includes(parsed.data.action) && !isFastDebugEnabled()"), '生产环境没有默认关闭测试调节 action');
assert(html.includes("if(value)state.wechat[id]=value;else delete state.wechat[id]"), '微信状态没有写入本地测试状态');
assert(html.includes("if(state.wechat[n.id]==='accepted')return renderMessageWorkspace('wechat')"), '已添加状态不能直接进入微信对话');
assert(html.includes('function syncCountdown(now=Date.now()'), '倒计时同步逻辑缺失');
assert(html.includes('pauseCountdown();'), '进入实际拜访时没有暂停倒计时');
assert(html.includes('resumeCountdown(turn)'), '结束拜访时没有按轮次恢复倒计时');
assert(html.includes('const immersive=Boolean(state.meeting);'), '进行中的拜访没有切换到沉浸式页面壳');
assert(html.includes('class="visit-immersive"'), '缺少近全视口沉浸式拜访画面');
assert(html.includes("uploadedImageUrls['visit_scene:leader_office']||uploadedImageUrls['visit_scene:office']"), '张建国办公室没有优先读取专用场景并回退办公室场景');
assert(html.includes('person_expression:${person?.id}:${expression}'), '人物表情素材键没有按 NPC 和表情读取');
assert(html.includes("['angry','serious','calm','pleasant','very_happy']"), '前端没有限制为安全的五档表情枚举');
assert(html.includes('id="meeting-input"'), '沉浸式拜访缺少自由文本输入框');
assert(html.includes('data-action="meeting-send"'), '沉浸式拜访缺少发送入口');
assert(html.includes('data-action="end-visit"'), '沉浸式拜访缺少主动告辞入口');
assert(html.includes('entryTransitionUntil'), '进入拜访缺少一次性入场过场状态');
assert(html.includes("prefers-reduced-motion: reduce"), '过场没有尊重减少动态效果偏好');
assert(html.includes('.visit-composer{display:grid;grid-template-columns:minmax(0,1fr) auto;'), '沉浸式输入区缺少防溢出布局');
assert(html.includes('function refreshWorkspaceBody(){if(state.meeting){render();return}'), '进入或更新拜访后没有刷新完整沉浸式画面');

const applyStart = html.indexOf('async function applyTestControls(){');
const handlerStart = html.indexOf('\nasync function handleAction', applyStart);
assert(applyStart >= 0 && handlerStart > applyStart, '测试值应用函数缺失');
const applySource = html.slice(applyStart, handlerStart);
assert(applySource.indexOf('accountScopedApiCall(action') < applySource.indexOf('state.actionPoints=actionPoints'), '服务端同步失败前不应先提交本地测试值');
assert(applySource.includes('save();closeModal();render()'), '测试值没有保存并刷新界面');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert(scripts.length > 0, '未找到内联脚本');
for (const [, source] of scripts) new Function(source);

const npcIds = ['P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005'];
const npcSnapshot = (supportBase: number, pleasantnessBase: number) => npcIds.map((npcId, index) => ({
  npcId,
  support: supportBase + index,
  pleasantness: pleasantnessBase + index,
  effectiveContactCount: index,
  node: index === 0 ? 'N1' : 'N2',
}));

function recoveryBody(sessionId: string, version: number, npcTestStates: ReturnType<typeof npcSnapshot>) {
  return {
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
      npcTestStates,
    },
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

function createRuntime(sessionStorage: MemoryStorage, replies: ((url: string, init?: RequestInit) => unknown)[]) {
  const localStorage = new MemoryStorage();
  localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'test-controls-user' }));
  localStorage.setItem('weixun_session', 'test-session-token');
  const app = { innerHTML: '' };
  const modal = {
    innerHTML: '',
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
  const toast = { appendChild: (_element: unknown) => undefined };
  const elements = new Map<string, { innerHTML?: string; value?: string; textContent?: string; disabled?: boolean; onclick?: () => void }>();
  const toggles = new Map(npcIds.map(npcId => [npcId, {
    dataset: { testNpcEnable: npcId }, checked: false, disabled: false,
    addEventListener: (_event: string, _callback: () => void) => undefined,
  }]));
  const metrics = new Map(npcIds.flatMap(npcId => ['support', 'pleasantness', 'effectiveContactCount'].map(field => [
    `${npcId}:${field}`,
    { dataset: { testNpc: npcId, testField: field }, value: '', disabled: true },
  ])));
  const nodes = new Map(npcIds.map(npcId => [npcId, { textContent: '—' }]));
  const document = {
    body: { appendChild: (_element: unknown) => undefined },
    getElementById(id: string) {
      if (id === 'app') return app;
      if (id === 'modal-root') return modal;
      if (id === 'toast-root') return toast;
      const metricMatch = id.match(/^test-(support|pleasantness|contact)-(P1-00[1-5])$/);
      if (metricMatch) return metrics.get(`${metricMatch[2]}:${metricMatch[1] === 'contact' ? 'effectiveContactCount' : metricMatch[1]}`);
      if (id !== 'test-npc-state-status' && id !== 'refresh-test-npc-states' && id !== 'apply-test-controls' && !id.startsWith('test-')) return null;
      if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false });
      return elements.get(id)!;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-test-npc-enable]' || selector === '[data-test-npc-enable]:checked') {
        const all = [...toggles.values()];
        return selector.endsWith(':checked') ? all.filter(toggle => toggle.checked) : all;
      }
      const npcMatch = selector.match(/^\[data-test-npc="(P1-00[1-5])"\]$/);
      if (npcMatch) return ['support', 'pleasantness', 'effectiveContactCount'].map(field => metrics.get(`${npcMatch[1]}:${field}`)!);
      return [] as unknown[];
    },
    querySelector(selector: string) {
      const toggleMatch = selector.match(/^\[data-test-npc-enable="(P1-00[1-5])"\]$/);
      if (toggleMatch) return toggles.get(toggleMatch[1]) || null;
      const nodeMatch = selector.match(/^\[data-test-node="(P1-00[1-5])"\]$/);
      if (nodeMatch) return nodes.get(nodeMatch[1]) || null;
      const metricMatch = selector.match(/^\[data-test-npc="(P1-00[1-5])"\]\[data-test-field="(support|pleasantness|effectiveContactCount)"\]$/);
      if (metricMatch) return metrics.get(`${metricMatch[1]}:${metricMatch[2]}`) || null;
      return null;
    },
    createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
  };
  let commandIndex = 0;
  let fetchCount = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    fetchCount += 1;
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected preview request: ${init?.method || 'GET'} ${url}`);
    return reply(url, init);
  };
  const lastScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
  assert(lastScript, '未找到预览应用脚本');
  const bootTail = lastScript.indexOf("window.addEventListener('storage'");
  assert(bootTail >= 0, '预览启动监听缺失');
  const injected = `
    globalThis.__previewTestHooks={
      snapshot:()=>JSON.parse(JSON.stringify(state)),
      openTestControls:()=>openTestControls(),
      refreshTestNpcStates:()=>refreshTestNpcStates(),
      apiCall:(action,payload)=>apiCall(action,payload),
      applyTestControls:()=>applyTestControls(),
      selectNpc:id=>selectNpc(id),
      reload:()=>{state=loadState(activeUserId);restorePreviewSession(activeUserId)},
      visibility:()=>testNpcStateVisibility,
      seedMetrics:snapshot=>applyPreviewNpcTestStates(snapshot),
      metric:(npcId,field)=>document.getElementById('test-'+(field==='pleasantness'?'pleasantness':field==='support'?'support':'contact')+'-'+npcId)?.value,
      status:()=>document.getElementById('test-npc-state-status')?.textContent,
      setNpcOverride:(id,checked)=>{const toggle=document.querySelector('[data-test-npc-enable="'+id+'"]');if(toggle)toggle.checked=checked},
      setMetric:(id,field,value)=>{const input=document.querySelector('[data-test-npc="'+id+'"][data-test-field="'+field+'"]');if(input)input.value=String(value)},
      setSession:(id,version=0)=>{state.previewSessionId=id;state.previewVersion=version;save()}
    };
  `;
  const script = `${lastScript.slice(0, bootTail)}${injected}\n})();`;
  const context = vm.createContext({
    console,
    document,
    window: { matchMedia: () => ({ matches: false }), addEventListener: () => undefined },
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
    crypto: { randomUUID: () => `test-command-${++commandIndex}` },
    setTimeout: (callback: () => void) => { callback(); return 0; },
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
  vm.runInContext(script, context, { filename: 'project1-prototype-v9.inline.js' });
  const hooks = vm.runInContext('globalThis.__previewTestHooks', context) as {
    snapshot: () => { npcTestStates: Record<string, { support: number; pleasantness: number; effectiveContactCount: number; node: string }>; previewSessionId: string | null; previewVersion: number; selectedNpcId: string };
    openTestControls: () => void;
    refreshTestNpcStates: () => Promise<boolean>;
    apiCall: (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    applyTestControls: () => Promise<void>;
    selectNpc: (id: string) => void;
    reload: () => void;
    visibility: () => string;
    seedMetrics: (snapshot: unknown[]) => boolean;
    metric: (npcId: string, field: string) => string;
    status: () => string;
    setNpcOverride: (id: string, checked: boolean) => void;
    setMetric: (id: string, field: string, value: number) => void;
    setSession: (id: string, version?: number) => void;
  };
  return { hooks, modal, elements, fetchCount: () => fetchCount };
}

async function verifyNpcTestStateRefresh() {
  const storage = new MemoryStorage();
  const initial = createRuntime(storage, []);
  initial.hooks.openTestControls();
  strictAssert.equal(initial.fetchCount(), 0, '首开没有 preview session 时不调用恢复接口');
  strictAssert.equal(initial.hooks.visibility(), 'uninitialized', '无会话时使用明确标记的初始状态');
  strictAssert.match(initial.hooks.status() || '', /尚未建立服务端预览会话/, '未建立服务端会话时明确标识默认值');

  const sessionId = '123e4567-e89b-12d3-a456-426614174000';
  const afterChat = npcSnapshot(21, 61);
  initial.hooks.setSession(sessionId, 4);
  const afterChatResponse = {
    success: true,
    previewSessionId: sessionId,
    version: 5,
    data: { previewSessionId: sessionId, version: 5, action: 'message', content: '已回复', npcTestStates: afterChat },
  };
  const withPost = createRuntime(storage, [async (url, init) => {
    strictAssert.equal(init?.method, 'GET', '同步会话后才允许发普通 NPC 消息');
    strictAssert.match(url, /previewSessionId=123e4567-e89b-12d3-a456-426614174000/, '发送消息前恢复当前预览会话');
    return { ok: true, status: 200, json: async () => recoveryBody(sessionId, 4, npcSnapshot(11, 51)) };
  }, async (_url, init) => {
    strictAssert.equal(init?.method, 'POST', '普通 NPC 沟通通过预览 POST');
    const request = JSON.parse(String(init?.body)) as { action: string; channel?: string };
    strictAssert.equal(request.action, 'message', '关系值来自一次真实消息 action');
    strictAssert.equal(request.channel, 'work_phone', '消息走电话预览渠道');
    return { ok: true, status: 200, json: async () => afterChatResponse };
  }]);
  withPost.hooks.setSession(sessionId, 4);
  await withPost.hooks.apiCall('message', { npcId: 'P1-001', channel: 'work_phone', text: '客户沟通后刷新状态' });
  let state = withPost.hooks.snapshot();
  strictAssert.equal(state.npcTestStates['P1-001'].support, 21, 'AI 响应快照刷新张建国支持度');
  strictAssert.equal(state.npcTestStates['P1-001'].pleasantness, 61, 'AI 响应快照刷新张建国愉悦度');
  strictAssert.equal(state.npcTestStates['P1-005'].support, 25, '快照包含并按 ID 更新全部 NPC');
  strictAssert.equal(withPost.hooks.visibility(), 'ready', '收到完整服务端快照后标记为已同步');

  const refreshed = npcSnapshot(41, 71);
  const adjusted = npcSnapshot(51, 81);
  adjusted[1].support = 77;
  adjusted[1].pleasantness = 88;
  const reloaded = createRuntime(storage, [async (url, init) => {
    strictAssert.equal(init?.method || 'GET', 'GET', '刷新页面后读取预览恢复接口');
    strictAssert.match(url, /previewSessionId=123e4567-e89b-12d3-a456-426614174000/, '恢复请求使用当前预览会话 ID');
    return { ok: true, status: 200, json: async () => recoveryBody(sessionId, 6, refreshed) };
  }, async (url, init) => {
    strictAssert.equal(init?.method, 'GET', '应用调节前先恢复服务端会话版本');
    strictAssert.match(url, /previewSessionId=123e4567-e89b-12d3-a456-426614174000/, '应用调节只恢复当前预览会话');
    return { ok: true, status: 200, json: async () => recoveryBody(sessionId, 6, refreshed) };
  }, async (_url, init) => {
    strictAssert.equal(init?.method, 'POST', '应用测试值写入预览服务端');
    const request = JSON.parse(String(init?.body)) as { action: string; adjustments?: Array<{ npcId: string; support: number; pleasantness: number }> };
    strictAssert.equal(request.action, 'test_adjust_npcs', '调节请求明确标记 NPC 测试 action');
    strictAssert.deepEqual(request.adjustments?.map(({ npcId, support, pleasantness }) => ({ npcId, support, pleasantness })), [{ npcId: 'P1-002', support: 77, pleasantness: 88 }], '只向服务端写入已勾选人物的输入值');
    return { ok: true, status: 200, json: async () => ({ success: true, previewSessionId: sessionId, version: 7, data: { previewSessionId: sessionId, version: 7, action: 'test_adjust_npcs', npcTestStates: adjusted } }) };
  }]);
  reloaded.hooks.reload();
  strictAssert.equal(reloaded.hooks.snapshot().npcTestStates['P1-001'].support, 21, '页面刷新前持久化最近快照');
  reloaded.hooks.openTestControls();
  await new Promise(resolve => setTimeout(resolve, 0));
  state = reloaded.hooks.snapshot();
  strictAssert.equal(state.npcTestStates['P1-001'].support, 41, '重开面板以 GET 权威值覆盖旧本地缓存');
  strictAssert.equal(state.npcTestStates['P1-001'].pleasantness, 71, '重开面板同步愉悦度');
  strictAssert.equal(state.previewVersion, 6, '恢复时同步服务端会话版本');
  strictAssert.equal(reloaded.hooks.metric('P1-001', 'support'), '41', '界面输入显示同步后的真实支持度');
  strictAssert.equal(reloaded.hooks.metric('P1-001', 'pleasantness'), '71', '界面输入显示同步后的真实愉悦度');
  reloaded.hooks.selectNpc('P1-002');
  state = reloaded.hooks.snapshot();
  strictAssert.equal(state.selectedNpcId, 'P1-002', '可切换当前联系人');
  strictAssert.equal(state.npcTestStates['P1-002'].support, 42, '切换联系人后读取其本人支持度，不串用上一联系人');
  strictAssert.equal(state.npcTestStates['P1-001'].support, 41, '切换联系人不会覆盖其他人物状态');

  reloaded.hooks.setNpcOverride('P1-002', true);
  reloaded.hooks.setMetric('P1-002', 'support', 77);
  reloaded.hooks.setMetric('P1-002', 'pleasantness', 88);
  await reloaded.hooks.applyTestControls();
  state = reloaded.hooks.snapshot();
  strictAssert.equal(state.npcTestStates['P1-002'].support, 77, '应用测试值后仍从成功响应刷新服务端支持度');
  strictAssert.equal(state.npcTestStates['P1-002'].pleasantness, 88, '应用测试值后愉悦度快照仍可读取');
  strictAssert.equal(state.previewVersion, 7, '应用测试值后保存最新服务端版本');

  const missingSnapshot = createRuntime(new MemoryStorage(), [async () => ({
    ok: true, status: 200,
    json: async () => ({ success: true, data: { previewSessionId: sessionId, version: 1 } }),
  })]);
  missingSnapshot.hooks.setSession(sessionId, 0);
  missingSnapshot.hooks.seedMetrics(npcSnapshot(91, 93));
  await missingSnapshot.hooks.refreshTestNpcStates();
  strictAssert.equal(missingSnapshot.hooks.visibility(), 'unavailable', '响应未提供快照时不显示本地缓存为当前值');
  strictAssert.equal(missingSnapshot.hooks.snapshot().npcTestStates['P1-001'].support, 0, '字段缺失清除缓存关系值');
  strictAssert.equal(missingSnapshot.hooks.metric('P1-001', 'support'), '', '缺失字段后界面隐藏旧本地支持度');

  const denied = createRuntime(new MemoryStorage(), [async () => ({
    ok: false, status: 403, json: async () => ({ error: '权限不足' }),
  })]);
  denied.hooks.setSession(sessionId, 0);
  denied.hooks.seedMetrics(npcSnapshot(91, 93));
  await denied.hooks.refreshTestNpcStates();
  strictAssert.equal(denied.hooks.visibility(), 'unavailable', '非设计师无法读取时进入不可用状态');
  strictAssert.equal(denied.hooks.status(), '当前账号无法读取设计师 NPC 状态；已隐藏本地缓存值。', '无权限时提示明确且不泄露旧缓存');
  strictAssert.equal(denied.hooks.metric('P1-001', 'support'), '', '无权限时界面不显示旧本地支持度');
}

void verifyNpcTestStateRefresh().then(() => {
  console.log('五人预览测试调节静态与状态刷新回归通过');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
