import {
  DESIGNER_IMAGE_ALLOWED_MIME_TYPES,
  DESIGNER_IMAGE_ASSET_BUCKET,
  DESIGNER_IMAGE_MAX_BYTES,
  DESIGNER_SCENE_DESCRIPTION_MAX_LENGTH,
  DESIGNER_SCENE_KEY_MAX_LENGTH,
  DESIGNER_SCENE_NAME_MAX_LENGTH,
  detectDesignerImageMimeType,
  imageExtensionForMimeType,
  isAllowedDesignerImageMimeType,
  isValidDesignerSceneKey,
  sceneSlotKey,
} from '@/lib/designer/image-assets';
import { createAdminClient } from '@/storage/database/supabase-client';

export interface DesignerSceneAsset {
  slotKey: string;
  sceneKey: string;
  name: string;
  description: string;
  imageUrl: string;
  originalFilename: string;
  byteSize: number;
  updatedAt: string;
}

export interface DesignerSceneAssetFields {
  sceneKey: string;
  name: string;
  description: string;
}

export interface CreateDesignerSceneAssetInput extends DesignerSceneAssetFields {
  bytes: Uint8Array;
  mimeType: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number];
  originalFilename: string;
  updatedBy: string;
}

export interface UpdateDesignerSceneAssetInput extends DesignerSceneAssetFields {
  slotKey: string;
  bytes?: Uint8Array;
  mimeType?: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number];
  originalFilename?: string;
  updatedBy: string;
}

export type DesignerSceneAssetErrorCode =
  | 'DESIGNER_SCENE_ASSET_INVALID_INPUT'
  | 'DESIGNER_SCENE_ASSET_NOT_FOUND'
  | 'DESIGNER_SCENE_ASSET_DUPLICATE_KEY'
  | 'DESIGNER_SCENE_ASSET_READ_FAILED'
  | 'DESIGNER_SCENE_ASSET_WRITE_FAILED'
  | 'DESIGNER_SCENE_ASSET_DELETE_FAILED'
  | 'DESIGNER_SCENE_ASSET_STORAGE_UPLOAD_FAILED'
  | 'DESIGNER_SCENE_ASSET_STORAGE_CLEANUP_FAILED';

export class DesignerSceneAssetError extends Error {
  readonly code: DesignerSceneAssetErrorCode;

  constructor(code: DesignerSceneAssetErrorCode) {
    super(code);
    this.name = 'DesignerSceneAssetError';
    this.code = code;
  }
}

interface StoredDesignerSceneAsset {
  slot_key: string;
  scene_key: string;
  name: string;
  description: string;
  storage_path: string;
  public_url: string;
  original_filename: string;
  byte_size: number;
  updated_at: string;
}

const SCENE_ASSET_SELECT = 'slot_key, scene_key, name, description, storage_path, public_url, original_filename, byte_size, updated_at';

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

function isValidSceneSlotKey(slotKey: string): boolean {
  if (!slotKey.startsWith('visit_scene:')) return false;
  const sceneKey = slotKey.slice('visit_scene:'.length);
  return isValidDesignerSceneKey(sceneKey) && sceneSlotKey(sceneKey) === slotKey;
}

function assertFields(fields: DesignerSceneAssetFields): void {
  if (!isValidDesignerSceneKey(fields.sceneKey) || fields.sceneKey.length > DESIGNER_SCENE_KEY_MAX_LENGTH) {
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_INVALID_INPUT');
  }
  if (!fields.name || fields.name.length > DESIGNER_SCENE_NAME_MAX_LENGTH) {
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_INVALID_INPUT');
  }
  if (fields.description.length > DESIGNER_SCENE_DESCRIPTION_MAX_LENGTH) {
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_INVALID_INPUT');
  }
}

function assertFile(bytes: Uint8Array, mimeType: string): asserts mimeType is (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number] {
  if (bytes.byteLength <= 0 || bytes.byteLength > DESIGNER_IMAGE_MAX_BYTES || !isAllowedDesignerImageMimeType(mimeType) || detectDesignerImageMimeType(bytes) !== mimeType) {
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_INVALID_INPUT');
  }
}

function toSceneAsset(row: StoredDesignerSceneAsset): DesignerSceneAsset {
  return {
    slotKey: row.slot_key,
    sceneKey: row.scene_key,
    name: row.name,
    description: row.description,
    imageUrl: row.public_url,
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
    updatedAt: row.updated_at,
  };
}

function storagePath(sceneKey: string, mimeType: (typeof DESIGNER_IMAGE_ALLOWED_MIME_TYPES)[number]): string {
  return `project-one/scene-assets/${sceneKey}/${crypto.randomUUID()}.${imageExtensionForMimeType(mimeType)}`;
}

async function removeStorageObject(supabase: ReturnType<typeof createAdminClient>, objectPath: string): Promise<void> {
  const { error } = await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).remove([objectPath]);
  if (error) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_STORAGE_CLEANUP_FAILED');
}

async function loadSceneRow(supabase: ReturnType<typeof createAdminClient>, slotKey: string): Promise<StoredDesignerSceneAsset> {
  if (!isValidSceneSlotKey(slotKey)) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_NOT_FOUND');
  const { data, error } = await supabase
    .from('designer_scene_assets')
    .select(SCENE_ASSET_SELECT)
    .eq('project_code', 'project-one')
    .eq('slot_key', slotKey)
    .maybeSingle();
  if (error) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_READ_FAILED');
  if (!data) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_NOT_FOUND');
  return data as unknown as StoredDesignerSceneAsset;
}

