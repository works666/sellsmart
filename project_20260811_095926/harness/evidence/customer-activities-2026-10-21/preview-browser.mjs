import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = resolve(repo, 'harness/evidence/customer-activities-2026-10-21');
const require = createRequire(resolve(repo, 'projects/package.json'));
const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const htmlPath = resolve(repo, 'projects/public/project1-prototype-v9.html');
await mkdir(evidence, { recursive: true });
const userId = 'preview-activity-browser-user';
const previewSessionId = 'preview-activity-session';
const pageErrors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_FILE_NOT_FOUND')) pageErrors.push(`console: ${message.text()}`);
  });
  await page.clock.install({ time: Date.now() });
  const initialNow = Date.now();
  await page.addInitScript(({ userId, previewSessionId, initialNow }) => {
    localStorage.setItem('weixun_session', 'preview-mock-token');
    localStorage.setItem('weixun_identity', JSON.stringify({ userId, role: 'player' }));
    const scoped = key => `${key}:user:${encodeURIComponent(userId)}`;
    sessionStorage.setItem(scoped('weixun_project1_preview_session_v1'), JSON.stringify({ ownerId: userId, id: previewSessionId, version: 1 }));
    sessionStorage.setItem(scoped('project1_interactive_prototype_v10'), JSON.stringify({ ownerId: userId, state: {
      screen: 'game', actionPoints: 28, totalSpent: 0,
      timer: { elapsedMs: 60000, lastResumedAt: initialNow, paused: false, refillsApplied: 0, expired: false, settled: false, started: true },
    }}));
    const mockKey = '__customerActivityBrowserMock';
    if (!sessionStorage.getItem(mockKey)) sessionStorage.setItem(mockKey, JSON.stringify({ version: 1, syncs: 0, mutations: [], delayedResultTaskId: 'preview-task-3', resultRetryRequested: false, tasks: [
      { id: 'preview-task-1', conversationId: 'preview-conversation', npcId: 'P1-002', type: 'technical_meeting', summary: '可以安排技术同事一起交流。', basis: ['可以安排技术同事一起交流。', '我们内部先确认参观安排。'], status: 'pending', createdAt: initialNow, draft: '' },
      { id: 'preview-task-2', conversationId: 'preview-conversation', npcId: 'P1-002', type: 'case_site_visit', summary: '可以安排技术同事一起交流。', basis: ['可以安排技术同事一起交流。', '我们内部先确认参观安排。'], status: 'pending', createdAt: initialNow + 1, draft: '' },
      { id: 'preview-task-3', conversationId: 'preview-conversation', npcId: 'P1-002', type: 'company_visit', summary: '可以安排技术同事一起交流。', basis: ['可以安排技术同事一起交流。', '我们内部先确认参观安排。'], status: 'pending', createdAt: initialNow + 2, draft: '' },
    ] }));
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://preview.mock');
      const mock = JSON.parse(sessionStorage.getItem(mockKey));
      const now = Date.now();
      const settle = () => {
        for (const task of mock.tasks) {
          if (task.status === 'planning' && now >= task.deadlineAt) {
            task.status = 'submitted'; task.submitReason = 'timeout'; task.submittedAt = task.deadlineAt;
          }
          if (task.status === 'submitted' && !task.evaluation
            && (task.id !== mock.delayedResultTaskId || mock.resultRetryRequested)) {
            task.evaluation = { overallEvaluation: task.draft.trim() ? '活动方案已形成可执行安排，活动结果已更新。' : '未提供可执行内容，本次未推进。' };
          }
        }
      };
      const request = init.body ? JSON.parse(init.body) : {};
      let response = { success: true, data: {} };
      if (url.pathname === '/api/project-one-preview/ai') {
        if (request.action === 'customer_activity_sync') {
          mock.syncs++;
          if (mock.explicitRetryRequested && mock.tasks.some(item => item.id === mock.delayedResultTaskId && item.status === 'submitted')) mock.resultRetryRequested = true;
        }
        if (request.action?.startsWith('customer_activity_')) {
          const task = mock.tasks.find(item => item.id === request.taskId);
          settle();
          if (request.action === 'customer_activity_start' && task?.status === 'pending' && mock.tasks.find(item => item.status !== 'submitted')?.id === task.id) {
            task.status = 'planning'; task.startedAt = now; task.deadlineAt = now + 300000;
          }
          if (request.action === 'customer_activity_save' && task?.status === 'planning' && now < task.deadlineAt && typeof request.draft === 'string') task.draft = request.draft;
          if (request.action === 'customer_activity_submit' && task?.status === 'planning') {
            if (now < task.deadlineAt && typeof request.draft === 'string') task.draft = request.draft;
            task.status = 'submitted'; task.submittedAt = now < task.deadlineAt ? now : task.deadlineAt;
            task.submitReason = now < task.deadlineAt ? 'manual' : 'timeout';
          }
          settle(); mock.version++;
          response = { success: true, previewSessionId, version: mock.version, data: {
            previewSessionId, version: mock.version,
            customerActivities: { version: 1, tasks: mock.tasks }, serverNow: now, npcTestStates: [],
          }};
          mock.mutations.push({ action: request.action, taskId: request.taskId, hasDraft: typeof request.draft === 'string', serverNow: now });
          sessionStorage.setItem(mockKey, JSON.stringify(mock));
        }
      } else if (url.pathname === '/api/designer/image-assets') {
        response = { success: true, data: { assets: [] } };
      }
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#customer-activity-retry')) {
        const mock = JSON.parse(sessionStorage.getItem(mockKey));
        mock.explicitRetryRequested = true;
        sessionStorage.setItem(mockKey, JSON.stringify(mock));
      }
    }, true);
  }, { userId, previewSessionId, initialNow });

  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded' });
  const mockState = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('__customerActivityBrowserMock')));
  const activityDialog = () => page.getByRole('dialog');
  await page.clock.fastForward(1000);
  const dialog = activityDialog();
  await dialog.waitFor();
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;}' });
  await page.waitForTimeout(150);
  const firstPopup = await dialog.innerText();
  assert.match(firstPopup, /活动提议/);
  assert.match(firstPopup, /可以安排技术同事一起交流/);
  assert.equal(firstPopup.split('可以安排技术同事一起交流。').length - 1, 1, '匹配提议只显示一次');
  assert.doesNotMatch(firstPopup, /我们内部先确认参观安排/);
  assert.doesNotMatch(firstPopup, /活动提议与系统匹配结果|系统结合本次活动提议/);
  assert.doesNotMatch(firstPopup, /客户明确接受|您已与客户约定/);
  await page.screenshot({ path: resolve(evidence, 'preview-planning-prompt.png'), fullPage: true });

  await dialog.getByRole('button', { name: '开始策划 · 5:00' }).click();
  const textbox = activityDialog().getByRole('textbox', { name: '活动方案' });
  await textbox.waitFor();
  const deadline = (await mockState()).tasks[0].deadlineAt;
  for (let index = 1; index <= 6; index++) {
    await textbox.fill(`技术交流方案第${index}轮：安排技术负责人结合接口适配、部署边界和实施风险现场答疑。`);
    await page.clock.fastForward(400);
  }
  await page.clock.fastForward(500);
  assert.ok((await mockState()).mutations.some(item => item.action === 'customer_activity_save'), '持续输入期间应触发自动保存');
  await textbox.blur();
  await page.clock.fastForward(500);
  const savedDraft = (await mockState()).tasks[0].draft;
  assert.ok(savedDraft.includes('第6轮'), 'onBlur保存当前草稿');
  await page.screenshot({ path: resolve(evidence, 'preview-planning-draft.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedDialog = activityDialog();
  await reloadedDialog.waitFor();
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;}' });
  await page.waitForTimeout(150);
  assert.equal(await reloadedDialog.getByRole('textbox', { name: '活动方案' }).inputValue(), savedDraft, '刷新恢复服务端草稿');
  assert.equal((await mockState()).tasks[0].deadlineAt, deadline, '刷新不重置服务端deadline');
  const timeUntilDeadline = await page.evaluate(deadlineAt => Math.max(0, deadlineAt + 1 - Date.now()), deadline);
  await page.clock.fastForward(timeUntilDeadline);
  await reloadedDialog.getByText('活动方案已形成可执行安排，活动结果已更新。', { exact: true }).waitFor();
  assert.equal((await mockState()).tasks[0].submitReason, 'timeout', '倒计时到期自动提交');
  assert.equal((await mockState()).tasks[0].draft, savedDraft, '到期提交冻结最后一次服务端保存的草稿');
  const firstResult = await reloadedDialog.innerText();
  assert.match(firstResult, /活动结果/);
  assert.doesNotMatch(firstResult, /可以安排技术同事一起交流|我们内部先确认参观安排|剩余时间|5 分钟|总体评价|支持度|愉悦度|\d+ 分/);
  await page.screenshot({ path: resolve(evidence, 'preview-timeout-evaluation.png'), fullPage: true });

  await reloadedDialog.getByRole('button', { name: /继续|下一项|完成/ }).click();
  const second = activityDialog();
  await second.waitFor();
  assert.match(await second.innerText(), /案例现场参观/);
  await second.getByRole('button', { name: '开始策划 · 5:00' }).click();
  const secondInput = second.getByRole('textbox', { name: '活动方案' });
  await secondInput.waitFor();
  await secondInput.fill('确认案例现场的接待权限、演示范围和客户需要重点了解的效果数据。');
  await second.getByRole('button', { name: '提前提交方案' }).click();
  await second.getByText('活动方案已形成可执行安排，活动结果已更新。', { exact: true }).waitFor();
  assert.equal((await mockState()).tasks[1].submitReason, 'manual', '提前提交生成总体评价');
  const secondResult = await second.innerText();
  assert.doesNotMatch(secondResult, /可以安排技术同事一起交流|我们内部先确认参观安排|剩余时间|5 分钟|总体评价|支持度|愉悦度|\d+ 分/);

  await second.getByRole('button', { name: /继续|下一项|完成/ }).click();
  const third = activityDialog();
  await third.waitFor();
  await third.getByRole('button', { name: '开始策划 · 5:00' }).click();
  await third.getByRole('textbox', { name: '活动方案' }).waitFor();
  await third.getByRole('button', { name: '提前提交方案' }).click();
  await third.getByRole('button', { name: '重试获取结果' }).waitFor();
  assert.ok(await third.getByRole('button', { name: '重试获取结果' }).isVisible());
  const processingText = await third.innerText();
  assert.doesNotMatch(processingText, /可以安排技术同事一起交流|我们内部先确认参观安排|剩余时间|总体评价/);
  await page.screenshot({ path: resolve(evidence, 'preview-processing-result.png'), fullPage: true });
  await third.getByRole('button', { name: '重试获取结果' }).click();
  await third.getByText('未提供可执行内容，本次未推进。', { exact: true }).waitFor();
  assert.match(await third.locator('h2').innerText(), /活动结果/);
  assert.equal((await mockState()).tasks[2].submitReason, 'manual');
  const finalState = await mockState();
  assert.ok(finalState.tasks[2].status === 'submitted', '第三项在前两项之后进入处理状态');
  assert.ok(finalState.syncs < 20, `同步请求应有限，不得形成请求循环: ${finalState.syncs}`);
  assert.deepEqual(pageErrors, [], '浏览器无运行时异常');
  const report = {
    passed: true,
    mockedApi: true,
    remoteAiCalls: 0,
    source: 'projects/public/project1-prototype-v9.html',
    assertions: ['匹配弹窗只显示一次提议内容', '持续输入期间autosave', '刷新恢复deadline与草稿', '到期提交冻结服务端草稿', '提交后只显示安全活动结果', '处理中可重试获取结果', '三项队列串行', '无runtime错误/同步循环'],
    syncRequests: finalState.syncs,
    mutations: finalState.mutations,
    tasks: finalState.tasks.map(({ id, type, status, submitReason }) => ({ id, type, status, submitReason })),
    pageErrors,
  };
  await writeFile(resolve(evidence, 'preview-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(evidence, 'preview-browser-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
