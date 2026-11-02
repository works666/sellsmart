import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAdminClient } from '../../../projects/src/storage/database/supabase-client';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evidenceDir, '../../..');
const projectRoot = path.join(repoRoot, 'projects');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const dotenv = projectRequire('dotenv') as { config: (options: Record<string, unknown>) => unknown };
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: false, quiet: true });

const { chromium } = projectRequire('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const username = `formal_sync_live_${randomUUID().replaceAll('-', '')}`;
const databaseUserId = `u_${username}`;
const password = `test-${randomUUID()}`;
const admin = createAdminClient();
const browserPath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let sessionId = '';
let token = '';
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function request(pathname: string, init: RequestInit = {}, sessionToken?: string) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'x-session': sessionToken } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, payload };
}

async function assertNoHorizontalOverflow(page: import('playwright').Page, label: string) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(metrics.document, metrics.body) <= metrics.viewport + 1,
    `${label} overflows horizontally: ${JSON.stringify(metrics)}`,
  );
}

async function waitForVisible(locator: import('playwright').Locator, label: string) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(`live /game UI did not show ${label}`);
  }
}

async function cleanup() {
  const { error } = await admin
    .from('game_sessions')
    .delete()
    .eq('user_id', databaseUserId);
  if (error) throw new Error('ephemeral live-smoke session cleanup failed');
  const { data, error: verifyError } = await admin
    .from('game_sessions')
    .select('id')
    .eq('user_id', databaseUserId)
    .limit(1);
  if (verifyError || (data?.length ?? 0) > 0) throw new Error('ephemeral live-smoke session remains after cleanup');
}

