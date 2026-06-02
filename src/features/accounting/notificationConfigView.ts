/**
 * Pure presentation helpers for the notification config/preferences surface (HELD /
 * UNVERIFIED — NOT FOR FILING, UI lane). No React, no Supabase — trivially unit-testable
 * (see notificationConfigView.test.ts).
 *
 * The DB (accounting.notification_rules) is the source of truth and the only enforcement;
 * the dispatch RPC re-checks `enabled` server-side (defense in depth). This module just
 * turns the five event types + the loaded rules into the per-event view-model the screen
 * renders — the threshold's meaning/label/placeholder per event, the client-side threshold
 * validation, and the recipient-audience summary — so the wording and the dollars-vs-days
 * boundary rules are covered by fast tests without rendering React.
 *
 * MONEY (G6): the low_bank_balance threshold is a DOLLAR amount; we validate it as a
 * non-negative number with at most cents precision but never compare balances here (that
 * is the pure detection math in reports/notificationRulesMath.ts, in integer cents).
 */
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_PREF_KEY,
  NOTIFICATION_THRESHOLD_KIND,
  type NotificationEventType,
  type NotificationRule,
  type NotificationThresholdKind,
} from './types';

/**
 * What the screen needs to render+label one event's threshold input. Derived purely from
 * the event's threshold KIND (days / dollars / none) — the single source of truth in
 * types.ts (NOTIFICATION_THRESHOLD_KIND), so the UI never re-decides per-event semantics.
 */
export interface ThresholdFieldSpec {
  kind: NotificationThresholdKind;
  /** True when this event takes NO threshold (invoice_sent) — the input is hidden. */
  hidden: boolean;
  /** Field label, e.g. "Notify when due within (days)" or "Minimum balance ($)". */
  label: string;
  /** Placeholder / example for the empty input. */
  placeholder: string;
  /** Short helper caption under the input explaining what the number means. */
  hint: string;
  /** A sensible default to pre-fill when an admin first sets a threshold for this event. */
  suggested: number;
  /** Unit suffix for compact summaries ("days" / "$"); empty for none. */
  unit: string;
}

const THRESHOLD_SPECS: Record<NotificationEventType, ThresholdFieldSpec> = {
  invoice_sent: {
    kind: 'none',
    hidden: true,
    label: '',
    placeholder: '',
    hint: 'Fires once when an invoice is sent. No threshold.',
    suggested: 0,
    unit: '',
  },
  invoice_overdue: {
    kind: 'days',
    hidden: false,
    label: 'Notify when past due by at least (days)',
    placeholder: 'e.g. 1',
    hint: 'A sent invoice with a balance is flagged once it is this many days past its due date (it re-alerts as it ages into deeper buckets, never daily).',
    suggested: 1,
    unit: 'days',
  },
  bill_due_soon: {
    kind: 'days',
    hidden: false,
    label: 'Notify when due within (days)',
    placeholder: 'e.g. 7',
    hint: 'An open bill with a balance is flagged when its due date is within this many days (and not already past due).',
    suggested: 7,
    unit: 'days',
  },
  low_bank_balance: {
    kind: 'dollars',
    hidden: false,
    label: 'Minimum balance ($)',
    placeholder: 'e.g. 500.00',
    hint: 'An active bank account is flagged when its current balance falls below this dollar amount (checked at most once per day).',
    suggested: 500,
    unit: '$',
  },
  tax_deadline_upcoming: {
    kind: 'days',
    hidden: false,
    label: 'Notify when due within (days)',
    placeholder: 'e.g. 14',
    hint: 'A representative tax-filing deadline (CDTFA cadence — verify with a CPA/EA) is flagged when it is within this many days.',
    suggested: 14,
    unit: 'days',
  },
};

/** The threshold field spec for an event (label/placeholder/hint/suggested/unit). */
export function thresholdFieldSpec(event: NotificationEventType): ThresholdFieldSpec {
  return THRESHOLD_SPECS[event];
}

/** The threshold kind for an event ('days' | 'dollars' | 'none'). */
export function thresholdKind(event: NotificationEventType): NotificationThresholdKind {
  return NOTIFICATION_THRESHOLD_KIND[event];
}

/** The human label for an event. */
export function eventLabel(event: NotificationEventType): string {
  return NOTIFICATION_EVENT_LABELS[event];
}

/** The in-app preference key an event maps to (the same key the dispatch RPC gates on). */
export function eventPrefKey(event: NotificationEventType): string {
  return NOTIFICATION_PREF_KEY[event];
}

/** Result of validating a typed threshold for an event before saving it. */
export interface ThresholdValidation {
  /** The normalized number to persist, or null to clear the threshold. */
  value: number | null;
  /** A user-facing reason the value can't be used, or null when it's fine. */
  error: string | null;
}

/**
 * Validate a threshold the admin typed (raw string from the input) for one event.
 *   • 'none'    — always { value: null } (no threshold for invoice_sent).
 *   • empty     — { value: null } (clears the threshold). The screen separately blocks
 *                 ENABLING an event whose threshold is required-but-empty.
 *   • 'days'    — a whole integer >= 0 (a day count). Rejects negatives / non-integers.
 *   • 'dollars' — a number >= 0 with at most two decimals (cents). Rejects negatives /
 *                 sub-cent precision. Stored as dollars; compared in cents downstream.
 */
