import { NextRequest } from 'next/server';
import { getSystemEvaluationResponse, postSystemEvaluationResponse } from './handler';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return getSystemEvaluationResponse(request);
}

export async function POST(request: NextRequest) {
  return postSystemEvaluationResponse(request);
}
