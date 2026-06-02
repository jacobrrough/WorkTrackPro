/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING — Overview.
 *     The whole module is FLAG-DARK and requires a SECURITY review before it is enabled; this
 *     screen carries the UnverifiedBanner (via SecurityScreen). It is READ-ONLY except for the ONE
 *     supervised, accounting_admin-only audit-chain backfill — and that posts NO journal entry and
 *     moves NO money.
 *
 * Three panels, each with its own loading / empty / error state:
 *   1. Encryption cutover progress — per-field plaintext-vs-ciphertext COUNTS (never values), the
 *      derived cutover %, and the honest note that the LIVE forms still write plaintext (G8: the
 *      ciphertext accessors are the post-sign-off cutover seam, not wired into edit forms).
 *   2. Audit hash-chain integrity — the SHA-256 chain badge, a link to the full per-seq detail, and
 *      the supervised one-time backfill of legacy (pre-E2) rows (re-running forks the chain, so it
 *      is a deliberate confirmed step — HUMAN-VERIFY).
 *   3. Rate-limit defaults — the READ-ONLY values the env-gated (default OFF) Netlify limiter uses
 *      once enabled.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  useAuditChainStatus,
  useEncryptionCoverage,
  useSecurityRateLimits,
} from '../hooks/useAccountingQueries';
import { useBackfillAuditChain } from '../hooks/useAccountingMutations';
import { securityAuditChainPath } from '../constants';
import {
  canBackfill,
  chainBadgeLabel,
  chainBadgeTone,
  chainSummary,
  coverageHeadline,
  coveragePercent,
  coverageStatusLabel,
  coverageTone,
  fieldLabel,
  rateLimitRows,
  toneBadgeClass,
  toneBarClass,
} from '../securityView';
import type { AuditChainStatus, EncryptionCoverageRow } from '../types';
import { SecurityError, SecurityScreen } from './SecurityScreen';

