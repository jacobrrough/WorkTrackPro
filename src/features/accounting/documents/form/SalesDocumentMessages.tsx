import type { ReactNode } from 'react';
import { SalesFormCard, FieldBlock, docInputClass } from './salesFormUi';

/**
 * QuickBooks-style "messages" card (left column of the lower form) shared by the estimate/invoice
 * create + edit screens: the customer-facing Note (prints on the document) and the internal Memo
 * on statement (hidden from the customer). `children` lets a view append extra blocks (e.g.
 * attachments or custom fields) inside the same card.
 */
export interface SalesDocumentMessagesProps {
  kind: 'invoice' | 'estimate';
  notes: string;
  onNotes: (v: string) => void;
  memo: string;
  onMemo: (v: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}

export function SalesDocumentMessages({
  kind,
  notes,
  onNotes,
  memo,
  onMemo,
  disabled,
  children,
}: SalesDocumentMessagesProps) {
  const docWord = kind === 'estimate' ? 'estimate' : 'invoice';
  return (
    <SalesFormCard title="Messages" bodyClassName="space-y-4 p-4">
      <FieldBlock
        label="Note to customer"
        htmlFor={`${kind}-notes`}
        hint={`Prints on the ${docWord}`}
      >
        <textarea
          id={`${kind}-notes`}
          className={docInputClass}
          rows={3}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="Thank you for your business."
          disabled={disabled}
        />
      </FieldBlock>
      <FieldBlock
        label="Memo on statement (hidden)"
        htmlFor={`${kind}-memo`}
        hint={`Not shown on the ${docWord}`}
      >
        <textarea
          id={`${kind}-memo`}
          className={docInputClass}
          rows={2}
          value={memo}
          onChange={(e) => onMemo(e.target.value)}
          placeholder="Internal note (statement only)"
          disabled={disabled}
        />
      </FieldBlock>
      {children}
    </SalesFormCard>
  );
}

export default SalesDocumentMessages;
