const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const Module = require('node:module');

const evidenceDir = __dirname;
const repoRoot = path.resolve(evidenceDir, '../../..');
const projectRoot = path.join(repoRoot, 'projects');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
projectRequire('tsx/cjs/api').register();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveProjectAlias(request, parent, ...args) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(projectRoot, 'src', request.slice(2))
    : request;
  return resolveFilename.call(this, resolvedRequest, parent, ...args);
};

const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {
  createProjectOneState,
  synchronizeProjectTimer,
  toPlayerVisibleGameState,
} = projectRequire(path.join(projectRoot, 'src/lib/game/state.ts'));
const { PROJECT_ONE_NPCS } = projectRequire(path.join(projectRoot, 'src/lib/game/project-one.ts'));

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const baseOrigin = new URL(baseUrl).origin;
const sessionId = 'competitor-profile-browser-fixture';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const diagnostics = {
  pageErrors: [],
  consoleErrors: [],
  failedNextRequests: [],
  badNextResponses: [],
  unmockedApi: [],
  externalRequests: [],
  modelRequests: [],
  profileRequests: [],
  designerWrites: [],
};
const results = [];

const FIELD_VALUES = {
  more_info: '基本介绍标记：华星智造覆盖工业现场设备全周期管理。',
  industry: '行业标记：工业自动化与智能制造',
  features: '核心优势标记：设备兼容范围广，交付团队稳定。',
  solution_summary: '方案特点标记：边缘采集加云端运维，分阶段部署。',
  representative_experience: '代表经验标记：曾为多条离散制造产线提供设备联网服务。',
  service_support: '服务支持标记：本地驻场、远程诊断与年度巡检。',
};

function profile(id, companyName, prefix) {
  return {
    id,
    project_id: 1,
    company_name: companyName,
    features: `${prefix}核心优势：稳定的项目实施团队。`,
    more_info: `${prefix}基本介绍：面向制造业提供工业数字化服务。`,
    industry: `${prefix}行业：工业自动化`,
    solution_summary: `${prefix}方案特点：模块化部署并兼容存量设备。`,
    representative_experience: `${prefix}代表经验：具有多类制造场景交付记录。`,
    service_support: `${prefix}服务支持：远程支持与定期巡检。`,
  };
}

const LEGACY_ABC_ID = '10000000-0000-4000-8000-000000000101';
const legacyAbcProfile = profile(LEGACY_ABC_ID, 'ABC竞品', '旧项目内置');
const initialProfiles = [
  profile('10000000-0000-4000-8000-000000000201', '华星智造有限公司', '华星'),
  profile('10000000-0000-4000-8000-000000000202', '中科云控科技有限公司', '中科'),
  profile('10000000-0000-4000-8000-000000000203', '远成工业系统有限公司', '远成'),
];

function visibleProfiles(profiles) {
  return profiles.filter((item) => !(item.id === LEGACY_ABC_ID && ['ABC竞品', 'ABC公司'].includes(item.company_name)));
}

assert.equal(visibleProfiles([legacyAbcProfile]).length, 0, 'legacy UUID101 ABC placeholder is excluded');
assert.equal(visibleProfiles([{ ...legacyAbcProfile, company_name: '已修改名称的公司' }]).length, 1,
  'an edited company that retains UUID101 but changes its name remains visible');
assert.equal(visibleProfiles([{ ...legacyAbcProfile, id: initialProfiles[0].id }]).length, 1,
  'an unrelated company UUID is not hidden by matching only the legacy placeholder name');
const formalPortraitAssets = PROJECT_ONE_NPCS.map((npc) => ({
  slotKey: `person_intro:${npc.id}`,
  imageUrl: `/assets/people/${({
    'P1-001': 'zhang-jianguo',
    'P1-002': 'li-minghui',
    'P1-003': 'wang-defu',
    'P1-004': 'zhao-xiaochen',
    'P1-005': 'liu-siqi',
  })[npc.id]}.png`,
}));

function makeProfileStore() {
  return {
    profiles: [legacyAbcProfile, ...initialProfiles].map((item) => ({ ...item })),
    revision: 6,
    getCalls: 0,
    failNextGets: 0,
    writes: [],
    events: [],
    async serveGet(route, surface) {
      this.getCalls += 1;
      const request = route.request();
      const requestUrl = new URL(request.url());
      const projectId = requestUrl.searchParams.get('project_id');
      const token = request.headers()['x-session'] || '';
      diagnostics.profileRequests.push({
        surface,
        method: request.method(),
        projectId,
        hasSessionHeader: Boolean(token),
      });
      this.events.push({ type: 'get', surface, projectId });
      if (request.method() !== 'GET' || projectId !== '1' || !token) {
        return route.fulfill(jsonResponse({ success: false, error: 'invalid mocked profile request' }, 400));
      }
      if (this.failNextGets > 0) {
        this.failNextGets -= 1;
        return route.fulfill(jsonResponse({ success: false, error: '暂时无法读取竞争对手资料' }, 503));
      }
      return route.fulfill(jsonResponse({
        success: true,
        data: visibleProfiles(this.profiles).map((item) => ({ ...item })),
        revision: this.revision,
      }));
    },
  };
}

