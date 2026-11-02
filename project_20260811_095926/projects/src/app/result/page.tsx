'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  FileCheck2,
  FileText,
  Gift,
  HeartHandshake,
  Home,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Swords,
  Target,
  Timer,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { calculateTotalScore, type GameDimension, type GameRuntimeState } from '@/lib/game/state';
import { getProjectOneNpc } from '@/lib/game/project-one';
import type { GameReview } from '@/lib/contracts/game';

const DIMENSION_LABELS: Record<GameDimension, string> = {
  decisionAnalysis: '分析决策',
  relationshipBuilding: '关系建立',
  valuePresentation: '价值呈现',
  objectionHandling: '异议处理',
  informationDiscovery: '提问挖掘',
};
const GIFT_OUTCOME_LABELS: Record<string, string> = {
  delighted_acceptance: '愉快接受，产生了较高即时收益',
  cautious_acceptance: '谨慎接受，同时留下隐藏风险',
  polite_decline: '婉拒，本次没有获得礼品收益',
  firm_rejection: '明确拒绝，并对关系造成负面影响',
  reported: '拒绝并上报，风险立即扩散',
};
const RISK_STATUS_LABELS: Record<string, string> = {
  latent: '风险潜伏',
  triggered: '风险已触发',
  resolved: '已处置',
  exposed: '已暴露',
  hidden: '暂未暴露',
  reported: '已上报',
  rejected: '已拒收',
};

interface OutcomeView {
  fiveDimensionScore?: number;
  publicValueScore?: number;
  personalBenefitScore?: number;
  baseScore?: number;
  compliancePenalty?: number;
  finalScore?: number;
  eligible?: boolean;
  won?: boolean;
  winnerSupplierId?: string;
  winnerSupplierName?: string;
  supplierResults: SupplierResultView[];
}

interface SupplierResultView {
  supplierId: string;
  name: string;
  coreAdvantage: string;
  rank?: number;
}

const NPC_PORTRAITS: Record<string, string> = {
  'P1-001': '/assets/people/zhang-jianguo.png',
  'P1-002': '/assets/people/li-minghui.png',
  'P1-003': '/assets/people/wang-defu.png',
  'P1-004': '/assets/people/zhao-xiaochen.png',
  'P1-005': '/assets/people/liu-siqi.png',
};

interface InteractionSummary {
  npcId: string;
  contactSummary?: string;
  meetingSummary?: string;
  confirmedItems: string[];
  npcCommitments: string[];
  completedTasks: string[];
  endReason?: string;
  nextStep?: string;
}

interface ComplianceView {
  id: string;
  npcId?: string;
  title: string;
  giftType?: string;
  status: string;
  description: string;
  immediateEffect?: string;
  delayedEffect?: string;
  penalty?: number;
}

interface EvidenceView {
  id: string;
  category: 'public' | 'personal';
  text: string;
  source?: string;
  confirmed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstRecord(source: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!source) return null;
  for (const key of keys) {
    const value = asRecord(source[key]);
    if (value) return value;
  }
  return null;
}

function firstArray(source: Record<string, unknown> | null, keys: string[]): unknown[] {
  if (!source) return [];
  for (const key of keys) if (Array.isArray(source[key])) return source[key] as unknown[];
  return [];
}

