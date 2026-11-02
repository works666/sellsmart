'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, Users, BarChart3, Plus, Edit2, Trash2, Lock, Unlock,
  Play, Settings, BookOpen, Package, Building2, History, Wand2, Eye,
  X, Save, KeyRound
} from 'lucide-react';

interface Player {
  id: number;
  username: string;
  role: string;
  status: string;
  progress: string;
  joined_at: string;
}

interface LockConfig {
  client_unit: string;
  client_industry: string;
  vendor_product: string;
  scenario_locked: boolean;
  locked_at: string | null;
}

interface InitiateRecord {
  id: number;
  room_code: string;
  delegate_to_coach: boolean;
  allow_coach_view: boolean;
  status: string;
  created_at: string;
  player_count: number;
}

interface StudentReport {
  id: number;
  player_name: string;
  room_code: string;
  score: number;
  rounds: number;
  result: string;
  completed_at: string;
}

interface CustomItem {
  id: number;
  name: string;
  type: 'client' | 'product' | 'knowledge' | 'history';
  description: string;
  created_at: string;
}

interface EnterpriseApiResponse {
  data?: unknown;
  error?: unknown;
}

class EnterpriseApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'EnterpriseApiError';
  }
}

function getSessionToken() {
  try {
    const localToken = window.localStorage.getItem('weixun_session');
    if (localToken) return localToken;
  } catch { /* Storage can be disabled by browser policy. */ }
  try {
    const cookieToken = document.cookie.match(/(?:^|;\s*)weixun_session=([^;]+)/)?.[1];
    return cookieToken ? decodeURIComponent(cookieToken) : '';
  } catch { return ''; }
}

function enterpriseFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-session', getSessionToken());
  return fetch(input, { ...init, headers });
}

async function readEnterpriseApiResponse(response: Response, fallback: string): Promise<EnterpriseApiResponse> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : fallback;
    const error = response.status === 401
      ? '登录已失效，请重新登录。'
      : response.status === 403
        ? '当前账号没有企业管理员权限。'
        : response.status === 501
          ? '该企业管理功能暂未开放。'
          : apiError;
    throw new EnterpriseApiError(error, response.status);
  }
  return payload && typeof payload === 'object' ? payload as EnterpriseApiResponse : {};
}

function isEnterpriseAccessError(error: unknown): error is EnterpriseApiError {
  return error instanceof EnterpriseApiError && (error.status === 401 || error.status === 403);
}

