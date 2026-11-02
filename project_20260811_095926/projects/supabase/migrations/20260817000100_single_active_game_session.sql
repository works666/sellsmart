-- Reconcile historical duplicates without deleting their audit trail. Only the
-- newest save remains resumable; older rows become internal replaced records.
WITH ranked_active_saves AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
  FROM public.game_sessions
  WHERE status = 'playing'
)
UPDATE public.game_sessions AS session
SET status = 'replaced',
    finished_at = COALESCE(session.finished_at, now())
FROM ranked_active_saves AS ranked
WHERE session.id = ranked.id AND ranked.position > 1;

-- Enforce the product rule that each player owns at most one active save.
CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_one_playing_per_user_idx
  ON public.game_sessions(user_id)
  WHERE status = 'playing';

CREATE OR REPLACE FUNCTION public.create_or_replace_game_session(
  p_user_id text,
  p_user_name text,
  p_scenario_id uuid,
  p_difficulty integer,
  p_state jsonb,
  p_total_score integer,
  p_replace_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_session_id uuid;
  existing_count integer;
BEGIN
  -- Serialize creates for the same logical player before checking or deleting.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  SELECT count(*)::integer
    INTO existing_count
  FROM game_sessions
  WHERE user_id = p_user_id AND status = 'playing';

  IF existing_count > 0 AND NOT p_replace_existing THEN
    RAISE EXCEPTION 'SAVE_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  IF p_replace_existing THEN
    UPDATE game_sessions
    SET status = 'replaced',
        finished_at = COALESCE(finished_at, now())
    WHERE user_id = p_user_id AND status = 'playing';
  END IF;

  INSERT INTO game_sessions(
    user_id,
    user_name,
    scenario_id,
    difficulty,
    mode,
    multiplayer,
    current_round,
    max_round,
    total_score,
    win_probability,
    status
  ) VALUES (
    p_user_id,
    p_user_name,
    p_scenario_id,
    p_difficulty,
    'ai_dialog',
    false,
    COALESCE((p_state->>'currentRound')::integer, 1),
    COALESCE((p_state->>'maxRounds')::integer, 5),
    p_total_score,
    p_total_score,
    'playing'
  ) RETURNING id INTO new_session_id;

  INSERT INTO game_runtime_states(
    session_id,
    scenario_code,
    action_points,
    dimensions,
    npc_affinity,
    unlocked_npc_ids,
    unlocked_clues,
    conversation_memories,
    phase_started_at,
    phase_ends_at,
    paused_at,
    paused_remaining_ms,
    npc_contacts,
    active_meeting,
    simulation_state,
    last_action,
    version
  ) VALUES (
    new_session_id,
    COALESCE(p_state->>'scenarioCode', 'project-1'),
    COALESCE((p_state->>'actionPoints')::integer, 28),
    COALESCE(p_state->'dimensions', '{}'::jsonb),
    COALESCE(p_state->'npcAffinity', '{}'::jsonb),
    COALESCE(p_state->'unlockedNpcIds', '[]'::jsonb),
    COALESCE(p_state->'unlockedClues', '[]'::jsonb),
    COALESCE(p_state->'conversationMemories', '{}'::jsonb),
    NULLIF(p_state->>'phaseStartedAt', '')::timestamptz,
    NULLIF(p_state->>'phaseEndsAt', '')::timestamptz,
    NULLIF(p_state->>'pausedAt', '')::timestamptz,
    NULLIF(p_state->>'pausedRemainingMs', '')::integer,
    COALESCE(p_state->'npcContacts', '{}'::jsonb),
    p_state->'activeMeeting',
    p_state,
    NULLIF(p_state->>'lastAction', ''),
    COALESCE((p_state->>'version')::integer, 1)
  );

  INSERT INTO game_events(session_id, round, event_type, payload)
  VALUES (
    new_session_id,
    COALESCE((p_state->>'currentRound')::integer, 1),
    CASE WHEN existing_count > 0 THEN 'session.replaced' ELSE 'session.created' END,
    jsonb_build_object(
      'scenarioCode', COALESCE(p_state->>'scenarioCode', 'project-1'),
      'replacedExisting', existing_count > 0,
      'replacedCount', existing_count
    )
  );

  RETURN jsonb_build_object(
    'id', new_session_id,
    'replacedExisting', existing_count > 0,
    'replacedCount', existing_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_replace_game_session(text, text, uuid, integer, jsonb, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_replace_game_session(text, text, uuid, integer, jsonb, integer, boolean) TO service_role;
