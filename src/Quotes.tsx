import React, { useState, useMemo, useCallback } from 'react';
import { Job, InventoryItem, User, ViewState, Quote, QuoteLineItem, Shift } from '@/core/types';
import { quoteService } from './services/api/quotes';
import { useScrollRestore } from './hooks/useScrollRestore';
import { useToast } from './Toast';
import { getJobDisplayName } from './lib/formatJob';
import { getMachineTotalsFromJob } from './lib/machineHours';
import { calculateJobHoursFromShifts } from './lib/laborSuggestion';
import { buildQuoteFromJobs } from './lib/quoteFromJobs';

interface QuotesProps {
  jobs: Job[];
  inventory: InventoryItem[];
  shifts: Shift[];
  currentUser: User;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
}

const DEFAULT_LABOR_RATE = 175; // Default hourly rate ($175/hour per V7 spec)
const MATERIAL_MARKUP_MULTIPLIER = 2.25; // Material unit price = cost × 2.25 (V7 spec)
const DEFAULT_MARKUP_PERCENT = 20; // Default 20% markup

const Quotes: React.FC<QuotesProps> = ({
  jobs,
  inventory,
  shifts,
  currentUser,
  onNavigate,
  onBack,
}) => {
  const { showToast } = useToast();
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore<HTMLElement>('quotes');
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [savedQuotes, setSavedQuotes] = useState<Quote[]>([]);
  const [showSavedQuotes, setShowSavedQuotes] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Quote calculation state
  const [quoteData, setQuoteData] = useState<{
    materialCost: number;
    laborHours: number;
    laborRate: number;
    laborCost: number;
    cncHours: number;
    cncRate: number;
    cncCost: number;
    markupPercent: number;
    subtotal: number;
    markupAmount: number;
    total: number;
    lineItems: QuoteLineItem[];
    referenceJobIds: string[];
    /** UI-only: how many matched jobs contributed real data to the averages. */
    contributorCount: number;
    /** UI-only: how many jobs matched the search. */
    matchedCount: number;
  } | null>(null);

  // Load saved quotes
  const loadSavedQuotes = useCallback(async () => {
    setIsLoadingSaved(true);
    try {
      const quotes = await quoteService.getAllQuotes();
      setSavedQuotes(quotes);
    } catch (error) {
      console.error('Failed to load quotes:', error);
      showToast('Failed to load saved quotes', 'error');
    } finally {
      setIsLoadingSaved(false);
    }
  }, [showToast]);

  // Find similar jobs based on product name
  const findSimilarJobs = useCallback(
    (searchTerm: string): Job[] => {
      if (!searchTerm.trim()) return [];

      const term = searchTerm.toLowerCase().trim();
      const words = term.split(/\s+/);

      return jobs
        .filter((job) => {
          const jobName = (getJobDisplayName(job) || job.name || '').toLowerCase();
          const jobDesc = (job.description || '').toLowerCase();
          const searchText = `${jobName} ${jobDesc}`;

          // Check if any word matches
          return words.some((word) => searchText.includes(word));
        })
        .slice(0, 10); // Limit to 10 most similar
    },
    [jobs]
  );

  // Actual logged labor hours for a job (completed shifts only). Used by the reference-jobs UI.
  const calculateJobHours = useCallback(
    (jobId: string): number => calculateJobHoursFromShifts(jobId, shifts),
    [shifts]
  );

  // Calculate quote from similar jobs
  const calculateQuote = useCallback(async () => {
    if (!productName.trim()) {
      showToast('Please enter a product name', 'error');
      return;
    }

    setIsCalculating(true);
    try {
      const similarJobs = findSimilarJobs(productName);

      if (similarJobs.length === 0) {
        showToast('No similar jobs found. You can manually enter values.', 'info');
        setQuoteData({
          materialCost: 0,
          laborHours: 0,
          laborRate: DEFAULT_LABOR_RATE,
          laborCost: 0,
          cncHours: 0,
          cncRate: DEFAULT_LABOR_RATE,
          cncCost: 0,
          markupPercent: DEFAULT_MARKUP_PERCENT,
          subtotal: 0,
          markupAmount: 0,
          total: 0,
          lineItems: [],
          referenceJobIds: [],
          contributorCount: 0,
          matchedCount: 0,
        });
        setIsCalculating(false);
        return;
      }

      // Average labor, CNC, and materials over only the matched jobs that actually have
      // that kind of history. Jobs with no logged data no longer dilute the estimate.
      const basis = buildQuoteFromJobs(similarJobs, shifts, inventory);

      // Create line items with material markup (cost × 2.25 per V7 spec)
      const lineItems: QuoteLineItem[] = basis.materials.map((item) => {
        const unitPrice = item.unitCost * MATERIAL_MARKUP_MULTIPLIER; // Our cost × 2.25
        return {
          name: item.name,
          inventoryName: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice,
          totalPrice: item.quantity * unitPrice,
          isManual: false,
        };
      });

      const materialCost = lineItems.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
      const laborRate = DEFAULT_LABOR_RATE;
      const laborCost = basis.laborHours * laborRate;
      const cncRate = DEFAULT_LABOR_RATE;
      const cncCost = basis.cncHours * cncRate;
      const subtotal = materialCost + laborCost + cncCost;
      const markupPercent = DEFAULT_MARKUP_PERCENT;
      const markupAmount = subtotal * (markupPercent / 100);
      const total = subtotal + markupAmount;

      setQuoteData({
        materialCost,
        laborHours: basis.laborHours,
        laborRate,
        laborCost,
        cncHours: basis.cncHours,
        cncRate,
        cncCost,
        markupPercent,
        subtotal,
        markupAmount,
        total,
        lineItems,
        referenceJobIds: basis.referenceJobIds,
        contributorCount: basis.contributorCount,
        matchedCount: basis.matchedCount,
      });

      if (basis.contributorCount === 0) {
        // Jobs matched by name but none have logged history yet — don't show a misleading
        // low number; prompt manual entry instead.
        showToast(
          `Matched ${basis.matchedCount} job(s), but none have logged history yet. Enter values manually.`,
          'info'
        );
      } else {
        showToast(
          `Quote averaged from ${basis.contributorCount} of ${basis.matchedCount} matched job(s)`,
          'success'
        );
      }
    } catch (error) {
      console.error('Calculate quote error:', error);
      showToast('Failed to calculate quote', 'error');
    } finally {
      setIsCalculating(false);
    }
  }, [productName, findSimilarJobs, shifts, inventory, showToast]);

  // Update quote calculations when values change
  const updateQuoteCalculations = useCallback(
    (updates: Partial<typeof quoteData>) => {
      if (!quoteData) return;

      const updated = { ...quoteData, ...updates };

      // Recalculate dependent values
      updated.laborCost = updated.laborHours * updated.laborRate;
      updated.cncCost = updated.cncHours * updated.cncRate;
      updated.subtotal = updated.materialCost + updated.laborCost + updated.cncCost;
      updated.markupAmount = updated.subtotal * (updated.markupPercent / 100);
      updated.total = updated.subtotal + updated.markupAmount;

      setQuoteData(updated);
    },
    [quoteData]
  );

  // Update line item
  const updateLineItem = useCallback(
    (index: number, updates: Partial<QuoteLineItem>) => {
      if (!quoteData) return;

      const updatedItems = [...quoteData.lineItems];
      updatedItems[index] = { ...updatedItems[index], ...updates };

      if (updates.quantity !== undefined || updates.unitPrice !== undefined) {
        updatedItems[index].totalPrice =
          updatedItems[index].quantity * (updatedItems[index].unitPrice ?? 0);
      }

      const materialCost = updatedItems.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
      updateQuoteCalculations({ lineItems: updatedItems, materialCost });
    },
    [quoteData, updateQuoteCalculations]
  );

  // Add manual line item
  const addManualLineItem = useCallback(() => {
    if (!quoteData) return;

    const newItem: QuoteLineItem = {
      name: '',
      inventoryName: '',
      quantity: 1,
      unit: 'units',
      unitPrice: 0,
      totalPrice: 0,
      isManual: true,
    };

    updateQuoteCalculations({
      lineItems: [...quoteData.lineItems, newItem],
    });
  }, [quoteData, updateQuoteCalculations]);

  // Remove line item
  const removeLineItem = useCallback(
    (index: number) => {
      if (!quoteData) return;

      const updatedItems = quoteData.lineItems.filter((_, i) => i !== index);
      const materialCost = updatedItems.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0);
      updateQuoteCalculations({ lineItems: updatedItems, materialCost });
    },
    [quoteData, updateQuoteCalculations]
  );

  // Save quote
  const saveQuote = useCallback(async () => {
    if (!quoteData || !productName.trim()) {
      showToast('Please enter a product name and calculate a quote', 'error');
      return;
    }

    try {
      const quote = await quoteService.createQuote({
        productName: productName.trim(),
        description: description.trim() || undefined,
        materialCost: quoteData.materialCost,
        laborHours: quoteData.laborHours,
        laborRate: quoteData.laborRate,
        laborCost: quoteData.laborCost,
        cncHours: quoteData.cncHours,
        cncRate: quoteData.cncRate,
        cncCost: quoteData.cncCost,
        markupPercent: quoteData.markupPercent,
        subtotal: quoteData.subtotal,
        markupAmount: quoteData.markupAmount,
        total: quoteData.total,
        lineItems: quoteData.lineItems,
        referenceJobIds: quoteData.referenceJobIds,
        createdBy: currentUser.id,
      });

      if (quote) {
        showToast('Quote saved successfully', 'success');
        setSavedQuotes((prev) => [quote, ...prev]);
        // Reset form
        setProductName('');
        setDescription('');
        setQuoteData(null);
      } else {
        showToast('Failed to save quote', 'error');
      }
    } catch (error) {
      console.error('Save quote error:', error);
      showToast('Failed to save quote', 'error');
    }
  }, [quoteData, productName, description, currentUser.id, showToast]);

  const similarJobs = useMemo(() => {
    if (!productName.trim()) return [];
    return findSimilarJobs(productName);
  }, [productName, findSimilarJobs]);

  const referenceJobs = useMemo(() => {
    if (!quoteData) return [];
    return jobs.filter((j) => quoteData.referenceJobIds.includes(j.id));
  }, [quoteData, jobs]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background-dark">
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-primary/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="rounded-sm border border-primary/30 bg-primary/20 p-1"
              >
                <span className="material-symbols-outlined text-primary">arrow_back</span>
              </button>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                Administrator
              </p>
              <h1 className="text-lg font-bold leading-tight text-white">Quotes</h1>
            </div>
          </div>
          <button
            onClick={() => {
              setShowSavedQuotes(!showSavedQuotes);
              if (!showSavedQuotes) loadSavedQuotes();
            }}
            className="relative flex size-10 items-center justify-center rounded-sm border border-white/5 bg-surface-dark text-white"
          >
            <span className="material-symbols-outlined">history</span>
          </button>
        </div>
      </header>

      <main ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 pb-24">
        {/* Product Input */}
        <div className="mb-6 pt-6">
          <label className="mb-2 block text-sm font-bold text-white">Product Name *</label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="Enter product name..."
            className="w-full rounded-sm border border-white/10 bg-surface-dark px-4 py-3 text-white placeholder-white/40 focus:border-primary focus:outline-none"
          />
        </div>

        {productName.trim() && similarJobs.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-sm text-white/60">Found {similarJobs.length} similar job(s):</p>
            <div className="space-y-2">
              {similarJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="rounded-sm border border-white/5 bg-surface-dark p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-white">
                        #{job.jobCode} - {getJobDisplayName(job)}
                      </p>
                      {job.description && (
                        <p className="mt-1 text-xs text-white/60">{job.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onNavigate('job-detail', job.id)}
                      className="text-xs font-bold text-primary"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={calculateQuote}
          disabled={isCalculating || !productName.trim()}
          className="mb-6 flex h-14 w-full items-center justify-center gap-3 rounded-sm bg-primary px-6 text-white shadow-lg shadow-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCalculating ? (
            <>
              <span className="material-symbols-outlined animate-spin">refresh</span>
              <span>Calculating...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined">calculate</span>
              <span className="text-base font-bold tracking-wide">Calculate Quote</span>
            </>
          )}
        </button>

        {/* Quote Results */}
        {quoteData && (
          <div className="mb-6 space-y-6">
            {/* Reference Jobs */}
            {referenceJobs.length > 0 && (
              <div className="rounded-sm border border-white/5 bg-surface-dark p-4">
                <div className="mb-3">
                  <h3 className="font-bold text-white">Reference Jobs</h3>
                  <p className="mt-0.5 text-xs text-white/50">
                    Averaged from {quoteData.contributorCount} of {quoteData.matchedCount} matched
                    job(s)
                  </p>
                </div>
                <div className="space-y-2">
                  {referenceJobs.map((job) => {
                    // Show what each job actually contributed. Reference jobs can be in for
                    // labor, CNC, or material, so a CNC-only job legitimately shows 0h labor —
                    // label each component so it doesn't read as missing data.
                    const laborHrs = calculateJobHours(job.id);
                    const cncHrs = getMachineTotalsFromJob(job).cncHours;
                    const matCount = job.inventoryItems?.length || 0;
                    const parts: string[] = [];
                    if (laborHrs > 0) parts.push(`${laborHrs.toFixed(1)}h labor`);
                    if (cncHrs > 0) parts.push(`${cncHrs.toFixed(1)}h CNC`);
                    if (matCount > 0) parts.push(`${matCount} materials`);
                    return (
                      <div
                        key={job.id}
                        className="flex items-center justify-between rounded bg-background-dark p-2"
                      >
                        <div>
                          <p className="text-sm font-bold text-white">
                            #{job.jobCode} - {getJobDisplayName(job)}
                          </p>
                          <p className="text-xs text-white/60">{parts.join(' • ') || '—'}</p>
                        </div>
                        <button
                          onClick={() => onNavigate('job-detail', job.id)}
                          className="text-xs font-bold text-primary"
                        >
                          View
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Line Items */}
            <div className="rounded-sm border border-white/5 bg-surface-dark p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-white">Materials</h3>
                <button
                  onClick={addManualLineItem}
                  className="flex items-center gap-1 text-xs font-bold text-primary"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  Add Item
                </button>
              </div>
              <div className="space-y-3">
                {quoteData.lineItems.map((item, index) => (
                  <div
                    key={index}
                    className="rounded-sm border border-white/5 bg-background-dark p-3"
                  >
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={item.inventoryName}
                        onChange={(e) => updateLineItem(index, { inventoryName: e.target.value })}
                        placeholder="Item name"
                        className="rounded border border-white/10 bg-surface-dark px-3 py-2 text-sm text-white placeholder-white/40"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateLineItem(index, { quantity: parseFloat(e.target.value) || 0 })
                          }
                          placeholder="Qty"
                          className="flex-1 rounded border border-white/10 bg-surface-dark px-3 py-2 text-sm text-white"
                          step="0.01"
                        />
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateLineItem(index, { unit: e.target.value })}
                          placeholder="Unit"
                          className="w-20 rounded border border-white/10 bg-surface-dark px-3 py-2 text-sm text-white"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/60">Unit Price:</span>
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateLineItem(index, { unitPrice: parseFloat(e.target.value) || 0 })
                          }
                          className="w-24 rounded border border-white/10 bg-surface-dark px-2 py-1 text-sm text-white"
                          step="0.01"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          ${(item.totalPrice ?? 0).toFixed(2)}
                        </span>
                        {item.isManual && (
                          <button
                            onClick={() => removeLineItem(index)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Labor & Costs */}
            <div className="space-y-3 rounded-sm border border-white/5 bg-surface-dark p-4">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Labor Hours:</span>
                <input
                  type="number"
                  value={quoteData.laborHours}
                  onChange={(e) =>
                    updateQuoteCalculations({
                      laborHours: Number((parseFloat(e.target.value) || 0).toFixed(2)),
                    })
                  }
                  className="w-32 rounded border border-white/10 bg-background-dark px-3 py-2 text-sm text-white"
                  step="0.01"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Labor Rate ($/hr):</span>
                <input
                  type="number"
                  value={quoteData.laborRate}
                  onChange={(e) =>
                    updateQuoteCalculations({ laborRate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-32 rounded border border-white/10 bg-background-dark px-3 py-2 text-sm text-white"
                  step="0.01"
                />
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="font-bold text-white">Labor Cost:</span>
                <span className="font-bold text-white">${quoteData.laborCost.toFixed(2)}</span>
              </div>
              {quoteData.cncHours > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">CNC Hours:</span>
                    <input
                      type="number"
                      value={quoteData.cncHours}
                      onChange={(e) =>
                        updateQuoteCalculations({
                          cncHours: Number((parseFloat(e.target.value) || 0).toFixed(2)),
                        })
                      }
                      className="w-32 rounded border border-white/10 bg-background-dark px-3 py-2 text-sm text-white"
                      step="0.01"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">CNC Rate ($/hr):</span>
                    <input
                      type="number"
                      value={quoteData.cncRate}
                      onChange={(e) =>
                        updateQuoteCalculations({ cncRate: parseFloat(e.target.value) || 0 })
                      }
                      className="w-32 rounded border border-white/10 bg-background-dark px-3 py-2 text-sm text-white"
                      step="0.01"
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 pt-2">
                    <span className="font-bold text-white">CNC Cost:</span>
                    <span className="font-bold text-white">${quoteData.cncCost.toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-white/60">Material Cost:</span>
                <span className="font-bold text-white">${quoteData.materialCost.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="font-bold text-white">Subtotal:</span>
                <span className="font-bold text-white">${quoteData.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Markup (%):</span>
                <input
                  type="number"
                  value={quoteData.markupPercent}
                  onChange={(e) =>
                    updateQuoteCalculations({ markupPercent: parseFloat(e.target.value) || 0 })
                  }
                  className="w-32 rounded border border-white/10 bg-background-dark px-3 py-2 text-sm text-white"
                  step="0.1"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Markup Amount:</span>
                <span className="font-bold text-white">${quoteData.markupAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t-2 border-primary pt-2">
                <span className="text-lg font-bold text-white">Total:</span>
                <span className="text-2xl font-bold text-primary">
                  ${quoteData.total.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-2 block text-sm font-bold text-white">
                Description (Optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add notes or description..."
                rows={3}
                className="w-full resize-none rounded-sm border border-white/10 bg-surface-dark px-4 py-3 text-white placeholder-white/40 focus:border-primary focus:outline-none"
              />
            </div>

            {/* Save Button */}
            <button
              onClick={saveQuote}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-sm bg-green-600 px-6 text-white shadow-lg shadow-green-600/25"
            >
              <span className="material-symbols-outlined">save</span>
              <span className="text-base font-bold tracking-wide">Save Quote</span>
            </button>
          </div>
        )}

        {/* Saved Quotes Modal */}
        {showSavedQuotes && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm">
            <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-t-md border-t border-white/10 bg-background-dark p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Saved Quotes</h3>
                <button onClick={() => setShowSavedQuotes(false)} className="text-slate-400">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto">
                {isLoadingSaved ? (
                  <div className="py-8 text-center text-white/60">Loading...</div>
                ) : savedQuotes.length === 0 ? (
                  <div className="py-8 text-center text-white/60">No saved quotes</div>
                ) : (
                  savedQuotes.map((quote) => (
                    <div
                      key={quote.id}
                      className="rounded-sm border border-white/5 bg-surface-dark p-4"
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-white">{quote.productName}</h4>
                          {quote.description && (
                            <p className="mt-1 text-sm text-white/60">{quote.description}</p>
                          )}
                        </div>
                        <span className="text-xl font-bold text-primary">
                          ${quote.total.toFixed(2)}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-white/60">
                        <p>
                          Materials: ${quote.materialCost.toFixed(2)} • Labor:{' '}
                          {quote.laborHours.toFixed(1)}h @ ${quote.laborRate}/hr
                          {quote.cncCost > 0 && ` • CNC: ${quote.cncHours.toFixed(1)}h`}
                        </p>
                        <p>Created: {new Date(quote.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Quotes;
