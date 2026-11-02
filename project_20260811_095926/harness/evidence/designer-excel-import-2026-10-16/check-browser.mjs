import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = here;
const repoRoot = path.resolve(here, '..', '..', '..');
const baseUrl = 'http://127.0.0.1:3000';
const artifactDir = path.join(repoRoot, 'harness', 'evidence', 'designer-excel-import-2026-10-16');
const targetFixture = path.join(artifactDir, 'archived-text-fixture.xlsx');
const emptyFixture = path.join(artifactDir, 'explicit-empty-fixture.xlsx');
const baselinePath = path.join(artifactDir, 'fixture-baseline.json');
const targetPath = path.join(artifactDir, 'fixture-target.json');
const downloadDir = 'C:/Users/17628/Downloads';
const originalExpectedSha = '8de831fd8d19c2d0a14be4fee7e24f831d2658766c21d372b07c16e42853b43f';
const credentials = {
  username: process.env.PROMPT_EXCEL_TEST_USERNAME ?? '',
  password: process.env.PROMPT_EXCEL_TEST_PASSWORD ?? '',
};
const mode = process.argv.includes('--baseline') ? 'baseline' : 'final';
const projectRequire = createRequire(path.join(repoRoot, 'projects', 'package.json'));
const ExcelJS = projectRequire('exceljs');

const NAMES = { 'P1-001': '张建国', 'P1-002': '李明辉', 'P1-003': '王德福', 'P1-004': '赵晓晨', 'P1-005': '刘思琪' };
const PERSON_FIELDS = ['base', 'low', 'medium', 'high'];
const SCOPE_LABEL = {
  role_base: '人物基础提示词',
  role_low: '低支持度提示词',
  role_medium: '中支持度提示词',
  role_high: '高支持度提示词',
  channel: '渠道补充',
  role: '人物总提示词',
};
const PERSON_FIELD_LABEL = {
  base: '人物基础提示词',
  low: '低支持度提示词',
  medium: '中支持度提示词',
  high: '高支持度提示词',
};
const CHANNEL_LABEL = {
  email: '邮件交流',
  wechat: '工作微信',
  work_phone: '电话交流',
  visit: '普通拜访',
  wechat_request: '申请添加微信',
  direct_visit: '直接登门',
  scheduled_visit: '约好拜访',
  referral: '他人转介绍',
};
const channelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function clone(value) { return structuredClone(value); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function check(result, name, passed, details = undefined) {
  result.checks.push({ name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) });
  if (!passed) throw new Error(`Assertion failed: ${name}${details ? ` — ${JSON.stringify(details)}` : ''}`);
}
function configMismatchList(actual, expected) {
  const mismatches = [];
  for (const [npcId, profile] of Object.entries(expected.npcRolePrompts ?? {})) {
    for (const field of PERSON_FIELDS) {
      if (actual.npcRolePrompts?.[npcId]?.[field] !== profile[field]) mismatches.push(`${npcId}.role.${field}`);
    }
  }
  for (const [npcId, channels] of Object.entries(expected.npcChannelExceptions ?? {})) {
    for (const [channelId, prompt] of Object.entries(channels)) {
      if (actual.npcChannelExceptions?.[npcId]?.[channelId] !== prompt) mismatches.push(`${npcId}.channel.${channelId}`);
    }
  }
  return mismatches;
}
function readonlyMismatchList(actual, baseline) {
  const editable = new Set(['npcRolePrompts', 'npcChannelExceptions']);
  return Object.keys(baseline).filter((key) => !editable.has(key) && stable(actual[key]) !== stable(baseline[key]));
}
function listExpectedFields(config) {
  const expected = [];
  for (const [npcId, profile] of Object.entries(config.npcRolePrompts ?? {})) {
    for (const field of PERSON_FIELDS) expected.push({ npcId, name: NAMES[npcId], kind: 'role', field, value: profile[field] });
  }
  for (const [npcId, channels] of Object.entries(config.npcChannelExceptions ?? {})) {
    for (const [channelId, value] of Object.entries(channels)) expected.push({ npcId, name: NAMES[npcId], kind: 'channel', channelId, value });
  }
  return expected;
}
function targetFieldCount(config) { return listExpectedFields(config).length; }

