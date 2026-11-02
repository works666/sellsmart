import { NextRequest, NextResponse } from 'next/server';
import { authGuard } from '@/lib/auth/guard';
import { DESIGNER_IMAGE_MAX_BYTES, detectDesignerImageMimeType, getDesignerImageAssetSlot, isAllowedDesignerImageMimeType, listDesignerImageAssets, saveDesignerImageAsset } from '@/lib/designer/image-assets';
import { listDesignerSceneAssets } from '@/lib/designer/scene-assets';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [assets, scenes] = await Promise.all([listDesignerImageAssets(), listDesignerSceneAssets()]);
    return NextResponse.json({
      success: true,
      assets: [
        ...assets,
        ...scenes.map((scene) => ({
          slotKey: scene.slotKey,
          category: 'visit_scene' as const,
          personId: null,
          label: `拜访场景 · ${scene.name}`,
          imageUrl: scene.imageUrl,
          isDefault: false,
          updatedAt: scene.updatedAt,
        })),
      ],
    });
  } catch (error) {
    console.error('Designer image assets read failed', { code: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: '图片素材暂时无法读取，请确认数据库迁移已执行。' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const guard = authGuard(request, '工作流编辑');
  if (!guard.ok || !guard.session) return guard.response!;
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) return NextResponse.json({ error: '请使用图片上传表单。' }, { status: 400 });
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > DESIGNER_IMAGE_MAX_BYTES + 32 * 1024) return NextResponse.json({ error: '图片不能超过 5 MB。' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: '上传表单无法解析。' }, { status: 400 }); }
  const slotKey = form.get('slotKey');
  const file = form.get('file');
  const slot = typeof slotKey === 'string' ? getDesignerImageAssetSlot(slotKey) : null;
  if (!slot) return NextResponse.json({ error: '图片用途槽位无效。' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择图片文件。' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: '图片文件为空。' }, { status: 400 });
  if (file.size > DESIGNER_IMAGE_MAX_BYTES) return NextResponse.json({ error: '图片不能超过 5 MB。' }, { status: 413 });
  if (!isAllowedDesignerImageMimeType(file.type)) return NextResponse.json({ error: '仅支持 PNG、JPEG 或 WebP 图片。' }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectDesignerImageMimeType(bytes) !== file.type) return NextResponse.json({ error: '图片内容与文件类型不匹配。' }, { status: 415 });
  try {
    const asset = await saveDesignerImageAsset({ slot, bytes, mimeType: file.type, originalFilename: file.name, updatedBy: guard.session.userId });
    return NextResponse.json({ success: true, asset });
  } catch (error) {
    console.error('Designer image asset upload failed', { code: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: '图片上传失败，请确认 Storage 与数据库迁移已执行。' }, { status: 503 });
  }
}
