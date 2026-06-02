/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The Admin Tax-Table editor (FLAG-DARK payroll
 *     module). Renders the PROMINENT UnverifiedBanner (via PayrollScreen). Reads + edits the
 *     admin-updatable accounting.payroll_tax_tables statutory reference rows (rates / wage bases /
 *     withholding brackets) for a tax year. Editing a rate posts NO journal entry and moves NO
 *     money — it only changes how a FUTURE pay run computes withholding (the standard audit trigger
 *     is the tamper trail). EVERY value MUST be verified by a CPA/EA against the current IRS Pub 15 /
 *     Pub 15-T and CA EDD DE 44 for the tax year before any real use. The screen also flags SEEDING
 *     GAPS (a kind with no active row → the engine withholds 0 for it).
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { PayrollScreen } from './PayrollScreen';
import {
  usePayrollSeededKinds,
  usePayrollTaxTables,
  usePayrollTaxTableYears,
} from '../hooks/useAccountingQueries';
import {
  useSetPayrollTaxTableActive,
  useUpdatePayrollTaxTable,
} from '../hooks/useAccountingMutations';
import {
  PAYROLL_FILING_STATUS_LABELS,
  type PayrollTaxTable,
  type PayrollTaxTableBody,
  type PercentageBracket,
  type UpdatePayrollTaxTableInput,
} from '../types';
import {
  groupTaxTables,
  isPercentageBody,
  missingTaxKindLabels,
  summarizeBody,
} from './taxTableEditorFormat';
import { formatPayrollDate, taxKindLabel } from './payrollFormat';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Parse a percentage string ("6.2") to a decimal rate (0.062); blank/NaN → 0. */
function pctToRate(text: string): number {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n / 100 : 0;
}
/** Format a decimal rate as a percentage string for an input ("0.062" → "6.2"). */
function rateToPct(rate: number | null | undefined): string {
  if (rate == null) return '';
  return String(Number((rate * 100).toFixed(6)));
}
/** Parse a dollar string to integer cents; blank → null. */
function dollarsToCentsOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number.parseFloat(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Format integer cents as a plain dollar string for an input; null → ''. */
function centsToDollarsStr(cents: number | null | undefined): string {
  if (cents == null) return '';
  return String(cents / 100);
}

/** Editor for a FLAT-rate body (rate / employer rate / wage base / threshold). */
function FlatBodyEditor({
  body,
  onChange,
}: {
  body: Extract<PayrollTaxTableBody, { method?: 'flat' }>;
  onChange: (next: PayrollTaxTableBody) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormField label="Employee rate (%)" htmlFor="b-rate">
        <input
          id="b-rate"
          inputMode="decimal"
          className={`${inputClass} text-right`}
          value={rateToPct(body.rate)}
          onChange={(e) => onChange({ ...body, rate: pctToRate(e.target.value) })}
        />
      </FormField>
      <FormField label="Employer rate (%)" htmlFor="b-erate" hint="Blank = none.">
        <input
          id="b-erate"
          inputMode="decimal"
          className={`${inputClass} text-right`}
          value={rateToPct(body.employerRate)}
          onChange={(e) => onChange({ ...body, employerRate: e.target.value.trim() === '' ? null : pctToRate(e.target.value) })}
        />
      </FormField>
      <FormField label="Annual wage base ($)" htmlFor="b-base" hint="Blank = no cap.">
        <input
          id="b-base"
          inputMode="decimal"
          className={`${inputClass} text-right`}
          value={centsToDollarsStr(body.wageBaseCents)}
          onChange={(e) => onChange({ ...body, wageBaseCents: dollarsToCentsOrNull(e.target.value) })}
        />
      </FormField>
      <FormField label="Threshold ($)" htmlFor="b-thresh" hint="e.g. Additional-Medicare start. Blank = none.">
        <input
          id="b-thresh"
          inputMode="decimal"
          className={`${inputClass} text-right`}
          value={centsToDollarsStr(body.thresholdCents)}
          onChange={(e) => onChange({ ...body, thresholdCents: dollarsToCentsOrNull(e.target.value) })}
        />
      </FormField>
    </div>
  );
}

/** Editor for a PERCENTAGE-method body (standard deduction + brackets). */
function PercentageBodyEditor({
  body,
  onChange,
}: {
  body: Extract<PayrollTaxTableBody, { method: 'percentage' }>;
  onChange: (next: PayrollTaxTableBody) => void;
}) {
  const setBracket = (i: number, patch: Partial<PercentageBracket>) => {
    const brackets = body.brackets.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    onChange({ ...body, brackets });
  };

  return (
    <div className="flex flex-col gap-3">
      <FormField label="Standard deduction ($)" htmlFor="b-std" hint="Blank = none.">
        <input
          id="b-std"
          inputMode="decimal"
          className={`${inputClass} max-w-[14rem] text-right`}
          value={centsToDollarsStr(body.standardDeductionCents)}
          onChange={(e) => onChange({ ...body, standardDeductionCents: dollarsToCentsOrNull(e.target.value) })}
        />
      </FormField>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          Annual brackets · {body.brackets.length}
        </p>
        <div className="overflow-x-auto rounded-sm border border-white/10">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-right">Over ($)</th>
                <th className="px-2 py-1.5 text-right">But not over ($)</th>
                <th className="px-2 py-1.5 text-right">Base tax ($)</th>
                <th className="px-2 py-1.5 text-right">Rate (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {body.brackets.map((b, i) => (
                <tr key={i}>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Bracket ${i + 1} over`}
                      inputMode="decimal"
                      className={`${inputClass} text-right`}
                      value={centsToDollarsStr(b.overCents)}
                      onChange={(e) => setBracket(i, { overCents: dollarsToCentsOrNull(e.target.value) ?? 0, ofExcessOverCents: dollarsToCentsOrNull(e.target.value) ?? 0 })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Bracket ${i + 1} but not over`}
                      inputMode="decimal"
                      className={`${inputClass} text-right`}
                      value={centsToDollarsStr(b.butNotOverCents)}
                      onChange={(e) => setBracket(i, { butNotOverCents: dollarsToCentsOrNull(e.target.value) })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Bracket ${i + 1} base tax`}
                      inputMode="decimal"
                      className={`${inputClass} text-right`}
                      value={centsToDollarsStr(b.baseCents)}
                      onChange={(e) => setBracket(i, { baseCents: dollarsToCentsOrNull(e.target.value) ?? 0 })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Bracket ${i + 1} rate`}
                      inputMode="decimal"
                      className={`${inputClass} text-right`}
                      value={rateToPct(b.rate)}
                      onChange={(e) => setBracket(i, { rate: pctToRate(e.target.value) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          "Of excess over" mirrors the bracket floor automatically. Adding/removing bracket rows is a
          follow-up — deactivate + insert a new row to restructure the schedule.
        </p>
      </div>
    </div>
  );
}

/** The edit dialog for one tax-table row (body + provenance + active). */
function TaxTableEditModal({ row, onClose }: { row: PayrollTaxTable; onClose: () => void }) {
  const update = useUpdatePayrollTaxTable();
  const [body, setBody] = useState<PayrollTaxTableBody>(row.body);
  const [effectiveDate, setEffectiveDate] = useState(row.effectiveDate);
  const [citation, setCitation] = useState(row.sourceCitation);
  const [revision, setRevision] = useState(row.sourceRevision);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!citation.trim() || !revision.trim()) {
      setError('A source citation and revision are required (provenance the verifier needs).');
      return;
    }
    const input: UpdatePayrollTaxTableInput = {
      body,
      effectiveDate,
      sourceCitation: citation.trim(),
      sourceRevision: revision.trim(),
      notes: notes.trim() || null,
    };
    const res = await update.mutateAsync({ id: row.id, input });
    if (res.error || !res.row) {
      setError(res.error ?? 'Could not save the tax-table row. Confirm you have a payroll-admin role.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {taxKindLabel(row.taxKind)} · {row.taxYear}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          {row.jurisdiction === 'CA' ? 'California' : 'Federal'} ·{' '}
          {row.filingStatus === 'any' ? 'all filing statuses' : PAYROLL_FILING_STATUS_LABELS[row.filingStatus]} ·{' '}
          {row.payFrequency} frequency
        </p>

        <div className="rounded-sm border border-red-500/40 bg-red-500/10 p-2 text-[11px] font-semibold text-red-200">
          UNVERIFIED — confirm every value against the current IRS Pub 15 / Pub 15-T or CA EDD DE 44
          before this is used to compute a real paycheck.
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {isPercentageBody(body) ? (
            <PercentageBodyEditor body={body} onChange={setBody} />
          ) : (
            <FlatBodyEditor body={body} onChange={setBody} />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Effective date" htmlFor="t-eff">
              <input id="t-eff" type="date" className={inputClass} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </FormField>
            <FormField label="Source citation" htmlFor="t-cite" required>
              <input id="t-cite" className={inputClass} value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="IRS Pub 15-T (2026)" />
            </FormField>
            <FormField label="Source revision" htmlFor="t-rev" required>
              <input id="t-rev" className={inputClass} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="2026" />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="t-notes">
            <input id="t-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional verification note" />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save tax table'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One tax-table row in the editor list. */
function TaxTableRow({ row, onEdit }: { row: PayrollTaxTable; onEdit: () => void }) {
  const setActive = useSetPayrollTaxTableActive();
  const [error, setError] = useState<string | null>(null);

  const onToggle = async () => {
    setError(null);
    const res = await setActive.mutateAsync({ id: row.id, isActive: !row.isActive });
    if (!res.ok) setError(res.error ?? 'Could not change the row status.');
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-white">{taxKindLabel(row.taxKind)}</p>
          {row.filingStatus !== 'any' && (
            <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
              {PAYROLL_FILING_STATUS_LABELS[row.filingStatus]}
            </span>
          )}
          {!row.isActive && (
            <span className="rounded-sm bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              Inactive
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {summarizeBody(row.body)} · eff {formatPayrollDate(row.effectiveDate)} ·{' '}
          <span className="text-slate-600">{row.sourceCitation}</span>
        </p>
        {error && (
          <p className="mt-0.5 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" onClick={onToggle} disabled={setActive.isPending}>
        {row.isActive ? 'Retire' : 'Restore'}
      </Button>
    </div>
  );
}

export default function TaxTablesView() {
  const { data: years = [], isPending: yearsPending } = usePayrollTaxTableYears();
  const [year, setYear] = useState<number | null>(null);

  // Default to the newest seeded year (or the current calendar year if none seeded).
  useEffect(() => {
    if (year == null) {
      if (years.length > 0) setYear(years[0]);
      else if (!yearsPending) setYear(new Date().getFullYear());
    }
  }, [years, yearsPending, year]);

  const effectiveYear = year ?? new Date().getFullYear();
  const { data: rows = [], isPending, isError, refetch } = usePayrollTaxTables(effectiveYear, true);
  const { data: seededKinds = [] } = usePayrollSeededKinds(effectiveYear);

  const [editRow, setEditRow] = useState<PayrollTaxTable | null>(null);

  const groups = useMemo(() => groupTaxTables(rows), [rows]);
  const gaps = useMemo(() => missingTaxKindLabels(seededKinds), [seededKinds]);

  return (
    <PayrollScreen
      section="tax-tables"
      title="Tax tables (Unverified)"
      bannerDetail="Every rate, wage base, threshold, and bracket here must be verified against the current IRS Pub 15 / Pub 15-T and CA EDD DE 44 before any real paycheck is computed."
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Statutory rates & brackets
        </h2>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Tax year
          <select
            className={`${inputClass} w-auto`}
            value={effectiveYear}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Tax year"
          >
            {(years.length > 0 ? years : [effectiveYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {gaps.length > 0 && (
        <Card padding="lg" className="border-amber-500/30 bg-amber-500/5">
          <p className="text-sm font-semibold text-amber-200">
            Missing tax tables for {effectiveYear}
          </p>
          <p className="mt-1 text-xs text-amber-100/90">
            The engine withholds <span className="font-bold">$0</span> for any kind with no active
            row. Seed/verify: {gaps.join(', ')}.
          </p>
        </Card>
      )}

      {isPending && <p className="text-slate-400">Loading tax tables…</p>}

      {!isPending && isError && (
        <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">
            Could not load the tax tables. Confirm the accounting schema is exposed and you have a
            payroll role.
          </p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && rows.length === 0 && (
        <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-600">table_chart</span>
          <p className="text-sm text-slate-400">
            No tax tables seeded for {effectiveYear}. The DB migration seeds the federal & CA tables
            from official published values — confirm a migration ran for this year.
          </p>
        </Card>
      )}

      {!isPending && !isError && groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.jurisdiction}>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                {group.jurisdiction === 'CA' ? 'California (EDD)' : 'Federal (IRS)'}
              </h3>
              <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
                {group.rows.map((row) => (
                  <TaxTableRow key={row.id} row={row} onEdit={() => setEditRow(row)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editRow && <TaxTableEditModal row={editRow} onClose={() => setEditRow(null)} />}
    </PayrollScreen>
  );
}
