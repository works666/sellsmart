ALTER TABLE public.game_runtime_states
  ADD COLUMN IF NOT EXISTS simulation_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.game_command_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  command_id varchar(128) NOT NULL,
  command_type varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_command_records_session_command_unique UNIQUE(session_id, command_id),
  CONSTRAINT game_command_records_status_check CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS game_command_records_session_idx
  ON public.game_command_records(session_id);

ALTER TABLE public.game_command_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_command_records_service_role_only ON public.game_command_records;
CREATE POLICY game_command_records_service_role_only
  ON public.game_command_records
  AS RESTRICTIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON COLUMN public.game_runtime_states.simulation_state IS
  'Authoritative simulated-workday, appointments, preparations, attitudes, evidence, notifications and compliance state';

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
    RAISE EXCEPTION 'COMMAND_IN_PROGRESS' USING ERRCODE = '40001';
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
    RAISE EXCEPTION 'STATE_VERSION_CONFLICT' USING ERRCODE = '40001';
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
      finished_at = CASE WHEN next_status = 'playing' THEN NULL ELSE now() END
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
