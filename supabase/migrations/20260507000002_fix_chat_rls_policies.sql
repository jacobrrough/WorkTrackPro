-- Fix: Re-apply RLS policies for chat tables.
-- The original migration may have partially applied, leaving RLS enabled
-- but without the necessary policies (which blocks all access).

-- =============================================
-- conversations
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
-- conversation_members
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
        select 1 from public.conversation_members
        where conversation_id = conversation_members.conversation_id
          and user_id = auth.uid()
          and role = 'admin'
          and left_at is null
      )
    )
  );

-- =============================================
-- messages
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
-- message_receipts
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
-- message_attachments
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
-- user_encryption_keys
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
