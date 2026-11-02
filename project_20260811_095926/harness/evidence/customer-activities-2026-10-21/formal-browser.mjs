import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const repo = 'D:/WeiXun/project_20260811_095926';
process.chdir(`${repo}/projects`);
const require = createRequire(`${repo}/projects/package.json`);
require('tsx/cjs');
const { createProjectOneState, toPlayerVisibleGameState } = require(`${repo}/projects/src/lib/game/state.ts`);
const { getPublicCustomerActivityOutcome } = require(`${repo}/projects/src/lib/game/customer-activities.ts`);
const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = `${repo}/harness/evidence/customer-activities-2026-10-21`;
await mkdir(output, { recursive: true });
let serverNow = Date.now();
let version = 1;
let activityGets = 0;
const mutations = [];
const errors = [];
let explicitRetryRequested = false;
const tasks = ['technical_meeting', 'case_site_visit', 'company_visit'].map((type, index) => ({
  id: `browser-activity-${index + 1}`, conversationId: 'browser-conversation', npcId: 'P1-002', type,
  summary: '我们可以安排相关活动。', basis: ['我们可以安排相关活动。', '我需要先向上汇报，确认后再答复。'],
  status: 'pending', createdAt: serverNow + index, draft: '',
}));
const runtime = createProjectOneState();
function publicActivities() {
  return tasks.map(({ evaluation, ...task }) => ({
    ...task,
    ...(evaluation ? { evaluation: { overallEvaluation: getPublicCustomerActivityOutcome(task.draft, evaluation) } } : {}),
  }));
}
function gameState() {
  const state = toPlayerVisibleGameState(runtime);
  state.version = version;
  state.customerActivities = structuredClone(publicActivities());
  state.projectTimer.isPaused = tasks.some(task => task.status === 'planning');
  return state;
}
function settle() {
  for (const task of tasks) {
    if (task.status === 'planning' && serverNow >= task.deadlineAt) {
      task.status = 'submitted'; task.submitReason = 'timeout'; task.submittedAt = task.deadlineAt;
    }
    if (task.status === 'submitted' && !task.evaluation && (task.id !== 'browser-activity-3' || explicitRetryRequested)) {
      task.evaluation = {
        overallEvaluation: '模型点评不应直接展示给玩家。',
        supportDelta: task.draft.trim() ? 1 : 0,
        pleasureDelta: task.draft.trim() ? 1 : 0,
      };
    }
  }
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let inspectedPage;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  inspectedPage = page;
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: serverNow });
  await page.addInitScript(() => {
    localStorage.setItem('weixun_session', 'browser-mock-token');
    localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'activity-browser-user', role: 'player' }));
    document.addEventListener('click', event => {
      if (event.target?.closest?.('button')?.textContent?.includes('重试获取结果')) {
        window.__customerActivityExplicitRetry = true;
      }
    }, true);
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body = { success: true, data: [] };
    if (path.endsWith('/customer-activities')) {
      if (request.method() === 'GET') activityGets++;
      if (request.method() === 'GET' && await request.frame().evaluate(() => window.__customerActivityExplicitRetry === true).catch(() => false)) explicitRetryRequested = true;
      settle();
      if (request.method() === 'POST') {
        const input = request.postDataJSON();
        mutations.push({ action: input.action, taskId: input.taskId, draft: input.draft, serverNow });
        const task = tasks.find(item => item.id === input.taskId);
        assert.ok(task);
        if (input.action === 'start' && task.status === 'pending') {
          task.status = 'planning'; task.startedAt = serverNow; task.deadlineAt = serverNow + 300000;
        }
        if ((input.action === 'save' || input.action === 'submit') && task.status === 'planning' && serverNow < task.deadlineAt) {
          if (typeof input.draft === 'string') task.draft = input.draft;
          if (input.action === 'submit') { task.status = 'submitted'; task.submitReason = 'manual'; task.submittedAt = serverNow; }
        }
        version++;
        settle();
      }
      body = { success: true, activities: structuredClone(publicActivities()), version, serverNow, state: gameState() };
    } else if (path === '/api/game/sessions/browser-session') {
      body = { success: true, gameSession: { id: 'browser-session', state: gameState() } };
    } else if (path.endsWith('/timer')) {
      body = { success: true, state: gameState(), timer: gameState().projectTimer };
    } else if (path === '/api/designer/image-assets') {
      body = { success: true, data: { assets: [] } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5000/game?location=project-1&sessionId=browser-session', { waitUntil: 'networkidle' });
  const activityDialog = () => page.getByRole('dialog');
  const dialog = page.getByRole('dialog', { name: '活动提议已匹配：「技术交流会」' });
  await dialog.waitFor();
  const promptText = await dialog.innerText();
  assert.equal(promptText.split('我们可以安排相关活动。').length - 1, 1, 'proposal must appear only once');
  assert.doesNotMatch(promptText, /我需要先向上汇报|活动提议与系统匹配结果|系统结合本次活动提议/);
  await dialog.getByRole('button', { name: '开始策划 · 5:00' }).click();
  await activityDialog().getByRole('textbox', { name: '活动方案' }).waitFor();
  await page.waitForTimeout(300);
  const deadline = tasks[0].deadlineAt;
  const input = activityDialog().getByRole('textbox', { name: '活动方案' });
  for (let i = 1; i <= 12; i++) {
    await input.fill('围绕客户接口适配需求，安排技术负责人演示并确认后续行动。'.repeat(i));
    serverNow += 300;
    await page.clock.fastForward(300);
  }
  await page.waitForTimeout(600);
  assert.ok(mutations.some(item => item.action === 'save'), 'continuous typing must trigger periodic draft saves');
  await input.blur();
  await page.waitForTimeout(600);
  const savedDraft = tasks[0].draft;
  assert.ok(savedDraft.length > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await activityDialog().waitFor();
  assert.equal(await activityDialog().getByRole('textbox', { name: '活动方案' }).inputValue(), savedDraft);
  assert.equal(tasks[0].deadlineAt, deadline, 'reload must preserve server deadline');
  await page.screenshot({ path: `${output}/formal-planning.png`, fullPage: true });
  serverNow = deadline + 1;
  await page.clock.fastForward(300000);
  await activityDialog().getByText('本次方案有助于推进后续活动沟通。', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(tasks[0].submitReason, 'timeout');
  assert.equal(tasks[0].draft, savedDraft);
  assert.doesNotMatch(await activityDialog().innerText(), /我们可以安排相关活动|我需要先向上汇报|剩余时间|总体评价|支持度|愉悦度|模型点评|\d+ 分/);
  await page.screenshot({ path: `${output}/formal-evaluation.png`, fullPage: true });
  await activityDialog().getByRole('button', { name: /继续|下一项|完成/ }).click();
  const second = page.getByRole('dialog', { name: '活动提议已匹配：「案例现场参观」' });
  await second.waitFor();
  await second.getByRole('button', { name: '开始策划 · 5:00' }).click();
  assert.equal(tasks[1].deadlineAt - tasks[1].startedAt, 300000);
  await activityDialog().getByRole('textbox', { name: '活动方案' }).fill('选择同类项目现场，先与项目方确认接待权限和运行效果展示范围。');
  await activityDialog().getByRole('button', { name: '提前提交方案' }).click();
  await activityDialog().getByText('本次方案有助于推进后续活动沟通。', { exact: true }).waitFor();
  assert.equal(tasks[1].submitReason, 'manual');
  await activityDialog().getByRole('button', { name: /继续|下一项|完成/ }).click();
  const third = page.getByRole('dialog', { name: '活动提议已匹配：「客户参观我们公司」' });
  await third.waitFor();
  await third.getByRole('button', { name: '开始策划 · 5:00' }).click();
  await activityDialog().getByRole('textbox', { name: '活动方案' }).waitFor();
  await page.waitForTimeout(250);
  serverNow = tasks[2].deadlineAt + 1;
  await page.clock.fastForward(300000);
  await activityDialog().getByText('正在处理方案', { exact: true }).waitFor();
  assert.ok(await activityDialog().getByRole('button', { name: '重试获取结果' }).isVisible());
  assert.doesNotMatch(await activityDialog().innerText(), /我们可以安排相关活动|我需要先向上汇报|剩余时间|总体评价|支持度|愉悦度/);
  await page.screenshot({ path: `${output}/formal-processing-result.png`, fullPage: true });
  await activityDialog().getByRole('button', { name: '重试获取结果' }).click();
  await activityDialog().getByText('方案已提交，但内容为空，本次未推进。', { exact: true }).waitFor();
  assert.doesNotMatch(await activityDialog().innerText(), /我们可以安排相关活动|我需要先向上汇报|剩余时间|总体评价|支持度|愉悦度|模型点评|\d+ 分/);
  assert.equal(tasks[2].draft, '');
  assert.ok(activityGets < 40, `unexpected GET loop: ${activityGets}`);
  assert.deepEqual(errors, [], 'browser must not report runtime exceptions');
  const publicTaskResults = publicActivities().map(({ id, type, status, submitReason, evaluation }) => ({ id, type, status, submitReason, ...(evaluation ? { evaluation } : {}) }));
  const mutationSummary = mutations.map(({ action, taskId, draft }) => ({ action, taskId, hasDraft: typeof draft === 'string' }));
  await writeFile(`${output}/formal-browser-results.json`, JSON.stringify({ passed: true, mockedApi: true, remoteAiCalls: 0, activityGets, mutations: mutationSummary, tasks: publicTaskResults, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, mockedApi: true, remoteAiCalls: 0, activityGets, mutations: mutations.length, screenshots: 3 }));
} catch (error) {
  await inspectedPage?.screenshot({ path: `${output}/formal-browser-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/formal-browser-failure.json`, JSON.stringify({ error: String(error), activityGets, mutations, tasks, errors, text: await inspectedPage?.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
}
