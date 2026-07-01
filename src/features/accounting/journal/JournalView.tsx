import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { useJournalEntries } from '../hooks/useAccountingQueries';
import { usePostJournalEntry } from '../hooks/useAccountingMutations';
import { computeBalance, formatMoney, toCents, validateJournalDraft } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { todayIsoLocal } from '../periodLockView';
import type { JournalEntry, JournalStatus, NewJournalLineInput } from '../types';

const STATUS_STYLES: Record<JournalStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  posted: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ status }: { status: JournalStatus }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function NewEntryModal({ onClose }: { onClose: () => void }) {
  const postEntry = usePostJournalEntry();
  const [entryDate, setEntryDate] = useState(todayIsoLocal());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<NewJournalLineInput[]>([
    { accountId: '', debit: 0, credit: 0 },
    { accountId: '', debit: 0, credit: 0 },
  ]);
  const [error, setError] = useState<string | null>(null);

  const balance = computeBalance(lines);

  const updateLine = (i: number, patch: Partial<NewJournalLineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const addLine = () => setLines((prev) => [...prev, { accountId: '', debit: 0, credit: 0 }]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const submit = async () => {
    setError(null);
    const validationError = validateJournalDraft(lines);
    if (validationError) {
      setError(validationError);
      return;
    }
    const realLines = lines.filter((l) => toCents(l.debit) > 0 || toCents(l.credit) > 0);
    const res = await postEntry.mutateAsync({
      entryDate,
      memo: memo.trim() || null,
      lines: realLines,
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
  };

  return (
    <div className="app-modal-backdrop z-[100] p-4">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-lg border border-line bg-card-dark shadow-xl">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="text-lg font-bold text-white">New Journal Entry</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Date" htmlFor="je-date">
              <input
                id="je-date"
                type="date"
                className="w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </FormField>
            <FormField label="Memo" htmlFor="je-memo">
              <input
                id="je-memo"
                className="w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Optional description"
              />
            </FormField>
          </div>

          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_120px_120px_40px] gap-2 px-1 text-xs font-semibold uppercase text-subtle md:grid">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span />
            </div>
            {lines.map((line, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_90px_90px_32px] gap-2 md:grid-cols-[1fr_120px_120px_40px]"
              >
                <AccountPicker
                  value={line.accountId}
                  onChange={(accountId) => updateLine(i, { accountId })}
                  ariaLabel={`Line ${i + 1} account`}
                />
                <CurrencyInput
                  aria-label={`Line ${i + 1} debit`}
                  value={line.debit}
                  onValueChange={(v) =>
                    updateLine(i, { debit: v, credit: v > 0 ? 0 : line.credit })
                  }
                />
                <CurrencyInput
                  aria-label={`Line ${i + 1} credit`}
                  value={line.credit}
                  onValueChange={(v) => updateLine(i, { credit: v, debit: v > 0 ? 0 : line.debit })}
                />
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length <= 2}
                  className="flex items-center justify-center rounded-lg text-subtle hover:bg-overlay/10 hover:text-red-400 disabled:opacity-30"
                >
                  <span className="material-symbols-outlined text-lg">delete</span>
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            Add line
          </button>

          <div className="mt-4 flex items-center justify-end gap-6 border-t border-line pt-3 text-sm">
            <span className="text-muted">
              Debits <span className="font-bold text-white">{formatMoney(balance.totalDebit)}</span>
            </span>
            <span className="text-muted">
              Credits{' '}
              <span className="font-bold text-white">{formatMoney(balance.totalCredit)}</span>
            </span>
            <span className={`font-bold ${balance.balanced ? 'text-green-400' : 'text-amber-400'}`}>
              {balance.balanced
                ? 'Balanced'
                : `Off by ${formatMoney(Math.abs(balance.difference))}`}
            </span>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={postEntry.isPending || !balance.balanced}>
            {postEntry.isPending ? 'Posting…' : 'Post entry'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntryRow({ entry, onOpen }: { entry: JournalEntry; onOpen: () => void }) {
  const total = computeBalance(entry.lines ?? []).totalDebit;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/5"
    >
      <span className="w-12 shrink-0 font-mono text-xs text-subtle">#{entry.entryNumber}</span>
      <span className="w-24 shrink-0 text-sm text-muted">{entry.entryDate}</span>
      <span className="flex-1 truncate text-white">{entry.memo || '—'}</span>
      <span className="shrink-0 font-mono text-sm tabular-nums text-muted">
        {formatMoney(total)}
      </span>
      <StatusPill status={entry.status} />
    </button>
  );
}

export default function JournalView() {
  const navigate = useNavigate();
  const { data: entries = [], isPending, isError } = useJournalEntries();
  const [showForm, setShowForm] = useState(false);

  return (
    <AccountingShell
      active="journal"
      title="Journal"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowForm(true)}>
          New entry
        </Button>
      }
    >
      {isPending && <p className="text-muted">Loading journal…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load journal entries. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && entries.length === 0 && (
        <p className="text-muted">No journal entries yet. Post your first entry to begin.</p>
      )}

      {entries.length > 0 && (
        <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onOpen={() => navigate(`${ACCOUNTING_BASE}/journal/${e.id}`)}
            />
          ))}
        </div>
      )}

      {showForm && <NewEntryModal onClose={() => setShowForm(false)} />}
    </AccountingShell>
  );
}
