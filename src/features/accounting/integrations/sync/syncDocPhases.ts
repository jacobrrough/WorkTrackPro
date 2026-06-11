/**
 * QBO sync — DOCUMENT phases (invoices, bills, estimates, customer payments, vendor
 * bill payments). Runs after the masters phases; order matters within this module:
 * invoices before estimates (conversion links) and before payments (applications);
 * bills before bill payments.
 *
 * Documents persist QBO's EXACT historical money (see qboDocMappers) and post their
 * ledger entries through the same balance-guarded path as in-app documents:
 * buildInvoiceRevenueJournalLines / buildBillExpenseJournalLines + createAndPost, and
 * the atomic record_customer_payment / record_vendor_payment RPCs. A record that
 * can't be made to tie out is failed + logged — never posted approximately.
 *
 * Idempotency: a document whose external_qbo_id already exists is SKIPPED (historical
 * documents don't change; edits surface in the verification report instead).
 */
import { buildBillExpenseJournalLines, buildInvoiceRevenueJournalLines } from '../../posting';
import { acct } from '../../../../services/api/accounting/accountingClient';
import { journalService } from '../../../../services/api/accounting/journal';
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import type { NewJournalLineInput } from '../../types';
import {
  mapQboBill,
  mapQboBillPayment,
  mapQboEstimate,
  mapQboInvoice,
  mapQboPayment,
  type DocLineRow,
  type DocResolvers,
} from './qboDocMappers';
import {
  zeroCounts,
  type PageOutcome,
  type SyncContext,
  type SyncLogLine,
  type SyncPhase,
} from './syncShared';

const dollars = (cents: number): number => Math.round(cents) / 100;

/** Lookup-map adapters → the plain resolver functions the pure mappers take. */
export function resolversFor(ctx: SyncContext): DocResolvers {
  return {
    customerId: (qboId) => (qboId ? (ctx.customers.byQboId.get(qboId) ?? null) : null),
    vendorId: (qboId) => (qboId ? (ctx.vendors.byQboId.get(qboId) ?? null) : null),
    item: (qboId) => (qboId ? (ctx.items.byQboId.get(qboId) ?? null) : null),
    accountId: (qboId) => (qboId ? (ctx.accounts.byQboId.get(qboId) ?? null) : null),
  };
}

/** Insert a header row, retrying ONCE with a suffixed number on a unique collision. */
async function insertWithNumberRetry(
  table: 'invoices' | 'estimates' | 'bills',
  row: Record<string, unknown>,
  numberColumn: 'invoice_number' | 'estimate_number' | 'bill_number',
  qboId: string
): Promise<{ id: string | null; error?: string }> {
  let { data, error } = await acct().from(table).insert(row).select('id').single();
  if (error && /duplicate|unique/i.test(error.message) && row[numberColumn] != null) {
    const retryRow = { ...row, [numberColumn]: `${row[numberColumn]} (QBO ${qboId})` };
    ({ data, error } = await acct().from(table).insert(retryRow).select('id').single());
  }
  if (error || !data) return { id: null, error: error?.message ?? 'insert failed' };
  return { id: String((data as Record<string, unknown>).id) };
}

function invoiceLineRows(invoiceId: string, lines: DocLineRow[]): Record<string, unknown>[] {
  return lines.map((l, i) => ({
    invoice_id: invoiceId,
    item_id: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    line_total: l.lineTotal,
    discount: 0,
    tax_code_id: null,
    taxable: l.taxable,
    income_account_id: l.incomeAccountId,
    job_id: null,
    sort_order: i,
  }));
}

// ── Invoices ─────────────────────────────────────────────────────────────────

