CREATE TABLE IF NOT EXISTS public.designer_image_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_code varchar(32) NOT NULL DEFAULT 'project-one', slot_key varchar(96) NOT NULL,
  category varchar(32) NOT NULL, person_id varchar(16), storage_path text NOT NULL, public_url text NOT NULL,
  original_filename varchar(255) NOT NULL, mime_type varchar(64) NOT NULL, byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  updated_by varchar(64), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designer_image_assets_project_slot_unique UNIQUE (project_code, slot_key),
  CONSTRAINT designer_image_assets_category_check CHECK (category IN ('person_intro', 'person_expression', 'visit_scene')),
  CONSTRAINT designer_image_assets_mime_type_check CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT designer_image_assets_slot_key_check CHECK (
    (category = 'person_intro' AND person_id IN ('P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005') AND slot_key = 'person_intro:' || person_id)
    OR (category = 'person_expression' AND person_id IN ('P1-001', 'P1-002', 'P1-003', 'P1-004', 'P1-005') AND slot_key ~ '^person_expression:P1-00[1-5]:(angry|serious|calm|pleasant|very_happy)$')
    OR (category = 'visit_scene' AND person_id IS NULL AND slot_key ~ '^visit_scene:(office|restaurant|elevator|bar)$')
  )
);
CREATE INDEX IF NOT EXISTS designer_image_assets_project_category_idx ON public.designer_image_assets (project_code, category);
ALTER TABLE public.designer_image_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS designer_image_assets_service_role_only ON public.designer_image_assets;
CREATE POLICY designer_image_assets_service_role_only ON public.designer_image_assets AS RESTRICTIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.designer_image_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.designer_image_assets TO service_role;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('designer-image-assets', 'designer-image-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS designer_image_assets_storage_service_role_only ON storage.objects;
CREATE POLICY designer_image_assets_storage_service_role_only ON storage.objects AS RESTRICTIVE FOR ALL TO service_role USING (bucket_id = 'designer-image-assets') WITH CHECK (bucket_id = 'designer-image-assets');
