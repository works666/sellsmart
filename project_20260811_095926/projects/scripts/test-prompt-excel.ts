import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  PROMPT_EXCEL_CHANNEL_IDS,
  PROMPT_EXCEL_CHANNEL_LABELS,
  PROMPT_EXCEL_DATA_SHEET,
  PROMPT_EXCEL_HEADERS,
  PROMPT_EXCEL_LEGACY_HEADERS,
  PROMPT_EXCEL_MAX_TEXT_LENGTH,
  PROMPT_EXCEL_NPC_IDS,
  PROMPT_EXCEL_NPC_NAMES,
  PROMPT_EXCEL_PROMPT_TYPE_LABELS,
  createPromptExcelWorkbook,
  exportPromptExcel,
  parsePromptExcel,
} from '../src/lib/designer/prompt-excel';
import { DEFAULT_PROJECT_ONE_PROMPT_CONFIG, normalizeNpcRolePrompt } from '../src/lib/designer/prompt-config';
import type { ProjectOnePromptConfig } from '../src/lib/designer/prompt-config';

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function rewriteZipXml(
  buffer: Buffer,
  entryName: string,
  rewrite: (source: string) => string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file(entryName);
  assert.ok(entry, `Expected ${entryName} in workbook`);
  zip.file(entryName, rewrite(await entry.async('string')));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function editableConfig(config: ProjectOnePromptConfig) {
  const npcRolePrompts: ProjectOnePromptConfig['npcRolePrompts'] = {};
  const npcChannelExceptions: Record<string, Record<string, string>> = {};
  for (const npcId of PROMPT_EXCEL_NPC_IDS) {
    npcRolePrompts[npcId] = config.npcRolePrompts[npcId] ?? '';
    const source = config.npcChannelExceptions[npcId] ?? {};
    for (const channelId of PROMPT_EXCEL_CHANNEL_IDS) {
      if (Object.prototype.hasOwnProperty.call(source, channelId)) {
        npcChannelExceptions[npcId] ??= {};
        npcChannelExceptions[npcId][channelId] = source[channelId];
      }
    }
  }
  return { npcRolePrompts, npcChannelExceptions };
}

async function testRoundTrip(): Promise<void> {
  const config = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  config.npcRolePrompts['P1-001'] = {
    ...normalizeNpcRolePrompt(config.npcRolePrompts['P1-001']),
    base: '张建国角色提示词\n保留换行和尾部标点。',
    low: '低档提示词',
    medium: '中档提示词',
    high: '高档提示词',
  };
  config.npcChannelExceptions['P1-002'] = {
    ...(config.npcChannelExceptions['P1-002'] ?? {}),
    work_phone: '电话例外提示词',
  };
  config.liveCustomerPrompt = '受保护字段不应进入工作簿';

  const buffer = await exportPromptExcel(config);
  assert.ok(buffer.length > 1_000);
  const result = await parsePromptExcel(buffer);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.editable, editableConfig(config));
  assert.equal(result.rows.filter((row) => row.scope.startsWith('role_')).length, 20);
  assert.equal(
    result.rows.length,
    20 + Object.values(editableConfig(config).npcChannelExceptions)
      .reduce((count, exceptions) => count + Object.keys(exceptions).length, 0),
  );

  // 应用解析结果只能改变两个可编辑字段。
  const applied = { ...config, ...result.editable };
  assert.equal(applied.liveCustomerPrompt, config.liveCustomerPrompt);
  assert.equal(applied.promptLayers, config.promptLayers);
  assert.equal(applied.liveEvaluatorPrompt, config.liveEvaluatorPrompt);
}

