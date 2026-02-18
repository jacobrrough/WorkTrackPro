import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Part } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import { formatSetComposition } from '@/lib/formatJob';
import { useThrottle } from '@/useThrottle';

const PARTS_VIEW_KEY = '/admin/parts';

interface PartsProps {
  onNavigate: (view: string, params?: { partId?: string }) => void;
  onNavigateBack: () => void;
}

const Parts: React.FC<PartsProps> = ({ onNavigate, onNavigateBack }) => {
  const [parts, setParts] = useState<(Part & { variantCount: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { state, updateState } = useNavigation();
  const searchQuery = state.partsSearchTerm ?? '';
  const setSearchQuery = useCallback(
    (value: string) => updateState({ partsSearchTerm: value }),
    [updateState]
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadParts();
  }, []);

  useEffect(() => {
    const scrollPos = state.scrollPositions[PARTS_VIEW_KEY] ?? 0;
    if (scrollPos > 0 && listRef.current) {
      listRef.current.scrollTop = scrollPos;
    }
  }, [state.scrollPositions]);

  const handleScroll = useThrottle(() => {
    if (listRef.current) {
      updateState({
        scrollPositions: {
          ...state.scrollPositions,
          [PARTS_VIEW_KEY]: listRef.current.scrollTop,
        },
      });
    }
  }, 100);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const loadParts = async () => {
    try {
      setLoading(true);
      const data = await partsService.getAllPartsWithMeta();
      setParts(data || []);
    } catch (error: any) {
      console.error('Error loading parts:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      const errorCode = error?.code;
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

  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return parts;
    const query = searchQuery.toLowerCase();
    return parts.filter(
      (p) =>
        p.partNumber.toLowerCase().includes(query) ||
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query))
    );
  }, [parts, searchQuery]);

  const handlePartClick = (partId: string) => {
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
    <div className="flex h-full flex-col bg-slate-950">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
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
          >
            <span className="material-symbols-outlined text-lg">add</span>
            New Part
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            search
          </span>
          <input
            type="text"
            placeholder="Search by part number, name, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-sm border border-white/10 bg-white/5 px-10 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Parts List */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
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
                ? 'Try a different search term'
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
            {filteredParts.map((part) => {
              const setSummary =
                part.setComposition && Object.keys(part.setComposition).length > 0
                  ? formatSetComposition(part.setComposition)
                  : null;
              return (
                <li key={part.id}>
                  <button
                    type="button"
                    onClick={() => handlePartClick(part.id)}
                    className="flex w-full flex-col items-start gap-1 py-4 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="font-mono text-base font-semibold text-white">
                        {part.partNumber}
                      </span>
                      <div className="flex items-center gap-3">
                        {part.pricePerSet != null && (
                          <span className="text-sm text-slate-400">
                            ${Number(part.pricePerSet).toFixed(2)}/set
                          </span>
                        )}
                        <span className="material-symbols-outlined text-slate-500">
                          chevron_right
                        </span>
                      </div>
                    </div>
                    {part.name && part.name !== part.partNumber && (
                      <span className="text-sm text-slate-400">{part.name}</span>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <span>
                        {part.variantCount} variant{part.variantCount !== 1 ? 's' : ''}
                      </span>
                      {setSummary ? (
                        <span className="text-slate-400">Set: {setSummary}</span>
                      ) : (
                        <span>No set defined</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Parts;
