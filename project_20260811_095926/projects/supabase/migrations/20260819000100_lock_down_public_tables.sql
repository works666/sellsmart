-- The application accesses Supabase only from trusted server routes with the
-- service-role key. Remove the inherited public policies so anon/authenticated
-- API clients cannot read or mutate application data directly.

ALTER TABLE public.health_check ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS affinity_scores_allow_all ON public.affinity_scores;
DROP POLICY IF EXISTS chat_messages_allow_all ON public.chat_messages;
DROP POLICY IF EXISTS decision_makers_allow_all ON public.decision_makers;
DROP POLICY IF EXISTS enterprises_allow_all ON public.enterprises;
DROP POLICY IF EXISTS game_sessions_allow_all ON public.game_sessions;
DROP POLICY IF EXISTS industries_allow_all ON public.industries;
DROP POLICY IF EXISTS invite_codes_allow_all ON public.invite_codes;
DROP POLICY IF EXISTS player_ability_allow_all ON public.player_ability;
DROP POLICY IF EXISTS product_categories_allow_all ON public.product_categories;
DROP POLICY IF EXISTS product_knowledge_allow_all ON public.product_knowledge;
DROP POLICY IF EXISTS project_scenarios_allow_all ON public.project_scenarios;
DROP POLICY IF EXISTS scenario_templates_allow_all ON public.scenario_templates;
DROP POLICY IF EXISTS user_identities_allow_all ON public.user_identities;

CREATE POLICY affinity_scores_service_role_only
  ON public.affinity_scores AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY chat_messages_service_role_only
  ON public.chat_messages AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY decision_makers_service_role_only
  ON public.decision_makers AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY enterprises_service_role_only
  ON public.enterprises AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY game_sessions_service_role_only
  ON public.game_sessions AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY industries_service_role_only
  ON public.industries AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY invite_codes_service_role_only
  ON public.invite_codes AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY player_ability_service_role_only
  ON public.player_ability AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY product_categories_service_role_only
  ON public.product_categories AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY product_knowledge_service_role_only
  ON public.product_knowledge AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY project_scenarios_service_role_only
  ON public.project_scenarios AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY scenario_templates_service_role_only
  ON public.scenario_templates AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY user_identities_service_role_only
  ON public.user_identities AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
