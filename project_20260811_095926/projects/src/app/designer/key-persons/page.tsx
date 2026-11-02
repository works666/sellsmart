'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit2, FileSpreadsheet, Save, X, Users, GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  PROJECT_ONE_FIVE_PERSON_NPCS,
  PROJECT_ONE_FIVE_PERSON_IDS,
  type ProjectOneCategory,
  type ProjectOneHierarchy,
  type ProjectOneVisitTask,
} from '@/lib/designer/project-one-five-person';
import {
  getProjectOnePersonalityType,
  PROJECT_ONE_PERSONALITY_TYPE_LIST,
  toProjectOnePersonalityTypeId,
  type ProjectOnePersonalityTypeId,
} from '@/lib/designer/personality-types';

type EditablePerson = {
  id: string;
  name: string;
  title: string;
  category: ProjectOneCategory;
  level: ProjectOneHierarchy;
  parentId: string | null;
  displayLevel: number;
  displayOrder: number;
  organization: string;
  personalityType: ProjectOnePersonalityTypeId;
  personality: string;
  coreNeeds: string[];
  facts: string[];
  clues: string[];
  informationBoundary: string[];
  memoryFocus: string[];
  taboos: string[];
  allowedTasks: ProjectOneVisitTask[];
};

type PersonDraft = EditablePerson;

const LIST_FIELDS: Array<{ key: keyof Pick<PersonDraft, 'coreNeeds' | 'facts' | 'clues' | 'informationBoundary' | 'memoryFocus' | 'taboos'>; label: string; hint: string }> = [
  { key: 'coreNeeds', label: '核心诉求', hint: '每行一项' },
  { key: 'facts', label: '公开事实', hint: '玩家可逐步查看的公开事实，每行一项' },
  { key: 'clues', label: '可匹配披露线索', hint: '按计划关键词匹配披露，每行一项' },
  { key: 'informationBoundary', label: '信息边界', hint: '不得越过的披露边界，每行一项' },
  { key: 'memoryFocus', label: '记忆重点', hint: '需要写入或召回的长期重点，每行一项' },
  { key: 'taboos', label: '禁忌', hint: '触发后应拒绝、降级或阻断的行为，每行一项' },
];

const initialPersons = PROJECT_ONE_FIVE_PERSON_IDS
  .map((id) => PROJECT_ONE_FIVE_PERSON_NPCS[id])
  .sort((left, right) => left.displayLevel - right.displayLevel || left.displayOrder - right.displayOrder)
  .map((person): EditablePerson => ({
    id: person.id,
    name: person.name,
    title: person.title,
    category: person.category,
    level: person.level,
    parentId: person.parentId,
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
  }));

function listText(items: readonly string[]): string {
  return items.join('\n');
}

