'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, ChevronRight, ChevronLeft, Edit2, Save, Wand2, Building2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';

const INDUSTRIES = [
  { id: 'government', name: '政府机关', icon: '🏛️' },
  { id: 'public_inst', name: '事业单位（高校/医院）', icon: '🏥' },
  { id: 'manufacturing', name: '制造企业', icon: '🏭' },
  { id: 'central', name: '央企', icon: '🏢' },
  { id: 'private', name: '民营企业', icon: '💼' },
];

const PRODUCT_CATEGORIES = [
  { id: 'smart_gov', name: '智慧政务' },
  { id: 'edu_cloud', name: '教育云平台' },
  { id: 'health_data', name: '医疗大数据' },
  { id: 'transport', name: '智慧交通' },
  { id: 'env_monitor', name: '环保监测' },
  { id: 'safe_city', name: '雪亮工程' },
  { id: 'civ_affairs', name: '民政大数据' },
  { id: 'erpcrm', name: 'ERP/CRM' },
  { id: 'data_center', name: '数据中心' },
  { id: 'custom', name: '自定义...' },
];

const TEMPLATE_SCENES = [
  { id: 't1', name: 'XX市政务办 · 智慧政务 v3.2', budget: 580, industry: 'government', product: 'smart_gov', desc: '日均 50W+ 高并发，等保三级，12 委办局数据互通' },
  { id: 't2', name: '某市卫健委 · 区域医疗云', budget: 320, industry: 'public_inst', product: 'health_data', desc: '多医院互联互通，医学影像云存储' },
  { id: 't3', name: '某区教育局 · 教育云平台', budget: 180, industry: 'public_inst', product: 'edu_cloud', desc: 'K12 在线教学，学情分析' },
  { id: 't4', name: '某央企集团 · 数字化 ERP', budget: 1200, industry: 'central', product: 'erpcrm', desc: '集团 30+ 子公司财务业务一体化' },
  { id: 't5', name: '某制造企业 · 智能工厂', budget: 850, industry: 'manufacturing', product: 'erpcrm', desc: 'MES 系统 + 设备联网 + 数字孪生' },
  { id: 't6', name: '某市民营集团 · 数据中台', budget: 460, industry: 'private', product: 'data_center', desc: '10+ 业务系统数据汇聚 + BI 分析' },
];

interface SceneParams {
  name: string;
  budget: number;
  duration: string;
  technicalDifficulties: string[];
  customerNeeds: string[];
  decisionMaker: { name: string; style: string; title: string };
  competitors: string[];
}

interface GeneratedCompetitor {
  name: string;
  strength: string;
}

export default function SetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-app-shell flex items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          加载中...
        </div>
      </div>
    }>
      <SetupInner />
    </Suspense>
  );
}

