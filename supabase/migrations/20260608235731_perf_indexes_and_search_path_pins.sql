-- Performance + security follow-ups (from the live Supabase advisor).
--
-- 1. Index the 20 unindexed foreign keys in the public schema. An unindexed FK makes
--    cascade deletes and filtered joins scan as the referenced tables grow; adding the
--    covering index is additive and safe. Idempotent (create index if not exists).
-- 2. Pin search_path on the two remaining SECURITY DEFINER functions the advisor still
--    flagged after the 20260608232336 hardening migration (part_id_from_attachment_path,
--    build_default_notification_preferences). ALTER only — bodies are untouched.
--
-- Applied live as migration 20260608235731.

-- ── 1. Foreign-key indexes ────────────────────────────────────────────────────
create index if not exists idx_board_cards_assignee_id on public.board_cards (assignee_id);
create index if not exists idx_checklist_history_checklist_id on public.checklist_history (checklist_id);
create index if not exists idx_checklist_history_user_id on public.checklist_history (user_id);
create index if not exists idx_comments_user_id on public.comments (user_id);
create index if not exists idx_customer_proposals_linked_job_id on public.customer_proposals (linked_job_id);
create index if not exists idx_deliveries_created_by on public.deliveries (created_by);
create index if not exists idx_inventory_history_related_job_id on public.inventory_history (related_job_id);
create index if not exists idx_inventory_history_user_id on public.inventory_history (user_id);
create index if not exists idx_job_status_history_user_id on public.job_status_history (user_id);
create index if not exists idx_jobs_cnc_completed_by on public.jobs (cnc_completed_by);
create index if not exists idx_jobs_created_by on public.jobs (created_by);
create index if not exists idx_jobs_part_number on public.jobs (part_number);
create index if not exists idx_jobs_printer3d_completed_by on public.jobs (printer3d_completed_by);
create index if not exists idx_organization_settings_updated_by on public.organization_settings (updated_by);
create index if not exists idx_part_materials_part_variant_id on public.part_materials (part_variant_id);
create index if not exists idx_part_revision_history_changed_by on public.part_revision_history (changed_by);
create index if not exists idx_profiles_approved_by on public.profiles (approved_by);
create index if not exists idx_quotes_created_by on public.quotes (created_by);
create index if not exists idx_shift_edits_edited_by on public.shift_edits (edited_by);
create index if not exists idx_shift_edits_shift_id on public.shift_edits (shift_id);

-- ── 2. Pin search_path on the last two flagged definer functions ───────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('part_id_from_attachment_path', 'build_default_notification_preferences')
  loop
    execute format('alter function %s set search_path = public, pg_catalog', r.sig);
  end loop;
end $$;
