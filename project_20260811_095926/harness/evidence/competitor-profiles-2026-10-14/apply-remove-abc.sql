BEGIN;
-- ABC is a historical placeholder, not a public company profile.
-- Preserve renamed/custom records and every other company, including order.
DO $$
DECLARE
  v_revision integer;
  v_profiles jsonb;
  v_filtered jsonb;
BEGIN
  SELECT revision, competitors INTO v_revision, v_profiles
    FROM public.scenario_templates WHERE code = 'project-1' FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(item ORDER BY position), '[]'::jsonb)
      INTO v_filtered
      FROM jsonb_array_elements(v_profiles) WITH ORDINALITY AS profiles(item, position)
      WHERE NOT (
        item->>'id' = '10000000-0000-4000-8000-000000000101'
        AND trim(item->>'company_name') ~* '^ABC(竞品|公司)?$'
      );
    IF v_filtered IS DISTINCT FROM v_profiles THEN
      UPDATE public.scenario_templates
        SET competitors = v_filtered, revision = v_revision + 1,
            updated_at = now(), updated_by = 'system'
        WHERE code = 'project-1' AND revision = v_revision;
    END IF;
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261014000200', 'remove_abc_profile_placeholder', ARRAY[$abc_profile_source$-- ABC is a historical placeholder, not a public company profile.
-- Preserve renamed/custom records and every other company, including order.
DO $$
DECLARE
  v_revision integer;
  v_profiles jsonb;
  v_filtered jsonb;
BEGIN
  SELECT revision, competitors INTO v_revision, v_profiles
    FROM public.scenario_templates WHERE code = 'project-1' FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(item ORDER BY position), '[]'::jsonb)
      INTO v_filtered
      FROM jsonb_array_elements(v_profiles) WITH ORDINALITY AS profiles(item, position)
      WHERE NOT (
        item->>'id' = '10000000-0000-4000-8000-000000000101'
        AND trim(item->>'company_name') ~* '^ABC(竞品|公司)?$'
      );
    IF v_filtered IS DISTINCT FROM v_profiles THEN
      UPDATE public.scenario_templates
        SET competitors = v_filtered, revision = v_revision + 1,
            updated_at = now(), updated_by = 'system'
        WHERE code = 'project-1' AND revision = v_revision;
    END IF;
  END IF;
END;
$$;
$abc_profile_source$]) ON CONFLICT (version) DO NOTHING;
COMMIT;
