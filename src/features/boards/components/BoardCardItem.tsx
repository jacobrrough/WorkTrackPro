import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardCard, User } from '@/core/types';
import { PendingSyncBadge } from '@/components/PendingSyncBadge';

interface BoardCardItemProps {
  card: BoardCard;
  users: User[];
  readOnly?: boolean;
  onClick: () => void;
}

const BoardCardItem: React.FC<BoardCardItemProps> = ({ card, users, readOnly, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
    // Block native scroll/zoom on the card so the TouchSensor's hold-delay isn't
    // racing the browser's pan gesture — that race was the source of the shake on mobile.
    touchAction: 'none',
  };

  const assignee = card.assigneeId ? users.find((u) => u.id === card.assigneeId) : null;
  const overdue = card.dueDate && new Date(card.dueDate + 'T23:59:59') < new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="cursor-pointer rounded border border-white/10 bg-white/5 p-3 transition-colors hover:border-white/20 hover:bg-white/10"
    >
      {card.color && <div className={`mb-2 h-1 w-8 rounded-full ${card.color}`} />}
      <PendingSyncBadge entityId={card.id} className="mb-1" />
      <p className="text-sm font-medium text-white">{card.title}</p>
      {card.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted">{card.description}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {card.dueDate && (
          <span
            className={`flex items-center gap-0.5 text-[10px] ${
              overdue ? 'text-red-400' : 'text-subtle'
            }`}
          >
            <span className="material-symbols-outlined text-xs">schedule</span>
            {card.dueDate}
          </span>
        )}
        {(card.attachmentCount ?? card.attachments?.length ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-subtle">
            <span className="material-symbols-outlined text-xs">attach_file</span>
            {card.attachmentCount ?? card.attachments?.length}
          </span>
        )}
        {assignee && (
          <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary/30 text-[10px] font-medium text-primary">
            {assignee.initials ?? assignee.name?.slice(0, 2)?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>
    </div>
  );
};

export default BoardCardItem;
