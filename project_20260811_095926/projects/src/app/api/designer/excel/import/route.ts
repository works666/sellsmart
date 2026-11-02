import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import {
  DesignerExcelRequestError,
  MAX_EXCEL_FILE_BYTES,
  getDesignerExcelDefinition,
  parseDesignerExcel,
} from '@/lib/designer/excel-data';

export const runtime = 'nodejs';

function isXlsxFile(file: File): boolean {
  const name = typeof file.name === 'string' ? file.name.toLocaleLowerCase() : '';
  if (!name.endsWith('.xlsx')) return false;
  // Browsers commonly send an empty or generic MIME type. The extension is
  // the user-facing contract; the XLSX parser below verifies the ZIP payload.
  return !file.type || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.type === 'application/octet-stream';
}
export async function POST(request: NextRequest) {
  const guard = authGuard(request, '数据表编辑');
  if (!guard.ok) return guard.response!;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLocaleLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: '请使用 multipart/form-data 上传 Excel 文件。' }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: '上传表单无法解析。' }, { status: 400 });
  }

  const typeValue = formData.get('type');
  const definition = getDesignerExcelDefinition(typeValue);
  if (!definition) {
    return NextResponse.json(
      { error: '表单 type 无效。可选类型：key-persons、client-info、metrics。' },
      { status: 400 },
    );
  }

  const fileValue = formData.get('file');
  if (!(fileValue instanceof File)) {
    return NextResponse.json({ error: '请上传名为 file 的 .xlsx 文件。' }, { status: 400 });
  }
  if (!isXlsxFile(fileValue)) {
    return NextResponse.json({ error: '只支持 .xlsx 文件。' }, { status: 415 });
  }
  if (fileValue.size > MAX_EXCEL_FILE_BYTES) {
    return NextResponse.json({ error: `文件大小不能超过 ${MAX_EXCEL_FILE_BYTES / 1024 / 1024}MB。` }, { status: 413 });
  }

  try {
    const bytes = Buffer.from(await fileValue.arrayBuffer());
    const result = await parseDesignerExcel(bytes, definition.type);
    // Data validation errors intentionally use 200. The UI can display rows,
    // errors and warnings together and let the designer correct the workbook.
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DesignerExcelRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Designer Excel import failed', {
      type: definition.type,
      code: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Excel 文件解析失败，请确认文件未损坏。' }, { status: 400 });
  }
}
