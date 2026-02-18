import React, { useState, useMemo, useEffect } from 'react';
import { Job, User, ViewState, JobStatus, BoardType, Shift, Part } from '@/core/types';
import { dateInputToISO } from '@/core/date';
import { getLaborSuggestion } from '@/lib/laborSuggestion';
import {
  formatJobCode,
  formatDashSummary,
  totalFromDashQuantities,
  getJobNameForSave,
} from '@/lib/formatJob';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import PartSelector from '@/components/PartSelector';
import { syncJobInventoryFromPart } from '@/lib/materialFromPart';

interface AdminCreateJobProps {
  onCreate: (data: {
    jobCode: number;
    name: string;
    po?: string;
    dueDate?: string;
    ecd?: string;
    ECD?: string; // Added: PocketBase schema uses uppercase
    qty?: string;
    description?: string;
    laborHours?: number;
    status: JobStatus;
    isRush?: boolean;
    active: boolean;
    binLocation?: string;
    createdBy?: string;
    boardType?: BoardType;
    assignedUsers?: string[];
    estNumber?: string;
    invNumber?: string;
    rfqNumber?: string;
    partNumber?: string;
    revision?: string;
    variantSuffix?: string;
    dashQuantities?: Record<string, number>;
  }) => Promise<Job | null>;
  onNavigate: (view: ViewState) => void;
  users: User[];
  existingJobCodes: number[];
  currentUser: User;
  jobs: Job[];
  shifts: Shift[];
}

