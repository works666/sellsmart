-- DATA-001: keep designer-managed competitors in the existing scenario template
-- JSONB instead of introducing a second competitor table.  The revision and
-- audit fields provide optimistic concurrency for the JSON document.
ALTER TABLE public.scenario_templates
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_by varchar(64),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scenario_templates_revision_check'
      AND conrelid = 'public.scenario_templates'::regclass
  ) THEN
    ALTER TABLE public.scenario_templates
      ADD CONSTRAINT scenario_templates_revision_check CHECK (revision >= 0);
  END IF;
END;
$$;

-- The runtime project is identified by the same stable code used by the
-- project_scenarios seed.  Do not overwrite an existing designer template.
INSERT INTO public.scenario_templates (
  code,
  title,
  industry_code,
  product_category_code,
  budget_wan,
  duration_months,
  technical_difficulties,
  client_demands,
  decision_maker_profile,
  competitors,
  tags,
  difficulty,
  description,
  is_preset,
  created_by,
  revision,
  updated_by
) VALUES (
  'project-1',
  '项目一 · 单单位内部竞标',
  'general-government',
  'general',
  100,
  5,
  '[]'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  '[{"id":"10000000-0000-4000-8000-000000000101","project_id":1,"company_name":"ABC竞品","features":"既有客情与价格竞争","more_info":"具体报价和项目动作需要在对局中继续收集。"}]'::jsonb,
  '["project-one"]'::jsonb,
  1,
  '年度办公配套升级采购项目。',
  true,
  'system',
  0,
  'system'
)
ON CONFLICT (code) DO NOTHING;

