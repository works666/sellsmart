import assert from 'node:assert/strict';
import { previewErrorResponse } from '../src/app/api/project-one-preview/ai/route';
import { toPreviewPersistenceError } from '../src/lib/game/project-one-preview-session-repository';

function postgrestError(message: string, code = 'P0001', details = '') {
  // Supabase's normal (non-throwOnError) RPC result uses this plain-object
  // shape, with SQL RAISE EXCEPTION text in `message`.
  return { code, message, details, hint: '' };
}

const missingSession = toPreviewPersistenceError(postgrestError('PREVIEW_SESSION_NOT_FOUND'));
assert.equal(missingSession.kind, 'not_found', 'a missing or foreign-owned session maps to not_found');
assert.deepEqual(previewErrorResponse(missingSession), {
  status: 404,
  message: '预览会话不存在或已过期，请重新开始。',
}, 'session absence is presented identically without revealing its owner');

const mismatchedReplay = toPreviewPersistenceError(postgrestError('PREVIEW_COMMAND_SESSION_MISMATCH'));
assert.equal(mismatchedReplay.kind, 'not_found', 'a command replay tied to another session also hides ownership');
assert.equal(previewErrorResponse(mismatchedReplay)?.status, 404);

const databaseFailure = toPreviewPersistenceError(postgrestError(
  'connection failure',
  '08006',
  'PREVIEW_SESSION_NOT_FOUND must not be inferred from untrusted details',
));
assert.equal(databaseFailure.kind, 'unavailable', 'ordinary database failures remain unavailable');
assert.equal(previewErrorResponse(databaseFailure)?.status, 503);
assert.equal(
  previewErrorResponse(databaseFailure)?.message,
  'AI 服务暂时不可用，请稍后重试。',
  'database error details are not exposed in the API response',
);

const unrelatedMessage = toPreviewPersistenceError(postgrestError('database log mentioned PREVIEW_SESSION_NOT_FOUND'));
assert.equal(unrelatedMessage.kind, 'unavailable', 'only the exact SQL exception token is treated as a missing session');

console.log('Preview session error mapping passed.');
