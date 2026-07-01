import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { CurrencyInput } from '../components/CurrencyInput';
import { useCustomers, useProjects } from '../hooks/useAccountingQueries';
import { useCreateProject } from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { PROGRESS_BASE } from '../constants';
import type { NewProjectInput, Project, ProjectStatus } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: 'bg-sky-500/15 text-sky-400',
  closed: 'bg-overlay/10 text-muted',
};

function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

/** Dialog to create a new project (contract sum + retainage %). */
function NewProjectModal({ onClose }: { onClose: (projectId?: string) => void }) {
  const { data: customers = [], isPending: customersLoading } = useCustomers();
  const createProject = useCreateProject();
  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [contractSum, setContractSum] = useState(0);
  const [retainagePercent, setRetainagePercent] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!customerId) {
      setError('Select a customer for this project.');
      return;
    }
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    const input: NewProjectInput = {
      customerId,
      name: name.trim(),
      contractSum,
      // Stored as a 0–1 fraction; the form collects a whole-number percent.
      retainagePercent: Math.max(0, Math.min(100, retainagePercent)) / 100,
    };
    const res = await createProject.mutateAsync(input);
    if (res.error || !res.project) {
      setError(res.error ?? 'Could not create the project.');
      return;
    }
    onClose(res.project.id);
  };

  return (
    <div className="app-modal-backdrop z-modal p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">New project</h2>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <FormField label="Customer" htmlFor="proj-customer" required>
            <select
              id="proj-customer"
              className={inputClass}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={customersLoading}
            >
              <option value="">{customersLoading ? 'Loading…' : 'Select customer…'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Project name" htmlFor="proj-name" required>
            <input
              id="proj-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maple St. remodel"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Contract sum" htmlFor="proj-contract">
              <CurrencyInput
                id="proj-contract"
                aria-label="Contract sum"
                value={contractSum}
                onValueChange={setContractSum}
              />
            </FormField>
            <FormField label="Retainage %" htmlFor="proj-retainage" hint="Withheld each period">
              <input
                id="proj-retainage"
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                max="100"
                className={`${inputClass} text-right`}
                value={retainagePercent}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  setRetainagePercent(Number.isFinite(n) ? n : 0);
                }}
              />
            </FormField>
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-overlay/5"
    >
      <span className="flex-1 truncate text-white">{project.name}</span>
      <span className="hidden flex-1 truncate text-sm text-muted sm:block">
        {project.customerName || project.customerId}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-white">
        {formatMoney(project.contractSum)}
      </span>
      <span className="hidden w-16 shrink-0 text-right text-sm text-muted sm:block">
        {(project.retainagePercent * 100).toFixed(1)}%
      </span>
      <StatusPill status={project.status} />
    </button>
  );
}

export default function ProjectsView() {
  const navigate = useNavigate();
  const { data: projects = [], isPending, isError } = useProjects();
  const [showNew, setShowNew] = useState(false);

  return (
    <AccountingShell
      active="progress"
      title="Progress billing"
      actions={
        <Button size="sm" icon="add" onClick={() => setShowNew(true)}>
          New project
        </Button>
      }
    >
      {isPending && <p className="text-muted">Loading projects…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load projects. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-subtle">foundation</span>
          <p className="text-lg font-bold text-white">No projects yet</p>
          <p className="max-w-sm text-sm text-muted">
            Create a project with a contract sum and retainage percent, build its schedule of
            values, then bill each period by percent complete.
          </p>
          <Button size="sm" icon="add" onClick={() => setShowNew(true)}>
            New project
          </Button>
        </div>
      )}

      {projects.length > 0 && (
        <>
          <div className="hidden items-center gap-3 px-3 pb-1 text-xs font-semibold uppercase text-subtle sm:flex">
            <span className="flex-1">Project</span>
            <span className="flex-1">Customer</span>
            <span className="w-28 shrink-0 text-right">Contract</span>
            <span className="w-16 shrink-0 text-right">Retainage</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onOpen={() => navigate(`${PROGRESS_BASE}/${p.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {showNew && (
        <NewProjectModal
          onClose={(projectId) => {
            setShowNew(false);
            if (projectId) navigate(`${PROGRESS_BASE}/${projectId}`);
          }}
        />
      )}
    </AccountingShell>
  );
}
