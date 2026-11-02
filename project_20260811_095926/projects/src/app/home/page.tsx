'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trophy, ArrowUpRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';

export default function HomePage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<{ name: string; displayName: string; role: string } | null>(null);

  useEffect(() => {
    // 读取身份 - 优先 localStorage，备选 cookie
    let identityData: string | null = null;

    // 方式1：从 localStorage 读取
    identityData = localStorage.getItem('weixun_identity');

    // 方式2：从 cookie 读取（备份）
    if (!identityData) {
      const match = document.cookie.match(/(?:^| )weixun_identity=([^;]+)/);
      if (match) {
        identityData = decodeURIComponent(match[1]);
      }
    }

    if (!identityData) {
      router.push('/');
      return;
    }

    try {
      setIdentity(JSON.parse(identityData));
    } catch (e) {
      console.error('Failed to parse identity:', e, identityData);
      router.push('/');
    }
  }, [router]);

  const hotspots = [
    { href: '/start', left: '50%', top: '39%', icon: Trophy, label: '游戏入口', primary: true },
  ];

  return (
    <AppShell identity={identity} activeNav="home" roleAccent={identity?.role}>
      <div className="mb-8 animate-fade-up">
        <div className="flex items-center gap-3 mb-2">
          <span className="badge badge-primary">已登录</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-1">
          早上好，<span className="text-gradient-primary">{identity?.displayName || '同学'}</span>
        </h1>
        <p className="text-sm text-muted-foreground">你的政企销售竞标实训已就绪，可以开始新的博弈演练。</p>
      </div>

      <div className="card-elevated overflow-hidden animate-fade-up-2">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card">
          <div>
            <h2 className="text-lg font-semibold text-foreground">竞标博弈城</h2>
            <p className="text-xs text-muted-foreground mt-0.5">点击建筑徽标或文字气泡进入对应模块</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-muted">{hotspots.length} 个功能入口</span>
          </div>
        </div>

        <div className="relative aspect-[16/9] bg-gradient-to-br from-surface-container to-surface-container-high overflow-hidden">
          <img
            src="/game-park.webp"
            alt="竞标博弈城"
            className="absolute inset-0 w-full h-full object-cover opacity-95"
            onError={(e) => { (e.target as HTMLImageElement).src = '/game-park.jpg'; }}
          />

          {hotspots.map((h) => {
            const Icon = h.icon;
            return (
              <Link
                key={h.href}
                href={h.href}
                className="absolute z-10 group"
                style={{ left: h.left, top: h.top, transform: 'translate(-50%, -50%)' }}
              >
                <div className="relative transition-transform duration-200 group-hover:scale-110">
                  {h.primary && (
                    <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
                  )}
                  <span
                    className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 border-card ${
                      h.primary ? 'btn-primary' : 'bg-card border-primary text-primary'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${h.primary ? 'text-primary-foreground' : 'text-primary'}`} />
                  </span>
                  <div className="absolute left-1/2 -translate-x-1/2 top-16 whitespace-nowrap px-3 py-1.5 rounded-lg bg-card/95 backdrop-blur border border-border text-sm font-semibold text-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    {h.label}
                    <ArrowUpRight className="inline-block w-3 h-3 ml-1 -mt-0.5 text-primary" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
