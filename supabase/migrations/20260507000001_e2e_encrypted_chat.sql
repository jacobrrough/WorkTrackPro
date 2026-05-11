-- E2E Encrypted Chat: conversations, messages, encryption keys, receipts, attachments.
-- Idempotent migration.

-- =============================================
-- 1. USER ENCRYPTION KEYS
-- =============================================
create table if not exists public.user_encryption_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  public_key text not null,
  encrypted_private_key text not null,
  key_salt text not null,
  key_iv text not null,
  algorithm text not null default 'ECDH-P256-AES-GCM',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_encryption_keys_user_unique'
  ) then
    alter table public.user_encryption_keys
    add constraint user_encryption_keys_user_unique unique (user_id);
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'idx_encryption_keys_user') then
    create index idx_encryption_keys_user on public.user_encryption_keys(user_id);
  end if;
end $$;

-- =============================================
-- 2. CONVERSATIONS
-- =============================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct',
  name text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_conversations_type') then
    create index idx_conversations_type on public.conversations(type);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_conversations_created_by') then
    create index idx_conversations_created_by on public.conversations(created_by);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_conversations_updated_at') then
    create index idx_conversations_updated_at on public.conversations(updated_at desc);
  end if;
end $$;

-- =============================================
-- 3. CONVERSATION MEMBERS
-- =============================================
create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  encrypted_conversation_key text,
  key_iv text,
  role text not null default 'member',
  joined_at timestamptz default now(),
  left_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversation_members_conv_user_unique'
  ) then
    alter table public.conversation_members
    add constraint conversation_members_conv_user_unique unique (conversation_id, user_id);
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'idx_conv_members_conversation') then
    create index idx_conv_members_conversation on public.conversation_members(conversation_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_conv_members_user') then
    create index idx_conv_members_user on public.conversation_members(user_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_conv_members_active') then
    create index idx_conv_members_active on public.conversation_members(user_id) where left_at is null;
  end if;
end $$;

-- =============================================
-- 4. MESSAGES
-- =============================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  encrypted_content text not null,
  content_iv text not null,
  message_type text not null default 'text',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_messages_conversation') then
    create index idx_messages_conversation on public.messages(conversation_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_messages_conv_created') then
    create index idx_messages_conv_created on public.messages(conversation_id, created_at desc);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_messages_sender') then
    create index idx_messages_sender on public.messages(sender_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_messages_not_deleted') then
    create index idx_messages_not_deleted on public.messages(conversation_id, created_at desc) where deleted_at is null;
  end if;
end $$;

-- =============================================
-- 5. MESSAGE RECEIPTS
-- =============================================
create table if not exists public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'message_receipts_msg_user_unique'
  ) then
    alter table public.message_receipts
    add constraint message_receipts_msg_user_unique unique (message_id, user_id);
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'idx_message_receipts_message') then
    create index idx_message_receipts_message on public.message_receipts(message_id);
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_message_receipts_user') then
    create index idx_message_receipts_user on public.message_receipts(user_id);
  end if;
end $$;

-- =============================================
-- 6. MESSAGE ATTACHMENTS
-- =============================================
create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  encrypted_file_key text not null,
  file_key_iv text not null,
  file_iv text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null default 'application/octet-stream'
);

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_message_attachments_message') then
    create index idx_message_attachments_message on public.message_attachments(message_id);
  end if;
end $$;

-- =============================================
-- 7. HELPER: membership check
-- =============================================
create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv_id
      and user_id = auth.uid()
      and left_at is null
  );
$$;

-- =============================================
-- 8. HELPER: find existing direct conversation
-- =============================================
create or replace function public.find_direct_conversation(user_a uuid, user_b uuid)
returns uuid
language sql
stable
security definer
as $$
  select cm1.conversation_id
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join public.conversations c on c.id = cm1.conversation_id
  where cm1.user_id = user_a
    and cm2.user_id = user_b
    and c.type = 'direct'
    and cm1.left_at is null
    and cm2.left_at is null
  limit 1;
$$;

-- =============================================
-- 9. TRIGGER: bump conversation.updated_at on new message
-- =============================================
create or replace function public.update_conversation_timestamp()
returns trigger
security definer
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_message_insert_update_conversation on public.messages;
create trigger on_message_insert_update_conversation
  after insert on public.messages
  for each row execute function public.update_conversation_timestamp();

