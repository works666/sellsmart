import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
function loadInlineScript(): string {
  const value = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
  if (value === undefined) throw new Error('preview page must contain its application script');
  return value;
}
const inlineScript = loadInlineScript();
const iifeClose = inlineScript.lastIndexOf('})();');
assert.notEqual(iifeClose, -1, 'preview application script must end with its IIFE');

type StubEvent = { key?: string | null; preventDefault?: () => void };
type FetchCall = { url: string; init?: Record<string, unknown> };
type ResponseStub = { status: number; ok: boolean; json: () => Promise<unknown> };
type RuntimeHooks = {
  snapshotCompetitors: () => unknown[];
  status: () => string;
  error: () => string;
  revision: () => string | number | null;
  normalize: (value: unknown) => unknown;
  summaryCopy: () => string;
  refresh: () => Promise<void>;
  open: () => void;
  selectedCompanyId: () => string | null;
  clickCompany: (id: string) => void;
  clickBack: () => void;
  shellReplacementCount: () => number;
  bodyUpdateCount: () => number;
  setModalScroll: (value: number) => void;
  modalScroll: () => number;
  modal: () => string;
  modalOpen: () => boolean;
  retryModal: () => void;
  close: () => void;
  fireWindow: (event: string) => void;
  fireDocument: (event: string, payload?: StubEvent) => void;
  fireBackdrop: () => void;
  fireInterval: (delay: number) => void;
  fireStorage: (key: string) => void;
  setAuth: (userId: string, token: string) => void;
  activeRequestSerial: () => number;
  gameSnapshot: () => unknown;
  showGame: () => void;
};

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