async function authenticate(request) {
  if (!credentials.username || !credentials.password) {
    throw new Error('Set PROMPT_EXCEL_TEST_USERNAME and PROMPT_EXCEL_TEST_PASSWORD in the process environment.');
  }
  const loginResponse = await request.post(`${baseUrl}/api/auth/login`, {
    data: { action: 'login', ...credentials },
  });
  const loginBody = await loginResponse.json();
  if (!loginResponse.ok() || !loginBody.loginToken) {
    throw new Error(`Local test login failed (${loginResponse.status()}): ${loginBody.error ?? 'missing login token'}`);
  }
  const roleResponse = await request.post(`${baseUrl}/api/auth/login`, {
    data: { action: 'select_role', loginToken: loginBody.loginToken, role: 'platform_designer' },
  });
  const roleBody = await roleResponse.json();
  if (!roleResponse.ok() || !roleBody.token) {
    throw new Error(`Local designer role selection failed (${roleResponse.status()}): ${roleBody.error ?? 'missing session token'}`);
  }
  return { token: roleBody.token, identity: roleBody.session };
}

async function workbookWithInvalidScope(sourcePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await fs.readFile(sourcePath));
  const sheet = workbook.worksheets.find((candidate) => candidate.name === '人物提示词');
  if (!sheet) throw new Error('Could not find 人物提示词 sheet for in-memory invalid-scope fixture.');
  sheet.getCell(2, 2).value = '未经注册的用途';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function workbookWithInvalidChannel(sourcePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await fs.readFile(sourcePath));
  const sheet = workbook.worksheets.find((candidate) => candidate.name === '人物提示词');
  if (!sheet) throw new Error('Could not find 人物提示词 sheet for in-memory invalid-channel fixture.');
  let targetRow = 0;
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    if (sheet.getRow(rowNumber).getCell(2).text.trim() === '渠道补充') { targetRow = rowNumber; break; }
  }
  if (!targetRow) throw new Error('Could not find a channel row for in-memory invalid-channel fixture.');
  sheet.getCell(targetRow, 3).value = '未注册交流方式';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  const result = {
    mode,
    status: 'running',
    build: mode === 'baseline' ? 'pre-fix local build (root-reported PID 32304)' : 'post-fix local build (root to confirm before run)',
    parser: 'real POST /api/designer/prompt-excel; uploads reach the local app parser',
    persistence: 'GET/PUT /api/designer/prompt-config intercepted with an in-memory mock; no database writes',
    externalNetwork: 'browser-origin traffic outside http://127.0.0.1:3000 is blocked',
    checks: [],
  };
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  const target = JSON.parse(await fs.readFile(targetPath, 'utf8'));
  const originalEntries = await fs.readdir(downloadDir);
  const originalWorkbookName = originalEntries.find((name) => name.startsWith('SellSmart_NPC%') && name.endsWith('.xlsx'));
  const originalWorkbookPath = originalWorkbookName ? path.join(downloadDir, originalWorkbookName) : null;
  const oldWorkbookPath = path.join(downloadDir, '项目一-人物提示词.xlsx');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1460, height: 1000 } });
  let blockedExternalRequests = 0;
  const memory = {
    config: clone(baseline),
    revision: 7,
    failNextPut: true,
    putLog: [],
  };
  let token;
  let identity;
  try {
    ({ token, identity } = await authenticate(context.request));
    await context.addInitScript(({ sessionToken, sessionIdentity }) => {
      localStorage.setItem('weixun_session', sessionToken);
      localStorage.setItem('weixun_identity', JSON.stringify(sessionIdentity));
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const requestUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (requestUrl.includes('/api/designer/prompt-excel') && method === 'POST') {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return nativeFetch(input, init);
      };
    }, { sessionToken: token, sessionIdentity: identity });

    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl) return route.continue();
      blockedExternalRequests += 1;
      return route.abort('blockedbyclient');
    });
    await context.route('**/api/designer/prompt-config*', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, config: clone(memory.config), revision: memory.revision }) });
      }
      if (method !== 'PUT') return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected prompt-config method' }) });
      const payload = route.request().postDataJSON();
      memory.putLog.push({ expectedRevision: payload.expectedRevision, requestRevision: memory.revision });
      if (memory.failNextPut) {
        memory.failNextPut = false;
        await sleep(500);
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '提示词已被其他设计师更新，请刷新后再保存。' }) });
      }
      memory.config = clone(payload.config);
      memory.revision += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, config: clone(memory.config), revision: memory.revision }) });
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message, stack: error.stack ?? '' }));
    const importButton = () => page.getByRole('button', { name: '导入 Excel', exact: true });
    const fileInput = () => page.locator('input[type="file"]');
    const saveButton = () => page.getByRole('button', { name: '保存全部', exact: true });
    const statusText = async () => (await page.getByRole('status').allTextContents()).join('\n');
    const scopeNav = () => page.getByRole('navigation', { name: '选择提示词范围' });

    async function openPage() {
      await page.goto(`${baseUrl}/designer/prompt-library`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await saveButton().waitFor({ state: 'visible' });
      await waitEditorReady();
    }
    async function waitEditorReady() {
      await page.waitForFunction(() => document.querySelector('textarea')?.getAttribute('placeholder') !== '正在读取已保存配置…', { timeout: 10000 });
    }
    async function upload(file) {
      const responsePromise = page.waitForResponse((response) => response.url() === `${baseUrl}/api/designer/prompt-excel` && response.request().method() === 'POST', { timeout: 30000 });
      await fileInput().setInputFiles(file);
      const response = await responsePromise;
      const body = await response.json();
      return { status: response.status(), body };
    }
    async function readRoleValue(name, field) {
      const personNav = page.getByRole('navigation', { name: '选择人物' });
      const personButton = personNav.getByRole('button').filter({ hasText: name });
      await personButton.click();
      await scopeNav().getByRole('button', { name: PERSON_FIELD_LABEL[field], exact: true }).click();
      return page.getByRole('textbox', { name: `${name} ${PERSON_FIELD_LABEL[field]}`, exact: true }).inputValue();
    }
    async function readChannelValue(name, channelId) {
      const personNav = page.getByRole('navigation', { name: '选择人物' });
      await personNav.getByRole('button').filter({ hasText: name }).click();
      await scopeNav().getByRole('button', { name: CHANNEL_LABEL[channelId], exact: true }).click();
      return page.getByRole('textbox', { name: `${name} ${CHANNEL_LABEL[channelId]}`, exact: true }).inputValue();
    }
    async function compareUiEditable(expectedConfig) {
      const mismatches = [];
      for (const item of listExpectedFields(expectedConfig)) {
        const actual = item.kind === 'role'
          ? await readRoleValue(item.name, item.field)
          : await readChannelValue(item.name, item.channelId);
        if (actual !== item.value) mismatches.push(`${item.npcId}.${item.kind}.${item.field ?? item.channelId}`);
      }
      return mismatches;
    }
    async function inspectPreview(expectedRows, expectedKinds) {
      await page.locator('section[aria-label="Excel 导入校验结果"]').waitFor({ timeout: 8000 });
      return page.locator('section[aria-label="Excel 导入校验结果"] tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => ({ text: td.innerText.trim(), title: td.getAttribute('title') }))));
    }
    async function verifyPreview(resultObj, label, expectedCount, expectedScopeCounts) {
      check(result, `${label}: parser accepted expected rows`, resultObj.status === 200 && resultObj.body?.ok === true && resultObj.body.rows?.length === expectedCount, {
        status: resultObj.status,
        ok: resultObj.body?.ok,
        rowCount: resultObj.body?.rows?.length,
        scopeValues: [...new Set((resultObj.body?.rows ?? []).map((row) => row.scope))],
        errorCode: resultObj.body?.code,
        error: resultObj.body?.error,
        validationErrors: resultObj.body?.errors?.map(({ code, message }) => ({ code, message })) ?? [],
      });
      const rows = await inspectPreview(resultObj.body.rows, expectedScopeCounts);
      const noUncaughtRenderError = pageErrors.length === 0;
      check(result, `${label}: preview renders without pageerror`, rows.length === expectedCount && noUncaughtRenderError, { visibleRows: rows.length, pageErrorCount: pageErrors.length });
      const scopeCounts = Object.fromEntries(Object.keys(expectedScopeCounts).map((scope) => [SCOPE_LABEL[scope], 0]));
      let roleChannelPlaceholders = 0;
      const cellMismatches = [];
      for (let i = 0; i < resultObj.body.rows.length; i += 1) {
        const parsed = resultObj.body.rows[i];
        const cells = rows[i] ?? [];
        const expectedScopeLabel = SCOPE_LABEL[parsed.scope] ?? parsed.scope;
        const expectedChannelLabel = parsed.scope === 'channel' ? CHANNEL_LABEL[parsed.channelId] ?? parsed.channelId : '—';
        const displayScope = SCOPE_LABEL[parsed.scope] ?? parsed.scope;
        if (Object.prototype.hasOwnProperty.call(scopeCounts, displayScope)) scopeCounts[displayScope] += 1;
        if (cells[1]?.text !== expectedScopeLabel) cellMismatches.push(`row${i + 1}:scope`);
        if (cells[2]?.text !== expectedChannelLabel) cellMismatches.push(`row${i + 1}:channel`);
        if (parsed.scope.startsWith('role_') && cells[2]?.text === '—') roleChannelPlaceholders += 1;
      }
      const scopeCountMismatches = Object.entries(expectedScopeCounts).filter(([scope, count]) => resultObj.body.rows.filter((row) => row.scope === scope).length !== count).map(([scope]) => scope);
      check(result, `${label}: labels and communication cells match row scopes`, cellMismatches.length === 0 && roleChannelPlaceholders === resultObj.body.rows.filter((row) => row.scope.startsWith('role_')).length && scopeCountMismatches.length === 0, {
        countsByDisplayedScope: scopeCounts,
        roleRowsWithDash: roleChannelPlaceholders,
        cellMismatchCount: cellMismatches.length,
        scopeCountMismatches,
      });
      result.parserRuns.push({ label, kind: 'real-local-parser', httpStatus: resultObj.status, ok: resultObj.body.ok, rowCount: resultObj.body.rows.length, scopes: [...new Set(resultObj.body.rows.map((row) => row.scope))], scopeCounts, invalidErrors: resultObj.body.errors?.map(({ code }) => code).filter(Boolean) ?? [] });
      return rows;
    }
    async function verifyOriginalRoleChannelWarnings(parsed, label) {
      const warnings = parsed.body.warnings ?? [];
      const expectedRows = Array.from({ length: 20 }, (_, index) => index + 2);
      const roleWarnings = warnings.filter((warning) => warning.code === 'ROLE_CHANNEL_IGNORED');
      const actualRows = roleWarnings.map((warning) => warning.row).sort((a, b) => a - b);
      const rowsMatch = actualRows.length === expectedRows.length && actualRows.every((row, index) => row === expectedRows[index]);
      check(result, `${label}: parser reports 20 ignored role-channel warnings with Excel row numbers`, warnings.length === 20 && roleWarnings.length === 20 && rowsMatch, {
        warningCount: warnings.length,
        roleChannelWarningCount: roleWarnings.length,
        warningRows: actualRows,
      });
      const previewText = await page.locator('section[aria-label="Excel 导入校验结果"]').innerText();
      const visibleRowCount = roleWarnings.filter(({ row }) => {
        const rowNumber = String(row);
        return [`第 ${rowNumber} 行`, `第${rowNumber}行`, `第 ${rowNumber} 行：`, `第${rowNumber}行：`].some((marker) => previewText.includes(marker));
      }).length;
      const sampleMessageVisible = typeof roleWarnings[0]?.message === 'string' && previewText.includes(roleWarnings[0].message);
      const summaryVisible = /忽略|警告|提醒/.test(previewText) && /20/.test(previewText);
      check(result, `${label}: role-channel warnings are visible in the preview`, visibleRowCount === 20 || (summaryVisible && sampleMessageVisible), {
        visibleRowCount,
        summaryVisible,
        sampleMessageVisible,
        previewContainsWarningText: /忽略|警告|提醒/.test(previewText),
      });
      const run = result.parserRuns.at(-1);
      if (run) run.warnings = { total: warnings.length, roleChannelIgnored: roleWarnings.length, rows: actualRows, visibleRowCount };
    }

    result.parserRuns = [];
    result.mockPersistence = { initialRevision: memory.revision, writes: [], databaseWrites: 0 };

    await openPage();
    const initialText = await readRoleValue(NAMES['P1-001'], 'base');
    check(result, 'GET loads intentionally different baseline draft', initialText === baseline.npcRolePrompts['P1-001'].base, { baselineLoaded: initialText === baseline.npcRolePrompts['P1-001'].base });

    if (mode === 'baseline') {
      const parsed = await upload(targetFixture);
      result.baselineParse = { status: parsed.status, ok: parsed.body.ok, rowCount: parsed.body.rows?.length, scopes: [...new Set((parsed.body.rows ?? []).map((row) => row.scope))] };
      await sleep(900);
      result.previewVisible = await page.locator('section[aria-label="Excel 导入校验结果"]').count().then((count) => count > 0);
      result.pageErrors = pageErrors;
      result.previewText = (await page.locator('body').innerText()).slice(-2500);
      try { await page.screenshot({ path: path.join(evidenceDir, 'baseline-old-build.png'), fullPage: true }); result.screenshot = 'baseline-old-build.png'; } catch (error) { result.screenshotError = error.message; }
      check(result, 'baseline parser accepts reconstructed 35-row workbook', parsed.status === 200 && parsed.body.ok && parsed.body.rows.length === 35, result.baselineParse);
      result.status = 'baseline-recorded';
    } else {
      const noPageErrorYet = () => pageErrors.length === 0;
      check(result, 'original user workbook is available at archived hash', Boolean(originalWorkbookPath), { found: Boolean(originalWorkbookPath) });
      if (!originalWorkbookPath) throw new Error('Original user workbook was not found in Downloads.');
      const originalBytes = await fs.readFile(originalWorkbookPath);
      const originalHash = createHash('sha256').update(originalBytes).digest('hex');
      result.originalWorkbook = { name: originalWorkbookName, path: originalWorkbookPath, bytes: originalBytes.length, sha256: originalHash, source: 'Downloads exact user workbook' };
      check(result, 'original user workbook bytes match archived SHA-256', originalHash === originalExpectedSha, { sha256: originalHash, expectedSha256: originalExpectedSha });

      // Make the editor dirty, then restore the old value. This lets the parse-in-flight check prove that Save is disabled while an unsaved draft exists.
      const baseTextarea = page.getByRole('textbox', { name: `${NAMES['P1-001']} ${PERSON_FIELD_LABEL.base}`, exact: true });
      await baseTextarea.fill('临时改动后恢复的旧草稿');
      await baseTextarea.fill(initialText);
      check(result, 'unsaved old draft is saveable before parse starts', await saveButton().isEnabled());
      const originalResponsePromise = page.waitForResponse((response) => response.url() === `${baseUrl}/api/designer/prompt-excel` && response.request().method() === 'POST', { timeout: 30000 });
      await fileInput().setInputFiles(originalWorkbookPath);
      await page.getByRole('button', { name: '解析中…', exact: true }).waitFor({ timeout: 5000 });
      check(result, 'save is disabled while real Excel parsing is in flight', await saveButton().isDisabled());
      check(result, 'import control is disabled while Excel parsing is in flight', await page.getByRole('button', { name: '解析中…', exact: true }).isDisabled());
      const originalResponse = await originalResponsePromise;
      const originalParsed = { status: originalResponse.status(), body: await originalResponse.json() };
      const originalPreviewRows = await verifyPreview(originalParsed, 'exact original user workbook', 35, { role_base: 5, role_low: 5, role_medium: 5, role_high: 5, channel: 15 });
      await verifyOriginalRoleChannelWarnings(originalParsed, 'exact original user workbook');
      check(result, 'old draft remains unchanged before applying the real upload', await baseTextarea.inputValue() === initialText, { unchanged: await baseTextarea.inputValue() === initialText });
      const originalMismatches = configMismatchList(originalParsed.body.editable, target);
      check(result, 'exact original parsed 35 values match archived target text', originalMismatches.length === 0, { mismatchCount: originalMismatches.length, mismatches: originalMismatches.slice(0, 10) });
      try { await page.screenshot({ path: path.join(evidenceDir, 'preview-validation.png'), fullPage: true }); result.screenshots = ['preview-validation.png']; } catch (error) { result.previewScreenshotError = error.message; }
      result.originalWorkbook.previewRowCount = originalPreviewRows.length;

      // The older single-role template is a separate UI regression: it must normalize to the base role label and render without a channel lookup.
      check(result, 'legacy 20-row workbook is available', await fs.access(oldWorkbookPath).then(() => true).catch(() => false));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await waitEditorReady();
      const oldParsed = await upload(oldWorkbookPath);
      await verifyPreview(oldParsed, 'legacy 20-row template', 20, { role_base: 5, channel: 15 });
      check(result, 'legacy template is preview-only and made no mock writes', memory.putLog.length === 0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await waitEditorReady();
      check(result, 'page errors remain absent after legacy preview', noPageErrorYet(), pageErrors);

      const invalidScopeBuffer = await workbookWithInvalidScope(targetFixture);
      const invalidScopeResponse = await upload({ name: 'invalid-scope-memory-only.xlsx', mimeType: channelMime, buffer: invalidScopeBuffer });
      check(result, 'invalid scope produces a validation result without becoming applicable', invalidScopeResponse.status === 200 && invalidScopeResponse.body.ok === false && invalidScopeResponse.body.errors?.some((entry) => entry.code === 'INVALID_SCOPE'), { status: invalidScopeResponse.status, ok: invalidScopeResponse.body?.ok, codes: invalidScopeResponse.body?.errors?.map((entry) => entry.code) });
      check(result, 'invalid scope does not change the old draft', await readRoleValue(NAMES['P1-001'], 'base') === baseline.npcRolePrompts['P1-001'].base);
      result.parserRuns.push({ label: 'invalid scope in-memory workbook', kind: 'real-local-parser', httpStatus: invalidScopeResponse.status, ok: invalidScopeResponse.body.ok, rowCount: invalidScopeResponse.body.rows?.length, invalidErrors: invalidScopeResponse.body.errors?.map(({ code }) => code).filter(Boolean) ?? [] });

      const invalidChannelBuffer = await workbookWithInvalidChannel(targetFixture);
      const invalidChannelResponse = await upload({ name: 'invalid-channel-memory-only.xlsx', mimeType: channelMime, buffer: invalidChannelBuffer });
      check(result, 'unregistered channel is still rejected by strict validation', invalidChannelResponse.status === 200 && invalidChannelResponse.body.ok === false && invalidChannelResponse.body.errors?.some((entry) => entry.code === 'UNKNOWN_CHANNEL_ID'), { status: invalidChannelResponse.status, ok: invalidChannelResponse.body?.ok, codes: invalidChannelResponse.body?.errors?.map((entry) => entry.code) });
      check(result, 'invalid channel does not change the old draft', await readRoleValue(NAMES['P1-001'], 'base') === baseline.npcRolePrompts['P1-001'].base);
      result.parserRuns.push({ label: 'invalid channel in-memory workbook', kind: 'real-local-parser', httpStatus: invalidChannelResponse.status, ok: invalidChannelResponse.body.ok, rowCount: invalidChannelResponse.body.rows?.length, invalidErrors: invalidChannelResponse.body.errors?.map(({ code }) => code).filter(Boolean) ?? [] });

      const invalidFileResponse = await upload({ name: 'corrupt-memory-only.xlsx', mimeType: channelMime, buffer: Buffer.from('not a valid xlsx zip') });
      check(result, 'corrupt workbook returns real HTTP 400 INVALID_XLSX', invalidFileResponse.status === 400 && invalidFileResponse.body?.code === 'INVALID_XLSX', { status: invalidFileResponse.status, code: invalidFileResponse.body?.code });
      check(result, 'HTTP 400 does not change the old draft', await readRoleValue(NAMES['P1-001'], 'base') === baseline.npcRolePrompts['P1-001'].base);
      result.parserRuns.push({ label: 'corrupt workbook', kind: 'real-local-parser', httpStatus: invalidFileResponse.status, code: invalidFileResponse.body?.code, ok: false });

      // Keep the reconstructed exact-text fixture as an independent parser/preview check. It is not represented as the original workbook bytes.
      const reconstructedResponse = await upload(targetFixture);
      const reconstructedRows = await verifyPreview(reconstructedResponse, 'reconstructed archived-text fixture', 35, { role_base: 5, role_low: 5, role_medium: 5, role_high: 5, channel: 15 });
      check(result, 'reconstructed fixture has 20 role rows and 15 channel rows', reconstructedRows.length === 35 && reconstructedResponse.body.rows.filter((row) => row.scope.startsWith('role_')).length === 20 && reconstructedResponse.body.rows.filter((row) => row.scope === 'channel').length === 15);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await waitEditorReady();

      // Apply and save the exact original user workbook so the end-to-end path covers the file they imported.
      const applyOriginalResponse = await upload(originalWorkbookPath);
      await verifyPreview(applyOriginalResponse, 'exact original user workbook before apply', 35, { role_base: 5, role_low: 5, role_medium: 5, role_high: 5, channel: 15 });
      const applyOriginalMismatches = configMismatchList(applyOriginalResponse.body.editable, target);
      check(result, 'reuploaded original workbook still matches all archived target text', applyOriginalMismatches.length === 0, { mismatchCount: applyOriginalMismatches.length, mismatches: applyOriginalMismatches.slice(0, 10) });
      check(result, 'draft remains old before applying the original workbook', await readRoleValue(NAMES['P1-001'], 'base') === initialText);
      await page.getByRole('button', { name: '应用到页面草稿', exact: true }).click();
      const appliedMismatches = await compareUiEditable(target);
      check(result, 'applying fixture updates all 35 editor values exactly', appliedMismatches.length === 0, { count: targetFieldCount(target), mismatchCount: appliedMismatches.length, mismatches: appliedMismatches.slice(0, 10) });
      check(result, 'apply preserves omitted P1-001 referral text', await readChannelValue(NAMES['P1-001'], 'referral') === baseline.npcChannelExceptions['P1-001'].referral);
      check(result, 'draft is dirty and save is enabled after apply', await saveButton().isEnabled());

      const firstSavePromise = page.getByRole('button', { name: '保存中…', exact: true }).waitFor({ timeout: 5000 }).catch(() => null);
      const firstClickPromise = saveButton().click();
      await firstSavePromise;
      check(result, 'import is disabled while the first save request is in flight', await page.getByRole('button', { name: '导入 Excel', exact: true }).isDisabled());
      await firstClickPromise;
      await page.getByRole('status').waitFor({ timeout: 5000 });
      const conflictNotice = await statusText();
      check(result, '409 keeps the draft dirty and does not show success', await saveButton().isEnabled() && !conflictNotice.includes('已保存人物提示词配置'), { saveEnabled: await saveButton().isEnabled(), notice: conflictNotice });
      check(result, '409 leaves editor values intact', (await readRoleValue(NAMES['P1-001'], 'base')) === target.npcRolePrompts['P1-001'].base);
      result.mockPersistence.writes.push({ outcome: '409 conflict', expectedRevision: memory.putLog.at(-1)?.expectedRevision, persisted: false });

      await saveButton().click();
      await page.getByRole('status').filter({ hasText: '已保存人物提示词配置' }).waitFor({ timeout: 10000 });
      const targetMismatches = configMismatchList(memory.config, target);
      const readonlyMismatches = readonlyMismatchList(memory.config, baseline);
      check(result, 'successful mock save contains all 35 target fields', targetMismatches.length === 0, { targetCount: targetFieldCount(target), mismatchCount: targetMismatches.length, mismatches: targetMismatches.slice(0, 10) });
      check(result, 'successful mock save preserves omitted referral text', memory.config.npcChannelExceptions['P1-001'].referral === baseline.npcChannelExceptions['P1-001'].referral);
      check(result, 'successful mock save leaves readonly config and thresholds unchanged', readonlyMismatches.length === 0, { mismatchCount: readonlyMismatches.length, fields: readonlyMismatches });
      check(result, 'successful mock save increments revision exactly once after 409', memory.revision === 8 && memory.putLog.length === 2, { revision: memory.revision, attempts: memory.putLog.length });
      result.mockPersistence.writes.push({ outcome: 'saved', expectedRevision: memory.putLog.at(-1)?.expectedRevision, revision: memory.revision, targetFieldCount: targetFieldCount(target), preservedOmittedReferral: true, readonlyFieldsPreserved: true });
      result.mockPersistence.databaseWrites = 0;
      try { await page.screenshot({ path: path.join(evidenceDir, 'post-save.png'), fullPage: true }); result.screenshots.push('post-save.png'); } catch (error) { result.postSaveScreenshotError = error.message; }
      check(result, 'save success clears dirty state', await saveButton().isDisabled());

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await waitEditorReady();
      const refreshMismatches = await compareUiEditable(target);
      check(result, 'refresh reloads all 35 saved values exactly', refreshMismatches.length === 0, { mismatchCount: refreshMismatches.length, mismatches: refreshMismatches.slice(0, 10) });
      check(result, 'refresh retains omitted referral supplement', await readChannelValue(NAMES['P1-001'], 'referral') === baseline.npcChannelExceptions['P1-001'].referral);
      check(result, 'refresh still leaves readonly fields unchanged', readonlyMismatchList(memory.config, baseline).length === 0);

      const emptyParsed = await upload(emptyFixture);
      check(result, 'explicit-empty fixture parses successfully with 35 rows', emptyParsed.status === 200 && emptyParsed.body?.ok === true && emptyParsed.body.rows?.length === 35, { status: emptyParsed.status, ok: emptyParsed.body?.ok, rowCount: emptyParsed.body?.rows?.length });
      check(result, 'explicit-empty parser preserves an empty email value', emptyParsed.body.editable?.npcChannelExceptions?.['P1-001']?.email === '', { isEmpty: emptyParsed.body.editable?.npcChannelExceptions?.['P1-001']?.email === '' });
      await verifyPreview(emptyParsed, 'explicit-empty fixture', 35, { role_base: 5, role_low: 5, role_medium: 5, role_high: 5, channel: 15 });
      result.parserRuns.at(-1).explicitEmptyEmail = emptyParsed.body.editable.npcChannelExceptions['P1-001'].email === '';
      await page.getByRole('button', { name: '应用到页面草稿', exact: true }).click();
      check(result, 'applying explicit-empty fixture clears P1-001 email draft', await readChannelValue(NAMES['P1-001'], 'email') === '');
      check(result, 'applying explicit-empty fixture keeps P1-001 referral draft', await readChannelValue(NAMES['P1-001'], 'referral') === baseline.npcChannelExceptions['P1-001'].referral);
      await saveButton().click();
      await page.getByRole('status').filter({ hasText: '已保存人物提示词配置' }).waitFor({ timeout: 10000 });
      check(result, 'second mock save persists empty email and preserves referral', memory.config.npcChannelExceptions['P1-001'].email === '' && memory.config.npcChannelExceptions['P1-001'].referral === baseline.npcChannelExceptions['P1-001'].referral);
      check(result, 'second mock save still preserves readonly fields', readonlyMismatchList(memory.config, baseline).length === 0);
      result.mockPersistence.writes.push({ outcome: 'saved explicit empty', expectedRevision: memory.putLog.at(-1)?.expectedRevision, revision: memory.revision, emptyEmailPersisted: memory.config.npcChannelExceptions['P1-001'].email === '', preservedOmittedReferral: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '提示词设计' }).waitFor({ timeout: 15000 });
      await waitEditorReady();
      check(result, 'refresh keeps explicitly empty email', await readChannelValue(NAMES['P1-001'], 'email') === '');
      check(result, 'refresh keeps the omitted referral supplement after empty save', await readChannelValue(NAMES['P1-001'], 'referral') === baseline.npcChannelExceptions['P1-001'].referral);
      check(result, 'no pageerror across final regression', pageErrors.length === 0, pageErrors);
      check(result, 'no external browser requests escaped the local test', blockedExternalRequests === 0, { blockedExternalRequests });
      result.pageErrors = pageErrors;
      result.mockPersistence.finalRevision = memory.revision;
      result.mockPersistence.putAttempts = memory.putLog.length;
      result.mockPersistence.writes = [...result.mockPersistence.writes];
      result.status = 'passed';
    }
  } catch (error) {
    result.status = mode === 'baseline' ? 'baseline-error' : 'failed';
    result.error = { name: error.name, message: error.message, stack: error.stack ?? '' };
  } finally {
    result.pageErrors ??= [];
    result.blockedExternalRequests = blockedExternalRequests;
    result.mockPersistence ??= { databaseWrites: 0, writes: [] };
    result.persistedRevision = memory.revision;
    result.putAttempts = memory.putLog.length;
    if (result.status === 'running') result.status = 'failed';
    await browser.close();
    const outputName = mode === 'baseline' ? 'baseline-result.json' : 'final-result.json';
    await fs.writeFile(path.join(evidenceDir, outputName), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({ mode: result.mode, status: result.status, originalWorkbook: result.originalWorkbook, parserRuns: result.parserRuns ?? [], checks: result.checks, pageErrors: result.pageErrors?.map(({ name, message }) => ({ name, message })), error: result.error?.message, mockPersistence: result.mockPersistence, blockedExternalRequests: result.blockedExternalRequests, resultFile: path.join(evidenceDir, mode === 'baseline' ? 'baseline-result.json' : 'final-result.json') }, null, 2)}\n`);
  if (result.status === 'failed' || result.status === 'baseline-error') process.exitCode = 1;
}

await main();
