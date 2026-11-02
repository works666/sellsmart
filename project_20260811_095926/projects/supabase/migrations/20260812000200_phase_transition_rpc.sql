CREATE OR REPLACE FUNCTION public.commit_game_phase_transition(
  p_session_id uuid,
  p_expected_version integer,
  p_state jsonb,
  p_total_score integer,
  p_event_type text,
  p_event_payload jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_version integer;
  next_status text := p_state->>'status';
BEGIN
  UPDATE game_runtime_states
  SET action_points = (p_state->>'actionPoints')::integer,
      dimensions = p_state->'dimensions',
      npc_affinity = p_state->'npcAffinity',
      unlocked_npc_ids = p_state->'unlockedNpcIds',
      unlocked_clues = p_state->'unlockedClues',
      conversation_memories = p_state->'conversationMemories',
      last_action = NULLIF(p_state->>'lastAction', ''),
      phase_started_at = (p_state->>'phaseStartedAt')::timestamptz,
      phase_ends_at = (p_state->>'phaseEndsAt')::timestamptz,
      paused_at = NULLIF(p_state->>'pausedAt', '')::timestamptz,
      paused_remaining_ms = NULLIF(p_state->>'pausedRemainingMs', '')::integer,
      npc_contacts = p_state->'npcContacts',
      active_meeting = p_state->'activeMeeting',
      version = version + 1,
      updated_at = now()
  WHERE session_id = p_session_id AND version = p_expected_version
  RETURNING version INTO next_version;

  IF next_version IS NULL THEN
    RAISE EXCEPTION 'STATE_VERSION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE game_sessions
  SET current_round = (p_state->>'currentRound')::integer,
      max_round = (p_state->>'maxRounds')::integer,
      total_score = p_total_score,
      win_probability = p_total_score,
      status = next_status,
      won = CASE WHEN next_status = 'playing' THEN NULL ELSE next_status = 'won' END,
      final_report = CASE WHEN next_status = 'playing' THEN NULL ELSE jsonb_build_object(
        'status', next_status,
        'totalScore', p_total_score,
        'dimensions', p_state->'dimensions',
        'npcAffinity', p_state->'npcAffinity',
        'unlockedClues', p_state->'unlockedClues'
      ) END,
      finished_at = CASE WHEN next_status = 'playing' THEN NULL ELSE now() END
  WHERE id = p_session_id;

  INSERT INTO game_events(session_id, round, event_type, payload)
  VALUES (p_session_id, (p_state->>'currentRound')::integer, p_event_type, COALESCE(p_event_payload, '{}'::jsonb));

  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_game_phase_transition(uuid, integer, jsonb, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_game_phase_transition(uuid, integer, jsonb, integer, text, jsonb) TO service_role;
