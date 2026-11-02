import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { processPendingCustomerActivityDetections, processSubmittedCustomerActivityEvaluations, synchronizeOwnedGameTimer } from '@/lib/game/repository';
import { getGameOutcome, toPlayerVisibleGameOutcome, toPlayerVisibleGameState } from '@/lib/game/state';

export const runtime = 'nodejs';

async function sync(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;
  try {
    let session = await synchronizeOwnedGameTimer(id, guard.session.userId);
    session = await processPendingCustomerActivityDetections(id, guard.session.userId).catch(() => session);
    session = await processSubmittedCustomerActivityEvaluations(id, guard.session.userId).catch(() => session);
    return NextResponse.json({
      success: true,
      state: toPlayerVisibleGameState(session.state),
      ...(session.state.status === 'playing' ? {} : { outcome: toPlayerVisibleGameOutcome(getGameOutcome(session.state)) }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TIMER_SYNC_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'STATE_VERSION_CONFLICT' ? 409 : 404 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return sync(request, context);
}

/** No pause/resume body is accepted: only an active server visit may pause time. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return sync(request, context);
}
