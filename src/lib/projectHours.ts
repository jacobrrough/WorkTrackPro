import type { ProjectHourEntry, ProjectHours } from '@/core/types';

/**
 * Default hourly pay rate for project-hours entries. Single source of truth; mirrored by
 * the project_hour_entries.rate column default in the DB. The rate is global and is NOT
 * historized in JS — each entry snapshots its own `rate` at insert time, so changing this
 * constant only affects new entries, never past pay totals.
 */
export const PROJECT_HOURS_RATE = 19;

/** Pay in dollars, rounded to cents. */
export function payFromHours(hours: number, rate: number = PROJECT_HOURS_RATE): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * rate * 100) / 100;
}

/** Largest hours value a single entry may hold (mirrors the DB check `hours <= 24`). */
export const MAX_ENTRY_HOURS = 24;

export interface ParsedHours {
  valid: boolean;
  hours: number; // rounded to cents; 0 when invalid
}

/**
 * Parse and validate a raw hours input string. Validation is applied to the *rounded*
 * value (rounded to 2dp, matching numeric(6,2)) so a sub-0.005 entry that rounds to 0 is
 * rejected here rather than silently failing the DB `hours > 0` check. Bounds mirror the
 * DB so the client never submits a value the database will reject.
 */
export function parseHoursInput(raw: string): ParsedHours {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return { valid: false, hours: 0 };
  const rounded = Math.round(parsed * 100) / 100;
  const valid = rounded > 0 && rounded <= MAX_ENTRY_HOURS;
  return { valid, hours: valid ? rounded : 0 };
}

/** Pay for a single entry using its snapshotted rate. */
export function computeEntryPay(entry: ProjectHourEntry): number {
  return payFromHours(entry.hours, entry.rate);
}

/** Format a dollar amount as $X.XX. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export interface ProjectHourTotals {
  totalHours: number;
  totalPay: number;
}

/**
 * Aggregate a set of entries. Pay is summed per-entry (each rounded to cents) so that
 * per-entry, per-project, and roll-up totals always reconcile to the penny. Hours are
 * rounded to 2dp to match the numeric(6,2) column and avoid float drift in the display.
 */
export function computeProjectTotals(entries: ProjectHourEntry[]): ProjectHourTotals {
  let totalHours = 0;
  let totalPay = 0;
  for (const e of entries) {
    if (!Number.isFinite(e.hours) || e.hours <= 0) continue;
    totalHours += e.hours;
    totalPay += computeEntryPay(e);
  }
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    totalPay: Math.round(totalPay * 100) / 100,
  };
}

/** Count entries per project id (unfiltered) — drives the delete-cascade warning. */
export function countEntriesByProject(entries: ProjectHourEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.projectId, (counts.get(e.projectId) ?? 0) + 1);
  }
  return counts;
}

/** Confirmation copy for permanently deleting a project and its cascaded entries. */
export function deleteProjectMessage(name: string, entryCount: number): string {
  if (entryCount <= 0) {
    return `Permanently delete "${name}"? This cannot be undone.`;
  }
  const noun = entryCount === 1 ? 'entry' : 'entries';
  return `Permanently delete "${name}" and its ${entryCount} logged ${noun}? This cannot be undone. To keep the record, use Archive instead.`;
}

/** One CSV row per entry; pay column equals the on-screen per-entry pay. */
export function buildExportRows(
  projects: ProjectHours[],
  entries: ProjectHourEntry[]
): Record<string, unknown>[] {
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  return entries.map((e) => ({
    Project: projectName.get(e.projectId) ?? '(unknown)',
    Date: e.entryDate,
    Hours: e.hours,
    Rate: e.rate,
    Pay: computeEntryPay(e).toFixed(2),
    Note: e.note ?? '',
  }));
}