export function validateThreshold(
  event: NotificationEventType,
  raw: string | null | undefined
): ThresholdValidation {
  const kind = thresholdKind(event);
  if (kind === 'none') return { value: null, error: null };

  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { value: null, error: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { value: null, error: 'Enter a number.' };
  }
  if (n < 0) {
    return { value: null, error: kind === 'dollars' ? 'Enter an amount of $0 or more.' : 'Enter 0 or more days.' };
  }

  if (kind === 'days') {
    if (!Number.isInteger(n)) return { value: null, error: 'Enter a whole number of days.' };
    return { value: n, error: null };
  }

  // dollars: at most two decimal places (cents). Compare the rounded-cents round-trip.
  const cents = Math.round(n * 100);
  if (Math.abs(cents - n * 100) > 1e-6) {
    return { value: null, error: 'Enter a dollar amount (at most two decimal places).' };
  }
  return { value: cents / 100, error: null };
}

/**
 * Whether ENABLING this event is blocked because its (required) threshold is not set.
 * Day/dollar events need a threshold to do anything; invoice_sent never does. Returns a
 * reason string the screen shows when it disables the toggle, or null when enabling is OK.
 */
export function enableBlockedReason(
  event: NotificationEventType,
  threshold: number | null | undefined
): string | null {
  const spec = thresholdFieldSpec(event);
  if (spec.kind === 'none') return null;
  if (threshold == null) {
    return spec.kind === 'dollars'
      ? 'Set a minimum balance before enabling this alert.'
      : 'Set a day threshold before enabling this alert.';
  }
  return null;
}

/** Format one event's current threshold for a compact summary (e.g. "7 days", "$500.00", "—"). */
export function formatThresholdSummary(
  event: NotificationEventType,
  threshold: number | null | undefined
): string {
  const spec = thresholdFieldSpec(event);
  if (spec.kind === 'none') return '—';
  if (threshold == null) return 'not set';
  if (spec.kind === 'dollars') {
    const sign = threshold < 0 ? '-' : '';
    const abs = Math.abs(threshold);
    const whole = Math.floor(abs).toLocaleString('en-US');
    const frac = String(Math.round((abs - Math.floor(abs)) * 100)).padStart(2, '0');
    return `${sign}$${whole}.${frac}`;
  }
  return `${threshold} day${threshold === 1 ? '' : 's'}`;
}

/**
 * The view-model for one event row on the config surface: the event, its label, pref key,
 * threshold spec, and the loaded rule (or null when no base rule exists yet — the migration
 * seeds all five, so null only happens on a partial DB). `enabled`/`threshold` read through
 * to the rule. `ruleId` is the row to mutate (null ⇒ the screen upserts to create it).
 */
export interface NotificationEventRow {
  event: NotificationEventType;
  label: string;
  prefKey: string;
  spec: ThresholdFieldSpec;
  /** The base (NULL-bank-account) rule for this event, when present. */
  rule: NotificationRule | null;
  ruleId: string | null;
  enabled: boolean;
  threshold: number | null;
}

/**
 * Assemble the five event rows for the screen from the loaded rules. We surface ALL five
 * events in a fixed order (NOTIFICATION_EVENT_TYPES), pairing each with its base rule (the
 * one with a NULL bankAccountId — the per-event default). A loaded rule scoped to a specific
 * bank account (low_bank_balance override) is intentionally NOT used as the base row here;
 * those per-account overrides are listed separately by the screen. When no base rule exists
 * for an event, the row is rendered as disabled/unset and the screen upserts on first edit.
 */
export function buildEventRows(rules: NotificationRule[]): NotificationEventRow[] {
  // Index base (NULL-account) rules by event; the first NULL-account rule wins.
  const baseByEvent = new Map<NotificationEventType, NotificationRule>();
  for (const r of rules) {
    if (r.bankAccountId == null && !baseByEvent.has(r.eventType)) {
      baseByEvent.set(r.eventType, r);
    }
  }

  return (Object.keys(NOTIFICATION_THRESHOLD_KIND) as NotificationEventType[]).map((event) => {
    const rule = baseByEvent.get(event) ?? null;
    return {
      event,
      label: eventLabel(event),
      prefKey: eventPrefKey(event),
      spec: thresholdFieldSpec(event),
      rule,
      ruleId: rule?.id ?? null,
      enabled: rule?.enabled ?? false,
      threshold: rule?.threshold ?? null,
    };
  });
}

/**
 * The per-account low_bank_balance OVERRIDE rules (rules with a non-null bankAccountId).
 * Surfaced separately from the five base rows so an admin can see/scope per-account floors.
 * Sorted by bank account name (hydrated) then id for a stable list.
 */
export function bankScopedRules(rules: NotificationRule[]): NotificationRule[] {
  return rules
    .filter((r) => r.bankAccountId != null)
    .sort((a, b) => {
      const an = a.bankAccountName ?? a.bankAccountId ?? '';
      const bn = b.bankAccountName ?? b.bankAccountId ?? '';
      return an.localeCompare(bn);
    });
}

/** Count of currently-enabled events across all rules (for the header summary). */
export function enabledEventCount(rules: NotificationRule[]): number {
  const enabled = new Set<NotificationEventType>();
  for (const r of rules) {
    if (r.enabled) enabled.add(r.eventType);
  }
  return enabled.size;
}

/**
 * One-line summary of the recipient audience for the preview card. `count` is the number of
 * distinct user ids resolved (accounting-role holders + approved admins). Pure string-builder
 * so the wording (and the empty/singular/plural cases) is unit-tested.
 */
export function recipientSummary(count: number): string {
  if (count <= 0) {
    return 'No recipients resolved. Accounting events go to users holding an accounting role plus approved admins — none were found.';
  }
  if (count === 1) {
    return '1 person would receive accounting notifications (accounting-role holders + approved admins).';
  }
  return `${count} people would receive accounting notifications (accounting-role holders + approved admins).`;
}
