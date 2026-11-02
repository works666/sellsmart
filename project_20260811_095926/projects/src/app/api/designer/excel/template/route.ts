import { NextRequest, NextResponse } from 'next/server';
import {
  createDesignerExcelTemplateBuffer,
  getDesignerExcelDefinition,
} from '@/lib/designer/excel-data';
import { authGuard } from '@/lib/auth/guard';

export const runtime = 'nodejs';

function contentDisposition(fileName: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
export async function GET(request: NextRequest) {
  const guard = authGuard(request, '数据表编辑');
  if (!guard.ok) return guard.response!;

  const type = request.nextUrl.searchParams.get('type');
  const definition = getDesignerExcelDefinition(type);
  if (!definition) {
    return NextResponse.json(
      { error: '模板类型无效。可选类型：key-persons、client-info、metrics。' },
      { status: 400 },
    );
  }

  try {
    const buffer = await createDesignerExcelTemplateBuffer(definition.type);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition(definition.fileName),
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Designer Excel template export failed', {
      type: definition.type,
      code: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Excel 模板生成失败，请稍后重试。' }, { status: 503 });
  }
}
