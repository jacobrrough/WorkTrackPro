import React, { useState } from 'react';
import { Job, User, ViewState, JobStatus, BoardType } from '@/core/types';
import { dateInputToISO } from '@/core/date';

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
    status: JobStatus;
    isRush?: boolean;
    active: boolean;
    binLocation?: string;
    createdBy?: string;
    boardType?: BoardType;
    assignedUsers?: string[];
  }) => Promise<Job | null>;
  onNavigate: (view: ViewState) => void;
  users: User[];
  existingJobCodes: number[];
  currentUser: User;
}

const AdminCreateJob: React.FC<AdminCreateJobProps> = ({
  onCreate,
  onNavigate,
  users: _users,
  existingJobCodes,
  currentUser,
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
  const [formData, setFormData] = useState({
    name: '',
    po: '',
    jobCode: generateJobCode(),
    dueDate: '',
    ecd: '',
    qty: '',
    isRush: false,
    description: '',
    status: 'toBeQuoted' as JobStatus,
    binLocation: '',
  });

  // Comprehensive validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Required: Job name
    if (!formData.name.trim()) {
      errors.name = 'Job name is required';
    } else if (formData.name.trim().length < 3) {
      errors.name = 'Job name must be at least 3 characters';
    } else if (formData.name.trim().length > 100) {
      errors.name = 'Job name must be less than 100 characters';
    }

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

    // Quantity validation
    if (formData.qty.trim() && isNaN(Number(formData.qty))) {
      // Allow text quantities like "100 pcs"
      // but warn if it's not parseable
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

    try {
      const job = await onCreate({
        jobCode: formData.jobCode,
        name: formData.name.trim(),
        po: formData.po.trim() || undefined,
        dueDate: dateInputToISO(formData.dueDate),
        ECD: dateInputToISO(formData.ecd),
        qty: formData.qty.trim() || undefined,
        description: formData.description.trim() || undefined,
        status: formData.isRush ? 'rush' : formData.status,
        isRush: formData.isRush,
        active: true, // CRITICAL: Set active to true!
        binLocation: formData.binLocation.trim() || undefined,
        createdBy: currentUser.id, // ADDED: Track who created the job
        boardType: 'admin' as BoardType,
        assignedUsers: [],
      });

      if (job) {
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
          onClick={() => onNavigate('admin-console')}
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
          disabled={isSubmitting || !formData.name.trim()}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500 bg-red-500/10 p-4">
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
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Job Identity
            </p>
            <div className="mb-4 flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">Job Code</label>
              <button
                type="button"
                onClick={handleRegenerateJobCode}
                className="flex h-14 w-full items-center rounded-lg border border-[#4d3465] bg-[#261a32]/50 px-4 transition-colors hover:border-primary hover:bg-[#261a32]"
                title="Click to regenerate code"
              >
                <span className="font-mono text-lg font-bold text-primary">{formData.jobCode}</span>
                <span className="material-symbols-outlined ml-auto text-sm text-[#ad93c8]">
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
            <div className="mb-4 flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">Job Name *</label>
              <input
                className={`w-full rounded-lg border text-white focus:ring-1 focus:ring-primary ${
                  validationErrors.name ? 'border-red-500' : 'border-[#4d3465]'
                } h-14 bg-[#261a32] p-[15px] placeholder:text-slate-600`}
                placeholder="Enter job name"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (validationErrors.name) {
                    setValidationErrors({ ...validationErrors, name: undefined });
                  }
                }}
                required
                disabled={isSubmitting}
              />
              {validationErrors.name && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  {validationErrors.name}
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              References
            </p>
            <div className="flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">PO Number</label>
              <input
                className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] text-white placeholder:text-slate-600"
                placeholder="5300170272"
                value={formData.po}
                onChange={(e) => setFormData({ ...formData, po: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Logistics
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="pb-2 text-sm font-medium text-white">Due Date</label>
                <input
                  type="date"
                  className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] text-white"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col">
                <label className="pb-2 text-sm font-medium text-white">ECD (Est. Completion)</label>
                <input
                  type="date"
                  className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] text-white"
                  value={formData.ecd}
                  onChange={(e) => setFormData({ ...formData, ecd: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">Quantity</label>
              <input
                className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] text-white placeholder:text-slate-600"
                placeholder="e.g., 50 units"
                value={formData.qty}
                onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div className="mt-4 flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">Bin Location</label>
              <input
                className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] font-mono uppercase text-white placeholder:text-slate-600"
                placeholder="e.g., A4c (Rack A, Shelf 4, Section c)"
                value={formData.binLocation}
                onChange={(e) =>
                  setFormData({ ...formData, binLocation: e.target.value.toUpperCase() })
                }
                disabled={isSubmitting}
                maxLength={10}
              />
              <p className="mt-1 text-xs text-slate-500">
                Format: Letter-Number-letter (e.g., A4c)
              </p>
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#ad93c8]">
              Status
            </p>
            <div className="flex flex-col">
              <label className="pb-2 text-sm font-medium text-white">Initial Status</label>
              <select
                className="h-14 w-full rounded-lg border border-[#4d3465] bg-[#261a32] px-4 text-white"
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

          <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-4">
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
              className={`relative h-6 w-12 rounded-full transition-colors ${formData.isRush ? 'bg-red-500' : 'bg-slate-700'}`}
              disabled={isSubmitting}
            >
              <div
                className={`absolute top-1 size-4 rounded-full bg-white transition-all ${formData.isRush ? 'right-1' : 'left-1'}`}
              ></div>
            </button>
          </div>

          <div className="flex flex-col">
            <label className="pb-2 text-sm font-medium text-white">Description</label>
            <textarea
              className="min-h-[120px] w-full resize-none rounded-lg border border-[#4d3465] bg-[#261a32] p-[15px] text-white placeholder:text-slate-600"
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-bold text-white shadow-lg transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSubmitting || !formData.name.trim()}
        >
          {isSubmitting ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              <span>Creating Job...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined">add_circle</span>
              <span>Create Job #{formData.jobCode}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AdminCreateJob;
