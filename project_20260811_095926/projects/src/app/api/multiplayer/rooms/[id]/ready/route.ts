import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  return NextResponse.json({ error: 'GAME_PHASE_DESIGN_REMOVED' }, { status: 410 });
}
