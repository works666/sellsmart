BEGIN;
-- Add public, fictional training profiles only to the untouched original preset.
-- Existing designer edits, custom lists, and empty lists are preserved.
DO $$
DECLARE
  v_revision integer;
  v_competitors jsonb;
BEGIN
  SELECT revision, competitors INTO v_revision, v_competitors
  FROM public.scenario_templates WHERE code = 'project-1' FOR UPDATE;
  IF FOUND AND v_revision = 0 AND jsonb_array_length(v_competitors) = 1
    AND v_competitors->0->>'id' = '10000000-0000-4000-8000-000000000101'
    AND v_competitors->0->>'company_name' = 'ABC竞品'
    AND v_competitors->0->>'features' = '既有客情与价格竞争'
    AND v_competitors->0->>'more_info' = '具体报价和项目动作需要在对局中继续收集。' THEN
    UPDATE public.scenario_templates
    SET competitors = v_competitors || '[{"id":"10000000-0000-4000-8000-000000000102","project_id":1,"company_name":"北辰数科（模拟企业）","features":"数据治理与系统集成方案成熟，适合复杂存量系统环境。","more_info":"纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。","industry":"政务数字化与数据治理（模拟设定）","solution_summary":"强调跨系统数据整合、统一身份与分阶段迁移，具体接口和验收方案需结合招标要求核实。","representative_experience":"模拟设定：曾参与多源数据整合类项目；未提供可核验的真实客户或合同案例。","service_support":"模拟设定：可提供本地实施团队与上线后运维响应；服务网点和响应时限尚未核验。"},{"id":"10000000-0000-4000-8000-000000000103","project_id":1,"company_name":"云桥协同（模拟企业）","features":"协同办公产品覆盖较完整，部署选择灵活，强调易用性。","more_info":"纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。","industry":"协同办公与政企软件（模拟设定）","solution_summary":"侧重统一门户、流程协同和分层部署，可按需求讨论模块组合；与现有系统的兼容性需要进一步确认。","representative_experience":"模拟设定：具有中型组织协同平台交付经验；未提供可核验的真实客户或合同案例。","service_support":"模拟设定：提供远程培训、知识库和上线辅导；具体服务范围与响应等级尚未核验。"}]'::jsonb,
        revision = v_revision + 1, updated_at = now(), updated_by = 'system'
    WHERE code = 'project-1' AND revision = v_revision;
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261014000100', 'seed_public_competitor_profiles', ARRAY[$competitor_migration_source$-- Add public, fictional training profiles only to the untouched original preset.
-- Existing designer edits, custom lists, and empty lists are preserved.
DO $$
DECLARE
  v_revision integer;
  v_competitors jsonb;
BEGIN
  SELECT revision, competitors INTO v_revision, v_competitors
  FROM public.scenario_templates WHERE code = 'project-1' FOR UPDATE;
  IF FOUND AND v_revision = 0 AND jsonb_array_length(v_competitors) = 1
    AND v_competitors->0->>'id' = '10000000-0000-4000-8000-000000000101'
    AND v_competitors->0->>'company_name' = 'ABC竞品'
    AND v_competitors->0->>'features' = '既有客情与价格竞争'
    AND v_competitors->0->>'more_info' = '具体报价和项目动作需要在对局中继续收集。' THEN
    UPDATE public.scenario_templates
    SET competitors = v_competitors || '[{"id":"10000000-0000-4000-8000-000000000102","project_id":1,"company_name":"北辰数科（模拟企业）","features":"数据治理与系统集成方案成熟，适合复杂存量系统环境。","more_info":"纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。","industry":"政务数字化与数据治理（模拟设定）","solution_summary":"强调跨系统数据整合、统一身份与分阶段迁移，具体接口和验收方案需结合招标要求核实。","representative_experience":"模拟设定：曾参与多源数据整合类项目；未提供可核验的真实客户或合同案例。","service_support":"模拟设定：可提供本地实施团队与上线后运维响应；服务网点和响应时限尚未核验。"},{"id":"10000000-0000-4000-8000-000000000103","project_id":1,"company_name":"云桥协同（模拟企业）","features":"协同办公产品覆盖较完整，部署选择灵活，强调易用性。","more_info":"纯模拟企业资料，仅用于项目一实训。其项目经历、报价及当前客户关系均未设定，需在对局中继续核实。","industry":"协同办公与政企软件（模拟设定）","solution_summary":"侧重统一门户、流程协同和分层部署，可按需求讨论模块组合；与现有系统的兼容性需要进一步确认。","representative_experience":"模拟设定：具有中型组织协同平台交付经验；未提供可核验的真实客户或合同案例。","service_support":"模拟设定：提供远程培训、知识库和上线辅导；具体服务范围与响应等级尚未核验。"}]'::jsonb,
        revision = v_revision + 1, updated_at = now(), updated_by = 'system'
    WHERE code = 'project-1' AND revision = v_revision;
  END IF;
END;
$$;
$competitor_migration_source$]) ON CONFLICT (version) DO NOTHING;
COMMIT;
