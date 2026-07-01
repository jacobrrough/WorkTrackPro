import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  usePlaidLink,
  type PlaidLinkOnSuccess,
  type PlaidLinkOnExit,
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata,
} from 'react-plaid-link';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { AccountPicker } from '../components/AccountPicker';
import { useBankAccounts, usePlaidItems } from '../hooks/useAccountingQueries';
import {
  useCreateBankAccount,
  useUpdateBankAccount,
  useExchangePlaidToken,
  useSyncPlaid,
  useDisconnectPlaid,
} from '../hooks/useAccountingMutations';
import {
  plaidService,
  type ExchangePublicTokenResult,
  type PlaidItemStatus,
  type PlaidItemStatus_State,
  type PlaidLinkedAccount,
  type PlaidSyncResult,
} from '@/services/api/accounting/plaid';
import type { BankAccount } from '../types';

/**
 * Plaid bank feeds — admin-only UI (Phase 0).
 *
 * Three things on one screen:
 *  1. "Connect a bank" → mints a Link token (plaidService.getLinkToken), opens Plaid Link
 *     (react-plaid-link), and on success exchanges the public_token server-side
 *     (useExchangePlaidToken — the access_token is stored ENCRYPTED and never reaches here).
 *  2. An account-MAPPING step on the exchange result: each returned Plaid account is either
 *     wired to an EXISTING bank account or used to CREATE a new one (writing plaid_item_id +
 *     plaid_account_id via bankAccountsService). Only mapped accounts sync.
 *  3. The connected-institutions list (usePlaidItems) with per-item Sync / Reconnect (Link in
 *     update mode) / Disconnect, plus a top-level "Sync all now". Sync result counts and any
 *     per-item errors render inline.
 *
 * SECURITY: this view only ever holds short-lived Link/public tokens (forwarded to the
 * functions) and non-secret status fields. It NEVER sees a Plaid access_token. All Plaid
 * imports live under the accounting feature tree so react-plaid-link stays code-split out of
 * the flag-off bundle (the whole module is lazy via AccountingRouter).
 *
 * NOTE: this is dedicated to the live bank FEED (auto-sync). The existing Banking screen
 * (manual CSV/OFX import, rules, reconcile) is unchanged.
 */

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none disabled:opacity-50';

/**
 * Plaid OAuth redirect support (ADDITIVE — only engages when an OAuth bank redirects back).
 *
 * OAuth-required institutions (e.g. Chase) take over the browser tab and, once the user
 * authenticates, redirect to our registered PLAID_REDIRECT_URI (this Bank Feeds page) with an
 * `?oauth_state_id=...` query param. react-plaid-link must then be RE-initialized with the SAME
 * link_token plus `receivedRedirectUri` to finish. Since the page reloaded, the link token can't
 * survive in memory — we stash it in localStorage right before opening Link and read it back on
 * the OAuth return. Non-OAuth banks never leave the page, so none of this runs for them.
 */
const PLAID_LINK_TOKEN_STORAGE_KEY = 'plaid:linkToken';

/** True when the current URL is a Plaid OAuth return (carries `oauth_state_id`). SSR-safe. */
function isOAuthReturn(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('oauth_state_id');
}

/** Read the link token persisted before an OAuth redirect, or null. SSR-safe / storage-safe. */
function readSavedLinkToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PLAID_LINK_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the link token so it survives the OAuth redirect back to this page. SSR/storage-safe. */
function saveLinkToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLAID_LINK_TOKEN_STORAGE_KEY, token);
  } catch {
    /* localStorage may be unavailable (private mode/quota) — the in-memory open still works for
       non-OAuth banks; only the OAuth resume degrades, which we can't help without storage. */
  }
}

/** Drop the persisted link token once the OAuth flow ends. SSR/storage-safe. */
function clearSavedLinkToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PLAID_LINK_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Strip Plaid's OAuth query params from the address bar (without reloading) so a manual refresh
 * can't re-trigger a stale resume. We only remove the Plaid-owned keys, preserving any others.
 */
function stripOAuthParamsFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('oauth_state_id');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore — leaving the params is harmless beyond a possible stale-resume on manual refresh */
  }
}

