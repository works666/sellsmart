ALTER TABLE "game_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "game_runtime_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "game_events_service_role_only" ON "game_events" AS RESTRICTIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "game_runtime_states_service_role_only" ON "game_runtime_states" AS RESTRICTIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);