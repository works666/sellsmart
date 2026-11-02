ALTER TABLE "game_runtime_states"
  ADD COLUMN IF NOT EXISTS "phase_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "phase_ends_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "paused_remaining_ms" integer,
  ADD COLUMN IF NOT EXISTS "npc_contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "active_meeting" jsonb;

COMMENT ON COLUMN "game_runtime_states"."npc_contacts" IS 'Per-NPC known/connected/online communication state';
COMMENT ON COLUMN "game_runtime_states"."active_meeting" IS 'Current bounded offline meeting, if any';
