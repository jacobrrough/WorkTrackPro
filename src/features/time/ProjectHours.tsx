import React, { useMemo, useState } from 'react';
import { useToast } from '@/Toast';
import ConfirmDialog from '@/ConfirmDialog';
import { exportToCsv } from '@/lib/exportCsv';
import {
  PROJECT_HOURS_RATE,
  buildExportRows,
  computeProjectTotals,
  countEntriesByProject,
  deleteProjectMessage,
  formatUsd,
  parseHoursInput,
  payFromHours,
} from '@/lib/projectHours';
import { type DateRangePreset, filterByDateRange, todayKey } from '@/lib/dateRange';
import type { ProjectHourEntry, ProjectHours as Project } from '@/core/types';
import { useProjectHoursData, useProjectHoursMutations } from '@/hooks/useProjectHours';
import HoursFields from './HoursFields';
import EntryRow from './EntryRow';

interface ProjectHoursProps {
  onBack: () => void;
}

const RANGES: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

const ProjectHours: React.FC<ProjectHoursProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { projects, entries } = useProjectHoursData(showArchived);
  const mutations = useProjectHoursMutations({ showToast });

  const [range, setRange] = useState<DateRangePreset>('week');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const projectList = projects.data ?? [];

  const filteredEntries = useMemo(
    () => filterByDateRange(entries.data ?? [], (e) => e.entryDate, range),
    [entries.data, range]
  );

  const entriesByProject = useMemo(() => {
    const map = new Map<string, ProjectHourEntry[]>();
    for (const e of filteredEntries) {
      const list = map.get(e.projectId) ?? [];
      list.push(e);
      map.set(e.projectId, list);
    }
    return map;
  }, [filteredEntries]);

  // Total (unfiltered) entry count per project — used for an accurate delete warning,
  // since deleting a project cascades ALL its entries regardless of the date filter.
  const totalCountByProject = useMemo(
    () => countEntriesByProject(entries.data ?? []),
    [entries.data]
  );

  const rollup = useMemo(() => computeProjectTotals(filteredEntries), [filteredEntries]);

  // Only assert a single "@ $X/hr" rate when every entry in view actually uses it; entries
  // snapshot their own rate, so a mixed set would make a single-rate label a lie.
  const uniformRate = useMemo(
    () => filteredEntries.length > 0 && filteredEntries.every((e) => e.rate === PROJECT_HOURS_RATE),
    [filteredEntries]
  );

  const handleExport = () => {
    const rows = buildExportRows(projectList, filteredEntries);
    if (!rows.length) {
      showToast('Nothing to export for this range', 'info');
      return;
    }
    exportToCsv(`project-hours-${range}-${todayKey()}`, rows);
  };

  const [creating, setCreating] = useState(false);
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await mutations.createProject({ name });
      if (created) {
        setNewName('');
        setShowNewProject(false);
        setExpandedId(created.id);
      }
    } finally {
      setCreating(false);
    }
  };

  const isLoading = projects.isLoading || entries.isLoading;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background-dark">
      <header className="safe-area-top sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex size-9 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="truncate text-lg font-bold text-white">Project Hours</h1>
        </div>
        <button
          onClick={() => setShowNewProject((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-base">add</span>
          New
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* New project form */}
          {showNewProject && (
            <div className="flex gap-2 rounded-sm border border-white/10 bg-white/5 p-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Project name"
                className="flex-1 rounded-sm border border-white/10 bg-background-dark px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          )}

          {/* Roll-up summary */}
          <div className="rounded-sm border border-primary/30 bg-primary/10 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Summary
              </span>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                      range === r.key
                        ? 'border border-primary bg-primary/20 text-primary'
                        : 'bg-white/10 text-slate-400'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-bold text-white">{formatUsd(rollup.totalPay)}</p>
                <p className="text-sm text-slate-400">
                  {rollup.totalHours} hrs{uniformRate ? ` @ $${PROJECT_HOURS_RATE}/hr` : ''}
                </p>
              </div>
              <button
                onClick={handleExport}
                disabled={filteredEntries.length === 0}
                className="flex items-center gap-2 rounded-sm border border-primary/50 bg-primary/20 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/30 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">download</span>
                Export CSV
              </button>
            </div>
          </div>

          {/* Show archived toggle */}
          <label className="flex items-center justify-end gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Show archived
          </label>

          {/* Projects */}
          {isLoading ? (
            <p className="py-10 text-center text-slate-400">Loading…</p>
          ) : projectList.length === 0 ? (
            <p className="py-10 text-center text-slate-400">
              No projects yet. Create one to start logging hours.
            </p>
          ) : (
            projectList.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                entries={entriesByProject.get(project.id) ?? []}
                totalEntryCount={totalCountByProject.get(project.id) ?? 0}
                range={range}
                expanded={expandedId === project.id}
                onToggle={() => setExpandedId((id) => (id === project.id ? null : project.id))}
                mutations={mutations}
                requestConfirm={setConfirm}
              />
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        destructive
        confirmText="Confirm"
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
};

interface ProjectRowProps {
  project: Project;
  entries: ProjectHourEntry[];
  totalEntryCount: number;
  range: DateRangePreset;
  expanded: boolean;
  onToggle: () => void;
  mutations: ReturnType<typeof useProjectHoursMutations>;
  requestConfirm: (c: { title: string; message: string; onConfirm: () => void }) => void;
}

const ProjectRow: React.FC<ProjectRowProps> = ({
  project,
  entries,
  totalEntryCount,
  range,
  expanded,
  onToggle,
  mutations,
  requestConfirm,
}) => {
  const totals = useMemo(() => computeProjectTotals(entries), [entries]);
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
    <div className="overflow-hidden rounded-sm border border-white/10 bg-white/5">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-white/5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`material-symbols-outlined text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
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
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                  Archived
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-white">{formatUsd(totals.totalPay)}</p>
          <p className="text-xs text-slate-400">{totals.totalHours} hrs</p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-white/10 p-3">
          {/* Rename */}
          {editingName && (
            <div className="flex gap-2 rounded-sm bg-background-dark/60 p-3">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setNameDraft(project.name);
                    setEditingName(false);
                  }
                }}
                className="flex-1 rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-sm text-white"
              />
              <button
                onClick={handleRename}
                disabled={!nameDraft.trim() || renaming}
                className="rounded-sm bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setNameDraft(project.name);
                  setEditingName(false);
                }}
                className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Add-hours form */}
          {!archived && (
            <div className="space-y-2 rounded-sm bg-background-dark/60 p-3">
              <HoursFields
                date={date}
                hours={hours}
                note={note}
                onDate={setDate}
                onHours={setHours}
                onNote={setNote}
              />
              <button
                onClick={handleAdd}
                disabled={!parsed.valid || saving}
                className="w-full rounded-sm bg-primary py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Log hours
                {parsed.valid ? ` (${formatUsd(payFromHours(parsed.hours))})` : ''}
              </button>
            </div>
          )}

          {/* Entries */}
          {entries.length === 0 ? (
            <p className="py-2 text-center text-xs text-slate-500">No hours in this range.</p>
          ) : (
            <ul className="space-y-1">
              {entries.map((e) => (
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
            <button
              onClick={() => {
                setNameDraft(project.name);
                setEditingName((v) => !v);
              }}
              className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
            >
              Rename
            </button>
            {project.status === 'finished' ? (
              <button
                onClick={() => mutations.setProjectStatus(project.id, 'active')}
                className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
              >
                Reopen
              </button>
            ) : (
              <button
                onClick={() => mutations.setProjectStatus(project.id, 'finished')}
                className="rounded-sm border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
              >
                Mark finished
              </button>
            )}
            {archived ? (
              <button
                onClick={() => mutations.unarchiveProject(project.id)}
                className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
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
                className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
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
              className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectHours;
