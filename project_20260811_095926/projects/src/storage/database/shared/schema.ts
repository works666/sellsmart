import { check, pgTable, serial, timestamp, index, unique, uniqueIndex, pgPolicy, uuid, varchar, integer, text, jsonb, foreignKey, boolean } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().primaryKey().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}).enableRLS();

export const decisionMakers = pgTable("decision_makers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 32 }).notNull(),
	name: varchar({ length: 64 }).notNull(),
	title: varchar({ length: 128 }).notNull(),
	faction: varchar({ length: 32 }).notNull(),
	factionLabel: varchar("faction_label", { length: 32 }).notNull(),
	weight: integer().default(10).notNull(),
	floor: integer().default(1).notNull(),
	room: varchar({ length: 32 }).notNull(),
	avatar: varchar({ length: 8 }).default('👤').notNull(),
	coreNeeds: text("core_needs").notNull(),
	painPoints: text("pain_points").notNull(),
	personalPreferences: text("personal_preferences").notNull(),
	bonusKeywords: jsonb("bonus_keywords").default([]).notNull(),
	tabooPhrases: jsonb("taboo_phrases").default([]).notNull(),
	difficultyMin: integer("difficulty_min").default(1).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("decision_makers_difficulty_idx").using("btree", table.difficultyMin.asc().nullsLast().op("int4_ops")),
	index("decision_makers_faction_idx").using("btree", table.faction.asc().nullsLast().op("text_ops")),
	unique("decision_makers_code_unique").on(table.code),
	pgPolicy("decision_makers_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const gameSessions = pgTable("game_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id", { length: 64 }).default('guest').notNull(),
	userName: varchar("user_name", { length: 64 }).default('销售新兵').notNull(),
	scenarioId: uuid("scenario_id").notNull(),
	productId: uuid("product_id"),
	difficulty: integer().default(1).notNull(),
	mode: varchar({ length: 32 }).default('ai_dialog').notNull(),
	multiplayer: boolean().default(false).notNull(),
	currentRound: integer("current_round").default(1).notNull(),
	maxRound: integer("max_round").default(10).notNull(),
	totalScore: integer("total_score").default(50).notNull(),
	winProbability: integer("win_probability").default(50).notNull(),
	status: varchar({ length: 32 }).default('playing').notNull(),
	won: boolean(),
	finalReport: jsonb("final_report"),
	personalityType: varchar("personality_type", { length: 64 }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("game_sessions_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("game_sessions_scenario_idx").using("btree", table.scenarioId.asc().nullsLast().op("uuid_ops")),
	index("game_sessions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("game_sessions_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	uniqueIndex("game_sessions_one_solo_playing_per_user_idx").on(table.userId).where(sql`${table.status} = 'playing' and ${table.multiplayer} = false`),
	foreignKey({
			columns: [table.scenarioId],
			foreignColumns: [projectScenarios.id],
			name: "game_sessions_scenario_id_project_scenarios_id_fk"
		}).onDelete("cascade"),
	pgPolicy("game_sessions_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const projectScenarios = pgTable("project_scenarios", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 32 }).notNull(),
	title: varchar({ length: 128 }).notNull(),
	industry: varchar({ length: 64 }).notNull(),
	projectType: varchar("project_type", { length: 64 }).notNull(),
	budgetWan: integer("budget_wan").notNull(),
	durationMonths: integer("duration_months").default(6).notNull(),
	technicalRisk: varchar("technical_risk", { length: 32 }).notNull(),
	competitorName: varchar("competitor_name", { length: 64 }).notNull(),
	competitorAdvantages: text("competitor_advantages").notNull(),
	decisionMakerIds: jsonb("decision_maker_ids").default([]).notNull(),
	difficulty: integer().default(1).notNull(),
	description: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("project_scenarios_difficulty_idx").using("btree", table.difficulty.asc().nullsLast().op("int4_ops")),
	index("project_scenarios_industry_idx").using("btree", table.industry.asc().nullsLast().op("text_ops")),
	unique("project_scenarios_code_unique").on(table.code),
	pgPolicy("project_scenarios_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const designerPromptConfigs = pgTable("designer_prompt_configs", {
	id: text().primaryKey().notNull(),
	config: jsonb().default({}).notNull(),
	revision: integer().default(0).notNull(),
	updatedBy: varchar("updated_by", { length: 64 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("designer_prompt_configs_revision_check", sql`${table.revision} >= 0`),
	pgPolicy("designer_prompt_configs_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const designerImageAssets = pgTable("designer_image_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	projectCode: varchar("project_code", { length: 32 }).default('project-one').notNull(),
	slotKey: varchar("slot_key", { length: 96 }).notNull(),
	category: varchar({ length: 32 }).notNull(),
	personId: varchar("person_id", { length: 16 }),
	storagePath: text("storage_path").notNull(),
	publicUrl: text("public_url").notNull(),
	originalFilename: varchar("original_filename", { length: 255 }).notNull(),
	mimeType: varchar("mime_type", { length: 64 }).notNull(),
	byteSize: integer("byte_size").notNull(),
	updatedBy: varchar("updated_by", { length: 64 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("designer_image_assets_project_slot_unique").on(table.projectCode, table.slotKey),
	index("designer_image_assets_project_category_idx").on(table.projectCode, table.category),
	check("designer_image_assets_byte_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 5242880`),
	check("designer_image_assets_category_check", sql`${table.category} in ('person_intro', 'person_expression', 'visit_scene')`),
	check("designer_image_assets_mime_type_check", sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
	pgPolicy("designer_image_assets_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const designerSceneAssets = pgTable("designer_scene_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	projectCode: varchar("project_code", { length: 32 }).default('project-one').notNull(),
	slotKey: varchar("slot_key", { length: 96 }).notNull(),
	sceneKey: varchar("scene_key", { length: 64 }).notNull(),
	name: varchar({ length: 128 }).notNull(),
	description: text().default('').notNull(),
	storagePath: text("storage_path").notNull(),
	publicUrl: text("public_url").notNull(),
	originalFilename: varchar("original_filename", { length: 255 }).notNull(),
	mimeType: varchar("mime_type", { length: 64 }).notNull(),
	byteSize: integer("byte_size").notNull(),
	updatedBy: varchar("updated_by", { length: 64 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("designer_scene_assets_project_slot_unique").on(table.projectCode, table.slotKey),
	unique("designer_scene_assets_project_key_unique").on(table.projectCode, table.sceneKey),
	index("designer_scene_assets_project_updated_idx").on(table.projectCode, table.updatedAt),
	check("designer_scene_assets_scene_key_check", sql`${table.sceneKey} ~ '^[a-z0-9][a-z0-9_-]*$'`),
	check("designer_scene_assets_slot_key_check", sql`${table.slotKey} = 'visit_scene:' || ${table.sceneKey}`),
	check("designer_scene_assets_mime_type_check", sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
	check("designer_scene_assets_byte_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 5242880`),
	pgPolicy("designer_scene_assets_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const affinityScores = pgTable("affinity_scores", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	decisionMakerId: uuid("decision_maker_id").notNull(),
	playerAffinity: integer("player_affinity").default(50).notNull(),
	competitorAffinity: integer("competitor_affinity").default(50).notNull(),
	lastChangeReason: text("last_change_reason"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("affinity_dm_idx").using("btree", table.decisionMakerId.asc().nullsLast().op("uuid_ops")),
	index("affinity_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [gameSessions.id],
			name: "affinity_scores_session_id_game_sessions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.decisionMakerId],
			foreignColumns: [decisionMakers.id],
			name: "affinity_scores_decision_maker_id_decision_makers_id_fk"
		}).onDelete("cascade"),
	pgPolicy("affinity_scores_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const productKnowledge = pgTable("product_knowledge", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: varchar("owner_id", { length: 64 }).default('guest').notNull(),
	productName: varchar("product_name", { length: 128 }).notNull(),
	category: varchar({ length: 64 }).default('通用').notNull(),
	technicalParams: jsonb("technical_params").default({}).notNull(),
	prohibitedDescriptions: jsonb("prohibited_descriptions").default([]).notNull(),
	keySellingPoints: jsonb("key_selling_points").default([]).notNull(),
	targetIndustries: jsonb("target_industries").default([]).notNull(),
	source: varchar({ length: 32 }).default('manual').notNull(),
	fileUrl: text("file_url"),
	rawContent: text("raw_content"),
	summary: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("product_knowledge_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("product_knowledge_owner_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops")),
	pgPolicy("product_knowledge_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const chatMessages = pgTable("chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	decisionMakerId: uuid("decision_maker_id"),
	round: integer().default(1).notNull(),
	sender: varchar({ length: 16 }).notNull(),
	content: text().notNull(),
	actionType: varchar("action_type", { length: 32 }),
	affinityDelta: integer("affinity_delta"),
	scoreDelta: integer("score_delta"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("chat_dm_idx").using("btree", table.decisionMakerId.asc().nullsLast().op("uuid_ops")),
	index("chat_round_idx").using("btree", table.round.asc().nullsLast().op("int4_ops")),
	index("chat_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [gameSessions.id],
			name: "chat_messages_session_id_game_sessions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.decisionMakerId],
			foreignColumns: [decisionMakers.id],
			name: "chat_messages_decision_maker_id_decision_makers_id_fk"
		}).onDelete("set null"),
	pgPolicy("chat_messages_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const gameRuntimeStates = pgTable("game_runtime_states", {
	sessionId: uuid("session_id").primaryKey().notNull(),
	scenarioCode: varchar("scenario_code", { length: 32 }).notNull(),
	actionPoints: integer("action_points").default(28).notNull(),
	dimensions: jsonb().default({}).notNull(),
	npcAffinity: jsonb("npc_affinity").default({}).notNull(),
	unlockedNpcIds: jsonb("unlocked_npc_ids").default([]).notNull(),
	unlockedClues: jsonb("unlocked_clues").default([]).notNull(),
	conversationMemories: jsonb("conversation_memories").default({}).notNull(),
	phaseStartedAt: timestamp("phase_started_at", { withTimezone: true, mode: 'string' }),
	phaseEndsAt: timestamp("phase_ends_at", { withTimezone: true, mode: 'string' }),
	pausedAt: timestamp("paused_at", { withTimezone: true, mode: 'string' }),
	pausedRemainingMs: integer("paused_remaining_ms"),
	npcContacts: jsonb("npc_contacts").default({}).notNull(),
	activeMeeting: jsonb("active_meeting"),
	simulationState: jsonb("simulation_state").default({}).notNull(),
	lastAction: varchar("last_action", { length: 64 }),
	version: integer().default(1).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.sessionId],
		foreignColumns: [gameSessions.id],
		name: "game_runtime_states_session_id_game_sessions_id_fk"
	}).onDelete("cascade"),
	pgPolicy("game_runtime_states_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const gameCommandRecords = pgTable("game_command_records", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	commandId: varchar("command_id", { length: 128 }).notNull(),
	commandType: varchar("command_type", { length: 64 }).notNull(),
	status: varchar({ length: 16 }).default('pending').notNull(),
	request: jsonb().default({}).notNull(),
	response: jsonb(),
	errorCode: varchar("error_code", { length: 64 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("game_command_records_session_command_unique").on(table.sessionId, table.commandId),
	index("game_command_records_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.sessionId],
		foreignColumns: [gameSessions.id],
		name: "game_command_records_session_id_game_sessions_id_fk"
	}).onDelete("cascade"),
	pgPolicy("game_command_records_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const gameEvents = pgTable("game_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	npcKey: varchar("npc_key", { length: 128 }),
	round: integer().notNull(),
	eventType: varchar("event_type", { length: 64 }).notNull(),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("game_events_session_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")),
	index("game_events_npc_idx").using("btree", table.npcKey.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.sessionId],
		foreignColumns: [gameSessions.id],
		name: "game_events_session_id_game_sessions_id_fk"
	}).onDelete("cascade"),
	pgPolicy("game_events_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const playerAbility = pgTable("player_ability", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id", { length: 64 }).notNull(),
	sessionsPlayed: integer("sessions_played").default(0).notNull(),
	sessionsWon: integer("sessions_won").default(0).notNull(),
	winRate: integer("win_rate").default(0).notNull(),
	avgTotalScore: integer("avg_total_score").default(0).notNull(),
	bestScore: integer("best_score").default(0).notNull(),
	abilityPersonality: integer("ability_personality").default(0).notNull(),
	abilityResearch: integer("ability_research").default(0).notNull(),
	abilityLayered: integer("ability_layered").default(0).notNull(),
	abilityPitch: integer("ability_pitch").default(0).notNull(),
	abilityCompetitor: integer("ability_competitor").default(0).notNull(),
	abilityBidding: integer("ability_bidding").default(0).notNull(),
	abilityProduct: integer("ability_product").default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("player_ability_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	unique("player_ability_user_id_unique").on(table.userId),
	pgPolicy("player_ability_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// =====================================================
// 多身份权限系统 6 张表
// =====================================================

// 1) 行业分类表
export const industries = pgTable("industries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 32 }).notNull(),
	name: varchar({ length: 64 }).notNull(),
	icon: varchar({ length: 8 }).default('🏛️').notNull(),
	description: text(),
	subCategories: jsonb("sub_categories").default([]).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	unique("industries_code_unique").on(table.code),
	pgPolicy("industries_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// 2) 产品分类表
export const productCategories = pgTable("product_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 32 }).notNull(),
	name: varchar({ length: 64 }).notNull(),
	parentCode: varchar("parent_code", { length: 32 }),
	icon: varchar({ length: 8 }).default('📦').notNull(),
	description: text(),
	typicalScenarios: jsonb("typical_scenarios").default([]).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	unique("product_categories_code_unique").on(table.code),
	index("product_categories_parent_idx").using("btree", table.parentCode.asc().nullsLast().op("text_ops")),
	pgPolicy("product_categories_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// 3) 标准场景案例表
export const scenarioTemplates = pgTable("scenario_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 64 }).notNull(),
	title: varchar({ length: 128 }).notNull(),
	industryCode: varchar("industry_code", { length: 32 }).notNull(),
	productCategoryCode: varchar("product_category_code", { length: 32 }).notNull(),
	budgetWan: integer("budget_wan").notNull(),
	durationMonths: integer("duration_months").default(12).notNull(),
	technicalDifficulties: jsonb("technical_difficulties").default([]).notNull(),
	clientDemands: jsonb("client_demands").default([]).notNull(),
	decisionMakerProfile: jsonb("decision_maker_profile").notNull(),
	competitors: jsonb().default([]).notNull(),
	revision: integer().default(0).notNull(),
	updatedBy: varchar("updated_by", { length: 64 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	tags: jsonb().default([]).notNull(),
	difficulty: integer().default(3).notNull(),
	description: text(),
	isPreset: boolean("is_preset").default(true).notNull(),
	createdBy: varchar("created_by", { length: 64 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("scenario_templates_code_unique").on(table.code),
	index("scenario_templates_industry_idx").using("btree", table.industryCode.asc().nullsLast().op("text_ops")),
	check("scenario_templates_revision_check", sql`${table.revision} >= 0`),
	pgPolicy("scenario_templates_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// 4) 企业信息表
export const enterprises = pgTable("enterprises", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 64 }).notNull(),
	name: varchar({ length: 128 }).notNull(),
	shortName: varchar("short_name", { length: 64 }),
	industryCode: varchar("industry_code", { length: 32 }),
	scale: varchar({ length: 32 }),
	region: varchar({ length: 64 }),
	contactName: varchar("contact_name", { length: 64 }),
	contactPhone: varchar("contact_phone", { length: 32 }),
	adminUserId: varchar("admin_user_id", { length: 64 }),
	productScopes: jsonb("product_scopes").default([]).notNull(),
	licenseCount: integer("license_count").default(0).notNull(),
	expireAt: timestamp("expire_at", { withTimezone: true, mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("enterprises_code_unique").on(table.code),
	index("enterprises_admin_idx").using("btree", table.adminUserId.asc().nullsLast().op("text_ops")),
	pgPolicy("enterprises_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// 5) 邀请码记录表
export const inviteCodes = pgTable("invite_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: varchar({ length: 32 }).notNull(),
	enterpriseId: uuid("enterprise_id"),
	createdBy: varchar("created_by", { length: 64 }).notNull(),
	role: varchar({ length: 32 }).default('enterprise_employee').notNull(),
	maxUses: integer("max_uses").default(1).notNull(),
	usedCount: integer("used_count").default(0).notNull(),
	expireAt: timestamp("expire_at", { withTimezone: true, mode: 'string' }).notNull(),
	usedBy: jsonb("used_by").default([]).notNull(),
	productScopes: jsonb("product_scopes").default([]).notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("invite_codes_code_unique").on(table.code),
	index("invite_codes_enterprise_idx").using("btree", table.enterpriseId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.enterpriseId],
		foreignColumns: [enterprises.id],
		name: "invite_codes_enterprise_id_enterprises_id_fk"
	}).onDelete("cascade"),
	pgPolicy("invite_codes_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// 6) 用户身份表
export const userIdentities = pgTable("user_identities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id", { length: 64 }).notNull(),
	phone: varchar({ length: 32 }),
	email: varchar({ length: 128 }),
	displayName: varchar("display_name", { length: 64 }).notNull(),
	avatar: varchar({ length: 8 }).default('👤').notNull(),
	role: varchar({ length: 32 }).notNull(),
	subRole: varchar("sub_role", { length: 32 }),
	enterpriseId: uuid("enterprise_id"),
	inviteCode: varchar("invite_code", { length: 32 }),
	level: integer().default(1).notNull(),
	totalPoints: integer("total_points").default(0).notNull(),
	permissions: jsonb().default([]).notNull(),
	status: varchar({ length: 32 }).default('active').notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_identities_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	index("user_identities_role_idx").using("btree", table.role.asc().nullsLast().op("text_ops")),
	index("user_identities_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	unique("user_identities_user_id_unique").on(table.userId),
	foreignKey({
		columns: [table.enterpriseId],
		foreignColumns: [enterprises.id],
		name: "user_identities_enterprise_id_enterprises_id_fk"
	}).onDelete("set null"),
	pgPolicy("user_identities_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

// Multiplayer: one shared customer world with one player-owned runtime per company slot.
export const multiplayerRooms = pgTable("multiplayer_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomCode: varchar("room_code", { length: 12 }).notNull(),
	scenarioCode: varchar("scenario_code", { length: 32 }).default('project-1').notNull(),
	hostUserId: varchar("host_user_id", { length: 64 }).notNull(),
	status: varchar({ length: 24 }).default('waiting').notNull(),
	currentStage: integer("current_stage").default(1).notNull(),
	maxStages: integer("max_stages").default(5).notNull(),
	stageDurationSeconds: integer("stage_duration_seconds"),
	stageDeadlineAt: timestamp("stage_deadline_at", { withTimezone: true, mode: 'string' }),
	sharedCustomerState: jsonb("shared_customer_state").default({}).notNull(),
	stageVersion: integer("stage_version").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("multiplayer_rooms_code_unique").on(table.roomCode),
	index("multiplayer_rooms_host_idx").on(table.hostUserId),
	check("multiplayer_rooms_status_check", sql`${table.status} in ('waiting', 'running', 'finished', 'cancelled')`),
	check("multiplayer_rooms_stage_check", sql`${table.currentStage} between 1 and 5`),
	check("multiplayer_rooms_max_stages_check", sql`${table.maxStages} = 5`),
	check("multiplayer_rooms_duration_check", sql`${table.stageDurationSeconds} is null or ${table.stageDurationSeconds} >= 60`),
	check("multiplayer_rooms_version_check", sql`${table.stageVersion} >= 1`),
	pgPolicy("multiplayer_rooms_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const multiplayerCompanySlots = pgTable("multiplayer_company_slots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: uuid("room_id").notNull(),
	companyId: varchar("company_id", { length: 64 }).notNull(),
	companyName: varchar("company_name", { length: 128 }).notNull(),
	playerUserId: varchar("player_user_id", { length: 64 }),
	gameSessionId: uuid("game_session_id"),
	hiddenProgressScore: integer("hidden_progress_score").default(50).notNull(),
	readyStage: integer("ready_stage"),
	readyByAdmin: boolean("ready_by_admin").default(false).notNull(),
	connected: boolean().default(true).notNull(),
	initialPersonalInfo: jsonb("initial_personal_info").default({}).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("multiplayer_company_slots_room_company_unique").on(table.roomId, table.companyId),
	uniqueIndex("multiplayer_company_slots_room_player_unique").on(table.roomId, table.playerUserId).where(sql`${table.playerUserId} is not null`),
	check("multiplayer_company_slots_hidden_progress_check", sql`${table.hiddenProgressScore} between 0 and 100`),
	check("multiplayer_company_slots_ready_stage_check", sql`${table.readyStage} is null or ${table.readyStage} between 1 and 5`),
	foreignKey({ columns: [table.roomId], foreignColumns: [multiplayerRooms.id], name: "multiplayer_company_slots_room_fk" }).onDelete("cascade"),
	foreignKey({ columns: [table.gameSessionId], foreignColumns: [gameSessions.id], name: "multiplayer_company_slots_session_fk" }).onDelete("set null"),
	pgPolicy("multiplayer_company_slots_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);

export const competitorClaims = pgTable("competitor_claims", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: uuid("room_id"),
	sessionId: uuid("session_id").notNull(),
	companyId: varchar("company_id", { length: 64 }).notNull(),
	npcKey: varchar("npc_key", { length: 128 }).notNull(),
	stage: integer().notNull(),
	statement: text().notNull(),
	truthStatus: varchar("truth_status", { length: 24 }).default('unverified').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("competitor_claims_session_idx").on(table.sessionId),
	check("competitor_claims_stage_check", sql`${table.stage} between 1 and 5`),
	check("competitor_claims_truth_status_check", sql`${table.truthStatus} in ('unverified', 'corroborated', 'contradicted', 'false')`),
	foreignKey({ columns: [table.roomId], foreignColumns: [multiplayerRooms.id], name: "competitor_claims_room_fk" }).onDelete("cascade"),
	foreignKey({ columns: [table.sessionId], foreignColumns: [gameSessions.id], name: "competitor_claims_session_fk" }).onDelete("cascade"),
	pgPolicy("competitor_claims_service_role_only", { as: "restrictive", for: "all", to: ["service_role"], using: sql`true`, withCheck: sql`true` }),
]);
