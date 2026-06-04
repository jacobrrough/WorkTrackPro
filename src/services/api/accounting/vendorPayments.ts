import type { NewVendorPaymentInput, VendorPayment } from '../../../features/accounting/types';
import { buildVendorPaymentJournalLines } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapVendorPaymentRow, type Row } from './mappers';
import { accountingSettingsService } from './settings';

/**
 * Vendor payments (accounting.vendor_payments + vendor_payment_applications).
 * Recording a payment posts a BALANCED disbursement journal entry through
 * accounting.post_journal_entry (Dr 2000 Accounts Payable / Cr 1000 Cash | bank),
 * inserts the payment and its applications (the DB `sync_bill_payment` trigger then
 * rolls each bill's amount_paid/balance_due/status and rejects over-application), and
 * links journal_entry_id back.
 *
 * Reads throw; the record path returns a result object carrying the DB error so the
 * UI can surface a rejection (e.g. over-application) without leaving orphans —
 * failures roll back the payment row and void the posted entry.
 */
export const vendorPaymentsService = {
  async list(limit = 200): Promise<VendorPayment[]> {
    const { data, error } = await acct()
      .from('vendor_payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapVendorPaymentRow);
  },

  async getById(id: string): Promise<VendorPayment | null> {
    const { data, error } = await acct()
      .from('vendor_payments')
      .select('*, applications:vendor_payment_applications(*)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapVendorPaymentRow(data as Row);
  },

  /** Payments applied to a given bill (for the bill detail screen). */
  async listForBill(billId: string): Promise<VendorPayment[]> {
    const { data, error } = await acct()
      .from('vendor_payment_applications')
      .select('payment:vendor_payments(*)')
      .eq('bill_id', billId);
    if (error) throw error;
    const rows = ((data ?? []) as Row[])
      .map((r) => (r.payment ?? null) as Row | null)
      .filter((p): p is Row => p != null);
    return rows.map(mapVendorPaymentRow);
  },

  /**
   * Record a vendor payment fully applied to one or more bills. Posts the
   * disbursement JE, then writes the payment + applications. On any failure after the
   * JE posts, the entry is voided and the payment row removed so no half-states leak.
   */
  async record(
    input: NewVendorPaymentInput
  ): Promise<{ payment: VendorPayment | null; error?: string }> {
    if (!input.applications.length) {
      return { payment: null, error: 'Apply the payment to at least one bill.' };
    }
    const defaults = await accountingSettingsService.getDefaultAccounts();
    const payFromAccount = input.payFromAccountId ?? defaults.cash ?? null;

    let jeLines;
    try {
      jeLines = buildVendorPaymentJournalLines({
        amount: input.amount,
        payFromAccountId: payFromAccount,
        accountsPayableId: defaults.accountsPayable,
        applications: input.applications,
        vendorId: input.vendorId,
      });
    } catch (e) {
      return {
        payment: null,
        error: e instanceof Error ? e.message : 'Unable to build the disbursement entry.',
      };
    }

    const paymentDate = input.paymentDate ?? new Date().toISOString().slice(0, 10);

    // Record atomically: accounting.record_vendor_payment inserts the payment header, posts
    // the disbursement JE (lines built above by posting.ts), inserts the applications, and
    // links the JE — all in ONE transaction. So a mid-sequence failure (or a hard client
    // crash) can never leave a posted JE without its applications. The DB guards (balance,
    // over-application) still fire and roll the whole transaction back on violation.
    const { data: paymentId, error } = await acct().rpc('record_vendor_payment', {
      p_vendor_id: input.vendorId,
      p_payment_date: paymentDate,
      p_amount: input.amount,
      p_method: input.method ?? 'other',
      p_reference: input.reference ?? null,
      p_pay_from_account_id: payFromAccount,
      p_memo: input.memo ?? null,
      p_je_date: paymentDate,
      p_je_memo: `Vendor payment${input.reference ? ` (${input.reference})` : ''}`,
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
        bill_id: a.billId,
        amount_applied: a.amountApplied,
      })),
    });
    if (error || !paymentId) {
      return { payment: null, error: error?.message ?? 'Failed to record the payment.' };
    }
    return { payment: await this.getById(paymentId as string) };
  },
};
