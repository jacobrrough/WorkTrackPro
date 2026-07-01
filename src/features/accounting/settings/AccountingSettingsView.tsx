import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { accountingSettingsService } from '@/services/api/accounting';
import type { DunningConfig } from '../types';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import DocumentTemplateSettings from '../documents/DocumentTemplateSettings';
import {
  useAccounts,
  useClosedThroughDate,
  useDefaultAccounts,
  useOpenTaxTableDriftCount,
} from '../hooks/useAccountingQueries';
import { useSetClosedThroughDate } from '../hooks/useAccountingMutations';
import { TAX_JURISDICTIONS_BASE, TAX_TABLES_BASE } from '../constants';
import { openDriftBadgeLabel } from '../taxTableSyncView';
import {
  confirmCloseMessage,
  isLockChange,
  lockStatusSummary,
  todayIsoLocal,
  validateProposedCloseDate,
} from '../periodLockView';
import {
  configuredSummary,
  resolveDefaultAccounts,
  resolvedByGroup,
  type DefaultAccountGroup,
  type ResolvedDefaultAccount,
} from '../defaultAccountsView';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** What the confirmation dialog is about to do. `date: null` means re-open the books. */
type PendingAction = { date: string | null };

/**
 * Confirmation dialog for changing the books-closed (period lock) date. Renders the
 * tailored warning (close / move / re-open) and, on failure, the DB RPC's error verbatim
 * — most importantly `insufficient_privilege` when the current user is not an
 * accounting_admin. We never assume success: the dialog only closes once the mutation
 * returns ok, so a rejected attempt keeps the dialog open with the reason shown.
 */