const invoicesPhase: SyncPhase = {
  key: 'invoices',
  label: 'Invoices',
  entity: 'Invoice',
  pageSize: 200,
  includeInactive: false,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const r = resolversFor(ctx);

    for (const json of records) {
      const doc = mapQboInvoice(json, r);
      const label = doc.docNumber ? `#${doc.docNumber}` : `QBO ${doc.qboId}`;

      if (doc.qboId && ctx.docs.invoices.has(doc.qboId)) {
        counts.skipped += 1;
        continue;
      }
      if (doc.problem) {
        counts.failed += 1;
        logs.push({
          entity: 'Invoice',
          qboId: doc.qboId || null,
          action: 'error',
          status: 'error',
          message: `${label}: ${doc.problem}`,
        });
        continue;
      }

      const header = {
        invoice_number: doc.docNumber,
        customer_id: doc.customerRowId,
        invoice_date: doc.txnDate,
        due_date: doc.dueDate,
        status: doc.voided ? 'void' : 'sent',
        subtotal: doc.voided ? 0 : dollars(doc.totalCents - doc.taxCents),
        discount_total: 0,
        tax_total: doc.voided ? 0 : dollars(doc.taxCents),
        total: doc.voided ? 0 : dollars(doc.totalCents),
        amount_paid: 0,
        balance_due: doc.voided ? 0 : dollars(doc.totalCents),
        memo: doc.memo,
        notes: doc.notes,
        external_qbo_id: doc.qboId,
      };
      const ins = await insertWithNumberRetry('invoices', header, 'invoice_number', doc.qboId);
      if (!ins.id) {
        counts.failed += 1;
        logs.push({
          entity: 'Invoice',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: ${ins.error}`,
        });
        continue;
      }

      if (doc.lineRows.length > 0) {
        const { error: lErr } = await acct()
          .from('invoice_lines')
          .insert(invoiceLineRows(ins.id, doc.lineRows));
        if (lErr) {
          await acct().from('invoices').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Invoice',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: lines failed — ${lErr.message}`,
          });
          continue;
        }
      }

      // Voided invoices import header-only; nothing posts.
      if (!doc.voided && doc.totals) {
        let je;
        try {
          je = buildInvoiceRevenueJournalLines(doc.totals, ctx.defaults, {
            customerId: doc.customerRowId,
          });
        } catch (e) {
          await acct().from('invoices').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Invoice',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: ${e instanceof Error ? e.message : 'could not build the entry'}`,
          });
          continue;
        }
        const posted = await journalService.createAndPost({
          entryDate: doc.txnDate,
          memo: `Invoice ${doc.docNumber ?? doc.qboId} (QuickBooks)`,
          sourceType: 'invoice',
          sourceId: ins.id,
          lines: je.lines,
        });
        if (!posted.entryId) {
          await acct().from('invoices').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Invoice',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: post failed — ${posted.error}`,
          });
          continue;
        }
        await acct().from('invoices').update({ journal_entry_id: posted.entryId }).eq('id', ins.id);
      }

      ctx.docs.invoices.set(doc.qboId, ins.id);
      counts.created += 1;
      logs.push({
        entity: 'Invoice',
        qboId: doc.qboId,
        action: doc.voided ? 'skip' : 'post',
        message: doc.voided ? `${label}: voided in QuickBooks (header only)` : label,
        recordId: ins.id,
      });
    }

    return { counts, logs };
  },
};

// ── Bills ────────────────────────────────────────────────────────────────────

const billsPhase: SyncPhase = {
  key: 'bills',
  label: 'Bills',
  entity: 'Bill',
  pageSize: 200,
  includeInactive: false,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const r = resolversFor(ctx);

    for (const json of records) {
      const doc = mapQboBill(json, r);
      const label = doc.docNumber ? `#${doc.docNumber}` : `QBO ${doc.qboId}`;

      if (doc.qboId && ctx.docs.bills.has(doc.qboId)) {
        counts.skipped += 1;
        continue;
      }
      if (doc.problem) {
        counts.failed += 1;
        logs.push({
          entity: 'Bill',
          qboId: doc.qboId || null,
          action: 'error',
          status: 'error',
          message: `${label}: ${doc.problem}`,
        });
        continue;
      }

      const header = {
        vendor_id: doc.vendorRowId,
        bill_number: doc.docNumber,
        bill_date: doc.txnDate,
        due_date: doc.dueDate,
        status: doc.voided ? 'void' : 'open',
        subtotal: doc.voided ? 0 : dollars(doc.totals?.subtotalCents ?? 0),
        tax_total: doc.voided ? 0 : dollars(doc.totals?.taxCents ?? 0),
        total: doc.voided ? 0 : dollars(doc.totalCents),
        amount_paid: 0,
        balance_due: doc.voided ? 0 : dollars(doc.totalCents),
        memo: doc.memo,
        external_qbo_id: doc.qboId,
      };
      // bills.bill_number is not unique in the schema, but reuse the retry helper for safety.
      const ins = await insertWithNumberRetry('bills', header, 'bill_number', doc.qboId);
      if (!ins.id) {
        counts.failed += 1;
        logs.push({
          entity: 'Bill',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: ${ins.error}`,
        });
        continue;
      }

      if (doc.lineRows.length > 0) {
        const rows = doc.lineRows.map((l, i) => ({
          bill_id: ins.id,
          account_id: l.accountId,
          item_id: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit_cost: l.unitCost,
          line_total: l.lineTotal,
          job_id: null,
          sort_order: i,
        }));
        const { error: lErr } = await acct().from('bill_lines').insert(rows);
        if (lErr) {
          await acct().from('bills').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Bill',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: lines failed — ${lErr.message}`,
          });
          continue;
        }
      }

      if (!doc.voided && doc.totals) {
        let je;
        try {
          je = buildBillExpenseJournalLines(doc.totals, ctx.defaults, {
            vendorId: doc.vendorRowId,
          });
        } catch (e) {
          await acct().from('bills').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Bill',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: ${e instanceof Error ? e.message : 'could not build the entry'}`,
          });
          continue;
        }
        const posted = await journalService.createAndPost({
          entryDate: doc.txnDate,
          memo: `Bill ${doc.docNumber ?? doc.qboId} (QuickBooks)`,
          sourceType: 'bill',
          sourceId: ins.id,
          lines: je.lines,
        });
        if (!posted.entryId) {
          await acct().from('bills').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Bill',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: post failed — ${posted.error}`,
          });
          continue;
        }
        await acct().from('bills').update({ journal_entry_id: posted.entryId }).eq('id', ins.id);
      }

      ctx.docs.bills.set(doc.qboId, ins.id);
      counts.created += 1;
      logs.push({
        entity: 'Bill',
        qboId: doc.qboId,
        action: doc.voided ? 'skip' : 'post',
        message: doc.voided ? `${label}: voided in QuickBooks (header only)` : label,
        recordId: ins.id,
      });
    }

    return { counts, logs };
  },
};