async function main() {
  // Confirm the configured admin database connection before creating any row.
  const { error: connectivityError } = await admin.from('game_sessions').select('id').limit(1);
  assert.equal(connectivityError, null, 'Supabase admin read must succeed before the live smoke test');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username, password }),
  });
  assert.equal(login.response.status, 200, 'ephemeral login must succeed');
  const loginToken = String(login.payload.loginToken ?? '');
  assert.ok(loginToken, 'ephemeral login proof should be returned');

  const selection = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'select_role', loginToken, role: 'player', subRole: 'paid_individual' }),
  });
  assert.equal(selection.response.status, 200, 'individual player role selection must succeed');
  token = String(selection.payload.token ?? '');
  const identity = selection.payload.session;
  assert.ok(token && identity?.role === 'player', 'signed player session should be returned');

  const created = await request('/api/game/sessions', {
    method: 'POST',
    body: JSON.stringify({ scenarioCode: 'project-1', replaceExisting: false }),
  }, token);
  assert.equal(created.response.status, 200, 'isolated formal game session must be created');
  sessionId = String(created.payload.gameSession?.id ?? '');
  assert.ok(sessionId, 'formal API should return the created session id');

  const sessionResponse = await request(`/api/game/sessions/${sessionId}`, {}, token);
  assert.equal(sessionResponse.response.status, 200, 'formal session API should load the new save');
  const initialState = sessionResponse.payload.gameSession?.state;
  assert.ok(initialState && initialState.activeMeeting === null, 'new save starts without an active meeting');
  const initialVersion = initialState.version;
  const initialActionPoints = initialState.actionPoints;

  const npcResponse = await request(`/api/game-data/npcs?project_id=1&game_session_id=${encodeURIComponent(sessionId)}`, {}, token);
  assert.equal(npcResponse.response.status, 200, 'formal NPC API should load');
  assert.equal(npcResponse.payload.data?.length, 5, 'formal session returns the five project-one contacts');
  const firstNpcName = String(npcResponse.payload.data[0]?.name ?? '');
  assert.ok(firstNpcName, 'first project-one NPC should have a display name');

  const { data: initialRuntime, error: initialRuntimeError } = await admin
    .from('game_runtime_states')
    .select('session_id, version, action_points, simulation_state')
    .eq('session_id', sessionId)
    .maybeSingle();
  assert.equal(initialRuntimeError, null, 'runtime row should be readable from the configured database');
  assert.ok(initialRuntime, 'new formal session should have a runtime row');
  const persistedInitialState = initialRuntime.simulation_state as Record<string, unknown>;
  assert.equal(persistedInitialState.activeMeeting, null, 'database snapshot has no active meeting');

  browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(({ sessionToken, savedIdentity }) => {
    localStorage.clear();
    localStorage.setItem('weixun_session', sessionToken);
    localStorage.setItem('weixun_identity', JSON.stringify(savedIdentity));
  }, { sessionToken: token, savedIdentity: identity });
  const page = await context.newPage();
  const mutatingRequests: string[] = [];
  const apiLoadStatuses: number[] = [];
  const pageErrors: string[] = [];
  const browserConsoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserConsoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && (url.pathname.endsWith('/commands') || url.pathname === '/api/chat/stream')) {
      mutatingRequests.push(url.pathname);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes(`/api/game/sessions/${sessionId}`)) apiLoadStatuses.push(response.status());
  });

  await page.goto(`${baseUrl}/game?location=project-1&mode=solo&sessionId=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' });
  await waitForVisible(page.getByRole('heading', { name: '整体工作计划' }), 'default overall work plan');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  await assertNoHorizontalOverflow(page, 'live 1440x900 global plan');
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 5000 });
  await page.screenshot({ path: path.join(evidenceDir, 'after-live-global.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  const storedBrowserAuth = await page.evaluate(() => ({
    hasToken: Boolean(localStorage.getItem('weixun_session')),
    role: JSON.parse(localStorage.getItem('weixun_identity') || '{}').role,
  }));
  assert.deepEqual(storedBrowserAuth, { hasToken: true, role: 'player' }, 'browser receives the authorized local identity and session token');

  const firstContact = page.getByRole('button', { name: new RegExp(firstNpcName) }).first();
  await waitForVisible(firstContact, 'first contact card');
  await firstContact.click();
  await waitForVisible(page.getByRole('heading', { name: /联系人概览|CONTACT OVERVIEW/ }), 'contact overview');
  await assertNoHorizontalOverflow(page, 'live 1440x900 contact overview');
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 5000 });
  await page.screenshot({ path: path.join(evidenceDir, 'after-live-contact.png'), fullPage: true, animations: 'disabled', caret: 'initial' });
  for (const channel of ['邮件', '电话', '微信', '邮寄', '拜访']) {
    await waitForVisible(page.getByRole('button', { name: new RegExp(channel) }).first(), `${channel} action`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForVisible(page.getByRole('heading', { name: '整体工作计划' }), 'default overall plan after reload');
  const reloadedContact = page.getByRole('button', { name: new RegExp(firstNpcName) }).first();
  await waitForVisible(reloadedContact, 'contact card after reload');
  await reloadedContact.click();
  await waitForVisible(page.getByRole('heading', { name: /联系人概览|CONTACT OVERVIEW/ }), 'contact overview after reload');
  await assertNoHorizontalOverflow(page, 'live contact overview after reload');

  assert.deepEqual(mutatingRequests, [], 'browser smoke must not send messages, AI requests, or game commands');
  assert.ok(apiLoadStatuses.includes(200), 'browser must load the formal session API successfully');
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(browserConsoleErrors, [], `browser console errors: ${browserConsoleErrors.join('; ')}`);

  const reloaded = await request(`/api/game/sessions/${sessionId}`, {}, token);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.payload.gameSession?.state?.version, initialVersion, 'loading and refreshing do not change formal game version');
  assert.equal(reloaded.payload.gameSession?.state?.actionPoints, initialActionPoints, 'loading and refreshing do not consume action points');
  const { data: afterRuntime, error: afterRuntimeError } = await admin
    .from('game_runtime_states')
    .select('session_id, version, action_points, simulation_state')
    .eq('session_id', sessionId)
    .maybeSingle();
  assert.equal(afterRuntimeError, null);
  assert.equal(afterRuntime?.version, initialRuntime.version, 'database runtime version stays unchanged during browser reads');
  assert.equal(afterRuntime?.action_points, initialRuntime.action_points, 'database action points stay unchanged during browser reads');
  await context.close();

  const globalPlan = '第一阶段工作计划：目标是在阶段结束前产出由客户确认的需求清单、采购决策链和技术交流议程，不把推测当成事实。第1步通过邮件向张建国确认项目业务目标、公开100万元预算的使用边界及关键决策参与人，请客户给出当前流程样例作为证据；记录未答问题。第2步分别向李明辉确认项目实施范围、交付负责人及验收流程，向王德福核实采购规则与审批环节，向赵晓晨和刘思琪询问实际操作中的重复录入节点、当前记录方式和影响。每项问题记录原话、来源人和待核实事项。第3步准备一页现状与方案对照清单，只用可核验案例说明技术路径，列出接口兼容、责任边界、预算与工期风险，不承诺未经验证的效果。下一步是在本阶段内邀请客户确认一次30分钟技术交流，议题为核对流程证据和验收指标；邮件中询问参加人和可用时间，对方答复后保存会议议程。验收标准是客户明确确认需求、参与人和时间；尚未答复则保留为待办，进入下一阶段继续验证。';
  const planCommand = await request(`/api/game/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedVersion: initialVersion,
      type: 'work_plan',
      payload: { scope: 'global', content: globalPlan },
    }),
  }, token);
  if (planCommand.response.status !== 200) {
    throw new Error(`live work-plan workflow failed: HTTP ${planCommand.response.status}, server code ${String(planCommand.payload.error ?? 'unknown')}`);
  }
  const plannedState = planCommand.payload.state as Record<string, any>;
  assert.equal(plannedState.version, initialVersion + 1, 'real work-plan command advances the formal version once');
  assert.equal(plannedState.actionPoints, initialActionPoints - 1, 'real work-plan command consumes one action point');
  assert.ok(
    Array.isArray(plannedState.workPlans) && plannedState.workPlans.some((item: Record<string, any>) => item.scope === 'global' && item.content === globalPlan),
    'formal API returns the saved natural-language global work plan',
  );

  const visitPreparation = '拜访目标：向张建国核实当前重复录入的业务节点及验收口径。先了解问题出现的时间、涉及岗位和现有流程，再使用分阶段实施对照清单说明责任边界。现场带上验收清单与可核验案例，明确哪些细节需客户确认。若预算、决策人或采购流程不清楚，先记录待核实问题，不作承诺。下一步争取确认技术交流参加人和时间。';
  const preparationCommand = await request(`/api/game/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedVersion: plannedState.version,
      type: 'prepare',
      payload: { npcId: 'P1-001', preparationType: 'visit_preparation', title: '拜访前准备', content: visitPreparation },
    }),
  }, token);
  if (preparationCommand.response.status !== 200) {
    throw new Error(`live preparation workflow failed: HTTP ${preparationCommand.response.status}, server code ${String(preparationCommand.payload.error ?? 'unknown')}`);
  }
  const preparedState = preparationCommand.payload.state as Record<string, any>;
  const savedPreparation = Array.isArray(preparedState.preparations)
    ? preparedState.preparations.find((item: Record<string, any>) => item.npcId === 'P1-001' && item.content === visitPreparation)
    : null;
  assert.ok(savedPreparation, 'real Jev-backed visit preparation is persisted in the formal state');
  assert.equal(savedPreparation.status, 'ready', 'real preparation is ready to support a visit');
  assert.equal(savedPreparation.costPoints, 0, 'formal visit preparation costs zero action points');
  assert.equal(preparedState.version, plannedState.version + 1, 'real preparation command advances the version once');
  assert.equal(preparedState.actionPoints, plannedState.actionPoints, 'real visit preparation does not consume action points');

  const finalSession = await request(`/api/game/sessions/${sessionId}`, {}, token);
  assert.equal(finalSession.response.status, 200, 'formal save remains readable after the two real workflows');
  assert.equal(finalSession.payload.gameSession?.state?.version, initialVersion + 2, 'formal API persists both workflow versions');
  assert.equal(finalSession.payload.gameSession?.state?.actionPoints, initialActionPoints - 1, 'formal API persists only the one work-plan action point');
  const { data: finalRuntime, error: finalRuntimeError } = await admin
    .from('game_runtime_states')
    .select('session_id, version, action_points, simulation_state')
    .eq('session_id', sessionId)
    .maybeSingle();
  assert.equal(finalRuntimeError, null, 'final runtime row should be readable');
  assert.equal(finalRuntime?.version, initialVersion + 2, 'database records both real workflow commands');
  assert.equal(finalRuntime?.action_points, initialActionPoints - 1, 'database reflects one AP spent and free preparation');
  const persistedState = finalRuntime?.simulation_state as Record<string, any> | undefined;
  assert.ok(persistedState?.workPlans?.some((item: Record<string, any>) => item.scope === 'global' && item.content === globalPlan));
  assert.ok(persistedState?.preparations?.some((item: Record<string, any>) => item.npcId === 'P1-001' && item.content === visitPreparation && item.status === 'ready' && item.costPoints === 0));
  console.log('live /game smoke passed: real auth/session APIs, browser default/contact/reload, DB reads, one Jev-backed work plan (1 AP) and one Jev-backed visit preparation (0 AP, ready).');
  console.log('No live chat, phone call, or actual meeting was started.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'live formal game smoke failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => undefined);
    try {
      await cleanup();
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'ephemeral session cleanup failed');
      process.exitCode = 1;
    }
  });
