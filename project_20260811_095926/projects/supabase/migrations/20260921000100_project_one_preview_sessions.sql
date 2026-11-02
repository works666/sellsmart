-- Durable state for the five-person preview. This is intentionally separate
-- from the old four-person game_sessions/runtime schema during the migration.

CREATE TABLE IF NOT EXISTS public.project_one_preview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(64) NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_one_preview_sessions_user_active_idx
  ON public.project_one_preview_sessions(user_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS public.project_one_preview_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(64) NOT NULL,
  session_id uuid NOT NULL REFERENCES public.project_one_preview_sessions(id) ON DELETE CASCADE,
  command_id varchar(128) NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_one_preview_commands_user_command_unique UNIQUE(user_id, command_id)
);

CREATE INDEX IF NOT EXISTS project_one_preview_commands_session_idx
  ON public.project_one_preview_commands(session_id, updated_at DESC);

ALTER TABLE public.project_one_preview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_one_preview_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_one_preview_sessions_service_role_only ON public.project_one_preview_sessions;
CREATE POLICY project_one_preview_sessions_service_role_only
  ON public.project_one_preview_sessions AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS project_one_preview_commands_service_role_only ON public.project_one_preview_commands;
CREATE POLICY project_one_preview_commands_service_role_only
  ON public.project_one_preview_commands AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.acquire_project_one_preview_command(
  p_user_id varchar,
  p_preview_session_id uuid,
  p_command_id varchar,
  p_request_hash varchar,
  p_expected_version integer,
  p_initial_state jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.project_one_preview_commands;
  session_row public.project_one_preview_sessions;
  next_session_id uuid;
  next_lease_token uuid := gen_random_uuid();
  prepared_initial_state jsonb;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN RAISE EXCEPTION 'PREVIEW_SESSION_OWNER_INVALID'; END IF;
  IF p_command_id IS NULL OR length(trim(p_command_id)) = 0 THEN RAISE EXCEPTION 'PREVIEW_COMMAND_INVALID'; END IF;
  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PREVIEW_COMMAND_INVALID'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN RAISE EXCEPTION 'PREVIEW_SESSION_VERSION_CONFLICT'; END IF;
  IF jsonb_typeof(COALESCE(p_initial_state, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'PREVIEW_INITIAL_STATE_INVALID'; END IF;

  -- Serialize all first-command creation and command-id replay for one user.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));
  SELECT * INTO command_row
    FROM public.project_one_preview_commands
    WHERE user_id = p_user_id AND command_id = p_command_id
    FOR UPDATE;

  IF FOUND THEN
    IF command_row.request_hash <> p_request_hash THEN RAISE EXCEPTION 'PREVIEW_COMMAND_HASH_MISMATCH'; END IF;
    IF command_row.status = 'completed' THEN
      RETURN jsonb_build_object('kind', 'replay', 'response', command_row.response);
    END IF;
    IF command_row.lease_expires_at IS NOT NULL AND command_row.lease_expires_at > now() THEN
      RAISE EXCEPTION 'PREVIEW_COMMAND_BUSY';
    END IF;
    IF p_preview_session_id IS NOT NULL AND p_preview_session_id <> command_row.session_id THEN
      RAISE EXCEPTION 'PREVIEW_COMMAND_SESSION_MISMATCH';
    END IF;
    SELECT * INTO session_row
      FROM public.project_one_preview_sessions
      WHERE id = command_row.session_id AND user_id = p_user_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_SESSION_NOT_FOUND'; END IF;
    IF session_row.lease_expires_at IS NOT NULL AND session_row.lease_expires_at > now()
      AND session_row.lease_token IS DISTINCT FROM command_row.lease_token THEN
      RAISE EXCEPTION 'PREVIEW_COMMAND_BUSY';
    END IF;
    IF session_row.version <> p_expected_version THEN RAISE EXCEPTION 'PREVIEW_SESSION_VERSION_CONFLICT'; END IF;
    UPDATE public.project_one_preview_commands
      SET lease_token = next_lease_token, lease_expires_at = now() + interval '90 seconds', updated_at = now()
      WHERE id = command_row.id;
    UPDATE public.project_one_preview_sessions
      SET lease_token = next_lease_token, lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now()
      WHERE id = session_row.id;
    RETURN jsonb_build_object('kind', 'lease', 'session_id', session_row.id, 'version', session_row.version,
      'state', session_row.state, 'lease_token', next_lease_token);
  END IF;

  IF p_preview_session_id IS NULL THEN
    IF p_expected_version <> 0 THEN RAISE EXCEPTION 'PREVIEW_SESSION_VERSION_CONFLICT'; END IF;
    next_session_id := gen_random_uuid();
    prepared_initial_state := jsonb_set(
      jsonb_set(COALESCE(p_initial_state, '{}'::jsonb), '{previewSessionId}', to_jsonb(next_session_id::text), true),
      '{version}', '0'::jsonb, true
    );
    INSERT INTO public.project_one_preview_sessions(id, user_id, state, version, lease_token, lease_expires_at)
      VALUES (next_session_id, p_user_id, prepared_initial_state, 0, next_lease_token, now() + interval '90 seconds')
      RETURNING * INTO session_row;
  ELSE
    SELECT * INTO session_row
      FROM public.project_one_preview_sessions
      WHERE id = p_preview_session_id AND user_id = p_user_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_SESSION_NOT_FOUND'; END IF;
    IF session_row.lease_expires_at IS NOT NULL AND session_row.lease_expires_at > now() THEN
      RAISE EXCEPTION 'PREVIEW_COMMAND_BUSY';
    END IF;
    IF session_row.version <> p_expected_version THEN RAISE EXCEPTION 'PREVIEW_SESSION_VERSION_CONFLICT'; END IF;
    UPDATE public.project_one_preview_sessions
      SET lease_token = next_lease_token, lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now()
      WHERE id = session_row.id
      RETURNING * INTO session_row;
  END IF;

  INSERT INTO public.project_one_preview_commands(user_id, session_id, command_id, request_hash, status, lease_token, lease_expires_at)
    VALUES (p_user_id, session_row.id, p_command_id, p_request_hash, 'pending', next_lease_token, now() + interval '90 seconds');
  RETURN jsonb_build_object('kind', 'lease', 'session_id', session_row.id, 'version', session_row.version,
    'state', session_row.state, 'lease_token', next_lease_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_project_one_preview_command_lease(
  p_user_id varchar,
  p_preview_session_id uuid,
  p_command_id varchar,
  p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.project_one_preview_commands;
BEGIN
  SELECT * INTO command_row FROM public.project_one_preview_commands
    WHERE user_id = p_user_id AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_preview_session_id OR command_row.status <> 'pending'
    OR command_row.lease_token IS DISTINCT FROM p_lease_token
    OR command_row.lease_expires_at IS NULL OR command_row.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'PREVIEW_COMMAND_LEASE_LOST';
  END IF;
  UPDATE public.project_one_preview_sessions
    SET lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now()
    WHERE id = p_preview_session_id AND user_id = p_user_id AND lease_token = p_lease_token
      AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_COMMAND_LEASE_LOST'; END IF;
  UPDATE public.project_one_preview_commands
    SET lease_expires_at = now() + interval '90 seconds', updated_at = now()
    WHERE id = command_row.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_project_one_preview_command(
  p_user_id varchar,
  p_preview_session_id uuid,
  p_command_id varchar,
  p_expected_version integer,
  p_lease_token uuid,
  p_state jsonb,
  p_response jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.project_one_preview_commands;
  session_row public.project_one_preview_sessions;
BEGIN
  IF jsonb_typeof(COALESCE(p_state, '{}'::jsonb)) <> 'object' OR jsonb_typeof(COALESCE(p_response, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'PREVIEW_COMMAND_PAYLOAD_INVALID';
  END IF;
  SELECT * INTO command_row FROM public.project_one_preview_commands
    WHERE user_id = p_user_id AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_preview_session_id THEN RAISE EXCEPTION 'PREVIEW_SESSION_NOT_FOUND'; END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.response; END IF;
  IF command_row.lease_token IS DISTINCT FROM p_lease_token OR command_row.lease_expires_at IS NULL OR command_row.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'PREVIEW_COMMAND_LEASE_LOST';
  END IF;
  SELECT * INTO session_row FROM public.project_one_preview_sessions
    WHERE id = p_preview_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_SESSION_NOT_FOUND'; END IF;
  IF session_row.version <> p_expected_version OR session_row.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'PREVIEW_SESSION_VERSION_CONFLICT';
  END IF;
  UPDATE public.project_one_preview_sessions
    SET state = p_state, version = version + 1, lease_token = NULL, lease_expires_at = NULL,
        last_active_at = now(), updated_at = now()
    WHERE id = p_preview_session_id;
  UPDATE public.project_one_preview_commands
    SET status = 'completed', response = p_response, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = command_row.id;
  RETURN p_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_project_one_preview_command(
  p_user_id varchar,
  p_preview_session_id uuid,
  p_command_id varchar,
  p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.project_one_preview_commands;
BEGIN
  SELECT * INTO command_row FROM public.project_one_preview_commands
    WHERE user_id = p_user_id AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_preview_session_id OR command_row.status <> 'pending' OR command_row.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN false;
  END IF;
  -- Keep the command row and request hash after a failed attempt. A retry with
  -- the same command id may reacquire the lease, while a changed payload is
  -- still rejected instead of being treated as a brand-new command.
  UPDATE public.project_one_preview_commands
    SET lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = command_row.id;
  UPDATE public.project_one_preview_sessions
    SET lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_preview_session_id AND user_id = p_user_id AND lease_token = p_lease_token;
  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.project_one_preview_sessions, public.project_one_preview_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_project_one_preview_command(varchar, uuid, varchar, varchar, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_project_one_preview_command_lease(varchar, uuid, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_project_one_preview_command(varchar, uuid, varchar, integer, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abandon_project_one_preview_command(varchar, uuid, varchar, uuid) FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_one_preview_sessions, public.project_one_preview_commands TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_project_one_preview_command(varchar, uuid, varchar, varchar, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_project_one_preview_command_lease(varchar, uuid, varchar, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_project_one_preview_command(varchar, uuid, varchar, integer, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_project_one_preview_command(varchar, uuid, varchar, uuid) TO service_role;
