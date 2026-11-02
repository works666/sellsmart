import ExcelJS from 'exceljs';
import {
  PROJECT_ONE_FIVE_PERSON_IDS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
  type ProjectOneCategory,
  type ProjectOneHierarchy,
  type ProjectOneVisitTask,
} from '@/lib/designer/project-one-five-person';
import {
  PROJECT_ONE_PERSONALITY_TYPE_IDS,
  PROJECT_ONE_PERSONALITY_TYPE_LIST,
  toProjectOnePersonalityTypeId,
} from '@/lib/designer/personality-types';
import { aMetrics, bMetrics, cMetrics } from '@/lib/metrics-data';

/**
 * The designer workbook contract is deliberately kept independent from any
 * persistence layer.  The import endpoint returns these normalized rows to
 * the client; a later save API can decide how and when to persist them.
 */
export const DESIGNER_EXCEL_TYPES = ['key-persons', 'client-info', 'metrics'] as const;
export type DesignerExcelType = (typeof DESIGNER_EXCEL_TYPES)[number];

export const MAX_EXCEL_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_EXCEL_IMPORT_ROWS = 5_000;

export interface DesignerExcelColumn {
  key: string;
  label: string;
  description: string;
  required?: boolean;
  kind?: 'text' | 'number' | 'list' | 'enum';
  enumValues?: readonly string[];
  valueLabels?: Readonly<Record<string, string>>;
}

export interface DesignerExcelDefinition {
  type: DesignerExcelType;
  title: string;
  fileName: string;
  instructionSheetName: string;
  dataSheetName: string;
  description: string;
  columns: readonly DesignerExcelColumn[];
  defaultRows: readonly Record<string, unknown>[];
  headerAliases?: Readonly<Record<string, readonly string[]>>;
}

export interface ExcelValidationIssue {
  row?: number;
  field?: string;
  message: string;
}

export interface DesignerExcelImportSummary {
  totalRows: number;
  validRows: number;
  errorCount: number;
}

export interface DesignerExcelImportResult {
  ok: boolean;
  type: DesignerExcelType;
  sheetName: string;
  rows: Array<Record<string, unknown>>;
  errors: ExcelValidationIssue[];
  warnings: ExcelValidationIssue[];
  summary: DesignerExcelImportSummary;
}

export class DesignerExcelRequestError extends Error {
  readonly status: 400 | 413 | 415;
  readonly code: string;

  constructor(message: string, status: 400 | 413 | 415, code: string) {
    super(message);
    this.name = 'DesignerExcelRequestError';
    this.status = status;
    this.code = code;
  }
}

const PERSON_LEVELS = ['高层', '中层', '一线'] as const satisfies readonly ProjectOneHierarchy[];
const PERSON_CATEGORIES = ['高层', '中层', '采购', '项目执行', '一线使用者', '办公室'] as const satisfies readonly ProjectOneCategory[];
const PERSON_TASKS = ['提问', '质疑', '挖坑'] as const satisfies readonly ProjectOneVisitTask[];
const PERSONALITY_TYPES = PROJECT_ONE_PERSONALITY_TYPE_IDS;
const PERSONALITY_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PROJECT_ONE_PERSONALITY_TYPE_LIST.map((type) => [type.id, type.displayName]),
);

const personRows: Record<string, unknown>[] = PROJECT_ONE_FIVE_PERSON_IDS.map((id) => {
  const person = PROJECT_ONE_FIVE_PERSON_NPCS[id];
  return {
    id: person.id,
    name: person.name,
    title: person.title,
    category: person.category,
    level: person.level,
    parentId: person.parentId ?? '',
    displayLevel: person.displayLevel,
    displayOrder: person.displayOrder,
    organization: person.organization,
    personalityType: person.personalityType,
    personality: person.personality,
    coreNeeds: [...person.coreNeeds],
    facts: [...person.facts],
    clues: [...person.clues],
    informationBoundary: [...person.informationBoundary],
    memoryFocus: [...person.memoryFocus],
    taboos: [...person.taboos],
    allowedTasks: [...person.allowedTasks],
  };
});

