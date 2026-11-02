'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Upload, FileText, Search, Tag, Trash2, ChevronRight,
  Building2, LogOut, ShieldCheck, Database, FilePlus, FolderOpen, Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';

interface Doc {
  id: string;
  title: string;
  category: string;
  size: string;
  updatedAt: string;
  uploader: string;
  aiIndexed: boolean;
}

const SEED_DOCS: Doc[] = [
  { id: 'd1', title: '智慧政务一网通办 · 投标应答话术库', category: '行业方案', size: '2.4 MB', updatedAt: '2026-06-12', uploader: '王老师', aiIndexed: true },
  { id: 'd2', title: '等保三级 2.0 实施要点', category: '合规资质', size: '1.8 MB', updatedAt: '2026-06-08', uploader: '王老师', aiIndexed: true },
  { id: 'd3', title: '主流云厂商 (华为云/阿里云/腾讯云) 横向对比', category: '竞品分析', size: '3.1 MB', updatedAt: '2026-05-30', uploader: '王老师', aiIndexed: true },
  { id: 'd4', title: '医联体信息化项目 · 客户痛点问答', category: '行业方案', size: '1.2 MB', updatedAt: '2026-05-22', uploader: '陈教练', aiIndexed: false },
  { id: 'd5', title: '教育云项目常见技术质疑应对', category: '客户异议', size: '890 KB', updatedAt: '2026-05-15', uploader: '王老师', aiIndexed: true },
];

const CATEGORIES = ['全部', '行业方案', '合规资质', '竞品分析', '客户异议', '招投标模板'];

export default function KnowledgePage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<{ name: string; role: string; permissions: string[] } | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [docs, setDocs] = useState<Doc[]>(SEED_DOCS);

  useEffect(() => {
    let data = localStorage.getItem('weixun_identity');
    if (!data) {
      const match = document.cookie.match(/(?:^| )weixun_identity=([^;]+)/);
      if (match) data = decodeURIComponent(match[1]);
    }
    if (!data) { router.push('/'); return; }
    try { setIdentity(JSON.parse(data)); }
    catch { router.push('/'); }
  }, [router]);

  const handleLogout = () => {
    document.cookie = 'weixun_session=; path=/; max-age=0';
    document.cookie = 'weixun_identity=; path=/; max-age=0';
    localStorage.removeItem('weixun_identity');
    localStorage.removeItem('weixun_session');
    router.push('/');
  };

  const filtered = docs.filter(d =>
    (category === '全部' || d.category === category) &&
    (keyword === '' || d.title.toLowerCase().includes(keyword.toLowerCase()))
  );

  const isDesigner = identity?.role === 'platform_designer';

  const stats = [
    { label: '文档总数', value: docs.length, icon: FileText, color: '#2F6BFF', tintBg: 'rgba(47,107,255,0.10)' },
    { label: 'AI 已索引', value: docs.filter(d => d.aiIndexed).length, icon: Sparkles, color: '#7C3AED', tintBg: 'rgba(124,58,237,0.10)' },
    { label: '本周新增', value: 3, icon: FilePlus, color: '#16A37B', tintBg: 'rgba(22,163,123,0.10)' },
    { label: '总存储量', value: '9.4 MB', icon: Database, color: '#EA580C', tintBg: 'rgba(234,88,12,0.10)' },
  ];

  return (
    <AppShell identity={identity} activeNav="knowledge" roleAccent={identity?.role}>
      <div className="flex items-center justify-between mb-6 animate-fade-up">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            产品知识库
          </h1>
          <p className="text-sm text-muted-foreground mt-2">管理产品文档、竞品资料、应答话术，AI 自动索引并注入对局场景</p>
        </div>
        {isDesigner && (
          <button
            onClick={() => alert('演示：上传文件 — 真实场景会调用 /api/knowledge/upload + 对象存储')}
            className="h-10 px-4 rounded-lg btn-primary text-sm font-medium flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            上传文档
          </button>
        )}
      </div>

      {/* 搜索 + 分类筛选 */}
      <div className="card-elevated p-4 mb-6 flex items-center gap-3 flex-wrap animate-fade-up-1">
        <div className="flex-1 relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索文档标题、关键词..."
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 h-8 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                category === c
                  ? 'btn-primary text-primary-foreground shadow-sm'
                  : 'bg-surface-container text-muted-foreground hover:text-foreground hover:bg-primary/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 4 个统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`card-elevated p-5 flex items-center gap-3 animate-fade-up-${Math.min(idx + 1, 3)}`}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: s.tintBg }}>
                <Icon className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-xl font-semibold text-foreground num">{s.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 文档列表 */}
      <div className="card-elevated overflow-hidden animate-fade-up-2">
        <div className="grid grid-cols-[1fr_120px_100px_120px_120px_80px] gap-4 px-6 py-3 bg-surface-container text-xs font-semibold text-muted-foreground border-b border-border uppercase tracking-wider">
          <div>文档名称</div>
          <div>分类</div>
          <div>大小</div>
          <div>上传者</div>
          <div>更新时间</div>
          <div className="text-right">操作</div>
        </div>
        {filtered.map(d => (
          <div key={d.id} className="grid grid-cols-[1fr_120px_100px_120px_120px_80px] gap-4 px-6 py-4 border-b border-border last:border-0 hover:bg-primary/5 transition-colors items-center text-sm">
            <div className="flex items-center gap-2 text-foreground font-medium min-w-0">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="truncate">{d.title}</span>
              {d.aiIndexed && (
                <span className="badge badge-designer shrink-0">
                  <Sparkles className="w-2.5 h-2.5" />AI
                </span>
              )}
            </div>
            <div className="text-muted-foreground flex items-center gap-1">
              <Tag className="w-3 h-3" />{d.category}
            </div>
            <div className="text-muted-foreground num">{d.size}</div>
            <div className="text-muted-foreground">{d.uploader}</div>
            <div className="text-muted-foreground num">{d.updatedAt}</div>
            <div className="flex items-center gap-1 justify-end">
              {isDesigner && (
                <button className="p-1.5 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-colors" title="删除">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button className="p-1.5 hover:bg-primary/10 rounded text-muted-foreground hover:text-primary transition-colors" title="查看">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
            没有匹配的文档
          </div>
        )}
      </div>
    </AppShell>
  );
}
