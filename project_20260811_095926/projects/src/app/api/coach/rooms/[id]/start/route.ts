import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createServerClient } from '@/storage/database/supabase-client';

const COACH_ROLES = new Set(['trainer', 'enterprise_admin', 'platform_designer']);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const g = authGuard(request);
  if (!g.ok || !g.session) return g.response!;
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
  const expectedVersion = body?.expectedVersion;
  if (!Number.isInteger(expectedVersion) || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return NextResponse.json({ error: 'ROOM_VERSION_INVALID' }, { status: 400 });
  }
  const supabase = createServerClient();
  const { data: room } = await supabase.from('multiplayer_rooms').select('host_user_id').eq('id', id).single();
  if (!room) return NextResponse.json({ error: 'ROOM_NOT_FOUND' }, { status: 404 });
  if (room.host_user_id !== g.session.userId && !COACH_ROLES.has(g.session.role)) return NextResponse.json({ error: '权限不足' }, { status: 403 });
  const { data, error } = await supabase.rpc('start_multiplayer_room', { p_room_id: id, p_expected_version: expectedVersion });
  if (error || !data) {
    const code = error?.message?.split(/\s|:/, 1)[0] ?? 'ROOM_START_FAILED';
    return NextResponse.json({ error: ['ROOM_NOT_FOUND', 'ROOM_VERSION_CONFLICT', 'ALL_COMPANIES_REQUIRE_PLAYERS', 'ROOM_ALREADY_STARTED'].includes(code) ? code : 'ROOM_START_FAILED' }, { status: code === 'ROOM_NOT_FOUND' ? 404 : 409 });
  }
  return NextResponse.json({ data });
}
