import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { AccountingDrawer } from '../components/AccountingDrawer';
import {
  useInventoryReconciliation,
  useInventoryReconciliationHeader,
  useInventorySeedPreview,
  usePendingInventoryRevaluations,
} from '../hooks/useAccountingQueries';
import {
  usePostAllInventoryRevaluations,
  useSeedOpeningInventory,
} from '../hooks/useAccountingMutations';
import { summarizeRevaluationBatch } from '../inventoryReconcileMath';
import { ACCOUNTING_BASE, INVENTORY_BASE, inventoryReconcileItemPath } from '../constants';
import {
  formatMoney,
  formatQty,
  formatSignedMoney,
  formatSignedQty,
  reconciliationFlags,
  signedTone,
  todayISO,
} from './inventoryReconcileFormat';
import { SeedExceptionsPanel, SeedPreviewTable } from './seedPanels';
import type {
  InventoryReconciliationHeader,
  InventoryReconciliationRow,
  SeedOpeningInventoryResult,
} from '../types';

/**
 * Inventory ↔ Accounting Reconciliation & Cost Sync (migrations 20260616000001–04). The
 * operations hub that ties operational stock (public.inventory) to the accounting FIFO
 * subledger and GL 1300:
 *
 *   • Header tie — Σ FIFO asset value vs. the LIVE GL 1300 balance (should be 0).
 *   • Pending revaluations — the GATED queue (decision 1). A cost change on stock already
 *     on hand syncs the VALUE instantly on both sides, but the JE that moves GL 1300 is
 *     posted here in an APPROVED batch (Dr/Cr 1300 ↔ 1310 by net). One-click "Post all".
 *   • Exceptions — rows that cannot be valued/seeded/tied (no cost, uncosted, negative,
 *     quantity mismatch), surfaced not hidden.
 *   • Reconciliation grid — per stock item, operational vs. accounting with variances; drills
 *     into the per-item detail (+ price history).
 *   • Seed opening balances — a dry-run PREVIEW (totals + per-item + exceptions) that the
 *     user confirms before ONE balanced opening JE posts (Dr 1300 = Σ in_stock×price /
 *     Cr 3050).
 *
 * Money moves only through the DB RPCs the mutation hooks wrap (each posts a balanced JE via
 * accounting.post_journal_entry). This surface shows financial figures, so it carries the
 * CPA/EA disclaimer (G9). All footer/preview sums come from inventoryReconcileMath (integer
 * cents, G6), so previews tie to the GL to the penny.
 */