-- =============================================
-- 10. ENABLE RLS
-- =============================================
alter table public.user_encryption_keys enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_attachments enable row level security;

-- =============================================
-- 11. RLS: user_encryption_keys
-- =============================================
drop policy if exists "Own keys full access" on public.user_encryption_keys;
create policy "Own keys full access" on public.user_encryption_keys
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Read public keys" on public.user_encryption_keys;
create policy "Read public keys" on public.user_encryption_keys
  for select to authenticated
  using (public.is_approved_user());

-- =============================================
-- 12. RLS: conversations
-- =============================================
drop policy if exists "Members read conversations" on public.conversations;
create policy "Members read conversations" on public.conversations
  for select to authenticated
  using (
    public.is_approved_user()
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.conversation_members
        where conversation_id = id
          and user_id = auth.uid()
          and left_at is null
      )
    )
  );

drop policy if exists "Approved users create conversations" on public.conversations;
create policy "Approved users create conversations" on public.conversations
  for insert to authenticated
  with check (
    public.is_approved_user()
    and created_by = auth.uid()
  );

drop policy if exists "Conv admins update conversations" on public.conversations;
create policy "Conv admins update conversations" on public.conversations
  for update to authenticated
  using (
    public.is_approved_user()
    and exists (
      select 1 from public.conversation_members
      where conversation_id = id
        and user_id = auth.uid()
        and role = 'admin'
        and left_at is null
    )
  );

-- =============================================
-- 13. RLS: conversation_members
-- =============================================
drop policy if exists "Members read conversation_members" on public.conversation_members;
create policy "Members read conversation_members" on public.conversation_members
  for select to authenticated
  using (
    public.is_approved_user()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "Add conversation members" on public.conversation_members;
create policy "Add conversation members" on public.conversation_members
  for insert to authenticated
  with check (
    public.is_approved_user()
  );

drop policy if exists "Update conversation members" on public.conversation_members;
create policy "Update conversation members" on public.conversation_members
  for update to authenticated
  using (
    public.is_approved_user()
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = conversation_members.conversation_id
          and cm.user_id = auth.uid()
          and cm.role = 'admin'
          and cm.left_at is null
      )
    )
  );

-- =============================================
-- 14. RLS: messages
-- =============================================
drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages" on public.messages
  for select to authenticated
  using (
    public.is_approved_user()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "Members send messages" on public.messages;
create policy "Members send messages" on public.messages
  for insert to authenticated
  with check (
    public.is_approved_user()
    and sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "Sender update own messages" on public.messages;
create policy "Sender update own messages" on public.messages
  for update to authenticated
  using (
    public.is_approved_user()
    and sender_id = auth.uid()
  );

-- =============================================
-- 15. RLS: message_receipts
-- =============================================
drop policy if exists "Members read receipts" on public.message_receipts;
create policy "Members read receipts" on public.message_receipts
  for select to authenticated
  using (
    public.is_approved_user()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "Users insert own receipts" on public.message_receipts;
create policy "Users insert own receipts" on public.message_receipts
  for insert to authenticated
  with check (
    public.is_approved_user()
    and user_id = auth.uid()
  );

drop policy if exists "Users update own receipts" on public.message_receipts;
create policy "Users update own receipts" on public.message_receipts
  for update to authenticated
  using (
    public.is_approved_user()
    and user_id = auth.uid()
  );

-- =============================================
-- 16. RLS: message_attachments
-- =============================================
drop policy if exists "Members read message_attachments" on public.message_attachments;
create policy "Members read message_attachments" on public.message_attachments
  for select to authenticated
  using (
    public.is_approved_user()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "Sender insert message_attachments" on public.message_attachments;
create policy "Sender insert message_attachments" on public.message_attachments
  for insert to authenticated
  with check (
    public.is_approved_user()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and m.sender_id = auth.uid()
    )
  );

-- =============================================
-- 17. STORAGE: chat-attachments bucket policies
-- =============================================
drop policy if exists "Chat attachments: member upload" on storage.objects;
create policy "Chat attachments: member upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and public.is_approved_user()
);

drop policy if exists "Chat attachments: member read" on storage.objects;
create policy "Chat attachments: member read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.is_approved_user()
);

drop policy if exists "Chat attachments: member delete" on storage.objects;
create policy "Chat attachments: member delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.is_approved_user()
);