const clientInfoRows: Record<string, unknown>[] = [
  { id: 'r1', label: 'R1', key: '项目名称', value: '某市智慧政务一体化平台建设项目' },
  { id: 'r2', label: 'R2', key: '规模', value: '市级平台，覆盖 12 个委办局' },
  { id: 'r3', label: 'R3', key: '采购时间', value: '2026 年 Q1' },
  { id: 'r4', label: 'R4', key: '投运时间', value: '2026 年 Q3' },
  { id: 'r5', label: 'R5', key: '最终使用者', value: '全市政务工作人员及市民' },
  { id: 'r6', label: 'R6', key: '设计单位', value: '某市规划设计研究院' },
  { id: 'r7', label: 'R7', key: '技术难点', value: '跨部门数据打通、历史系统兼容' },
  { id: 'r8', label: 'R8', key: '技术要求', value: '支持国产化、等保三级、高可用' },
  { id: 'r9', label: 'R9', key: '预算规模', value: '5000 万元' },
  { id: 'r10', label: 'R10', key: '资金来源', value: '财政拨款 + 专项债' },
  { id: 'r11', label: 'R11', key: '决策方式', value: '公开招标' },
  { id: 'r12', label: 'R12', key: '验收标准', value: '通过等保测评、功能验收、性能验收' },
  { id: 'r13', label: 'R13', key: '选择供应商的要求', value: '具备政务云建设经验、本地化服务能力' },
  { id: 'r14', label: 'R14', key: '历史合作记录', value: '与 A 公司合作过数据中台项目' },
  { id: 'r15', label: 'R15', key: '立项原因', value: '响应国家数字政府建设要求' },
  { id: 'r16', label: 'R16', key: '企业发展规划', value: '三年内实现全市政务一网通办' },
  { id: 'r17', label: 'R17', key: '领导关注点', value: '数据安全、建设进度、成本控制' },
];

const metricRows: Record<string, unknown>[] = [
  ...aMetrics.map((metric) => ({
    kind: 'A',
    tag: metric.tag,
    name: metric.name,
    desc: metric.desc,
    value: Number(metric.init),
    category: metric.category ?? '',
  })),
  ...bMetrics.map((metric) => ({
    kind: 'B',
    tag: metric.tag,
    name: metric.name,
    desc: metric.desc,
    value: metric.formula,
    category: metric.category ?? '',
  })),
  ...cMetrics.map((metric) => ({
    kind: 'C',
    tag: metric.tag,
    name: metric.name,
    desc: metric.desc,
    value: metric.formula,
    category: metric.category ?? '',
  })),
];

const personColumns: readonly DesignerExcelColumn[] = [
  { key: 'id', label: '人物编号', description: '系统用它识别人物。已有行建议保留原编号；新增人物请填写不重复的编号，例如 P1-006。', required: true, kind: 'text' },
  { key: 'name', label: '姓名', description: '游戏中显示的人物姓名。', required: true, kind: 'text' },
  { key: 'title', label: '职务', description: '人物在甲方单位中的职务或岗位。', required: true, kind: 'text' },
  { key: 'category', label: '角色类别', description: '从下拉选项中选择最符合该人物职责的一项。', required: true, kind: 'enum', enumValues: PERSON_CATEGORIES },
  { key: 'level', label: '组织层级', description: '从高层、中层、一线中选择。', required: true, kind: 'enum', enumValues: PERSON_LEVELS },
  { key: 'parentId', label: '上级人物编号', description: '填写此人物直接上级的“人物编号”；没有上级时留空。', kind: 'text' },
  { key: 'displayLevel', label: '组织图层级', description: '控制人物在组织图中的纵向位置。最高层填 1，下一层填 2，以此类推。', kind: 'number' },
  { key: 'displayOrder', label: '同层显示顺序', description: '控制同一层人物从左到右的顺序，从 1 开始填写。', kind: 'number' },
  { key: 'organization', label: '组织关系与职责', description: '说明此人的主要职责、汇报关系以及与其他部门的协作关系。', required: true, kind: 'text' },
  { key: 'personalityType', label: '性格类型', description: '从统一性格字典中选择老虎型、猫头鹰型、孔雀型或考拉型；人物具体边界优先。', required: true, kind: 'enum', enumValues: PERSONALITY_TYPES, valueLabels: PERSONALITY_TYPE_LABELS },
  { key: 'personality', label: '性格与沟通表现', description: '描述此人的说话方式、沟通偏好，以及面对玩家时的典型反应。', required: true, kind: 'text' },
  { key: 'coreNeeds', label: '核心诉求', description: '填写此人最关心的目标。多项内容请在同一单元格内换行，每行一项。', kind: 'list' },
  { key: 'facts', label: '已知事实', description: '填写此人已掌握、可用于对话的事实。多项内容每行一项。', kind: 'list' },
  { key: 'clues', label: '可向玩家透露的线索', description: '填写满足条件时可向玩家透露的线索。多项内容每行一项。', kind: 'list' },
  { key: 'informationBoundary', label: '不可透露的信息', description: '填写此人不应主动透露或无权确认的信息。多项内容每行一项。', kind: 'list' },
  { key: 'memoryFocus', label: '需要持续记住的内容', description: '填写后续交流中需要持续记住的承诺、证据或关键事件。多项内容每行一项。', kind: 'list' },
  { key: 'taboos', label: '沟通禁忌', description: '填写会引起反感、降分或终止交流的行为。多项内容每行一项。', kind: 'list' },
  { key: 'allowedTasks', label: '拜访时可用的互动任务', description: '每行填写一项，只能使用：提问、质疑、挖坑。', required: true, kind: 'list', enumValues: PERSON_TASKS },
];

