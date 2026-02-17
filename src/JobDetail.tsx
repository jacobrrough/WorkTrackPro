import React, { useState, useEffect, useMemo } from 'react';
import {
  Job,
  ViewState,
  Shift,
  InventoryItem,
  User,
  Comment,
  JobStatus,
  Attachment,
} from '@/core/types';
import { jobService } from './pocketbase';
import FileUploadButton from './FileUploadButton';
import FileViewer from './FileViewer';
import AttachmentsList from './AttachmentsList';
import BinLocationScanner from './BinLocationScanner';
import ChecklistDisplay from './ChecklistDisplay';
import { formatBinLocation } from '@/core/validation';
import { formatDateOnly, isoToDateInput, dateInputToISO } from '@/core/date';
import { durationMs, formatDurationHMS } from './lib/timeUtils';
import { useToast } from './Toast';
import { StatusBadge } from './components/ui/StatusBadge';
import { getLaborSuggestion } from './lib/laborSuggestion';

interface JobDetailProps {
  job: Job;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  isClockedIn: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  activeShift: Shift | null;
  inventory: InventoryItem[];
  jobs: Job[]; // For labor hours suggestion
  shifts: Shift[]; // For labor hours suggestion
  onAddComment: (jobId: string, text: string) => Promise<Comment | null>;
  onAddInventory: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    unit: string
  ) => Promise<void>;
  onRemoveInventory: (jobId: string, jobInventoryId: string) => Promise<void>;
  onUpdateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  onReloadJob?: () => Promise<void>;
  currentUser: User;
  onAddAttachment: (jobId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: string) => Promise<boolean>;
  calculateAvailable: (item: InventoryItem) => number;
}

// All available statuses for editing
const ALL_STATUSES: { id: JobStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'rush', label: 'Rush' },
  { id: 'inProgress', label: 'In Progress' },
  { id: 'qualityControl', label: 'Quality Control' },
  { id: 'finished', label: 'Finished' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'onHold', label: 'On Hold' },
  { id: 'toBeQuoted', label: 'To Be Quoted' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'rfqReceived', label: 'RFQ Received' },
  { id: 'rfqSent', label: 'RFQ Sent' },
  { id: 'pod', label: "PO'd" },
  { id: 'waitingForPayment', label: 'Waiting For Payment' },
  { id: 'projectCompleted', label: 'Project Completed' },
];