/** One per-field cutover row: label + counts + a thin progress bar + status badge. */
function CoverageRow({ row }: { row: EncryptionCoverageRow }) {
  const pct = coveragePercent(row);
  const tone = coverageTone(row);
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-white">{fieldLabel(row.field)}</span>
        <span
          className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${toneBadgeClass(tone)}`}
        >
          {coverageStatusLabel(row)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${toneBarClass(tone)}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 font-mono text-xs text-slate-400">
          {row.encryptedCount}/{row.plaintextCount} enc
        </span>
      </div>
    </div>
  );
}

/** Encryption cutover-progress panel (counts only — never values). */
function EncryptionPanel() {
  const { data: rows, isPending, isError, refetch } = useEncryptionCoverage();

  return (
    <section>
      <h3 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">enhanced_encryption</span>
        Field encryption cutover
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Per sensitive field, how many rows hold an encrypted (pgcrypto) shadow value versus a
        plaintext value. Counts only — no sensitive value is ever read here.
      </p>

      {isPending && <p className="mt-3 text-sm text-slate-400">Loading encryption coverage…</p>}

      {!isPending && isError && (
        <div className="mt-3">
          <SecurityError
            message="Could not load encryption coverage. Confirm the accounting schema is exposed and you have an accounting role."
            onRetry={() => refetch()}
          />
        </div>
      )}

      {!isPending && !isError && rows && (
        <Card className="mt-3 flex flex-col gap-3" padding="lg">
          <p className="text-sm text-slate-300">{coverageHeadline(rows)}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No sensitive fields are tracked yet.</p>
          ) : (
            <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
              {rows.map((row) => (
                <CoverageRow key={row.field} row={row} />
              ))}
            </div>
          )}
          <p className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
            <span className="font-bold">Cutover not started in live forms.</span> The vendor, bank,
            and employee edit forms still write plaintext. The encrypted accessors are the
            authorized backfill + verification path for the post-sign-off cutover — and wages remain
            shadow-only (the payroll engine still reads the plaintext rate). Retiring any plaintext
            column is a future migration AFTER the security review.
          </p>
        </Card>
      )}
    </section>
  );
}

/** The supervised one-time backfill confirm dialog (accounting_admin-only at the DB). */
function BackfillDialog({ status, onClose }: { status: AuditChainStatus; onClose: () => void }) {
  const backfill = useBackfillAuditChain();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    setError(null);
    const res = await backfill.mutateAsync();
    if (!res.ok) {
      setError(
        res.error ?? 'The backfill was rejected. Confirm you hold the accounting_admin role.'
      );
      return;
    }
    setDone(res.hashed);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backfill-title"
    >
      <div className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="backfill-title" className="text-lg font-bold text-white">
            Backfill the audit chain?
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

        {done == null ? (
          <>
            <p className="mb-3 text-sm text-slate-300">
              This hashes the {status.unchainedRows} legacy audit row
              {status.unchainedRows === 1 ? '' : 's'} that pre-date the hash chain, extending the
              chain from its current tail. It is a <span className="font-semibold">one-time</span>{' '}
              operation.
            </p>
            <p className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
              <span className="font-bold">Run this once, deliberately.</span> Re-running after any
              tampering would re-bless the altered rows. Only proceed if the legacy rows are
              trusted. Restricted to the <span className="font-semibold">accounting_admin</span>{' '}
              role.
            </p>
            {error && (
              <p className="mb-3 text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={backfill.isPending}>
                Cancel
              </Button>
              <Button variant="danger" onClick={run} disabled={backfill.isPending}>
                {backfill.isPending ? 'Hashing…' : 'Run backfill'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-green-300">
              Backfill complete. {done} legacy row{done === 1 ? '' : 's'} hashed into the chain.
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Audit hash-chain integrity panel. */
function AuditChainPanel() {
  const navigate = useNavigate();
  const { data: status, isPending, isError, refetch } = useAuditChainStatus();
  const [confirming, setConfirming] = useState(false);

  const tone = chainBadgeTone(status);

  return (
    <section>
      <h3 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">link</span>
        Tamper-evident audit log
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Each audit row carries a SHA-256 hash linking it to the previous one. A break means a row
        was altered, deleted, or reordered.
      </p>

      {isPending && <p className="mt-3 text-sm text-slate-400">Checking the hash chain…</p>}

      {!isPending && isError && (
        <div className="mt-3">
          <SecurityError
            message="Could not read the audit-chain status. Confirm the accounting schema is exposed and you have an accounting role."
            onRetry={() => refetch()}
          />
        </div>
      )}

      {!isPending && !isError && status && (
        <Card className="mt-3 flex flex-col gap-3" padding="lg">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${toneBadgeClass(tone)}`}
            >
              {chainBadgeLabel(status)}
            </span>
            <span className="text-xs text-slate-500">
              {status.chainedRows} chained · {status.unchainedRows} legacy
            </span>
          </div>
          <p className="text-sm text-slate-300">{chainSummary(status)}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon="fact_check"
              onClick={() => navigate(securityAuditChainPath())}
            >
              View full verification
            </Button>
            {canBackfill(status) && (
              <Button
                size="sm"
                variant="ghost"
                icon="playlist_add_check"
                onClick={() => setConfirming(true)}
              >
                Backfill legacy rows
              </Button>
            )}
          </div>
        </Card>
      )}

      {confirming && status && (
        <BackfillDialog status={status} onClose={() => setConfirming(false)} />
      )}
    </section>
  );
}

/** Read-only rate-limit defaults panel. */
function RateLimitPanel() {
  const { data: limits, isPending, isError, refetch } = useSecurityRateLimits();

  return (
    <section>
      <h3 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">speed</span>
        API rate limits
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        The per-route limits the serverless hardening uses. It is server-gated{' '}
        <span className="font-semibold">off</span> by default and inert until explicitly enabled —
        these are the values it would apply.
      </p>

      {isPending && <p className="mt-3 text-sm text-slate-400">Loading rate limits…</p>}

      {!isPending && isError && (
        <div className="mt-3">
          <SecurityError
            message="Could not load the rate-limit settings. Confirm the accounting schema is exposed and you have an accounting role."
            onRetry={() => refetch()}
          />
        </div>
      )}

      {!isPending && !isError && limits && (
        <Card className="mt-3" padding="none">
          <div className="divide-y divide-white/5">
            {rateLimitRows(limits).map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm text-slate-300">{r.label}</span>
                <span className="font-mono text-sm text-white">{r.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Note: the limiter is in-memory and per-warm-instance (best-effort). A distributed store is
        on the human-verify list before relying on it.
      </p>
    </section>
  );
}

export default function SecurityOverviewView() {
  return (
    <SecurityScreen
      tab="overview"
      title="Security overview"
      intro="Encryption cutover progress, tamper-evident audit-log integrity, and the API rate-limit posture for the accounting module. Read-only except the one supervised audit-chain backfill."
    >
      <EncryptionPanel />
      <div className="border-t border-white/10 pt-5">
        <AuditChainPanel />
      </div>
      <div className="border-t border-white/10 pt-5">
        <RateLimitPanel />
      </div>
    </SecurityScreen>
  );
}