/** Format an ISO timestamp as a short, human date-time; tolerates null/garbage. */
function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Status-badge presentation per connection lifecycle state. */
const STATUS_BADGE: Record<
  PlaidItemStatus_State,
  { label: string; className: string; icon: string }
> = {
  active: {
    label: 'Active',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    icon: 'check_circle',
  },
  login_required: {
    label: 'Login required',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    icon: 'lock',
  },
  error: {
    label: 'Error',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
    icon: 'error',
  },
  disconnected: {
    label: 'Disconnected',
    className: 'border-line bg-white/5 text-muted',
    icon: 'link_off',
  },
};

function StatusBadge({ status }: { status: PlaidItemStatus_State }) {
  const b = STATUS_BADGE[status] ?? STATUS_BADGE.error;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${b.className}`}
    >
      <span className="material-symbols-outlined text-sm">{b.icon}</span>
      {b.label}
    </span>
  );
}

/**
 * Mounts react-plaid-link's hook with a ready link token and auto-opens it. The hook needs a
 * non-null token at call time and re-creates Link when the token changes, so this lives in its
 * own component that is only rendered once a token has been minted — that keeps the open()
 * deterministic and tears Link down cleanly when the flow ends (parent drops `token`).
 *
 * `onSuccess` forwards Plaid's public_token up; `onDone` fires on exit/finish so the parent can
 * clear the token and stop rendering this. The launcher renders nothing itself.
 *
 * OAuth resume: `receivedRedirectUri` is the standard react-plaid-link mechanism for FINISHING an
 * OAuth Link after the bank redirected the browser back to us (?oauth_state_id=...). When present,
 * the SAME link_token is re-used with the current URL so Link picks up where it left off. It is
 * left undefined on a normal connect/reconnect — passing it then would break the initial flow.
 */
function PlaidLinkLauncher({
  token,
  onSuccess,
  onDone,
  receivedRedirectUri,
}: {
  token: string;
  onSuccess: (publicToken: string) => void;
  onDone: (error?: PlaidLinkError | null, metadata?: PlaidLinkOnExitMetadata) => void;
  receivedRedirectUri?: string;
}) {
  const handleSuccess = useMemo<PlaidLinkOnSuccess>(
    () => (publicToken) => {
      onSuccess(publicToken);
    },
    [onSuccess]
  );
  // Forward Plaid's exit reason up. Link calls onExit on a clean user-cancel (error === null)
  // AND on a real failure (e.g. an OAuth handoff that authenticated at the bank but never made
  // it back to the SDK) — the parent decides what to surface so a failed connect is never
  // silent. THIS is the case the user hits: "the code works but then it just goes away."
  const handleExit = useMemo<PlaidLinkOnExit>(
    () => (error, metadata) => {
      onDone(error, metadata);
    },
    [onDone]
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: handleSuccess,
    onExit: handleExit,
    // Only set on an OAuth return; undefined for a normal open (Plaid requires it absent then).
    receivedRedirectUri,
  });

  // Open as soon as Link is ready for this token. The parent only renders the launcher once it
  // has a fresh token, so this opens exactly one Link session per connect/reconnect click.
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}

/** What the admin chose to do with one returned Plaid account. */
type MappingKind = 'create' | 'existing' | 'skip';

interface MappingRowState {
  kind: MappingKind;
  /** Target bank account id when kind === 'existing'. */
  existingBankAccountId: string;
  /** Editable name when creating; prefilled from the Plaid account name. */
  newName: string;
  /** GL cash/credit-card account to link when creating (required — bank_accounts.account_id
   *  is a real uuid FK, mirroring the manual "New Bank Account" form). */
  newAccountId: string;
  status: 'idle' | 'saving' | 'done' | 'error';
  error: string | null;
}

/**
 * The account-mapping step shown after a successful exchange. For each returned Plaid account
 * the admin maps to an existing bank account, creates a new one (name prefilled), or skips.
 * "Save mappings" persists each choice by writing plaid_item_id + plaid_account_id onto the
 * chosen/created bank_account (only mapped accounts will sync).
 */
function MappingStep({
  result,
  onClose,
}: {
  result: ExchangePublicTokenResult;
  onClose: () => void;
}) {
  const { data: bankAccounts = [] } = useBankAccounts();
  // The exchange returns Plaid's item_id STRING; bank_accounts.plaid_item_id references the
  // accounting.plaid_items ROW PK (uuid). Resolve that PK from the connections list (the
  // exchange mutation invalidates it, so the just-connected Item is present). Until it loads
  // we hold off saving rather than writing a wrong id.
  const itemsQuery = usePlaidItems();
  const itemPk = (itemsQuery.data ?? []).find((i) => i.itemId === result.itemId)?.id ?? null;
  const createBankAccount = useCreateBankAccount();
  const updateBankAccount = useUpdateBankAccount();

  // Default each row to "create" (the common case for a first connect), prefilling the name.
  const [rows, setRows] = useState<Record<string, MappingRowState>>(() => {
    const init: Record<string, MappingRowState> = {};
    for (const acct of result.accounts) {
      init[acct.plaidAccountId] = {
        kind: 'create',
        existingBankAccountId: '',
        newName: acct.name?.trim() || result.institutionName || 'Bank account',
        newAccountId: '',
        status: 'idle',
        error: null,
      };
    }
    return init;
  });
  const [savingAll, setSavingAll] = useState(false);
  const [allDone, setAllDone] = useState(false);

  // Bank accounts already wired to THIS item (so re-mapping shows their current link).
  const linkedAccountIds = useMemo(() => {
    const map: Record<string, BankAccount> = {};
    if (!itemPk) return map;
    for (const ba of bankAccounts) {
      if (ba.plaidItemId === itemPk && ba.plaidAccountId) {
        map[ba.plaidAccountId] = ba;
      }
    }
    return map;
  }, [bankAccounts, itemPk]);

  const setRow = (plaidAccountId: string, patch: Partial<MappingRowState>) =>
    setRows((prev) => ({ ...prev, [plaidAccountId]: { ...prev[plaidAccountId], ...patch } }));

  /** Persist one mapping: create-or-update a bank account with the Plaid link columns. */
  const saveOne = async (acct: PlaidLinkedAccount): Promise<boolean> => {
    const row = rows[acct.plaidAccountId];
    if (!row || row.kind === 'skip') return true; // nothing to persist

    if (!itemPk) {
      setRow(acct.plaidAccountId, {
        status: 'error',
        error: 'Still loading the connection. Try again in a moment.',
      });
      return false;
    }

    const link = {
      plaidItemId: itemPk,
      plaidAccountId: acct.plaidAccountId,
      plaidMask: acct.mask,
      plaidSubtype: acct.subtype,
    };

    try {
      if (row.kind === 'existing') {
        if (!row.existingBankAccountId) {
          setRow(acct.plaidAccountId, { status: 'error', error: 'Choose a bank account.' });
          return false;
        }
        setRow(acct.plaidAccountId, { status: 'saving', error: null });
        const updated = await updateBankAccount.mutateAsync({
          id: row.existingBankAccountId,
          input: link,
        });
        if (!updated) throw new Error('Could not link the bank account.');
      } else {
        // Create a NEW bank account from the Plaid account. A GL cash/credit-card account is
        // required (bank_accounts.account_id is a real uuid FK) — same as the manual form.
        if (!row.newAccountId) {
          setRow(acct.plaidAccountId, {
            status: 'error',
            error: 'Pick a general-ledger account to link.',
          });
          return false;
        }
        setRow(acct.plaidAccountId, { status: 'saving', error: null });
        const created = await createBankAccount.mutateAsync({
          name: row.newName.trim() || acct.name?.trim() || 'Bank account',
          accountId: row.newAccountId,
          accountType: null,
          institution: result.institutionName,
          mask: acct.mask,
          ...link,
        });
        if (!created) throw new Error('Could not create the bank account.');
      }
      setRow(acct.plaidAccountId, { status: 'done', error: null });
      return true;
    } catch (e) {
      setRow(acct.plaidAccountId, {
        status: 'error',
        error: e instanceof Error ? e.message : 'Could not save this mapping.',
      });
      return false;
    }
  };

  const saveAll = async () => {
    setSavingAll(true);
    let ok = true;
    // Sequential so each row's status updates legibly and a NewBankAccount insert can't race.
    for (const acct of result.accounts) {
      const rowOk = await saveOne(acct);
      ok = ok && rowOk;
    }
    setSavingAll(false);
    if (ok) setAllDone(true);
  };

  const mappedCount = result.accounts.filter((a) => rows[a.plaidAccountId]?.kind !== 'skip').length;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">account_tree</span>
            Map {result.institutionName ?? 'the connected institution'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Choose where each account&rsquo;s transactions land. Map to an existing bank account or
            create a new one — only mapped accounts will sync. You can finish mapping later from the
            connection below.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close mapping"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {result.accounts.length === 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Plaid returned no accounts for this institution. You can close this and try reconnecting.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {result.accounts.map((acct) => {
            const row = rows[acct.plaidAccountId];
            const alreadyLinked = linkedAccountIds[acct.plaidAccountId];
            const subtitle = [acct.subtype || acct.type, acct.mask ? `••${acct.mask}` : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={acct.plaidAccountId}
                className="rounded-2xl border border-line bg-card-dark p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">
                      {acct.name || 'Account'}
                      {subtitle && (
                        <span className="ml-2 text-xs font-normal text-subtle">{subtitle}</span>
                      )}
                    </p>
                    {alreadyLinked && (
                      <p className="text-xs text-emerald-300">
                        Currently linked to {alreadyLinked.name}
                      </p>
                    )}
                  </div>
                  {row?.status === 'done' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                      <span className="material-symbols-outlined text-sm">task_alt</span>
                      Saved
                    </span>
                  )}
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <FormField label="Action" htmlFor={`map-action-${acct.plaidAccountId}`}>
                    <select
                      id={`map-action-${acct.plaidAccountId}`}
                      className={inputClass}
                      disabled={savingAll || allDone}
                      value={row?.kind ?? 'create'}
                      onChange={(e) =>
                        setRow(acct.plaidAccountId, {
                          kind: e.target.value as MappingKind,
                          status: 'idle',
                          error: null,
                        })
                      }
                    >
                      <option value="create">Create new bank account</option>
                      <option value="existing">Map to existing</option>
                      <option value="skip">Skip (don&rsquo;t sync)</option>
                    </select>
                  </FormField>

                  {row?.kind === 'existing' && (
                    <FormField label="Bank account" htmlFor={`map-target-${acct.plaidAccountId}`}>
                      <select
                        id={`map-target-${acct.plaidAccountId}`}
                        className={inputClass}
                        disabled={savingAll || allDone}
                        value={row.existingBankAccountId}
                        onChange={(e) =>
                          setRow(acct.plaidAccountId, {
                            existingBankAccountId: e.target.value,
                            status: 'idle',
                            error: null,
                          })
                        }
                      >
                        <option value="">Choose…</option>
                        {bankAccounts.map((ba) => (
                          <option key={ba.id} value={ba.id}>
                            {ba.name}
                            {ba.mask ? ` (${ba.mask})` : ''}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}

                  {row?.kind === 'create' && (
                    <>
                      <FormField
                        label="New account name"
                        htmlFor={`map-name-${acct.plaidAccountId}`}
                      >
                        <input
                          id={`map-name-${acct.plaidAccountId}`}
                          className={inputClass}
                          disabled={savingAll || allDone}
                          value={row.newName}
                          onChange={(e) =>
                            setRow(acct.plaidAccountId, { newName: e.target.value, error: null })
                          }
                          placeholder="e.g. Operating Checking"
                        />
                      </FormField>
                      <FormField
                        label="General-ledger account"
                        htmlFor={`map-gl-${acct.plaidAccountId}`}
                        hint="The cash / credit-card account this feed posts to."
                        className="sm:col-span-2"
                      >
                        <AccountPicker
                          id={`map-gl-${acct.plaidAccountId}`}
                          ariaLabel="General-ledger account"
                          value={row.newAccountId}
                          onChange={(accountId) =>
                            setRow(acct.plaidAccountId, { newAccountId: accountId, error: null })
                          }
                        />
                      </FormField>
                    </>
                  )}
                </div>

                {row?.error && (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {row.error}
                  </p>
                )}
              </div>
            );
          })}

          {allDone ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-sm text-emerald-200">
                Mappings saved. Run a sync below to pull in transactions — they&rsquo;ll arrive as
                unreviewed and can be categorized with your Bank Rules.
              </p>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-subtle">
                {itemPk
                  ? `${mappedCount} of ${result.accounts.length} account${
                      result.accounts.length === 1 ? '' : 's'
                    } will sync.`
                  : 'Loading the connection…'}
              </span>
              <Button variant="ghost" onClick={onClose} disabled={savingAll}>
                Cancel
              </Button>
              <Button icon="save" onClick={saveAll} disabled={savingAll || !itemPk}>
                {savingAll ? 'Saving…' : 'Save mappings'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One row in the connected-institutions list, with its per-item actions. */
function ConnectionRow({
  item,
  onReconnect,
  onSync,
  onDisconnect,
  syncing,
  disconnecting,
  reconnecting,
}: {
  item: PlaidItemStatus;
  onReconnect: (plaidItemId: string) => void;
  onSync: (rowPk: string) => void;
  onDisconnect: (item: PlaidItemStatus) => void;
  syncing: boolean;
  disconnecting: boolean;
  reconnecting: boolean;
}) {
  const lastSync = formatDateTime(item.lastSyncAt);
  const connected = formatDateTime(item.connectedAt);
  const isDisconnected = item.status === 'disconnected';
  const busy = syncing || disconnecting || reconnecting;

  return (
    <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <span className="material-symbols-outlined text-lg">account_balance</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-white">
            {item.institutionName || 'Connected institution'}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <p className="text-xs text-subtle">
          {lastSync ? `Last synced ${lastSync}` : 'Not synced yet'}
          {connected ? ` · connected ${connected}` : ''}
        </p>
        {item.lastError && item.status !== 'active' && (
          <p className="mt-0.5 text-xs text-red-400" role="alert">
            {item.lastError}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {item.status === 'login_required' && (
          <Button
            size="sm"
            variant="secondary"
            icon="autorenew"
            onClick={() => onReconnect(item.itemId)}
            disabled={busy}
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        )}
        {!isDisconnected && (
          <Button
            size="sm"
            variant="secondary"
            icon="sync"
            onClick={() => onSync(item.id)}
            disabled={busy}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        {!isDisconnected && (
          <Button
            size="sm"
            variant="ghost"
            icon="link_off"
            onClick={() => onDisconnect(item)}
            disabled={busy}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Inline panel summarizing a sync run's counts plus any per-item errors. */
function SyncResultPanel({ result }: { result: PlaidSyncResult }) {
  const hasErrors = !!result.errors && result.errors.length > 0;
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        hasErrors
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      }`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-lg">
          {hasErrors ? 'sync_problem' : 'task_alt'}
        </span>
        <span className="font-semibold">
          Synced {result.synced} connection{result.synced === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-1">
        <span className="font-mono font-bold">{result.added}</span> added ·{' '}
        <span className="font-mono font-bold">{result.modified}</span> modified ·{' '}
        <span className="font-mono font-bold">{result.removed}</span> removed. New transactions are
        unreviewed — categorize them with your Bank Rules.
      </p>
      {hasErrors && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
          {result.errors!.map((e) => (
            <li key={e.itemId}>{e.error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BankFeedsView() {
  const itemsQuery = usePlaidItems();
  const items = itemsQuery.data ?? [];

  const exchange = useExchangePlaidToken();
  const sync = useSyncPlaid();
  const disconnect = useDisconnectPlaid();

  // The live Link token (initial connect OR update-mode reconnect). When set, the launcher
  // mounts and auto-opens. `linkBusy` covers the async token mint before Link appears.
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  // Which item is being reconnected (drives that row's spinner). null = initial connect.
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);

  // OAuth RESUME: when the page loads as a Plaid OAuth return (?oauth_state_id) AND we still have
  // the link token we stashed before redirecting, we re-mount Link in resume mode (same token +
  // receivedRedirectUri) WITHOUT a second "Connect" click. Computed once from the initial URL so a
  // later replaceState (our cleanup) can't flip it mid-flow. `oauthResumeToken` non-null = resume.
  const [oauthResumeToken, setOauthResumeToken] = useState<string | null>(() =>
    isOAuthReturn() ? readSavedLinkToken() : null
  );

  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ExchangePublicTokenResult | null>(null);
  const [syncResult, setSyncResult] = useState<PlaidSyncResult | null>(null);

  // Per-item action spinners (keyed by the row PK / Plaid item id as appropriate).
  const [syncingPk, setSyncingPk] = useState<string | null>(null);
  const [disconnectingItemId, setDisconnectingItemId] = useState<string | null>(null);

  // OAuth return, but the link token we stashed before redirecting is GONE. Plaid sent the
  // browser back (?oauth_state_id present) yet localStorage has no token to resume with —
  // which means we came back to a DIFFERENT origin than the one that opened Link (the
  // PLAID_REDIRECT_URI domain doesn't match the address you actually use — www vs non-www, a
  // *.netlify.app vs the custom domain, http vs https), or storage was cleared. Without the
  // token Link can't resume and the connection dies silently — THIS is "it just goes away and
  // nothing happens." Surface it with a pointed message instead of rendering nothing.
  useEffect(() => {
    if (isOAuthReturn() && !readSavedLinkToken()) {
      setError(
        'Your bank sent you back, but this page couldn’t finish the connection. This almost ' +
          'always means the app’s web address doesn’t EXACTLY match the Plaid redirect URL ' +
          '(check www vs non-www, the domain, and https). Open the app at the same address that ' +
          'matches your Plaid redirect URL, then connect again.'
      );
      stripOAuthParamsFromUrl();
    }
    // Mount-only: evaluate the URL we landed on. Safe to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mint a Link token and mount the launcher. `itemId` (Plaid item_id) → update mode. */
  const startLink = async (plaidItemId?: string) => {
    setError(null);
    setSyncResult(null);
    setLinkBusy(true);
    setReconnectingItemId(plaidItemId ?? null);
    try {
      const { linkToken: token } = await plaidService.getLinkToken(plaidItemId);
      // Persist BEFORE opening so an OAuth bank that redirects the browser away can find the same
      // token to resume with on return. Harmless (and cleared on done) for non-OAuth banks.
      saveLinkToken(token);
      setLinkToken(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the bank connection.');
      setReconnectingItemId(null);
    } finally {
      setLinkBusy(false);
    }
  };

  /** Plaid Link finished (success or exit) — tear down the launcher either way. Stable so the
   *  launcher's usePlaidLink instance isn't re-created on every parent render. Also clears the
   *  OAuth resume state + persisted token and strips ?oauth_state_id so a refresh can't re-trigger
   *  a stale resume (no-op for the non-OAuth path beyond removing the just-saved token). */
  const endLink = useCallback(
    (error?: PlaidLinkError | null, metadata?: PlaidLinkOnExitMetadata) => {
      setLinkToken(null);
      setReconnectingItemId(null);
      setOauthResumeToken(null);
      clearSavedLinkToken();
      stripOAuthParamsFromUrl();
      // Plaid passes a non-null error when Link FAILED (vs. a clean user-cancel, where error is
      // null). Surface it so an OAuth / redirect failure that "just goes away" shows a real
      // reason instead of nothing. error_code is the key diagnostic (e.g. INVALID_LINK_TOKEN,
      // or an OAuth/redirect-uri mismatch that finishes at the bank but can't return here).
      if (error) {
        const inst = metadata?.institution?.name;
        const code = error.error_code ? ` [${error.error_code}]` : '';
        setError(
          (error.display_message || error.error_message || 'The bank connection didn’t finish.') +
            (inst ? ` (${inst})` : '') +
            code
        );
      }
    },
    []
  );

  const handleLinkSuccess = useCallback(
    async (publicToken: string) => {
      // Stop rendering Link immediately; the exchange owns the next step.
      setLinkToken(null);
      setReconnectingItemId(null);
      // OAuth cleanup: drop the resume state + persisted token and strip ?oauth_state_id so a
      // refresh can't replay a completed OAuth flow. Identical effect on the non-OAuth path.
      setOauthResumeToken(null);
      clearSavedLinkToken();
      stripOAuthParamsFromUrl();
      setError(null);
      try {
        const result = await exchange.mutateAsync(publicToken);
        // Always show the mapping step so the admin can (re)wire accounts; a reconnect of an
        // already-mapped item simply shows its current links.
        setMapping(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not finish connecting the bank.');
      }
    },
    [exchange]
  );

  const runSync = async (rowPk?: string) => {
    setError(null);
    setSyncResult(null);
    if (rowPk) setSyncingPk(rowPk);
    try {
      const result = await sync.mutateAsync(rowPk);
      setSyncResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncingPk(null);
    }
  };

  const handleDisconnect = async (item: PlaidItemStatus) => {
    const name = item.institutionName || 'this institution';
    if (!window.confirm(`Disconnect ${name}? This stops syncing and unlinks its bank accounts.`)) {
      return;
    }
    setError(null);
    setDisconnectingItemId(item.itemId);
    try {
      const res = await disconnect.mutateAsync(item.itemId);
      if (!res.ok) throw new Error('Could not disconnect this institution.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect this institution.');
    } finally {
      setDisconnectingItemId(null);
    }
  };

  const activeCount = items.filter((i) => i.status !== 'disconnected').length;
  const connectBusy = linkBusy || exchange.isPending;

  return (
    <AccountingShell
      active="bank-feeds"
      title="Bank feeds"
      actions={
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon="sync"
              onClick={() => runSync()}
              disabled={sync.isPending}
            >
              {sync.isPending && !syncingPk ? 'Syncing…' : 'Sync all now'}
            </Button>
          )}
          <Button size="sm" icon="add_link" onClick={() => startLink()} disabled={connectBusy}>
            {connectBusy && reconnectingItemId === null ? 'Connecting…' : 'Connect a bank'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm text-muted">
          Securely connect your bank or credit-card accounts through Plaid to pull transactions in
          automatically. Your bank credentials are entered on Plaid&rsquo;s secure screen and never
          touch this app. Synced transactions arrive as{' '}
          <span className="font-semibold text-muted">unreviewed</span> and are categorized with your
          existing <span className="font-semibold text-muted">Bank Rules / review flow</span> before
          they post.
        </p>

        {error && (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}

        {syncResult && <SyncResultPanel result={syncResult} />}

        {mapping && <MappingStep result={mapping} onClose={() => setMapping(null)} />}

        {/* Connections list */}
        {itemsQuery.isPending ? (
          <p className="text-muted">Loading connected banks…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">account_balance</span>
            <p className="text-lg font-bold text-white">No banks connected</p>
            <p className="max-w-sm text-sm text-muted">
              Connect a bank to start pulling transactions automatically. Prefer to upload a
              statement instead? Use manual import from the Banking screen.
            </p>
            <Button size="sm" icon="add_link" onClick={() => startLink()} disabled={connectBusy}>
              {connectBusy ? 'Connecting…' : 'Connect a bank'}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
            {items.map((item) => (
              <ConnectionRow
                key={item.id}
                item={item}
                onReconnect={(plaidItemId) => void startLink(plaidItemId)}
                onSync={(rowPk) => void runSync(rowPk)}
                onDisconnect={(it) => void handleDisconnect(it)}
                syncing={syncingPk === item.id}
                disconnecting={disconnectingItemId === item.itemId}
                reconnecting={reconnectingItemId === item.itemId}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-subtle">
          Disconnecting removes the stored authorization and unlinks the bank accounts it fed; it
          does not delete anything already imported. You can reconnect a bank at any time.
        </p>
      </div>

      {/* Plaid Link is mounted only while a token is live; it auto-opens, then clears. The
          callbacks are useCallback-stable so the launcher doesn't re-create Link each render.
          OAuth RESUME takes precedence: when we returned from an OAuth bank with a saved token, we
          re-mount Link with that SAME token + receivedRedirectUri (the current URL, carrying
          ?oauth_state_id) to finish — no second "Connect" click. On a NORMAL connect/reconnect we
          render the in-memory launcher WITHOUT receivedRedirectUri (Plaid requires it absent then).
          The two are mutually exclusive: the OAuth return is a fresh page load, so the in-memory
          linkToken is null while oauthResumeToken is set. */}
      {oauthResumeToken ? (
        <PlaidLinkLauncher
          token={oauthResumeToken}
          onSuccess={handleLinkSuccess}
          onDone={endLink}
          receivedRedirectUri={typeof window !== 'undefined' ? window.location.href : undefined}
        />
      ) : (
        linkToken && (
          <PlaidLinkLauncher token={linkToken} onSuccess={handleLinkSuccess} onDone={endLink} />
        )
      )}
    </AccountingShell>
  );
}
