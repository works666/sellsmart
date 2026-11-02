'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wand2, Building2, Megaphone, UserRound, X } from 'lucide-react';

type Identity = 'designer' | 'enterprise' | 'trainer' | 'player';
type SubRole = 'enterprise_employee' | 'paid_individual';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('17805156105');
  const [password, setPassword] = useState('qwer1234');
  const [countdown, setCountdown] = useState(0);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [selectedIdentity, setSelectedIdentity] = useState<Identity | null>(null);
  const [subRole, setSubRole] = useState<SubRole>('enterprise_employee');
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<'phone' | 'password'>('password');
  const [loginToken, setLoginToken] = useState('');

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      alert('请输入正确的手机号');
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_code', phone }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '发送失败'); return; }
      setCountdown(data.cooldown ?? 60);
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) { clearInterval(timer); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      alert('网络错误');
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      // 账号密码模式 vs 手机验证码模式
      const isPassword = loginMode === 'password';
      const body = isPassword
        ? { action: 'login', username, password }
        : { action: 'login', phone, code };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || '登录失败');
        return;
      }
      const data = await res.json();
      setLoginToken(data.loginToken);

      // 所有账号都弹身份选择卡
      setShowIdentityModal(true);
    } catch (err) {
      alert('网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 前端 id -> API role 映射
  const IDENTITY_TO_ROLE: Record<Identity, 'platform_designer' | 'enterprise_admin' | 'trainer' | 'player'> = {
    designer: 'platform_designer',
    enterprise: 'enterprise_admin',
    trainer: 'trainer',
    player: 'player',
  };

  const enterWorkbench = async () => {
    if (!selectedIdentity || !loginToken) {
      alert('登录凭证已失效，请重新登录');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select_role',
          loginToken,
          role: IDENTITY_TO_ROLE[selectedIdentity],
          subRole: selectedIdentity === 'player' ? subRole : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '选择失败'); setLoading(false); return; }

      // 存 token + identity 到 cookie 和 localStorage
      const identity = data.session;
      const expires = new Date(identity.expiresAt);
      document.cookie = `weixun_session=${data.token}; path=/; expires=${expires.toUTCString()}`;
      document.cookie = `weixun_identity=${encodeURIComponent(JSON.stringify(identity))}; path=/; expires=${expires.toUTCString()}`;
      // 同时存储到 localStorage 作为备份
      localStorage.setItem('weixun_identity', JSON.stringify(identity));
      localStorage.setItem('weixun_session', data.token);

      // 使用 window.location.href 强制全页刷新，确保 cookie 生效
      window.location.href = data.redirect || '/home';
    } catch (err) {
      alert('进入失败');
      setLoading(false);
    }
  };

  const identities = [
    { id: 'designer' as Identity, name: '游戏设计师', icon: Wand2, desc: '搭建与维护整个平台', permissions: ['页面编辑', '数据表', '工作流', '权限'] },
    { id: 'enterprise' as Identity, name: '企业管理员', icon: Building2, desc: '管理学院与员工', permissions: ['学员管理', '邀请码', '查看对话', '下载报告'], noGame: true },
    { id: 'trainer' as Identity, name: '培训教练', icon: Megaphone, desc: '组织多人联机实训', permissions: ['创建房间', '启停对局', '实时数据', '统一点评'] },
    { id: 'player' as Identity, name: '玩家', icon: UserRound, desc: '参与博弈演练', permissions: ['单局博弈', '对局记录', '复盘报告'] },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-login-stage">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between animate-fade-up">
        <Link href="/" className="flex items-center gap-3" aria-label="sellsmart 首页">
          <Image src="/brand/sellsmart-mark.svg" alt="" width={36} height={36} />
          <div>
            <div className="text-base font-semibold text-foreground">sellsmart</div>
            <div className="text-xs text-muted-foreground">政企销售 AI 竞标实训</div>
          </div>
        </Link>
        <Link href="/" className="text-xs text-muted-foreground transition-colors hover:text-foreground">返回首页</Link>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[440px] animate-fade-up-1">
          <div className="rounded-2xl bg-card border border-border shadow-xl p-8 sm:p-10">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-foreground mb-2">登录到工作台</h1>
              <p className="text-sm text-muted-foreground">使用手机号或企业账号登录</p>
            </div>

            <Tabs value={loginMode} onValueChange={(v) => setLoginMode(v as 'phone' | 'password')} defaultValue="password">
              <TabsList className="w-full grid grid-cols-2 mb-6">
                <TabsTrigger value="phone">手机验证码</TabsTrigger>
                <TabsTrigger value="password">账号密码</TabsTrigger>
              </TabsList>

              <TabsContent value="phone" className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">手机号</Label>
                  <Input
                    type="tel"
                    placeholder="请输入手机号"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1.5 bg-surface-container border-none h-11"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">验证码</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      type="text"
                      placeholder="6 位验证码"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="flex-1 bg-surface-container border-none h-11"
                    />
                    <Button
                      onClick={sendCode}
                      disabled={countdown > 0}
                      variant="outline"
                      className="h-11 px-4"
                    >
                      {countdown > 0 ? `${countdown}s` : '发送验证码'}
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={handleLogin}
                  disabled={loading}
                  className="w-full h-11 btn-primary"
                >
                  {loading ? '登录中...' : '立即登录'}
                </Button>
              </TabsContent>

              <TabsContent value="password" className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">账号</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="手机号 / 工号"
                    className="mt-1.5 bg-surface-container border-none h-11"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">密码</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="mt-1.5 bg-surface-container border-none h-11"
                  />
                </div>
                <Button
                  onClick={handleLogin}
                  disabled={loading}
                  className="w-full h-11 btn-primary"
                >
                  {loading ? '登录中...' : '立即登录'}
                </Button>
                <div className="text-[11px] text-muted-foreground text-center pt-1">
                  预制账号 <span className="font-mono text-foreground">17805156105</span> / <span className="font-mono text-foreground">qwer1234</span> 可登录任意身份
                </div>
                <div className="text-[11px] text-primary text-center">
                  FAST 测试账号 <span className="font-mono">fast_acceptance</span> / <span className="font-mono">fastpass</span>（选择玩家后可正常游戏，右侧可打开测试后台）
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-6 pt-6 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="rounded" /> 记住登录状态
              </label>
              <span>验证码登录遇到问题？请稍后重试</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-4 text-center text-xs text-muted-foreground animate-fade-up-2">
        <div>sellsmart · 政企销售 AI 竞标实训</div>
      </footer>

      {/* 身份选择弹窗 */}
      {showIdentityModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
          onClick={() => setShowIdentityModal(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl w-[880px] max-w-[95vw] p-8 animate-modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-foreground">选择你的身份</h2>
                <p className="text-sm text-muted-foreground mt-1">不同身份对应不同权限和工作台</p>
              </div>
              <button onClick={() => setShowIdentityModal(false)} className="text-muted-foreground hover:text-foreground p-1.5 hover:bg-muted rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {identities.map((item) => {
                const Icon = item.icon;
                const isSelected = selectedIdentity === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedIdentity(item.id)}
                    className={`relative p-5 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-lg -translate-y-1'
                        : 'border-border bg-card hover:border-primary/40 hover:-translate-y-1 hover:shadow-md'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="text-base font-semibold text-foreground mb-1">{item.name}</div>
                    <div className="text-xs text-muted-foreground mb-3">{item.desc}</div>
                    <div className="space-y-1">
                      {item.permissions.map((p) => (
                        <div key={p} className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-primary" /> {p}
                        </div>
                      ))}
                    </div>
                    {item.noGame && (
                      <div className="mt-3 inline-block badge badge-warning">
                        无游戏对战
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 玩家二级 Tab */}
            {selectedIdentity === 'player' && (
              <div className="mb-6 p-4 rounded-xl bg-surface-container">
                <div className="text-xs text-muted-foreground mb-2">玩家身份细分（互斥）</div>
                <div className="flex gap-2">
                  {[
                    { id: 'enterprise_employee' as SubRole, label: '企业员工', desc: '邀请码 + 手机号绑定企业' },
                    { id: 'paid_individual' as SubRole, label: '付费个人', desc: '付费解锁通用场景' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSubRole(s.id)}
                      className={`flex-1 px-4 py-3 rounded-lg text-sm transition ${
                        subRole === s.id
                          ? 'btn-primary'
                          : 'bg-card text-foreground hover:bg-primary/10 border border-border'
                      }`}
                    >
                      <div className="font-semibold">{s.label}</div>
                      <div className="text-[11px] opacity-70 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => setShowIdentityModal(false)}>取消</Button>
              <Button
                onClick={enterWorkbench}
                disabled={!selectedIdentity || loading}
                className="btn-primary"
              >
                {loading ? '进入中...' : '进入工作台'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
