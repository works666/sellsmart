import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';

// 延期后台功能（企业玩家管理）：列名尚未对齐真实 schema，先干净降级，避免向客户端泄漏内部错误。
export async function GET(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

export async function POST(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

export async function PUT(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

export async function DELETE(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}
