import React, { useState, useEffect, useCallback } from 'react';
import type { InventoryItem, ViewState, Attachment, Job } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';
import { useToast } from './Toast';
import QRScanner from './components/QRScanner';
import FileViewer from './FileViewer';
import AllocateToJobModal from '@/features/inventory/AllocateToJobModal';
import {
  useInventoryDetail,
  InventoryDetailOverview,
  InventoryDetailEdit,
  InventoryDetailHistory,
  InventoryDetailAttachments,
  BarcodeScannerModal,
  type InventoryDetailEditFormState,
} from '@/features/inventory/detail';
import { computeStock } from '@/features/inventory/inventoryViewModel';

type DetailSection = 'overview' | 'edit' | 'history' | 'attachments';

interface InventoryDetailProps {
  item: InventoryItem;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onUpdateItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onAddAttachment: (inventoryId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: string, inventoryId: string) => Promise<boolean>;
  onReloadItem?: () => Promise<void>;
  onMarkOrdered?: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onReceiveOrder?: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onAllocateToJob?: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    notes?: string
  ) => Promise<boolean>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  jobs?: Job[];
}

function buildEditForm(item: InventoryItem): InventoryDetailEditFormState {
  return {
    editName: item.name,
    editDescription: item.description || '',
    editCategory: item.category,
    editInStock: item.inStock,
    editPrice: item.price || 0,
    editUnit: item.unit,
    editBarcode: item.barcode || '',
    editBinLocation: item.binLocation || '',
    editVendor: item.vendor || '',
    editReorderPoint: item.reorderPoint || 0,
    editOnOrder: item.onOrder || 0,
    editReason: '',
  };
}

