import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const repo = 'D:/WeiXun/project_20260811_095926';
process.chdir(`${repo}/projects`);
const require = createRequire(`${repo}/projects/package.json`);
require('tsx/cjs');
const { createProjectOneState, toPlayerVisibleGameState } = require(`${repo}/projects/src/lib/game/state.ts`);
const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = `${repo}/harness/evidence/customer-activities-2026-10-20`;
await mkdir(output, { recursive: true });
let serverNow = Date.now();
let version = 1;
let activityGets = 0;
const mutations = [];
const errors = [];
const tasks = ['technical_meeting', 'case_site_visit', 'company_visit'].map((type, index) => ({
  id: `browser-activity-${index + 1}`, conversationId: 'browser-conversation', npcId: 'P1-002', type,
  summary: '本次活动提议已通过开展条件判断。', basis: ['我们可以安排相关活动。', '我需要先向上汇报，确认后再答复。'],
  status: 'pending', createdAt: serverNow + index, draft: '',
}));
const runtime = createProjectOneState();
function gameState() {
  const state = toPlayerVisibleGameState(runtime);
  state.version = version;
  state.customerActivities = structuredClone(tasks);
  state.projectTimer.isPaused = tasks.some(task => task.status === 'planning');
  return state;
}
function settle() {
  for (const task of tasks) {
    if (task.status === 'planning' && serverNow >= task.deadlineAt) {
      task.status = 'submitted'; task.submitReason = 'timeout'; task.submittedAt = task.deadlineAt;
    }
    if (task.status === 'submitted' && !task.evaluation) task.evaluation = { overallEvaluation: task.draft.trim() ? '方案回应了客户需求，建议补充会后跟进安排。' : '未提交活动方案，相关指标保持不变。' };
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
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body = { success: true, data: [] };
    if (path.endsWith('/customer-activities')) {
      if (request.method() === 'GET') activityGets++;
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
      body = { success: true, activities: structuredClone(tasks), version, serverNow, state: gameState() };
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
  const dialog = page.getByRole('dialog', { name: '活动提议已匹配：「技术交流会」' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '开始策划 · 5:00' }).click();
  await dialog.getByRole('textbox', { name: '活动方案' }).waitFor();
  await page.waitForTimeout(300);
  const deadline = tasks[0].deadlineAt;
  const input = dialog.getByRole('textbox', { name: '活动方案' });
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
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '活动方案' }).inputValue(), savedDraft);
  assert.equal(tasks[0].deadlineAt, deadline, 'reload must preserve server deadline');
  await page.screenshot({ path: `${output}/formal-planning.png`, fullPage: true });
  serverNow = deadline + 1;
  await page.clock.fastForward(300000);
  await dialog.getByText('总体评价', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(tasks[0].submitReason, 'timeout');
  assert.equal(tasks[0].draft, savedDraft);
  await page.screenshot({ path: `${output}/formal-evaluation.png`, fullPage: true });
  await dialog.getByRole('button', { name: /继续|下一项|完成/ }).click();
  const second = page.getByRole('dialog', { name: '活动提议已匹配：「案例现场参观」' });
  await second.waitFor();
  await second.getByRole('button', { name: '开始策划 · 5:00' }).click();
  assert.equal(tasks[1].deadlineAt - tasks[1].startedAt, 300000);
  await second.getByRole('textbox', { name: '活动方案' }).fill('选择同类项目现场，先与项目方确认接待权限和运行效果展示范围。');
  await second.getByRole('button', { name: '提前提交方案' }).click();
  await second.getByText('总体评价', { exact: true }).waitFor();
  assert.equal(tasks[1].submitReason, 'manual');
  await second.getByRole('button', { name: /继续|下一项|完成/ }).click();
  const third = page.getByRole('dialog', { name: '活动提议已匹配：「客户参观我们公司」' });
  await third.waitFor();
  await third.getByRole('button', { name: '开始策划 · 5:00' }).click();
  await third.getByRole('textbox', { name: '活动方案' }).waitFor();
  await page.waitForTimeout(250);
  serverNow = tasks[2].deadlineAt + 1;
  await page.clock.fastForward(300000);
  await third.getByText('未提交活动方案，相关指标保持不变。', { exact: true }).waitFor();
  assert.equal(tasks[2].draft, '');
  assert.ok(activityGets < 40, `unexpected GET loop: ${activityGets}`);
  assert.deepEqual(errors, [], 'browser must not report runtime exceptions');
  await writeFile(`${output}/formal-browser-results.json`, JSON.stringify({ passed: true, mockedApi: true, activityGets, mutations, tasks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, mockedApi: true, activityGets, mutations: mutations.length, screenshots: 2 }));
} catch (error) {
  await inspectedPage?.screenshot({ path: `${output}/formal-browser-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/formal-browser-failure.json`, JSON.stringify({ error: String(error), activityGets, mutations, tasks, errors, text: await inspectedPage?.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
}
