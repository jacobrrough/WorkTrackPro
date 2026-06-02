import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { CurrencyInput } from '../components/CurrencyInput';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useCreateFixedAsset } from '../hooks/useAccountingMutations';
import { computeStraightLineSchedule, depreciableBaseCents } from '../depreciation';
import { FIXED_ASSETS_BASE } from '../constants';
import { formatAssetDate, formatMoney } from './fixedAssetFormat';
import {
  DEPRECIATION_METHOD_LABELS,
  DEPRECIATION_METHODS,
  type DepreciationMethod,
  type NewFixedAssetInput,
} from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Today as a bare ISO `YYYY-MM-DD` for the in-service date default. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * D3 — Create a fixed asset. Captures the asset's name, the three GL accounts its
 * depreciation touches (the asset account it sits in, the accumulated-depreciation
 * contra-asset it credits, and the depreciation-expense account it debits), its acquisition
 * cost, salvage value, useful life in months, method and in-service date. On save the
 * service writes the header and generates its straight-line schedule via the DB
 * (integer-cents split, remainder in the final period) — creating the asset posts NO money;
 * depreciation posts later, per period.
 *
 * The contra/expense accounts are OPTIONAL here: left blank, the service fills them from the
 * seeded defaults in accounting.settings (1510 Accumulated Depreciation / 6000 Depreciation
 * Expense). A live preview shows the schedule the straight-line math will produce (the JS
 * analog of the DB generator) so the user can sanity-check the per-period amount and end date
 * before saving. Financial surface → carries the CPA/EA disclaimer (G9).
 */
