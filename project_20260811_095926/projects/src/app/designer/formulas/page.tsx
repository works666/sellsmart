'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save } from 'lucide-react';

interface Formula {
  id: number;
  name: string;
  targetRole: string;
  formula: string;
  description: string;
}

const DEFAULT_FORMULAS: Formula[] = [
  { id: 1, name: '高层支持度计算', targetRole: '高层决策人', formula: '(亲密度 * 0.3 + 信任度 * 0.4 + 方案匹配度 * 0.3) * 权重', description: '计算高层决策人的支持度' },
  { id: 2, name: '中层支持度计算', targetRole: '中层决策人', formula: '(好感度 * 0.3 + 需求理解度 * 0.3 + 成本合理性 * 0.4) * 权重', description: '计算中层决策人的支持度' },
  { id: 3, name: '一线支持度计算', targetRole: '一线执行人', formula: '(沟通有效性 * 0.4 + 技术可行性 * 0.3 + 响应速度 * 0.3) * 权重', description: '计算一线执行人的支持度' },
  { id: 4, name: '综合支持度计算', targetRole: '所有关键人', formula: '高层支持度 * 0.5 + 中层支持度 * 0.3 + 一线支持度 * 0.2', description: '计算所有关键人的综合支持度' },
];

export default function FormulasPage() {
  const router = useRouter();
  const [formulas, setFormulas] = useState<Formula[]>(DEFAULT_FORMULAS);

  const addFormula = () => {
    const newFormula: Formula = {
      id: Date.now(),
      name: '新公式',
      targetRole: '',
      formula: '',
      description: '',
    };
    setFormulas([...formulas, newFormula]);
  };

  const updateFormula = (id: number, field: keyof Formula, value: string) => {
    setFormulas(formulas.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const deleteFormula = (id: number) => {
    setFormulas(formulas.filter(f => f.id !== id));
  };

  return (
    <div className="min-h-screen" style={{ background: '#F6F8FB' }}>
      <header className="h-16 bg-card border-b border-border px-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button onClick={() => router.push('/designer')} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold text-foreground">公式管理</span>
          <span className="text-xs text-muted-foreground">计算被攻略人的实时支持度</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={addFormula}
            className="px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/20"
          >
            <Plus className="w-4 h-4" /> 新增公式
          </button>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/90">
            <Save className="w-4 h-4" /> 保存
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-6">
        <div className="space-y-4">
          {formulas.map(formula => (
            <div key={formula.id} className="bg-card rounded-xl border border-border p-5">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">公式名称</label>
                  <input
                    type="text"
                    value={formula.name}
                    onChange={(e) => updateFormula(formula.id, 'name', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">目标角色</label>
                  <input
                    type="text"
                    value={formula.targetRole}
                    onChange={(e) => updateFormula(formula.id, 'targetRole', e.target.value)}
                    placeholder="如：高层决策人、中层决策人"
                    className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-muted-foreground mb-1 block">公式表达式</label>
                <input
                  type="text"
                  value={formula.formula}
                  onChange={(e) => updateFormula(formula.id, 'formula', e.target.value)}
                  placeholder="如：(亲密度 * 0.3 + 信任度 * 0.4 + 方案匹配度 * 0.3) * 权重"
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">描述</label>
                <textarea
                  value={formula.description}
                  onChange={(e) => updateFormula(formula.id, 'description', e.target.value)}
                  rows={2}
                  placeholder="描述公式的用途和计算逻辑"
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
