'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FlaskConical,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS,
  DEFAULT_PROJECT_ONE_PROMPT_CONFIG,
  normalizeNpcRolePrompt,
  type NpcRolePromptProfile,
  type ProjectOnePromptConfig,
} from '@/lib/designer/prompt-config';
import {
  PROJECT_ONE_CHANNEL_MODIFIERS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
  PROJECT_ONE_FIVE_PERSON_IDS,
  type ProjectOneChannelId,
  type ProjectOneFivePersonId,
} from '@/lib/designer/project-one-five-person';
import {
  getPromptTestNpcPromptDraftStorageKey,
  getPromptTestUserId,
} from '@/lib/designer/prompt-test-storage';
import type { PromptExcelImportResult, PromptExcelRow } from '@/lib/designer/prompt-excel';
import { getProjectOnePersonalityType } from '@/lib/designer/personality-types';

type Person = (typeof PROJECT_ONE_FIVE_PERSON_NPCS)[ProjectOneFivePersonId];
type Channel = (typeof PROJECT_ONE_CHANNEL_MODIFIERS)[ProjectOneChannelId];

type ChannelMenuItem = {
  id: ProjectOneChannelId;
  label: string;
};

type ChannelMenuGroup = {
  id: string;
  label: string;
  items: readonly ChannelMenuItem[];
};

type Selection =
  | { kind: 'person'; field: keyof NpcRolePromptProfile }
  | { kind: 'channel'; channelId: ProjectOneChannelId };

const PERSON_PROMPT_FIELDS: Array<{ field: keyof NpcRolePromptProfile; label: string; hint: string }> = [
  { field: 'base', label: '人物基础提示词', hint: '人物背景、职责和边界；运行时会保留原稿并排除旧的支持度条件段。' },
  { field: 'low', label: '低支持度提示词', hint: '服务端按当前配置门槛选择后使用。' },
  { field: 'medium', label: '中支持度提示词', hint: '服务端按当前配置门槛选择后使用。' },
  { field: 'high', label: '高支持度提示词', hint: '服务端按当前配置门槛选择后使用。' },
];

const CHANNEL_MENU_GROUPS: readonly ChannelMenuGroup[] = [
  {
    id: 'email',
    label: '邮件交流',
    items: [{ id: 'email', label: '邮件交流' }],
  },
  {
    id: 'wechat',
    label: '微信交流',
    items: [
      { id: 'wechat', label: '工作微信' },
      { id: 'wechat_request', label: '申请添加微信' },
    ],
  },
  {
    id: 'phone',
    label: '电话交流',
    items: [{ id: 'work_phone', label: '电话交流' }],
  },
  {
    id: 'visit',
    label: '拜访面谈',
    items: [
      { id: 'visit', label: '普通拜访' },
      { id: 'direct_visit', label: '直接登门' },
      { id: 'scheduled_visit', label: '约好拜访' },
      { id: 'referral', label: '他人转介绍' },
    ],
  },
];

const PEOPLE = PROJECT_ONE_FIVE_PERSON_IDS
  .map((id) => PROJECT_ONE_FIVE_PERSON_NPCS[id])
  .sort((left, right) => left.displayLevel - right.displayLevel || left.displayOrder - right.displayOrder);

function getChannel(channelId: ProjectOneChannelId): Channel {
  return PROJECT_ONE_CHANNEL_MODIFIERS[channelId];
}

function getSelectionValue(config: ProjectOnePromptConfig, npcId: ProjectOneFivePersonId, selection: Selection): string {
  if (selection.kind === 'person') return normalizeNpcRolePrompt(config.npcRolePrompts[npcId])[selection.field];
  return config.npcChannelExceptions[npcId]?.[selection.channelId] ?? '';
}

function setSelectionValue(
  config: ProjectOnePromptConfig,
  npcId: ProjectOneFivePersonId,
  selection: Selection,
  value: string,
): ProjectOnePromptConfig {
  const next = structuredClone(config);
  if (selection.kind === 'person') {
    next.npcRolePrompts[npcId] = { ...normalizeNpcRolePrompt(next.npcRolePrompts[npcId]), [selection.field]: value };
  } else {
    next.npcChannelExceptions[npcId] ??= {};
    next.npcChannelExceptions[npcId][selection.channelId] = value;
  }
  return next;
}

function getDefaultSelectionValue(npcId: ProjectOneFivePersonId, selection: Selection): string {
  return getSelectionValue(DEFAULT_PROJECT_ONE_PROMPT_CONFIG, npcId, selection);
}

