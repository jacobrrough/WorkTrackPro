import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { qboConnectionService, type QboStatus } from '@/services/api/accounting/qboConnection';
import { ACCOUNTING_BASE } from '../constants';
import { AccountingShell } from '../components/AccountingShell';

/**
 * QuickBooks Online connection — import Phase 0.
 *
 * Self-contained AccountingShell screen that drives the OAuth handshake against the
 * `qbo-oauth` Netlify function (via qboConnectionService). It never sees the Intuit
 * client secret or the stored tokens — the function holds those and only reports a
 * sanitized status here.
 *
 * Flow:
 *  - On mount it reads the connection status and, if the OAuth callback bounced the
 *    browser back here with `?qbo=connected|error`, shows a one-shot banner and strips
 *    the param from the URL so a refresh doesn't repeat it.
 *  - "Connect to QuickBooks" asks the function for a signed Intuit authorize URL and
 *    redirects there; Intuit later calls our /callback, which persists tokens and 302s
 *    back here.
 *  - "Test connection" calls companyinfo (refreshing the token server-side if needed)
 *    and shows the live company name.
 *  - "Disconnect" deletes the stored connection.
 *
 * This view talks to a Netlify function, NOT the accounting Postgres schema, so its
 * query lives here rather than in the shared accounting hooks (keeping the schema-seam
 * isolation intact). React Query (the module's data layer) caches the status.
 */

/** Outcome of a one-off action (connect/test/disconnect), shown as an inline banner. */
type Feedback = { kind: 'success' | 'error'; text: string };

/** Format an ISO timestamp as a human date, tolerating null/garbage. */
function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Connection status panel: connected (green) vs. not connected (neutral). */
function StatusCard({ status }: { status: QboStatus }) {
  const connected = status.connected;
  const since = formatDate(status.connectedAt);
  const lastSync = formatDate(status.lastSyncAt);

  return (
    <div
      className={`rounded-sm border p-3 ${
        connected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          : 'border-white/10 bg-white/5 text-slate-300'
      }`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-xl">{connected ? 'link' : 'link_off'}</span>
        <span className="text-sm font-semibold">
          {connected ? 'Connected to QuickBooks' : 'Not connected'}
        </span>
      </div>
      {connected ? (
        <p className="mt-1 text-sm">
          {status.companyName ? (
            <>
              Connected to <span className="font-semibold">{status.companyName}</span>
            </>
          ) : (
            'Connected'
          )}
          {since ? ` since ${since}` : ''}
          {lastSync ? ` · last checked ${lastSync}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-sm">
          Connect your QuickBooks Online company to begin syncing. We never store your QuickBooks
          password — the connection is authorized securely through Intuit.
        </p>
      )}
    </div>
  );
}

export default function QuickBooksConnectView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'test' | 'disconnect'>(null);

  const statusQuery = useQuery({
    queryKey: ['accounting', 'qbo', 'status'] as const,
    queryFn: () => qboConnectionService.getStatus(),
  });
  const status: QboStatus = statusQuery.data ?? { connected: false };

  // One-shot banner from the OAuth callback redirect (?qbo=connected|error), then strip
  // the param so a refresh doesn't re-show it. Runs once per distinct param value.
  const qbo = searchParams.get('qbo');
  useEffect(() => {
    if (qbo === 'connected') {
      setFeedback({ kind: 'success', text: 'QuickBooks connected successfully.' });
    } else if (qbo === 'error') {
      setFeedback({
        kind: 'error',
        text: 'QuickBooks could not be connected. Please try again.',
      });
    }
    if (qbo) {
      const next = new URLSearchParams(searchParams);
      next.delete('qbo');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbo]);

  const handleConnect = async () => {
    setFeedback(null);
    setBusy('connect');
    // On success this redirects away (no return); only a failure resolves here.
    const res = await qboConnectionService.startAuthorize();
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error ?? 'Could not start the connection.' });
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setFeedback(null);
    setBusy('test');
    const res = await qboConnectionService.testCompanyInfo();
    if (res.ok) {
      const name = res.data?.companyName;
      setFeedback({
        kind: 'success',
        text: name ? `Connection is working. Company: ${name}.` : 'Connection is working.',
      });
      // companyinfo updates company_name + last_sync_at server-side — refresh the banner.
      statusQuery.refetch();
    } else {
      setFeedback({ kind: 'error', text: res.error ?? 'The test call failed.' });
    }
    setBusy(null);
  };

  const handleDisconnect = async () => {
    setFeedback(null);
    setBusy('disconnect');
    const res = await qboConnectionService.disconnect();
    if (res.ok) {
      setFeedback({ kind: 'success', text: 'QuickBooks disconnected.' });
      statusQuery.refetch();
    } else {
      setFeedback({ kind: 'error', text: res.error ?? 'Could not disconnect.' });
    }
    setBusy(null);
  };

  return (
    <AccountingShell active="integrations" title="QuickBooks Connection">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">sync_alt</span>
            QuickBooks Online
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Securely link your QuickBooks Online company through Intuit. Once connected, you can
            verify the link and, later, sync your books. Authorization happens on Intuit&rsquo;s
            site — your QuickBooks credentials never touch this app.
          </p>
        </div>

        {feedback && (
          <p
            className={`rounded-sm border p-2 text-sm ${
              feedback.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.text}
          </p>
        )}

        {statusQuery.isPending ? (
          <p className="text-slate-400">Loading the QuickBooks connection…</p>
        ) : (
          <Card className="flex flex-col gap-4" padding="lg">
            <StatusCard status={status} />

            {statusQuery.isError && (
              <p className="text-sm text-amber-300" role="alert">
                Could not load the connection status. You can still try connecting below.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {status.connected ? (
                <>
                  <Link to={`${ACCOUNTING_BASE}/integrations/sync`}>
                    <Button icon="cloud_sync">Open data sync</Button>
                  </Link>
                  <Button
                    variant="secondary"
                    icon="wifi_tethering"
                    onClick={handleTest}
                    disabled={busy !== null}
                  >
                    {busy === 'test' ? 'Testing…' : 'Test connection'}
                  </Button>
                  <Button
                    variant="danger"
                    icon="link_off"
                    onClick={handleDisconnect}
                    disabled={busy !== null}
                  >
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </>
              ) : (
                <Button icon="link" onClick={handleConnect} disabled={busy !== null}>
                  {busy === 'connect' ? 'Connecting…' : 'Connect to QuickBooks'}
                </Button>
              )}
            </div>
          </Card>
        )}

        <p className="text-xs text-slate-500">
          You can disconnect at any time. Disconnecting removes the stored authorization; it does
          not delete anything already imported.
        </p>
      </div>
    </AccountingShell>
  );
}
