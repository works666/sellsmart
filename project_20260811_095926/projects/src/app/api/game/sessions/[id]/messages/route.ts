import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { getNpcConversation, getOwnedGameSession, toPlayerVisibleChatMessages } from '@/lib/game/repository';
import { getProjectOneNpc } from '@/lib/game/project-one';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = authGuard(request);
  if (!guard.ok || !guard.session) return guard.response!;
  const { id } = await context.params;
  const npcId = new URL(request.url).searchParams.get('npcId');
  if (!npcId || !getProjectOneNpc(npcId)) {
    return NextResponse.json({ error: 'NPC参数无效' }, { status: 400 });
  }

  try {
    await getOwnedGameSession(id, guard.session.userId);
    const messages = await getNpcConversation(id, npcId, 100);
    return NextResponse.json({ success: true, messages: toPlayerVisibleChatMessages(messages) });
  } catch {
    return NextResponse.json({ error: '对话历史读取失败' }, { status: 404 });
  }
}
