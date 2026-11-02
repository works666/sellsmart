'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleHelp,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';

type JevTaskConfig = {
  stateGuidance: string;
  questionInstructions: Record<string, string>;
};

type DecisionProvider = 'jev' | 'llm';

type JevConfig = {
  decisionProvider: DecisionProvider;
  tasks: Record<string, JevTaskConfig>;
};

type JevStateField = string | {
  key?: string;
  id?: string;
  label?: string;
  name?: string;
  type?: string;
  description?: string;
  path?: string;
  source?: string;
};

type JevQuestion = {
  id: string;
  label: string;
  type: string;
  criteria: unknown;
  baselineInstructions: string;
  editable?: boolean;
  dynamicCandidates?: unknown;
};

type JevTask = {
  taskId: string;
  label: string;
  state: {
    description: string;
    fields: JevStateField[];
  };
  questions: JevQuestion[];
};

type JevNpcProfile = {
  id: string;
  name: string;
  [key: string]: unknown;
};

type JevConfigResponse = {
  revision: number;
  config: JevConfig;
  catalog: JevTask[];
  npcProfiles?: JevNpcProfile[];
  candidateNpcProfiles?: JevNpcProfile[];
};

function normalizeConfig(value: unknown): JevConfig {
  if (!value || typeof value !== 'object') return { decisionProvider: 'jev', tasks: {} };
  const decisionProvider = (value as Partial<JevConfig>).decisionProvider;
  const rawTasks = (value as Partial<JevConfig>).tasks;
  const tasks: JevConfig['tasks'] = {};
  if (rawTasks && typeof rawTasks === 'object' && !Array.isArray(rawTasks)) {
    for (const [taskId, rawTask] of Object.entries(rawTasks)) {
      if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
      const questionInstructions = (rawTask as Partial<JevTaskConfig>).questionInstructions;
      tasks[taskId] = {
        stateGuidance: typeof (rawTask as Partial<JevTaskConfig>).stateGuidance === 'string'
          ? (rawTask as JevTaskConfig).stateGuidance
          : '',
        questionInstructions: questionInstructions && typeof questionInstructions === 'object' && !Array.isArray(questionInstructions)
          ? Object.fromEntries(Object.entries(questionInstructions).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          : {},
      };
    }
  }
  return { decisionProvider: decisionProvider === 'llm' ? 'llm' : 'jev', tasks };
}

function prettyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeNpcProfiles(value: unknown): JevNpcProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((profile): profile is JevNpcProfile => (
    Boolean(profile)
    && typeof profile === 'object'
    && typeof (profile as Partial<JevNpcProfile>).id === 'string'
    && typeof (profile as Partial<JevNpcProfile>).name === 'string'
  ));
}

function fieldLabel(field: JevStateField, index: number): string {
  if (typeof field === 'string') return field;
  return field.label || field.name || field.key || field.id || `字段 ${index + 1}`;
}

function fieldKey(field: JevStateField): string {
  if (typeof field === 'string') return field;
  return field.key || field.id || field.name || '';
}

function fieldDescription(field: JevStateField): string {
  return typeof field === 'string' ? '' : field.description || '';
}

function fieldMetadata(field: JevStateField): string[] {
  if (typeof field === 'string') return [];
  return [field.type, field.path, field.source].filter((value): value is string => Boolean(value));
}

function criteriaText(criteria: unknown): string {
  return prettyValue(criteria) || '未提供题目判定标准。';
}

function sessionHeaders(): Record<string, string> {
  return { 'x-session': window.localStorage.getItem('weixun_session') || '' };
}

