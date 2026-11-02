'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';

interface Metric {
  id: number;
  name: string;
  category: string;
  description: string;
  weight: number;
  showInDashboard: boolean;
}

const DEFAULT_METRICS: Metric[] = [
  // 关系类指标
  { id: 1, name: '亲密度', category: '关系', description: '与关键人的关系亲密程度', weight: 10, showInDashboard: true },
  { id: 2, name: '信任度', category: '关系', description: '关键人对玩家的信任程度', weight: 10, showInDashboard: true },
  { id: 3, name: '好感度', category: '关系', description: '关键人对玩家的好感程度', weight: 8, showInDashboard: true },
  { id: 4, name: '影响力', category: '关系', description: '玩家对关键人的影响力', weight: 8, showInDashboard: true },
  // 方案类指标
  { id: 5, name: '方案匹配度', category: '方案', description: '方案与甲方需求的匹配程度', weight: 12, showInDashboard: true },
  { id: 6, name: '技术可行性', category: '方案', description: '方案的技术可行性评分', weight: 10, showInDashboard: true },
  { id: 7, name: '成本合理性', category: '方案', description: '方案成本的合理性评分', weight: 8, showInDashboard: true },
  { id: 8, name: '创新性', category: '方案', description: '方案的创新程度', weight: 6, showInDashboard: false },
  // 竞品类指标
  { id: 9, name: '竞品对比优势', category: '竞品', description: '与竞品相比的优势程度', weight: 10, showInDashboard: true },
  { id: 10, name: '价格竞争力', category: '竞品', description: '价格方面的竞争力', weight: 8, showInDashboard: true },
  { id: 11, name: '服务优势', category: '竞品', description: '服务方面的优势', weight: 6, showInDashboard: false },
  { id: 12, name: '品牌影响力', category: '竞品', description: '品牌在甲方心中的影响力', weight: 6, showInDashboard: false },
  // 沟通类指标
  { id: 13, name: '沟通有效性', category: '沟通', description: '沟通的有效程度', weight: 8, showInDashboard: true },
  { id: 14, name: '需求理解度', category: '沟通', description: '对甲方需求的理解程度', weight: 8, showInDashboard: true },
  { id: 15, name: '响应速度', category: '沟通', description: '对甲方需求的响应速度', weight: 6, showInDashboard: false },
  { id: 16, name: '专业度', category: '沟通', description: '沟通中的专业程度', weight: 6, showInDashboard: false },
  // 策略类指标
  { id: 17, name: '策略合理性', category: '策略', description: '攻坚策略的合理性', weight: 8, showInDashboard: true },
  { id: 18, name: '时机把握', category: '策略', description: '对时机的把握程度', weight: 6, showInDashboard: false },
  { id: 19, name: '资源利用', category: '策略', description: '资源利用的效率', weight: 6, showInDashboard: false },
  { id: 20, name: '风险控制', category: '策略', description: '风险控制的程度', weight: 6, showInDashboard: false },
  // 支持度指标
  { id: 21, name: '高层支持度', category: '支持度', description: '高层决策人的支持程度', weight: 15, showInDashboard: true },
  { id: 22, name: '中层支持度', category: '支持度', description: '中层决策人的支持程度', weight: 12, showInDashboard: true },
  { id: 23, name: '一线支持度', category: '支持度', description: '一线执行人的支持程度', weight: 10, showInDashboard: true },
  { id: 24, name: '综合支持度', category: '支持度', description: '所有关键人的综合支持度', weight: 15, showInDashboard: true },
  // 进度类指标
  { id: 25, name: '项目推进度', category: '进度', description: '项目整体推进程度', weight: 8, showInDashboard: true },
  { id: 26, name: '关键节点完成', category: '进度', description: '关键节点的完成情况', weight: 6, showInDashboard: false },
  { id: 27, name: '里程碑达成', category: '进度', description: '里程碑的达成情况', weight: 6, showInDashboard: false },
  // 风险类指标
  { id: 28, name: '竞品威胁', category: '风险', description: '竞品带来的威胁程度', weight: 8, showInDashboard: true },
  { id: 29, name: '内部阻力', category: '风险', description: '内部阻力的程度', weight: 6, showInDashboard: false },
  { id: 30, name: '预算风险', category: '风险', description: '预算方面的风险', weight: 6, showInDashboard: false },
  // 能力类指标
  { id: 31, name: '需求洞察', category: '能力', description: '对甲方需求的洞察能力', weight: 6, showInDashboard: false },
  { id: 32, name: '关系建立', category: '能力', description: '建立关系的能力', weight: 6, showInDashboard: false },
  { id: 33, name: '方案呈现', category: '能力', description: '方案呈现的能力', weight: 6, showInDashboard: false },
  { id: 34, name: '谈判技巧', category: '能力', description: '谈判的技巧水平', weight: 6, showInDashboard: false },
  { id: 35, name: '应变能力', category: '能力', description: '应对突发情况的能力', weight: 6, showInDashboard: false },
  // 满意度指标
  { id: 36, name: '甲方满意度', category: '满意度', description: '甲方对整体服务的满意度', weight: 10, showInDashboard: true },
  { id: 37, name: '方案满意度', category: '满意度', description: '甲方对方案的满意度', weight: 8, showInDashboard: true },
  { id: 38, name: '服务满意度', category: '满意度', description: '甲方对服务的满意度', weight: 6, showInDashboard: false },
  // 综合指标
  { id: 39, name: '胜率预测', category: '综合', description: '预测的胜率', weight: 10, showInDashboard: true },
  { id: 40, name: '综合评分', category: '综合', description: '综合评分', weight: 10, showInDashboard: true },
  { id: 41, name: '攻略进度', category: '综合', description: '攻略的整体进度', weight: 8, showInDashboard: true },
  { id: 42, name: '剩余时间', category: '综合', description: '剩余攻略时间', weight: 5, showInDashboard: true },
];

