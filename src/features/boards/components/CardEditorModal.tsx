import React, { useState } from 'react';
import type { Attachment, BoardCard, User } from '@/core/types';
import AttachmentsList from '@/AttachmentsList';
import FileUploadButton from '@/FileUploadButton';

const CARD_COLORS = [
  'bg-pink-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-green-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-purple-500',
];

export interface CardSaveData {
  title: string;
  description?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  color?: string | null;
}

interface CardEditorModalProps {
  card?: BoardCard;
  users: User[];
  canManageAttachments?: boolean;
  onClose: () => void;
  onSave: (data: CardSaveData) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onUploadAttachment?: (cardId: string, file: File) => Promise<Attachment | null>;
  onDeleteAttachment?: (attachmentId: string) => Promise<boolean>;
}

const CardEditorModal: React.FC<CardEditorModalProps> = ({
  card,
  users,
  canManageAttachments = false,
  onClose,
  onSave,
  onDelete,
  onUploadAttachment,
  onDeleteAttachment,
}) => {
  const isEdit = !!card;
  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<string>(card?.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '');
  const [color, setColor] = useState(card?.color ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeId: assigneeId || null,
      dueDate: dueDate || null,
      color: color || null,
    });
    setSaving(false);
  };

  const handleUpload = async (file: File): Promise<boolean> => {
    if (!card || !onUploadAttachment) return false;
    const att = await onUploadAttachment(card.id, file);
    return att != null;
  };

  const handleViewAttachment = (att: Attachment) => {
    if (att.url) window.open(att.url, '_blank', 'noopener,noreferrer');
  };

  const attachments = card?.attachments ?? [];

  return (
    <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col rounded-lg border border-line bg-surface-dark"
        style={{ maxHeight: '90vh' }}
      >
        <header className="border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{isEdit ? 'Edit Card' : 'New Card'}</h2>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <label className="mb-1 block text-sm text-muted">Title</label>
          <input
            autoFocus
            className="app-input mb-4"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title"
            maxLength={200}
          />

          <label className="mb-1 block text-sm text-muted">Description</label>
          <textarea
            className="mb-4 w-full resize-none rounded border border-line bg-overlay/5 px-3 py-2 text-white placeholder-subtle focus:border-primary focus:outline-none"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details..."
            maxLength={2000}
          />

          {isEdit ? (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm text-muted">
                  Attachments
                  {attachments.length > 0 && (
                    <span className="ml-2 rounded bg-overlay/10 px-1.5 py-0.5 text-xs text-muted">
                      {attachments.length}
                    </span>
                  )}
                </label>
                {canManageAttachments && onUploadAttachment && (
                  <FileUploadButton onUpload={handleUpload} label="Upload" />
                )}
              </div>
              <AttachmentsList
                attachments={attachments}
                onViewAttachment={handleViewAttachment}
                canUpload={false}
                showUploadButton={false}
                canDelete={canManageAttachments && !!onDeleteAttachment}
                onDeleteAttachment={onDeleteAttachment}
              />
            </div>
          ) : (
            <p className="mb-4 rounded border border-dashed border-line bg-overlay/5 px-3 py-2 text-xs text-subtle">
              Save the card to upload files.
            </p>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted">Assignee</label>
              <select
                className="app-input text-sm"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">Due date</label>
              <input
                type="date"
                className="app-input text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <label className="mb-1 block text-sm text-muted">Label color</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setColor('')}
              className={`flex h-6 w-6 items-center justify-center rounded-full border border-line-strong ${
                !color ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-dark' : ''
              }`}
            >
              <span className="material-symbols-outlined text-xs text-muted">close</span>
            </button>
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full ${c} ${
                  color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-dark' : ''
                }`}
              />
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-line px-6 py-3">
          <div>
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-sm text-danger-fg hover:underline"
              >
                Delete card
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-muted hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Add Card'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};

export default CardEditorModal;
