import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const repo = 'D:/WeiXun/project_20260811_095926';
const db = new PGlite();
const output = `${repo}/harness/evidence/customer-activities-2026-10-20`;
await mkdir(output, { recursive: true });
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE multiplayer_rooms(id uuid PRIMARY KEY, status text, stage_version integer, stage_duration_seconds integer, stage_deadline_at timestamptz, updated_at timestamptz);
    CREATE TABLE multiplayer_company_slots(id uuid PRIMARY KEY, room_id uuid, game_session_id uuid, ready_stage integer, ready_by_admin boolean, updated_at timestamptz);
    CREATE TABLE game_sessions(id uuid PRIMARY KEY, multiplayer boolean, status text, won boolean, finished_at timestamptz);
    CREATE TABLE game_runtime_states(session_id uuid PRIMARY KEY, simulation_state jsonb, action_points integer, active_meeting jsonb, last_action text, phase_started_at timestamptz, phase_ends_at timestamptz, paused_at timestamptz, paused_remaining_ms bigint, version integer, updated_at timestamptz);
  `);
  await db.exec(await readFile(`${repo}/projects/supabase/migrations/20261020000100_pause_multiplayer_timer_for_customer_activity.sql`, 'utf8'));
  const results = [];
  const roomId = '10000000-0000-4000-8000-000000000001';
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const slotId = '30000000-0000-4000-8000-000000000001';
  for (const name of ['planning_before_deadline', 'planning_after_deadline', 'ordinary_visit', 'ordinary_clock']) {
    await db.exec('BEGIN; TRUNCATE multiplayer_rooms, multiplayer_company_slots, game_sessions, game_runtime_states;');
    const now = Number((await db.query('SELECT FLOOR(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS ms')).rows[0].ms);
    const task = { id: 'task-1', status: 'planning', startedAt: now - 60000, deadlineAt: now + 240000, draft: 'server-saved draft' };
    if (name === 'planning_after_deadline') { task.startedAt = now - 320000; task.deadlineAt = now - 20000; }
    const state = {
      status: 'playing', actionPoints: 20, version: 1,
      projectTimer: { durationMs: 1200000, elapsedMs: 120000, recoveredIntervals: 0, lastResumedAt: null, visitPaused: true },
      customerActivities: { version: 1, tasks: name.startsWith('planning_') ? [task] : [], decisions: [] },
      activeMeeting: name === 'ordinary_visit' ? { turnCount: 4 } : null,
    };
    if (name === 'ordinary_clock') {
      state.projectTimer.lastResumedAt = new Date(now - 20000).toISOString();
      state.projectTimer.visitPaused = false;
    }
    await db.query('INSERT INTO multiplayer_rooms VALUES ($1, $2, 1, 1200, now(), now() - interval \'2 minutes\')', [roomId, 'running']);
    await db.query('INSERT INTO multiplayer_company_slots VALUES ($1, $2, $3, NULL, false, now())', [slotId, roomId, sessionId]);
    await db.query('INSERT INTO game_sessions VALUES ($1, true, $2, NULL, NULL)', [sessionId, 'playing']);
    await db.query('INSERT INTO game_runtime_states(session_id, simulation_state, action_points, active_meeting, version, updated_at) VALUES ($1, $2::jsonb, 20, $3::jsonb, 1, now())', [sessionId, JSON.stringify(state), JSON.stringify(state.activeMeeting)]);
    await db.query('SELECT public.end_multiplayer_room($1, 1)', [roomId]);
    const updated = (await db.query('SELECT simulation_state, action_points, version FROM game_runtime_states WHERE session_id = $1', [sessionId])).rows[0];
    const actual = updated.simulation_state;
    assert.equal(actual.status, 'lost');
    assert.equal(actual.actionPoints, 20, `${name}: no free action-point regeneration during activity planning`);
    assert.equal(updated.version, 2);
    const expectedElapsed = name === 'planning_before_deadline' ? 120000 : name === 'ordinary_visit' ? 180000 : 140000;
    assert.ok(Math.abs(actual.projectTimer.elapsedMs - expectedElapsed) <= 1, `${name}: expected ${expectedElapsed}, got ${actual.projectTimer.elapsedMs}`);
    if (name.startsWith('planning_')) {
      const submitted = actual.customerActivities.tasks[0];
      assert.equal(submitted.status, 'submitted');
      assert.equal(submitted.draft, 'server-saved draft');
      assert.equal(submitted.submitReason, name === 'planning_before_deadline' ? 'room_ended' : 'timeout');
      assert.equal(submitted.submittedAt, name === 'planning_before_deadline' ? now : task.deadlineAt);
    }
    const replay = (await db.query('SELECT (public.end_multiplayer_room($1, 1)).stage_version AS stage_version', [roomId])).rows[0];
    assert.equal(replay.stage_version, 2, 'room end replay is idempotent');
    results.push({ name, passed: true, elapsedMs: actual.projectTimer.elapsedMs, actionPoints: actual.actionPoints });
    await db.exec('COMMIT;');
  }
  const permissions = (await db.query("SELECT has_function_privilege('authenticated', 'public.end_multiplayer_room(uuid,integer)', 'EXECUTE') AS authenticated, has_function_privilege('service_role', 'public.end_multiplayer_room(uuid,integer)', 'EXECUTE') AS service_role")).rows[0];
  assert.equal(permissions.authenticated, false);
  assert.equal(permissions.service_role, true);
  await writeFile(`${output}/sql-results.json`, JSON.stringify({ passed: true, engine: 'isolated PGlite PostgreSQL', productionDatabaseTouched: false, minimalFixtureSchema: true, results, permissions }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, permissions }));
} finally { await db.close(); }
