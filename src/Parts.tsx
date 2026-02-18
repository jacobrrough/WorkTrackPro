import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Part, ViewState } from '@/core/types';
import { partsService } from './pocketbase';
import { useToast } from './Toast';
import { Card } from './components/ui/Card';
import { Button } from './components/ui/Button';
import { FormField } from './components/ui/FormField';
import { LoadingSpinner } from './Loading';
import PartDetail from './PartDetail';

const PARTS_LIST_STATE_KEY = 'partsListState';

interface PartsListState {
  searchTerm: string;
  scrollPosition: number;
}

function loadPartsListState(): PartsListState {
  try {
    const raw = localStorage.getItem(PARTS_LIST_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PartsListState;
      return {
        searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
        scrollPosition: typeof parsed.scrollPosition === 'number' ? parsed.scrollPosition : 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { searchTerm: '', scrollPosition: 0 };
}

function savePartsListState(state: PartsListState) {
  try {
    localStorage.setItem(PARTS_LIST_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

interface AddPartFormProps {
  onSave: (data: { partNumber: string; name: string; description?: string }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

const AddPartForm: React.FC<AddPartFormProps> = ({ onSave, onCancel, saving }) => {
  const [partNumber, setPartNumber] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = partNumber.trim();
    const n = name.trim();
    if (!num || !n) return;
    await onSave({ partNumber: num, name: n, description: description.trim() || undefined });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 bg-background-dark px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Back"
        >
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <h1 className="text-lg font-bold text-white">New Part</h1>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-3 py-3">
        <FormField label="Part number" required>
          <input
            type="text"
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            placeholder="e.g. ABC"
            className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
            autoFocus
          />
        </FormField>
        <FormField label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Part name"
            className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
          />
        </FormField>
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional"
            className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none"
          />
        </FormField>
        <div className="mt-6 flex gap-2">
          <Button type="submit" variant="primary" disabled={saving} fullWidth>
            {saving ? 'Creating...' : 'Create Part'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} fullWidth>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
};

interface PartsProps {
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  initialPartId?: string;
  isAdmin: boolean;
}

const Parts: React.FC<PartsProps> = ({ onNavigate, onBack, initialPartId, isAdmin }) => {
  const { showToast } = useToast();
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [persistedState, setPersistedState] = useState<PartsListState>(loadPartsListState);
  const [view, setView] = useState<'list' | 'add'>('list');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchTerm = persistedState.searchTerm;
  const setSearchTerm = useCallback((value: string) => {
    setPersistedState((prev) => {
      const next = { ...prev, searchTerm: value };
      savePartsListState(next);
      return next;
    });
  }, []);

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return parts;
    const q = searchTerm.trim().toLowerCase();
    return parts.filter((p) => {
      const num = (p.partNumber ?? '').toLowerCase();
      const name = (p.name ?? '').toLowerCase();
      const desc = (p.description ?? '').toLowerCase();
      return num.includes(q) || name.includes(q) || desc.includes(q);
    });
  }, [parts, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    partsService
      .getAllParts()
      .then((list) => {
        if (!cancelled) setParts(list);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast('Failed to load parts', 'error');
          console.error(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Restore scroll when returning to list
  useEffect(() => {
    if (!initialPartId && persistedState.scrollPosition > 0 && scrollRef.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = persistedState.scrollPosition;
      });
    }
  }, [initialPartId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setPersistedState((prev) => {
        const next = { ...prev, scrollPosition: scrollRef.current!.scrollTop };
        savePartsListState(next);
        return next;
      });
    }
  }, []);

  if (initialPartId) {
    return (
      <PartDetail
        partId={initialPartId}
        onNavigate={onNavigate}
        onBack={onBack}
        isAdmin={isAdmin}
      />
    );
  }

  if (view === 'add') {
    return (
      <AddPartForm
        onSave={async (data) => {
          setSaving(true);
          try {
            const created = await partsService.createPart(data);
            if (created) {
              setParts((prev) =>
                [...prev, created].sort((a, b) => a.partNumber.localeCompare(b.partNumber))
              );
              showToast('Part created', 'success');
              setView('list');
              onNavigate('part-detail', created.id);
            } else {
              showToast('Failed to create part', 'error');
            }
          } catch {
            showToast('Failed to create part', 'error');
          } finally {
            setSaving(false);
          }
        }}
        onCancel={() => setView('list')}
        saving={saving}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-background-dark px-3 py-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Back"
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-white">Parts</h1>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setView('add')}
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-sm bg-primary text-white hover:bg-primary/90"
              aria-label="Add part"
            >
              <span className="material-symbols-outlined text-2xl">add</span>
            </button>
          )}
        </div>
        <div className="relative mt-3">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">
            search
          </span>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search part number, name..."
            className="w-full rounded-sm border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search parts"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading ? (
          <LoadingSpinner text="Loading parts..." />
        ) : filteredParts.length === 0 ? (
          <div className="rounded-sm border border-white/10 bg-white/5 p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">
              precision_manufacturing
            </span>
            <p className="mt-2 text-slate-400">
              {searchTerm.trim() ? 'No parts match your search.' : 'No parts yet.'}
            </p>
            {isAdmin && !searchTerm.trim() && (
              <p className="mt-1 text-sm text-slate-500">Create a part from the detail view.</p>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredParts.map((part) => (
              <li key={part.id}>
                <Card
                  onClick={() => onNavigate('part-detail', part.id)}
                  className="touch-manipulation"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-primary">
                      <span className="material-symbols-outlined text-2xl">
                        precision_manufacturing
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">{part.partNumber}</p>
                      <p className="truncate text-sm text-slate-400">{part.name || '—'}</p>
                    </div>
                    <span className="material-symbols-outlined text-xl text-slate-500">
                      chevron_right
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Parts;
