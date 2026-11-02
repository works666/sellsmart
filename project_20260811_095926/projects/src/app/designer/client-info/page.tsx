'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet, FileText, Plus, Save, Trash2, Edit3, Check, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ProjectInfo {
  id: string;
  label: string;
  key: string;
  value: string;
}

const DEFAULT_PROJECT_INFO: ProjectInfo[] = [
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

export default function ClientInfoPage() {
  const router = useRouter();
  const [description, setDescription] = useState('某市智慧政务一体化平台建设项目，旨在整合全市各部门政务系统，实现数据互通和业务协同。');
  const [projectInfo, setProjectInfo] = useState<ProjectInfo[]>(DEFAULT_PROJECT_INFO);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [importNotice, setImportNotice] = useState('');

  useEffect(() => {
    const raw = window.localStorage.getItem('weixun_designer_excel_import:client-info');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { rows?: ProjectInfo[] };
      if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return;
      setProjectInfo(parsed.rows);
      setImportNotice(`已载入 Excel 草稿，共 ${parsed.rows.length} 条项目信息。`);
    } catch {
      setImportNotice('Excel 草稿读取失败，请重新上传。');
    }
  }, []);

  const handleEdit = (item: ProjectInfo) => {
    setEditingId(item.id);
    setEditValue(item.value);
  };

  const handleSaveEdit = (id: string) => {
    setProjectInfo(projectInfo.map(item =>
      item.id === id ? { ...item, value: editValue } : item
    ));
    setEditingId(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleDelete = (id: string) => {
    setProjectInfo(projectInfo.filter(item => item.id !== id));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newItems = [...projectInfo];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    // Re-number labels
    newItems.forEach((item, i) => { item.label = `R${i + 1}`; });
    setProjectInfo(newItems);
  };

  const handleMoveDown = (index: number) => {
    if (index === projectInfo.length - 1) return;
    const newItems = [...projectInfo];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    // Re-number labels
    newItems.forEach((item, i) => { item.label = `R${i + 1}`; });
    setProjectInfo(newItems);
  };

  const handleAdd = () => {
    if (newKey.trim() && newValue.trim()) {
      const nextNum = projectInfo.length + 1;
      const newItem: ProjectInfo = {
        id: `r${nextNum}`,
        label: `R${nextNum}`,
        key: newKey.trim(),
        value: newValue.trim(),
      };
      setProjectInfo([...projectInfo, newItem]);
      setNewKey('');
      setNewValue('');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="h-14 border-b border-border bg-card px-6 flex items-center gap-4">
        <button
          onClick={() => router.push('/designer')}
          className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">甲方基本信息</h1>
        <button onClick={() => router.push('/designer/data-import-export')} className="ml-auto flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"><FileSpreadsheet className="h-4 w-4" />Excel 导入导出</button>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        {importNotice && <div role="status" className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{importNotice}</div>}
        {/* 项目介绍词 */}
        <div className="bg-card rounded-xl p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">甲方项目介绍词</h2>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground text-sm resize-none focus:outline-none focus:border-primary"
            placeholder="输入项目介绍词..."
          />
        </div>

        {/* 项目相关信息 */}
        <div className="bg-card rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                <FileText className="w-4 h-4 text-warning" />
              </div>
              <h2 className="text-base font-semibold text-foreground">项目相关信息</h2>
            </div>
            <span className="text-xs text-muted-foreground">共 {projectInfo.length} 条</span>
          </div>

          {/* 信息列表 */}
          <div className="space-y-2 mb-6">
            {projectInfo.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted border border-border group"
              >
                {/* 标签 */}
                <span className="text-xs font-mono font-semibold text-primary bg-primary/10 px-2 py-1 rounded min-w-[36px] text-center">
                  {item.label}
                </span>

                {/* 字段名 */}
                <span className="text-sm font-medium text-foreground min-w-[120px]">
                  {item.key}
                </span>

                {/* 字段值 */}
                {editingId === item.id ? (
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 px-3 py-1 rounded bg-background border border-primary text-sm text-foreground focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(item.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                  />
                ) : (
                  <span className="flex-1 text-sm text-muted-foreground">
                    {item.value}
                  </span>
                )}

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {editingId === item.id ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(item.id)}
                        className="w-7 h-7 rounded flex items-center justify-center text-success hover:bg-success/10 transition-colors"
                        title="保存"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                        title="取消"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEdit(item)}
                        className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                        title="编辑"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上移"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === projectInfo.length - 1}
                        className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下移"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 新增区域 */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-3">新增信息</h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-32 px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="字段名"
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="字段值"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              <button
                onClick={handleAdd}
                className="h-9 px-4 rounded-lg bg-primary/10 text-primary text-sm font-medium flex items-center gap-1.5 hover:bg-primary/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                新增
              </button>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <button className="h-10 px-6 rounded-lg bg-primary text-on-primary text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
      </main>
    </div>
  );
}
