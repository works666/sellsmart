import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createAdminClient } from '../src/storage/database/supabase-client';

dotenv.config({ path: '.env.local', override: false, quiet: true });

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const username = `single_save_e2e_${Date.now()}`;
const databaseUserId = `u_${username}`;

async function request(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session': token } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, payload };
}

async function cleanup() {
  const { error } = await createAdminClient().from('game_sessions').delete().eq('user_id', databaseUserId);
  if (error) console.warn(`single-save cleanup failed: ${error.message}`);
}

async function main() {
  const authenticated = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username, password: 'e2e-test-password' }),
  });
  assert.equal(authenticated.response.status, 200);
  const loginToken = String(authenticated.payload.loginToken ?? '');
  assert(loginToken);

  const selected = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'select_role', loginToken, role: 'player', subRole: 'paid_individual' }),
  });
  assert.equal(selected.response.status, 200);
  const token = String(selected.payload.token ?? '');
  assert(token);

  const createBody = JSON.stringify({ scenarioCode: 'project-1', replaceExisting: false });
  const concurrent = await Promise.all([
    request('/api/game/sessions', { method: 'POST', body: createBody }, token),
    request('/api/game/sessions', { method: 'POST', body: createBody }, token),
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409], 'concurrent create must produce one save and one limit rejection');

  const firstList = await request('/api/game/sessions?scenarioCode=project-1', {}, token);
  assert.equal(firstList.response.status, 200);
  const firstSaves = firstList.payload.saves as Array<{ id: string }>;
  assert.equal(firstSaves.length, 1);
  const firstId = firstSaves[0].id;

  // A rejected create is the server equivalent of preserving the existing save
  // when the player has not confirmed replacement.
  const rejected = await request('/api/game/sessions', {
    method: 'POST',
    body: createBody,
  }, token);
  assert.equal(rejected.response.status, 409);
  const afterRejected = await request('/api/game/sessions?scenarioCode=project-1', {}, token);
  assert.equal((afterRejected.payload.saves as Array<{ id: string }>)[0].id, firstId);

  const replaced = await request('/api/game/sessions', {
    method: 'POST',
    body: JSON.stringify({ scenarioCode: 'project-1', replaceExisting: true }),
  }, token);
  assert.equal(replaced.response.status, 200);
  const replacementId = String((replaced.payload.gameSession as { id?: unknown })?.id ?? '');
  assert(replacementId && replacementId !== firstId);

  const finalList = await request('/api/game/sessions?scenarioCode=project-1', {}, token);
  const finalSaves = finalList.payload.saves as Array<{ id: string }>;
  assert.equal(finalSaves.length, 1);
  assert.equal(finalSaves[0].id, replacementId);

  const archivedRead = await request(`/api/game/sessions/${firstId}`, {}, token);
  assert.equal(archivedRead.response.status, 404, 'replaced save must not remain resumable by direct URL');

  const continued = await request(`/api/game/sessions/${replacementId}?entry=continue`, {}, token);
  assert.equal(continued.response.status, 200);

  const { data: rows, error: rowError } = await createAdminClient()
    .from('game_sessions')
    .select('id, status')
    .eq('user_id', databaseUserId);
  assert.equal(rowError, null);
  assert.equal(rows?.filter((row) => row.status === 'playing').length, 1);
  assert(rows?.some((row) => row.id === firstId && row.status === 'replaced'));

  const { data: replacementEvents, error: eventError } = await createAdminClient()
    .from('game_events')
    .select('event_type, payload')
    .eq('session_id', replacementId)
    .eq('event_type', 'session.replaced');
  assert.equal(eventError, null);
  assert.equal(replacementEvents?.length, 1);
  assert.equal((replacementEvents?.[0].payload as Record<string, unknown>).replacedExisting, true);

  const { data: continueEvents, error: continueEventError } = await createAdminClient()
    .from('game_events')
    .select('event_type, payload')
    .eq('session_id', replacementId)
    .eq('event_type', 'session.continued');
  assert.equal(continueEventError, null);
  assert.equal(continueEvents?.length, 1);
  assert.equal(typeof (continueEvents?.[0].payload as Record<string, unknown>).version, 'number');

  console.log('single-save concurrency and replacement e2e passed');
  await cleanup();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup();
  process.exitCode = 1;
});
