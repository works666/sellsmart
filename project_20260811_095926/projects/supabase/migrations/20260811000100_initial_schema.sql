CREATE TABLE "affinity_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"decision_maker_id" uuid NOT NULL,
	"player_affinity" integer DEFAULT 50 NOT NULL,
	"competitor_affinity" integer DEFAULT 50 NOT NULL,
	"last_change_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affinity_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"decision_maker_id" uuid,
	"round" integer DEFAULT 1 NOT NULL,
	"sender" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"action_type" varchar(32),
	"affinity_delta" integer,
	"score_delta" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decision_makers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"faction" varchar(32) NOT NULL,
	"faction_label" varchar(32) NOT NULL,
	"weight" integer DEFAULT 10 NOT NULL,
	"floor" integer DEFAULT 1 NOT NULL,
	"room" varchar(32) NOT NULL,
	"avatar" varchar(8) DEFAULT '👤' NOT NULL,
	"core_needs" text NOT NULL,
	"pain_points" text NOT NULL,
	"personal_preferences" text NOT NULL,
	"bonus_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"taboo_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty_min" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_makers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "decision_makers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enterprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"short_name" varchar(64),
	"industry_code" varchar(32),
	"scale" varchar(32),
	"region" varchar(64),
	"contact_name" varchar(64),
	"contact_phone" varchar(32),
	"admin_user_id" varchar(64),
	"product_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license_count" integer DEFAULT 0 NOT NULL,
	"expire_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprises_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "enterprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"npc_key" varchar(128),
	"round" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_runtime_states" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"scenario_code" varchar(32) NOT NULL,
	"action_points" integer DEFAULT 28 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"npc_affinity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unlocked_npc_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unlocked_clues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conversation_memories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_action" varchar(64),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) DEFAULT 'guest' NOT NULL,
	"user_name" varchar(64) DEFAULT '销售新兵' NOT NULL,
	"scenario_id" uuid NOT NULL,
	"product_id" uuid,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"mode" varchar(32) DEFAULT 'ai_dialog' NOT NULL,
	"multiplayer" boolean DEFAULT false NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"max_round" integer DEFAULT 10 NOT NULL,
	"total_score" integer DEFAULT 50 NOT NULL,
	"win_probability" integer DEFAULT 50 NOT NULL,
	"status" varchar(32) DEFAULT 'playing' NOT NULL,
	"won" boolean,
	"final_report" jsonb,
	"personality_type" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "health_check" (
	"id" serial NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"icon" varchar(8) DEFAULT '🏛️' NOT NULL,
	"description" text,
	"sub_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "industries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "industries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"enterprise_id" uuid,
	"created_by" varchar(64) NOT NULL,
	"role" varchar(32) DEFAULT 'enterprise_employee' NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expire_at" timestamp with time zone NOT NULL,
	"used_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "invite_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "player_ability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"sessions_played" integer DEFAULT 0 NOT NULL,
	"sessions_won" integer DEFAULT 0 NOT NULL,
	"win_rate" integer DEFAULT 0 NOT NULL,
	"avg_total_score" integer DEFAULT 0 NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"ability_personality" integer DEFAULT 0 NOT NULL,
	"ability_research" integer DEFAULT 0 NOT NULL,
	"ability_layered" integer DEFAULT 0 NOT NULL,
	"ability_pitch" integer DEFAULT 0 NOT NULL,
	"ability_competitor" integer DEFAULT 0 NOT NULL,
	"ability_bidding" integer DEFAULT 0 NOT NULL,
	"ability_product" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_ability_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "player_ability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"parent_code" varchar(32),
	"icon" varchar(8) DEFAULT '📦' NOT NULL,
	"description" text,
	"typical_scenarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" varchar(64) DEFAULT 'guest' NOT NULL,
	"product_name" varchar(128) NOT NULL,
	"category" varchar(64) DEFAULT '通用' NOT NULL,
	"technical_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prohibited_descriptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_selling_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_industries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"file_url" text,
	"raw_content" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" varchar(128) NOT NULL,
	"industry" varchar(64) NOT NULL,
	"project_type" varchar(64) NOT NULL,
	"budget_wan" integer NOT NULL,
	"duration_months" integer DEFAULT 6 NOT NULL,
	"technical_risk" varchar(32) NOT NULL,
	"competitor_name" varchar(64) NOT NULL,
	"competitor_advantages" text NOT NULL,
	"decision_maker_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_scenarios_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "project_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scenario_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"industry_code" varchar(32) NOT NULL,
	"product_category_code" varchar(32) NOT NULL,
	"budget_wan" integer NOT NULL,
	"duration_months" integer DEFAULT 12 NOT NULL,
	"technical_difficulties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_demands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_maker_profile" jsonb NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"description" text,
	"is_preset" boolean DEFAULT true NOT NULL,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "scenario_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"phone" varchar(32),
	"email" varchar(128),
	"display_name" varchar(64) NOT NULL,
	"avatar" varchar(8) DEFAULT '👤' NOT NULL,
	"role" varchar(32) NOT NULL,
	"sub_role" varchar(32),
	"enterprise_id" uuid,
	"invite_code" varchar(32),
	"level" integer DEFAULT 1 NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "affinity_scores" ADD CONSTRAINT "affinity_scores_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affinity_scores" ADD CONSTRAINT "affinity_scores_decision_maker_id_decision_makers_id_fk" FOREIGN KEY ("decision_maker_id") REFERENCES "public"."decision_makers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_decision_maker_id_decision_makers_id_fk" FOREIGN KEY ("decision_maker_id") REFERENCES "public"."decision_makers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_runtime_states" ADD CONSTRAINT "game_runtime_states_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_scenario_id_project_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."project_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affinity_dm_idx" ON "affinity_scores" USING btree ("decision_maker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "affinity_session_idx" ON "affinity_scores" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "chat_dm_idx" ON "chat_messages" USING btree ("decision_maker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "chat_round_idx" ON "chat_messages" USING btree ("round" int4_ops);--> statement-breakpoint
CREATE INDEX "chat_session_idx" ON "chat_messages" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "decision_makers_difficulty_idx" ON "decision_makers" USING btree ("difficulty_min" int4_ops);--> statement-breakpoint
CREATE INDEX "decision_makers_faction_idx" ON "decision_makers" USING btree ("faction" text_ops);--> statement-breakpoint
CREATE INDEX "enterprises_admin_idx" ON "enterprises" USING btree ("admin_user_id" text_ops);--> statement-breakpoint
CREATE INDEX "game_events_session_idx" ON "game_events" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "game_events_npc_idx" ON "game_events" USING btree ("npc_key" text_ops);--> statement-breakpoint
CREATE INDEX "game_sessions_created_idx" ON "game_sessions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "game_sessions_scenario_idx" ON "game_sessions" USING btree ("scenario_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "game_sessions_status_idx" ON "game_sessions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "game_sessions_user_idx" ON "game_sessions" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "invite_codes_enterprise_idx" ON "invite_codes" USING btree ("enterprise_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "player_ability_user_idx" ON "player_ability" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "product_categories_parent_idx" ON "product_categories" USING btree ("parent_code" text_ops);--> statement-breakpoint
CREATE INDEX "product_knowledge_category_idx" ON "product_knowledge" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "product_knowledge_owner_idx" ON "product_knowledge" USING btree ("owner_id" text_ops);--> statement-breakpoint
CREATE INDEX "project_scenarios_difficulty_idx" ON "project_scenarios" USING btree ("difficulty" int4_ops);--> statement-breakpoint
CREATE INDEX "project_scenarios_industry_idx" ON "project_scenarios" USING btree ("industry" text_ops);--> statement-breakpoint
CREATE INDEX "scenario_templates_industry_idx" ON "scenario_templates" USING btree ("industry_code" text_ops);--> statement-breakpoint
CREATE INDEX "user_identities_phone_idx" ON "user_identities" USING btree ("phone" text_ops);--> statement-breakpoint
CREATE INDEX "user_identities_role_idx" ON "user_identities" USING btree ("role" text_ops);--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE POLICY "affinity_scores_allow_all" ON "affinity_scores" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "chat_messages_allow_all" ON "chat_messages" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "decision_makers_allow_all" ON "decision_makers" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "enterprises_allow_all" ON "enterprises" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "game_sessions_allow_all" ON "game_sessions" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "industries_allow_all" ON "industries" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "invite_codes_allow_all" ON "invite_codes" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "player_ability_allow_all" ON "player_ability" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "product_categories_allow_all" ON "product_categories" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "product_knowledge_allow_all" ON "product_knowledge" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "project_scenarios_allow_all" ON "project_scenarios" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "scenario_templates_allow_all" ON "scenario_templates" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_identities_allow_all" ON "user_identities" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);