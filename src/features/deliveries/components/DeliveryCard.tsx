import React from 'react';
import type { Delivery } from '@/core/types';

interface DeliveryCardProps {
  delivery: Delivery;
  canEdit: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const DeliveryCard: React.FC<DeliveryCardProps> = ({
  delivery,
  canEdit,
  onPreview,
  onEdit,
  onDelete,
}) => {
  const totalQty = delivery.lineItems.reduce((sum, l) => sum + (l.quantity || 0), 0);
  const formattedDate = new Date(delivery.deliveredAt + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary/30 px-1.5 py-0.5 text-xs font-bold text-primary">
              #{delivery.deliveryNumber}
            </span>
            <span className="text-base font-semibold text-white">{formattedDate}</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            <span className="font-semibold text-slate-300">{totalQty}</span> items
            {delivery.carrier && ` · ${delivery.carrier}`}
            {delivery.trackingNumber && ` · ${delivery.trackingNumber}`}
          </p>
          {delivery.recipientName && (
            <p className="text-xs text-slate-500">Received by {delivery.recipientName}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={onPreview}
            className="flex items-center gap-1 rounded bg-primary/20 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/30"
            title="View, print or download packing slip"
          >
            <span className="material-symbols-outlined text-sm">receipt_long</span>
            Slip
          </button>
          {canEdit && (
            <>
              <button
                onClick={onEdit}
                className="flex items-center justify-center rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Edit delivery"
                title="Edit"
              >
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
              <button
                onClick={onDelete}
                className="flex items-center justify-center rounded p-1 text-slate-400 hover:bg-white/10 hover:text-red-400"
                aria-label="Delete delivery"
                title="Delete"
              >
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">
        {delivery.lineItems.slice(0, 4).map((item, i) => (
          <div key={i} className="flex justify-between">
            <span className="truncate">
              {item.partNumber
                ? `${item.partNumber}${item.variantSuffix ? `-${item.variantSuffix}` : ''}`
                : item.description}
            </span>
            <span className="ml-2 flex-shrink-0 font-medium">
              {item.quantity} {item.unit ?? 'units'}
            </span>
          </div>
        ))}
        {delivery.lineItems.length > 4 && (
          <p className="text-[10px] text-slate-500">
            …and {delivery.lineItems.length - 4} more
          </p>
        )}
      </div>
      {delivery.notes && (
        <p className="mt-2 line-clamp-2 border-t border-white/10 pt-2 text-xs italic text-slate-400">
          {delivery.notes}
        </p>
      )}
    </div>
  );
};

export default DeliveryCard;