const JobDetail: React.FC<JobDetailProps> = ({
  job,
  onNavigate,
  onBack,
  isClockedIn,
  onClockIn,
  onClockOut,
  activeShift,
  inventory,
  jobs,
  shifts,
  onAddComment,
  onAddInventory,
  onRemoveInventory,
  onUpdateJob,
  onReloadJob,
  currentUser,
  onAddAttachment,
  onDeleteAttachment,
  calculateAvailable,
}) => {
  const [timer, setTimer] = useState('00:00:00');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<string>('');
  const [inventoryQty, setInventoryQty] = useState('1');
  const [inventorySearch, setInventorySearch] = useState('');
  const [editingMaterialQty, setEditingMaterialQty] = useState<string | null>(null);
  const [materialQtyValue, setMaterialQtyValue] = useState<string>('');
  const { showToast } = useToast();

  // File viewing state
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);

  // Bin location state
  const [showBinLocationScanner, setShowBinLocationScanner] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: job.name,
    po: job.po || '',
    description: job.description || '',
    dueDate: isoToDateInput(job.dueDate),
    ecd: isoToDateInput(job.ecd),
    qty: job.qty || '',
    laborHours: job.laborHours?.toString() || '',
    status: job.status,
    isRush: job.isRush,
    binLocation: job.binLocation || '',
  });

  // Calculate labor hours suggestion from similar jobs
  const laborSuggestion = useMemo(() => {
    if (!editForm.name.trim()) return null;
    const suggestion = getLaborSuggestion(editForm.name, jobs, shifts);
    return suggestion > 0 ? suggestion : null;
  }, [editForm.name, jobs, shifts]);

  // Reset edit form when job changes
  useEffect(() => {
    setEditForm({
      name: job.name,
      po: job.po || '',
      description: job.description || '',
      dueDate: isoToDateInput(job.dueDate),
      ecd: isoToDateInput(job.ecd),
      qty: job.qty || '',
      laborHours: job.laborHours?.toString() || '',
      status: job.status,
      isRush: job.isRush,
      binLocation: job.binLocation || '',
    });
  }, [job]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isClockedIn && activeShift) {
      interval = setInterval(() => {
        setTimer(formatDurationHMS(durationMs(activeShift.clockInTime, null)));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isClockedIn, activeShift]);

  const handleSubmitComment = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const comment = await onAddComment(job.id, newComment.trim());
      if (comment) {
        setNewComment('');
        // Comment added successfully - the parent will refresh the job data
      } else {
        console.error('Failed to add comment - no comment returned');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    }
    setIsSubmitting(false);
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!editingCommentText.trim()) return;
    try {
      await jobService.updateComment(commentId, editingCommentText.trim());
      setEditingCommentId(null);
      setEditingCommentText('');
      // Reload job data to show updated comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error updating comment:', error);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await jobService.deleteComment(commentId);
      // Reload job data to remove deleted comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const handleAddInventory = async () => {
    if (!selectedInventory || !inventoryQty) return;
    const item = inventory.find((i) => i.id === selectedInventory);
    if (!item) return;

    setIsSubmitting(true);
    try {
      await onAddInventory(job.id, selectedInventory, parseFloat(inventoryQty), item.unit);
      setShowAddInventory(false);
      setSelectedInventory('');
      setInventoryQty('1');
      setInventorySearch('');
    } catch (error) {
      console.error('Error adding inventory:', error);
    }
    setIsSubmitting(false);
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) {
      showToast('Job name is required', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await onUpdateJob(job.id, {
        name: editForm.name.trim(),
        po: editForm.po.trim() || undefined,
        description: editForm.description.trim() || undefined,
        dueDate: dateInputToISO(editForm.dueDate),
        ECD: dateInputToISO(editForm.ecd),
        qty: editForm.qty.trim() || undefined,
        laborHours: editForm.laborHours ? parseFloat(editForm.laborHours) : undefined,
        status: editForm.status,
        isRush: editForm.isRush,
        binLocation: editForm.binLocation.trim() || undefined,
      });

      if (updated) {
        setIsEditing(false);
      } else {
        showToast('Failed to save changes', 'error');
      }
    } catch (error) {
      console.error('Error updating job:', error);
      showToast('Failed to save changes', 'error');
    }
    setIsSubmitting(false);
  };

  const handleCancelEdit = () => {
    setEditForm({
      name: job.name,
      po: job.po || '',
      description: job.description || '',
      dueDate: job.dueDate ? job.dueDate.split('T')[0] : '',
      ecd: job.ecd ? job.ecd.split('T')[0] : '',
      qty: job.qty || '',
      status: job.status,
      isRush: job.isRush,
      binLocation: job.binLocation || '',
    });
    setIsEditing(false);
  };

  const handleRemoveInventory = async (jobInvId: string) => {
    if (!jobInvId) return;
    try {
      await onRemoveInventory(job.id, jobInvId);
    } catch (error) {
      console.error('Error removing inventory:', error);
    }
  };

  // File attachment handlers
  const handleFileUpload = async (file: File, isAdminOnly = false): Promise<boolean> => {
    try {
      const success = await onAddAttachment(job.id, file, isAdminOnly);
      if (success && onReloadJob) {
        await onReloadJob();
      }
      return success;
    } catch (error) {
      console.error('Error uploading file:', error);
      return false;
    }
  };

  const handleViewAttachment = (attachment: Attachment) => {
    // Open all files in a new tab
    window.open(attachment.url, '_blank');
  };

  const handleCloseViewer = () => {
    setViewingAttachment(null);
  };

  const handleDeleteAttachment = async () => {
    if (!viewingAttachment) return;
    try {
      const success = await onDeleteAttachment(viewingAttachment.id);
      if (success && onReloadJob) {
        await onReloadJob();
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
    }
  };

  // Bin location handlers
  const handleBinLocationUpdate = async (location: string) => {
    try {
      const updated = await onUpdateJob(job.id, {
        binLocation: location || undefined,
      });

      if (updated && onReloadJob) {
        await onReloadJob();
      }
    } catch (error) {
      console.error('Error updating bin location:', error);
      showToast('Failed to update bin location', 'error');
    }
  };

  // Filter attachments by type
  const adminAttachments = (job.attachments || []).filter((a) => a.isAdminOnly);
  const regularAttachments = (job.attachments || []).filter((a) => !a.isAdminOnly);

  const formatCommentTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const filteredInventory = inventory.filter(
    (i) =>
      i.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      i.barcode?.toLowerCase().includes(inventorySearch.toLowerCase())
  );

  const getInventoryItem = (inventoryId: string) => {
    return inventory.find((i) => i.id === inventoryId);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-white">
      {/* Custom Scrollbar Styles */}
      <style>{`
        main::-webkit-scrollbar {
          width: 8px;
        }
        main::-webkit-scrollbar-track {
          background: transparent;
        }
        main::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        main::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background-dark/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              if (isEditing) {
                handleCancelEdit();
              } else if (onBack) {
                onBack();
              } else {
                onNavigate('dashboard');
              }
            }}
            className="flex size-10 items-center justify-center text-slate-400 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold text-white">
              {isEditing ? 'Edit Job' : `Job #${job.jobCode}`}
            </h1>
            {!isEditing && <StatusBadge status={job.status} size="sm" />}
            {isEditing && <p className="text-xs text-slate-400">Make changes below</p>}
          </div>
          {currentUser.isAdmin && (
            <button
              onClick={() => (isEditing ? handleSaveEdit() : setIsEditing(true))}
              disabled={isSubmitting}
              className={`flex size-10 items-center justify-center ${
                isEditing
                  ? 'text-green-400 hover:text-green-300'
                  : 'text-primary hover:text-primary/80'
              } ${isSubmitting ? 'opacity-50' : ''}`}
            >
              <span className="material-symbols-outlined">{isEditing ? 'check' : 'edit'}</span>
            </button>
          )}
          {!currentUser.isAdmin && <div className="w-10"></div>}
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto pb-24"
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
      >
        {/* EDIT MODE */}
        {isEditing ? (
          <div className="space-y-4 p-4">
            {/* Name */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Job Name *
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                placeholder="Enter job name"
              />
            </div>

            {/* PO Number */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                PO Number
              </label>
              <input
                type="text"
                value={editForm.po}
                onChange={(e) => setEditForm({ ...editForm, po: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                placeholder="Enter PO number"
              />
            </div>

            {/* Status */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Status
              </label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as JobStatus })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#1a1122]">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Rush Toggle */}
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="font-medium text-white">Rush Job</span>
              <button
                onClick={() => setEditForm({ ...editForm, isRush: !editForm.isRush })}
                className={`h-6 w-12 rounded-full transition-colors ${
                  editForm.isRush ? 'bg-red-500' : 'bg-white/20'
                }`}
              >
                <div
                  className={`h-5 w-5 transform rounded-full bg-white transition-transform ${
                    editForm.isRush ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Dates Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                  Due Date
                </label>
                <input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-slate-400">ECD</label>
                <input
                  type="date"
                  value={editForm.ecd}
                  onChange={(e) => setEditForm({ ...editForm, ecd: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Quantity
              </label>
              <input
                type="text"
                value={editForm.qty}
                onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                placeholder="e.g., 100 units"
              />
            </div>

            {/* Labor Hours (Expected Time) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-bold uppercase text-slate-400">
                  Labor Hours (expected time)
                </label>
                {laborSuggestion && (
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, laborHours: laborSuggestion.toString() })}
                    className="text-xs font-medium text-primary hover:text-primary/80"
                  >
                    Use {laborSuggestion.toFixed(1)}h
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.1"
                min="0"
                value={editForm.laborHours}
                onChange={(e) => setEditForm({ ...editForm, laborHours: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                placeholder="e.g., 8.5 (for calendar scheduling)"
              />
              <p className="mt-1 text-xs text-slate-500">
                Used for calendar timeline calculation. Suggestion from similar jobs shown above.
              </p>
            </div>

            {/* Bin Location */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Bin Location
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editForm.binLocation}
                  onChange={(e) =>
                    setEditForm({ ...editForm, binLocation: e.target.value.toUpperCase() })
                  }
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono uppercase text-white focus:border-primary focus:outline-none"
                  placeholder="e.g., A4c"
                  maxLength={10}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowBinLocationScanner(true);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-primary bg-primary/20 px-4 text-white transition-colors hover:bg-primary/30"
                  title="Scan QR Code"
                >
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                </button>
              </div>
              {editForm.binLocation && (
                <p className="mt-1 text-xs text-slate-400">
                  {formatBinLocation(editForm.binLocation)}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Description
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={5}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none"
                placeholder="Enter job description..."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleCancelEdit}
                className="flex-1 rounded-xl bg-white/10 py-3 font-bold text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSubmitting || !editForm.name.trim()}
                className="flex-1 rounded-xl bg-primary py-3 font-bold text-white disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Job Header Card - Streamlined */}
            <div className="bg-gradient-to-br from-[#2a1f35] to-[#1a1122] p-4">
              <div className="mb-3 flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {job.isRush && (
                      <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold uppercase text-white">
                        Rush
                      </span>
                    )}
                    <span className="text-xs font-bold text-primary">#{job.jobCode}</span>
                    {job.po && <span className="text-xs text-slate-400">\u2022 PO: {job.po}</span>}
                  </div>
                  <h2 className="text-lg font-bold leading-tight text-white">{job.name}</h2>
                </div>
              </div>

              {/* Timer if clocked in - Compact */}
              {isClockedIn && (
                <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/20 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
                      <span className="text-xs font-medium text-green-400">Active</span>
                    </div>
                    <span className="font-mono text-xl font-bold text-green-400">{timer}</span>
                  </div>
                </div>
              )}

              {/* Info Grid - Compact 2x2 */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Due Date</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.dueDate)}</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Status</p>
                  <StatusBadge status={job.status} size="sm" />
                </div>
                <div className="rounded-lg bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">ECD</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.ecd)}</p>
                </div>
                <div className="rounded-lg bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Quantity</p>
                  <p className="text-sm font-bold text-white">{job.qty || 'N/A'}</p>
                </div>
              </div>

              {/* Bin Location - Compact */}
              {job.binLocation && (
                <button
                  onClick={() => setShowBinLocationScanner(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-primary/30 bg-primary/10 p-2.5 transition-colors hover:bg-primary/15"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="material-symbols-outlined text-base text-primary">
                      location_on
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Bin Location</p>
                      <p className="truncate font-mono text-sm font-bold text-white">
                        {job.binLocation}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-base text-primary">
                    chevron_right
                  </span>
                </button>
              )}

              {!job.binLocation && currentUser.isAdmin && (
                <button
                  onClick={() => setShowBinLocationScanner(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2.5 transition-colors hover:bg-white/10"
                >
                  <span className="material-symbols-outlined text-base text-primary">
                    add_location
                  </span>
                  <span className="text-sm font-medium text-white">Add Bin Location</span>
                </button>
              )}
            </div>

            {/* Currently Working */}
            {job.workers && job.workers.length > 0 && (
              <div className="p-4 pt-0">
                <div className="rounded-xl bg-[#1a1122] p-3">
                  <p className="mb-2 text-xs text-slate-400">Currently Working:</p>
                  <div className="flex flex-wrap gap-2">
                    {job.workers.map((initials, idx) => (
                      <div
                        key={idx}
                        className="flex size-8 items-center justify-center rounded-full border-2 border-green-500 bg-green-500/20"
                      >
                        <span className="text-xs font-bold text-green-400">{initials}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {job.description && (
              <div className="p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    description
                  </span>
                  Description
                </h3>
                <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl bg-[#261a32] p-4 text-sm text-slate-300">
                  {job.description.split('\n').map((line, idx) => {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('http')) {
                      const urlParts = trimmedLine.split('/');
                      const lastPart =
                        urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || 'Link';
                      const displayName = lastPart.split('-').slice(1).join(' ') || lastPart;

                      return (
                        <a
                          key={idx}
                          href={trimmedLine}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-primary hover:underline"
                          title={trimmedLine}
                        >
                          <span className="material-symbols-outlined align-middle text-sm">
                            link
                          </span>{' '}
                          {displayName.substring(0, 60)}
                        </a>
                      );
                    }
                    return trimmedLine ? (
                      <p key={idx} className="whitespace-pre-wrap">
                        {line}
                      </p>
                    ) : (
                      <div key={idx} className="h-1" />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Checklist Section */}
            <div className="p-4 pt-0">
              <ChecklistDisplay
                jobId={job.id}
                jobStatus={job.status}
                currentUser={currentUser}
                compact={false}
              />
            </div>

            {/* Materials / Inventory Section */}
            <div className="p-4 pt-0">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    inventory_2
                  </span>
                  Materials ({job.inventoryItems?.length || 0})
                </h3>
                {currentUser.isAdmin && (
                  <button
                    onClick={() => setShowAddInventory(true)}
                    className="flex items-center gap-1 text-xs font-bold text-primary"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Add
                  </button>
                )}
              </div>

              {!job.inventoryItems || job.inventoryItems.length === 0 ? (
                <div className="rounded-xl bg-[#261a32] p-4 text-center">
                  <span className="material-symbols-outlined mb-2 text-3xl text-slate-500">
                    inventory_2
                  </span>
                  <p className="text-sm text-slate-400">No materials assigned</p>
                  {currentUser.isAdmin && (
                    <button
                      onClick={() => setShowAddInventory(true)}
                      className="mt-2 text-sm font-bold text-primary"
                    >
                      + Add materials
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {(job.inventoryItems || []).map((item) => {
                    const invItem = getInventoryItem(item.inventoryId);
                    const available = invItem
                      ? (invItem.available ?? calculateAvailable(invItem))
                      : 0;
                    const isLow = available < item.quantity;
                    const isEditingThis = editingMaterialQty === item.id;

                    return (
                      <div
                        key={item.id || item.inventoryId}
                        className="overflow-hidden rounded-xl bg-[#261a32]"
                      >
                        <div className="flex items-center justify-between p-3">
                          <button
                            onClick={() => {
                              if (invItem) {
                                onNavigate('inventory-detail', invItem.id);
                              }
                            }}
                            className="-ml-1 flex flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-white/5"
                          >
                            {invItem?.imageUrl ? (
                              <img
                                src={invItem.imageUrl}
                                alt={item.inventoryName || 'Material'}
                                className={`size-10 flex-shrink-0 rounded-lg object-cover ${isLow ? 'ring-2 ring-red-500' : ''}`}
                              />
                            ) : (
                              <div
                                className={`flex size-10 flex-shrink-0 items-center justify-center rounded-lg ${isLow ? 'bg-red-500/20' : 'bg-white/10'}`}
                              >
                                <span
                                  className={`material-symbols-outlined ${isLow ? 'text-red-400' : 'text-slate-400'}`}
                                >
                                  {isLow ? 'warning' : 'inventory_2'}
                                </span>
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-white transition-colors hover:text-primary">
                                {item.inventoryName || 'Unknown Item'}
                              </p>
                              <p className="text-xs text-slate-400">
                                Need:{' '}
                                {isEditingThis ? (
                                  <input
                                    type="number"
                                    value={materialQtyValue}
                                    onChange={(e) => setMaterialQtyValue(e.target.value)}
                                    onBlur={async () => {
                                      const newQty = parseFloat(materialQtyValue);
                                      if (newQty > 0 && newQty !== item.quantity && item.id) {
                                        setIsSubmitting(true);
                                        await onRemoveInventory(job.id, item.id);
                                        await onAddInventory(
                                          job.id,
                                          item.inventoryId,
                                          newQty,
                                          item.unit
                                        );
                                        setIsSubmitting(false);
                                      }
                                      setEditingMaterialQty(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingMaterialQty(null);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-16 rounded border border-primary bg-white/10 px-2 py-0.5 text-xs text-white"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    onClick={(e) => {
                                      if (currentUser.isAdmin && item.id) {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setEditingMaterialQty(item.id);
                                        setMaterialQtyValue(item.quantity.toString());
                                      }
                                    }}
                                    className={
                                      currentUser.isAdmin
                                        ? '-mx-2 -my-1 inline-block cursor-pointer rounded px-2 py-1 transition-colors hover:bg-primary/10 hover:text-primary hover:underline'
                                        : ''
                                    }
                                    title={currentUser.isAdmin ? 'Click to edit quantity' : ''}
                                  >
                                    {item.quantity}
                                  </span>
                                )}{' '}
                                {item.unit}
                                {invItem && (
                                  <span className="ml-2">
                                    • Available: {invItem.available ?? calculateAvailable(invItem)}
                                  </span>
                                )}
                              </p>
                            </div>
                          </button>

                          {currentUser.isAdmin && item.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveInventory(item.id!);
                              }}
                              className="ml-2 p-1 text-red-400 hover:text-red-300"
                              title="Remove material"
                            >
                              <span className="material-symbols-outlined text-lg">delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Admin Files Section (Admin Only) */}
            {currentUser.isAdmin && (
              <div className="p-4 pt-0">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <span className="material-symbols-outlined text-lg text-red-400">
                      admin_panel_settings
                    </span>
                    Admin Files ({adminAttachments.length})
                  </h3>
                  <FileUploadButton
                    onUpload={(file) => handleFileUpload(file, true)}
                    label="Upload Admin File"
                  />
                </div>

                <AttachmentsList
                  attachments={adminAttachments}
                  onViewAttachment={handleViewAttachment}
                  canUpload={true}
                  showUploadButton={false}
                />
              </div>
            )}

            {/* Attachments Section (Everyone) */}
            <div className="p-4 pt-0">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    attach_file
                  </span>
                  Attachments ({regularAttachments.length})
                </h3>
                {currentUser.isAdmin && (
                  <FileUploadButton
                    onUpload={(file) => handleFileUpload(file, false)}
                    label="Upload File"
                  />
                )}
              </div>

              <AttachmentsList
                attachments={regularAttachments}
                onViewAttachment={handleViewAttachment}
                canUpload={currentUser.isAdmin}
                showUploadButton={false}
              />
            </div>

            {/* Comments Section */}
            <div className="p-4 pt-0">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <span className="material-symbols-outlined text-lg text-primary">chat</span>
                Comments ({job.comments?.length || 0})
              </h3>

              {/* Add Comment */}
              <div className="mb-3 rounded-xl bg-[#261a32] p-3">
                <div className="flex gap-2">
                  <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {currentUser.initials}
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                      rows={2}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleSubmitComment}
                        disabled={!newComment.trim() || isSubmitting}
                        className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {isSubmitting ? 'Posting...' : 'Post'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Comments List */}
              <div className="space-y-2">
                {(job.comments || []).map((comment) => {
                  const isOwnComment = comment.user === currentUser.id;
                  const canEdit = isOwnComment || currentUser.isAdmin;
                  const isEditingThis = editingCommentId === comment.id;

                  return (
                    <div key={comment.id} className="rounded-xl bg-[#261a32] p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-bold text-white">
                          {comment.userInitials || 'U'}
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">
                                {comment.userName || 'User'}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatCommentTime(comment.created || comment.timestamp)}
                              </p>
                            </div>
                            {canEdit && !isEditingThis && (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    setEditingCommentId(comment.id);
                                    setEditingCommentText(comment.text);
                                  }}
                                  className="p-1 text-slate-400 hover:text-primary"
                                  title="Edit comment"
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteComment(comment.id)}
                                  className="p-1 text-slate-400 hover:text-red-500"
                                  title="Delete comment"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {isEditingThis ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                className="w-full resize-none rounded border border-primary/30 bg-[#1a1122] p-2 text-sm text-white outline-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => {
                                    setEditingCommentId(null);
                                    setEditingCommentText('');
                                  }}
                                  className="rounded px-3 py-1 text-xs font-bold text-slate-400 hover:bg-slate-700"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleUpdateComment(comment.id)}
                                  disabled={!editingCommentText.trim()}
                                  className="rounded bg-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-300">{comment.text}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(!job.comments || job.comments.length === 0) && (
                  <p className="py-4 text-center text-sm text-slate-500">No comments yet</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Clock In/Out Button - Fixed at bottom, above nav */}
      {!isEditing && (
        <div className="fixed bottom-20 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-4 md:max-w-2xl lg:max-w-4xl xl:max-w-6xl">
          {isClockedIn ? (
            <button
              onClick={onClockOut}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-6 py-3 font-bold text-white shadow-xl transition-all hover:bg-red-600 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined">logout</span>
              <span>Clock Out</span>
            </button>
          ) : (
            <button
              onClick={onClockIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 font-bold text-white shadow-xl transition-all hover:bg-green-600 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined">login</span>
              <span>Clock In</span>
            </button>
          )}
        </div>
      )}

      {/* Add Inventory Modal */}
      {showAddInventory && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/80 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full flex-col rounded-t-2xl border-t border-white/10 bg-background-dark p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add Material</h3>
              <button
                onClick={() => setShowAddInventory(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                search
              </span>
              <input
                type="text"
                placeholder="Search inventory..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className="h-12 w-full rounded-lg border border-white/20 bg-white/10 pl-10 pr-4 text-white"
              />
            </div>

            {/* Inventory List */}
            <div className="mb-4 flex-1 space-y-2 overflow-y-auto">
              {filteredInventory.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedInventory(item.id)}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                    selectedInventory === item.id
                      ? 'border border-primary bg-primary/20'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">
                    Available: {item.available ?? calculateAvailable(item)} {item.unit} \u2022{' '}
                    {item.category}
                  </p>
                </button>
              ))}
            </div>

            {/* Quantity & Submit */}
            {selectedInventory && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400">
                    Quantity Needed
                  </label>
                  <input
                    type="number"
                    value={inventoryQty}
                    onChange={(e) => setInventoryQty(e.target.value)}
                    className="mt-1 h-12 w-full rounded-lg border border-white/20 bg-white/10 px-4 text-white"
                    min="1"
                  />
                </div>
                <button
                  onClick={handleAddInventory}
                  disabled={isSubmitting}
                  className="w-full rounded-xl bg-primary py-4 font-bold text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add to Job'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewingAttachment && (
        <FileViewer
          attachment={viewingAttachment}
          onClose={handleCloseViewer}
          onDelete={handleDeleteAttachment}
          canDelete={currentUser.isAdmin}
        />
      )}

      {/* Bin Location Scanner Modal */}
      {showBinLocationScanner && (
        <BinLocationScanner
          currentLocation={isEditing ? editForm.binLocation : job.binLocation}
          onLocationUpdate={(location) => {
            if (isEditing) {
              setEditForm({ ...editForm, binLocation: location });
              setShowBinLocationScanner(false);
            } else {
              handleBinLocationUpdate(location);
              setShowBinLocationScanner(false);
            }
          }}
          onClose={() => setShowBinLocationScanner(false)}
        />
      )}
    </div>
  );
};

export default JobDetail;
