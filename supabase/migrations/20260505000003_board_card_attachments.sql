-- Allow attachments to be owned by board_cards (in addition to jobs/inventory/parts)
-- Idempotent migration.

alter table public.attachments
  add column if not exists board_card_id uuid references public.board_cards(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_attachments_board_card') then
    create index idx_attachments_board_card on public.attachments(board_card_id) where board_card_id is not null;
  end if;
end $$;

-- Replace one-owner check to allow board_card_id as a fourth alternative.
alter table public.attachments drop constraint if exists attachments_one_owner_check;
alter table public.attachments add constraint attachments_one_owner_check check (
  (job_id is not null and inventory_id is null and part_id is null and board_card_id is null) or
  (job_id is null and inventory_id is not null and part_id is null and board_card_id is null) or
  (job_id is null and inventory_id is null and part_id is not null and board_card_id is null) or
  (job_id is null and inventory_id is null and part_id is null and board_card_id is not null)
);
