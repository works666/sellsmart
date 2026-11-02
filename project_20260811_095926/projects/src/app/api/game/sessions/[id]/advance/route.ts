import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  return NextResponse.json({
    error: 'LEGACY_MUTATION_ENDPOINT_REMOVED',
    commandType: 'advance_phase',
    commandEndpoint: 'POST /api/game/sessions/:id/commands',
  }, { status: 410 });
}
