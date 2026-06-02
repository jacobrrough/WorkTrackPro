/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. The notification-delivery seam (app-side path).
 *     The whole module is FLAG-DARK and requires CPA and/or security sign-off before it is
 *     enabled. Delivery happens ONLY through the single sanctioned cross-schema RPC
 *     accounting.dispatch_notification (SECURITY DEFINER, migration 20260601000025), which
 *     inserts into the EXISTING public.system_notifications feed AFTER gating on the rule
 *     being enabled + public.should_notify + the dedupe ledger. NO money moves here and NO
 *     journal entry is posted. Every delivered notification carries metadata.unverified=true.
 *
 * Two responsibilities, both READ-ONLY against public.* except the one authorized definer
 * insert the RPC performs:
 *   1. resolveRecipientIds() — the AUDIENCE: every user holding an accounting role
 *      (accounting.user_roles, any role) PLUS approved global admins (public.profiles), who
 *      implicitly hold all accounting roles. Deduped. This is the ONLY public.* read we do,
 *      and it leaks no financial detail. (Security note: a global admin is treated as an
 *      accounting recipient by the same convention the RLS helpers use — admin ⇒ all roles.)
 *   2. dispatch(candidate) — invoke the dispatch RPC ONCE PER RECIPIENT for a single computed
 *      candidate. The RPC, not this caller, performs the privileged write, and only ever for
 *      the one user_id passed — it never broadcasts. Suppressed deliveries (disabled rule /
 *      opted-out user / duplicate dedupe key) return a null notification id, not an error.
 *
 * EVENT-DRIVEN (app-side) entrypoint: dispatchInvoiceSent(invoice) — fired right after an
 * invoice is sent, under the user's own session. The time-based events (overdue/due-soon/
 * low-balance/tax-deadline) are swept by the ENV-GATED (default OFF) Netlify scheduled
 * function (server lane) using the SAME notificationRulesMath candidates + this same RPC, so
 * the two paths share one dedupe ledger. This service exposes dispatchCandidates() so a thin
 * app-side trigger could also fire a time-based sweep if ever desired, but the canonical
 * time-based path is the server function.
 *
 * Convention: reads THROW; the dispatch calls RETURN result objects (a failed delivery must
 * not throw — one bad recipient should not abort the rest).
 */
import type {
  NotificationDispatchResult,
  NotificationEventType,
  Invoice,
} from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import type { NotificationCandidate } from '../../../features/accounting/reports/notificationRulesMath';
import { buildInvoiceSentCandidate } from '../../../features/accounting/reports/notificationRulesMath';

/** Per-recipient outcome of dispatching one candidate. */
export interface CandidateDispatchSummary {
  eventType: NotificationEventType;
  subjectId: string | null;
  dedupeKey: string;
  /** How many recipients the candidate was offered to. */
  recipients: number;
  /** How many actually received a notification (after the RPC's gates). */
  delivered: number;
  /** How many were suppressed (disabled rule / opted-out / duplicate). */
  suppressed: number;
  /** Per-recipient errors (recipient id → message), if any. */
  errors: Array<{ userId: string; error: string }>;
}

