'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';

type DataType = 'key-persons' | 'client-info' | 'metrics';

type ImportIssue = {
  row?: number;
  field?: string;
  message: string;
};

type ImportResult = {
  ok: boolean;
  type: DataType;
  sheetName: string;
  rows: Array<Record<string, unknown>>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  summary: {
    totalRows: number;
    validRows: number;
    errorCount: number;
  };
};

const DATA_TYPES: Array<{ id: DataType; title: string; description: string; target: string }> = [
  { id: 'key-persons', title: '人物主档', description: '人物身份、组织关系、性格、线索、边界、记忆和允许任务。', target: '/designer/key-persons' },
  { id: 'client-info', title: '甲方项目信息', description: '项目介绍以及 R1、R2 等可扩展项目信息。', target: '/designer/client-info' },
  { id: 'metrics', title: '指标体系', description: '基础输入、过程计算和综合结果指标。', target: '/designer' },
];

const FIELD_LABELS: Record<DataType, Record<string, string>> = {
  'key-persons': {
    id: '人物编号', name: '姓名', title: '职务', category: '角色类别', level: '组织层级',
    parentId: '上级人物编号', displayLevel: '组织图层级', displayOrder: '同层显示顺序',
    organization: '组织关系与职责', personalityType: '性格类型', personality: '性格与沟通表现',
    coreNeeds: '核心诉求', facts: '已知事实', clues: '可披露线索', informationBoundary: '信息边界',
    memoryFocus: '需要记住的内容', taboos: '沟通禁忌', allowedTasks: '拜访时可执行的任务',
  },
  'client-info': {
    id: '信息编号', label: '页面显示编号', key: '信息名称', value: '信息内容', description: '补充说明',
  },
  metrics: {
    kind: '指标类型', tag: '指标编号', name: '指标名称', desc: '指标说明',
    value: '初始值或计算规则', category: '指标分类',
  },
};

const STORAGE_PREFIX = 'weixun_designer_excel_import:';

function sessionHeader(): HeadersInit {
  return { 'x-session': window.localStorage.getItem('weixun_session') || '' };
}

function fieldLabel(type: DataType, field: string): string {
  return FIELD_LABELS[type][field] ?? field;
}

function issueText(issue: ImportIssue, type: DataType): string {
  const location = [issue.row ? `第 ${issue.row} 行` : '', issue.field ? fieldLabel(type, issue.field) : ''].filter(Boolean).join(' · ');
  return location ? `${location}：${issue.message}` : issue.message;
}

