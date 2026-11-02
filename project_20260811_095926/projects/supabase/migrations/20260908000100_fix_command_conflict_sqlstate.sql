-- Business conflicts must not use serialization_failure (40001): PostgREST may retry it indefinitely.
-- Preserve the completion timestamp fix and all existing transaction and permission boundaries.
-- Preserve the first terminal completion time. Reading a notification after
-- a game is over is still committed through this RPC, but must not move the
-- timestamp used by history and ranking consumers.
CREATE OR REPLACE FUNCTION public.commit_game_command(
  p_session_id uuid,
  p_command_id text,
  p_command_type text,
  p_expected_version integer,
  p_state jsonb,
  p_total_score integer,
  p_event_type text,
  p_event_payload jsonb DEFAULT '{}'::jsonb,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_chat_messages jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_version integer;
  stored_status text;
  stored_response jsonb;
  inserted boolean;
  response_payload jsonb;
  next_status text := COALESCE(p_state->>'status', 'playing');
BEGIN
  INSERT INTO game_command_records(session_id, command_id, command_type, status, request)
  VALUES (
    p_session_id,
    p_command_id,
    p_command_type,
    'pending',
    jsonb_build_object('expectedVersion', p_expected_version, 'payload', COALESCE(p_event_payload, '{}'::jsonb))
  )
  ON CONFLICT (session_id, command_id) DO NOTHING;
  inserted := FOUND;

  IF NOT inserted THEN
    SELECT status, response
      INTO stored_status, stored_response
    FROM game_command_records
    WHERE session_id = p_session_id AND command_id = p_command_id;

    IF stored_status = 'completed' AND stored_response IS NOT NULL THEN
      RETURN jsonb_build_object('replayed', true, 'response', stored_response);
    END IF;
    RAISE EXCEPTION 'COMMAND_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE game_runtime_states
  SET action_points = COALESCE((p_state->>'actionPoints')::integer, action_points),
      dimensions = COALESCE(p_state->'dimensions', dimensions),
      npc_affinity = COALESCE(p_state->'npcAffinity', npc_affinity),
      unlocked_npc_ids = COALESCE(p_state->'unlockedNpcIds', unlocked_npc_ids),
      unlocked_clues = COALESCE(p_state->'unlockedClues', unlocked_clues),
      conversation_memories = COALESCE(p_state->'conversationMemories', conversation_memories),
      npc_contacts = COALESCE(p_state->'npcContacts', npc_contacts),
      active_meeting = p_state->'activeMeeting',
      last_action = NULLIF(p_state->>'lastAction', ''),
      phase_started_at = NULL,
      phase_ends_at = NULL,
      paused_at = NULL,
      paused_remaining_ms = NULL,
      simulation_state = p_state || jsonb_build_object('version', version + 1),
      version = version + 1,
      updated_at = now()
  WHERE session_id = p_session_id AND version = p_expected_version
  RETURNING version INTO next_version;

  IF next_version IS NULL THEN
    RAISE EXCEPTION 'STATE_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE game_sessions
  SET current_round = COALESCE((p_state->>'currentRound')::integer, current_round),
      max_round = COALESCE((p_state->>'maxRounds')::integer, max_round),
      total_score = p_total_score,
      win_probability = p_total_score,
      status = next_status,
      won = CASE WHEN next_status = 'playing' THEN NULL ELSE next_status = 'won' END,
      final_report = CASE WHEN next_status = 'playing' THEN NULL ELSE
        (p_state || jsonb_build_object('version', next_version, 'totalScore', p_total_score))
      END,
      finished_at = CASE
        WHEN game_sessions.status = 'playing'
          AND next_status IN ('won', 'lost')
          AND game_sessions.finished_at IS NULL
          THEN now()
        ELSE game_sessions.finished_at
      END
  WHERE id = p_session_id;

  -- Chat turns are committed in the same transaction as simulated time,
  -- attitudes, inventory and the audit event. A provider failure therefore
  -- leaves neither a partial transcript nor a resource charge behind.
  IF jsonb_typeof(COALESCE(p_chat_messages, '[]'::jsonb)) = 'array' THEN
    INSERT INTO chat_messages(
      session_id,
      decision_maker_id,
      round,
      sender,
      content,
      affinity_delta,
      score_delta,
      metadata
    )
    SELECT
      p_session_id,
      NULL,
      COALESCE(NULLIF(message->>'round', '')::integer, COALESCE((p_state->>'currentRound')::integer, 1)),
      message->>'role',
      message->>'content',
      NULLIF(message->>'affinityDelta', '')::integer,
      NULLIF(message->>'scoreDelta', '')::integer,
      COALESCE(message->'metadata', '{}'::jsonb)
        || jsonb_build_object('commandId', p_command_id)
    FROM jsonb_array_elements(COALESCE(p_chat_messages, '[]'::jsonb)) AS message
    WHERE message->>'role' IN ('user', 'assistant')
      AND length(trim(COALESCE(message->>'content', ''))) > 0;
  END IF;

  INSERT INTO game_events(session_id, npc_key, round, event_type, payload)
  VALUES (
    p_session_id,
    NULLIF(p_event_payload->>'npcId', ''),
    COALESCE((p_state->>'currentRound')::integer, 1),
    p_event_type,
    COALESCE(p_event_payload, '{}'::jsonb) || jsonb_build_object('commandId', p_command_id)
  );

  response_payload := jsonb_build_object(
    'state', p_state || jsonb_build_object('version', next_version),
    'result', COALESCE(p_result, '{}'::jsonb)
  );

  UPDATE game_command_records
  SET status = 'completed', response = response_payload, updated_at = now()
  WHERE session_id = p_session_id AND command_id = p_command_id;

  RETURN jsonb_build_object('replayed', false, 'response', response_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_game_command(uuid, text, text, integer, jsonb, integer, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_game_command(uuid, text, text, integer, jsonb, integer, text, jsonb, jsonb, jsonb) TO service_role;

-- Apply the same conflict and completion-time policy to the legacy phase RPC.
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
    RAISE EXCEPTION 'STATE_VERSION_CONFLICT' USING ERRCODE = 'P0001';
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
      finished_at = CASE
        WHEN game_sessions.status = 'playing'
          AND next_status IN ('won', 'lost')
          AND game_sessions.finished_at IS NULL
          THEN now()
        ELSE game_sessions.finished_at
      END
  WHERE id = p_session_id;

  INSERT INTO game_events(session_id, round, event_type, payload)
  VALUES (p_session_id, (p_state->>'currentRound')::integer, p_event_type, COALESCE(p_event_payload, '{}'::jsonb));

  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_game_phase_transition(uuid, integer, jsonb, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_game_phase_transition(uuid, integer, jsonb, integer, text, jsonb) TO service_role;
