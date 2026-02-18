import React, { useState, useEffect, useMemo } from 'react';
import { Part, PartVariant, PartMaterial, InventoryItem, Job } from '@/core/types';
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
import { computeRequiredMaterials } from '@/lib/materialFromPart';

interface PartDetailProps {
  partId: string;
  jobs?: Job[];
  onNavigate: (view: string, params?: any) => void;
  onNavigateBack: () => void;
}

const PartDetail: React.FC<PartDetailProps> = ({
  partId,
  jobs: allJobs = [],
  onNavigate,
  onNavigateBack,
}) => {
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
  }, [partId]);

  const loadPart = async () => {
    try {
      setLoading(true);
      setIsVirtualPart(false);
      const partNumberFromJob = partId.startsWith('job-') ? partId.slice(4) : null;
      if (partNumberFromJob) {
        const fromDb = await partsService.getPartByNumber(partNumberFromJob);
        if (fromDb) {
          const withVariants = await partsService.getPartWithVariants(fromDb.id);
          setPart(withVariants);
          return;
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
        return;
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
    } catch (error) {
      showToast('Failed to load part details', 'error');
      console.error('Error loading part:', error);
      setPart(null);
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
    laborHours?: number
  ) => {
    if (!part) return;
    try {
      await partsService.createVariant(part.id, {
        variantSuffix,
        name,
        pricePerVariant: price,
        laborHours,
      });
      showToast('Variant added', 'success');
      loadPart();
    } catch (error) {
      showToast('Failed to add variant', 'error');
      console.error('Error adding variant:', error);
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
      loadPart();
    } catch (error) {
      showToast('Failed to update variant', 'error');
      console.error('Error updating variant:', error);
    }
  };

  const handleAddMaterial = async (
    inventoryId: string,
    quantity: number,
    unit: string,
    usageType: 'per_set' | 'per_variant'
  ) => {
    if (!part) return;
    try {
      await partsService.addMaterial({
        partId: showAddMaterial?.partId || part.id,
        variantId: showAddMaterial?.variantId,
        inventoryId,
        quantity,
        unit,
        usageType,
      });
      showToast('Material added successfully', 'success');
      setShowAddMaterial(null);
      loadPart();
    } catch (error) {
      showToast('Failed to add material', 'error');
      console.error('Error adding material:', error);
    }
  };

  const handleUpdatePart = async (updates: {
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
      const updated = await partsService.updatePart(part.id, updates);
      setPart(updated);
      showToast('Part updated successfully', 'success');
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
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateBack}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">{part.name}</h1>
              <p className="font-mono text-sm text-slate-400">{part.partNumber}</p>
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
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Part Info */}
        <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">Part Information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Name</label>
              <input
                type="text"
                value={part.name}
                onChange={(e) => handleUpdatePart({ name: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value !== part.name) {
                    handleUpdatePart({ name: e.target.value });
                  }
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Price per Set</label>
              <input
                type="number"
                step="0.01"
                value={part.pricePerSet || ''}
                onChange={(e) =>
                  handleUpdatePart({
                    pricePerSet: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                onBlur={(e) => {
                  const value = e.target.value ? Number(e.target.value) : undefined;
                  if (value !== part.pricePerSet) {
                    handleUpdatePart({ pricePerSet: value });
                  }
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                placeholder="0.00"
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
            <div>
              <label className="mb-1 block text-sm text-slate-400">Labor Hours</label>
              <input
                type="number"
                step="0.1"
                value={part.laborHours || ''}
                onChange={(e) =>
                  handleUpdatePart({
                    laborHours: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                onBlur={(e) => {
                  const value = e.target.value ? Number(e.target.value) : undefined;
                  if (value !== part.laborHours) {
                    handleUpdatePart({ laborHours: value });
                  }
                }}
                className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary/50 focus:outline-none"
                placeholder="0.0"
              />
            </div>
          </div>
        </div>

        {/* Set Composition - only for parts in repository */}
        {!isVirtualPart && (
          <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-4 text-lg font-semibold text-white">Set Composition</h2>
            <p className="mb-3 text-sm text-slate-400">
              Define how many of each dash number makes one complete set. This helps compare ordered
              quantities vs full sets.
            </p>
            {part.variants && part.variants.length > 0 ? (
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
            ) : (
              <p className="text-sm text-slate-500">
                Add variants first to define set composition.
              </p>
            )}
            {part.setComposition &&
              typeof part.setComposition === 'object' &&
              !Array.isArray(part.setComposition) &&
              Object.keys(part.setComposition).length > 0 && (
                <>
                  <div className="mt-4 rounded-sm border border-primary/30 bg-primary/10 p-3">
                    <p className="mb-1 text-xs font-bold uppercase text-slate-400">
                      One complete set requires:
                    </p>
                    <p className="text-sm font-medium text-white">
                      {formatSetComposition(part.setComposition)}
                    </p>
                  </div>
                  {(() => {
                    const oneSetQty = part.setComposition as Record<string, number>;
                    const materialMap = computeRequiredMaterials(
                      part as Part & { variants?: PartVariant[] },
                      oneSetQty
                    );
                    if (materialMap.size === 0) return null;
                    const lines = Array.from(materialMap.entries()).map(
                      ([invId, { quantity, unit }]) => {
                        const inv = inventoryItems.find((i) => i.id === invId);
                        return { name: inv?.name ?? 'Unknown', quantity, unit };
                      }
                    );
                    return (
                      <div className="mt-3 rounded-sm border border-white/10 bg-white/5 p-3">
                        <p className="mb-2 text-xs font-bold uppercase text-slate-400">
                          Material requirements for 1 set
                        </p>
                        <ul className="space-y-1 text-sm text-white">
                          {lines.map((l, i) => (
                            <li key={i}>
                              {l.name}: {l.quantity} {l.unit}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </>
              )}
          </div>
        )}

        {/* Variants (dash numbers) - only for parts in repository; 0 variants = part number is the only SKU */}
        {!isVirtualPart && (
          <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Variants (dash numbers)</h2>
            {(part.variants?.length ?? 0) === 0 ? (
              <p className="mb-3 text-sm text-slate-400">
                No variants — part number is the only SKU.
              </p>
            ) : (
              <p className="mb-3 text-xs text-slate-400">
                {part.variants?.length} dash number{(part.variants?.length ?? 0) !== 1 ? 's' : ''}:{' '}
                {part.variants?.map((v) => `-${v.variantSuffix}`).join(', ')}
              </p>
            )}
            <AddVariantInline
              existingSuffixes={part.variants?.map((v) => v.variantSuffix) || []}
              onAdd={handleAddVariant}
              showToast={showToast}
            />
            {part.variants && part.variants.length > 0 ? (
              <div className="mt-4 space-y-3">
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
                    onAddMaterial={() => setShowAddMaterial({ variantId: variant.id })}
                    onMaterialAdded={loadPart}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Part-Level Materials - only for parts in repository */}
        {!isVirtualPart && (
          <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Materials (Per Set)</h2>
              <button
                onClick={() => setShowAddMaterial({ partId: part.id })}
                className="flex items-center gap-2 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-lg">add</span>
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
              <MaterialsList materials={part.materials} onUpdate={loadPart} />
            ) : (
              <p className="text-sm text-slate-400">No materials defined for this part.</p>
            )}
          </div>
        )}

        {/* Job History - record of jobs that used this part; all remain editable */}
        {partJobs.length > 0 && (
          <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-4 text-lg font-semibold text-white">Job History</h2>
            <p className="mb-3 text-sm text-slate-400">
              History of jobs that used this part (including completed/paid). Tap a job to view or
              edit.
            </p>
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
          </div>
        )}
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
  onUpdate: (id: string, updates: any) => void;
  onAddMaterial: () => void;
  onMaterialAdded: () => void;
}

const VariantCard: React.FC<VariantCardProps> = ({
  variant,
  partNumber,
  inventoryItems,
  isEditing,
  onEdit,
  onCancel,
  onUpdate,
  onAddMaterial,
  onMaterialAdded,
}) => {
  const [name, setName] = useState(variant.name || '');
  const [price, setPrice] = useState(variant.pricePerVariant?.toString() || '');
  const [laborHours, setLaborHours] = useState(variant.laborHours?.toString() || '');

  const handleSave = () => {
    onUpdate(variant.id, {
      name: name || undefined,
      pricePerVariant: price ? Number(price) : undefined,
      laborHours: laborHours ? Number(laborHours) : undefined,
    });
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
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="rounded bg-primary px-3 py-1 text-sm text-white"
            >
              Save
            </button>
            <button onClick={onCancel} className="rounded bg-white/10 px-3 py-1 text-sm text-white">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={onEdit} className="text-sm text-primary hover:underline">
            Edit
          </button>
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
            <label className="mb-1 block text-xs text-slate-400">Labor Hours</label>
            <input
              type="number"
              step="0.1"
              value={laborHours}
              onChange={(e) => setLaborHours(e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
              placeholder="0.0"
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
          <button onClick={onAddMaterial} className="text-xs text-primary hover:underline">
            Add Material
          </button>
        </div>
        {variant.materials && variant.materials.length > 0 ? (
          <MaterialsList materials={variant.materials} onUpdate={onMaterialAdded} />
        ) : (
          <p className="text-xs text-slate-500">No materials defined</p>
        )}
      </div>
    </div>
  );
};

interface MaterialsListProps {
  materials: PartMaterial[];
  onUpdate: () => void;
}

const MaterialsList: React.FC<MaterialsListProps> = ({ materials, onUpdate }) => {
  const { showToast } = useToast();

  const handleDelete = async (id: string) => {
    try {
      await partsService.deleteMaterial(id);
      showToast('Material removed', 'success');
      onUpdate();
    } catch (error) {
      showToast('Failed to delete material', 'error');
    }
  };

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
              {material.quantity} {material.unit} ({material.usageType})
            </span>
          </div>
          <button
            onClick={() => handleDelete(material.id)}
            className="text-red-400 hover:text-red-300"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      ))}
    </div>
  );
};

interface AddVariantInlineProps {
  existingSuffixes: string[];
  onAdd: (
    suffix: string,
    name?: string,
    price?: number,
    laborHours?: number
  ) => void | Promise<void>;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

const AddVariantInline: React.FC<AddVariantInlineProps> = ({
  existingSuffixes,
  onAdd,
  showToast,
}) => {
  const [suffix, setSuffix] = useState('');
  const [loading, setLoading] = useState(false);

  const normalize = (s: string) => s.replace(/^-/, '').trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = suffix.trim();
    if (!raw) return;
    const normalized = normalize(raw);
    if (!normalized) return;
    if (existingSuffixes.includes(normalized)) {
      showToast('That dash number already exists', 'error');
      return;
    }
    setLoading(true);
    try {
      await onAdd(normalized);
      setSuffix('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
        placeholder="e.g. 01"
        className="w-24 rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !suffix.trim()}
        className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? '…' : 'Add'}
      </button>
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

const AddMaterialForm: React.FC<AddMaterialFormProps> = ({
  inventoryItems,
  usageType,
  onSave,
  onCancel,
}) => {
  const [inventoryId, setInventoryId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('units');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inventoryId || !quantity) return;
    onSave(inventoryId, Number(quantity), unit, usageType);
    setInventoryId('');
    setQuantity('');
    setUnit('units');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 rounded-sm border border-primary/30 bg-primary/10 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm text-slate-300">Material</label>
          <select
            value={inventoryId}
            onChange={(e) => setInventoryId(e.target.value)}
            className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-white"
            required
          >
            <option value="">Select material...</option>
            {inventoryItems.map((item) => (
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
  part,
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
        <div className="space-y-2 rounded-sm border border-primary/30 bg-primary/10 p-3">
          <p className="text-xs font-bold uppercase text-slate-400">One complete set requires:</p>
          {variants.map((variant) => {
            const qty = localComposition[variant.variantSuffix] || 0;
            return (
              <div key={variant.id} className="flex items-center gap-2">
                <label className="w-32 text-xs text-slate-300">
                  {part.partNumber}-{variant.variantSuffix}:
                </label>
                <input
                  type="number"
                  min="0"
                  value={qty}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setLocalComposition((prev) => ({
                      ...prev,
                      [variant.variantSuffix]: val,
                    }));
                  }}
                  className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                  placeholder="0"
                />
                <span className="text-xs text-slate-500">per set</span>
              </div>
            );
          })}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 rounded bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
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
    setSubmitting(true);
    try {
      const created = await partsService.createPart({
        partNumber: pn,
        name: n,
        description: description.trim() || undefined,
      });
      showToast('Part created. Add variants and set composition.', 'success');
      onCreated(created.id);
    } catch (err) {
      console.error('Create part error:', err);
      showToast('Failed to create part. It may already exist.', 'error');
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
            <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional; defaults to part number"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
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
