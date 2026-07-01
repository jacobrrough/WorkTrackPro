/**
 * Shared filter controls for the document lists (invoices, estimates, bills): a text search
 * (number + party name), a status dropdown, and a document-date range. Status semantics:
 *   'all'    → everything
 *   'active' → hide voided (the default for invoices/bills — the "void & remove" behavior)
 *   <status> → exactly that status
 * The bar is presentational; the parent owns the DocFilters state and runs applyDocFilters.
 */

export interface DocFilters {
  search: string;
  status: string;
  from: string;
  to: string;
}

export interface DocStatusOption {
  value: string;
  label: string;
}

/** Initial filter state; the default status is the caller's first option ('active' hides void). */
export function initialDocFilters(defaultStatus = 'all'): DocFilters {
  return { search: '', status: defaultStatus, from: '', to: '' };
}

export interface DocFilterAccessors<T> {
  number: (item: T) => string | null | undefined;
  party: (item: T) => string | null | undefined;
  /** Document date as YYYY-MM-DD (ISO strings compare lexicographically). */
  date: (item: T) => string | null | undefined;
  status: (item: T) => string;
}

/** Pure filter over search (number|party), status, and an inclusive date range. */
export function applyDocFilters<T>(items: T[], f: DocFilters, a: DocFilterAccessors<T>): T[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((it) => {
    const status = a.status(it);
    if (f.status === 'active') {
      if (status === 'void') return false;
    } else if (f.status !== 'all') {
      if (status !== f.status) return false;
    }
    const d = a.date(it) ?? '';
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (q) {
      const hay = `${a.number(it) ?? ''} ${a.party(it) ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const ctrl =
  'rounded-lg border border-line bg-background-dark px-2 py-1 text-xs text-muted focus:border-primary focus:outline-none';

export function DocumentFilterBar({
  filters,
  onChange,
  statusOptions,
  searchPlaceholder,
  resultCount,
  totalCount,
}: {
  filters: DocFilters;
  onChange: (next: DocFilters) => void;
  statusOptions: DocStatusOption[];
  searchPlaceholder?: string;
  resultCount: number;
  totalCount: number;
}) {
  const defaultStatus = statusOptions[0]?.value ?? 'all';
  const dirty =
    filters.search !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.status !== defaultStatus;
  const set = (patch: Partial<DocFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <input
        type="search"
        aria-label="Search"
        placeholder={searchPlaceholder ?? 'Search…'}
        className={`${ctrl} min-w-[10rem] flex-1`}
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <select
        aria-label="Filter by status"
        className={ctrl}
        value={filters.status}
        onChange={(e) => set({ status: e.target.value })}
      >
        {statusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-subtle">
        <span className="hidden sm:inline">From</span>
        <input
          type="date"
          aria-label="From date"
          className={ctrl}
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-subtle">
        <span className="hidden sm:inline">To</span>
        <input
          type="date"
          aria-label="To date"
          className={ctrl}
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
        />
      </label>
      {dirty && (
        <button
          type="button"
          onClick={() => onChange(initialDocFilters(defaultStatus))}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-white/10 hover:text-white"
        >
          Clear
        </button>
      )}
      <span className="ml-auto text-xs text-subtle">
        {resultCount} of {totalCount}
      </span>
    </div>
  );
}
