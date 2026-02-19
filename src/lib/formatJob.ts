/**
 * Format job code for display (e.g. 1234 → "#1234").
 */
export function formatJobCode(jobCode: number | undefined | null): string {
  if (jobCode == null) return '#—';
  return `#${jobCode}`;
}

/**
 * Format dash quantities for display (e.g. { "-01": 5, "-05": 10 } → "-01 ×5, -05 ×10").
 * Suffix can be stored with or without leading dash; display with dash.
 */
export function formatDashSummary(
  dashQuantities: Record<string, number> | undefined | null,
  _partNumber?: string
): string {
  if (!dashQuantities || Object.keys(dashQuantities).length === 0) return '';
  const parts = Object.entries(dashQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([suffix, qty]) => {
      const dash = suffix.startsWith('-') ? suffix : `-${suffix}`;
      return `${dash} ×${qty}`;
    });
  return parts.join(', ');
}

/**
 * Total quantity from dash quantities.
 */
export function totalFromDashQuantities(
  dashQuantities: Record<string, number> | undefined | null
): number {
  if (!dashQuantities) return 0;
  return Object.values(dashQuantities).reduce((sum, q) => sum + q, 0);
}

/**
 * Format set composition for display (e.g. { "01": 2, "05": 1 } → "2× -01, 1× -05").
 */
export function formatSetComposition(
  setComposition: Record<string, number> | undefined | null
): string {
  if (!setComposition || Object.keys(setComposition).length === 0) return '';
  return Object.entries(setComposition)
    .filter(([, qty]) => qty > 0)
    .map(([suffix, qty]) => {
      const dash = suffix.startsWith('-') ? suffix : `-${suffix}`;
      return `${qty}× ${dash}`;
    })
    .join(', ');
}

/** Standard order for all job identity fields: Part Number, Rev, Part Name, Qty, EST #, RFQ #, PO #, INV# */
export const JOB_FIELD_ORDER = [
  { key: 'partNumber', label: 'Part Number' },
  { key: 'revision', label: 'Rev' },
  { key: 'name', label: 'Part Name' },
  { key: 'qty', label: 'Qty' },
  { key: 'estNumber', label: 'EST #' },
  { key: 'rfqNumber', label: 'RFQ #' },
  { key: 'po', label: 'PO #' },
  { key: 'invNumber', label: 'INV#' },
] as const;

export type JobFieldKey = (typeof JOB_FIELD_ORDER)[number]['key'];

/**
 * Returns job identity fields in standard order for display. Only includes entries with a value.
 */
export function getJobFieldsInOrder(job: {
  partNumber?: string;
  revision?: string;
  name?: string;
  qty?: string;
  estNumber?: string;
  rfqNumber?: string;
  po?: string;
  invNumber?: string;
  dashQuantities?: Record<string, number>;
}): { label: string; value: string }[] {
  const qtyDisplay =
    job.dashQuantities && Object.keys(job.dashQuantities).length > 0
      ? formatDashSummary(job.dashQuantities)
      : (job.qty ?? '').trim();
  const entries: { label: string; value: string }[] = [];
  for (const { key, label } of JOB_FIELD_ORDER) {
    let value = '';
    if (key === 'partNumber') value = (job.partNumber ?? '').trim();
    else if (key === 'revision') value = (job.revision ?? '').trim();
    else if (key === 'name') value = (job.name ?? '').trim();
    else if (key === 'qty') value = qtyDisplay;
    else if (key === 'estNumber') value = (job.estNumber ?? '').trim();
    else if (key === 'rfqNumber') value = (job.rfqNumber ?? '').trim();
    else if (key === 'po') value = (job.po ?? '').trim();
    else if (key === 'invNumber') value = (job.invNumber ?? '').trim();
    if (value) entries.push({ label, value });
  }
  return entries;
}

/**
 * Single line for cards: "Part# Rev Name Qty EST# RFQ# PO# INV#" (only non-empty).
 */
export function formatJobIdentityLine(job: {
  partNumber?: string;
  revision?: string;
  name?: string;
  qty?: string;
  estNumber?: string;
  rfqNumber?: string;
  po?: string;
  invNumber?: string;
  dashQuantities?: Record<string, number>;
}): string {
  const fields = getJobFieldsInOrder(job);
  return fields.map((f) => f.value).join(' · ');
}

/**
 * Build part + REV string (e.g. "SK-F35-0197 REV A" or "SK-F35-0197").
 */
