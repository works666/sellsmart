import { NextRequest } from 'next/server';
import { handleCompetitorDelete, handleCompetitorPut } from '@/lib/designer/competitor-api';

export const runtime = 'nodejs';

interface CompetitorRouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: CompetitorRouteContext) {
  const { id } = await context.params;
  return handleCompetitorPut(request, id);
}

export async function DELETE(request: NextRequest, context: CompetitorRouteContext) {
  const { id } = await context.params;
  return handleCompetitorDelete(request, id);
}

