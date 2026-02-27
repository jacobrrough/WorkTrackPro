import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  InventoryItem,
  ViewState,
  getCategoryDisplayName,
  InventoryCategory,
  Attachment,
  Job,
} from '@/core/types';
import { inventoryHistoryService, inventoryService } from './pocketbase';
import { useToast } from './Toast';
import jsQR from 'jsqr';
import QRScanner from './components/QRScanner';
import AttachmentsList from './AttachmentsList';
import FileUploadButton from './FileUploadButton';
import FileViewer from './FileViewer';
import { shouldShowInventoryDetailPrice } from '@/lib/priceVisibility';
import { isAllocationActiveStatus } from '@/lib/inventoryCalculations';

interface InventoryDetailProps {
  item: InventoryItem;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onUpdateItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onAddAttachment: (inventoryId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: string, inventoryId: string) => Promise<boolean>;
  onReloadItem?: () => Promise<void>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  jobs?: Job[];
}

const InventoryDetail: React.FC<InventoryDetailProps> = ({
  item,
  onNavigate: _onNavigate,
  onBack,
  onUpdateStock,
  onUpdateItem,
  onAddAttachment,
  onDeleteAttachment,
  onReloadItem,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  jobs = [],
}) => {
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [currentItem, setCurrentItem] = useState<InventoryItem>(item);
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);

  // QR Scanner state - ROBUST VERSION (for barcode)
  const [isScanning, setIsScanning] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  // Bin location scanner state
  const [isScanningBin, setIsScanningBin] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState(currentItem.name);
  const [editDescription, setEditDescription] = useState(currentItem.description || '');
  const [editCategory, setEditCategory] = useState(currentItem.category);
  const [editInStock, setEditInStock] = useState(currentItem.inStock);
  const [editPrice, setEditPrice] = useState(currentItem.price || 0);
  const [editUnit, setEditUnit] = useState(currentItem.unit);
  const [editBarcode, setEditBarcode] = useState(currentItem.barcode || '');
  const [editBinLocation, setEditBinLocation] = useState(currentItem.binLocation || '');
  const [editVendor, setEditVendor] = useState(currentItem.vendor || '');
  const [editReorderPoint, setEditReorderPoint] = useState(currentItem.reorderPoint || 0);
  const [editOnOrder, setEditOnOrder] = useState(currentItem.onOrder || 0);
  const [editReason, setEditReason] = useState('');

  // Update edit form when currentItem changes
  useEffect(() => {
    setEditName(currentItem.name);
    setEditDescription(currentItem.description || '');
    setEditCategory(currentItem.category);
    setEditInStock(currentItem.inStock);
    setEditPrice(currentItem.price || 0);
    setEditUnit(currentItem.unit);
    setEditBarcode(currentItem.barcode || '');
    setEditBinLocation(currentItem.binLocation || '');
    setEditVendor(currentItem.vendor || '');
    setEditReorderPoint(currentItem.reorderPoint || 0);
    setEditOnOrder(currentItem.onOrder || 0);
  }, [currentItem]);

  const allocated = currentItem.allocated ?? calculateAllocated(currentItem.id);
  const available = currentItem.available ?? calculateAvailable(currentItem);
  const minStock = currentItem.reorderPoint ?? 0;
  const minStockPercent = minStock > 0 ? Math.min(200, (available / minStock) * 100) : 100;
  const sku = (currentItem.barcode || currentItem.id.slice(0, 8)).toUpperCase();
  const reorderCostEstimate =
    shouldShowInventoryDetailPrice(item, isAdmin) && minStock > 0
      ? minStock * (item.price ?? 0)
      : null;
  const linkedJobs = useMemo(() => {
    const entries: Array<{ job: Job; quantity: number; jobInventoryId: string }> = [];
    for (const job of jobs) {
      if (!isAllocationActiveStatus(job.status)) continue;
      for (const ji of job.inventoryItems ?? []) {
        if (ji.inventoryId === currentItem.id) {
          entries.push({ job, quantity: ji.quantity, jobInventoryId: ji.id });
        }
      }
    }
    return entries;
  }, [jobs, currentItem.id]);

  // Update currentItem when item prop changes
  useEffect(() => {
    setCurrentItem(item);
  }, [item]);

  // Load item with attachments and history when viewing
  useEffect(() => {
    if (!isEditing) {
      loadItemWithAttachments();
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadItemWithAttachments and loadHistory are stable
  }, [currentItem.id, isEditing]);

  const loadItemWithAttachments = async () => {
    try {
      const itemWithAttachments = await inventoryService.getInventoryWithAttachments(
        currentItem.id
      );
      if (itemWithAttachments) {
        setCurrentItem(itemWithAttachments);
      }
    } catch (error) {
      console.error('Failed to load item with attachments:', error);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const historyData = await inventoryHistoryService.getHistory(currentItem.id);
      setHistory(historyData);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
    setLoadingHistory(false);
  };

  // File attachment handlers
  const handleFileUpload = async (file: File, isAdminOnly = false): Promise<boolean> => {
    try {
      const success = await onAddAttachment(currentItem.id, file, isAdminOnly);
      if (success) {
        await loadItemWithAttachments();
        if (onReloadItem) {
          await onReloadItem();
        }
        showToast('File uploaded successfully', 'success');
      } else {
        showToast('Failed to upload file', 'error');
      }
      return success;
    } catch (error) {
      console.error('Error uploading file:', error);
      showToast('Failed to upload file', 'error');
      return false;
    }
  };

  const handleViewAttachment = (attachment: Attachment) => {
    setViewingAttachment(attachment);
  };

  const handleCloseViewer = () => {
    setViewingAttachment(null);
  };

  const handleDeleteAttachment = async () => {
    if (!viewingAttachment) return;
    try {
      const success = await onDeleteAttachment(viewingAttachment.id, currentItem.id);
      if (success) {
        await loadItemWithAttachments();
        if (onReloadItem) {
          await onReloadItem();
        }
        setViewingAttachment(null);
        showToast('File deleted successfully', 'success');
      } else {
        showToast('Failed to delete file', 'error');
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
      showToast('Failed to delete file', 'error');
    }
  };

  // Filter attachments by type
  const adminAttachments = (currentItem.attachments || []).filter((a) => a.isAdminOnly);
  const regularAttachments = (currentItem.attachments || []).filter((a) => !a.isAdminOnly);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only on unmount
  }, []);

  // ROBUST QR SCANNER FUNCTIONS
  const startScan = async () => {
    setIsScanning(true);
    setScanAttempts(0);
    scanningRef.current = true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera requires HTTPS. On iOS, use https://your-ip:port');
      }

      let stream: MediaStream | null = null;

      // Try rear camera first (best for scanning)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        // Try front camera
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          // Try any camera
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }

      if (!stream) throw new Error('Could not access camera');

      streamRef.current = stream;

      if (videoRef.current && mountedRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.setAttribute('muted', 'true');

        // Wait for video to be ready
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video ref lost'));
            return;
          }

          const video = videoRef.current;

          video.addEventListener(
            'loadedmetadata',
            () => {
              resolve();
            },
            { once: true }
          );

          video.addEventListener(
            'error',
            () => {
              console.error('❌ Video error');
              reject(new Error('Video error'));
            },
            { once: true }
          );

          video.play().catch(reject);
          setTimeout(() => reject(new Error('Video load timeout')), 5000);
        });

        // Start scanning
        scanFrame();
      }
    } catch (err) {
      console.error('❌ Camera error:', err);
      showToast(err instanceof Error ? err.message : 'Camera access failed', 'error');
      setIsScanning(false);
      scanningRef.current = false;
    }
  };

  const scanFrame = useCallback(() => {
    if (!scanningRef.current || !mountedRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      requestAnimationFrame(scanFrame);
      return;
    }

    // Wait for video to be ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanFrame);
      return;
    }

    // Wait for valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      requestAnimationFrame(scanFrame);
      return;
    }

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        requestAnimationFrame(scanFrame);
        return;
      }

      // Match canvas to video size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw current frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Update scan attempts
      const attempts = scanAttempts + 1;
      setScanAttempts(attempts);

      if (attempts % 30 === 0) {
        // Throttle progress; actual scan runs every frame
      }

      // Try to detect QR code with inversion attempts
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (code && code.data) {
        scanningRef.current = false;
        stopScan();

        // Fill in barcode field
        setEditBarcode(code.data);
        return;
      }

      // EXTRA INVERSION LOGIC - Try manual inversion every 10th frame
      if (attempts % 10 === 0) {
        const invertedData = new Uint8ClampedArray(imageData.data);
        for (let i = 0; i < invertedData.length; i += 4) {
          invertedData[i] = 255 - invertedData[i]; // R
          invertedData[i + 1] = 255 - invertedData[i + 1]; // G
          invertedData[i + 2] = 255 - invertedData[i + 2]; // B
        }

        const invertedCode = jsQR(invertedData, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (invertedCode && invertedCode.data) {
          scanningRef.current = false;
          stopScan();
          setEditBarcode(invertedCode.data);
          return;
        }
      }
    } catch (err) {
      console.error('❌ Scan error:', err);
    }

    // Continue scanning
    if (scanningRef.current) {
      requestAnimationFrame(scanFrame);
    }
    // stopScan stable; omit to avoid re-creating scanFrame every time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanAttempts]);

  const stopScan = useCallback(() => {
    setIsScanning(false);
    scanningRef.current = false;

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleStartEdit = () => {
    // Reset form to current values
    setEditName(currentItem.name);
    setEditDescription(currentItem.description || '');
    setEditCategory(currentItem.category);
    setEditInStock(currentItem.inStock);
    setEditPrice(currentItem.price || 0);
    setEditUnit(currentItem.unit);
    setEditBarcode(currentItem.barcode || '');
    setEditBinLocation(currentItem.binLocation || '');
    setEditVendor(currentItem.vendor || '');
    setEditReorderPoint(currentItem.reorderPoint || 0);
    setEditOnOrder(currentItem.onOrder || 0);
    setEditReason('');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditReason('');
  };

  const handleSave = async () => {
    if (!isAdmin) return;

    // Validate
    if (!editName.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    if (!editUnit.trim()) {
      showToast('Unit is required', 'error');
      return;
    }
    const stockChanged = editInStock !== currentItem.inStock;
    if (stockChanged && !editReason.trim()) {
      showToast('Please provide a reason for stock change', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await onUpdateItem(currentItem.id, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        category: editCategory,
        price: editPrice || undefined,
        unit: editUnit.trim(),
        barcode: editBarcode.trim() || undefined,
        binLocation: editBinLocation.trim() || undefined,
        vendor: editVendor.trim() || undefined,
        reorderPoint: editReorderPoint > 0 ? editReorderPoint : undefined,
        onOrder: editOnOrder || 0,
      });

      if (!updated) {
        showToast('Failed to update item', 'error');
        setIsSaving(false);
        return;
      }

      // If stock changed, update stock (this creates history)
      if (stockChanged) {
        await onUpdateStock(currentItem.id, editInStock, editReason.trim());
      }

      setIsEditing(false);
      setEditReason('');

      // Reload history
      await loadHistory();
    } catch (error) {
      console.error('Save error:', error);
      showToast('Failed to save changes', 'error');
    }
    setIsSaving(false);
  };

  const formatHistoryDate = (dateString: string | null | undefined) => {
    if (dateString == null || dateString === '') return 'N/A';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      manual_adjust: 'Manual Adjustment',
      reconcile_job: 'Job Reconciliation',
      reconcile_job_reversal: 'Delivery Reversal',
      reconcile_po: 'PO Reconciliation',
      order_received: 'Order Received',
      order_placed: 'Order Placed',
      allocated_to_job: 'Allocated To Job',
      stock_correction: 'Stock Correction',
    };
    return labels[action] || action;
  };

  if (isEditing) {
    return (
      <>
        <div className="flex h-full flex-col bg-background-dark">
          {/* Header */}
          <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={handleCancelEdit} className="text-white">
                  <span className="material-symbols-outlined">close</span>
                </button>
                <h1 className="text-xl font-bold text-white">Edit Item</h1>
              </div>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-sm bg-primary px-6 py-2 font-bold text-white disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {/* Basic Info */}
            <div className="space-y-3 rounded-sm bg-card-dark p-3">
              <h2 className="text-lg font-bold text-white">Basic Information</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Name *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full resize-none rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Category *</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as InventoryCategory)}
                  className="w-full cursor-pointer rounded-sm border-2 border-primary/50 bg-background-light px-4 py-3 font-bold text-white hover:border-primary focus:border-primary focus:outline-none"
                >
                  <option value="material" className="bg-background-dark text-white">
                    Material
                  </option>
                  <option value="foam" className="bg-background-dark text-white">
                    Foam
                  </option>
                  <option value="trimCord" className="bg-background-dark text-white">
                    Trim Cord
                  </option>
                  <option value="printing3d" className="bg-background-dark text-white">
                    3D Printing
                  </option>
                  <option value="chemicals" className="bg-background-dark text-white">
                    Chemicals
                  </option>
                  <option value="hardware" className="bg-background-dark text-white">
                    Hardware
                  </option>
                  <option value="miscSupplies" className="bg-background-dark text-white">
                    Misc Supplies
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Unit *</label>
                <input
                  type="text"
                  value={editUnit}
                  onChange={(e) => setEditUnit(e.target.value)}
                  placeholder="e.g., ft, lbs, ea"
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">
                  Price Per Unit
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editPrice || ''}
                  onChange={(e) => setEditPrice(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>

            {/* Stock */}
            <div className="space-y-3 rounded-sm bg-card-dark p-3">
              <h2 className="text-lg font-bold text-white">Stock Levels</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">In Stock *</label>
                <input
                  type="number"
                  step="1"
                  value={editInStock}
                  onChange={(e) => setEditInStock(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
                {editInStock !== currentItem.inStock && (
                  <p className="mt-1 text-xs text-yellow-400">
                    Current: {currentItem.inStock} → New: {editInStock} (
                    {editInStock > currentItem.inStock ? '+' : ''}
                    {editInStock - currentItem.inStock})
                  </p>
                )}
              </div>

              {editInStock !== currentItem.inStock && (
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-400">
                    Reason for Change *
                  </label>
                  <input
                    type="text"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="e.g., Physical count, received shipment, correction"
                    className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-sm border border-white/10 bg-white/5 px-4 py-3">
                  <p className="mb-1 text-xs text-slate-400">Allocated</p>
                  <p className="text-lg font-bold text-yellow-400">{allocated}</p>
                  <p className="text-xs text-slate-500">(auto-calculated)</p>
                </div>
                <div className="rounded-sm border border-white/10 bg-white/5 px-4 py-3">
                  <p className="mb-1 text-xs text-slate-400">Available</p>
                  <p className="text-lg font-bold text-green-400">
                    {Math.max(0, editInStock - allocated)}
                  </p>
                  <p className="text-xs text-slate-500">(auto-calculated)</p>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Reorder Point</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={editReorderPoint > 0 ? editReorderPoint : ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                    setEditReorderPoint(val);
                  }}
                  placeholder="Not set (enter number to enable)"
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Alert when available stock falls below this level. Leave empty or set to 0 to
                  disable.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">On Order</label>
                <input
                  type="number"
                  step="1"
                  value={editOnOrder || ''}
                  onChange={(e) => setEditOnOrder(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>

            {/* Location & Vendor */}
            <div className="space-y-3 rounded-sm bg-card-dark p-3">
              <h2 className="text-lg font-bold text-white">Location & Vendor</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Barcode</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editBarcode}
                    onChange={(e) => setEditBarcode(e.target.value)}
                    placeholder="Scan or enter manually"
                    className="flex-1 rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                  <button
                    type="button"
                    onClick={startScan}
                    className="rounded-sm border border-primary bg-primary/20 px-4 py-3 text-primary transition-colors hover:bg-primary/30"
                  >
                    <span className="material-symbols-outlined">qr_code_scanner</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Bin Location</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editBinLocation}
                    onChange={(e) => setEditBinLocation(e.target.value)}
                    placeholder="e.g., A4c"
                    className="flex-1 rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setIsScanningBin(true)}
                    className="rounded-sm border border-primary bg-primary/20 px-4 py-3 text-primary transition-colors hover:bg-primary/30"
                    title="Scan bin location QR"
                  >
                    <span className="material-symbols-outlined">qr_code_scanner</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Vendor</label>
                <input
                  type="text"
                  value={editVendor}
                  onChange={(e) => setEditVendor(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* QR Scanner Modal */}
        {isScanning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
            <div className="w-full max-w-md rounded-sm bg-card-dark p-3">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
                <button onClick={stopScan} className="text-white">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-sm" playsInline muted autoPlay />
                <canvas ref={canvasRef} className="hidden" />
                {/* Scanning indicator */}
                <div className="absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
                  Scanning... ({scanAttempts} frames)
                </div>
              </div>
              <p className="mt-4 text-center text-sm text-slate-400">
                Position barcode in view. Camera will auto-detect.
              </p>
            </div>
          </div>
        )}
      </>
    );
  }

  // VIEW MODE
  return (
    <>
      <div className="flex h-full flex-col bg-background-dark">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (onBack) {
                    onBack();
                  }
                }}
                className="flex size-10 items-center justify-center text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              <div className="flex-1">
                <h1 className="text-xl font-bold text-white">{currentItem.name}</h1>
                <p className="text-sm text-slate-400">
                  {getCategoryDisplayName(currentItem.category)}
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={handleStartEdit}
                className="rounded-sm bg-primary px-4 py-2 font-bold text-white"
              >
                Edit
              </button>
            )}
            {!isAdmin && <div className="text-sm text-slate-500">View Only</div>}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <div className="rounded-sm border border-white/10 bg-card-dark p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">SKU</p>
                <p className="font-mono text-sm text-white">{sku}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">In Stock</p>
                <p className="text-3xl font-bold text-white">{currentItem.inStock}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200">
                {getCategoryDisplayName(currentItem.category)}
              </span>
              {currentItem.vendor && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-200">
                  {currentItem.vendor}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {currentItem.description && (
            <div className="rounded-sm bg-card-dark p-3">
              <h2 className="mb-2 text-sm font-bold text-white">Description</h2>
              <p className="text-sm leading-relaxed text-slate-300">{currentItem.description}</p>
            </div>
          )}

          {/* Stock Overview */}
          <div className="rounded-sm bg-card-dark p-3">
            <h2 className="mb-4 text-lg font-bold text-white">Stock Overview</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-sm bg-white/5 p-3">
                <p className="text-sm text-slate-400">In Stock</p>
                <p className="text-2xl font-bold text-white">{currentItem.inStock}</p>
              </div>
              <div className="rounded-sm bg-white/5 p-3">
                <p className="text-sm text-slate-400">Available</p>
                <p className="text-2xl font-bold text-green-400">{available}</p>
              </div>
              <div className="rounded-sm bg-white/5 p-3">
                <p className="text-sm text-slate-400">Allocated (needed for jobs)</p>
                <p className="text-2xl font-bold text-yellow-400">{allocated}</p>
                <p className="text-xs text-slate-500">PO&apos;d / in-production jobs only</p>
              </div>
              <div className="rounded-sm bg-white/5 p-3">
                <p className="text-sm text-slate-400">On Order</p>
                <p className="text-2xl font-bold text-blue-400">{currentItem.onOrder || 0}</p>
              </div>
            </div>

            {minStock > 0 && (
              <div className="mt-4 rounded-sm border border-white/10 bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">Min Stock Coverage</span>
                  <span className="text-slate-400">
                    {available} / {minStock}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full ${available <= 0 ? 'bg-red-500' : available < minStock ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.max(5, Math.min(minStockPercent, 100))}%` }}
                  />
                </div>
              </div>
            )}

            {(currentItem.reorderPoint != null &&
              currentItem.reorderPoint > 0 &&
              available <= currentItem.reorderPoint) ||
            (allocated > 0 && available < allocated) ? (
              <div className="mt-4 space-y-1 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
                <p className="font-bold text-red-400">
                  {currentItem.reorderPoint != null &&
                  currentItem.reorderPoint > 0 &&
                  available <= currentItem.reorderPoint &&
                  allocated > 0 &&
                  available < allocated
                    ? '⚠️ Below reorder point & short for jobs'
                    : currentItem.reorderPoint != null &&
                        currentItem.reorderPoint > 0 &&
                        available <= currentItem.reorderPoint
                      ? '⚠️ Below reorder point'
                      : '⚠️ Short for jobs'}
                </p>
                {currentItem.reorderPoint != null &&
                  currentItem.reorderPoint > 0 &&
                  available <= currentItem.reorderPoint && (
                    <p className="text-sm font-bold text-red-300">
                      Available ({available}) is at or below reorder point (
                      {currentItem.reorderPoint}).
                    </p>
                  )}
                {allocated > 0 && available < allocated && (
                  <p className="text-sm text-red-300">
                    {allocated} {item.unit} needed to complete all jobs (committed to PO&apos;d /
                    in-production jobs). Short by {allocated - available} {item.unit} — order at
                    least this much to fulfill current jobs.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {/* Location & Barcode */}
          <div className="space-y-3 rounded-sm bg-card-dark p-3">
            <h2 className="mb-4 text-lg font-bold text-white">Location & Barcode</h2>

            {currentItem.barcode && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Barcode</p>
                <p className="font-mono text-sm text-white">{currentItem.barcode}</p>
              </div>
            )}

            {currentItem.binLocation && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Bin Location</p>
                <p className="font-bold text-white">{currentItem.binLocation}</p>
              </div>
            )}

            <div className="flex justify-between border-b border-white/10 pb-2">
              <p className="text-sm text-slate-400">Unit</p>
              <p className="font-bold text-white">{item.unit}</p>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={startScan}
                className="min-h-[44px] rounded-sm border border-primary/30 bg-primary/10 px-3 text-sm font-bold text-primary"
              >
                Scan Barcode
              </button>
            )}
          </div>

          {/* Supplier & Pricing */}
          <div className="space-y-3 rounded-sm bg-card-dark p-3">
            <h2 className="mb-4 text-lg font-bold text-white">Supplier & Pricing</h2>

            {currentItem.vendor && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Vendor</p>
                <p className="text-white">{currentItem.vendor}</p>
              </div>
            )}

            {shouldShowInventoryDetailPrice(item, isAdmin) && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Unit Price</p>
                <p className="font-bold text-white">
                  ${item.price.toFixed(2)} / {item.unit}
                </p>
              </div>
            )}

            {reorderCostEstimate != null && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Reorder Cost Estimate</p>
                <p className="font-bold text-white">${reorderCostEstimate.toFixed(2)}</p>
              </div>
            )}

            <div className="flex justify-between">
              <p className="text-sm text-slate-400">Reorder Point</p>
              <p
                className={`font-bold ${currentItem.reorderPoint != null && currentItem.reorderPoint > 0 && available <= currentItem.reorderPoint ? 'text-orange-400' : 'text-white'}`}
              >
                {currentItem.reorderPoint != null ? currentItem.reorderPoint : 'Not set'}
              </p>
            </div>
          </div>

          {/* Linked Jobs */}
          <div className="rounded-sm bg-card-dark p-3">
            <h2 className="mb-3 text-lg font-bold text-white">Linked Jobs</h2>
            {linkedJobs.length === 0 ? (
              <p className="text-sm text-slate-400">No active job allocations for this part.</p>
            ) : (
              <div className="space-y-2">
                {linkedJobs.map(({ job, quantity, jobInventoryId }) => (
                  <button
                    type="button"
                    key={jobInventoryId}
                    onClick={() => onNavigate('job-detail', job.id)}
                    className="flex w-full items-center justify-between rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                  >
                    <div>
                      <p className="font-bold text-white">Job #{job.jobCode}</p>
                      <p className="text-xs text-slate-400">{job.name}</p>
                    </div>
                    <p className="text-sm font-bold text-yellow-300">
                      {quantity} {currentItem.unit}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Admin Files Section (Admin Only) */}
          {isAdmin && (
            <div className="rounded-sm bg-card-dark p-3">
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
          <div className="rounded-sm bg-card-dark p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <span className="material-symbols-outlined text-lg text-primary">attach_file</span>
                Attachments ({regularAttachments.length})
              </h3>
              {isAdmin && (
                <FileUploadButton
                  onUpload={(file) => handleFileUpload(file, false)}
                  label="Upload File"
                />
              )}
            </div>

            <AttachmentsList
              attachments={regularAttachments}
              onViewAttachment={handleViewAttachment}
              canUpload={isAdmin}
              showUploadButton={false}
            />
          </div>

          {/* History */}
          <div className="rounded-sm bg-card-dark p-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Stock History</h2>
              <button
                onClick={loadHistory}
                disabled={loadingHistory}
                className="text-sm font-bold text-primary"
              >
                {loadingHistory ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {history.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No history records yet</p>
            ) : (
              <div className="space-y-3">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-r border-l-4 border-primary/50 bg-white/5 py-2 pl-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-white">{getActionLabel(h.action)}</p>
                        <p className="text-sm text-slate-400">{h.reason}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {(
                            h as {
                              profiles?: { name?: string };
                              expand?: { user?: { name?: string } };
                            }
                          ).profiles?.name ||
                            (h as { expand?: { user?: { name?: string } } }).expand?.user?.name ||
                            'System'}{' '}
                          •{' '}
                          {formatHistoryDate(
                            (h as { created_at?: string; created?: string }).created_at ??
                              (h as { created?: string }).created
                          )}
                        </p>
                      </div>
                      <div className="ml-3 text-right">
                        <p
                          className={`text-lg font-bold ${h.changeAmount >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {h.changeAmount >= 0 ? '+' : ''}
                          {h.changeAmount}
                        </p>
                        <p className="text-xs text-slate-500">
                          {h.previousInStock} → {h.newInStock}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QR Scanner Modal */}
      {isScanning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
          <div className="w-full max-w-md rounded-sm bg-card-dark p-3">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
              <button onClick={stopScan} className="text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="relative">
              <video ref={videoRef} className="w-full rounded-sm" playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <p className="mt-4 text-center text-sm text-slate-400">Position barcode in view</p>
          </div>
        </div>
      )}

      {/* Bin Location Scanner */}
      {isScanningBin && (
        <QRScanner
          scanType="bin"
          onScanComplete={(binLocation) => {
            setEditBinLocation(binLocation);
            setIsScanningBin(false);
            showToast(`Bin location scanned: ${binLocation}`, 'success');
          }}
          onClose={() => setIsScanningBin(false)}
          currentValue={editBinLocation}
          title="Scan Bin Location"
          description="Scan QR code on bin location"
        />
      )}

      {/* File Viewer Modal */}
      {viewingAttachment && (
        <FileViewer
          attachment={viewingAttachment}
          onClose={handleCloseViewer}
          onDelete={handleDeleteAttachment}
          canDelete={isAdmin}
        />
      )}
    </>
  );
};

export default InventoryDetail;