function ConfirmLockDialog({
  action,
  currentClosed,
  onClose,
}: {
  action: PendingAction;
  currentClosed: string | null;
  onClose: () => void;
}) {
  const setLock = useSetClosedThroughDate();
  const [error, setError] = useState<string | null>(null);

  const reopening = action.date == null;
  const message = confirmCloseMessage(action.date, currentClosed);

  const confirm = async () => {
    setError(null);
    const res = await setLock.mutateAsync(action.date);
    if (!res.ok) {
      // Surface the DB rejection inline (e.g. "only accounting_admin may change the
      // books-closed date"). Do NOT close — the lock did not move.
      setError(res.error ?? 'The change was rejected.');
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-confirm-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="lock-confirm-title" className="text-lg font-bold text-white">
            {reopening ? 'Re-open the books?' : 'Close the books?'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">{message}</p>

        <p className="mb-4 text-xs text-subtle">
          This action is restricted to the <span className="font-semibold">accounting_admin</span>{' '}
          role and is recorded in the accounting audit log.
        </p>

        {error && (
          <p className="mb-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={setLock.isPending}>
            Cancel
          </Button>
          <Button
            variant={reopening ? 'secondary' : 'danger'}
            onClick={confirm}
            disabled={setLock.isPending}
          >
            {setLock.isPending ? 'Saving…' : reopening ? 'Re-open books' : 'Close books'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Status banner: open (neutral) vs. locked (amber), driven entirely by the pure summary. */
function LockStatusCard({ closedThrough }: { closedThrough: string | null }) {
  const locked = !!closedThrough;
  return (
    <div
      className={`rounded-lg border p-3 ${
        locked
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-green-500/30 bg-green-500/10 text-green-200'
      }`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-xl">{locked ? 'lock' : 'lock_open'}</span>
        <span className="text-sm font-semibold">{locked ? 'Books closed' : 'Books open'}</span>
      </div>
      <p className="mt-1 text-sm">{lockStatusSummary(closedThrough)}</p>
    </div>
  );
}

/** One resolved default-account mapping row: label + description + the resolved account (or a "not configured" flag). */
function DefaultAccountRow({ row }: { row: ResolvedDefaultAccount }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{row.label}</p>
        <p className="mt-0.5 text-xs text-subtle">{row.description}</p>
      </div>
      <div className="shrink-0 text-right">
        {row.configured && row.account ? (
          <>
            <p className="font-mono text-sm text-white">
              <span className="text-subtle">{row.account.accountNumber ?? '—'}</span>{' '}
              {row.account.name}
            </p>
            {/* Flag a seed that resolved to an UNEXPECTED account number (configured, but not
                the number this role is documented to use). Quietly reassuring when they match. */}
            {row.account.accountNumber && row.account.accountNumber !== row.expectedNumber && (
              <p className="mt-0.5 text-[11px] text-amber-300/90">expected {row.expectedNumber}</p>
            )}
          </>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
            Not configured
          </span>
        )}
      </div>
    </div>
  );
}

/** A titled group (Structural / Core) of default-account rows with a configured-count caption. */
function DefaultAccountGroupSection({
  title,
  caption,
  rows,
}: {
  title: string;
  caption: string;
  rows: ResolvedDefaultAccount[];
}) {
  if (rows.length === 0) return null;
  const summary = configuredSummary(rows);
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
        <span className="text-[11px] text-subtle">{summary.label}</span>
      </div>
      <p className="mb-2 text-xs text-subtle">{caption}</p>
      <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
        {rows.map((row) => (
          <DefaultAccountRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}

const GROUP_META: Record<DefaultAccountGroup, { title: string; caption: string }> = {
  structural: {
    title: 'Structural accounts',
    caption:
      'Posting targets the import/migration and bank-feed modules resolve by name. Verify each points at the right account before those modules go live.',
  },
  core: {
    title: 'Core mappings',
    caption: 'Defaults the invoice, bill, payment, and COGS postings already use.',
  },
};

/**
 * COA-EXPAND — read-only panel that shows which chart-of-accounts account each default
 * posting role resolves to (settings.default_accounts), foregrounding the new structural
 * accounts (3050/4900/6900/1260). The mapping is seeded by migration, so this is a
 * verification surface only — there is no edit control here. Loads its own data; renders
 * loading / error / (resolved) states. An unset or dangling mapping shows "Not configured".
 */
function DefaultAccountsPanel() {
  const defaultsQuery = useDefaultAccounts();
  const accountsQuery = useAccounts();

  const isPending = defaultsQuery.isPending || accountsQuery.isPending;
  const isError = defaultsQuery.isError || accountsQuery.isError;

  const rows = resolveDefaultAccounts(defaultsQuery.data ?? null, accountsQuery.data ?? []);

  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">account_tree</span>
        Default GL accounts
      </h2>
      <p className="mt-1 text-sm text-muted">
        The chart-of-accounts account each posting role maps to. Configured in the database seed;
        shown here so you can confirm the wiring (especially the structural accounts the import and
        bank-feed modules depend on).
      </p>

      {isPending && <p className="mt-3 text-sm text-muted">Loading default accounts…</p>}

      {!isPending && isError && (
        <div className="mt-3 flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-300">
            Could not load the default-account mappings. Confirm the accounting schema is exposed
            and you have an accounting role.
          </p>
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={() => {
              defaultsQuery.refetch();
              accountsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && (
        <Card className="mt-3 flex flex-col gap-5" padding="lg">
          {(['structural', 'core'] as DefaultAccountGroup[]).map((group) => (
            <DefaultAccountGroupSection
              key={group}
              title={GROUP_META[group].title}
              caption={GROUP_META[group].caption}
              rows={resolvedByGroup(rows, group)}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

/**
 * TAX-SYNC entry — a link into the accounting_admin-only "Tax table updates" screen, with
 * a count of OPEN drift alerts (the in-app advisory alert that stored tax rates differ from
 * the latest official tables). The count comes from a cheap head+exact query; the screen
 * itself is where an admin reviews and explicitly Applies/Dismisses. Nothing here moves
 * money. The whole module is server-gated OFF until graduation — the entry is always shown
 * (so an admin can open it and run a check / read the disclaimer), but it will normally
 * report zero alerts.
 */
function TaxTableUpdatesPanel() {
  const navigate = useNavigate();
  const { data: openCount } = useOpenTaxTableDriftCount();
  const badge = openDriftBadgeLabel(openCount);

  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">policy</span>
        Tax table updates
      </h2>
      <p className="mt-1 text-sm text-muted">
        Advisory checks of official sales-tax (CDTFA) and payroll (CA EDD) rate tables against your
        stored rates. Differences are flagged for your review — they are never applied
        automatically.
      </p>
      <Card
        className="mt-3 flex items-center gap-3"
        padding="lg"
        onClick={() => navigate(TAX_TABLES_BASE)}
      >
        <span className="material-symbols-outlined text-amber-300">notifications</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">Open the tax table updates screen</p>
          <p className="mt-0.5 text-xs text-subtle">
            {badge
              ? `${openCount} open alert${openCount === 1 ? '' : 's'} need your review`
              : 'No open alerts. You can also run a check now.'}
          </p>
        </div>
        {badge && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-accent">
            {badge}
          </span>
        )}
        <span className="material-symbols-outlined text-subtle">chevron_right</span>
      </Card>
    </div>
  );
}

/**
 * #13 — entry into the sales-tax jurisdictions screen (address → tax-code map). ADVISORY-ONLY:
 * a mapping points an address at an EXISTING composite tax code to PRE-FILL the tax code on new
 * invoices/estimates. Nothing here moves money or defines a rate.
 */
function TaxJurisdictionsPanel() {
  const navigate = useNavigate();
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">map</span>
        Sales-tax jurisdictions
      </h2>
      <p className="mt-1 text-sm text-muted">
        Map a customer&apos;s address (state / county / city / ZIP) to the sales-tax code to apply.
        New invoices and estimates use the most specific match to suggest a tax code — you can
        always override it. A mapping never defines a rate.
      </p>
      <Card
        className="mt-3 flex items-center gap-3"
        padding="lg"
        onClick={() => navigate(TAX_JURISDICTIONS_BASE)}
      >
        <span className="material-symbols-outlined text-primary">location_on</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">Open the sales-tax jurisdictions screen</p>
          <p className="mt-0.5 text-xs text-subtle">
            View and edit the address-to-tax-code map (ZIP-level; verify with a CPA/EA).
          </p>
        </div>
        <span className="material-symbols-outlined text-subtle">chevron_right</span>
      </Card>
    </div>
  );
}

/** Parse the "-3, 0, 7, 14" offsets text input into a clean, sorted int[]. */
function parseOffsets(text: string): number[] {
  const nums = text
    .split(',')
    .map((s) => Math.trunc(Number(s.trim())))
    .filter((n) => Number.isFinite(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * #6 — Dunning (automated invoice reminders) settings. Reads/writes the 'dunning' settings
 * key. The SCHEDULED sender is ALSO hard-gated by the server env ACCOUNTING_DUNNING_ENABLED
 * (default OFF); the "Enable reminders" toggle here is the per-tenant soft switch on top of
 * that gate, so reminders only go out when BOTH are on. No money moves here.
 *
 * Manages its own data (load via the service, local form state) so it needs no new query
 * hooks — mirroring how the other lightweight panels stay self-contained.
 */
function DunningSettingsPanel() {
  const [config, setConfig] = useState<DunningConfig | null>(null);
  const [offsetsText, setOffsetsText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountingSettingsService
      .getDunningConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setOffsetsText(cfg.offsetsDays.join(', '));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the reminder settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof DunningConfig>(key: K, value: DunningConfig[K]) => {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
    setSavedAt(null);
  };

  const save = async () => {
    if (!config) return;
    setSaveError(null);
    setSaving(true);
    const next: DunningConfig = { ...config, offsetsDays: parseOffsets(offsetsText) };
    const res = await accountingSettingsService.setDunningConfig(next);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error ?? 'Could not save the reminder settings.');
      return;
    }
    setConfig(next);
    setOffsetsText(next.offsetsDays.join(', '));
    setSavedAt(Date.now());
  };

  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">forward_to_inbox</span>
        Invoice reminders (dunning)
      </h2>
      <p className="mt-1 text-sm text-muted">
        Automatically email customers about unpaid invoices on a schedule relative to each invoice’s
        due date. Reminders only send when this is enabled here AND the feature is switched on for
        the server.
      </p>

      {loadError && <p className="mt-3 text-sm text-red-400">{loadError}</p>}

      {config && (
        <Card className="mt-3 flex flex-col gap-4" padding="lg">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="size-4 rounded border-line-strong bg-background-dark text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium text-white">Enable automated reminders</span>
          </label>

          <FormField
            label="Reminder days (relative to due date)"
            htmlFor="dunning-offsets"
            hint="Comma-separated. Negative = before due, 0 = on the due date, positive = after. e.g. -3, 0, 7, 14"
          >
            <input
              id="dunning-offsets"
              className={inputClass}
              value={offsetsText}
              onChange={(e) => {
                setOffsetsText(e.target.value);
                setSavedAt(null);
              }}
              placeholder="-3, 0, 7, 14"
            />
          </FormField>

          <FormField label="From address" htmlFor="dunning-from" hint="Must be a verified sender">
            <input
              id="dunning-from"
              type="email"
              className={inputClass}
              value={config.fromEmail}
              onChange={(e) => update('fromEmail', e.target.value)}
              placeholder="billing@yourcompany.com"
            />
          </FormField>

          <FormField
            label="Subject template"
            htmlFor="dunning-subject"
            hint="Tokens: {{invoiceNumber}} {{customerName}} {{balanceDue}}"
          >
            <input
              id="dunning-subject"
              className={inputClass}
              value={config.subjectTemplate}
              onChange={(e) => update('subjectTemplate', e.target.value)}
            />
          </FormField>

          <FormField
            label="Body template"
            htmlFor="dunning-body"
            hint="Tokens: {{invoiceNumber}} {{customerName}} {{balanceDue}}"
          >
            <textarea
              id="dunning-body"
              className={`${inputClass} min-h-[120px] resize-y`}
              value={config.bodyTemplate}
              onChange={(e) => update('bodyTemplate', e.target.value)}
            />
          </FormField>

          <FormField
            label="Max emails per run"
            htmlFor="dunning-max"
            hint="Safety cap on how many reminders a single scheduled run will send"
          >
            <input
              id="dunning-max"
              type="number"
              min={1}
              className={inputClass}
              value={config.maxPerRun}
              onChange={(e) =>
                update('maxPerRun', Math.max(1, Math.trunc(Number(e.target.value)) || 1))
              }
            />
          </FormField>

          {saveError && (
            <p className="text-sm text-red-400" role="alert">
              {saveError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            {savedAt && <span className="text-xs text-green-400">Saved.</span>}
            <Button icon="save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save reminder settings'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Document template — branding/layout for the customer-facing sales documents
 * (estimates & invoices). The editor is self-contained: it loads the saved branding
 * template, lets an admin tune the header/colors/layout, and persists it. Nothing here
 * moves money. Wrapped in the standard heading + description so it reads like the other
 * settings sections; the editor itself owns its Card/form chrome.
 */
function DocumentTemplatePanel() {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">description</span>
        Document template
      </h2>
      <p className="mt-1 text-sm text-muted">
        Customize how your estimates and invoices look to customers — header, logo, colors, and
        layout. Changes apply to newly generated documents.
      </p>
      <DocumentTemplateSettings />
    </div>
  );
}

/**
 * D1 — Books-closed (period lock) date. Accounting-admin control to "close the books"
 * through a date: once set, the DB rejects posting or voiding any journal entry dated on
 * or before it (migration 20260601000016). The whole accounting module is already behind
 * AdminGuard; the set/clear RPC additionally enforces accounting_admin and surfaces an
 * insufficient_privilege error here if the signed-in admin lacks that accounting role.
 *
 * G9 disclaimer is shown because this is a financial-control surface. No money moves here
 * (it is a period control), so there is no journal entry to post.
 */
export default function AccountingSettingsView() {
  const { data: closedThrough = null, isPending, isError, refetch } = useClosedThroughDate();
  const [draftDate, setDraftDate] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);

  const today = todayIsoLocal();
  // Default the picker to the existing lock (so "move" starts from the current value) or
  // today when the books are open. Controlled value falls back to that default.
  const inputValue = draftDate || closedThrough || today;
  const validation = validateProposedCloseDate(inputValue);
  const willChange = validation.date != null && isLockChange(validation.date, closedThrough);

  return (
    <AccountingShell active="settings" title="Accounting Settings">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <TaxDisclaimer />

        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">event_busy</span>
            Books-closed (period lock) date
          </h2>
          <p className="mt-1 text-sm text-muted">
            Closing the books through a date freezes that period: no journal entry dated on or
            before it can be posted or voided — including invoices, bills, payments, and bank
            matches that would post into it. Use this after a period is reconciled and filed.
          </p>
        </div>

        {isPending && <p className="text-muted">Loading the period lock…</p>}

        {isError && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">
              Could not load the books-closed date. Confirm the accounting schema is exposed and you
              have an accounting role.
            </p>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!isPending && !isError && (
          <Card className="flex flex-col gap-4" padding="lg">
            <LockStatusCard closedThrough={closedThrough} />

            <FormField
              label="Close the books through"
              htmlFor="close-through-date"
              hint="Entries on or before this date will be locked. You can move this date later or re-open the books at any time."
            >
              <input
                id="close-through-date"
                type="date"
                className={inputClass}
                max={today}
                value={inputValue}
                onChange={(e) => setDraftDate(e.target.value)}
              />
            </FormField>

            {validation.error && (
              <p className="text-sm text-red-400" role="alert">
                {validation.error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {closedThrough && (
                <Button variant="ghost" icon="lock_open" onClick={() => setPending({ date: null })}>
                  Re-open the books
                </Button>
              )}
              <Button
                icon="lock"
                disabled={!willChange}
                onClick={() => {
                  if (validation.date) setPending({ date: validation.date });
                }}
              >
                {closedThrough ? 'Update lock date' : 'Close the books'}
              </Button>
            </div>

            {!willChange && validation.date != null && (
              <p className="text-right text-xs text-subtle">
                {closedThrough
                  ? 'This matches the current lock date — pick a different date to change it.'
                  : 'Pick a date, then close the books.'}
              </p>
            )}
          </Card>
        )}

        <div className="border-t border-line pt-5">
          <DefaultAccountsPanel />
        </div>

        <div className="border-t border-line pt-5">
          <DocumentTemplatePanel />
        </div>

        <div className="border-t border-line pt-5">
          <DunningSettingsPanel />
        </div>

        <div className="border-t border-line pt-5">
          <TaxTableUpdatesPanel />
        </div>

        <div className="border-t border-line pt-5">
          <TaxJurisdictionsPanel />
        </div>
      </div>

      {pending && (
        <ConfirmLockDialog
          action={pending}
          currentClosed={closedThrough}
          onClose={() => {
            setPending(null);
            setDraftDate('');
          }}
        />
      )}
    </AccountingShell>
  );
}
