'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Clipboard,
  Copy,
  Database,
  Eye,
  Bug,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';

type UnknownRecord = Record<string, unknown>;

interface DebugSnapshot {
  traces: unknown[];
  previewStates: unknown[];
  tables: unknown[];
  generatedAt?: string;
}

interface TableSnapshot {
  name: string;
  rows: unknown[];
  metadata?: unknown;
}

const POLL_INTERVAL_MS = 2500;
const FAST_USER_ID = 'u_fast_acceptance';
const SENSITIVE_KEY_PATTERN = /(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|session[-_]?token|(?:^|[-_])token$|password|secret)/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asDisplayString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(redactSensitive(value), null, 2);
  } catch {
    return String(value);
  }
}

/** Never render credential-shaped fields returned by a debug endpoint. */
function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[已隐藏]' : redactSensitive(nested),
    ]),
  );
}

function normalizeCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (isRecord(item)) return { id: key, ...item };
      return { id: key, value: item };
    });
  }
  return [];
}

function normalizeDatabase(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([name, table]) => {
    if (!isRecord(table)) return { name, rows: Array.isArray(table) ? table : [table] };
    const rows = firstDefined(table, ['rows', 'data', 'records', 'snapshot']);
    return {
      name,
      rows: rows === undefined ? [] : Array.isArray(rows) ? rows : [rows],
      metadata: firstDefined(table, ['metadata', 'columns', 'rowCount', 'error']),
      error: table.error,
    };
  });
}

function normalizePreviewStates(value: unknown): unknown[] {
  const sessions = normalizeCollection(value);
  const flattened: unknown[] = [];

  for (const session of sessions) {
    if (!isRecord(session)) {
      flattened.push(session);
      continue;
    }

    const npcStates = firstDefined(session, ['npcStates', 'states']);
    if (npcStates === undefined) {
      flattened.push(session);
      continue;
    }

    const sessionId = firstDefined(session, ['previewSessionId', 'sessionId', 'id']);
    const conversations = firstDefined(session, ['conversations', 'conversationHistory']);
    const states = normalizeCollection(npcStates);
    if (!states.length) {
      flattened.push({ ...session, npcStates: [] });
      continue;
    }

    for (const state of states) {
      if (isRecord(state)) {
        flattened.push({
          ...state,
          previewSessionId: sessionId,
          conversations,
        });
      } else {
        flattened.push({ previewSessionId: sessionId, state, conversations });
      }
    }
  }

  return flattened;
}