function getChannelMenuLabel(channelId: ProjectOneChannelId): string {
  for (const group of CHANNEL_MENU_GROUPS) {
    const item = group.items.find((candidate) => candidate.id === channelId);
    if (item) return item.label;
  }
  return getChannel(channelId).label;
}

function getExcelScopeLabel(scope: PromptExcelRow['scope']): string {
  if (scope === 'channel') return '渠道补充';
  if (scope === 'role') return '人物总提示词';
  return PERSON_PROMPT_FIELDS.find(({ field }) => scope === `role_${field}`)?.label ?? '未知用途';
}

export default function PromptLibraryPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ProjectOnePromptConfig>(() => structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG));
  const [revision, setRevision] = useState(0);
  const [selectedNpcId, setSelectedNpcId] = useState<ProjectOneFivePersonId>('P1-001');
  const [selection, setSelection] = useState<Selection>({ kind: 'person', field: 'base' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [excelBusy, setExcelBusy] = useState<'export' | 'import' | null>(null);
  const [excelResult, setExcelResult] = useState<PromptExcelImportResult | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const selectedPerson = useMemo<Person>(
    () => PROJECT_ONE_FIVE_PERSON_NPCS[selectedNpcId],
    [selectedNpcId],
  );
  const selectedChannel = selection.kind === 'channel' ? getChannel(selection.channelId) : null;
  const thresholds = config.supportTierThresholds ?? DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS;
  const thresholdsValid = Number.isInteger(thresholds.mediumMin)
    && Number.isInteger(thresholds.highMin)
    && thresholds.mediumMin >= 1
    && thresholds.mediumMin <= 99
    && thresholds.highMin >= 2
    && thresholds.highMin <= 100
    && thresholds.highMin > thresholds.mediumMin;
  const value = getSelectionValue(config, selectedNpcId, selection);
  const defaultValue = getDefaultSelectionValue(selectedNpcId, selection);
  const exceptionConfigured = selection.kind === 'channel'
    && Object.prototype.hasOwnProperty.call(config.npcChannelExceptions[selectedNpcId] ?? {}, selection.channelId);

  useEffect(() => {
    const token = window.localStorage.getItem('weixun_session') || '';
    fetch('/api/designer/prompt-config', { headers: { 'x-session': token } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '读取失败');
        setConfig(body.config);
        setRevision(body.revision);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : '提示词读取失败'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch('/api/designer/prompt-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ expectedRevision: revision, config }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '保存失败');
      setConfig(body.config);
      setRevision(body.revision);
      const userId = getPromptTestUserId(window.localStorage.getItem('weixun_identity'));
      const draftKey = getPromptTestNpcPromptDraftStorageKey(userId);
      if (draftKey) window.localStorage.setItem(draftKey, JSON.stringify(body.config.promptTestNpcPrompt));
      setDirty(false);
      setNotice('已保存人物提示词配置。规则性配置仍由系统控制，未被此页面改写。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提示词保存失败');
    } finally {
      setSaving(false);
    }
  }

  function selectPerson(personId: ProjectOneFivePersonId) {
    setSelectedNpcId(personId);
    setNotice('');
  }

  function selectChannel(channelId: ProjectOneChannelId) {
    setSelection({ kind: 'channel', channelId });
    setNotice('');
  }

  function updateValue(nextValue: string) {
    setConfig((current) => setSelectionValue(current, selectedNpcId, selection, nextValue));
    setDirty(true);
    setNotice('');
  }

  function updateThreshold(field: 'mediumMin' | 'highMin', value: number) {
    if (!Number.isInteger(value)) return;
    setConfig((current) => ({
      ...current,
      supportTierThresholds: { ...(current.supportTierThresholds ?? DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS), [field]: value },
    }));
    setDirty(true);
    setNotice('');
  }

  function restoreDefault() {
    setConfig((current) => setSelectionValue(current, selectedNpcId, selection, defaultValue));
    setDirty(true);
    setNotice('已恢复当前项默认值，点击“保存全部”后生效。');
  }

  async function exportExcel() {
    setExcelBusy('export');
    setNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch('/api/designer/prompt-excel', { headers: { 'x-session': token } });
      if (!response.ok) throw new Error((await response.json())?.error || 'Excel 导出失败');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '项目一-人物提示词.xlsx';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已导出服务端当前保存的人物提示词。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Excel 导出失败');
    } finally {
      setExcelBusy(null);
    }
  }

  async function importExcel(file: File) {
    setExcelBusy('import');
    setExcelResult(null);
    setNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/designer/prompt-excel', { method: 'POST', headers: { 'x-session': token }, body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Excel 解析失败');
      setExcelResult(body as PromptExcelImportResult);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Excel 解析失败');
    } finally {
      setExcelBusy(null);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }

  function applyExcel() {
    const imported = excelResult?.editable;
    if (!excelResult?.ok || !imported) return;
    setConfig((current) => {
      const exceptions = structuredClone(current.npcChannelExceptions);
      for (const [npcId, channels] of Object.entries(imported.npcChannelExceptions)) {
        exceptions[npcId] = { ...exceptions[npcId], ...channels };
      }
      return {
        ...current,
        npcRolePrompts: { ...current.npcRolePrompts, ...imported.npcRolePrompts },
        npcChannelExceptions: exceptions,
      };
    });
    setDirty(true);
    setExcelResult(null);
    setNotice('已应用人物提示词到页面草稿，点击“保存全部”后生效。');
  }

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
          <button
            onClick={() => router.push('/designer')}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="返回游戏设计师"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">提示词设计</h1>
            <p className="mt-0.5 text-xs text-slate-500">为每个人物填写通用提示词，也可以补充邮件、微信等交流方式的专属表达。</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => void exportExcel()} disabled={loading || excelBusy !== null} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Download className="h-4 w-4" />{excelBusy === 'export' ? '导出中…' : '导出 Excel'}</button>
            <input ref={excelInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importExcel(file); }} />
            <button onClick={() => excelInputRef.current?.click()} disabled={loading || saving || excelBusy !== null} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Upload className="h-4 w-4" />{excelBusy === 'import' ? '解析中…' : '导入 Excel'}</button>
            <button
              onClick={() => router.push('/designer/dialogue-prompts')}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <FlaskConical className="h-4 w-4" />模型回复测试
            </button>
            <button
              onClick={() => void save()}
              disabled={loading || saving || excelBusy !== null || !dirty || !thresholdsValid}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-4 w-4" />{saving ? '保存中…' : '保存全部'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <p>这里编辑人物如何表达。身份、信息边界、评分和其他游戏规则由系统维护，导入 Excel 也不会修改这些规则。</p>
        </div>
        <section className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-sm" aria-label="支持度档位门槛">
          <div className="min-w-56"><div className="font-semibold text-slate-800">支持度档位门槛</div><p className="mt-1 leading-5 text-slate-500">由服务端确定人物使用低、中或高提示词；不会发送给生成模型。</p></div>
          <label className="grid gap-1 text-slate-600">中档起点<input type="number" min={1} max={99} step={1} value={thresholds.mediumMin} disabled={loading} onChange={(event) => updateThreshold('mediumMin', event.currentTarget.valueAsNumber)} className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-slate-900 outline-none focus:border-blue-500 disabled:opacity-50" /></label>
          <label className="grid gap-1 text-slate-600">高档起点<input type="number" min={2} max={100} step={1} value={thresholds.highMin} disabled={loading} onChange={(event) => updateThreshold('highMin', event.currentTarget.valueAsNumber)} className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-slate-900 outline-none focus:border-blue-500 disabled:opacity-50" /></label>
          <span className={thresholdsValid ? 'text-emerald-700' : 'text-rose-700'}>{thresholdsValid ? `低：0–${thresholds.mediumMin - 1}；中：${thresholds.mediumMin}–${thresholds.highMin - 1}；高：${thresholds.highMin}–100` : '高档起点必须大于中档起点。'}</span>
        </section>
        {notice && <div role="status" className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">{notice}</div>}
        {excelResult && <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-sm" aria-label="Excel 导入校验结果">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 font-semibold text-slate-800"><FileSpreadsheet className="h-4 w-4 text-blue-600" />{excelResult.ok ? `校验通过：${excelResult.rows.length} 项人物提示词` : `校验失败：${excelResult.errors.length} 个错误`}</div><button onClick={applyExcel} disabled={!excelResult.ok || saving || excelBusy !== null} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-40">应用到页面草稿</button></div>
          {excelResult.ok && <p className="mt-2 text-slate-500">校验通过后，点击“应用到页面草稿”查看覆盖结果，再点击“保存全部”使其生效。表格中未包含的渠道补充会保留。</p>}
          {dirty && excelResult.ok && <p className="mt-2 text-amber-700">应用会替换当前尚未保存的人物提示词修改。</p>}
          {excelResult.errors.length > 0 && <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto text-rose-700">{excelResult.errors.map((issue, index) => <li key={index}>{issue.row ? `第 ${issue.row} 行：` : ''}{issue.message}</li>)}</ul>}
          {(excelResult.warnings?.length ?? 0) > 0 && <div className="mt-3 text-amber-700"><p>以下多余字段已忽略，提示词正文未改动：</p><ul className="mt-1 max-h-28 space-y-1 overflow-y-auto">{excelResult.warnings?.map((issue, index) => <li key={index}>{issue.row ? `第 ${issue.row} 行：` : ''}{issue.message}</li>)}</ul></div>}
          {excelResult.ok && <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-left"><thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2">人物</th><th className="px-3 py-2">提示词用途</th><th className="px-3 py-2">交流方式</th><th className="px-3 py-2">内容预览</th></tr></thead><tbody>{excelResult.rows.map((row, index) => <tr key={index} className="border-t border-slate-100"><td className="px-3 py-2">{PROJECT_ONE_FIVE_PERSON_NPCS[row.npcId as ProjectOneFivePersonId]?.name ?? row.npcId}</td><td className="px-3 py-2">{getExcelScopeLabel(row.scope)}</td><td className="px-3 py-2">{row.scope === 'channel' ? getChannelMenuLabel(row.channelId as ProjectOneChannelId) : '—'}</td><td className="max-w-xl truncate px-3 py-2" title={row.prompt}>{row.prompt}</td></tr>)}</tbody></table></div>}
        </section>}

        <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[245px_225px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 lg:max-h-[calc(100vh-210px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">项目一</div>
                  <div className="mt-1 text-sm font-semibold text-slate-800">五人关键人物</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">{PEOPLE.length} 人</span>
              </div>
            </div>
            <nav className="p-3" aria-label="选择人物">
              <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">人物角色</div>
              <div className="space-y-1">
                {PEOPLE.map((person) => {
                  const active = person.id === selectedNpcId;
                  return (
                    <button
                      key={person.id}
                      onClick={() => selectPerson(person.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                      style={{ paddingLeft: `${10 + Math.max(0, person.displayLevel - 1) * 8}px` }}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{person.name.slice(0, 1)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{person.name} · {person.title}</span>
                        <span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-blue-100' : 'text-slate-400'}`}>{person.level}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </aside>

          <aside className="border-b border-slate-200 lg:max-h-[calc(100vh-210px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">提示词范围</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{selectedPerson.name} 的沟通场景</div>
            </div>
            <nav className="p-3" aria-label="选择提示词范围">
              <button
                onClick={() => { setSelection({ kind: 'person', field: 'base' }); setNotice(''); }}
                aria-current={selection.kind === 'person' ? 'true' : undefined}
                className={`mb-3 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${selection.kind === 'person' ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                <span>人物提示词</span>
                <span className={`text-[10px] ${selection.kind === 'person' ? 'text-blue-100' : 'text-slate-400'}`}>基础 + 三档</span>
              </button>
              <div className="mb-3 space-y-0.5 pl-3">
                {PERSON_PROMPT_FIELDS.map((item) => {
                  const active = selection.kind === 'person' && selection.field === item.field;
                  return <button key={item.field} onClick={() => { setSelection({ kind: 'person', field: item.field }); setNotice(''); }} aria-current={active ? 'true' : undefined} className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${active ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>{item.label}</button>;
                })}
              </div>

              <div className="space-y-4">
                {CHANNEL_MENU_GROUPS.map((group) => (
                  <section key={group.id}>
                    <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {group.items.length > 1 && <ChevronDown className="h-3 w-3" />}
                      <span>{group.label}</span>
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = selection.kind === 'channel' && selection.channelId === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => selectChannel(item.id)}
                            aria-current={active ? 'true' : undefined}
                            className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${active ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'} ${group.items.length > 1 ? 'pl-6' : ''}`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </nav>
          </aside>

          <section className="min-w-0 bg-white p-4 sm:p-5 lg:max-h-[calc(100vh-210px)] lg:overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-slate-900">{selectedPerson.name} · {selectedPerson.title}</h2>
                  <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">{selection.kind === 'person' ? PERSON_PROMPT_FIELDS.find((item) => item.field === selection.field)?.label : getChannelMenuLabel(selection.channelId)}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {selection.kind === 'person'
                    ? PERSON_PROMPT_FIELDS.find((item) => item.field === selection.field)?.hint
                    : `编辑该人物在“${getChannelMenuLabel(selection.channelId)}”中的专属补充；没有配置时可直接填写。`}
                </p>
                {(selection.kind === 'person' || (selection.kind === 'channel' && (selection.channelId === 'email' || selection.channelId === 'wechat'))) && (
                  <p className="mt-2 text-xs leading-5 text-blue-700">邮件和工作微信可以已读不回。如果想体现此人的处理习惯，可在这里写出偏好；系统仍会按对话内容判断，遇到合规红线会明确拒绝。</p>
                )}
              </div>
              <button
                onClick={restoreDefault}
                disabled={loading}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />恢复当前项默认值
              </button>
            </div>

            {selectedChannel ? <ReadOnlyChannelSummary channel={selectedChannel} modifier={config.channelModifiers[selectedChannel.id] ?? selectedChannel.modifier} /> : <ReadOnlyPersonSummary person={selectedPerson} />}

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3 text-[11px]">
                <div className="flex items-center gap-2 font-semibold text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {selection.kind === 'person' ? PERSON_PROMPT_FIELDS.find((item) => item.field === selection.field)?.label : `${getChannelMenuLabel(selection.channelId)} · 人物例外`}
                </div>
                <span className="text-slate-500">{selection.kind === 'channel' && !exceptionConfigured ? '未配置，输入后可新增' : '可编辑'}</span>
              </div>
              <textarea
                value={value}
                disabled={loading}
                onChange={(event) => updateValue(event.target.value)}
                className="min-h-[390px] w-full resize-y border-0 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:ring-2 focus:ring-inset focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[470px]"
                placeholder={loading ? '正在读取已保存配置…' : selection.kind === 'channel' ? '此人物暂无渠道例外，可直接输入补充提示词。' : '请输入人物提示词'}
                aria-label={`${selectedPerson.name} ${selection.kind === 'person' ? PERSON_PROMPT_FIELDS.find((item) => item.field === selection.field)?.label : getChannelMenuLabel(selection.channelId)}`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900 px-4 py-2 text-[10px] text-slate-500">
                <span>{value.length} 字</span>
                <span className={dirty ? 'text-amber-300' : 'text-emerald-400'}>{dirty ? '有尚未保存的修改' : '当前内容已保存'}</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ReadOnlyChannelSummary({ channel, modifier }: { channel: Channel; modifier: string }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <LockKeyhole className="h-3.5 w-3.5 text-slate-400" />系统渠道规则（只读）
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{channel.description} {modifier}</p>
      <div className="mt-3 grid gap-3 text-[11px] leading-5 sm:grid-cols-2">
        <div>
          <div className="font-semibold text-slate-500">沟通目标</div>
          <div className="mt-0.5 text-slate-700">{channel.goal}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-500">风险边界</div>
          <div className="mt-0.5 text-slate-700">{channel.risk}</div>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyPersonSummary({ person }: { person: Person }) {
  const personalityType = getProjectOnePersonalityType(person.personalityType);
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <LockKeyhole className="h-3.5 w-3.5 text-slate-400" />人物系统边界（只读）
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{person.organization}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
        <span className="rounded bg-white px-2 py-1">性格：{personalityType.displayName}</span>
        <span className="rounded bg-white px-2 py-1">类型 ID：{personalityType.id}</span>
        <span className="rounded bg-white px-2 py-1">DISC：{personalityType.disc}（{personalityType.discLabel}）</span>
        <span className="rounded bg-white px-2 py-1">层级：{person.level}</span>
        <span className="rounded bg-white px-2 py-1">渠道规则由系统叠加</span>
      </div>
      <div className="mt-3 grid gap-3 text-[11px] leading-5 text-slate-600 sm:grid-cols-2">
        <div><span className="font-semibold text-slate-500">沟通偏好：</span>{personalityType.communicationPreference}</div>
        <div><span className="font-semibold text-slate-500">正向触发：</span>{personalityType.positiveTriggers.join('；')}</div>
        <div><span className="font-semibold text-slate-500">负向触发：</span>{personalityType.negativeTriggers.join('；')}</div>
        <div><span className="font-semibold text-slate-500">信息披露倾向：</span>{personalityType.informationDisclosureTendency}</div>
        <div className="sm:col-span-2"><span className="font-semibold text-slate-500">默认风险反应：</span>{personalityType.defaultRiskResponse}</div>
      </div>
      <p className="mt-3 text-[10px] leading-5 text-amber-700">人物主档中的职务、诉求、信息边界、禁忌和状态节点规则优先于通用性格类型；此处只能作为表达风格参考。</p>
    </div>
  );
}