export default function JevConfigPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<JevTask[]>([]);
  const [npcProfiles, setNpcProfiles] = useState<JevNpcProfile[]>([]);
  const [candidateNpcProfiles, setCandidateNpcProfiles] = useState<JevNpcProfile[]>([]);
  const [config, setConfig] = useState<JevConfig>({ decisionProvider: 'jev', tasks: {} });
  const [savedConfig, setSavedConfig] = useState<JevConfig>({ decisionProvider: 'jev', tasks: {} });
  const [revision, setRevision] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [selectedNpcId, setSelectedNpcId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);
  const selectedTask = catalog.find((task) => task.taskId === selectedTaskId) ?? catalog[0];
  const selectedQuestion = selectedTask?.questions.find((question) => question.id === selectedQuestionId) ?? selectedTask?.questions[0];
  const selectedNpcProfile = npcProfiles.find((profile) => profile.id === selectedNpcId);
  const selectedCandidateProfile = candidateNpcProfiles.find((profile) => profile.id === selectedNpcId);
  const hasTaskNpcProfile = Boolean(selectedTask?.state.fields.some((field) => ['npcProfile', 'candidateNpcProfiles'].includes(fieldKey(field))));
  const hasTaskCandidateProfiles = Boolean(selectedTask?.state.fields.some((field) => fieldKey(field) === 'candidateNpcProfiles'));
  const selectedTaskConfig = selectedTask ? config.tasks[selectedTask.taskId] : undefined;
  const stateGuidance = selectedTaskConfig?.stateGuidance ?? '';
  const questionInstruction = selectedTask && selectedQuestion
    ? selectedTaskConfig?.questionInstructions[selectedQuestion.id] ?? ''
    : '';

  async function loadConfig() {
    setLoading(true);
    setNotice('');
    setConflict(false);
    try {
      const response = await fetch('/api/designer/jev-config', {
        headers: sessionHeaders(),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Jev 决策配置读取失败。');
      const result = body as JevConfigResponse;
      const nextCatalog = Array.isArray(result.catalog) ? result.catalog : [];
      const nextNpcProfiles = normalizeNpcProfiles(result.npcProfiles);
      const nextCandidateNpcProfiles = normalizeNpcProfiles(result.candidateNpcProfiles);
      const nextConfig = normalizeConfig(result.config);
      setCatalog(nextCatalog);
      setNpcProfiles(nextNpcProfiles);
      setCandidateNpcProfiles(nextCandidateNpcProfiles);
      setConfig(nextConfig);
      setSavedConfig(structuredClone(nextConfig));
      setRevision(Number.isInteger(result.revision) ? result.revision : 0);
      setSelectedTaskId((current) => nextCatalog.some((task) => task.taskId === current) ? current : nextCatalog[0]?.taskId ?? '');
      setSelectedQuestionId((current) => {
        const task = nextCatalog.find((entry) => entry.taskId === selectedTaskId) ?? nextCatalog[0];
        return task?.questions.some((question) => question.id === current) ? current : task?.questions[0]?.id ?? '';
      });
      setSelectedNpcId((current) => {
        if (nextNpcProfiles.some((profile) => profile.id === current)) return current;
        return nextNpcProfiles[0]?.id ?? '';
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Jev 决策配置读取失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
    // Initial read only; reload actions call the same function directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateStateGuidance(value: string) {
    if (!selectedTask || config.decisionProvider !== 'jev') return;
    setConfig((current) => ({
      ...current,
      tasks: {
        ...current.tasks,
        [selectedTask.taskId]: {
          stateGuidance: value,
          questionInstructions: current.tasks[selectedTask.taskId]?.questionInstructions ?? {},
        },
      },
    }));
    setNotice('');
  }

  function updateQuestionInstruction(value: string) {
    if (!selectedTask || !selectedQuestion || config.decisionProvider !== 'jev') return;
    setConfig((current) => ({
      ...current,
      tasks: {
        ...current.tasks,
        [selectedTask.taskId]: {
          stateGuidance: current.tasks[selectedTask.taskId]?.stateGuidance ?? '',
          questionInstructions: {
            ...current.tasks[selectedTask.taskId]?.questionInstructions,
            [selectedQuestion.id]: value,
          },
        },
      },
    }));
    setNotice('');
  }

  function restoreCurrentDefault() {
    if (!selectedTask || config.decisionProvider !== 'jev') return;
    if (selectedQuestion) {
      updateQuestionInstruction('');
      setNotice('已将当前题目恢复为默认说明；保存后生效。');
      return;
    }
    updateStateGuidance('');
    setNotice('已清空当前任务的状态补充说明；保存后生效。');
  }

  function updateDecisionProvider(decisionProvider: DecisionProvider) {
    setConfig((current) => ({ ...current, decisionProvider }));
    setNotice('');
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setNotice('');
    setConflict(false);
    try {
      const response = await fetch('/api/designer/jev-config', {
        method: 'PUT',
        headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision, config }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setConflict(true);
        setNotice(body.error || '配置已被其他设计师更新。当前草稿仍保留，请复制需要的修改后再加载最新版本。');
        return;
      }
      if (!response.ok) throw new Error(body.error || 'Jev 决策配置保存失败。');
      const result = body as Pick<JevConfigResponse, 'revision' | 'config'>;
      const nextConfig = normalizeConfig(result.config);
      setConfig(nextConfig);
      setSavedConfig(structuredClone(nextConfig));
      setRevision(Number.isInteger(result.revision) ? result.revision : revision);
      setNotice('Jev 决策配置已保存。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Jev 决策配置保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
          <button
            onClick={() => router.push('/designer')}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="返回设计师工作台"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700"><BrainCircuit className="h-5 w-5" /></span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Jev 决策配置</h1>
              <p className="mt-0.5 text-xs text-slate-500">查看决策上下文，并编辑状态补充说明与题目自定义说明。</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className={`mr-1 text-xs font-medium ${dirty ? 'text-amber-700' : 'text-emerald-700'}`} role="status">
              {dirty ? '有尚未保存的修改' : '当前内容已保存'}
            </span>
            <button
              onClick={restoreCurrentDefault}
              disabled={loading || saving || !selectedTask || config.decisionProvider !== 'jev'}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />{selectedQuestion ? '恢复当前问题默认值' : '清空状态补充说明'}
            </button>
            <button
              onClick={() => void save()}
              disabled={loading || saving || !dirty}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-4 w-4" />{saving ? '保存中…' : '保存全部'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p>状态字段说明、题目 key、类型与判定标准为只读。Jev 模式下，状态补充说明用于引导 Jev 如何理解状态；题目自定义说明填写后会替换默认说明，留空则沿用默认。</p>
        </div>
        <section className="mb-4 rounded-xl border border-blue-200 bg-white p-4 shadow-sm" aria-labelledby="decision-provider-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="decision-provider-heading" className="text-sm font-semibold text-slate-900">全局决策模型</h2>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-600">此设置对项目内所有 AI 决策统一生效。切换后需要点击“保存全部”；保存成功后，新发起的决策才会使用所选模型。</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${config.decisionProvider === 'jev' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
              当前草稿：{config.decisionProvider === 'jev' ? 'Jev' : '现有 LLM'}
            </span>
          </div>
          <fieldset className="mt-3 grid gap-2 sm:grid-cols-2" disabled={loading || saving}>
            <legend className="sr-only">选择所有决策使用的模型</legend>
            {([
              { value: 'jev', title: 'Jev', description: '将所有决策交给 Jev API。' },
              { value: 'llm', title: '现有 LLM', description: '将所有决策交给项目当前配置的 LLM。' },
            ] as const).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${config.decisionProvider === option.value ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-slate-200 hover:bg-slate-50'} ${loading || saving ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="decision-provider"
                  value={option.value}
                  checked={config.decisionProvider === option.value}
                  onChange={() => updateDecisionProvider(option.value)}
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-900">{option.title}</span>
                  <span className="mt-1 block text-[11px] leading-5 text-slate-600">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {config.decisionProvider === 'llm' && (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600" role="status">
              当前为 LLM 模式。下方状态补充说明和题目自定义说明是 Jev 专用配置，现已暂停应用；切回 Jev 后会恢复使用，配置内容不会被清除。
            </p>
          )}
        </section>
        {notice && (
          <div role="alert" className={`mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs leading-5 ${conflict ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white text-slate-700'}`}>
            <span className="flex min-w-0 items-start gap-2">
              {conflict && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
              {notice}
            </span>
            {conflict && (
              <button onClick={() => void loadConfig()} disabled={loading} className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                丢弃草稿并加载最新版本
              </button>
            )}
          </div>
        )}

        {loading && catalog.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-16 text-center text-sm text-slate-500">正在读取 Jev 决策配置…</div>
        ) : catalog.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-semibold text-slate-800">暂时没有可编辑的 Jev 决策任务</p>
            <p className="mt-2 text-xs text-slate-500">{notice || '请确认当前账号有设计师权限，并且服务端已配置 Jev 任务目录。'}</p>
            <button onClick={() => void loadConfig()} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">重新读取</button>
          </div>
        ) : (
          <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[235px_255px_minmax(0,1fr)]">
            <aside className="border-b border-slate-200 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="border-b border-slate-100 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Jev 决策任务</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">选择任务</div>
              </div>
              <nav className="space-y-1 p-3" aria-label="选择 Jev 决策任务">
                {catalog.map((task) => {
                  const active = task.taskId === selectedTask?.taskId;
                  const customQuestionCount = task.questions.filter((question) => Boolean(config.tasks[task.taskId]?.questionInstructions[question.id]?.trim())).length;
                  return (
                    <button
                      key={task.taskId}
                      onClick={() => { setSelectedTaskId(task.taskId); setSelectedQuestionId(task.questions[0]?.id ?? ''); setNotice(''); }}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{task.label}</span>
                        <span className={`mt-1 block truncate text-[10px] ${active ? 'text-amber-100' : 'text-slate-400'}`}>{task.taskId} · {task.questions.length} 个问题</span>
                      </span>
                      <ChevronRight className={`h-4 w-4 shrink-0 ${active ? 'text-amber-100' : 'text-slate-300'}`} />
                      {customQuestionCount > 0 && <span className="sr-only">有 {customQuestionCount} 个问题使用自定义说明</span>}
                    </button>
                  );
                })}
              </nav>
            </aside>

            <aside className="border-b border-slate-200 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="border-b border-slate-100 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">问题清单</div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-800">{selectedTask?.label}</div>
              </div>
              {selectedTask?.questions.length ? (
                <nav className="space-y-1 p-3" aria-label="选择 Jev 决策问题">
                  {selectedTask.questions.map((question) => {
                    const active = question.id === selectedQuestion?.id;
                    const customized = Boolean(config.tasks[selectedTask.taskId]?.questionInstructions[question.id]?.trim());
                    return (
                      <button
                        key={question.id}
                        onClick={() => { setSelectedQuestionId(question.id); setNotice(''); }}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold leading-5">{question.label}</span>
                            <span className={`mt-1 block break-all font-mono text-[10px] ${active ? 'text-blue-100' : 'text-slate-400'}`}>{question.id}</span>
                          </span>
                          {customized ? <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'text-blue-100' : 'text-emerald-600'}`} aria-label="已填写自定义说明" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              ) : (
                <p className="p-4 text-xs leading-5 text-slate-500">此任务暂无独立问题。右侧仍可查看状态字段并编辑状态补充说明。</p>
              )}
            </aside>

            <section className="min-w-0 space-y-4 p-4 sm:p-5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              {selectedTask && (
                <>
                  <section className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-slate-900">Jev state context</h2>
                          <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">动态输入 · 只读</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{selectedTask.state.description || 'Jev 决策时使用的状态上下文说明。'}</p>
                      </div>
                      <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
                    </div>
                    <div className="p-4">
                      <p className="mb-3 flex items-start gap-2 text-[11px] leading-5 text-slate-500">
                        <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                        下列项目是传给 Jev 的状态字段说明。玩家输入、关系状态与记忆等动态值会随每轮变化，本页不展示单局快照；人物主档中的稳定画像会在下方单独展示。
                      </p>
                      {selectedTask.state.fields.length ? (
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {selectedTask.state.fields.map((field, index) => (
                            <li key={`${fieldLabel(field, index)}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-slate-800">{fieldLabel(field, index)}</span>
                                {fieldMetadata(field).map((metadata) => <span key={metadata} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{metadata}</span>)}
                              </div>
                              {fieldDescription(field) && <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{fieldDescription(field)}</p>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500">此任务没有单独列出的状态字段。</p>
                      )}
                      {hasTaskNpcProfile && (
                        <div className="mt-4 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50/40">
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100 px-3 py-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-xs font-semibold text-slate-900">{hasTaskCandidateProfiles ? 'Jev 候选人物画像' : 'Jev 人物决策画像'}</h3>
                                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[9px] font-semibold text-indigo-800">静态值 · 只读</span>
                              </div>
                              <p className="mt-1 text-[10px] leading-5 text-slate-600">
                                目录任务：<span className="font-mono">{selectedTask.taskId}</span>。{hasTaskCandidateProfiles
                                  ? '下方完整静态决策画像是候选资料来源；同时展示本任务实际提供给 Jev 的精简候选值。'
                                  : '下方静态决策画像会按目标 NPC 提供给 Jev。'}这不是某一局的完整请求快照；玩家本轮输入、关系数值和记忆等动态值仍按轮次传入，未在此显示。
                              </p>
                            </div>
                            <LockKeyhole className="h-4 w-4 shrink-0 text-indigo-500" />
                          </div>
                          <div className="space-y-3 p-3">
                            {npcProfiles.length > 0 ? (
                              <div>
                                <label htmlFor="jev-npc-profile" className="mb-1.5 block text-[10px] font-semibold text-slate-700">查看人物决策画像（{hasTaskCandidateProfiles ? '候选来源' : 'Jev 静态画像输入'}）</label>
                                <select
                                  id="jev-npc-profile"
                                  value={selectedNpcProfile?.id ?? ''}
                                  onChange={(event) => setSelectedNpcId(event.target.value)}
                                  disabled={loading || npcProfiles.length === 0}
                                  className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-100"
                                >
                                  {npcProfiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.name} · {profile.id}{typeof profile.title === 'string' ? ` · ${profile.title}` : ''}</option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <p className="rounded-lg bg-white px-3 py-2 text-[10px] text-slate-600">服务端尚未返回人物主档画像。</p>
                            )}
                            {selectedNpcProfile && (
                              <div className="rounded-lg border border-indigo-100 bg-white p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[10px] font-semibold text-slate-700">当前查看：{selectedNpcProfile.name}{typeof selectedNpcProfile.title === 'string' ? ` · ${selectedNpcProfile.title}` : ''}{hasTaskCandidateProfiles ? ' · 完整静态画像来源' : ''}</span>
                                  <span className="font-mono text-[9px] text-slate-400">{selectedNpcProfile.id} · {selectedTask.taskId}</span>
                                </div>
                                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-[10px] leading-5 text-slate-700">{prettyValue(selectedNpcProfile)}</pre>
                              </div>
                            )}
                            {hasTaskCandidateProfiles && (
                              <div className="rounded-lg border border-indigo-100 bg-white p-3">
                                {selectedCandidateProfile ? (
                                  <>
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[10px] font-semibold text-slate-700">Jev 实际接收的精简候选值：{selectedCandidateProfile.name}{typeof selectedCandidateProfile.title === 'string' ? ` · ${selectedCandidateProfile.title}` : ''}</span>
                                      <span className="font-mono text-[9px] text-slate-400">{selectedCandidateProfile.id} · {selectedTask.taskId}</span>
                                    </div>
                                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-[10px] leading-5 text-slate-700">{prettyValue(selectedCandidateProfile)}</pre>
                                  </>
                                ) : (
                                  <p className="text-[10px] leading-5 text-slate-600">服务端尚未返回此任务的精简候选人物值。</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-200 bg-amber-50/60 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor="jev-state-guidance" className="text-xs font-semibold text-slate-800">Jev state guidance</label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">{config.decisionProvider === 'llm' ? 'LLM 模式下暂停应用' : '补充说明；不替代动态状态内容'}</span>
                          <button type="button" onClick={() => updateStateGuidance('')} disabled={loading || saving || config.decisionProvider !== 'jev' || !stateGuidance} className="rounded px-1.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40">清空</button>
                        </div>
                      </div>
                      <textarea
                        id="jev-state-guidance"
                        value={stateGuidance}
                        onChange={(event) => updateStateGuidance(event.target.value)}
                        disabled={loading || saving || config.decisionProvider !== 'jev'}
                        maxLength={8000}
                        placeholder="填写 Jev 解读这些状态字段时应遵循的补充原则。留空表示不添加额外说明。"
                        className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15 disabled:cursor-not-allowed disabled:bg-slate-100"
                      />
                      <p className="mt-1 text-right text-[10px] text-slate-400">{stateGuidance.length}/8000 字</p>
                    </div>
                  </section>

                  {selectedQuestion && (
                    <section className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-semibold text-slate-900">{selectedQuestion.label}</h2>
                            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{selectedQuestion.type}</span>
                          </div>
                          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Question key：{selectedQuestion.id}</p>
                        </div>
                        <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">判定标准 · 只读</div>
                          <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-slate-700">{criteriaText(selectedQuestion.criteria)}</pre>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">默认题目说明 · 只读</div>
                          <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-slate-700">{selectedQuestion.baselineInstructions || '此题没有额外的默认说明。'}</pre>
                        </div>
                      </div>
                      <div className="border-t border-slate-200 bg-blue-50/50 p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <label htmlFor="jev-question-instructions" className="text-xs font-semibold text-slate-800">Jev 自定义题目说明（填写后替换默认说明）</label>
                          <span className="text-[10px] text-slate-500">{config.decisionProvider === 'llm' ? 'LLM 模式下暂停应用' : questionInstruction.trim() ? '当前使用自定义说明' : '留空时使用默认说明'}</span>
                        </div>
                        <textarea
                          id="jev-question-instructions"
                          value={questionInstruction}
                          onChange={(event) => updateQuestionInstruction(event.target.value)}
                          disabled={loading || saving || config.decisionProvider !== 'jev' || selectedQuestion.editable === false}
                          maxLength={4000}
                          placeholder={config.decisionProvider === 'llm' ? '当前使用 LLM 模式；切回 Jev 后可继续编辑此说明。' : selectedQuestion.editable === false ? '此问题暂不开放自定义说明。' : '留空则沿用上方默认题目说明。填写后将以此内容替换默认说明。'}
                          className="min-h-36 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />
                        <p className="mt-1 text-right text-[10px] text-slate-400">{questionInstruction.length}/4000 字</p>
                      </div>
                      {selectedQuestion.dynamicCandidates !== undefined && (
                        <div className="border-t border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><LockKeyhole className="h-3.5 w-3.5" />候选选项与键 · 只读</div>
                          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-700">{prettyValue(selectedQuestion.dynamicCandidates) || '此题没有单独列出的候选选项。'}</pre>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