function jsonResponse(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function safeDiagnosticText(value) {
  return String(value).replace(/https?:\/\/[^\s)]+/g, '[url]').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function nextAssetPath(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    return pathname.startsWith('/_next/') ? pathname.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function attachDiagnostics(page) {
  page.on('pageerror', (error) => diagnostics.pageErrors.push(safeDiagnosticText(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(safeDiagnosticText(message.text()));
  });
  page.on('requestfailed', (request) => {
    const pathname = nextAssetPath(request.url());
    if (pathname) diagnostics.failedNextRequests.push(`${pathname}: ${safeDiagnosticText(request.failure()?.errorText ?? 'request failed')}`);
  });
  page.on('response', (response) => {
    const pathname = nextAssetPath(response.url());
    if (pathname && response.status() >= 400) diagnostics.badNextResponses.push(`${response.status()} ${pathname}`);
  });
}

async function blockExternalNetwork(context) {
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (/^(data:|blob:|about:)/i.test(requestUrl)) return route.continue();
    let origin = '';
    try { origin = new URL(requestUrl).origin; } catch { return route.abort(); }
    if (origin !== baseOrigin) {
      diagnostics.externalRequests.push(new URL(requestUrl).host);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(Math.max(metrics.document, metrics.body) <= metrics.viewport + 1,
    `${label} overflows horizontally: ${JSON.stringify(metrics)}`);
}

async function assertSummaryCardsAligned(page, projectSelector, competitorName, label) {
  const projectCard = page.locator(projectSelector);
  const competitorCard = page.getByRole('button', { name: competitorName, exact: true });
  assert.equal(await projectCard.count(), 1, `${label} has one project-background card`);
  assert.equal(await competitorCard.count(), 1, `${label} has one competitor-summary card`);
  const [projectBox, competitorBox] = await Promise.all([projectCard.boundingBox(), competitorCard.boundingBox()]);
  assert.ok(projectBox && competitorBox, `${label} summary cards have bounding boxes`);
  assert.ok(Math.abs(projectBox.y - competitorBox.y) <= 2,
    `${label} project and competitor cards share a row: project y=${projectBox.y}, competitor y=${competitorBox.y}`);
}

async function captureCompetitorModalShell(page, selectors, remember = false) {
  return page.evaluate(({ modalSelector, backdropSelector, bodySelector, scrollContainerSelector, remember }) => {
    const modal = document.querySelector(modalSelector);
    const backdrop = modal?.closest(backdropSelector) ?? document.querySelector(backdropSelector);
    const body = modal?.querySelector(bodySelector) ?? null;
    const scrollContainer = scrollContainerSelector
      ? (modal?.matches(scrollContainerSelector) ? modal : modal?.querySelector(scrollContainerSelector))
      : body;
    if (remember) {
      window.__originalBackdrop = backdrop;
      window.__originalModal = modal;
      window.__originalModalBody = body;
      window.__originalModalScrollContainer = scrollContainer;
    }
    const activeAnimations = backdrop
      ? backdrop.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running' || animation.playState === 'pending')
      : [];
    const focused = document.activeElement;
    const identity = (node) => node ? {
      tag: node.tagName,
      action: node.getAttribute('data-action'),
      label: node.getAttribute('aria-label'),
      text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
    } : null;
    return {
      hasBackdrop: Boolean(backdrop),
      hasModal: Boolean(modal),
      hasBody: Boolean(body),
      sameBackdropAsOriginal: Boolean(backdrop && backdrop === window.__originalBackdrop),
      sameModalAsOriginal: Boolean(modal && modal === window.__originalModal),
      sameBodyAsOriginal: Boolean(body && body === window.__originalModalBody),
      sameScrollContainerAsOriginal: Boolean(scrollContainer && scrollContainer === window.__originalModalScrollContainer),
      activeAnimationCount: activeAnimations.length,
      activeAnimations: activeAnimations.map((animation) => ({
        name: animation.animationName || animation.id || 'unknown',
        state: animation.playState,
      })),
      computedAnimationNames: {
        backdrop: backdrop ? getComputedStyle(backdrop).animationName : null,
        modal: modal ? getComputedStyle(modal).animationName : null,
      },
      focus: identity(focused),
      bodyScrollTop: scrollContainer?.scrollTop ?? null,
      bodyScrollHeight: scrollContainer?.scrollHeight ?? null,
      bodyClientHeight: scrollContainer?.clientHeight ?? null,
    };
  }, { ...selectors, remember });
}

function assertStableCompetitorModalShell(snapshot, label) {
  assert.equal(snapshot.hasBackdrop, true, `${label} keeps the competitor modal backdrop mounted`);
  assert.equal(snapshot.hasModal, true, `${label} keeps the competitor modal mounted`);
  assert.equal(snapshot.sameBackdropAsOriginal, true, `${label} retains the original backdrop node`);
  assert.equal(snapshot.sameModalAsOriginal, true, `${label} retains the original modal node`);
  assert.equal(snapshot.activeAnimationCount, 0, `${label} has no active modal or backdrop entrance animation`);
  assert.deepEqual(snapshot.computedAnimationNames, { backdrop: 'none', modal: 'none' },
    `${label} CSS disables modal and backdrop entrance animations`);
}

function profileFieldValues(profile) {
  return [profile.more_info, profile.industry, profile.features, profile.solution_summary, profile.representative_experience, profile.service_support].filter(Boolean);
}

async function assertFormalCompanyList(dialog, profiles, label) {
  const rows = dialog.getByRole('button', { name: /^查看.+公司资料$/ });
  for (const profile of profiles) {
    await dialog.getByRole('button', { name: `查看${profile.company_name}公司资料`, exact: true }).waitFor({ state: 'visible' });
  }
  assert.equal(await rows.count(), profiles.length, `${label} shows the expected company rows`);
  for (const labelText of ['方案特点', '代表经验', '服务支持']) {
    assert.equal(await dialog.getByText(labelText, { exact: true }).count(), 0, `${label} does not show ${labelText} details`);
  }
  for (const profile of profiles) {
    for (const value of [profile.solution_summary, profile.representative_experience, profile.service_support]) {
      if (value) assert.equal(await dialog.getByText(value, { exact: true }).count(), 0, `${label} hides the detailed field ${value}`);
    }
  }
}

async function assertFormalCompanyDetail(dialog, profile, otherProfiles) {
  await dialog.getByRole('heading', { name: `${profile.company_name} · 资料详情`, exact: true }).waitFor({ state: 'visible' });
  const article = dialog.getByRole('article', { name: `${profile.company_name}资料`, exact: true });
  await article.waitFor({ state: 'visible' });
  for (const value of profileFieldValues(profile)) await article.getByText(value, { exact: true }).waitFor({ state: 'visible' });
  for (const label of ['基本介绍', '核心优势', '方案特点', '代表经验', '服务支持']) {
    await article.getByText(label, { exact: true }).waitFor({ state: 'visible' });
  }
  for (const other of otherProfiles) {
    for (const value of profileFieldValues(other)) {
      assert.equal(await dialog.getByText(value, { exact: true }).count(), 0,
        `detail for ${profile.company_name} does not include ${other.company_name} content`);
    }
  }
  return article;
}

async function assertPreviewCompanyList(modal, profiles, label) {
  const rows = modal.locator('.competitor-company-row[data-action="open-competitor-company"][data-competitor-id]');
  for (const profile of profiles) {
    await modal.getByRole('button', { name: `查看 ${profile.company_name} 详情`, exact: true }).waitFor({ state: 'visible' });
  }
  await modal.getByRole('heading', { name: '竞争对手', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await rows.count(), profiles.length, `${label} shows the expected company rows`);
  for (const labelText of ['方案特点', '代表经验', '服务支持']) {
    assert.equal(await modal.getByText(labelText, { exact: true }).count(), 0, `${label} does not show ${labelText} details`);
  }
  for (const profile of profiles) {
    for (const value of [profile.solution_summary, profile.representative_experience, profile.service_support]) {
      if (value) assert.equal(await modal.getByText(value, { exact: true }).count(), 0, `${label} hides the detailed field ${value}`);
    }
  }
}

async function assertPreviewCompanyDetail(modal, profile, otherProfiles) {
  await modal.getByRole('heading', { name: '竞争对手', exact: true }).waitFor({ state: 'visible' });
  const company = modal.locator(`.competitor-company-detail[data-competitor-id="${profile.id}"]`);
  await company.waitFor({ state: 'visible' });
  await company.getByText(profile.company_name, { exact: true }).waitFor({ state: 'visible' });
  for (const value of profileFieldValues(profile)) await company.getByText(value, { exact: true }).waitFor({ state: 'visible' });
  for (const label of ['所属行业', '核心优势', '方案特点', '代表经验', '服务支持']) {
    await company.getByRole('heading', { name: label, exact: true }).waitFor({ state: 'visible' });
  }
  for (const other of otherProfiles) {
    for (const value of profileFieldValues(other)) {
      assert.equal(await modal.getByText(value, { exact: true }).count(), 0,
        `detail for ${profile.company_name} does not include ${other.company_name} content`);
    }
  }
  return company;
}

async function waitForGlobalPlanHeading(page, label) {
  try {
    await page.getByRole('heading', { name: /整体工作计划|全局工作计划/ }).waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      url: location.pathname + location.search,
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((element) => element.innerText.trim()).filter(Boolean).slice(0, 20),
      visibleText: (document.body?.innerText ?? '').slice(0, 1_000),
    })).catch(() => ({ url: 'unavailable', title: '', headings: [], visibleText: '' }));
    throw new Error(`${label} could not find the global plan heading; visible page diagnostics=${JSON.stringify(pageState)}; cause=${error instanceof Error ? error.message : 'unknown'}`);
  }
}

function assertProfileRequestBoundary(store, surface) {
  assert.ok(store.getCalls >= 1, 'the page requested competitor profiles');
  assert.ok(diagnostics.profileRequests.some((entry) => entry.surface === surface && entry.projectId === '1' && entry.hasSessionHeader),
    `${surface} profile GET includes project_id=1 and the current session header`);
}

function captureFormalBaseline(state) {
  return {
    version: state.version,
    actionPoints: state.actionPoints,
    cumulativeSpentPoints: state.cumulativeSpentPoints,
    processedCommands: state.processedCommandIds.length,
    appointments: state.appointments.length,
    competitorPosition: state.competitorState.position,
    recoveredIntervals: state.projectTimer.recoveredIntervals,
    activeMeetingId: state.activeMeeting?.id ?? null,
  };
}

function assertFormalNoBusinessMutation(state, baseline, label) {
  assert.deepEqual(captureFormalBaseline(state), baseline, `${label} changed mock game AP, version, spent points, command count, appointments, competitor position, refill counter, or meeting`);
  assert.ok(state.projectTimer.elapsedMs < 30_000, `${label} unexpectedly consumed more than 30 seconds in the mocked timer`);
}

function setUpdatedProfile(store, id, suffix = '设计师刷新版') {
  const current = store.profiles.find((item) => item.id === id);
  assert.ok(current, `mock profile ${id} exists before update`);
  Object.assign(current, {
    company_name: '华星智造有限公司',
    more_info: `基本介绍标记：${suffix}，覆盖工业现场设备全周期管理。`,
    industry: '行业标记：工业自动化与智能制造（已更新）',
    features: `核心优势标记：${suffix}，兼容范围广且交付团队稳定。`,
    solution_summary: `方案特点标记：${suffix}，边缘采集加云端运维。`,
    representative_experience: `代表经验标记：${suffix}，服务过多条制造产线。`,
    service_support: `服务支持标记：${suffix}，本地驻场与年度巡检。`,
  });
  store.revision += 1;
  return { ...current };
}

async function waitForProfileReads(store, minimum, label) {
  await waitUntil(() => store.getCalls >= minimum, `${label}: expected at least ${minimum} profile GETs`);
}

async function waitUntil(predicate, message, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function installFormalApi(page, harness) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;
    if (pathname === '/api/game-data/competitor-profiles') {
      return harness.profileStore.serveGet(route, 'formal');
    }
    if (pathname.startsWith('/api/chat/stream')) {
      diagnostics.modelRequests.push(`formal ${request.method()} ${pathname}`);
      return route.fulfill(jsonResponse({ error: 'mock UI must not invoke AI' }, 500));
    }
    if (pathname === `/api/game/sessions/${sessionId}` && request.method() === 'GET') {
      return route.fulfill(jsonResponse({ success: true, gameSession: { id: sessionId, state: toPlayerVisibleGameState(harness.state) } }));
    }
    if (pathname === `/api/game/sessions/${sessionId}/timer` && request.method() === 'POST') {
      harness.timerPolls += 1;
      harness.state = synchronizeProjectTimer(harness.state, Date.now());
      return route.fulfill(jsonResponse({ success: true, state: toPlayerVisibleGameState(harness.state) }));
    }
    if (pathname === `/api/game/sessions/${sessionId}/messages`) {
      return route.fulfill(jsonResponse({ success: true, messages: [] }));
    }
    if (pathname === `/api/game/sessions/${sessionId}/call-history`) {
      return route.fulfill(jsonResponse({ success: true, calls: [] }));
    }
    if (pathname.startsWith('/api/game-data/npcs')) {
      return route.fulfill(jsonResponse({ success: true, data: PROJECT_ONE_NPCS.map((npc) => ({ ...npc, weakness: null })) }));
    }
    if (pathname === '/api/designer/image-assets') return route.fulfill(jsonResponse({ success: true, assets: formalPortraitAssets }));
    if (pathname === '/api/game/sessions' && request.method() === 'GET') return route.fulfill(jsonResponse({ success: true, saves: [] }));
    if (pathname === `/api/game/sessions/${sessionId}/commands`) {
      return route.fulfill(jsonResponse({ error: 'mock browser acceptance must not mutate a save' }, 500));
    }
    diagnostics.unmockedApi.push(`${request.method()} ${pathname}`);
    return route.fulfill(jsonResponse({ success: true, data: {} }));
  });
}

