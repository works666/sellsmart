-- Durable command processing for the Zhang Jianguo prompt-test workbench.
-- This remains separate from both the legacy game save and five-person preview tables.

CREATE TABLE IF NOT EXISTS public.prompt_test_sessions (
  id varchar(128) PRIMARY KEY,
  user_id varchar(64) NOT NULL,
  provider varchar(16) NOT NULL CHECK (provider IN ('deepseek', 'doubao')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_test_sessions_user_provider_active_idx
  ON public.prompt_test_sessions(user_id, provider, last_active_at DESC);

CREATE TABLE IF NOT EXISTS public.prompt_test_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(64) NOT NULL,
  provider varchar(16) NOT NULL CHECK (provider IN ('deepseek', 'doubao')),
  session_id varchar(128) NOT NULL REFERENCES public.prompt_test_sessions(id) ON DELETE CASCADE,
  command_id varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_test_commands_user_provider_command_unique UNIQUE(user_id, provider, command_id)
);

CREATE INDEX IF NOT EXISTS prompt_test_commands_session_idx
  ON public.prompt_test_commands(session_id, updated_at DESC);

ALTER TABLE public.prompt_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_test_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prompt_test_sessions_service_role_only ON public.prompt_test_sessions;
CREATE POLICY prompt_test_sessions_service_role_only
  ON public.prompt_test_sessions AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS prompt_test_commands_service_role_only ON public.prompt_test_commands;
CREATE POLICY prompt_test_commands_service_role_only
  ON public.prompt_test_commands AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.acquire_prompt_test_command(
  p_user_id varchar,
  p_provider varchar,
  p_session_id varchar,
  p_command_id varchar,
  p_request_hash char(64),
  p_expected_version integer,
  p_initial_state jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.prompt_test_commands;
  session_row public.prompt_test_sessions;
  next_session_id varchar(128);
  next_lease_token uuid := gen_random_uuid();
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN RAISE EXCEPTION 'PROMPT_TEST_SESSION_OWNER_INVALID'; END IF;
  IF p_provider NOT IN ('deepseek', 'doubao') THEN RAISE EXCEPTION 'PROMPT_TEST_PROVIDER_INVALID'; END IF;
  IF p_command_id IS NULL OR length(trim(p_command_id)) = 0 THEN RAISE EXCEPTION 'PROMPT_TEST_COMMAND_INVALID'; END IF;
  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PROMPT_TEST_COMMAND_HASH_INVALID'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN RAISE EXCEPTION 'PROMPT_TEST_VERSION_CONFLICT'; END IF;
  IF jsonb_typeof(COALESCE(p_initial_state, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'PROMPT_TEST_INITIAL_STATE_INVALID'; END IF;

  -- One user/provider is serialized while a command is acquired, so a new
  -- session cannot race another first command and command replay is stable.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || chr(31) || p_provider, 0));
  SELECT * INTO command_row FROM public.prompt_test_commands
    WHERE user_id = p_user_id AND provider = p_provider AND command_id = p_command_id
    FOR UPDATE;

  IF FOUND THEN
    IF command_row.request_hash <> p_request_hash THEN RAISE EXCEPTION 'PROMPT_TEST_COMMAND_PAYLOAD_MISMATCH'; END IF;
    IF p_session_id IS NOT NULL AND p_session_id <> command_row.session_id THEN RAISE EXCEPTION 'PROMPT_TEST_COMMAND_SESSION_MISMATCH'; END IF;
    IF command_row.status = 'completed' THEN
      RETURN jsonb_build_object('kind', 'replay', 'response', command_row.response);
    END IF;
    IF command_row.lease_expires_at IS NOT NULL AND command_row.lease_expires_at > now() THEN
      RAISE EXCEPTION 'PROMPT_TEST_COMMAND_BUSY';
    END IF;
    SELECT * INTO session_row FROM public.prompt_test_sessions
      WHERE id = command_row.session_id AND user_id = p_user_id AND provider = p_provider FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROMPT_TEST_SESSION_NOT_FOUND'; END IF;
    IF session_row.lease_expires_at IS NOT NULL AND session_row.lease_expires_at > now()
      AND session_row.lease_token IS DISTINCT FROM command_row.lease_token THEN
      RAISE EXCEPTION 'PROMPT_TEST_COMMAND_BUSY';
    END IF;
    IF session_row.version <> p_expected_version THEN RAISE EXCEPTION 'PROMPT_TEST_VERSION_CONFLICT'; END IF;
    UPDATE public.prompt_test_commands SET lease_token = next_lease_token,
      lease_expires_at = now() + interval '90 seconds', updated_at = now() WHERE id = command_row.id;
    UPDATE public.prompt_test_sessions SET lease_token = next_lease_token,
      lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now() WHERE id = session_row.id;
    RETURN jsonb_build_object('kind', 'lease', 'session_id', session_row.id, 'version', session_row.version,
      'state', session_row.state, 'lease_token', next_lease_token);
  END IF;

  IF p_session_id IS NULL THEN
    IF p_expected_version <> 0 THEN RAISE EXCEPTION 'PROMPT_TEST_VERSION_CONFLICT'; END IF;
    next_session_id := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.prompt_test_sessions(id, user_id, provider, state, version, lease_token, lease_expires_at)
      VALUES (next_session_id, p_user_id, p_provider, p_initial_state, 0, next_lease_token, now() + interval '90 seconds')
      RETURNING * INTO session_row;
  ELSE
    SELECT * INTO session_row FROM public.prompt_test_sessions
      WHERE id = p_session_id AND user_id = p_user_id AND provider = p_provider FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROMPT_TEST_SESSION_NOT_FOUND'; END IF;
    IF session_row.lease_expires_at IS NOT NULL AND session_row.lease_expires_at > now() THEN RAISE EXCEPTION 'PROMPT_TEST_COMMAND_BUSY'; END IF;
    IF session_row.version <> p_expected_version THEN RAISE EXCEPTION 'PROMPT_TEST_VERSION_CONFLICT'; END IF;
    UPDATE public.prompt_test_sessions SET lease_token = next_lease_token,
      lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now() WHERE id = session_row.id RETURNING * INTO session_row;
  END IF;

  INSERT INTO public.prompt_test_commands(user_id, provider, session_id, command_id, request_hash, lease_token, lease_expires_at)
    VALUES (p_user_id, p_provider, session_row.id, p_command_id, p_request_hash, next_lease_token, now() + interval '90 seconds');
  RETURN jsonb_build_object('kind', 'lease', 'session_id', session_row.id, 'version', session_row.version,
    'state', session_row.state, 'lease_token', next_lease_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_prompt_test_command_lease(
  p_user_id varchar, p_provider varchar, p_session_id varchar, p_command_id varchar, p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.prompt_test_commands;
BEGIN
  SELECT * INTO command_row FROM public.prompt_test_commands WHERE user_id = p_user_id AND provider = p_provider AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_session_id OR command_row.status <> 'pending'
    OR command_row.lease_token IS DISTINCT FROM p_lease_token OR command_row.lease_expires_at IS NULL OR command_row.lease_expires_at <= now() THEN
    RETURN false;
  END IF;
  UPDATE public.prompt_test_commands SET lease_expires_at = now() + interval '90 seconds', updated_at = now() WHERE id = command_row.id;
  UPDATE public.prompt_test_sessions SET lease_expires_at = now() + interval '90 seconds', last_active_at = now(), updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id AND provider = p_provider AND lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_prompt_test_command(
  p_user_id varchar, p_provider varchar, p_session_id varchar, p_command_id varchar,
  p_expected_version integer, p_lease_token uuid, p_state jsonb, p_response jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.prompt_test_commands; session_row public.prompt_test_sessions;
BEGIN
  IF jsonb_typeof(COALESCE(p_state, '{}'::jsonb)) <> 'object' OR jsonb_typeof(COALESCE(p_response, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'PROMPT_TEST_COMMAND_PAYLOAD_INVALID';
  END IF;
  SELECT * INTO command_row FROM public.prompt_test_commands WHERE user_id = p_user_id AND provider = p_provider AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_session_id THEN RAISE EXCEPTION 'PROMPT_TEST_SESSION_NOT_FOUND'; END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.response; END IF;
  IF command_row.lease_token IS DISTINCT FROM p_lease_token OR command_row.lease_expires_at IS NULL OR command_row.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'PROMPT_TEST_COMMAND_LEASE_LOST';
  END IF;
  SELECT * INTO session_row FROM public.prompt_test_sessions WHERE id = p_session_id AND user_id = p_user_id AND provider = p_provider FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROMPT_TEST_SESSION_NOT_FOUND'; END IF;
  IF session_row.version <> p_expected_version OR session_row.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'PROMPT_TEST_VERSION_CONFLICT'; END IF;
  UPDATE public.prompt_test_sessions SET state = p_state, version = version + 1, lease_token = NULL, lease_expires_at = NULL,
    last_active_at = now(), updated_at = now() WHERE id = p_session_id;
  UPDATE public.prompt_test_commands SET status = 'completed', response = p_response, lease_token = NULL, lease_expires_at = NULL,
    updated_at = now() WHERE id = command_row.id;
  RETURN p_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_prompt_test_command(
  p_user_id varchar, p_provider varchar, p_session_id varchar, p_command_id varchar, p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE command_row public.prompt_test_commands;
BEGIN
  SELECT * INTO command_row FROM public.prompt_test_commands WHERE user_id = p_user_id AND provider = p_provider AND command_id = p_command_id FOR UPDATE;
  IF NOT FOUND OR command_row.session_id <> p_session_id OR command_row.status <> 'pending' OR command_row.lease_token IS DISTINCT FROM p_lease_token THEN RETURN false; END IF;
  -- Preserve the pending row and its request hash. A failed provider call may
  -- retry the same command, but must never let the caller reuse its id with a
  -- different action or message.
  UPDATE public.prompt_test_commands SET lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = command_row.id;
  UPDATE public.prompt_test_sessions SET lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id AND provider = p_provider AND lease_token = p_lease_token;
  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.prompt_test_sessions, public.prompt_test_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_prompt_test_command(varchar, varchar, varchar, varchar, char, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_prompt_test_command_lease(varchar, varchar, varchar, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_prompt_test_command(varchar, varchar, varchar, varchar, integer, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abandon_prompt_test_command(varchar, varchar, varchar, varchar, uuid) FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prompt_test_sessions, public.prompt_test_commands TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_prompt_test_command(varchar, varchar, varchar, varchar, char, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_prompt_test_command_lease(varchar, varchar, varchar, varchar, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_prompt_test_command(varchar, varchar, varchar, varchar, integer, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_prompt_test_command(varchar, varchar, varchar, varchar, uuid) TO service_role;
