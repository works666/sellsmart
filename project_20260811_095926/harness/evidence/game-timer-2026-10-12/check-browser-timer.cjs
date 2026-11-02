const assert = require('node:assert/strict');
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
  getPlayerVisibleProjectTimer,
  synchronizeProjectTimer,
  toPlayerVisibleGameState,
} = projectRequire(path.join(projectRoot, 'src/lib/game/state.ts'));
const { PROJECT_ONE_NPCS } = projectRequire(path.join(projectRoot, 'src/lib/game/project-one.ts'));

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const sessionId = 'game-timer-browser-fixture';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const notice = require(path.join(projectRoot, 'public/project-one-notice.json'));
const diagnostics = { pageErrors: [], consoleErrors: [], failedNextRequests: [], badNextResponses: [], unmockedApi: [], mutatingModelRequests: [] };

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

function jsonResponse(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function newFormalHarness() {
  const state = createProjectOneState();
  state.projectTimer = {
    ...state.projectTimer,
    elapsedMs: 0,
    recoveredIntervals: 0,
    visitPaused: false,
    lastResumedAt: new Date().toISOString(),
  };
  return { state, timerPolls: 0 };
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
    const browserDiagnostics = {
      pageErrors: diagnostics.pageErrors.slice(-20),
      consoleErrors: diagnostics.consoleErrors.slice(-20),
      failedNextRequests: diagnostics.failedNextRequests.slice(-20),
      badNextResponses: diagnostics.badNextResponses.slice(-20),
    };
    throw new Error(`${label} could not find the global plan heading; visible page diagnostics=${JSON.stringify(pageState)}; browser errors/assets=${JSON.stringify(browserDiagnostics)}; cause=${error instanceof Error ? error.message : 'unknown'}`);
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

async function interceptFormalApi(page, harness) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname.startsWith('/api/chat/stream')) {
      diagnostics.mutatingModelRequests.push(pathname);
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
    if (pathname === '/api/designer/image-assets') return route.fulfill(jsonResponse({ success: true, assets: {} }));
    if (pathname === '/api/game/sessions' && request.method() === 'GET') return route.fulfill(jsonResponse({ success: true, saves: [] }));
    if (pathname === `/api/game/sessions/${sessionId}/commands`) {
      return route.fulfill(jsonResponse({ error: 'mock browser smoke must not mutate a save' }, 500));
    }
    diagnostics.unmockedApi.push(`${request.method()} ${pathname}`);
    return route.fulfill(jsonResponse({ success: true, data: {} }));
  });
}

