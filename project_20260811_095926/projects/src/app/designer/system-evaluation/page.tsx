'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Download, RefreshCw, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import type { SystemEvaluationReport, SystemEvaluationSnapshotMetadata } from '@/lib/contracts/system-evaluation';
import { PROJECT_ONE_FIVE_PERSON_NPCS } from '@/lib/designer/project-one-five-person';
import {
  isSystemEvaluationSnapshotId,
  parseSystemEvaluationThreshold,
  parseSystemEvaluationTurns,
  SYSTEM_EVALUATION_DEFAULT_EXPECTATION,
  SYSTEM_EVALUATION_DEFAULT_TURNS,
  systemEvaluationFilename,
  validateSystemEvaluationTurns,
} from '@/lib/designer/system-evaluation-ui';

type EvaluationSource = 'fresh' | 'snapshot';
type NpcId = keyof typeof PROJECT_ONE_FIVE_PERSON_NPCS;

const NPC_OPTIONS = Object.entries(PROJECT_ONE_FIVE_PERSON_NPCS).map(([id, npc]) => ({
  id: id as NpcId,
  label: `${npc.name} · ${npc.title}`,
}));
const FIELD_CLASS = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const LABEL_CLASS = 'text-sm font-medium text-foreground';

function readSessionToken(): string {
  return window.localStorage.getItem('weixun_session') || '';
}

function readIdentityMarker(): string {
  return window.localStorage.getItem('weixun_identity') || '';
}

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }
  return fallback;
}

function normalizeSnapshotOptions(value: unknown): SystemEvaluationSnapshotMetadata[] {
  if (!value || typeof value !== 'object') return [];
  const body = value as { sessions?: unknown; previewSessions?: unknown; data?: unknown };
  const entries = [body.sessions, body.previewSessions, body.data].find(Array.isArray) as unknown[] | undefined;
  if (!entries) return [];
  return entries.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<SystemEvaluationSnapshotMetadata>;
    if (typeof candidate.previewSessionId !== 'string') return [];
    return [{
      previewSessionId: candidate.previewSessionId,
      version: typeof candidate.version === 'number' ? candidate.version : 0,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    }];
  });
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function stateValue(state: unknown, key: string): string {
  if (!state || typeof state !== 'object' || !(key in state)) return '—';
  const value = (state as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

function terminationReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    npc_task_completed: '客户事项已完成',
    turn_limit: '达到拜访轮次上限',
    player_farewell: '销售人员告辞',
    npc_farewell: '客户告辞',
    npc_time_constraint: '客户时间有限',
  };
  return labels[reason] ?? '会面已正常结束';
}

