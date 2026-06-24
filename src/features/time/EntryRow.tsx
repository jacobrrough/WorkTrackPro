import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '@/Toast';
import type { ProjectHourEntry } from '@/core/types';
import {
  computeEntryPay,
  formatUsd,
  isEntryPaid,
  parseHoursInput,
  payFromHours,
} from '@/lib/projectHours';
import { type DateRangePreset, filterByDateRange } from '@/lib/dateRange';
import type { useProjectHoursMutations } from '@/hooks/useProjectHours';
import HoursFields from './HoursFields';

interface EntryRowProps {
  entry: ProjectHourEntry;
  range: DateRangePreset;
  mutations: ReturnType<typeof useProjectHoursMutations>;
  requestConfirm: (c: { title: string; message: string; onConfirm: () => void }) => void;
}

const EntryRow: React.FC<EntryRowProps> = ({ entry, range, mutations, requestConfirm }) => {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(entry.entryDate);
  const [hoursStr, setHoursStr] = useState(String(entry.hours));
  const [note, setNote] = useState(entry.note ?? '');
  const [saving, setSaving] = useState(false);

  // This row unmounts when an edit moves the entry out of the active filter; guard the
  // post-await setState so it doesn't run on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const parsed = parseHoursInput(hoursStr);

  const openEdit = () => {
    // Re-seed drafts from current props so reopening always reflects the latest values
    // (the useState initializers only ran at mount).
    setDate(entry.entryDate);
    setHoursStr(String(entry.hours));
    setNote(entry.note ?? '');
    setEditing(true);
  };

  const cancel = () => {
    setDate(entry.entryDate);
    setHoursStr(String(entry.hours));
    setNote(entry.note ?? '');
    setEditing(false);
  };

  const handleSave = async () => {
    if (!parsed.valid || saving) return;
    setSaving(true);
    try {
      const updated = await mutations.updateEntry(entry.id, {
        entryDate: date,
        hours: parsed.hours,
        note: note.trim() || null,
      });
      if (updated) {
        // If the new date falls outside the active filter, the row will disappear from
        // this view — tell the user so a "vanished" entry isn't re-logged as a duplicate.
        const stillVisible = filterByDateRange([updated], (e) => e.entryDate, range).length > 0;
        if (!stillVisible) {
          showToast('Saved — entry is outside the current date filter', 'info');
        }
        if (mounted.current) setEditing(false);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-2 rounded-sm bg-background-dark/60 p-3 text-sm">
        <HoursFields
          date={date}
          hours={hoursStr}
          note={note}
          onDate={setDate}
          onHours={setHoursStr}
          onNote={setNote}
          onEnter={handleSave}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!parsed.valid || saving}
            className="flex-1 rounded-sm bg-primary py-1.5 text-xs font-bold text-on-accent disabled:opacity-50"
          >
            Save{parsed.valid ? ` (${formatUsd(payFromHours(parsed.hours, entry.rate))})` : ''}
          </button>
          <button
            onClick={cancel}
            className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  const paid = isEntryPaid(entry);

  return (
    <li className="flex items-center justify-between gap-2 rounded-sm bg-white/5 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="text-white">{entry.entryDate}</span>
        <span className="ml-2 text-muted">
          {entry.hours} hrs · {formatUsd(computeEntryPay(entry))}
        </span>
        {paid && (
          <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            Paid
          </span>
        )}
        {entry.note && <p className="truncate text-xs text-subtle">{entry.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {paid ? (
          // A settled entry is locked (no edit/delete); it can only be reopened.
          <button
            onClick={() => mutations.unmarkEntryPaid(entry.id)}
            className="rounded-sm border border-white/10 px-2 py-1 text-[11px] font-medium text-muted hover:bg-white/10"
          >
            Unmark paid
          </button>
        ) : (
          <>
            <button
              onClick={openEdit}
              className="flex size-7 items-center justify-center rounded-full text-subtle hover:bg-white/10 hover:text-white"
              aria-label="Edit entry"
            >
              <span className="material-symbols-outlined text-base">edit</span>
            </button>
            <button
              onClick={() =>
                requestConfirm({
                  title: 'Delete entry',
                  message: `Delete ${entry.hours} hrs logged on ${entry.entryDate}?`,
                  onConfirm: () => mutations.deleteEntry(entry.id),
                })
              }
              className="flex size-7 items-center justify-center rounded-full text-subtle hover:bg-red-500/20 hover:text-red-400"
              aria-label="Delete entry"
            >
              <span className="material-symbols-outlined text-base">delete</span>
            </button>
          </>
        )}
      </div>
    </li>
  );
};

export default EntryRow;
