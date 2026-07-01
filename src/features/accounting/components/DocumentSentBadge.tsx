import { Button } from '@/components/ui/Button';
import { useDocumentSentState } from '../hooks/useAccountingQueries';

/** "…T12:34:56+00" → "YYYY-MM-DD HH:MM". */
function formatStamp(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/**
 * Sent-version indicator (QuickBooks-style): tells the admin whether the copy the customer holds
 * matches what's on screen. Green = the current version was sent; amber = edited since the last
 * send (the customer has an older copy) with an optional Re-send action; grey = not sent yet.
 * Renders nothing for a draft (the status pill already says "Draft") or a void document.
 */
export function DocumentSentBadge({
  documentType,
  documentId,
  status,
  onResend,
}: {
  documentType: 'invoice' | 'estimate';
  documentId: string;
  status: string;
  /** Optional re-send handler (invoices open the email dialog); omit to hide the CTA. */
  onResend?: () => void;
}) {
  const { data: state } = useDocumentSentState(documentType, documentId);
  if (status === 'draft' || status === 'void') return null;
  if (!state) return null;

  if (!state.issued) {
    return (
      <Pill tone="grey" icon="mark_email_unread">
        Not sent to the customer yet
      </Pill>
    );
  }

  const sentMeta = (
    <>
      {state.lastSentAt ? ` · last sent ${formatStamp(state.lastSentAt)}` : ''}
      {state.sentCount > 1 ? ` · ${state.sentCount}×` : ''}
    </>
  );

  if (state.isCurrent) {
    return (
      <Pill tone="green" icon="verified">
        Customer has the current version{sentMeta}
      </Pill>
    );
  }

  return (
    <Pill tone="amber" icon="edit_note">
      <span>Edited since last sent — the customer has an older copy{sentMeta}</span>
      {onResend && (
        <Button size="sm" variant="secondary" icon="mail" onClick={onResend}>
          Re-send
        </Button>
      )}
    </Pill>
  );
}

const TONE_STYLES: Record<'green' | 'amber' | 'grey', string> = {
  green: 'border-green-500/30 bg-green-500/10 text-green-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  grey: 'border-line bg-white/5 text-muted',
};

function Pill({
  tone,
  icon,
  children,
}: {
  tone: 'green' | 'amber' | 'grey';
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${TONE_STYLES[tone]}`}
    >
      <span className="material-symbols-outlined text-lg">{icon}</span>
      {children}
    </div>
  );
}