const InventoryDetail: React.FC<InventoryDetailProps> = ({
  item,
  onNavigate,
  onBack,
  onUpdateStock,
  onUpdateItem,
  onAddAttachment,
  onDeleteAttachment,
  onReloadItem,
  onMarkOrdered,
  onReceiveOrder,
  onAllocateToJob,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  jobs = [],
}) => {
  const { showToast } = useToast();
  const {
    currentItem,
    setCurrentItem,
    history,
    loadingHistory,
    loadHistory,
    loadItemWithAttachments,
  } = useInventoryDetail(item);

  const [activeSection, setActiveSection] = useState<DetailSection>('overview');
  const [editForm, setEditFormState] = useState<InventoryDetailEditFormState>(() =>
    buildEditForm(item)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [allocatingItem, setAllocatingItem] = useState<InventoryItem | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showBinScanner, setShowBinScanner] = useState(false);

  const [showAddToOrder, setShowAddToOrder] = useState(false);
  const [addToOrderQty, setAddToOrderQty] = useState(0);
  const [showReceiveOrder, setShowReceiveOrder] = useState(false);
  const [receiveOrderQty, setReceiveOrderQty] = useState(0);

  const allocated = calculateAllocated(currentItem.id);
  const available = calculateAvailable(currentItem);

  useEffect(() => {
    setEditFormState(buildEditForm(currentItem));
  }, [currentItem.id]);

  const setEditForm = useCallback((patch: Partial<InventoryDetailEditFormState>) => {
    setEditFormState((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleStartEdit = useCallback(() => {
    setEditFormState(buildEditForm(currentItem));
    setActiveSection('edit');
  }, [currentItem]);

  const handleCancelEdit = useCallback(() => {
    setActiveSection('overview');
    setEditFormState(buildEditForm(currentItem));
  }, [currentItem]);

  const handleSave = useCallback(async () => {
    if (!editForm.editName.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    if (!editForm.editUnit.trim()) {
      showToast('Unit is required', 'error');
      return;
    }
    const stockChanged = editForm.editInStock !== currentItem.inStock;
    if (stockChanged && !editForm.editReason.trim()) {
      showToast('Please provide a reason for stock change', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const payload: Partial<InventoryItem> = {
        name: editForm.editName.trim(),
        description: editForm.editDescription.trim() || undefined,
        category: editForm.editCategory,
        unit: editForm.editUnit.trim(),
        barcode: editForm.editBarcode.trim() || undefined,
        binLocation: editForm.editBinLocation.trim() || undefined,
        vendor: editForm.editVendor.trim() || undefined,
        reorderPoint: editForm.editReorderPoint > 0 ? editForm.editReorderPoint : undefined,
        onOrder: editForm.editOnOrder || 0,
      };
      if (isAdmin) payload.price = editForm.editPrice || undefined;
      const updated = await onUpdateItem(currentItem.id, payload);
      if (!updated) {
        showToast('Failed to update item', 'error');
        setIsSaving(false);
        return;
      }
      if (stockChanged) {
        await onUpdateStock(currentItem.id, editForm.editInStock, editForm.editReason.trim());
      }
      setCurrentItem(updated);
      setActiveSection('overview');
      setEditFormState(buildEditForm(updated));
      await loadHistory();
      await loadItemWithAttachments();
    } catch (error) {
      console.error('Save error:', error);
      showToast('Failed to save changes', 'error');
    }
    setIsSaving(false);
  }, [
    currentItem,
    editForm,
    isAdmin,
    onUpdateItem,
    onUpdateStock,
    showToast,
    setCurrentItem,
    loadHistory,
    loadItemWithAttachments,
  ]);

  const handleFileUpload = useCallback(
    async (file: File, isAdminOnly: boolean): Promise<boolean> => {
      try {
        const success = await onAddAttachment(currentItem.id, file, isAdminOnly);
        if (success) {
          await loadItemWithAttachments();
          await onReloadItem?.();
          showToast('File uploaded successfully', 'success');
        } else {
          showToast('Failed to upload file', 'error');
        }
        return success;
      } catch {
        showToast('Failed to upload file', 'error');
        return false;
      }
    },
    [currentItem.id, onAddAttachment, loadItemWithAttachments, onReloadItem, showToast]
  );

  const handleDeleteAttachmentFromList = useCallback(
    async (attachmentId: string): Promise<boolean> => {
      try {
        const success = await onDeleteAttachment(attachmentId, currentItem.id);
        if (success) {
          await loadItemWithAttachments();
          await onReloadItem?.();
        }
        return success;
      } catch {
        return false;
      }
    },
    [currentItem.id, onDeleteAttachment, loadItemWithAttachments, onReloadItem]
  );

  const handleConfirmAddToOrder = useCallback(async () => {
    if (addToOrderQty <= 0) {
      showToast('Enter a quantity greater than 0', 'warning');
      return;
    }
    if (!onMarkOrdered) return;
    const ok = await onMarkOrdered(currentItem.id, addToOrderQty);
    setShowAddToOrder(false);
    setAddToOrderQty(0);
    if (ok) {
      showToast('Added to order', 'success');
      await loadItemWithAttachments();
      await onReloadItem?.();
    } else {
      showToast('Failed to add to order', 'error');
    }
  }, [
    addToOrderQty,
    currentItem.id,
    onMarkOrdered,
    showToast,
    loadItemWithAttachments,
    onReloadItem,
  ]);

  const handleConfirmReceiveOrder = useCallback(async () => {
    if (receiveOrderQty <= 0) {
      showToast('Enter a quantity greater than 0', 'warning');
      return;
    }
    if (!onReceiveOrder) return;
    const ok = await onReceiveOrder(currentItem.id, receiveOrderQty);
    setShowReceiveOrder(false);
    setReceiveOrderQty(0);
    if (ok) {
      showToast(`Received ${receiveOrderQty} ${currentItem.unit}`, 'success');
      await loadItemWithAttachments();
      await onReloadItem?.();
    } else {
      showToast('Failed to receive order', 'error');
    }
  }, [
    receiveOrderQty,
    currentItem.id,
    currentItem.unit,
    onReceiveOrder,
    showToast,
    loadItemWithAttachments,
    onReloadItem,
  ]);

  const handleQuickAdjust = useCallback(
    async (delta: number) => {
      const next = Math.max(0, currentItem.inStock + delta);
      await onUpdateStock(
        currentItem.id,
        next,
        delta > 0 ? 'Quick add from detail' : 'Quick subtract from detail'
      );
      await loadItemWithAttachments();
    },
    [currentItem.id, currentItem.inStock, onUpdateStock, loadItemWithAttachments]
  );

  const adminAttachments = (currentItem.attachments || []).filter((a) => a.isAdminOnly);
  const regularAttachments = (currentItem.attachments || []).filter((a) => !a.isAdminOnly);

  if (activeSection === 'edit') {
    return (
      <>
        <InventoryDetailEdit
          currentItem={currentItem}
          form={editForm}
          setForm={setEditForm}
          allocated={allocated}
          isAdmin={isAdmin}
          isSaving={isSaving}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          onScanBarcode={() => setShowBarcodeScanner(true)}
          onScanBin={() => setShowBinScanner(true)}
        />
        <BarcodeScannerModal
          open={showBarcodeScanner}
          onClose={() => setShowBarcodeScanner(false)}
          onScanned={(barcode) => setEditForm({ editBarcode: barcode })}
          showToast={showToast}
        />
        {showBinScanner && (
          <QRScanner
            scanType="bin"
            onScanComplete={async (binLocation) => {
              setShowBinScanner(false);
              try {
                const updated = await onUpdateItem(currentItem.id, {
                  binLocation: binLocation.trim() || undefined,
                });
                if (updated) {
                  setCurrentItem(updated);
                  setEditForm({ editBinLocation: binLocation });
                  showToast('Bin location saved', 'success');
                } else {
                  showToast('Failed to save bin location', 'error');
                }
              } catch {
                showToast('Failed to save bin location', 'error');
              }
            }}
            onClose={() => setShowBinScanner(false)}
            currentValue={editForm.editBinLocation}
            title="Scan Bin Location"
            description="Scan QR code on bin location"
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col bg-background-dark">
        <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onBack?.()}
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
            <button
              type="button"
              onClick={handleStartEdit}
              className="rounded-sm bg-primary px-4 py-2 font-bold text-white"
            >
              Edit
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {(['overview', 'history', 'attachments'] as const).map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
                className={`min-h-[40px] rounded-sm px-3 text-sm font-bold capitalize ${
                  activeSection === section ? 'bg-primary text-white' : 'bg-white/5 text-slate-300'
                }`}
              >
                {section}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeSection === 'overview' && (
            <InventoryDetailOverview
              item={currentItem}
              allocated={allocated}
              available={available}
              isAdmin={isAdmin}
              jobs={jobs}
              onNavigate={onNavigate}
              onOpenAllocate={() => setAllocatingItem(currentItem)}
              onQuickAdjust={handleQuickAdjust}
              onMarkOrdered={onMarkOrdered}
              onReceiveOrder={onReceiveOrder}
              showAddToOrder={showAddToOrder}
              setShowAddToOrder={setShowAddToOrder}
              addToOrderQty={addToOrderQty}
              setAddToOrderQty={setAddToOrderQty}
              showReceiveOrder={showReceiveOrder}
              setShowReceiveOrder={setShowReceiveOrder}
              receiveOrderQty={receiveOrderQty}
              setReceiveOrderQty={setReceiveOrderQty}
              onConfirmAddToOrder={handleConfirmAddToOrder}
              onConfirmReceiveOrder={handleConfirmReceiveOrder}
              showToast={showToast}
              onScanBarcode={isAdmin ? () => setShowBarcodeScanner(true) : undefined}
            />
          )}
          {activeSection === 'history' && (
            <InventoryDetailHistory
              history={history}
              loadingHistory={loadingHistory}
              onRefresh={loadHistory}
            />
          )}
          {activeSection === 'attachments' && (
            <InventoryDetailAttachments
              adminAttachments={adminAttachments}
              regularAttachments={regularAttachments}
              isAdmin={isAdmin}
              onFileUpload={handleFileUpload}
              onViewAttachment={setViewingAttachment}
              onDeleteAttachment={handleDeleteAttachmentFromList}
            />
          )}
        </div>
      </div>

      {allocatingItem && onAllocateToJob && (
        <AllocateToJobModal
          item={allocatingItem}
          jobs={jobs}
          maxAvailable={
            computeStock(allocatingItem, calculateAvailable, calculateAllocated).available
          }
          onClose={() => setAllocatingItem(null)}
          onAllocate={(jobId, quantity, notes) =>
            onAllocateToJob(jobId, allocatingItem.id, quantity, notes)
          }
        />
      )}

      <BarcodeScannerModal
        open={showBarcodeScanner && activeSection === 'overview'}
        onClose={() => setShowBarcodeScanner(false)}
        onScanned={async (barcode) => {
          setShowBarcodeScanner(false);
          const updated = await onUpdateItem(currentItem.id, { barcode });
          if (updated) {
            setCurrentItem(updated);
            await loadItemWithAttachments();
            showToast('Barcode updated', 'success');
          }
        }}
        showToast={showToast}
      />

      {viewingAttachment && (
        <FileViewer
          attachment={viewingAttachment}
          onClose={() => setViewingAttachment(null)}
          onDelete={async () => {
            await onDeleteAttachment(viewingAttachment.id, currentItem.id);
            setViewingAttachment(null);
            await loadItemWithAttachments();
            await onReloadItem?.();
            showToast('File deleted successfully', 'success');
          }}
          canDelete={isAdmin}
        />
      )}
    </>
  );
};

export default InventoryDetail;