function firstDefined(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeSnapshot(value: unknown): DebugSnapshot {
  const root = isRecord(value) ? value : {};
  const nested = isRecord(root.data) ? root.data : isRecord(root.payload) ? root.payload : root;
  const tablesValue = firstDefined(nested, ['database', 'tables', 'tableSnapshots', 'databaseTables']);

  return {
    traces: normalizeCollection(firstDefined(nested, ['traces', 'aiTraces', 'aiTrace', 'requests'])),
    previewStates: normalizePreviewStates(firstDefined(nested, ['previewStates', 'previewStateSnapshots', 'states', 'npcStates'])),
    tables: isRecord(tablesValue) ? normalizeDatabase(tablesValue) : normalizeCollection(tablesValue),
    generatedAt: typeof nested.generatedAt === 'string'
      ? nested.generatedAt
      : typeof nested.updatedAt === 'string'
        ? nested.updatedAt
        : undefined,
  };
}

function normalizeTables(values: unknown[]): TableSnapshot[] {
  return values.map((value, index) => {
    if (!isRecord(value)) {
      return { name: `表 ${index + 1}`, rows: [value] };
    }

    const nameValue = firstDefined(value, ['name', 'tableName', 'table', 'id']);
    const rowsValue = firstDefined(value, ['rows', 'data', 'records', 'snapshot']);
    const rows = rowsValue === undefined
      ? [value]
      : Array.isArray(rowsValue)
        ? rowsValue
        : [rowsValue];

    return {
      name: typeof nameValue === 'string' && nameValue.trim() ? nameValue : `表 ${index + 1}`,
      rows,
      metadata: firstDefined(value, ['metadata', 'columns', 'rowCount']),
    };
  });
}

function getField(record: UnknownRecord, keys: string[]): unknown {
  return firstDefined(record, keys);
}

function getText(record: UnknownRecord, keys: string[]): string {
  const value = getField(record, keys);
  return typeof value === 'string' ? value : value === undefined ? '' : asDisplayString(value);
}

function getNumber(record: UnknownRecord, keys: string[]): number | undefined {
  const value = getField(record, keys);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getArray(record: UnknownRecord, keys: string[]): unknown[] {
  return normalizeCollection(getField(record, keys));
}

function formatTime(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function readClientSession(): { allowed: boolean; token: string } {
  if (typeof window === 'undefined') return { allowed: false, token: '' };

  const token = window.localStorage.getItem('weixun_session') || '';
  const identityRaw = window.localStorage.getItem('weixun_identity');
  let userId = '';

  if (identityRaw) {
    try {
      const identity = JSON.parse(identityRaw) as UnknownRecord;
      const candidate = identity.userId ?? identity.id;
      if (typeof candidate === 'string') userId = candidate;
    } catch {
      // An invalid local identity should not prevent the server from deciding access by token.
    }
  }

  return { allowed: userId === FAST_USER_ID, token };
}

function getTraceRequest(trace: UnknownRecord): UnknownRecord | undefined {
  const request = firstDefined(trace, ['request', 'input', 'payload']);
  return isRecord(request) ? request : undefined;
}

function getTraceResponse(trace: UnknownRecord): unknown {
  return firstDefined(trace, ['response', 'rawResponse', 'result', 'output', 'reply', 'assistant']);
}

function getTraceError(trace: UnknownRecord): string {
  const value = firstDefined(trace, ['error', 'failure', 'exception']);
  if (value === undefined || value === null || value === '') return '';
  return asDisplayString(value);
}

function getTraceMessages(trace: UnknownRecord): unknown {
  const request = getTraceRequest(trace);
  return firstDefined(trace, ['messages', 'sentMessages']) ?? request?.messages;
}

function getTraceOptions(trace: UnknownRecord): unknown {
  const request = getTraceRequest(trace);
  return firstDefined(trace, ['options', 'requestOptions']) ?? request?.options;
}

function getResponseText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const direct = firstDefined(value, ['text', 'content', 'message', 'reply', 'outputText']);
    if (typeof direct === 'string') return direct;
    if (isRecord(value.message)) {
      const nested = firstDefined(value.message, ['content', 'text']);
      if (typeof nested === 'string') return nested;
    }
    if (Array.isArray(value.choices) && isRecord(value.choices[0])) {
      const choiceMessage = value.choices[0].message;
      if (isRecord(choiceMessage)) {
        const nested = firstDefined(choiceMessage, ['content', 'text']);
        if (typeof nested === 'string') return nested;
      }
      const choiceText = firstDefined(value.choices[0], ['text', 'content']);
      if (typeof choiceText === 'string') return choiceText;
    }
  }
  return '';
}

function JsonTree({ value, label, depth = 0 }: { value: unknown; label?: string; depth?: number }) {
  const clean = redactSensitive(value);
  const complex = Array.isArray(clean) || isRecord(clean);
  const title = label || (Array.isArray(clean) ? `数组 · ${clean.length}` : 'JSON');

  if (!complex) {
    return (
      <div className="flex gap-2 text-[11px] leading-5 font-mono">
        {label && <span className="shrink-0 text-slate-500">{label}:</span>}
        <span className="break-all text-slate-700 dark:text-slate-200">{asDisplayString(clean) || '—'}</span>
      </div>
    );
  }

  const entries = Array.isArray(clean)
    ? clean.map((item, index) => [String(index), item] as const)
    : Object.entries(clean);

  return (
    <details open={depth < 1} className="min-w-0">
      <summary className="cursor-pointer select-none text-[11px] leading-5 text-slate-600 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-300">
        <span className="mr-1">{title}</span>
        <span className="text-[10px] text-slate-400">{Array.isArray(clean) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </summary>
      <div className="ml-3 border-l border-slate-200 pl-2 dark:border-slate-700">
        {entries.map(([key, nested]) => (
          <JsonTree key={key} value={nested} label={key} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

function CopyJsonButton({ value, label = '复制 JSON' }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = asDisplayString(redactSensitive(value));
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300"
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        <CopyJsonButton value={value} />
      </div>
      <div className="max-h-52 overflow-auto pr-1">
        <JsonTree value={value} />
      </div>
    </div>
  );
}

function TraceCard({ trace, index }: { trace: unknown; index: number }) {
  const record = isRecord(trace) ? trace : { value: trace };
  const request = getTraceRequest(record);
  const response = getTraceResponse(record);
  const error = getTraceError(record);
  const messages = getTraceMessages(record);
  const options = getTraceOptions(record);
  const responseText = getResponseText(response);
  const traceStatus = getText(record, ['status']);
  const pending = traceStatus === 'pending';
  const operation = getText(record, ['operation', 'action', 'kind', 'type']) || 'AI 调用';
  const npc = getText(record, ['npcName', 'npcId', 'characterName']);
  const channel = getText(record, ['channel', 'contactMethod', 'mode']);
  const timestamp = getField(record, ['createdAt', 'timestamp', 'time', 'startedAt']);
  const timestampText = formatTime(timestamp);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{operation}</span>
            {npc && <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{npc}</span>}
            {channel && <span className="text-[10px] text-slate-500">· {channel}</span>}
          </div>
          {timestampText && <div className="mt-1 text-[10px] text-slate-400">{timestampText}</div>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${error ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' : pending ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
          {error ? '失败' : pending ? '处理中' : '已返回'}
        </span>
      </div>

      <div className="space-y-2">
        <JsonBlock title="发送 messages" value={messages} />
        <JsonBlock title="发送 options" value={options} />
        {request && !messages && !options && <JsonBlock title="发送请求" value={request} />}
        {responseText && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">返回文本</div>
            <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">{responseText}</div>
          </div>
        )}
        {response !== undefined && !responseText && <JsonBlock title="返回结果" value={response} />}
        {error && (
          <div className="flex gap-2 rounded-lg border border-red-100 bg-red-50/70 p-2 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-words">{error}</div>
          </div>
        )}
        <details className="rounded-lg border border-slate-100 dark:border-slate-800">
          <summary className="flex cursor-pointer items-center justify-between px-2 py-1.5 text-[10px] text-slate-500 hover:text-blue-600 dark:text-slate-400">
            <span>完整追踪 JSON</span>
            <CopyJsonButton value={record} />
          </summary>
          <div className="max-h-64 overflow-auto border-t border-slate-100 px-2 py-2 dark:border-slate-800">
            <JsonTree value={record} />
          </div>
        </details>
      </div>
      {index === 0 && <div className="mt-2 text-[10px] text-slate-400">最新记录</div>}
    </article>
  );
}

function StateCard({ state, index }: { state: unknown; index: number }) {
  const record = isRecord(state) ? state : { value: state };
  const name = getText(record, ['npcName', 'name', 'npcId', 'id']) || `NPC ${index + 1}`;
  const node = getText(record, ['node', 'stateNode', 'currentNode', 'stage', 'status']);
  const support = getNumber(record, ['support', 'supportScore', 'supportValue']);
  const pleasantness = getNumber(record, ['pleasantness', 'pleasantnessScore', 'mood']);
  const contactCount = getNumber(record, ['effectiveContactCount', 'effectiveContacts', 'contactCount']);
  const blockers = getArray(record, ['activeBlockers', 'blockers', 'blockingReasons']);
  const memory = getArray(record, ['workingMemory', 'memory', 'memories', 'workingMemoryIndex']);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</div>
          {node && <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-300">节点 / 状态：{node}</div>}
        </div>
        <Eye className="h-4 w-4 shrink-0 text-slate-400" />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <Metric label="支持度" value={support} />
        <Metric label="愉悦度" value={pleasantness} />
        <Metric label="有效接触" value={contactCount} />
      </div>
      {blockers.length > 0 && (
        <div className="mb-2 rounded-lg border border-red-100 bg-red-50/70 p-2 dark:border-red-900/60 dark:bg-red-950/20">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-red-700 dark:text-red-300"><ShieldAlert className="h-3 w-3" />当前阻断</div>
          <div className="max-h-24 overflow-auto space-y-1 text-[11px] text-red-700 dark:text-red-200">
            {blockers.map((item, blockerIndex) => <div key={blockerIndex} className="break-words">{asDisplayString(item)}</div>)}
          </div>
        </div>
      )}
      {memory.length > 0 && (
        <div className="mb-2 rounded-lg border border-amber-100 bg-amber-50/60 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="mb-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">工作记忆 · {memory.length}</div>
          <div className="max-h-32 space-y-1 overflow-auto text-[11px] text-slate-700 dark:text-slate-200">
            {memory.map((item, memoryIndex) => <div key={memoryIndex} className="break-words">{asDisplayString(item)}</div>)}
          </div>
        </div>
      )}
      <details className="rounded-lg border border-slate-100 dark:border-slate-800">
        <summary className="flex cursor-pointer items-center justify-between px-2 py-1.5 text-[10px] text-slate-500 hover:text-blue-600 dark:text-slate-400">
          <span>状态完整 JSON</span>
          <CopyJsonButton value={record} />
        </summary>
        <div className="max-h-64 overflow-auto border-t border-slate-100 px-2 py-2 dark:border-slate-800"><JsonTree value={record} /></div>
      </details>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/70">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-100">{value === undefined ? '—' : value}</div>
    </div>
  );
}

function TableCard({ table }: { table: TableSnapshot }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><Database className="h-3.5 w-3.5 shrink-0 text-violet-500" /><span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{table.name}</span></div>
        <span className="shrink-0 text-[10px] text-slate-400">{table.rows.length} 行</span>
      </div>
      {table.metadata !== undefined && <JsonBlock title="表元数据" value={table.metadata} />}
      <div className="mt-2">
        <JsonBlock title="快照" value={table.rows} />
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400 dark:border-slate-700">{text}</div>;
}

type Tab = 'traces' | 'states' | 'tables';

export function FastTestPanel() {
  const [clientReady, setClientReady] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [serverDenied, setServerDenied] = useState(false);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<Tab>('traces');
  const [snapshot, setSnapshot] = useState<DebugSnapshot>({ traces: [], previewStates: [], tables: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const tokenRef = useRef('');

  const refreshEligibility = useCallback(() => {
    const session = readClientSession();
    tokenRef.current = session.token;
    setEligible(session.allowed && !serverDenied);
    if (!session.allowed) setOpen(false);
    return session;
  }, [serverDenied]);

  const requestSnapshot = useCallback(async () => {
    const session = refreshEligibility();
    if (!session.allowed || serverDenied) return;

    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/testing/fast-debug', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: session.token ? { 'x-session': session.token } : {},
      });

      if (response.status === 403) {
        setServerDenied(true);
        setEligible(false);
        setOpen(false);
        return;
      }
      if (response.status === 401) {
        setEligible(false);
        setOpen(false);
        setError('登录会话已过期，请重新登录。');
        return;
      }
      if (!response.ok) {
        throw new Error(`后台快照请求失败（${response.status}）`);
      }

      const payload: unknown = await response.json();
      setSnapshot(normalizeSnapshot(payload));
      setLastFetchedAt(Date.now());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '后台快照请求失败');
    } finally {
      setLoading(false);
    }
  }, [refreshEligibility, serverDenied]);

  useEffect(() => {
    setClientReady(true);
    const session = readClientSession();
    tokenRef.current = session.token;
    setEligible(session.allowed);
    if (session.allowed) void requestSnapshot();

    const handleStorage = () => {
      const next = readClientSession();
      tokenRef.current = next.token;
      if (!next.allowed) {
        setEligible(false);
        setOpen(false);
      } else if (!serverDenied) {
        setEligible(true);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [requestSnapshot, serverDenied]);

  useEffect(() => {
    if (!clientReady || !open || paused || !eligible || serverDenied) return;
    const timer = window.setInterval(() => void requestSnapshot(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [clientReady, eligible, open, paused, requestSnapshot, serverDenied]);

  const tables = useMemo(() => normalizeTables(snapshot.tables), [snapshot.tables]);

  if (!clientReady || !eligible || serverDenied) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[600] flex items-center">
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); void requestSnapshot(); }}
          className="pointer-events-auto flex min-h-[112px] items-center gap-1 rounded-l-xl border border-r-0 border-amber-300 bg-[#241b09]/95 px-2 py-3 text-amber-100 shadow-2xl shadow-slate-950/30 backdrop-blur transition hover:bg-[#3b2b0b] focus:outline-none focus:ring-2 focus:ring-amber-300"
          aria-label="打开 FAST 测试后台"
          title="打开 FAST 测试后台"
        >
          <Bug className="h-4 w-4" />
          <span className="[writing-mode:vertical-rl] text-xs font-semibold tracking-wider">FAST 测试后台</span>
        </button>
      )}

      {open && (
        <aside className="pointer-events-auto flex h-full w-[min(96vw,620px)] max-w-full flex-col border-l border-slate-700 bg-slate-100/95 text-slate-900 shadow-2xl shadow-slate-950/35 backdrop-blur-xl dark:bg-slate-950/95 dark:text-slate-100">
          <header className="shrink-0 border-b border-slate-200 bg-white/90 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/90">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><Bug className="h-4 w-4" /></div>
                <div className="min-w-0"><h2 className="truncate text-sm font-bold">FAST 测试后台</h2><p className="text-[10px] text-slate-500 dark:text-slate-400">仅测试账号可见 · 不展示 API key</p></div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => void requestSnapshot()} disabled={loading} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-800" title="立即刷新" aria-label="立即刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
                <button type="button" onClick={() => setPaused((current) => !current)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" title={paused ? '恢复轮询' : '暂停轮询'} aria-label={paused ? '恢复轮询' : '暂停轮询'}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800" title="收起" aria-label="收起 FAST 测试后台"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400"><span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />{paused ? '轮询已暂停' : `每 ${POLL_INTERVAL_MS / 1000} 秒刷新`}</span><span>{lastFetchedAt ? `更新于 ${new Date(lastFetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '等待快照'}</span></div>
          </header>

          <nav className="grid shrink-0 grid-cols-3 border-b border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/70" aria-label="FAST 后台标签">
            <TabButton active={tab === 'traces'} onClick={() => setTab('traces')} icon={<Activity className="h-3.5 w-3.5" />} label="AI 追踪" count={snapshot.traces.length} />
            <TabButton active={tab === 'states'} onClick={() => setTab('states')} icon={<Eye className="h-3.5 w-3.5" />} label="当前状态" count={snapshot.previewStates.length} />
            <TabButton active={tab === 'tables'} onClick={() => setTab('tables')} icon={<Database className="h-3.5 w-3.5" />} label="数据表" count={tables.length} />
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{error}</span></div>}
            {tab === 'traces' && (snapshot.traces.length ? <div className="space-y-3">{snapshot.traces.map((trace, index) => <TraceCard key={index} trace={trace} index={index} />)}</div> : <EmptyState text="暂无 AI 调用追踪。先在游戏中发送一条测试话术。" />)}
            {tab === 'states' && (snapshot.previewStates.length ? <div className="space-y-3">{snapshot.previewStates.map((state, index) => <StateCard key={index} state={state} index={index} />)}</div> : <EmptyState text="暂无五人版预览状态。" />)}
            {tab === 'tables' && (tables.length ? <div className="space-y-3">{tables.map((table) => <TableCard key={table.name} table={table} />)}</div> : <EmptyState text="暂无数据库表快照。" />)}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white/80 px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/80">
            <span className="inline-flex min-w-0 items-center gap-1 truncate"><Clipboard className="h-3 w-3" />{snapshot.generatedAt ? `服务端生成 ${formatTime(snapshot.generatedAt)}` : '服务端调试快照'}</span>
            <CopyJsonButton value={snapshot} label="复制当前快照 JSON" />
          </footer>
        </aside>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs transition ${active ? 'border-blue-600 font-semibold text-blue-700 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'}`} aria-current={active ? 'page' : undefined}>
      {icon}<span>{label}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>{count}</span>
    </button>
  );
}