const clientInfoColumns: readonly DesignerExcelColumn[] = [
  { key: 'id', label: '信息编号', description: '系统用它识别本行。已有行建议保留原编号；新增一行时填写不重复的编号，例如 r18。', required: true, kind: 'text' },
  { key: 'label', label: '页面显示编号', description: '在设计师后台显示的简短编号，例如 R1。', required: true, kind: 'text' },
  { key: 'key', label: '信息名称', description: '说明这条信息是什么，例如“采购时间”或“预算规模”。', required: true, kind: 'text' },
  { key: 'value', label: '信息内容', description: '填写对应的具体内容。', required: true, kind: 'text' },
  { key: 'description', label: '补充说明', description: '选填。需要解释口径、来源或注意事项时再填写。', kind: 'text' },
];

const METRIC_KIND_LABELS = {
  A: '基础输入（A）',
  B: '过程计算（B）',
  C: '综合结果（C）',
} as const;

const metricColumns: readonly DesignerExcelColumn[] = [
  { key: 'kind', label: '指标类型', description: '基础输入由设计师填写初始值；过程计算和综合结果由计算规则得出。', required: true, kind: 'enum', enumValues: ['A', 'B', 'C'], valueLabels: METRIC_KIND_LABELS },
  { key: 'tag', label: '指标编号', description: '系统用它识别指标。已有行建议保留原编号；新增指标请填写不重复的编号。', required: true, kind: 'text' },
  { key: 'name', label: '指标名称', description: '游戏和设计师后台显示的指标名称。', required: true, kind: 'text' },
  { key: 'desc', label: '指标说明', description: '用一句话说明指标衡量什么，以及数值变大或变小代表什么。', required: true, kind: 'text' },
  { key: 'value', label: '初始值或计算规则', description: '基础输入填写数字；过程计算和综合结果填写现有计算规则。', required: true, kind: 'text' },
  { key: 'category', label: '指标分类', description: '选填。用于把用途相近的指标归在一起。', kind: 'text' },
];

const aliases = (values: string[]): readonly string[] => values;

const personHeaderAliases: Readonly<Record<string, readonly string[]>> = {
  id: aliases(['id', '人物id', '人物 ID', '稳定id', '稳定 ID', '人物编号']),
  name: aliases(['name', '姓名']),
  title: aliases(['title', '职务', '岗位']),
  category: aliases(['category', '类别', '角色类别']),
  level: aliases(['level', '层级']),
  parentId: aliases(['parentid', 'parent id', '上级id', '上级 ID', '上级人物id', '上级人物 ID']),
  displayLevel: aliases(['displaylevel', 'display level', '展示层级']),
  displayOrder: aliases(['displayorder', 'display order', '展示顺序']),
  organization: aliases(['organization', '组织关系', '组织职责']),
  personalityType: aliases(['personalitytype', 'personality type', '性格类型']),
  personality: aliases(['personality', '性格', '性格与对话表现']),
  coreNeeds: aliases(['coreneeds', 'core needs', '核心诉求']),
  facts: aliases(['facts', '公开事实', '事实']),
  clues: aliases(['clues', '可匹配披露线索', '披露线索']),
  informationBoundary: aliases(['informationboundary', 'information boundary', '信息边界']),
  memoryFocus: aliases(['memoryfocus', 'memory focus', '记忆重点']),
  taboos: aliases(['taboos', '禁忌']),
  allowedTasks: aliases(['allowedtasks', 'allowed tasks', '允许的拜访任务', '拜访任务']),
};

