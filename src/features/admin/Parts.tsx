import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Part, Job, User } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import { useThrottle } from '@/useThrottle';

const PARTS_VIEW_KEY = '/admin/parts';

type PartsTab = 'all' | 'needs-attention' | 'in-jobs';

interface PartsProps {
  jobs: Job[];
  currentUser: User;
  onNavigate: (view: string, params?: { partId?: string } | string) => void;
  onNavigateBack: () => void;
}

const Parts: React.FC<PartsProps> = ({
  jobs,
  currentUser: _currentUser,
  onNavigate,
  onNavigateBack,
}) => {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { state, updateState } = useNavigation();
  const searchQuery = state.partsSearchTerm ?? '';
  const setSearchQuery = useCallback(
    (value: string) => updateState({ partsSearchTerm: value }),
    [updateState]
  );
  const [activeTab, setActiveTab] = useState<PartsTab>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef(state.scrollPositions);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    scrollPositionsRef.current = state.scrollPositions;
  }, [state.scrollPositions]);

  useEffect(() => {
    loadParts();
  }, []);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;
    const scrollPos = scrollPositionsRef.current[PARTS_VIEW_KEY] ?? 0;
    if (scrollPos <= 0 || !listRef.current) {
      hasRestoredScrollRef.current = true;
      return;
    }
    hasRestoredScrollRef.current = true;
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = scrollPos;
    });
  }, [loading, parts.length]);

  const handleScroll = useThrottle(() => {
    const el = listRef.current;
    if (!el) return;
    const nextScrollTop = el.scrollTop;
    if ((scrollPositionsRef.current[PARTS_VIEW_KEY] ?? 0) === nextScrollTop) return;
    updateState({
      scrollPositions: {
        ...scrollPositionsRef.current,
        [PARTS_VIEW_KEY]: nextScrollTop,
      },
    });
  }, 150);

  const loadParts = async () => {
    try {
      setLoading(true);
      const data = await partsService.getAllParts();
      setParts(data || []);
    } catch (error: unknown) {
      console.error('Error loading parts:', error);
      const err = error as { message?: string; code?: string };
      const errorMessage = err?.message ?? (typeof error === 'string' ? error : 'Unknown error');
      const errorCode = err?.code;
      if (errorCode === 'PGRST205' || errorCode === '42P01') {
        showToast('Parts table not found. Please run database migrations.', 'error');
      } else {
        showToast(`Failed to load parts: ${errorMessage}`, 'error');
      }
      setParts([]);
    } finally {
      setLoading(false);
    }
  };

  const partIdsInJobs = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => {
      if (j.partId) set.add(j.partId);
    });
    return set;
  }, [jobs]);

  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) return parts;
    const q = searchQuery.toLowerCase();
    return parts.filter(
      (p) =>
        p.partNumber.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }, [parts, searchQuery]);

  const filteredParts = useMemo(() => {
    if (activeTab === 'all') return filteredBySearch;
    if (activeTab === 'in-jobs') return filteredBySearch.filter((p) => partIdsInJobs.has(p.id));
    if (activeTab === 'needs-attention') {
      return filteredBySearch;
    }
    return filteredBySearch;
  }, [activeTab, filteredBySearch, partIdsInJobs]);

  const handlePartClick = (partId: string) => {
    const currentScroll = listRef.current?.scrollTop ?? 0;
    updateState({
      scrollPositions: {
        ...scrollPositionsRef.current,
        [PARTS_VIEW_KEY]: currentScroll,
      },
    });
    onNavigate('part-detail', { partId });
  };

  const handleNewPart = () => {
    onNavigate('part-detail', { partId: 'new' });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-slate-400">Loading parts...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
              aria-label="Go back"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Parts</h1>
              <p className="text-sm text-slate-400">Master parts, variants, and set composition</p>
            </div>
          </div>
          <button
            onClick={handleNewPart}
            className="flex shrink-0 items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            aria-label="New part"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            New Part
          </button>
        </div>
      </header>

      <div className="border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8">
        <div className="relative mb-3">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            search
          </span>
          <input
            type="text"
            placeholder="Search by part number or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-sm border border-white/10 bg-white/5 px-10 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            aria-label="Search parts"
          />
        </div>
        <div className="flex gap-1 rounded-sm bg-white/5 p-1">
          {(
            [
              { id: 'all' as const, label: 'All Parts' },
              { id: 'in-jobs' as const, label: 'In Jobs' },
              { id: 'needs-attention' as const, label: 'Needs Attention' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`min-h-[36px] flex-1 rounded px-3 text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-primary text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto px-4 py-4 sm:px-6 lg:px-8"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {filteredParts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="material-symbols-outlined mb-4 text-6xl text-slate-600">
              precision_manufacturing
            </span>
            <p className="mb-2 text-lg font-medium text-white">
              {searchQuery ? 'No parts found' : 'No parts yet'}
            </p>
            <p className="mb-4 text-sm text-slate-400">
              {searchQuery
                ? 'Try a different search term or tab'
                : 'Create a master part to define variants, set composition, and materials.'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleNewPart}
                className="flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                New Part
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-0 divide-y divide-white/10">
            {filteredParts.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => handlePartClick(part.id)}
                  className="flex w-full items-center justify-between gap-3 py-4 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                >
                  <div className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="font-mono text-base font-semibold text-white">
                      {part.partNumber}
                    </span>
                    <span className="text-sm text-slate-400">{part.name || part.partNumber}</span>
                  </div>
                  {partIdsInJobs.has(part.id) && (
                    <span
                      className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary"
                      title="Used in jobs"
                    >
                      In use
                    </span>
                  )}
                  <span className="material-symbols-outlined shrink-0 text-slate-500">
                    chevron_right
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Parts;