function response(status: number, body: unknown): ResponseStub {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function createRuntime() {
  const localStorage = new MemoryStorage();
  localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'user-A' }));
  localStorage.setItem('weixun_session', 'token-A');
  const windowListeners = new Map<string, Array<(event?: StubEvent) => void>>();
  const documentListeners = new Map<string, Array<(event?: StubEvent) => void>>();
  const intervals: Array<{ delay: number; callback: () => void }> = [];
  const calls: FetchCall[] = [];
  const pendingProfiles: Array<{ resolve: (value: ResponseStub) => void; init?: Record<string, unknown> }> = [];
  const app = { innerHTML: '' };
  const summaryCopy = { textContent: '' };
  const summaryButton = { dataset: {} as Record<string, string> };
  let modalShellHtml = '';
  let competitorBodyHtml = '';
  let modalShellReplacementCount = 0;
  let competitorBodyUpdateCount = 0;
  const competitorModalScroll = { scrollTop: 0 };
  const competitorModalBody = {
    get innerHTML() { return competitorBodyHtml; },
    set innerHTML(value: string) { competitorBodyHtml = value; competitorBodyUpdateCount++; },
  };
  let modalRetryHandler: (() => void) | null = null;
  let modalBackdropHandler: ((event: { target: { classList: { contains: (name: string) => boolean } } }) => void) | null = null;
  let competitorBackHandler: (() => void) | null = null;
  const competitorRowHandlers = new Map<string, () => void>();
  const modal = {
    get innerHTML() {
      const marker = '<div class="modal-body" id="competitor-modal-body"></div>';
      return modalShellHtml.includes(marker)
        ? modalShellHtml.replace(marker, `<div class="modal-body" id="competitor-modal-body">${competitorBodyHtml}</div>`)
        : modalShellHtml;
    },
    set innerHTML(value: string) {
      modalShellHtml = value;
      modalShellReplacementCount++;
      competitorBodyHtml = '';
      competitorModalScroll.scrollTop = 0;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-action="open-competitor-company"]') {
        const ids = [...competitorBodyHtml.matchAll(/data-action="open-competitor-company" data-competitor-id="([^"]+)"/g)].map(match => match[1] || '');
        return ids.map(id => ({ dataset: { competitorId: id }, addEventListener: (_type: string, listener: () => void) => { competitorRowHandlers.set(id, listener); } }));
      }
      return [] as Array<{ onclick?: () => void }>;
    },
    __fireRetry: () => { if (modalRetryHandler) modalRetryHandler(); },
    __fireBackdrop: () => modalBackdropHandler?.({ target: { classList: { contains: name => name === 'modal-backdrop' } } }),
    __fireBack: () => { if (competitorBackHandler) competitorBackHandler(); },
    __fireCompany: (id: string) => { const handler = competitorRowHandlers.get(id); if (handler) handler(); },
    __shellCount: () => modalShellReplacementCount,
    __bodyCount: () => competitorBodyUpdateCount,
    __setScroll: (value: number) => { competitorModalScroll.scrollTop = value; },
    __scroll: () => competitorModalScroll.scrollTop,
    querySelector(selector: string) {
      if (selector === '#competitor-modal-body') return modalShellHtml.includes('id="competitor-modal-body"') ? competitorModalBody : null;
      if (selector === '.competitor-modal') return modalShellHtml.includes('class="modal competitor-modal"') ? competitorModalScroll : null;
      if (selector === '[data-action="refresh-competitors"]') {
        if (!competitorBodyHtml.includes('data-action="refresh-competitors"')) return null;
        return { addEventListener: (_type: string, listener: () => void) => { modalRetryHandler = listener; } };
      }
      if (selector === '[data-action="competitor-back"]') {
        if (!competitorBodyHtml.includes('data-action="competitor-back"')) return null;
        return { addEventListener: (_type: string, listener: () => void) => { competitorBackHandler = listener; } };
      }
      if (selector === '.modal-backdrop') {
        return { addEventListener: (_type: string, listener: typeof modalBackdropHandler) => { modalBackdropHandler = listener; } };
      }
      return { addEventListener: () => undefined };
    },
  };
  let fetchHandler: (url: string, init?: Record<string, unknown>) => Promise<ResponseStub> = (url, init) => {
    if (url === '/api/game-data/competitor-profiles?project_id=1') {
      return new Promise<ResponseStub>(resolve => pendingProfiles.push({ resolve, init }));
    }
    if (url === '/project-one-notice.json') return Promise.resolve(response(404, {}));
    if (url === '/api/designer/image-assets') return new Promise<ResponseStub>(() => undefined);
    return Promise.resolve(response(404, {}));
  };
  const document = {
    hidden: false,
    body: { appendChild: () => undefined },
    getElementById(id: string) {
      if (id === 'app') return app;
      if (id === 'modal-root') return modal;
      if (id === 'toast-root') return { appendChild: () => undefined };
      if (id === 'competitor-summary-copy') return summaryCopy;
      if (id === 'competitor-summary-card') return summaryButton;
      return null;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
    addEventListener(type: string, listener: (event?: StubEvent) => void) {
      const items = documentListeners.get(type) ?? [];
      items.push(listener);
      documentListeners.set(type, items);
    },
    __fire(type: string, event?: StubEvent) { (documentListeners.get(type) ?? []).forEach(listener => listener(event)); },
  };
  const window = {
    location: { reload: () => undefined },
    matchMedia: () => ({ matches: false }),
    addEventListener(type: string, listener: (event?: StubEvent) => void) {
      const items = windowListeners.get(type) ?? [];
      items.push(listener);
      windowListeners.set(type, items);
    },
    __fire(type: string, event?: StubEvent) { (windowListeners.get(type) ?? []).forEach(listener => listener(event)); },
  };
  const fetch = async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init });
    return fetchHandler(url, init);
  };

  const instrumented = `${inlineScript.slice(0, iifeClose)}
 globalThis.__competitorTestHooks={
  snapshotCompetitors:()=>JSON.parse(JSON.stringify(competitorProfiles)),
  status:()=>competitorProfilesLoadStatus,
  error:()=>competitorProfilesLoadError,
  revision:()=>competitorProfilesRevision,
  normalize:value=>normalizeCompetitorProfile(value),
  summaryCopy:()=>document.getElementById('competitor-summary-copy').textContent,
  refresh:()=>refreshCompetitorProfiles(),
  open:()=>openCompetitorModal(),
  selectedCompanyId:()=>competitorSelectedCompanyId,
  clickCompany:id=>modalRoot.__fireCompany(id),
  clickBack:()=>modalRoot.__fireBack(),
  shellReplacementCount:()=>modalRoot.__shellCount(),
  bodyUpdateCount:()=>modalRoot.__bodyCount(),
  setModalScroll:value=>modalRoot.__setScroll(value),
  modalScroll:()=>modalRoot.__scroll(),
  modal:()=>modalRoot.innerHTML,
  modalOpen:()=>competitorModalOpen,
  retryModal:()=>modalRoot.__fireRetry(),
  close:()=>closeModal(),
  fireWindow:(name,payload)=>window.__fire(name,payload),
  fireDocument:(name,payload)=>document.__fire(name,payload),
  fireBackdrop:()=>modalRoot.__fireBackdrop(),
  fireInterval:delay=>__testIntervals.filter(item=>item.delay===delay).forEach(item=>item.callback()),
  fireStorage:key=>handleIdentityStorageChange({key}),
  setAuth:(userId,token)=>{localStorage.setItem('weixun_identity',JSON.stringify({userId}));localStorage.setItem('weixun_session',token);handleIdentityStorageChange({key:'weixun_identity'})},
  activeRequestSerial:()=>activeRequestSerial,
  gameSnapshot:()=>JSON.parse(JSON.stringify({actionPoints:state.actionPoints,totalSpent:state.totalSpent,timer:state.timer,previewSessionId:state.previewSessionId})),
  showGame:()=>{syncIdentitySnapshot();state.screen='game';render()},
 };
${inlineScript.slice(iifeClose)}`;
  const context = vm.createContext({
    console,
    document,
    window,
    localStorage,
    sessionStorage: new MemoryStorage(),
    fetch,
    AbortController,
    TextDecoder,
    TextEncoder,
    URL,
    Event,
    Date,
    Math,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: (callback: () => void, delay: number) => { intervals.push({ callback, delay }); return intervals.length; },
    clearInterval: () => undefined,
    requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    crypto: { randomUUID: () => 'test-command-id' },
    __testIntervals: intervals,
  });
  vm.runInContext(instrumented, context, { filename: 'project1-prototype-v9.inline.js' });
  const hooks = vm.runInContext('globalThis.__competitorTestHooks', context) as RuntimeHooks;
  return {
    hooks,
    calls,
    app,
    summaryButton,
    pendingProfiles,
    setFetchHandler(handler: (url: string, init?: Record<string, unknown>) => Promise<ResponseStub>) {
      fetchHandler = handler;
    },
  };
}

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(`timed out waiting for ${label}`);
};

