import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import {
  useAccounts,
  useDefaultAccounts,
  useProgressInvoices,
  useProject,
  useSovLines,
  useTaxCodes,
} from '../hooks/useAccountingQueries';
import { useCreateProgressInvoice } from '../hooks/useAccountingMutations';
import { buildProgressInvoiceJournalLines, type ComputedProgressLine } from '../posting';
import { formatMoney, toCents } from '../accountingViewModel';
import { PROGRESS_BASE } from '../constants';
import type { NewProgressInvoiceInput, NewProgressInvoiceLineInput } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One editable application row: a SOV line + the percent-complete entered this period. */
interface RowState {
  sovLineId: string;
  description: string;
  scheduledValue: number;
  incomeAccountId: string | null;
  /** Cumulative already billed for this SOV line (from prior posted applications), dollars. */
  priorBilled: number;
  /** Whole-number percent the user entered (0–100). */
  percent: number;
  taxable: boolean;
}

export default function ProgressInvoiceCreateView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId);
  const { data: sovLines = [] } = useSovLines(projectId);
  const { data: applications = [] } = useProgressInvoices(projectId);
  const { data: taxCodes = [] } = useTaxCodes();
  const { data: defaults } = useDefaultAccounts();
  const { data: accounts = [] } = useAccounts();
  const createProgressInvoice = useCreateProgressInvoice();

  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [taxCodeId, setTaxCodeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Account-number lookup for the JE preview (so the preview reads like the ledger).
  const accountLabel = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return (id: string) => {
      const a = byId.get(id);
      if (!a) return id;
      return `${a.accountNumber ? `${a.accountNumber} · ` : ''}${a.name}`;
    };
  }, [accounts]);

  // Prior cumulative billed per SOV line, summed across non-void applications.
  const priorBilledByLine = useMemo(() => {
    const byLine = new Map<string, number>();
    for (const app of applications) {
      if (app.status === 'void') continue;
      for (const l of app.lines ?? []) {
        byLine.set(l.sovLineId, (byLine.get(l.sovLineId) ?? 0) + l.currentPeriod);
      }
    }
    return byLine;
  }, [applications]);

  // Seed one editable row per SOV line, defaulting percent-complete to the already-billed
  // fraction so the form opens showing "no new work this period" until the user bumps it.
  const [rows, setRows] = useState<RowState[]>([]);
  const seeded = useMemo(() => {
    return sovLines.map<RowState>((l) => {
      const prior = priorBilledByLine.get(l.id) ?? 0;
      const startPct = l.scheduledValue > 0 ? Math.round((prior / l.scheduledValue) * 100) : 0;
      return {
        sovLineId: l.id,
        description: l.description || '—',
        scheduledValue: l.scheduledValue,
        incomeAccountId: l.incomeAccountId,
        priorBilled: prior,
        percent: startPct,
        taxable: false,
      };
    });
  }, [sovLines, priorBilledByLine]);

  // Adopt the seeded rows once (and whenever the SOV set changes underneath us).
  const rowsKey = seeded.map((r) => r.sovLineId).join(',');
  const [appliedKey, setAppliedKey] = useState('');
  if (rowsKey !== appliedKey) {
    setRows(seeded);
    setAppliedKey(rowsKey);
  }

  const retainageRate = project?.retainagePercent ?? 0;
  const taxRate = useMemo(() => {
    const code = taxCodes.find((t) => t.id === taxCodeId);
    return code && code.isTaxable ? code.rate : 0;
  }, [taxCodes, taxCodeId]);

  const updateRow = (sovLineId: string, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.sovLineId === sovLineId ? { ...r, ...patch } : r)));

  // Compute the period figures (integer cents) exactly as the service will, so the preview
  // matches the posted entry. completed-to-date = scheduled × pct; current = completed − prior;
  // retainage = current × project rate; tax = current × rate when the row is taxable.
  const computed = useMemo(() => {
    const lines: (ComputedProgressLine & {
      sovLineId: string;
      description: string;
      completedCents: number;
      currentCents: number;
    })[] = [];
    for (const r of rows) {
      const scheduledCents = toCents(r.scheduledValue);
      const pct = Math.max(0, Math.min(1, r.percent / 100));
      const completedCents = Math.round(scheduledCents * pct);
      const priorCents = toCents(r.priorBilled);
      const currentCents = Math.max(0, completedCents - priorCents);
      const retainageCents = Math.round(currentCents * retainageRate);
      const taxCents = r.taxable && taxRate > 0 ? Math.round(currentCents * taxRate) : 0;
      lines.push({
        sovLineId: r.sovLineId,
        description: r.description,
        incomeAccountId: r.incomeAccountId,
        completedCents,
        currentCents,
        currentPeriodCents: currentCents,
        retainageCents,
        taxable: r.taxable,
        taxCents,
        classId: null,
        locationId: null,
        departmentId: null,
      });
    }
    return lines;
  }, [rows, retainageRate, taxRate]);

  const workCents = computed.reduce((s, l) => s + l.currentPeriodCents, 0);
  const retainageCents = computed.reduce((s, l) => s + l.retainageCents, 0);
  const taxCents = computed.reduce((s, l) => s + l.taxCents, 0);
  const currentDueCents = workCents - retainageCents + taxCents;

  // Live JE preview — reuse the exact builder the service uses so the on-screen entry equals
  // the posted one. It throws when there is nothing to bill or accounts are unconfigured; we
  // surface that as a caption rather than a crash.
  const preview = useMemo(() => {
    if (!defaults || workCents <= 0) return null;
    try {
      return buildProgressInvoiceJournalLines(
        {
          workCents,
          retainageCents,
          taxCents,
          lines: computed,
        },
        defaults,
        { customerId: project?.customerId ?? null }
      );
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Unable to preview the entry.' } as const;
    }
  }, [defaults, workCents, retainageCents, taxCents, computed, project]);

  const previewLines = preview && 'lines' in preview ? preview.lines : null;
  const previewError = preview && 'error' in preview ? preview.error : null;

  const submit = async () => {
    setError(null);
    if (workCents <= 0) {
      setError('Enter a percent complete that bills new work this period.');
      return;
    }
    const lines: NewProgressInvoiceLineInput[] = rows
      .filter((r) => {
        const scheduledCents = toCents(r.scheduledValue);
        const completedCents = Math.round(
          scheduledCents * Math.max(0, Math.min(1, r.percent / 100))
        );
        return completedCents - toCents(r.priorBilled) > 0;
      })
      .map((r) => ({
        sovLineId: r.sovLineId,
        percentComplete: Math.max(0, Math.min(1, r.percent / 100)),
        taxable: r.taxable,
      }));
    const input: NewProgressInvoiceInput = {
      projectId: projectId as string,
      periodEnd,
      taxCodeId: taxCodeId || null,
      lines,
    };
    const res = await createProgressInvoice.mutateAsync(input);
    if (res.error || !res.progressInvoice) {
      setError(res.error ?? 'Could not post the progress billing.');
      return;
    }
    navigate(`${PROGRESS_BASE}/${projectId}`);
  };

  const taxShown = taxCodes.length > 0;

  return (
    <AccountingShell active="progress" title="New application">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {taxShown && <TaxDisclaimer />}

        {/* Header */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Period end" htmlFor="pb-period">
            <input
              id="pb-period"
              type="date"
              className={inputClass}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </FormField>
          <FormField
            label="Tax code"
            htmlFor="pb-tax"
            hint="Applied to taxable lines (tax on work)"
          >
            <select
              id="pb-tax"
              className={inputClass}
              value={taxCodeId}
              onChange={(e) => setTaxCodeId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Schedule-of-values percent-complete entry */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
            Work completed
          </h2>
          <LedgerTable
            columns={[
              { label: 'Description' },
              { label: 'Scheduled', align: 'right' },
              { label: 'Prior billed', align: 'right' },
              { label: '% complete', align: 'right' },
              { label: 'This period', align: 'right' },
              { label: 'Retainage', align: 'right' },
              { label: 'Tax' },
            ]}
          >
            {rows.map((r) => {
              const c = computed.find((x) => x.sovLineId === r.sovLineId);
              return (
                <tr key={r.sovLineId} className="border-t border-white/5">
                  <td className="px-3 py-2 text-white">{r.description}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {formatMoney(r.scheduledValue)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {formatMoney(r.priorBilled)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      max="100"
                      aria-label={`Percent complete for ${r.description}`}
                      className={`${inputClass} text-right`}
                      value={r.percent === 0 ? '' : r.percent}
                      onChange={(e) => {
                        const n = Number.parseFloat(e.target.value);
                        updateRow(r.sovLineId, { percent: Number.isFinite(n) ? n : 0 });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
                    {formatMoney((c?.currentCents ?? 0) / 100)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {formatMoney((c?.retainageCents ?? 0) / 100)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Taxable: ${r.description}`}
                      checked={r.taxable}
                      onChange={(e) => updateRow(r.sovLineId, { taxable: e.target.checked })}
                      className="size-4 rounded-sm border-white/20 bg-background-dark"
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr className="border-t border-white/5">
                <td className="px-3 py-2 text-subtle" colSpan={7}>
                  This project has no schedule-of-values lines yet. Add them on the project page.
                </td>
              </tr>
            )}
          </LedgerTable>
        </section>

        {/* Period totals */}
        <div className="ml-auto w-full max-w-xs space-y-1 border-t border-white/10 pt-3 text-sm">
          <div className="flex justify-between text-muted">
            <span>Work this period</span>
            <span className="font-mono tabular-nums text-white">
              {formatMoney(workCents / 100)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Less retainage</span>
            <span className="font-mono tabular-nums text-white">
              −{formatMoney(retainageCents / 100)}
            </span>
          </div>
          {taxCents > 0 && (
            <div className="flex justify-between text-muted">
              <span>Tax</span>
              <span className="font-mono tabular-nums text-white">
                {formatMoney(taxCents / 100)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold text-white">
            <span>Current due</span>
            <span className="font-mono tabular-nums">{formatMoney(currentDueCents / 100)}</span>
          </div>
        </div>

        {/* JE preview — the exact balanced lines that will post. */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
            Journal entry preview
          </h2>
          {previewError && (
            <p className="rounded-sm border border-dashed border-white/10 px-3 py-3 text-sm text-amber-400">
              {previewError}
            </p>
          )}
          {!previewError && !previewLines && (
            <p className="rounded-sm border border-dashed border-white/10 px-3 py-3 text-sm text-subtle">
              Enter a percent complete above to preview the balanced entry.
            </p>
          )}
          {previewLines && (
            <LedgerTable
              columns={[
                { label: 'Account' },
                { label: 'Memo' },
                { label: 'Debit', align: 'right' },
                { label: 'Credit', align: 'right' },
              ]}
            >
              {previewLines.map((l, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-muted">
                    {accountLabel(l.accountId)}
                  </td>
                  <td className="px-3 py-2 text-muted">{l.lineMemo || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
                    {l.debit > 0 ? formatMoney(l.debit) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
                    {l.credit > 0 ? formatMoney(l.credit) : ''}
                  </td>
                </tr>
              ))}
            </LedgerTable>
          )}
        </section>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(`${PROGRESS_BASE}/${projectId}`)}>
            Cancel
          </Button>
          <Button
            icon="post_add"
            onClick={submit}
            disabled={createProgressInvoice.isPending || workCents <= 0 || !!previewError}
          >
            {createProgressInvoice.isPending ? 'Posting…' : 'Post application'}
          </Button>
        </div>
      </div>
    </AccountingShell>
  );
}
