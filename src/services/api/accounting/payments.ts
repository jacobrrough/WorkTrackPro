import type { NewPaymentInput, Payment } from '../../../features/accounting/types';
import { buildPaymentJournalLines } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapPaymentRow, type Row } from './mappers';
import { journalService } from './journal';
import { accountingSettingsService } from './settings';

/**
 * Customer payments (accounting.payments + payment_applications). Recording a
 * payment posts a BALANCED receipt journal entry through
 * accounting.post_journal_entry (Dr 1000 Cash | 1050 Undeposited Funds /
 * Cr 1200 Accounts Receivable), inserts the payment and its applications (the DB
 * `sync_invoice_payment` trigger then rolls each invoice's amount_paid/balance_due/
 * status and rejects over-application), and links journal_entry_id back.
 *
 * Reads throw; the create path returns a result object carrying the DB error so the
 * UI can surface a rejection (e.g. over-application) without leaving orphans —
 * failures roll back the payment row and void the posted entry.
 */
export const paymentsService = {
  async list(limit = 200): Promise<Payment[]> {
    const { data, error } = await acct()
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPaymentRow);
  },

  async getById(id: string): Promise<Payment | null> {
    const { data, error } = await acct()
      .from('payments')
      .select('*, applications:payment_applications(*)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapPaymentRow(data as Row);
  },

  /** Payments applied to a given invoice (for the invoice detail screen). */
  async listForInvoice(invoiceId: string): Promise<Payment[]> {
    const { data, error } = await acct()
      .from('payment_applications')
      .select('payment:payments(*)')
      .eq('invoice_id', invoiceId);
    if (error) throw error;
    const rows = ((data ?? []) as Row[])
      .map((r) => (r.payment ?? null) as Row | null)
      .filter((p): p is Row => p != null);
    return rows.map(mapPaymentRow);
  },

  /**
   * Record a customer payment fully applied to one or more invoices. Posts the
   * receipt JE, then writes the payment + applications. On any failure after the JE
   * posts, the entry is voided and the payment row removed so no half-states leak.
   * If the compensating void/delete itself fails, the rows are left in place and the
   * error names the orphaned id so it can be reconciled by hand (better than
   * silently abandoning a posted entry on the ledger).
   */
  async record(input: NewPaymentInput): Promise<{ payment: Payment | null; error?: string }> {
    if (!input.applications.length) {
      return { payment: null, error: 'Apply the payment to at least one invoice.' };
    }
    const defaults = await accountingSettingsService.getDefaultAccounts();
    const depositAccount =
      input.depositAccountId ?? defaults.undepositedFunds ?? defaults.cash ?? null;

    let jeLines;
    try {
      jeLines = buildPaymentJournalLines({
        amount: input.amount,
        depositAccountId: depositAccount,
        accountsReceivableId: defaults.accountsReceivable,
        applications: input.applications,
        customerId: input.customerId,
      });
    } catch (e) {
      return {
        payment: null,
        error: e instanceof Error ? e.message : 'Unable to build the receipt entry.',
      };
    }

    const paymentDate = input.paymentDate ?? new Date().toISOString().slice(0, 10);

    // 1) Insert the payment header (unapplied_amount starts at the full amount; the
    //    application trigger reduces it as applications are inserted).
    const { data: payRow, error: pErr } = await acct()
      .from('payments')
      .insert({
        customer_id: input.customerId,
        payment_date: paymentDate,
        amount: input.amount,
        method: input.method ?? 'other',
        reference: input.reference ?? null,
        deposit_account_id: depositAccount,
        unapplied_amount: input.amount,
        memo: input.memo ?? null,
      })
      .select('*')
      .single();
    if (pErr || !payRow)
      return { payment: null, error: pErr?.message ?? 'Failed to create payment.' };
    const paymentId = (payRow as Row).id as string;

    // 2) Post the receipt JE.
    const posted = await journalService.createAndPost({
      entryDate: paymentDate,
      memo: `Customer payment ${input.reference ? `(${input.reference})` : paymentId}`,
      sourceType: 'payment',
      sourceId: paymentId,
      lines: jeLines,
    });
    if (!posted.entryId) {
      // The post failed, so createAndPost already removed its own draft entry — there
      // is no posted JE to void here, only the orphan payment header to clean up. If
      // that delete fails, surface the dangling paymentId rather than swallowing it.
      const { error: cleanupErr } = await acct().from('payments').delete().eq('id', paymentId);
      if (cleanupErr) {
        return {
          payment: null,
          error: `Failed to post the receipt journal entry (${posted.error ?? 'unknown error'}) and could not remove the orphan payment ${paymentId}: ${cleanupErr.message}`,
        };
      }
      return { payment: null, error: posted.error ?? 'Failed to post the receipt journal entry.' };
    }

    // 3) Insert applications (trigger updates invoices + payment.unapplied_amount and
    //    rejects over-application).
    const appRows = input.applications.map((a) => ({
      payment_id: paymentId,
      invoice_id: a.invoiceId,
      amount_applied: a.amountApplied,
    }));
    const { error: aErr } = await acct().from('payment_applications').insert(appRows);
    if (aErr) {
      // Void the posted JE before removing the payment. If the void fails we must
      // NOT delete the payment: leaving both rows keeps the orphaned (still-posted)
      // entry traceable to its source document for manual cleanup, instead of
      // silently abandoning a posted JE on the ledger with no payment to point at.
      const v = await journalService.voidEntry(posted.entryId, 'Payment application failed');
      if (!v.ok) {
        return {
          payment: null,
          error: `Payment recorded but cleanup failed — manual review required (orphaned journal entry ${posted.entryId}): ${v.error ?? 'unknown error'}. Original failure: ${aErr.message}`,
        };
      }
      await acct().from('payments').delete().eq('id', paymentId);
      return { payment: null, error: aErr.message };
    }

    // 4) Link the JE onto the payment.
    const { error: lErr } = await acct()
      .from('payments')
      .update({ journal_entry_id: posted.entryId })
      .eq('id', paymentId);
    if (lErr) {
      // Non-fatal for accounting integrity (the JE & applications stand); surface it.
      return { payment: await this.getById(paymentId), error: lErr.message };
    }
    return { payment: await this.getById(paymentId) };
  },
};
