import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/project-one-preview/ai/route';
import { getPreviewRecoveryResponse } from '../src/app/api/project-one-preview/ai/handler';
import { createSession, signSession } from '../src/lib/auth/identity';
import { createPreviewServerState, PreviewAiError } from '../src/lib/game/project-one-preview-ai';

const playerToken = signSession(createSession('preview-metric-player', 'player'));
const headers = { 'x-session': playerToken };
const previewSessionId = '00000000-0000-4000-8000-000000000001';

function request(url: string, token: string) {
  return new NextRequest(url, { headers: { 'x-session': token } });
}

async function main() {
  const postResponse = await POST(new Request('http://localhost/api/project-one-preview/ai', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }) as never);
  assert.equal(postResponse.status, 403, 'the designer preview API rejects player requests before parsing or executing a command');
  assert.deepEqual(await postResponse.json(), { error: '权限不足' });

  const getResponse = await getPreviewRecoveryResponse(request(`http://localhost/api/project-one-preview/ai?previewSessionId=${previewSessionId}`, playerToken), { load: async () => { throw new Error('player must be rejected before repository access'); } });
  assert.equal(getResponse.status, 403, 'a player cannot recover designer relationship metrics by guessing a preview session ID');
  assert.deepEqual(await getResponse.json(), { error: '权限不足' });

  const ownerId = 'preview-metric-designer';
  const ownerToken = signSession(createSession(ownerId, 'platform_designer'));
  const ownerState = createPreviewServerState(ownerId, previewSessionId);
  ownerState.npcStates['P1-001'].support = 42;
  ownerState.npcStates['P1-001'].pleasantness = 68;
  ownerState.npcStates['P1-001'].effectiveContactCount = 3;
  const repository = {
    async load(userId: string, sessionId: string) {
      if (userId !== ownerId || sessionId !== previewSessionId) throw new PreviewAiError('not_found', 'PREVIEW_SESSION_NOT_FOUND');
      return ownerState;
    },
  };
  const ownerResponse = await getPreviewRecoveryResponse(request(`http://localhost/api/project-one-preview/ai?previewSessionId=${previewSessionId}`, ownerToken), repository);
  assert.equal(ownerResponse.status, 200, 'a designer can recover their own preview snapshot');
  const ownerBody = await ownerResponse.json() as { data: { npcTestStates: Array<{ npcId: string; support: number; pleasantness: number; effectiveContactCount: number }> } };
  assert.deepEqual(ownerBody.data.npcTestStates.find((item) => item.npcId === 'P1-001'), {
    npcId: 'P1-001', support: 42, pleasantness: 68, effectiveContactCount: 3, node: 'N1',
  }, 'designer recovery exposes the committed support and pleasantness snapshot only through the preview route');

  const otherDesignerToken = signSession(createSession('preview-metric-other-designer', 'platform_designer'));
  const foreignResponse = await getPreviewRecoveryResponse(request(`http://localhost/api/project-one-preview/ai?previewSessionId=${previewSessionId}`, otherDesignerToken), repository);
  assert.equal(foreignResponse.status, 404, 'a foreign designer receives the same not-found response as an absent preview session');
  console.log('Preview designer authorization tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
