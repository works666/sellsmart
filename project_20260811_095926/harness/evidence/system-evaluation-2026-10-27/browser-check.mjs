import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.SYSTEM_EVALUATION_BASE_URL ?? 'http://127.0.0.1:3000';
const sessionIds = {
  first: 'b4f3c2d1-9a87-4b65-8c43-1234567890ab',
  second: 'a9e8d7c6-5b43-4a21-9c87-abcdef123456',
};
const calls = [];
let postMode = 'completed';

function state(support) {
  return {
    support,
    pleasantness: 50,
    effectiveContactCount: 1,
    node: 'initial',
    activeBlockers: [],
    dimensionScores: {},
    workingMemory: [],
    history: [],
    activeMeeting: null,
  };
}

function mockReport(payload, mode) {
  const initialState = state(20);
  const finalState = state(mode === 'completed' ? 24 : 20);
  const metricNames = ['角色一致性', '关系状态响应', '渠道适配', '事实边界'];
  const metrics = metricNames.map((name, index) => ({
    key: 'metric-' + (index + 1),
    name,
    score: mode === 'error' ? null : (mode === 'partial' && index === 2 ? null : 0.88),
    reason: mode === 'partial' && index === 2 ? '' : '模拟评委理由：' + name,
    passed: mode === 'completed' || (mode === 'partial' && index < 2),
    ...(mode === 'partial' && index === 2 ? { error: '模拟指标暂时不可用' } : {}),
  }));
  return {
    runId: 'mock-' + mode,
    createdAt: '2026-10-27T03:00:00.000Z',
    pipeline: 'project-one-preview',
    source: payload.source,
    npc: { id: payload.npcId, name: '模拟 NPC', role: '模拟业务联系人' },
    channel: payload.channel,
    expectation: payload.expectation,
    threshold: payload.threshold,
    phase: mode,
    initialState,
    finalState,
    history: [],
    rounds: mode === 'error' ? [] : [{
      round: 1,
      salesMessage: payload.salesTurns[0],
      npcResponse: '模拟 NPC 回复：可以先把项目背景发我，我看过后再判断。',
      responseAction: 'reply',
      beforeState: initialState,
      afterState: finalState,
      generationRequests: [{ messages: [{ role: 'user', content: payload.salesTurns[0] }], options: { model: 'mock-model' }, rawResponse: '模拟 NPC 回复：可以先把项目背景发我，我看过后再判断。' }],
    }],
    judge: mode === 'error' ? null : {
      engine: 'deepeval',
      metrics,
      passed: mode === 'completed',
      total100: mode === 'completed' ? 88 : null,
    },
    requestCounts: { previewLlm: 1, judge: mode === 'error' ? 0 : 4, jev: 'not_instrumented' },
    configRevisions: {
      prompt: { revision: 1, persisted: true },
      activity: { revision: 1, persisted: true },
      provider: { revision: 1, provider: 'mock', configuredModel: 'mock-model', persisted: true },
    },
    boundaries: ['mock data; no real AI call'],
    ...(mode === 'error' ? { error: { code: 'MOCK_EVALUATION_ERROR', message: '模拟后端评测失败' } } : {}),
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('weixun_session', 'designer-token-a');
  localStorage.setItem('weixun_identity', JSON.stringify({ role: 'designer' }));
});
await context.route('**/api/designer/system-evaluation', async (route) => {
  const request = route.request();
  const token = request.headers()['x-session'] ?? '';
  const call = { method: request.method(), token };
  if (request.method() === 'GET') {
    calls.push(call);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [{ previewSessionId: sessionIds.first, version: 4, updatedAt: '2026-10-27T02:00:00.000Z' }] }) });
    return;
  }
  const payload = request.postDataJSON();
  calls.push({ ...call, payload });
  const report = mockReport(payload, postMode);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, report }) });
});

try {
  await fs.mkdir(here, { recursive: true });
  await page.goto(baseUrl + '/designer/system-evaluation', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '系统链路评测' }).waitFor();
  if (!calls.some((call) => call.method === 'GET' && call.token === 'designer-token-a')) throw new Error('GET metadata did not use the current session token.');

  await page.getByLabel('关系状态来源').selectOption('snapshot');
  await page.getByLabel('从本人快照列表选择').selectOption(sessionIds.first);
  if (await page.getByLabel('本人五人预览快照 ID').inputValue() !== sessionIds.first) throw new Error('Snapshot selection did not copy its ID into the request field.');
  await page.getByRole('button', { name: '运行系统评测' }).click();
  await page.getByText('模拟 NPC 回复：可以先把项目背景发我，我看过后再判断。', { exact: true }).waitFor();
  await page.getByText('评测通过').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(here, 'desktop-success.png'), fullPage: true });
  if (!calls.some((call) => call.method === 'POST' && call.payload?.source?.kind === 'snapshot' && call.payload.source.previewSessionId === sessionIds.first)) {
    throw new Error('Snapshot evaluation did not submit the selected snapshot source.');
  }

  await page.getByLabel('关系状态来源').selectOption('fresh');
  postMode = 'partial';
  await page.getByRole('button', { name: '运行系统评测' }).click();
  await page.getByText('评测只完成了部分流程，请查看下面已完成的对话和指标错误。').waitFor();
  await page.getByText('模拟指标暂时不可用').waitFor();

  postMode = 'error';
  await page.getByRole('button', { name: '运行系统评测' }).click();
  await page.getByText('模拟后端评测失败', { exact: true }).first().waitFor();
  await page.getByText('评测未通过或未完成').waitFor();

  const secondTab = await context.newPage();
  await secondTab.goto(baseUrl + '/designer/system-evaluation', { waitUntil: 'domcontentloaded' });
  await secondTab.evaluate((token) => localStorage.setItem('weixun_session', token), 'designer-token-b');
  await page.getByText('评测结果会显示在这里').waitFor();
  if (pageErrors.length) throw new Error('Page error during report states/account switch: ' + pageErrors.join('; '));

  postMode = 'completed';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '运行系统评测' }).click();
  await page.getByText('评测通过').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(here, 'mobile-success.png'), fullPage: true });
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  if (dimensions.scrollWidth > dimensions.width + 1) throw new Error('Mobile page overflows horizontally: ' + JSON.stringify(dimensions));
  if (!calls.some((call) => call.method === 'GET' && call.token === 'designer-token-b')) throw new Error('Account switch did not reload metadata with the new token.');
  if (!calls.some((call) => call.method === 'POST' && call.token === 'designer-token-b')) throw new Error('Post-switch evaluation did not use the new session token.');

  console.log(JSON.stringify({ result: 'passed', calls, mobile: dimensions, screenshots: ['desktop-success.png', 'mobile-success.png'], reportModes: ['completed', 'partial', 'error'], apiCallsAreMocked: true }, null, 2));
} finally {
  await browser.close();
}