const AdminCreateJob: React.FC<AdminCreateJobProps> = ({
  onCreate,
  onNavigate,
  users: _users,
  existingJobCodes,
  currentUser,
  jobs,
  shifts,
}) => {
  // Generate a unique job code
  const generateJobCode = () => {
    let code = Math.floor(1000 + Math.random() * 9000);
    while (existingJobCodes.includes(code)) {
      code = Math.floor(1000 + Math.random() * 9000);
    }
    return code;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [selectedPartNumber, setSelectedPartNumber] = useState('');
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partNameEdit, setPartNameEdit] = useState('');
  const [dashQuantities, setDashQuantities] = useState<Record<string, number>>({});
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    po: '',
    jobCode: generateJobCode(),
    dueDate: '',
    ecd: '',
    qty: '',
    laborHours: '',
    isRush: false,
    description: '',
    status: 'toBeQuoted' as JobStatus,
    binLocation: '',
    estNumber: '',
    invNumber: '',
    rfqNumber: '',
    revision: '',
  });

  // Auto-generate EST# when job code is set
  useEffect(() => {
    if (formData.jobCode && !formData.estNumber) {
      setFormData((prev) => ({ ...prev, estNumber: `EST-${formData.jobCode}` }));
    }
  }, [formData.jobCode]);

  const handlePartSelect = (part: Part, quantities: Record<string, number>) => {
    setSelectedPartNumber(part.partNumber);
    setSelectedPart(part);
    setPartNameEdit(part.name ?? '');
    setDashQuantities(quantities);
    setFormData((prev) => ({
      ...prev,
      laborHours: part.laborHours?.toString() || prev.laborHours,
      description: part.description || prev.description,
    }));
  };

  // Auto name for display and labor suggestion (Part → Part REV → EST # n → PO# n → fallback Job #code)
  const autoJobName = getJobNameForSave(
    {
      partNumber: selectedPartNumber?.trim(),
      revision: formData.revision.trim(),
      estNumber: formData.estNumber.trim(),
      po: formData.po.trim(),
      status: formData.isRush ? 'rush' : formData.status,
    },
    formData.jobCode
  );

  // Calculate labor hours suggestion from similar jobs (using auto name)
  const laborSuggestion = useMemo(() => {
    if (!autoJobName.trim()) return null;
    const suggestion = getLaborSuggestion(autoJobName, jobs, shifts);
    return suggestion > 0 ? suggestion : null;
  }, [autoJobName, jobs, shifts]);

  // Comprehensive validation (job name is always auto from convention)
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Job code validation
    if (!formData.jobCode) {
      errors.jobCode = 'Job code is required';
    } else if (existingJobCodes.includes(formData.jobCode)) {
      errors.jobCode = 'This job code already exists. Click to regenerate.';
    } else if (formData.jobCode < 1000 || formData.jobCode > 9999) {
      errors.jobCode = 'Job code must be 4 digits';
    }

    // Date validation
    if (formData.dueDate && formData.ecd) {
      const due = new Date(formData.dueDate);
      const ecd = new Date(formData.ecd);
      if (ecd > due) {
        errors.ecd = 'ECD cannot be after due date';
      }
    }

    // Quantity: either from dashQuantities total or free-text qty
    const totalFromDash = totalFromDashQuantities(dashQuantities);
    if (totalFromDash === 0 && formData.qty.trim() && isNaN(Number(formData.qty))) {
      if (!/\d/.test(formData.qty)) {
        errors.qty = 'Quantity should contain a number';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Clear previous errors
    setError(null);
    setValidationErrors({});

    // Validate form
    if (!validateForm()) {
      setError('Please fix the errors below');
      return;
    }

    if (isSubmitting) return;

    setIsSubmitting(true);

    const partNumberForCreate = selectedPartNumber?.trim();
    const nameForCreate = getJobNameForSave(
      {
        partNumber: partNumberForCreate,
        revision: formData.revision.trim(),
        estNumber: formData.estNumber.trim(),
        po: formData.po.trim(),
        status: formData.isRush ? 'rush' : formData.status,
      },
      formData.jobCode
    );

    try {
      const job = await onCreate({
        jobCode: formData.jobCode,
        name: nameForCreate,
        po: formData.po.trim() || undefined,
        dueDate: dateInputToISO(formData.dueDate),
        ecd: dateInputToISO(formData.ecd), // Fixed: use lowercase 'ecd' not 'ECD'
        qty:
          totalFromDashQuantities(dashQuantities) > 0
            ? String(totalFromDashQuantities(dashQuantities))
            : formData.qty.trim() || undefined,
        description: formData.description.trim() || undefined,
        laborHours: formData.laborHours ? parseFloat(formData.laborHours) : undefined,
        status: formData.isRush ? 'rush' : formData.status,
        isRush: formData.isRush,
        active: true, // CRITICAL: Set active to true!
        binLocation: formData.binLocation.trim() || undefined,
        createdBy: currentUser.id, // ADDED: Track who created the job
        boardType: 'admin' as BoardType,
        assignedUsers: [],
        estNumber: formData.estNumber.trim() || undefined,
        invNumber: formData.invNumber.trim() || undefined,
        rfqNumber: formData.rfqNumber.trim() || undefined,
        partNumber: selectedPartNumber || undefined,
        revision: formData.revision.trim() || undefined,
        dashQuantities: Object.keys(dashQuantities).length > 0 ? dashQuantities : undefined,
      } as any);

      if (job) {
        // If part number was selected but not found, create master part
        if (selectedPartNumber && !job.partNumber) {
          try {
            const basePartNumber = selectedPartNumber.replace(/-\d+$/, ''); // Remove variant suffix if present
            await partsService.createPart({
              partNumber: basePartNumber,
              name: (selectedPart ? partNameEdit.trim() : '') || nameForCreate,
              description: formData.description.trim() || undefined,
              laborHours: formData.laborHours ? parseFloat(formData.laborHours) : undefined,
              pricePerSet: undefined, // Will be set later
            });
            showToast('Master part created in Parts repository', 'success');
          } catch (partError) {
            console.error('Error creating master part:', partError);
            // Don't fail the job creation if part creation fails
            showToast('Job created, but failed to create master part', 'warning');
          }
        }
        // Auto-assign materials from part when job has part + dash quantities
        if (job.partNumber && dashQuantities && Object.values(dashQuantities).some((q) => q > 0)) {
          try {
            const found = await partsService.getPartByNumber(job.partNumber);
            if (found) {
              const fullPart = await partsService.getPartWithVariants(found.id);
              if (fullPart) {
                await syncJobInventoryFromPart(job.id, fullPart, dashQuantities);
                showToast('Job created; materials assigned from part.', 'success');
              }
            }
          } catch (syncErr) {
            console.error('Material sync after job create:', syncErr);
            showToast(
              'Job created; material assignment failed. Assign from job detail.',
              'warning'
            );
          }
        }
        // Success! Navigate to admin board
        onNavigate('board-admin');
      } else {
        // Creation returned null - something failed
        console.error('Ã¢ÂÅ’ Job creation returned null');
        setError('Failed to create job. The server did not return a job record. Please try again.');
      }
    } catch (error: unknown) {
      console.error('Ã¢ÂÅ’ Error creating job:', error);

      // Parse error message
      let errorMessage = 'Failed to create job. ';

      if (error instanceof Error) {
        errorMessage += error.message;
      } else if (typeof error === 'object' && error !== null && 'response' in error) {
        const err = error as { response?: { message?: string } };
        errorMessage += err.response?.message || 'Unknown error occurred. Please try again.';
      } else if (typeof error === 'string') {
        errorMessage += error;
      } else {
        errorMessage += 'Unknown error occurred. Please try again.';
      }

      // Check for specific errors
      if (errorMessage.includes('duplicate') || errorMessage.includes('unique')) {
        errorMessage = 'Job code already exists. Click job code to regenerate.';
        setValidationErrors({ jobCode: 'Already exists' });
      }

      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Regenerate job code
  const handleRegenerateJobCode = () => {
    const newCode = generateJobCode();
    setFormData({ ...formData, jobCode: newCode });
    setValidationErrors({ ...validationErrors, jobCode: undefined });
    setError(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-white">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-[#4d3465]/30 bg-background-dark p-4 backdrop-blur-md">
        <button
          onClick={() => onNavigate('dashboard')}
          className="text-base font-medium text-primary"
        >
          Cancel
        </button>
        <h2 className="flex-1 text-center text-lg font-bold leading-tight tracking-tight text-white">
          New Job
        </h2>
        <button
          onClick={handleSubmit}
          className="text-base font-bold text-primary disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-sm border border-red-500 bg-red-500/10 p-4">
            <span className="material-symbols-outlined text-red-400">error</span>
            <div className="flex-1">
              <p className="mb-1 font-bold text-red-400">Error</p>
              <p className="text-sm text-red-300">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Part Selector */}
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Part Number & Dash Quantities
            </p>
            <PartSelector
              onSelect={handlePartSelect}
              initialPartNumber={selectedPartNumber}
              isAdmin={currentUser.isAdmin}
              showPrices={currentUser.isAdmin}
            />
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Job Identity
            </p>
            <div className="mb-3 flex flex-col">
              <label className="pb-1 text-xs font-medium text-slate-300">Job Code</label>
              <button
                type="button"
                onClick={handleRegenerateJobCode}
                className="flex h-10 w-full items-center rounded-sm border border-[#4d3465] bg-[#261a32]/50 px-3 transition-colors hover:border-primary hover:bg-[#261a32]"
                title="Click to regenerate code"
              >
                <span className="font-mono text-sm font-bold text-primary">
                  {formatJobCode(formData.jobCode)}
                </span>
                <span className="material-symbols-outlined ml-auto text-xs text-[#ad93c8]">
                  refresh
                </span>
              </button>
              {validationErrors.jobCode ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  {validationErrors.jobCode}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Auto-generated \u2022 Click to regenerate
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Part Number · Rev · Part Name · Qty · EST # · RFQ # · PO # · INV#
            </p>
            <div className="space-y-3">
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">Rev</label>
                <input
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 font-mono text-sm uppercase text-white placeholder:text-slate-600"
                  placeholder="e.g. A, B, NC"
                  value={formData.revision}
                  onChange={(e) => setFormData({ ...formData, revision: e.target.value })}
                  disabled={isSubmitting}
                  maxLength={20}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">Part Name</label>
                {selectedPart ? (
                  <>
                    <input
                      className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                      placeholder="Part name"
                      value={partNameEdit}
                      onChange={(e) => setPartNameEdit(e.target.value)}
                      onBlur={async () => {
                        if (
                          !selectedPart ||
                          partNameEdit.trim() === (selectedPart.name ?? '').trim()
                        )
                          return;
                        try {
                          const updated = await partsService.updatePart(selectedPart.id, {
                            name: partNameEdit.trim(),
                          });
                          if (updated)
                            setSelectedPart((p) => (p ? { ...p, name: updated.name } : null));
                          showToast('Part name updated', 'success');
                        } catch {
                          showToast('Failed to update part name', 'error');
                        }
                      }}
                      disabled={isSubmitting}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Editable; saved to Part when you blur
                    </p>
                  </>
                ) : (
                  <div className="flex h-10 w-full items-center rounded-sm border border-[#4d3465] bg-[#261a32]/50 px-3 py-2 text-sm text-slate-500">
                    Select a part above to set part name
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">Qty</label>
                {totalFromDashQuantities(dashQuantities) > 0 ? (
                  <div className="flex h-10 w-full items-center rounded-sm border border-[#4d3465] bg-[#261a32]/50 px-3 py-2 text-sm text-slate-300">
                    {formatDashSummary(dashQuantities)} → Total:{' '}
                    {totalFromDashQuantities(dashQuantities)}
                  </div>
                ) : (
                  <input
                    className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                    placeholder="e.g., 50 units"
                    value={formData.qty}
                    onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                    disabled={isSubmitting}
                  />
                )}
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">EST #</label>
                <input
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                  placeholder="Enter EST number"
                  value={formData.estNumber}
                  onChange={(e) => setFormData({ ...formData, estNumber: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">RFQ #</label>
                <input
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                  placeholder="Enter RFQ number"
                  value={formData.rfqNumber}
                  onChange={(e) => setFormData({ ...formData, rfqNumber: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">PO #</label>
                <input
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                  placeholder="5300170272"
                  value={formData.po}
                  onChange={(e) => setFormData({ ...formData, po: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">INV#</label>
                <input
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                  placeholder="Enter INV number"
                  value={formData.invNumber}
                  onChange={(e) => setFormData({ ...formData, invNumber: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Logistics
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">Due Date</label>
                <input
                  type="date"
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-1 text-xs font-medium text-slate-300">ECD</label>
                <input
                  type="date"
                  className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white"
                  value={formData.ecd}
                  onChange={(e) => setFormData({ ...formData, ecd: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-col">
              <label className="pb-1 text-xs font-medium text-slate-300">Bin Location</label>
              <input
                className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 font-mono text-sm uppercase text-white placeholder:text-slate-600"
                placeholder="e.g., A4c"
                value={formData.binLocation}
                onChange={(e) =>
                  setFormData({ ...formData, binLocation: e.target.value.toUpperCase() })
                }
                disabled={isSubmitting}
                maxLength={10}
              />
            </div>
            <div className="mt-3 flex flex-col">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">Labor (hours)</label>
                {laborSuggestion && (
                  <button
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, laborHours: laborSuggestion.toString() })
                    }
                    className="text-[10px] font-medium text-primary hover:text-primary/80"
                  >
                    Use {laborSuggestion.toFixed(1)}h
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.1"
                min="0"
                className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                placeholder="0"
                value={formData.laborHours}
                onChange={(e) => setFormData({ ...formData, laborHours: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Status
            </p>
            <div className="flex flex-col">
              <label className="pb-1 text-xs font-medium text-slate-300">Initial Status</label>
              <select
                className="h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 text-sm text-white"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as JobStatus })}
                disabled={isSubmitting || formData.isRush}
              >
                <option value="toBeQuoted">To Be Quoted</option>
                <option value="rfqReceived">RFQ Received</option>
                <option value="rfqSent">RFQ Sent</option>
                <option value="pod">PO'd</option>
                <option value="pending">Pending (Shop)</option>
                <option value="inProgress">In Progress</option>
                <option value="qualityControl">Quality Control</option>
                <option value="onHold">On Hold</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-sm border border-red-500/20 bg-red-500/10 px-3 py-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-red-500">bolt</span>
              <div>
                <p className="font-bold text-white">Rush Job</p>
                <p className="text-xs font-bold uppercase tracking-widest text-red-400/80">
                  High Priority
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isRush: !formData.isRush })}
              className={`relative h-6 w-12 rounded-sm transition-colors ${formData.isRush ? 'bg-red-500' : 'bg-slate-700'}`}
              disabled={isSubmitting}
            >
              <div
                className={`absolute top-1 size-4 rounded-sm bg-white transition-all ${formData.isRush ? 'right-1' : 'left-1'}`}
              ></div>
            </button>
          </div>

          <div className="flex flex-col">
            <label className="pb-1 text-xs font-medium text-slate-300">Description</label>
            <textarea
              className="min-h-[80px] w-full resize-none rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white placeholder:text-slate-600"
              placeholder="Enter job requirements, notes, or instructions..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isSubmitting}
            />
          </div>
        </form>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[#4d3465]/30 bg-background-dark/90 p-4 backdrop-blur-lg">
        <button
          onClick={handleSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-primary py-3 font-bold text-white shadow-lg transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent"></div>
              <span>Creating Job...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined">add_circle</span>
              <span>Create Job {formatJobCode(formData.jobCode)}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AdminCreateJob;