export default function SystemEvaluationPage() {
  const router = useRouter();
  const [sessionToken, setSessionToken] = useState('');
  const [identityMarker, setIdentityMarker] = useState('');
  const [npcId, setNpcId] = useState<NpcId>('P1-001');
  const [source, setSource] = useState<EvaluationSource>('fresh');
  const [support, setSupport] = useState('20');
  const [pleasantness, setPleasantness] = useState('50');
  const [effectiveContactCount, setEffectiveContactCount] = useState('0');
  const [channel, setChannel] = useState<'visit' | 'email'>('visit');
  const [salesTurnsText, setSalesTurnsText] = useState(SYSTEM_EVALUATION_DEFAULT_TURNS);
  const [expectation, setExpectation] = useState(SYSTEM_EVALUATION_DEFAULT_EXPECTATION);
  const [thresholdText, setThresholdText] = useState('0.7');
  const [snapshotId, setSnapshotId] = useState('');
  const [snapshots, setSnapshots] = useState<SystemEvaluationSnapshotMetadata[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [snapshotRefreshNonce, setSnapshotRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<SystemEvaluationReport | null>(null);
  const activeEvaluationRequest = useRef<AbortController | null>(null);
  const activeSnapshotRequest = useRef<AbortController | null>(null);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    const syncToken = () => {
      const nextToken = readSessionToken();
      const nextIdentity = readIdentityMarker();
      setSessionToken((current) => current === nextToken ? current : nextToken);
      setIdentityMarker((current) => current === nextIdentity ? current : nextIdentity);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'weixun_session' || event.key === 'weixun_identity') syncToken();
    };
    syncToken();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', syncToken);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', syncToken);
      activeEvaluationRequest.current?.abort();
      activeSnapshotRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    activeEvaluationRequest.current?.abort();
    submissionInFlight.current = false;
    activeSnapshotRequest.current?.abort();
    setLoading(false);
    setLoadingSnapshots(false);
    setReport(null);
    setSnapshots([]);
    setSnapshotId('');
    setNotice('');
    if (!sessionToken) return;
    const controller = new AbortController();
    activeSnapshotRequest.current = controller;
    const requestIdentity = identityMarker;
    setLoadingSnapshots(true);
    void fetch('/api/designer/system-evaluation', {
      headers: { 'x-session': sessionToken },
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const body: unknown = await response.json().catch(() => ({}));
      if (controller.signal.aborted || sessionToken !== readSessionToken() || requestIdentity !== readIdentityMarker()) return;
      if (!response.ok || (body && typeof body === 'object' && 'success' in body && (body as { success?: unknown }).success === false)) {
        throw new Error(responseError(body, '预览快照读取失败。'));
      }
      const options = normalizeSnapshotOptions(body);
      if (!controller.signal.aborted) {
        setSnapshots(options);
        setSnapshotId((current) => current && options.some((item) => item.previewSessionId === current)
          ? current
          : options[0]?.previewSessionId || '');
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && sessionToken === readSessionToken() && requestIdentity === readIdentityMarker()) {
        setNotice(error instanceof Error ? error.message : '预览快照读取失败。');
      }
    }).finally(() => {
      if (!controller.signal.aborted && sessionToken === readSessionToken() && requestIdentity === readIdentityMarker()) setLoadingSnapshots(false);
    });
    return () => controller.abort();
  }, [sessionToken, identityMarker, snapshotRefreshNonce]);

  const selectedSnapshot = useMemo(
    () => snapshots.find((item) => item.previewSessionId === snapshotId.trim()) ?? null,
    [snapshots, snapshotId],
  );
  const salesTurns = useMemo(() => parseSystemEvaluationTurns(salesTurnsText), [salesTurnsText]);
  const turnsError = useMemo(() => validateSystemEvaluationTurns(salesTurns), [salesTurns]);
  const threshold = parseSystemEvaluationThreshold(thresholdText);
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
  const freshNumbersValid = [support, pleasantness, effectiveContactCount].every((value) => {
    if (!value.trim()) return false;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  });
  const canSubmit = Boolean(sessionToken)
    && !loading
    && !turnsError
    && threshold !== null
    && expectation.trim().length > 0
    && expectation.length <= 2_000
    && (source === 'fresh' ? freshNumbersValid : isSystemEvaluationSnapshotId(snapshotId));

  const refreshSnapshots = useCallback(() => {
    const currentToken = readSessionToken();
    if (currentToken !== sessionToken) setSessionToken(currentToken);
    setSnapshots([]);
    setSnapshotId('');
    setReport(null);
    setNotice('');
    setSnapshotRefreshNonce((current) => current + 1);
  }, [sessionToken]);

  async function runEvaluation() {
    if (!canSubmit || submissionInFlight.current) return;
    const token = readSessionToken();
    const currentIdentity = readIdentityMarker();
    if (!token || token !== sessionToken || currentIdentity !== identityMarker) {
      setSessionToken(token);
      setIdentityMarker(currentIdentity);
      setReport(null);
      setNotice('登录状态已变化，请确认后重新提交。');
      return;
    }
    activeEvaluationRequest.current?.abort();
    const controller = new AbortController();
    activeEvaluationRequest.current = controller;
    submissionInFlight.current = true;
    setLoading(true);
    setNotice('');
    setReport(null);
    const requestSource = source === 'fresh'
      ? {
          kind: 'fresh',
          support: Number(support),
          pleasantness: Number(pleasantness),
          effectiveContactCount: Number(effectiveContactCount),
        }
      : { kind: 'snapshot', previewSessionId: snapshotId.trim() };
    try {
      const response = await fetch('/api/designer/system-evaluation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          source: requestSource,
          npcId,
          channel,
          salesTurns,
          expectation: expectation.trim(),
          threshold,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (controller.signal.aborted || token !== readSessionToken() || currentIdentity !== readIdentityMarker()) return;
      if (!response.ok || (body && typeof body === 'object' && 'success' in body && (body as { success?: unknown }).success === false)) {
        throw new Error(responseError(body, '系统评测运行失败。'));
      }
      const envelope = body && typeof body === 'object' && 'report' in body
        ? (body as { report?: SystemEvaluationReport }).report
        : body as SystemEvaluationReport;
      if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.rounds)) {
        throw new Error('评测服务返回了无法识别的报告格式。');
      }
      setReport(envelope);
      if (envelope.phase !== 'completed') {
        setNotice(envelope.error?.message || (envelope.phase === 'error'
          ? '评测未能完成，请查看错误信息和已生成内容。'
          : '评测只完成了部分流程，请查看下面已完成的对话和指标错误。'));
      }
    } catch (error) {
      if (!controller.signal.aborted && token === readSessionToken() && currentIdentity === readIdentityMarker()) {
        setNotice(error instanceof Error ? error.message : '系统评测运行失败。');
      }
    } finally {
      if (activeEvaluationRequest.current === controller) {
        activeEvaluationRequest.current = null;
        submissionInFlight.current = false;
        setLoading(false);
      }
    }
  }

  function downloadReport() {
    if (!report) return;
    const content = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = systemEvaluationFilename(report.runId);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const metrics = report?.judge?.metrics ?? [];
  const reportRounds = report?.rounds ?? [];
  const reportNpcName = report?.npc.name || npc.name;
  const reportChannel = report?.channel === 'email' ? '邮件' : '拜访';
  const reportPassed = report?.phase === 'completed' && report.judge?.passed === true;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <button onClick={() => router.push('/designer')} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="返回设计师工作台">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">系统链路评测</h1>
            <p className="text-xs text-muted-foreground">复用项目一五人预览服务端生成与状态链路</p>
          </div>
          <button onClick={refreshSnapshots} disabled={!sessionToken || loadingSnapshots} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loadingSnapshots ? 'animate-spin' : ''}`} />刷新快照
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <section className="space-y-5">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-6">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" />在隔离副本中评测</div>
            <p className="mt-2 text-muted-foreground"> NPC 回复使用五人预览的真实角色提示词、关系状态、记忆和渠道。快照来源会复制你自己的预览状态；新状态来源会建立干净测试状态。每次运行都使用独立会话，不改变正式玩家对局或原预览快照。</p>
            <p className="mt-1 text-xs text-muted-foreground">拜访首版可能跳过准备流程；NPC 与 DeepEval 评委会调用当前已配置的 AI 服务并产生费用。熟悉度没有单独数值，仅按真实历史和有效接触记录判断。结果仅保留在本页，可下载 JSON。</p>
          </div>

          {!sessionToken && <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">请先使用设计师账号登录，再运行系统评测。</div>}
          {notice && <div role="alert" className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{notice}</div>}

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-semibold">评测设置</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">设置 NPC、关系状态、沟通方式和销售话术。最多运行 3 轮。</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>NPC
                <select className={FIELD_CLASS} value={npcId} onChange={(event) => setNpcId(event.target.value as NpcId)}>
                  {NPC_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className={LABEL_CLASS}>关系状态来源
                <select className={FIELD_CLASS} value={source} onChange={(event) => { setSource(event.target.value as EvaluationSource); setReport(null); }}>
                  <option value="fresh">新建状态</option>
                  <option value="snapshot">我的预览快照</option>
                </select>
              </label>
            </div>

            {source === 'fresh' ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className={LABEL_CLASS}>支持度（0–100）
                  <input className={FIELD_CLASS} type="number" min="0" max="100" step="1" value={support} onChange={(event) => setSupport(event.target.value)} />
                </label>
                <label className={LABEL_CLASS}>愉悦度（0–100）
                  <input className={FIELD_CLASS} type="number" min="0" max="100" step="1" value={pleasantness} onChange={(event) => setPleasantness(event.target.value)} />
                </label>
                <label className={LABEL_CLASS}>有效接触次数
                  <input className={FIELD_CLASS} type="number" min="0" max="100" step="1" value={effectiveContactCount} onChange={(event) => setEffectiveContactCount(event.target.value)} />
                  <span className="mt-1 block text-[11px] font-normal text-muted-foreground">这是接触记录，不是熟悉度分数。</span>
                </label>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                {snapshots.length > 0 && <label className={LABEL_CLASS}>从本人快照列表选择
                  <select className={FIELD_CLASS} value={selectedSnapshot?.previewSessionId ?? ''} onChange={(event) => { setSnapshotId(event.target.value); setReport(null); }} disabled={loadingSnapshots}>
                    <option value="">手动输入其他快照 ID</option>
                    {snapshots.map((item) => <option key={item.previewSessionId} value={item.previewSessionId}>
                      {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '预览会话'} · v{item.version} · {item.previewSessionId.slice(0, 8)}
                    </option>)}
                  </select>
                </label>}
                <label className={`${LABEL_CLASS} ${snapshots.length > 0 ? 'mt-3 block' : ''}`}>本人五人预览快照 ID
                  <input className={FIELD_CLASS} type="text" autoComplete="off" spellCheck={false} maxLength={36} placeholder="粘贴 previewSessionId（UUID）" value={snapshotId} onChange={(event) => { setSnapshotId(event.target.value); setReport(null); }} />
                </label>
                {loadingSnapshots && <p className="mt-2 text-[11px] text-muted-foreground">正在读取本人快照列表…</p>}
                {!loadingSnapshots && snapshots.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">列表没有可选快照时，可直接粘贴本人预览会话 ID；服务端会验证归属。</p>}
                {selectedSnapshot && <p className="mt-2 text-[11px] text-muted-foreground">选中快照 v{selectedSnapshot.version}{selectedSnapshot.updatedAt ? ` · 更新于 ${new Date(selectedSnapshot.updatedAt).toLocaleString('zh-CN')}` : ''}</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">快照接口只提供本人会话元数据，不显示其中角色状态。运行时服务端会复制整份状态（含历史和工作记忆）到独立评测副本。</p>
              </div>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>沟通渠道
                <select className={FIELD_CLASS} value={channel} onChange={(event) => setChannel(event.target.value as 'visit' | 'email')}>
                  <option value="visit">拜访</option>
                  <option value="email">邮件</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>单项通过阈值（0–1）
                <input className={FIELD_CLASS} type="number" min="0" max="1" step="0.05" value={thresholdText} onChange={(event) => setThresholdText(event.target.value)} />
              </label>
            </div>

            <label className={`${LABEL_CLASS} mt-4 block`}>销售话术（每行一轮）
              <textarea className={`${FIELD_CLASS} min-h-32 resize-y leading-6`} value={salesTurnsText} maxLength={6_000} onChange={(event) => setSalesTurnsText(event.target.value)} />
              <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{salesTurns.length}/3 轮；每轮最多 2000 字。</span>
              {turnsError && <span className="mt-1 block text-xs font-normal text-destructive">{turnsError}</span>}
            </label>
            <label className={`${LABEL_CLASS} mt-4 block`}>本场预期行为
              <textarea className={`${FIELD_CLASS} min-h-20 resize-y leading-6`} value={expectation} maxLength={2_000} onChange={(event) => setExpectation(event.target.value)} />
              <span className="mt-1 block text-[11px] font-normal text-muted-foreground">评委会结合每轮前的状态、人物设定和实际生成消息逐项评分。</span>
            </label>

            {thresholdText && threshold === null && <p className="mt-2 text-xs text-destructive">阈值须为 0 到 1 的数字。</p>}
            {expectation.length > 2_000 && <p className="mt-2 text-xs text-destructive">预期行为最多 2000 个字符。</p>}
            {source === 'snapshot' && !isSystemEvaluationSnapshotId(snapshotId) && <p className="mt-2 text-xs text-destructive">请输入有效的 UUID 格式快照 ID，或改用“新建状态”。</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="max-w-lg text-xs leading-5 text-muted-foreground">NPC 生成、系统内部语义判定和 DeepEval 指标都会使用已配置模型。实际请求次数随场景变化。</p>
              <button onClick={() => void runEvaluation()} disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <><RefreshCw className="h-4 w-4 animate-spin" />评测运行中…</> : '运行系统评测'}
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-5" aria-live="polite">
          {!report && <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
            <p className="text-sm font-medium text-foreground">评测结果会显示在这里</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">报告包含每轮实际 NPC 回复、关系状态变化、DeepEval 分数和评委理由。可运行评测后下载 JSON 保存。</p>
          </div>}
          {report && <>
            <div className={`rounded-xl border p-5 ${reportPassed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    {reportPassed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <TriangleAlert className="h-5 w-5 text-amber-600" />}
                    {reportPassed ? '评测通过' : '评测未通过或未完成'}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{reportNpcName} · {reportChannel} · {reportRounds.length} 轮</p>
                  <p className="mt-1 text-xs text-muted-foreground">四项均分：{typeof report.judge?.total100 === 'number' ? `${report.judge.total100.toFixed(1)} / 100` : '暂无完整均分'} · 阈值 {report.threshold.toFixed(2)}</p>
                </div>
                <button onClick={downloadReport} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
                  <Download className="h-4 w-4" />下载 JSON
                </button>
              </div>
              <p className="mt-3 break-all text-[11px] text-muted-foreground">运行编号：{report.runId}</p>
              {report.termination && <p role="status" className="mt-2 text-sm text-muted-foreground">
                拜访正常结束，已完成 {report.termination.completedTurns}/{report.termination.plannedTurns} 轮，跳过 {report.termination.skippedTurns} 轮，原因：{terminationReasonLabel(report.termination.reason)}。
              </p>}
              {report.error?.message && <p role="alert" className="mt-2 text-sm text-amber-800 dark:text-amber-200">{report.error.message}</p>}
            </div>

            {reportRounds.map((round) => <article key={round.round} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold">第 {round.round} 轮对话</h3>
              <div className="mt-3 space-y-3 text-sm leading-6">
                <div className="rounded-lg bg-muted/50 p-3"><div className="mb-1 text-[11px] font-medium text-muted-foreground">销售</div><p className="whitespace-pre-wrap">{round.salesMessage}</p></div>
                <div className="rounded-lg border border-primary/10 bg-primary/5 p-3"><div className="mb-1 text-[11px] font-medium text-primary">{reportNpcName}</div><p className="whitespace-pre-wrap">{round.npcResponse ?? (round.responseAction === 'read_no_reply' ? '已读但未回复' : round.error || 'NPC 未返回回复')}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                {(['beforeState', 'afterState'] as const).map((key) => {
                  const value = round[key];
                  return <div key={key} className="rounded-lg border border-border p-2">
                    <div className="mb-1 font-medium text-muted-foreground">{key === 'beforeState' ? '本轮前状态' : '本轮后状态'}</div>
                    <div>支持 {stateValue(value, 'support')} · 愉悦 {stateValue(value, 'pleasantness')}</div>
                    <div>接触 {stateValue(value, 'effectiveContactCount')} · 节点 {stateValue(value, 'node')}</div>
                  </div>;
                })}
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">查看本轮状态、历史和实际模型请求</summary>
                <div className="mt-2 grid gap-2">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3">{pretty(round.beforeState)}</pre>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3">{pretty(round.generationRequests)}</pre>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3">{pretty(round.afterState)}</pre>
                </div>
              </details>
            </article>)}

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold">DeepEval 指标</h2>
              <p className="mt-1 text-xs text-muted-foreground">每项单独过阈值，均分不能覆盖任何单项未通过。</p>
              <div className="mt-3 space-y-3">
                {metrics.map((metric) => <div key={metric.key} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{metric.name}</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${metric.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {metric.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {typeof metric.score === 'number' ? metric.score.toFixed(2) : '未完成'} · {metric.passed ? '通过' : '未通过'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{metric.error || metric.reason || '评委没有返回理由。'}</p>
                </div>)}
                {metrics.length === 0 && <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">尚无完成的评分指标。已生成对话和错误信息仍可下载报告查看。</p>}
              </div>
            </div>

            <details className="rounded-xl border border-border bg-card p-4 text-xs">
              <summary className="cursor-pointer font-medium">运行来源、配置版本和最终状态</summary>
              <div className="mt-3 space-y-2">
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3">{pretty({ source: report.source, pipeline: report.pipeline, requestCounts: report.requestCounts, configRevisions: report.configRevisions, boundaries: report.boundaries })}</pre>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3">{pretty(report.finalState)}</pre>
              </div>
            </details>
          </>}
        </section>
      </main>
    </div>
  );
}
