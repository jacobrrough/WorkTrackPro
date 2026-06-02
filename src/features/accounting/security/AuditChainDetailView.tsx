/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING — audit-chain
 *     detail. The whole module is FLAG-DARK and requires a SECURITY review before it is enabled;
 *     this screen carries the UnverifiedBanner (via SecurityScreen). It is READ-ONLY — it walks the
 *     SHA-256 hash chain row by row and reports the first break. NOTHING here moves money or posts a
 *     journal entry.
 *
 * One row per inspected chain_seq: ok / reason / the stored hash vs the recomputed expected hash.
 * The DB reports the FIRST break exactly once (it re-chains from the stored hash), so a single
 * corrupted row is flagged once and does not cascade. The failing row is foregrounded.
 */
import { Card } from '@/components/ui/Card';
import { useNavigate } from 'react-router-dom';
import { useAuditChainVerification } from '../hooks/useAccountingQueries';
import { securityOverviewPath } from '../constants';
import {
  failingRowCount,
  shortHash,
  toneBadgeClass,
  toneBorderClass,
  verificationSummary,
  verifyRowTone,
} from '../securityView';
import type { AuditChainVerifyRow } from '../types';
import { SecurityError, SecurityScreen } from './SecurityScreen';

/** One verification row: the seq, the ok/fail badge, the reason, and both hashes. */
function VerifyRow({ row }: { row: AuditChainVerifyRow }) {
  const tone = verifyRowTone(row);
  return (
    <div className={`flex flex-col gap-1.5 border-l-2 px-3 py-2.5 ${toneBorderClass(tone)}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm text-white">#{row.chainSeq}</span>
        <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${toneBadgeClass(tone)}`}>
          {row.ok ? 'Verified' : 'Broken'}
        </span>
      </div>
      {!row.ok && <p className="text-xs text-red-300">{row.reason}</p>}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Stored</span>
          <p className="truncate font-mono text-xs text-slate-300" title={row.storedHash ?? undefined}>
            {shortHash(row.storedHash)}
          </p>
        </div>
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Expected</span>
          <p
            className={`truncate font-mono text-xs ${row.ok ? 'text-slate-300' : 'text-red-300'}`}
            title={row.expectedHash ?? undefined}
          >
            {shortHash(row.expectedHash)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuditChainDetailView() {
  const navigate = useNavigate();
  const { data: rows, isPending, isError, refetch } = useAuditChainVerification();

  const failing = rows ? failingRowCount(rows) : 0;

  return (
    <SecurityScreen
      tab="overview"
      title="Audit-chain verification"
      intro={
        <button
          type="button"
          onClick={() => navigate(securityOverviewPath())}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to security overview
        </button>
      }
    >
      {isPending && <p className="text-sm text-slate-400">Walking the hash chain…</p>}

      {!isPending && isError && (
        <SecurityError
          message="Could not run the chain verification. Confirm the accounting schema is exposed and you have an accounting role."
          onRetry={() => refetch()}
        />
      )}

      {!isPending && !isError && rows && (
        <>
          <Card
            padding="lg"
            className={`border ${failing > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-green-500/30 bg-green-500/5'}`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`material-symbols-outlined ${failing > 0 ? 'text-red-400' : 'text-green-400'}`}
              >
                {failing > 0 ? 'gpp_bad' : 'verified_user'}
              </span>
              <p className={`text-sm font-semibold ${failing > 0 ? 'text-red-200' : 'text-green-200'}`}>
                {verificationSummary(rows)}
              </p>
            </div>
          </Card>

          {rows.length === 0 ? (
            <Card padding="lg">
              <p className="text-sm text-slate-400">
                No chained audit rows to verify yet. Once accounting activity is audited (and any
                legacy rows are backfilled from the overview), the per-row verification appears here.
              </p>
            </Card>
          ) : (
            <Card padding="none">
              <div className="divide-y divide-white/5">
                {rows.map((row) => (
                  <VerifyRow key={row.chainSeq} row={row} />
                ))}
              </div>
            </Card>
          )}

          <p className="text-xs text-slate-500">
            The first break is reported once — the chain continues from each stored hash, so a single
            altered row does not cascade into the rows after it. Canonical serialization and
            concurrency safety of the chain are on the human-verify list.
          </p>
        </>
      )}
    </SecurityScreen>
  );
}
