'use client';

import { useState, useEffect, useCallback, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Wand2, Building2, Users, FileText, Save, ArrowLeft, UserCog, BarChart3, Plus, Trash2, Pencil, X, LogOut, ShieldCheck, FlaskConical, Library, Database, ImageIcon, FileBarChart, TestTube2, PlayCircle, ClipboardList, Upload, Sparkles, FolderOpen, BrainCircuit, Bot } from 'lucide-react';
import { aMetrics, bMetrics, cMetrics } from '@/lib/metrics-data';
import { PROJECT_ONE_FIVE_PERSON_NPCS } from '@/lib/designer/project-one-five-person';
import type { CompetitorProfile } from '@/lib/contracts/competitors';
import { ROLE_COLOR, ROLE_LABEL } from '@/components/app-shell';

type DesignerImageAssetCategory = 'person_intro' | 'person_expression' | 'visit_scene';

interface DesignerImageAsset {
  slotKey: string;
  category: DesignerImageAssetCategory;
  personId: string | null;
  label: string;
  imageUrl: string | null;
  isDefault: boolean;
  updatedAt: string | null;
}

interface DesignerSceneAsset {
  slotKey: string;
  sceneKey: string;
  name: string;
  description: string;
  imageUrl: string;
  originalFilename: string;
  byteSize: number;
  updatedAt: string;
}

interface SceneAssetForm {
  sceneKey: string;
  name: string;
  description: string;
  file: File | null;
}

type ConfigRecord = Record<string, unknown>;

interface FivePersonNpcConfig extends ConfigRecord {
  id: string;
  name: string;
  title?: string;
  parentId?: string | null;
  displayOrder?: number;
  displayLevel?: number;
}

function configRecords(value: unknown): ConfigRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is ConfigRecord => Boolean(item && typeof item === 'object'));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as ConfigRecord).map(([id, item]) => ({
    id,
    ...(item && typeof item === 'object' ? item : { value: item }),
  }));
}

function configText(record: ConfigRecord | undefined, ...keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join('；');
  }
  return '';
}

const fivePersonNpcs = configRecords(PROJECT_ONE_FIVE_PERSON_NPCS) as FivePersonNpcConfig[];

interface KeyPerson {
  id: number | string;
  name: string;
  title: string;
  gender: string;
  age: number;
  hometown: string;
  personality: string;
  weakness: string;
}

const projectOneKeyPersons: KeyPerson[] = fivePersonNpcs.map((person) => ({
  id: person.id,
  name: person.name,
  title: person.title ?? '',
  gender: '',
  age: 0,
  hometown: '',
  personality: configText(person, 'personality'),
  weakness: '',
}));

const FALLBACK_PROJECTS: ProjectConfig[] = [
  {
    id: 1,
    name: '项目一·单单位内部竞标',
    budget: 100,
    description: '',
    products: '',
    keyPersons: projectOneKeyPersons,
    aiPrompt: '',
    successCriteria: '',
    scoringStandard: '',
  },
];

interface ProjectConfig {
  id: number;
  name: string;
  budget: number;
  description: string;
  products: string;
  keyPersons: KeyPerson[];
  aiPrompt: string;
  successCriteria: string;
  scoringStandard: string;
}

type Competitor = CompetitorProfile;

interface CompetitorForm {
  company_name: string;
  features: string;
  more_info: string;
  industry: string;
  solution_summary: string;
  representative_experience: string;
  service_support: string;
}

interface ProjectApiItem {
  project_id: number;
  name?: string;
  budget?: number;
  description?: string;
  products?: string;
  ai_prompt?: string;
  success_criteria?: string;
  scoring_standard?: string;
}

interface NpcApiItem {
  project_id: number;
  id: number;
  name?: string;
  title?: string;
  gender?: string;
  age?: number;
  hometown?: string;
  personality?: string;
  weakness?: string;
}