/** One labeled figure in a summary strip / header card. */
function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'good' | 'bad';
}) {
  const valueTone =
    tone === 'accent'
      ? 'text-primary'
      : tone === 'good'
        ? 'text-emerald-300'
        : tone === 'bad'
          ? 'text-red-300'
          : 'text-white';
  return (
    <div className="rounded-sm border border-white/10 bg-card-dark p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * The header tie card: Σ asset value vs. live GL 1300, with Σ operational value and Σ
 * queued reval. A non-zero asset-vs-GL variance is flagged (legacy/uncosted stock); a clean
 * tie reads green. Reads its own hook so it can degrade independently of the grid.
 */
function HeaderTie() {
  const { data: header, isPending, isError } = useInventoryReconciliationHeader();

  if (isPending) return <p className="text-slate-400">Loading the GL tie…</p>;
  if (isError || !header) {
    return (
      <p className="text-red-400">
        Could not load the GL-1300 tie. Confirm the accounting schema is exposed and you have an
        accounting role.
      </p>
    );
  }

  const h: InventoryReconciliationHeader = header;
  const tied = Math.round(h.assetValueVsGlVariance * 100) === 0;

  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="FIFO asset value"
          value={formatMoney(h.totalAssetValue)}
          hint="subledger total"
          tone="accent"
        />
        <Stat label="GL 1300 balance" value={formatMoney(h.gl1300Balance)} hint="posted ledger" />
        <Stat
          label="Asset vs GL"
          value={formatSignedMoney(h.assetValueVsGlVariance)}
          hint={tied ? 'ties to the penny' : 'investigate variance'}
          tone={tied ? 'good' : 'bad'}
        />
        <Stat
          label="Operational value"
          value={formatMoney(h.totalOpValue)}
          hint="in-stock × cost"
        />
      </div>
      {h.totalPendingReval !== 0 && (
        <p className="text-xs text-slate-500">
          Plus{' '}
          <span className={`font-mono font-semibold ${signedTone(h.totalPendingReval)}`}>
            {formatSignedMoney(h.totalPendingReval)}
          </span>{' '}
          of cost revaluations queued but not yet posted to GL 1300 (see below).
        </p>
      )}
    </section>
  );
}

/**
 * The gated revaluation batch-post panel. Lists the pending queue, previews the single
 * balanced JE the batch will post (Dr/Cr 1300 ↔ 1310 by net direction, from
 * summarizeRevaluationBatch in integer cents), and posts ALL pending in one approved batch.
 * A net of zero cents posts NO JE (the cost value already synced) — the rows still close.
 */
function PendingRevaluationsPanel() {
  const { data: pending = [], isPending, isError } = usePendingInventoryRevaluations();
  const postAll = usePostAllInventoryRevaluations();
  const [result, setResult] = useState<{ posted: boolean; error?: string } | null>(null);

  const summary = useMemo(() => summarizeRevaluationBatch(pending), [pending]);

  if (isPending) return <p className="text-slate-400">Loading pending revaluations…</p>;
  if (isError) {
    return <p className="text-red-400">Could not load the pending-revaluation queue.</p>;
  }

  if (pending.length === 0) {
    return (
      <div className="rounded-sm border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
        No pending cost revaluations. Every on-hand cost change has been posted to GL 1300.
      </div>
    );
  }

  const directionLabel =
    summary.direction === 'increase'
      ? 'Dr 1300 Inventory Asset / Cr 1310 Inventory Revaluation'
      : summary.direction === 'decrease'
        ? 'Dr 1310 Inventory Revaluation / Cr 1300 Inventory Asset'
        : 'No GL movement (net zero) — rows close without a journal entry';

  const post = async () => {
    setResult(null);
    const res = await postAll.mutateAsync();
    setResult(res);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sky-300">
          Pending revaluations · {pending.length}
        </h2>
        <Button size="sm" icon="post_add" onClick={post} disabled={postAll.isPending}>
          {postAll.isPending ? 'Posting…' : 'Post all'}
        </Button>
      </div>

      <p className="text-xs text-slate-400">
        Cost changes on stock already on hand. The cost value is already in sync on both sides;
        posting books the gated GL movement in one approved, balanced entry.
      </p>

      <div className="overflow-x-auto rounded-sm border border-white/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-slate-400">
              <th className="px-3 py-2 text-left font-semibold">Item</th>
              <th className="px-3 py-2 text-right font-semibold">On hand</th>
              <th className="px-3 py-2 text-right font-semibold">Old cost</th>
              <th className="px-3 py-2 text-right font-semibold">New cost</th>
              <th className="px-3 py-2 text-right font-semibold">GL Δ</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {r.sourceInventoryId.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-300">
                  {formatQty(r.onHandQty)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                  {formatMoney(r.oldCost)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                  {formatMoney(r.newCost)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular-nums ${signedTone(r.deltaAmount)}`}
                >
                  {formatSignedMoney(r.deltaAmount)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-white/10 bg-white/5">
              <td className="px-3 py-2 font-bold text-white" colSpan={4}>
                Net movement ({summary.count} {summary.count === 1 ? 'item' : 'items'})
              </td>
              <td
                className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${signedTone(summary.netAmount)}`}
              >
                {formatSignedMoney(summary.netAmount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Posts as: <span className="text-slate-400">{directionLabel}</span>
      </p>

      {result && (
        <div
          className={`rounded-sm border px-3 py-2 text-xs ${
            result.error
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
          }`}
          role="status"
        >
          {result.error
            ? result.error
            : 'Revaluation batch processed. The open cost layers were re-marked and the GL entry posted.'}
        </div>
      )}
    </section>
  );
}

/** A short attention-flag chip row for a reconciliation row. */
function FlagChips({ row }: { row: InventoryReconciliationRow }) {
  const flags = reconciliationFlags(row);
  if (flags.length === 0) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
        Reconciled
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f.key}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.className}`}
        >
          {f.label}
        </span>
      ))}
    </span>
  );
}

/** The per-item reconciliation grid. Rows are pre-sorted by the service (flagged first). */
function ReconciliationGrid({ rows }: { rows: InventoryReconciliationRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto rounded-sm border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5 text-slate-400">
            <th className="px-3 py-2 text-left font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Op qty</th>
            <th className="px-3 py-2 text-right font-semibold">Acct qty</th>
            <th className="px-3 py-2 text-right font-semibold">Qty Δ</th>
            <th className="px-3 py-2 text-right font-semibold">Op value</th>
            <th className="px-3 py-2 text-right font-semibold">Asset value</th>
            <th className="px-3 py-2 text-right font-semibold">Value Δ</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.sourceInventoryId}
              onClick={() => navigate(inventoryReconcileItemPath(row.sourceInventoryId))}
              className="cursor-pointer border-t border-white/5 hover:bg-white/5"
            >
              <td className="px-3 py-2">
                <span className="block truncate font-medium text-white">
                  {row.inventoryName || 'Unnamed item'}
                </span>
                <span className="block text-xs text-slate-500">
                  {row.unitPrice == null ? 'no cost' : `${formatMoney(row.unitPrice)} / unit`}
                  {row.vendor ? ` · ${row.vendor}` : ''}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                {formatQty(row.inStock)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                {formatQty(row.qtyOnHand)}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono tabular-nums ${
                  row.qtyVariance === 0 ? 'text-slate-500' : signedTone(row.qtyVariance)
                }`}
              >
                {formatSignedQty(row.qtyVariance)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                {row.unitPrice == null ? '—' : formatMoney(row.opValue)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">
                {formatMoney(row.assetValue)}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono tabular-nums ${signedTone(row.valueVariance)}`}
              >
                {formatSignedMoney(row.valueVariance)}
              </td>
              <td className="px-3 py-2">
                <FlagChips row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The seed opening-balances drawer: shows the dry-run PREVIEW (totals, per-item rows that
 * will seed, exceptions) and, on confirm, posts the ONE balanced opening JE. The preview is
 * a read-only query (p_dry_run=true); the confirm calls the writing seed (p_dry_run=false).
 * Idempotent — if a prior opening JE exists the result reports `alreadySeeded`.
 */
function SeedDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const asOf = useMemo(() => todayISO(), []);
  // Only fetch the preview while the drawer is open.
  const { data: preview, isPending, isError } = useInventorySeedPreview(asOf, open);
  const seed = useSeedOpeningInventory();
  const [result, setResult] = useState<SeedOpeningInventoryResult | null>(null);

  const close = () => {
    setResult(null);
    onClose();
  };

  const confirm = async () => {
    setResult(null);
    const res = await seed.mutateAsync(asOf);
    setResult(res);
  };

  // What the confirm will post: the dry-run preview before posting, the real result after.
  const shown = result ?? preview;
  const nothingToSeed = !!shown && shown.itemCount === 0;
  const done = !!result && (result.posted || result.alreadySeeded || !!result.error);

  return (
    <AccountingDrawer
      open={open}
      onClose={close}
      title="Seed opening inventory balances"
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done && (
            <Button
              icon="flag"
              onClick={confirm}
              disabled={seed.isPending || isPending || isError || nothingToSeed}
            >
              {seed.isPending ? 'Posting…' : 'Post opening balances'}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TaxDisclaimer />

        <p className="text-sm text-slate-400">
          Establishes the opening Inventory Asset balance so GL 1300 ties to real on-hand stock. For
          each stock item with on-hand units and a unit cost, this seeds one FIFO cost layer (qty ×
          cost) and posts a single balanced opening entry — Dr 1300 = Σ(in&#8209;stock × cost) / Cr
          3050 Opening Balance Equity. Items already carrying a cost layer are skipped. As of{' '}
          <span className="font-mono text-slate-300">{asOf}</span>.
        </p>

        {isPending && !result && <p className="text-slate-400">Calculating the preview…</p>}
        {isError && !result && (
          <p className="text-red-400">
            Could not calculate the opening-balance preview. Confirm the accounting schema is
            exposed and you have an accounting role.
          </p>
        )}

        {shown && (
          <>
            {/* Idempotency / outcome banners */}
            {result?.error && (
              <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {result.error}
              </div>
            )}
            {result?.alreadySeeded && (
              <div className="rounded-sm border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Opening balances were already seeded (a prior opening entry exists). Nothing was
                posted.
              </div>
            )}
            {result?.posted && (
              <div className="rounded-sm border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                Posted the opening entry: Dr 1300 {formatMoney(result.totalValue)} / Cr 3050.
                {result.journalEntryId ? ' The journal entry is now on the books.' : ''}
              </div>
            )}

            {/* Totals strip */}
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Opening value"
                value={formatMoney(shown.totalValue)}
                hint="Dr 1300 / Cr 3050"
                tone="accent"
              />
              <Stat label="Items" value={String(shown.itemCount)} hint="to seed" />
              <Stat label="Units" value={formatQty(shown.totalQty)} hint="total on hand" />
            </div>

            {nothingToSeed && !result?.alreadySeeded && (
              <p className="rounded-sm border border-white/10 bg-card-dark px-3 py-2 text-xs text-slate-400">
                No eligible items to seed. Every costed, in-stock item already has a cost layer (or
                see the exceptions below).
              </p>
            )}

            <SeedPreviewTable rows={shown.preview} />
            <SeedExceptionsPanel rows={shown.exceptions} />
          </>
        )}
      </div>
    </AccountingDrawer>
  );
}

export default function InventoryReconciliationView() {
  const navigate = useNavigate();
  const { data: rows = [], isPending, isError } = useInventoryReconciliation();
  const [seedOpen, setSeedOpen] = useState(false);

  const exceptionRows = useMemo(
    () => rows.filter((r) => reconciliationFlags(r).length > 0),
    [rows]
  );

  return (
    <AccountingShell
      active="inventory"
      title="Inventory reconciliation"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon="inventory_2"
            onClick={() => navigate(INVENTORY_BASE)}
          >
            Valuation
          </Button>
          <Button size="sm" icon="flag" onClick={() => setSeedOpen(true)}>
            Seed opening balances
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <TaxDisclaimer />

        <p className="text-sm text-slate-400">
          Reconciles operational stock (entered in the app) with the accounting FIFO subledger and
          GL 1300. Per-unit cost stays in sync automatically on both sides; the GL movement for a
          cost change on on-hand stock is posted here in an approved batch. Tap any item for its
          detail and cost-change history.
        </p>

        {/* Header tie — reads its own hook so it degrades independently. */}
        <HeaderTie />

        {/* Gated revaluation queue + batch post. */}
        <PendingRevaluationsPanel />

        {/* Reconciliation grid. */}
        {isPending && <p className="text-slate-400">Loading the reconciliation grid…</p>}
        {isError && (
          <p className="text-red-400">
            Could not load the reconciliation grid. Confirm the accounting schema is exposed and you
            have an accounting role.
          </p>
        )}

        {!isPending && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-500">inventory_2</span>
            <p className="text-lg font-bold text-white">Nothing to reconcile yet</p>
            <p className="max-w-md text-sm text-slate-400">
              This grid compares each stock item&apos;s operational on-hand and cost with its
              accounting cost layers. Add stock with a unit cost in the app, then seed opening
              balances to establish GL 1300.
            </p>
            <Button size="sm" icon="flag" onClick={() => setSeedOpen(true)}>
              Seed opening balances
            </Button>
          </div>
        )}

        {!isPending && !isError && rows.length > 0 && (
          <>
            {/* Exceptions panel — the rows that need attention, called out above the full grid. */}
            {exceptionRows.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300">
                  Needs attention · {exceptionRows.length}
                </h2>
                <p className="text-xs text-slate-400">
                  Items that cannot be valued, are not yet costed in accounting, have a quantity
                  discrepancy, have negative stock, or have a queued revaluation.
                </p>
                <ReconciliationGrid rows={exceptionRows} />
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                All items · {rows.length}
              </h2>
              <ReconciliationGrid rows={rows} />
            </section>

            <p className="text-xs leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-400">How these tie:</span> operational value
              is in&#8209;stock × the per-unit cost; asset value is the FIFO open-layer total that
              ties to GL 1300. A value or quantity variance means the subledger and operational
              stock disagree — investigate, or post a queued revaluation. Seeding opening balances
              establishes the initial cost layers and the GL 1300 balance.
            </p>
          </>
        )}
      </div>

      <SeedDrawer open={seedOpen} onClose={() => setSeedOpen(false)} />

      {/* A quiet link to the GL so an accountant can verify a posting. */}
      <div className="mx-auto mt-4 flex max-w-5xl justify-end">
        <Button
          size="sm"
          variant="ghost"
          icon="menu_book"
          onClick={() => navigate(`${ACCOUNTING_BASE}/journal`)}
        >
          View journal
        </Button>
      </div>
    </AccountingShell>
  );
}
