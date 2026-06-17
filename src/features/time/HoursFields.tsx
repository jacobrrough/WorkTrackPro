import React from 'react';
import { MAX_ENTRY_HOURS } from '@/lib/projectHours';

interface HoursFieldsProps {
  date: string;
  hours: string;
  note: string;
  onDate: (v: string) => void;
  onHours: (v: string) => void;
  onNote: (v: string) => void;
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
}) => (
  <>
    <div className="flex gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => onDate(e.target.value)}
        className={inputClass}
      />
      <input
        type="number"
        step="0.25"
        min="0.25"
        max={MAX_ENTRY_HOURS}
        value={hours}
        onChange={(e) => onHours(e.target.value)}
        placeholder="Hours"
        className={`w-24 ${inputClass}`}
      />
    </div>
    <input
      value={note}
      onChange={(e) => onNote(e.target.value)}
      placeholder="Note (optional)"
      className={`w-full ${inputClass}`}
    />
  </>
);

export default HoursFields;
