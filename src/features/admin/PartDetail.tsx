import React, { useState, useEffect, useMemo } from 'react';
import {
  Part,
  PartVariant,
  PartMaterial,
  InventoryItem,
  Job,
  InventoryCategory,
  getCategoryDisplayName,
} from '@/core/types';
import { partsService } from '@/services/api/parts';
import { inventoryService } from '@/services/api/inventory';
import { useToast } from '@/Toast';
import {
  formatSetComposition,
  formatJobCode,
  formatDashSummary,
  getJobDisplayName,
} from '@/lib/formatJob';
import { formatDateOnly } from '@/core/date';
import { getStatusDisplayName } from '@/core/types';
import Accordion from '@/components/Accordion';
import MaterialCostDisplay from '@/components/MaterialCostDisplay';
import QuoteCalculator from '@/components/QuoteCalculator';
import FileUploadButton from '@/FileUploadButton';
import { calculateVariantQuote } from '@/lib/calculatePartQuote';
import { useSettings } from '@/contexts/SettingsContext';
import {
  calculateSetPriceFromVariants,
  variantPricesFromSetPrice,
  calculateSetLaborFromVariants,
  variantLaborFromSetComposition,
  distributeSetMaterialToVariants,
} from '@/lib/partDistribution';

interface PartDetailProps {
  partId: string;
  jobs?: Job[];
  onNavigate: (view: string, params?: Record<string, string>) => void;
  onNavigateBack: () => void;
}

