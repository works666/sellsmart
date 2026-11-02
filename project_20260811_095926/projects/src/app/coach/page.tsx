'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clipboard, Copy, Megaphone, Play, Plus, RefreshCw, ShieldCheck, Square, Users, X } from 'lucide-react';
import { ROLE_COLOR, ROLE_LABEL } from '@/components/app-shell';

interface CompanySlot {
  id: string;
  company_id: string;
  company_name: string;
  player_user_id: string | null;
  game_session_id: string | null;
}

interface MultiplayerRoom {
  id: string;
  room_code: string;
  scenario_code: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  stage_version: number;
  created_at: string;
  multiplayer_company_slots: CompanySlot[];
}

interface CreateRoomForm {
  firstCompanyName: string;
  secondCompanyName: string;
}

const initialCreateForm: CreateRoomForm = {
  firstCompanyName: '我方公司',
  secondCompanyName: 'ABC公司',
};

const roomStatusLabel: Record<MultiplayerRoom['status'], string> = {
  waiting: '等待加入',
  running: '进行中',
  finished: '已结束',
  cancelled: '已取消',
};

function getSessionToken() {
  const localToken = window.localStorage.getItem('weixun_session');
  if (localToken) return localToken;
  const cookieToken = document.cookie.match(/(?:^|;\s*)weixun_session=([^;]+)/)?.[1];
  return cookieToken ? decodeURIComponent(cookieToken) : '';
}

async function getErrorMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const code = typeof body?.error === 'string' ? body.error : 'REQUEST_FAILED';
  const messages: Record<string, string> = {
    ROOM_VERSION_CONFLICT: '房间状态已变化，请刷新后重试。',
    ALL_COMPANIES_REQUIRE_PLAYERS: '每个公司席位均需有玩家加入后才能开始。',
    ROOM_NOT_RUNNING: '房间尚未进行中，无法代为确认。',
    ROOM_NOT_MUTABLE: '当前房间状态不允许此操作。',
    ROOM_ALREADY_STARTED: '房间已经开始。',
    ROOM_CREATE_FAILED: '创建房间失败，请稍后重试。',
    GAME_PHASE_DESIGN_REMOVED: '实训已改为固定时长，阶段设置已取消。',
    ROOM_LIST_FAILED: '加载房间失败，请检查登录状态或稍后重试。',
    '权限不足': '当前账号没有教练工作台权限。',
    '未登录': '登录已失效，请重新登录。',
  };
  return messages[code] ?? `操作失败：${code}`;
}

function statusClass(status: MultiplayerRoom['status']) {
  if (status === 'running') return 'badge-success';
  if (status === 'waiting') return 'badge-muted';
  return 'badge-danger';
}