export default function FixedAssetCreateView() {
  const navigate = useNavigate();
  const createAsset = useCreateFixedAsset();

  const [name, setName] = useState('');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [accumDeprAccountId, setAccumDeprAccountId] = useState('');
  const [deprExpenseAccountId, setDeprExpenseAccountId] = useState('');
  const [cost, setCost] = useState(0);
  const [salvageValue, setSalvageValue] = useState(0);
  const [usefulLifeMonths, setUsefulLifeMonths] = useState(60);
  const [method, setMethod] = useState<DepreciationMethod>('straight_line');
  const [inServiceDate, setInServiceDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  // Live straight-line preview (JS analog of accounting.generate_depreciation_schedule).
  // Empty until there is a depreciable base and a positive life, exactly as the DB writes
  // no rows then. We show the first/last period and the per-period amount, plus the base.
  const baseCents = useMemo(
    () => depreciableBaseCents(cost, salvageValue),
    [cost, salvageValue]
  );
  const schedule = useMemo(
    () =>
      computeStraightLineSchedule({
        cost,
        salvageValue,
        usefulLifeMonths,
        inServiceDate,
      }),
    [cost, salvageValue, usefulLifeMonths, inServiceDate]
  );

  // Local validity mirrors the service's validateAssetFigures so the button enables only
  // when a save would pass (the service + DB remain the authority).
  const figuresValid =
    cost >= 0 &&
    salvageValue >= 0 &&
    salvageValue <= cost &&
    Number.isInteger(usefulLifeMonths) &&
    usefulLifeMonths > 0 &&
    !!inServiceDate;
  const canSave = !!name.trim() && !!assetAccountId && figuresValid;

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give the asset a name.');
      return;
    }
    if (!assetAccountId) {
      setError('Choose the asset account this asset sits in.');
      return;
    }
    if (salvageValue > cost) {
      setError('Salvage value cannot exceed cost.');
      return;
    }
    if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
      setError('Useful life must be a whole number of months greater than zero.');
      return;
    }
    const input: NewFixedAssetInput = {
      name: name.trim(),
      assetAccountId,
      accumDeprAccountId: accumDeprAccountId || null,
      deprExpenseAccountId: deprExpenseAccountId || null,
      cost,
      salvageValue,
      usefulLifeMonths,
      method,
      inServiceDate,
    };
    const res = await createAsset.mutateAsync(input);
    if (res.error || !res.asset) {
      setError(res.error ?? 'Could not create the fixed asset.');
      return;
    }
    navigate(`${FIXED_ASSETS_BASE}/${res.asset.id}`);
  };

  return (
    <AccountingShell active="fixed-assets" title="New fixed asset">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <TaxDisclaimer />

        <button
          type="button"
          onClick={() => navigate(FIXED_ASSETS_BASE)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-slate-400 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          All fixed assets
        </button>

        {/* Identity + accounts */}
        <section className="flex flex-col gap-3">
          <FormField label="Asset name" htmlFor="fa-name" required>
            <input
              id="fa-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Delivery van"
            />
          </FormField>

          <FormField
            label="Asset account"
            htmlFor="fa-asset-account"
            required
            hint="The GL account the asset's cost sits in (e.g. 1500 Fixed Assets)."
          >
            <AccountPicker
              id="fa-asset-account"
              ariaLabel="Asset account"
              value={assetAccountId}
              onChange={setAssetAccountId}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Accumulated depreciation"
              htmlFor="fa-accum-account"
              hint="Defaults to 1510 Accumulated Depreciation when left blank."
            >
              <AccountPicker
                id="fa-accum-account"
                ariaLabel="Accumulated depreciation account"
                value={accumDeprAccountId}
                onChange={setAccumDeprAccountId}
              />
            </FormField>

            <FormField
              label="Depreciation expense"
              htmlFor="fa-expense-account"
              hint="Defaults to the configured Depreciation Expense account when left blank."
            >
              <AccountPicker
                id="fa-expense-account"
                ariaLabel="Depreciation expense account"
                value={deprExpenseAccountId}
                onChange={setDeprExpenseAccountId}
              />
            </FormField>
          </div>
        </section>

        {/* Cost basis + schedule inputs */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Cost" htmlFor="fa-cost" required hint="Acquisition cost.">
            <CurrencyInput
              id="fa-cost"
              aria-label="Cost"
              value={cost}
              onValueChange={setCost}
            />
          </FormField>

          <FormField
            label="Salvage value"
            htmlFor="fa-salvage"
            hint="Estimated end-of-life value (0 ≤ salvage ≤ cost)."
          >
            <CurrencyInput
              id="fa-salvage"
              aria-label="Salvage value"
              value={salvageValue}
              onValueChange={setSalvageValue}
            />
          </FormField>

          <FormField
            label="Useful life (months)"
            htmlFor="fa-life"
            required
            hint="Number of monthly depreciation periods."
          >
            <input
              id="fa-life"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className={inputClass}
              value={usefulLifeMonths === 0 ? '' : usefulLifeMonths}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setUsefulLifeMonths(Number.isFinite(n) ? n : 0);
              }}
            />
          </FormField>

          <FormField label="In-service date" htmlFor="fa-in-service" required>
            <input
              id="fa-in-service"
              type="date"
              className={inputClass}
              value={inServiceDate}
              onChange={(e) => setInServiceDate(e.target.value)}
            />
          </FormField>

          <FormField
            label="Method"
            htmlFor="fa-method"
            hint="Straight-line is posted today; declining balance is reserved (schedules straight-line for now)."
          >
            <select
              id="fa-method"
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
            >
              {DEPRECIATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {DEPRECIATION_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </FormField>
        </section>

        {/* Live straight-line preview */}
        <section className="rounded-sm border border-white/10 bg-card-dark p-3">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">
            Schedule preview
          </h2>
          {baseCents <= 0 || schedule.length === 0 ? (
            <p className="text-sm text-slate-500">
              Enter a cost greater than the salvage value and a useful life of at least one month to
              preview the straight-line schedule.
            </p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Depreciable base
                  </p>
                  <p className="font-mono tabular-nums text-white">{formatMoney(baseCents / 100)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Periods
                  </p>
                  <p className="font-mono tabular-nums text-white">{schedule.length}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Per period
                  </p>
                  <p className="font-mono tabular-nums text-white">
                    {formatMoney(schedule[0].amount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Final period
                  </p>
                  <p className="font-mono tabular-nums text-white">
                    {formatMoney(schedule[schedule.length - 1].amount)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                First period ends {formatAssetDate(schedule[0].periodDate)}; last period ends{' '}
                {formatAssetDate(schedule[schedule.length - 1].periodDate)}. The rounding remainder
                lands in the final period, so the lifetime total equals the depreciable base to the
                penny.
              </p>
            </div>
          )}
        </section>

        {error && (
          <p
            className="rounded-sm border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={() => navigate(FIXED_ASSETS_BASE)}>
            Cancel
          </Button>
          <Button icon="save" onClick={submit} disabled={createAsset.isPending || !canSave}>
            {createAsset.isPending ? 'Saving…' : 'Create asset'}
          </Button>
        </div>
      </div>
    </AccountingShell>
  );
}