const profile = (id: string, name: string, features: string, extra: Record<string, string> = {}) => ({
  id,
  project_id: '1',
  company_name: name,
  features,
  more_info: '在本地区域有客户经验。',
  industry: '政企服务',
  solution_summary: '模块化实施方案。',
  representative_experience: '完成过类似建设。',
  service_support: '提供本地服务团队。',
  ...extra,
});

async function main() {
  const runtime = createRuntime();
  const { hooks, pendingProfiles, calls, app, summaryButton } = runtime;
  hooks.showGame();
  await waitFor(() => pendingProfiles.length === 1, 'initial authenticated profile request');
  assert.equal(calls.some(call => call.url === '/api/game-data/competitor-profiles?project_id=1'), true);
  assert.equal((pendingProfiles[0]?.init?.headers as Record<string, string>)['x-session'], 'token-A');

  hooks.setAuth('user-B', 'token-B');
  await waitFor(() => pendingProfiles.length === 2, 'new account profile request');
  assert.equal((pendingProfiles[1]?.init?.headers as Record<string, string>)['x-session'], 'token-B', 'the switched account uses only its own session token');
  hooks.showGame();
  assert.equal(hooks.normalize(profile('10000000-0000-4000-8000-000000000101', 'ABC竞品', 'legacy seed')), null);
  assert.equal(hooks.normalize(profile('10000000-0000-4000-8000-000000000101', 'ABC公司', 'legacy seed')), null);
  assert.notEqual(hooks.normalize(profile('ordinary-id', 'ABC公司', 'legitimate supplier')), null, 'legacy-name filtering must not hide unrelated records');
  const serialBeforeProfileFetch = hooks.activeRequestSerial();
  assert.equal(JSON.stringify(hooks.snapshotCompetitors()), '[]', 'account switch immediately clears old competitor data');
  pendingProfiles[0]!.resolve(response(200, { success: true, revision: 1, data: [profile('A-company', 'Account A supplier', 'A-only capability')] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.stringify(hooks.snapshotCompetitors()), '[]', 'late response from the previous account is ignored');
  pendingProfiles[1]!.resolve(response(200, { success: true, revision: 7, data: [
    profile('B-company', '<img src=x onerror=alert(1)>', '<script>alert("x")</script>', { more_info: '<b>unsafe intro</b>' }),
    profile('C-company', 'Regional Supplier', 'Regional delivery network'),
    profile('10000000-0000-4000-8000-000000000101', 'ABC竞品', 'legacy seed'),
  ] }));
  await waitFor(() => hooks.snapshotCompetitors().length === 2, 'current account profile response and legacy profile filtering');
  assert.equal(hooks.activeRequestSerial(), serialBeforeProfileFetch, 'profile reads do not use or increment the AI request serial');
  assert.match(app.innerHTML, /id="competitor-summary-card"[^>]*aria-label="查看竞争对手资料"/, 'the topbar has one accessible competitor summary entry');
  assert.match(app.innerHTML, /data-action="project-notice"/, 'the summary entry remains adjacent to the project notice in the topbar');
  assert.doesNotMatch(app.innerHTML, /competitor-strip-root|competitor-profile-card|data-action="competitor-profile"/, 'the old second-row company card strip is removed');
  assert.match(hooks.summaryCopy(), /2 家/, 'the summary card displays the current company count');
  assert.equal(summaryButton.dataset.revision, '7');
  assert.equal(hooks.status(), 'ready');
  const gameSnapshotBeforeReading = JSON.stringify(hooks.gameSnapshot());

  hooks.open();
  assert.equal(hooks.modalOpen(), true);
  assert.match(hooks.modal(), /<h3>竞争对手<\/h3>/, 'all companies use one total modal');
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="B-company"[\s\S]*data-action="open-competitor-company" data-competitor-id="C-company"/, 'the total modal starts with a company list');
  assert.doesNotMatch(hooks.modal(), /基本介绍|方案特点|代表经验|服务支持/, 'the company list avoids detailed profile fields');
  assert.doesNotMatch(hooks.modal(), /data-competitor-id="10000000-0000-4000-8000-000000000101"|ABC竞品|legacy seed/, 'the legacy ABC seed is excluded');
  assert.doesNotMatch(hooks.modal(), /<img|<script|<b>unsafe intro/i, 'profile data cannot inject markup into the modal');
  assert.match(hooks.modal(), /&lt;img src=x onerror=alert\(1\)&gt;/, 'company names are escaped in the list');
  const shellCountAfterOpen = hooks.shellReplacementCount();
  const bodyCountAfterOpen = hooks.bodyUpdateCount();
  hooks.setModalScroll(74);
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 7, data: [
    profile('B-company', '<img src=x onerror=alert(1)>', '<script>alert("x")</script>', { more_info: '<b>unsafe intro</b>' }),
    profile('C-company', 'Regional Supplier', 'Regional delivery network'),
  ] }));
  await hooks.refresh();
  assert.equal(hooks.shellReplacementCount(), shellCountAfterOpen, 'an identical refresh does not replace the competitor modal shell');
  assert.equal(hooks.bodyUpdateCount(), bodyCountAfterOpen, 'an identical refresh skips replacing the body');
  assert.equal(hooks.modalScroll(), 74, 'an identical refresh preserves the modal scroll position');

  hooks.clickCompany('B-company');
  assert.equal(hooks.selectedCompanyId(), 'B-company');
  assert.equal(hooks.shellReplacementCount(), shellCountAfterOpen, 'list-to-detail navigation keeps the shell instance');
  assert.equal(hooks.modalScroll(), 0, 'list-to-detail navigation resets body scroll');
  assert.match(hooks.modal(), /data-competitor-id="B-company"[\s\S]*data-action="competitor-back"/);
  assert.match(hooks.modal(), /基本介绍[\s\S]*所属行业[\s\S]*核心优势[\s\S]*方案特点[\s\S]*代表经验[\s\S]*服务支持/, 'the selected company detail shows each configured field');
  assert.match(hooks.modal(), /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/, 'detail text is HTML escaped');
  assert.doesNotMatch(hooks.modal(), /<img|<script|<b>unsafe intro/i, 'profile fields cannot inject markup into company detail');

  // The open all-companies modal refreshes in place when a designer edits a record.
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 8, data: [
    profile('B-company', 'Updated Supplier', 'Updated advantage'),
    profile('C-company', 'Regional Supplier', 'Regional delivery network'),
  ] }));
  hooks.setModalScroll(38);
  await hooks.refresh();
  assert.equal(JSON.stringify(hooks.gameSnapshot()), gameSnapshotBeforeReading, 'loading and viewing competitor data do not alter AP, timer, or the preview session');
  assert.match(hooks.modal(), /Updated Supplier[\s\S]*Updated advantage/, 'editing a supplier refreshes the open total modal');
  assert.doesNotMatch(hooks.modal(), /&lt;script&gt;/, 'updated modal no longer contains old supplier data');
  assert.match(hooks.summaryCopy(), /2 家/);
  assert.equal(hooks.shellReplacementCount(), shellCountAfterOpen, 'profile edits update the body without replacing the shell');
  assert.equal(hooks.modalScroll(), 38, 'profile edits preserve the current scroll position');
  assert.equal(hooks.selectedCompanyId(), 'B-company', 'refreshing an existing selected company preserves the details view');
  hooks.setModalScroll(52);
  hooks.clickBack();
  assert.equal(hooks.selectedCompanyId(), null, 'the back action returns to the company list');
  assert.equal(hooks.modalScroll(), 0, 'detail-to-list navigation resets body scroll');
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="B-company"/);
  assert.doesNotMatch(hooks.modal(), /方案特点|代表经验|服务支持/);
  hooks.clickCompany('B-company');
  hooks.close();
  assert.equal(hooks.selectedCompanyId(), null, 'closing the modal clears its selected company');
  hooks.open();
  assert.equal(hooks.selectedCompanyId(), null, 'reopening starts from the company list');
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="B-company"/);

  // A deleted company disappears, but the total modal remains open with the remaining company.
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 9, data: [profile('C-company', 'Regional Supplier', 'Regional delivery network')] }));
  await hooks.refresh();
  assert.equal(hooks.modalOpen(), true, 'deleting a company does not close the total modal');
  assert.equal(hooks.selectedCompanyId(), null, 'deleting the selected company returns to the list');
  assert.doesNotMatch(hooks.modal(), /data-competitor-id="B-company"/);
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="C-company"/);
  assert.match(hooks.summaryCopy(), /1 家/);

  hooks.clickCompany('C-company');
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 10, data: [] }));
  await hooks.refresh();
  assert.equal(hooks.modalOpen(), true, 'the modal remains available for a true empty state');
  assert.equal(hooks.selectedCompanyId(), null, 'a now-empty list has no stale selection');
  assert.equal(hooks.status(), 'empty', 'an actual empty response produces the configured-empty state');
  assert.match(hooks.modal(), /设计师尚未配置竞争对手资料/);
  assert.match(hooks.summaryCopy(), /暂未配置/);

  runtime.setFetchHandler(async () => response(503, { error: '暂时不可用' }));
  await hooks.refresh();
  assert.equal(hooks.status(), 'error');
  assert.equal(hooks.error(), '暂时不可用');
  assert.match(hooks.modal(), /重试/);
  assert.match(hooks.summaryCopy(), /加载失败/);
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 11, data: [profile('C-company', 'Retry Supplier', 'Updated capability')] }));
  const beforeRetry = calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length;
  hooks.retryModal();
  await waitFor(() => calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length > beforeRetry, 'modal retry request');
  await waitFor(() => hooks.status() === 'ready', 'modal retry success');
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="C-company"/);
  hooks.clickCompany('C-company');
  assert.match(hooks.modal(), /Retry Supplier[\s\S]*Updated capability/);

  runtime.setFetchHandler(async () => response(200, { success: true, revision: 12, data: [profile('C-company', 'Focus Updated Supplier', 'Focused capability')] }));
  const beforeFocusEdit = calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length;
  hooks.fireWindow('focus');
  await waitFor(() => calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length > beforeFocusEdit, 'focus refresh while details are selected');
  await waitFor(() => /Focus Updated Supplier[\s\S]*Focused capability/.test(hooks.modal()), 'focus refresh updates selected details');

  let prevented = false;
  hooks.fireDocument('keydown', { key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.equal(hooks.modalOpen(), false, 'Escape closes the competitor total modal');
  assert.equal(hooks.selectedCompanyId(), null, 'Escape also clears the selected company');
  assert.equal(hooks.modal(), '');
  assert.equal(prevented, true);
  hooks.open();
  assert.equal(hooks.selectedCompanyId(), null, 'reopening after Escape starts with the list');
  assert.match(hooks.modal(), /data-action="open-competitor-company" data-competitor-id="C-company"/);
  hooks.fireBackdrop();
  assert.equal(hooks.modalOpen(), false, 'clicking the modal backdrop closes the total modal');

  const beforeFocus = calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length;
  runtime.setFetchHandler(async () => response(200, { success: true, revision: 13, data: [] }));
  hooks.fireWindow('focus');
  await waitFor(() => calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length > beforeFocus, 'focus refresh after close');
  const beforeVisibility = calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length;
  hooks.fireDocument('visibilitychange');
  await waitFor(() => calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length > beforeVisibility, 'visibility refresh');
  const beforeInterval = calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length;
  hooks.fireInterval(30_000);
  await waitFor(() => calls.filter(call => call.url === '/api/game-data/competitor-profiles?project_id=1').length > beforeInterval, '30-second refresh');

  runtime.setFetchHandler(async (_url, init) => {
    const token = (init?.headers as Record<string, string>)['x-session'];
    return token === 'token-C'
      ? response(200, { success: true, revision: 14, data: [profile('C-account', 'Account C supplier', 'C-only capability')] })
      : response(200, { success: true, revision: 15, data: [] });
  });
  hooks.setAuth('user-C', 'token-C');
  await waitFor(() => hooks.snapshotCompetitors().length === 1, 'third-account profile load');
  hooks.open();
  hooks.clickCompany('C-account');
  assert.equal(hooks.selectedCompanyId(), 'C-account');
  hooks.setAuth('user-D', 'token-D');
  assert.equal(hooks.selectedCompanyId(), null, 'account changes clear the selected company immediately');
  assert.equal(hooks.modalOpen(), false, 'account changes close the old account modal');
  await waitFor(() => hooks.status() === 'empty', 'fourth-account empty profile load');
  assert.equal(JSON.stringify(hooks.snapshotCompetitors()), '[]', 'a new account never sees the previous account profile');

  console.log('Preview competitor summary, total modal, refresh, safety, and account-isolation checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
