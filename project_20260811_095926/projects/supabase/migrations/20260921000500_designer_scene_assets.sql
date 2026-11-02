-- Designer scene assets are dynamic records.  Keep them separate from the
-- fixed person-image slots so adding/removing a scene cannot loosen or delete
-- a person slot by accident.
CREATE TABLE IF NOT EXISTS public.designer_scene_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code varchar(32) NOT NULL DEFAULT 'project-one',
  slot_key varchar(96) NOT NULL,
  scene_key varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  description text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  original_filename varchar(255) NOT NULL,
  mime_type varchar(64) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  updated_by varchar(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designer_scene_assets_project_slot_unique UNIQUE (project_code, slot_key),
  CONSTRAINT designer_scene_assets_project_key_unique UNIQUE (project_code, scene_key),
  CONSTRAINT designer_scene_assets_scene_key_check CHECK (scene_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  CONSTRAINT designer_scene_assets_slot_key_check CHECK (slot_key = 'visit_scene:' || scene_key),
  CONSTRAINT designer_scene_assets_mime_type_check CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE INDEX IF NOT EXISTS designer_scene_assets_project_updated_idx
  ON public.designer_scene_assets (project_code, updated_at);

ALTER TABLE public.designer_scene_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS designer_scene_assets_service_role_only ON public.designer_scene_assets;
CREATE POLICY designer_scene_assets_service_role_only
  ON public.designer_scene_assets AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.designer_scene_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.designer_scene_assets TO service_role;

-- Preserve any previously uploaded fixed scene rows while moving them into the
-- dynamic table.  The current development database has no such rows, but the
-- migration is safe for installations that used the old four-slot contract.
INSERT INTO public.designer_scene_assets (
  project_code, slot_key, scene_key, name, description, storage_path, public_url,
  original_filename, mime_type, byte_size, updated_by, updated_at
)
SELECT
  project_code,
  slot_key,
  regexp_replace(slot_key, '^visit_scene:', ''),
  CASE regexp_replace(slot_key, '^visit_scene:', '')
    WHEN 'office' THEN '办公室'
    WHEN 'restaurant' THEN '饭店'
    WHEN 'elevator' THEN '电梯'
    WHEN 'bar' THEN '酒馆'
  END,
  '',
  storage_path,
  public_url,
  original_filename,
  mime_type,
  byte_size,
  updated_by,
  updated_at
FROM public.designer_image_assets
WHERE category = 'visit_scene'
  AND slot_key ~ '^visit_scene:(office|restaurant|elevator|bar)$'
ON CONFLICT (project_code, scene_key) DO NOTHING;

DELETE FROM public.designer_image_assets
WHERE category = 'visit_scene'
  AND slot_key ~ '^visit_scene:(office|restaurant|elevator|bar)$';

-- The old table is now reserved for the fixed person slots.  Keep its
-- person-slot invariants explicit so future writes cannot recreate the four
-- retired scene slots through a low-level service-role operation.
ALTER TABLE public.designer_image_assets
  DROP CONSTRAINT IF EXISTS designer_image_assets_category_check,
  DROP CONSTRAINT IF EXISTS designer_image_assets_slot_key_check;

ALTER TABLE public.designer_image_assets
  ADD CONSTRAINT designer_image_assets_category_check CHECK (category IN ('person_intro', 'person_expression')),
  ADD CONSTRAINT designer_image_assets_slot_key_check CHECK (
    (category = 'person_intro' AND person_id IN ('P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005') AND slot_key = 'person_intro:' || person_id)
    OR (category = 'person_expression' AND person_id IN ('P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005') AND slot_key ~ '^person_expression:P1-00[1-5]:(angry|serious|calm|pleasant|very_happy)$')
  );
