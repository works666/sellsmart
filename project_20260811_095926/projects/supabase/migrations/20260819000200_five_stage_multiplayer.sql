-- Five-stage, action-point-only multiplayer foundation.
DROP INDEX IF EXISTS public.game_sessions_one_playing_per_user_idx;
CREATE UNIQUE INDEX game_sessions_one_solo_playing_per_user_idx
  ON public.game_sessions (user_id)
  WHERE status = 'playing' AND multiplayer = false;

-- The single-save RPC predates multiplayer. Replace it in this migration so
-- a solo restart can never count or replace a player's room-owned runtime.
CREATE OR REPLACE FUNCTION public.create_or_replace_game_session(
  p_user_id text,
  p_user_name text,
  p_scenario_id uuid,
  p_difficulty integer,
  p_state jsonb,
  p_total_score integer,
  p_replace_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_session_id uuid; existing_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));
  SELECT count(*)::integer INTO existing_count
    FROM game_sessions
   WHERE user_id = p_user_id AND status = 'playing' AND multiplayer = false;
  IF existing_count > 0 AND NOT p_replace_existing THEN
    RAISE EXCEPTION 'SAVE_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;
  IF p_replace_existing THEN
    UPDATE game_sessions
       SET status = 'replaced', finished_at = COALESCE(finished_at, now())
     WHERE user_id = p_user_id AND status = 'playing' AND multiplayer = false;
  END IF;
  INSERT INTO game_sessions(
    user_id,user_name,scenario_id,difficulty,mode,multiplayer,current_round,max_round,total_score,win_probability,status
  ) VALUES (
    p_user_id,p_user_name,p_scenario_id,p_difficulty,'ai_dialog',false,
    COALESCE((p_state->>'currentRound')::integer, 1),COALESCE((p_state->>'maxRounds')::integer, 5),
    p_total_score,p_total_score,'playing'
  ) RETURNING id INTO new_session_id;
  INSERT INTO game_runtime_states(
    session_id,scenario_code,action_points,dimensions,npc_affinity,unlocked_npc_ids,unlocked_clues,
    conversation_memories,phase_started_at,phase_ends_at,paused_at,paused_remaining_ms,npc_contacts,
    active_meeting,simulation_state,last_action,version
  ) VALUES (
    new_session_id,COALESCE(p_state->>'scenarioCode', 'project-1'),COALESCE((p_state->>'actionPoints')::integer, 28),
    COALESCE(p_state->'dimensions', '{}'::jsonb),COALESCE(p_state->'npcAffinity', '{}'::jsonb),
    COALESCE(p_state->'unlockedNpcIds', '[]'::jsonb),COALESCE(p_state->'unlockedClues', '[]'::jsonb),
    COALESCE(p_state->'conversationMemories', '{}'::jsonb),NULLIF(p_state->>'phaseStartedAt', '')::timestamptz,
    NULLIF(p_state->>'phaseEndsAt', '')::timestamptz,NULLIF(p_state->>'pausedAt', '')::timestamptz,
    NULLIF(p_state->>'pausedRemainingMs', '')::integer,COALESCE(p_state->'npcContacts', '{}'::jsonb),
    p_state->'activeMeeting',p_state,NULLIF(p_state->>'lastAction', ''),COALESCE((p_state->>'version')::integer, 1)
  );
  INSERT INTO game_events(session_id, round, event_type, payload)
  VALUES (new_session_id,COALESCE((p_state->>'currentRound')::integer, 1),
    CASE WHEN existing_count > 0 THEN 'session.replaced' ELSE 'session.created' END,
    jsonb_build_object('scenarioCode', COALESCE(p_state->>'scenarioCode', 'project-1'), 'replacedExisting', existing_count > 0, 'replacedCount', existing_count));
  RETURN jsonb_build_object('id', new_session_id, 'replacedExisting', existing_count > 0, 'replacedCount', existing_count);