// ── Estimates (non-posting) ──────────────────────────────────────────────────

const estimatesPhase: SyncPhase = {
  key: 'estimates',
  label: 'Estimates',
  entity: 'Estimate',
  pageSize: 200,
  includeInactive: false,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const r = resolversFor(ctx);

    for (const json of records) {
      const doc = mapQboEstimate(json, r);
      const label = doc.docNumber ? `#${doc.docNumber}` : `QBO ${doc.qboId}`;

      if (doc.qboId && ctx.docs.estimates.has(doc.qboId)) {
        counts.skipped += 1;
        continue;
      }
      if (doc.problem) {
        counts.failed += 1;
        logs.push({
          entity: 'Estimate',
          qboId: doc.qboId || null,
          action: 'error',
          status: 'error',
          message: `${label}: ${doc.problem}`,
        });
        continue;
      }

      const convertedInvoiceId = doc.linkedInvoiceQboId
        ? (ctx.docs.invoices.get(doc.linkedInvoiceQboId) ?? null)
        : null;

      const header = {
        estimate_number: doc.docNumber,
        customer_id: doc.customerRowId,
        estimate_date: doc.txnDate,
        expiry_date: doc.expiryDate,
        status: convertedInvoiceId
          ? 'converted'
          : doc.status === 'converted'
            ? 'accepted'
            : doc.status,
        subtotal: dollars(doc.subtotalCents),
        discount_total: 0,
        tax_total: dollars(doc.taxCents),
        total: dollars(doc.totalCents),
        converted_invoice_id: convertedInvoiceId,
        accepted_at: doc.acceptedAt,
        memo: doc.memo,
        notes: doc.notes,
        external_qbo_id: doc.qboId,
      };
      const ins = await insertWithNumberRetry('estimates', header, 'estimate_number', doc.qboId);
      if (!ins.id) {
        counts.failed += 1;
        logs.push({
          entity: 'Estimate',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: ${ins.error}`,
        });
        continue;
      }

      if (doc.lineRows.length > 0) {
        const rows = doc.lineRows.map((l, i) => ({
          estimate_id: ins.id,
          item_id: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unitPrice,
          line_total: l.lineTotal,
          discount: 0,
          taxable: l.taxable,
          income_account_id: l.incomeAccountId,
          job_id: null,
          sort_order: i,
        }));
        const { error: lErr } = await acct().from('estimate_lines').insert(rows);
        if (lErr) {
          await acct().from('estimates').delete().eq('id', ins.id);
          counts.failed += 1;
          logs.push({
            entity: 'Estimate',
            qboId: doc.qboId,
            action: 'error',
            status: 'error',
            message: `${label}: lines failed — ${lErr.message}`,
          });
          continue;
        }
      }

      ctx.docs.estimates.set(doc.qboId, ins.id);
      counts.created += 1;
      logs.push({
        entity: 'Estimate',
        qboId: doc.qboId,
        action: 'create',
        message: label,
        recordId: ins.id,
      });
    }

    return { counts, logs };
  },
};

// ── Customer payments ────────────────────────────────────────────────────────

const paymentsPhase: SyncPhase = {
  key: 'payments',
  label: 'Customer payments',
  entity: 'Payment',
  pageSize: 200,
  includeInactive: false,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const r = resolversFor(ctx);
    const resolveInvoice = (qboId: string | null) =>
      qboId ? (ctx.docs.invoices.get(qboId) ?? null) : null;

    for (const json of records) {
      const doc = mapQboPayment(json, resolveInvoice, r);
      const label = doc.reference ? `ref ${doc.reference}` : `QBO ${doc.qboId}`;

      if (doc.qboId && ctx.docs.payments.has(doc.qboId)) {
        counts.skipped += 1;
        continue;
      }
      if (doc.problem) {
        // Credit-only applications are expected non-money records → skipped, not failed.
        const benign = doc.problem.startsWith('No money');
        if (benign) {
          counts.skipped += 1;
          logs.push({
            entity: 'Payment',
            qboId: doc.qboId || null,
            action: 'skip',
            message: `${label}: ${doc.problem}`,
          });
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Payment',
            qboId: doc.qboId || null,
            action: 'error',
            status: 'error',
            message: `${label}: ${doc.problem}`,
          });
        }
        continue;
      }

      const depositAccount =
        doc.depositAccountRowId ?? ctx.defaults.undepositedFunds ?? ctx.defaults.cash;
      const arAccount = ctx.defaults.accountsReceivable;
      if (!depositAccount || !arAccount) {
        counts.failed += 1;
        logs.push({
          entity: 'Payment',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: deposit or AR default account is not configured`,
        });
        continue;
      }

      // Ledger truth: Dr deposit / Cr AR for the FULL cash amount (an unapplied
      // remainder stays as customer credit on AR — QBO semantics). Applications may
      // legitimately total less than the amount.
      const amount = dollars(doc.amountCents);
      const jeLines: NewJournalLineInput[] = [
        {
          accountId: depositAccount,
          debit: amount,
          credit: 0,
          lineMemo: 'Customer payment received (QuickBooks)',
          customerId: doc.customerRowId,
        },
        {
          accountId: arAccount,
          debit: 0,
          credit: amount,
          lineMemo: 'Applied to accounts receivable',
          customerId: doc.customerRowId,
        },
      ];

      const { data: paymentId, error } = await acct().rpc('record_customer_payment', {
        p_customer_id: doc.customerRowId,
        p_payment_date: doc.txnDate,
        p_amount: amount,
        p_method: 'other',
        p_reference: doc.reference,
        p_deposit_account_id: depositAccount,
        p_memo: doc.memo,
        p_je_date: doc.txnDate,
        p_je_memo: `Customer payment ${doc.reference ?? doc.qboId} (QuickBooks)`,
        p_lines: jeLines.map((l) => ({
          account_id: l.accountId,
          debit: l.debit,
          credit: l.credit,
          line_memo: l.lineMemo ?? null,
          job_id: null,
          customer_id: l.customerId ?? null,
          vendor_id: null,
          class_id: null,
          location_id: null,
          department_id: null,
        })),
        p_applications: doc.applications.map((a) => ({
          invoice_id: a.invoiceRowId,
          amount_applied: dollars(a.amountCents),
        })),
      });
      if (error || !paymentId) {
        counts.failed += 1;
        logs.push({
          entity: 'Payment',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: ${error?.message ?? 'record failed'}`,
        });
        continue;
      }

      await acct()
        .from('payments')
        .update({ external_qbo_id: doc.qboId })
        .eq('id', paymentId as string);

      ctx.docs.payments.add(doc.qboId);
      counts.created += 1;
      const notes: string[] = [];
      if (doc.creditPortionCents > 0) {
        notes.push(`credit-memo portion ${dollars(doc.creditPortionCents)} not allocated`);
      }
      if (doc.unresolvedInvoiceQboIds.length > 0) {
        notes.push(`unresolved invoices: ${doc.unresolvedInvoiceQboIds.join(', ')}`);
      }
      logs.push({
        entity: 'Payment',
        qboId: doc.qboId,
        action: 'apply',
        message: notes.length ? `${label} — ${notes.join('; ')}` : label,
        recordId: paymentId as string,
      });
    }

    return { counts, logs };
  },
};

// ── Vendor bill payments ─────────────────────────────────────────────────────

const billPaymentsPhase: SyncPhase = {
  key: 'billPayments',
  label: 'Vendor payments',
  entity: 'BillPayment',
  pageSize: 200,
  includeInactive: false,
  async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const r = resolversFor(ctx);
    const resolveBill = (qboId: string | null) =>
      qboId ? (ctx.docs.bills.get(qboId) ?? null) : null;

    for (const json of records) {
      const doc = mapQboBillPayment(json, resolveBill, r);
      const label = doc.reference ? `#${doc.reference}` : `QBO ${doc.qboId}`;

      if (doc.qboId && ctx.docs.vendorPayments.has(doc.qboId)) {
        counts.skipped += 1;
        continue;
      }
      if (doc.problem) {
        const benign = doc.problem.startsWith('No money');
        if (benign) {
          counts.skipped += 1;
          logs.push({
            entity: 'BillPayment',
            qboId: doc.qboId || null,
            action: 'skip',
            message: `${label}: ${doc.problem}`,
          });
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'BillPayment',
            qboId: doc.qboId || null,
            action: 'error',
            status: 'error',
            message: `${label}: ${doc.problem}`,
          });
        }
        continue;
      }

      const payFromAccount = doc.payFromAccountRowId ?? ctx.defaults.cash;
      const apAccount = ctx.defaults.accountsPayable;
      if (!payFromAccount || !apAccount) {
        counts.failed += 1;
        logs.push({
          entity: 'BillPayment',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: pay-from or AP default account is not configured`,
        });
        continue;
      }

      const amount = dollars(doc.amountCents);
      const jeLines: NewJournalLineInput[] = [
        {
          accountId: apAccount,
          debit: amount,
          credit: 0,
          lineMemo: 'Applied to accounts payable',
          vendorId: doc.vendorRowId,
        },
        {
          accountId: payFromAccount,
          debit: 0,
          credit: amount,
          lineMemo: 'Vendor payment paid (QuickBooks)',
          vendorId: doc.vendorRowId,
        },
      ];

      const { data: paymentId, error } = await acct().rpc('record_vendor_payment', {
        p_vendor_id: doc.vendorRowId,
        p_payment_date: doc.txnDate,
        p_amount: amount,
        p_method: 'other',
        p_reference: doc.reference,
        p_pay_from_account_id: payFromAccount,
        p_memo: doc.memo,
        p_je_date: doc.txnDate,
        p_je_memo: `Vendor payment ${doc.reference ?? doc.qboId} (QuickBooks)`,
        p_lines: jeLines.map((l) => ({
          account_id: l.accountId,
          debit: l.debit,
          credit: l.credit,
          line_memo: l.lineMemo ?? null,
          job_id: null,
          customer_id: null,
          vendor_id: l.vendorId ?? null,
          class_id: null,
          location_id: null,
          department_id: null,
        })),
        p_applications: doc.applications.map((a) => ({
          bill_id: a.billRowId,
          amount_applied: dollars(a.amountCents),
        })),
      });
      if (error || !paymentId) {
        counts.failed += 1;
        logs.push({
          entity: 'BillPayment',
          qboId: doc.qboId,
          action: 'error',
          status: 'error',
          message: `${label}: ${error?.message ?? 'record failed'}`,
        });
        continue;
      }

      await acct()
        .from('vendor_payments')
        .update({ external_qbo_id: doc.qboId })
        .eq('id', paymentId as string);

      ctx.docs.vendorPayments.add(doc.qboId);
      counts.created += 1;
      const notes: string[] = [];
      if (doc.unresolvedBillQboIds.length > 0) {
        notes.push(`unresolved bills: ${doc.unresolvedBillQboIds.join(', ')}`);
      }
      logs.push({
        entity: 'BillPayment',
        qboId: doc.qboId,
        action: 'apply',
        message: notes.length ? `${label} — ${notes.join('; ')}` : label,
        recordId: paymentId as string,
      });
    }

    return { counts, logs };
  },
};

/** Document phases, in dependency order. */
export const DOC_PHASES: SyncPhase[] = [
  invoicesPhase,
  billsPhase,
  estimatesPhase,
  paymentsPhase,
  billPaymentsPhase,
];
