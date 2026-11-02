import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = 'D:/WeiXun/project_20260811_095926/harness/evidence/customer-activities-2026-10-20';
await mkdir(output, { recursive: true });
let config = { revision: 0, mode: 'ai', thresholds: {} };
let saveFailure = 0;
let gets = 0;
const writes = [];
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('weixun_session', 'designer-browser-mock-token');
    localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'designer-browser-user', role: 'platform_designer' }));
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname !== '/api/designer/customer-activities') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    }
    if (route.request().method() === 'GET') gets++;
    if (route.request().method() === 'PUT') {
      const request = route.request().postDataJSON();
      writes.push(structuredClone(request));
      if (saveFailure) return route.fulfill({ status: saveFailure, contentType: 'application/json', body: JSON.stringify({ error: saveFailure === 409 ? '配置版本冲突' : '模拟网络保存失败' }) });
      assert.equal(request.expectedRevision, config.revision);
      config = { ...request.config, revision: config.revision + 1 };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, config, persisted: config.revision > 0, updatedAt: null, updatedBy: null }) });
  });
  await page.goto('http://127.0.0.1:5000/designer/customer-activities', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '客户活动匹配设置' }).waitFor();
  await page.locator('input[value="ai"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('input[value="ai"]').isChecked(), true);
  assert.equal(await page.locator('input[value="numeric"]').isDisabled(), true);
  const labels = ['技术交流会', '案例现场参观', '客户参观我们公司'];
  for (const [index, label] of labels.entries()) {
    await page.getByRole('spinbutton', { name: `${label}支持度下限` }).fill(String(index === 0 ? 0 : 50 + index));
    await page.getByRole('spinbutton', { name: `${label}愉悦度下限` }).fill(String(index === 0 ? 100 : 50));
  }
  assert.equal(await page.locator('input[value="numeric"]').isEnabled(), true);
  await page.getByText('数值门槛', { exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('客户活动判定配置已保存。', { exact: true }).waitFor();
  assert.equal(config.mode, 'numeric');
  assert.deepEqual(config.thresholds.technical_meeting, { supportMin: 0, pleasantnessMin: 100 });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('input[value="numeric"]').isChecked(), true);
  assert.equal(await page.getByRole('spinbutton', { name: '技术交流会愉悦度下限' }).inputValue(), '100');
  await page.screenshot({ path: `${output}/designer-settings.png`, fullPage: true });
  const first = page.getByRole('spinbutton', { name: '技术交流会支持度下限' });
  await first.fill('101');
  assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(), true);
  await first.fill('60');
  saveFailure = 409;
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText(/配置版本冲突.*当前草稿仍保留/).waitFor();
  assert.equal(await first.inputValue(), '60');
  await page.getByRole('button', { name: '重新读取最新版本', exact: true }).click();
  await page.waitForTimeout(200);
  await first.fill('60');
  saveFailure = 503;
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('模拟网络保存失败', { exact: true }).waitFor();
  assert.equal(await first.inputValue(), '60');
  saveFailure = 0;
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('客户活动判定配置已保存。', { exact: true }).waitFor();
  assert.equal(config.thresholds.technical_meeting.supportMin, 60);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/designer-browser-results.json`, JSON.stringify({ passed: true, mockedApi: true, gets, writes, config, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, mockedApi: true, gets, writes: writes.length, zeroAndHundredAccepted: true, conflictAndFailureDraftPreserved: true }));
} catch (error) {
  await page?.screenshot({ path: `${output}/designer-browser-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/designer-browser-failure.json`, JSON.stringify({ error: String(error), gets, writes, config, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
