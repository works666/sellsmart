'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type ProviderId = 'default' | 'deepseek' | 'doubao' | 'qwen';

interface ProviderStatus {
  configured: boolean;
  model: string | null;
}

interface ProviderSnapshot {
  provider: ProviderId;
  revision: number;
  persisted: boolean;
  providers: Record<ProviderId, ProviderStatus>;
}

const PROVIDER_OPTIONS: Array<{
  id: ProviderId;
  name: string;
  description: string;
  accent: 'blue' | 'violet' | 'emerald' | 'slate';
}> = [
  {
    id: 'deepseek',
    name: 'DeepSeek Flash',
    description: '使用服务端配置的 DeepSeek Flash 接口。',
    accent: 'blue',
  },
  {
    id: 'doubao',
    name: '豆包',
    description: '使用服务端配置的豆包接口。',
    accent: 'violet',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    description: '使用服务端配置的通义千问接口。',
    accent: 'emerald',
  },
  {
    id: 'default',
    name: '旧默认接口',
    description: '沿用原有 AI_* 环境变量配置。',
    accent: 'slate',
  },
];

function sessionHeaders(): Record<string, string> {
  return { 'x-session': window.localStorage.getItem('weixun_session') || '' };
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'default' || value === 'deepseek' || value === 'doubao' || value === 'qwen';
}

function normalizeSnapshot(value: unknown): ProviderSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ProviderSnapshot>;
  if (
    !isProviderId(candidate.provider)
    || !Number.isInteger(candidate.revision)
    || typeof candidate.persisted !== 'boolean'
    || !candidate.providers
    || typeof candidate.providers !== 'object'
  ) return null;

  const providers = {} as Record<ProviderId, ProviderStatus>;
  for (const id of ['default', 'deepseek', 'doubao', 'qwen'] as const) {
    const status = candidate.providers[id];
    if (!status || typeof status !== 'object' || typeof status.configured !== 'boolean') return null;
    providers[id] = {
      configured: status.configured,
      model: typeof status.model === 'string' ? status.model : null,
    };
  }

  return {
    provider: candidate.provider,
    revision: candidate.revision as number,
    persisted: candidate.persisted,
    providers,
  };
}

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string') {
    return (value as { error: string }).error;
  }
  return fallback;
}

function providerName(provider: ProviderId): string {
  return PROVIDER_OPTIONS.find((option) => option.id === provider)?.name ?? provider;
}

