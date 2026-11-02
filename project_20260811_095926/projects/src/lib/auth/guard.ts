// 身份权限判断工作流（用于 API 守卫）
import { NextRequest, NextResponse } from 'next/server';
import { getSession, hasPermission, type Session } from '@/lib/auth/identity';

export const runtime = 'nodejs';

export interface AuthGuardResult {
  ok: boolean;
  session: Session | null;
  response?: NextResponse;
}

export function authGuard(request: NextRequest, requiredPermission?: string): AuthGuardResult {
  const token = request.headers.get('x-session') ?? undefined;
  const session = getSession(token);

  if (!session) {
    return {
      ok: false,
      session: null,
      response: NextResponse.json({ error: '未登录' }, { status: 401 }),
    };
  }

  if (requiredPermission && !hasPermission(session, requiredPermission)) {
    return {
      ok: false,
      session,
      response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
    };
  }

  return { ok: true, session };
}
