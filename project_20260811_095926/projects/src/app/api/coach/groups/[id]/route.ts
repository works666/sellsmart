import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';

// 延期后台功能（小组详情）：对应数据表尚未建模，先干净降级，避免向客户端泄漏内部错误。
export async function GET(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

export async function PUT(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}
