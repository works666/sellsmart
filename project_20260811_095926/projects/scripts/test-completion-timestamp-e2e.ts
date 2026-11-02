import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { createGameSession, commitGameCommand } from '../src/lib/game/repository';
import { createAdminClient } from '../src/storage/database/supabase-client';

dotenv.config({ path: '.env.local', override: false, quiet: true });

async function main() {
  const userId = `u_completion_regression_${randomUUID()}`;
  const database = createAdminClient();
  let sessionId: string | undefined;
  try {
    const session = await createGameSession(userId, 'Completion regression', 'project-1');
    sessionId = session.id;
    const readTime = async () => {
      const { data, error } = await database.from('game_sessions').select('finished_at').eq('id', session.id).eq('user_id', userId).single();
      assert.equal(error, null);
      return data!.finished_at as string | null;
    };
    assert.equal(await readTime(), null);
    const finish = {
      sessionId: session.id, commandId: randomUUID(), commandType: 'regression.finish',
      expectedVersion: session.state.version, state: { ...session.state, status: 'won' as const }, eventType: 'regression.finished',
    };
    const completed = await commitGameCommand(finish);
    const firstTime = await readTime();
    assert.ok(firstTime, 'First completion must set a timestamp');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const notified = await commitGameCommand({ ...finish, commandId: randomUUID(), commandType: 'regression.notification', expectedVersion: completed.state.version, state: completed.state });
    assert.equal(await readTime(), firstTime, 'Notification after completion must preserve original timestamp');
    assert.equal(notified.state.version, completed.state.version + 1);
    assert.equal((await commitGameCommand(finish)).replayed, true);
    assert.equal(await readTime(), firstTime, 'Replay must preserve original timestamp');
    const conflictStartedAt = Date.now();
    const conflict = await database.rpc('commit_game_command', {
      p_session_id: session.id, p_command_id: randomUUID(), p_command_type: 'regression.conflict',
      p_expected_version: finish.expectedVersion, p_state: finish.state, p_total_score: 0, p_event_type: 'regression.conflict',
    });
    assert.equal(conflict.error?.message, 'STATE_VERSION_CONFLICT');
    assert.equal(conflict.error?.code, 'P0001', 'Business conflicts must not be serialization failures');
    assert.ok(Date.now() - conflictStartedAt < 15_000, 'A stale version must fail promptly, not retry to timeout');
    await assert.rejects(commitGameCommand({ ...finish, commandId: randomUUID() }), /STATE_VERSION_CONFLICT/);
    const legacyConflict = await database.rpc('commit_game_phase_transition', {
      p_session_id: session.id, p_expected_version: -1, p_state: finish.state, p_total_score: 0, p_event_type: 'regression.legacy-conflict',
    });
    assert.equal(legacyConflict.error?.message, 'STATE_VERSION_CONFLICT');
    assert.equal(legacyConflict.error?.code, 'P0001');
    const runtime = await database.from('game_runtime_states').select('version').eq('session_id', session.id).single();
    assert.equal(runtime.error, null);
    assert.equal(runtime.data?.version, notified.state.version, 'Rejected commands must not advance runtime');
    const records = await database.from('game_command_records').select('command_id', { count: 'exact', head: true }).eq('session_id', session.id);
    assert.equal(records.error, null);
    assert.equal(records.count, 2, 'Rejected inserts must roll back and replay must not add a command');
    assert.equal(await readTime(), firstTime, 'Rejected version must preserve original timestamp');
    console.log('Database completion timestamp, notification, replay and conflict regressions passed.');
  } finally {
    if (sessionId) {
      const { error } = await database.from('game_sessions').delete().eq('id', sessionId).eq('user_id', userId);
      assert.equal(error, null, 'Only this test session must be cleaned up');
    }
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'COMPLETION_TEST_FAILED'); process.exitCode = 1; });
