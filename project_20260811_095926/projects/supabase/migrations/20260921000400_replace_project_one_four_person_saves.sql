-- D-047 formal cutover: the old four-person project-one saves have no valid
-- semantic mapping to the formal five-person roster.  The user explicitly
-- approved deleting them rather than manufacturing a person-ID mapping.
--
-- Scope is deliberately narrow.  A row is deleted only when its persisted
-- state proves it belongs to the deleted four-person roster; this protects a
-- five-person session created between deployment and migration application.
-- Preview sessions, prompt-test sessions, designer assets/configuration and
-- every non-project-1 scenario are left untouched.  Delete rooms first
-- because a room's slot -> game_session FK is SET NULL, whereas its own
-- children cascade with the room.

DELETE FROM public.multiplayer_rooms AS room
WHERE room.scenario_code = 'project-1'
  AND EXISTS (
    SELECT 1
    FROM public.multiplayer_company_slots AS slot
    LEFT JOIN public.game_runtime_states AS runtime
      ON runtime.session_id = slot.game_session_id
    WHERE slot.room_id = room.id
      AND (
        slot.initial_personal_info::text ~ '(p1-frontline-wang-hao|p1-procurement-liu-kai|p1-minister-chen-jianguo|p1-deputy-zhao-feng)'
        OR runtime.npc_affinity::text ~ '(p1-frontline-wang-hao|p1-procurement-liu-kai|p1-minister-chen-jianguo|p1-deputy-zhao-feng)'
      )
  );

-- game_sessions owns chat_messages, affinity_scores, game_events,
-- game_runtime_states, simulation_visits and competitor_claims through
-- ON DELETE CASCADE.  This deletes only proven old formal project-one
-- sessions; it does not touch the independent project_one_preview_sessions
-- table.
DELETE FROM public.game_sessions AS session
USING public.project_scenarios AS scenario
WHERE session.scenario_id = scenario.id
  AND scenario.code = 'project-1'
  AND EXISTS (
    SELECT 1
    FROM public.game_runtime_states AS runtime
    WHERE runtime.session_id = session.id
      AND runtime.npc_affinity::text ~ '(p1-frontline-wang-hao|p1-procurement-liu-kai|p1-minister-chen-jianguo|p1-deputy-zhao-feng)'
  );