async function testWorkbookShape(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  assert.ok(workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET));
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  assert.deepEqual(
    (worksheet.getRow(1).values as unknown[]).slice(1),
    [...PROMPT_EXCEL_HEADERS],
  );
  const firstRow = worksheet.getRow(2).values as unknown[];
  assert.equal(firstRow[1], PROMPT_EXCEL_NPC_NAMES[0]);
  assert.equal(firstRow[2], PROMPT_EXCEL_PROMPT_TYPE_LABELS[0]);
  assert.equal(firstRow[3], '');
  assert.equal(firstRow[4], normalizeNpcRolePrompt(DEFAULT_PROJECT_ONE_PROMPT_CONFIG.npcRolePrompts[PROMPT_EXCEL_NPC_IDS[0]]).base);

  const visibleValues = worksheet.getRows(1, worksheet.actualRowCount)
    ?.flatMap((row) => (row.values as unknown[]).slice(1, 4).map((value) => String(value ?? '')))
    .join('|') ?? '';
  assert.equal(visibleValues.includes('role'), false);
  assert.equal(visibleValues.includes('channel'), false);
  assert.equal(visibleValues.includes('email'), false);
  assert.equal(visibleValues.includes('work_phone'), false);

  const instructionSheet = workbook.getWorksheet('填写说明');
  assert.ok(instructionSheet);
  const instructionValues = instructionSheet.getRows(1, instructionSheet.actualRowCount)
    ?.flatMap((row) => (row.values as unknown[]).slice(1).map((value) => String(value ?? '')))
    .join('|') ?? '';
  assert.match(instructionValues, /已读不回/);
  assert.match(instructionValues, /系统规则控制/);
}

async function testStrictHeadersAndMissingRoles(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  worksheet.getCell(1, 1).value = '人物编号';
  worksheet.getCell(2, 1).value = '不存在的人物';
  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'UNKNOWN_HEADER'));
  assert.ok(result.errors.some((error) => error.code === 'MISSING_HEADER'));
  assert.ok(result.errors.some((error) => error.code === 'UNKNOWN_NPC_ID'));
  assert.ok(result.errors.some((error) => error.code === 'MISSING_ROLE_ROW'));
  assert.equal(result.editable, null);
}

async function testLegacyWorkbookCompatibility(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(PROMPT_EXCEL_DATA_SHEET);
  worksheet.addRow([...PROMPT_EXCEL_LEGACY_HEADERS]);
  PROMPT_EXCEL_NPC_IDS.forEach((npcId) => {
    worksheet.addRow([npcId, 'role', '', `${npcId}人物总提示词`]);
  });
  worksheet.addRow(['P1-002', 'channel', 'email', '旧版邮件补充提示词']);

  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(normalizeNpcRolePrompt(result.editable?.npcRolePrompts['P1-001']).base, 'P1-001人物总提示词');
  assert.equal(result.editable?.npcChannelExceptions['P1-002']?.email, '旧版邮件补充提示词');
  assert.equal(result.rows[0].npcId, 'P1-001');
  assert.equal(result.rows[0].scope, 'role_base');
  assert.equal(result.rows[5].channelId, 'email');
}

async function testModernWorkbookRequiresAllNpcTiers(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  // Delete the first NPC's low-tier row while keeping the other new tier rows.
  worksheet.spliceRows(3, 1);
  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'MISSING_ROLE_TIER_ROW'));
}

async function testDuplicateAndUnknownChannel(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  // 每位人物均有基础、低、中、高四行；第 2 行是第一个人物的基础提示词。
  worksheet.getCell(3, 1).value = PROMPT_EXCEL_NPC_NAMES[0];
  worksheet.getCell(3, 2).value = PROMPT_EXCEL_PROMPT_TYPE_LABELS[0];
  worksheet.getCell(3, 3).value = '';
  const channelRow = 2 + PROMPT_EXCEL_NPC_IDS.length * 4;
  worksheet.getCell(channelRow, 1).value = PROMPT_EXCEL_NPC_NAMES[0];
  worksheet.getCell(channelRow, 2).value = PROMPT_EXCEL_PROMPT_TYPE_LABELS.at(-1);
  worksheet.getCell(channelRow, 3).value = '未知方式';
  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_ROW'));
  assert.ok(result.errors.some((error) => error.code === 'UNKNOWN_CHANNEL_ID'));
}

