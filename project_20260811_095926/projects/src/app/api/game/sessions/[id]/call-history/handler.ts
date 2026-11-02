import { NextRequest, NextResponse } from 'next/server';
import { authGuard, type AuthGuardResult } from '@/lib/auth/guard';
import { getProjectOneNpc } from '@/lib/game/project-one';
import { getOwnedGameSession } from '@/lib/game/repository';
import { createServerClient } from '@/storage/database/supabase-client';

const CALL_EVENT_TYPES = ['npc.call.connected', 'npc.call.unanswered', 'contact.completed'] as const;
const CONTACT_OUTCOMES = new Set(['connected', 'unanswered', 'declined', 'call_later']);

type CallEventType = typeof CALL_EVENT_TYPES[number];

export interface StoredCallHistoryEvent {
  id: string;
  npcId: string | null;
  round: number;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

interface CallHistoryRecord {
  id: string;
  npcId: string;
  outcome: 'connected' | 'unanswered' | 'declined' | 'call_later';
  round: number;
  createdAt: string;
}

interface CallHistoryDependencies {
  authorize: (request: NextRequest) => AuthGuardResult;
  assertSessionOwnership: (sessionId: string, userId: string) => Promise<unknown>;
  readEvents: (sessionId: string, npcId: string) => Promise<StoredCallHistoryEvent[]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function eventOutcome(event: StoredCallHistoryEvent, payload: Record<string, unknown>): CallHistoryRecord['outcome'] | null {
  if (event.eventType === 'npc.call.connected') return 'connected';
  if (event.eventType === 'npc.call.unanswered') return 'unanswered';
  if (event.eventType !== 'contact.completed' || typeof payload.outcome !== 'string' || !CONTACT_OUTCOMES.has(payload.outcome)) return null;
  return payload.outcome as CallHistoryRecord['outcome'];
}

function projectCallHistory(events: StoredCallHistoryEvent[], npcId: string): CallHistoryRecord[] {
  return events.flatMap((event) => {
    if (!CALL_EVENT_TYPES.includes(event.eventType as CallEventType)) return [];
    const payload = asRecord(event.payload);
    if (event.npcId !== npcId || payload.npcId !== npcId || payload.channel !== 'work_phone') return [];
    const outcome = eventOutcome(event, payload);
    if (!outcome || !event.id || !event.createdAt || !Number.isFinite(event.round)) return [];
    return [{
      id: event.id,
      npcId,
      outcome,
      round: event.round,
      createdAt: event.createdAt,
    }];
  }).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
}

async function readCallEvents(sessionId: string, npcId: string): Promise<StoredCallHistoryEvent[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('game_events')
    .select('id, npc_key, round, event_type, payload, created_at')
    .eq('session_id', sessionId)
    .eq('npc_key', npcId)
    .in('event_type', CALL_EVENT_TYPES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('CALL_HISTORY_LOAD_FAILED');
  return (data ?? []).map((event) => ({
    id: String(event.id),
    npcId: event.npc_key ? String(event.npc_key) : null,
    round: Number(event.round),
    eventType: String(event.event_type),
    payload: event.payload,
    createdAt: String(event.created_at),
  }));
}

export function createCallHistoryGet(dependencies: CallHistoryDependencies) {
  return async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const guard = dependencies.authorize(request);
    if (!guard.ok || !guard.session) return guard.response!;

    const { id } = await context.params;
    const npcId = request.nextUrl.searchParams.get('npcId');
    if (!npcId || !getProjectOneNpc(npcId)) {
      return NextResponse.json({ error: 'NPC参数无效' }, { status: 400 });
    }

    try {
      await dependencies.assertSessionOwnership(id, guard.session.userId);
    } catch {
      return NextResponse.json({ error: '对局不存在或无权访问' }, { status: 404 });
    }

    try {
      const events = await dependencies.readEvents(id, npcId);
      return NextResponse.json({ success: true, calls: projectCallHistory(events, npcId) });
    } catch {
      return NextResponse.json({ error: '通话记录读取失败' }, { status: 503 });
    }
  };
}

export const getCallHistoryHandler = createCallHistoryGet({
  authorize: authGuard,
  assertSessionOwnership: getOwnedGameSession,
  readEvents: readCallEvents,
});
