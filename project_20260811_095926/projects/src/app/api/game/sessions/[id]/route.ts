import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { appendGameEvent, deleteOwnedActiveGameSave, processPendingCustomerActivityDetections, processSubmittedCustomerActivityEvaluations, synchronizeOwnedGameTimer } from '@/lib/game/repository';
import { getGameOutcome, toPlayerVisibleGameOutcome, toPlayerVisibleGameState } from '@/lib/game/state';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;

  try {
    let gameSession = await synchronizeOwnedGameTimer(id, guard.session.userId);
    gameSession = await processPendingCustomerActivityDetections(id, guard.session.userId).catch(() => gameSession);
    gameSession = await processSubmittedCustomerActivityEvaluations(id, guard.session.userId).catch(() => gameSession);
    if (request.nextUrl.searchParams.get('entry') === 'continue') {
      await appendGameEvent(id, gameSession.state.currentRound, 'session.continued', {
        round: gameSession.state.currentRound,
        version: gameSession.state.version,
        hasActiveMeeting: Boolean(gameSession.state.activeMeeting),
      }).catch(() => undefined);
    }
    return NextResponse.json({
      success: true,
      gameSession: {
        ...gameSession,
        state: toPlayerVisibleGameState(gameSession.state),
        ...(gameSession.state.status === 'playing' ? {} : { outcome: toPlayerVisibleGameOutcome(getGameOutcome(gameSession.state)) }),
      },
    });
  } catch {
    return NextResponse.json({ error: '对局不存在或无权访问' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;
  try {
    await deleteOwnedActiveGameSave(id, guard.session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SAVE_DELETE_FAILED';
    const status = code === 'SAVE_NOT_DELETABLE' ? 409 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
