import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { useJournalEntry } from '../hooks/useAccountingQueries';
import { useRemoveEntityAttachments, useVoidJournalEntry } from '../hooks/useAccountingMutations';
import { computeBalance, formatMoney } from '../accountingViewModel';
import type { JournalLine } from '../types';

function sortedLines(lines: JournalLine[] | undefined): JournalLine[] {
  return [...(lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

export default function JournalEntryDetail() {
  const { entryId } = useParams<{ entryId: string }>();
  const { data: entry, isPending, isError } = useJournalEntry(entryId);
  const voidEntry = useVoidJournalEntry();
  // DOCUMENT MANAGEMENT (HELD / UNVERIFIED — NOT FOR FILING). App-layer orphan cleanup for the
  // polymorphic accounting.attachments table (no DB FK to cascade). Fired AFTER a successful
  // void so a voided (terminal) journal entry does not strand its attached objects. Best-effort
  // + non-blocking: a cleanup failure must NEVER mask the successful void.
  const removeEntityAttachments = useRemoveEntityAttachments();
  const [error, setError] = useState<string | null>(null);

  const onVoid = async () => {
    if (!entry) return;
    const reason = window.prompt('Reason for voiding this entry?');
    if (reason == null) return;
    setError(null);
    const res = await voidEntry.mutateAsync({ id: entry.id, reason: reason.trim() || 'Voided' });
    if (!res.ok) {
      setError(res.error ?? 'Could not void the entry.');
      return;
    }
    // Cascade-remove this entry's attachments now that it is voided (fire-and-forget; a cleanup
    // error is swallowed so it cannot surface on the void path).
    removeEntityAttachments.mutate(
      { entityType: 'journal_entry', entityId: entry.id },
      {
        onError: () => {
          /* orphan cleanup is best-effort; never block the void */
        },
      }
    );
  };

  const lines = sortedLines(entry?.lines);
  const balance = computeBalance(lines);

  return (
    <AccountingShell
      active="journal"
      title={entry ? `Journal Entry #${entry.entryNumber}` : 'Journal Entry'}
      actions={
        entry && entry.status === 'posted' ? (
          <Button size="sm" variant="danger" onClick={onVoid} disabled={voidEntry.isPending}>
            {voidEntry.isPending ? 'Voiding…' : 'Void'}
          </Button>
        ) : undefined
      }
    >
      {isPending && <p className="text-slate-400">Loading entry…</p>}
      {isError && <p className="text-red-400">Could not load this entry.</p>}
      {!isPending && !isError && !entry && <p className="text-slate-400">Entry not found.</p>}

      {entry && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-400">
              Date <span className="text-white">{entry.entryDate}</span>
            </span>
            <span className="text-slate-400">
              Status <span className="uppercase text-white">{entry.status}</span>
            </span>
            <span className="text-slate-400">
              Source <span className="text-white">{entry.sourceType}</span>
            </span>
          </div>

          {entry.memo && <p className="text-white">{entry.memo}</p>}
          {entry.status === 'void' && entry.voidReason && (
            <p className="text-sm text-red-400">Voided: {entry.voidReason}</p>
          )}

          <LedgerTable
            columns={[
              { label: 'Account' },
              { label: 'Memo' },
              { label: 'Debit', align: 'right' },
              { label: 'Credit', align: 'right' },
            ]}
          >
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-white">
                  {l.accountNumber ? `${l.accountNumber} · ` : ''}
                  {l.accountName ?? l.accountId}
                </td>
                <td className="px-3 py-2 text-slate-400">{l.lineMemo ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                  {l.debit ? formatMoney(l.debit) : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                  {l.credit ? formatMoney(l.credit) : ''}
                </td>
              </tr>
            ))}
            <tr className="border-t border-white/10 bg-white/5 font-bold">
              <td className="px-3 py-2 text-white" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-white">
                {formatMoney(balance.totalDebit)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-white">
                {formatMoney(balance.totalCredit)}
              </td>
            </tr>
          </LedgerTable>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          {/* DOCUMENT MANAGEMENT (HELD / UNVERIFIED — NOT FOR FILING). Attach supporting
              documents to this journal entry. Renders the UnverifiedBanner + the "stored
              unencrypted" disclosure; moves NO money and posts NO journal entry. */}
          <AttachmentsSection entityType="journal_entry" entityId={entry.id} />
        </div>
      )}
    </AccountingShell>
  );
}
