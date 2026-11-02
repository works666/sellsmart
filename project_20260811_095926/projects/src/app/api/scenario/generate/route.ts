// AI 场景生成 API（setup 页面用）
import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { invokeLLM } from '@/lib/ai/client';
import { parseAiJsonObject } from '@/lib/ai/json';
import { SCENARIO_GENERATOR_PROMPT } from '@/lib/ai/prompts/scenario-generator';
import { generatedScenarioSchema, scenarioGenerateRequestSchema } from '@/lib/contracts/ai';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const guard = authGuard(request);
  if (!guard.ok) return guard.response!;

  try {
    const parsedRequest = scenarioGenerateRequestSchema.safeParse(await request.json());
    if (!parsedRequest.success) {
      return NextResponse.json(
        { error: '场景生成请求字段无效', details: parsedRequest.error.flatten() },
        { status: 400 }
      );
    }
    const { industry, productCategory, customRequirement } = parsedRequest.data;

    const prompt = SCENARIO_GENERATOR_PROMPT
      .replace(/\{\{industry\}\}/g, industry)
      .replace(/\{\{productCategory\}\}/g, productCategory)
      .replace(/\{\{customRequirement\}\}/g, customRequirement || '无');

    const result = await invokeLLM(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: `行业：${industry}\n产品分类：${productCategory}\n${customRequirement ? `补充：${customRequirement}` : ''}` },
      ],
      { temperature: 0.8, maxTokens: 2000, jsonMode: true }
    );

    // 尝试解析 JSON（LLM 可能包了 markdown 代码块）
    let json: unknown;
    try {
      json = parseAiJsonObject(result);
    } catch {
      return NextResponse.json({ error: 'AI未返回有效JSON' }, { status: 502 });
    }

    const parsedScenario = generatedScenarioSchema.safeParse(json);
    if (!parsedScenario.success) {
      return NextResponse.json(
        { error: 'AI场景数据未通过校验', details: parsedScenario.error.flatten() },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, scenario: parsedScenario.data });
  } catch {
    return NextResponse.json({ error: '场景生成服务暂时不可用' }, { status: 500 });
  }
}
