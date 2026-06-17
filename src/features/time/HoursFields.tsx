import React from 'react';
import { MAX_ENTRY_HOURS } from '@/lib/projectHours';
import { todayKey } from '@/lib/dateRange';

interface HoursFieldsProps {
  date: string;
  hours: string;
  note: string;
  onDate: (v: string) => void;
  onHours: (v: string) => void;
  onNote: (v: string) => void;
  /** Fired when Enter is pressed in the date or hours field (submit shortcut). */
  onEnter?: () => void;
  /** Autofocus the date field (used when the edit form opens). */
  autoFocus?: boolean;
}

const inputClass =
  'rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white placeholder:text-slate-500';

/** Shared date + hours + optional-note inputs, used by both the add-hours and edit forms. */
const HoursFields: React.FC<HoursFieldsProps> = ({
  date,
  hours,
  note,
  onDate,
  onHours,
  onNote,
  onEnter,
  autoFocus,
}) => {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && onEnter) onEnter();
  };
  return (
    <>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label="Date"
          max={todayKey()}
          value={date}
          autoFocus={autoFocus}
          onChange={(e) => onDate(e.target.value)}
          onKeyDown={onKeyDown}
          className={inputClass}
        />
        <input
          type="number"
          aria-label="Hours"
          step="0.25"
          min="0.25"
          max={MAX_ENTRY_HOURS}
          value={hours}
          onChange={(e) => onHours(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Hours"
          className={`w-24 ${inputClass}`}
        />
      </div>
      <input
        aria-label="Note (optional)"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="Note (optional)"
        className={`w-full ${inputClass}`}
      />
    </>
  );
};

export default HoursFields;
