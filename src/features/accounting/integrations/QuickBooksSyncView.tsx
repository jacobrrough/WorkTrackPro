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

type LoopState = 'idle' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';

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
        <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-400">
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
            <tr key={phase.key} className="border-b border-white/5 text-slate-200">
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
              <td className="py-1.5 pl-2 text-xs text-slate-400">{state}</td>
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
      setErrors(await qboSyncService.listErrors(runId));
    } catch {
      setErrors([]);
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
    setRun(existing);
    const engine = new QboSyncEngine(existing.id);
    engineRef.current = engine;
    await loop(engine, existing.id);
  };

  const handleCancel = () => {
    stopRequested.current = true;
    setMessage('Stopping after the current page…');
  };

  // Surface a resumable run found on mount.
  const resumable = activeRunQuery.data ?? null;

  // Leaving the page mid-run leaves the run 'running' (resumable) — warn the user.
  useEffect(() => {
    if (loopState !== 'running' && loopState !== 'waiting') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [loopState]);

  const busy = loopState === 'running' || loopState === 'waiting';

  return (
    <AccountingShell active="integrations" title="QuickBooks Sync">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">cloud_sync</span>
            Sync from QuickBooks
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Pulls your QuickBooks Online company into WorkTrack — chart of accounts, products &
            services, customers, and vendors. Reading from QuickBooks never changes anything there;
            re-running is safe and updates rather than duplicates.
          </p>
        </div>

        {!statusQuery.isPending && !status.connected && (
          <Card padding="lg">
            <p className="text-sm text-slate-300">
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
              <div className="text-sm text-slate-300">
                Connected to{' '}
                <span className="font-semibold text-white">
                  {status.companyName ?? 'QuickBooks'}
                </span>
                {status.lastCdcCursor ? (
                  <span className="text-slate-400">
                    {' '}
                    · last synced {formatWhen(status.lastCdcCursor)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {busy ? (
                  <Button variant="danger" icon="stop_circle" onClick={handleCancel}>
                    Stop
                  </Button>
                ) : resumable ? (
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
                className={`rounded-sm border p-2 text-sm ${
                  loopState === 'failed'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : loopState === 'done'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-300'
                }`}
                role={loopState === 'failed' ? 'alert' : 'status'}
              >
                {message}
              </p>
            )}

            {run && <PhaseTable run={run} />}

            {run?.error && (
              <p className="text-sm text-red-300" role="alert">
                {run.error}
              </p>
            )}

            {errors.length > 0 && (
              <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="text-sm font-semibold text-amber-200">
                  {errors.length} record{errors.length === 1 ? '' : 's'} need attention
                </p>
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-amber-100/90">
                  {errors.map((e) => (
                    <li key={e.id} className="border-b border-white/5 py-1 last:border-0">
                      <span className="font-semibold">{e.entity}</span>
                      {e.qboId ? ` #${e.qboId}` : ''} — {e.message ?? 'failed'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {(runsQuery.data?.length ?? 0) > 0 && (
          <Card padding="lg">
            <h3 className="text-sm font-bold text-white">Recent runs</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-2 font-semibold">Started</th>
                  <th className="px-2 py-1.5 font-semibold">Mode</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Finished</th>
                </tr>
              </thead>
              <tbody>
                {(runsQuery.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-white/5 text-slate-300">
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

        <p className="text-xs text-slate-500">
          The sync reads from QuickBooks and writes only to WorkTrack. If a run is interrupted it
          can be resumed — every record carries its QuickBooks id, so nothing imports twice.
        </p>
      </div>
    </AccountingShell>
  );
}
