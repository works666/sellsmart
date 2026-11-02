import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { getPreviewAiDebugSnapshots } from '@/lib/game/project-one-preview-ai';
import { createServerClient } from '@/storage/database/supabase-client';
import {
  getFastAiTraces,
  isFastDebugEnabled,
  isFastTestUser,
  redactFastTestValue,
} from '@/lib/testing/fast-test-observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QueryResult = { rows: unknown[]; error?: string };

function safeError(scope: string, error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message)
    : String(error ?? 'unknown');
  return `${scope}: ${message.slice(0, 180)}`;
}

async function safeQuery(scope: string, query: PromiseLike<{ data: unknown; error: unknown }>): Promise<QueryResult> {
  try {
    const { data, error } = await query;
    if (error) return { rows: [], error: safeError(scope, error) };
    return { rows: Array.isArray(data) ? data : data ? [data] : [] };
  } catch (error) {
    return { rows: [], error: safeError(scope, error) };
  }
}

function queryResult(result: QueryResult) {
  return {
    rows: redactFastTestValue(result.rows),
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function GET(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  if (!isFastDebugEnabled() || !isFastTestUser(guard.session.userId)) {
    return NextResponse.json({ error: '仅 Fast 验收账号可查看测试观测数据' }, { status: 403 });
  }

  const userId = guard.session.userId;
  let supabase: ReturnType<typeof createServerClient>;
  try {
    supabase = createServerClient();
  } catch (error) {
    const unavailable = { rows: [], error: safeError('database', error) };
    const aiTraces = getFastAiTraces(userId, 40);
    const previewStates = redactFastTestValue(getPreviewAiDebugSnapshots(userId));
    const tables = {
      gameSessions: unavailable,
      gameRuntimeStates: unavailable,
      chatMessages: unavailable,
      gameCommandRecords: unavailable,
      gameEvents: unavailable,
      affinityScores: unavailable,
      playerAbility: unavailable,
    };
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      userId,
      limits: { aiTraces: 40, sessions: 8, runtimeStates: 8, chatMessages: 80, commandRecords: 40, gameEvents: 80, affinityScores: 40 },
      aiTraces,
      previewStateSnapshots: previewStates,
      database: tables,
      traces: aiTraces,
      previewStates,
      tables,
    });
  }
  const sessions = await safeQuery('game_sessions', supabase
    .from('game_sessions')
    .select('id,user_id,user_name,scenario_id,difficulty,mode,multiplayer,current_round,max_round,total_score,win_probability,status,won,started_at,finished_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(8));
  const sessionIds = sessions.rows
    .map((row) => row && typeof row === 'object' ? (row as { id?: unknown }).id : null)
    .filter((id): id is string => typeof id === 'string');
  const playerAbilityPromise = safeQuery('player_ability', supabase.from('player_ability')
    .select('user_id,sessions_played,sessions_won,win_rate,avg_total_score,best_score,ability_personality,ability_research,ability_layered,ability_pitch,ability_competitor,ability_bidding,ability_product,updated_at')
    .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1));

  const empty: QueryResult = { rows: [] };
  const [runtimeStates, chatMessages, commandRecords, gameEvents, affinityScores] = sessionIds.length
    ? await Promise.all([
      safeQuery('game_runtime_states', supabase.from('game_runtime_states')
        .select('session_id,scenario_code,action_points,dimensions,npc_affinity,unlocked_npc_ids,unlocked_clues,conversation_memories,npc_contacts,active_meeting,simulation_state,last_action,version,updated_at')
        .in('session_id', sessionIds).order('updated_at', { ascending: false }).limit(8)),
      safeQuery('chat_messages', supabase.from('chat_messages')
        .select('id,session_id,decision_maker_id,round,sender,content,action_type,affinity_delta,score_delta,metadata,created_at')
        .in('session_id', sessionIds).order('created_at', { ascending: false }).limit(80)),
      safeQuery('game_command_records', supabase.from('game_command_records')
        .select('id,session_id,command_id,command_type,status,request,response,error_code,created_at,updated_at')
        .in('session_id', sessionIds).order('updated_at', { ascending: false }).limit(40)),
      safeQuery('game_events', supabase.from('game_events')
        .select('id,session_id,npc_key,round,event_type,payload,created_at')
        .in('session_id', sessionIds).order('created_at', { ascending: false }).limit(80)),
      safeQuery('affinity_scores', supabase.from('affinity_scores')
        .select('id,session_id,decision_maker_id,player_affinity,competitor_affinity,last_change_reason,updated_at')
        .in('session_id', sessionIds).order('updated_at', { ascending: false }).limit(40)),
    ])
    : [empty, empty, empty, empty, empty];
  const playerAbility = await playerAbilityPromise;

  const aiTraces = getFastAiTraces(userId, 40);
  const previewStates = redactFastTestValue(getPreviewAiDebugSnapshots(userId));
  const tables = {
    gameSessions: queryResult(sessions),
    gameRuntimeStates: queryResult(runtimeStates),
    chatMessages: queryResult(chatMessages),
    gameCommandRecords: queryResult(commandRecords),
    gameEvents: queryResult(gameEvents),
    affinityScores: queryResult(affinityScores),
    playerAbility: queryResult(playerAbility),
  };

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    userId,
    limits: { aiTraces: 40, sessions: 8, runtimeStates: 8, chatMessages: 80, commandRecords: 40, gameEvents: 80, affinityScores: 40 },
    aiTraces,
    previewStateSnapshots: previewStates,
    database: tables,
    // Short aliases keep the endpoint simple for the in-game debug panel.
    traces: aiTraces,
    previewStates,
    tables,
  });
}
