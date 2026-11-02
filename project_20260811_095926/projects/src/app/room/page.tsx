import Link from 'next/link';
import { ArrowLeft, Megaphone } from 'lucide-react';

export default function RoomPage() {
  return (
    <main className="min-h-screen bg-role-trainer flex items-center justify-center px-6">
      <section className="card-elevated max-w-lg w-full p-8 text-center">
        <div className="w-12 h-12 rounded-xl btn-warning mx-auto mb-4 flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-bold text-foreground">房间实时看板暂未开放</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          当前没有可用于此页面的实时事件或在线状态数据源。为避免把演示数据当作真实房间状态，请返回教练工作台管理已建模的房间和公司席位。
        </p>
        <Link href="/coach" className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg btn-warning text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> 返回教练工作台
        </Link>
      </section>
    </main>
  );
}
