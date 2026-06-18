import type { NewPaymentInput, Payment } from '../../../features/accounting/types';
import { buildPaymentJournalLines } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapPaymentRow, type Row } from './mappers';
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

  /** Payments received from a given customer (the Customers hub). Newest first. */
  async listByCustomer(customerId: string, limit = 200): Promise<Payment[]> {
    const { data, error } = await acct()
      .from('payments')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPaymentRow);
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

    // Record atomically: accounting.record_customer_payment inserts the payment header,
    // posts the receipt JE (lines built above by posting.ts), inserts the applications, and
    // links the JE — all in ONE transaction. So a mid-sequence failure (or a hard client
    // crash) can never leave a posted JE without its applications. The DB guards (balance,
    // over-application) still fire and roll the whole transaction back on violation.
    const { data: paymentId, error } = await acct().rpc('record_customer_payment', {
      p_customer_id: input.customerId,
      p_payment_date: paymentDate,
      p_amount: input.amount,
      p_method: input.method ?? 'other',
      p_reference: input.reference ?? null,
      p_deposit_account_id: depositAccount,
      p_memo: input.memo ?? null,
      p_je_date: paymentDate,
      p_je_memo: `Customer payment${input.reference ? ` (${input.reference})` : ''}`,
      p_lines: jeLines.map((l) => ({
        account_id: l.accountId,
        debit: l.debit,
        credit: l.credit,
        line_memo: l.lineMemo ?? null,
        job_id: l.jobId ?? null,
        customer_id: l.customerId ?? null,
        vendor_id: l.vendorId ?? null,
        class_id: l.classId ?? null,
        location_id: l.locationId ?? null,
        department_id: l.departmentId ?? null,
      })),
      p_applications: input.applications.map((a) => ({
        invoice_id: a.invoiceId,
        amount_applied: a.amountApplied,
      })),
    });
    if (error || !paymentId) {
      return { payment: null, error: error?.message ?? 'Failed to record the payment.' };
    }
    return { payment: await this.getById(paymentId as string) };
  },
};
