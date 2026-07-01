import React, { useEffect, useMemo, useState } from 'react';
import type { InventoryItem, Job, JobStatus, ViewState } from '@/core/types';
import { getCategoryDisplayName, getStatusDisplayName } from '@/core/types';
import { matchesInventorySearch, matchesJobSearch } from '@/lib/jobSearch';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchAutocompleteProps {
  jobs: Job[];
  inventory: InventoryItem[];
  isAdmin: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSubmit: (term: string) => void;
  onNavigateDirect: (view: ViewState, id?: string) => void;
}

type SuggestionType = 'job' | 'inventory' | 'status' | 'search';

interface Suggestion {
  type: SuggestionType;
  id: string;
  label: string;
  sublabel?: string;
  icon: string;
  view?: ViewState;
  viewId?: string;
  searchTerm?: string;
}

const SHOP_FLOOR_STATUSES: JobStatus[] = [
  'pending',
  'rush',
  'inProgress',
  'qualityControl',
  'finished',
  'delivered',
  'onHold',
];

const ADMIN_ONLY_STATUSES: JobStatus[] = [
  'toBeQuoted',
  'quoted',
  'rfqReceived',
  'rfqSent',
  'pod',
  'waitingForPayment',
  'projectCompleted',
];

const SearchAutocomplete: React.FC<SearchAutocompleteProps> = ({
  jobs,
  inventory,
  isAdmin,
  searchInput,
  onSearchInputChange,
  onSubmit,
  onNavigateDirect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = 'search-autocomplete-listbox';

  const debouncedQuery = useDebounce(searchInput.trim(), 200);
  const query = debouncedQuery.toLowerCase();

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!query) return [];

    const results: Suggestion[] = [];

    const matchingJobs = jobs.filter((j) => matchesJobSearch(j, query)).slice(0, 5);
    for (const job of matchingJobs) {
      results.push({
        type: 'job',
        id: `job-${job.id}`,
        label: `#${job.jobCode} ${job.name}`,
        sublabel: job.po ? `PO: ${job.po}` : undefined,
        icon: 'assignment',
        view: 'job-detail',
        viewId: job.id,
      });
    }

    const matchingInventory = inventory.filter((i) => matchesInventorySearch(i, query)).slice(0, 3);
    for (const item of matchingInventory) {
      results.push({
        type: 'inventory',
        id: `inv-${item.id}`,
        label: item.name,
        sublabel: getCategoryDisplayName(item.category),
        icon: 'inventory_2',
        view: 'inventory-detail',
        viewId: item.id,
      });
    }

    const availableStatuses = isAdmin
      ? [...SHOP_FLOOR_STATUSES, ...ADMIN_ONLY_STATUSES]
      : SHOP_FLOOR_STATUSES;
    const matchingStatuses = availableStatuses
      .filter((s) => getStatusDisplayName(s).toLowerCase().includes(query))
      .slice(0, 3);
    for (const status of matchingStatuses) {
      results.push({
        type: 'status',
        id: `status-${status}`,
        label: `Status: ${getStatusDisplayName(status)}`,
        icon: 'filter_list',
        searchTerm: status,
      });
    }

    results.push({
      type: 'search',
      id: 'search-fallback',
      label: `Search for "${debouncedQuery}"`,
      icon: 'search',
      searchTerm: debouncedQuery,
    });

    return results;
  }, [query, debouncedQuery, jobs, inventory, isAdmin]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  const selectSuggestion = (suggestion: Suggestion) => {
    setIsOpen(false);
    setActiveIndex(-1);

    if (suggestion.view && suggestion.viewId) {
      onNavigateDirect(suggestion.view, suggestion.viewId);
    } else if (suggestion.searchTerm != null) {
      onSubmit(suggestion.searchTerm);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      selectSuggestion(suggestions[activeIndex]);
    } else {
      setIsOpen(false);
      onSubmit(searchInput.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const activeDescendant = activeIndex >= 0 ? suggestions[activeIndex]?.id : undefined;

  const categoryLabel = (type: SuggestionType) => {
    switch (type) {
      case 'job':
        return 'Jobs';
      case 'inventory':
        return 'Inventory';
      case 'status':
        return 'Status Filters';
      default:
        return null;
    }
  };

  const showCategoryHeader = (index: number) => {
    const current = suggestions[index];
    if (current.type === 'search') return false;
    if (index === 0) return true;
    return suggestions[index - 1].type !== current.type;
  };

  return (
    <form onSubmit={handleSubmit} className="relative mb-4" role="search" aria-label="Search jobs">
      <label htmlFor="dashboard-search" className="sr-only">
        Search jobs, PO, description, bin location, or status
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
        >
          search
        </span>
        <input
          id="dashboard-search"
          type="search"
          role="combobox"
          aria-expanded={isOpen && suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          value={searchInput}
          onChange={(e) => {
            onSearchInputChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (searchInput.trim()) setIsOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search jobs, PO, description, bin, status..."
          className="w-full rounded-lg border border-line bg-surface-2 py-2.5 pl-10 pr-3 text-white placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Search"
        />

        {isOpen && suggestions.length > 0 && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto rounded-lg border border-line bg-app-2 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <React.Fragment key={suggestion.id}>
                {showCategoryHeader(index) && (
                  <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-primary">
                    {categoryLabel(suggestion.type)}
                  </div>
                )}
                <button
                  id={suggestion.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    index === activeIndex ? 'bg-primary/20' : 'hover:bg-overlay/5'
                  } ${suggestion.type === 'search' ? 'border-t border-line' : ''}`}
                >
                  <span className="material-symbols-outlined text-lg text-muted">
                    {suggestion.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{suggestion.label}</div>
                    {suggestion.sublabel && (
                      <div className="truncate text-xs text-muted">{suggestion.sublabel}</div>
                    )}
                  </div>
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </form>
  );
};

export default SearchAutocomplete;
