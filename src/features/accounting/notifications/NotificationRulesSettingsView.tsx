/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. The notification-delivery config/preferences
 *     surface. The whole notification module is FLAG-DARK and requires CPA and/or security
 *     sign-off before it is enabled. This screen carries the UnverifiedBanner. It edits ONLY
 *     accounting.notification_rules CONFIG (enable toggle + threshold per event) and shows the
 *     recipient AUDIENCE preview — it moves NO money, posts NO journal entry, and delivers
 *     nothing itself. Delivery is the dispatch RPC (event-driven, app-side) / the ENV-GATED
 *     (default OFF) Netlify scheduled function (time-based) — never this screen.
 *
 * Two-gate honesty: even with a rule ENABLED here, a recipient only receives an in-app
 * notification if THEIR own preference for that event is ON — and those acct_* preferences
 * DEFAULT OFF (the client-side analog of the DB `notification_rules.enabled=false` backstop).
 * Both gates plus the dispatch RPC's own re-check keep the module flag-dark until deliberately
 * graduated. The screen states this so an admin is not surprised that "enabled" ≠ "delivered".
 *
 * HUMAN MUST VERIFY before enabling: cross-schema delivery security, recipient audience,
 * tax-deadline cadence (representative CDTFA only), threshold/day semantics, the dedupe scheme,
 * and the server env gate. See the module's "WHAT A HUMAN MUST VERIFY" list.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import { useNotificationRecipients, useNotificationRules } from '../hooks/useAccountingQueries';
import {
  useDeleteNotificationRule,
  useUpsertNotificationRule,
} from '../hooks/useAccountingMutations';
import {
  bankScopedRules,
  buildEventRows,
  enableBlockedReason,
  enabledEventCount,
  formatThresholdSummary,
  recipientSummary,
  validateThreshold,
  type NotificationEventRow,
} from '../notificationConfigView';
import type { NotificationRule } from '../types';

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** A small on/off switch styled as a pill toggle (keyboard + screen-reader accessible). */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background-dark disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/**
 * One event's config card: the label, the enable toggle (gated when a required threshold is
 * unset), the threshold input (hidden for invoice_sent), the in-app pref-key note, and a Save
 * that upserts the rule. The card keeps a LOCAL draft so an admin can edit the threshold and
 * enable in one Save (upsert is atomic on (event, NULL account)). Saving a still-flag-dark rule
 * is harmless — the dispatch RPC's own enabled-gate + the recipients' default-OFF preferences
 * mean nothing delivers until the module is deliberately graduated.
 */
