import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createSession, signSession } from '../src/lib/auth/identity';
import { authGuard } from '../src/lib/auth/guard';
import {
  createCallHistoryGet,
  type StoredCallHistoryEvent,
} from '../src/app/api/game/sessions/[id]/call-history/handler';

process.env.SESSION_SECRET = 'call-history-api-regression-secret';

const userId = 'call-history-player';
const playerToken = signSession(createSession(userId, 'player'));
const events: StoredCallHistoryEvent[] = [
  {
    id: 'call-connected', npcId: 'P1-001', round: 2, eventType: 'npc.call.connected',
    payload: { npcId: 'P1-001', channel: 'work_phone', commandId: 'private-command', secret: 'private text' },
    createdAt: '2026-09-20T10:02:00.000Z',
  },
  {
    id: 'call-unanswered', npcId: 'P1-001', round: 1, eventType: 'npc.call.unanswered',
    payload: { npcId: 'P1-001', channel: 'work_phone', callChance: 88 },
    createdAt: '2026-09-20T10:01:00.000Z',
  },
  {
    id: 'legacy-phone', npcId: 'P1-001', round: 2, eventType: 'contact.completed',
    payload: { npcId: 'P1-001', channel: 'work_phone', outcome: 'call_later', transcript: 'must never leave the server' },
    createdAt: '2026-09-20T10:03:00.000Z',
  },
  {
    id: 'email-contact', npcId: 'P1-001', round: 3, eventType: 'contact.completed',
    payload: { npcId: 'P1-001', channel: 'email', outcome: 'connected' },
    createdAt: '2026-09-20T10:04:00.000Z',
  },
  {
    id: 'other-npc', npcId: 'P1-002', round: 3, eventType: 'npc.call.connected',
    payload: { npcId: 'P1-002', channel: 'work_phone' },
    createdAt: '2026-09-20T10:05:00.000Z',
  },
  {
    id: 'invalid-outcome', npcId: 'P1-001', round: 3, eventType: 'contact.completed',
    payload: { npcId: 'P1-001', channel: 'work_phone', outcome: 'secret' },
    createdAt: '2026-09-20T10:06:00.000Z',
  },
];

function request(sessionId = 'owned-session', token?: string, npcId: string | null = 'P1-001') {
  const url = new URL(`http://localhost/api/game/sessions/${sessionId}/call-history`);
  if (npcId !== null) url.searchParams.set('npcId', npcId);
  return new NextRequest(url, { headers: token ? { 'x-session': token } : {} });
}

async function main() {
  let eventReadCount = 0;
  const get = createCallHistoryGet({
    authorize: authGuard,
    assertSessionOwnership: async (sessionId, requestedUserId) => {
      assert.equal(requestedUserId, userId);
      if (sessionId !== 'owned-session') throw new Error('SESSION_NOT_FOUND');
    },
    readEvents: async (sessionId, npcId) => {
      eventReadCount += 1;
      assert.equal(sessionId, 'owned-session');
      assert.equal(npcId, 'P1-001');
      return events;
    },
  });

  assert.equal((await get(request(), { params: Promise.resolve({ id: 'owned-session' }) })).status, 401, 'unauthenticated requests are rejected');

  const invalidNpcResponse = await get(request('owned-session', playerToken, 'not-an-npc'), { params: Promise.resolve({ id: 'owned-session' }) });
  assert.equal(invalidNpcResponse.status, 400, 'unknown NPC ids are rejected');
  assert.equal(eventReadCount, 0, 'invalid NPC ids do not read events');

  const missingNpcResponse = await get(request('owned-session', playerToken, null), { params: Promise.resolve({ id: 'owned-session' }) });
  assert.equal(missingNpcResponse.status, 400, 'missing NPC ids are rejected');

  const forbiddenSessionResponse = await get(request('other-session', playerToken), { params: Promise.resolve({ id: 'other-session' }) });
  assert.equal(forbiddenSessionResponse.status, 404, 'other users’ sessions are not disclosed');
  assert.equal(eventReadCount, 0, 'events are not loaded before session ownership is confirmed');

  const response = await get(request('owned-session', playerToken), { params: Promise.resolve({ id: 'owned-session' }) });
  assert.equal(response.status, 200);
  const responseBody = await response.text();
  assert.deepEqual(JSON.parse(responseBody), {
    success: true,
    calls: [
      { id: 'call-unanswered', npcId: 'P1-001', outcome: 'unanswered', round: 1, createdAt: '2026-09-20T10:01:00.000Z' },
      { id: 'call-connected', npcId: 'P1-001', outcome: 'connected', round: 2, createdAt: '2026-09-20T10:02:00.000Z' },
      { id: 'legacy-phone', npcId: 'P1-001', outcome: 'call_later', round: 2, createdAt: '2026-09-20T10:03:00.000Z' },
    ],
  }, 'response includes metadata for work phone calls only and excludes all event payload fields');

  const unavailable = createCallHistoryGet({
    authorize: authGuard,
    assertSessionOwnership: async () => undefined,
    readEvents: async () => { throw new Error('database unavailable'); },
  });
  const unavailableResponse = await unavailable(request('owned-session', playerToken), { params: Promise.resolve({ id: 'owned-session' }) });
  assert.equal(unavailableResponse.status, 503, 'event storage failures are surfaced as unavailable');

  const ownershipFailure = createCallHistoryGet({
    authorize: authGuard,
    assertSessionOwnership: async () => { throw new Error('SESSION_NOT_FOUND'); },
    readEvents: async () => { throw new Error('must not be reached'); },
  });
  assert.equal((await ownershipFailure(request('owned-session', playerToken), { params: Promise.resolve({ id: 'owned-session' }) })).status, 404);

  assert.doesNotMatch(responseBody, /private-command|private text|transcript|callChance|secret/);
  console.log('call history API auth, ownership, work-phone filtering and metadata-only response checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