const PartDetail: React.FC<PartDetailProps> = ({
  partId,
  jobs: allJobs = [],
  onNavigate,
  onNavigateBack,
}) => {
  const { settings } = useSettings();
  const [part, setPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVirtualPart, setIsVirtualPart] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [editingVariant, setEditingVariant] = useState<string | null>(null);
  const [showAddMaterial, setShowAddMaterial] = useState<{
    partId?: string;
    variantId?: string;
  } | null>(null);
  const [creatingPart, setCreatingPart] = useState(false);
  const [variantsAccordionExpanded, setVariantsAccordionExpanded] = useState(false);
  const { showToast } = useToast();

  const partJobs = useMemo(
    () =>
      part
        ? allJobs.filter((j) => {
            if (
              j.partNumber &&
              (j.partNumber === part.partNumber ||
                j.partNumber.replace(/-\d+$/, '') === part.partNumber)
            )
              return true;
            if (
              part.id?.toString().startsWith('job-') &&
              j.name?.trim().startsWith(part.partNumber)
            )
              return true;
            return false;
          })
        : [],
    [allJobs, part]
  );

  useEffect(() => {
    if (partId === 'new') {
      setLoading(false);
      setPart(null);
      loadInventory();
      return;
    }
    if (partId) {
      loadPart();
      loadInventory();
    } else {
      setLoading(false);
      setPart(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPart, loadInventory are stable
  }, [partId]);

  const loadPart = async (): Promise<Part | null> => {
    try {
      setLoading(true);
      setIsVirtualPart(false);
      const partNumberFromJob = partId.startsWith('job-') ? partId.slice(4) : null;
      if (partNumberFromJob) {
        const fromDb = await partsService.getPartByNumber(partNumberFromJob);
        if (fromDb) {
          const withVariants = await partsService.getPartWithVariants(fromDb.id);
          setPart(withVariants);
          return withVariants;
        }
        const matchingJobs = allJobs.filter(
          (j) =>
            (j.partNumber &&
              (j.partNumber === partNumberFromJob ||
                j.partNumber.replace(/-\d+$/, '') === partNumberFromJob)) ||
            (j.name && j.name.startsWith(partNumberFromJob))
        );
        const latestJob = matchingJobs.sort((a, b) => (b.jobCode ?? 0) - (a.jobCode ?? 0))[0];
        const virtualPart: Part = {
          id: partId,
          partNumber: partNumberFromJob,
          name: partNumberFromJob,
          description: latestJob?.description ?? undefined,
          pricePerSet: undefined,
          laborHours: latestJob?.laborHours,
          setComposition: undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setPart(virtualPart);
        setIsVirtualPart(true);
        return virtualPart;
      }
      let data = await partsService.getPartWithVariants(partId);
      if (
        !data &&
        partId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(partId)
      ) {
        data = await partsService.getPartWithVariants(
          (await partsService.getPartByNumber(partId))?.id ?? ''
        );
      }
      setPart(data ?? null);
      return data ?? null;
    } catch (error) {
      showToast('Failed to load part details', 'error');
      console.error('Error loading part:', error);
      setPart(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadInventory = async () => {
    try {
      const data = await inventoryService.getAllInventory();
      setInventoryItems(data);
    } catch (error) {
      console.error('Error loading inventory:', error);
    }
  };

  const handleAddVariant = async (
    variantSuffix: string,
    name?: string,
    price?: number,
    laborHours?: number,
    skipRefresh = false
  ) => {
    if (!part) return;
    try {
      await partsService.createVariant(part.id, {
        variantSuffix,
        name,
        pricePerVariant: price,
        laborHours,
      });
      if (!skipRefresh) {
        showToast('Variant added', 'success');
        loadPart();
      }
    } catch (error) {
      if (!skipRefresh) {
        showToast('Failed to add variant', 'error');
      }
      console.error('Error adding variant:', error);
      throw error; // Re-throw for bulk operations to handle errors
    }
  };

  const handleUpdateVariant = async (
    variantId: string,
    updates: { name?: string; pricePerVariant?: number; laborHours?: number }
  ) => {
    try {
      await partsService.updateVariant(variantId, updates);
      showToast('Variant updated successfully', 'success');
      setEditingVariant(null);
      const updated = await loadPart();
      if (updated && updates.pricePerVariant !== undefined && updated.variants?.length) {
        const composition =
          updated.setComposition && Object.keys(updated.setComposition).length > 0
            ? updated.setComposition
            : Object.fromEntries((updated.variants ?? []).map((v) => [v.variantSuffix, 1]));
        const newSetPrice = calculateSetPriceFromVariants(updated.variants, composition);
        if (newSetPrice != null) {
          await handleUpdatePart({ pricePerSet: newSetPrice });
        }
      }
    } catch (error) {
      showToast('Failed to update variant', 'error');
      console.error('Error updating variant:', error);
    }
  };

  const handleDeleteVariant = async (variantId: string, variantSuffix: string) => {
    if (!part) return;
    try {
      const ok = await partsService.deleteVariant(variantId);
      if (!ok) {
        showToast('Failed to delete variant', 'error');
        return;
      }
      setEditingVariant(null);
      const norm = (s: string) => s.replace(/^-/, '');
      const suffixNorm = norm(variantSuffix);
      if (part.setComposition && Object.keys(part.setComposition).length > 0) {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(part.setComposition)) {
          if (norm(k) !== suffixNorm) next[k] = v;
        }
        await handleUpdatePart({ setComposition: Object.keys(next).length > 0 ? next : null });
      }
      showToast('Variant deleted', 'success');
      loadPart();
    } catch (error) {
      showToast('Failed to delete variant', 'error');
      console.error('Error deleting variant:', error);
    }
  };

  const handleAddMaterial = async (
    inventoryId: string,
    quantity: number,
    unit: string,
    usageType: 'per_set' | 'per_variant'
  ) => {
    if (!part) return;
    const addedToVariantId = showAddMaterial?.variantId;
    try {
      const added = await partsService.addMaterial({
        partId: showAddMaterial?.partId || part.id,
        variantId: addedToVariantId,
        inventoryId,
        quantity,
        unit,
        usageType,
      });
      if (!added) {
        showToast(
          'Failed to add material. Check that part_materials has part_id column (run migrations).',
          'error'
        );
        return;
      }

      const variants = part.variants ?? [];
      const setComposition =
        part.setComposition && Object.keys(part.setComposition).length > 0
          ? part.setComposition
          : null;
      const totalUnitsInSet = setComposition
        ? Object.values(setComposition).reduce((a, b) => a + b, 0)
        : 0;

      let copyOrSetMessage = '';
      if (usageType === 'per_set' && variants.length > 0 && setComposition && totalUnitsInSet > 0) {
        const toDistribute = distributeSetMaterialToVariants(
          variants,
          setComposition,
          inventoryId,
          quantity,
          unit
        );
        for (const { variantId, inventoryId: invId, quantity: qty, unit: u } of toDistribute) {
          try {
            await partsService.addMaterial({
              variantId,
              inventoryId: invId,
              quantity: qty,
              unit: u,
              usageType: 'per_variant',
            });
          } catch {
            /* ignore */
          }
        }
        if (toDistribute.length > 0)
          copyOrSetMessage = ` and applied to ${toDistribute.length} variant(s)`;
      } else if (addedToVariantId && usageType === 'per_variant' && variants.length >= 2) {
        const otherVariants = variants.filter((v) => v.id !== addedToVariantId);
        const alreadyHave = (v: { materials?: { inventoryId: string }[] }) =>
          (v.materials ?? []).some((m) => m.inventoryId === inventoryId);
        let copied = 0;
        for (const v of otherVariants) {
          if (alreadyHave(v)) continue;
          try {
            const res = await partsService.addMaterial({
              variantId: v.id,
              inventoryId,
              quantity,
              unit,
              usageType: 'per_variant',
            });
            if (res) copied++;
          } catch {
            /* ignore */
          }
        }
        if (copied > 0) copyOrSetMessage = ` and copied to ${copied} variant(s)`;
        if (setComposition && totalUnitsInSet > 0) {
          try {
            await partsService.addMaterial({
              partId: part.id,
              inventoryId,
              quantity: quantity * totalUnitsInSet,
              unit,
              usageType: 'per_set',
            });
          } catch {
            /* ignore */
          }
        }
      }

      setShowAddMaterial(null);
      showToast(`Material added successfully${copyOrSetMessage}`, 'success');
      await loadPart();
    } catch (error) {
      showToast('Failed to add material', 'error');
      console.error('Error adding material:', error);
    }
  };

  const handleUpdatePart = async (updates: {
    partNumber?: string;
    name?: string;
    description?: string;
    pricePerSet?: number;
    laborHours?: number;
    setComposition?: Record<string, number> | null;
  }) => {
    if (!part) return;
    if (isVirtualPart) {
      setPart((prev) => (prev ? { ...prev, ...updates } : null));
      return;
    }
    try {
      let updated = await partsService.updatePart(part.id, updates);
      if (!updated && updates.setComposition !== undefined) {
        updated = await partsService.updatePart(part.id, {
          setComposition: updates.setComposition,
        });
        if (!updated) {
          setPart((prev) => (prev ? { ...prev, ...updates } : null));
          showToast(
            'Set composition could not be saved. Run migration to add set_composition to parts table.',
            'error'
          );
          return;
        }
      }
      if (updated) {
        setPart((prev) => (prev ? { ...prev, ...updated } : null));
        showToast('Part updated successfully', 'success');
      } else {
        setPart((prev) => (prev ? { ...prev, ...updates } : null));
        showToast('Part updated (save may be partial)', 'warning');
      }
    } catch (error) {
      showToast('Failed to update part', 'error');
      console.error('Error updating part:', error);
    }
  };

  const handleCreateInRepository = async () => {
    if (!part || !isVirtualPart) return;
    try {
      setCreatingPart(true);
      const created = await partsService.createPart({
        partNumber: part.partNumber,
        name: part.name || part.partNumber,
        description: part.description,
        laborHours: part.laborHours,
        pricePerSet: part.pricePerSet,
      });
      showToast('Part created in repository. You can now add variants and materials.', 'success');
      onNavigate('part-detail', { partId: created.id });
    } catch (error) {
      showToast('Failed to create part in repository', 'error');
      console.error('Error creating part:', error);
    } finally {
      setCreatingPart(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-slate-400">Loading part details...</div>
      </div>
    );
  }

  if (!part) {
    if (partId === 'new') {
      return (
        <CreatePartForm
          onCreated={(createdId) => onNavigate('part-detail', { partId: createdId })}
          onCancel={onNavigateBack}
          showToast={showToast}
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-2 text-white">Part not found</p>
          <button onClick={onNavigateBack} className="text-primary hover:underline">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      {/* Header: Part Number first, then Part Name */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
              aria-label="Go back"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div className="min-w-0">
              <h1 className="font-mono text-xl font-bold text-white">{part.partNumber}</h1>
              <p className="text-sm text-slate-400">{part.name || part.partNumber}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Virtual part: Create in repository banner */}
      {isVirtualPart && (
        <div className="mx-4 mt-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-4 sm:mx-6 lg:mx-8">
          <p className="mb-3 text-sm text-amber-200">
            This part is aggregated from jobs. Create it in the repository to edit variants, set
            composition, and manage materials.
          </p>
          <button
            onClick={handleCreateInRepository}
            disabled={creatingPart}
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
            {creatingPart ? 'Creating...' : 'Create in repository'}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Section 1: Part Information (always expanded) */}
        <div className="rounded-sm border border-white/10 bg-white/5 p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Part Information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Part Number</label>
              <input
                type="text"
                value={part.partNumber}
                onChange={(e) => handleUpdatePart({ partNumber: e.target.value })}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== part.partNumber) handleUpdatePart({ partNumber: v });
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 font-mono text-white focus:border-primary/50 focus:outline-none"
                placeholder="e.g. SK-F35-0911"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Part Name (required)</label>
              <input
                type="text"
                value={part.name || ''}
                onChange={(e) => handleUpdatePart({ name: e.target.value || part.partNumber })}
                onBlur={(e) => {
                  const v = e.target.value.trim() || part.partNumber;
                  if (v !== (part.name || '')) handleUpdatePart({ name: v });
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                placeholder={part.partNumber}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm text-slate-400">Description</label>
              <textarea
                value={part.description || ''}
                onChange={(e) => handleUpdatePart({ description: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value !== (part.description || '')) {
                    handleUpdatePart({ description: e.target.value || undefined });
                  }
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                rows={3}
              />
            </div>
            {!isVirtualPart && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm text-slate-400">Part Drawing</label>
                <p className="mb-2 text-xs text-slate-500">
                  One file per part. This is the only file shop-floor users can access on job cards.
                </p>
                {part.drawingAttachment ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={part.drawingAttachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white hover:bg-white/10"
                    >
                      <span className="material-symbols-outlined text-primary">picture_as_pdf</span>
                      {part.drawingAttachment.filename}
                    </a>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await partsService.deletePartDrawing(part.drawingAttachment!.id);
                        if (ok) {
                          await loadPart();
                          showToast('Drawing removed');
                        } else {
                          showToast('Failed to remove drawing', 'error');
                        }
                      }}
                      className="min-h-[44px] rounded-sm border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                    <FileUploadButton
                      label="Replace"
                      onUpload={async (file) => {
                        const result = await partsService.addPartDrawing(part.id, file);
                        if (result.success) {
                          await loadPart();
                          showToast('Drawing updated');
                          return true;
                        }
                        throw new Error(result.error || 'Upload failed');
                      }}
                    />
                  </div>
                ) : (
                  <FileUploadButton
                    label="Upload Drawing"
                    onUpload={async (file) => {
                      const result = await partsService.addPartDrawing(part.id, file);
                      if (result.success) {
                        await loadPart();
                        showToast('Drawing uploaded');
                        return true;
                      }
                      throw new Error(result.error || 'Upload failed');
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Set Information (accordion) - labor, price, materials, set composition, quote */}
        {!isVirtualPart && (
          <Accordion title="Set Information" defaultExpanded>
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm text-slate-400">Set Labor Hours</label>
                  {part.variants &&
                    part.variants.length > 0 &&
                    part.setComposition &&
                    Object.keys(part.setComposition).length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const auto = calculateSetLaborFromVariants(
                            part.variants ?? [],
                            part.setComposition ?? {}
                          );
                          if (auto != null) handleUpdatePart({ laborHours: auto });
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Use Auto
                      </button>
                    )}
                </div>
                <input
                  type="number"
                  step="0.1"
                  value={part.laborHours ?? ''}
                  onChange={(e) =>
                    handleUpdatePart({
                      laborHours: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  onBlur={(e) => {
                    const value = e.target.value ? Number(e.target.value) : undefined;
                    if (value !== part.laborHours) handleUpdatePart({ laborHours: value });
                  }}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="0.0"
                />
              </div>

              <div className="space-y-3">
                {/* CNC Toggle */}
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!part.requiresCNC}
                      onChange={(e) =>
                        handleUpdatePart({
                          requiresCNC: e.target.checked,
                          ...(e.target.checked && part.cncTimeHours == null
                            ? { cncTimeHours: 0 }
                            : {}),
                        })
                      }
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-white">CNC (machine time in quote)</span>
                  </label>
                  {part.requiresCNC && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-400">CNC time (hours per set)</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        value={part.cncTimeHours ?? ''}
                        onChange={(e) =>
                          handleUpdatePart({
                            cncTimeHours: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        onBlur={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          if (value !== part.cncTimeHours)
                            handleUpdatePart({ cncTimeHours: value ?? 0 });
                        }}
                        className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                {/* 3D Printer Toggle */}
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!part.requires3DPrint}
                      onChange={(e) =>
                        handleUpdatePart({
                          requires3DPrint: e.target.checked,
                          ...(e.target.checked && part.printer3DTimeHours == null
                            ? { printer3DTimeHours: 0 }
                            : {}),
                        })
                      }
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-white">3D Print (machine time in quote)</span>
                  </label>
                  {part.requires3DPrint && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-400">
                        3D print time (hours per set)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        value={part.printer3DTimeHours ?? ''}
                        onChange={(e) =>
                          handleUpdatePart({
                            printer3DTimeHours: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        onBlur={(e) => {
                          const value = e.target.value ? Number(e.target.value) : undefined;
                          if (value !== part.printer3DTimeHours)
                            handleUpdatePart({ printer3DTimeHours: value ?? 0 });
                        }}
                        className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Materials (per set)</span>
                  <button
                    type="button"
                    onClick={() => setShowAddMaterial({ partId: part.id })}
                    className="text-xs text-primary hover:underline"
                  >
                    Add Material
                  </button>
                </div>
                {showAddMaterial?.partId && (
                  <AddMaterialForm
                    inventoryItems={inventoryItems}
                    usageType="per_set"
                    onSave={handleAddMaterial}
                    onCancel={() => setShowAddMaterial(null)}
                  />
                )}
                {part.materials && part.materials.length > 0 ? (
                  <MaterialsListWithCost
                    materials={part.materials}
                    inventoryItems={inventoryItems}
                    onUpdate={loadPart}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No materials defined for this part.</p>
                )}
              </div>

              {part.variants && part.variants.length > 0 && (
                <>
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase text-slate-400">
                      Set composition
                    </p>
                    <SetCompositionEditor
                      part={part}
                      variants={part.variants}
                      setComposition={
                        part.setComposition &&
                        typeof part.setComposition === 'object' &&
                        !Array.isArray(part.setComposition)
                          ? part.setComposition
                          : {}
                      }
                      onUpdate={(composition) => handleUpdatePart({ setComposition: composition })}
                    />
                    {part.setComposition &&
                      typeof part.setComposition === 'object' &&
                      Object.keys(part.setComposition).length > 0 && (
                        <p className="mt-2 text-sm text-white">
                          One set: {formatSetComposition(part.setComposition)}
                        </p>
                      )}
                  </div>
                  <QuoteCalculator
                    part={part}
                    inventoryItems={inventoryItems}
                    variants={part.variants}
                    setComposition={part.setComposition}
                    laborRate={settings.laborRate}
                    cncRate={settings.cncRate}
                    printer3DRate={settings.printer3DRate}
                    onSetPriceChange={async (price) => {
                      if (price !== undefined) {
                        if (price !== part.pricePerSet) {
                          await handleUpdatePart({ pricePerSet: price });
                          if (
                            part.variants?.length &&
                            part.setComposition &&
                            Object.keys(part.setComposition).length > 0
                          ) {
                            const toApply = variantPricesFromSetPrice(
                              price,
                              part.setComposition,
                              part.variants
                            );
                            for (const { variantId, price: p } of toApply) {
                              await partsService.updateVariant(variantId, { pricePerVariant: p });
                            }
                            if (toApply.length > 0) await loadPart();
                          }
                        }
                      } else {
                        const auto = calculateSetPriceFromVariants(
                          part.variants ?? [],
                          part.setComposition ?? {}
                        );
                        if (auto != null) handleUpdatePart({ pricePerSet: auto });
                      }
                    }}
                  />
                </>
              )}
            </div>
          </Accordion>
        )}

        {/* Section 3: Variants / Dash Numbers (accordion) */}
        {!isVirtualPart && (
          <Accordion
            title={`Variants / Dash Numbers (${part.variants?.length ?? 0})`}
            defaultExpanded={false}
            expanded={variantsAccordionExpanded}
            onToggle={() => setVariantsAccordionExpanded((e) => !e)}
          >
            {(part.variants?.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400">No variants — part number is the only SKU.</p>
            ) : (
              <p className="mb-3 text-xs text-slate-400">
                {part.variants?.length} dash number{(part.variants?.length ?? 0) !== 1 ? 's' : ''}:{' '}
                {part.variants?.map((v) => `-${v.variantSuffix}`).join(', ')}
              </p>
            )}
            <AddVariantInline
              existingSuffixes={part.variants?.map((v) => v.variantSuffix) || []}
              onAdd={handleAddVariant}
              onRefresh={loadPart}
              showToast={showToast}
            />
            {showAddMaterial?.variantId &&
              part.variants &&
              (() => {
                const addToVariant = part.variants.find((v) => v.id === showAddMaterial!.variantId);
                if (!addToVariant) return null;
                return (
                  <div
                    key={`add-mat-${addToVariant.id}`}
                    className="mt-4 rounded-sm border border-primary/30 bg-primary/10 p-4"
                  >
                    <p className="mb-3 text-sm text-slate-300">
                      Adding material to{' '}
                      <span className="font-mono text-primary">
                        {part.partNumber}-{addToVariant.variantSuffix}
                      </span>
                    </p>
                    <AddMaterialForm
                      inventoryItems={inventoryItems}
                      usageType="per_variant"
                      onSave={handleAddMaterial}
                      onCancel={() => setShowAddMaterial(null)}
                    />
                  </div>
                );
              })()}
            {part.variants && part.variants.length > 0 && (
              <div className="mt-4 space-y-4">
                {part.variants.map((variant) => (
                  <VariantCard
                    key={variant.id}
                    variant={variant}
                    partNumber={part.partNumber}
                    inventoryItems={inventoryItems}
                    isEditing={editingVariant === variant.id}
                    onEdit={() => setEditingVariant(variant.id)}
                    onCancel={() => setEditingVariant(null)}
                    onUpdate={handleUpdateVariant}
                    onDelete={handleDeleteVariant}
                    onAddMaterial={() => setShowAddMaterial({ variantId: variant.id })}
                    onMaterialAdded={loadPart}
                    partPricePerSet={part.pricePerSet}
                    partLaborHours={part.laborHours}
                    setComposition={part.setComposition}
                  />
                ))}
              </div>
            )}
          </Accordion>
        )}

        {/* Section 4: Past Jobs (accordion) */}
        <Accordion title={`Past Jobs (${partJobs.length})`} defaultExpanded={false}>
          {partJobs.length === 0 ? (
            <p className="text-sm text-slate-400">No jobs match this part number.</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {[...partJobs]
                .sort((a, b) => {
                  const da = a.dueDate || a.ecd || '';
                  const db = b.dueDate || b.ecd || '';
                  return db.localeCompare(da);
                })
                .map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onNavigate('job-detail', { jobId: job.id })}
                    className="flex w-full items-center justify-between rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-white/10"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm font-semibold text-primary">
                        {job.partNumber ?? '—'}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        {formatJobCode(job.jobCode)} · {getJobDisplayName(job)}
                      </span>
                      {job.dashQuantities && Object.keys(job.dashQuantities).length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDashSummary(job.dashQuantities)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          job.status === 'paid'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-slate-500/20 text-slate-400'
                        }`}
                      >
                        {getStatusDisplayName(job.status)}
                      </span>
                      {job.dueDate && (
                        <span className="text-xs text-slate-500">
                          {formatDateOnly(job.dueDate)}
                        </span>
                      )}
                      <span className="material-symbols-outlined text-slate-400">
                        chevron_right
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </Accordion>
      </div>
    </div>
  );
};

interface VariantCardProps {
  variant: PartVariant;
  partNumber: string;
  inventoryItems: InventoryItem[];
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (id: string, updates: Partial<PartVariant>) => void;
  onDelete: (variantId: string, variantSuffix: string) => void;
  onAddMaterial: () => void;
  onMaterialAdded: () => void;
  partPricePerSet?: number;
  partLaborHours?: number;
  setComposition?: Record<string, number> | null;
}

const VariantCard: React.FC<VariantCardProps> = ({
  variant,
  partNumber,
  inventoryItems,
  isEditing,
  onEdit,
  onCancel,
  onUpdate,
  onDelete,
  onAddMaterial,
  onMaterialAdded,
  partPricePerSet,
  partLaborHours,
  setComposition,
}) => {
  const { showToast } = useToast();
  const [name, setName] = useState(variant.name || '');
  const [price, setPrice] = useState(variant.pricePerVariant?.toString() || '');
  const [laborHours, setLaborHours] = useState(variant.laborHours?.toString() || '');
  const [editingMaterialQty, setEditingMaterialQty] = useState<string | null>(null);
  const [materialQtyValues, setMaterialQtyValues] = useState<Record<string, string>>({});

  const autoLaborHours =
    partLaborHours != null && setComposition && Object.keys(setComposition).length > 0
      ? variantLaborFromSetComposition(variant.variantSuffix, partLaborHours, setComposition)
      : undefined;

  const handleSave = () => {
    onUpdate(variant.id, {
      name: name || undefined,
      pricePerVariant: price ? Number(price) : undefined,
      laborHours: laborHours ? Number(laborHours) : undefined,
    });
  };

  const revertLaborToAuto = () => {
    if (autoLaborHours != null) {
      setLaborHours(autoLaborHours.toString());
      onUpdate(variant.id, { laborHours: autoLaborHours });
    }
  };

  return (
    <div className="rounded-sm border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="font-mono font-semibold text-primary">
            {partNumber}-{variant.variantSuffix}
          </span>
          {isEditing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Variant name (optional)"
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
            />
          ) : (
            variant.name && <p className="mt-1 text-sm text-white">{variant.name}</p>
          )}
        </div>
        {isEditing ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSave}
              className="rounded bg-primary px-3 py-1 text-sm text-white"
            >
              Save
            </button>
            <button onClick={onCancel} className="rounded bg-white/10 px-3 py-1 text-sm text-white">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDelete(variant.id, variant.variantSuffix)}
              className="rounded border border-red-500/50 bg-red-500/20 px-3 py-1 text-sm text-red-400 transition-colors hover:bg-red-500/30"
              aria-label={`Delete variant -${variant.variantSuffix}`}
            >
              Delete
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="text-sm text-primary hover:underline">
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(variant.id, variant.variantSuffix)}
              className="min-h-[44px] rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
              aria-label={`Delete variant -${variant.variantSuffix}`}
            >
              <span className="material-symbols-outlined text-lg">delete</span>
            </button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Price</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
              placeholder="0.00"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-slate-400">Labor Hours</label>
              {autoLaborHours != null && (
                <button
                  type="button"
                  onClick={revertLaborToAuto}
                  className="text-xs text-primary hover:underline"
                >
                  Use Auto
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.1"
              value={laborHours}
              onChange={(e) => setLaborHours(e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
              placeholder={autoLaborHours != null ? autoLaborHours.toString() : '0.0'}
            />
          </div>
        </div>
      )}

      {!isEditing && (
        <div className="mb-3 flex gap-4 text-xs text-slate-400">
          {variant.pricePerVariant !== undefined && (
            <span>${variant.pricePerVariant.toFixed(2)}/variant</span>
          )}
          {variant.laborHours !== undefined && <span>{variant.laborHours}h</span>}
        </div>
      )}

      <div className="border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-white">Materials (Per Variant)</span>
          <button
            type="button"
            onClick={onAddMaterial}
            className="text-xs text-primary hover:underline"
          >
            Add Material
          </button>
        </div>
        {variant.materials && variant.materials.length > 0 ? (
          <div className="space-y-2">
            {variant.materials.map((material) => {
              const inv = inventoryItems.find((i) => i.id === material.inventoryId);
              const qty =
                material.quantityPerUnit ?? (material as { quantity?: number }).quantity ?? 1;
              const isEditingQty = editingMaterialQty === material.id;
              const displayQty = isEditingQty
                ? (materialQtyValues[material.id] ?? qty.toString())
                : qty;
              const ourCost =
                (inv?.price ?? 0) *
                (isEditingQty ? parseFloat(materialQtyValues[material.id] || '0') || qty : qty);
              return (
                <div
                  key={material.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="flex-1">
                    <span className="text-sm text-white">
                      {material.inventoryName || inv?.name || 'Unknown'}
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      {isEditingQty ? (
                        <>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={materialQtyValues[material.id] ?? qty}
                            onChange={(e) =>
                              setMaterialQtyValues((prev) => ({
                                ...prev,
                                [material.id]: e.target.value,
                              }))
                            }
                            onBlur={async () => {
                              const value = materialQtyValues[material.id];
                              if (!value) {
                                setEditingMaterialQty(null);
                                return;
                              }
                              const numValue = parseFloat(value);
                              if (isNaN(numValue) || numValue < 0) {
                                showToast('Invalid quantity', 'error');
                                return;
                              }
                              try {
                                const updated = await partsService.updatePartMaterial(material.id, {
                                  quantityPerUnit: numValue,
                                });
                                if (updated) {
                                  showToast('Quantity updated', 'success');
                                  setEditingMaterialQty(null);
                                  onMaterialAdded();
                                } else {
                                  showToast('Failed to update quantity', 'error');
                                }
                              } catch {
                                showToast('Failed to update quantity', 'error');
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              } else if (e.key === 'Escape') {
                                setEditingMaterialQty(null);
                                setMaterialQtyValues((prev) => {
                                  const next = { ...prev };
                                  delete next[material.id];
                                  return next;
                                });
                              }
                            }}
                            autoFocus
                            className="w-20 rounded border border-primary/50 bg-white/5 px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                          />
                          <span className="text-xs text-slate-400">{material.unit}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-slate-400">
                            {displayQty} {material.unit}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMaterialQty(material.id);
                              setMaterialQtyValues((prev) => ({
                                ...prev,
                                [material.id]: qty.toString(),
                              }));
                            }}
                            className="ml-2 text-xs text-primary hover:underline"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                    <div className="mt-1">
                      <MaterialCostDisplay ourCost={ourCost} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await partsService.deleteMaterial(material.id);
                        showToast('Material removed', 'success');
                        onMaterialAdded();
                      } catch {
                        showToast('Failed to delete material', 'error');
                      }
                    }}
                    className="text-red-400 hover:text-red-300"
                    aria-label="Remove material"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No materials defined</p>
        )}
      </div>

      {/* Per-variant quote */}
      <div className="mt-3 border-t border-white/10 pt-3">
        <VariantQuoteMini
          partNumber={partNumber}
          variant={variant}
          inventoryItems={inventoryItems}
          partPricePerSet={partPricePerSet}
          setComposition={setComposition}
          onVariantPriceChange={(variantId, price) => {
            if (variantId === variant.id) {
              onUpdate(variantId, { pricePerVariant: price });
            }
          }}
        />
      </div>
    </div>
  );
};

function VariantQuoteMini({
  partNumber,
  variant,
  inventoryItems,
  partPricePerSet,
  setComposition,
  onVariantPriceChange,
}: {
  partNumber: string;
  variant: PartVariant & { materials?: PartMaterial[] };
  inventoryItems: InventoryItem[];
  partPricePerSet?: number;
  setComposition?: Record<string, number> | null;
  onVariantPriceChange?: (variantId: string, price: number | undefined) => void;
}) {
  const { settings } = useSettings();
  const [qty, setQty] = useState(1);
  const [manualVariantPrice, setManualVariantPrice] = useState<string>('');
  const [isManualPrice, setIsManualPrice] = useState(false);
  const [hasUserEdited, setHasUserEdited] = useState(false);

  // Calculate variant's share of set price based on set composition
  const calculatedVariantPrice = useMemo(() => {
    if (!partPricePerSet || !setComposition || Object.keys(setComposition).length === 0) {
      return undefined;
    }
    // Normalize variant suffix (handle both "-01" and "01" formats)
    const norm = (s: string) => s.replace(/^-/, '');
    const variantSuffixNorm = norm(variant.variantSuffix);

    // Find this variant's quantity in the set composition
    const variantQtyInSet = Object.entries(setComposition).find(
      ([suffix]) => norm(suffix) === variantSuffixNorm
    )?.[1];

    if (!variantQtyInSet || variantQtyInSet <= 0) {
      return undefined;
    }

    // Calculate total units in set
    const totalUnitsInSet = Object.values(setComposition).reduce((sum, q) => sum + q, 0);
    if (totalUnitsInSet <= 0) {
      return undefined;
    }

    // Per-unit price = set price / total units
    const pricePerUnit = partPricePerSet / totalUnitsInSet;
    // Variant's share = price per unit × variant quantity in set
    return pricePerUnit * variantQtyInSet;
  }, [partPricePerSet, setComposition, variant.variantSuffix]);

  const revertToAuto = () => {
    setHasUserEdited(false);
    setIsManualPrice(false);
    if (calculatedVariantPrice != null) {
      setManualVariantPrice(calculatedVariantPrice.toFixed(2));
      onVariantPriceChange?.(variant.id, calculatedVariantPrice);
    } else {
      setManualVariantPrice('');
      onVariantPriceChange?.(variant.id, undefined);
    }
  };

  // Initialize manualVariantPrice from calculated price or variant's own pricePerVariant
  useEffect(() => {
    if (!hasUserEdited) {
      if (calculatedVariantPrice != null) {
        setManualVariantPrice(calculatedVariantPrice.toFixed(2));
        setIsManualPrice(true);
        // Auto-save calculated price to variant (only if different from current)
        if (
          onVariantPriceChange &&
          Math.abs(calculatedVariantPrice - (variant.pricePerVariant ?? 0)) > 0.01
        ) {
          onVariantPriceChange(variant.id, calculatedVariantPrice);
        }
      } else if (variant.pricePerVariant != null) {
        setManualVariantPrice(variant.pricePerVariant.toString());
        setIsManualPrice(true);
      } else {
        setManualVariantPrice('');
        setIsManualPrice(false);
      }
    }
  }, [
    calculatedVariantPrice,
    variant.pricePerVariant,
    variant.id,
    hasUserEdited,
    onVariantPriceChange,
  ]);

  // Notify parent when variant price changes manually (debounced to avoid excessive saves)
  useEffect(() => {
    if (hasUserEdited && onVariantPriceChange) {
      const timeoutId = setTimeout(() => {
        if (isManualPrice && manualVariantPrice) {
          const price = parseFloat(manualVariantPrice);
          if (!Number.isNaN(price) && Math.abs(price - (variant.pricePerVariant ?? 0)) > 0.01) {
            onVariantPriceChange(variant.id, price);
          }
        } else if (!isManualPrice && variant.pricePerVariant != null) {
          onVariantPriceChange(variant.id, undefined);
        }
      }, 500); // Debounce manual edits

      return () => clearTimeout(timeoutId);
    }
  }, [
    manualVariantPrice,
    isManualPrice,
    hasUserEdited,
    variant.id,
    variant.pricePerVariant,
    onVariantPriceChange,
  ]);

  const result = useMemo(() => {
    const variantPrice =
      isManualPrice && manualVariantPrice ? parseFloat(manualVariantPrice) : undefined;
    return calculateVariantQuote(partNumber, variant, qty, inventoryItems, {
      laborRate: settings.laborRate,
      manualVariantPrice: variantPrice,
    });
  }, [
    partNumber,
    variant,
    qty,
    inventoryItems,
    settings.laborRate,
    manualVariantPrice,
    isManualPrice,
  ]);

  const AutoBadge = () => (
    <span className="ml-1 rounded bg-primary/20 px-1 py-0.5 text-xs text-primary">auto</span>
  );

  return (
    <div className="rounded border border-primary/20 bg-primary/5 p-3">
      <p className="mb-2 text-xs font-bold uppercase text-slate-400">Quote (variant)</p>
      <div className="mb-2 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Qty</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-20 rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Price per unit</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min={0}
              value={manualVariantPrice}
              onChange={(e) => {
                setManualVariantPrice(e.target.value);
                setHasUserEdited(true);
                setIsManualPrice(e.target.value.trim() !== '');
              }}
              onBlur={() => {
                if (manualVariantPrice.trim() === '') {
                  setIsManualPrice(false);
                }
              }}
              className="w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:border-primary/50 focus:outline-none"
              placeholder={
                calculatedVariantPrice != null ? calculatedVariantPrice.toFixed(2) : 'Auto'
              }
            />
            {calculatedVariantPrice != null && !hasUserEdited && <AutoBadge />}
            {hasUserEdited && calculatedVariantPrice != null && (
              <button
                type="button"
                onClick={revertToAuto}
                className="rounded bg-primary/20 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
              >
                Use Auto
              </button>
            )}
          </div>
        </div>
      </div>
      {result ? (
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between text-slate-300">
            <span>Material</span>
            <span className="text-white">${result.materialCostCustomer.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Labor</span>
            <span className="text-white">${result.laborCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1 text-slate-300">
            <span className="flex items-center">
              Subtotal
              {result.isReverseCalculated && <AutoBadge />}
            </span>
            <span className="text-white">${result.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-primary/30 pt-1 font-medium text-white">
            <span className="flex items-center">
              Total
              {result.isReverseCalculated && <AutoBadge />}
            </span>
            <span>${result.total.toFixed(2)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface MaterialsListProps {
  materials: PartMaterial[];
  onUpdate: () => void;
}

// Unused alternate list component; kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MaterialsList: React.FC<MaterialsListProps> = ({ materials, onUpdate }) => {
  const { showToast } = useToast();
  const handleDelete = async (id: string) => {
    try {
      await partsService.deleteMaterial(id);
      showToast('Material removed', 'success');
      onUpdate();
    } catch {
      showToast('Failed to delete material', 'error');
    }
  };
  const qty = (m: PartMaterial) => m.quantityPerUnit ?? (m as { quantity?: number }).quantity ?? 1;
  return (
    <div className="space-y-2">
      {materials.map((material) => (
        <div
          key={material.id}
          className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-3 py-2"
        >
          <div>
            <span className="text-sm font-medium text-white">
              {material.inventoryName || 'Unknown'}
            </span>
            <span className="ml-2 text-xs text-slate-400">
              {qty(material)} {material.unit}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleDelete(material.id)}
            className="text-red-400 hover:text-red-300"
            aria-label="Remove material"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      ))}
    </div>
  );
};

interface MaterialsListWithCostProps {
  materials: PartMaterial[];
  inventoryItems: InventoryItem[];
  onUpdate: () => void;
}

const MaterialsListWithCost: React.FC<MaterialsListWithCostProps> = ({
  materials,
  inventoryItems,
  onUpdate,
}) => {
  const { showToast } = useToast();
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [qtyValues, setQtyValues] = useState<Record<string, string>>({});

  const qty = (m: PartMaterial) => m.quantityPerUnit ?? (m as { quantity?: number }).quantity ?? 1;

  const handleQtyChange = (materialId: string, value: string) => {
    setQtyValues((prev) => ({ ...prev, [materialId]: value }));
  };

  const handleQtySave = async (materialId: string, _material: PartMaterial) => {
    const value = qtyValues[materialId];
    if (!value) {
      setEditingQty(null);
      return;
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      showToast('Invalid quantity', 'error');
      return;
    }
    try {
      const updated = await partsService.updatePartMaterial(materialId, {
        quantityPerUnit: numValue,
      });
      if (updated) {
        showToast('Quantity updated', 'success');
        setEditingQty(null);
        onUpdate();
      } else {
        showToast('Failed to update quantity', 'error');
      }
    } catch {
      showToast('Failed to update quantity', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await partsService.deleteMaterial(id);
      showToast('Material removed', 'success');
      onUpdate();
    } catch {
      showToast('Failed to delete material', 'error');
    }
  };

  return (
    <div className="space-y-2">
      {materials.map((material) => {
        const inv = inventoryItems.find((i) => i.id === material.inventoryId);
        const currentQty = qty(material);
        const isEditing = editingQty === material.id;
        const displayQty = isEditing
          ? (qtyValues[material.id] ?? currentQty.toString())
          : currentQty;
        const ourCost =
          (inv?.price ?? 0) *
          (isEditing ? parseFloat(qtyValues[material.id] || '0') || currentQty : currentQty);
        return (
          <div
            key={material.id}
            className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="flex-1">
              <span className="text-sm font-medium text-white">
                {material.inventoryName || inv?.name || 'Unknown'}
              </span>
              <div className="mt-1 flex items-center gap-2">
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={qtyValues[material.id] ?? currentQty}
                      onChange={(e) => handleQtyChange(material.id, e.target.value)}
                      onBlur={() => handleQtySave(material.id, material)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleQtySave(material.id, material);
                        } else if (e.key === 'Escape') {
                          setEditingQty(null);
                          setQtyValues((prev) => {
                            const next = { ...prev };
                            delete next[material.id];
                            return next;
                          });
                        }
                      }}
                      autoFocus
                      className="w-20 rounded border border-primary/50 bg-white/5 px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                    />
                    <span className="text-xs text-slate-400">{material.unit}</span>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">
                      {displayQty} {material.unit}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQty(material.id);
                        setQtyValues((prev) => ({ ...prev, [material.id]: currentQty.toString() }));
                      }}
                      className="ml-2 text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
              <div className="mt-1">
                <MaterialCostDisplay ourCost={ourCost} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(material.id)}
              className="text-red-400 hover:text-red-300"
              aria-label="Remove material"
            >
              <span className="material-symbols-outlined text-lg">delete</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface AddVariantInlineProps {
  existingSuffixes: string[];
  onAdd: (
    suffix: string,
    name?: string,
    price?: number,
    laborHours?: number,
    skipRefresh?: boolean
  ) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

const AddVariantInline: React.FC<AddVariantInlineProps> = ({
  existingSuffixes,
  onAdd,
  onRefresh,
  showToast,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const normalize = (s: string) => s.replace(/^-/, '').trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;

    // Check if input is a number (for bulk creation)
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0 && num <= 999) {
      // Bulk creation: create variants from -01 through -{num}
      setLoading(true);
      try {
        const created: string[] = [];
        const skipped: string[] = [];

        for (let i = 1; i <= num; i++) {
          const suffix = i.toString().padStart(2, '0'); // "01", "02", ..., "14"

          if (existingSuffixes.includes(suffix)) {
            skipped.push(suffix);
            continue;
          }

          try {
            await onAdd(suffix, undefined, undefined, undefined, true); // skipRefresh = true
            created.push(suffix);
          } catch (error) {
            console.error(`Failed to create variant -${suffix}:`, error);
            skipped.push(suffix);
          }
        }

        // Refresh the variant list once after all variants are created
        if (onRefresh) {
          await onRefresh();
        }

        if (created.length > 0) {
          showToast(
            `Created ${created.length} variant${created.length !== 1 ? 's' : ''}${skipped.length > 0 ? ` (${skipped.length} already existed)` : ''}`,
            'success'
          );
        } else if (skipped.length > 0) {
          showToast(
            `All ${skipped.length} variant${skipped.length !== 1 ? 's' : ''} already exist`,
            'warning'
          );
        }
        setInput('');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Single variant creation (backward compatibility)
    const normalized = normalize(raw);
    if (!normalized) return;
    if (existingSuffixes.includes(normalized)) {
      showToast('That dash number already exists', 'error');
      return;
    }
    setLoading(true);
    try {
      await onAdd(normalized); // Will auto-refresh via handleAddVariant
      setInput('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. 14 (creates -01 through -14)"
        className="w-48 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Add'}
      </button>
      <span className="text-xs text-slate-400">
        Enter a number to create sequential variants (e.g., 14 creates -01 through -14)
      </span>
    </form>
  );
};

interface AddMaterialFormProps {
  inventoryItems: InventoryItem[];
  usageType: 'per_set' | 'per_variant';
  onSave: (
    inventoryId: string,
    quantity: number,
    unit: string,
    usageType: 'per_set' | 'per_variant'
  ) => void;
  onCancel: () => void;
}

const INVENTORY_CATEGORIES: InventoryCategory[] = [
  'material',
  'foam',
  'trimCord',
  'printing3d',
  'chemicals',
  'hardware',
  'miscSupplies',
];
const CATEGORY_OPTIONS: { value: '' | InventoryCategory; label: string }[] = [
  { value: '', label: 'All types' },
  ...INVENTORY_CATEGORIES.map((c) => ({
    value: c as InventoryCategory,
    label: getCategoryDisplayName(c),
  })),
];

const AddMaterialForm: React.FC<AddMaterialFormProps> = ({
  inventoryItems,
  usageType,
  onSave,
  onCancel,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'' | InventoryCategory>('');
  const [inventoryId, setInventoryId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('units');

  const filteredItems = useMemo(() => {
    if (!categoryFilter) return inventoryItems;
    return inventoryItems.filter((item) => item.category === categoryFilter);
  }, [inventoryItems, categoryFilter]);

  const handleMaterialChange = (selectedId: string) => {
    setInventoryId(selectedId);
    const item = inventoryItems.find((i) => i.id === selectedId);
    setUnit(item?.unit ?? 'units');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inventoryId || !quantity) return;
    onSave(inventoryId, Number(quantity), unit, usageType);
    setInventoryId('');
    setQuantity('');
    setUnit('units');
  };

  const handleCategoryChange = (value: '' | InventoryCategory) => {
    setCategoryFilter(value);
    setInventoryId(''); // clear material when filter changes
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 rounded-sm border border-primary/30 bg-primary/10 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm text-slate-300">Filter by type</label>
          <select
            value={categoryFilter}
            onChange={(e) => handleCategoryChange((e.target.value || '') as '' | InventoryCategory)}
            className="w-full rounded-sm border border-white/10 bg-slate-800 px-3 py-2 text-white focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            style={{
              colorScheme: 'dark',
              backgroundColor: '#1e293b',
              color: '#ffffff',
            }}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Material</label>
          <select
            value={inventoryId}
            onChange={(e) => handleMaterialChange(e.target.value)}
            className="w-full rounded-sm border border-white/10 bg-slate-800 px-3 py-2 text-white focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            style={{
              colorScheme: 'dark',
              backgroundColor: '#1e293b',
              color: '#ffffff',
            }}
            required
          >
            <option value="">Select material...</option>
            {filteredItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Quantity</label>
          <input
            type="number"
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-white"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Unit</label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-white"
            placeholder="From material"
            required
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Add Material
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-white/10 px-4 py-2 text-sm font-medium text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

interface SetCompositionEditorProps {
  part: Part;
  variants: PartVariant[];
  setComposition: Record<string, number>;
  onUpdate: (composition: Record<string, number>) => void;
}

const SetCompositionEditor: React.FC<SetCompositionEditorProps> = ({
  part: _part,
  variants,
  setComposition,
  onUpdate,
}) => {
  const [editing, setEditing] = useState(false);
  const [localComposition, setLocalComposition] = useState<Record<string, number>>({
    ...setComposition,
  });

  const handleSave = () => {
    // Remove zero values
    const cleaned: Record<string, number> = {};
    for (const [key, value] of Object.entries(localComposition)) {
      if (value > 0) cleaned[key] = value;
    }
    onUpdate(cleaned);
    setEditing(false);
  };

  const handleCancel = () => {
    setLocalComposition({ ...setComposition });
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      {!editing ? (
        <div className="flex items-center justify-between">
          {Object.keys(setComposition).length > 0 ? (
            <div>
              <p className="text-sm text-white">
                Contains {Object.keys(setComposition).length} dash number
                {Object.keys(setComposition).length !== 1 ? 's' : ''}
              </p>
              <p className="mt-1 text-xs text-slate-400">{formatSetComposition(setComposition)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No set composition defined</p>
          )}
          <button
            onClick={() => {
              // Initialize with 0 for all variants
              const initial: Record<string, number> = {};
              variants.forEach((v) => {
                initial[v.variantSuffix] = setComposition[v.variantSuffix] || 0;
              });
              setLocalComposition(initial);
              setEditing(true);
            }}
            className="rounded-sm border border-primary/30 bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
          >
            {Object.keys(setComposition).length > 0 ? 'Edit' : 'Define Set'}
          </button>
        </div>
      ) : (
        <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
          <p className="mb-2 text-xs font-bold uppercase text-slate-400">One set:</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {variants.map((variant) => {
              const qty = localComposition[variant.variantSuffix] || 0;
              return (
                <div key={variant.id} className="flex items-center gap-1.5">
                  <label className="shrink-0 text-xs text-slate-300">
                    -{variant.variantSuffix}:
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={qty}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setLocalComposition((prev) => ({
                        ...prev,
                        [variant.variantSuffix]: val,
                      }));
                    }}
                    className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-center text-sm text-white [appearance:textfield] focus:border-primary/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    placeholder="0"
                    aria-label={`Qty for -${variant.variantSuffix}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface CreatePartFormProps {
  onCreated: (partId: string) => void;
  onCancel: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

const CreatePartForm: React.FC<CreatePartFormProps> = ({ onCreated, onCancel, showToast }) => {
  const [partNumber, setPartNumber] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pn = partNumber.trim().toUpperCase();
    const n = name.trim() || pn;
    if (!pn) {
      showToast('Part number is required', 'error');
      return;
    }

    // Check if part already exists
    try {
      const existing = await partsService.getPartByNumber(pn);
      if (existing) {
        showToast(`Part "${pn}" already exists. Opening existing part.`, 'warning');
        onCreated(existing.id);
        return;
      }
    } catch (err) {
      console.error('Error checking for existing part:', err);
    }

    setSubmitting(true);
    try {
      const created = await partsService.createPart({
        partNumber: pn,
        name: n,
        description: description.trim() || undefined,
      });
      if (!created || !created.id) {
        showToast('Failed to create part. It may already exist.', 'error');
        return;
      }
      showToast('Part created. Add variants and set composition.', 'success');
      onCreated(created.id);
    } catch (err: unknown) {
      console.error('Create part error:', err);
      const errorMsg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
      if (errorMsg.includes('duplicate') || errorMsg.includes('unique')) {
        // Try to find and open the existing part
        const existing = await partsService.getPartByNumber(pn);
        if (existing) {
          showToast(`Part "${pn}" already exists. Opening existing part.`, 'warning');
          onCreated(existing.id);
          return;
        }
      }
      showToast(`Failed to create part: ${errorMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            aria-label="Cancel"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <h1 className="text-xl font-bold text-white">New Part</h1>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-lg space-y-3 rounded-sm border border-white/10 bg-white/5 p-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Part Number</label>
            <input
              type="text"
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value.toUpperCase())}
              placeholder="e.g. SK-F35-0911"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Part Name (required)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Required; defaults to part number if empty"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-sm bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Part'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PartDetail;