export default function DesignerPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectConfig[]>(FALLBACK_PROJECTS);
  const [selectedProject, setSelectedProject] = useState<number>(1);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [competitorRevision, setCompetitorRevision] = useState(0);
  const [competitorsLoading, setCompetitorsLoading] = useState(true);
  const [competitorNotice, setCompetitorNotice] = useState('');
  const [competitorFormOpen, setCompetitorFormOpen] = useState(false);
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);
  const [competitorForm, setCompetitorForm] = useState<CompetitorForm>({
    company_name: '',
    features: '',
    more_info: '',
    industry: '',
    solution_summary: '',
    representative_experience: '',
    service_support: '',
  });
  const [competitorSaving, setCompetitorSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<'assets' | 'data' | 'reports' | 'testing'>('assets');
  const [selectedDataTab, setSelectedDataTab] = useState<'project' | 'competitors' | 'metrics'>('project');
  const [selectedMetricTab, setSelectedMetricTab] = useState('A类基础指标');
  const [a, setA] = useState(aMetrics);
  const [b, setB] = useState(bMetrics);
  const [c, setC] = useState(cMetrics);
  const metricTabs = ['A类基础指标', 'B类中级指标', 'C类高级指标', '情商', '销售风格', '关系建立', '影响力', '提升空间', '价值观', '能量与活力', '大订单运作能力'];
  // 指标编辑状态
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', desc: '', value: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ tag: '', name: '', desc: '', value: '', category: '' });
  // 公式大弹窗编辑状态
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [formulaModalData, setFormulaModalData] = useState({ tag: '', name: '', formula: '' });
  const [imageAssets, setImageAssets] = useState<DesignerImageAsset[]>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(true);
  const [imageAssetNotice, setImageAssetNotice] = useState('');
  const [uploadingImageSlot, setUploadingImageSlot] = useState<string | null>(null);
  const [previewImageAsset, setPreviewImageAsset] = useState<DesignerImageAsset | null>(null);
  const [sceneAssets, setSceneAssets] = useState<DesignerSceneAsset[]>([]);
  const [sceneAssetsLoading, setSceneAssetsLoading] = useState(true);
  const [sceneAssetNotice, setSceneAssetNotice] = useState('');
  const [sceneAssetFormOpen, setSceneAssetFormOpen] = useState(false);
  const [editingSceneSlotKey, setEditingSceneSlotKey] = useState<string | null>(null);
  const [sceneAssetForm, setSceneAssetForm] = useState<SceneAssetForm>({ sceneKey: '', name: '', description: '', file: null });
  const [sceneAssetSaving, setSceneAssetSaving] = useState(false);
  const [deletingSceneSlotKey, setDeletingSceneSlotKey] = useState<string | null>(null);

  useEffect(() => {
    const importedMetrics = window.localStorage.getItem('weixun_designer_excel_import:metrics');
    if (importedMetrics) {
      try {
        const parsed = JSON.parse(importedMetrics) as { rows?: Array<Record<string, unknown>> };
        const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
        if (rows.length > 0) {
          setA(rows.filter((row) => row.kind === 'A').map((row) => ({ tag: String(row.tag), name: String(row.name), desc: String(row.desc || ''), init: String(row.value ?? '0'), ...(row.category ? { category: String(row.category) } : {}) })));
          setB(rows.filter((row) => row.kind === 'B').map((row) => ({ tag: String(row.tag), name: String(row.name), desc: String(row.desc || ''), formula: String(row.value ?? '0'), ...(row.category ? { category: String(row.category) } : {}) })));
          setC(rows.filter((row) => row.kind === 'C').map((row) => ({ tag: String(row.tag), name: String(row.name), desc: String(row.desc || ''), formula: String(row.value ?? '0'), ...(row.category ? { category: String(row.category) } : {}) })));
          setSelectedModule('data');
          setSelectedDataTab('metrics');
        }
      } catch {
        // 无效草稿保持默认指标，不阻断设计师工作台。
      }
    }

    // 加载项目数据
    fetch('/api/game-data/projects')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setProjects(d.data.map((p: ProjectApiItem) => ({
            id: p.project_id,
            name: p.name,
            budget: p.budget || 100,
            description: p.description || '',
            products: p.products || '',
            keyPersons: p.project_id === 1 ? projectOneKeyPersons : [],
            aiPrompt: p.ai_prompt || '',
            successCriteria: p.success_criteria || '',
            scoringStandard: p.scoring_standard || '',
          })));
        }
      })
      .catch(() => {});

    // 加载 NPC 数据
    fetch('/api/game-data/npcs')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          const personsByProject: Record<number, KeyPerson[]> = {};
          d.data.forEach((npc: NpcApiItem) => {
            if (!personsByProject[npc.project_id]) personsByProject[npc.project_id] = [];
            personsByProject[npc.project_id].push({
              id: npc.id,
              name: npc.name || '',
              title: npc.title || '',
              gender: npc.gender || '',
              age: npc.age || 0,
              hometown: npc.hometown || '',
              personality: npc.personality || '',
              weakness: npc.weakness || '',
            });
          });
          setProjects(prev => prev.map(p => ({
            ...p,
            keyPersons: p.id === 1 ? projectOneKeyPersons : personsByProject[p.id] || [],
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadSceneAssets = useCallback(async () => {
    setSceneAssetsLoading(true);
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch('/api/designer/scene-assets', { headers: { 'x-session': token }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '场景素材读取失败');
      setSceneAssets(Array.isArray(body.scenes) ? body.scenes : []);
      setSceneAssetNotice('');
    } catch (error) {
      setSceneAssets([]);
      setSceneAssetNotice(error instanceof Error ? error.message : '场景素材读取失败');
    } finally {
      setSceneAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSceneAssets();
  }, [loadSceneAssets]);

  const loadCompetitors = useCallback(async (projectId: number) => {
    setCompetitorsLoading(true);
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch(`/api/game-data/competitors?project_id=${projectId}`, {
        headers: { 'x-session': token },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '竞品数据读取失败');
      setCompetitors(Array.isArray(body.data) ? body.data : []);
      setCompetitorRevision(typeof body.revision === 'number' ? body.revision : 0);
      setCompetitorNotice('');
    } catch (error) {
      setCompetitors([]);
      setCompetitorRevision(0);
      setCompetitorNotice(error instanceof Error ? error.message : '竞品数据读取失败');
    } finally {
      setCompetitorsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCompetitors(selectedProject);
  }, [loadCompetitors, selectedProject]);

  useEffect(() => {
    fetch('/api/designer/image-assets')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '图片素材读取失败');
        setImageAssets(Array.isArray(body.assets) ? body.assets : []);
      })
      .catch((error) => setImageAssetNotice(error instanceof Error ? error.message : '图片素材读取失败'))
      .finally(() => setImageAssetsLoading(false));
  }, []);

  useEffect(() => {
    if (!previewImageAsset) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImageAsset(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImageAsset]);

  const currentProject = projects.find(p => p.id === selectedProject);
  const currentCompetitors = competitors.filter(c => c.project_id === selectedProject);

  if (loading) {
    return (
      <div className="min-h-screen bg-role-designer flex items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 border-2 border-role-designer border-t-transparent rounded-full animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  // 指标编辑处理函数
  const handleEditMetric = (tag: string, name: string, desc: string, value: string) => {
    setEditingMetric(tag);
    setEditForm({ name, desc, value });
  };

  const handleImageUpload = async (slotKey: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingImageSlot(slotKey);
    setImageAssetNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const form = new FormData();
      form.append('slotKey', slotKey);
      form.append('file', file);
      const response = await fetch('/api/designer/image-assets', { method: 'POST', headers: { 'x-session': token }, body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '图片上传失败');
      const asset = body.asset as DesignerImageAsset;
      setImageAssets((current) => current.map((item) => item.slotKey === asset.slotKey ? asset : item));
      setImageAssetNotice(`已更新「${asset.label}」。`);
    } catch (error) {
      setImageAssetNotice(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploadingImageSlot(null);
    }
  };

  const resetSceneAssetForm = () => {
    setSceneAssetForm({ sceneKey: '', name: '', description: '', file: null });
    setEditingSceneSlotKey(null);
    setSceneAssetFormOpen(false);
  };

  const startAddSceneAsset = () => {
    setSceneAssetForm({ sceneKey: '', name: '', description: '', file: null });
    setEditingSceneSlotKey(null);
    setSceneAssetNotice('');
    setSceneAssetFormOpen(true);
  };

  const startEditSceneAsset = (scene: DesignerSceneAsset) => {
    setSceneAssetForm({ sceneKey: scene.sceneKey, name: scene.name, description: scene.description, file: null });
    setEditingSceneSlotKey(scene.slotKey);
    setSceneAssetNotice('');
    setSceneAssetFormOpen(true);
  };

  const handleSaveSceneAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingSceneSlotKey && !sceneAssetForm.file) {
      setSceneAssetNotice('新增场景时请选择图片。');
      return;
    }
    setSceneAssetSaving(true);
    setSceneAssetNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const form = new FormData();
      form.append('sceneKey', sceneAssetForm.sceneKey.trim());
      form.append('name', sceneAssetForm.name.trim());
      form.append('description', sceneAssetForm.description.trim());
      if (editingSceneSlotKey) form.append('slotKey', editingSceneSlotKey);
      if (sceneAssetForm.file) form.append('file', sceneAssetForm.file);
      const response = await fetch('/api/designer/scene-assets', {
        method: editingSceneSlotKey ? 'PUT' : 'POST',
        headers: { 'x-session': token },
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '场景素材保存失败');
      resetSceneAssetForm();
      await loadSceneAssets();
      setSceneAssetNotice(`已保存「${body.scene?.name || sceneAssetForm.name}」。`);
    } catch (error) {
      setSceneAssetNotice(error instanceof Error ? error.message : '场景素材保存失败');
    } finally {
      setSceneAssetSaving(false);
    }
  };

  const handleDeleteSceneAsset = async (scene: DesignerSceneAsset) => {
    if (!window.confirm(`确定删除场景素材「${scene.name}」？图片文件也会一并删除。`)) return;
    setDeletingSceneSlotKey(scene.slotKey);
    setSceneAssetNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch('/api/designer/scene-assets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({ slotKey: scene.slotKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '场景素材删除失败');
      setSceneAssets((current) => current.filter((item) => item.slotKey !== scene.slotKey));
      setSceneAssetNotice(`已删除「${scene.name}」。`);
      if (editingSceneSlotKey === scene.slotKey) resetSceneAssetForm();
    } catch (error) {
      setSceneAssetNotice(error instanceof Error ? error.message : '场景素材删除失败');
    } finally {
      setDeletingSceneSlotKey(null);
    }
  };

  const resetCompetitorForm = () => {
    setCompetitorForm({
      company_name: '',
      features: '',
      more_info: '',
      industry: '',
      solution_summary: '',
      representative_experience: '',
      service_support: '',
    });
    setEditingCompetitorId(null);
    setCompetitorFormOpen(false);
  };

  const startAddCompetitor = () => {
    setCompetitorForm({
      company_name: '',
      features: '',
      more_info: '',
      industry: '',
      solution_summary: '',
      representative_experience: '',
      service_support: '',
    });
    setEditingCompetitorId(null);
    setCompetitorNotice('');
    setCompetitorFormOpen(true);
  };

  const startEditCompetitor = (competitor: Competitor) => {
    setCompetitorForm({
      company_name: competitor.company_name,
      features: competitor.features,
      more_info: competitor.more_info,
      industry: competitor.industry,
      solution_summary: competitor.solution_summary,
      representative_experience: competitor.representative_experience,
      service_support: competitor.service_support,
    });
    setEditingCompetitorId(competitor.id);
    setCompetitorNotice('');
    setCompetitorFormOpen(true);
  };

  const handleSaveCompetitor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCompetitorSaving(true);
    setCompetitorNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const payload = {
        project_id: selectedProject,
        expected_revision: competitorRevision,
        ...competitorForm,
        ...(editingCompetitorId ? { id: editingCompetitorId } : {}),
      };
      const response = await fetch('/api/game-data/competitors', {
        method: editingCompetitorId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) await loadCompetitors(selectedProject);
        throw new Error(body.error || '竞品保存失败');
      }
      setCompetitors(Array.isArray(body.data) ? body.data : []);
      setCompetitorRevision(typeof body.revision === 'number' ? body.revision : competitorRevision + 1);
      setCompetitorNotice(editingCompetitorId ? '竞品已更新。' : '竞品已添加。');
      resetCompetitorForm();
    } catch (error) {
      setCompetitorNotice(error instanceof Error ? error.message : '竞品保存失败');
    } finally {
      setCompetitorSaving(false);
    }
  };

  const handleDeleteCompetitor = async (competitor: Competitor) => {
    if (!window.confirm(`确定删除竞品「${competitor.company_name}」吗？`)) return;
    setCompetitorSaving(true);
    setCompetitorNotice('');
    try {
      const token = window.localStorage.getItem('weixun_session') || '';
      const response = await fetch('/api/game-data/competitors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          id: competitor.id,
          project_id: selectedProject,
          expected_revision: competitorRevision,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) await loadCompetitors(selectedProject);
        throw new Error(body.error || '竞品删除失败');
      }
      setCompetitors(Array.isArray(body.data) ? body.data : []);
      setCompetitorRevision(typeof body.revision === 'number' ? body.revision : competitorRevision + 1);
      setCompetitorNotice('竞品已删除。');
      if (editingCompetitorId === competitor.id) resetCompetitorForm();
    } catch (error) {
      setCompetitorNotice(error instanceof Error ? error.message : '竞品删除失败');
    } finally {
      setCompetitorSaving(false);
    }
  };

  const handleSaveEdit = () => {
    if (!editingMetric) return;
    // A类
    const aIdx = a.findIndex(m => m.tag === editingMetric);
    if (aIdx >= 0) {
      const updated = [...a];
      updated[aIdx] = { ...updated[aIdx], name: editForm.name, desc: editForm.desc, init: editForm.value };
      setA(updated);
      setEditingMetric(null);
      return;
    }
    // B类
    const bIdx = b.findIndex(m => m.tag === editingMetric);
    if (bIdx >= 0) {
      const updated = [...b];
      updated[bIdx] = { ...updated[bIdx], name: editForm.name, desc: editForm.desc, formula: editForm.value };
      setB(updated);
      setEditingMetric(null);
      return;
    }
    // C类
    const cIdx = c.findIndex(m => m.tag === editingMetric);
    if (cIdx >= 0) {
      const updated = [...c];
      updated[cIdx] = { ...updated[cIdx], name: editForm.name, desc: editForm.desc, formula: editForm.value };
      setC(updated);
      setEditingMetric(null);
    }
  };

  const handleDeleteMetric = (tag: string) => {
    setA(a.filter(m => m.tag !== tag));
    setB(b.filter(m => m.tag !== tag));
    setC(c.filter(m => m.tag !== tag));
  };

  // 公式弹窗保存
  const handleSaveFormulaModal = () => {
    const { tag, formula } = formulaModalData;
    const aIdx = a.findIndex(m => m.tag === tag);
    if (aIdx >= 0) {
      const updated = [...a];
      updated[aIdx] = { ...updated[aIdx], init: formula };
      setA(updated);
      return;
    }
    const bIdx = b.findIndex(m => m.tag === tag);
    if (bIdx >= 0) {
      const updated = [...b];
      updated[bIdx] = { ...updated[bIdx], formula };
      setB(updated);
      return;
    }
    const cIdx = c.findIndex(m => m.tag === tag);
    if (cIdx >= 0) {
      const updated = [...c];
      updated[cIdx] = { ...updated[cIdx], formula };
      setC(updated);
    }
  };

  const handleAddMetric = () => {
    if (!addForm.tag || !addForm.name) return;
    const newItem = { tag: addForm.tag, name: addForm.name, desc: addForm.desc, category: addForm.category };
    if (selectedMetricTab === 'A类基础指标') {
      setA([...a, { ...newItem, init: addForm.value || '0' }]);
    } else if (selectedMetricTab === 'B类中级指标') {
      setB([...b, { ...newItem, formula: addForm.value || '0' }]);
    } else if (selectedMetricTab === 'C类高级指标') {
      setC([...c, { ...newItem, formula: addForm.value || '0' }]);
    }
    setAddForm({ tag: '', name: '', desc: '', value: '', category: '' });
    setShowAddForm(false);
  };

  return (
    <div className="min-h-screen bg-role-designer">
      {/* 顶部导航 */}
      <header className="topbar-glass sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={() => router.push('/')} className="text-muted-foreground hover:text-foreground p-2 hover:bg-muted rounded-lg transition-colors" title="返回首页">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: ROLE_COLOR.platform_designer }}>
                <Wand2 className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">游戏设计师工作台</div>
                <div className="text-[10px] text-muted-foreground">管理游戏素材 · 数据 · 场景 · 报告 · 测试</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-medium items-center gap-1.5 text-white shadow-sm"
              style={{ background: ROLE_COLOR.platform_designer }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{ROLE_LABEL.platform_designer}</span>
            </div>
            <button
              onClick={() => {
                document.cookie = 'weixun_session=; path=/; max-age=0';
                document.cookie = 'weixun_identity=; path=/; max-age=0';
                try { localStorage.removeItem('weixun_identity'); localStorage.removeItem('weixun_session'); } catch {}
                router.push('/');
              }}
              className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-6">
        {/* 项目选择 */}
        <div className="mb-6 flex items-center gap-4 flex-wrap animate-fade-up">
          <span className="text-sm font-semibold text-foreground uppercase tracking-wider">选择项目：</span>
          <div className="flex gap-2 flex-wrap">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProject(p.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedProject === p.id
                    ? 'btn-primary text-primary-foreground shadow-sm'
                    : 'bg-card text-muted-foreground hover:text-foreground border border-border'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 一级工作区 */}
        <nav aria-label="设计师工作区" className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { id: 'assets' as const, label: '素材库', hint: '人物、图片与拜访场景', icon: Library },
            { id: 'data' as const, label: '数据', hint: '项目、竞品与指标', icon: Database },
            { id: 'reports' as const, label: '报告', hint: '玩家生成的报告', icon: FileBarChart },
            { id: 'testing' as const, label: '测试', hint: '实际测试与模型回复', icon: TestTube2 },
          ].map((section) => {
            const Icon = section.icon;
            const active = selectedModule === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setSelectedModule(section.id)}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                  active
                    ? 'border-role-designer bg-role-designer/10 text-role-designer shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:border-role-designer/40 hover:bg-muted hover:text-foreground'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-role-designer text-white' : 'bg-muted text-muted-foreground group-hover:text-role-designer'}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{section.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{section.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {selectedModule === 'data' && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <span className="mr-2 text-xs font-semibold text-foreground">数据分类</span>
            {[
              { id: 'project' as const, label: '项目数据', icon: Building2 },
              { id: 'competitors' as const, label: '竞品数据', icon: Users },
              { id: 'metrics' as const, label: '指标体系', icon: BarChart3 },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = selectedDataTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedDataTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {tab.label}
                </button>
              );
            })}
            <button
              onClick={() => router.push('/designer/data-import-export')}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              <Upload className="h-3.5 w-3.5" /> Excel 导入导出
            </button>
          </div>
        )}

        {selectedModule === 'assets' && (
          <div className="space-y-4 animate-fade-up">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-role-designer/10 text-role-designer">
                  <Library className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">素材库</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">集中管理人物资料、人物提示词、人物图片和拜访场景图片。</p>
                </div>
              </div>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">当前项目 · {currentProject?.name || '项目一'}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <button
                onClick={() => router.push('/designer/key-persons')}
                className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserCog className="h-5 w-5" /></span>
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">人物</span>
                </div>
                <div className="text-sm font-semibold text-foreground">人物资料</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">维护关键人的基础信息、性格和沟通画像。</p>
                <div className="mt-4 text-xs font-medium text-primary">{currentProject?.keyPersons.length || 0} 位人物 · 查看资料 →</div>
              </button>

              <button
                onClick={() => router.push('/designer/prompt-library')}
                className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-violet-400/60 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600"><FlaskConical className="h-5 w-5" /></span>
                  <span className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] text-violet-600">提示词</span>
                </div>
                <div className="text-sm font-semibold text-foreground">人物提示词设计</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">按人物和交流渠道维护角色表达；系统规则由代码统一保护。</p>
                <div className="mt-4 text-xs font-medium text-violet-600">打开人物提示词 →</div>
              </button>

              <button
                onClick={() => router.push('/designer/jev-config')}
                className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-amber-400/60 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600"><BrainCircuit className="h-5 w-5" /></span>
                  <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700">决策配置</span>
                </div>
                <div className="text-sm font-semibold text-foreground">Jev 决策配置</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">查看 Jev 可用的状态字段与题目规则，编辑决策补充说明。</p>
                <div className="mt-4 text-xs font-medium text-amber-700">查看并编辑 Jev 配置 →</div>
              </button>

              <button
                onClick={() => router.push('/designer/customer-activities')}
                className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-400/60 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><ClipboardList className="h-5 w-5" /></span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-700">活动判定</span>
                </div>
                <div className="text-sm font-semibold text-foreground">客户活动匹配设置</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">选择 AI 综合判断，或按支持度与愉悦度门槛匹配活动。</p>
                <div className="mt-4 text-xs font-medium text-emerald-700">配置活动判定方式 →</div>
              </button>

              <button
                onClick={() => router.push('/designer/ai-provider')}
                className="group rounded-xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-400/60 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"><Bot className="h-5 w-5" /></span>
                  <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] text-blue-700">接口配置</span>
                </div>
                <div className="text-sm font-semibold text-foreground">AI 接口配置</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">在 DeepSeek Flash、豆包、通义千问和旧默认接口间切换。</p>
                <div className="mt-4 text-xs font-medium text-blue-700">选择运行接口 →</div>
              </button>

              <div className="rounded-xl border border-role-designer/30 bg-role-designer/5 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-role-designer/10 text-role-designer"><ImageIcon className="h-5 w-5" /></span>
                  <span className="rounded-full bg-role-designer/10 px-2 py-1 text-[10px] text-role-designer">已开放</span>
                </div>
                <div className="text-sm font-semibold text-foreground">人物图片素材</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">人物介绍图已预填；可上传替换介绍图或补充五种表情。</p>
                <div className="mt-4 text-xs font-medium text-role-designer">在下方按用途上传 →</div>
              </div>
            </div>

            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">人物形象</h3>
                  <p className="mt-1 text-xs text-muted-foreground">支持 PNG、JPEG、WebP，单张不超过 5 MB。人物介绍图用于游戏主进程页面。</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{imageAssets.filter((asset) => asset.category === 'person_intro').length}/5 介绍图</span>
              </div>
              {imageAssetNotice && <p role="status" className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{imageAssetNotice}</p>}
              {imageAssetsLoading ? (
                <div className="py-6 text-center text-xs text-muted-foreground">正在读取图片素材…</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {imageAssets.filter((asset) => asset.category === 'person_intro').map((asset) => (
                    <article key={asset.slotKey} className="overflow-hidden rounded-lg border border-border bg-muted/30">
                      <div className="h-32 bg-muted">
                        {asset.imageUrl ? <button type="button" onClick={() => setPreviewImageAsset(asset)} className="h-full w-full cursor-zoom-in" aria-label={`查看${asset.label}高清大图`}><img src={asset.imageUrl} alt={asset.label} className="h-full w-full object-cover object-top" /></button> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂未上传</div>}
                      </div>
                      <div className="p-3">
                        <div className="min-h-9 text-xs font-medium text-foreground">{asset.label}</div>
                        <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground hover:bg-muted">
                          <Upload className="h-3.5 w-3.5" /> {uploadingImageSlot === asset.slotKey ? '上传中…' : asset.isDefault ? '替换图片' : '再次替换'}
                          <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingImageSlot !== null} onChange={(event) => void handleImageUpload(asset.slotKey, event)} />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {!imageAssetsLoading && (
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">人物表情</h3>
                  <p className="mt-1 text-xs text-muted-foreground">愤怒、严肃、正常淡定、愉快、特别开心五种表情初始为空，可按人物分别上传。</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {imageAssets.filter((asset) => asset.category === 'person_expression').map((asset) => (
                    <article key={asset.slotKey} className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/25 p-2 hover:border-role-designer/50 hover:bg-role-designer/5">
                      {asset.imageUrl ? <button type="button" onClick={() => setPreviewImageAsset(asset)} className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded" aria-label={`查看${asset.label}高清大图`}><img src={asset.imageUrl} alt={asset.label} className="h-full w-full object-cover" /></button> : <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 text-xs text-foreground">{asset.label}</span>
                      <label className="cursor-pointer rounded p-1 text-role-designer hover:bg-role-designer/10" aria-label={`上传${asset.label}`}>
                        <Upload className="h-3.5 w-3.5" />
                        <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingImageSlot !== null} onChange={(event) => void handleImageUpload(asset.slotKey, event)} />
                      </label>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">素材使用说明</span>
              </div>
              <div className="grid gap-3 text-xs leading-5 text-muted-foreground md:grid-cols-3">
                <div className="rounded-lg bg-muted/60 p-3"><span className="font-medium text-foreground">人物资料</span><br />用于维护人物主档和游戏中的可披露信息。</div>
                <div className="rounded-lg bg-muted/60 p-3"><span className="font-medium text-foreground">人物提示词</span><br />按人物和交流渠道维护角色表达，规则性约束不开放编辑。</div>
                <div className="rounded-lg bg-muted/60 p-3"><span className="font-medium text-foreground">图片素材</span><br />人物介绍图已预填，表情与拜访场景可在对应槽位上传。</div>
              </div>
            </div>
          </div>
        )}

        {selectedModule === 'assets' && (
          <div className="space-y-4 animate-fade-up">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">场景素材管理</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">以数据记录管理场景名称、唯一标识、说明和图片，支持新增、查看、编辑与删除。</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{sceneAssets.length} 条记录</span>
                  <button type="button" onClick={startAddSceneAsset} className="flex items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/35 focus-visible:ring-offset-2">
                    <Plus className="h-3.5 w-3.5" /> 新增场景
                  </button>
                </div>
              </div>
              {sceneAssetNotice && <p role="status" className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{sceneAssetNotice}</p>}

              {sceneAssetFormOpen && (
                <form onSubmit={(event) => void handleSaveSceneAsset(event)} className="mb-4 rounded-xl border border-role-designer/25 bg-role-designer/5 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{editingSceneSlotKey ? '编辑场景记录' : '新增场景记录'}</h3>
                    <button type="button" onClick={resetSceneAssetForm} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="关闭场景表单"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 text-xs text-foreground">
                      <span className="font-medium">场景名称</span>
                      <input required maxLength={120} value={sceneAssetForm.name} onChange={(event) => setSceneAssetForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：公司前台" className="w-full rounded-lg border border-border bg-card px-3 py-2 outline-none focus:border-role-designer" />
                    </label>
                    <label className="space-y-1.5 text-xs text-foreground">
                      <span className="font-medium">唯一标识</span>
                      <input required pattern="[a-z0-9][a-z0-9_-]{0,63}" maxLength={64} value={sceneAssetForm.sceneKey} onChange={(event) => setSceneAssetForm((current) => ({ ...current, sceneKey: event.target.value.toLowerCase() }))} placeholder="例如：company_lobby" className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono outline-none focus:border-role-designer" />
                      <span className="block text-[10px] text-muted-foreground">仅小写字母、数字、下划线和连字符，保存后仍可修改。</span>
                    </label>
                    <label className="space-y-1.5 text-xs text-foreground md:col-span-2">
                      <span className="font-medium">场景说明</span>
                      <textarea maxLength={1000} rows={3} value={sceneAssetForm.description} onChange={(event) => setSceneAssetForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明适用的拜访地点或使用方式" className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 outline-none focus:border-role-designer" />
                    </label>
                    <label className="space-y-1.5 text-xs text-foreground md:col-span-2">
                      <span className="font-medium">场景图片{editingSceneSlotKey ? '（不选择则保留原图）' : ''}</span>
                      <input required={!editingSceneSlotKey} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setSceneAssetForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" />
                      <span className="block text-[10px] text-muted-foreground">PNG、JPEG、WebP，最大 5 MB。</span>
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={resetSceneAssetForm} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted">取消</button>
                    <button type="submit" disabled={sceneAssetSaving} className="rounded-lg bg-[#6D28D9] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/35 focus-visible:ring-offset-2 disabled:opacity-50">{sceneAssetSaving ? '保存中…' : '保存记录'}</button>
                  </div>
                </form>
              )}

              {sceneAssetsLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">正在读取场景素材…</div>
              ) : sceneAssets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center">
                  <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium text-foreground">暂无场景记录</p>
                  <p className="mt-1 text-xs text-muted-foreground">点击“新增场景”创建第一条记录。</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[900px] border-collapse text-left text-xs">
                    <thead className="bg-muted/70 text-muted-foreground">
                      <tr><th className="px-4 py-3 font-medium">预览</th><th className="px-4 py-3 font-medium">场景名称</th><th className="px-4 py-3 font-medium">唯一标识</th><th className="px-4 py-3 font-medium">说明</th><th className="px-4 py-3 font-medium">文件</th><th className="px-4 py-3 font-medium">更新时间</th><th className="px-4 py-3 text-right font-medium">操作</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sceneAssets.map((scene) => (
                        <tr key={scene.slotKey} className="bg-card hover:bg-muted/30">
                          <td className="px-4 py-3"><button type="button" onClick={() => setPreviewImageAsset({ slotKey: scene.slotKey, category: 'visit_scene', personId: null, label: scene.name, imageUrl: scene.imageUrl, isDefault: false, updatedAt: scene.updatedAt })} className="h-14 w-20 overflow-hidden rounded-md border border-border bg-muted" aria-label={`查看${scene.name}高清大图`}><img src={scene.imageUrl} alt={scene.name} className="h-full w-full object-cover" /></button></td>
                          <td className="px-4 py-3 font-medium text-foreground">{scene.name}</td>
                          <td className="px-4 py-3"><code className="rounded bg-muted px-1.5 py-1 text-[11px] text-foreground">{scene.sceneKey}</code></td>
                          <td className="max-w-[260px] px-4 py-3 text-muted-foreground"><span className="line-clamp-2">{scene.description || '—'}</span></td>
                          <td className="max-w-[180px] px-4 py-3 text-muted-foreground"><span className="block truncate" title={scene.originalFilename}>{scene.originalFilename}</span><span className="mt-1 block text-[10px]">{Math.max(1, Math.round(scene.byteSize / 1024))} KB</span></td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(scene.updatedAt).toLocaleString('zh-CN')}</td>
                          <td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => startEditSceneAsset(scene)} className="rounded-md p-2 text-role-designer hover:bg-role-designer/10" aria-label={`编辑${scene.name}`}><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={deletingSceneSlotKey !== null} onClick={() => void handleDeleteSceneAsset(scene)} className="rounded-md p-2 text-destructive hover:bg-destructive/10 disabled:opacity-40" aria-label={`删除${scene.name}`}><Trash2 className="h-3.5 w-3.5" /></button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedModule === 'reports' && (
          <div className="rounded-xl border border-border bg-card p-8 text-center animate-fade-up">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-role-designer/10 text-role-designer"><FileBarChart className="h-6 w-6" /></div>
            <h2 className="mt-4 text-base font-semibold text-foreground">玩家生成报告</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">完成对局并生成复盘报告后，报告会集中出现在这里。当前暂无可查看的玩家报告。</p>
            <div className="mx-auto mt-6 grid max-w-xl gap-3 text-left sm:grid-cols-3">
              {['对局复盘', '能力诊断', '行动记录'].map((item) => (
                <div key={item} className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
                  <div className="text-xs font-medium text-muted-foreground">{item}</div>
                  <div className="mt-2 text-[10px] text-muted-foreground/70">暂无记录</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedModule === 'testing' && (
          <div className="space-y-4 animate-fade-up">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-role-designer/10 text-role-designer"><TestTube2 className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">测试中心</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">按测试目标选择实际测试或模型回复测试，测试记录与正式数据分开。</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <button
                onClick={() => router.push('/project-one-preview')}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><PlayCircle className="h-6 w-6" /></span>
                  <span className="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">可用</span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-foreground">实际测试</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">进入项目一五人版前端测试页，体验完整作战台和真实 AI 交互预览。</p>
                <div className="mt-5 text-xs font-medium text-primary">进入实际测试 →</div>
              </button>
              <button
                onClick={() => router.push('/designer/dialogue-prompts')}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-all hover:-translate-y-0.5 hover:border-violet-400/60 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600"><ClipboardList className="h-6 w-6" /></span>
                  <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-medium text-violet-600">双轨</span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-foreground">模型回复测试</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">使用同一输入对比 DeepSeek Flash 与豆包的 NPC 回复、评估和状态变化。</p>
                <div className="mt-5 text-xs font-medium text-violet-600">进入模型回复测试 →</div>
              </button>
              <button
                onClick={() => router.push('/designer/system-evaluation')}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-400/60 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><TestTube2 className="h-6 w-6" /></span>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-600">新功能</span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-foreground">系统链路评测</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">在五人预览的隔离副本中复用真实状态和提示词，并用 DeepEval 评测完整对话。</p>
                <div className="mt-5 text-xs font-medium text-emerald-600">进入系统评测 →</div>
              </button>
            </div>
          </div>
        )}

        {/* 根据选中的工作区显示不同内容 */}
        {selectedModule === 'data' && selectedDataTab === 'project' && (
          <div className="bg-card rounded-xl border border-border p-6 mb-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">项目数据</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{currentProject?.name || '项目一'} · 项目配置</span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <button
                onClick={() => router.push('/designer/client-info')}
                className="bg-muted rounded-xl border border-border p-4 hover:border-primary/50 hover:shadow-md transition-all text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="text-sm font-semibold text-foreground">甲方基本信息</div>
                <div className="text-[10px] text-muted-foreground mt-1">预算、介绍、产品</div>
              </button>

              <div className="bg-muted rounded-xl border border-border p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <FileText className="w-5 h-5 text-success" />
                </div>
                <div className="text-sm font-semibold text-foreground">项目概览</div>
                <div className="mt-2 space-y-1 text-[10px] leading-5 text-muted-foreground">
                  <div>预算：{currentProject?.budget ? `${currentProject.budget} 万元` : '待配置'}</div>
                  <div>产品：{currentProject?.products || '待配置'}</div>
                </div>
              </div>

              <div className="bg-muted rounded-xl border border-border p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-role-designer/10">
                  <Sparkles className="w-5 h-5 text-role-designer" />
                </div>
                <div className="text-sm font-semibold text-foreground">配置状态</div>
                <div className="mt-2 space-y-1 text-[10px] leading-5 text-muted-foreground">
                  <div>关键人物：{currentProject?.keyPersons.length || 0} 人</div>
                  <div>竞品记录：{currentCompetitors.length} 家</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedModule === 'data' && selectedDataTab === 'competitors' && (
          <div className="bg-card rounded-xl border border-border p-6 mb-6">
            <div className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> 竞品数据
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">当前项目 · {currentCompetitors.length} 家</span>
            </div>

            {competitorNotice && (
              <div role="status" className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                {competitorNotice}
              </div>
            )}

            {competitorFormOpen && (
              <form onSubmit={handleSaveCompetitor} className="mb-4 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="text-xs font-semibold text-foreground">{editingCompetitorId ? '编辑竞品' : '添加竞品'}</div>
                <input
                  required
                  maxLength={64}
                  value={competitorForm.company_name}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, company_name: event.target.value }))}
                  placeholder="公司名称"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  required
                  maxLength={2_000}
                  value={competitorForm.features}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, features: event.target.value }))}
                  placeholder="核心优势（必填）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  required
                  maxLength={4_000}
                  value={competitorForm.more_info}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, more_info: event.target.value }))}
                  placeholder="基本介绍（必填）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  maxLength={120}
                  value={competitorForm.industry}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, industry: event.target.value }))}
                  placeholder="所属行业（选填）"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  maxLength={1_500}
                  value={competitorForm.solution_summary}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, solution_summary: event.target.value }))}
                  placeholder="方案概况（选填）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  maxLength={2_000}
                  value={competitorForm.representative_experience}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, representative_experience: event.target.value }))}
                  placeholder="代表性经验（选填；仅填写有依据的信息）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <textarea
                  maxLength={1_500}
                  value={competitorForm.service_support}
                  onChange={(event) => setCompetitorForm((current) => ({ ...current, service_support: event.target.value }))}
                  placeholder="交付与服务支持（选填）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={resetCompetitorForm} disabled={competitorSaving} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">
                    取消
                  </button>
                  <button type="submit" disabled={competitorSaving} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                    {competitorSaving ? '保存中…' : '保存竞品'}
                  </button>
                </div>
              </form>
            )}

            {competitorsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">正在读取竞品数据…</div>
            ) : currentCompetitors.length > 0 ? (
              <div className="space-y-3">
                {currentCompetitors.map(c => (
                  <div key={c.id} className="bg-muted rounded-lg p-4 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-foreground">{c.company_name}</div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => startEditCompetitor(c)} disabled={competitorSaving} className="text-xs text-primary hover:text-primary/80 disabled:opacity-50">编辑</button>
                        <button type="button" onClick={() => void handleDeleteCompetitor(c)} disabled={competitorSaving} className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50">删除</button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">核心优势：</span>{c.features}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div><span className="font-medium">基本介绍：</span>{c.more_info}</div>
                      {c.industry && <div><span className="font-medium">所属行业：</span>{c.industry}</div>}
                      {c.solution_summary && <div><span className="font-medium">方案概况：</span>{c.solution_summary}</div>}
                      {c.representative_experience && <div><span className="font-medium">代表性经验：</span>{c.representative_experience}</div>}
                      {c.service_support && <div><span className="font-medium">交付与服务支持：</span>{c.service_support}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8">暂无竞品数据</div>
            )}
            <button type="button" onClick={startAddCompetitor} disabled={competitorSaving || competitorsLoading || competitorFormOpen} className="mt-4 w-full px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50">
              添加竞品
            </button>
          </div>
        )}

        {selectedModule === 'data' && selectedDataTab === 'metrics' && (
          <div className="bg-card rounded-xl border border-border p-6 mb-6">
            <div className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> 指标体系
              <span className="text-[10px] text-muted-foreground font-normal ml-auto">A/B/C 三级指标体系</span>
            </div>

            {/* 指标分类 Tab */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
              {metricTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSelectedMetricTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    selectedMetricTab === tab
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* A/B/C 类指标通用渲染 */}
            {['A类基础指标', 'B类中级指标', 'C类高级指标'].includes(selectedMetricTab) && (
              <div className="space-y-3">
                {/* 新增按钮 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {selectedMetricTab === 'A类基础指标' && `共 ${a.length} 项`}
                    {selectedMetricTab === 'B类中级指标' && `共 ${b.length} 项`}
                    {selectedMetricTab === 'C类高级指标' && `共 ${c.length} 项`}
                  </span>
                  <button
                    onClick={() => { setShowAddForm(!showAddForm); setEditingMetric(null); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> 新增指标
                  </button>
                </div>

                {/* 新增表单 */}
                {showAddForm && (
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                      <input
                        value={addForm.tag}
                        onChange={(e) => setAddForm({...addForm, tag: e.target.value})}
                        placeholder="标签 (如 A68)"
                        className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        value={addForm.name}
                        onChange={(e) => setAddForm({...addForm, name: e.target.value})}
                        placeholder="指标名称"
                        className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        value={addForm.desc}
                        onChange={(e) => setAddForm({...addForm, desc: e.target.value})}
                        placeholder="描述"
                        className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        value={addForm.value}
                        onChange={(e) => setAddForm({...addForm, value: e.target.value})}
                        placeholder={selectedMetricTab === 'A类基础指标' ? '初始值' : '公式'}
                        className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={addForm.category}
                        onChange={(e) => setAddForm({...addForm, category: e.target.value})}
                        placeholder="分类 (可选)"
                        className="flex-1 px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button onClick={handleAddMetric} className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">保存</button>
                      <button onClick={() => { setShowAddForm(false); setAddForm({ tag: '', name: '', desc: '', value: '', category: '' }); }} className="px-4 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">取消</button>
                    </div>
                  </div>
                )}

                {/* 指标列表 */}
                <div className="space-y-2 max-h-[450px] overflow-y-auto pr-2">
                  {selectedMetricTab === 'A类基础指标' && a.map((item) => (
                    <div key={item.tag} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted border border-border group">
                      {editingMetric === item.tag ? (
                        <>
                          <span className="text-xs font-mono font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <input value={editForm.name} onChange={(e) => setEditForm({...editForm, name: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[120px]" />
                          <input value={editForm.desc} onChange={(e) => setEditForm({...editForm, desc: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="描述" />
                          <input value={editForm.value} onChange={(e) => setEditForm({...editForm, value: e.target.value})} className="w-20 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 text-right" placeholder="初始值" />
                          <button onClick={handleSaveEdit} className="p-1.5 rounded hover:bg-success/10 text-success transition-colors"><Save className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingMetric(null)} className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-mono font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <span className="text-sm font-medium text-foreground min-w-[120px]">{item.name}</span>
                          <span className="flex-1 text-xs text-muted-foreground">{item.desc}</span>
                          <span className="text-xs text-muted-foreground min-w-[60px] text-right">初始值: {item.init}</span>
                          {item.category && <span className="text-[10px] text-warning bg-warning/10 px-2 py-0.5 rounded">{item.category}</span>}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditMetric(item.tag, item.name, item.desc, item.init)} className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteMetric(item.tag)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {selectedMetricTab === 'B类中级指标' && b.map((item) => (
                    <div key={item.tag} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted border border-border group">
                      {editingMetric === item.tag ? (
                        <>
                          <span className="text-xs font-mono font-semibold text-success bg-success/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <input value={editForm.name} onChange={(e) => setEditForm({...editForm, name: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[100px]" />
                          <input value={editForm.desc} onChange={(e) => setEditForm({...editForm, desc: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="描述" />
                          <input value={editForm.value} onChange={(e) => setEditForm({...editForm, value: e.target.value})} className="w-48 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono" placeholder="公式" />
                          <button onClick={handleSaveEdit} className="p-1.5 rounded hover:bg-success/10 text-success transition-colors"><Save className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingMetric(null)} className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-mono font-semibold text-success bg-success/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <span className="text-sm font-medium text-foreground min-w-[100px]">{item.name}</span>
                          <span className="flex-1 text-xs text-muted-foreground">{item.desc}</span>
                          <code
                            className="text-[10px] text-primary bg-primary/5 px-2 py-0.5 rounded font-mono min-w-[180px] text-right truncate cursor-pointer hover:bg-primary/10 transition-colors"
                            title={item.formula}
                            onClick={() => { setFormulaModalData({ tag: item.tag, name: item.name, formula: item.formula }); setShowFormulaModal(true); }}
                          >{item.formula}</code>
                          {item.category && <span className="text-[10px] text-warning bg-warning/10 px-2 py-0.5 rounded">{item.category}</span>}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditMetric(item.tag, item.name, item.desc, item.formula)} className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteMetric(item.tag)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {selectedMetricTab === 'C类高级指标' && c.map((item) => (
                    <div key={item.tag} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted border border-border group">
                      {editingMetric === item.tag ? (
                        <>
                          <span className="text-xs font-mono font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <input value={editForm.name} onChange={(e) => setEditForm({...editForm, name: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[120px]" />
                          <input value={editForm.desc} onChange={(e) => setEditForm({...editForm, desc: e.target.value})} className="flex-1 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="描述" />
                          <input value={editForm.value} onChange={(e) => setEditForm({...editForm, value: e.target.value})} className="w-48 px-2 py-1 rounded bg-card border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono" placeholder="公式" />
                          <button onClick={handleSaveEdit} className="p-1.5 rounded hover:bg-success/10 text-success transition-colors"><Save className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingMetric(null)} className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-mono font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded min-w-[40px] text-center">{item.tag}</span>
                          <span className="text-sm font-medium text-foreground min-w-[120px]">{item.name}</span>
                          <span className="flex-1 text-xs text-muted-foreground">{item.desc}</span>
                          <code
                            className="text-[10px] text-destructive bg-destructive/5 px-2 py-0.5 rounded font-mono min-w-[180px] text-right truncate cursor-pointer hover:bg-destructive/10 transition-colors"
                            title={item.formula}
                            onClick={() => {
                              setFormulaModalData({ tag: item.tag, name: item.name, formula: item.formula });
                              setShowFormulaModal(true);
                            }}
                          >{item.formula}</code>
                          {item.category && <span className="text-[10px] text-warning bg-warning/10 px-2 py-0.5 rounded">{item.category}</span>}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditMetric(item.tag, item.name, item.desc, item.formula)} className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteMetric(item.tag)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 其他分类 Tab 内容 */}
            {!['A类基础指标', 'B类中级指标', 'C类高级指标'].includes(selectedMetricTab) && (
              <div className="text-sm text-muted-foreground text-center py-8">
                {selectedMetricTab} 指标配置区域
              </div>
            )}
          </div>
        )}

        {previewImageAsset?.imageUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={`${previewImageAsset.label}高清大图`}
            onClick={() => setPreviewImageAsset(null)}
          >
            <div className="relative flex max-h-[92vh] max-w-[94vw] flex-col overflow-hidden rounded-2xl bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
                <div className="min-w-0 truncate text-sm font-semibold text-foreground">{previewImageAsset.label}</div>
                <button type="button" onClick={() => setPreviewImageAsset(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭高清大图">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 items-center justify-center overflow-auto bg-black/90 p-3">
                <img src={previewImageAsset.imageUrl} alt={previewImageAsset.label} className="max-h-[82vh] max-w-full object-contain" />
              </div>
            </div>
          </div>
        )}

        {/* 公式编辑大弹窗 */}
        {showFormulaModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowFormulaModal(false)}>
            <div className="bg-card rounded-2xl shadow-2xl w-[600px] max-w-[90vw] p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-foreground">编辑公式</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono text-destructive">{formulaModalData.tag}</span>
                    <span className="mx-1.5">·</span>
                    {formulaModalData.name}
                  </p>
                </div>
                <button onClick={() => setShowFormulaModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <textarea
                value={formulaModalData.formula}
                onChange={(e) => setFormulaModalData({ ...formulaModalData, formula: e.target.value })}
                placeholder="输入公式，如 (A01 + A02) / A03 * 100"
                rows={6}
                className="w-full px-4 py-3 rounded-xl bg-surface-container border-none text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowFormulaModal(false)} className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-surface-container">
                  取消
                </button>
                <button
                  onClick={() => { handleSaveFormulaModal(); setShowFormulaModal(false); }}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