export default function DataImportExportPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dataType, setDataType] = useState<DataType>('key-persons');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [requestError, setRequestError] = useState('');

  const config = useMemo(() => DATA_TYPES.find((item) => item.id === dataType) ?? DATA_TYPES[0], [dataType]);
  const previewColumns = useMemo(() => result?.rows[0] ? Object.keys(result.rows[0]).slice(0, 8) : [], [result]);

  const changeType = (next: DataType) => {
    setDataType(next);
    setFile(null);
    setResult(null);
    setRequestError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const exportTemplate = async () => {
    setBusy('export');
    setRequestError('');
    try {
      const response = await fetch(`/api/designer/excel/template?type=${encodeURIComponent(dataType)}`, { headers: sessionHeader() });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '模板导出失败');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : `${config.title}_导入模板.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '模板导出失败');
    } finally {
      setBusy(null);
    }
  };

  const parseFile = async () => {
    if (!file) return;
    setBusy('import');
    setRequestError('');
    setResult(null);
    try {
      const form = new FormData();
      form.set('type', dataType);
      form.set('file', file);
      const response = await fetch('/api/designer/excel/import', { method: 'POST', headers: sessionHeader(), body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Excel 解析失败');
      setResult(payload as ImportResult);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Excel 解析失败');
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () => {
    if (!result?.ok) return;
    window.localStorage.setItem(`${STORAGE_PREFIX}${dataType}`, JSON.stringify({ importedAt: new Date().toISOString(), rows: result.rows }));
    router.push(config.target);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center gap-4 border-b border-border bg-card px-6">
        <button onClick={() => router.push('/designer')} className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20" aria-label="返回设计师工作台">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Excel 数据导入导出</h1>
          <p className="text-xs text-muted-foreground">先下载模板，保持工作表名称和表头不变，上传后校验并预览。</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-6">
        <section className="grid gap-3 md:grid-cols-3">
          {DATA_TYPES.map((item) => (
            <button key={item.id} onClick={() => changeType(item.id)} className={`rounded-xl border p-4 text-left transition-colors ${dataType === item.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}>
              <div className="flex items-center gap-2 font-semibold text-foreground"><FileSpreadsheet className="h-4 w-4 text-primary" />{item.title}</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
            </button>
          ))}
        </section>
        <button onClick={() => router.push('/designer/prompt-library')} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40">
          <div><div className="flex items-center gap-2 font-semibold text-foreground"><FileSpreadsheet className="h-4 w-4 text-primary" />人物提示词</div><p className="mt-1 text-xs text-muted-foreground">导出当前保存的五人人物与渠道提示词，在提示词页面导入、预览并保存。</p></div>
          <span className="text-xs font-semibold text-primary">打开人物提示词 →</span>
        </button>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-foreground">1. 下载标准模板</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">模板包含字段说明和当前默认数据，可直接修改，也可保留表头后替换全部数据行。</p>
              </div>
              <button onClick={() => void exportTemplate()} disabled={busy !== null} className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                <Download className="h-4 w-4" />{busy === 'export' ? '生成中…' : '导出 Excel'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-foreground">2. 上传并解析</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">仅支持 .xlsx，最大 5 MB。解析只生成预览，校验通过后才可保存为设计师草稿。</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setRequestError(''); }} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-primary" />
              <button onClick={() => void parseFile()} disabled={!file || busy !== null} className="flex items-center gap-2 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary disabled:opacity-40">
                <Upload className="h-4 w-4" />{busy === 'import' ? '解析中…' : '开始解析'}
              </button>
            </div>
          </div>
        </section>

        {requestError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{requestError}</div>}

        {result && (
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {result.ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
                  <h2 className="font-semibold text-foreground">解析结果</h2>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">工作表“{result.sheetName}”共 {result.summary.totalRows} 行，{result.summary.validRows} 行通过校验，{result.summary.errorCount} 个错误。</p>
              </div>
              <button onClick={saveDraft} disabled={!result.ok} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">保存草稿并打开配置页</button>
            </div>

            {(result.errors.length > 0 || result.warnings.length > 0) && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <IssueList title="错误" issues={result.errors} tone="error" type={dataType} />
                <IssueList title="提醒" issues={result.warnings} tone="warning" type={dataType} />
              </div>
            )}

            {result.rows.length > 0 && (
              <div className="mt-5 overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-muted text-muted-foreground"><tr>{previewColumns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-semibold">{fieldLabel(dataType, column)}</th>)}</tr></thead>
                  <tbody>{result.rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-border">{previewColumns.map((column) => <td key={column} className="max-w-64 truncate px-3 py-2 text-foreground" title={String(row[column] ?? '')}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody>
                </table>
                {result.rows.length > 10 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">仅预览前 10 行，保存时包含全部 {result.rows.length} 行。</p>}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function IssueList({ title, issues, tone, type }: { title: string; issues: ImportIssue[]; tone: 'error' | 'warning'; type: DataType }) {
  if (issues.length === 0) return <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">没有{title}</div>;
  const toneClass = tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-warning/30 bg-warning/5 text-warning';
  return <div className={`rounded-lg border p-3 ${toneClass}`}><h3 className="text-sm font-semibold">{title}（{issues.length}）</h3><ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{issues.slice(0, 30).map((issue, index) => <li key={`${issue.row}-${issue.field}-${index}`}>{issueText(issue, type)}</li>)}</ul></div>;
}
