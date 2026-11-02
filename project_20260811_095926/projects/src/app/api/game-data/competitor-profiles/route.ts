import { NextRequest } from 'next/server';
import { handleCompetitorProfilesGet } from '@/lib/designer/competitor-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return handleCompetitorProfilesGet(request);
}