export default function MetricsPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metric[]>(DEFAULT_METRICS);
  const [filter, setFilter] = useState<string>('all');

  const categories = ['all', ...Array.from(new Set(metrics.map(m => m.category)))];
  const filteredMetrics = filter === 'all' ? metrics : metrics.filter(m => m.category === filter);

  const addMetric = () => {
    const newMetric: Metric = {
      id: Date.now(),
      name: '新指标',
      category: '自定义',
      description: '',
      weight: 5,
      showInDashboard: false,
    };
    setMetrics([...metrics, newMetric]);
  };

  const updateMetric = <K extends keyof Metric>(id: number, field: K, value: Metric[K]) => {
    setMetrics(metrics.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const deleteMetric = (id: number) => {
    setMetrics(metrics.filter(m => m.id !== id));
  };

  return (
    <div className="min-h-screen" style={{ background: '#F6F8FB' }}>
      <header className="h-16 bg-card border-b border-border px-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button onClick={() => router.push('/designer')} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold text-foreground">指标管理</span>
          <span className="text-xs text-muted-foreground">共 {metrics.length} 个指标</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={addMetric}
            className="px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/20"
          >
            <Plus className="w-4 h-4" /> 新增指标
          </button>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Save className="w-4 h-4" /> 保存
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-6">
        {/* 分类筛选 */}
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                filter === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {cat === 'all' ? '全部' : cat}
            </button>
          ))}
        </div>

        {/* 指标列表 */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-container border-b border-border">
                <th className="px-4 py-3 text-left font-semibold text-foreground">指标名称</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">分类</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">描述</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">权重</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">看板显示</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredMetrics.map(metric => (
                <tr key={metric.id} className="border-b border-border hover:bg-surface-container/50">
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={metric.name}
                      onChange={(e) => updateMetric(metric.id, 'name', e.target.value)}
                      className="w-full px-2 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:outline-none text-sm text-foreground"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={metric.category}
                      onChange={(e) => updateMetric(metric.id, 'category', e.target.value)}
                      className="w-20 px-2 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:outline-none text-xs text-muted-foreground"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={metric.description}
                      onChange={(e) => updateMetric(metric.id, 'description', e.target.value)}
                      className="w-full px-2 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:outline-none text-xs text-muted-foreground"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      value={metric.weight}
                      onChange={(e) => updateMetric(metric.id, 'weight', parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 rounded bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:outline-none text-sm text-foreground text-center"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={metric.showInDashboard}
                        onChange={(e) => updateMetric(metric.id, 'showInDashboard', e.target.checked)}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <span className="text-xs text-muted-foreground">显示</span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteMetric(metric.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
