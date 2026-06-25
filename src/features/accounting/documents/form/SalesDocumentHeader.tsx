import type { ReactNode } from 'react';
import { SalesFormCard, MetaRow, FieldBlock, docInputClass } from './salesFormUi';

/**
 * QuickBooks-style header card shared by the estimate/invoice create + edit screens.
 * Left: the customer control (passed in, since create uses a picker and edit may differ).
 * Right: the compact meta block (document no., primary/secondary dates, and — for estimates —
 * accepted by / accepted date). Below: P.O. Number, Sales Rep, Terms.
 *
 * Presentational only: every value + change handler is supplied by the owning view, which keeps
 * its own state (create = local useState; edit = useSalesDocumentEditor).
 */
export interface SalesDocumentHeaderProps {
  kind: 'invoice' | 'estimate';
  /** The customer control (a <select> on create; a read-only name or picker on edit). */
  customerSlot: ReactNode;
  /** Display-only document number; null/'' shows "Auto-assigned on save". */
  docNumber?: string | null;

  primaryDateLabel: string;
  primaryDate: string;
  onPrimaryDate: (v: string) => void;

  secondaryDateLabel: string;
  secondaryDate: string;
  onSecondaryDate: (v: string) => void;

  terms: string;
  onTerms: (v: string) => void;
  /** P.O. Number / Sales Rep are estimate-only in the data model; omit the handlers to hide them. */
  poNumber?: string;
  onPoNumber?: (v: string) => void;
  salesRep?: string;
  onSalesRep?: (v: string) => void;

  /** Estimate-only acceptance fields. Omitted handlers hide the rows (invoices). */
  acceptedBy?: string;
  onAcceptedBy?: (v: string) => void;
  acceptedDate?: string;
  onAcceptedDate?: (v: string) => void;

  disabled?: boolean;
}

export function SalesDocumentHeader({
  kind,
  customerSlot,
  docNumber,
  primaryDateLabel,
  primaryDate,
  onPrimaryDate,
  secondaryDateLabel,
  secondaryDate,
  onSecondaryDate,
  terms,
  onTerms,
  poNumber,
  onPoNumber,
  salesRep,
  onSalesRep,
  acceptedBy,
  onAcceptedBy,
  acceptedDate,
  onAcceptedDate,
  disabled,
}: SalesDocumentHeaderProps) {
  const numberLabel = kind === 'estimate' ? 'Estimate no.' : 'Invoice no.';
  const showAcceptance = kind === 'estimate' && !!onAcceptedBy && !!onAcceptedDate;
  const idp = kind; // prefix to keep field ids unique per kind

  return (
    <SalesFormCard>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Left: customer */}
        <div className="min-w-0">
          <label htmlFor={`${idp}-customer`} className="mb-1 block text-xs font-medium text-muted">
            Customer
          </label>
          {customerSlot}
        </div>

        {/* Right: compact meta block */}
        <div className="space-y-2 lg:w-[26rem]">
          <MetaRow label={numberLabel}>
            <div
              className={`${docInputClass} flex items-center bg-white/[0.03] text-muted`}
              aria-label={numberLabel}
            >
              {docNumber ? (
                <span className="text-white">{docNumber}</span>
              ) : (
                <span className="text-subtle">Auto-assigned on save</span>
              )}
            </div>
          </MetaRow>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <MetaRow label={primaryDateLabel} htmlFor={`${idp}-pdate`}>
                <input
                  id={`${idp}-pdate`}
                  type="date"
                  className={docInputClass}
                  value={primaryDate}
                  onChange={(e) => onPrimaryDate(e.target.value)}
                  disabled={disabled}
                />
              </MetaRow>
              <MetaRow label={secondaryDateLabel} htmlFor={`${idp}-sdate`}>
                <input
                  id={`${idp}-sdate`}
                  type="date"
                  className={docInputClass}
                  value={secondaryDate}
                  onChange={(e) => onSecondaryDate(e.target.value)}
                  disabled={disabled}
                />
              </MetaRow>
            </div>

            {showAcceptance && (
              <div className="space-y-2">
                <MetaRow label="Accepted by" htmlFor={`${idp}-acceptedby`}>
                  <input
                    id={`${idp}-acceptedby`}
                    className={docInputClass}
                    value={acceptedBy ?? ''}
                    onChange={(e) => onAcceptedBy?.(e.target.value)}
                    placeholder="Name"
                    disabled={disabled}
                  />
                </MetaRow>
                <MetaRow label="Accepted date" htmlFor={`${idp}-accepteddate`}>
                  <input
                    id={`${idp}-accepteddate`}
                    type="date"
                    className={docInputClass}
                    value={acceptedDate ?? ''}
                    onChange={(e) => onAcceptedDate?.(e.target.value)}
                    disabled={disabled}
                  />
                </MetaRow>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* P.O. / Sales Rep / Terms — PO + Rep are estimate-only; Terms always present. */}
      <div className="mt-5 flex flex-wrap gap-4 border-t border-white/10 pt-5">
        {onPoNumber && (
          <FieldBlock label="P.O. Number" htmlFor={`${idp}-po`} className="min-w-[200px] flex-1">
            <input
              id={`${idp}-po`}
              className={docInputClass}
              value={poNumber ?? ''}
              onChange={(e) => onPoNumber(e.target.value)}
              placeholder="Customer PO #"
              disabled={disabled}
            />
          </FieldBlock>
        )}
        {onSalesRep && (
          <FieldBlock label="Sales Rep" htmlFor={`${idp}-rep`} className="min-w-[200px] flex-1">
            <input
              id={`${idp}-rep`}
              className={docInputClass}
              value={salesRep ?? ''}
              onChange={(e) => onSalesRep(e.target.value)}
              placeholder="Name or initials"
              disabled={disabled}
            />
          </FieldBlock>
        )}
        <FieldBlock label="Terms" htmlFor={`${idp}-terms`} className="min-w-[200px] flex-1">
          <input
            id={`${idp}-terms`}
            className={docInputClass}
            value={terms}
            onChange={(e) => onTerms(e.target.value)}
            placeholder={kind === 'estimate' ? 'e.g. Valid 30 days' : 'e.g. Net 30'}
            disabled={disabled}
          />
        </FieldBlock>
      </div>
    </SalesFormCard>
  );
}

export default SalesDocumentHeader;
