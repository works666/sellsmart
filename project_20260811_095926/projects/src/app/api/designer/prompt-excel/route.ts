import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { loadProjectOnePromptConfig } from '@/lib/designer/prompt-config-repository';
import { exportPromptExcel, parsePromptExcel, PromptExcelRequestError } from '@/lib/designer/prompt-excel';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    const { config } = await loadProjectOnePromptConfig();
    const buffer = await exportPromptExcel(config);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('项目一-人物提示词.xlsx')}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Prompt Excel export failed', { code: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: '人物提示词 Excel 导出失败。' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: '请上传 Excel 文件。' }, { status: 400 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '上传表单无法解析。' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择 .xlsx 文件。' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ error: '只支持 .xlsx 文件。' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件不能超过 5 MB。' }, { status: 413 });
  try {
    const result = await parsePromptExcel(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PromptExcelRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Prompt Excel import failed', { code: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'Excel 文件无法解析，请检查文件格式。' }, { status: 400 });
  }
}