function EventConfigCard({ row }: { row: NotificationEventRow }) {
  const upsert = useUpsertNotificationRule();

  // Local draft, re-synced whenever the underlying rule changes (after a save/refetch).
  const [enabled, setEnabled] = useState(row.enabled);
  const [thresholdText, setThresholdText] = useState(
    row.threshold == null ? '' : String(row.threshold)
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setEnabled(row.enabled);
    setThresholdText(row.threshold == null ? '' : String(row.threshold));
    setError(null);
  }, [row.enabled, row.threshold, row.ruleId]);

  const validation = validateThreshold(row.event, thresholdText);
  // Block enabling when a required threshold is not (validly) set.
  const wouldBeThreshold = validation.error ? null : validation.value;
  const enableBlock = enableBlockedReason(row.event, wouldBeThreshold);
  const toggleDisabled = !enabled && enableBlock != null;

  const dirty = enabled !== row.enabled || (validation.value ?? null) !== (row.threshold ?? null);

  const onSave = async () => {
    setError(null);
    setSavedAt(null);
    if (validation.error) {
      setError(validation.error);
      return;
    }
    if (enabled && enableBlock) {
      setError(enableBlock);
      return;
    }
    const res = await upsert.mutateAsync({
      eventType: row.event,
      enabled,
      threshold: validation.value,
    });
    if (res.error || !res.rule) {
      setError(res.error ?? 'Could not save this rule. Confirm you have an accounting-admin role.');
      return;
    }
    setSavedAt(Date.now());
  };

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">{row.label}</h3>
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                row.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-slate-400'
              }`}
            >
              {row.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{row.spec.hint}</p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(next) => {
            setEnabled(next);
            setError(null);
          }}
          disabled={toggleDisabled}
          label={`Enable ${row.label}`}
        />
      </div>

      {!row.spec.hidden && (
        <FormField
          label={row.spec.label}
          htmlFor={`threshold-${row.event}`}
          hint={`Current: ${formatThresholdSummary(row.event, row.threshold)}`}
          error={validation.error}
        >
          <input
            id={`threshold-${row.event}`}
            inputMode={row.spec.kind === 'dollars' ? 'decimal' : 'numeric'}
            className={`${inputClass} max-w-[12rem]`}
            placeholder={row.spec.placeholder}
            value={thresholdText}
            onChange={(e) => {
              setThresholdText(e.target.value);
              setError(null);
            }}
          />
        </FormField>
      )}

      {toggleDisabled && enableBlock && <p className="text-xs text-amber-300">{enableBlock}</p>}

      {/* Two-gate note: recipients must ALSO have this in-app preference on (defaults OFF). */}
      <p className="text-[11px] text-slate-500">
        In-app preference key <span className="font-mono text-slate-400">{row.prefKey}</span> — each
        recipient must have this on (it defaults off), so enabling here alone does not deliver.
      </p>

      <div className="flex items-center justify-end gap-3">
        {error && (
          <span className="mr-auto text-sm text-red-400" role="alert">
            {error}
          </span>
        )}
        {!error && savedAt != null && !dirty && (
          <span className="mr-auto text-sm text-green-400">Saved.</span>
        )}
        <Button size="sm" onClick={onSave} disabled={upsert.isPending || !dirty}>
          {upsert.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}

/** The recipient-audience preview card: who would receive accounting notifications. */
function RecipientPreview() {
  const { data: recipients, isPending, isError, refetch } = useNotificationRecipients();
  const count = recipients?.length ?? 0;

  return (
    <Card padding="lg" className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">group</span>
        Who gets notified
      </h2>

      {isPending && <p className="text-sm text-slate-400">Resolving the recipient audience…</p>}

      {!isPending && isError && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-red-300">
            Could not resolve the recipient audience. Confirm the accounting schema is exposed and
            you have an accounting role.
          </p>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isPending && !isError && (
        <>
          <p className="text-sm text-slate-300">{recipientSummary(count)}</p>
          <p className="text-xs text-slate-500">
            Resolved live from accounting-role holders plus approved admins. Each delivery is sent
            to one recipient at a time — accounting events are never broadcast, and they leak no
            financial detail beyond the audience already sees.
          </p>
        </>
      )}
    </Card>
  );
}

/** One per-account low_bank_balance OVERRIDE row, with a remove control. */
function BankScopedRuleRow({ rule }: { rule: NotificationRule }) {
  const remove = useDeleteNotificationRule();
  const [error, setError] = useState<string | null>(null);

  const onRemove = async () => {
    setError(null);
    const res = await remove.mutateAsync(rule.id);
    if (!res.ok) setError(res.error ?? 'Could not remove this override.');
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="material-symbols-outlined text-slate-400">account_balance</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white">
          {rule.bankAccountName ?? rule.bankAccountId ?? 'Bank account'}
        </p>
        <p className="text-xs text-slate-500">
          Minimum balance {formatThresholdSummary('low_bank_balance', rule.threshold)} ·{' '}
          {rule.enabled ? 'enabled' : 'disabled'}
        </p>
        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon="delete"
        onClick={onRemove}
        disabled={remove.isPending}
      >
        Remove
      </Button>
    </div>
  );
}

export default function NotificationRulesSettingsView() {
  const { data: rules = [], isPending, isError, refetch } = useNotificationRules();

  const eventRows = buildEventRows(rules);
  const overrides = bankScopedRules(rules);
  const enabledCount = enabledEventCount(rules);

  return (
    <AccountingShell active="notifications" title="Notifications (Unverified)">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <UnverifiedBanner detail="Notification delivery — config only. Nothing is delivered while the module is flag-dark." />

        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <span className="material-symbols-outlined text-primary">notifications_active</span>
            Accounting notifications
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Wire accounting events into the app notification feed: an invoice is sent or goes
            overdue, a bill comes due soon, a bank balance dips low, or a tax-filing deadline is
            near. Every event ships <span className="font-semibold">disabled</span>. Enabling one
            here is only the first gate — see the recipient note below.
          </p>
        </div>

        {isPending && <p className="text-slate-400">Loading notification rules…</p>}

        {!isPending && isError && (
          <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">
              Could not load the notification rules. Confirm the accounting schema is exposed and
              you have an accounting role.
            </p>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!isPending && !isError && (
          <>
            <RecipientPreview />

            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Events</h2>
              <span className="text-[11px] text-slate-500">
                {enabledCount} of {eventRows.length} enabled
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {eventRows.map((row) => (
                <EventConfigCard key={row.event} row={row} />
              ))}
            </div>

            {/* Per-account low-bank-balance overrides (a low_bank_balance rule scoped to one
                account). The base "all accounts" floor lives in the event card above; these are
                additional account-specific floors. We surface + allow removing them here; creating
                one is a follow-up control (the base floor covers the common case). */}
            {overrides.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  Per-account balance floors
                </h2>
                <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
                  {overrides.map((rule) => (
                    <BankScopedRuleRow key={rule.id} rule={rule} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AccountingShell>
  );
}
