INSERT INTO public.project_scenarios (
  id, code, title, industry, project_type, budget_wan, duration_months,
  technical_risk, competitor_name, competitor_advantages,
  decision_maker_ids, difficulty, description
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'project-1',
  '项目一 · 单单位内部竞标',
  '通用政企单位',
  '单单位内部竞标',
  100, 5, '低', 'ABC竞品', '既有客情与价格竞争',
  '[]'::jsonb, 1,
  '年度办公配套升级采购项目。玩家需要识别决策流程、经营关键人物关系，并完成五轮竞标博弈。'
) ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  budget_wan = EXCLUDED.budget_wan,
  difficulty = EXCLUDED.difficulty,
  description = EXCLUDED.description;

INSERT INTO public.health_check (id, updated_at)
VALUES (1, now())
ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at;
