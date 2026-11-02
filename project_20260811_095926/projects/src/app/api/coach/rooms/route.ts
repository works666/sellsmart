import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createServerClient } from '@/storage/database/supabase-client';

const DEFAULT_COMPANIES = [
  { company_id: 'player-company', company_name: '我方公司', initial_personal_info: { 'P1-004': ['曾在公开交流活动中短暂接触。'] } },
  { company_id: 'abc-company', company_name: 'ABC公司', initial_personal_info: { 'P1-003': ['熟悉其对采购留痕和验收边界的重视。'], 'P1-002': ['知道其近期关注可量化、可验证的方案落地证据。'] } },
];
const COACH_ROLES = new Set(['trainer', 'enterprise_admin', 'platform_designer']);

export async function GET(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  if (!COACH_ROLES.has(guard.session.role)) return NextResponse.json({ error: '权限不足' }, { status: 403 });
  const { data, error } = await createServerClient().from('multiplayer_rooms').select('*, multiplayer_company_slots(*)').order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'ROOM_LIST_FAILED' }, { status: 503 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  if (!COACH_ROLES.has(guard.session.role)) return NextResponse.json({ error: '权限不足' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (body.stageDurationSeconds != null) return NextResponse.json({ error: 'GAME_PHASE_DESIGN_REMOVED' }, { status: 400 });
  const companies = Array.isArray(body.companies) && body.companies.length >= 2
    ? body.companies.slice(0, 8).map((item, index) => {
      const row = item as Record<string, unknown>;
      return { company_id: String(row.id || `company-${index + 1}`).slice(0, 64), company_name: String(row.name || `公司${index + 1}`).slice(0, 128), initial_personal_info: row.initialPersonalInfo ?? {} };
    }) : DEFAULT_COMPANIES;
  const roomCode = randomBytes(4).toString('hex').toUpperCase();
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc('create_multiplayer_room', {
    p_host_user_id: guard.session.userId,
    p_room_code: roomCode,
    p_stage_duration_seconds: null,
    p_companies: companies,
  });
  if (error || !data) return NextResponse.json({ error: 'ROOM_CREATE_FAILED' }, { status: 503 });
  return NextResponse.json({ data }, { status: 201 });
}
