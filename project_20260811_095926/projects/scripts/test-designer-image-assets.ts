import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DESIGNER_IMAGE_ALLOWED_MIME_TYPES,
  DESIGNER_IMAGE_MAX_BYTES,
  detectDesignerImageMimeType,
  getDesignerImageAssetSlot,
  getDesignerImageAssetSlots,
  imageExtensionForMimeType,
  isAllowedDesignerImageMimeType,
  isValidDesignerSceneKey,
} from '../src/lib/designer/image-assets';

const slots = getDesignerImageAssetSlots();
assert.equal(slots.length, 30, 'five introductions and twenty-five expressions retain fixed person slots');

const introductions = slots.filter((slot) => slot.category === 'person_intro');
assert.equal(introductions.length, 5, 'all five people retain an introduction image slot');
assert.ok(introductions.every((slot) => slot.imageUrl?.startsWith('/assets/people/')), 'introduction images retain the existing public assets');
assert.ok(introductions.every((slot) => slot.isDefault), 'existing introduction images are marked as defaults until replaced');

const expressions = slots.filter((slot) => slot.category === 'person_expression');
assert.equal(expressions.length, 25, 'each person has five expression slots');
assert.ok(expressions.every((slot) => slot.imageUrl === null), 'expression slots start empty');
assert.deepEqual(new Set(expressions.map((slot) => slot.slotKey.split(':').at(-1))), new Set(['angry', 'serious', 'calm', 'pleasant', 'very_happy']));

assert.equal(getDesignerImageAssetSlot('person_intro:P1-001')?.imageUrl, '/assets/people/zhang-jianguo.png');
assert.equal(getDesignerImageAssetSlot('visit_scene:office'), null, 'visit scenes are dynamic records, not fixed slots');
assert.equal(getDesignerImageAssetSlot('unregistered'), null, 'invented slots are rejected');

assert.equal(DESIGNER_IMAGE_MAX_BYTES, 5 * 1024 * 1024, 'file-size limit is five MB');
assert.deepEqual(DESIGNER_IMAGE_ALLOWED_MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
assert.equal(isAllowedDesignerImageMimeType('image/png'), true);
assert.equal(isAllowedDesignerImageMimeType('image/gif'), false);
assert.equal(detectDesignerImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
assert.equal(detectDesignerImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff])), 'image/jpeg');
assert.equal(detectDesignerImageMimeType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
assert.equal(detectDesignerImageMimeType(Uint8Array.from([1, 2, 3])), null);
assert.equal(imageExtensionForMimeType('image/jpeg'), 'jpg');
assert.equal(isValidDesignerSceneKey('office-main_2'), true);
assert.equal(isValidDesignerSceneKey('Office'), false);
assert.equal(isValidDesignerSceneKey('office space'), false);
assert.equal(isValidDesignerSceneKey('_office'), false);

const migration = readFileSync(new URL('../supabase/migrations/20260917000100_designer_image_assets.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.designer_image_assets/);
assert.match(migration, /designer-image-assets/);
assert.match(migration, /file_size_limit = EXCLUDED\.file_size_limit/);
assert.match(migration, /person_expression:P1-00\[1-5\]/);

const sceneMigration = readFileSync(new URL('../supabase/migrations/20260921000500_designer_scene_assets.sql', import.meta.url), 'utf8');
assert.match(sceneMigration, /CREATE TABLE IF NOT EXISTS public\.designer_scene_assets/);
assert.match(sceneMigration, /designer_scene_assets_project_key_unique/);
assert.match(sceneMigration, /designer_scene_assets_scene_key_check[\s\S]*scene_key ~/);
assert.match(sceneMigration, /INSERT INTO public\.designer_scene_assets/);
assert.match(sceneMigration, /DELETE FROM public\.designer_image_assets/);

const sceneRepository = readFileSync(new URL('../src/lib/designer/scene-assets.ts', import.meta.url), 'utf8');
assert.match(sceneRepository, /designer_scene_assets/);
assert.match(sceneRepository, /DESIGNER_SCENE_ASSET_STORAGE_CLEANUP_FAILED/);
assert.match(sceneRepository, /await removeStorageObject\(supabase, existing\.storage_path\)/);

const sceneRoute = readFileSync(new URL('../src/app/api/designer/scene-assets/route.ts', import.meta.url), 'utf8');
assert.match(sceneRoute, /authGuard\(request, '工作流编辑'\)/);
assert.match(sceneRoute, /export async function GET/);
assert.match(sceneRoute, /export async function POST/);
assert.match(sceneRoute, /export async function PUT/);
assert.match(sceneRoute, /export async function DELETE/);
assert.match(sceneRoute, /success: true, scene/);
assert.match(sceneRoute, /success: true, slotKey/);

const imageAssetsRoute = readFileSync(new URL('../src/app/api/designer/image-assets/route.ts', import.meta.url), 'utf8');
assert.match(imageAssetsRoute, /listDesignerSceneAssets/);

const designerPage = readFileSync(new URL('../src/app/designer/page.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(designerPage, /id: 'scenario' as const/, 'scene is no longer a separate top-level workspace');
assert.doesNotMatch(designerPage, /场景提示词/, 'unused scene prompt workspace is removed');
assert.match(designerPage, /selectedModule === 'assets'[\s\S]*拜访场景图片/, 'visit scenes are managed inside the asset library');
assert.match(designerPage, /setPreviewImageAsset\(asset\)/, 'uploaded images open the high-resolution preview');
assert.match(designerPage, /aria-modal="true"/, 'high-resolution preview uses an accessible modal');
assert.match(designerPage, /场景素材管理/);
assert.match(designerPage, /新增场景/);
assert.match(designerPage, /编辑场景记录/);
assert.match(designerPage, /<table/);
assert.match(designerPage, /method: editingSceneSlotKey \? 'PUT' : 'POST'/);
assert.match(designerPage, /method: 'DELETE'/);
assert.match(designerPage, /onClick=\{startAddSceneAsset\}[\s\S]{0,300}bg-\[#6D28D9\][\s\S]{0,300}text-white/, '新增场景按钮必须使用高对比度实色背景');
assert.doesNotMatch(designerPage, /onClick=\{startAddSceneAsset\}[\s\S]{0,300}bg-role-designer/, '新增场景按钮不得复用页面浅色背景类');
console.log('designer image asset contracts passed');
