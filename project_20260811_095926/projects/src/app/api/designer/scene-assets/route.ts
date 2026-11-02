import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import {
  DESIGNER_IMAGE_ALLOWED_MIME_TYPES,
  DESIGNER_IMAGE_MAX_BYTES,
  DESIGNER_SCENE_DESCRIPTION_MAX_LENGTH,
  DESIGNER_SCENE_KEY_MAX_LENGTH,
  DESIGNER_SCENE_NAME_MAX_LENGTH,
  detectDesignerImageMimeType,
  isAllowedDesignerImageMimeType,
  isValidDesignerSceneKey,
} from '@/lib/designer/image-assets';
import {
  createDesignerSceneAsset,
  deleteDesignerSceneAsset,
  DesignerSceneAssetError,
  listDesignerSceneAssets,
  updateDesignerSceneAsset,
} from '@/lib/designer/scene-assets';

export const runtime = 'nodejs';

const MAX_MULTIPART_OVERHEAD = 32 * 1024;

function errorResponse(error: unknown): NextResponse {
  const code = error instanceof DesignerSceneAssetError ? error.code : 'DESIGNER_SCENE_ASSET_UNKNOWN_ERROR';
  const responseByCode: Record<string, { status: number; message: string }> = {
    DESIGNER_SCENE_ASSET_INVALID_INPUT: { status: 400, message: '场景素材参数无效。' },
    DESIGNER_SCENE_ASSET_NOT_FOUND: { status: 404, message: '场景素材记录不存在。' },
    DESIGNER_SCENE_ASSET_DUPLICATE_KEY: { status: 409, message: '场景标识已存在，请更换后重试。' },
    DESIGNER_SCENE_ASSET_STORAGE_UPLOAD_FAILED: { status: 503, message: '图片上传失败，请稍后重试。' },
    DESIGNER_SCENE_ASSET_STORAGE_CLEANUP_FAILED: { status: 503, message: '场景素材已更新，但旧图片清理失败，请稍后重试。' },
    DESIGNER_SCENE_ASSET_READ_FAILED: { status: 503, message: '场景素材暂时无法读取，请稍后重试。' },
    DESIGNER_SCENE_ASSET_WRITE_FAILED: { status: 503, message: '场景素材保存失败，请稍后重试。' },
    DESIGNER_SCENE_ASSET_DELETE_FAILED: { status: 503, message: '场景素材删除失败，请稍后重试。' },
    DESIGNER_SCENE_ASSET_UNKNOWN_ERROR: { status: 503, message: '场景素材服务暂时不可用，请稍后重试。' },
  };
  const response = responseByCode[code] ?? responseByCode.DESIGNER_SCENE_ASSET_UNKNOWN_ERROR;
  console.error('Designer scene asset request failed', { code });
  return NextResponse.json({ error: response.message }, { status: response.status });
}

function validateTextFields(form: FormData): { sceneKey: string; name: string; description: string } | null {
  const sceneKey = form.get('sceneKey');
  const name = form.get('name');
  const description = form.get('description');
  if (typeof sceneKey !== 'string' || typeof name !== 'string' || typeof description !== 'string') return null;
  const normalized = { sceneKey: sceneKey.trim(), name: name.trim(), description: description.trim() };
  if (!isValidDesignerSceneKey(normalized.sceneKey) || normalized.sceneKey.length > DESIGNER_SCENE_KEY_MAX_LENGTH) return null;
  if (!normalized.name || normalized.name.length > DESIGNER_SCENE_NAME_MAX_LENGTH) return null;
  if (normalized.description.length > DESIGNER_SCENE_DESCRIPTION_MAX_LENGTH) return null;
  return normalized;
}

function validateContentLength(request: NextRequest): NextResponse | null {
  const contentLengthHeader = request.headers.get('content-length');
  if (!contentLengthHeader) return null;
  const contentLength = Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > DESIGNER_IMAGE_MAX_BYTES + MAX_MULTIPART_OVERHEAD) {
    return NextResponse.json({ error: '图片不能超过 5 MB。' }, { status: 413 });
  }
  return null;
}

async function readForm(request: NextRequest): Promise<FormData | NextResponse> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: '请使用场景素材表单。' }, { status: 400 });
  }
  try {
    return await request.formData();
  } catch {
    return NextResponse.json({ error: '上传表单无法解析。' }, { status: 400 });
  }
}

async function readImageFile(value: FormDataEntryValue | null, required: boolean): Promise<{ bytes: Uint8Array; mimeType: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number]; originalFilename: string } | null | NextResponse> {
  if (value === null && !required) return null;
  if (!(value instanceof File)) return NextResponse.json({ error: required ? '请选择图片文件。' : '图片文件无效。' }, { status: 400 });
  if (value.size <= 0) return NextResponse.json({ error: '图片文件为空。' }, { status: 400 });
  if (value.size > DESIGNER_IMAGE_MAX_BYTES) return NextResponse.json({ error: '图片不能超过 5 MB。' }, { status: 413 });
  if (!isAllowedDesignerImageMimeType(value.type)) return NextResponse.json({ error: '仅支持 PNG、JPEG 或 WebP 图片。' }, { status: 415 });
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (detectDesignerImageMimeType(bytes) !== value.type) return NextResponse.json({ error: '图片内容与文件类型不匹配。' }, { status: 415 });
  return { bytes, mimeType: value.type, originalFilename: value.name };
}

export async function GET(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok) return guard.response!;
  try {
    return NextResponse.json({ success: true, scenes: await listDesignerSceneAssets() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  const lengthError = validateContentLength(request);
  if (lengthError) return lengthError;
  const formResult = await readForm(request);
  if (formResult instanceof NextResponse) return formResult;
  const fields = validateTextFields(formResult);
  if (!fields) return NextResponse.json({ error: '场景标识、名称或说明无效。' }, { status: 400 });
  const fileResult = await readImageFile(formResult.get('file'), true);
  if (fileResult instanceof NextResponse || fileResult === null) return fileResult ?? NextResponse.json({ error: '请选择图片文件。' }, { status: 400 });
  try {
    const scene = await createDesignerSceneAsset({ ...fields, ...fileResult, updatedBy: guard.session.userId });
    return NextResponse.json({ success: true, scene }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  const lengthError = validateContentLength(request);
  if (lengthError) return lengthError;
  const formResult = await readForm(request);
  if (formResult instanceof NextResponse) return formResult;
  const slotKey = formResult.get('slotKey');
  if (typeof slotKey !== 'string' || !slotKey.trim()) return NextResponse.json({ error: '原场景记录无效。' }, { status: 400 });
  const fields = validateTextFields(formResult);
  if (!fields) return NextResponse.json({ error: '场景标识、名称或说明无效。' }, { status: 400 });
  const fileResult = await readImageFile(formResult.get('file'), false);
  if (fileResult instanceof NextResponse) return fileResult;
  try {
    const scene = await updateDesignerSceneAsset({
      ...fields,
      slotKey: slotKey.trim(),
      ...(fileResult ?? {}),
      updatedBy: guard.session.userId,
    });
    return NextResponse.json({ success: true, scene });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '删除请求无法解析。' }, { status: 400 });
  }
  const slotKey = body && typeof body === 'object' && 'slotKey' in body && typeof body.slotKey === 'string' ? body.slotKey.trim() : '';
  if (!slotKey) return NextResponse.json({ error: '原场景记录无效。' }, { status: 400 });
  try {
    await deleteDesignerSceneAsset(slotKey);
    return NextResponse.json({ success: true, slotKey });
  } catch (error) {
    return errorResponse(error);
  }
}
