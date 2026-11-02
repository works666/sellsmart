import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createProjectOneState } from '@/lib/game/state';
import { createServerClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const body = await request.json().catch(() => null) as { roomCode?: unknown; companyId?: unknown } | null;
  const roomCode = typeof body?.roomCode === 'string' ? body.roomCode.trim().toUpperCase() : '';
  const companyId = typeof body?.companyId === 'string' ? body.companyId.trim() : '';
  if (!/^[A-Z0-9]{1,12}$/.test(roomCode) || !/^[A-Za-z0-9_-]{1,64}$/.test(companyId)) {
    return NextResponse.json({ error: 'JOIN_PARAMETERS_INVALID' }, { status: 400 });
  }
  const createdState = createProjectOneState();
  const initialState = {
    ...createdState,
    gameMode: 'multiplayer' as const,
    companyId,
    projectTimer: { ...createdState.projectTimer, lastResumedAt: null, visitPaused: false },
  };
  const { data, error } = await createServerClient().rpc('join_multiplayer_company', {
    p_room_code: roomCode,
    p_company_id: companyId,
    p_user_id: guard.session.userId,
    p_user_name: guard.session.displayName,
    p_state: initialState,
  });
  if (error || !data) {
    const code = error?.message?.split(/\s|:/, 1)[0] ?? 'ROOM_JOIN_FAILED';
    const status = code === 'ROOM_NOT_FOUND' ? 404 : code === 'SCENARIO_NOT_CONFIGURED' ? 503 : 409;
    return NextResponse.json({ error: ['ROOM_NOT_FOUND', 'ROOM_ALREADY_STARTED', 'PLAYER_ALREADY_JOINED', 'COMPANY_SLOT_NOT_FOUND', 'COMPANY_SLOT_OCCUPIED', 'SCENARIO_NOT_CONFIGURED'].includes(code) ? code : 'ROOM_JOIN_FAILED' }, { status });
  }
  return NextResponse.json({ data });
}
