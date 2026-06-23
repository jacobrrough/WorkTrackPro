-- Email-delivery bookkeeping for system notifications.
--
-- emailed_at marks when the notification-emails Netlify function sent a digest email
-- containing this notification (null = not yet emailed). The partial index keeps the
-- every-few-minutes "pending email" poll cheap as the table grows.
--
-- Adding a nullable column is a metadata-only change (no table rewrite, no lock concern);
-- it does not affect RLS or the existing realtime subscription to this table.
-- Idempotent.

alter table public.system_notifications
  add column if not exists emailed_at timestamptz;

comment on column public.system_notifications.emailed_at is
  'When a digest email covering this notification was sent (netlify/functions/notification-emails.mjs). Null = not emailed.';

create index if not exists system_notifications_pending_email_idx
  on public.system_notifications (created_at)
  where emailed_at is null;
