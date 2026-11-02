'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BrainCircuit, CheckCircle2, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import {
  activityDecisionConfigSchema,
  CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
  ORGANIZATION_CUSTOMER_ACTIVITY_TYPES,
  CUSTOMER_ACTIVITY_TYPES,
  DEFAULT_ACTIVITY_DECISION_CONFIG,
  HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD,
  RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS,
  type ActivityDecisionConfig,
  type CustomerActivityOrganizationNpcId,
  type CustomerActivityType,
  type OrganizationActivityThreshold,
} from '@/lib/game/customer-activities';
import { PROJECT_ONE_FIVE_PERSON_NPCS } from '@/lib/designer/project-one-five-person';
import {
  buildOrganizationActivityThreshold,
  isEmptyOrganizationActivityThresholdForm,
  buildSingleCustomerActivityThreshold,
  parseCustomerActivityDecisionConfigWrite,
  parseCustomerActivityThreshold,
  type OrganizationActivityThresholdForm,
  type SingleCustomerActivityThresholdForm,
} from '@/lib/designer/customer-activity-decision-form';

type ActivityDecisionForm = {
  mode: ActivityDecisionConfig['mode'];
  thresholds: Record<CustomerActivityType, OrganizationActivityThresholdForm>;
  hospitality: SingleCustomerActivityThresholdForm;
};

const ACTIVITY_OPTIONS: Array<{ id: CustomerActivityType; label: string; description: string }> = [
  { id: 'technical_meeting', label: '技术交流会', description: '判断是否匹配与客户开展技术交流。' },
  { id: 'case_site_visit', label: '案例现场参观', description: '判断是否匹配参观已落地的客户案例现场。' },
  { id: 'company_visit', label: '客户参观我们公司', description: '判断是否匹配邀请客户到我方公司参观。' },
  { id: 'hospitality', label: '吃饭或喝酒邀约', description: '邀请目标客户共进餐叙或小酌。' },
];

const HOSPITALITY_RECOMMENDATION = HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD;

const NPC_OPTIONS = CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.map((id) => ({
  id,
  label: PROJECT_ONE_FIVE_PERSON_NPCS[id].name + ' · ' + PROJECT_ONE_FIVE_PERSON_NPCS[id].title,
}));

let nextFormKey = 0;
function formKey(prefix: string): string {
  nextFormKey += 1;
  return 'activity-' + prefix + '-' + nextFormKey;
}

function blankThresholdForm(): OrganizationActivityThresholdForm {
  return { minimumPleasantness: '', paths: [] };
}

function blankCondition() {
  return { id: formKey('condition'), npcIds: [] as CustomerActivityOrganizationNpcId[], minCount: '1', supportMin: '', pleasantnessMin: '' };
}

function recommendedThresholdForm(threshold: OrganizationActivityThreshold): OrganizationActivityThresholdForm {
  return {
    minimumPleasantness: String(threshold.minimumPleasantness),
    paths: threshold.paths.map((path) => ({
      id: path.id,
      label: path.label,
      conditions: path.conditions.map((condition) => ({
        id: formKey('condition'),
        npcIds: [...condition.npcIds],
        minCount: String(condition.minCount),
        supportMin: String(condition.supportMin),
        pleasantnessMin: String(condition.pleasantnessMin),
      })),
    })),
  };
}

function emptyForm(mode: ActivityDecisionForm['mode'] = DEFAULT_ACTIVITY_DECISION_CONFIG.mode): ActivityDecisionForm {
  return {
    mode,
    thresholds: Object.fromEntries(CUSTOMER_ACTIVITY_TYPES.map((type) => [type, blankThresholdForm()])) as Record<CustomerActivityType, OrganizationActivityThresholdForm>,
    hospitality: { supportMin: String(HOSPITALITY_RECOMMENDATION.supportMin), pleasantnessMin: String(HOSPITALITY_RECOMMENDATION.pleasantnessMin) },
  };
}