export default function AiProviderPage() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'error' | 'success' | 'conflict'>('error');
  const [conflict, setConflict] = useState(false);
  const [conflictHasLatest, setConflictHasLatest] = useState(false);

  const dirty = useMemo(
    () => Boolean(snapshot && selectedProvider !== snapshot.provider),
    [snapshot, selectedProvider],
  );

  async function loadConfig() {
    setLoading(true);
    setNotice('');
    setConflict(false);
    setConflictHasLatest(false);
    try {
      const response = await fetch('/api/designer/ai-provider', {
        headers: sessionHeaders(),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(body, 'AI 接口配置读取失败。'));
      const nextSnapshot = normalizeSnapshot(body);
      if (!nextSnapshot) throw new Error('服务端返回的 AI 接口配置格式无效。');
      setSnapshot(nextSnapshot);
      setSelectedProvider(nextSnapshot.provider);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 接口配置读取失败。');
      setNoticeKind('error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
    // Initial read only; reload actions call the same function directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!snapshot || !dirty || saving) return;
    setSaving(true);
    setNotice('');
    setConflict(false);
    setConflictHasLatest(false);
    try {
      const response = await fetch('/api/designer/ai-provider', {
        method: 'PUT',
        headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, revision: snapshot.revision }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (response.status === 409) {
        const latest = body && typeof body === 'object'
          ? normalizeSnapshot((body as { current?: unknown }).current)
          : null;
        if (latest) setSnapshot(latest);
        setConflict(true);
        setConflictHasLatest(Boolean(latest));
        setNotice(latest
          ? responseError(body, '配置已被其他设计师更新。你选择的接口仍保留，可基于最新版本重新保存。')
          : responseError(body, '配置已被其他设计师更新，无法读取最新版本。请重新加载后再保存。'));
        setNoticeKind('conflict');
        return;
      }
      if (!response.ok) throw new Error(responseError(body, 'AI 接口配置保存失败。'));
      const saved = normalizeSnapshot(body);
      if (!saved) throw new Error('服务端返回的已保存配置格式无效。');
      setSnapshot(saved);
      setSelectedProvider(saved.provider);
      setConflictHasLatest(false);
      setNotice('AI 接口配置已保存，新发起的 AI 请求将使用所选接口。');
      setNoticeKind('success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 接口配置保存失败。');
      setNoticeKind('error');
    } finally {
      setSaving(false);
    }
  }

  const currentProvider = snapshot ? PROVIDER_OPTIONS.find((option) => option.id === snapshot.provider) : null;
  const currentStatus = snapshot ? snapshot.providers[snapshot.provider] : null;
  const selectedStatus = snapshot ? snapshot.providers[selectedProvider] : null;
  const saveDisabled = loading || saving || !dirty || conflict || !snapshot || !selectedStatus?.configured;

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push('/designer')}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="返回设计师工作台"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-700">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">AI 接口配置</h1>
              <p className="mt-0.5 text-xs text-slate-500">选择项目运行时使用的 AI 服务接口。</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className={`mr-1 text-xs font-medium ${dirty ? 'text-amber-700' : 'text-emerald-700'}`} role="status">
              {dirty ? '有尚未保存的选择' : snapshot && !snapshot.persisted ? '尚未切换，沿用旧默认' : '当前选择已保存'}
            </span>
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={loading || saving}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />重新读取
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saveDisabled}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-4 w-4" />{saving ? '保存中…' : '保存接口'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <p>接口密钥由服务端管理。本页只显示接口是否已配置，不读取或展示任何密钥；保存后，新发起的 AI 请求使用当前选定的接口。</p>
        </div>

        {notice && (
          <div
            role={noticeKind === 'success' ? 'status' : 'alert'}
            className={`mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs leading-5 ${
              noticeKind === 'conflict'
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : noticeKind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            <span className="flex min-w-0 items-start gap-2">
              {noticeKind === 'conflict' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : null}
              {noticeKind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}
              {noticeKind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : null}
              {notice}
            </span>
            {conflict && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadConfig()}
                  disabled={loading || saving}
                  className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  放弃我的选择并加载最新版本
                </button>
                {conflictHasLatest && snapshot && (
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={loading || saving || !dirty || !selectedStatus?.configured}
                    className="rounded-md bg-amber-700 px-3 py-1.5 font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    保留我的选择并基于最新版本保存
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {loading && !snapshot ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-16 text-center text-sm text-slate-500" role="status">
            正在读取 AI 接口配置…
          </div>
        ) : !snapshot ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center">
            <CircleHelp className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-800">暂时无法读取 AI 接口配置</p>
            <p className="mt-2 text-xs text-slate-500">{notice || '请确认当前账号有设计师权限后重试。'}</p>
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={loading}
              className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              重新读取
            </button>
          </div>
        ) : (
          <>
            <section className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="current-provider-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="current-provider-heading" className="text-sm font-semibold text-slate-900">当前生效接口</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {snapshot.persisted
                      ? `当前保存的供应商是 ${currentProvider?.name ?? providerName(snapshot.provider)}。`
                      : '尚无后台切换记录，运行时继续使用原有 AI_* 默认配置。'}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${snapshot.persisted ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                  {snapshot.persisted ? `当前：${currentProvider?.name ?? providerName(snapshot.provider)}` : '当前：旧默认接口'}
                </span>
              </div>
              {currentStatus && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                  {currentStatus.configured
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
                  <span className="font-medium text-slate-800">
                    {snapshot.persisted ? currentProvider?.name : '旧默认配置'}：
                    {currentStatus.configured ? '已配置' : '未配置'}
                  </span>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="provider-options-heading">
              <div className="mb-4">
                <h2 id="provider-options-heading" className="text-sm font-semibold text-slate-900">选择接口</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">选择后点击“保存接口”生效。未完成服务端配置的接口不能保存。</p>
              </div>
              <fieldset disabled={loading || saving} className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">选择 AI 服务接口</legend>
                {PROVIDER_OPTIONS.map((option) => {
                  const status = snapshot.providers[option.id];
                  const checked = selectedProvider === option.id;
                  const isCurrent = snapshot.persisted && snapshot.provider === option.id;
                  const accentClasses = {
                    blue: checked ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'hover:border-blue-300',
                    violet: checked ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500/20' : 'hover:border-violet-300',
                    emerald: checked ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/20' : 'hover:border-emerald-300',
                    slate: checked ? 'border-slate-500 bg-slate-50 ring-1 ring-slate-500/20' : 'hover:border-slate-300',
                  }[option.accent];
                  return (
                    <label
                      key={option.id}
                      className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${accentClasses} ${loading || saving ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="radio"
                        name="ai-provider"
                        value={option.id}
                        checked={checked}
                        onChange={() => {
                          setSelectedProvider(option.id);
                          setNotice('');
                          setConflict(false);
                          setConflictHasLatest(false);
                        }}
                        className="mt-0.5 h-4 w-4 accent-blue-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900">{option.name}</span>
                          {isCurrent && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-800">当前生效</span>}
                          {checked && dirty && !isCurrent && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800">待保存</span>}
                        </span>
                        <span className="mt-1 block text-[11px] leading-5 text-slate-600">{option.description}</span>
                        <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium">
                          {status.configured
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
                          <span className={status.configured ? 'text-emerald-700' : 'text-rose-700'}>
                            {status.configured ? '服务端已配置' : '服务端未配置'}
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {dirty && selectedStatus && !selectedStatus.configured && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-800" role="status">
                  所选接口尚未完成服务端配置。配置完成后重新读取本页，再保存切换。
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
