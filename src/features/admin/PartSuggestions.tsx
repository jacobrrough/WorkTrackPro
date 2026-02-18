import React, { useState, useEffect, useMemo } from 'react';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import { formatJobCode } from '@/lib/formatJob';
import { getStatusDisplayName } from '@/core/types';

interface PartSuggestion {
  suggestedPartNumber: string;
  suggestedName: string;
  jobs: Array<{
    id: string;
    jobCode: number;
    name: string;
    partNumber?: string;
    variantSuffix?: string;
    description?: string;
    qty?: string;
    dueDate?: string;
    status: string;
  }>;
}

interface PartSuggestionsProps {
  onNavigate: (view: string, params?: { partId?: string; jobId?: string } | string) => void;
  onCreatePart: (partNumber: string, name: string, description?: string) => Promise<void>;
}

const PartSuggestions: React.FC<PartSuggestionsProps> = ({ onNavigate, onCreatePart }) => {
  const [suggestions, setSuggestions] = useState<PartSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingPartNumber, setCreatingPartNumber] = useState<string | null>(null);
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadSuggestions();
  }, []);

  const loadSuggestions = async () => {
    try {
      setLoading(true);
      const data = await partsService.getJobsWithMissingPartInfo();
      setSuggestions(data);
    } catch (error: any) {
      console.error('Error loading suggestions:', error);
      showToast(`Failed to load suggestions: ${error?.message || 'Unknown error'}`, 'error');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return suggestions;
    const query = searchQuery.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.suggestedPartNumber.toLowerCase().includes(query) ||
        s.suggestedName.toLowerCase().includes(query) ||
        s.jobs.some((j) => j.name.toLowerCase().includes(query))
    );
  }, [suggestions, searchQuery]);

  const handleCreatePart = async (suggestion: PartSuggestion) => {
    if (creatingPartNumber) return; // Prevent double-click

    try {
      setCreatingPartNumber(suggestion.suggestedPartNumber);
      // Get description from first job if available
      const description = suggestion.jobs[0]?.description || undefined;
      await onCreatePart(suggestion.suggestedPartNumber, suggestion.suggestedName, description);
      showToast(`Part "${suggestion.suggestedPartNumber}" created successfully`, 'success');
      // Reload suggestions (this one should disappear)
      await loadSuggestions();
    } catch (error: any) {
      console.error('Error creating part:', error);
      showToast(`Failed to create part: ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      setCreatingPartNumber(null);
    }
  };

  const handleViewJob = (jobId: string) => {
    onNavigate('job-detail', { jobId });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-slate-400">Loading suggestions...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            search
          </span>
          <input
            type="text"
            placeholder="Search by part number, name, or job name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-sm border border-white/10 bg-white/5 px-10 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Suggestions List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
        {filteredSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="material-symbols-outlined mb-4 text-6xl text-slate-600">
              check_circle
            </span>
            <p className="mb-2 text-lg font-medium text-white">
              {searchQuery ? 'No suggestions found' : 'All completed jobs have parts!'}
            </p>
            <p className="text-sm text-slate-400">
              {searchQuery
                ? 'Try a different search term'
                : 'Completed jobs are properly linked to parts in the repository.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSuggestions.map((suggestion) => (
              <div
                key={suggestion.suggestedPartNumber}
                className="rounded-sm border border-white/10 bg-card-dark p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-lg font-semibold text-primary">
                        {suggestion.suggestedPartNumber}
                      </span>
                      <span className="text-sm text-slate-400">
                        ({suggestion.jobs.length} job{suggestion.jobs.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <p className="text-sm text-white">{suggestion.suggestedName}</p>
                    {suggestion.jobs[0]?.description && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-2">
                        {suggestion.jobs[0].description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCreatePart(suggestion)}
                    disabled={creatingPartNumber === suggestion.suggestedPartNumber}
                    className="flex shrink-0 items-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {creatingPartNumber === suggestion.suggestedPartNumber ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-lg">
                          hourglass_empty
                        </span>
                        Creating...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-lg">add</span>
                        Create Part
                      </>
                    )}
                  </button>
                </div>

                {/* Jobs List */}
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {suggestion.jobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => handleViewJob(job.id)}
                      className="flex w-full items-center justify-between rounded-sm bg-white/5 px-3 py-2 text-left transition-colors hover:bg-white/10"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-white">
                            {formatJobCode(job.jobCode)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {getStatusDisplayName(job.status as any)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300">{job.name}</p>
                        {job.partNumber && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            Part: {job.partNumber}
                            {job.variantSuffix && `-${job.variantSuffix}`}
                          </p>
                        )}
                      </div>
                      <span className="material-symbols-outlined text-slate-400">chevron_right</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PartSuggestions;