function recommendedForm(mode: ActivityDecisionForm['mode']): ActivityDecisionForm {
  return {
    mode,
    thresholds: Object.fromEntries(CUSTOMER_ACTIVITY_TYPES.map((type) => [
      type,
      type === 'hospitality' ? blankThresholdForm() : recommendedThresholdForm(RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[type]),
    ])) as ActivityDecisionForm['thresholds'],
    hospitality: { supportMin: String(HOSPITALITY_RECOMMENDATION.supportMin), pleasantnessMin: String(HOSPITALITY_RECOMMENDATION.pleasantnessMin) },
  };
}

function thresholdFormFromConfig(threshold?: ActivityDecisionConfig['thresholds'][CustomerActivityType]): OrganizationActivityThresholdForm {
  if (!threshold?.organization) return blankThresholdForm();
  return {
    minimumPleasantness: String(threshold.organization.minimumPleasantness),
    paths: threshold.organization.paths.map((path) => ({
      id: path.id,
      label: path.label,
      conditions: path.conditions.map((condition) => ({
        id: formKey('condition'),
        npcIds: [...condition.npcIds],
        minCount: String(condition.minCount),
        supportMin: String(condition.supportMin),
        pleasantnessMin: String(condition.pleasantnessMin),
      })),
    })),
  };
}

function formFromConfig(config: ActivityDecisionConfig): ActivityDecisionForm {
  return {
    mode: config.mode,
    thresholds: Object.fromEntries(CUSTOMER_ACTIVITY_TYPES.map((type) => [
      type,
      thresholdFormFromConfig(config.thresholds[type]),
    ])) as Record<CustomerActivityType, OrganizationActivityThresholdForm>,
    hospitality: {
      supportMin: String(config.thresholds.hospitality?.supportMin ?? HOSPITALITY_RECOMMENDATION.supportMin),
      pleasantnessMin: String(config.thresholds.hospitality?.pleasantnessMin ?? HOSPITALITY_RECOMMENDATION.pleasantnessMin),
    },
  };
}

function configHasOrganizationRules(config: ActivityDecisionConfig): boolean {
  return ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.some((type) => Boolean(config.thresholds[type]?.organization));
}

function configHasLegacyRules(config: ActivityDecisionConfig): boolean {
  return ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.some((type) => {
    const threshold = config.thresholds[type];
    return Boolean(threshold && !threshold.organization
      && (threshold.supportMin !== undefined || threshold.pleasantnessMin !== undefined));
  });
}

function buildThresholds(
  form: ActivityDecisionForm,
  config: ActivityDecisionConfig | null,
): ActivityDecisionConfig['thresholds'] | null {
  const thresholds: ActivityDecisionConfig['thresholds'] = {};
  const hospitality = buildSingleCustomerActivityThreshold(form.hospitality);
  if (!hospitality) return null;
  thresholds.hospitality = hospitality;
  for (const activity of ORGANIZATION_CUSTOMER_ACTIVITY_TYPES) {
    const thresholdForm = form.thresholds[activity];
    if (isEmptyOrganizationActivityThresholdForm(thresholdForm)) {
      const legacy = config?.thresholds[activity];
      if (form.mode === 'ai' && legacy && !legacy.organization
        && (legacy.supportMin !== undefined || legacy.pleasantnessMin !== undefined)) {
        thresholds[activity] = {
          ...(legacy.supportMin === undefined ? {} : { supportMin: legacy.supportMin }),
          ...(legacy.pleasantnessMin === undefined ? {} : { pleasantnessMin: legacy.pleasantnessMin }),
        };
      }
      continue;
    }
    const organization = buildOrganizationActivityThreshold(thresholdForm);
    if (!organization) return null;
    thresholds[activity] = { organization };
  }
  const parsed = activityDecisionConfigSchema.safeParse({ revision: 0, mode: form.mode, thresholds });
  if (!parsed.success) return null;
  if (form.mode === 'numeric' && ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.some((type) => !parsed.data.thresholds[type]?.organization)) return null;
  return parsed.data.thresholds;
}