END $$;
REVOKE ALL ON FUNCTION public.create_or_replace_game_session(text, text, uuid, integer, jsonb, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_replace_game_session(text, text, uuid, integer, jsonb, integer, boolean) TO service_role;

CREATE TABLE public.multiplayer_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code varchar(12) NOT NULL,
  scenario_code varchar(32) NOT NULL DEFAULT 'project-1',
  host_user_id varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'waiting' CONSTRAINT multiplayer_rooms_status_check CHECK (status IN ('waiting','running','finished','cancelled')),
  current_stage integer NOT NULL DEFAULT 1 CONSTRAINT multiplayer_rooms_stage_check CHECK (current_stage BETWEEN 1 AND 5),
  max_stages integer NOT NULL DEFAULT 5 CONSTRAINT multiplayer_rooms_max_stages_check CHECK (max_stages = 5),
  stage_duration_seconds integer CONSTRAINT multiplayer_rooms_duration_check CHECK (stage_duration_seconds IS NULL OR stage_duration_seconds >= 60),
  stage_deadline_at timestamptz,
  shared_customer_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage_version integer NOT NULL DEFAULT 1 CONSTRAINT multiplayer_rooms_version_check CHECK (stage_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT multiplayer_rooms_code_unique UNIQUE (room_code)
);
CREATE INDEX multiplayer_rooms_host_idx ON public.multiplayer_rooms(host_user_id);

CREATE TABLE public.multiplayer_company_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  company_id varchar(64) NOT NULL,
  company_name varchar(128) NOT NULL,
  player_user_id varchar(64),
  game_session_id uuid,
  hidden_progress_score integer NOT NULL DEFAULT 50 CONSTRAINT multiplayer_company_slots_hidden_progress_check CHECK (hidden_progress_score BETWEEN 0 AND 100),
  ready_stage integer CONSTRAINT multiplayer_company_slots_ready_stage_check CHECK (ready_stage IS NULL OR ready_stage BETWEEN 1 AND 5),
  ready_by_admin boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT true,
  initial_personal_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT multiplayer_company_slots_room_company_unique UNIQUE(room_id, company_id),
  CONSTRAINT multiplayer_company_slots_room_fk FOREIGN KEY(room_id) REFERENCES public.multiplayer_rooms(id) ON DELETE CASCADE,
  CONSTRAINT multiplayer_company_slots_session_fk FOREIGN KEY(game_session_id) REFERENCES public.game_sessions(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX multiplayer_company_slots_room_player_unique
  ON public.multiplayer_company_slots(room_id, player_user_id)
  WHERE player_user_id IS NOT NULL;

CREATE TABLE public.competitor_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid,
  session_id uuid NOT NULL,
  company_id varchar(64) NOT NULL,
  npc_key varchar(128) NOT NULL,
  stage integer NOT NULL CONSTRAINT competitor_claims_stage_check CHECK (stage BETWEEN 1 AND 5),
  statement text NOT NULL,
  truth_status varchar(24) NOT NULL DEFAULT 'unverified' CONSTRAINT competitor_claims_truth_status_check CHECK (truth_status IN ('unverified','corroborated','contradicted','false')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_claims_room_fk FOREIGN KEY(room_id) REFERENCES public.multiplayer_rooms(id) ON DELETE CASCADE,
  CONSTRAINT competitor_claims_session_fk FOREIGN KEY(session_id) REFERENCES public.game_sessions(id) ON DELETE CASCADE
);
CREATE INDEX competitor_claims_session_idx ON public.competitor_claims(session_id);

ALTER TABLE public.multiplayer_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multiplayer_company_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY multiplayer_rooms_service_role_only ON public.multiplayer_rooms AS RESTRICTIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY multiplayer_company_slots_service_role_only ON public.multiplayer_company_slots AS RESTRICTIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY competitor_claims_service_role_only ON public.competitor_claims AS RESTRICTIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.multiplayer_rooms, public.multiplayer_company_slots, public.competitor_claims FROM anon, authenticated;
GRANT ALL ON public.multiplayer_rooms, public.multiplayer_company_slots, public.competitor_claims TO service_role;

-- Atomic, idempotent stage transition. The room, every company slot and each
-- attached runtime are locked in this transaction before any stage data moves.
-- A retry with an older expected version returns the already-committed room and
-- does not grant action points twice.
CREATE OR REPLACE FUNCTION public.advance_multiplayer_stage(p_room_id uuid, p_expected_version integer)
RETURNS public.multiplayer_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.multiplayer_rooms;
  slot_row public.multiplayer_company_slots;
  runtime_row public.game_runtime_states;
  slot_count integer := 0;
  occupied_count integer := 0;
  ready_count integer := 0;
  next_stage integer;
  next_action_points integer;
  average_dimension numeric;
  average_affinity numeric;
  progress_delta integer;
  next_hidden_progress integer;
  next_simulation jsonb;
  next_shared_customer_state jsonb;
  next_room_version integer;
  final_stage boolean;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'ROOM_VERSION_INVALID';
  END IF;

  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  -- A concurrent/retried request observes the committed result after waiting
  -- on the room lock. It is intentionally idempotent rather than a second
  -- transition with another point grant.
  IF r.stage_version = p_expected_version + 1 THEN RETURN r; END IF;
  IF r.stage_version > p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.stage_version < p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status = 'finished' THEN RETURN r; END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'ROOM_NOT_RUNNING'; END IF;

  -- Lock and inspect all slots before deciding whether the transition is
  -- allowed. The deadline path is the only exception to all-player readiness.
  FOR slot_row IN
    SELECT * FROM public.multiplayer_company_slots
    WHERE room_id = p_room_id
    ORDER BY id
    FOR UPDATE
  LOOP
    slot_count := slot_count + 1;
    IF slot_row.player_user_id IS NOT NULL THEN occupied_count := occupied_count + 1; END IF;
    IF slot_row.player_user_id IS NOT NULL AND slot_row.ready_stage = r.current_stage THEN ready_count := ready_count + 1; END IF;
  END LOOP;
  IF slot_count < 2 OR occupied_count < slot_count THEN RAISE EXCEPTION 'ALL_COMPANIES_REQUIRE_PLAYERS'; END IF;
  IF (r.stage_deadline_at IS NULL OR r.stage_deadline_at > now()) AND ready_count < slot_count THEN
    RAISE EXCEPTION 'ROOM_NOT_READY';
  END IF;

  final_stage := r.current_stage >= r.max_stages;
  next_stage := CASE WHEN final_stage THEN r.current_stage ELSE r.current_stage + 1 END;
  next_room_version := r.stage_version + 1;

  -- Every attached runtime advances in the same transaction as the room. The
  -- relational action_points/version columns and the JSON snapshot are kept in
  -- sync so normal game-session reads observe the same stage.
  FOR slot_row IN
    SELECT * FROM public.multiplayer_company_slots
    WHERE room_id = p_room_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF slot_row.game_session_id IS NULL THEN
      RAISE EXCEPTION 'COMPANY_RUNTIME_MISSING';
    END IF;
    SELECT * INTO runtime_row
      FROM public.game_runtime_states
      WHERE session_id = slot_row.game_session_id
      FOR UPDATE;
    IF runtime_row.session_id IS NULL THEN RAISE EXCEPTION 'COMPANY_RUNTIME_MISSING'; END IF;

    next_action_points := CASE
      WHEN final_stage THEN GREATEST(0, runtime_row.action_points)
      ELSE LEAST(28, GREATEST(0, runtime_row.action_points) + 8)
    END;
    next_simulation := COALESCE(runtime_row.simulation_state, '{}'::jsonb);
    next_simulation := jsonb_set(next_simulation, '{currentRound}', to_jsonb(next_stage), true);
    next_simulation := jsonb_set(next_simulation, '{currentStage}', to_jsonb(next_stage), true);
    next_simulation := jsonb_set(next_simulation, '{maxRounds}', to_jsonb(r.max_stages), true);
    next_simulation := jsonb_set(next_simulation, '{maxStages}', to_jsonb(r.max_stages), true);
    next_simulation := jsonb_set(next_simulation, '{roomStageVersion}', to_jsonb(next_room_version), true);
    next_simulation := jsonb_set(next_simulation, '{version}', to_jsonb(runtime_row.version + 1), true);
    next_simulation := jsonb_set(next_simulation, '{actionPoints}', to_jsonb(next_action_points), true);
    next_simulation := jsonb_set(next_simulation, '{submissionReady}', to_jsonb(final_stage), true);
    next_simulation := jsonb_set(next_simulation, '{lastAction}', to_jsonb('multiplayer_stage_advance'::text), true);

    UPDATE public.game_runtime_states
       SET action_points = next_action_points,
           simulation_state = next_simulation,
           last_action = 'multiplayer_stage_advance',
           version = runtime_row.version + 1,
           updated_at = now()
     WHERE session_id = slot_row.game_session_id;
    UPDATE public.game_sessions
       SET current_round = next_stage,
           max_round = r.max_stages
     WHERE id = slot_row.game_session_id;

    -- Hidden company progress is derived server-side from the runtime and is
    -- never placed in shared_customer_state or returned to player APIs.
    average_dimension := (
      CASE WHEN jsonb_typeof(runtime_row.dimensions->'decisionAnalysis') = 'number' THEN (runtime_row.dimensions->>'decisionAnalysis')::numeric ELSE 50 END
      + CASE WHEN jsonb_typeof(runtime_row.dimensions->'relationshipBuilding') = 'number' THEN (runtime_row.dimensions->>'relationshipBuilding')::numeric ELSE 50 END
      + CASE WHEN jsonb_typeof(runtime_row.dimensions->'valuePresentation') = 'number' THEN (runtime_row.dimensions->>'valuePresentation')::numeric ELSE 50 END
      + CASE WHEN jsonb_typeof(runtime_row.dimensions->'objectionHandling') = 'number' THEN (runtime_row.dimensions->>'objectionHandling')::numeric ELSE 50 END
      + CASE WHEN jsonb_typeof(runtime_row.dimensions->'informationDiscovery') = 'number' THEN (runtime_row.dimensions->>'informationDiscovery')::numeric ELSE 50 END
    ) / 5;
    average_affinity := (
      SELECT COALESCE(avg(value::numeric), 35)
      FROM jsonb_each_text(COALESCE(runtime_row.npc_affinity, '{}'::jsonb))
      WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
    );
    progress_delta := GREATEST(-5, LEAST(5, round((average_dimension - 50) / 10 + (average_affinity - 35) / 10)::integer));
    next_hidden_progress := GREATEST(0, LEAST(100, slot_row.hidden_progress_score + progress_delta));
    UPDATE public.multiplayer_company_slots
       SET hidden_progress_score = next_hidden_progress,
           ready_stage = NULL,
           ready_by_admin = false,
           updated_at = now()
     WHERE id = slot_row.id;
  END LOOP;

  next_shared_customer_state := COALESCE(r.shared_customer_state, '{}'::jsonb)
    || jsonb_build_object(
      'currentStage', next_stage,
      'lastCompletedStage', r.current_stage,
      'companyCount', slot_count,
      'updatedAt', now()
    );
  UPDATE public.multiplayer_rooms
     SET current_stage = next_stage,
         status = CASE WHEN final_stage THEN 'finished' ELSE status END,
         stage_version = stage_version + 1,
         stage_deadline_at = CASE
           WHEN final_stage OR stage_duration_seconds IS NULL THEN NULL
           ELSE now() + make_interval(secs => stage_duration_seconds)
         END,
         shared_customer_state = next_shared_customer_state,
         updated_at = now()
   WHERE id = p_room_id
   RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.advance_multiplayer_stage(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_multiplayer_stage(uuid, integer) TO service_role;

-- Marking a player's stage complete and deciding whether to advance must also
-- be atomic. It prevents two ready requests from observing the same old slot
-- set and racing a separate read/update/RPC sequence in the API.
CREATE OR REPLACE FUNCTION public.mark_multiplayer_ready(
  p_room_id uuid,
  p_user_id text,
  p_expected_stage integer,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.multiplayer_rooms;
  slot_row public.multiplayer_company_slots;
  slot_count integer;
  occupied_count integer;
  ready_count integer;
  advance_reason text;
  advanced_room public.multiplayer_rooms;
BEGIN
  IF p_expected_stage IS NULL OR p_expected_stage < 1 OR p_expected_stage > 5
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'ROOM_VERSION_INVALID';
  END IF;
  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  SELECT * INTO slot_row FROM public.multiplayer_company_slots
    WHERE room_id = p_room_id AND player_user_id = p_user_id FOR UPDATE;
  IF slot_row.id IS NULL THEN RAISE EXCEPTION 'NOT_A_ROOM_PLAYER'; END IF;

  -- A response can be lost after this player's ready action triggered the
  -- atomic transition. Only the immediately preceding room version may replay;
  -- do not ever mark the player ready for the new stage on a stale retry.
  IF r.stage_version = p_expected_version + 1
    AND (r.current_stage = p_expected_stage + 1 OR (r.status = 'finished' AND r.current_stage = p_expected_stage)) THEN
    RETURN jsonb_build_object('advanced', true, 'replayed', true, 'reason', 'replay', 'room', to_jsonb(r));
  END IF;
  IF r.stage_version <> p_expected_version OR r.current_stage <> p_expected_stage THEN
    RAISE EXCEPTION 'ROOM_VERSION_CONFLICT';
  END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'ROOM_NOT_RUNNING'; END IF;
  IF slot_row.ready_stage = p_expected_stage THEN
    RETURN jsonb_build_object('advanced', false, 'replayed', true, 'reason', 'replay', 'room', to_jsonb(r));
  END IF;

  UPDATE public.multiplayer_company_slots
     SET ready_stage = r.current_stage, ready_by_admin = false, updated_at = now()
   WHERE id = slot_row.id;
  SELECT count(*), count(player_user_id), count(*) FILTER (WHERE player_user_id IS NOT NULL AND ready_stage = r.current_stage)
    INTO slot_count, occupied_count, ready_count
    FROM public.multiplayer_company_slots
   WHERE room_id = p_room_id;
  IF slot_count < 2 OR occupied_count < slot_count THEN RAISE EXCEPTION 'ALL_COMPANIES_REQUIRE_PLAYERS'; END IF;
  IF ready_count = slot_count THEN
    advance_reason := 'all_ready';
  ELSIF r.stage_deadline_at IS NOT NULL AND r.stage_deadline_at <= now() THEN
    advance_reason := 'timeout';
  ELSE
    RETURN jsonb_build_object('advanced', false, 'replayed', false, 'reason', NULL, 'room', to_jsonb(r));
  END IF;

  SELECT * INTO advanced_room FROM public.advance_multiplayer_stage(p_room_id, r.stage_version);
  RETURN jsonb_build_object('advanced', true, 'replayed', false, 'reason', advance_reason, 'room', to_jsonb(advanced_room));
END $$;
REVOKE ALL ON FUNCTION public.mark_multiplayer_ready(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_multiplayer_ready(uuid, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.join_multiplayer_company(
  p_room_code text, p_company_id text, p_user_id text, p_user_name text, p_state jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r multiplayer_rooms; s multiplayer_company_slots; scenario_uuid uuid; new_session_id uuid;
BEGIN
  SELECT * INTO r FROM multiplayer_rooms WHERE room_code=upper(p_room_code) FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  -- Returning the exact existing slot/session makes a lost join response
  -- harmless, even when the host started the room before the retry arrived.
  SELECT * INTO s FROM multiplayer_company_slots
    WHERE room_id=r.id AND player_user_id=p_user_id FOR UPDATE;
  IF s.id IS NOT NULL THEN
    IF s.company_id <> p_company_id THEN RAISE EXCEPTION 'PLAYER_ALREADY_JOINED'; END IF;
    IF s.game_session_id IS NULL THEN RAISE EXCEPTION 'COMPANY_RUNTIME_MISSING'; END IF;
    RETURN jsonb_build_object('roomId',r.id,'slotId',s.id,'sessionId',s.game_session_id,'companyId',s.company_id,'replayed',true);
  END IF;
  IF r.status <> 'waiting' THEN RAISE EXCEPTION 'ROOM_ALREADY_STARTED'; END IF;
  SELECT * INTO s FROM multiplayer_company_slots WHERE room_id=r.id AND company_id=p_company_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'COMPANY_SLOT_NOT_FOUND'; END IF;
  IF s.player_user_id IS NOT NULL THEN RAISE EXCEPTION 'COMPANY_SLOT_OCCUPIED'; END IF;
  SELECT id INTO scenario_uuid FROM project_scenarios WHERE code=r.scenario_code;
  IF scenario_uuid IS NULL THEN RAISE EXCEPTION 'SCENARIO_NOT_CONFIGURED'; END IF;
  INSERT INTO game_sessions(user_id,user_name,scenario_id,difficulty,mode,multiplayer,current_round,max_round,total_score,win_probability,status)
  VALUES(p_user_id,p_user_name,scenario_uuid,1,'ai_dialog',true,1,5,50,50,'playing') RETURNING id INTO new_session_id;
  INSERT INTO game_runtime_states(session_id,scenario_code,action_points,dimensions,npc_affinity,unlocked_npc_ids,unlocked_clues,conversation_memories,npc_contacts,active_meeting,simulation_state,last_action,version)
  VALUES(
    new_session_id,
    r.scenario_code,
    LEAST(28, GREATEST(0, COALESCE((p_state->>'actionPoints')::int, 28))),
    COALESCE(p_state->'dimensions','{}'),
    COALESCE(p_state->'npcAffinity','{}'),
    COALESCE(p_state->'unlockedNpcIds','[]'),
    COALESCE(p_state->'unlockedClues','[]'),
    COALESCE(p_state->'conversationMemories','{}'),
    COALESCE(p_state->'npcContacts','{}'),
    p_state->'activeMeeting',
    COALESCE(p_state, '{}'::jsonb) || jsonb_build_object(
      'gameMode', 'multiplayer',
      'companyId', p_company_id,
      'knownPersonalInfo', COALESCE(s.initial_personal_info, '{}'::jsonb),
      'currentRound', 1,
      'currentStage', 1,
      'maxRounds', 5,
      'maxStages', 5,
      'actionPoints', LEAST(28, GREATEST(0, COALESCE((p_state->>'actionPoints')::int, 28))),
      'version', 1,
      'roomStageVersion', r.stage_version
    ),
    NULL,
    1
  );
  UPDATE multiplayer_company_slots SET player_user_id=p_user_id,game_session_id=new_session_id,connected=true,updated_at=now() WHERE id=s.id;
  RETURN jsonb_build_object('roomId',r.id,'slotId',s.id,'sessionId',new_session_id,'companyId',p_company_id);
END $$;
REVOKE ALL ON FUNCTION public.join_multiplayer_company(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_multiplayer_company(text,text,text,text,jsonb) TO service_role;

-- Room creation and its initial company slots are one transaction. The API
-- must not be able to leave a joinable room behind without its full roster.
CREATE OR REPLACE FUNCTION public.create_multiplayer_room(
  p_host_user_id text,
  p_room_code text,
  p_stage_duration_seconds integer,
  p_companies jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.multiplayer_rooms;
  company jsonb;
  company_id text;
  company_name text;
  company_count integer;
BEGIN
  IF p_host_user_id IS NULL OR length(trim(p_host_user_id)) = 0
    OR p_room_code IS NULL OR upper(p_room_code) !~ '^[A-Z0-9]{1,12}$' THEN
    RAISE EXCEPTION 'ROOM_PARAMETERS_INVALID';
  END IF;
  IF p_stage_duration_seconds IS NOT NULL AND p_stage_duration_seconds < 60 THEN
    RAISE EXCEPTION 'ROOM_PARAMETERS_INVALID';
  END IF;
  IF jsonb_typeof(p_companies) <> 'array' THEN RAISE EXCEPTION 'ROOM_COMPANIES_INVALID'; END IF;
  company_count := jsonb_array_length(p_companies);
  IF company_count < 2 OR company_count > 8 THEN RAISE EXCEPTION 'ROOM_COMPANIES_INVALID'; END IF;
  INSERT INTO public.multiplayer_rooms(room_code, scenario_code, host_user_id, stage_duration_seconds)
  VALUES (upper(p_room_code), 'project-1', trim(p_host_user_id), p_stage_duration_seconds)
  RETURNING * INTO r;
  FOR company IN SELECT value FROM jsonb_array_elements(p_companies)
  LOOP
    company_id := trim(COALESCE(company->>'company_id', ''));
    company_name := trim(COALESCE(company->>'company_name', ''));
    IF company_id !~ '^[A-Za-z0-9_-]{1,64}$' OR length(company_name) = 0 OR length(company_name) > 128 THEN
      RAISE EXCEPTION 'ROOM_COMPANIES_INVALID';
    END IF;
    INSERT INTO public.multiplayer_company_slots(room_id, company_id, company_name, initial_personal_info)
    VALUES (
      r.id, company_id, company_name,
      CASE WHEN jsonb_typeof(company->'initial_personal_info') = 'object'
        THEN company->'initial_personal_info' ELSE '{}'::jsonb END
    );
  END LOOP;
  RETURN to_jsonb(r) || jsonb_build_object('companies', p_companies);
END $$;
REVOKE ALL ON FUNCTION public.create_multiplayer_room(text, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_multiplayer_room(text, text, integer, jsonb) TO service_role;

-- Starts are versioned and lock the full roster before the room becomes live.
CREATE OR REPLACE FUNCTION public.start_multiplayer_room(p_room_id uuid, p_expected_version integer)
RETURNS public.multiplayer_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.multiplayer_rooms; slot_row public.multiplayer_company_slots; slot_count integer := 0; occupied_count integer := 0;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN RAISE EXCEPTION 'ROOM_VERSION_INVALID'; END IF;
  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF r.stage_version = p_expected_version + 1 AND r.status = 'running' THEN RETURN r; END IF;
  IF r.stage_version <> p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status <> 'waiting' THEN RAISE EXCEPTION 'ROOM_ALREADY_STARTED'; END IF;
  FOR slot_row IN SELECT * FROM public.multiplayer_company_slots WHERE room_id = p_room_id ORDER BY id FOR UPDATE LOOP
    slot_count := slot_count + 1;
    IF slot_row.player_user_id IS NOT NULL AND slot_row.game_session_id IS NOT NULL THEN occupied_count := occupied_count + 1; END IF;
  END LOOP;
  IF slot_count < 2 OR occupied_count < slot_count THEN RAISE EXCEPTION 'ALL_COMPANIES_REQUIRE_PLAYERS'; END IF;
  UPDATE public.multiplayer_company_slots
     SET ready_stage = NULL, ready_by_admin = false, updated_at = now()
   WHERE room_id = p_room_id;
  -- The room version is a separate coordination token from each player's
  -- command version. Publish it into every attached snapshot as part of the
  -- same start transaction so ready requests do not compare unlike versions.
  UPDATE public.game_runtime_states AS runtime
     SET simulation_state = jsonb_set(
           jsonb_set(COALESCE(runtime.simulation_state, '{}'::jsonb), '{roomStageVersion}', to_jsonb(r.stage_version + 1), true),
           '{version}', to_jsonb(runtime.version + 1), true
         ),
         version = runtime.version + 1,
         updated_at = now()
    FROM public.multiplayer_company_slots AS slot
   WHERE slot.room_id = p_room_id AND runtime.session_id = slot.game_session_id;
  UPDATE public.multiplayer_rooms
     SET status = 'running', current_stage = 1, stage_version = stage_version + 1,
         stage_deadline_at = CASE WHEN stage_duration_seconds IS NULL THEN NULL ELSE now() + make_interval(secs => stage_duration_seconds) END,
         updated_at = now()
   WHERE id = p_room_id RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.start_multiplayer_room(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_multiplayer_room(uuid, integer) TO service_role;

-- Coach-ready shares the same lock/version/replay semantics as player-ready.
CREATE OR REPLACE FUNCTION public.force_multiplayer_ready(
  p_room_id uuid, p_slot_id uuid, p_expected_stage integer, p_expected_version integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.multiplayer_rooms; s public.multiplayer_company_slots; total integer; ready integer; advanced public.multiplayer_rooms;
BEGIN
  IF p_expected_stage IS NULL OR p_expected_stage < 1 OR p_expected_stage > 5 OR p_expected_version IS NULL OR p_expected_version < 1 THEN RAISE EXCEPTION 'ROOM_VERSION_INVALID'; END IF;
  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  SELECT * INTO s FROM public.multiplayer_company_slots WHERE id = p_slot_id AND room_id = p_room_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'ROOM_SLOT_NOT_FOUND'; END IF;
  IF r.stage_version = p_expected_version + 1
    AND (r.current_stage = p_expected_stage + 1 OR (r.status = 'finished' AND r.current_stage = p_expected_stage)) THEN
    RETURN jsonb_build_object('advanced', true, 'replayed', true, 'reason', 'replay', 'room', to_jsonb(r));
  END IF;
  IF r.stage_version <> p_expected_version OR r.current_stage <> p_expected_stage THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'ROOM_NOT_RUNNING'; END IF;
  IF s.ready_stage = p_expected_stage THEN RETURN jsonb_build_object('advanced', false, 'replayed', true, 'reason', 'replay', 'room', to_jsonb(r)); END IF;
  UPDATE public.multiplayer_company_slots SET ready_stage = p_expected_stage, ready_by_admin = true, updated_at = now() WHERE id = s.id;
  SELECT count(*), count(*) FILTER (WHERE player_user_id IS NOT NULL AND ready_stage = r.current_stage)
    INTO total, ready FROM public.multiplayer_company_slots WHERE room_id = p_room_id;
  IF ready = total THEN
    SELECT * INTO advanced FROM public.advance_multiplayer_stage(p_room_id, r.stage_version);
    RETURN jsonb_build_object('advanced', true, 'replayed', false, 'reason', 'all_ready', 'room', to_jsonb(advanced));
  END IF;
  RETURN jsonb_build_object('advanced', false, 'replayed', false, 'reason', NULL, 'room', to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION public.force_multiplayer_ready(uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_multiplayer_ready(uuid, uuid, integer, integer) TO service_role;

-- Removing a player is intentionally limited to the lobby. A running room
-- cannot be refilled by join_multiplayer_company, so allowing removal there
-- would strand every remaining player behind the all-companies requirement.
CREATE OR REPLACE FUNCTION public.remove_multiplayer_player(p_room_id uuid, p_slot_id uuid, p_expected_version integer)
RETURNS public.multiplayer_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.multiplayer_rooms; s public.multiplayer_company_slots; runtime_row public.game_runtime_states;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN RAISE EXCEPTION 'ROOM_VERSION_INVALID'; END IF;
  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF r.stage_version <> p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status <> 'waiting' THEN RAISE EXCEPTION 'ROOM_NOT_MUTABLE'; END IF;
  SELECT * INTO s FROM public.multiplayer_company_slots WHERE id = p_slot_id AND room_id = p_room_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'ROOM_SLOT_NOT_FOUND'; END IF;
  IF s.game_session_id IS NOT NULL THEN
    -- Lock and invalidate the runtime before retiring its session. A command
    -- that read the former version cannot subsequently commit a stale
    -- `playing` snapshot over this detached slot.
    SELECT * INTO runtime_row FROM public.game_runtime_states
      WHERE session_id = s.game_session_id FOR UPDATE;
    IF runtime_row.session_id IS NOT NULL THEN
      UPDATE public.game_runtime_states
         SET simulation_state = jsonb_set(
               jsonb_set(
                 jsonb_set(COALESCE(simulation_state, '{}'::jsonb), '{status}', '"lost"'::jsonb, true),
                 '{lastAction}', to_jsonb('multiplayer_player_removed'::text), true
               ),
               '{version}', to_jsonb(version + 1), true
             ),
             last_action = 'multiplayer_player_removed', version = version + 1, updated_at = now()
       WHERE session_id = s.game_session_id;
    END IF;
    UPDATE public.game_sessions SET status = 'replaced', finished_at = COALESCE(finished_at, now())
      WHERE id = s.game_session_id AND multiplayer = true AND status = 'playing';
  END IF;
  UPDATE public.multiplayer_company_slots
     SET player_user_id = NULL, game_session_id = NULL, connected = false, ready_stage = NULL, ready_by_admin = false, updated_at = now()
   WHERE id = s.id;
  UPDATE public.multiplayer_rooms SET stage_version = stage_version + 1, updated_at = now()
    WHERE id = p_room_id RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.remove_multiplayer_player(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_multiplayer_player(uuid, uuid, integer) TO service_role;

-- Ending a room is coordinated with every attached runtime. Marking only the
-- room finished would leave player-owned game sessions writable via commands.
CREATE OR REPLACE FUNCTION public.end_multiplayer_room(p_room_id uuid, p_expected_version integer)
RETURNS public.multiplayer_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.multiplayer_rooms; slot_row public.multiplayer_company_slots;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN RAISE EXCEPTION 'ROOM_VERSION_INVALID'; END IF;
  SELECT * INTO r FROM public.multiplayer_rooms WHERE id = p_room_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF r.status IN ('finished', 'cancelled') THEN
    IF r.stage_version IN (p_expected_version, p_expected_version + 1) THEN RETURN r; END IF;
    RAISE EXCEPTION 'ROOM_VERSION_CONFLICT';
  END IF;
  IF r.stage_version <> p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status NOT IN ('waiting', 'running') THEN RAISE EXCEPTION 'ROOM_NOT_MUTABLE'; END IF;
  FOR slot_row IN SELECT * FROM public.multiplayer_company_slots WHERE room_id = p_room_id ORDER BY id FOR UPDATE LOOP
    IF slot_row.game_session_id IS NOT NULL THEN
      UPDATE public.game_runtime_states
         SET simulation_state = jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(COALESCE(simulation_state, '{}'::jsonb), '{submissionReady}', 'false'::jsonb, true),
                   '{status}', '"lost"'::jsonb, true
                 ),
                 '{roomStageVersion}', to_jsonb(r.stage_version + 1), true
               ),
               '{version}', to_jsonb(version + 1), true
             ),
             last_action = 'multiplayer_room_ended', version = version + 1, updated_at = now()
       WHERE session_id = slot_row.game_session_id;
      UPDATE public.game_sessions
         SET status = 'lost', finished_at = COALESCE(finished_at, now())
       WHERE id = slot_row.game_session_id AND multiplayer = true AND status = 'playing';
    END IF;
  END LOOP;
  UPDATE public.multiplayer_rooms
     SET status = 'finished', stage_deadline_at = NULL, stage_version = stage_version + 1, updated_at = now()
   WHERE id = p_room_id RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.end_multiplayer_room(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_multiplayer_room(uuid, integer) TO service_role;
