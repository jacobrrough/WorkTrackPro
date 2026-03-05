import type { Job } from '@/core/types';

/**
 * ECD = last possible contracted delivery date. Automation never writes ECD.
 * When applying a planned completion date, we must not set it past ECD without user approval.
 */
export function requiresPastEcdApproval(job: Job, newCompletionDate: string): boolean {
  const ecd = job.ecd?.trim();
  if (!ecd) return false;
  const ecdKey = ecd.split(/[T ]/)[0];
  const newKey = newCompletionDate.split(/[T ]/)[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ecdKey) || !/^\d{4}-\d{2}-\d{2}$/.test(newKey)) return false;
  return newKey > ecdKey;
}
