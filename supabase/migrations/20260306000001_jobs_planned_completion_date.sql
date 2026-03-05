-- Planned completion date: internal schedule plan (calendar Apply). ECD remains reference-only.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS planned_completion_date date;

COMMENT ON COLUMN jobs.planned_completion_date IS 'Internal planned completion from calendar/scheduling; ECD is contract reference only.';