const clientHeaderAliases: Readonly<Record<string, readonly string[]>> = {
  id: aliases(['id', '信息id', '信息 ID', '编号']),
  label: aliases(['label', '显示标签', '标签']),
  key: aliases(['key', '信息名称', '字段名']),
  value: aliases(['value', '信息内容', '字段值']),
  description: aliases(['description', '备注', '说明']),
};

const metricHeaderAliases: Readonly<Record<string, readonly string[]>> = {
  kind: aliases(['kind', '指标组', '类型']),
  tag: aliases(['tag', '指标标签', '标签', '指标id', '指标 ID']),
  name: aliases(['name', '指标名称', '名称']),
  desc: aliases(['desc', '指标说明', '说明', '描述']),
  value: aliases(['value', '初始值或公式', '初始值', '公式', '值']),
  category: aliases(['category', '指标类别', '类别']),
};

export const DESIGNER_EXCEL_REGISTRY: Readonly<Record<DesignerExcelType, DesignerExcelDefinition>> = {
  'key-persons': {
    type: 'key-persons',
    title: '项目一关键人物信息填写模板',
    fileName: '项目一-关键人物主档模板.xlsx',
    instructionSheetName: '填写说明',
    dataSheetName: '人物主档',
    description: '请在“人物主档”工作表中直接修改示例数据。带“必填”的列不能为空；一格内有多项内容时，请按 Alt+Enter 换行。',
    columns: personColumns,
    defaultRows: personRows,
    headerAliases: personHeaderAliases,
  },
  'client-info': {
    type: 'client-info',
    title: '甲方项目信息填写模板',
    fileName: '甲方基本信息模板.xlsx',
    instructionSheetName: '填写说明',
    dataSheetName: '甲方基本信息',
    description: '请在“甲方基本信息”工作表中修改或补充项目名称、规模、预算、采购、决策和验收等信息。',
    columns: clientInfoColumns,
    defaultRows: clientInfoRows,
    headerAliases: clientHeaderAliases,
  },
  metrics: {
    type: 'metrics',
    title: '游戏指标填写模板',
    fileName: '指标数据模板.xlsx',
    instructionSheetName: '填写说明',
    dataSheetName: '指标数据',
    description: '请在“指标数据”工作表中修改指标。基础输入填写数字；过程计算和综合结果填写计算规则。',
    columns: metricColumns,
    defaultRows: metricRows,
    headerAliases: metricHeaderAliases,
  },
};

// Short alias kept for callers that treat the registry as a generic data table registry.
export const EXCEL_REGISTRY = DESIGNER_EXCEL_REGISTRY;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-（）()]/g, '');
}

function normalizeType(value: unknown): DesignerExcelType | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLocaleLowerCase();
  return (DESIGNER_EXCEL_TYPES as readonly string[]).includes(candidate)
    ? candidate as DesignerExcelType
    : null;
}

export function getDesignerExcelDefinition(value: unknown): DesignerExcelDefinition | null {
  const type = normalizeType(value);
  return type ? DESIGNER_EXCEL_REGISTRY[type] : null;
}

export function getDesignerExcelType(value: unknown): DesignerExcelType | null {
  return normalizeType(value);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('formula' in value && typeof (value as { formula?: unknown }).formula === 'string') {
      return (value as { formula: string }).formula;
    }
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text;
    }
    if ('richText' in value && Array.isArray((value as { richText?: unknown }).richText)) {
      return ((value as { richText: Array<{ text?: string }> }).richText)
        .map((item) => item.text ?? '')
        .join('');
    }
  }
  return String(value);
}

function isBlankValue(value: unknown): boolean {
  return cellText(value).trim() === '';
}

function rowIsBlank(row: ExcelJS.Row): boolean {
  for (let column = 1; column <= row.cellCount; column += 1) {
    if (!isBlankValue(row.getCell(column).value)) return false;
  }
  return true;
}

