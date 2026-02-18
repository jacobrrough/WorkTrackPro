import React, { useState, useEffect, useCallback } from 'react';
import { Part, ViewState, PartVariant, PartMaterial } from '@/core/types';
import { partsService } from './pocketbase';
import { useToast } from './Toast';
import { Card } from './components/ui/Card';
import { Button } from './components/ui/Button';
import { FormField } from './components/ui/FormField';
import { LoadingSpinner } from './Loading';

interface PartDetailProps {
  partId: string;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  isAdmin: boolean;
}

const PartDetail: React.FC<PartDetailProps> = ({ partId, onNavigate, onBack, isAdmin }) => {
  const { showToast } = useToast();
  const [part, setPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editPartNumber, setEditPartNumber] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const loadPart = useCallback(async () => {
    setLoading(true);
    try {
      const p = await partsService.getPartWithVariantsAndMaterials(partId);
      setPart(p);
      if (p) {
        setEditPartNumber(p.partNumber);
        setEditName(p.name);
        setEditDescription(p.description ?? '');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to load part', 'error');
    } finally {
      setLoading(false);
    }
  }, [partId, showToast]);

  useEffect(() => {
    loadPart();
  }, [loadPart]);

  const handleSave = async () => {
    if (!part) return;
    setSaving(true);
    try {
      const updated = await partsService.updatePart(part.id, {
        partNumber: editPartNumber.trim(),
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      if (updated) {
        setPart(updated);
        setIsEditing(false);
        showToast('Part updated', 'success');
      } else {
        showToast('Failed to update part', 'error');
      }
    } catch {
      showToast('Failed to update part', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMaterialClick = (inventoryId: string) => {
    onNavigate('inventory-detail', inventoryId);
  };

  if (loading || !part) {
    return (
      <div className="flex h-full flex-col">
        {onBack && (
          <header className="flex items-center border-b border-white/10 bg-background-dark px-3 py-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Back"
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>
          </header>
        )}
        <LoadingSpinner text="Loading part..." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-background-dark px-3 py-2">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Back"
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-white">
            {part.partNumber}
          </h1>
        </div>
      </header>

      <main
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Part info card */}
        <Card className="mb-3">
          {isEditing ? (
            <div className="space-y-3">
              <FormField label="Part number" required>
                <input
                  type="text"
                  value={editPartNumber}
                  onChange={(e) => setEditPartNumber(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary focus:outline-none"
                />
              </FormField>
              <FormField label="Name" required>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary focus:outline-none"
                />
              </FormField>
              <FormField label="Description">
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-primary focus:outline-none"
                />
              </FormField>
              <div className="flex gap-2">
                <Button variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-400">Part number</p>
                  <p className="font-bold text-white">{part.partNumber}</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
                    aria-label="Edit part"
                  >
                    <span className="material-symbols-outlined text-xl">edit</span>
                  </button>
                )}
              </div>
              <div className="mt-3">
                <p className="text-sm text-slate-400">Name</p>
                <p className="text-white">{part.name || '—'}</p>
              </div>
              {part.description && (
                <div className="mt-3">
                  <p className="text-sm text-slate-400">Description</p>
                  <p className="text-slate-300">{part.description}</p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Variants & materials */}
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">
          Variants & materials
        </h2>
        {!part.variants?.length ? (
          <Card>
            <p className="text-slate-400">
              No variants. Add variants to define materials per option.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {part.variants.map((variant: PartVariant) => (
              <Card key={variant.id}>
                <p className="font-bold text-white">
                  {part.partNumber}-{variant.variantSuffix}
                </p>
                {variant.name && <p className="text-sm text-slate-400">{variant.name}</p>}
                {variant.materials?.length ? (
                  <ul className="mt-3 space-y-2">
                    {variant.materials.map((mat: PartMaterial) => (
                      <li key={mat.id} className="flex items-center justify-between gap-2 text-sm">
                        <button
                          type="button"
                          onClick={() => handleMaterialClick(mat.inventoryId)}
                          className="min-w-0 flex-1 touch-manipulation truncate text-left text-primary hover:underline"
                        >
                          {mat.inventoryName ?? 'Unknown'}
                        </button>
                        <span className="shrink-0 text-slate-400">
                          {mat.quantityPerUnit} {mat.unit}/unit
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No materials</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default PartDetail;
