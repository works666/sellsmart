import { PROJECT_ONE_FIVE_PERSON_IDS, PROJECT_ONE_FIVE_PERSON_NPCS, type ProjectOneFivePersonId } from '@/lib/designer/project-one-five-person';
import { createAdminClient } from '@/storage/database/supabase-client';

export const DESIGNER_IMAGE_ASSET_BUCKET = 'designer-image-assets';
export const DESIGNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DESIGNER_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DESIGNER_SCENE_KEY_MAX_LENGTH = 64;
export const DESIGNER_SCENE_NAME_MAX_LENGTH = 128;
export const DESIGNER_SCENE_DESCRIPTION_MAX_LENGTH = 2000;

const DESIGNER_SCENE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export type DesignerImageAssetCategory = 'person_intro' | 'person_expression' | 'visit_scene';
export type PersonExpression = 'angry' | 'serious' | 'calm' | 'pleasant' | 'very_happy';

export interface DesignerImageAssetSlot {
  slotKey: string;
  category: DesignerImageAssetCategory;
  personId: ProjectOneFivePersonId | null;
  label: string;
  imageUrl: string | null;
  isDefault: boolean;
  updatedAt: string | null;
}

interface StoredDesignerImageAsset {
  slot_key: string;
  storage_path: string;
  public_url: string;
  updated_at: string;
}

const INTRO_IMAGE_PATHS: Record<ProjectOneFivePersonId, string> = {
  'P1-001': '/assets/people/zhang-jianguo.png',
  'P1-002': '/assets/people/li-minghui.png',
  'P1-003': '/assets/people/wang-defu.png',
  'P1-004': '/assets/people/zhao-xiaochen.png',
  'P1-005': '/assets/people/liu-siqi.png',
};

const EXPRESSIONS: ReadonlyArray<{ id: PersonExpression; label: string }> = [
  { id: 'angry', label: '愤怒' },
  { id: 'serious', label: '严肃' },
  { id: 'calm', label: '正常淡定' },
  { id: 'pleasant', label: '愉快' },
  { id: 'very_happy', label: '特别开心' },
];

function personName(personId: ProjectOneFivePersonId): string {
  return PROJECT_ONE_FIVE_PERSON_NPCS[personId].name;
}

export function getDesignerImageAssetSlots(): DesignerImageAssetSlot[] {
  const intros = PROJECT_ONE_FIVE_PERSON_IDS.map((personId) => ({
    slotKey: `person_intro:${personId}`,
    category: 'person_intro' as const,
    personId,
    label: `${personName(personId)} · 人物介绍图像`,
    imageUrl: INTRO_IMAGE_PATHS[personId],
    isDefault: true,
    updatedAt: null,
  }));
  const expressions = PROJECT_ONE_FIVE_PERSON_IDS.flatMap((personId) => EXPRESSIONS.map((expression) => ({
    slotKey: `person_expression:${personId}:${expression.id}`,
    category: 'person_expression' as const,
    personId,
    label: `${personName(personId)} · ${expression.label}`,
    imageUrl: null,
    isDefault: false,
    updatedAt: null,
  })));
  return [...intros, ...expressions];
}

const slotsByKey = new Map(getDesignerImageAssetSlots().map((slot) => [slot.slotKey, slot]));

export function getDesignerImageAssetSlot(slotKey: string): DesignerImageAssetSlot | null {
  return slotsByKey.get(slotKey) ?? null;
}

export function isAllowedDesignerImageMimeType(value: string): value is (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number] {
  return (DESIGNER_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export function detectDesignerImageMimeType(bytes: Uint8Array): (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export function imageExtensionForMimeType(mimeType: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number]): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

export function isValidDesignerSceneKey(value: string): boolean {
  return value.length > 0 && value.length <= DESIGNER_SCENE_KEY_MAX_LENGTH && DESIGNER_SCENE_KEY_PATTERN.test(value);
}

export function sceneSlotKey(sceneKey: string): string {
  return `visit_scene:${sceneKey}`;
}

export async function listDesignerImageAssets(): Promise<DesignerImageAssetSlot[]> {
  const slots = getDesignerImageAssetSlots();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('designer_image_assets').select('slot_key, storage_path, public_url, updated_at').eq('project_code', 'project-one');
  if (error) throw new Error(`DESIGNER_IMAGE_ASSET_READ_FAILED:${error.code || 'unknown'}`);
  const storedBySlot = new Map((data ?? []).map((asset) => [asset.slot_key, asset as StoredDesignerImageAsset]));
  return slots.map((slot) => {
    const stored = storedBySlot.get(slot.slotKey);
    return stored ? { ...slot, imageUrl: stored.public_url, isDefault: false, updatedAt: stored.updated_at } : slot;
  });
}

export interface SaveDesignerImageAssetInput {
  slot: DesignerImageAssetSlot;
  bytes: Uint8Array;
  mimeType: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number];
  originalFilename: string;
  updatedBy: string;
}

export async function saveDesignerImageAsset(input: SaveDesignerImageAssetInput): Promise<DesignerImageAssetSlot> {
  const supabase = createAdminClient();
  const { data: existing, error: existingError } = await supabase.from('designer_image_assets').select('storage_path').eq('project_code', 'project-one').eq('slot_key', input.slot.slotKey).maybeSingle();
  if (existingError) throw new Error(`DESIGNER_IMAGE_ASSET_LOOKUP_FAILED:${existingError.code || 'unknown'}`);
  const objectName = `project-one/${input.slot.slotKey.replace(/[^a-zA-Z0-9:_-]/g, '-')}/${crypto.randomUUID()}.${imageExtensionForMimeType(input.mimeType)}`;
  const { error: uploadError } = await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).upload(objectName, input.bytes, { contentType: input.mimeType, upsert: false, cacheControl: '31536000' });
  if (uploadError) throw new Error(`DESIGNER_IMAGE_ASSET_UPLOAD_FAILED:${uploadError.message}`);
  const { data: publicUrl } = supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).getPublicUrl(objectName);
  const updatedAt = new Date().toISOString();
  const { data, error: saveError } = await supabase.from('designer_image_assets').upsert({
    project_code: 'project-one', slot_key: input.slot.slotKey, category: input.slot.category, person_id: input.slot.personId,
    storage_path: objectName, public_url: publicUrl.publicUrl, original_filename: input.originalFilename.slice(0, 255),
    mime_type: input.mimeType, byte_size: input.bytes.byteLength, updated_by: input.updatedBy, updated_at: updatedAt,
  }, { onConflict: 'project_code,slot_key' }).select('public_url, updated_at').single();
  if (saveError) {
    await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).remove([objectName]);
    throw new Error(`DESIGNER_IMAGE_ASSET_SAVE_FAILED:${saveError.code || 'unknown'}`);
  }
  if (existing?.storage_path && existing.storage_path !== objectName) {
    const { error: removeError } = await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).remove([existing.storage_path]);
    if (removeError) console.error('Designer image asset replacement cleanup failed', { code: removeError.message });
  }
  return { ...input.slot, imageUrl: data.public_url, isDefault: false, updatedAt: data.updated_at };
}
