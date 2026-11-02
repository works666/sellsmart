// 排行榜 API
import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { createServerClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_CODE_PATTERN = /^[A-Za-z0-9_-]{1,12}$/;
const MAX_PAGE = 100_000;
const MAX_PAGE_SIZE = 100;
const VALID_RANGES = new Set(['week', 'month', 'season', 'all']);
const ROOM_WIDE_RANKING_ROLES = new Set(['trainer', 'enterprise_admin', 'platform_designer']);

type RankingTab = 'room' | 'platform';
type RankingRange = 'week' | 'month' | 'season' | 'all';

export interface RankingQuery {
  tab: RankingTab;
  range: RankingRange;
  track: string;
  page: number;
  pageSize: number;
  roomId: string | null;
  roomCode: string | null;
  error: 'ROOM_SCOPE_INVALID' | 'ROOM_SCOPE_CONFLICT' | null;
}

export interface RoomRankingRow {
  status?: unknown;
  total_score?: unknown;
}

export interface RoomRankingSummary {
  avgScore: number;
  maxScore: number;
  totalCount: number;
}

function firstNonEmpty(params: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

function parsePositiveInteger(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/**
 * Parse the public query contract without touching the database. `room` is
 * accepted as a backwards-compatible alias for either a UUID or room code.
 */
export function parseRankingQuery(params: URLSearchParams): RankingQuery {
  const tab: RankingTab = params.get('tab') === 'platform' ? 'platform' : 'room';
  const rawRange = params.get('range') ?? params.get('timeframe') ?? 'all';
  const range = (VALID_RANGES.has(rawRange) ? rawRange : 'all') as RankingRange;
  const track = params.get('track')?.trim() || 'all';
  const page = parsePositiveInteger(params.get('page'), 1, MAX_PAGE);
  const pageSize = parsePositiveInteger(params.get('pageSize'), 20, MAX_PAGE_SIZE);

  const explicitRoomId = firstNonEmpty(params, ['roomId', 'room_id']);
  const explicitRoomCode = firstNonEmpty(params, ['roomCode', 'room_code']);
  const roomAlias = firstNonEmpty(params, ['room', 'roomScope', 'room_scope']);
  let roomId: string | null = null;
  let roomCode: string | null = null;
  let error: RankingQuery['error'] = null;

  if (explicitRoomId) {
    if (ROOM_ID_PATTERN.test(explicitRoomId)) roomId = explicitRoomId;
    else error = 'ROOM_SCOPE_INVALID';
  }
  if (explicitRoomCode) {
    if (ROOM_CODE_PATTERN.test(explicitRoomCode)) roomCode = explicitRoomCode.toUpperCase();
    else error = 'ROOM_SCOPE_INVALID';
  }
  if (roomAlias) {
    if (ROOM_ID_PATTERN.test(roomAlias)) {
      if (roomId && roomId !== roomAlias) error = 'ROOM_SCOPE_CONFLICT';
      roomId = roomAlias;
    } else if (ROOM_CODE_PATTERN.test(roomAlias)) {
      const normalizedCode = roomAlias.toUpperCase();
      if (roomCode && roomCode !== normalizedCode) error = 'ROOM_SCOPE_CONFLICT';
      roomCode = normalizedCode;
    } else {
      error = 'ROOM_SCOPE_INVALID';
    }
  }
  if (roomId && roomCode) error = 'ROOM_SCOPE_CONFLICT';

  return { tab, range, track, page, pageSize, roomId, roomCode, error };
}

function isCompletedRoomResult(row: RoomRankingRow): boolean {
  return row.status === 'won' || row.status === 'lost';
}

/** Summarize only terminal game results; empty and non-terminal inputs are 0. */
export function summarizeRoomResults(rows: readonly RoomRankingRow[]): RoomRankingSummary {
  const completedRows = rows.filter(isCompletedRoomResult);
  if (completedRows.length === 0) {
    return { avgScore: 0, maxScore: 0, totalCount: 0 };
  }

  const scores = completedRows.map((row) => (
    typeof row.total_score === 'number' && Number.isFinite(row.total_score) ? row.total_score : 0
  ));
  return {
    avgScore: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    maxScore: Math.max(...scores),
    totalCount: completedRows.length,
  };
}

function rankingFailure(): NextResponse {
  // Never return a Supabase/Postgres message to the browser.
  return NextResponse.json({ error: 'RANKING_LOAD_FAILED' }, { status: 503 });
}

function emptyRoomResponse(roomId: string | null, roomCode: string | null): NextResponse {
  return NextResponse.json({
    success: true,
    tab: 'room',
    roomId,
    roomCode,
    items: [],
    summary: summarizeRoomResults([]),
  });
}

async function resolveRoomId(
  supabase: ReturnType<typeof createServerClient>,
  query: RankingQuery,
  userId: string,
): Promise<{ roomId: string | null; roomMissing: boolean }> {
  if (query.roomId) {
    const { data, error } = await supabase
      .from('multiplayer_rooms')
      .select('id')
      .eq('id', query.roomId)
      .maybeSingle();
    if (error) throw error;
    return { roomId: typeof data?.id === 'string' ? data.id : null, roomMissing: !data?.id };
  }

  if (query.roomCode) {
    const { data, error } = await supabase
      .from('multiplayer_rooms')
      .select('id')
      .eq('room_code', query.roomCode)
      .maybeSingle();
    if (error) throw error;
    return { roomId: typeof data?.id === 'string' ? data.id : null, roomMissing: !data?.id };
  }

  // The room tab means the caller's current room when no explicit scope is
  // supplied. A solo player (or a user without a room) therefore gets a
  // valid empty result instead of all users' completed games.
  const { data, error } = await supabase
    .from('multiplayer_company_slots')
    .select('room_id')
    .eq('player_user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return { roomId: typeof data?.room_id === 'string' ? data.room_id : null, roomMissing: false };
}

async function canViewRoom(
  supabase: ReturnType<typeof createServerClient>,
  roomId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (ROOM_WIDE_RANKING_ROLES.has(role)) return true;

  const { data: room, error: roomError } = await supabase
    .from('multiplayer_rooms')
    .select('host_user_id')
    .eq('id', roomId)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return false;
  if (room.host_user_id === userId) return true;

  const { data: slot, error: slotError } = await supabase
    .from('multiplayer_company_slots')
    .select('id')
    .eq('room_id', roomId)
    .eq('player_user_id', userId)
    .maybeSingle();
  if (slotError) throw slotError;
  return Boolean(slot);
}

async function loadRoomResults(
  supabase: ReturnType<typeof createServerClient>,
  roomId: string,
): Promise<RoomRankingRow[]> {
  const { data: slots, error: slotsError } = await supabase
    .from('multiplayer_company_slots')
    .select('game_session_id')
    .eq('room_id', roomId)
    .limit(100);
  if (slotsError) throw slotsError;

  const sessionIds = Array.from(new Set(
    ((slots ?? []) as Array<{ game_session_id?: unknown }>)
      .map((slot) => slot.game_session_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  ));
  if (sessionIds.length === 0) return [];

  const { data, error } = await supabase
    .from('game_sessions')
    .select('id, user_id, user_name, total_score, status, won, difficulty, mode, started_at, finished_at')
    .in('id', sessionIds)
    .in('status', ['won', 'lost'])
    .order('total_score', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as RoomRankingRow[]).filter(isCompletedRoomResult);
}

export async function GET(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;

  const query = parseRankingQuery(new URL(request.url).searchParams);
  if (query.error) {
    return NextResponse.json({ error: query.error }, { status: 400 });
  }

  try {
    const supabase = createServerClient();

    // 房间榜：只读取当前房间槽位关联且已真正结算的 won/lost 对局。
    if (query.tab === 'room') {
      const scope = await resolveRoomId(supabase, query, guard.session.userId);
      if (scope.roomMissing) {
        return NextResponse.json({ error: 'ROOM_NOT_FOUND' }, { status: 404 });
      }
      if (!scope.roomId) return emptyRoomResponse(null, query.roomCode);
      if ((query.roomId || query.roomCode) && !(await canViewRoom(
        supabase,
        scope.roomId,
        guard.session.userId,
        guard.session.role,
      ))) {
        return NextResponse.json({ error: 'ROOM_ACCESS_DENIED' }, { status: 403 });
      }

      const data = await loadRoomResults(supabase, scope.roomId);
      return NextResponse.json({
        success: true,
        tab: 'room',
        roomId: scope.roomId,
        roomCode: query.roomCode,
        items: data,
        summary: summarizeRoomResults(data),
      });
    }

    // 全平台榜：能力表是已完成对局的聚合快照；分页参数仍由同一解析器约束。
    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;
    const { data, error, count } = await supabase
      .from('player_ability')
      .select('user_id, sessions_played, sessions_won, win_rate, best_score, updated_at', { count: 'exact' })
      .order('best_score', { ascending: false })
      .range(from, to);

    if (error) return rankingFailure();

    return NextResponse.json({
      success: true,
      tab: 'platform',
      items: data ?? [],
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / query.pageSize),
      },
    });
  } catch {
    return rankingFailure();
  }
}
