import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useSettings } from '@/contexts/SettingsContext';
import { AccountingShell } from '../components/AccountingShell';
import { AccountingDrawer } from '../components/AccountingDrawer';
import { CurrencyInput } from '../components/CurrencyInput';
import { CustomFieldsSection } from '../components/CustomFieldsSection';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { DocumentActivityPanel } from '../components/DocumentActivityPanel';
import { DocumentSentBadge } from '../components/DocumentSentBadge';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import JobLinkControl from '../jobs/JobLinkControl';
import {
  useCustomer,
  useCustomers,
  useInvoice,
  useInvoiceEmails,
  useInvoicePayments,
  useTaxCodes,
} from '../hooks/useAccountingQueries';
import {
  useCreatePortalLink,
  useDeleteInvoiceDraft,
  useEditPostedInvoice,
  useRecordPayment,
  useSendInvoice,
  useSendInvoiceEmail,
  useSetInvoiceNumber,
  useVoidAndReissueInvoice,
  useVoidInvoice,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import SalesDocument from '../documents/SalesDocument';
import { invoiceToSalesDocumentData } from '../documents/salesDocumentMappers';
import { resolveTemplateConfig } from '../documents/templateConfig';
import { exportSalesDocumentPdf } from '../documents/exportSalesDocumentPdf';
import { salesDocumentFilenameBase } from '../documents/salesDocumentTypes';
import { useSalesDocumentEditor } from '../documents/useSalesDocumentEditor';
import SalesLineItemsEditor from '../documents/SalesLineItemsEditor';
import { SalesDocumentHeader } from '../documents/form/SalesDocumentHeader';
import { SalesDocumentTotalsPanel } from '../documents/form/SalesDocumentTotalsPanel';
import { SalesDocumentMessages } from '../documents/form/SalesDocumentMessages';
import { docInputClass } from '../documents/form/salesFormUi';
import {
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceEmail,
  type PaymentMethod,
  type UpdateInvoiceInput,
} from '../types';

const inputClass =
  'w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Per-status color for an invoice_emails row (the #6 email history list). */
const EMAIL_STATUS_STYLES: Record<InvoiceEmail['status'], string> = {
  queued: 'text-muted',
  sent: 'text-green-400',
  failed: 'text-red-400',
  bounced: 'text-red-400',
};

/** Describe one email log row, e.g. "Reminder (+7d)" or "Manual send". */
function emailKindLabel(email: InvoiceEmail): string {
  if (email.kind === 'reminder') {
    const off = email.reminderOffsetDays;
    if (off == null) return 'Reminder';
    const rel = off === 0 ? 'on due date' : off > 0 ? `+${off}d` : `${off}d`;
    return `Reminder (${rel})`;
  }
  return 'Manual send';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dialog to record a customer payment fully applied to this one invoice. */
function RecordPaymentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const recordPayment = useRecordPayment();
  const [amount, setAmount] = useState(invoice.balanceDue);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const overBalance = amount > invoice.balanceDue + 0.005;

  const submit = async () => {
    setError(null);
    if (amount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (overBalance) {
      setError(
        `Amount exceeds the balance due (${formatMoney(invoice.balanceDue)}). Phase A applies each payment fully to its invoice.`
      );
      return;
    }
    const res = await recordPayment.mutateAsync({
      customerId: invoice.customerId,
      paymentDate,
      amount,
      method,
      reference: reference.trim() || null,
      applications: [{ invoiceId: invoice.id, amountApplied: amount }],
    });
    if (res.error || !res.payment) {
      setError(res.error ?? 'Could not record the payment.');
      return;
    }
    onClose();
  };

  return (
    <AccountingDrawer
      open
      onClose={onClose}
      title="Record Payment"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={recordPayment.isPending || amount <= 0 || overBalance}>
            {recordPayment.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Balance due{' '}
        <span className="font-mono font-bold text-white">{formatMoney(invoice.balanceDue)}</span>.
        Posts a balanced receipt entry (Dr Cash / Cr Accounts Receivable).
      </p>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Amount" htmlFor="pay-amount" required>
            <CurrencyInput
              id="pay-amount"
              aria-label="Payment amount"
              value={amount}
              onValueChange={setAmount}
            />
          </FormField>
          <FormField label="Date" htmlFor="pay-date">
            <input
              id="pay-date"
              type="date"
              className={inputClass}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Method" htmlFor="pay-method">
            <select
              id="pay-method"
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reference" htmlFor="pay-ref" hint="Check # or txn id">
            <input
              id="pay-ref"
              className={inputClass}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
            />
          </FormField>
        </div>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </AccountingDrawer>
  );
}

/**
 * Dialog to email this invoice to the customer (#6). Mirrors RecordPaymentModal. The
 * recipient is prefilled from the customer's email; the server mints a portal link and
 * sends the email via Resend, then logs an invoice_emails row. We never assume success —
 * a server error stays in the dialog so the admin sees why.
 */
function EmailInvoiceModal({
  invoice,
  defaultEmail,
  onClose,
}: {
  invoice: Invoice;
  defaultEmail: string;
  onClose: () => void;
}) {
  const sendEmail = useSendInvoiceEmail();
  const [toEmail, setToEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = toEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid recipient email address.');
      return;
    }
    const res = await sendEmail.mutateAsync({
      invoiceId: invoice.id,
      opts: { toEmail: trimmed, subject: subject.trim() || undefined, scope: 'invoice' },
    });
    if (!res.ok) {
      setError(res.error ?? 'Could not send the invoice email.');
      return;
    }
    setSentTo(res.toEmail ?? trimmed);
  };

  return (
    <AccountingDrawer
      open
      onClose={onClose}
      title="Email invoice"
      footer={
        sentTo ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={sendEmail.isPending}>
              {sendEmail.isPending ? 'Sending…' : 'Send email'}
            </Button>
          </div>
        )
      }
    >
      {sentTo ? (
        <p className="text-sm text-muted">
          Invoice emailed to <span className="font-semibold text-white">{sentTo}</span> with a
          secure portal link.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Sends invoice{' '}
            <span className="font-semibold text-white">{invoice.invoiceNumber ?? 'Draft'}</span>{' '}
            with a secure link the customer can use to view and download it. No payment is taken.
          </p>

          <FormField label="To" htmlFor="email-to" required>
            <input
              id="email-to"
              type="email"
              className={inputClass}
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="customer@example.com"
            />
          </FormField>
          <FormField label="Subject" htmlFor="email-subject" hint="Optional — a default is used">
            <input
              id="email-subject"
              className={inputClass}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={`Invoice ${invoice.invoiceNumber ?? ''}`.trim()}
            />
          </FormField>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </AccountingDrawer>
  );
}

/**
 * In-place editor for an invoice — works at ANY editable status (the editor is the default landing
 * view). Mounted keyed by invoice id so each open re-seeds the header + lines; Cancel just unmounts.
 * Saves through useEditPostedInvoice, which routes a draft to updateDraft and a POSTED invoice
 * through editPosted (reverse + re-post on a financial change, header-only when ledger-neutral). A
 * server rejection (payments applied, closed period, etc.) stays inline.
 */
function InvoiceEditPanel({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const editor = useSalesDocumentEditor('invoice', invoice);
  const saveEdits = useEditPostedInvoice();
  const { data: customers = [] } = useCustomers();
  const { data: taxCodes = [] } = useTaxCodes();
  const [error, setError] = useState<string | null>(null);
  const isPosted = invoice.status !== 'draft';
  const hasPayments = invoice.amountPaid > 0;
  const defaultTaxCode = taxCodes.find((t) => t.isDefault) ?? null;
  const busy = saveEdits.isPending;

  const save = async () => {
    setError(null);
    // Editing a posted invoice re-posts its ledger entry when amounts change — confirm first.
    if (
      isPosted &&
      !window.confirm(
        'Save changes to this sent invoice? If any amounts changed, its journal entry is reversed and re-posted automatically.'
      )
    ) {
      return;
    }
    const res = await saveEdits.mutateAsync({
      id: invoice.id,
      // kind='invoice' guarantees the invoice branch of the editor's return union.
      input: editor.toUpdateInput() as UpdateInvoiceInput,
    });
    if (res.error || !res.invoice) {
      setError(res.error ?? 'Could not save the invoice.');
      return;
    }
    onClose();
  };

  return (
    <div className="flex flex-col gap-4">
      {hasPayments && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This invoice has payments applied — you can edit text and dates, but changing the amounts
          requires unapplying the payments first (or use void &amp; reissue).
        </p>
      )}

      <SalesDocumentHeader
        kind="invoice"
        docNumber={invoice.invoiceNumber}
        customerSlot={
          <select
            id="invoice-customer"
            className={docInputClass}
            value={editor.customerId}
            onChange={(e) => editor.setCustomerId(e.target.value)}
            disabled={busy}
          >
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.taxExempt ? ' (tax-exempt)' : ''}
              </option>
            ))}
          </select>
        }
        primaryDateLabel="Invoice date"
        primaryDate={editor.date}
        onPrimaryDate={editor.setDate}
        secondaryDateLabel="Due date"
        secondaryDate={editor.secondaryDate}
        onSecondaryDate={editor.setSecondaryDate}
        terms={editor.terms}
        onTerms={editor.setTerms}
        disabled={busy}
      />

      <SalesLineItemsEditor
        lines={editor.lines}
        onChange={editor.setLines}
        lineAmountsCents={editor.totals.lines.map((l) => l.netCents)}
        disabled={busy}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SalesDocumentMessages
          kind="invoice"
          notes={editor.notes}
          onNotes={editor.setNotes}
          memo={editor.memo}
          onMemo={editor.setMemo}
          disabled={busy}
        />
        <SalesDocumentTotalsPanel
          kind="invoice"
          totals={editor.totals}
          taxCodes={taxCodes}
          taxCodeId={editor.taxCodeId}
          onTaxCodeId={editor.setTaxCodeId}
          hasDefaultTaxCode={!!defaultTaxCode}
          disabled={busy}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {error && (
          <p className="mr-auto text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button icon="save" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export default function InvoiceDetailView() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isPending, isError } = useInvoice(invoiceId);
  const { data: payments = [] } = useInvoicePayments(invoiceId);
  const { data: emails = [] } = useInvoiceEmails(invoiceId);
  const { data: customer } = useCustomer(invoice?.customerId);
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const voidAndReissue = useVoidAndReissueInvoice();
  const deleteDraft = useDeleteInvoiceDraft();
  const setInvoiceNumber = useSetInvoiceNumber();
  const createPortalLink = useCreatePortalLink();
  const { settings } = useSettings();
  const printRef = useRef<HTMLDivElement>(null);
  // Land directly in the live editor (QuickBooks-style); Preview toggles to the read-only paper.
  // A void invoice is never editable, so it always shows the read-only document.
  const [editing, setEditing] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Org branding → fully-defaulted template for the shared <SalesDocument /> paper.
  const template = resolveTemplateConfig(settings.branding);

  const onDownloadPdf = async () => {
    if (!invoice) return;
    setActionError(null);
    // The PDF rasterizes the read-only paper (printRef), so make sure we're in Preview (not the
    // editor) before capturing — otherwise printRef isn't mounted.
    setEditing(false);
    setDownloading(true);
    try {
      // Wait two frames for the preview to mount + lay out before capture (avoids a blank PDF).
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      if (!printRef.current) throw new Error('preview not ready');
      await exportSalesDocumentPdf(
        printRef.current,
        salesDocumentFilenameBase({ kind: 'invoice', number: invoice.invoiceNumber })
      );
    } catch {
      setActionError('Could not generate the invoice PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const onCreatePortalLink = async () => {
    if (!invoice) return;
    setActionError(null);
    setPortalLink(null);
    const res = await createPortalLink.mutateAsync({
      customerId: invoice.customerId,
      scope: 'invoice',
      invoiceId: invoice.id,
      // Default to a 30-day link; the customer can request a fresh one if it lapses.
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    if (res.error || !res.link) {
      setActionError(res.error ?? 'Could not create a portal link.');
      return;
    }
    setPortalLink(res.link);
  };

  const onSend = async () => {
    if (!invoice) return;
    setActionError(null);
    const res = await sendInvoice.mutateAsync(invoice.id);
    if (res.error) setActionError(res.error);
  };

  // Manually override this invoice's number (for reconciling against QuickBooks). Numbers are
  // auto-assigned and sequential; this is the deliberate by-hand correction.
  const onEditNumber = async () => {
    if (!invoice) return;
    const next = window.prompt(
      'Invoice number — override for QuickBooks reconciliation:',
      invoice.invoiceNumber ?? ''
    );
    if (next == null) return;
    setActionError(null);
    const res = await setInvoiceNumber.mutateAsync({ id: invoice.id, number: next });
    if (!res.ok) setActionError(res.error ?? 'Could not update the invoice number.');
  };

  const onVoid = async () => {
    if (!invoice) return;
    const reason = window.prompt('Reason for voiding this invoice?');
    if (reason == null) return;
    setActionError(null);
    const res = await voidInvoice.mutateAsync({
      id: invoice.id,
      reason: reason.trim() || 'Voided',
    });
    if (!res.ok) setActionError(res.error ?? 'Could not void the invoice.');
  };

  // Void this posted invoice (reversing its JE) and open the freshly minted draft so the
  // admin can correct it. Only offered before any payment lands; confirm first since it
  // touches the ledger.
  const onVoidAndReissue = async () => {
    if (!invoice) return;
    const ok = window.confirm(
      `This voids invoice ${invoice.invoiceNumber ?? 'Draft'} (reversing its posted entry) and opens a new editable draft. Continue?`
    );
    if (!ok) return;
    setActionError(null);
    const res = await voidAndReissue.mutateAsync(invoice.id);
    if (res.error || !res.invoiceId) {
      setActionError(res.error ?? 'Could not void and reissue the invoice.');
      return;
    }
    navigate(`${ACCOUNTING_BASE}/invoices/${res.invoiceId}`);
  };

  // Permanently delete a DRAFT (nothing posted yet); posted invoices use Void instead.
  const onDelete = async () => {
    if (!invoice) return;
    const ok = window.confirm(
      `Delete draft invoice ${invoice.invoiceNumber ?? 'Draft'}? This permanently removes it. Drafts post nothing to the ledger.`
    );
    if (!ok) return;
    setActionError(null);
    const res = await deleteDraft.mutateAsync(invoice.id);
    if (!res.ok) {
      setActionError(res.error ?? 'Could not delete the invoice.');
      return;
    }
    navigate(`${ACCOUNTING_BASE}/invoices`);
  };

  const canSend = invoice?.status === 'draft';
  const canPay =
    invoice != null &&
    (invoice.status === 'sent' || invoice.status === 'partially_paid') &&
    invoice.balanceDue > 0;
  // Void is for POSTED invoices (drafts are removed with Delete instead).
  const canVoid =
    invoice != null &&
    invoice.status !== 'void' &&
    invoice.status !== 'draft' &&
    invoice.amountPaid === 0;
  // Void & reissue: a posted (non-draft) invoice with nothing paid yet can be reversed and
  // re-opened as a draft for correction.
  const canReissue =
    invoice != null &&
    invoice.status !== 'draft' &&
    invoice.status !== 'void' &&
    invoice.amountPaid === 0;
  // Email + portal link are available once the invoice has been sent (it has an invoice
  // number + a posted JE), and never for a voided invoice.
  const canEmail = invoice != null && invoice.status !== 'draft' && invoice.status !== 'void';
  // Every non-void invoice is editable in place (a void one is read-only — reissue instead).
  const isEditable = invoice != null && invoice.status !== 'void';
  const taxShown = (invoice?.taxTotal ?? 0) > 0;

  return (
    <AccountingShell
      active="invoices"
      title={invoice ? `Invoice ${invoice.invoiceNumber ?? 'Draft'}` : 'Invoice'}
      actions={
        invoice ? (
          <div className="flex flex-wrap gap-2">
            {isEditable && (
              <Button
                size="sm"
                variant="secondary"
                icon={editing ? 'visibility' : 'edit'}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? 'Preview' : 'Edit'}
              </Button>
            )}
            {invoice.status === 'draft' && (
              <Button
                size="sm"
                variant="danger"
                icon="delete"
                onClick={onDelete}
                disabled={deleteDraft.isPending}
              >
                {deleteDraft.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            )}
            {canSend && (
              <Button size="sm" icon="send" onClick={onSend} disabled={sendInvoice.isPending}>
                {sendInvoice.isPending ? 'Sending…' : 'Send'}
              </Button>
            )}
            {canPay && (
              <Button size="sm" icon="payments" onClick={() => setShowPayment(true)}>
                Record payment
              </Button>
            )}
            {canEmail && (
              <Button size="sm" variant="secondary" icon="mail" onClick={() => setShowEmail(true)}>
                Email invoice
              </Button>
            )}
            {canEmail && (
              <Button
                size="sm"
                variant="secondary"
                icon="link"
                onClick={onCreatePortalLink}
                disabled={createPortalLink.isPending}
              >
                {createPortalLink.isPending ? 'Creating…' : 'Create portal link'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              onClick={onDownloadPdf}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : 'Download PDF'}
            </Button>
            {canReissue && (
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={onVoidAndReissue}
                disabled={voidAndReissue.isPending}
              >
                {voidAndReissue.isPending ? 'Reissuing…' : 'Edit (void & reissue)'}
              </Button>
            )}
            {canVoid && (
              <Button size="sm" variant="danger" onClick={onVoid} disabled={voidInvoice.isPending}>
                {voidInvoice.isPending ? 'Voiding…' : 'Void'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-muted">Loading invoice…</p>}
      {isError && <p className="text-red-400">Could not load this invoice.</p>}
      {!isPending && !isError && !invoice && <p className="text-muted">Invoice not found.</p>}

      {invoice && (
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {taxShown && <TaxDisclaimer />}

          {/* Sent-version indicator: does the customer hold the current copy? Re-send opens email. */}
          <DocumentSentBadge
            documentType="invoice"
            documentId={invoice.id}
            status={invoice.status}
            onResend={canEmail ? () => setShowEmail(true) : undefined}
          />

          {/* Document number — auto-assigned & sequential, with a by-hand override for QuickBooks
              reconciliation (a void invoice is read-only). */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Invoice #</span>
            <span className="font-mono font-semibold text-white">
              {invoice.invoiceNumber ?? '—'}
            </span>
            {invoice.status !== 'void' && (
              <button
                type="button"
                onClick={onEditNumber}
                disabled={setInvoiceNumber.isPending}
                className="text-xs font-semibold text-primary hover:text-primary-hover disabled:opacity-50"
              >
                {setInvoiceNumber.isPending ? 'Saving…' : 'Edit number'}
              </button>
            )}
          </div>

          {editing && isEditable ? (
            // The live editor is the default landing view; remounting per invoice id re-seeds it,
            // so Cancel/Preview simply unmounts and discards local edits.
            <InvoiceEditPanel
              key={invoice.id}
              invoice={invoice}
              onClose={() => setEditing(false)}
            />
          ) : (
            /* The branded read-only "paper" (Preview / what the customer sees). printRef is what
               Download PDF rasterizes, so it must be mounted to export. */
            <div className="overflow-hidden rounded-lg shadow-lg">
              <SalesDocument
                ref={printRef}
                data={invoiceToSalesDocumentData(invoice)}
                template={template}
                mode="read"
              />
            </div>
          )}

          {/* Link this invoice to a job — a pure organizational tag (no JE, any status), so
              an already-sent or paid invoice can still be filed against the right job. */}
          <JobLinkControl
            documentType="invoice"
            documentId={invoice.id}
            currentJobId={invoice.jobId}
            customerId={invoice.customerId}
            canEdit={invoice.status !== 'void'}
          />

          {/* Posted journal entry link */}
          {invoice.journalEntryId && (
            <button
              type="button"
              onClick={() => navigate(`${ACCOUNTING_BASE}/journal/${invoice.journalEntryId}`)}
              className="flex items-center gap-1 self-start text-sm font-semibold text-primary hover:text-primary-hover"
            >
              <span className="material-symbols-outlined text-lg">menu_book</span>
              View revenue journal entry
            </button>
          )}

          {/* Payment history */}
          {payments.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Payments
              </h2>
              <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-muted">{p.paymentDate}</span>
                    <span className="flex-1 truncate text-white">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-green-400">
                      {formatMoney(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* #6 — email + reminder history for this invoice (manual sends and dunning rungs). */}
          {emails.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                Email history
              </h2>
              <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-line">
                {emails.map((em) => (
                  <div key={em.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-28 shrink-0 text-muted">{em.createdAt.slice(0, 10)}</span>
                    <span className="w-32 shrink-0 text-muted">{emailKindLabel(em)}</span>
                    <span className="flex-1 truncate text-white" title={em.toEmail}>
                      {em.toEmail || '—'}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold uppercase ${EMAIL_STATUS_STYLES[em.status]}`}
                      title={em.error ?? em.providerLastEvent ?? undefined}
                    >
                      {em.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {actionError && (
            <p className="text-sm text-red-400" role="alert">
              {actionError}
            </p>
          )}

          {/* #7 — freshly minted portal link (shown once so the admin can copy/share it). */}
          {portalLink && (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p className="text-sm font-semibold text-white">Customer portal link created</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={portalLink}
                  className="w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 font-mono text-xs text-white"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon="content_copy"
                  onClick={() => navigator.clipboard?.writeText(portalLink)}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted">
                Anyone with this link can view this invoice until it expires. Share it only with the
                customer.
              </p>
            </div>
          )}

          {/* Additive custom fields (D4). Renders nothing when no invoice custom fields
              are defined; otherwise edits/saves them into accounting.custom_field_values
              without touching this invoice's own record. */}
          <CustomFieldsSection entityType="invoice" entityId={invoice.id} />

          {/* Additive document attachments. Owns its own data; attaching a file moves no
              money and posts no journal entry, and never touches this invoice's record. */}
          <AttachmentsSection entityType="invoice" entityId={invoice.id} />

          <DocumentActivityPanel
            documentType="invoice"
            documentId={invoice.id}
            status={invoice.status}
          />
        </div>
      )}

      {showPayment && invoice && (
        <RecordPaymentModal invoice={invoice} onClose={() => setShowPayment(false)} />
      )}

      {showEmail && invoice && (
        <EmailInvoiceModal
          invoice={invoice}
          defaultEmail={customer?.email ?? ''}
          onClose={() => setShowEmail(false)}
        />
      )}
    </AccountingShell>
  );
}