function parseList(value: string): string[] {
  return value
    .split(/[\r\n；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function roleTone(level: ProjectOneHierarchy): string {
  if (level === '高层') return 'bg-error/10 text-error';
  if (level === '中层') return 'bg-warning/10 text-warning';
  return 'bg-primary/10 text-primary';
}

export default function KeyPersonsPage() {
  const router = useRouter();
  const [persons, setPersons] = useState<EditablePerson[]>(initialPersons);
  const [importNotice, setImportNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonDraft | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem('weixun_designer_excel_import:key-persons');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { importedAt?: string; rows?: EditablePerson[] };
      if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return;
      setPersons(parsed.rows.map((person) => ({
        ...person,
        personalityType: toProjectOnePersonalityTypeId(person.personalityType) ?? 'tiger',
        parentId: person.parentId || null,
        coreNeeds: [...(person.coreNeeds || [])],
        facts: [...(person.facts || [])],
        clues: [...(person.clues || [])],
        informationBoundary: [...(person.informationBoundary || [])],
        memoryFocus: [...(person.memoryFocus || [])],
        taboos: [...(person.taboos || [])],
        allowedTasks: [...(person.allowedTasks || [])],
      })));
      setImportNotice(`已载入 Excel 草稿，共 ${parsed.rows.length} 位人物。`);
    } catch {
      setImportNotice('Excel 草稿读取失败，请重新上传。');
    }
  }, []);

  const parentName = (parentId: string | null): string => {
    if (!parentId) return '顶层节点';
    return persons.find((person) => person.id === parentId)?.name ?? parentId;
  };

  const handleEdit = (person: EditablePerson) => {
    setEditingId(person.id);
    setDraft({
      ...person,
      coreNeeds: [...person.coreNeeds],
      facts: [...person.facts],
      clues: [...person.clues],
      informationBoundary: [...person.informationBoundary],
      memoryFocus: [...person.memoryFocus],
      taboos: [...person.taboos],
      allowedTasks: [...person.allowedTasks],
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setDraft(null);
  };

  const handleSave = () => {
    if (!draft || !draft.name.trim() || !draft.title.trim()) return;
    const next = {
      ...draft,
      name: draft.name.trim(),
      title: draft.title.trim(),
      organization: draft.organization.trim(),
      personality: draft.personality.trim(),
      coreNeeds: draft.coreNeeds.filter(Boolean),
      facts: draft.facts.filter(Boolean),
      clues: draft.clues.filter(Boolean),
      informationBoundary: draft.informationBoundary.filter(Boolean),
      memoryFocus: draft.memoryFocus.filter(Boolean),
      taboos: draft.taboos.filter(Boolean),
    };
    setPersons((current) => current.map((person) => person.id === next.id ? next : person));
    handleCancel();
  };

  const updateDraft = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const toggleTask = (task: ProjectOneVisitTask) => {
    if (!draft) return;
    const allowedTasks = draft.allowedTasks.includes(task)
      ? draft.allowedTasks.filter((item) => item !== task)
      : [...draft.allowedTasks, task];
    updateDraft('allowedTasks', allowedTasks);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center gap-4 border-b border-border bg-card px-6">
        <button
          onClick={() => router.push('/designer')}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20"
          aria-label="返回设计师工作台"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">项目一·五人关键人主档</h1>
          <p className="text-xs text-muted-foreground">支持 Excel 模板导出和校验导入；当前编辑与导入结果保存为浏览器草稿。</p>
        </div>
        <button onClick={() => router.push('/designer/data-import-export')} className="ml-auto flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"><FileSpreadsheet className="h-4 w-4" />Excel 导入导出</button>
      </header>

      <main className="space-y-5 p-6">
        {importNotice && <div role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{importNotice}</div>}
        <section className="rounded-xl border border-primary/15 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Users className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold text-foreground">五人组织关系</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                人物 ID、上级关系和展示层级来自新版人物主档。公开事实、线索、核心诉求、边界与禁忌供设计和提示词分层使用；个人敏感字段不在新版主档页面展示。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {persons.map((person) => (
            <article key={person.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{person.name.slice(0, 1)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-foreground">{person.name}</h2>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{person.id}</code>
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${roleTone(person.level)}`}>{person.level} · {person.category}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{person.title}</p>
                  </div>
                </div>
                <button onClick={() => handleEdit(person)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5">
                  <Edit2 className="h-3.5 w-3.5" />编辑
                </button>
              </div>

              <div className="grid gap-4 px-5 py-4 text-sm md:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-3 md:col-span-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><GitBranch className="h-3.5 w-3.5" />组织关系</div>
                  <p className="mt-1 text-foreground">{person.parentId ? `上级：${parentName(person.parentId)}` : '上级：无（项目决策牵头）'}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">展示层级 {person.displayLevel} · 展示顺序 {person.displayOrder} · {person.organization}</p>
                </div>
                <InfoBlock
                  title={`性格 · ${getProjectOnePersonalityType(person.personalityType).displayName}`}
                  items={[
                    person.personality,
                    `DISC 对应：${getProjectOnePersonalityType(person.personalityType).disc}（${getProjectOnePersonalityType(person.personalityType).discLabel}）`,
                    `通用沟通偏好：${getProjectOnePersonalityType(person.personalityType).communicationPreference}`,
                    `正向触发：${getProjectOnePersonalityType(person.personalityType).positiveTriggers.join('；')}`,
                    `负向触发：${getProjectOnePersonalityType(person.personalityType).negativeTriggers.join('；')}`,
                    `信息披露倾向：${getProjectOnePersonalityType(person.personalityType).informationDisclosureTendency}`,
                    `默认风险反应：${getProjectOnePersonalityType(person.personalityType).defaultRiskResponse}`,
                    '优先级：人物主档的职务、诉求、边界、禁忌和状态节点规则优先。',
                  ]}
                />
                <InfoBlock title="允许的拜访任务" items={person.allowedTasks} />
                <InfoBlock title="核心诉求" items={person.coreNeeds} />
                <InfoBlock title="公开事实" items={person.facts} />
                <InfoBlock title="可匹配披露线索" items={person.clues} />
                <InfoBlock title="信息边界" items={person.informationBoundary} />
                <InfoBlock title="记忆重点" items={person.memoryFocus} />
                <InfoBlock title="禁忌" items={person.taboos} />
              </div>
            </article>
          ))}
        </section>
      </main>

      {editingId && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="person-editor-title">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="person-editor-title" className="text-lg font-semibold text-foreground">编辑 {draft.name} 的五人主档字段</h2>
                <p className="mt-1 text-xs text-muted-foreground">稳定 ID、展示层级和展示顺序只读；编辑结果只保留在当前页面。</p>
              </div>
              <button onClick={handleCancel} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭编辑"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="稳定 ID"><input value={draft.id} disabled className="field-input bg-muted text-muted-foreground" /></Field>
              <Field label="姓名"><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} className="field-input" /></Field>
              <Field label="职务"><input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} className="field-input" /></Field>
              <Field label="层级"><select value={draft.level} onChange={(event) => updateDraft('level', event.target.value as ProjectOneHierarchy)} className="field-input"><option value="高层">高层</option><option value="中层">中层</option><option value="一线">一线</option></select></Field>
              <Field label="角色类别"><select value={draft.category} onChange={(event) => updateDraft('category', event.target.value as ProjectOneCategory)} className="field-input"><option value="高层">高层</option><option value="中层">中层</option><option value="采购">采购</option><option value="项目执行">项目执行</option><option value="一线使用者">一线使用者</option><option value="办公室">办公室</option></select></Field>
              <Field label="上级人物"><select value={draft.parentId ?? ''} onChange={(event) => updateDraft('parentId', event.target.value || null)} className="field-input"><option value="">无（顶层节点）</option>{persons.filter((person) => person.id !== draft.id).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.id}</option>)}</select></Field>
              <Field label="性格类型" hint="通用行为风格；人物具体边界优先">
                <select value={draft.personalityType} onChange={(event) => updateDraft('personalityType', event.target.value as ProjectOnePersonalityTypeId)} className="field-input">
                  {PROJECT_ONE_PERSONALITY_TYPE_LIST.map((type) => <option key={type.id} value={type.id}>{type.displayName} · DISC {type.disc}</option>)}
                </select>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{getProjectOnePersonalityType(draft.personalityType).communicationPreference}</p>
              </Field>
              <Field label="组织关系" wide><textarea value={draft.organization} onChange={(event) => updateDraft('organization', event.target.value)} rows={2} className="field-input resize-none" /></Field>
              <Field label="性格与对话表现" wide><textarea value={draft.personality} onChange={(event) => updateDraft('personality', event.target.value)} rows={3} className="field-input resize-y" /></Field>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {LIST_FIELDS.map(({ key, label, hint }) => (
                <Field key={key} label={label} hint={hint}>
                  <textarea value={listText(draft[key])} onChange={(event) => updateDraft(key, parseList(event.target.value))} rows={4} className="field-input resize-y" />
                </Field>
              ))}
            </div>

            <fieldset className="mt-5 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium text-foreground">允许的拜访任务</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {(['提问', '质疑', '挖坑'] as const).map((task) => (
                  <label key={task} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={draft.allowedTasks.includes(task)} onChange={() => toggleTask(task)} className="h-4 w-4 accent-primary" />
                    {task}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={handleCancel} className="flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"><X className="h-4 w-4" />取消</button>
              <button onClick={handleSave} disabled={!draft.name.trim() || !draft.title.trim()} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />保存到本地</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBlock({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-foreground">
        {items.length > 0 ? items.map((item) => <li key={item} className="flex gap-1.5"><span className="text-primary">•</span><span>{item}</span></li>) : <li className="text-muted-foreground">暂无配置</li>}
      </ul>
    </div>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="mb-1 block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}