function partAndRev(partNumber: string | undefined, revision: string | undefined): string {
  if (!partNumber) return '';
  const rev = (revision ?? '').trim();
  return rev ? `${partNumber} REV ${rev}` : partNumber;
}

/**
 * Job display name by workflow stage:
 * Part → Part REV → Part REV EST # n → PO# n (with part/REV underneath) → after paid: Part REV
 */
export function getJobDisplayName(job: {
  partNumber?: string;
  revision?: string;
  estNumber?: string;
  po?: string;
  status?: string;
  name?: string;
}): string {
  const part = (job.partNumber ?? '').trim();
  const rev = (job.revision ?? '').trim();
  const est = (job.estNumber ?? '').trim();
  const po = (job.po ?? '').trim();
  const isPaid = job.status === 'paid';

  if (isPaid) return partAndRev(part || undefined, rev || undefined) || job.name || '';
  if (po) return `PO# ${po}`;
  if (est && part) return partAndRev(part, rev || undefined) + ` EST # ${est}`;
  if (rev && part) return partAndRev(part, rev);
  if (part) return part;
  return job.name ?? '';
}

/**
 * When job has PO and is not paid, show part number and REV underneath the PO title.
 */
export function getJobDisplaySubline(job: {
  partNumber?: string;
  revision?: string;
  po?: string;
  status?: string;
}): string | null {
  if (job.status === 'paid') return null;
  const po = (job.po ?? '').trim();
  if (!po) return null;
  const line = partAndRev(
    (job.partNumber ?? '').trim() || undefined,
    (job.revision ?? '').trim() || undefined
  );
  return line || null;
}

/**
 * Build stored job name from convention (for save).
 * Part → Part REV → Part REV EST # n → PO# n → (when paid) Part REV
 */
export function buildJobNameFromConvention(job: {
  partNumber?: string;
  revision?: string;
  estNumber?: string;
  po?: string;
  status?: string;
  name?: string;
}): string {
  const part = (job.partNumber ?? '').trim();
  const rev = (job.revision ?? '').trim();
  const est = (job.estNumber ?? '').trim();
  const po = (job.po ?? '').trim();
  const isPaid = job.status === 'paid';

  if (isPaid) return partAndRev(part || undefined, rev || undefined) || job.name || '';
  if (po) return `PO# ${po}`;
  if (est && part) return partAndRev(part, rev || undefined) + ` EST # ${est}`;
  if (rev && part) return partAndRev(part, rev);
  if (part) return part;
  return job.name ?? '';
}

/**
 * Name to persist for a job: convention first, then fallback to "Job #" + jobCode.
 * Use this whenever saving job name so it is always auto-set from rules.
 */
export function getJobNameForSave(
  job: {
    partNumber?: string;
    revision?: string;
    estNumber?: string;
    po?: string;
    status?: string;
    name?: string;
  },
  jobCode: number
): string {
  const fromConvention = buildJobNameFromConvention(job);
  return fromConvention.trim() ? fromConvention : `Job #${jobCode}`;
}

/**
 * Calculate how many complete sets can be made from dash quantities given set composition.
 * Returns { completeSets, percentage }.
 */
export function calculateSetCompletion(
  dashQuantities: Record<string, number> | undefined | null,
  setComposition: Record<string, number> | undefined | null
): { completeSets: number; percentage: number } {
  if (!dashQuantities || !setComposition || Object.keys(setComposition).length === 0) {
    return { completeSets: 0, percentage: 0 };
  }

  let minSets = Infinity;
  for (const [suffix, requiredPerSet] of Object.entries(setComposition)) {
    if (requiredPerSet <= 0) continue;
    const ordered =
      dashQuantities[suffix] ||
      dashQuantities[`-${suffix}`] ||
      dashQuantities[suffix.replace(/^-/, '')] ||
      0;
    const setsPossible = Math.floor(ordered / requiredPerSet);
    minSets = Math.min(minSets, setsPossible);
  }

  if (minSets === Infinity) return { completeSets: 0, percentage: 0 };

  // Calculate percentage: sum of ordered quantities / sum of required quantities for one set
  const totalOrdered = Object.values(dashQuantities).reduce((sum, q) => sum + q, 0);
  const totalRequiredPerSet = Object.values(setComposition).reduce((sum, q) => sum + q, 0);
  const percentage =
    totalRequiredPerSet > 0 ? Math.min(100, (totalOrdered / totalRequiredPerSet) * 100) : 0;

  return { completeSets: minSets, percentage: Math.round(percentage) };
}
