import React, { useMemo, useState } from 'react';
import type { ProjectHourEntry, ProjectHours as Project } from '@/core/types';
import {
  computeProjectTotals,
  deleteProjectMessage,
  formatUsd,
  isEntryPaid,
  owedEntryIds,
  parseHoursInput,
  payFromHours,
} from '@/lib/projectHours';
import { type DateRangePreset, todayKey } from '@/lib/dateRange';
import type { useProjectHoursMutations } from '@/hooks/useProjectHours';
import HoursFields from './HoursFields';
import EntryRow from './EntryRow';

interface ProjectRowProps {
  project: Project;
  /** All-time entries for this project — drives totals, owed, mark-paid, delete guard. */
  allEntries: ProjectHourEntry[];
  /** Entries to display (date-range + show-paid filtered). */
  filteredEntries: ProjectHourEntry[];
  range: DateRangePreset;
  expanded: boolean;
  onToggle: () => void;
  mutations: ReturnType<typeof useProjectHoursMutations>;
  requestConfirm: (c: { title: string; message: string; onConfirm: () => void }) => void;
}

const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  allEntries,
  filteredEntries,
  range,
  expanded,
  onToggle,
  mutations,
  requestConfirm,
}) => {
  const totals = useMemo(() => computeProjectTotals(allEntries), [allEntries]);
  const paidCount = useMemo(() => allEntries.filter(isEntryPaid).length, [allEntries]);
  const totalEntryCount = allEntries.length;
  const [date, setDate] = useState(todayKey());
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Rename
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [renaming, setRenaming] = useState(false);

  const handleRename = async () => {
    const next = nameDraft.trim();
    if (!next || next === project.name) {
      setEditingName(false);
      return;
    }
    if (renaming) return;
    setRenaming(true);
    try {
      const ok = await mutations.renameProject(project.id, next);
      if (ok) setEditingName(false);
    } finally {
      setRenaming(false);
    }
  };

  const parsed = parseHoursInput(hours);

  const handleAdd = async () => {
    if (!parsed.valid || saving) return;
    setSaving(true);
    try {
      const added = await mutations.addEntry({
        projectId: project.id,
        entryDate: date,
        hours: parsed.hours,
        note: note.trim() || undefined,
      });
      if (added) {
        setHours('');
        setNote('');
      }
    } finally {
      setSaving(false);
    }
  };

  const archived = !!project.archivedAt;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white/5">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${project.name}, ${expanded ? 'collapse' : 'expand'}`}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-white/5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`material-symbols-outlined text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            chevron_right
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{project.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  project.status === 'finished'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-blue-500/20 text-blue-400'
                }`}
              >
                {project.status === 'finished' ? 'Finished' : 'Active'}
              </span>
              {archived && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">
                  Archived
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-white">
            {totals.owedPay > 0 ? `${formatUsd(totals.owedPay)} owed` : 'Settled'}
          </p>
          <p className="text-xs text-muted">
            {totals.totalHours} hrs · {formatUsd(totals.totalPay)} total
          </p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-line p-3">
          {/* Rename */}
          {editingName && (
            <div className="flex gap-2 rounded-lg bg-background-dark/60 p-3">
              <input
                autoFocus
                aria-label="Project name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setNameDraft(project.name);
                    setEditingName(false);
                  }
                }}
                className="flex-1 rounded-lg border border-line bg-background-dark px-2 py-1.5 text-sm text-white"
              />
              <button
                onClick={handleRename}
                disabled={!nameDraft.trim() || renaming}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setNameDraft(project.name);
                  setEditingName(false);
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Add-hours form */}
          {!archived && (
            <div className="space-y-2 rounded-lg bg-background-dark/60 p-3">
              <HoursFields
                date={date}
                hours={hours}
                note={note}
                onDate={setDate}
                onHours={setHours}
                onNote={setNote}
                onEnter={handleAdd}
              />
              <button
                onClick={handleAdd}
                disabled={!parsed.valid || saving}
                className="w-full rounded-lg bg-primary py-2 text-sm font-bold text-on-accent disabled:opacity-50"
              >
                Log hours
                {parsed.valid ? ` (${formatUsd(payFromHours(parsed.hours))})` : ''}
              </button>
            </div>
          )}

          {/* Entries */}
          {filteredEntries.length === 0 ? (
            <p className="py-2 text-center text-xs text-subtle">No hours in this view.</p>
          ) : (
            <ul className="space-y-1">
              {filteredEntries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  range={range}
                  mutations={mutations}
                  requestConfirm={requestConfirm}
                />
              ))}
            </ul>
          )}

          {/* Project actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {totals.owedPay > 0 && (
              <button
                onClick={() =>
                  requestConfirm({
                    title: 'Mark project paid',
                    message: `Mark ${formatUsd(totals.owedPay)} (${totals.owedHours} hrs) owed on "${project.name}" as paid? Paid entries become locked.`,
                    onConfirm: () => mutations.markPaid(owedEntryIds(allEntries)),
                  })
                }
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
              >
                Mark paid
              </button>
            )}
            <button
              onClick={() => {
                setNameDraft(project.name);
                setEditingName((v) => !v);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
            >
              Rename
            </button>
            {project.status === 'finished' ? (
              <button
                onClick={() => mutations.setProjectStatus(project.id, 'active')}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
              >
                Reopen
              </button>
            ) : (
              <button
                onClick={() => mutations.setProjectStatus(project.id, 'finished')}
                className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
              >
                Mark finished
              </button>
            )}
            {archived ? (
              <button
                onClick={() => mutations.unarchiveProject(project.id)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
              >
                Restore
              </button>
            ) : (
              <button
                onClick={() =>
                  requestConfirm({
                    title: 'Archive project',
                    message: `Archive "${project.name}"? Its logged hours are kept and it can be restored later.`,
                    onConfirm: () => mutations.archiveProject(project.id),
                  })
                }
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
              >
                Archive
              </button>
            )}
            <button
              onClick={() =>
                requestConfirm({
                  title: 'Delete project',
                  message: deleteProjectMessage(project.name, totalEntryCount),
                  onConfirm: () => mutations.deleteProject(project.id),
                })
              }
              disabled={paidCount > 0}
              title={
                paidCount > 0
                  ? 'This project has paid hours and can’t be deleted — archive it instead.'
                  : undefined
              }
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectRow;
