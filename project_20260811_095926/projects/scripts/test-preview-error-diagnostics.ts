import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { previewErrorResponse } from '../src/app/api/project-one-preview/ai/route';
import { previewErrorDiagnosticFields } from '../src/lib/game/preview-error-diagnostics';

type PreviewKind = 'protocol' | 'unavailable' | 'conflict' | 'not_found' | 'limit';

function previewError(kind: PreviewKind, message: string): Error & { kind: PreviewKind } {
  const error = new Error(message) as Error & { kind: PreviewKind };
  error.kind = kind;
  return error;
}

const context = {
  action: 'visit_turn',
  npcId: 'P1-001',
  commandId: '12345678-1234-4234-8234-123456789abc',
};

const protocolError = previewError('protocol', 'AI_PROTOCOL_INVALID: prompt content and token=should-not-leak');
assert.deepEqual(previewErrorResponse(protocolError), {
  status: 502,
  message: 'AI 返回结果不符合预览协议，请重试。',
});
assert.deepEqual(previewErrorDiagnosticFields(protocolError, context), {
  code: 'AI_PROTOCOL_INVALID',
  kind: 'protocol',
  ...context,
});

const providerError = previewError('unavailable', 'AI_PROVIDER_NETWORK_ERROR');
assert.equal(previewErrorResponse(providerError)?.status, 503);
assert.equal(previewErrorDiagnosticFields(providerError, context).code, 'AI_PROVIDER_NETWORK_ERROR');
assert.equal(previewErrorResponse(previewError('unavailable', 'AI_API_KEY_NOT_SET'))?.status, 503);
assert.equal(previewErrorDiagnosticFields(previewError('unavailable', 'AI_API_KEY_NOT_SET')).code, 'AI_API_KEY_NOT_SET');

const persistenceError = previewError('unavailable', 'PREVIEW_PERSISTENCE_UNAVAILABLE');
assert.equal(previewErrorResponse(persistenceError)?.status, 503);
assert.equal(previewErrorDiagnosticFields(persistenceError).code, 'PREVIEW_PERSISTENCE_UNAVAILABLE');

const genericProtocolError = previewError('protocol', 'internal prompt or user data');
assert.equal(previewErrorResponse(genericProtocolError)?.status, 502);
assert.equal(previewErrorDiagnosticFields(genericProtocolError).code, 'PREVIEW_PROTOCOL_ERROR');

const unexpectedError = new Error('secret prompt, API key, and customer content');
assert.equal(previewErrorResponse(unexpectedError), null);
const unexpectedFields = previewErrorDiagnosticFields(unexpectedError, context);
assert.deepEqual(unexpectedFields, { code: 'PREVIEW_UNEXPECTED_ERROR', ...context });
assert.doesNotMatch(JSON.stringify(unexpectedFields), /secret|prompt|API key|customer content/i);

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const apiErrorFunction = html.match(/function apiErrorMessage\(status,message\)\{([\s\S]*?)\n\}/);
assert.ok(apiErrorFunction, 'the preview page should define apiErrorMessage');
const apiErrorMessage = new Function('status', 'message', apiErrorFunction[1]) as (status: number, message?: string) => string;
assert.equal(apiErrorMessage(401), '登录会话已失效，请重新登录后再试。');
assert.equal(apiErrorMessage(502, 'AI 返回结果不符合预览协议，请重试。'), 'AI 返回结果不符合预览协议，请重试。');
assert.equal(apiErrorMessage(503, 'internal provider detail'), 'AI 服务暂时不可用，请稍后重试。');
assert.equal(apiErrorMessage(400, '参数无效'), '参数无效');

console.log('Preview error diagnostics and UI mapping passed.');
