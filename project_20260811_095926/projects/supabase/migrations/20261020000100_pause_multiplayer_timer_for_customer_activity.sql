-- Extends the active multiplayer project timer by the exact server-clock activity window.
CREATE OR REPLACE FUNCTION public.end_multiplayer_room(p_room_id uuid, p_expected_version integer)
RETURNS public.multiplayer_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.multiplayer_rooms;
  slot_row public.multiplayer_company_slots;
  runtime_row public.game_runtime_states;
  session_row public.game_sessions;
  next_state jsonb;
  timer_state jsonb;
  meeting_state jsonb;
  planning_activity jsonb;
  activities_state jsonb;
  planning_deadline_text text;
  planning_deadline_at timestamptz;
  anchor_text text;
  anchor_at timestamptz;
  elapsed_ms bigint;
  turn_count bigint;
  old_recovered_intervals bigint;
  recovered_intervals bigint;
  old_action_points integer;
  next_action_points integer;
  timer_now timestamptz := now();
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'ROOM_VERSION_INVALID';
  END IF;

  SELECT * INTO r
    FROM public.multiplayer_rooms
   WHERE id = p_room_id
   FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;
  IF r.status IN ('finished', 'cancelled') THEN
    IF r.stage_version IN (p_expected_version, p_expected_version + 1) THEN RETURN r; END IF;
    RAISE EXCEPTION 'ROOM_VERSION_CONFLICT';
  END IF;
  IF r.stage_version <> p_expected_version THEN RAISE EXCEPTION 'ROOM_VERSION_CONFLICT'; END IF;
  IF r.status NOT IN ('waiting', 'running') THEN RAISE EXCEPTION 'ROOM_NOT_MUTABLE'; END IF;

  -- Match commit_game_command's row-lock order (runtime, then session). A
  -- concurrent command either commits before this lock or loses its version
  -- precondition after this transaction marks the runtime terminal.
  FOR slot_row IN
    SELECT * FROM public.multiplayer_company_slots
     WHERE room_id = p_room_id
     ORDER BY id
     FOR UPDATE
  LOOP
    IF slot_row.game_session_id IS NULL THEN CONTINUE; END IF;

    SELECT * INTO runtime_row
      FROM public.game_runtime_states
     WHERE session_id = slot_row.game_session_id
     FOR UPDATE;

    SELECT * INTO session_row
      FROM public.game_sessions
     WHERE id = slot_row.game_session_id
       AND multiplayer = true
     FOR UPDATE;
    IF session_row.id IS NULL OR session_row.status <> 'playing' THEN
      CONTINUE;
    END IF;

    IF runtime_row.session_id IS NOT NULL THEN
      next_state := COALESCE(runtime_row.simulation_state, '{}'::jsonb);
      timer_state := CASE
        WHEN jsonb_typeof(next_state->'projectTimer') = 'object' THEN next_state->'projectTimer'
        ELSE '{}'::jsonb
      END;
      old_recovered_intervals := CASE
        WHEN COALESCE(timer_state->>'recoveredIntervals', '') ~ '^[0-9]+$'
          THEN (timer_state->>'recoveredIntervals')::bigint
        ELSE 0
      END;
      old_action_points := COALESCE(runtime_row.action_points, 0);
      meeting_state := CASE
        WHEN jsonb_typeof(runtime_row.active_meeting) = 'object' THEN runtime_row.active_meeting
        WHEN jsonb_typeof(next_state->'activeMeeting') = 'object' THEN next_state->'activeMeeting'
        ELSE NULL
      END;

      planning_activity := NULL;
      IF jsonb_typeof(next_state #> '{customerActivities,tasks}') = 'array' THEN
        SELECT item.value INTO planning_activity
          FROM jsonb_array_elements(next_state #> '{customerActivities,tasks}') AS item(value)
         WHERE item.value->>'status' = 'planning'
         LIMIT 1;
      END IF;

      IF planning_activity IS NOT NULL THEN
        planning_deadline_text := NULLIF(planning_activity->>'deadlineAt', '');
        IF planning_deadline_text IS NULL OR planning_deadline_text !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'CUSTOMER_ACTIVITY_TIMER_INVALID';
        END IF;
        planning_deadline_at := to_timestamp(planning_deadline_text::numeric / 1000.0);
        -- The room owner may end training while a plan is open. Freeze only
        -- the last server-saved draft; use room_ended before the deadline and
        -- timeout at/after it. Activity time itself never consumes the game
        -- timer, so only post-deadline wall time is charged below.
        activities_state := next_state->'customerActivities';
        activities_state := activities_state || jsonb_build_object(
          'tasks', COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN item.value->>'id' = planning_activity->>'id'
                    THEN item.value || jsonb_build_object(
                      'status', 'submitted',
                      'submittedAt', LEAST(
                        planning_deadline_text::numeric::bigint,
                        FLOOR(EXTRACT(EPOCH FROM timer_now) * 1000)::bigint
                      ),
                      'submitReason', CASE
                        WHEN planning_deadline_at > timer_now THEN 'room_ended'
                        ELSE 'timeout'
                      END
                    )
                  ELSE item.value
                END
                ORDER BY item.ordinality
              )
              FROM jsonb_array_elements(activities_state->'tasks') WITH ORDINALITY AS item(value, ordinality)
            ),
            '[]'::jsonb
          )
        );
        next_state := next_state || jsonb_build_object('customerActivities', activities_state);
        elapsed_ms := CASE
          WHEN COALESCE(timer_state->>'elapsedMs', '') ~ '^[0-9]+$'
            THEN (timer_state->>'elapsedMs')::bigint
          ELSE 0
        END + CASE
          WHEN planning_deadline_at > timer_now THEN 0
          ELSE GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (timer_now - planning_deadline_at)) * 1000)::bigint
          )
        END;
      ELSIF meeting_state IS NOT NULL THEN
        turn_count := CASE
          WHEN COALESCE(meeting_state->>'turnCount', '') ~ '^[0-9]+$'
            THEN (meeting_state->>'turnCount')::bigint
          ELSE 0
        END;
        -- A visit pauses wall time. Each already-committed conversation round
        -- is charged exactly as resumeProjectTimerAfterVisit would charge it.
        elapsed_ms := CASE
          WHEN COALESCE(timer_state->>'elapsedMs', '') ~ '^[0-9]+$'
            THEN (timer_state->>'elapsedMs')::bigint
          ELSE 0
        END + turn_count * 15000;
      ELSE
        elapsed_ms := CASE
          WHEN COALESCE(timer_state->>'elapsedMs', '') ~ '^[0-9]+$'
            THEN (timer_state->>'elapsedMs')::bigint
          ELSE 0
        END;
        anchor_text := NULLIF(timer_state->>'lastResumedAt', '');
        anchor_at := NULL;
        IF anchor_text IS NOT NULL THEN
          BEGIN
            anchor_at := anchor_text::timestamptz;
          EXCEPTION WHEN others THEN
            anchor_at := NULL;
          END;
        END IF;
        -- New rooms always carry the anchor installed by start_multiplayer_room.
        -- For a legacy running room without one, updated_at is the closest
        -- persisted start/checkpoint boundary available in the old schema.
        IF anchor_at IS NULL AND r.status = 'running' THEN
          anchor_at := r.updated_at;
        END IF;
        IF anchor_at IS NOT NULL THEN
          elapsed_ms := elapsed_ms + GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (timer_now - anchor_at)) * 1000)::bigint
          );
        END IF;
      END IF;

      elapsed_ms := LEAST(1200000::bigint, GREATEST(0::bigint, elapsed_ms));
      recovered_intervals := GREATEST(
        old_recovered_intervals,
        FLOOR(elapsed_ms / 300000)::bigint
      );
      next_action_points := LEAST(
        28::bigint,
        old_action_points + GREATEST(0::bigint, recovered_intervals - old_recovered_intervals) * 5
      )::integer;
      timer_state := (timer_state - 'remainingMs' - 'expiresAt' - 'isPaused' - 'serverNow')
        || jsonb_build_object(
          'durationMs', 1200000,
          'elapsedMs', elapsed_ms,
          'recoveredIntervals', recovered_intervals,
          'visitPaused', false,
          'lastResumedAt', NULL
        );
      next_state := next_state || jsonb_build_object(
        'status', 'lost',
        'submissionReady', false,
        'actionPoints', next_action_points,
        'activeMeeting', NULL,
        'activePhoneCall', NULL,
        'projectTimer', timer_state,
        'lastAction', 'multiplayer_room_ended',
        'version', runtime_row.version + 1
      );

      UPDATE public.game_runtime_states
         SET simulation_state = next_state,
             action_points = next_action_points,
             active_meeting = NULL,
             last_action = 'multiplayer_room_ended',
             phase_started_at = NULL,
             phase_ends_at = NULL,
             paused_at = NULL,
             paused_remaining_ms = NULL,
             version = runtime_row.version + 1,
             updated_at = timer_now
       WHERE session_id = slot_row.game_session_id;
    END IF;

    UPDATE public.game_sessions
       SET status = 'lost',
           won = false,
           finished_at = COALESCE(finished_at, timer_now)
     WHERE id = slot_row.game_session_id
       AND multiplayer = true
       AND status = 'playing';
  END LOOP;

  UPDATE public.multiplayer_company_slots
     SET ready_stage = NULL,
         ready_by_admin = false,
         updated_at = timer_now
   WHERE room_id = p_room_id;
  UPDATE public.multiplayer_rooms
     SET status = 'finished',
         stage_duration_seconds = NULL,
         stage_deadline_at = NULL,
         stage_version = stage_version + 1,
         updated_at = timer_now
   WHERE id = p_room_id
   RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.end_multiplayer_room(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_multiplayer_room(uuid, integer) TO service_role;
