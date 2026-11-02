'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Building2, Star, Settings, X, Sparkles } from 'lucide-react';

interface Hotspot {
  id: string;
  projectId?: number;
  name: string;
  budget: number;
  difficulty: number;
  difficultyLabel: string;
  left: string;
  top: string;
  type: 'main' | 'side' | 'fold';
  leader: { name: string; style: string; title: string };
  technicalDifficulties: string[];
  customerNeeds: string[];
  aiAdvice: string;
  expectedProfit: number;
  winRate: number;
}

// 四档项目（从数据库加载）
const DEFAULT_PROJECTS: Hotspot[] = [
  {
    id: 'project-1',
    projectId: 1,
    name: '单单位内部竞标',
    budget: 100,
    difficulty: 1,
    difficultyLabel: '新手入门',
    left: '20%', top: '40%',
    type: 'side',
    leader: { name: '张建国', style: '重视协同与交付闭环', title: '主管副总经理' },
    technicalDifficulties: ['五人组织关系梳理', '公开信息持续沉淀', '多渠道沟通与拜访策略'],
    customerNeeds: ['项目可落地', '采购流程合规', '一线使用顺畅'],
    aiAdvice: '新版项目一采用张建国、李明辉、王德福、赵晓晨、刘思琪五人结构。先理解组织与公开事实，再围绕交付、合规和使用场景制定人物化策略。',
    expectedProfit: 25,
    winRate: 70,
  },
  {
    id: 'project-2',
    projectId: 2,
    name: '国产化改造项目',
    budget: 300,
    difficulty: 2,
    difficultyLabel: '进阶实训',
    left: '40%', top: '30%',
    type: 'side',
    leader: { name: '陈主任', style: '老虎型（极度自负）', title: '设计院技术室主任' },
    technicalDifficulties: ['双主体并行攻关', '设计院话语权极高', '技术评审一票否决'],
    customerNeeds: ['国产化替代', '技术改造升级', '设计院技术认可'],
    aiAdvice: '设计院中基层技术室主任是核心卡点，手握技术一票否决权。需结合技术诉求+私人软肋双重公关。',
    expectedProfit: 28,
    winRate: 50,
  },
  {
    id: 'project-3',
    projectId: 3,
    name: '大型央企升级项目',
    budget: 1000,
    difficulty: 3,
    difficultyLabel: '高阶实训',
    left: '60%', top: '45%',
    type: 'side',
    leader: { name: '周副总工', style: '老虎型（极度自负）', title: '技术副总工' },
    technicalDifficulties: ['多部门制衡', '双主线分支', '线索链路最长', '容错率极低'],
    customerNeeds: ['千万级设备升级', '多平级部门协调', '中间人搭桥引荐'],
    aiAdvice: '技术副总工和设备分管副总掌握最终决定权，必须通过总经理亲属或服务商X总搭桥。两条主线自由选择。',
    expectedProfit: 35,
    winRate: 30,
  },
  {
    id: 'project-4',
    projectId: 4,
    name: '一体化总包解决方案',
    budget: 200,
    difficulty: 4,
    difficultyLabel: '专家挑战',
    left: '80%', top: '35%',
    type: 'side',
    leader: { name: '钱副局长', style: '老虎型', title: '分管高层领导' },
    technicalDifficulties: ['需求挖掘', '价值营销', '方案重塑', '策略门槛极高'],
    customerNeeds: ['标准化物资采购', '竞品低价碾压', '挖掘隐性痛点'],
    aiAdvice: '单品报价完全劣势，唯一破局路径是打通各层级，挖掘隐性痛点，将单一采购升级为一体化总包方案。',
    expectedProfit: 30,
    winRate: 35,
  },
];