async function testPromptLengthAndScopeShape(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  worksheet.getCell(2, 2).value = '其他用途';
  worksheet.getCell(2, 3).value = PROMPT_EXCEL_CHANNEL_LABELS[0];
  worksheet.getCell(2, 4).value = 'x'.repeat(PROMPT_EXCEL_MAX_TEXT_LENGTH + 1);
  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SCOPE'));
  assert.ok(result.errors.some((error) => error.code === 'PROMPT_TOO_LONG'));
}

async function testBlankRowsDoNotBreakSummary(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  worksheet.spliceRows(3, 0, []);
  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, true);
  assert.equal(result.summary.totalRows, result.summary.validRows);
}

async function testExtraRowsHaveValidationWithoutData(): Promise<void> {
  const workbook = createPromptExcelWorkbook(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  const populatedRows = worksheet.actualRowCount;
  assert.ok(worksheet.getCell(populatedRows + 1, 2).dataValidation);
  assert.ok(worksheet.getCell(populatedRows + 15, 3).dataValidation);
  assert.equal(worksheet.getCell(populatedRows + 16, 2).dataValidation, undefined);

  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, true);
  assert.equal(result.summary.totalRows, populatedRows - 1);
}

async function testChineseEntryInReservedRow(): Promise<void> {
  const config = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  config.npcChannelExceptions = {};
  const workbook = createPromptExcelWorkbook(config);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  const rowNumber = PROMPT_EXCEL_NPC_IDS.length * 4 + 2;
  worksheet.getCell(rowNumber, 1).value = PROMPT_EXCEL_NPC_NAMES[0];
  worksheet.getCell(rowNumber, 2).value = PROMPT_EXCEL_PROMPT_TYPE_LABELS.at(-1);
  worksheet.getCell(rowNumber, 3).value = PROMPT_EXCEL_CHANNEL_LABELS[0];
  worksheet.getCell(rowNumber, 4).value = '没有新增价值时可直接已读不回，不编造理由。';

  const result = await parsePromptExcel(await workbookBuffer(workbook));
  assert.equal(result.ok, true);
  assert.equal(result.editable?.npcChannelExceptions['P1-001']?.email, '没有新增价值时可直接已读不回，不编造理由。');
  assert.equal(result.rows.at(-1)?.npcId, 'P1-001');
  assert.equal(result.rows.at(-1)?.scope, 'channel');
  assert.equal(result.rows.at(-1)?.channelId, 'email');

  const roundTrip = await parsePromptExcel(await exportPromptExcel({ ...config, ...result.editable }));
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.editable?.npcChannelExceptions['P1-001']?.email, '没有新增价值时可直接已读不回，不编造理由。');
}

async function testMalformedWorkbook(): Promise<void> {
  await assert.rejects(
    () => parsePromptExcel(Buffer.from('not an xlsx')),
    (error: unknown) => error instanceof Error && error.message.includes('有效的 .xlsx'),
  );
}

async function testXmlNamespaceAndTextPreservation(): Promise<void> {
  const config = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  config.npcChannelExceptions = {};
  const workbook = createPromptExcelWorkbook(config);
  const worksheet = workbook.getWorksheet(PROMPT_EXCEL_DATA_SHEET);
  assert.ok(worksheet);
  worksheet.getCell(2, 4).value = { richText: [{ text: '富文本' }, { text: '\r<&内容' }] };
  worksheet.getCell(3, 4).value = 'CDATA_MARKER';
  worksheet.getCell(4, 4).value = 'CR_MARKER';
  let buffer = await workbookBuffer(workbook);
  buffer = await rewriteZipXml(buffer, 'xl/sharedStrings.xml', (source) => source
    .replace('CDATA_MARKER', '<![CDATA[CDATA<&内容]]>')
    .replace('CR_MARKER', 'CR&#13;MARKER'));
  // This is deliberately a default namespace: it must become a prefixed
  // extension during normalization, never a bare SpreadsheetML sheetData.
  buffer = await rewriteZipXml(buffer, 'xl/worksheets/sheet2.xml', (source) => source.replace(
    '</worksheet>',
    '<foreign xmlns="urn:unrelated"><sheetData><row r="99"><c r="D99" t="inlineStr"><is><t>INJECTED</t></is></c></row></sheetData></foreign></worksheet>',
  ));

  const result = await parsePromptExcel(buffer);
  assert.equal(result.ok, true);
  assert.equal(normalizeNpcRolePrompt(result.editable?.npcRolePrompts['P1-001']).base, '富文本\n<&内容');
  assert.equal(normalizeNpcRolePrompt(result.editable?.npcRolePrompts['P1-001']).low, 'CDATA<&内容');
  assert.equal(normalizeNpcRolePrompt(result.editable?.npcRolePrompts['P1-001']).medium, 'CR\rMARKER');
  assert.equal(result.rows.some((row) => row.prompt.includes('INJECTED')), false);
}

