import type { Job } from '@/core/types';

export function dedupeJobsById(items: Job[]): Job[] {
  const seen = new Set<string>();
  const unique: Job[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}
