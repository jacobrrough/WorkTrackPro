import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { adminSettingsService } from '@/services/api/adminSettings';
import { AccountingShell } from '../components/AccountingShell';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { DocumentActivityPanel } from '../components/DocumentActivityPanel';
import { DocumentSentBadge } from '../components/DocumentSentBadge';
import JobLinkControl from '../jobs/JobLinkControl';
import { useEstimate } from '../hooks/useAccountingQueries';
import {
  useAcceptEstimate,
  useConvertEstimate,
  useDeclineEstimate,
  useDeleteEstimateDraft,
  useReissueEstimate,
  useSendEstimate,
  useSetEstimateNumber,
  useUpdateEstimateDraft,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import SalesDocument from '../documents/SalesDocument';
import SalesLineItemsEditor from '../documents/SalesLineItemsEditor';
import { useSalesDocumentEditor } from '../documents/useSalesDocumentEditor';
import { estimateToSalesDocumentData } from '../documents/salesDocumentMappers';
import { resolveTemplateConfig } from '../documents/templateConfig';
import { exportSalesDocumentPdf } from '../documents/exportSalesDocumentPdf';
import { salesDocumentFilenameBase } from '../documents/salesDocumentTypes';
import { ACCOUNTING_BASE, ESTIMATES_BASE } from '../constants';
import { ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from '../types';

const STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-white/10 text-muted',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/**
 * Draft inline editor for an estimate — mirrors the invoice detail view's edit mode. Holds an
 * editable header (estimate date, expiry, terms, memo, notes) + the shared line grid via
 * useSalesDocumentEditor, derives live totals, and persists through useUpdateEstimateDraft with
 * editor.toUpdateInput(). Lives in its own component so the editor hook only mounts once we have
 * a non-null estimate to seed from (the parent guards on a loaded estimate before rendering it).
 */
function EstimateDraftEditor({ estimate, onClose }: { estimate: Estimate; onClose: () => void }) {
  const editor = useSalesDocumentEditor('estimate', estimate);
  const updateDraft = useUpdateEstimateDraft();
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    const res = await updateDraft.mutateAsync({ id: estimate.id, input: editor.toUpdateInput() });
    if (res.error || !res.estimate) {
      setError(res.error ?? 'Could not save the estimate.');
      return;
    }
    onClose();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Estimate date" htmlFor="edit-est-date">
          <input
            id="edit-est-date"
            type="date"
            className={inputClass}
            value={editor.date}
            onChange={(e) => editor.setDate(e.target.value)}
          />
        </FormField>

        <FormField label="Expires" htmlFor="edit-est-expiry">
          <input
            id="edit-est-expiry"
            type="date"
            className={inputClass}
            value={editor.secondaryDate}
            onChange={(e) => editor.setSecondaryDate(e.target.value)}
          />
        </FormField>

        <FormField label="Terms" htmlFor="edit-est-terms">
          <input
            id="edit-est-terms"
            className={inputClass}
            value={editor.terms}
            onChange={(e) => editor.setTerms(e.target.value)}
            placeholder="e.g. Valid 30 days"
          />
        </FormField>

        <FormField label="Memo" htmlFor="edit-est-memo">
          <input
            id="edit-est-memo"
            className={inputClass}
            value={editor.memo}
            onChange={(e) => editor.setMemo(e.target.value)}
            placeholder="Optional note"
          />
        </FormField>

        <FormField label="Notes" htmlFor="edit-est-notes" className="sm:col-span-2">
          <textarea
            id="edit-est-notes"
            className={inputClass}
            rows={2}
            value={editor.notes}
            onChange={(e) => editor.setNotes(e.target.value)}
            placeholder="Optional notes shown on the estimate"
          />
        </FormField>
      </div>

      {/* Line items */}
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Line items</h2>
        <SalesLineItemsEditor
          lines={editor.lines}
          onChange={editor.setLines}
          lineAmountsCents={editor.totals.lines.map((l) => l.netCents)}
          disabled={updateDraft.isPending}
        />
      </div>

      {/* Totals */}
      <div className="ml-auto w-full max-w-xs space-y-1 border-t border-white/10 pt-3 text-sm">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums text-white">
            {formatMoney(editor.totals.subtotalCents / 100)}
          </span>
        </div>
        <div className="flex justify-between text-muted">
          <span>Tax</span>
          <span className="font-mono tabular-nums text-white">
            {formatMoney(editor.totals.taxCents / 100)}
          </span>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-1 font-bold text-white">
          <span>Total</span>
          <span className="font-mono tabular-nums">
            {formatMoney(editor.totals.totalCents / 100)}
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={updateDraft.isPending}>
          Cancel
        </Button>
        <Button icon="save" onClick={onSave} disabled={updateDraft.isPending}>
          {updateDraft.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export default function EstimateDetailView() {
  const { estimateId } = useParams<{ estimateId: string }>();
  const navigate = useNavigate();
  const { data: estimate, isPending, isError } = useEstimate(estimateId);
  const { data: settings } = useQuery({
    queryKey: ['organization-settings'],
    queryFn: () => adminSettingsService.getOrganizationSettings(),
  });
  const sendEstimate = useSendEstimate();
  const acceptEstimate = useAcceptEstimate();
  const declineEstimate = useDeclineEstimate();
  const convertEstimate = useConvertEstimate();
  const reissueEstimate = useReissueEstimate();
  const deleteEstimate = useDeleteEstimateDraft();
  const setEstimateNumber = useSetEstimateNumber();
  const printRef = useRef<HTMLDivElement>(null);
  // Land directly in the live editor (QuickBooks-style); Preview toggles to the read-only paper.
  const [editing, setEditing] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fully-defaulted from branding (handles undefined before settings load), so the
  // on-screen paper — and the ref-captured PDF — always reflect the org's template.
  const template = resolveTemplateConfig(settings?.branding);

  const onSend = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await sendEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  // Manually override this estimate's number (for reconciling against QuickBooks). Numbers are
  // auto-assigned and sequential; this is the deliberate by-hand correction.
  const onEditNumber = async () => {
    if (!estimate) return;
    const next = window.prompt(
      'Estimate number — override for QuickBooks reconciliation:',
      estimate.estimateNumber ?? ''
    );
    if (next == null) return;
    setActionError(null);
    const res = await setEstimateNumber.mutateAsync({ id: estimate.id, number: next });
    if (!res.ok) setActionError(res.error ?? 'Could not update the estimate number.');
  };

  const onAccept = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await acceptEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  const onDecline = async () => {
    if (!estimate) return;
    if (!window.confirm('Decline this estimate? It can no longer be converted to an invoice.'))
      return;
    setActionError(null);
    const res = await declineEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  const onConvert = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await convertEstimate.mutateAsync(estimate.id);
    if (res.error || !res.invoiceId) {
      setActionError(res.error ?? 'Could not convert the estimate.');
      return;
    }
    // The converted invoice is a DRAFT — open it so the user can review and send it.
    navigate(`${ACCOUNTING_BASE}/invoices/${res.invoiceId}`);
  };

  const onReissue = async () => {
    if (!estimate) return;
    if (!window.confirm('Create a new editable draft copy of this estimate?')) return;
    setActionError(null);
    const res = await reissueEstimate.mutateAsync(estimate.id);
    if (res.error || !res.estimateId) {
      setActionError(res.error ?? 'Could not reissue the estimate.');
      return;
    }
    // The reissued estimate is a fresh DRAFT — open it so the user can edit and send it.
    navigate(`${ESTIMATES_BASE}/${res.estimateId}`);
  };

  // Permanently delete a DRAFT estimate (posts nothing); non-draft estimates use Decline/Reissue.
  const onDelete = async () => {
    if (!estimate) return;
    if (
      !window.confirm(
        `Delete draft estimate ${estimate.estimateNumber ?? 'Draft'}? This permanently removes it.`
      )
    )
      return;
    setActionError(null);
    const res = await deleteEstimate.mutateAsync(estimate.id);
    if (!res.ok) {
      setActionError(res.error ?? 'Could not delete the estimate.');
      return;
    }
    navigate(ESTIMATES_BASE);
  };

  const onDownloadPdf = async () => {
    if (!estimate) return;
    setActionError(null);
    // The PDF rasterizes the read-only paper (printRef); switch to Preview first so it's mounted.
    setEditing(false);
    setDownloading(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      if (!printRef.current) throw new Error('preview not ready');
      await exportSalesDocumentPdf(
        printRef.current,
        salesDocumentFilenameBase({ kind: 'estimate', number: estimate.estimateNumber })
      );
    } catch {
      setActionError('Could not generate the estimate PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const canEdit = estimate?.status === 'draft';
  // Estimates post no ledger, so any live status is editable in place except converted/accepted.
  const isEditable =
    estimate != null && estimate.status !== 'converted' && estimate.status !== 'accepted';
  const canSend = estimate?.status === 'draft';
  const canAccept =
    estimate != null && (estimate.status === 'sent' || estimate.status === 'expired');
  const canDecline =
    estimate != null &&
    estimate.status !== 'draft' &&
    estimate.status !== 'declined' &&
    estimate.status !== 'converted';
  const canConvert =
    estimate != null && estimate.status !== 'declined' && estimate.status !== 'converted';
  // Reissue spins off a fresh draft copy — only offered once the estimate has left draft.
  const canReissue = estimate != null && estimate.status !== 'draft';
  const taxShown = (estimate?.taxTotal ?? 0) > 0;

  const busy =
    sendEstimate.isPending ||
    acceptEstimate.isPending ||
    declineEstimate.isPending ||
    convertEstimate.isPending ||
    reissueEstimate.isPending ||
    deleteEstimate.isPending;

  return (
    <AccountingShell
      active="estimates"
      title={estimate ? `Estimate ${estimate.estimateNumber ?? 'Draft'}` : 'Estimate'}
      actions={
        estimate ? (
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
            {canEdit && (
              <Button size="sm" variant="danger" icon="delete" onClick={onDelete} disabled={busy}>
                {deleteEstimate.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            )}
            {canSend && (
              <Button size="sm" icon="send" onClick={onSend} disabled={busy}>
                {sendEstimate.isPending ? 'Sending…' : 'Send'}
              </Button>
            )}
            {canAccept && (
              <Button size="sm" variant="secondary" icon="check" onClick={onAccept} disabled={busy}>
                {acceptEstimate.isPending ? 'Accepting…' : 'Accept'}
              </Button>
            )}
            {canConvert && (
              <Button size="sm" icon="receipt_long" onClick={onConvert} disabled={busy}>
                {convertEstimate.isPending ? 'Converting…' : 'Convert to invoice'}
              </Button>
            )}
            {canReissue && (
              <Button
                size="sm"
                variant="secondary"
                icon="content_copy"
                onClick={onReissue}
                disabled={busy}
              >
                {reissueEstimate.isPending ? 'Reissuing…' : 'Reissue as draft'}
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
            {canDecline && (
              <Button size="sm" variant="danger" onClick={onDecline} disabled={busy}>
                {declineEstimate.isPending ? 'Declining…' : 'Decline'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-muted">Loading estimate…</p>}
      {isError && <p className="text-red-400">Could not load this estimate.</p>}
      {!isPending && !isError && !estimate && <p className="text-muted">Estimate not found.</p>}

      {estimate && (
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {taxShown && <TaxDisclaimer />}

          {/* Sent-version indicator: does the customer hold the current copy of this estimate? */}
          <DocumentSentBadge
            documentType="estimate"
            documentId={estimate.id}
            status={estimate.status}
          />

          {/* Status + meta — shown in both edit and preview. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[estimate.status]}`}
            >
              {ESTIMATE_STATUS_LABELS[estimate.status]}
            </span>
            {/* Document number — auto-assigned & sequential, with a by-hand override for
                QuickBooks reconciliation. */}
            <span className="text-sm text-muted">
              Estimate #{' '}
              <span className="font-mono text-white">{estimate.estimateNumber ?? '—'}</span>
              <button
                type="button"
                onClick={onEditNumber}
                disabled={setEstimateNumber.isPending}
                className="ml-2 text-xs font-semibold text-primary hover:text-primary-hover disabled:opacity-50"
              >
                {setEstimateNumber.isPending ? 'Saving…' : 'Edit'}
              </button>
            </span>
            <span className="text-sm text-muted">
              Customer{' '}
              <span className="text-white">{estimate.customerName || estimate.customerId}</span>
            </span>
            <span className="text-sm text-muted">
              Date <span className="text-white">{estimate.estimateDate}</span>
            </span>
            {estimate.expiryDate && (
              <span className="text-sm text-muted">
                Expires <span className="text-white">{estimate.expiryDate}</span>
              </span>
            )}
            {estimate.terms && (
              <span className="text-sm text-muted">
                Terms <span className="text-white">{estimate.terms}</span>
              </span>
            )}
          </div>

          {editing && isEditable ? (
            // The live editor is the default landing view; remounting per estimate id re-seeds it.
            <EstimateDraftEditor
              key={estimate.id}
              estimate={estimate}
              onClose={() => setEditing(false)}
            />
          ) : (
            /* Branded read-only "paper" (Preview). The forwarded ref lands on the white root so
               Download PDF captures the on-screen node. Estimates carry no payments/balance block. */
            <SalesDocument
              ref={printRef}
              data={estimateToSalesDocumentData(estimate)}
              template={template}
              mode="read"
            />
          )}

          {/* Link this estimate to a job — a pure organizational tag (estimates post no JE). */}
          <JobLinkControl
            documentType="estimate"
            documentId={estimate.id}
            currentJobId={estimate.jobId}
            customerId={estimate.customerId}
          />

          {/* Converted-invoice link */}
          {estimate.convertedInvoiceId && (
            <button
              type="button"
              onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/${estimate.convertedInvoiceId}`)}
              className="flex items-center gap-1 self-start text-sm font-semibold text-primary hover:text-primary-hover"
            >
              <span className="material-symbols-outlined text-lg">receipt_long</span>
              View converted invoice
            </button>
          )}

          {actionError && (
            <p className="text-sm text-red-400" role="alert">
              {actionError}
            </p>
          )}

          <DocumentActivityPanel
            documentType="estimate"
            documentId={estimate.id}
            status={estimate.status}
          />
        </div>
      )}
    </AccountingShell>
  );
}
