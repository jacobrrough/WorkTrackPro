import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { qboConnectionService, type QboStatus } from '@/services/api/accounting/qboConnection';
import { qboSyncService } from '@/services/api/accounting/qboSync';
import type { QboImportLogEntry, QboImportRun } from '../types';
import { ACCOUNTING_BASE } from '../constants';
import { AccountingShell } from '../components/AccountingShell';
import { QboSyncEngine, SYNC_PHASES, startSyncRun } from './sync/syncEngine';
import { countLegacyImportEntries } from './sync/syncCompletenessPhases';
import { runVerification, type VerificationResult } from './sync/qboVerification';

/**
 * QuickBooks Online data sync — the client-stepped runner UI.
 *
 * Drives QboSyncEngine one page at a time: every step processes one QBO query page,
 * persists the cursor + tallies to accounting.qbo_import_runs, then this view loops.
 * Closing the tab mid-run is safe — the run stays 'running' and the view offers
 * Resume, picking up from the stored cursor. The proxy function only ever READS from
 * QuickBooks; all writes land in our own accounting schema under the signed-in
 * accountant's RLS.
 */

type LoopState = 'idle' | 'running' | 'waiting' | 'gated' | 'done' | 'failed' | 'cancelled';

const money = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString(undefined, { style: 'currency', currency: 'USD' });

/**
 * Surface the real reason from any thrown shape. runVerification can reject with a Supabase
 * (PostgREST) error — a PLAIN OBJECT, not an Error instance — so `e instanceof Error` missed it
 * and the user only saw a generic "Verification failed." Pull message/details/hint/code instead.
 */
function verificationErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [o.message, o.details, o.hint].filter(
      (p): p is string => typeof p === 'string' && p.length > 0
    );
    if (parts.length) {
      return parts.join(' — ') + (typeof o.code === 'string' ? ` (${o.code})` : '');
    }
  }
  return 'Verification failed — open the browser console for details.';
}

