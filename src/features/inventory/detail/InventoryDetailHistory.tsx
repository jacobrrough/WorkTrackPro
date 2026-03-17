import React from 'react';
import type { InventoryHistoryEntry } from '@/core/types';

function formatHistoryDate(dateString: string | null | undefined): string {
  if (dateString == null || dateString === '') return 'N/A';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    manual_adjust: 'Manual Adjustment',
    reconcile_job: 'Job Reconciliation',
    reconcile_job_reversal: 'Delivery Reversal',
    reconcile_po: 'PO Reconciliation',
    order_received: 'Order Received',
    order_placed: 'Order Placed',
    allocated_to_job: 'Allocated To Job',
    stock_correction: 'Stock Correction',
  };
  return labels[action] || action;
}

interface InventoryDetailHistoryProps {
  history: InventoryHistoryEntry[];
  loadingHistory: boolean;
  onRefresh: () => void;
}

export function InventoryDetailHistory({
  history,
  loadingHistory,
  onRefresh,
}: InventoryDetailHistoryProps) {
  return (
    <div className="rounded-sm bg-card-dark p-3">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Stock History</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingHistory}
          className="text-sm font-bold text-primary disabled:opacity-50"
        >
          {loadingHistory ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      {history.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No history records yet</p>
      ) : (
        <div className="space-y-3">
          {history.map((h) => (
            <div key={h.id} className="rounded-r border-l-4 border-primary/50 bg-white/5 py-2 pl-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">{getActionLabel(h.action)}</p>
                  <p className="text-sm text-slate-400">{h.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {h.userName || 'System'} • {formatHistoryDate(h.createdAt)}
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
  );
}
