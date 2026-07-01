import React, { useState } from 'react';
import type { Attachment, ViewState } from '@/core/types';
import { formatDate } from '@/core/date';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { useBoardDetail } from '@/hooks/useBoardQueries';
import { useBoardMutations } from '@/hooks/useBoardMutations';
import AttachmentsList from '@/AttachmentsList';
import FileUploadButton from '@/FileUploadButton';
import CardEditorModal, { type CardSaveData } from './components/CardEditorModal';

interface CardDetailViewProps {
  boardId: string;
  cardId: string;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack: () => void;
}

const CardDetailView: React.FC<CardDetailViewProps> = ({ boardId, cardId, onBack }) => {
  const { currentUser, users } = useApp();
  const { showToast } = useToast();
  const { data, isLoading } = useBoardDetail(boardId);
  const mutations = useBoardMutations({ currentUser: currentUser ?? null, showToast });

  const [editing, setEditing] = useState(false);

  const board = data?.board ?? null;
  const card = (data?.cards ?? []).find((c) => c.id === cardId) ?? null;
  const members = data?.members ?? [];
  const columns = board?.columns ?? [];

  const isOwner = board?.createdBy === currentUser?.id;
  const memberEntry = members.find((m) => m.userId === currentUser?.id);
  const readOnly = !isOwner && memberEntry?.role === 'viewer';

  const column = card ? columns.find((col) => col.id === card.columnId) : null;
  const assignee = card?.assigneeId ? users.find((u) => u.id === card.assigneeId) : null;
  const overdue = card?.dueDate && new Date(card.dueDate + 'T23:59:59') < new Date();
  const attachments = card?.attachments ?? [];

  const handleUpdateCard = async (saveData: CardSaveData) => {
    if (!card) return;
    await mutations.updateCard(boardId, card.id, saveData);
    setEditing(false);
  };

  const handleDeleteCard = async () => {
    if (!card) return;
    await mutations.deleteCard(boardId, card.id);
    onBack();
  };

  const handleUpload = async (file: File): Promise<boolean> => {
    if (!card) return false;
    const att = await mutations.addCardAttachment(boardId, card.id, file);
    return att != null;
  };

  const handleViewAttachment = (att: Attachment) => {
    if (att.url) window.open(att.url, '_blank', 'noopener,noreferrer');
  };

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background-dark">
        <p className="text-muted">Loading card...</p>
      </div>
    );
  }

  if (!board || !card) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-2 bg-background-dark">
        <p className="text-muted">Card not found</p>
        <button onClick={onBack} className="text-sm text-primary hover:underline">
          Back to board
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex items-center justify-between border-b border-line bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"
            aria-label="Back to board"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="truncate text-lg font-bold text-white">{card.title}</h1>
        </div>
        {!readOnly && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-base">edit</span>
            Edit
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-20">
        <div className="mx-auto max-w-2xl space-y-6">
          {card.color && <div className={`h-2 w-16 rounded-full ${card.color}`} />}

          <div className="flex flex-wrap items-center gap-2">
            {column && (
              <span
                className={`rounded px-2.5 py-1 text-xs font-medium text-white ${column.color ?? 'bg-white/20'}`}
              >
                {column.name}
              </span>
            )}
            {card.dueDate && (
              <span
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
                  overdue ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-muted'
                }`}
              >
                <span className="material-symbols-outlined text-sm">schedule</span>
                {formatDate(card.dueDate)}
              </span>
            )}
          </div>

          {assignee && (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/30 text-sm font-medium text-primary">
                {assignee.initials ?? assignee.name?.slice(0, 2)?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{assignee.name ?? assignee.email}</p>
                <p className="text-xs text-muted">Assignee</p>
              </div>
            </div>
          )}

          {card.description && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Description</h3>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-white/5 p-4 text-sm leading-relaxed text-white">
                {card.description}
              </p>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted">
                Attachments
                {attachments.length > 0 && (
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-muted">
                    {attachments.length}
                  </span>
                )}
              </h3>
              {!readOnly && <FileUploadButton onUpload={handleUpload} label="Upload" />}
            </div>
            <AttachmentsList
              attachments={attachments}
              onViewAttachment={handleViewAttachment}
              canUpload={false}
              showUploadButton={false}
              canDelete={!readOnly}
              onDeleteAttachment={(attachmentId) =>
                mutations.deleteCardAttachment(boardId, attachmentId)
              }
            />
          </div>
        </div>
      </div>

      {editing && card && (
        <CardEditorModal
          card={card}
          users={users}
          canManageAttachments={!readOnly}
          onClose={() => setEditing(false)}
          onSave={handleUpdateCard}
          onDelete={handleDeleteCard}
          onUploadAttachment={(cId, file) => mutations.addCardAttachment(boardId, cId, file)}
          onDeleteAttachment={(attachmentId) =>
            mutations.deleteCardAttachment(boardId, attachmentId)
          }
        />
      )}
    </div>
  );
};

export default CardDetailView;
