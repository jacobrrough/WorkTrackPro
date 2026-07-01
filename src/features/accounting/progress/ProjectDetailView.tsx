import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { LedgerTable } from '../components/LedgerTable';
import {
  useChangeOrders,
  useProgressInvoices,
  useProject,
  useSovLines,
} from '../hooks/useAccountingQueries';
import {
  useCreateChangeOrder,
  useReleaseRetainage,
  useSetChangeOrderStatus,
  useUpsertSovLine,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE, PROGRESS_BASE } from '../constants';
import type { ChangeOrder, ProgressInvoice, SovLine } from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

const CO_STATUS_STYLES: Record<ChangeOrder['status'], string> = {
  draft: 'bg-overlay/10 text-muted',
  approved: 'bg-green-500/15 text-green-400',
  rejected: 'bg-red-500/15 text-red-400',
};

/** A new (unsaved) SOV row the user is filling in. */
interface DraftSov {
  description: string;
  scheduledValue: number;
  incomeAccountId: string;
}

/** Editable schedule-of-values grid: existing lines + an add-row. */
function SovSection({ projectId, sovLines }: { projectId: string; sovLines: SovLine[] }) {
  const upsertSov = useUpsertSovLine();
  const [draft, setDraft] = useState<DraftSov>({
    description: '',
    scheduledValue: 0,
    incomeAccountId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const totalScheduled = useMemo(
    () => sovLines.reduce((s, l) => s + l.scheduledValue, 0),
    [sovLines]
  );

  const addLine = async () => {
    setError(null);
    if (!draft.description.trim() && draft.scheduledValue <= 0) {
      setError('Enter a description and a scheduled value.');
      return;
    }
    const res = await upsertSov.mutateAsync({
      projectId,
      input: {
        description: draft.description.trim() || null,
        scheduledValue: draft.scheduledValue,
        incomeAccountId: draft.incomeAccountId || null,
        sortOrder: sovLines.length,
      },
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    setDraft({ description: '', scheduledValue: 0, incomeAccountId: '' });
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
        Schedule of values
      </h2>
      <LedgerTable
        columns={[
          { label: 'Description' },
          { label: 'Income account' },
          { label: 'Scheduled value', align: 'right' },
          { label: 'Source' },
        ]}
      >
        {sovLines.map((l) => (
          <tr key={l.id} className="border-t border-line/60">
            <td className="px-3 py-2 text-white">{l.description || '—'}</td>
            <td className="px-3 py-2 text-muted">{l.incomeAccountId ? '—' : 'Default income'}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
              {formatMoney(l.scheduledValue)}
            </td>
            <td className="px-3 py-2 text-xs text-subtle">
              {l.changeOrderId ? 'Change order' : 'Original'}
            </td>
          </tr>
        ))}
        {sovLines.length === 0 && (
          <tr className="border-t border-line/60">
            <td className="px-3 py-2 text-subtle" colSpan={4}>
              No schedule-of-values lines yet. Add the first below.
            </td>
          </tr>
        )}
        {/* Add-row */}
        <tr className="border-t border-line bg-overlay/[0.02]">
          <td className="px-3 py-2">
            <input
              aria-label="New SOV description"
              className={inputClass}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Line description"
            />
          </td>
          <td className="px-3 py-2">
            <AccountPicker
              ariaLabel="New SOV income account"
              value={draft.incomeAccountId}
              onChange={(id) => setDraft((d) => ({ ...d, incomeAccountId: id }))}
            />
          </td>
          <td className="px-3 py-2">
            <CurrencyInput
              aria-label="New SOV scheduled value"
              value={draft.scheduledValue}
              onValueChange={(v) => setDraft((d) => ({ ...d, scheduledValue: v }))}
            />
          </td>
          <td className="px-3 py-2 text-right">
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={addLine}
              disabled={upsertSov.isPending}
            >
              Add
            </Button>
          </td>
        </tr>
      </LedgerTable>
      <div className="mt-1 flex justify-end gap-2 pr-3 text-sm">
        <span className="text-muted">Total scheduled</span>
        <span className="font-mono font-bold tabular-nums text-white">
          {formatMoney(totalScheduled)}
        </span>
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Change-orders panel: list + create + approve/reject. */
function ChangeOrdersSection({
  projectId,
  changeOrders,
}: {
  projectId: string;
  changeOrders: ChangeOrder[];
}) {
  const createCo = useCreateChangeOrder();
  const setStatus = useSetChangeOrderStatus();
  const [coNumber, setCoNumber] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    if (amount === 0 && !description.trim()) {
      setError('Enter a change-order amount and description.');
      return;
    }
    const res = await createCo.mutateAsync({
      projectId,
      input: { coNumber: coNumber.trim() || null, description: description.trim() || null, amount },
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    setCoNumber('');
    setDescription('');
    setAmount(0);
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Change orders</h2>
      <LedgerTable
        columns={[
          { label: 'CO #' },
          { label: 'Description' },
          { label: 'Amount', align: 'right' },
          { label: 'Status' },
          { label: '', align: 'right' },
        ]}
      >
        {changeOrders.map((co) => (
          <tr key={co.id} className="border-t border-line/60">
            <td className="px-3 py-2 font-mono text-xs text-muted">{co.coNumber || '—'}</td>
            <td className="px-3 py-2 text-white">{co.description || '—'}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
              {formatMoney(co.amount)}
            </td>
            <td className="px-3 py-2">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CO_STATUS_STYLES[co.status]}`}
              >
                {co.status}
              </span>
            </td>
            <td className="px-3 py-2 text-right">
              {co.status === 'draft' && (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void setStatus.mutateAsync({ projectId, id: co.id, status: 'approved' });
                    }}
                    disabled={setStatus.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void setStatus.mutateAsync({ projectId, id: co.id, status: 'rejected' });
                    }}
                    disabled={setStatus.isPending}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </td>
          </tr>
        ))}
        {changeOrders.length === 0 && (
          <tr className="border-t border-line/60">
            <td className="px-3 py-2 text-subtle" colSpan={5}>
              No change orders. A deduct change order uses a negative amount.
            </td>
          </tr>
        )}
        {/* Add-row */}
        <tr className="border-t border-line bg-overlay/[0.02]">
          <td className="px-3 py-2">
            <input
              aria-label="New change-order number"
              className={inputClass}
              value={coNumber}
              onChange={(e) => setCoNumber(e.target.value)}
              placeholder="CO-001"
            />
          </td>
          <td className="px-3 py-2">
            <input
              aria-label="New change-order description"
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope change"
            />
          </td>
          <td className="px-3 py-2">
            <CurrencyInput
              aria-label="New change-order amount"
              value={amount}
              onValueChange={setAmount}
            />
          </td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-right">
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={add}
              disabled={createCo.isPending}
            >
              Add
            </Button>
          </td>
        </tr>
      </LedgerTable>
      <p className="mt-1 text-xs text-subtle">
        Approving a change order does not post anything. Add its scope as schedule-of-values line(s)
        tied to the change order to bill it.
      </p>
      {error && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Posted applications list with a link out to each one's posted journal entry. */
function ApplicationsSection({
  applications,
  onOpenInvoice,
}: {
  applications: ProgressInvoice[];
  onOpenInvoice: (invoiceId: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Applications</h2>
      <LedgerTable
        columns={[
          { label: '#' },
          { label: 'Period end' },
          { label: 'Work to date', align: 'right' },
          { label: 'Retainage', align: 'right' },
          { label: 'Current due', align: 'right' },
          { label: '', align: 'right' },
        ]}
      >
        {applications.map((app) => (
          <tr key={app.id} className="border-t border-line/60">
            <td className="px-3 py-2 font-mono text-xs text-muted">#{app.sequence}</td>
            <td className="px-3 py-2 text-muted">{app.periodEnd}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
              {formatMoney(app.workCompletedToDate)}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
              {formatMoney(app.retainageToDate)}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
              {formatMoney(app.currentDue)}
            </td>
            <td className="px-3 py-2 text-right">
              {app.invoiceId && (
                <button
                  type="button"
                  onClick={() => onOpenInvoice(app.invoiceId as string)}
                  className="text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  Invoice
                </button>
              )}
            </td>
          </tr>
        ))}
        {applications.length === 0 && (
          <tr className="border-t border-line/60">
            <td className="px-3 py-2 text-subtle" colSpan={6}>
              No applications billed yet.
            </td>
          </tr>
        )}
      </LedgerTable>
    </section>
  );
}

/** Dialog to release withheld retainage into a current receivable. */
function ReleaseRetainageModal({
  projectId,
  withheld,
  onClose,
}: {
  projectId: string;
  withheld: number;
  onClose: () => void;
}) {
  const release = useReleaseRetainage();
  const [amount, setAmount] = useState(withheld);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const res = await release.mutateAsync({ projectId, amount });
    if (!res.ok) {
      setError(res.error ?? 'Could not release retainage.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Release retainage</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-3 text-sm text-muted">
          Withheld to date{' '}
          <span className="font-mono font-bold text-white">{formatMoney(withheld)}</span>. Posts a
          balanced entry (Dr Accounts Receivable / Cr Retainage Receivable) and bills the customer.
        </p>
        <FormField label="Amount to release" htmlFor="release-amount" required>
          <CurrencyInput
            id="release-amount"
            aria-label="Retainage amount to release"
            value={amount}
            onValueChange={setAmount}
          />
        </FormField>
        {error && (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={release.isPending || amount <= 0}>
            {release.isPending ? 'Releasing…' : 'Release'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project, isPending, isError } = useProject(projectId);
  const { data: sovLines = [] } = useSovLines(projectId);
  const { data: changeOrders = [] } = useChangeOrders(projectId);
  const { data: applications = [] } = useProgressInvoices(projectId);
  const [showRelease, setShowRelease] = useState(false);

  // Withheld-to-date = the latest application's retainage-to-date (cumulative figure).
  const withheld = useMemo(() => {
    const posted = applications.filter((a) => a.status !== 'void');
    return posted.length ? posted[posted.length - 1].retainageToDate : 0;
  }, [applications]);

  return (
    <AccountingShell
      active="progress"
      title={project ? project.name : 'Project'}
      actions={
        project ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon="request_quote"
              onClick={() => navigate(`${PROGRESS_BASE}/${project.id}/bill`)}
            >
              New application
            </Button>
            {withheld > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="lock_open"
                onClick={() => setShowRelease(true)}
              >
                Release retainage
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-muted">Loading project…</p>}
      {isError && <p className="text-red-400">Could not load this project.</p>}
      {!isPending && !isError && !project && <p className="text-muted">Project not found.</p>}

      {project && (
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {/* Header meta */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-sm text-muted">
              Customer{' '}
              <span className="text-white">{project.customerName || project.customerId}</span>
            </span>
            <span className="text-sm text-muted">
              Contract{' '}
              <span className="font-mono text-white">{formatMoney(project.contractSum)}</span>
            </span>
            <span className="text-sm text-muted">
              Retainage{' '}
              <span className="text-white">{(project.retainagePercent * 100).toFixed(1)}%</span>
            </span>
            <span className="text-sm text-muted">
              Status <span className="text-white">{project.status}</span>
            </span>
            {withheld > 0 && (
              <span className="text-sm text-muted">
                Withheld <span className="font-mono text-amber-400">{formatMoney(withheld)}</span>
              </span>
            )}
          </div>

          <SovSection projectId={project.id} sovLines={sovLines} />
          <ChangeOrdersSection projectId={project.id} changeOrders={changeOrders} />
          <ApplicationsSection
            applications={applications}
            onOpenInvoice={(invoiceId) => navigate(`${ACCOUNTING_BASE}/invoices/${invoiceId}`)}
          />
        </div>
      )}

      {showRelease && project && (
        <ReleaseRetainageModal
          projectId={project.id}
          withheld={withheld}
          onClose={() => setShowRelease(false)}
        />
      )}
    </AccountingShell>
  );
}
