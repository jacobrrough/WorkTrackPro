-- Admin-defined inventory categories.
-- Stored as a jsonb array of {key,label} objects, layered on top of the 7 built-in categories
-- defined in code (src/core/types.ts). Mirrors cnc_able_categories (20260622000001).
-- Org-wide setting; defaults to an empty array (no custom categories).
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS custom_inventory_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