function SetupInner() {
  const searchParams = useSearchParams();
  const location = searchParams.get('location') || 'project-1';
  const projectId = location.replace('project-', '');
  
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState('government');
  const [product, setProduct] = useState('smart_gov');
  const [customProduct, setCustomProduct] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [scene, setScene] = useState<SceneParams | null>(null);
  const [competitorProfiles, setCompetitorProfiles] = useState<{company_name: string; features: string; more_info: string; project_id: number}[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (scene) {
      fetch(`/api/game-data/competitors?project_id=${projectId}`)
        .then(r => r.json())
        .then(d => setCompetitorProfiles(d.data || []))
        .catch(() => {});
    }
  }, [scene, projectId]);
  const generateScene = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/scenario/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': localStorage.getItem('weixun_session') || '',
        },
        body: JSON.stringify({
          industry: INDUSTRIES.find(i => i.id === industry)?.name,
          productCategory: product === 'custom' ? customProduct : PRODUCT_CATEGORIES.find(p => p.id === product)?.name,
          customRequirement: customDescription || undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || '生成失败');
      }
      const data = await res.json();
      const raw = data.scenario;
      setScene({
        name: raw.name || raw.scenarioName || raw.projectName || 'AI 生成的政企场景',
        budget: raw.budget || 500,
        duration: raw.duration || raw.deliveryPeriod || raw.cycle || '12 个月',
        technicalDifficulties: raw.technicalDifficulties?.length ? raw.technicalDifficulties
          : (raw.techChallenges?.length ? raw.techChallenges
          : (raw.difficulties?.length ? raw.difficulties
          : ['等保三级合规', '多部门数据对接', '国产化替代'])),
        customerNeeds: raw.customerNeeds?.length ? raw.customerNeeds
          : (raw.clientNeeds?.length ? raw.clientNeeds
          : (raw.needs?.length ? raw.needs
          : ['数据互通', '安全合规', '信创替代'])),
        decisionMaker: raw.decisionMaker
          ? {
              name: raw.decisionMaker.name || '待指派',
              style: raw.decisionMaker.personality || raw.decisionMaker.style || '理性决策',
              title: raw.decisionMaker.role || raw.decisionMaker.title || '信息中心主任',
            }
          : { name: '待指派', style: '理性决策', title: '信息中心主任' },
        competitors: raw.competitors?.length
          ? raw.competitors.map((c: GeneratedCompetitor) => c.name)
          : ['华为云', '阿里云', '腾讯云'],
      });
      setStep(2);
    } catch (err) {
      alert('场景生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const startGame = () => {
    if (!scene) return;
    alert('本期只开放项目一固定纵向场景；AI自定义场景可预览，但尚未进入可游玩状态。');
  };

  return (
    <AppShell identity={null} activeNav="setup">
      {/* Step Indicator */}
      <div className="mb-6 flex items-center gap-3 animate-fade-up">
        <span className="badge badge-primary">第 {step} / 2 步</span>
        <div className="flex-1 h-1 rounded-full bg-surface-container overflow-hidden max-w-md">
          <div
            className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-500"
            style={{ width: `${(step / 2) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{step === 1 ? '生成场景' : '确认场景'}</span>
      </div>

      {step === 1 && (
        <div className="animate-fade-up">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-primary" />
              AI 场景生成器
            </h1>
            <p className="text-sm text-muted-foreground">选择行业与产品，AI 自动生成完整政企竞标项目背景</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左：参数 */}
            <div className="card-elevated p-6 space-y-5">
              <div>
                <label className="text-xs font-semibold text-foreground mb-3 block uppercase tracking-wider">行业分类</label>
                <div className="grid grid-cols-1 gap-2">
                  {INDUSTRIES.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => setIndustry(i.id)}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-all ${
                        industry === i.id
                          ? 'border-primary bg-primary/5 text-foreground shadow-sm -translate-y-0.5'
                          : 'border-border bg-card hover:border-primary/40 hover:-translate-y-0.5'
                      }`}
                    >
                      <span className="text-xl w-7 text-center">{i.icon}</span>
                      <span className="text-sm font-medium">{i.name}</span>
                      {industry === i.id && <span className="ml-auto w-2 h-2 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-2 block uppercase tracking-wider">产品分类</label>
                <select
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-surface-container border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {PRODUCT_CATEGORIES.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {product === 'custom' && (
                  <input
                    type="text"
                    value={customProduct}
                    onChange={(e) => setCustomProduct(e.target.value)}
                    placeholder="输入自定义产品名..."
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground"
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-2 block uppercase tracking-wider">补充说明（可选）</label>
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="例如：客户是省会城市级别，预算在 500-1000 万..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <button
                onClick={generateScene}
                disabled={generating || (product === 'custom' && !customProduct)}
                className="w-full py-3 rounded-lg btn-primary font-semibold flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    AI 生成中...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" /> AI 生成场景
                  </>
                )}
              </button>
            </div>

            {/* 右：推荐场景 */}
            <div className="card-elevated p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wider">📌 推荐场景</div>
                <span className="badge badge-muted">{TEMPLATE_SCENES.length} 个模板</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">点击直接使用该模板生成场景</p>
              <div className="space-y-2.5">
                {TEMPLATE_SCENES.map((t) => (
                  <button
                    key={t.id}
                    onClick={async () => {
                      setIndustry(t.industry);
                      setProduct(t.product);
                      setGenerating(true);
                      try {
                        const res = await fetch('/api/scenario/generate', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'x-session': localStorage.getItem('weixun_session') || '',
                          },
                          body: JSON.stringify({
                            industry: INDUSTRIES.find(i => i.id === t.industry)?.name,
                            productCategory: PRODUCT_CATEGORIES.find(p => p.id === t.product)?.name || t.name,
                            customRequirement: `参考模板：${t.name}；${t.desc}`,
                          }),
                        });
                        if (!res.ok) {
                          const error = await res.json().catch(() => null);
                          throw new Error(error?.error || '生成失败');
                        }
                        const data = await res.json();
                        const raw = data.scenario;
                        setScene({
                          name: t.name,
                          budget: t.budget,
                          duration: raw.deliveryPeriod || raw.duration || '12 个月',
                          technicalDifficulties: raw.techChallenges?.length ? raw.techChallenges
                            : (raw.technicalDifficulties?.length ? raw.technicalDifficulties
                            : ['等保三级合规', '多委办局数据对接', '信创全栈替代']),
                          customerNeeds: raw.clientNeeds?.length ? raw.clientNeeds
                            : (raw.customerNeeds?.length ? raw.customerNeeds
                            : ['数据互通', '安全合规', '信创替代']),
                          decisionMaker: raw.decisionMaker
                            ? {
                                name: raw.decisionMaker.name || '待 AI 分配',
                                style: raw.decisionMaker.personality || '理性决策',
                                title: raw.decisionMaker.role || '信息中心主任',
                              }
                            : { name: '待 AI 分配', style: '理性决策', title: '信息中心主任' },
                          competitors: raw.competitors?.length
                            ? raw.competitors.map((c: GeneratedCompetitor) => c.name)
                            : ['华为云', '阿里云', '腾讯云'],
                        });
                        setStep(2);
                      } catch (error) {
                        alert(error instanceof Error ? error.message : '场景生成失败，请重试');
                      } finally {
                        setGenerating(false);
                      }
                    }}
                    className="w-full text-left p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 hover:-translate-y-0.5 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="text-sm font-semibold text-foreground flex-1">{t.name}</div>
                      <span className="text-xs font-bold text-primary num shrink-0 ml-2">¥{t.budget}万</span>
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && scene && (
        <div className="animate-fade-up">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
                <Sparkles className="w-7 h-7 text-primary" />
                AI 生成结果
              </h1>
              <p className="text-sm text-muted-foreground">你可以手动调整任何字段后再开始</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(!editing)}
                className="px-4 py-2 rounded-lg btn-glass text-sm text-foreground flex items-center gap-1.5"
              >
                {editing ? <Save className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                {editing ? '保存' : '编辑'}
              </button>
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-lg btn-glass text-sm text-foreground flex items-center gap-1.5"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> 返回
              </button>
              <button
                onClick={startGame}
                className="px-5 py-2 rounded-lg btn-primary text-sm font-semibold flex items-center gap-1.5"
              >
                开始博弈 <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="card-elevated p-5">
              <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">项目名称</div>
              {editing ? (
                <input value={scene.name} onChange={(e) => setScene({ ...scene, name: e.target.value })} className="w-full text-lg font-semibold text-foreground bg-surface-container border-none rounded px-2 py-1.5" />
              ) : (
                <div className="text-lg font-semibold text-foreground">{scene.name}</div>
              )}
            </div>
            <div className="card-elevated p-5">
              <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">项目预算</div>
              {editing ? (
                <input type="number" value={scene.budget} onChange={(e) => setScene({ ...scene, budget: Number(e.target.value) })} className="w-full text-lg font-semibold text-foreground bg-surface-container border-none rounded px-2 py-1.5" />
              ) : (
                <div className="text-2xl font-bold text-primary num">¥{scene.budget}万</div>
              )}
            </div>
            <div className="card-elevated p-5">
              <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">交付周期</div>
              {editing ? (
                <input value={scene.duration} onChange={(e) => setScene({ ...scene, duration: e.target.value })} className="w-full text-sm text-foreground bg-surface-container border-none rounded px-2 py-1.5" />
              ) : (
                <div className="text-base text-foreground">{scene.duration}</div>
              )}
            </div>
            <div className="card-elevated p-5">
              <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">决策人</div>
              {scene.decisionMaker ? (
                <>
                  <div className="text-base font-semibold text-foreground">{scene.decisionMaker.name} · {scene.decisionMaker.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{scene.decisionMaker.style}</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">未指定</div>
              )}
            </div>
            <div className="card-elevated p-5 md:col-span-2">
              <div className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">技术难点</div>
              {editing ? (
                <textarea
                  value={scene.technicalDifficulties.join('\n')}
                  onChange={(e) => setScene({ ...scene, technicalDifficulties: e.target.value.split('\n').filter(Boolean) })}
                  rows={3}
                  className="w-full text-sm text-foreground bg-surface-container border-none rounded px-2 py-1.5"
                />
              ) : (
                <ul className="space-y-1.5">
                  {scene.technicalDifficulties.map((t, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" /> {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card-elevated p-5 md:col-span-2">
              <div className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">客户核心诉求</div>
              {editing ? (
                <textarea
                  value={scene.customerNeeds.join('\n')}
                  onChange={(e) => setScene({ ...scene, customerNeeds: e.target.value.split('\n').filter(Boolean) })}
                  rows={4}
                  className="w-full text-sm text-foreground bg-surface-container border-none rounded px-2 py-1.5"
                />
              ) : (
                <ul className="space-y-1.5">
                  {scene.customerNeeds.map((c, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-success mt-1.5 shrink-0" /> {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card-elevated p-5 md:col-span-2">
              <div className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">竞品企业</div>
              <div className="flex flex-wrap gap-2">
                {scene.competitors.map((c, i) => (
                  <span key={i} className="badge badge-warning">{typeof c === 'string' ? c : (c as { name?: string }).name || '竞品'}</span>
                ))}
              </div>
            </div>
          </div>

          {/* 竞品特点表 - 表格形式 */}
          {competitorProfiles.length > 0 && (
            <div className="bg-gradient-to-br from-card to-surface-container rounded-2xl border-2 border-primary/20 p-8 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">{competitorProfiles.length === 3 ? 'ABC' : 'ABCD'}公司特点表</div>
                  <div className="text-xs text-muted-foreground">了解各竞品优势与劣势，制定针对性竞标策略</div>
                </div>
              </div>

              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-container border-b border-border">
                      <th className="px-4 py-3 text-left font-semibold text-foreground">公司</th>
                      {competitorProfiles.map((cp, i) => (
                        <th key={i} className="px-4 py-3 text-center font-bold text-primary text-lg">{cp.company_name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="px-4 py-3 font-semibold text-foreground">特点</td>
                      {competitorProfiles.map((cp, i) => (
                        <td key={i} className="px-4 py-3 text-center text-foreground/80">{cp.features}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-semibold text-foreground align-top">更多信息</td>
                      {competitorProfiles.map((cp, i) => (
                        <td key={i} className="px-4 py-3 text-center text-muted-foreground align-top">{cp.more_info || '-'}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
