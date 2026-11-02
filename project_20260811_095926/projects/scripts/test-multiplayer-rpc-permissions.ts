import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static source check only. The deployed ACLs must also be verified with
// has_function_privilege against the target database after applying the repair.
const migration = readFileSync(
  new URL('../supabase/migrations/20261012000100_fix_multiplayer_timer_lifecycle.sql', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ').toLowerCase();

const serverOnlyFunctions = [
  ['start_multiplayer_room', 'uuid, integer'],
  ['end_multiplayer_room', 'uuid, integer'],
  ['advance_multiplayer_stage', 'uuid, integer'],
  ['mark_multiplayer_ready', 'uuid, text, integer, integer'],
  ['force_multiplayer_ready', 'uuid, uuid, integer, integer'],
  ['commit_game_command', 'uuid, text, text, integer, jsonb, integer, text, jsonb, jsonb, jsonb'],
  ['commit_game_phase_transition', 'uuid, integer, jsonb, integer, text, jsonb'],
  ['create_or_replace_game_session', 'text, text, uuid, integer, jsonb, integer, boolean'],
  ['join_multiplayer_company', 'text, text, text, text, jsonb'],
  ['create_multiplayer_room', 'text, text, integer, jsonb'],
  ['remove_multiplayer_player', 'uuid, uuid, integer'],
] as const;

for (const [functionName, signature] of serverOnlyFunctions) {
  const identity = `public.${functionName}(${signature})`;
  assert.ok(
    migration.includes(`revoke all on function ${identity} from public, anon, authenticated;`),
    `${identity} must revoke PUBLIC, anon, and authenticated`,
  );
  assert.ok(
    migration.includes(`grant execute on function ${identity} to service_role;`),
    `${identity} must remain executable by service_role`,
  );
}

console.log(`multiplayer RPC permission migration checks passed: ${serverOnlyFunctions.length} functions`);