function firstNumber(source: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function formatTrainingDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(totalSeconds / 60)}分${String(totalSeconds % 60).padStart(2, '0')}秒`;
}

function firstString(source: Record<string, unknown> | null, keys: string[], fallback = ''): string {
  if (!source) return fallback;
  for (const key of keys) if (typeof source[key] === 'string') return source[key] as string;
  return fallback;
}

function clampOutcomeScore(value: number | undefined): number | undefined {
  return typeof value === 'number'
    ? Math.max(0, Math.min(100, Math.round(value * 10) / 10))
    : undefined;
}

function normalizeOutcome(value: unknown, fallbackFiveDimension: number): OutcomeView {
  const raw = asRecord(value);
  const fiveDimensionScore = clampOutcomeScore(firstNumber(raw, ['fiveDimensionScore', 'abilityScore', 'salesCapability'])) ?? fallbackFiveDimension;
  const publicValueScore = clampOutcomeScore(firstNumber(raw, ['publicValueScore', 'publicValue', 'organizationalValue']));
  const personalBenefitScore = clampOutcomeScore(firstNumber(raw, ['personalBenefitScore', 'personalBenefit', 'individualBenefit']));
  const compliancePenalty = Math.max(0, Math.min(30, Math.round(firstNumber(raw, ['compliancePenalty', 'riskPenalty']) ?? 0)));
  const baseScore = clampOutcomeScore(firstNumber(raw, ['baseScore']));
  const finalScore = clampOutcomeScore(firstNumber(raw, ['finalScore', 'score'])) ?? (baseScore !== undefined ? Math.max(0, baseScore - compliancePenalty) : fallbackFiveDimension);
  return {
    fiveDimensionScore,
    publicValueScore,
    personalBenefitScore,
    baseScore,
    compliancePenalty,
    finalScore,
    eligible: typeof raw?.eligible === 'boolean' ? raw.eligible : undefined,
    won: typeof raw?.won === 'boolean' ? raw.won : undefined,
    winnerSupplierId: firstString(raw, ['winnerSupplierId']) || undefined,
    winnerSupplierName: firstString(raw, ['winnerSupplierName']) || undefined,
    supplierResults: firstArray(raw, ['supplierResults']).map((item) => {
      const supplier = asRecord(item);
      return {
        supplierId: firstString(supplier, ['supplierId', 'id']),
        name: firstString(supplier, ['name', 'supplierName'], '供应商'),
        coreAdvantage: firstString(supplier, ['coreAdvantage', 'advantage'], '核心优势尚未配置'),
        rank: firstNumber(supplier, ['rank']),
      };
    }).filter((supplier) => supplier.supplierId || supplier.name !== '供应商'),
  };
}

function getInteractionSummaries(state: GameRuntimeState): InteractionSummary[] {
  const root = asRecord(state);
  const summaries = new Map<string, InteractionSummary>();
  const contacts = firstRecord(root, ['npcContacts']);
  for (const [npcId, raw] of Object.entries(contacts ?? {})) {
    const contact = asRecord(raw);
    if (!contact) continue;
    const status = firstString(contact, ['status']);
    const wechatStatus = firstString(contact, ['wechatStatus']);
    const phoneOutcome = firstString(contact, ['lastPhoneOutcome']);
    const outboundCount = firstNumber(contact, ['outboundCount']) ?? 0;
    const hasActivity = contact.hasReplied === true
      || firstNumber(contact, ['lastContactRound']) !== undefined
      || outboundCount > 0
      || !['', 'not_requested'].includes(wechatStatus)
      || ['unanswered', 'declined', 'call_later'].includes(phoneOutcome);
    if (!hasActivity) continue;

    let contactSummary = status === 'online' || wechatStatus === 'accepted'
      ? '已建立工作微信沟通渠道。'
      : status === 'connected'
        ? '已建立正式联系。'
        : contact.hasReplied === true
          ? '客户已回应过沟通。'
          : '已尝试联系，暂未形成持续沟通。';
    if (phoneOutcome === 'unanswered') contactSummary = '最近一次工作电话暂未接通。';
    else if (phoneOutcome === 'declined') contactSummary = '客户暂未接受本次工作电话。';
    else if (phoneOutcome === 'call_later') contactSummary = '客户建议稍后再进行电话沟通。';
    else if (wechatStatus === 'rejected') contactSummary = '客户暂未接受工作微信申请。';
    else if (wechatStatus === 'later') contactSummary = '客户表示之后再考虑工作微信申请。';

    summaries.set(npcId, {
      npcId,
      contactSummary,
      confirmedItems: [],
      npcCommitments: [],
      completedTasks: [],
    });
  }

  const meetingMinutes = firstArray(root, ['meetingMinutes']);
  for (const raw of meetingMinutes) {
    const minutes = asRecord(raw);
    const npcId = firstString(minutes, ['npcId']);
    if (!minutes || !npcId) continue;
    const existing = summaries.get(npcId) ?? {
      npcId,
      confirmedItems: [],
      npcCommitments: [],
      completedTasks: [],
    };
    summaries.set(npcId, {
      ...existing,
      meetingSummary: firstString(minutes, ['summary']) || '已生成拜访纪要。',
      confirmedItems: firstArray(minutes, ['confirmedItems']).filter((item): item is string => typeof item === 'string').slice(0, 3),
      npcCommitments: firstArray(minutes, ['npcCommitments']).filter((item): item is string => typeof item === 'string').slice(0, 3),
      completedTasks: firstArray(minutes, ['completedTasks']).filter((item): item is string => typeof item === 'string').slice(0, 3),
      endReason: firstString(minutes, ['endReason']) || undefined,
      nextStep: firstString(minutes, ['nextStep']) || undefined,
    });
  }

  return Array.from(summaries.values());
}

function getComplianceEvents(state: GameRuntimeState): ComplianceView[] {
  const raw = firstArray(asRecord(state), ['complianceRisks', 'complianceEvents', 'riskEvents']);
  return raw.map((entry, index) => {
    const item = asRecord(entry);
    const giftType = firstString(item, ['giftType', 'preparationType', 'type', 'kind']);
    const outcome = firstString(item, ['outcome', 'disposition']);
    const exposed = typeof item?.exposed === 'boolean' ? item.exposed : undefined;
    const status = firstString(item, ['status', 'outcome'], exposed === true ? 'exposed' : exposed === false ? 'hidden' : 'recorded');
    return {
      id: firstString(item, ['id', 'riskId'], `risk-${index}`),
      npcId: firstString(item, ['npcId']) || undefined,
      title: firstString(item, ['title'], giftType === 'boundary_gift' ? '高波动边界礼品' : '合规风险事件'),
      giftType: giftType || undefined,
      status,
      description: firstString(item, ['description', 'reason', 'summary'], '本次行为留下了合规风险记录。'),
      immediateEffect: firstString(item, ['immediateEffect', 'shortTermEffect']) || GIFT_OUTCOME_LABELS[outcome] || undefined,
      delayedEffect: firstString(item, ['delayedEffect', 'consequence']) || (status === 'triggered' ? '隐藏风险已在本局推进中触发，并进入最终结算。' : undefined),
      penalty: firstNumber(item, ['penalty', 'scorePenalty']),
    };
  });
}

function evidenceItems(rawValue: unknown, category: EvidenceView['category']): EvidenceView[] {
  if (!Array.isArray(rawValue)) return [];
  return rawValue.map((raw, index) => {
    if (typeof raw === 'string') return { id: `${category}-${index}`, category, text: raw, confirmed: true };
    const item = asRecord(raw);
    return {
      id: firstString(item, ['id', 'evidenceId'], `${category}-${index}`),
      category,
      text: firstString(item, ['statement', 'text', 'content', 'summary', 'claim'], '已记录一条项目证据'),
      source: firstString(item, ['sourceNpcName', 'npcId', 'source']) || undefined,
      confirmed: typeof item?.confirmed === 'boolean' ? item.confirmed : firstString(item, ['status'], 'confirmed') !== 'unconfirmed',
    };
  });
}

function getEvidence(state: GameRuntimeState): EvidenceView[] {
  const evidence = firstRecord(asRecord(state), ['outcomeEvidence', 'evidenceLedger']);
  return [
    ...evidenceItems(evidence?.publicValue, 'public'),
    ...evidenceItems(evidence?.personalBenefit, 'personal'),
  ];
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#eff3f9] text-[#68758c]">正在生成赛后报告...</div>}>
      <ResultInner />
    </Suspense>
  );
}

function ResultInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get('sessionId') || '';
  const [state, setState] = useState<GameRuntimeState | null>(null);
  const [outcomeSource, setOutcomeSource] = useState<unknown>(null);
  const [review, setReview] = useState<GameReview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) {
      setError('缺少对局标识');
      return;
    }
    fetch(`/api/game/sessions/${sessionId}`, { headers: { 'x-session': localStorage.getItem('weixun_session') || '' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取本局结果');
        return response.json();
      })
      .then(async (data) => {
        const restoredState: GameRuntimeState = data.gameSession.state;
        setState(restoredState);
        const stateRecord = asRecord(restoredState);
        setOutcomeSource(data.gameSession.outcome ?? data.outcome ?? stateRecord?.outcome ?? stateRecord?.gameOutcome ?? stateRecord?.result);
        if (restoredState.status !== 'playing') {
          try {
            const response = await fetch(`/api/game/sessions/${sessionId}/review`, { method: 'POST', headers: { 'x-session': localStorage.getItem('weixun_session') || '' } });
            if (response.ok) setReview((await response.json()).review);
          } catch {
            // AI复盘失败时仍展示可复算的确定性结果。
          }
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '结果加载失败'));
  }, [sessionId]);

  const dimensions = useMemo(() => state
    ? Object.entries(state.dimensions).map(([key, score]) => ({ key: key as GameDimension, name: DIMENSION_LABELS[key as GameDimension], score }))
    : [], [state]);

  if (error) return <div className="flex min-h-screen items-center justify-center bg-[#eff3f9] text-[#d94c60]">{error}</div>;
  if (!state) return <div className="flex min-h-screen items-center justify-center bg-[#eff3f9] text-[#68758c]">正在读取真实对局数据...</div>;

  const fiveDimensionFallback = calculateTotalScore(state.dimensions);
  const outcome = normalizeOutcome(outcomeSource, fiveDimensionFallback);
  const finalScore = outcome.finalScore ?? fiveDimensionFallback;
  const root = asRecord(state);
  const playerSupplierId = firstString(root, ['companyId'], 'player-company');
  const isWin = outcome.winnerSupplierId
    ? outcome.winnerSupplierId === playerSupplierId
    : outcome.won ?? outcome.eligible ?? state.status === 'won';
  const strongest = dimensions.reduce((best, item) => item.score > best.score ? item : best, dimensions[0]);
  const weakest = dimensions.reduce((worst, item) => item.score < worst.score ? item : worst, dimensions[0]);
  const interactions = getInteractionSummaries(state);
  const complianceEvents = getComplianceEvents(state);
  const evidence = getEvidence(state);
  const supplierResults = [...outcome.supplierResults].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  const winningSupplier = outcome.supplierResults.find((supplier) => supplier.supplierId === outcome.winnerSupplierId)
    ?? supplierResults.find((supplier) => supplier.rank === 1);
  const objectiveWinnerReason = winningSupplier
    ? `${winningSupplier.name}凭借“${winningSupplier.coreAdvantage}”以及本次方案表现，在客户关注重点与供应能力的综合比较中排名第一。`
    : '客户综合比较了本次项目需求、方案表现与各家供应商能力后，选出了最终中标者。';
  const cumulativeSpent = firstNumber(root, ['cumulativeSpentPoints', 'totalActionPointsSpent']) ?? 0;
  const projectTimer = firstRecord(root, ['projectTimer']);
  const elapsedMs = firstNumber(projectTimer, ['elapsedMs']);
  const trainingDuration = elapsedMs === undefined ? '未记录' : formatTrainingDuration(elapsedMs);
  const completeHybridData = outcome.publicValueScore !== undefined && outcome.personalBenefitScore !== undefined;
  const restartGame = () => {
    localStorage.removeItem(`game-session:${state.scenarioCode}`);
    router.push('/start');
  };

  const outcomeCards = [
    { label: '五维能力', value: outcome.fiveDimensionScore, weight: '40%', icon: BarChart3, color: 'blue' },
    { label: '对公价值', value: outcome.publicValueScore, weight: '30%', icon: Building2, color: 'emerald' },
    { label: '个人合理收益', value: outcome.personalBenefitScore, weight: '20%', icon: HeartHandshake, color: 'amber' },
  ] as const;

  return (
    <div className="min-h-screen text-[#17223a]" style={{ background: 'radial-gradient(1100px 520px at 12% -6%,rgba(47,107,255,.075),transparent 60%),radial-gradient(900px 480px at 96% 6%,rgba(123,75,234,.055),transparent 55%),linear-gradient(180deg,#f5f8fd,#eef2f9 46%,#ebf0f8)' }}>
      <main className="mx-auto max-w-[1220px] px-4 pb-12 pt-5 sm:px-6">
        <section className="relative overflow-hidden rounded-[17px] border border-[rgba(90,130,200,.35)] p-6 text-white shadow-[0_18px_50px_rgba(24,43,77,.13)] sm:p-7" style={{ background: 'radial-gradient(700px 320px at 88% -20%,rgba(246,189,79,.16),transparent 55%),linear-gradient(135deg,#101b31,#16263f 52%,#0c1526)' }}>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_42%,rgba(190,214,250,.09)_50%,transparent_58%)]" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/[.08] text-[#ffd582] shadow-inner backdrop-blur"><Trophy className="h-9 w-9" /></div>
              <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#b9cdfc]">PROJECT 01 · FINAL REVIEW</div><h1 className="mt-1 bg-gradient-to-r from-white via-white to-[#ffd582] bg-clip-text text-3xl font-black text-transparent">{isWin ? '中标' : '本场未中标'}</h1><div className="mt-2 text-xs text-[#c7d2df]">三家供应商按客户关注重点、方案表现与核心优势综合比较。</div></div>
            </div>
            <div className="flex items-end gap-6">
              <div><div className="text-[10px] text-[#c6d1df]">我方方案表现分</div><div className="bg-gradient-to-b from-[#ffe9b8] to-[#f6bd4f] bg-clip-text text-4xl font-black text-transparent drop-shadow-[0_0_18px_rgba(246,189,79,.28)] num">{finalScore}<span className="text-base font-medium text-[#c6d1df]"> / 100</span></div></div>
              {(outcome.compliancePenalty ?? 0) > 0 && <div className="rounded-xl bg-red-500/25 px-4 py-3"><div className="text-[10px] text-white/70">合规扣分</div><div className="text-xl font-bold">-{outcome.compliancePenalty}</div></div>}
            </div>
          </div>
          <div className="relative mt-6 grid gap-3 border-t border-white/15 pt-5 sm:grid-cols-4">
            <SummaryStat icon={Target} label="基础结果" value={outcome.baseScore !== undefined ? `${outcome.baseScore}分` : '旧存档'} />
            <SummaryStat icon={Timer} label="实训耗时" value={trainingDuration} />
            <SummaryStat icon={Sparkles} label="行动点" value={cumulativeSpent ? `已消耗${cumulativeSpent}点` : `剩余${state.actionPoints}点`} />
            <SummaryStat icon={FileCheck2} label="确认价值证据" value={`${evidence.filter((item) => item.confirmed).length}条`} />
          </div>
        </section>

        {!completeHybridData && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#f2d694] bg-[#fff9ea] p-4 text-xs leading-5 text-[#7d5715]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            这是旧版或迁移中的对局，部分「对公价值、个人合理收益」复盘数据尚未记录。已保留原五维结果，不会用虚构数值补齐缺失项。
          </div>
        )}

        <section className="mt-6 rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
          <div className="flex items-center gap-2"><Swords className="h-5 w-5 text-[#2f6bff]" /><h2 className="text-base font-bold">三家供应商中标结果</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">排名综合客户意见、供应商核心优势和方案表现；供应商精确竞争分保留为后台推演数据。</p>
          <div className="mt-4 rounded-xl border border-[#cfdcf4] bg-gradient-to-br from-[#f4f8ff] to-[#edf4ff] p-4">
            <div className="text-[10px] font-bold text-[#2c5cd0]">最终中标供应商</div>
            <div className="mt-1 text-lg font-extrabold text-[#17223a]">{outcome.winnerSupplierName ?? '本局存档未记录中标供应商'}</div>
            <p className="mt-2 text-sm leading-6 text-[#33445f]">{objectiveWinnerReason}</p>
          </div>
          {supplierResults.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {supplierResults.map((supplier) => {
                const isWinner = supplier.supplierId === outcome.winnerSupplierId;
                return <article key={supplier.supplierId || supplier.name} className={`rounded-xl border p-4 shadow-[0_2px_8px_rgba(24,43,77,.04)] ${isWinner ? 'border-[#bde5d6] bg-gradient-to-b from-[#f0faf6] to-[#e7f7f0]' : 'border-[#e2eaf4] bg-gradient-to-b from-white to-[#fafcfe]'}`}>
                  <div className="flex items-start justify-between gap-2"><div><div className="text-sm font-bold">{supplier.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{supplier.coreAdvantage}</div></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${isWinner ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container text-muted-foreground'}`}>{isWinner ? '中标' : supplier.rank ? `第 ${supplier.rank} 名` : '参与竞标'}</span></div>
                  <div className="mt-3 text-[10px] text-muted-foreground">综合客户意见与本次方案表现进行评定</div>
                </article>;
              })}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
          <div className="flex items-center gap-2"><Award className="h-5 w-5 text-[#2f6bff]" /><h2 className="text-base font-bold">混合结果构成</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">基础分综合本局已记录的方案与价值指标；最终分再扣除已触发的合规风险。</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {outcomeCards.map((item) => <MetricCard key={item.label} {...item} />)}
          </div>
          {(outcome.baseScore !== undefined || outcome.compliancePenalty !== undefined) && <div className="mt-5 flex flex-wrap items-center justify-center gap-3 rounded-xl bg-surface-container p-4 text-sm"><span>基础分 <strong>{outcome.baseScore ?? '—'}</strong></span><span className="text-muted-foreground/40">−</span><span>合规惩罚 <strong className="text-destructive">{outcome.compliancePenalty ?? 0}</strong></span><span className="text-muted-foreground/40">=</span><span>我方方案表现分 <strong className="text-primary">{finalScore}</strong></span></div>}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
            <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#2f6bff]" /><h2 className="text-base font-bold">五维销售能力</h2></div>
            <div className="mt-4 h-64 w-full" aria-label="五维销售能力雷达图">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={dimensions} outerRadius="72%">
                  <PolarGrid stroke="#CBD5E1" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="能力得分" dataKey="score" stroke="#2563EB" fill="#3B82F6" fillOpacity={0.28} />
                  <Tooltip formatter={(value) => [`${Number(value)}分`, '能力得分']} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-3">
              {dimensions.map((dimension) => <ScoreBar key={dimension.key} label={dimension.name} value={dimension.score} />)}
            </div>
          </section>
          <section className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
            <div className="flex items-center gap-2"><Users className="h-5 w-5 text-[#7b4bea]" /><h2 className="text-base font-bold">人物互动反馈</h2></div>
            <p className="mt-1 text-xs text-muted-foreground">以下摘要来自公开联络状态和已保存的拜访纪要。</p>
            <div className="mt-4 max-h-[330px] space-y-3 overflow-y-auto pr-1">
              {interactions.length === 0 && <EmptyReport text="本局尚未形成可展示的联络或拜访记录。" />}
              {interactions.map((interaction) => {
                const npc = getProjectOneNpc(interaction.npcId);
                const endReasonLabel: Record<string, string> = {
                  completed: '完成关键沟通任务',
                  player: '我方主动结束交流',
                  npc_left: '客户临时离场',
                  turn_limit: '达到会谈轮次上限',
                };
                return <article key={interaction.npcId} className="rounded-xl border border-[#e5edf6] bg-gradient-to-b from-white to-[#fafcfe] p-3 transition-colors hover:border-[#c6d6ee]">
                  <div className="mb-3 flex items-center gap-2"><div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#4f8dff] to-[#2250c8] font-bold text-white ring-2 ring-white shadow-sm">{npc?.name.slice(0, 1) ?? <UserRound className="h-4 w-4" />}{NPC_PORTRAITS[interaction.npcId] && <Image src={NPC_PORTRAITS[interaction.npcId]} alt="" width={40} height={40} className="absolute inset-0 h-full w-full object-cover" />}</div><div><div className="text-xs font-bold">{npc?.name ?? interaction.npcId}</div><div className="text-[10px] text-muted-foreground">{npc?.title ?? '关键联系人'}</div></div></div>
                  {interaction.contactSummary && <div className="mb-2 rounded-lg bg-surface-container px-3 py-2 text-[11px] text-muted-foreground">{interaction.contactSummary}</div>}
                  {interaction.meetingSummary && <div className="space-y-2 text-[11px] leading-5">
                    <div className="flex flex-wrap gap-1.5"><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">拜访纪要</span>{interaction.endReason && <span className="rounded-full bg-surface-container px-2 py-1 text-muted-foreground">{endReasonLabel[interaction.endReason] ?? '拜访已结束'}</span>}</div>
                    <p>{interaction.meetingSummary}</p>
                    {interaction.completedTasks.length > 0 && <div><span className="font-semibold">完成事项：</span>{interaction.completedTasks.join('、')}</div>}
                    {interaction.confirmedItems.length > 0 && <div><span className="font-semibold">已确认：</span>{interaction.confirmedItems.join('；')}</div>}
                    {interaction.npcCommitments.length > 0 && <div><span className="font-semibold">客户承诺：</span>{interaction.npcCommitments.join('；')}</div>}
                    {interaction.nextStep && <div className="text-muted-foreground"><span className="font-semibold">后续：</span>{interaction.nextStep}</div>}
                  </div>}
                </article>;
              })}
            </div>
          </section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
            <div className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-emerald-600" /><h2 className="text-base font-bold">价值证据账本</h2></div>
            <div className="mt-4 space-y-4">
              {(['public', 'personal'] as const).map((category) => {
                const items = evidence.filter((item) => item.category === category);
                return <div key={category}><div className="mb-2 text-xs font-bold">{category === 'public' ? '对公价值' : '个人合理收益'}</div>{items.length === 0 ? <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">本局尚未形成可验证证据</div> : <div className="space-y-2">{items.map((item) => { const sourceNpc = item.source ? getProjectOneNpc(item.source) : null; return <div key={item.id} className={`rounded-xl border p-3 text-xs ${item.confirmed ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-surface-container'}`}><div className="flex items-start gap-2"><FileCheck2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.confirmed ? 'text-emerald-600' : 'text-muted-foreground'}`} /><span>{item.text}</span></div>{item.source && <div className="mt-1 pl-5 text-[10px] text-muted-foreground">来源：{sourceNpc?.name ?? item.source}</div>}</div>; })}</div>}</div>;
              })}
            </div>
          </section>
          <section className="rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
            <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-[#d94c60]" /><h2 className="text-base font-bold">礼品与合规事件</h2></div>
            <p className="mt-1 text-xs text-muted-foreground">高波动礼品的即时收益与延迟代价在这里一并复盘。</p>
            <div className="mt-4 space-y-3">
              {complianceEvents.length === 0 && <EmptyReport text="本局没有记录到合规风险事件。" />}
              {complianceEvents.map((event) => <div key={event.id} className={`rounded-xl border p-4 ${['triggered', 'exposed', 'reported', 'rejected'].includes(event.status) ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Gift className="h-4 w-4" /><span className="text-xs font-bold">{event.title}</span></div><span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px]">{RISK_STATUS_LABELS[event.status] ?? event.status}</span></div><p className="mt-2 text-[11px] leading-5">{event.description}</p>{event.immediateEffect && <div className="mt-2 text-[10px] text-emerald-700">即时：{event.immediateEffect}</div>}{event.delayedEffect && <div className="mt-1 text-[10px] text-red-700">后续：{event.delayedEffect}</div>}{event.penalty !== undefined && <div className="mt-2 text-[10px] font-bold text-red-700">结算扣分：{event.penalty}</div>}</div>)}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-[#e0e8f2] bg-gradient-to-b from-white to-[#fbfdff] p-5 shadow-[0_4px_16px_rgba(20,40,80,.05)] sm:p-6">
          <div className="flex items-center gap-2"><Award className="h-5 w-5 text-amber-500" /><h2 className="text-base font-bold">基于本局数据的诊断</h2></div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <DiagnosisCard title="当前优势" tone="success" text={review?.strengths.join('；') || `${strongest.name}为本局最高维度（${strongest.score}分），可回看对应对话与准备动作并固化做法。`} />
            <DiagnosisCard title="优先改进" tone="danger" text={review?.improvements.join('；') || `${weakest.name}为本局最低维度（${weakest.score}分），下一局应围绕该能力设定明确行动目标。`} />
            <DiagnosisCard title="下一步建议" tone="primary" text={review?.nextActions.join('；') || (evidence.length === 0 ? '不要只追求关系热度；应让NPC明确认可对公价值与个人合理收益，并形成可验证证据。' : '复盘关键人物的真实顾虑，围绕缺失证据设计下一次邀约、材料与方案陈述。')} />
          </div>
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button onClick={restartGame} className="flex items-center justify-center gap-2 rounded-xl btn-glass py-3 text-sm font-semibold text-foreground"><RefreshCw className="h-4 w-4" />重新开局</button>
          <button onClick={() => router.push('/ranking')} className="flex items-center justify-center gap-2 rounded-xl btn-warning py-3 text-sm font-semibold"><Trophy className="h-4 w-4" />查看排行榜</button>
          <button onClick={() => router.push('/')} className="flex items-center justify-center gap-2 rounded-xl btn-glass py-3 text-sm font-semibold text-foreground"><Home className="h-4 w-4" />回到首页</button>
          <button onClick={() => window.print()} className="flex items-center justify-center gap-2 rounded-xl btn-primary py-3 text-sm font-semibold"><FileText className="h-4 w-4" />打印报告</button>
        </div>
      </main>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: string }) {
  return <div className="rounded-xl bg-white/10 p-3"><div className="flex items-center gap-1.5 text-[10px] text-white/65"><Icon className="h-3.5 w-3.5" />{label}</div><div className="mt-1 text-lg font-bold">{value}</div></div>;
}

function MetricCard({ label, value, weight, icon: Icon, color }: { label: string; value?: number; weight: string; icon: typeof Trophy; color: 'blue' | 'emerald' | 'amber' | 'violet' }) {
  const colorClasses = { blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', violet: 'bg-violet-50 text-violet-700' };
  return <div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${colorClasses[color]}`}><Icon className="h-4 w-4" /></div><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">权重 {weight}</span></div><div className="mt-4 text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value ?? '—'}{value !== undefined && <span className="text-xs font-medium text-slate-400"> / 100</span>}</div></div>;
}

function ScoreBar({ label, value, compact = false, color = 'blue' }: { label: string; value: number; compact?: boolean; color?: 'blue' | 'amber' | 'violet' }) {
  const barColor = color === 'amber' ? 'bg-amber-500' : color === 'violet' ? 'bg-violet-500' : 'bg-blue-600';
  return <div className={compact ? 'mb-2' : ''}><div className={`mb-1 flex justify-between ${compact ? 'text-[10px]' : 'text-xs'}`}><span className="text-slate-600">{label}</span><strong>{value}</strong></div><div className={`${compact ? 'h-1.5' : 'h-2'} overflow-hidden rounded-full bg-slate-100`}><div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

function DiagnosisCard({ title, text, tone }: { title: string; text: string; tone: 'success' | 'danger' | 'primary' }) {
  const classes = tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'danger' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div className={`rounded-xl border p-4 ${classes}`}><div className="text-xs font-bold">{title}</div><div className="mt-2 text-[11px] leading-5 text-slate-700">{text}</div></div>;
}

function EmptyReport({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-[11px] text-slate-500">{text}</div>;
}
