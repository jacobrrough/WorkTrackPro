-- Company branding for packing slips (and future documents)
-- Stored as a single jsonb blob on the org-wide settings row so it can hold
-- name/address/phone/email plus an uploaded logo (base64 data URL).
-- Additive + idempotent: safe to re-run.

alter table public.organization_settings
  add column if not exists branding jsonb not null default '{}'::jsonb;

comment on column public.organization_settings.branding is
  'Packing-slip / document branding: { companyName, companyAddress, companyPhone, companyEmail, logoDataUrl }. logoDataUrl is a base64 data URL so it prints without CORS issues and works offline.';