export default function StartPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [identity, setIdentity] = useState<{ displayName: string; role: string; subRole?: string } | null>(null);
  const [playMode, setPlayMode] = useState<'solo' | 'multiplayer'>('solo');
  const canSelectMode = identity !== null && (identity.role !== 'player' || identity.subRole === 'enterprise_employee');
  const effectivePlayMode = canSelectMode ? playMode : 'solo';
  const [roomCode, setRoomCode] = useState('');
  const [companyId, setCompanyId] = useState('player-company');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  // 读取身份（顶栏显示个人名）
  useEffect(() => {
    let raw = localStorage.getItem('weixun_identity');
    if (!raw) {
      const match = document.cookie.match(/(?:^| )weixun_identity=([^;]+)/);
      if (match) raw = decodeURIComponent(match[1]);
    }
    if (raw) {
      try {
        const data = JSON.parse(raw);
        setIdentity({ displayName: data.displayName, role: data.role, subRole: data.subRole });
      } catch {}
    }
  }, []);

  // 派生：等级 / 职称（根据 role）
  const roleMeta: Record<string, { title: string; level: number; avatarChar: string }> = {
    platform_designer: { title: '平台设计师', level: 10, avatarChar: '设' },
    enterprise_admin: { title: '企业管理员', level: 8,  avatarChar: '管' },
    trainer:           { title: '培训教练',   level: 6,  avatarChar: '教' },
    player:            { title: '销售经理',   level: 4,  avatarChar: '销' },
  };
  const meta = identity ? roleMeta[identity.role] || roleMeta.player : { title: '销售经理', level: 4, avatarChar: '销' };
  const leaderPortraits: Record<string, string> = {
    张建国: '/assets/people/zhang-jianguo.png',
    李明辉: '/assets/people/li-minghui.png',
    王德福: '/assets/people/wang-defu.png',
    赵晓晨: '/assets/people/zhao-xiaochen.png',
    刘思琪: '/assets/people/liu-siqi.png',
  };

  const [projects, setProjects] = useState<Hotspot[]>(DEFAULT_PROJECTS);
  
  // 加载项目数据
  useEffect(() => {
    fetch('/api/game-data/projects')
      .then(r => r.json())
      .then(d => {
        if (d.data && d.data.length > 0) {
          // 用数据库数据更新项目名称和描述
          setProjects(prev => prev.map(p => {
            const dbProject = d.data.find((dp: { project_id: number }) => dp.project_id === p.projectId);
            if (dbProject) {
              return { ...p, name: dbProject.name, aiAdvice: dbProject.description };
            }
            return p;
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleStart = async () => {
    if (!selected) return;
    if (selected.id !== 'project-1') return;
    if (effectivePlayMode === 'multiplayer') {
      if (!roomCode.trim()) { setJoinError('请输入联机房间码'); return; }
      setJoining(true);
      setJoinError('');
      try {
        const response = await fetch('/api/multiplayer/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session': localStorage.getItem('weixun_session') || '' }, body: JSON.stringify({ roomCode, companyId }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加入房间失败');
        router.push(`/game?location=${selected.id}&mode=multiplayer&roomId=${encodeURIComponent(data.data.roomId)}&sessionId=${encodeURIComponent(data.data.sessionId)}`);
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : '加入房间失败');
        setJoining(false);
      }
      return;
    }
    // The player-facing solo flow has one authoritative client: the formal
    // game page owns saves, commands, chat and settlement.  The five-person
    // preview remains available only as a design/test route.
    router.push('/game?location=project-1&mode=solo');
  };

  return (
    <div className="min-h-screen text-[#17223a]" style={{ background: 'radial-gradient(1100px 520px at 12% -6%,rgba(47,107,255,.075),transparent 60%),radial-gradient(900px 480px at 96% 6%,rgba(123,75,234,.055),transparent 55%),linear-gradient(180deg,#f5f8fd,#eef2f9 46%,#ebf0f8)' }}>
      <header className="sticky top-0 z-20 flex min-h-[68px] items-center justify-between gap-4 border-b border-[#d6e2f2] bg-white/85 px-4 shadow-[0_10px_26px_rgba(30,47,77,.05)] backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#4f8dff] via-[#2b64ec] to-[#2250c8] text-white shadow-[0_7px_18px_rgba(47,107,255,.28)]"><Building2 className="h-5 w-5" /></div><div><div className="text-sm font-bold text-[#17223a]">竞标博弈</div><div className="mt-0.5 text-[10px] text-[#68758c]">销售攻关实训 · 正式项目</div></div></div>
        <div className="hidden items-center gap-3 border-l border-[#e0e8f2] pl-5 text-xs sm:flex"><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#4f8dff] to-[#2250c8] text-xs font-bold text-white">{meta.avatarChar}</div><div><div className="font-semibold text-[#263550]">{identity?.displayName || '游客'}</div><div className="mt-0.5 text-[10px] text-[#68758c]">{meta.title} · Lv.{meta.level}</div></div><Settings className="ml-2 h-4 w-4 text-[#8a99b2]" aria-hidden="true" /></div>
      </header>

      <main className="mx-auto w-full max-w-[1260px] px-4 pb-12 pt-6 sm:px-6">
        <section className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><div className="text-[10px] font-black uppercase tracking-[.16em] text-[#2f6bff]">PROJECT SELECTION · SALES SIMULATION</div><h1 className="mt-1.5 bg-gradient-to-r from-[#1b2a47] via-[#244879] to-[#2f6bff] bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-[28px]">销售攻关实训 · 项目入口</h1><p className="mt-2 max-w-[760px] text-xs leading-6 text-[#68758c]">选择一个项目开始推进。项目一已开放正式五人对局，客户沟通、20 分钟项目倒计时、行动点与最终结算将写入正式存档。</p></div>
          <div className="inline-flex w-fit items-center rounded-full border border-[#cfdcf4] bg-gradient-to-b from-white to-[#f2f6ff] px-3 py-2 text-[10px] font-extrabold text-[#2c5cd0] shadow-[0_5px_16px_rgba(47,107,255,.1)]"><span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-[#15966f] shadow-[0_0_8px_rgba(21,150,111,.55)]" />正式存档 · 已启用</div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="可选实训项目">
          {projects.map((project, index) => {
            const available = project.id === 'project-1';
            return <article key={project.id} className={`group relative min-h-[184px] overflow-hidden rounded-2xl border bg-gradient-to-b from-white to-[#fbfdff] p-4 shadow-[0_4px_16px_rgba(20,40,80,.05)] transition duration-300 ${available ? 'border-[#dbe4f0] hover:-translate-y-1 hover:border-[#c6d6ee] hover:shadow-[0_12px_30px_rgba(20,40,80,.1)]' : 'border-[#e2eaf4] opacity-60 saturate-50'}`} style={{ animation: `fade-up .45s ease ${index * 55}ms both` }}>
              {available && <span className="absolute inset-x-8 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#2f6bff] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />}
              <div className="flex items-start justify-between gap-2"><span className="text-[9px] font-black tracking-[.14em] text-[#8795aa]">PROJECT 0{project.projectId ?? index + 1}</span><span className={`rounded-full border px-2 py-1 text-[9px] font-extrabold ${available ? 'border-[#c8ecdf] bg-[#e6f8f1] text-[#0f7a59]' : 'border-[#e2eaf4] bg-[#f1f5fa] text-[#68758c]'}`}>{available ? '可开始' : '暂未开放'}</span></div>
              <h2 className="mt-3 text-base font-bold text-[#17223a]">{project.name}</h2><div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#68758c]"><span>{project.difficultyLabel}</span><span className="text-[#d9951a]">{'★'.repeat(project.difficulty)}<span className="text-[#d8e0eb]">{'★'.repeat(5 - project.difficulty)}</span></span></div>
              <div className="mt-4 text-2xl font-black leading-none text-[#b97a10]">{project.budget}<span className="ml-1 text-[11px] font-semibold text-[#8795aa]">万预算</span></div>
              <button onClick={() => available && setSelected(project)} disabled={!available} className={`mt-4 w-full rounded-[10px] border px-3 py-2.5 text-[11px] font-extrabold transition ${available ? 'border-[#2b64ee] bg-gradient-to-b from-[#4080ff] via-[#2b64ee] to-[#2355d6] text-white shadow-[0_7px_18px_rgba(47,107,255,.24)] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(47,107,255,.34)]' : 'cursor-not-allowed border-[#d5deeb] bg-[#f5f8fc] text-[#96a3b5]'}`}>{available ? '查看项目一' : '暂未开放'}</button>
            </article>;
          })}
        </section>

        <section className="mt-4 grid gap-3 lg:grid-cols-[1.08fr_.92fr]">
          <article className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)]"><div className="text-[9px] font-black uppercase tracking-[.14em] text-[#2f6bff]">PROJECT 01</div><h2 className="mt-1.5 text-xl font-bold text-[#17223a]">单单位内部竞标</h2><p className="mt-2 text-xs leading-6 text-[#68758c]">围绕关键客户人物推进项目，从组织关系、公开信息与真实沟通中形成可验证的方案和决策依据。</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{[{ label: '客户需求', items: ['项目可落地', '采购流程合规', '一线使用顺畅'] }, { label: '项目特点', items: ['五人组织关系梳理', '公开信息持续沉淀', '多渠道沟通与拜访'] }].map((group) => <div key={group.label} className="rounded-xl border border-[#e9eff7] bg-[#f7fafd] p-3"><strong className="mb-2 block text-[11px] text-[#33445f]">{group.label}</strong><div className="flex flex-wrap gap-1.5">{group.items.map((item) => <span key={item} className="rounded-full border border-[#dbe4f0] bg-white px-2 py-1 text-[9px] text-[#52627c]">{item}</span>)}</div></div>)}</div></article>
          <article className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)]"><div className="text-[9px] font-black uppercase tracking-[.14em] text-[#2f6bff]">HOW TO START</div><h2 className="mt-1.5 text-[15px] font-bold text-[#17223a]">进入正式项目</h2><p className="mt-2 text-xs leading-6 text-[#68758c]">选择项目一查看负责人、客户诉求和本局模式，然后创建或加入一场正式对局。</p><div className="mt-4 rounded-xl border border-[#d8e4f6] bg-[#f4f8fe] px-3 py-2.5 text-[10px] leading-5 text-[#41547a]">正式模式使用服务端存档；项目计时、拜访、招标规则与三家供应商结算共用同一份对局数据。</div></article>
        </section>

        {/* 保留项目详情弹窗和正式开局流程。 */}
        {selected && (
          <>
            <div
              className="fixed inset-0 z-[100] bg-[#172642]/40 backdrop-blur-[7px]"
              onClick={() => setSelected(null)}
            />
            <div className="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center p-4">
              <div className="pointer-events-auto flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[17px] border border-white/80 bg-gradient-to-b from-white to-[#f9fbfe] shadow-[0_30px_90px_rgba(15,30,60,.32),0_0_70px_rgba(47,107,255,.14)]">
                {/* 头部 - 固定 */}
                <div className="flex-shrink-0 border-b border-[#e7edf6] bg-gradient-to-b from-[#f7faff] to-white px-5 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#eaf2ff] text-[#2f6bff]">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-[#17223a]">{selected.name}</h2>
                        <div className="flex items-center gap-1 mt-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`h-3 w-3 ${i < selected.difficulty ? 'fill-[#df9416] text-[#df9416]' : 'text-[#dbe4f0]'}`} />
                          ))}
                          <span className="ml-1.5 text-[10px] text-[#68758c]">{selected.difficultyLabel}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-[#8a99b2] transition hover:rotate-90 hover:bg-[#f1f5fa] hover:text-[#d94c60]" aria-label="关闭项目详情">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* 内容区 - 可滚动 */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">

                {/* 项目信息 */}
                <div className="mb-4 rounded-xl border border-[#e9eff7] bg-[#f7fafd] p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#68758c]">项目信息</div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-[#68758c]">项目预算</span><span className="font-semibold text-[#17223a] num">¥{selected.budget}万</span></div>
                    <div className="flex justify-between"><span className="text-[#68758c]">交付周期</span><span className="font-semibold text-[#17223a]">5 个月</span></div>
                    <div className="flex justify-between"><span className="text-[#68758c]">参与竞品</span><span className="font-semibold text-[#17223a]">3 家</span></div>
                  </div>
                </div>

                {/* 技术难点 */}
                <div className="mb-4">
                  <div className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-[#33445f]">技术难点</div>
                  <div className="space-y-1.5">
                    {selected.technicalDifficulties.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] leading-5 text-[#68758c]">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2f6bff]" />
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 客户诉求 */}
                <div className="mb-4">
                  <div className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-[#33445f]">客户核心诉求</div>
                  <div className="space-y-1.5">
                    {selected.customerNeeds.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] leading-5 text-[#68758c]">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#15966f]" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 决策人 */}
                <div className="mb-4 rounded-xl border border-[#e2eaf4] bg-[#fafcfe] p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#33445f]">当前已知负责人</div>
                  <div className="flex items-center gap-3">
                    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#dce9ff] to-[#d9d0fb] text-base font-bold text-[#2f6bff] ring-2 ring-white shadow-sm">
                      <span>{selected.leader.name[0]}</span>
                      {leaderPortraits[selected.leader.name] && <Image src={leaderPortraits[selected.leader.name]} alt="" width={48} height={48} className="absolute inset-0 h-full w-full object-cover" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-[#17223a]">{selected.leader.name}</div>
                      <div className="mt-0.5 text-[10px] text-[#68758c]">{selected.leader.title} · {selected.leader.style}</div>
                    </div>
                  </div>
                </div>

                {/* AI 战前预估 */}
                <div className="mb-2 rounded-xl border border-[#d9e5fa] bg-gradient-to-br from-[#f4f8ff] to-[#faf8ff] p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#2f6bff]">
                    <Sparkles className="h-3.5 w-3.5" /> AI 战前预估
                  </div>
                  <div className="mb-3 text-[11px] leading-5 text-[#41547a]">{selected.aiAdvice}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-white/80 bg-white/80 p-2">
                      <div className="text-[9px] text-[#68758c]">预期利润率</div>
                      <div className="text-base font-black text-[#2f6bff] num">{selected.expectedProfit}%</div>
                    </div>
                    <div className="rounded-lg border border-white/80 bg-white/80 p-2">
                      <div className="text-[9px] text-[#68758c]">胜率预估</div>
                      <div className="text-base font-black text-[#2f6bff] num">{selected.winRate}%</div>
                    </div>
                    <div className="rounded-lg border border-white/80 bg-white/80 p-2">
                      <div className="text-[9px] text-[#68758c]">难度系数</div>
                      <div className="text-base font-black text-[#2f6bff] num">{(selected.difficulty * 0.95).toFixed(1)}</div>
                    </div>
                  </div>
                </div>

                {canSelectMode && <div className="mx-5 mb-2 rounded-xl border border-[#e2eaf4] bg-[#f7fafd] p-4 sm:mx-6">
                  <div className="text-[11px] font-bold text-[#33445f]">游戏模式</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => setPlayMode('solo')} className={`rounded-[10px] border px-3 py-2.5 text-[10px] font-bold transition ${playMode === 'solo' ? 'border-[#8fb2ff] bg-gradient-to-b from-[#f3f7ff] to-[#e9f0ff] text-[#2c5cd0] shadow-[0_0_0_1px_#c4d7ff,0_8px_20px_rgba(47,107,255,.1)]' : 'border-[#dde6f1] bg-white text-[#52627c] hover:border-[#bccfe9]'}`}>单机 · 正式五人对局</button>
                    <button onClick={() => setPlayMode('multiplayer')} className={`rounded-[10px] border px-3 py-2.5 text-[10px] font-bold transition ${playMode === 'multiplayer' ? 'border-[#8fb2ff] bg-gradient-to-b from-[#f3f7ff] to-[#e9f0ff] text-[#2c5cd0] shadow-[0_0_0_1px_#c4d7ff,0_8px_20px_rgba(47,107,255,.1)]' : 'border-[#dde6f1] bg-white text-[#52627c] hover:border-[#bccfe9]'}`}>联机 · 公司均由玩家控制</button>
                  </div>
                  {playMode === 'solo' && <div className="mt-3 rounded-lg border border-[#d9e5fa] bg-[#f4f8ff] px-3 py-2 text-[10px] leading-5 text-[#52627c]">项目计时、行动点、NPC 沟通与最终结算均由服务端会话保存和恢复。</div>}
                  {playMode === 'multiplayer' && <div className="mt-3 grid grid-cols-2 gap-2"><input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="房间码" className="min-w-0 rounded-lg border border-[#dbe4f0] bg-white px-3 py-2 text-xs outline-none transition focus:border-[#6593e8] focus:ring-4 focus:ring-blue-100" /><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="min-w-0 rounded-lg border border-[#dbe4f0] bg-white px-3 py-2 text-xs outline-none focus:border-[#6593e8]"><option value="player-company">我方公司</option><option value="abc-company">ABC公司</option></select></div>}
                  {joinError && <div className="mt-2 text-[11px] text-[#d94c60]">{joinError}</div>}
                </div>}

                {/* 操作按钮 - 固定在底部 */}
                </div>
                <div className="flex flex-shrink-0 gap-2 border-t border-[#e7edf6] px-5 py-4 sm:px-6">
                  <button
                    onClick={() => setSelected(null)}
                    className="flex-1 rounded-[10px] border border-[#d5deeb] bg-gradient-to-b from-white to-[#f5f8fc] py-2.5 text-xs font-bold text-[#33445f] shadow-sm transition hover:-translate-y-0.5 hover:border-[#b9cbe6]"
                  >
                    换个目标
                  </button>
                  <button
                    onClick={handleStart}
                    disabled={selected.id !== 'project-1' || joining}
                    className="flex-1 rounded-[10px] border border-[#2b64ee] bg-gradient-to-b from-[#4080ff] via-[#2b64ee] to-[#2355d6] py-2.5 text-xs font-extrabold text-white shadow-[0_7px_18px_rgba(47,107,255,.26)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(47,107,255,.36)] disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50"
                  >
                    {selected.id === 'project-1' ? joining ? '正在加入...' : effectivePlayMode === 'solo' ? '开始单机模式' : '加入联机模式' : '本期暂未开放'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
