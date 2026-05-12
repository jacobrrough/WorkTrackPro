-- Custom Kanban Boards: boards, columns, cards, and member sharing
-- This migration is IDEMPOTENT - safe to run multiple times.

-- Boards
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id),
  visibility text not null default 'private',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_boards_created_by') then
    create index if not exists idx_boards_created_by on public.boards(created_by);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_boards_visibility') then
    create index if not exists idx_boards_visibility on public.boards(visibility);
  end if;
end $$;

-- Board columns
create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  color text,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_columns_board') then
    create index if not exists idx_board_columns_board on public.board_columns(board_id);
  end if;
end $$;

-- Board cards (standalone tasks)
create table if not exists public.board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.board_columns(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references public.profiles(id),
  due_date date,
  color text,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_cards_column') then
    create index if not exists idx_board_cards_column on public.board_cards(column_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_cards_board') then
    create index if not exists idx_board_cards_board on public.board_cards(board_id);
  end if;
end $$;

-- Board members (per-user sharing)
create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor',
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_members_board') then
    create index if not exists idx_board_members_board on public.board_members(board_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_board_members_user') then
    create index if not exists idx_board_members_user on public.board_members(user_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'board_members_board_user_unique'
    and conrelid = 'public.board_members'::regclass
  ) then
    alter table public.board_members add constraint board_members_board_user_unique unique (board_id, user_id);
  end if;
end $$;

-- RLS
alter table public.boards enable row level security;
alter table public.board_columns enable row level security;
alter table public.board_cards enable row level security;
alter table public.board_members enable row level security;

-- Board policies: visibility-based SELECT, owner-only write
drop policy if exists "Board select" on public.boards;
create policy "Board select" on public.boards for select to authenticated using (
  created_by = auth.uid()
  or visibility = 'everyone'
  or (visibility = 'members' and exists (
    select 1 from public.board_members where board_id = id and user_id = auth.uid()
  ))
);

drop policy if exists "Board insert" on public.boards;
create policy "Board insert" on public.boards for insert to authenticated with check (
  created_by = auth.uid()
);

drop policy if exists "Board update" on public.boards;
create policy "Board update" on public.boards for update to authenticated using (
  created_by = auth.uid()
);

drop policy if exists "Board delete" on public.boards;
create policy "Board delete" on public.boards for delete to authenticated using (
  created_by = auth.uid()
);

-- Child tables: permissive authenticated (board-level RLS handles gating)
drop policy if exists "Authenticated board_columns" on public.board_columns;
create policy "Authenticated board_columns" on public.board_columns for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated board_cards" on public.board_cards;
create policy "Authenticated board_cards" on public.board_cards for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated board_members" on public.board_members;
create policy "Authenticated board_members" on public.board_members for all to authenticated using (true) with check (true);