async function testFormalGame(browser) {
  const harness = newFormalHarness();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('weixun_session', 'timer-ui-fixture');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'player', userId: 'timer-ui-fixture', displayName: '计时验收' }));
  });
  const page = await context.newPage();
  attachDiagnostics(page);
  await interceptFormalApi(page, harness);
  const firstTimerPost = page.waitForRequest((request) => {
    const requestUrl = new URL(request.url());
    return request.method() === 'POST' && requestUrl.pathname === `/api/game/sessions/${sessionId}/timer`;
  }, { timeout: 15_000 });

  await page.goto(`${baseUrl}/game?location=project-1&mode=solo&sessionId=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' });
  await waitForGlobalPlanHeading(page, 'formal game');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  const desktop = await page.evaluate(() => {
    const organizationColumn = document.querySelector('[class*="organizationColumn"]');
    const workspace = organizationColumn?.parentElement ?? null;
    const visibleChildren = workspace ? Array.from(workspace.children).filter((element) => element.getBoundingClientRect().width > 0) : [];
    const tracks = workspace ? getComputedStyle(workspace).gridTemplateColumns.trim().split(/\s+/).length : 0;
    return {
      foundOrganizationColumn: Boolean(organizationColumn),
      childCount: visibleChildren.length,
      tracks,
      text: document.querySelector('header')?.innerText ?? '',
    };
  });
  assert.equal(desktop.foundOrganizationColumn, true, 'formal game exposes its organization column');
  assert.equal(desktop.childCount, 2, 'formal game shows the two workspace columns');
  assert.equal(desktop.tracks, 2, 'formal game grid allocates exactly two desktop columns');
  assert.doesNotMatch(desktop.text, /当前阶段|阶段进度|第\s*[1-5]\s*阶段/, 'formal header contains no stage progress UI');
  await assertNoHorizontalOverflow(page, 'formal desktop 1440x900');
  await page.getByText(/^20:0[0-1]$/, { exact: false }).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'after-formal-global-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  await page.getByRole('button', { name: '打开项目招标通知' }).click();
  await page.getByRole('heading', { name: '项目采购通知', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: notice.title, exact: true }).waitFor({ state: 'visible' });
  await page.getByText(/项目总时长为\s*20\s*分钟/).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'after-formal-notice-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.keyboard.press('Escape');
  await firstTimerPost;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGlobalPlanHeading(page, 'formal mobile refresh');
  await page.waitForLoadState('networkidle');
  await assertNoHorizontalOverflow(page, 'formal mobile 390x844');
  await page.screenshot({ path: path.join(evidenceDir, 'after-formal-global-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  assert.ok(harness.timerPolls >= 1, 'formal browser synchronizes its timer with the mock timer endpoint');
  assert.equal(harness.state.version, 1, 'timer reads do not advance the mock game version');
  assert.equal(harness.state.actionPoints, 28, 'initial timer reads do not change action points');
  assert.deepEqual(diagnostics.mutatingModelRequests, [], 'formal UI mock makes no AI/model requests');
  await context.close();
}

async function testPrototype(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('weixun_session', 'timer-preview-fixture');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'platform_designer', userId: 'timer-preview-fixture', displayName: '计时验收' }));
  });
  const page = await context.newPage();
  attachDiagnostics(page);
  await page.route('**/api/project-one-preview/ai**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill(jsonResponse({ success: true, previewSessionId: 'timer-preview-fixture', version: 1, data: { previewSessionId: 'timer-preview-fixture', version: 1, timer: { elapsedMs: 0, lastResumedAt: Date.now(), paused: false, refillsApplied: 0, expired: false, settled: false }, npcTestStates: [] } }));
    }
    const body = request.postDataJSON();
    if (body.action === 'message' || body.action === 'visit_turn' || body.action === 'phone_connect') {
      diagnostics.mutatingModelRequests.push(`preview:${body.action}`);
      return route.fulfill(jsonResponse({ error: 'mock browser smoke must not call AI' }, 500));
    }
    return route.fulfill(jsonResponse({ success: true, previewSessionId: 'timer-preview-fixture', version: 1, data: { version: 1, previewSessionId: 'timer-preview-fixture', timer: body.timer ?? { elapsedMs: 0, lastResumedAt: Date.now(), paused: false, refillsApplied: 0, expired: false, settled: false }, npcTestStates: [] } }));
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/api/project-one-preview/ai')) return route.fallback();
    return route.fulfill(jsonResponse({ success: true, data: {} }));
  });

  await page.goto(`${baseUrl}/project1-prototype-v9.html`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始项目一' }).click();
  await page.locator('.topbar').waitFor({ state: 'visible' });
  await page.getByText(notice.title, { exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.topbar')?.innerText.includes('20:00'));
  const desktop = await page.evaluate(() => {
    const columns = Array.from(document.querySelectorAll('.workspace > *')).filter((element) => getComputedStyle(element).display !== 'none');
    return { columnCount: columns.length, text: document.querySelector('.topbar')?.innerText ?? '' };
  });
  assert.equal(desktop.columnCount, 2, 'prototype shows two workspace columns');
  assert.doesNotMatch(desktop.text, /当前阶段|第\s*[1-5]\s*阶段/, 'prototype header contains no stage progress UI');
  await assertNoHorizontalOverflow(page, 'prototype desktop 1440x900');
  await page.screenshot({ path: path.join(evidenceDir, 'after-prototype-global-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  await page.getByRole('button', { name: '查看项目招标通知' }).click();
  await page.getByRole('heading', { name: notice.title, exact: true }).waitFor({ state: 'visible' });
  await page.getByText(/项目总时长为\s*20\s*分钟/).waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'after-prototype-notice-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  await page.locator('.modal-close').click();

  await page.getByRole('button', { name: '测试调节' }).click();
  await page.locator('#test-remaining-seconds').waitFor({ state: 'visible' });
  await page.locator('#test-remaining-seconds').fill('604');
  await page.locator('#test-action-points').fill('27');
  await page.getByRole('button', { name: '应用测试值' }).click();
  await page.waitForFunction(() => /10:0[34]/.test(document.querySelector('.topbar')?.innerText ?? ''));
  await page.waitForFunction(() => /27/.test(document.querySelector('.top-ap')?.innerText ?? ''));
  await page.screenshot({ path: path.join(evidenceDir, 'after-prototype-adjusted-timer-desktop.png'), fullPage: true, animations: 'disabled', caret: 'initial' });

  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page, 'prototype mobile 390x844');
  await page.screenshot({ path: path.join(evidenceDir, 'after-prototype-adjusted-timer-mobile.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  assert.deepEqual(diagnostics.mutatingModelRequests, [], 'prototype timer UI does not invoke AI/model endpoints');
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    await testFormalGame(browser);
    await testPrototype(browser);
    assert.deepEqual(diagnostics.pageErrors, [], `browser page errors: ${diagnostics.pageErrors.join('; ')}`);
    assert.deepEqual(diagnostics.unmockedApi, [], `unexpected API requests: ${diagnostics.unmockedApi.join('; ')}`);
    console.log('Formal and prototype timer browser acceptance passed at desktop 1440x900 and mobile 390x844.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
