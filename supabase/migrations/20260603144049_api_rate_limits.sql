-- Persistent sliding-window rate limiter for the public serverless endpoints
-- (submit-proposal by IP, ai-chat by user). Netlify Functions don't share memory across
-- invocations, so the counter must live in Postgres. Only service_role (used by the
-- functions, bypassing RLS) may touch it. APPLIED to live 2026-06-03.
create table if not exists public.api_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);
alter table public.api_rate_limits enable row level security;
-- Intentionally NO policies: anon/authenticated get zero access.
create index if not exists idx_api_rate_limits_window on public.api_rate_limits(window_start);

create or replace function public.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public.api_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else r.window_start end,
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else r.count + 1 end
  returning r.count into v_count;
  return v_count <= p_max;
end;
$$;
revoke all on function public.check_rate_limit(text,int,int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text,int,int) to service_role;
