import { NextResponse } from 'next/server';
import { createServerClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('health_check')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal);

    if (error) {
      return NextResponse.json({
        app: 'weixun-project',
        buildId: process.env.WEIXUN_BUILD_ID ?? 'development',
        database: 'unavailable',
      }, { status: 503 });
    }

    return NextResponse.json({
      app: 'weixun-project',
      buildId: process.env.WEIXUN_BUILD_ID ?? 'development',
      database: 'ok',
    });
  } catch {
    return NextResponse.json({
      app: 'weixun-project',
      buildId: process.env.WEIXUN_BUILD_ID ?? 'development',
      database: 'unavailable',
    }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
