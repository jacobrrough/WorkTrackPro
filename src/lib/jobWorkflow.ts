import type { JobStatus } from '@/core/types';

/**
 * Canonical automatic status flow for checklist-driven movement.
 * Excludes 'onHold' and 'rush' (not linear production steps).
 * 'projectCompleted' and 'paid' are included because both advances are
 * checklist-driven: waitingForPayment → projectCompleted (via checklist),
 * then projectCompleted → paid (via checklist + name rebuild).
 * 'paid' is the final entry; nothing advances beyond it.
 */
export const AUTO_WORKFLOW_STATUSES: readonly JobStatus[] = [
  'toBeQuoted',
  'quoted',
  'rfqReceived',
  'rfqSent',
  'pod',
  'pending',
  'inProgress',
  'qualityControl',
  'finished',
  'delivered',
  'waitingForPayment',
  'projectCompleted',
  'paid',
];

export function getNextWorkflowStatus(status: JobStatus): JobStatus | null {
  const idx = AUTO_WORKFLOW_STATUSES.indexOf(status);
  if (idx === -1 || idx === AUTO_WORKFLOW_STATUSES.length - 1) return null;
  return AUTO_WORKFLOW_STATUSES[idx + 1];
}

/**
 * The single truly terminal status — 'paid' closes the job lifecycle.
 * No checklist is seeded for 'paid' (use isTerminalStatus() to guard that call).
 * 'projectCompleted' is NOT terminal: its checklist drives the final advance to 'paid'.
 */
export const TERMINAL_STATUSES: readonly JobStatus[] = ['paid'];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const ALLOW_PARTS_EDIT_STATUSES: Set<JobStatus> = new Set([
  'toBeQuoted',
  'quoted',
  'rfqReceived',
]);

export function isPartsEditingAllowed(status: JobStatus): boolean {
  return ALLOW_PARTS_EDIT_STATUSES.has(status);
}

export function getPartsLockedReason(status: JobStatus): string | null {
  if (ALLOW_PARTS_EDIT_STATUSES.has(status)) return null;
  return 'Parts info is locked after RFQ Sent';
}