export default function EnterpriseAdminPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [playersAvailable, setPlayersAvailable] = useState(false);
  const [progressAvailable, setProgressAvailable] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [initiateAvailable, setInitiateAvailable] = useState(false);
  const [customizeAvailable, setCustomizeAvailable] = useState(false);
  const [reportsAvailable, setReportsAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<'players' | 'progress' | 'lock' | 'initiate' | 'customize' | 'history'>('players');

  // Lock state
  const [lockConfig, setLockConfig] = useState<LockConfig>({
    client_unit: '',
    client_industry: '',
    vendor_product: '',
    scenario_locked: false,
    locked_at: null,
  });

  // Initiate state
  const [initiateRecords, setInitiateRecords] = useState<InitiateRecord[]>([]);
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [initiateDelegate, setInitiateDelegate] = useState(true);
  const [initiateCoachVisible, setInitiateCoachVisible] = useState(true);

  // Customize state
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [customizeType, setCustomizeType] = useState<'client' | 'product' | 'knowledge' | 'history'>('client');
  const [customizeName, setCustomizeName] = useState('');
  const [customizeDesc, setCustomizeDesc] = useState('');

  // Student reports
  const [studentReports, setStudentReports] = useState<StudentReport[]>([]);

  // Edit player modal
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [playerForm, setPlayerForm] = useState({ username: '', role: 'player' });

  useEffect(() => {
    enterpriseFetch('/api/enterprise/players')
      .then(r => readEnterpriseApiResponse(r, '玩家数据暂不可用'))
      .then(d => {
        if (!Array.isArray(d.data)) throw new Error('玩家数据格式无效');
        setPlayers(d.data as Player[]);
        setPlayersAvailable(true);
      })
      .catch(error => {
        setPlayersAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      })
      .finally(() => setLoading(false));

    // Load lock config
    enterpriseFetch('/api/enterprise/lock')
      .then(r => readEnterpriseApiResponse(r, '场景锁定配置暂不可用'))
      .then(d => {
        if (!d.data || typeof d.data !== 'object') throw new Error('场景锁定配置格式无效');
        setLockConfig(d.data as LockConfig);
        setLockAvailable(true);
      })
      .catch(error => {
        setLockAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      });

    // Load initiate records
    enterpriseFetch('/api/enterprise/initiate')
      .then(r => readEnterpriseApiResponse(r, '发起对局数据暂不可用'))
      .then(d => {
        if (!Array.isArray(d.data)) throw new Error('发起对局数据格式无效');
        setInitiateRecords(d.data as InitiateRecord[]);
        setInitiateAvailable(true);
      })
      .catch(error => {
        setInitiateAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      });

    // Load custom items
    enterpriseFetch('/api/enterprise/customize')
      .then(r => readEnterpriseApiResponse(r, '定制内容数据暂不可用'))
      .then(d => {
        if (!Array.isArray(d.data)) throw new Error('定制内容数据格式无效');
        setCustomItems(d.data as CustomItem[]);
        setCustomizeAvailable(true);
      })
      .catch(error => {
        setCustomizeAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      });

    // Game progress is intentionally an explicit empty state until its data model is available.
    enterpriseFetch('/api/enterprise/progress')
      .then(r => readEnterpriseApiResponse(r, '游戏进度数据暂不可用'))
      .then(() => setProgressAvailable(true))
      .catch(error => {
        setProgressAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      });

    // Load student reports
    enterpriseFetch('/api/enterprise/history')
      .then(r => readEnterpriseApiResponse(r, '学员报告数据暂不可用'))
      .then(d => {
        if (!Array.isArray(d.data)) throw new Error('学员报告数据格式无效');
        setStudentReports(d.data as StudentReport[]);
        setReportsAvailable(true);
      })
      .catch(error => {
        setReportsAvailable(false);
        if (isEnterpriseAccessError(error)) setAccessError(error.message);
      });
  }, []);

  const handleAddPlayer = () => {
    setEditingPlayer(null);
    setPlayerForm({ username: '', role: 'player' });
    setShowPlayerModal(true);
  };

  const handleEditPlayer = (player: Player) => {
    setEditingPlayer(player);
    setPlayerForm({ username: player.username, role: player.role });
    setShowPlayerModal(true);
  };

  const handleSavePlayer = async () => {
    if (!playerForm.username.trim()) return;
    setActionError(null);
    try {
      if (editingPlayer) {
        const res = await enterpriseFetch(`/api/enterprise/players?id=${editingPlayer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(playerForm),
        });
        const d = await readEnterpriseApiResponse(res, '保存玩家失败');
        if (!d.data) throw new Error('服务器未返回玩家数据');
        setPlayers(players.map(p => p.id === editingPlayer.id ? d.data as Player : p));
      } else {
        const res = await enterpriseFetch('/api/enterprise/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(playerForm),
        });
        const d = await readEnterpriseApiResponse(res, '添加玩家失败');
        if (!d.data) throw new Error('服务器未返回玩家数据');
        setPlayers([...players, d.data as Player]);
      }
      setShowPlayerModal(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存玩家失败');
    }
  };

  const handleDeletePlayer = async (id: number) => {
    if (!confirm('确定删除该玩家？')) return;
    setActionError(null);
    try {
      const res = await enterpriseFetch(`/api/enterprise/players?id=${id}`, { method: 'DELETE' });
      await readEnterpriseApiResponse(res, '删除玩家失败');
      setPlayers(players.filter(p => p.id !== id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除玩家失败');
    }
  };

  const handleSaveLock = async () => {
    setActionError(null);
    try {
      const res = await enterpriseFetch('/api/enterprise/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lockConfig, scenario_locked: true }),
      });
      const d = await readEnterpriseApiResponse(res, '锁定场景失败');
      if (!d.data || typeof d.data !== 'object') throw new Error('服务器未返回场景配置');
      setLockConfig(d.data as LockConfig);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '锁定场景失败');
    }
  };

  const handleUnlock = async () => {
    setActionError(null);
    try {
      const res = await enterpriseFetch('/api/enterprise/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lockConfig, scenario_locked: false }),
      });
      const d = await readEnterpriseApiResponse(res, '解锁场景失败');
      if (!d.data || typeof d.data !== 'object') throw new Error('服务器未返回场景配置');
      setLockConfig(d.data as LockConfig);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '解锁场景失败');
    }
  };

  const handleInitiate = async () => {
    setActionError(null);
    try {
      const res = await enterpriseFetch('/api/enterprise/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegate_to_coach: initiateDelegate,
          allow_coach_view: initiateCoachVisible,
        }),
      });
      const d = await readEnterpriseApiResponse(res, '发起对局失败');
      if (!d.data) throw new Error('服务器未返回对局记录');
      setInitiateRecords([d.data as InitiateRecord, ...initiateRecords]);
      setShowInitiateModal(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '发起对局失败');
    }
  };

  const handleAddCustomItem = async () => {
    if (!customizeName.trim()) return;
    setActionError(null);
    try {
      const res = await enterpriseFetch('/api/enterprise/customize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: customizeName, type: customizeType, description: customizeDesc }),
      });
      const d = await readEnterpriseApiResponse(res, '保存定制内容失败');
      if (!d.data) throw new Error('服务器未返回定制内容');
      setCustomItems([...customItems, d.data as CustomItem]);
      setShowCustomizeModal(false);
      setCustomizeName('');
      setCustomizeDesc('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存定制内容失败');
    }
  };

  const handleDeleteCustomItem = async (id: number) => {
    setActionError(null);
    try {
      const res = await enterpriseFetch(`/api/enterprise/customize?id=${id}`, { method: 'DELETE' });
      await readEnterpriseApiResponse(res, '删除定制内容失败');
      setCustomItems(customItems.filter(i => i.id !== id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除定制内容失败');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-role-admin flex items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 border-2 border-role-admin border-t-transparent rounded-full animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  const progressStats = {
    not_started: players.filter(p => p.status === '未开始').length,
    in_progress: players.filter(p => p.status === '进行中').length,
    completed: players.filter(p => p.status === '已完成').length,
  };

  const customizeTypeLabels: Record<string, string> = {
    client: '客户',
    product: '产品',
    knowledge: '知识库',
    history: '公司历史',
  };

  const customizeTypeIcons: Record<string, typeof Building2> = {
    client: Building2,
    product: Package,
    knowledge: BookOpen,
    history: History,
  };

  return (
    <div className="min-h-screen bg-role-admin">
      {/* Header */}
      <header className="topbar-glass sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={() => router.push('/')} className="text-muted-foreground hover:text-foreground p-2 hover:bg-muted rounded-lg transition-colors" title="返回首页">
              <Shield className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ background: '#0EA5E9' }}>
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">企业管理员工作台</div>
                <div className="text-[10px] text-muted-foreground">学员 · 进度 · 邀请码 · 报告</div>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-1 text-sm ml-8">
              <button onClick={() => router.push('/designer')} className="px-3 py-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5" /> 游戏设计师
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm" style={{ background: '#0EA5E9' }}>企业管理员</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 py-6">
        {(actionError || accessError) && (
          <div role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {actionError ?? accessError}
          </div>
        )}
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.1)' }}>
              <Users className="w-4 h-4" style={{ color: '#0EA5E9' }} />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{playersAvailable ? players.length : '—'}</div>
              <div className="text-xs text-muted-foreground">玩家总数</div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Play className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{playersAvailable ? progressStats.in_progress : '—'}</div>
              <div className="text-xs text-muted-foreground">进行中</div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.1)' }}>
              <Lock className="w-4 h-4" style={{ color: '#0EA5E9' }} />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{lockAvailable ? (lockConfig.scenario_locked ? '已锁定' : '未锁定') : '—'}</div>
              <div className="text-xs text-muted-foreground">场景状态</div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-purple-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{initiateAvailable ? initiateRecords.length : '—'}</div>
              <div className="text-xs text-muted-foreground">发起次数</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-t-2xl border border-border border-b-0 px-6 flex items-center gap-6 overflow-x-auto">
          {([
            ['players', '人员管理', Users],
            ['progress', '游戏进度', BarChart3],
            ['lock', '锁定配置', Lock],
            ['initiate', '发起对局', Play],
            ['customize', '定制内容', Settings],
            ['history', '历史记录', History],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`relative py-4 text-sm font-semibold flex items-center gap-2 whitespace-nowrap ${activeTab === key ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              <Icon className="w-4 h-4" /> {label}
              {activeTab === key && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#0EA5E9' }} />}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-b-2xl border border-border border-t-0 p-6">
          {/* 人员管理 */}
          {activeTab === 'players' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-foreground">企业玩家列表</div>
                <button onClick={handleAddPlayer} disabled={!playersAvailable} title={playersAvailable ? '添加玩家' : (accessError ?? '玩家管理接口尚未接入')} className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: '#0EA5E9' }}>
                  <Plus className="w-3.5 h-3.5" /> 添加玩家
                </button>
              </div>
              {players.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-container border-b border-border">
                        <th className="px-4 py-3 text-left font-semibold text-foreground">用户名</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">角色</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">状态</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">进度</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">加入时间</th>
                        <th className="px-4 py-3 text-right font-semibold text-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.map(p => (
                        <tr key={p.id} className="border-b border-border hover:bg-surface-container/50">
                          <td className="px-4 py-3 font-semibold text-foreground">{p.username}</td>
                          <td className="px-4 py-3 text-foreground">{p.role}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              p.status === '在线' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                            }`}>{p.status}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              p.progress === '已完成' ? 'bg-success/10 text-success' :
                              p.progress === '进行中' ? 'bg-primary/10 text-primary' :
                              'bg-muted text-muted-foreground'
                            }`}>{p.progress}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(p.joined_at).toLocaleDateString('zh-CN')}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleEditPlayer(p)} className="text-primary hover:text-primary/80"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => handleDeletePlayer(p.id)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {playersAvailable ? '暂无玩家，点击「添加玩家」开始' : (accessError ?? '玩家数据接口尚未接入真实数据服务，当前仅显示空状态。')}
                </div>
              )}
            </div>
          )}

          {/* 游戏进度 */}
          {activeTab === 'progress' && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <div className="text-sm font-semibold text-foreground">游戏进度</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {progressAvailable ? '暂无游戏进度数据。' : (accessError ?? '游戏进度数据接口尚未接入真实数据服务，暂不展示班次、学员或完成率。')}
              </p>
            </div>
          )}

          {/* 锁定配置 */}
          {activeTab === 'lock' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-foreground">场景锁定配置</div>
                  <div className="text-xs text-muted-foreground mt-0.5">锁定后，所有玩家将使用统一的甲乙方场景，无法自行选择</div>
                </div>
                {lockConfig.scenario_locked ? (
                  <button onClick={handleUnlock} disabled={!lockAvailable} title={lockAvailable ? '解锁场景' : (accessError ?? '场景锁定接口尚未接入')} className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-semibold flex items-center gap-1 hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50">
                    <Unlock className="w-3.5 h-3.5" /> 解锁
                  </button>
                ) : (
                  <button onClick={handleSaveLock} disabled={!lockAvailable} title={lockAvailable ? '锁定场景' : (accessError ?? '场景锁定接口尚未接入')} className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: '#0EA5E9' }}>
                    <Lock className="w-3.5 h-3.5" /> 锁定场景
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border p-5">
                  <div className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Building2 className="w-4 h-4" style={{ color: '#0EA5E9' }} /> 甲方信息锁定
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">客户单位</label>
                      <input
                        type="text"
                        value={lockConfig.client_unit}
                        onChange={e => setLockConfig({ ...lockConfig, client_unit: e.target.value })}
                        disabled={!lockAvailable}
                        className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="如：某市公安局"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">所属行业</label>
                      <input
                        type="text"
                        value={lockConfig.client_industry}
                        onChange={e => setLockConfig({ ...lockConfig, client_industry: e.target.value })}
                        disabled={!lockAvailable}
                        className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="如：政府/医疗/教育"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-5">
                  <div className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Package className="w-4 h-4 text-warning" /> 乙方产品锁定
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">指定产品</label>
                    <input
                      type="text"
                      value={lockConfig.vendor_product}
                      onChange={e => setLockConfig({ ...lockConfig, vendor_product: e.target.value })}
                      disabled={!lockAvailable}
                      className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="如：智慧政务云平台 V3.0"
                    />
                  </div>
                </div>

                {lockConfig.scenario_locked && (
                  <div className="rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.05)' }}>
                    <Lock className="w-5 h-5" style={{ color: '#0EA5E9' }} />
                    <div>
                      <div className="text-sm font-semibold text-foreground">场景已锁定</div>
                      <div className="text-xs text-muted-foreground">
                        甲方：{lockConfig.client_unit || '未设置'} | 行业：{lockConfig.client_industry || '未设置'} | 产品：{lockConfig.vendor_product || '未设置'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 教练邀请码 */}
              <div className="mt-6 rounded-xl border border-border p-5">
               <div className="flex items-center justify-between mb-4">
                 <div>
                   <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                     <KeyRound className="w-4 h-4" style={{ color: '#EA580C' }} /> 培训教练邀请码
                   </div>
                    <div className="text-xs text-muted-foreground mt-0.5">邀请码数据模型尚未接入</div>
                 </div>
               </div>
                <div className="text-center py-6 text-sm text-muted-foreground">
                  邀请码服务尚未接入真实数据，当前无法生成或复制邀请码。
                </div>
              </div>
            </div>
          )}

          {/* 发起对局 */}
          {activeTab === 'initiate' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-foreground">发起对局记录</div>
                <button onClick={() => setShowInitiateModal(true)} disabled={!initiateAvailable} title={initiateAvailable ? '发起新对局' : (accessError ?? '发起对局接口尚未接入')} className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: '#0EA5E9' }}>
                  <Play className="w-3.5 h-3.5" /> 发起新对局
                </button>
              </div>
              {initiateRecords.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-container border-b border-border">
                        <th className="px-4 py-3 text-left font-semibold text-foreground">房间号</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">委托教练</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">教练查报告</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">参与人数</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">状态</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">发起时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {initiateRecords.map(r => (
                        <tr key={r.id} className="border-b border-border hover:bg-surface-container/50">
                          <td className="px-4 py-3 font-mono font-semibold text-foreground">{r.room_code}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.delegate_to_coach ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            }`}>{r.delegate_to_coach ? '联机版' : '单机版'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.allow_coach_view ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                            }`}>{r.allow_coach_view ? '是' : '否'}</span>
                          </td>
                          <td className="px-4 py-3 text-foreground">{r.player_count}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.status === '进行中' ? 'bg-success/10 text-success' :
                              r.status === '已结束' ? 'bg-muted text-muted-foreground' :
                              'bg-primary/10 text-primary'
                            }`}>{r.status}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {initiateAvailable ? '暂无发起记录' : (accessError ?? '发起对局接口尚未接入真实数据，当前仅显示空状态。')}
                </div>
              )}
            </div>
          )}

          {/* 定制内容 */}
          {activeTab === 'customize' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-semibold text-foreground">定制内容管理</div>
                <button onClick={() => { setCustomizeName(''); setCustomizeDesc(''); setShowCustomizeModal(true); }} disabled={!customizeAvailable} title={customizeAvailable ? '新增定制内容' : (accessError ?? '定制内容接口尚未接入')} className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: '#0EA5E9' }}>
                  <Plus className="w-3.5 h-3.5" /> 新增内容
                </button>
              </div>

              {/* Filter by type */}
              <div className="flex items-center gap-2 mb-4">
                {(['all', 'client', 'product', 'knowledge', 'history'] as const).map(type => (
                  <button
                    key={type}
                    disabled={!customizeAvailable}
                    className="px-3 py-1 rounded-full text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  >
                    {type === 'all' ? '全部' : customizeTypeLabels[type]}
                  </button>
                ))}
              </div>

              {customItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {customItems.map(item => {
                    const IconComp = customizeTypeIcons[item.type] || Package;
                    return (
                      <div key={item.id} className="rounded-xl border border-border p-4 flex items-start gap-3 hover:border-primary/30 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center flex-shrink-0">
                          <IconComp className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground truncate">{item.name}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-container text-muted-foreground">{customizeTypeLabels[item.type]}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</div>
                        </div>
                        <button onClick={() => handleDeleteCustomItem(item.id)} className="text-destructive hover:text-destructive/80 flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {customizeAvailable ? '暂无定制内容' : (accessError ?? '定制内容接口尚未接入真实数据，当前仅显示空状态。')}
                </div>
              )}
            </div>
          )}

          {/* 历史记录 */}
          {activeTab === 'history' && (
            <div>
              <div className="text-sm font-semibold text-foreground mb-4">发起历史与学员报告</div>
              {studentReports.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-container border-b border-border">
                        <th className="px-4 py-3 text-left font-semibold text-foreground">学员</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">房间</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">得分</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">轮次</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">结果</th>
                        <th className="px-4 py-3 text-left font-semibold text-foreground">完成时间</th>
                        <th className="px-4 py-3 text-right font-semibold text-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentReports.map(r => (
                        <tr key={r.id} className="border-b border-border hover:bg-surface-container/50">
                          <td className="px-4 py-3 font-semibold text-foreground">{r.player_name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-foreground">{r.room_code}</td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-bold text-foreground">{r.score}</span>
                            <span className="text-xs text-muted-foreground ml-1">分</span>
                          </td>
                          <td className="px-4 py-3 text-foreground">{r.rounds} 轮</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.result === 'win' ? 'bg-success/10 text-success' :
                              r.result === 'lose' ? 'bg-destructive/10 text-destructive' :
                              'bg-muted text-muted-foreground'
                            }`}>{r.result === 'win' ? '攻略成功' : r.result === 'lose' ? '攻略失败' : '进行中'}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(r.completed_at).toLocaleString('zh-CN')}</td>
                          <td className="px-4 py-3 text-right">
                            <button disabled title={accessError ?? '报告详情接口尚未接入'} className="text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50">
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {reportsAvailable ? '暂无学员报告' : (accessError ?? '学员报告接口尚未接入真实数据，当前仅显示空状态。')}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Player Modal */}
      {showPlayerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPlayerModal(false)}>
          <div className="bg-card rounded-2xl p-6 w-[400px] border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-semibold text-foreground">{editingPlayer ? '编辑玩家' : '添加玩家'}</div>
              <button onClick={() => setShowPlayerModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">用户名</label>
                <input
                  type="text"
                  value={playerForm.username}
                  onChange={e => setPlayerForm({ ...playerForm, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="输入用户名"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">角色</label>
                <select
                  value={playerForm.role}
                  onChange={e => setPlayerForm({ ...playerForm, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="player">玩家</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowPlayerModal(false)} className="px-4 py-2 rounded-lg bg-surface-container text-xs font-semibold text-foreground">取消</button>
              <button onClick={handleSavePlayer} className="px-4 py-2 rounded-lg text-white text-xs font-semibold flex items-center gap-1" style={{ background: '#0EA5E9' }}>
                <Save className="w-3.5 h-3.5" /> 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Initiate Modal */}
      {showInitiateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowInitiateModal(false)}>
          <div className="bg-card rounded-2xl p-6 w-[440px] border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-semibold text-foreground">发起新对局</div>
              <button onClick={() => setShowInitiateModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-surface-container/50 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">委托给培训教练</div>
                    <div className="text-xs text-muted-foreground mt-1">开启后由培训教练控制游戏，为联机版</div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !initiateDelegate;
                      setInitiateDelegate(next);
                      if (next) setInitiateCoachVisible(true);
                    }}
                    className={`w-12 h-6 rounded-full transition-colors ${initiateDelegate ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${initiateDelegate ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
              <div className={`p-4 rounded-lg border ${initiateDelegate ? 'bg-surface-container/50 border-border' : 'bg-surface-container/30 border-border/50 opacity-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">允许教练查看报告</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {initiateDelegate ? '开启后培训教练可查看学员报告' : '需先开启「委托给培训教练」'}
                    </div>
                  </div>
                  <button
                    onClick={() => initiateDelegate && setInitiateCoachVisible(!initiateCoachVisible)}
                    disabled={!initiateDelegate}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      !initiateDelegate ? 'bg-muted cursor-not-allowed' : initiateCoachVisible ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      !initiateDelegate ? 'translate-x-0.5' : initiateCoachVisible ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowInitiateModal(false)} className="px-4 py-2 rounded-lg bg-surface-container text-xs font-semibold text-foreground">取消</button>
              <button onClick={handleInitiate} className="px-4 py-2 rounded-lg text-white text-xs font-semibold flex items-center gap-1" style={{ background: '#0EA5E9' }}>
                <Play className="w-3.5 h-3.5" /> 发起
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customize Modal */}
      {showCustomizeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCustomizeModal(false)}>
          <div className="bg-card rounded-2xl p-6 w-[440px] border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-semibold text-foreground">新增定制内容</div>
              <button onClick={() => setShowCustomizeModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">内容类型</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['client', 'product', 'knowledge', 'history'] as const).map(type => {
                    const IconComp = customizeTypeIcons[type];
                    return (
                      <button
                        key={type}
                        onClick={() => setCustomizeType(type)}
                        className={`p-2 rounded-lg border text-center transition-all ${
                          customizeType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                        }`}
                      >
                        <IconComp className={`w-4 h-4 mx-auto mb-1 ${customizeType === type ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="text-[10px] font-medium text-foreground">{customizeTypeLabels[type]}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">名称</label>
                <input
                  type="text"
                  value={customizeName}
                  onChange={e => setCustomizeName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="输入名称"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">描述</label>
                <textarea
                  value={customizeDesc}
                  onChange={e => setCustomizeDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container border-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  placeholder="输入描述信息"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowCustomizeModal(false)} className="px-4 py-2 rounded-lg bg-surface-container text-xs font-semibold text-foreground">取消</button>
              <button onClick={handleAddCustomItem} className="px-4 py-2 rounded-lg text-white text-xs font-semibold flex items-center gap-1" style={{ background: '#0EA5E9' }}>
                <Save className="w-3.5 h-3.5" /> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
