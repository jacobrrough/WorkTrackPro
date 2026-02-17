import React, { useState, useEffect, useRef, useCallback } from 'react';
import { InventoryItem, ViewState, getCategoryDisplayName, InventoryCategory } from '@/core/types';
import { inventoryHistoryService } from './pocketbase';
import { useToast } from './Toast';
import jsQR from 'jsqr';

interface InventoryDetailProps {
  item: InventoryItem;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onUpdateItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
}

const InventoryDetail: React.FC<InventoryDetailProps> = ({
  item,
  onNavigate: _onNavigate,
  onBack,
  onUpdateStock,
  onUpdateItem,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
}) => {
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // QR Scanner state - ROBUST VERSION
  const [isScanning, setIsScanning] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  // Edit form state
  const [editName, setEditName] = useState(item.name);
  const [editDescription, setEditDescription] = useState(item.description || '');
  const [editCategory, setEditCategory] = useState(item.category);
  const [editInStock, setEditInStock] = useState(item.inStock);
  const [editPrice, setEditPrice] = useState(item.price || 0);
  const [editUnit, setEditUnit] = useState(item.unit);
  const [editBarcode, setEditBarcode] = useState(item.barcode || '');
  const [editBinLocation, setEditBinLocation] = useState(item.binLocation || '');
  const [editVendor, setEditVendor] = useState(item.vendor || '');
  const [editReorderPoint, setEditReorderPoint] = useState(item.reorderPoint || 0);
  const [editOnOrder, setEditOnOrder] = useState(item.onOrder || 0);
  const [editReason, setEditReason] = useState('');

  const allocated = item.allocated ?? calculateAllocated(item.id);
  const available = item.available ?? calculateAvailable(item);

  // Load history when viewing
  useEffect(() => {
    if (!isEditing) {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadHistory is stable
  }, [item.id, isEditing]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const historyData = await inventoryHistoryService.getHistory(item.id);
      setHistory(historyData);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
    setLoadingHistory(false);
  };

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
    setEditName(item.name);
    setEditDescription(item.description || '');
    setEditCategory(item.category);
    setEditInStock(item.inStock);
    setEditPrice(item.price || 0);
    setEditUnit(item.unit);
    setEditBarcode(item.barcode || '');
    setEditBinLocation(item.binLocation || '');
    setEditVendor(item.vendor || '');
    setEditReorderPoint(item.reorderPoint || 0);
    setEditOnOrder(item.onOrder || 0);
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
    const stockChanged = editInStock !== item.inStock;
    if (stockChanged && !editReason.trim()) {
      showToast('Please provide a reason for stock change', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await onUpdateItem(item.id, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        category: editCategory,
        price: editPrice || undefined,
        unit: editUnit.trim(),
        barcode: editBarcode.trim() || undefined,
        binLocation: editBinLocation.trim() || undefined,
        vendor: editVendor.trim() || undefined,
        reorderPoint: editReorderPoint || undefined,
        onOrder: editOnOrder || 0,
      });

      if (!updated) {
        showToast('Failed to update item', 'error');
        setIsSaving(false);
        return;
      }

      // If stock changed, update stock (this creates history)
      if (stockChanged) {
        await onUpdateStock(item.id, editInStock, editReason.trim());
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      manual_adjust: '📝 Manual Adjustment',
      reconcile_job: '📦 Job Reconciliation',
      reconcile_po: '📋 PO Reconciliation',
      order_received: '✅ Order Received',
      order_placed: '🛒 Order Placed',
      stock_correction: '🔧 Stock Correction',
    };
    return labels[action] || action;
  };

  if (isEditing) {
    return (
      <>
        <div className="flex h-full flex-col bg-background-dark">
          {/* Header */}
          <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-4">
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
                className="rounded-lg bg-primary px-6 py-2 font-bold text-white disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Basic Info */}
            <div className="space-y-4 rounded-xl bg-card-dark p-4">
              <h2 className="text-lg font-bold text-white">Basic Information</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Name *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Category *</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as InventoryCategory)}
                  className="w-full cursor-pointer rounded-lg border-2 border-primary/50 bg-background-light px-4 py-3 font-bold text-white hover:border-primary focus:border-primary focus:outline-none"
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
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
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
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>

            {/* Stock */}
            <div className="space-y-4 rounded-xl bg-card-dark p-4">
              <h2 className="text-lg font-bold text-white">Stock Levels</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">In Stock *</label>
                <input
                  type="number"
                  step="1"
                  value={editInStock}
                  onChange={(e) => setEditInStock(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
                {editInStock !== item.inStock && (
                  <p className="mt-1 text-xs text-yellow-400">
                    Current: {item.inStock} → New: {editInStock} (
                    {editInStock > item.inStock ? '+' : ''}
                    {editInStock - item.inStock})
                  </p>
                )}
              </div>

              {editInStock !== item.inStock && (
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-400">
                    Reason for Change *
                  </label>
                  <input
                    type="text"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="e.g., Physical count, received shipment, correction"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                  <p className="mb-1 text-xs text-slate-400">Allocated</p>
                  <p className="text-lg font-bold text-yellow-400">{allocated}</p>
                  <p className="text-xs text-slate-500">(auto-calculated)</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
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
                  value={editReorderPoint || ''}
                  onChange={(e) => setEditReorderPoint(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Alert when available falls below this level
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
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>

            {/* Location & Vendor */}
            <div className="space-y-4 rounded-xl bg-card-dark p-4">
              <h2 className="text-lg font-bold text-white">Location & Vendor</h2>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Barcode</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editBarcode}
                    onChange={(e) => setEditBarcode(e.target.value)}
                    placeholder="Scan or enter manually"
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                  <button
                    type="button"
                    onClick={startScan}
                    className="rounded-lg border border-primary bg-primary/20 px-4 py-3 text-primary transition-colors hover:bg-primary/30"
                  >
                    <span className="material-symbols-outlined">qr_code_scanner</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Bin Location</label>
                <input
                  type="text"
                  value={editBinLocation}
                  onChange={(e) => setEditBinLocation(e.target.value)}
                  placeholder="e.g., A3, B12"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-400">Vendor</label>
                <input
                  type="text"
                  value={editVendor}
                  onChange={(e) => setEditVendor(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>
        </div>

        {/* QR Scanner Modal */}
        {isScanning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
            <div className="w-full max-w-md rounded-xl bg-card-dark p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
                <button onClick={stopScan} className="text-white">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-lg" playsInline muted autoPlay />
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
        <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-4">
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
                <h1 className="text-xl font-bold text-white">{item.name}</h1>
                <p className="text-sm text-slate-400">{getCategoryDisplayName(item.category)}</p>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={handleStartEdit}
                className="rounded-lg bg-primary px-4 py-2 font-bold text-white"
              >
                Edit
              </button>
            )}
            {!isAdmin && <div className="text-sm text-slate-500">View Only</div>}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Description */}
          {item.description && (
            <div className="rounded-xl bg-card-dark p-4">
              <h2 className="mb-2 text-sm font-bold text-white">Description</h2>
              <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
            </div>
          )}

          {/* Stock Status */}
          <div className="rounded-xl bg-card-dark p-4">
            <h2 className="mb-4 text-lg font-bold text-white">Stock Status</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-sm text-slate-400">In Stock</p>
                <p className="text-2xl font-bold text-white">{item.inStock}</p>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-sm text-slate-400">Available</p>
                <p className="text-2xl font-bold text-green-400">{available}</p>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-sm text-slate-400">Allocated (needed for jobs)</p>
                <p className="text-2xl font-bold text-yellow-400">{allocated}</p>
                <p className="text-xs text-slate-500">PO&apos;d / in-production jobs only</p>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-sm text-slate-400">On Order</p>
                <p className="text-2xl font-bold text-blue-400">{item.onOrder || 0}</p>
              </div>
            </div>

            {(item.reorderPoint != null && available <= item.reorderPoint) ||
            (allocated > 0 && available < allocated) ? (
              <div className="mt-4 space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="font-bold text-red-400">Reorder recommended</p>
                <p className="text-sm text-red-300">
                  {allocated} {item.unit} needed to complete all jobs (committed to PO&apos;d /
                  in-production jobs).
                </p>
                {allocated > 0 && available < allocated && (
                  <p className="text-sm font-bold text-red-300">
                    Short by {allocated - available} {item.unit} — order at least this much to
                    fulfill current jobs.
                  </p>
                )}
                {item.reorderPoint != null && available <= item.reorderPoint && (
                  <p className="text-sm text-red-300">
                    Available ({available}) is at or below reorder point ({item.reorderPoint}).
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {/* Details */}
          <div className="space-y-3 rounded-xl bg-card-dark p-4">
            <h2 className="mb-4 text-lg font-bold text-white">Details</h2>

            {item.price && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Price Per Unit</p>
                <p className="font-bold text-white">
                  ${item.price.toFixed(2)} / {item.unit}
                </p>
              </div>
            )}

            <div className="flex justify-between border-b border-white/10 pb-2">
              <p className="text-sm text-slate-400">Unit</p>
              <p className="font-bold text-white">{item.unit}</p>
            </div>

            {item.barcode && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Barcode</p>
                <p className="font-mono text-sm text-white">{item.barcode}</p>
              </div>
            )}

            {item.binLocation && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Bin Location</p>
                <p className="font-bold text-white">{item.binLocation}</p>
              </div>
            )}

            {item.vendor && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <p className="text-sm text-slate-400">Vendor</p>
                <p className="text-white">{item.vendor}</p>
              </div>
            )}

            {item.reorderPoint && (
              <div className="flex justify-between">
                <p className="text-sm text-slate-400">Reorder Point</p>
                <p className="text-white">{item.reorderPoint}</p>
              </div>
            )}
          </div>

          {/* History */}
          <div className="rounded-xl bg-card-dark p-4">
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
                          {h.expand?.user?.name || 'System'} • {formatDate(h.created)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-md rounded-xl bg-card-dark p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
              <button onClick={stopScan} className="text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="relative">
              <video ref={videoRef} className="w-full rounded-lg" playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <p className="mt-4 text-center text-sm text-slate-400">Position barcode in view</p>
          </div>
        </div>
      )}
    </>
  );
};

export default InventoryDetail;