function defaultValueForColumn(column: DesignerExcelColumn): unknown {
  if (column.kind === 'list') return [];
  if (column.key === 'parentId') return null;
  if (column.kind === 'number') return '';
  return '';
}

function formatCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length > 0 ? value.join('\n') : null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return cellText(value) || null;
}

function formatTemplateCellValue(column: DesignerExcelColumn, value: unknown): string | number | boolean | null {
  const formatted = formatCellValue(value);
  return typeof formatted === 'string' ? column.valueLabels?.[formatted] ?? formatted : formatted;
}

function templateEnumValues(column: DesignerExcelColumn): readonly string[] {
  return column.enumValues?.map((value) => column.valueLabels?.[value] ?? value) ?? [];
}

function templateHeader(column: DesignerExcelColumn): string {
  return `${column.label}（${column.required ? '必填' : '选填'}）`;
}

function applyHeaderStyle(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '5B21B6' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'DDD6FE' } },
    left: { style: 'thin', color: { argb: 'DDD6FE' } },
    bottom: { style: 'thin', color: { argb: 'DDD6FE' } },
    right: { style: 'thin', color: { argb: 'DDD6FE' } },
  };
}

function applyDataStyle(cell: ExcelJS.Cell): void {
  cell.alignment = { vertical: 'top', wrapText: true };
  cell.border = {
    top: { style: 'hair', color: { argb: 'E5E7EB' } },
    left: { style: 'hair', color: { argb: 'E5E7EB' } },
    bottom: { style: 'hair', color: { argb: 'E5E7EB' } },
    right: { style: 'hair', color: { argb: 'E5E7EB' } },
  };
}

function addEnumValidation(worksheet: ExcelJS.Worksheet, columnIndex: number, values: readonly string[], rowCount: number): void {
  if (values.length === 0) return;
  const list = values.join(',').replace(/"/g, '""');
  for (let row = 2; row <= Math.max(rowCount + 1, 200); row += 1) {
    worksheet.getCell(row, columnIndex).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${list}"`],
      showErrorMessage: true,
      errorTitle: '值不在允许范围内',
      error: `请选择：${values.join('、')}`,
    };
  }
}

/** Build a fresh workbook containing a usage sheet and a data sheet. */
export function createDesignerExcelTemplate(type: DesignerExcelType): ExcelJS.Workbook {
  const definition = DESIGNER_EXCEL_REGISTRY[type];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Weixun Designer';
  workbook.lastModifiedBy = 'Weixun Designer';
  workbook.created = new Date();
  workbook.modified = new Date();

  const instructions = workbook.addWorksheet(definition.instructionSheetName);
  instructions.getColumn(1).width = 22;
  instructions.getColumn(2).width = 16;
  instructions.getColumn(3).width = 72;
  instructions.getColumn(4).width = 34;
  instructions.properties.defaultRowHeight = 20;
  instructions.views = [{ state: 'frozen', ySplit: 10, showGridLines: false }];
  instructions.mergeCells('A1:D1');
  instructions.getCell('A1').value = definition.title;
  instructions.getCell('A1').font = { bold: true, size: 16, color: { argb: '4C1D95' } };
  instructions.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  instructions.getRow(1).height = 28;
  instructions.mergeCells('A2:D2');
  instructions.getCell('A2').value = definition.description;
  instructions.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  instructions.getRow(2).height = 34;
  instructions.addRow([]);
  instructions.mergeCells('A4:D4');
  instructions.getCell('A4').value = '填写步骤';
  instructions.getCell('A4').font = { bold: true, color: { argb: '4C1D95' } };
  instructions.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EDE9FE' } };
  const steps = [
    `1. 打开“${definition.dataSheetName}”工作表，在示例数据上直接修改或继续向下新增。`,
    '2. 不要修改工作表名称和第一行表头。带“必填”的列不能为空。',
    '3. 有下拉选项的单元格请直接选择；一格内填写多项内容时，按 Alt+Enter 换行。',
    '4. 填写完成后保存为 .xlsx 文件，再回到设计师后台上传。',
  ];
  steps.forEach((step) => {
    const row = instructions.addRow([step]);
    instructions.mergeCells(row.number, 1, row.number, 4);
    row.getCell(1).alignment = { vertical: 'middle', wrapText: true };
    row.getCell(1).font = { color: { argb: '374151' } };
  });
  instructions.addRow([]);
  const instructionHeader = instructions.addRow(['需要填写的内容', '是否必填', '怎么填写', '填写示例']);
  instructionHeader.eachCell((cell) => applyHeaderStyle(cell));
  definition.columns.forEach((column) => {
    const examples = definition.defaultRows
      .map((row) => row[column.key])
      .find((value) => !isBlankValue(value));
    const row = instructions.addRow([
      column.label,
      column.required ? '是' : '否',
      column.description,
      formatTemplateCellValue(column, examples ?? ''),
    ]);
    row.eachCell((cell) => applyDataStyle(cell));
    row.height = column.kind === 'list' ? 48 : 36;
  });

  const data = workbook.addWorksheet(definition.dataSheetName);
  data.columns = definition.columns.map((column) => ({
    header: templateHeader(column),
    key: column.key,
    width: column.kind === 'list' ? 34 : column.key === 'organization' || column.key === 'personality' ? 42 : 20,
  }));
  const header = data.getRow(1);
  header.eachCell((cell) => applyHeaderStyle(cell));
  header.height = 28;
  definition.defaultRows.forEach((sourceRow) => {
    const row = data.addRow(definition.columns.map((column) => formatTemplateCellValue(column, sourceRow[column.key] ?? defaultValueForColumn(column))));
    row.eachCell((cell) => applyDataStyle(cell));
    row.eachCell((cell, columnNumber) => {
      const column = definition.columns[columnNumber - 1];
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: column.required ? 'FFFBEA' : 'F8FAFC' },
      };
    });
    row.height = 36;
  });
  data.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, definition.defaultRows.length + 1), column: definition.columns.length },
  };
  definition.columns.forEach((column, index) => {
    if (column.enumValues) addEnumValidation(data, index + 1, templateEnumValues(column), definition.defaultRows.length);
  });

  return workbook;
}

