import type { Metadata } from 'next';
import { FastTestPanel } from '@/components/testing/FastTestPanel';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'sellsmart · AI 销售实训',
    template: '%s | sellsmart',
  },
  description: '面向政企销售的 AI 竞标博弈与复盘训练平台。',
  keywords: ['政企销售', '竞标实训', 'AI 对话', '销售复盘'],
  generator: 'Next.js',
  openGraph: {
    title: 'sellsmart · AI 销售实训',
    description: '通过 AI 驱动的 NPC 对话、关系经营和竞标复盘训练销售能力。',
    siteName: 'sellsmart',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: { index: true, follow: true },
  icons: { icon: '/brand/sellsmart-mark.svg', apple: '/brand/sellsmart-mark.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
        <FastTestPanel />
      </body>
    </html>
  );
}
