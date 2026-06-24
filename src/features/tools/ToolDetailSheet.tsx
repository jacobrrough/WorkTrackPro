import { useState } from 'react';
import type { Tool } from '@/core/types';
import { formatBinLocation } from '@/core/validation';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { toolsService } from '@/services/api/tools';
import { useToolHistory } from '@/hooks/useToolQueries';
import QRScanner from '@/components/QRScanner';
import { ToolStatusPill } from './ToolStatusPill';
import { binsMatch } from './toolScan';
import { holderName } from './toolFormat';

interface ToolDetailSheetProps {
  tool: Tool;
  onClose: () => void;
}

const EVENT_ICON: Record<string, string> = {
  checkout: 'logout',
  checkin: 'login',
  transfer: 'sync_alt',
  retire: 'block',
};

export function ToolDetailSheet({ tool, onClose }: ToolDetailSheetProps) {
  const { currentUser, users, refreshTools } = useApp();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [wrongBinMsg, setWrongBinMsg] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: history = [], isLoading: historyLoading } = useToolHistory(tool.id, showHistory);

  const isMine = !!currentUser && tool.currentHolderId === currentUser.id;
  const isRetired = tool.status === 'retired';
  const isOut = tool.status === 'out';

  const handleTake = async () => {
    setBusy(true);
    const res = await toolsService.take(tool.id);
    setBusy(false);
    if (res.ok) {
      showToast('Checked out to you', 'success');
      await refreshTools();
    } else {
      showToast(res.error || 'Could not take this tool', 'error');
    }
  };

  const handlePutAwayScan = async (scanned: string) => {
    // Instant client-side feedback before the round-trip; the DB is the final authority.
    if (!binsMatch(scanned, tool.homeBin)) {
      setScanning(false);
      setWrongBinMsg(
        `Wrong bin. This tool belongs in ${formatBinLocation(tool.homeBin)} (${tool.homeBin}). Tap “Put away” to scan again.`
      );
      return;
    }
    setScanning(false);
    setBusy(true);
    const res = await toolsService.putAway(tool.id, scanned);
    setBusy(false);
    if (res.ok) {
      showToast('Put away — thanks!', 'success');
      await refreshTools();
      onClose();
    } else if (res.wrongBin) {
      setWrongBinMsg(
        `Wrong bin. This tool belongs in ${formatBinLocation(res.wrongBin)} (${res.wrongBin}). Tap “Put away” to scan again.`
      );
    } else {
      showToast(res.error || 'Could not put this tool away', 'error');
    }
  };

  const handleAssign = async (userId: string) => {
    setBusy(true);
    const res = await toolsService.assign(tool.id, userId);
    setBusy(false);
    setShowAssign(false);
    if (res.ok) {
      showToast(`Handed off to ${holderName(users, userId)}`, 'success');
      await refreshTools();
    } else {
      showToast(res.error || 'Could not hand off this tool', 'error');
    }
  };

  // Coworkers available to receive a hand-off: everyone except the current holder.
  const coworkers = users.filter((u) => u.id !== tool.currentHolderId);

  if (scanning) {
    return (
      <QRScanner
        scanType="bin"
        title="Scan the home bin"
        description={`Scan bin ${tool.homeBin} to put “${tool.name}” away`}
        onScanComplete={handlePutAwayScan}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[88vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-background-dark p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-white">{tool.name}</h2>
            <p className="text-xs text-muted">
              #{tool.toolNumber} • Home: {formatBinLocation(tool.homeBin)}
            </p>
          </div>
          <button onClick={onClose} className="text-white" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="mb-3">
          <ToolStatusPill tool={tool} holderLabel={holderName(users, tool.currentHolderId)} />
          {isMine && <span className="ml-2 text-xs font-semibold text-primary">(you)</span>}
        </div>

        {tool.description && <p className="mb-3 text-sm text-muted">{tool.description}</p>}

        {wrongBinMsg && (
          <div className="mb-3 rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-sm font-semibold text-red-300">
            {wrongBinMsg}
          </div>
        )}

        {/* Actions */}
        {isRetired ? (
          <p className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-muted">
            This tool has been retired and is out of service.
          </p>
        ) : (
          <div className="space-y-2">
            {!isMine && (
              <button
                type="button"
                disabled={busy}
                onClick={handleTake}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 font-bold text-on-accent disabled:opacity-50"
              >
                <span className="material-symbols-outlined">back_hand</span>
                {isOut ? `Take from ${holderName(users, tool.currentHolderId)}` : 'Take / Use'}
              </button>
            )}
            {isOut && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setWrongBinMsg(null);
                  setScanning(true);
                }}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm border border-primary/50 bg-primary/15 px-4 font-bold text-primary disabled:opacity-50"
              >
                <span className="material-symbols-outlined">inventory_2</span>
                Put away
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowAssign(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/5 px-4 font-bold text-white hover:bg-white/10 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">group</span>
              Hand off to coworker
            </button>
          </div>
        )}

        {/* History */}
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="mt-4 flex w-full items-center justify-between rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white"
        >
          <span>Custody history</span>
          <span className="material-symbols-outlined">
            {showHistory ? 'expand_less' : 'expand_more'}
          </span>
        </button>
        {showHistory && (
          <div className="mt-2 space-y-2">
            {historyLoading && <p className="text-sm text-muted">Loading…</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-muted">No activity yet.</p>
            )}
            {history.map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-3 rounded-sm border border-white/10 bg-white/5 p-3"
              >
                <span className="material-symbols-outlined text-base text-muted">
                  {EVENT_ICON[ev.eventType] ?? 'history'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white">
                    {ev.eventType === 'checkout' && `${ev.actorName ?? 'Someone'} took it`}
                    {ev.eventType === 'transfer' &&
                      `${ev.actorName ?? 'Someone'} handed off to ${ev.newHolderName ?? 'someone'}`}
                    {ev.eventType === 'checkin' &&
                      `${ev.actorName ?? 'Someone'} put it away${ev.bin ? ` in ${ev.bin}` : ''}`}
                    {ev.eventType === 'retire' && `${ev.actorName ?? 'Someone'} retired it`}
                  </p>
                  <p className="text-[11px] text-subtle">
                    {new Date(ev.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hand-off coworker picker */}
      {showAssign && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
          onClick={() => setShowAssign(false)}
        >
          <div
            className="max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-background-dark p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Hand off to…</h3>
              <button
                onClick={() => setShowAssign(false)}
                className="text-white"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {coworkers.length === 0 ? (
              <p className="text-sm text-muted">No other employees to hand off to.</p>
            ) : (
              <div className="space-y-2">
                {coworkers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAssign(u.id)}
                    className="flex min-h-[48px] w-full items-center gap-3 rounded-sm border border-white/10 bg-white/5 px-4 text-left font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-muted">person</span>
                    {u.name || u.email}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
