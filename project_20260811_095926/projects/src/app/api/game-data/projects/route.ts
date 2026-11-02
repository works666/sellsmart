import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';

// GET /api/game-data/projects - 项目难度表尚未建模；start 页已硬编码 DEFAULT_PROJECTS 兜底，先干净降级。
export async function GET() {
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

// PUT /api/game-data/projects/:id - 修改项目难度（设计师 CRUD，尚未建模）
export async function PUT(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}
