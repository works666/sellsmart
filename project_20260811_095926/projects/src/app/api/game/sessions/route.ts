import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createGameSessionRequestSchema } from '@/lib/contracts/game';
import { createGameSession, listOwnedActiveGameSaves, MAX_ACTIVE_GAME_SAVES } from '@/lib/game/repository';
import { getProgressionMultiplier } from '@/lib/game/acceptance-mode';
import { toPlayerVisibleGameState } from '@/lib/game/state';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const scenarioCode = request.nextUrl.searchParams.get('scenarioCode') || undefined;
  try {
    const saves = await listOwnedActiveGameSaves(guard.session.userId, scenarioCode);
    return NextResponse.json({ success: true, saves, maxSaves: MAX_ACTIVE_GAME_SAVES });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SAVE_LIST_UNAVAILABLE';
    return NextResponse.json({ error: code }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;

  const parsed = createGameSessionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '对局创建参数无效', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const gameSession = await createGameSession(
      guard.session.userId,
      guard.session.displayName,
      parsed.data.scenarioCode,
      getProgressionMultiplier(guard.session.userId),
      parsed.data.replaceExisting,
    );
    return NextResponse.json({ success: true, gameSession: { ...gameSession, state: toPlayerVisibleGameState(gameSession.state) } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SESSION_CREATE_FAILED';
    const status = code === 'SCENARIO_NOT_CONFIGURED' || code === 'SAVE_LIMIT_REACHED' || code === 'SAVE_REPLACE_FAILED' ? 409 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
