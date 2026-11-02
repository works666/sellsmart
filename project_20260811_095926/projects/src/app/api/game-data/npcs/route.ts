import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { PROJECT_ONE_NPCS } from '@/lib/game/project-one';
import { getOwnedGameSession } from '@/lib/game/repository';

// GET /api/game-data/npcs?project_id=1 - 获取项目一人物表（可用游戏依赖，保留真实内容）
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');

  if (projectId === '1') {
    const gameSessionId = searchParams.get('game_session_id');
    let npcAffinity: Record<string, number> = {};
    let personalInterestUnlocked = false;

    if (gameSessionId) {
      const guard = authGuard(request);
      if (!guard.ok || !guard.session) return guard.response!;
      try {
        const gameSession = await getOwnedGameSession(gameSessionId, guard.session.userId);
        npcAffinity = gameSession.state.npcAffinity;
        personalInterestUnlocked = gameSession.state.unlockedClues.includes('personal_interest');
      } catch {
        return NextResponse.json({ error: '对局不存在或无权访问' }, { status: 404 });
      }
    }

    const data = PROJECT_ONE_NPCS.map((npc) => ({
        id: npc.id,
        project_id: npc.projectId,
        category: npc.category,
        name: npc.name,
        title: npc.title,
        gender: npc.gender,
        age: npc.age,
        hometown: npc.hometown,
        personality: npc.personality,
        weakness: personalInterestUnlocked && (npcAffinity[npc.id] ?? 0) >= 50 ? npc.weakness : null,
    }));
    return NextResponse.json({ success: true, data });
  }

  // 非项目一的人物表（自定义场景）尚未建模，先干净降级。
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

// POST /api/game-data/npcs - 新增人物（设计师 CRUD，尚未建模）
export async function POST(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

// PUT /api/game-data/npcs/:id - 修改人物
export async function PUT(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}

// DELETE /api/game-data/npcs/:id - 删除人物
export async function DELETE(request: NextRequest) {
  const g = authGuard(request);
  if (!g.ok) return g.response;
  return NextResponse.json({ error: '功能未实现' }, { status: 501 });
}