export default function CoachPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<MultiplayerRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [createForm, setCreateForm] = useState<CreateRoomForm>(initialCreateForm);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const apiFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-session', getSessionToken());
    return fetch(input, { ...init, headers });
  }, []);

  const loadRooms = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await apiFetch('/api/coach/rooms');
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const payload = await response.json() as { data?: MultiplayerRoom[] };
      setRooms(Array.isArray(payload.data) ? payload.data : []);
      if (background) setNotice({ type: 'success', message: '房间列表已刷新。' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '加载房间失败。' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  const mutateRoom = async (path: string, body: Record<string, unknown>, successMessage: string) => {
    setNotice(null);
    try {
      const response = await apiFetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      await loadRooms();
      setNotice({ type: 'success', message: successMessage });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '操作失败。' });
    }
  };

  const handleCreateRoom = async () => {
    const first = createForm.firstCompanyName.trim();
    const second = createForm.secondCompanyName.trim();
    if (!first || !second || first === second) {
      setNotice({ type: 'error', message: '请填写两个不同的公司名称。' });
      return;
    }
    setNotice(null);
    try {
      const response = await apiFetch('/api/coach/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: [{ id: 'player-company', name: first }, { id: 'abc-company', name: second }],
        }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      setShowCreateRoom(false);
      setCreateForm(initialCreateForm);
      await loadRooms();
      setNotice({ type: 'success', message: '房间已创建，请将房间码和公司席位告知参与者。' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '创建房间失败。' });
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice({ type: 'success', message: '房间码已复制。' });
    } catch {
      setNotice({ type: 'error', message: '无法访问剪贴板，请手动复制房间码。' });
    }
  };

  const totalSlots = rooms.reduce((total, room) => total + room.multiplayer_company_slots.length, 0);
  const occupiedSlots = rooms.reduce((total, room) => total + room.multiplayer_company_slots.filter((slot) => slot.player_user_id).length, 0);

  return (
    <div className="min-h-screen bg-role-trainer">
      <header className="topbar-glass sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/')} className="text-muted-foreground hover:text-foreground p-2 hover:bg-muted rounded-lg transition-colors" title="返回首页"><ArrowLeft className="w-5 h-5" /></button>
            <div className="w-8 h-8 rounded-lg btn-warning flex items-center justify-center"><Megaphone className="w-4 h-4 text-white" /></div>
            <div><div className="text-sm font-semibold text-foreground">培训教练工作台</div><div className="text-[10px] text-muted-foreground">多人房间管理 · 手动刷新</div></div>
          </div>
          <div className="hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-medium items-center gap-1.5 text-white shadow-sm" style={{ background: ROLE_COLOR.trainer }}><ShieldCheck className="w-3.5 h-3.5" /><span>{ROLE_LABEL.trainer}</span></div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[{ label: '房间总数', value: rooms.length }, { label: '进行中房间', value: rooms.filter((room) => room.status === 'running').length }, { label: '已占公司席位', value: `${occupiedSlots} / ${totalSlots}` }].map((stat) => (
            <div key={stat.label} className="card-elevated px-5 py-4"><div className="text-2xl font-bold text-foreground num">{stat.value}</div><div className="text-xs text-muted-foreground">{stat.label}</div></div>
          ))}
        </div>
        <div className="card-elevated p-5 mb-6 text-sm text-muted-foreground">每场实训限时 20 分钟；每 5 分钟恢复 5 点行动点（上限 28 点），拜访期间暂停计时，并按每轮 15 秒扣除。当前页面只管理多人房间与公司席位；房间状态不会实时推送，请在玩家加入或操作冲突后手动刷新。</div>
        {notice && <div className={`rounded-xl border px-4 py-3 mb-4 text-sm ${notice.type === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-success/30 bg-success/10 text-foreground'}`} role="status">{notice.message}</div>}

        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div><h1 className="text-base font-bold text-foreground">多人房间</h1><p className="text-xs text-muted-foreground mt-1">每个公司席位只能加入一位玩家；开始前所有席位都必须已加入。</p></div>
            <div className="flex items-center gap-2">
              <button onClick={() => void loadRooms(true)} disabled={refreshing} className="px-3 py-2 rounded-lg btn-glass text-sm text-foreground flex items-center gap-1.5 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> 刷新</button>
              <button onClick={() => setShowCreateRoom(true)} className="px-3 py-2 rounded-lg btn-warning text-sm font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> 创建房间</button>
            </div>
          </div>
          {loading ? <div className="py-16 text-center text-sm text-muted-foreground">正在加载房间…</div> : rooms.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">暂无房间。创建房间后，参与者可通过房间码选择公司席位加入。</div> : (
            <div className="space-y-4">
              {rooms.map((room) => (
                <article key={room.id} className="rounded-xl border border-border overflow-hidden">
                  <div className="p-4 bg-surface-container/40 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      <div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">房间码</div><div className="flex items-center gap-2 font-mono font-bold text-foreground num">{room.room_code}<button onClick={() => void handleCopyCode(room.room_code)} className="p-1 rounded hover:bg-primary/10 text-primary" title="复制房间码"><Copy className="w-3.5 h-3.5" /></button></div></div>
                      <div><div className="text-[10px] text-muted-foreground">状态</div><span className={`badge ${statusClass(room.status)}`}>{roomStatusLabel[room.status]}</span></div>
                      <div><div className="text-[10px] text-muted-foreground">实训时长</div><div className="text-sm text-foreground">20 分钟</div></div>
                    </div>
                    <div className="flex items-center gap-2">
                      {room.status === 'waiting' && <button onClick={() => void mutateRoom(`/api/coach/rooms/${room.id}/start`, { expectedVersion: room.stage_version }, '房间已开始。')} className="px-3 py-2 rounded-lg btn-primary text-sm font-semibold flex items-center gap-1.5"><Play className="w-4 h-4" /> 开始</button>}
                      {(room.status === 'waiting' || room.status === 'running') && <button onClick={() => { if (window.confirm('确定结束此房间？所有关联对局会停止。')) void mutateRoom(`/api/coach/rooms/${room.id}/end`, { expectedVersion: room.stage_version }, '房间已结束。'); }} className="px-3 py-2 rounded-lg btn-warning text-sm font-semibold flex items-center gap-1.5"><Square className="w-4 h-4" /> 结束</button>}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> 公司席位</div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {room.multiplayer_company_slots.map((slot) => {
                        const occupied = Boolean(slot.player_user_id);
                        return <div key={slot.id} className="rounded-lg border border-border p-3 flex flex-wrap items-center justify-between gap-3">
                          <div><div className="font-medium text-foreground">{slot.company_name}</div><div className="text-xs text-muted-foreground mt-1">{occupied ? `玩家：${slot.player_user_id}` : '尚未加入'}</div></div>
                          <div className="flex items-center gap-2">
                            {room.status === 'waiting' && occupied && <button onClick={() => { if (window.confirm(`确定移除 ${slot.company_name} 的玩家？`)) void mutateRoom(`/api/coach/rooms/${room.id}`, { action: 'remove_player', slotId: slot.id, expectedVersion: room.stage_version }, '玩家已从公司席位移除。'); }} className="px-2.5 py-1.5 rounded-lg border border-destructive/30 text-destructive text-xs hover:bg-destructive/10 flex items-center gap-1"><X className="w-3.5 h-3.5" /> 移除</button>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {showCreateRoom && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={() => setShowCreateRoom(false)}>
        <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <h2 className="text-base font-bold text-foreground mb-1">创建多人房间</h2><p className="text-xs text-muted-foreground mb-5">创建两个公司席位。各席位加入一位玩家后才能开始。</p>
          <div className="space-y-4">
            <label className="block text-sm text-foreground">公司席位 A<input value={createForm.firstCompanyName} onChange={(event) => setCreateForm({ ...createForm, firstCompanyName: event.target.value })} className="mt-1.5 w-full px-3 py-2 rounded-lg bg-surface-container border border-border text-sm" maxLength={128} /></label>
            <label className="block text-sm text-foreground">公司席位 B<input value={createForm.secondCompanyName} onChange={(event) => setCreateForm({ ...createForm, secondCompanyName: event.target.value })} className="mt-1.5 w-full px-3 py-2 rounded-lg bg-surface-container border border-border text-sm" maxLength={128} /></label>
            <p className="rounded-lg bg-surface-container px-3 py-2 text-xs leading-5 text-muted-foreground">实训时长固定为 20 分钟。房间开始后计时，每 5 分钟恢复 5 点行动点，拜访期间暂停。</p>
          </div>
          <div className="flex justify-end gap-2 mt-6"><button onClick={() => setShowCreateRoom(false)} className="px-4 py-2 rounded-lg btn-glass text-sm text-foreground">取消</button><button onClick={() => void handleCreateRoom()} className="px-4 py-2 rounded-lg btn-warning text-sm font-semibold flex items-center gap-1.5"><Clipboard className="w-4 h-4" /> 创建</button></div>
        </div>
      </div>}
    </div>
  );
}
