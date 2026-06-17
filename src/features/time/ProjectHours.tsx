import React, { useMemo, useState } from 'react';
import { useToast } from '@/Toast';
import ConfirmDialog from '@/ConfirmDialog';
import { exportToCsv } from '@/lib/exportCsv';
import {
  buildExportRows,
  computeProjectTotals,
  formatUsd,
  isEntryPaid,
  owedEntryIds,
} from '@/lib/projectHours';
import { type DateRangePreset, filterByDateRange, todayKey } from '@/lib/dateRange';
import type { ProjectHourEntry } from '@/core/types';
import { useProjectHoursData, useProjectHoursMutations } from '@/hooks/useProjectHours';
import ProjectRow from './ProjectRow';

interface ProjectHoursProps {
  onBack: () => void;
}

const RANGES: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

function groupByProject(entries: ProjectHourEntry[]): Map<string, ProjectHourEntry[]> {
  const map = new Map<string, ProjectHourEntry[]>();
  for (const e of entries) {
    const list = map.get(e.projectId) ?? [];
    list.push(e);
    map.set(e.projectId, list);
  }
  return map;
}

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

  const [showPaid, setShowPaid] = useState(false);

  const projectList = projects.data ?? [];

  // Ids of the projects currently shown (archived ones are hidden unless toggled on).
  const visibleProjectIds = useMemo(
    () => new Set((projects.data ?? []).map((p) => p.id)),
    [projects.data]
  );

  // All entries belonging to a VISIBLE project (all-time, no date/paid filter). Drives the
  // money picture (Total/Paid/Owed) and each project's owed/total + mark-paid availability.
  const allEntries = useMemo(
    () => (entries.data ?? []).filter((e) => visibleProjectIds.has(e.projectId)),
    [entries.data, visibleProjectIds]
  );

  const allByProject = useMemo(() => groupByProject(allEntries), [allEntries]);

  // Entries shown in the expanded lists & export: date-range filtered, and paid hidden
  // unless "Show paid" is on.
  const filteredEntries = useMemo(() => {
    const inRange = filterByDateRange(allEntries, (e) => e.entryDate, range);
    return showPaid ? inRange : inRange.filter((e) => !isEntryPaid(e));
  }, [allEntries, range, showPaid]);

  const filteredByProject = useMemo(() => groupByProject(filteredEntries), [filteredEntries]);

  // All-time money picture (NOT range-filtered) — owed is the balance still due.
  const summary = useMemo(() => computeProjectTotals(allEntries), [allEntries]);

  const handleExport = () => {
    const rows = buildExportRows(projectList, filteredEntries);
    if (!rows.length) {
      showToast('Nothing to export for this view', 'info');
      return;
    }
    exportToCsv(`project-hours-${range}-${todayKey()}`, rows);
  };

  const handleSettleAll = () => {
    // Settle exactly the visible owed entries that make up summary.owedPay — never a
    // table-wide update that could also touch archived/off-screen owed hours.
    const ids = owedEntryIds(allEntries);
    if (ids.length === 0) return;
    setConfirm({
      title: 'Mark all owed as paid',
      message: `Mark ${formatUsd(summary.owedPay)} (${summary.owedHours} hrs) across all projects as paid? Paid entries become locked.`,
      onConfirm: () => mutations.markPaid(ids),
    });
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
  const isError = projects.isError || entries.isError;
  const retry = () => {
    projects.refetch();
    entries.refetch();
  };

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
                aria-label="Project name"
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

          {/* Money summary — all-time. Owed is the balance still due. */}
          <div className="rounded-sm border border-primary/30 bg-primary/10 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Owed</p>
                <p className="text-3xl font-bold text-white">{formatUsd(summary.owedPay)}</p>
                <p className="text-sm text-slate-400">{summary.owedHours} hrs unpaid</p>
              </div>
              <button
                onClick={handleSettleAll}
                disabled={summary.owedPay <= 0}
                className="flex items-center gap-2 rounded-sm border border-emerald-500/50 bg-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">paid</span>
                Mark all paid
              </button>
            </div>
            <div className="mt-3 flex gap-4 border-t border-white/10 pt-2 text-xs text-slate-400">
              <span>Paid to date: {formatUsd(summary.paidPay)}</span>
              <span>Total: {formatUsd(summary.totalPay)}</span>
            </div>
          </div>

          {/* Toolbar: range + visibility filters + export (scope the activity below) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <button
              onClick={handleExport}
              disabled={filteredEntries.length === 0}
              className="flex items-center gap-2 rounded-sm border border-primary/50 bg-primary/20 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/30 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">download</span>
              Export CSV
            </button>
          </div>
          <div className="flex items-center justify-end gap-4 text-xs text-slate-400">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showPaid}
                onChange={(e) => setShowPaid(e.target.checked)}
                className="accent-primary"
              />
              Show paid
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-primary"
              />
              Show archived
            </label>
          </div>

          {/* Projects */}
          {isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-slate-400">Couldn’t load project hours.</p>
              <button
                onClick={retry}
                className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white"
              >
                Try again
              </button>
            </div>
          ) : isLoading ? (
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
                allEntries={allByProject.get(project.id) ?? []}
                filteredEntries={filteredByProject.get(project.id) ?? []}
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

export default ProjectHours;
