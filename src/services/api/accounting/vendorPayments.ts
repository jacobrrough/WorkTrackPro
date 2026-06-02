import type {
  NewVendorPaymentInput,
  VendorPayment,
} from '../../../features/accounting/types';
import { buildVendorPaymentJournalLines } from '../../../features/accounting/posting';
import { acct } from './accountingClient';
import { mapVendorPaymentRow, type Row } from './mappers';
import { journalService } from './journal';
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

    // 1) Insert the payment header (unapplied_amount starts at the full amount; the
    //    application trigger reduces it as applications are inserted).
    const { data: payRow, error: pErr } = await acct()
      .from('vendor_payments')
      .insert({
        vendor_id: input.vendorId,
        payment_date: paymentDate,
        amount: input.amount,
        method: input.method ?? 'other',
        reference: input.reference ?? null,
        pay_from_account_id: payFromAccount,
        unapplied_amount: input.amount,
        memo: input.memo ?? null,
      })
      .select('*')
      .single();
    if (pErr || !payRow) return { payment: null, error: pErr?.message ?? 'Failed to create payment.' };
    const paymentId = (payRow as Row).id as string;

    // 2) Post the disbursement JE.
    const posted = await journalService.createAndPost({
      entryDate: paymentDate,
      memo: `Vendor payment ${input.reference ? `(${input.reference})` : paymentId}`,
      sourceType: 'vendor_payment',
      sourceId: paymentId,
      lines: jeLines,
    });
    if (!posted.entryId) {
      await acct().from('vendor_payments').delete().eq('id', paymentId);
      return { payment: null, error: posted.error ?? 'Failed to post the disbursement journal entry.' };
    }

    // 3) Insert applications (trigger updates bills + payment.unapplied_amount and
    //    rejects over-application).
    const appRows = input.applications.map((a) => ({
      vendor_payment_id: paymentId,
      bill_id: a.billId,
      amount_applied: a.amountApplied,
    }));
    const { error: aErr } = await acct().from('vendor_payment_applications').insert(appRows);
    if (aErr) {
      await journalService.voidEntry(posted.entryId, 'Vendor payment application failed');
      await acct().from('vendor_payments').delete().eq('id', paymentId);
      return { payment: null, error: aErr.message };
    }

    // 4) Link the JE onto the payment.
    const { error: lErr } = await acct()
      .from('vendor_payments')
      .update({ journal_entry_id: posted.entryId })
      .eq('id', paymentId);
    if (lErr) {
      // Non-fatal for accounting integrity (the JE & applications stand); surface it.
      return { payment: await this.getById(paymentId), error: lErr.message };
    }
    return { payment: await this.getById(paymentId) };
  },
};
