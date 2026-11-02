import assert from 'node:assert/strict';
import { streamPreviewResponse } from '../src/app/api/project-one-preview/ai/route';
import type { PreviewAiResponse } from '../src/lib/contracts/project-one-preview-ai';

const reply: PreviewAiResponse = {
  previewSessionId: 'x'.repeat(20),
  version: 1,
  action: 'phone_connect',
  content: '这是一段保留逐字播放效果的电话回复。'.repeat(8),
  npcTestStates: [],
};

async function main() {
  const response = streamPreviewResponse(async () => reply);
  const payload = await response.text();
  const events = payload.trim().split(/\n\n+/).map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);

  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(events[0].type, 'status');
  assert.equal(events.at(-2)?.type, 'result');
  assert.equal(events.at(-1)?.type, 'done');
  const deltas = events.filter((event) => event.type === 'delta');
  assert.ok(deltas.length > 1, 'preview reply remains split into visible typing chunks');
  assert.equal(deltas.map((event) => event.content).join(''), reply.content);
  assert.deepEqual(events.at(-2)?.data, reply, 'the result remains the same committed response returned by execution');
  console.log('Preview stream protocol and typing effect tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
