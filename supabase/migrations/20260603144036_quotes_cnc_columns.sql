-- Persist the CNC component of a quote so a reloaded quote reconciles. The saved
-- subtotal/total already include CNC cost (Quotes.tsx), but cnc_hours/cnc_rate/cnc_cost
-- were dropped at the persistence boundary, so the breakdown couldn't be restored.
-- Additive + safe (defaults 0). APPLIED to live 2026-06-03.
alter table public.quotes
  add column if not exists cnc_hours numeric not null default 0,
  add column if not exists cnc_rate  numeric not null default 0,
  add column if not exists cnc_cost  numeric not null default 0;
