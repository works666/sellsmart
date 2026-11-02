CREATE TABLE IF NOT EXISTS public.designer_prompt_configs (
  id text PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by varchar(64),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.designer_prompt_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designer_prompt_configs_service_role_only ON public.designer_prompt_configs;
CREATE POLICY designer_prompt_configs_service_role_only
  ON public.designer_prompt_configs AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.designer_prompt_configs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.designer_prompt_configs TO service_role;
