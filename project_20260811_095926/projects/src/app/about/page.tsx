import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  MessageCircle,
  Network,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react';
import styles from '../landing.module.css';

export const metadata: Metadata = {
  title: '产品介绍',
  description: '在贴近政企项目的竞标情境中，与 AI 客户角色练习沟通、关系推进与方案表达。',
  openGraph: {
    title: '产品介绍',
    description: '把每一次练习，变成赢单的底气。',
    type: 'website',
  },
};

const channels = ['电话', '邮件', '微信', '邮寄', '拜访'];

const capabilityCards = [
  {
    number: '01',
    icon: UsersRound,
    title: '在真实岗位关系中练习',
    description: '与五位职责各异的 AI 客户角色沟通，理解组织里的不同关注点，把零散信息串成推进思路。',
    tags: ['角色判断', '信息验证'],
  },
  {
    number: '02',
    icon: MessageCircle,
    title: '用多种方式推进沟通',
    description: '从电话、邮件、微信，到邮寄材料与预约拜访，练习选择合适方式、组织表达并推动下一步。',
    tags: channels.slice(0, 3),
  },
  {
    number: '03',
    icon: Target,
    title: '从方案表达走到竞标复盘',
    description: '在不同竞品优势与采购规则下推进方案，完成对局后查看结果和复盘建议。',
    tags: ['方案推进', '结果复盘'],
  },
];