function newFormalHarness(profileStore) {
  const state = createProjectOneState();
  state.projectTimer = {
    ...state.projectTimer,
    elapsedMs: 0,
    recoveredIntervals: 0,
    visitPaused: false,
    lastResumedAt: new Date().toISOString(),
  };
  return { state, timerPolls: 0, profileStore };
}

async function testFormalGame(browser, profileStore) {
  const harness = newFormalHarness(profileStore);
  const baseline = captureFormalBaseline(harness.state);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await blockExternalNetwork(context);
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('weixun_session', 'competitor-formal-fixture');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'player', userId: 'competitor-formal-fixture', displayName: '竞品资料验收' }));
  });
  const page = await context.newPage();
  attachDiagnostics(page);
  await installFormalApi(page, harness);
  const firstTimerPost = page.waitForRequest((request) => {
    const requestUrl = new URL(request.url());
    return request.method() === 'POST' && requestUrl.pathname === `/api/game/sessions/${sessionId}/timer`;
  }, { timeout: 15_000 });
  const initialProfileReads = profileStore.getCalls;
  await page.goto(`${baseUrl}/game?location=project-1&mode=solo&sessionId=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' });
  await waitForGlobalPlanHeading(page, 'formal game');
  await waitForProfileReads(profileStore, initialProfileReads + 1, 'formal initial competitor load');
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).getByText(/3 家公司/).waitFor({ state: 'visible' });
  await assertSummaryCardsAligned(page, 'button[aria-label="打开项目招标通知"]', '查看竞争对手资料', 'formal desktop 1440x900');
  assert.equal(await page.locator('button[aria-label="查看竞争对手资料"]').count(), 1, 'formal header has one competitor summary card');
  assert.equal(await page.locator('.competitor-profile-card, .competitor-strip').count(), 0,
    'formal page has no per-company cards or lower competitor strip');
  assert.equal(await page.getByRole('button', { name: /ABC竞品/ }).count(), 0,
    'formal game does not render the legacy ABC placeholder as a card');
  const formalContacts = page.locator('[class*="organizationGrid"] button[class*="personNode"]');
  assert.equal(await formalContacts.count(), 5, 'formal page renders all five project-one contacts');
  for (const npc of PROJECT_ONE_NPCS) {
    await page.getByRole('button', { name: new RegExp(npc.name) }).waitFor({ state: 'visible' });
  }
  await page.waitForFunction(() => {
    const portraits = Array.from(document.querySelectorAll('[class*="personAvatar"] img'));
    return portraits.length === 5 && portraits.every((image) => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 15_000 });
  await assertNoHorizontalOverflow(page, 'formal desktop 1440x900');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-cards-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const initialVisibleProfiles = visibleProfiles(profileStore.profiles);
  await assertFormalCompanyList(dialog, initialVisibleProfiles, 'formal initial list');
  const formalShellSelectors = {
    modalSelector: '[role="dialog"]',
    backdropSelector: '[role="presentation"]',
    bodySelector: '.overflow-y-auto',
    scrollContainerSelector: '.overflow-y-auto',
  };
  const formalInitialShell = await captureCompetitorModalShell(page, formalShellSelectors, true);
  assertStableCompetitorModalShell(formalInitialShell, 'formal modal first open');
  assert.equal(await dialog.getByText('ABC竞品', { exact: true }).count(), 0,
    'formal company list excludes the legacy ABC placeholder');

  const formalFirstRow = dialog.getByRole('button', { name: `查看${initialVisibleProfiles[0].company_name}公司资料`, exact: true });
  await formalFirstRow.focus();
  const formalBeforeUnchangedRefresh = await captureCompetitorModalShell(page, formalShellSelectors);
  const formalBeforeUnchangedReads = profileStore.getCalls;
  const formalUnchangedReadWait = waitForProfileReads(profileStore, formalBeforeUnchangedReads + 1, 'formal unchanged-data focus refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await formalUnchangedReadWait;
  await assertFormalCompanyList(dialog, initialVisibleProfiles, 'formal list after unchanged-data refresh');
  const formalAfterUnchangedRefresh = await captureCompetitorModalShell(page, formalShellSelectors);
  assertStableCompetitorModalShell(formalAfterUnchangedRefresh, 'formal unchanged-data refresh');
  assert.equal(formalAfterUnchangedRefresh.sameBodyAsOriginal, true, 'formal same-data refresh preserves modal body');
  assert.deepEqual(formalAfterUnchangedRefresh.focus, formalBeforeUnchangedRefresh.focus,
    'formal same-data refresh preserves keyboard focus');
  assert.equal(formalAfterUnchangedRefresh.bodyScrollTop, formalBeforeUnchangedRefresh.bodyScrollTop,
    'formal same-data refresh preserves modal body scroll position');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-list-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const firstProfile = initialVisibleProfiles[0];
  const secondProfile = initialVisibleProfiles[1];
  await dialog.getByRole('button', { name: `查看${firstProfile.company_name}公司资料`, exact: true }).click();
  await assertFormalCompanyDetail(dialog, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal list-to-detail navigation');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-detail-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const originalFormalExperience = firstProfile.representative_experience;
  firstProfile.representative_experience = `${originalFormalExperience}\n${Array.from({ length: 36 }, (_, index) => `滚动保留验收内容 ${index + 1}：该段仅用于确认长详情在同资料刷新后保留滚动位置。`).join('\n')}`;
  profileStore.revision += 1;
  const formalLongDetailReads = profileStore.getCalls;
  const formalLongDetailWait = waitForProfileReads(profileStore, formalLongDetailReads + 1, 'formal long-detail refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await formalLongDetailWait;
  await assertFormalCompanyDetail(dialog, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  const formalScrollSetup = await page.evaluate(() => {
    const scrollContainer = document.querySelector('[role="dialog"] .overflow-y-auto');
    const returnButton = document.querySelector('[role="dialog"] [aria-label="返回竞争对手列表"]');
    if (!scrollContainer || !returnButton) return null;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    returnButton.focus({ preventScroll: true });
    return {
      scrollTop: scrollContainer.scrollTop,
      maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight,
    };
  });
  assert.ok(formalScrollSetup && formalScrollSetup.maxScrollTop > 0 && formalScrollSetup.scrollTop > 0,
    'formal fixture creates a genuinely scrollable detail body');
  const formalBeforeDetailRefresh = await captureCompetitorModalShell(page, formalShellSelectors);
  const formalBeforeDetailReads = profileStore.getCalls;
  const formalDetailSameDataWait = waitForProfileReads(profileStore, formalBeforeDetailReads + 1, 'formal same-detail focus refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await formalDetailSameDataWait;
  await assertFormalCompanyDetail(dialog, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  const formalAfterDetailRefresh = await captureCompetitorModalShell(page, formalShellSelectors);
  assertStableCompetitorModalShell(formalAfterDetailRefresh, 'formal same-detail refresh');
  assert.equal(formalAfterDetailRefresh.sameBodyAsOriginal, true, 'formal same-detail refresh preserves the body node');
  assert.deepEqual(formalAfterDetailRefresh.focus, formalBeforeDetailRefresh.focus,
    'formal same-detail refresh preserves keyboard focus');
  assert.ok(formalAfterDetailRefresh.bodyScrollTop > 0, 'formal same-detail refresh retains a non-zero body scroll position');
  assert.equal(formalAfterDetailRefresh.bodyScrollTop, formalBeforeDetailRefresh.bodyScrollTop,
    'formal same-detail refresh keeps the body scroll position unchanged');

  firstProfile.representative_experience = originalFormalExperience;
  profileStore.revision += 1;
  const formalRestoreReads = profileStore.getCalls;
  const formalRestoreWait = waitForProfileReads(profileStore, formalRestoreReads + 1, 'formal restore short-detail fixture');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await formalRestoreWait;
  await assertFormalCompanyDetail(dialog, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  await dialog.getByRole('button', { name: '返回竞争对手列表', exact: true }).click();
  await assertFormalCompanyList(dialog, initialVisibleProfiles, 'formal list after first detail');
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal detail-to-list navigation');
  await dialog.getByRole('button', { name: `查看${secondProfile.company_name}公司资料`, exact: true }).click();
  await assertFormalCompanyDetail(dialog, secondProfile, initialVisibleProfiles.filter((item) => item.id !== secondProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal second detail navigation');
  await dialog.getByRole('button', { name: '返回竞争对手列表', exact: true }).click();
  await assertFormalCompanyList(dialog, initialVisibleProfiles, 'formal list after switching companies');
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal second return to list');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await assertFormalCompanyList(dialog, initialVisibleProfiles, 'formal list after close and reopen');
  const formalReopenedShell = await captureCompetitorModalShell(page, formalShellSelectors, true);
  assertStableCompetitorModalShell(formalReopenedShell, 'formal modal reopen');
  await firstTimerPost;
  const timerPollsBeforeShellCheck = harness.timerPolls;
  await waitUntil(() => harness.timerPolls > timerPollsBeforeShellCheck, 'formal timer poll while competitor modal is open', 5000);
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal modal during timer polling');

  // A focused detail refreshes when a designer edits the selected company.
  await dialog.getByRole('button', { name: `查看${firstProfile.company_name}公司资料`, exact: true }).click();
  const beforeUpdateReads = profileStore.getCalls;
  const updatedProfile = setUpdatedProfile(profileStore, initialProfiles[0].id);
  const updateReadWait = waitForProfileReads(profileStore, beforeUpdateReads + 1, 'formal focus refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await updateReadWait;
  const updatedCompany = await assertFormalCompanyDetail(dialog, updatedProfile, visibleProfiles(profileStore.profiles).filter((item) => item.id !== updatedProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal designer edit refresh');
  await updatedCompany.getByText(updatedProfile.solution_summary, { exact: true }).waitFor({ state: 'visible' });
  await updatedCompany.getByText(updatedProfile.service_support, { exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-after-designer-update.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  // Deleting the selected company returns to the list and leaves the modal open.
  const beforeDeleteReads = profileStore.getCalls;
  profileStore.profiles = profileStore.profiles.filter((item) => item.id !== updatedProfile.id);
  profileStore.revision += 1;
  const deleteReadWait = waitForProfileReads(profileStore, beforeDeleteReads + 1, 'formal deletion refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await deleteReadWait;
  await dialog.waitFor({ state: 'visible' });
  await updatedCompany.waitFor({ state: 'detached' });
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, formalShellSelectors), 'formal deletion refresh');
  const afterDeleteProfiles = visibleProfiles(profileStore.profiles);
  await assertFormalCompanyList(dialog, afterDeleteProfiles, 'formal list after deleting the selected company');
  assert.equal(afterDeleteProfiles.some((item) => item.id === updatedProfile.id), false,
    'formal list no longer contains the deleted company');
  assert.equal(await dialog.getByText('ABC竞品', { exact: true }).count(), 0,
    'formal modal continues to exclude the legacy ABC placeholder after refresh');

  const beforeEmptyReads = profileStore.getCalls;
  profileStore.profiles = [];
  profileStore.revision += 1;
  const emptyReadWait = waitForProfileReads(profileStore, beforeEmptyReads + 1, 'formal empty refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await emptyReadWait;
  await dialog.getByText(/当前项目尚未配置竞争对手资料/).waitFor({ state: 'visible' });
  assert.equal(await dialog.getByRole('button', { name: /^查看.+公司资料$/ }).count(), 0,
    'formal empty state replaces the company list while keeping the modal open');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-empty-state.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  profileStore.profiles = [legacyAbcProfile, ...initialProfiles].map((item) => ({ ...item }));
  profileStore.revision += 1;
  const beforeEmptyRetry = profileStore.getCalls;
  const emptyRetryWait = waitForProfileReads(profileStore, beforeEmptyRetry + 1, 'formal empty-state reload');
  await dialog.getByRole('button', { name: /重新加载/ }).click();
  await emptyRetryWait;
  await assertFormalCompanyList(dialog, visibleProfiles(profileStore.profiles), 'formal list after empty-state reload');

  const beforeFailureReads = profileStore.getCalls;
  profileStore.failNextGets = 1;
  const failureReadWait = waitForProfileReads(profileStore, beforeFailureReads + 1, 'formal failure state');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await failureReadWait;
  await dialog.getByRole('alert').getByText(/暂时无法读取竞争对手资料|加载失败/).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-error-state.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  const retryButton = dialog.getByRole('button', { name: /重试/ });
  const beforeRetryReads = profileStore.getCalls;
  const retryReadWait = waitForProfileReads(profileStore, beforeRetryReads + 1, 'formal explicit retry');
  await retryButton.click();
  await retryReadWait;
  await assertFormalCompanyList(dialog, visibleProfiles(profileStore.profiles), 'formal list after retry');

  await page.setViewportSize({ width: 390, height: 844 });
  await assertSummaryCardsAligned(page, 'button[aria-label="打开项目招标通知"]', '查看竞争对手资料', 'formal mobile 390x844');
  await assertNoHorizontalOverflow(page, 'formal mobile 390x844');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-cards-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await assertFormalCompanyList(dialog, visibleProfiles(profileStore.profiles), 'formal mobile company list');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-list-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await dialog.getByRole('button', { name: `查看${secondProfile.company_name}公司资料`, exact: true }).click();
  await assertFormalCompanyDetail(dialog, secondProfile, visibleProfiles(profileStore.profiles).filter((item) => item.id !== secondProfile.id));
  await assertNoHorizontalOverflow(page, 'formal mobile detail 390x844');
  await page.screenshot({ path: path.join(evidenceDir, 'formal-competitor-detail-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await assertFormalCompanyList(dialog, visibleProfiles(profileStore.profiles), 'formal mobile list after close and reopen');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  assertProfileRequestBoundary(profileStore, 'formal');
  assert.ok(harness.timerPolls >= 1, 'formal timer mock remained connected during competitor checks');
  assertFormalNoBusinessMutation(harness.state, baseline, 'formal competitor cards and details');
  await context.close();
  results.push('formal /game: list/detail navigation, focus refresh, deletion, and a timer poll retain the same modal shell; unchanged data preserves body, focus, and scroll; no active modal entrance animation; competitor data edit, empty/error retry, legacy ABC exclusion, five contacts, mobile layout, and unchanged AP/game commands passed');
}

async function installPreviewApi(page, store) {
  await page.route('**/api/project-one-preview/ai**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill(jsonResponse({
        success: true,
        previewSessionId: 'competitor-preview-fixture',
        version: 1,
        data: {
          previewSessionId: 'competitor-preview-fixture',
          version: 1,
          timer: { elapsedMs: 0, lastResumedAt: Date.now(), paused: false, refillsApplied: 0, expired: false, settled: false, started: true },
          npcTestStates: [],
        },
      }));
    }
    try {
      const body = request.postDataJSON();
      if (['message', 'visit_turn', 'phone_connect'].includes(body.action)) {
        diagnostics.modelRequests.push(`preview ${body.action}`);
        return route.fulfill(jsonResponse({ error: 'mock competitor acceptance must not invoke AI' }, 500));
      }
      return route.fulfill(jsonResponse({ success: true, previewSessionId: 'competitor-preview-fixture', version: 1, data: { version: 1, previewSessionId: 'competitor-preview-fixture', npcTestStates: [] } }));
    } catch {
      return route.fulfill(jsonResponse({ error: 'invalid mock preview request' }, 400));
    }
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith('/api/project-one-preview/ai')) return route.fallback();
    if (requestUrl.pathname === '/api/game-data/competitor-profiles') return store.serveGet(route, 'preview');
    if (requestUrl.pathname === '/api/designer/image-assets') return route.fulfill(jsonResponse({ success: true, assets: {} }));
    diagnostics.unmockedApi.push(`${request.method()} ${requestUrl.pathname}`);
    return route.fulfill(jsonResponse({ success: true, data: {} }));
  });
}

async function testPrototype(browser, profileStore) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await blockExternalNetwork(context);
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('weixun_session', 'competitor-preview-fixture');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'platform_designer', userId: 'competitor-preview-fixture', displayName: '竞品资料验收' }));
  });
  const page = await context.newPage();
  attachDiagnostics(page);
  await installPreviewApi(page, profileStore);
  await page.goto(`${baseUrl}/project1-prototype-v9.html`, { waitUntil: 'domcontentloaded' });
  const initialProfileReads = profileStore.getCalls;
  await page.getByRole('button', { name: '开始项目一' }).click();
  await page.locator('.topbar').waitFor({ state: 'visible' });
  await waitForProfileReads(profileStore, initialProfileReads + 1, 'prototype initial competitor load');
  await page.locator('#competitor-summary-copy').getByText(/3 家/).waitFor({ state: 'visible' });
  await assertSummaryCardsAligned(page, 'button[data-action="project-notice"]', '查看竞争对手资料', 'prototype desktop 1440x900');
  assert.equal(await page.locator('#competitor-summary-card').count(), 1, 'prototype header has one competitor summary card');
  assert.equal(await page.locator('.competitor-profile-card, .competitor-strip').count(), 0,
    'prototype has no per-company cards or lower competitor strip');
  assert.equal(await page.getByRole('button', { name: /ABC竞品/ }).count(), 0,
    'prototype game does not render the legacy ABC placeholder as a card');
  const apBefore = (await page.locator('#ap-badge strong').innerText()).trim();
  await assertNoHorizontalOverflow(page, 'prototype desktop 1440x900');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-cards-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  const modal = page.locator('#modal-root .modal-backdrop .modal');
  await modal.waitFor({ state: 'visible' });
  const initialVisibleProfiles = visibleProfiles(profileStore.profiles);
  await assertPreviewCompanyList(modal, initialVisibleProfiles, 'prototype initial list');
  const previewShellSelectors = {
    modalSelector: '#modal-root .modal-backdrop .modal',
    backdropSelector: '#modal-root .modal-backdrop',
    bodySelector: '#competitor-modal-body',
    scrollContainerSelector: '.modal',
  };
  const previewInitialShell = await captureCompetitorModalShell(page, previewShellSelectors, true);
  assertStableCompetitorModalShell(previewInitialShell, 'prototype modal first open');
  assert.equal(await modal.getByText('ABC竞品', { exact: true }).count(), 0,
    'prototype company list excludes the legacy ABC placeholder');
  const previewFirstRow = modal.locator('.competitor-company-row[data-action="open-competitor-company"]').first();
  await previewFirstRow.focus();
  const previewBeforeUnchangedRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  const previewBeforeUnchangedReads = profileStore.getCalls;
  const previewUnchangedReadWait = waitForProfileReads(profileStore, previewBeforeUnchangedReads + 1, 'prototype unchanged-data focus refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await previewUnchangedReadWait;
  await assertPreviewCompanyList(modal, initialVisibleProfiles, 'prototype list after unchanged-data refresh');
  const previewAfterUnchangedRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  assertStableCompetitorModalShell(previewAfterUnchangedRefresh, 'prototype unchanged-data refresh');
  assert.equal(previewAfterUnchangedRefresh.sameBodyAsOriginal, true, 'prototype same-data refresh preserves modal body');
  assert.deepEqual(previewAfterUnchangedRefresh.focus, previewBeforeUnchangedRefresh.focus,
    'prototype same-data refresh preserves keyboard focus');
  assert.equal(previewAfterUnchangedRefresh.bodyScrollTop, previewBeforeUnchangedRefresh.bodyScrollTop,
    'prototype same-data refresh preserves modal body scroll position');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-list-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const firstProfile = initialVisibleProfiles[0];
  const secondProfile = initialVisibleProfiles[1];
  await modal.getByRole('button', { name: `查看 ${firstProfile.company_name} 详情`, exact: true }).click();
  await assertPreviewCompanyDetail(modal, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype list-to-detail navigation');
  await modal.locator('[data-action="competitor-back"]').focus();
  const previewBeforeDetailRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  const previewBeforeDetailRefreshReads = profileStore.getCalls;
  const previewDetailReadWait = waitForProfileReads(profileStore, previewBeforeDetailRefreshReads + 1, 'prototype detail unchanged-data refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await previewDetailReadWait;
  await assertPreviewCompanyDetail(modal, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  const previewAfterDetailRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  assertStableCompetitorModalShell(previewAfterDetailRefresh, 'prototype unchanged-data detail refresh');
  assert.equal(previewAfterDetailRefresh.sameBodyAsOriginal, true, 'prototype detail refresh preserves modal body');
  assert.deepEqual(previewAfterDetailRefresh.focus, previewBeforeDetailRefresh.focus,
    'prototype detail refresh preserves keyboard focus');
  assert.equal(previewAfterDetailRefresh.bodyScrollTop, previewBeforeDetailRefresh.bodyScrollTop,
    'prototype detail refresh preserves modal body scroll position');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-detail-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const originalPreviewExperience = firstProfile.representative_experience;
  firstProfile.representative_experience = `${originalPreviewExperience}\n${Array.from({ length: 36 }, (_, index) => `滚动保留验收内容 ${index + 1}：该段仅用于确认长详情在同资料刷新后保留滚动位置。`).join('\n')}`;
  profileStore.revision += 1;
  const previewLongDetailReads = profileStore.getCalls;
  const previewLongDetailWait = waitForProfileReads(profileStore, previewLongDetailReads + 1, 'prototype long-detail refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await previewLongDetailWait;
  await assertPreviewCompanyDetail(modal, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  const previewScrollSetup = await page.evaluate(() => {
    const scrollContainer = document.querySelector('#modal-root .modal-backdrop .modal');
    const returnButton = document.querySelector('#modal-root [data-action="competitor-back"]');
    if (!scrollContainer || !returnButton) return null;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    returnButton.focus({ preventScroll: true });
    return {
      scrollTop: scrollContainer.scrollTop,
      maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight,
    };
  });
  assert.ok(previewScrollSetup && previewScrollSetup.maxScrollTop > 0 && previewScrollSetup.scrollTop > 0,
    'prototype fixture creates a genuinely scrollable modal shell');
  const previewBeforeScrollableRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  const previewBeforeScrollableReads = profileStore.getCalls;
  const previewScrollableReadWait = waitForProfileReads(profileStore, previewBeforeScrollableReads + 1, 'prototype same-detail scroll refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await previewScrollableReadWait;
  await assertPreviewCompanyDetail(modal, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  const previewAfterScrollableRefresh = await captureCompetitorModalShell(page, previewShellSelectors);
  assertStableCompetitorModalShell(previewAfterScrollableRefresh, 'prototype same-detail scroll refresh');
  assert.equal(previewAfterScrollableRefresh.sameBodyAsOriginal, true, 'prototype same-detail refresh preserves body node');
  assert.deepEqual(previewAfterScrollableRefresh.focus, previewBeforeScrollableRefresh.focus,
    'prototype same-detail refresh preserves keyboard focus');
  assert.ok(previewAfterScrollableRefresh.bodyScrollTop > 0, 'prototype same-detail refresh retains non-zero modal scroll');
  assert.equal(previewAfterScrollableRefresh.bodyScrollTop, previewBeforeScrollableRefresh.bodyScrollTop,
    'prototype same-detail refresh keeps modal scroll position unchanged');

  firstProfile.representative_experience = originalPreviewExperience;
  profileStore.revision += 1;
  const previewRestoreReads = profileStore.getCalls;
  const previewRestoreWait = waitForProfileReads(profileStore, previewRestoreReads + 1, 'prototype restore short-detail fixture');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await previewRestoreWait;
  await assertPreviewCompanyDetail(modal, firstProfile, initialVisibleProfiles.filter((item) => item.id !== firstProfile.id));
  await modal.getByRole('button', { name: '返回竞争对手列表', exact: true }).click();
  await assertPreviewCompanyList(modal, initialVisibleProfiles, 'prototype list after first detail');
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype detail-to-list navigation');
  await modal.getByRole('button', { name: `查看 ${secondProfile.company_name} 详情`, exact: true }).click();
  await assertPreviewCompanyDetail(modal, secondProfile, initialVisibleProfiles.filter((item) => item.id !== secondProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype second detail navigation');
  await modal.getByRole('button', { name: '返回竞争对手列表', exact: true }).click();
  await assertPreviewCompanyList(modal, initialVisibleProfiles, 'prototype list after switching companies');
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype second return to list');
  await page.keyboard.press('Escape');
  await page.locator('#modal-root .modal-backdrop').waitFor({ state: 'detached' });

  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await modal.waitFor({ state: 'visible' });
  await assertPreviewCompanyList(modal, initialVisibleProfiles, 'prototype list after close and reopen');
  const previewReopenedShell = await captureCompetitorModalShell(page, previewShellSelectors, true);
  assertStableCompetitorModalShell(previewReopenedShell, 'prototype modal reopen');
  await modal.getByRole('button', { name: `查看 ${firstProfile.company_name} 详情`, exact: true }).click();
  const beforeUpdateReads = profileStore.getCalls;
  const updatedProfile = setUpdatedProfile(profileStore, initialProfiles[0].id);
  const updateReadWait = waitForProfileReads(profileStore, beforeUpdateReads + 1, 'preview focus refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await updateReadWait;
  await assertPreviewCompanyDetail(modal, updatedProfile, visibleProfiles(profileStore.profiles).filter((item) => item.id !== updatedProfile.id));
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype designer edit refresh');
  const updatedCompany = modal.locator(`.competitor-company-detail[data-competitor-id="${updatedProfile.id}"]`);
  await updatedCompany.getByText(updatedProfile.solution_summary, { exact: true }).waitFor({ state: 'visible' });
  await updatedCompany.getByText(updatedProfile.service_support, { exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-after-designer-update.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const beforeDeleteReads = profileStore.getCalls;
  profileStore.profiles = profileStore.profiles.filter((item) => item.id !== updatedProfile.id);
  profileStore.revision += 1;
  const deleteReadWait = waitForProfileReads(profileStore, beforeDeleteReads + 1, 'preview deletion refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await deleteReadWait;
  await modal.waitFor({ state: 'visible' });
  await updatedCompany.waitFor({ state: 'detached' });
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype deletion refresh');
  const afterDeleteProfiles = visibleProfiles(profileStore.profiles);
  await assertPreviewCompanyList(modal, afterDeleteProfiles, 'prototype list after deleting the selected company');
  assert.equal(afterDeleteProfiles.some((item) => item.id === updatedProfile.id), false,
    'prototype list no longer contains the deleted company');
  assert.equal(await modal.getByText('ABC竞品', { exact: true }).count(), 0,
    'prototype modal continues to exclude the legacy ABC placeholder after refresh');

  const beforeEmptyReads = profileStore.getCalls;
  profileStore.profiles = [];
  profileStore.revision += 1;
  const emptyReadWait = waitForProfileReads(profileStore, beforeEmptyReads + 1, 'preview empty refresh');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await emptyReadWait;
  await modal.getByText('设计师尚未配置竞争对手资料。', { exact: true }).waitFor({ state: 'visible' });
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype empty refresh');
  assert.equal(await modal.locator('.competitor-company-row[data-action="open-competitor-company"]').count(), 0,
    'prototype empty state replaces the company list while keeping the modal open');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-empty-state.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  const beforeFailureReads = profileStore.getCalls;
  profileStore.profiles = [legacyAbcProfile, ...initialProfiles].map((item) => ({ ...item }));
  profileStore.revision += 1;
  profileStore.failNextGets = 1;
  const failureReadWait = waitForProfileReads(profileStore, beforeFailureReads + 1, 'preview failure state');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await failureReadWait;
  await modal.getByText('暂时无法读取竞争对手资料', { exact: false }).waitFor({ state: 'visible' });
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype error refresh');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-error-state.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  const retryButton = modal.locator('button[data-action="refresh-competitors"]');
  const beforeRetryReads = profileStore.getCalls;
  const retryReadWait = waitForProfileReads(profileStore, beforeRetryReads + 1, 'preview explicit retry');
  await retryButton.click();
  await retryReadWait;
  await assertPreviewCompanyList(modal, visibleProfiles(profileStore.profiles), 'prototype list after retry');
  assertStableCompetitorModalShell(await captureCompetitorModalShell(page, previewShellSelectors), 'prototype retry refresh');

  await page.setViewportSize({ width: 390, height: 844 });
  await assertSummaryCardsAligned(page, 'button[data-action="project-notice"]', '查看竞争对手资料', 'prototype mobile 390x844');
  await assertNoHorizontalOverflow(page, 'prototype mobile 390x844');
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-cards-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await modal.waitFor({ state: 'visible' });
  await assertPreviewCompanyList(modal, visibleProfiles(profileStore.profiles), 'prototype mobile company list');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-list-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await modal.getByRole('button', { name: `查看 ${secondProfile.company_name} 详情`, exact: true }).click();
  await assertPreviewCompanyDetail(modal, secondProfile, visibleProfiles(profileStore.profiles).filter((item) => item.id !== secondProfile.id));
  await assertNoHorizontalOverflow(page, 'prototype mobile detail 390x844');
  await page.screenshot({ path: path.join(evidenceDir, 'preview-competitor-detail-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '查看竞争对手资料', exact: true }).click();
  await modal.waitFor({ state: 'visible' });
  await assertPreviewCompanyList(modal, visibleProfiles(profileStore.profiles), 'prototype mobile list after close and reopen');
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });

  assertProfileRequestBoundary(profileStore, 'preview');
  assert.equal((await page.locator('#ap-badge strong').innerText()).trim(), apBefore,
    'opening and refreshing competitor data does not change preview action points');
  const countdown = await page.locator('#countdown-value').innerText();
  assert.match(countdown, /^\d{2}:\d{2}$/, 'preview countdown remains visible and well-formed');
  assert.deepEqual(diagnostics.modelRequests.filter((item) => item.startsWith('preview')), [],
    'competitor preview acceptance never calls a mutating preview/model action');
  await context.close();
  results.push('preview /project1-prototype-v9.html: list/detail navigation, focus refresh, and deletion retain the same modal shell; unchanged data preserves body, focus, and scroll; no active modal entrance animation on open/reopen; competitor data edit, empty/error retry, legacy ABC exclusion, mobile layout, and stable AP/countdown passed');
}

async function installDesignerApi(page, store) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;
    if (pathname === '/api/game-data/competitors' && request.method() === 'GET') {
      const projectId = requestUrl.searchParams.get('project_id');
      const token = request.headers()['x-session'] || '';
      store.designerGets.push({ projectId, hasSessionHeader: Boolean(token) });
      assert.equal(projectId, '1', 'designer loads project 1 competitor profiles');
      assert.ok(token, 'designer profile request carries a session header');
      return route.fulfill(jsonResponse({ success: true, data: visibleProfiles(store.profiles).map((item) => ({ ...item })), revision: store.revision }));
    }
    if (pathname === '/api/game-data/competitors' && ['POST', 'PUT'].includes(request.method())) {
      const payload = request.postDataJSON();
      store.writes.push({ method: request.method(), payload });
      diagnostics.designerWrites.push({ method: request.method(), payload });
      assert.equal(payload.project_id, 1, 'designer write is bound to project 1');
      assert.equal(payload.expected_revision, store.revision, 'designer write includes the latest expected revision');
      const next = {
        id: request.method() === 'PUT' ? payload.id : 'competitor-designed-new',
        project_id: 1,
        company_name: payload.company_name,
        features: payload.features,
        more_info: payload.more_info,
        industry: payload.industry,
        solution_summary: payload.solution_summary,
        representative_experience: payload.representative_experience,
        service_support: payload.service_support,
      };
      if (request.method() === 'PUT') {
        const index = store.profiles.findIndex((item) => item.id === payload.id);
        assert.notEqual(index, -1, 'designer PUT updates an existing mock profile');
        store.profiles[index] = next;
      } else {
        store.profiles.push(next);
      }
      store.revision += 1;
      return route.fulfill(jsonResponse({
        success: true,
        data: visibleProfiles(store.profiles).map((item) => ({ ...item })),
        revision: store.revision,
        persisted: true,
        item: { ...next },
      }));
    }
    if (pathname === '/api/game-data/projects') {
      return route.fulfill(jsonResponse({ data: [{ project_id: 1, name: '项目一 · 智能制造平台', budget: 100, description: '采购设备联网与运营管理平台' }] }));
    }
    if (pathname === '/api/game-data/npcs') return route.fulfill(jsonResponse({ data: [] }));
    if (pathname === '/api/designer/scene-assets') return route.fulfill(jsonResponse({ scenes: [] }));
    if (pathname === '/api/designer/image-assets') return route.fulfill(jsonResponse({ assets: [] }));
    diagnostics.unmockedApi.push(`${request.method()} ${pathname}`);
    return route.fulfill(jsonResponse({ success: true, data: {} }));
  });
}

async function testDesignerEdit(browser, profileStore) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await blockExternalNetwork(context);
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('weixun_session', 'competitor-designer-fixture');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'platform_designer', userId: 'competitor-designer-fixture', displayName: '竞品资料验收' }));
  });
  const page = await context.newPage();
  attachDiagnostics(page);
  await installDesignerApi(page, profileStore);
  await page.goto(`${baseUrl}/designer`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^数据/ }).click();
  await page.getByRole('button', { name: '竞品数据', exact: true }).click();
  await page.getByText('华星智造有限公司', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.getByPlaceholder('公司名称').fill('华星智造有限公司');
  await page.getByPlaceholder('核心优势（必填）').fill(FIELD_VALUES.features);
  await page.getByPlaceholder('基本介绍（必填）').fill(FIELD_VALUES.more_info);
  await page.getByPlaceholder('所属行业（选填）').fill(FIELD_VALUES.industry);
  await page.getByPlaceholder('方案概况（选填）').fill(FIELD_VALUES.solution_summary);
  await page.getByPlaceholder('代表性经验（选填；仅填写有依据的信息）').fill(FIELD_VALUES.representative_experience);
  await page.getByPlaceholder('交付与服务支持（选填）').fill(FIELD_VALUES.service_support);
  const writePromise = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/game-data/competitors', { timeout: 10_000 });
  await page.getByRole('button', { name: '保存竞品' }).click();
  const writeRequest = await writePromise;
  const payload = writeRequest.postDataJSON();
  assert.equal(payload.id, initialProfiles[0].id, 'designer edit sends the existing profile id');
  assert.deepEqual({
    company_name: payload.company_name,
    features: payload.features,
    more_info: payload.more_info,
    industry: payload.industry,
    solution_summary: payload.solution_summary,
    representative_experience: payload.representative_experience,
    service_support: payload.service_support,
  }, {
    company_name: '华星智造有限公司',
    features: FIELD_VALUES.features,
    more_info: FIELD_VALUES.more_info,
    industry: FIELD_VALUES.industry,
    solution_summary: FIELD_VALUES.solution_summary,
    representative_experience: FIELD_VALUES.representative_experience,
    service_support: FIELD_VALUES.service_support,
  }, 'designer editor persists every displayed profile field');
  await page.getByText(FIELD_VALUES.service_support, { exact: false }).waitFor({ state: 'visible' });
  await page.getByText(FIELD_VALUES.representative_experience, { exact: false }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'designer-competitor-edited-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  assert.equal(visibleProfiles(profileStore.profiles).length, 3, 'designer update keeps the visible company count stable');
  assert.ok(profileStore.profiles.some((item) => item.id === LEGACY_ABC_ID && item.company_name === 'ABC竞品'),
    'the mocked source retains the legacy ABC UUID101 fixture while hiding it from designer and game API responses');
  assert.ok(profileStore.designerGets.some((entry) => entry.projectId === '1' && entry.hasSessionHeader),
    'designer competitor list GET includes project_id=1 and session header');
  assert.deepEqual(diagnostics.modelRequests.filter((item) => item.startsWith('designer')), [], 'designer form save does not invoke AI');
  await context.close();
  results.push('designer /designer → 数据 → 竞品数据: all seven form fields saved in a PUT payload with project_id and expected_revision; mock source updated for both game surfaces');
  return profileStore;
}

function writeReport(status, error) {
  const report = [
    '# 竞争对手资料联动浏览器验收（2026-10-14）',
    '',
    `状态：${status}`,
    '',
    ...results.map((result) => `- ${result}`),
    ...(error ? [`- 失败：${safeDiagnosticText(error instanceof Error ? error.message : error)}`] : []),
    '',
    '## Modal 闪动排查',
    '',
    '- 静态根因（主线程对旧实现的检查）：原型页 `openModal` 每次都通过 `modalRoot.innerHTML` 重建 backdrop 和 modal；CSS 分别为 backdrop 与 modal 设置 `backdropIn`、`modalIn` 入场动画，因此打开和内部导航会重复触发入场效果。',
    '- 旧版本运行时 baseline 未取得：在访问旧服务前原型 HTML 已更新为稳定 shell，且本机默认沙箱拒绝了 localhost socket；报告只记录静态根因和下面对最终页面的实际浏览器断言，不声称做过旧版运行时对比。',
    '- 最终页面实际检查打开/重开时 computed `animation-name` 为 `none` 且无活动动画；焦点刷新、列表/详情往返、删除刷新，以及正式页 timer poll 后 backdrop/modal 节点不变；相同资料刷新还检查 body 节点、焦点和真实非零滚动位置。',
    '',
    '## Mock 边界',
    '',
    '- 使用本地 `127.0.0.1:3000` 页面，通过 Playwright 路由 mock 所有应用 API；测试数据只存在于本脚本内存中的 profile store。',
    '- Mock 原始资料包含旧 UUID `10000000-0000-4000-8000-000000000101` 的 `ABC竞品` 占位；mock API 按 UUID 与占位公司名同时匹配后过滤它，避免把旧资料展示给设计师和玩家。',
    '- 设计师保存由 mock `/api/game-data/competitors` 接收并校验完整 payload，再将更新写入同一个内存 store；正式页与预览页从 mock `/api/game-data/competitor-profiles?project_id=1` 读取相同 revision 和资料。该流程验证前后端契约与页面联动，不验证数据库、权限服务或真实持久化。',
    '- 浏览器对非本机 origin 的网络请求全部拦截；正式聊天、预览消息/拜访/电话 AI 请求均未调用。计时和行动点只通过页面/API mock 观察，竞品交互不发送游戏命令。',
    '',
    '## 独立的真实配置检查',
    '',
    '- 主线程另行查询了真实管理数据库：项目当前有 2 家竞品，revision 为 2，`ABC_removed=true`。这不是本次 Playwright mock 请求的结果。',
    '- 真实 REST 浏览器保存仍未验收；外部 REST 连接受 TLS `ECONNRESET` 限制。',
    '',
    '## 截图',
    '',
    '- 正式页： [桌面顶部卡片](formal-competitor-cards-desktop.png) · [桌面公司列表](formal-competitor-list-desktop.png) · [桌面公司详情](formal-competitor-detail-desktop.png) · [手机顶部卡片](formal-competitor-cards-mobile.png) · [手机公司列表](formal-competitor-list-mobile.png) · [手机公司详情](formal-competitor-detail-mobile.png)',
    '- 预览页： [桌面顶部卡片](preview-competitor-cards-desktop.png) · [桌面公司列表](preview-competitor-list-desktop.png) · [桌面公司详情](preview-competitor-detail-desktop.png) · [手机顶部卡片](preview-competitor-cards-mobile.png) · [手机公司列表](preview-competitor-list-mobile.png) · [手机公司详情](preview-competitor-detail-mobile.png)',
    '- 交互状态： [正式页编辑后更新](formal-competitor-after-designer-update.png) · [预览页编辑后更新](preview-competitor-after-designer-update.png) · [设计师编辑表单](designer-competitor-edited-desktop.png) · [正式页空状态](formal-competitor-empty-state.png) · [正式页错误与重试](formal-competitor-error-state.png) · [预览页空状态](preview-competitor-empty-state.png) · [预览页错误与重试](preview-competitor-error-state.png)',
    '',
    '## 浏览器诊断',
    '',
    `- 页面运行错误：${diagnostics.pageErrors.length}`,
    `- Next 静态资源失败：${diagnostics.failedNextRequests.length}`,
    `- 未预期应用 API：${diagnostics.unmockedApi.length}`,
    `- 出站外部请求（已拦截）：${diagnostics.externalRequests.length}`,
    `- AI/模型写请求：${diagnostics.modelRequests.length}`,
    `- 资料 GET：${diagnostics.profileRequests.length}`,
    `- 设计师保存：${diagnostics.designerWrites.length}`,
    '',
    '截图与本报告位于 `harness/evidence/competitor-profiles-2026-10-14/`。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(evidenceDir, 'report.md'), report, 'utf8');
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const sharedDesignerStore = makeProfileStore();
    sharedDesignerStore.designerGets = [];
    await testDesignerEdit(browser, sharedDesignerStore);
    initialProfiles[0] = { ...visibleProfiles(sharedDesignerStore.profiles)[0] };
    // Both player-facing surfaces read the same in-memory store the designer just updated.
    await testFormalGame(browser, sharedDesignerStore);
    await testPrototype(browser, sharedDesignerStore);
    assert.deepEqual(diagnostics.pageErrors, [], `browser page errors: ${diagnostics.pageErrors.join('; ')}`);
    assert.deepEqual(diagnostics.unmockedApi, [], `unexpected application API requests: ${diagnostics.unmockedApi.join('; ')}`);
    assert.deepEqual(diagnostics.externalRequests, [], `external requests were blocked: ${diagnostics.externalRequests.join('; ')}`);
    assert.deepEqual(diagnostics.modelRequests, [], `unexpected AI/model calls: ${diagnostics.modelRequests.join('; ')}`);
    assert.deepEqual(diagnostics.badNextResponses, [], `failed Next assets: ${diagnostics.badNextResponses.join('; ')}`);
    writeReport('通过', null);
    console.log('Competitor profile designer/formal/prototype browser acceptance passed at desktop 1440x900 and mobile 390x844. All application APIs were mocked; no external/model calls were made.');
  } catch (error) {
    writeReport('未通过', error);
    console.error(error);
    console.error(`browser diagnostics=${JSON.stringify({
      pageErrors: diagnostics.pageErrors.slice(-20),
      consoleErrors: diagnostics.consoleErrors.slice(-20),
      failedNextRequests: diagnostics.failedNextRequests.slice(-20),
      badNextResponses: diagnostics.badNextResponses.slice(-20),
      unmockedApi: diagnostics.unmockedApi.slice(-20),
      externalRequests: diagnostics.externalRequests.slice(-20),
      modelRequests: diagnostics.modelRequests.slice(-20),
    })}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
