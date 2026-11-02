import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:3000';
const dir = new URL('./', import.meta.url);
const username = process.env.PROMPT_EXCEL_TEST_USERNAME;
const password = process.env.PROMPT_EXCEL_TEST_PASSWORD;
if (!username || !password) throw new Error('Missing local test credentials');
async function call(route, options = {}) {
  const response = await fetch(base + route, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return body;
}
const login = await call('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'login', username, password }),
});
const session = await call('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'select_role', loginToken: login.loginToken, role: 'platform_designer' }),
});
if (!session.token) throw new Error('Missing session token');
const headers = { 'x-session': session.token };
const originalPath = 'C:/Users/17628/Downloads/SellSmart_NPC%E6%8F%90%E7%A4%BA%E8%AF%8D_%E8%87%AA%E7%84%B6%E5%AF%B9%E8%AF%9D%E4%BC%98%E5%8C%96%E7%89%88.xlsx';
const original = await fs.readFile(originalPath);
const sha = (data) => createHash('sha256').update(data).digest('hex');
if (sha(original) !== '8de831fd8d19c2d0a14be4fee7e24f831d2658766c21d372b07c16e42853b43f') throw new Error('Original hash changed');
const form = new FormData();
form.append('file', new Blob([original]), 'SellSmart-original.xlsx');
const imported = await call('/api/designer/prompt-excel', { method: 'POST', headers, body: form });
if (!imported.ok || imported.rows.length !== 35) throw new Error('Original import did not validate 35 rows');
if (imported.warnings?.length !== 20 || imported.warnings.some(({ code }) => code !== 'ROLE_CHANNEL_IGNORED')) throw new Error('Original role-channel warnings missing');
const plan = JSON.parse(await fs.readFile(new URL('../npc-excel-sync-2026-10-15/sync-plan.json', dir), 'utf8'));
const entries = Array.isArray(plan) ? plan : plan.changes;
if (!Array.isArray(entries) || entries.length !== 35) throw new Error('Unknown sync-plan shape');
const mismatches = (config) => entries.filter(({ path, text }) => path.reduce((value, key) => value?.[key], config) !== text).map(({ path }) => path.join('.'));
if (mismatches(imported.editable).length) throw new Error('Original imported text mismatch');
const before = await call('/api/designer/prompt-config', { headers });
await fs.writeFile(new URL('real-save-before.json', dir), JSON.stringify(before, null, 2));
const differing = mismatches(before.config);
let saved;
let after = before;
if (!differing.length) {
  // Save identical current content only: exercise real persistence without replacing user edits.
  saved = await call('/api/designer/prompt-config', {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: before.revision, config: before.config }),
  });
  after = await call('/api/designer/prompt-config', { headers });
  if (!saved.persisted || !after.persisted || after.revision !== before.revision + 1 || JSON.stringify(after.config) !== JSON.stringify(before.config)) throw new Error('Real no-content-change save verification failed');
}
if (sha(await fs.readFile(originalPath)) !== sha(original)) throw new Error('Source workbook modified');
await fs.writeFile(new URL('real-save-after.json', dir), JSON.stringify(after, null, 2));
const audit = { passed: true, originalSha256: sha(original), parsedRows: imported.rows.length, exactFields: 35, roleChannelWarnings: imported.warnings.length, differingCurrentFields: differing, realSavePerformed: Boolean(saved), saveMode: 'identical current content; no prompt text changes', beforeRevision: before.revision, afterRevision: after.revision, persisted: after.persisted, sourceUnchanged: true };
await fs.writeFile(new URL('real-save-audit.json', dir), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
