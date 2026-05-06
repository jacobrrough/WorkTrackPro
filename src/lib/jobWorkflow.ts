import type { JobStatus } from '@/core/types';

/**
 * Canonical automatic status flow for checklist-driven movement.
 * Intentionally excludes "onHold" from auto-advance.
 */
export const AUTO_WORKFLOW_STATUSES: JobStatus[] = [
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
];

export function isAutoFlowStatus(status: JobStatus): boolean {
  return AUTO_WORKFLOW_STATUSES.includes(status);
}

export function getNextWorkflowStatus(status: JobStatus): JobStatus | null {
  const idx = AUTO_WORKFLOW_STATUSES.indexOf(status);
  if (idx === -1 || idx === AUTO_WORKFLOW_STATUSES.length - 1) return null;
  return AUTO_WORKFLOW_STATUSES[idx + 1];
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
