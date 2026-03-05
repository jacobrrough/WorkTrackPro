-- User-estimated progress percent (0-100) for scheduling accuracy and progress bar
alter table public.jobs add column if not exists progress_estimate_percent numeric;

comment on column public.jobs.progress_estimate_percent is 'User-estimated completion percent (0-100). When set, used for progress bar and at-risk flag if implied total labor would exceed job labor estimate.';
