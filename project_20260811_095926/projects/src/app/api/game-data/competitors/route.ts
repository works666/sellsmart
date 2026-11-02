import { NextRequest } from 'next/server';
import {
  handleCompetitorDelete,
  handleCompetitorGet,
  handleCompetitorPost,
  handleCompetitorPut,
} from '@/lib/designer/competitor-api';

export const runtime = 'nodejs';

// Collection endpoint.  PUT/DELETE accept the item id in the strict JSON
// body for compatibility with the existing designer page; item endpoints are
// also exposed from [id]/route.ts.
export async function GET(request: NextRequest) {
  return handleCompetitorGet(request);
}

export async function POST(request: NextRequest) {
  return handleCompetitorPost(request);
}

export async function PUT(request: NextRequest) {
  return handleCompetitorPut(request);
}

export async function DELETE(request: NextRequest) {
  return handleCompetitorDelete(request);
}