const audiences = [
  {
    icon: Building2,
    title: '企业销售团队',
    description: '让团队围绕共同的政企竞标情境，练习需求理解、客户沟通与方案表达。',
  },
  {
    icon: Network,
    title: '培训教练',
    description: '以真实对话、行动选择与赛后复盘为切入点，组织讨论与带教，帮助学员把策略讲清楚。',
  },
  {
    icon: Sparkles,
    title: '一线销售',
    description: '在客户现场之前，反复演练信息判断、异议回应和关键沟通。',
  },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="sellsmart 首页">
            <Image src="/brand/sellsmart-mark.svg" alt="" width={36} height={36} priority />
            <span className={styles.brandName}>sellsmart</span>
          </Link>

          <nav className={styles.desktopNavigation} aria-label="主导航">
            <a href="#capabilities">产品能力</a>
            <a href="#how-it-works">实训流程</a>
            <a href="#audience">适用人群</a>
            <Link className={styles.headerLogin} href="/login">登录</Link>
          </nav>

          <details className={styles.mobileNavigation}>
            <summary aria-label="打开导航菜单">菜单</summary>
            <nav className={styles.mobileMenu} aria-label="移动端主导航">
              <a href="#capabilities">产品能力</a>
              <a href="#how-it-works">实训流程</a>
              <a href="#audience">适用人群</a>
              <Link href="/login">登录 / 开始实训 <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </nav>
          </details>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.eyebrowDot} /> 政企销售 AI 竞标实训</p>
            <h1 id="hero-title">把每一次练习，<br />变成赢单的底气。</h1>
            <p className={styles.heroDescription}>
              围绕贴近政企项目的竞标情境，和 AI 客户角色展开多渠道沟通，练习理解需求、建立信任与推进方案。
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryButton} href="/login">
                开始实训 <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
              </Link>
              <a className={styles.secondaryButton} href="#how-it-works">
                了解实训 <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className={styles.heroNote}>
              <span className={styles.noteCheck}><Check size={13} aria-hidden="true" /></span>
              <span>从第一次接触，到关键决策与结果复盘</span>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <Image
              className={styles.heroImage}
              src="/images/landing/sales-training-hero.png"
              alt="销售团队围绕客户沟通情境进行讨论和演练"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 54vw"
            />
            <div className={`${styles.floatingCard} ${styles.roleCard}`}>
              <div className={styles.roleCardTop}>
                <span className={styles.roleIcon}><UsersRound size={17} aria-hidden="true" /></span>
                <span>客户角色</span>
                <span className={styles.liveDot} aria-label="实训角色" />
              </div>
              <strong>五位 AI 客户角色</strong>
              <div className={styles.avatarDots} aria-hidden="true"><i /><i /><i /><i /><i /></div>
            </div>
            <div className={`${styles.floatingCard} ${styles.dialogueCard}`}>
              <div className={styles.dialogueHeading}><span className={styles.dialogueSpark}><Sparkles size={13} aria-hidden="true" /></span> AI 对话训练 <span>模拟片段</span></div>
              <p className={styles.dialogueQuestion}>“这项方案，准备怎样保障后续落地？”</p>
              <div className={styles.dialogueReply}><span>下一步</span> 先厘清关注点，再组织方案表达</div>
            </div>
            <div className={styles.imageCaption}><span /> 沟通 · 判断 · 复盘</div>
          </div>
        </section>

        <section className={styles.featureBar} aria-label="实训内容概览">
          <div className={styles.featureMetric}>
            <strong>05</strong>
            <span><b>位 AI 客户角色</b><small>不同职责与沟通关注点</small></span>
          </div>
          <div className={styles.featureMetric}>
            <strong>05</strong>
            <span><b>种沟通方式</b><small>沟通、邮寄材料与拜访</small></span>
          </div>
          <div className={styles.featureMetric}>
            <strong>20</strong>
            <span><b>分钟实训时限</b><small>拜访期间暂停倒计时</small></span>
          </div>
        </section>

        <section className={styles.capabilitiesSection} id="capabilities" aria-labelledby="capabilities-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionEyebrow}>WHAT YOU CAN PRACTICE</p>
              <h2 id="capabilities-title">练的不只是一句话，<br />更是整个销售过程。</h2>
            </div>
            <p>一次完整的竞标实训，包含客户理解、沟通推进、方案判断与事后复盘。</p>
          </div>
          <div className={styles.capabilityGrid}>
            {capabilityCards.map(({ number, icon: Icon, title, description, tags }) => (
              <article className={styles.capabilityCard} key={number}>
                <div className={styles.capabilityTop}>
                  <span className={styles.capabilityIcon}><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
                  <span className={styles.capabilityNumber}>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
                <div className={styles.tagRow}>{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.processSection} id="how-it-works" aria-labelledby="process-title">
          <div className={styles.processShell}>
            <div className={styles.processHeading}>
              <div>
                <p className={styles.processEyebrow}><span /> THE TRAINING JOURNEY</p>
                <h2 id="process-title">从初次接触，<br />走到关键决策。</h2>
              </div>
              <p>在 20 分钟内结合人物、沟通渠道与客户反馈调整策略。时间用于推进项目，每 5 分钟补充行动点，实际拜访期间暂停计时。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-white/70 bg-white/75 p-4 shadow-sm"><strong className="text-sm text-[#233d66]">计时推进项目</strong><p className="mt-2 text-xs leading-5 text-[#68758c]">在 20 分钟内了解客户、沟通需求并完善方案。</p></article>
              <article className="rounded-xl border border-white/70 bg-white/75 p-4 shadow-sm"><strong className="text-sm text-[#233d66]">行动点定期恢复</strong><p className="mt-2 text-xs leading-5 text-[#68758c]">每经过 5 分钟恢复 5 点行动点，最多保留 28 点。</p></article>
              <article className="rounded-xl border border-white/70 bg-white/75 p-4 shadow-sm"><strong className="text-sm text-[#233d66]">拜访期间暂停</strong><p className="mt-2 text-xs leading-5 text-[#68758c]">拜访结束后按每轮对话 15 秒扣除时间，再继续推进。</p></article>
            </div>
            <div className={styles.processFooter}>
              <div className={styles.channelList}>
                <span>接触方式</span>
                {channels.map((channel) => <i key={channel}>{channel}</i>)}
              </div>
              <p>一次选择，带来一次真实的推进反馈。</p>
            </div>
          </div>
        </section>

        <section className={styles.audienceSection} id="audience" aria-labelledby="audience-title">
          <div className={styles.audienceHeading}>
            <p className={styles.sectionEyebrow}>MADE FOR REAL SALES MOMENTS</p>
            <h2 id="audience-title">让每一种角色，<br />找到练习的起点。</h2>
          </div>
          <div className={styles.audienceGrid}>
            {audiences.map(({ icon: Icon, title, description }, index) => (
              <article className={styles.audienceCard} key={title}>
                <span className={`${styles.audienceIcon} ${index === 1 ? styles.audienceIconOrange : ''}`}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /></span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div className={styles.ctaGlow} aria-hidden="true" />
          <div>
            <p className={styles.ctaEyebrow}>准备好开始了吗？</p>
            <h2 id="cta-title">下一次沟通，<br />先练在这里。</h2>
            <p>走进一场政企竞标实训，从你的第一步策略开始。</p>
          </div>
          <Link className={styles.ctaButton} href="/login">开始实训 <ArrowRight size={18} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link className={styles.footerBrand} href="/" aria-label="sellsmart 首页">
          <Image src="/brand/sellsmart-mark.svg" alt="" width={30} height={30} />
          <span>sellsmart</span>
        </Link>
        <p>政企销售 AI 竞标实训</p>
        <nav aria-label="页脚导航">
          <a href="#capabilities">产品能力</a>
          <a href="#how-it-works">实训流程</a>
          <Link href="/login">登录</Link>
        </nav>
        <span className={styles.footerCopyright}>© sellsmart</span>
      </footer>
    </div>
  );
}