function sessionHeaders(): Record<string, string> {
  return { 'x-session': window.localStorage.getItem('weixun_session') || '' };
}

function numberInputValid(value: string): boolean {
  return value.trim() === '' || parseCustomerActivityThreshold(value) !== null;
}

function pathDistinctNpcCount(path: OrganizationActivityThresholdForm['paths'][number]): number {
  return new Set(path.conditions.flatMap((condition) => condition.npcIds)).size;
}

export default function CustomerActivitiesSettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ActivityDecisionConfig | null>(null);
  const [form, setForm] = useState<ActivityDecisionForm>(() => emptyForm());
  const [savedForm, setSavedForm] = useState<ActivityDecisionForm>(() => emptyForm());
  const [persisted, setPersisted] = useState(false);
  const [recommendationDraft, setRecommendationDraft] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<CustomerActivityType>(CUSTOMER_ACTIVITY_TYPES[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'error' | 'success' | 'conflict'>('error');
  const [conflict, setConflict] = useState(false);

  const dirty = useMemo(() => !persisted || JSON.stringify(form) !== JSON.stringify(savedForm), [form, persisted, savedForm]);
  const thresholds = buildThresholds(form, config);
  const organizationThresholdsComplete = ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.every((type) => (
    buildOrganizationActivityThreshold(form.thresholds[type]) !== null
  ));
  const hospitalityThresholdComplete = buildSingleCustomerActivityThreshold(form.hospitality) !== null;
  const numericModeAvailable = organizationThresholdsComplete;
  const invalidThreshold = thresholds === null;
  const saveDisabled = loading || saving || !dirty || !config || conflict || invalidThreshold
    || !hospitalityThresholdComplete
    || (form.mode === 'numeric' && !organizationThresholdsComplete);
  const selectedThreshold = form.thresholds[selectedActivity];
  const legacyRows = config ? ACTIVITY_OPTIONS.filter((activity) => activity.id !== 'hospitality').flatMap((activity) => {
    const threshold = config.thresholds[activity.id];
    if (!threshold || threshold.organization
      || (threshold.supportMin === undefined && threshold.pleasantnessMin === undefined)) return [];
    return [{ ...activity, supportMin: threshold.supportMin, pleasantnessMin: threshold.pleasantnessMin }];
  }) : [];

  async function loadConfig() {
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/designer/customer-activities', {
        headers: sessionHeaders(),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => ({}));
      const rawConfig = body && typeof body === 'object' ? (body as { config?: unknown }).config : undefined;
      if (!response.ok) {
        const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : '客户活动判定配置读取失败。';
        throw new Error(message);
      }
      const parsed = activityDecisionConfigSchema.safeParse(rawConfig);
      if (!parsed.success) throw new Error('服务端返回的客户活动判定配置格式无效。');
      const nextConfig = parsed.data;
      const saved = formFromConfig(nextConfig);
      const noOrganization = !configHasOrganizationRules(nextConfig);
      const hasPersistedRow = Boolean(body && typeof body === 'object' && (body as { persisted?: unknown }).persisted === true);
      const showRecommendations = noOrganization && (nextConfig.mode === 'ai' || configHasLegacyRules(nextConfig));
      const nextForm = showRecommendations
        ? { ...recommendedForm(nextConfig.mode), hospitality: saved.hospitality }
        : saved;
      setConfig(nextConfig);
      setPersisted(hasPersistedRow);
      setForm(nextForm);
      setSavedForm(saved);
      setRecommendationDraft(showRecommendations || !hasPersistedRow);
      setConflict(false);
      setSelectedActivity(CUSTOMER_ACTIVITY_TYPES[0]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '客户活动判定配置读取失败。');
      setNoticeKind('error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  function markEdited() {
    setRecommendationDraft(false);
    setNotice('');
  }

  function updateMode(mode: ActivityDecisionForm['mode']) {
    if (mode === 'numeric' && !numericModeAvailable) return;
    setForm((current) => ({ ...current, mode }));
    markEdited();
  }

  function updateSelectedThreshold(update: (current: OrganizationActivityThresholdForm) => OrganizationActivityThresholdForm) {
    setForm((current) => ({
      ...current,
      thresholds: { ...current.thresholds, [selectedActivity]: update(current.thresholds[selectedActivity]) },
    }));
    markEdited();
  }

  function updatePath(pathId: string, update: (path: OrganizationActivityThresholdForm['paths'][number]) => OrganizationActivityThresholdForm['paths'][number]) {
    updateSelectedThreshold((current) => ({
      ...current,
      paths: current.paths.map((path) => path.id === pathId ? update(path) : path),
    }));
  }

  function updateCondition(pathId: string, conditionId: string, update: (condition: OrganizationActivityThresholdForm['paths'][number]['conditions'][number]) => OrganizationActivityThresholdForm['paths'][number]['conditions'][number]) {
    updatePath(pathId, (path) => ({
      ...path,
      conditions: path.conditions.map((condition) => condition.id === conditionId ? update(condition) : condition),
    }));
  }

  function fillRecommendedThresholds() {
    setForm((current) => ({
      ...current,
      thresholds: Object.fromEntries(CUSTOMER_ACTIVITY_TYPES.map((type) => [
        type,
        type === 'hospitality' ? blankThresholdForm() : recommendedThresholdForm(RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[type]),
      ])) as Record<CustomerActivityType, OrganizationActivityThresholdForm>,
      hospitality: { supportMin: String(HOSPITALITY_RECOMMENDATION.supportMin), pleasantnessMin: String(HOSPITALITY_RECOMMENDATION.pleasantnessMin) },
    }));
    setRecommendationDraft(false);
    setNotice('推荐门槛已填入本地草稿；请逐项审核后保存。');
    setNoticeKind('success');
  }

  async function save() {
    if (!config || saveDisabled || !thresholds) return;
    const writeConfig = parseCustomerActivityDecisionConfigWrite({ mode: form.mode, thresholds });
    if (!writeConfig) {
      setNotice('请完整配置吃饭或喝酒邀约的单人门槛；数值模式还要求三项组织活动规则完整。');
      setNoticeKind('error');
      return;
    }
    setSaving(true);
    setNotice('');
    setConflict(false);
    try {
      const response = await fetch('/api/designer/customer-activities', {
        method: 'PUT',
        headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: config.revision, config: writeConfig }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : '客户活动判定配置保存失败。';
      if (response.status === 409) {
        setConflict(true);
        setNotice(message + ' 当前草稿仍保留，可重新读取后再修改。');
        setNoticeKind('conflict');
        return;
      }
      if (!response.ok) throw new Error(message);
      const nextConfig = activityDecisionConfigSchema.safeParse(body && typeof body === 'object' ? (body as { config?: unknown }).config : undefined);
      if (!nextConfig.success) throw new Error('服务端未返回有效的已保存配置。');
      const nextForm = formFromConfig(nextConfig.data);
      setConfig(nextConfig.data);
      setPersisted(!(body && typeof body === 'object' && (body as { persisted?: unknown }).persisted === false));
      setForm(nextForm);
      setSavedForm(structuredClone(nextForm));
      setRecommendationDraft(false);
      setNotice('客户活动判定配置已保存。');
      setNoticeKind('success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '客户活动判定配置保存失败。');
      setNoticeKind('error');
    } finally {
      setSaving(false);
    }
  }

  const currentPathComplete = selectedActivity === 'hospitality' || selectedThreshold.paths.every((path) => (
    path.label.trim() !== ''
    && path.conditions.length > 0
    && pathDistinctNpcCount(path) >= 2
    && path.conditions.every((condition) => (
      condition.npcIds.length > 0
      && parseCustomerActivityThreshold(condition.minCount) !== null
      && Number(condition.minCount) <= condition.npcIds.length
      && parseCustomerActivityThreshold(condition.supportMin) !== null
      && parseCustomerActivityThreshold(condition.pleasantnessMin) !== null
    ))
  ));
  const currentThresholdHasInvalidInput = selectedActivity !== 'hospitality' && (!numberInputValid(selectedThreshold.minimumPleasantness)
    || selectedThreshold.paths.some((path) => path.conditions.some((condition) => (
      !numberInputValid(condition.minCount) || !numberInputValid(condition.supportMin) || !numberInputValid(condition.pleasantnessMin)
    ))));

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
          <button type="button" onClick={() => router.push('/designer')} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-label="返回设计师工作台">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><BrainCircuit className="h-5 w-5" /></span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">客户活动匹配设置</h1>
              <p className="mt-0.5 text-xs text-slate-500">配置技术交流、参观和吃饭或喝酒邀约的判定方式。</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className={'mr-1 text-xs font-medium ' + (loading || !config ? 'text-slate-500' : saving || dirty ? 'text-amber-700' : 'text-emerald-700')} role="status">
              {loading ? '正在读取配置…' : !config ? '尚未读取配置' : saving ? '正在保存修改…' : recommendationDraft ? '推荐门槛仅为草稿，尚未保存' : dirty ? '有尚未保存的修改' : persisted ? '当前内容已保存' : '默认推荐值尚未保存'}
            </span>
            <button type="button" onClick={() => void loadConfig()} disabled={loading || saving || (dirty && !conflict && !recommendationDraft)} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw className="h-4 w-4" />重新读取
            </button>
            <button type="button" onClick={() => void save()} disabled={saveDisabled} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
              <Save className="h-4 w-4" />{saving ? '保存中…' : '保存设置'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <p>活动在对话结束后匹配。技术交流和参观活动按冻结的五人客户状态检查组织门槛；吃饭或喝酒邀约只检查本次目标客户，支持度与愉悦度同时达到各自下限即可，并始终采用数值门槛。客户主动提出的吃饭或喝酒邀约需要销售确认后再进入策划。</p>
        </div>

        {recommendationDraft && config && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950" role="status">
          当前表格展示的是推荐门槛草稿，尚未写入服务端。请检查三项组织活动规则和单联系人邀约门槛，再选择匹配方式并保存。
        </div>}
        {legacyRows.length > 0 && <section className="mb-5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950" aria-labelledby="legacy-threshold-heading">
          <h2 id="legacy-threshold-heading" className="font-semibold">已保存的旧版单联系人门槛（只读）</h2>
          <p className="mt-1 text-xs leading-5">旧的单联系人规则仅供查看，不用于三项组织活动的数值判定。吃饭或喝酒邀约始终按目标客户的单人门槛判断。</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {legacyRows.map((row) => <span key={row.id}>{row.label}：支持度 {row.supportMin ?? '未设'}，愉悦度 {row.pleasantnessMin ?? '未设'}</span>)}
          </div>
        </section>}

        {notice && <div role={noticeKind === 'error' ? 'alert' : 'status'} className={'mb-5 rounded-xl border px-4 py-3 text-sm ' + (noticeKind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : noticeKind === 'conflict' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-rose-200 bg-rose-50 text-rose-900')}>
          <div className="flex flex-wrap items-center justify-between gap-3"><span>{notice}</span>{conflict && <button type="button" onClick={() => void loadConfig()} className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100">重新读取最新版本</button>}</div>
        </div>}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">正在读取活动判定配置…</div>
        ) : !config ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600"><p>配置暂时无法读取。</p><button type="button" onClick={() => void loadConfig()} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white">重试</button></div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="activity-decision-mode">
              <div className="mb-4">
                <h2 id="activity-decision-mode" className="text-sm font-semibold text-slate-900">活动匹配方式</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">选择在本次对话结束后判断是否创建活动策划任务的方式。</p>
              </div>
              <fieldset disabled={loading || saving} className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">活动匹配方式</legend>
                <label className={'cursor-pointer rounded-xl border p-4 transition-colors ' + (form.mode === 'ai' ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="radio" name="activity-decision-mode" value="ai" checked={form.mode === 'ai'} onChange={() => updateMode('ai')} className="sr-only" />
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">AI 综合判断</span>{form.mode === 'ai' && <CheckCircle2 className="h-4 w-4 text-emerald-700" />}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">结合销售提议、客户回应和对话结束时的状态判断三项组织活动；吃饭或喝酒邀约始终走目标客户单人门槛。</span>
                </label>
                <label className={'rounded-xl border p-4 ' + (!numericModeAvailable ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70' : 'cursor-pointer ' + (form.mode === 'numeric' ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300'))}>
                  <input type="radio" name="activity-decision-mode" value="numeric" checked={form.mode === 'numeric'} disabled={!numericModeAvailable || loading || saving} onChange={() => updateMode('numeric')} className="sr-only" />
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">数值门槛</span>{form.mode === 'numeric' && <CheckCircle2 className="h-4 w-4 text-emerald-700" />}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">三项组织活动采用五人团队门槛；吃饭或喝酒邀约始终按目标客户的支持度和愉悦度判断。</span>
                  {!numericModeAvailable && <span className="mt-2 block text-[11px] font-medium text-amber-800">请先完整填写三项组织活动的团队规则。</span>}
                </label>
              </fieldset>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="organization-thresholds-heading">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="organization-thresholds-heading" className="text-sm font-semibold text-slate-900">活动数值门槛</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">组织活动分别设置团队规则；吃饭或喝酒邀约设置目标客户单人门槛。数值范围均为 0–100 整数。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">当前版本 v{config.revision}</span>
                  <button type="button" onClick={fillRecommendedThresholds} disabled={loading || saving} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />填入推荐门槛</button>
                </div>
              </div>

              <div role="tablist" aria-label="选择要编辑的活动" className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {ACTIVITY_OPTIONS.map((activity) => {
                  const complete = activity.id === 'hospitality'
                    ? hospitalityThresholdComplete
                    : buildOrganizationActivityThreshold(form.thresholds[activity.id]) !== null;
                  const selected = selectedActivity === activity.id;
                  return <button key={activity.id} type="button" role="tab" aria-selected={selected} onClick={() => setSelectedActivity(activity.id)} className={'rounded-xl border px-3 py-3 text-left transition-colors ' + (selected ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300')}>
                    <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{activity.label}</span><span className={'text-[10px] font-semibold ' + (complete ? 'text-emerald-700' : 'text-amber-800')}>{complete ? '已配置' : '待补充'}</span></span>
                    <span className="mt-1 block text-[11px] leading-4 text-slate-500">{activity.description}</span>
                  </button>;
                })}
              </div>

              {selectedActivity === 'hospitality' ? <div role="tabpanel" aria-label="吃饭或喝酒邀约" className="space-y-4">
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
                  只检查当前被邀约客户在本次对话结束时的数值。支持度和愉悦度都达到下限后，弹出策划窗口；全局 AI/数值匹配方式不会改变这项规则。
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <span><strong className="block text-sm text-slate-900">目标客户支持度下限</strong><span className="mt-1 block text-xs leading-5 text-slate-600">支持度达到或超过此值。</span></span>
                    <input type="number" min={0} max={100} step={1} inputMode="numeric" value={form.hospitality.supportMin} onChange={(event) => { setForm((current) => ({ ...current, hospitality: { ...current.hospitality, supportMin: event.target.value } })); markEdited(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label="吃饭或喝酒邀约支持度下限" />
                  </label>
                  <label className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <span><strong className="block text-sm text-slate-900">目标客户愉悦度下限</strong><span className="mt-1 block text-xs leading-5 text-slate-600">愉悦度达到或超过此值。</span></span>
                    <input type="number" min={0} max={100} step={1} inputMode="numeric" value={form.hospitality.pleasantnessMin} onChange={(event) => { setForm((current) => ({ ...current, hospitality: { ...current.hospitality, pleasantnessMin: event.target.value } })); markEdited(); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label="吃饭或喝酒邀约愉悦度下限" />
                  </label>
                </div>
                {!hospitalityThresholdComplete && <p className="text-xs text-rose-700" role="alert">支持度和愉悦度下限都必须为 0–100 的整数。</p>}
              </div> : <div role="tabpanel" aria-label={ACTIVITY_OPTIONS.find((item) => item.id === selectedActivity)?.label} className="space-y-4">
                <label className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
                  <span><strong className="block text-sm text-slate-900">全体最低愉悦度</strong><span className="mt-1 block text-xs leading-5 text-slate-600">五名联系人都必须达到此值，才会继续检查下方候选路径。</span></span>
                  <input type="number" min={0} max={100} step={1} inputMode="numeric" value={selectedThreshold.minimumPleasantness} onChange={(event) => updateSelectedThreshold((current) => ({ ...current, minimumPleasantness: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label="全体最低愉悦度" />
                </label>
                {selectedThreshold.minimumPleasantness !== '' && parseCustomerActivityThreshold(selectedThreshold.minimumPleasantness) === null && <p className="text-xs text-rose-700" role="alert">全体最低愉悦度需为 0–100 的整数。</p>}

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-sm font-semibold text-slate-900">候选路径</h3><p className="mt-1 text-xs leading-5 text-slate-500">任一条路径成立即可；同一条路径中的每项条件都必须成立。</p></div>
                  <button type="button" onClick={() => updateSelectedThreshold((current) => ({ ...current, paths: [...current.paths, { id: formKey('path'), label: '新路径', conditions: [blankCondition()] }] }))} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />添加路径</button>
                </div>

                {selectedThreshold.paths.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500">尚未设置路径。数值门槛模式至少需要一条路径。</div>}
                <div className="space-y-4">
                  {selectedThreshold.paths.map((path, pathIndex) => {
                    const distinctNpcCount = pathDistinctNpcCount(path);
                    return <section key={path.id} className="rounded-2xl border border-slate-200 p-4 sm:p-5" aria-label={'路径 ' + (pathIndex + 1)}>
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-700">路径名称</span><input value={path.label} maxLength={160} onChange={(event) => updatePath(path.id, (current) => ({ ...current, label: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label={'路径 ' + (pathIndex + 1) + ' 名称'} /></label>
                          <span className="mt-1 block text-[10px] text-slate-500">备选方案之一 · 涉及 {distinctNpcCount} 位不同联系人</span>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => updatePath(path.id, (current) => ({ ...current, conditions: [...current.conditions, blankCondition()] }))} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />添加条件</button>
                          <button type="button" aria-label={'删除路径 ' + (pathIndex + 1)} disabled={selectedThreshold.paths.length <= 1} onClick={() => updateSelectedThreshold((current) => ({ ...current, paths: current.paths.filter((item) => item.id !== path.id) }))} className="rounded-lg border border-rose-200 p-2 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {path.conditions.map((condition, conditionIndex) => {
                          const countInvalid = parseCustomerActivityThreshold(condition.minCount) === null || Number(condition.minCount) < 1 || Number(condition.minCount) > condition.npcIds.length;
                          const valueInvalid = parseCustomerActivityThreshold(condition.supportMin) === null || parseCustomerActivityThreshold(condition.pleasantnessMin) === null;
                          return <div key={condition.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                            <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-slate-800">条件 {conditionIndex + 1}</h4><button type="button" aria-label={'删除路径 ' + (pathIndex + 1) + ' 条件 ' + (conditionIndex + 1)} disabled={path.conditions.length <= 1} onClick={() => updatePath(path.id, (current) => ({ ...current, conditions: current.conditions.filter((item) => item.id !== condition.id) }))} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div>
                            <fieldset className="mb-3">
                              <legend className="mb-2 text-[11px] font-semibold text-slate-700">选择本条件适用的联系人（条件之间可以重复选择）</legend>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {NPC_OPTIONS.map((npc) => {
                                  const checked = condition.npcIds.includes(npc.id);
                                  return <label key={npc.id} className={'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ' + (checked ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-slate-200 bg-white text-slate-700')}>
                                    <input type="checkbox" checked={checked} onChange={(event) => updateCondition(path.id, condition.id, (current) => ({
                                      ...current,
                                      npcIds: event.target.checked
                                        ? [...current.npcIds, npc.id]
                                        : current.npcIds.filter((id) => id !== npc.id),
                                    }))} />
                                    <span>{npc.label}</span>
                                  </label>;
                                })}
                              </div>
                              {condition.npcIds.length === 0 && <p className="mt-2 text-[11px] text-rose-700" role="alert">至少选择一名联系人。</p>}
                            </fieldset>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-600">达到条件的最少人数</span><input type="number" min={1} max={Math.max(1, condition.npcIds.length)} step={1} inputMode="numeric" value={condition.minCount} onChange={(event) => updateCondition(path.id, condition.id, (current) => ({ ...current, minCount: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label={'路径 ' + (pathIndex + 1) + ' 条件 ' + (conditionIndex + 1) + ' 最少人数'} /></label>
                              <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-600">支持度下限</span><input type="number" min={0} max={100} step={1} inputMode="numeric" value={condition.supportMin} onChange={(event) => updateCondition(path.id, condition.id, (current) => ({ ...current, supportMin: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label={'路径 ' + (pathIndex + 1) + ' 条件 ' + (conditionIndex + 1) + ' 支持度下限'} /></label>
                              <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-600">愉悦度下限</span><input type="number" min={0} max={100} step={1} inputMode="numeric" value={condition.pleasantnessMin} onChange={(event) => updateCondition(path.id, condition.id, (current) => ({ ...current, pleasantnessMin: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" aria-label={'路径 ' + (pathIndex + 1) + ' 条件 ' + (conditionIndex + 1) + ' 愉悦度下限'} /></label>
                            </div>
                            {countInvalid && <p className="mt-2 text-[11px] text-rose-700" role="alert">最少人数必须为 1 到已选联系人数之间的整数。</p>}
                            {valueInvalid && <p className="mt-2 text-[11px] text-rose-700" role="alert">支持度与愉悦度下限必须为 0–100 的整数。</p>}
                            <p className="mt-3 text-[10px] leading-4 text-slate-500">此条件表示：所选联系人中，至少达到指定人数的人，其支持度和愉悦度都达到下限。</p>
                          </div>;
                        })}
                      </div>
                      {distinctNpcCount < 2 && <p className="mt-3 text-xs text-rose-700" role="alert">每条路径至少要涉及两位不同联系人；人数不足的路径无法通过组织团队判定。</p>}
                      {path.conditions.length === 0 && <p className="mt-3 text-xs text-rose-700" role="alert">此路径至少需要一个条件。</p>}
                      <p className="mt-3 text-[11px] font-medium text-slate-600">这条路径中的每项条件都必须满足。</p>
                    </section>;
                  })}
                </div>

                {!currentPathComplete && selectedThreshold.paths.length > 0 && <p className="text-xs text-rose-700" role="alert">当前活动仍有未完成或无效的路径；请填写人员、人数及门槛后保存。</p>}
                {currentThresholdHasInvalidInput && <p className="text-xs text-rose-700" role="alert">数值需为 0–100 的整数。</p>}
                {form.mode === 'numeric' && !organizationThresholdsComplete && <p className="text-xs text-rose-700" role="alert">数值门槛模式要求三项活动各自设置全体最低愉悦度，并至少配置一条完整团队路径。</p>}
              </div>}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
