import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createServerClient } from '@/storage/database/supabase-client';

const COACH_ROLES = new Set(['trainer', 'enterprise_admin', 'platform_designer']);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const g = authGuard(request);
  if (!g.ok || !g.session) return g.response!;
  const { id } = await context.params;
  const { data, error } = await createServerClient().from('multiplayer_rooms').select('*, multiplayer_company_slots(*)').eq('id', id).single();
  if (error || !data) return NextResponse.json({ error: 'ROOM_NOT_FOUND' }, { status: 404 });
  if (data.host_user_id !== g.session.userId && !COACH_ROLES.has(g.session.role)) return NextResponse.json({ error: '权限不足' }, { status: 403 });
  return NextResponse.json({ data });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const g = authGuard(request);
  if (!g.ok || !g.session) return g.response!;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const supabase = createServerClient();
  const { data: room } = await supabase.from('multiplayer_rooms').select('host_user_id').eq('id', id).single();
  if (!room || (room.host_user_id !== g.session.userId && !COACH_ROLES.has(g.session.role))) return NextResponse.json({ error: '权限不足' }, { status: 403 });
  if (body.action === 'force_ready') return NextResponse.json({ error: 'GAME_PHASE_DESIGN_REMOVED' }, { status: 410 });
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return NextResponse.json({ error: 'ROOM_VERSION_INVALID' }, { status: 400 });
  }
  if (body.action === 'remove_player' && typeof body.slotId === 'string') {
    const { data, error } = await supabase.rpc('remove_multiplayer_player', { p_room_id: id, p_slot_id: body.slotId, p_expected_version: expectedVersion });
    if (error || !data) return NextResponse.json({ error: error?.message?.startsWith('ROOM_VERSION_CONFLICT') ? 'ROOM_VERSION_CONFLICT' : 'REMOVE_PLAYER_FAILED' }, { status: error?.message?.startsWith('ROOM_VERSION_CONFLICT') ? 409 : 503 });
    return NextResponse.json({ success: true, data });
  }
  return NextResponse.json({ error: 'ROOM_ACTION_INVALID' }, { status: 400 });
}