export async function listDesignerSceneAssets(): Promise<DesignerSceneAsset[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('designer_scene_assets')
    .select(SCENE_ASSET_SELECT)
    .eq('project_code', 'project-one')
    .order('scene_key', { ascending: true });
  if (error) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_READ_FAILED');
  return (data ?? []).map((row) => toSceneAsset(row as unknown as StoredDesignerSceneAsset));
}

export async function createDesignerSceneAsset(input: CreateDesignerSceneAssetInput): Promise<DesignerSceneAsset> {
  assertFields(input);
  assertFile(input.bytes, input.mimeType);
  const supabase = createAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from('designer_scene_assets')
    .select('slot_key')
    .eq('project_code', 'project-one')
    .eq('scene_key', input.sceneKey)
    .maybeSingle();
  if (existingError) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_READ_FAILED');
  if (existing) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_DUPLICATE_KEY');

  const objectPath = storagePath(input.sceneKey, input.mimeType);
  const { error: uploadError } = await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).upload(objectPath, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
    cacheControl: '31536000',
  });
  if (uploadError) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_STORAGE_UPLOAD_FAILED');

  const { data, error: saveError } = await supabase.from('designer_scene_assets').insert({
    project_code: 'project-one',
    slot_key: sceneSlotKey(input.sceneKey),
    scene_key: input.sceneKey,
    name: input.name,
    description: input.description,
    storage_path: objectPath,
    public_url: supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).getPublicUrl(objectPath).data.publicUrl,
    original_filename: input.originalFilename.slice(0, 255),
    mime_type: input.mimeType,
    byte_size: input.bytes.byteLength,
    updated_by: input.updatedBy,
    updated_at: new Date().toISOString(),
  }).select(SCENE_ASSET_SELECT).single();
  if (saveError) {
    await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).remove([objectPath]);
    if (isUniqueViolation(saveError)) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_DUPLICATE_KEY');
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_WRITE_FAILED');
  }
  return toSceneAsset(data as unknown as StoredDesignerSceneAsset);
}

export async function updateDesignerSceneAsset(input: UpdateDesignerSceneAssetInput): Promise<DesignerSceneAsset> {
  assertFields(input);
  if (!isValidSceneSlotKey(input.slotKey)) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_NOT_FOUND');
  if (input.bytes !== undefined || input.mimeType !== undefined || input.originalFilename !== undefined) {
    if (!input.bytes || !input.mimeType || input.originalFilename === undefined) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_INVALID_INPUT');
    assertFile(input.bytes, input.mimeType);
  }

  const supabase = createAdminClient();
  const existing = await loadSceneRow(supabase, input.slotKey);
  if (input.sceneKey !== existing.scene_key) {
    const { data: duplicate, error: duplicateError } = await supabase
      .from('designer_scene_assets')
      .select('slot_key')
      .eq('project_code', 'project-one')
      .eq('scene_key', input.sceneKey)
      .neq('slot_key', input.slotKey)
      .maybeSingle();
    if (duplicateError) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_READ_FAILED');
    if (duplicate) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_DUPLICATE_KEY');
  }

  let nextObjectPath: string | undefined;
  if (input.bytes && input.mimeType && input.originalFilename !== undefined) {
    nextObjectPath = storagePath(input.sceneKey, input.mimeType);
    const { error: uploadError } = await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).upload(nextObjectPath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
      cacheControl: '31536000',
    });
    if (uploadError) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_STORAGE_UPLOAD_FAILED');
  }

  const patch: Record<string, unknown> = {
    slot_key: sceneSlotKey(input.sceneKey),
    scene_key: input.sceneKey,
    name: input.name,
    description: input.description,
    updated_by: input.updatedBy,
    updated_at: new Date().toISOString(),
  };
  if (nextObjectPath && input.mimeType && input.originalFilename !== undefined && input.bytes) {
    patch.storage_path = nextObjectPath;
    patch.public_url = supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).getPublicUrl(nextObjectPath).data.publicUrl;
    patch.original_filename = input.originalFilename.slice(0, 255);
    patch.mime_type = input.mimeType;
    patch.byte_size = input.bytes.byteLength;
  }

  const { data, error: saveError } = await supabase
    .from('designer_scene_assets')
    .update(patch)
    .eq('project_code', 'project-one')
    .eq('slot_key', input.slotKey)
    .select(SCENE_ASSET_SELECT)
    .maybeSingle();
  if (saveError || !data) {
    if (nextObjectPath) await supabase.storage.from(DESIGNER_IMAGE_ASSET_BUCKET).remove([nextObjectPath]);
    if (isUniqueViolation(saveError)) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_DUPLICATE_KEY');
    if (!data) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_NOT_FOUND');
    throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_WRITE_FAILED');
  }
  if (nextObjectPath && existing.storage_path !== nextObjectPath) await removeStorageObject(supabase, existing.storage_path);
  return toSceneAsset(data as unknown as StoredDesignerSceneAsset);
}

export async function deleteDesignerSceneAsset(slotKey: string): Promise<void> {
  const supabase = createAdminClient();
  const existing = await loadSceneRow(supabase, slotKey);
  const { data, error } = await supabase
    .from('designer_scene_assets')
    .delete()
    .eq('project_code', 'project-one')
    .eq('slot_key', slotKey)
    .select('slot_key')
    .maybeSingle();
  if (error) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_DELETE_FAILED');
  if (!data) throw new DesignerSceneAssetError('DESIGNER_SCENE_ASSET_NOT_FOUND');
  // The DB row is deleted first.  A failed DB delete above never reaches this
  // call, so the only object removed is one owned by a successfully deleted row.
  await removeStorageObject(supabase, existing.storage_path);
}
