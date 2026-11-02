import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Play } from 'lucide-react';
import { getSession, type Role } from '@/lib/auth/identity';
import styles from './entry.module.css';

export const metadata: Metadata = {
  title: 'sellsmart｜销售竞标实训',
  description: '进入 sellsmart 销售竞标实训，在客户、竞品与关键决策间打出你的策略。',
};

const destinations: Record<Role, { href: string; label: string }> = {
  player: { href: '/start', label: '开始游戏' },
  trainer: { href: '/coach', label: '进入工作台' },
  enterprise_admin: { href: '/enterprise-admin', label: '进入工作台' },
  platform_designer: { href: '/designer', label: '进入工作台' },
};

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = getSession(cookieStore.get('weixun_session')?.value);
  const destination = session ? destinations[session.role] : { href: '/login', label: '开始游戏' };
  const accountLink = session
    ? { href: destinations[session.role].href, label: session.role === 'player' ? '进入游戏' : '工作台' }
    : { href: '/login', label: '登录' };

  return (
    <div className={styles.page}>
      <div className={styles.scene} aria-hidden="true">
        <Image
          className={`${styles.sceneImage} ${styles.desktopScene}`}
          src="/images/landing/sellsmart-entry-background-v4.png"
          alt=""
          fill
          priority
          sizes="100vw"
        />
        <Image
          className={`${styles.sceneImage} ${styles.mobileScene}`}
          src="/images/landing/sellsmart-entry-mobile-v4.png"
          alt=""
          fill
          sizes="(max-width: 560px) 100vw, 1px"
        />
      </div>

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="sellsmart 首页">
          <Image src="/brand/sellsmart-mark.svg" alt="" width={36} height={36} priority />
          <span>sellsmart</span>
        </Link>
        <Link className={styles.accountLink} href={accountLink.href}>
          {accountLink.label}
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.eyebrow}><span aria-hidden="true" /> 政企销售竞标模拟</p>
          <div className={styles.wordmark} aria-label="sellsmart">sellsmart</div>
          <h1 id="hero-title">销售竞标，等你开局。</h1>
          <p className={styles.description}>走进客户现场，在沟通与博弈中争取下一个项目。</p>
          <div className={styles.actions}>
            <Link className={styles.playButton} href={destination.href}>
              <Play size={19} fill="currentColor" strokeWidth={1.7} aria-hidden="true" />
              <span>{destination.label}</span>
            </Link>
            <Link className={styles.aboutLink} href="/about">产品介绍</Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>AI 角色</span><i aria-hidden="true" />
        <span>竞标博弈</span><i aria-hidden="true" />
        <span>对局复盘</span>
      </footer>
    </div>
  );
}
