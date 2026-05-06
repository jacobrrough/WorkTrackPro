import type { InventoryItem, Job } from '@/core/types';

function toSearchable(value: string | number | undefined): string {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

export function matchesJobSearch(job: Job, normalizedQuery: string): boolean {
  const query = normalizedQuery.trim().toLowerCase();
  if (!query) return true;

  const searchableFields = [
    job.jobCode,
    job.po,
    job.name,
    job.description,
    job.status,
    job.binLocation,
    job.partNumber,
    job.estNumber,
    job.invNumber,
    job.rfqNumber,
    job.owrNumber,
  ];

  return searchableFields.some((field) => toSearchable(field).includes(query));
}

export function matchesInventorySearch(item: InventoryItem, normalizedQuery: string): boolean {
  const query = normalizedQuery.trim().toLowerCase();
  if (!query) return true;

  const searchableFields = [
    item.name,
    item.description,
    item.category,
    item.barcode,
    item.binLocation,
  ];

  return searchableFields.some((field) => toSearchable(field).includes(query));
}