export const notificationDispatchService = {
  /**
   * The recipient audience: distinct user ids holding ANY accounting role, plus approved
   * global admins. READ-ONLY. Throws on read failure (the caller decides how to surface it).
   */
  async resolveRecipientIds(): Promise<string[]> {
    const ids = new Set<string>();

    // Accounting-role holders (any role). RLS (can_read) lets a role-holder read this table.
    const { data: roleRows, error: roleErr } = await acct()
      .from('user_roles')
      .select('user_id');
    if (roleErr) throw roleErr;
    for (const r of (roleRows ?? []) as Array<{ user_id?: unknown }>) {
      if (r.user_id) ids.add(String(r.user_id));
    }

    // Approved global admins (admin ⇒ every accounting role). Read from public.profiles.
    const { data: adminRows, error: adminErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_admin', true)
      .eq('is_approved', true);
    if (adminErr) throw adminErr;
    for (const r of (adminRows ?? []) as Array<{ id?: unknown }>) {
      if (r.id) ids.add(String(r.id));
    }

    return Array.from(ids);
  },

  /**
   * Deliver ONE candidate to ONE recipient via the dispatch RPC. The RPC enforces enabled +
   * should_notify + dedupe and performs the single authorized insert. Returns the delivered
   * notification id or null (suppressed). Never throws on an expected DB rejection.
   */
  async dispatchOne(
    candidate: NotificationCandidate,
    userId: string
  ): Promise<NotificationDispatchResult> {
    const { data, error } = await acct().rpc('dispatch_notification', {
      p_event_type: candidate.eventType,
      p_user_id: userId,
      p_title: candidate.title,
      p_message: candidate.message,
      p_link: candidate.link ?? null,
      p_metadata: candidate.metadata ?? {},
      p_dedupe_key: candidate.dedupeKey,
      p_subject_id: candidate.subjectId,
    });
    if (error) return { notificationId: null, delivered: false, error: error.message };
    const notificationId = data == null ? null : String(data);
    return { notificationId, delivered: notificationId != null };
  },

  /**
   * Deliver ONE candidate to a set of recipients (resolved by the caller, or all recipients
   * when omitted). One RPC call per recipient; aggregates delivered/suppressed/errors. Each
   * recipient is independent — one failure is recorded and the rest proceed.
   */
  async dispatch(
    candidate: NotificationCandidate,
    recipientIds?: string[]
  ): Promise<CandidateDispatchSummary> {
    let recipients = recipientIds;
    if (!recipients) {
      try {
        recipients = await this.resolveRecipientIds();
      } catch (e) {
        return {
          eventType: candidate.eventType,
          subjectId: candidate.subjectId,
          dedupeKey: candidate.dedupeKey,
          recipients: 0,
          delivered: 0,
          suppressed: 0,
          errors: [{ userId: '*', error: e instanceof Error ? e.message : 'Recipient lookup failed.' }],
        };
      }
    }

    const summary: CandidateDispatchSummary = {
      eventType: candidate.eventType,
      subjectId: candidate.subjectId,
      dedupeKey: candidate.dedupeKey,
      recipients: recipients.length,
      delivered: 0,
      suppressed: 0,
      errors: [],
    };

    for (const userId of recipients) {
      const res = await this.dispatchOne(candidate, userId);
      if (res.error) {
        summary.errors.push({ userId, error: res.error });
      } else if (res.delivered) {
        summary.delivered += 1;
      } else {
        summary.suppressed += 1;
      }
    }
    return summary;
  },

  /**
   * Deliver MANY candidates (e.g. a batch of overdue invoices) to the recipient audience.
   * Resolves recipients ONCE and reuses them across all candidates (the same audience gets
   * every accounting alert). Returns one summary per candidate.
   */
  async dispatchCandidates(candidates: NotificationCandidate[]): Promise<CandidateDispatchSummary[]> {
    if (candidates.length === 0) return [];
    let recipients: string[];
    try {
      recipients = await this.resolveRecipientIds();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Recipient lookup failed.';
      return candidates.map((c) => ({
        eventType: c.eventType,
        subjectId: c.subjectId,
        dedupeKey: c.dedupeKey,
        recipients: 0,
        delivered: 0,
        suppressed: 0,
        errors: [{ userId: '*', error: msg }],
      }));
    }
    const out: CandidateDispatchSummary[] = [];
    for (const c of candidates) {
      out.push(await this.dispatch(c, recipients));
    }
    return out;
  },

  /**
   * EVENT-DRIVEN (app-side): an invoice was just sent → notify the accounting audience. Builds
   * the single invoice_sent candidate (per-invoice dedupe key, so re-sending the same invoice
   * does NOT re-notify) and dispatches it. Safe to call after invoicesService.send(): the
   * dispatch RPC's enabled-gate means this is a no-op until an admin enables invoice_sent, so
   * wiring the call in early does not deliver anything while the module is flag-dark.
   */
  async dispatchInvoiceSent(invoice: Invoice): Promise<CandidateDispatchSummary> {
    return this.dispatch(buildInvoiceSentCandidate(invoice));
  },
};