export async function createDesignerExcelTemplateBuffer(type: DesignerExcelType): Promise<Buffer> {
  const workbook = createDesignerExcelTemplate(type);
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function findCanonicalHeader(definition: DesignerExcelDefinition, value: unknown): string | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  for (const column of definition.columns) {
    if (normalizeHeader(column.key) === normalized) return column.key;
    if (normalizeHeader(column.label) === normalized) return column.key;
    if (normalizeHeader(templateHeader(column)) === normalized) return column.key;
    const aliasesForColumn = definition.headerAliases?.[column.key] ?? [];
    if (aliasesForColumn.some((alias) => normalizeHeader(alias) === normalized)) return column.key;
  }
  return null;
}

function parseListCell(value: unknown): string[] {
  return cellText(value)
    .split(/[\r\n；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberCell(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cellText(value).trim();
  if (!text) return '';
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : text;
}

function parseMetricValue(kind: unknown, value: unknown): number | string {
  const text = cellText(value).trim();
  if (normalizeMetricKind(kind) === 'A' && text !== '') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
  }
  return text;
}

function normalizeMetricKind(value: unknown): string {
  const text = cellText(value).trim();
  const direct = text.toUpperCase();
  if (direct === 'A' || direct === 'B' || direct === 'C') return direct;
  for (const [kind, label] of Object.entries(METRIC_KIND_LABELS)) {
    if (normalizeHeader(label) === normalizeHeader(text)) return kind;
  }
  return direct;
}

function parseRowValue(column: DesignerExcelColumn, value: unknown, rawKind?: unknown): unknown {
  if (column.kind === 'list') return parseListCell(value);
  if (column.kind === 'number') return parseNumberCell(value);
  if (column.key === 'kind') return normalizeMetricKind(value);
  if (column.key === 'parentId') return cellText(value).trim() || null;
  if (column.key === 'personalityType') return toProjectOnePersonalityTypeId(value) ?? cellText(value).trim();
  if (column.key === 'value' && rawKind !== undefined) return parseMetricValue(rawKind, value);
  return cellText(value).trim();
}

function addMissingHeaderIssues(
  definition: DesignerExcelDefinition,
  headerMap: Map<string, number>,
  errors: ExcelValidationIssue[],
  warnings: ExcelValidationIssue[],
): void {
  for (const column of definition.columns) {
    if (headerMap.has(column.key)) continue;
    const issue = { field: column.key, message: `缺少“${column.label}”这一列。请使用系统导出的模板，不要修改第一行表头。` };
    if (column.required) errors.push(issue);
    else warnings.push(issue);
  }
}

function validateRequired(
  value: unknown,
  column: DesignerExcelColumn,
  rowNumber: number,
  errors: ExcelValidationIssue[],
): void {
  if (!column.required) return;
  const empty = column.kind === 'list'
    ? !Array.isArray(value) || value.length === 0
    : isBlankValue(value);
  if (empty) errors.push({ row: rowNumber, field: column.key, message: `“${column.label}”不能为空。` });
}

function validateEnum(
  value: unknown,
  column: DesignerExcelColumn,
  rowNumber: number,
  errors: ExcelValidationIssue[],
): void {
  if (!column.enumValues || isBlankValue(value)) return;
  if (column.kind === 'list') {
    const invalid = (Array.isArray(value) ? value : []).filter((item) => !column.enumValues?.includes(String(item)));
    if (invalid.length > 0) {
      errors.push({ row: rowNumber, field: column.key, message: `包含不支持的值：${invalid.join('、')}。允许值：${column.enumValues.join('、')}。` });
    }
    return;
  }
  if (!column.enumValues.includes(String(value))) {
    errors.push({ row: rowNumber, field: column.key, message: `值“${String(value)}”无效。允许值：${column.enumValues.join('、')}。` });
  }
}

function validateRowShape(
  type: DesignerExcelType,
  row: Record<string, unknown>,
  rowNumber: number,
  errors: ExcelValidationIssue[],
): void {
  const definition = DESIGNER_EXCEL_REGISTRY[type];
  for (const column of definition.columns) {
    validateRequired(row[column.key], column, rowNumber, errors);
    validateEnum(row[column.key], column, rowNumber, errors);
    if (column.kind === 'number' && !isBlankValue(row[column.key]) && typeof row[column.key] !== 'number') {
      errors.push({ row: rowNumber, field: column.key, message: `“${column.label}”必须是数字。` });
    }
  }

  if (type === 'key-persons') {
    const parentId = String(row.parentId ?? '').trim();
    if (parentId && parentId === String(row.id ?? '').trim()) {
      errors.push({ row: rowNumber, field: 'parentId', message: '上级人物不能指向自己。' });
    }
  }
  if (type === 'metrics' && normalizeMetricKind(row.kind) === 'A') {
    const value = row.value;
    if (!isBlankValue(value) && typeof value !== 'number') {
      errors.push({ row: rowNumber, field: 'value', message: '“基础输入”类型的初始值必须是数字。' });
    }
  }
}

function validateDuplicateIds(
  type: DesignerExcelType,
  rows: Array<{ rowNumber: number; row: Record<string, unknown> }>,
  errors: ExcelValidationIssue[],
): void {
  const field = type === 'metrics' ? 'tag' : 'id';
  const counts = new Map<string, number>();
  for (const item of rows) {
    const key = String(item.row[field] ?? '').trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of rows) {
    const key = String(item.row[field] ?? '').trim();
    if (key && (counts.get(key) ?? 0) > 1) {
      errors.push({ row: item.rowNumber, field, message: `重复的${field === 'id' ? '编号' : '指标编号'}“${key}”。` });
    }
  }
}

function validatePersonParentIds(
  rows: Array<{ rowNumber: number; row: Record<string, unknown> }>,
  errors: ExcelValidationIssue[],
): void {
  const ids = new Set(rows.map((item) => String(item.row.id ?? '').trim()).filter(Boolean));
  for (const item of rows) {
    const parentId = String(item.row.parentId ?? '').trim();
    if (parentId && !ids.has(parentId)) {
      errors.push({ row: item.rowNumber, field: 'parentId', message: `上级人物编号“${parentId}”不在本次导入的人物表中。` });
    }
  }
}

function chooseDataWorksheet(workbook: ExcelJS.Workbook, definition: DesignerExcelDefinition): ExcelJS.Worksheet | undefined {
  const exact = workbook.getWorksheet(definition.dataSheetName);
  if (exact) return exact;
  return workbook.worksheets.find((worksheet) =>
    worksheet.name !== definition.instructionSheetName && worksheet.actualRowCount > 0,
  );
}

/**
 * Parse and validate an .xlsx buffer without writing anything to storage.
 * Structural workbook errors are returned as validation errors where possible;
 * malformed ZIP/XLSX input is raised as DesignerExcelRequestError by the API.
 */
export async function parseDesignerExcel(
  input: Buffer | Uint8Array,
  type: DesignerExcelType,
): Promise<DesignerExcelImportResult> {
  const definition = DESIGNER_EXCEL_REGISTRY[type];
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS's public declaration models its in-memory input as an
    // ArrayBuffer-like Buffer. Passing the underlying ArrayBuffer also avoids
    // the Node 20 Buffer generic mismatch between ExcelJS and @types/node.
    const arrayBuffer = new Uint8Array(input).buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    throw new DesignerExcelRequestError('上传文件不是有效的 .xlsx 工作簿。', 400, 'INVALID_XLSX');
  }

  const worksheet = chooseDataWorksheet(workbook, definition);
  if (!worksheet) {
    return {
      ok: false,
      type,
      sheetName: definition.dataSheetName,
      rows: [],
      errors: [{ message: `未找到“${definition.dataSheetName}”工作表。请使用系统导出的模板，不要修改工作表名称。` }],
      warnings: [],
      summary: { totalRows: 0, validRows: 0, errorCount: 1 },
    };
  }

  const headerMap = new Map<string, number>();
  const errors: ExcelValidationIssue[] = [];
  const warnings: ExcelValidationIssue[] = [];
  const headerRow = worksheet.getRow(1);
  for (let columnNumber = 1; columnNumber <= Math.max(headerRow.cellCount, worksheet.actualColumnCount); columnNumber += 1) {
    const cellValue = headerRow.getCell(columnNumber).value;
    if (isBlankValue(cellValue)) continue;
    const canonical = findCanonicalHeader(definition, cellValue);
    if (!canonical) {
      warnings.push({ field: cellText(cellValue).trim(), message: `忽略未知列“${cellText(cellValue).trim()}”。` });
      continue;
    }
    if (headerMap.has(canonical)) {
      const label = definition.columns.find((column) => column.key === canonical)?.label ?? canonical;
      errors.push({ field: canonical, message: `“${label}”这一列重复出现。` });
      continue;
    }
    headerMap.set(canonical, columnNumber);
  }
  addMissingHeaderIssues(definition, headerMap, errors, warnings);

  const rowItems: Array<{ rowNumber: number; row: Record<string, unknown> }> = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    if (rowIsBlank(worksheetRow)) continue;
    if (rowItems.length >= MAX_EXCEL_IMPORT_ROWS) {
      throw new DesignerExcelRequestError(`数据行数不能超过 ${MAX_EXCEL_IMPORT_ROWS} 行。`, 413, 'ROW_LIMIT_EXCEEDED');
    }

    const rawKind = headerMap.get('kind') === undefined
      ? undefined
      : worksheetRow.getCell(headerMap.get('kind')!).value;
    const row: Record<string, unknown> = {};
    for (const column of definition.columns) {
      const sourceCell = headerMap.get(column.key);
      const rawValue = sourceCell === undefined ? undefined : worksheetRow.getCell(sourceCell).value;
      row[column.key] = sourceCell === undefined
        ? defaultValueForColumn(column)
        : parseRowValue(column, rawValue, rawKind);
    }
    rowItems.push({ rowNumber, row });
    validateRowShape(type, row, rowNumber, errors);
  }

  validateDuplicateIds(type, rowItems, errors);
  if (type === 'key-persons') validatePersonParentIds(rowItems, errors);

  const rowErrorNumbers = new Set(errors.flatMap((error) => error.row === undefined ? [] : [error.row]));
  const rows = rowItems.map((item) => item.row);
  return {
    ok: errors.length === 0,
    type,
    sheetName: worksheet.name,
    rows,
    errors,
    warnings,
    summary: {
      totalRows: rowItems.length,
      validRows: rowItems.filter((item) => !rowErrorNumbers.has(item.rowNumber)).length,
      errorCount: errors.length,
    },
  };
}

// Exported aliases make the small service easy to use from tests and future save APIs.
export const createExcelTemplate = createDesignerExcelTemplate;
export const createExcelTemplateBuffer = createDesignerExcelTemplateBuffer;
export const parseExcelImport = parseDesignerExcel;
