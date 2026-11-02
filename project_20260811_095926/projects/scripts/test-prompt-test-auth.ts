import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createSession, getSession, hasPermission, signLoginProof, signSession, type Role } from '../src/lib/auth/identity';
import { POST } from '../src/app/api/designer/prompt-test/route';

async function main() {
  process.env.SESSION_SECRET = 'local-auth-regression-secret';
  const request = (token?: string) => new NextRequest('http://localhost/api/designer/prompt-test', {
    method: 'POST', headers: token ? { 'x-session': token } : {}, body: '{}',
  });
  assert.equal((await POST(request())).status, 401);
  const proof = signLoginProof('auth-regression-user');
  assert.equal(getSession(proof), null, 'Login proof must not grant session access');
  assert.equal((await POST(request(proof))).status, 401);
  for (const role of ['player', 'trainer', 'enterprise_admin'] as Role[]) {
    const session = createSession(`auth-${role}`, role);
    session.permissions.push('工作流编辑');
    assert.equal(hasPermission(session, '工作流编辑'), false, 'Permissions must follow configured role');
    assert.equal((await POST(request(signSession(session)))).status, 403);
  }
  const designer = signSession(createSession('auth-designer', 'platform_designer'));
  assert.equal((await POST(request(designer))).status, 400, 'Designer reaches request validation');
  for (let index = 0; index < 28; index += 1) await POST(request(designer));
  assert.equal((await POST(request(designer))).status, 400);
  assert.equal((await POST(request(designer))).status, 429, 'Designer requests remain rate limited');
  console.log('Prompt test authentication, role authorization and rate limit regressions passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