/** The QBO-vs-WorkTrack delta report (the migration sign-off artifact). */
function VerificationCard({ disabled }: { disabled: boolean }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await runVerification());
    } catch (e) {
      console.error('QBO verification failed:', e);
      setError(verificationErrorMessage(e));
    }
    setRunning(false);
  };

  return (
    <Card className="flex flex-col gap-3" padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Verify against QuickBooks</h3>
          <p className="mt-0.5 text-xs text-muted">
            Compares QuickBooks&rsquo; own P&amp;L, balance sheet, and AR/AP aging against
            WorkTrack&rsquo;s reports, line by line. Every section must tie to the penny before
            cutover.
          </p>
        </div>
        <Button icon="rule" onClick={handleRun} disabled={disabled || running}>
          {running ? 'Comparing…' : 'Run verification'}
        </Button>
      </div>

      {error && (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2">
          <p
            className={`rounded-lg border p-2 text-sm font-semibold ${
              result.allTied
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            }`}
            role="status"
          >
            {result.allTied
              ? 'All sections tie to QuickBooks exactly.'
              : 'Differences found — chase each line below before signing off.'}
          </p>

          {result.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">
              {w}
            </p>
          ))}

          {result.sections.map((s) => (
            <div key={s.title} className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-white">{s.title}</span>
                <span className={s.tied ? 'text-emerald-300' : 'text-amber-300'}>
                  {s.tied
                    ? `Tied at ${money(s.qboTotal)}`
                    : `QBO ${money(s.qboTotal)} vs WorkTrack ${money(s.ourTotal)}`}
                </span>
              </div>
              {s.mismatches.length > 0 && (
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 pr-2 font-semibold">Line</th>
                      <th className="px-2 py-1 text-right font-semibold">QuickBooks</th>
                      <th className="px-2 py-1 text-right font-semibold">WorkTrack</th>
                      <th className="py-1 pl-2 text-right font-semibold">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.mismatches.map((m) => (
                      <tr
                        key={`${s.title}-${m.label}`}
                        className="border-t border-line/60 text-muted"
                      >
                        <td className="py-1 pr-2">{m.label}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(m.qboAmount)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(m.ourAmount)}</td>
                        <td className="py-1 pl-2 text-right tabular-nums text-amber-300">
                          {money(m.deltaCents / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Per-phase tallies table for the active/last run. */
function PhaseTable({ run }: { run: QboImportRun }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <th className="py-1.5 pr-2 font-semibold">Step</th>
          <th className="px-2 py-1.5 text-right font-semibold">Created</th>
          <th className="px-2 py-1.5 text-right font-semibold">Updated</th>
          <th className="px-2 py-1.5 text-right font-semibold">Skipped</th>
          <th className="px-2 py-1.5 text-right font-semibold">Failed</th>
          <th className="py-1.5 pl-2 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {SYNC_PHASES.map((phase) => {
          const tally = run.counts[phase.key];
          const progress = run.progress[phase.key];
          const state = progress?.done
            ? 'Done'
            : run.phase === phase.key && run.status === 'running'
              ? 'Syncing…'
              : tally
                ? 'In progress'
                : 'Pending';
          return (
            <tr key={phase.key} className="border-b border-line/60 text-white">
              <td className="py-1.5 pr-2">{phase.label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{tally?.created ?? '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{tally?.updated ?? '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{tally?.skipped ?? '—'}</td>
              <td
                className={`px-2 py-1.5 text-right tabular-nums ${
                  (tally?.failed ?? 0) > 0 ? 'font-semibold text-red-300' : ''
                }`}
              >
                {tally?.failed ?? '—'}
              </td>
              <td className="py-1.5 pl-2 text-xs text-muted">{state}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function QuickBooksSyncView() {
  const [run, setRun] = useState<QboImportRun | null>(null);
  const [loopState, setLoopState] = useState<LoopState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<QboImportLogEntry[]>([]);
  const [skips, setSkips] = useState<QboImportLogEntry[]>([]);
  const [gate, setGate] = useState<{ phaseKey: string; legacyCount: number | null } | null>(null);
  const engineRef = useRef<QboSyncEngine | null>(null);
  const stopRequested = useRef(false);

  const statusQuery = useQuery({
    queryKey: ['accounting', 'qbo', 'status'] as const,
    queryFn: () => qboConnectionService.getStatus(),
  });
  const status: QboStatus = statusQuery.data ?? { connected: false };

  const activeRunQuery = useQuery({
    queryKey: ['accounting', 'qbo', 'active-run'] as const,
    queryFn: () => qboSyncService.getActiveRun(),
    enabled: loopState === 'idle',
  });

  const runsQuery = useQuery({
    queryKey: ['accounting', 'qbo', 'runs'] as const,
    queryFn: () => qboSyncService.listRuns(8),
  });

  const loadErrors = useCallback(async (runId: string) => {
    try {
      const [errs, skipped] = await Promise.all([
        qboSyncService.listErrors(runId),
        qboSyncService.listSkips(runId),
      ]);
      setErrors(errs);
      setSkips(skipped);
    } catch {
      setErrors([]);
      setSkips([]);
    }
  }, []);

  /** The stepping loop. Runs until done/failed/cancelled; honors throttle waits. */
  const loop = useCallback(
    async (engine: QboSyncEngine, runId: string) => {
      setLoopState('running');
      for (;;) {
        if (stopRequested.current) {
          stopRequested.current = false;
          await qboSyncService.updateRun(runId, { status: 'cancelled', finished: true });
          const cancelled = await qboSyncService.getRun(runId);
          if (cancelled) setRun(cancelled);
          setLoopState('cancelled');
          setMessage('Sync cancelled. A new run can resume safely — nothing duplicates.');
          break;
        }

        const out = await engine.step();
        if (out.run) setRun(out.run);
        if (out.message) setMessage(out.message);

        if (out.state === 'continue') continue;
        if (out.state === 'wait') {
          setLoopState('waiting');
          setMessage(`QuickBooks rate limit — retrying in ${out.waitSeconds ?? 60}s…`);
          await new Promise((r) => setTimeout(r, (out.waitSeconds ?? 60) * 1000));
          setLoopState('running');
          continue;
        }
        if (out.state === 'gate') {
          // The reconcile step needs explicit approval — pause and show the gate card.
          setLoopState('gated');
          let legacyCount: number | null = null;
          try {
            legacyCount = await countLegacyImportEntries();
          } catch {
            legacyCount = null;
          }
          setGate({ phaseKey: out.gatePhaseKey ?? 'reconcile', legacyCount });
          setMessage(null);
          break;
        }
        if (out.state === 'done') {
          setLoopState('done');
          setMessage('Sync complete.');
        } else if (out.state === 'stopped') {
          setLoopState('cancelled');
        } else {
          setLoopState('failed');
        }
        if (out.run) await loadErrors(out.run.id);
        runsQuery.refetch();
        break;
      }
    },
    [loadErrors, runsQuery]
  );

  const handleStart = async (mode: 'full' | 'incremental') => {
    setMessage(null);
    setErrors([]);
    setSkips([]);
    const newRun = await startSyncRun(mode, status.lastCdcCursor ?? null);
    if (!newRun) {
      setMessage('Could not start a sync run.');
      setLoopState('failed');
      return;
    }
    setRun(newRun);
    const engine = new QboSyncEngine(newRun.id);
    engineRef.current = engine;
    await loop(engine, newRun.id);
  };

  const handleResume = async (existing: QboImportRun) => {
    setMessage(null);
    setErrors([]);
    setSkips([]);
    setRun(existing);
    const engine = new QboSyncEngine(existing.id);
    engineRef.current = engine;
    await loop(engine, existing.id);
  };

  const handleCancel = () => {
    stopRequested.current = true;
    setMessage('Stopping after the current page…');
  };

  /** Approve the gated reconcile step and continue the run. */
  const handleApproveGate = async () => {
    if (!run || !gate) return;
    const engine = engineRef.current ?? new QboSyncEngine(run.id);
    engineRef.current = engine;
    const updated = await engine.confirmGate(run, gate.phaseKey);
    if (updated) setRun(updated);
    setGate(null);
    await loop(engine, run.id);
  };

  /** Decline the gate: stop here (run stays resumable; books remain double-counted). */
  const handleDeclineGate = async () => {
    if (!run) return;
    setGate(null);
    await qboSyncService.updateRun(run.id, { status: 'cancelled', finished: true });
    const cancelled = await qboSyncService.getRun(run.id);
    if (cancelled) setRun(cancelled);
    setLoopState('cancelled');
    setMessage(
      'Stopped before retiring the legacy import. NOTE: until that step runs, the ledger counts both the old import and the new QuickBooks documents.'
    );
  };

  // Surface a resumable run found on mount.
  const resumable = activeRunQuery.data ?? null;

  // Leaving the page mid-run leaves the run 'running' (resumable) — warn the user.
  useEffect(() => {
    if (loopState !== 'running' && loopState !== 'waiting' && loopState !== 'gated') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [loopState]);

  return (
    <AccountingShell active="integrations" title="QuickBooks Sync">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">cloud_sync</span>
            Sync from QuickBooks
          </h2>
          <p className="mt-1 text-sm text-muted">
            Pulls your QuickBooks Online company into WorkTrack — chart of accounts, products &
            services, customers, and vendors. Reading from QuickBooks never changes anything there;
            re-running is safe and updates rather than duplicates.
          </p>
        </div>

        {!statusQuery.isPending && !status.connected && (
          <Card padding="lg">
            <p className="text-sm text-muted">
              QuickBooks is not connected yet. Set up the connection first on the{' '}
              <Link
                className="font-semibold text-primary underline-offset-2 hover:underline"
                to={`${ACCOUNTING_BASE}/integrations`}
              >
                QuickBooks Connection
              </Link>{' '}
              page.
            </p>
          </Card>
        )}

        {status.connected && (
          <Card className="flex flex-col gap-4" padding="lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted">
                Connected to{' '}
                <span className="font-semibold text-white">
                  {status.companyName ?? 'QuickBooks'}
                </span>
                {status.lastCdcCursor ? (
                  <span className="text-muted">
                    {' '}
                    · last synced {formatWhen(status.lastCdcCursor)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {loopState === 'running' || loopState === 'waiting' ? (
                  <Button variant="danger" icon="stop_circle" onClick={handleCancel}>
                    Stop
                  </Button>
                ) : loopState === 'gated' ? null : resumable ? (
                  <Button icon="resume" onClick={() => handleResume(resumable)}>
                    Resume interrupted sync
                  </Button>
                ) : (
                  <>
                    {status.lastCdcCursor && (
                      <Button
                        variant="secondary"
                        icon="update"
                        onClick={() => handleStart('incremental')}
                      >
                        Sync changes
                      </Button>
                    )}
                    <Button icon="cloud_sync" onClick={() => handleStart('full')}>
                      Full sync
                    </Button>
                  </>
                )}
              </div>
            </div>

            {message && (
              <p
                className={`rounded-lg border p-2 text-sm ${
                  loopState === 'failed'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : loopState === 'done'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-line bg-overlay/5 text-muted'
                }`}
                role={loopState === 'failed' ? 'alert' : 'status'}
              >
                {message}
              </p>
            )}

            {loopState === 'gated' && gate && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-200">
                  <span className="material-symbols-outlined text-lg">warning</span>
                  Approve the final step: retire the legacy GL import
                </p>
                <p className="mt-1 text-sm text-amber-100/90">
                  Every QuickBooks transaction has now been re-posted from the live company as
                  documents and journal entries. The original CSV-imported ledger
                  {gate.legacyCount != null ? (
                    <>
                      {' '}
                      (<span className="font-semibold">
                        {gate.legacyCount.toLocaleString()}
                      </span>{' '}
                      posted entries)
                    </>
                  ) : null}{' '}
                  must be voided so the books don&rsquo;t double-count. Voiding keeps every entry
                  (marked void, fully auditable) — nothing is deleted.
                </p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={handleDeclineGate}>
                    Not now
                  </Button>
                  <Button icon="task_alt" onClick={handleApproveGate}>
                    Void legacy entries & finish
                  </Button>
                </div>
              </div>
            )}

            {run && <PhaseTable run={run} />}

            {run?.error && (
              <p className="text-sm text-red-300" role="alert">
                {run.error}
              </p>
            )}

            {errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="text-sm font-semibold text-amber-200">
                  {errors.length} record{errors.length === 1 ? '' : 's'} need attention
                </p>
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-amber-100/90">
                  {errors.map((e) => (
                    <li key={e.id} className="border-b border-line/60 py-1 last:border-0">
                      <span className="font-semibold">{e.entity}</span>
                      {e.qboId ? ` #${e.qboId}` : ''} — {e.message ?? 'failed'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {skips.length > 0 && (
              <details className="rounded-2xl border border-line bg-overlay/5 p-2">
                <summary className="cursor-pointer text-sm font-semibold text-muted">
                  {skips.length} record{skips.length === 1 ? '' : 's'} skipped — no effect on your
                  books
                </summary>
                <p className="mt-1 text-xs text-muted">
                  Voided or $0 transactions QuickBooks keeps for its audit trail. They post nothing,
                  so skipping them does not change the ledger.
                </p>
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-muted">
                  {skips.map((e) => (
                    <li key={e.id} className="border-b border-line/60 py-1 last:border-0">
                      <span className="font-semibold">{e.entity}</span>
                      {e.qboId ? ` #${e.qboId}` : ''} — {e.message ?? 'skipped'}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        )}

        {status.connected && (
          <VerificationCard
            disabled={loopState === 'running' || loopState === 'waiting' || loopState === 'gated'}
          />
        )}

        {(runsQuery.data?.length ?? 0) > 0 && (
          <Card padding="lg">
            <h3 className="text-sm font-bold text-white">Recent runs</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1.5 pr-2 font-semibold">Started</th>
                  <th className="px-2 py-1.5 font-semibold">Mode</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Finished</th>
                </tr>
              </thead>
              <tbody>
                {(runsQuery.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-line/60 text-muted">
                    <td className="py-1.5 pr-2">{formatWhen(r.startedAt)}</td>
                    <td className="px-2 py-1.5 capitalize">{r.mode}</td>
                    <td
                      className={`px-2 py-1.5 capitalize ${
                        r.status === 'completed'
                          ? 'text-emerald-300'
                          : r.status === 'failed'
                            ? 'text-red-300'
                            : ''
                      }`}
                    >
                      {r.status}
                    </td>
                    <td className="py-1.5 pl-2 text-right">{formatWhen(r.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <p className="text-xs text-subtle">
          The sync reads from QuickBooks and writes only to WorkTrack. If a run is interrupted it
          can be resumed — every record carries its QuickBooks id, so nothing imports twice.
        </p>
      </div>
    </AccountingShell>
  );
}
