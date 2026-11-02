import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  DESIGNER_EXCEL_TYPES,
  MAX_EXCEL_IMPORT_ROWS,
  createDesignerExcelTemplate,
  createDesignerExcelTemplateBuffer,
  parseDesignerExcel,
} from '../src/lib/designer/excel-data';

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function testTemplates(): Promise<void> {
  for (const type of DESIGNER_EXCEL_TYPES) {
    const workbook = createDesignerExcelTemplate(type);
    assert.equal(workbook.worksheets.length, 2, `${type} should contain instructions and data sheets`);
    const instructions = workbook.getWorksheet('填写说明');
    assert.ok(instructions, `${type} should contain a plain-language instruction sheet`);
    assert.equal(instructions.getCell('A4').value, '填写步骤');
    assert.match(String(instructions.getCell('A5').value), /直接修改|继续向下新增/);
    const data = workbook.worksheets[1];
    const headers = data.getRow(1).values as unknown[];
    assert.ok(headers.some((value) => String(value).includes('必填')), `${type} should mark required columns`);
    assert.ok(!headers.some((value) => ['id', 'name', 'kind', 'value'].includes(String(value))), `${type} should not expose raw field keys`);
    const buffer = await createDesignerExcelTemplateBuffer(type);
    assert.ok(buffer.length > 1_000, `${type} template should be a non-empty xlsx file`);
    const result = await parseDesignerExcel(buffer, type);
    assert.equal(result.type, type);
    assert.equal(result.ok, true, `${type} template should import without validation errors`);
    assert.ok(result.rows.length > 0, `${type} template should contain default rows`);
    assert.equal(result.summary.validRows, result.summary.totalRows);
  }
}

async function testPersonValidation(): Promise<void> {
  const workbook = createDesignerExcelTemplate('key-persons');
  const data = workbook.getWorksheet('人物主档');
  assert.ok(data);
  const idColumn = data.getColumn('id').number;
  const nameColumn = data.getColumn('name').number;
  const categoryColumn = data.getColumn('category').number;
  const levelColumn = data.getColumn('level').number;
  const parentColumn = data.getColumn('parentId').number;
  const taskColumn = data.getColumn('allowedTasks').number;
  data.getCell(2, nameColumn).value = '';
  data.getCell(3, idColumn).value = data.getCell(2, idColumn).value;
  data.getCell(4, categoryColumn).value = '未知类别';
  data.getCell(5, levelColumn).value = '未知层级';
  data.getCell(6, taskColumn).value = '未知任务';
  data.getCell(7, parentColumn).value = 'P1-999';

  const result = await parseDesignerExcel(await workbookBuffer(workbook), 'key-persons');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.field === 'name' && error.row === 2));
  assert.ok(result.errors.some((error) => error.field === 'id' && error.row === 3));
  assert.ok(result.errors.some((error) => error.field === 'category' && error.row === 4));
  assert.ok(result.errors.some((error) => error.field === 'level' && error.row === 5));
  assert.ok(result.errors.some((error) => error.field === 'allowedTasks' && error.row === 6));
  assert.ok(result.errors.some((error) => error.field === 'parentId' && error.row === 7));
}

async function testClientAndMetricsValidation(): Promise<void> {
  const clientWorkbook = createDesignerExcelTemplate('client-info');
  const client = clientWorkbook.getWorksheet('甲方基本信息');
  assert.ok(client);
  client.getCell(2, client.getColumn('id').number).value = '';
  const clientResult = await parseDesignerExcel(await workbookBuffer(clientWorkbook), 'client-info');
  assert.equal(clientResult.ok, false);
  assert.ok(clientResult.errors.some((error) => error.field === 'id' && error.row === 2));

  const metricsWorkbook = createDesignerExcelTemplate('metrics');
  const metrics = metricsWorkbook.getWorksheet('指标数据');
  assert.ok(metrics);
  metrics.getCell(2, metrics.getColumn('kind').number).value = 'D';
  metrics.getCell(3, metrics.getColumn('tag').number).value = metrics.getCell(2, metrics.getColumn('tag').number).value;
  const metricsResult = await parseDesignerExcel(await workbookBuffer(metricsWorkbook), 'metrics');
  assert.equal(metricsResult.ok, false);
  assert.ok(metricsResult.errors.some((error) => error.field === 'kind' && error.row === 2));
  assert.ok(metricsResult.errors.some((error) => error.field === 'tag' && error.row === 3));
}

async function testFriendlyMetricLabels(): Promise<void> {
  const workbook = createDesignerExcelTemplate('metrics');
  const metrics = workbook.getWorksheet('指标数据');
  assert.ok(metrics);
  assert.equal(metrics.getCell(2, metrics.getColumn('kind').number).value, '基础输入（A）');
  const result = await parseDesignerExcel(await workbookBuffer(workbook), 'metrics');
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].kind, 'A');
  assert.equal(typeof result.rows[0].value, 'number');
}

async function testListParsing(): Promise<void> {
  const workbook = createDesignerExcelTemplate('key-persons');
  const data = workbook.getWorksheet('人物主档');
  assert.ok(data);
  data.getCell(2, data.getColumn('coreNeeds').number).value = '一项\n二项\r\n三项';
  const result = await parseDesignerExcel(await workbookBuffer(workbook), 'key-persons');
  assert.deepEqual(result.rows[0].coreNeeds, ['一项', '二项', '三项']);
}

async function main(): Promise<void> {
  await testTemplates();
  await testPersonValidation();
  await testClientAndMetricsValidation();
  await testFriendlyMetricLabels();
  await testListParsing();
  assert.ok(MAX_EXCEL_IMPORT_ROWS > 0);
  console.log('designer Excel template/import tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
