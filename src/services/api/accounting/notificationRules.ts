/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. CRUD around the additive notification-rules config
 *     (accounting.notification_rules, migration 20260601000025). The whole notification
 *     module is FLAG-DARK and requires CPA and/or security sign-off before it is enabled.
 *     This service ONLY reads/writes the accounting-schema CONFIG; it delivers nothing.
 *     Delivery goes exclusively through accounting.dispatch_notification (see
 *     notificationDispatch.ts). NO money moves here and NO journal entry is posted.
 *
 * Rules ship DISABLED (enabled=false) and the DB re-checks `enabled` inside the dispatch RPC
 * (defense in depth), so even a stale client cannot deliver for a disabled event. RLS:
 * read=can_read(), write=can_write() (migration 025 via _apply_standard_table) — a non-role
 * user is denied at the database; failures surface in the returned result object.
 *
 * Convention (matches the rest of the module): reads THROW (React Query surfaces them);
 * writes RETURN a result object carrying the DB error string.
 *
 * UPSERT semantics: one rule per (event_type, bankAccountId). The 5 base rules (NULL
 * bankAccountId) are seeded by the migration, so the common operation is an UPDATE-by-id
 * (toggle enabled / set threshold). A per-account low_bank_balance rule is created by
 * upserting with a non-null bankAccountId. We resolve the existing row by (event, account)
 * and UPDATE it, else INSERT — robust against the partial unique index on the NULL-account
 * case (which PostgREST's onConflict cannot target directly).
 */
import type {
  NotificationEventType,
  NotificationRule,
  NotificationRuleInput,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapNotificationRuleRow, toNotificationRulePayload, type Row } from './mappers';

/** Select that hydrates the optional scoped bank account's name for display. */
const RULE_SELECT = '*, bank_account:bank_accounts(id, name)';

export const notificationRulesService = {
  /** All notification rules, ordered by event then account (the 5 base rules first). */
  async list(): Promise<NotificationRule[]> {
    const { data, error } = await acct()
      .from('notification_rules')
      .select(RULE_SELECT)
      .order('event_type', { ascending: true })
      .order('bank_account_id', { ascending: true, nullsFirst: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapNotificationRuleRow);
  },

  /** One rule by id (null when absent). */
  async getById(id: string): Promise<NotificationRule | null> {
    const { data, error } = await acct()
      .from('notification_rules')
      .select(RULE_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapNotificationRuleRow(data as Row);
  },

  /**
   * Find the rule for an (event_type, bankAccountId) pair, or null. bankAccountId null matches
   * the "all-accounts" base rule. Used by upsert to decide UPDATE vs INSERT.
   */
  async findByEvent(
    eventType: NotificationEventType,
    bankAccountId: string | null = null
  ): Promise<NotificationRule | null> {
    let q = acct().from('notification_rules').select(RULE_SELECT).eq('event_type', eventType);
    q = bankAccountId == null ? q.is('bank_account_id', null) : q.eq('bank_account_id', bankAccountId);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return mapNotificationRuleRow(data as Row);
  },

  /**
   * Create-or-update the rule for (eventType, bankAccountId). Resolves the existing row and
   * UPDATEs it (touching updated_at), else INSERTs a new one. Returns the saved rule or an
   * error. The DB unique constraint + partial index are the ultimate backstop against dupes.
   */
  async upsert(input: NotificationRuleInput): Promise<{ rule: NotificationRule | null; error?: string }> {
    const bankAccountId = input.bankAccountId ?? null;
    const existing = await this.findByEvent(input.eventType, bankAccountId);

    if (existing) {
      // UPDATE the resolved row by id (do not rewrite event_type/bank_account_id here).
      const patch = toNotificationRulePayload({ ...input, eventType: input.eventType }, false);
      delete (patch as Record<string, unknown>).bank_account_id; // identity, not editable here
      patch.updated_at = new Date().toISOString();
      const { data, error } = await acct()
        .from('notification_rules')
        .update(patch)
        .eq('id', existing.id)
        .select(RULE_SELECT)
        .single();
      if (error || !data) return { rule: null, error: error?.message ?? 'Failed to update rule.' };
      return { rule: mapNotificationRuleRow(data as Row) };
    }

    // INSERT a new rule. event_type + bank_account_id form the identity.
    const row = toNotificationRulePayload(input, true);
    row.bank_account_id = bankAccountId;
    const { data, error } = await acct()
      .from('notification_rules')
      .insert(row)
      .select(RULE_SELECT)
      .single();
    if (error || !data) return { rule: null, error: error?.message ?? 'Failed to create rule.' };
    return { rule: mapNotificationRuleRow(data as Row) };
  },

  /** Toggle one rule's enabled flag by id. */
  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('notification_rules')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Set one rule's threshold by id (dollars for low_bank_balance; days otherwise; null clears). */
  async setThreshold(id: string, threshold: number | null): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('notification_rules')
      .update({ threshold, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Delete a rule by id. The 5 base (NULL-account) rules are seeded and normally kept (just
   * disabled); this is primarily for removing a per-account low_bank_balance override.
   */
  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('notification_rules').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** True when ANY rule for the event is enabled — the same gate the dispatch RPC applies. */
  async isEventEnabled(eventType: NotificationEventType): Promise<boolean> {
    const { data, error } = await acct()
      .from('notification_rules')
      .select('id')
      .eq('event_type', eventType)
      .eq('enabled', true)
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
};