async function testInvalidXmlAndExpandedSizeLimit(): Promise<void> {
  const valid = await exportPromptExcel(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  const dtdWorkbook = await rewriteZipXml(valid, 'xl/workbook.xml', (source) => source.replace(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE workbook []>',
  ));
  await assert.rejects(
    () => parsePromptExcel(dtdWorkbook),
    (error: unknown) => error instanceof Error && error.message.includes('有效的 .xlsx'),
  );

  const largeZip = new JSZip();
  largeZip.file('large.bin', Buffer.alloc(20 * 1024 * 1024 + 1));
  const largeBuffer = await largeZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(
    () => parsePromptExcel(largeBuffer),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 413,
  );
}

async function testSellSmartOriginalWorkbook(): Promise<void> {
  const fixture = path.join(import.meta.dirname, 'fixtures', 'prompt-excel-sellsmart-original.xlsx');
  const planFile = path.join(import.meta.dirname, 'fixtures', 'prompt-excel-sellsmart-expected.json');
  const [buffer, planText] = await Promise.all([readFile(fixture), readFile(planFile, 'utf8')]);
  const plan = JSON.parse(planText) as {
    sourceSha256: string;
    changes: Array<{ path: [string, string, string]; text: string }>;
  };
  assert.equal(createHash('sha256').update(buffer).digest('hex'), plan.sourceSha256);
  assert.equal(plan.changes.length, 35);
  assert.equal(new Set(plan.changes.map((change) => change.path.join('\u0000'))).size, 35);
  const result = await parsePromptExcel(buffer);

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 35);
  assert.equal(result.warnings.length, 20);
  assert.ok(result.warnings.every((warning) => warning.code === 'ROLE_CHANNEL_IGNORED'));
  const imported = result.editable;
  assert.ok(imported);
  for (const change of plan.changes) {
    const [group, npcId, field] = change.path;
    const actual: string | undefined = group === 'npcRolePrompts'
      ? normalizeNpcRolePrompt(imported.npcRolePrompts[npcId])[field as 'base' | 'low' | 'medium' | 'high']
      : imported.npcChannelExceptions[npcId]?.[field];
    assert.equal(actual, change.text, `${npcId}.${field} should retain every character`);
  }
}

async function main(): Promise<void> {
  await testRoundTrip();
  await testWorkbookShape();
  await testStrictHeadersAndMissingRoles();
  await testLegacyWorkbookCompatibility();
  await testModernWorkbookRequiresAllNpcTiers();
  await testDuplicateAndUnknownChannel();
  await testPromptLengthAndScopeShape();
  await testBlankRowsDoNotBreakSummary();
  await testExtraRowsHaveValidationWithoutData();
  await testChineseEntryInReservedRow();
  await testMalformedWorkbook();
  await testXmlNamespaceAndTextPreservation();
  await testInvalidXmlAndExpandedSizeLimit();
  await testSellSmartOriginalWorkbook();
  console.log('人物提示词表格导入导出专项测试通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
