// ChecklistManager.tsx - Admin component for managing checklists
import React, { useState, useEffect } from 'react';
import { Checklist, ChecklistItem, JobStatus, User } from '@/core/types';
import { useToast } from './Toast';
import { checklistService } from './pocketbase';

interface ChecklistManagerProps {
  onClose: () => void;
  currentUser: User;
}

const ChecklistManager: React.FC<ChecklistManagerProps> = ({
  onClose,
  currentUser: _currentUser,
}) => {
  const { showToast } = useToast();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingChecklist, setEditingChecklist] = useState<Checklist | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<JobStatus>('inProgress');

  const STATUSES: { value: JobStatus; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'rush', label: 'Rush' },
    { value: 'inProgress', label: 'In Progress' },
    { value: 'qualityControl', label: 'Quality Control' },
    { value: 'finished', label: 'Finished' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'toBeQuoted', label: 'To Be Quoted' },
    { value: 'quoted', label: 'Quoted' },
    { value: 'rfqReceived', label: 'RFQ Received' },
    { value: 'rfqSent', label: 'RFQ Sent' },
    { value: 'pod', label: "PO'd" },
  ];

  useEffect(() => {
    loadChecklists();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const loadChecklists = async () => {
    try {
      const lists = await checklistService.getTemplates();
      setChecklists(lists);
    } catch (error) {
      console.error('Failed to load checklists:', error);
      showToast('Failed to load checklists', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateChecklist = async () => {
    try {
      const existing = checklists.find((c) => c.status === selectedStatus);
      if (existing) {
        showToast('Checklist already exists for this status', 'error');
        return;
      }

      const record = await checklistService.create({ job_id: null, status: selectedStatus, items: [] });
      if (!record) throw new Error('Create failed');
      const newChecklist: Checklist = {
        id: record.id,
        job: '',
        status: selectedStatus,
        items: [],
        created: record.created,
        updated: record.updated,
      };

      setChecklists([...checklists, newChecklist]);
      setEditingChecklist(newChecklist);
      showToast('Checklist created', 'success');
    } catch (error) {
      console.error('Failed to create checklist:', error);
      showToast('Failed to create checklist', 'error');
    }
  };

  const handleAddItem = async () => {
    if (!editingChecklist || !newItemText.trim()) return;

    const newItem: ChecklistItem = {
      id: `item_${Date.now()}`,
      text: newItemText.trim(),
      checked: false,
    };

    const updatedItems = [...editingChecklist.items, newItem];

    try {
      await checklistService.update(editingChecklist.id, {
        items: updatedItems,
      });

      const updated = { ...editingChecklist, items: updatedItems };
      setEditingChecklist(updated);
      setChecklists(checklists.map((c) => (c.id === updated.id ? updated : c)));
      setNewItemText('');
      showToast('Item added', 'success');
    } catch (error) {
      console.error('Failed to add item:', error);
      showToast('Failed to add item', 'error');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!editingChecklist) return;

    const updatedItems = editingChecklist.items.filter((item) => item.id !== itemId);

    try {
      await checklistService.update(editingChecklist.id, {
        items: updatedItems,
      });

      const updated = { ...editingChecklist, items: updatedItems };
      setEditingChecklist(updated);
      setChecklists(checklists.map((c) => (c.id === updated.id ? updated : c)));
      showToast('Item deleted', 'success');
    } catch (error) {
      console.error('Failed to delete item:', error);
      showToast('Failed to delete item', 'error');
    }
  };

  const handleUpdateItemText = async (itemId: string, newText: string) => {
    if (!editingChecklist || !newText.trim()) return;

    const updatedItems = editingChecklist.items.map((item) =>
      item.id === itemId ? { ...item, text: newText.trim() } : item
    );

    try {
      await checklistService.update(editingChecklist.id, {
        items: updatedItems,
      });

      const updated = { ...editingChecklist, items: updatedItems };
      setEditingChecklist(updated);
      setChecklists(checklists.map((c) => (c.id === updated.id ? updated : c)));
      showToast('Item updated', 'success');
    } catch (error) {
      console.error('Failed to update item:', error);
      showToast('Failed to update item', 'error');
    }
  };

  const handleReorderItems = async (fromIndex: number, toIndex: number) => {
    if (!editingChecklist) return;

    const items = [...editingChecklist.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);

    try {
      await checklistService.update(editingChecklist.id, {
        items,
      });

      const updated = { ...editingChecklist, items };
      setEditingChecklist(updated);
      setChecklists(checklists.map((c) => (c.id === updated.id ? updated : c)));
    } catch (error) {
      console.error('Failed to reorder items:', error);
      showToast('Failed to reorder items', 'error');
    }
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    if (!confirm('Delete this checklist? This cannot be undone.')) return;

    try {
      await checklistService.delete(checklistId);
      setChecklists(checklists.filter((c) => c.id !== checklistId));
      if (editingChecklist?.id === checklistId) {
        setEditingChecklist(null);
      }
      showToast('Checklist deleted', 'success');
    } catch (error) {
      console.error('Failed to delete checklist:', error);
      showToast('Failed to delete checklist', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-sm border border-white/10 bg-card-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h2 className="text-lg font-bold text-white">Manage Checklists</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex h-[calc(90vh-80px)]">
          {/* Left Panel - Checklist List */}
          <div className="w-1/3 overflow-y-auto border-r border-white/10 p-4">
            <div className="mb-4">
              <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                Create New Checklist
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as JobStatus)}
                className="mb-2 w-full rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-primary"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleCreateChecklist}
                className="w-full rounded bg-primary py-2 text-sm font-bold text-white transition-colors hover:bg-primary/80"
              >
                Create Checklist
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="mb-2 text-xs font-bold uppercase text-slate-400">
                Existing Checklists
              </h3>
              {loading ? (
                <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
              ) : checklists.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">No checklists yet</p>
              ) : (
                checklists.map((checklist) => (
                  <button
                    key={checklist.id}
                    onClick={() => setEditingChecklist(checklist)}
                    className={`w-full rounded-sm border p-3 text-left transition-all ${
                      editingChecklist?.id === checklist.id
                        ? 'border-primary bg-primary/20 text-white'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-primary/50'
                    }`}
                  >
                    <p className="text-sm font-bold">
                      {STATUSES.find((s) => s.value === checklist.status)?.label}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{checklist.items.length} items</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right Panel - Checklist Editor */}
          <div className="flex-1 overflow-y-auto p-4">
            {editingChecklist ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white">
                    {STATUSES.find((s) => s.value === editingChecklist.status)?.label} Checklist
                  </h3>
                  <button
                    onClick={() => handleDeleteChecklist(editingChecklist.id)}
                    className="text-sm font-bold text-red-400 hover:text-red-300"
                  >
                    Delete Checklist
                  </button>
                </div>

                <div className="rounded-sm border border-white/10 bg-white/5 p-3">
                  <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                    Add New Item
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newItemText}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddItem()}
                      placeholder="Enter checklist item..."
                      className="flex-1 rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleAddItem}
                      disabled={!newItemText.trim()}
                      className="rounded bg-primary px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-400">
                    Checklist Items ({editingChecklist.items.length})
                  </h4>
                  {editingChecklist.items.length === 0 ? (
                    <p className="py-8 text-center text-slate-500">
                      No items yet. Add items above.
                    </p>
                  ) : (
                    editingChecklist.items.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-sm border border-white/10 bg-white/5 p-3"
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => index > 0 && handleReorderItems(index, index - 1)}
                            disabled={index === 0}
                            className="text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <span className="material-symbols-outlined text-sm">arrow_upward</span>
                          </button>
                          <button
                            onClick={() =>
                              index < editingChecklist.items.length - 1 &&
                              handleReorderItems(index, index + 1)
                            }
                            disabled={index === editingChecklist.items.length - 1}
                            className="text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <span className="material-symbols-outlined text-sm">
                              arrow_downward
                            </span>
                          </button>
                        </div>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={item.text}
                            onChange={(e) => handleUpdateItemText(item.id, e.target.value)}
                            className="w-full border-none bg-transparent text-sm text-white outline-none"
                          />
                        </div>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-slate-500">
                  Select a checklist to edit
                  <br />
                  or create a new one
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChecklistManager;
