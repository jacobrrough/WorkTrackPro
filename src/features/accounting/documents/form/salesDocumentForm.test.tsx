import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalesDocumentHeader } from './SalesDocumentHeader';
import { SalesDocumentTotalsPanel } from './SalesDocumentTotalsPanel';
import { SalesDocumentMessages } from './SalesDocumentMessages';
import type { InvoiceTotals } from '../../posting';
import type { TaxCode } from '../../types';

const noop = () => {};

const TAX_CODES: TaxCode[] = [
  {
    id: 'tc-1',
    name: 'CA Sales Tax',
    description: null,
    isTaxable: true,
    isDefault: true,
    isActive: true,
    rate: 0.0725,
    createdAt: '2026-01-01',
  },
];

// One taxable line ($100) + one non-taxable line ($40); tax = 7.25% of the taxable base.
const TOTALS: InvoiceTotals = {
  subtotalCents: 14000,
  discountCents: 0,
  taxCents: 725,
  totalCents: 14725,
  lines: [
    {
      incomeAccountId: null,
      netCents: 10000,
      taxable: true,
      taxCents: 725,
      jobId: null,
      classId: null,
      locationId: null,
      departmentId: null,
    },
    {
      incomeAccountId: null,
      netCents: 4000,
      taxable: false,
      taxCents: 0,
      jobId: null,
      classId: null,
      locationId: null,
      departmentId: null,
    },
  ],
};

describe('SalesDocumentHeader', () => {
  const baseProps = {
    customerSlot: <select aria-label="customer" />,
    primaryDate: '2026-06-25',
    onPrimaryDate: noop,
    secondaryDate: '',
    onSecondaryDate: noop,
    terms: '',
    onTerms: noop,
  };

  it('renders the estimate fields, including acceptance + PO/Sales Rep', () => {
    render(
      <SalesDocumentHeader
        {...baseProps}
        kind="estimate"
        docNumber={null}
        primaryDateLabel="Estimate date"
        secondaryDateLabel="Expiration date"
        poNumber=""
        onPoNumber={noop}
        salesRep=""
        onSalesRep={noop}
        acceptedBy=""
        onAcceptedBy={noop}
        acceptedDate=""
        onAcceptedDate={noop}
      />
    );
    expect(screen.getByText('Estimate no.')).toBeTruthy();
    expect(screen.getByText('Auto-assigned on save')).toBeTruthy();
    expect(screen.getByText('Estimate date')).toBeTruthy();
    expect(screen.getByText('Expiration date')).toBeTruthy();
    expect(screen.getByText('Accepted by')).toBeTruthy();
    expect(screen.getByText('P.O. Number')).toBeTruthy();
    expect(screen.getByText('Sales Rep')).toBeTruthy();
  });

  it('hides acceptance + PO/Sales Rep for an invoice and shows the document number', () => {
    render(
      <SalesDocumentHeader
        {...baseProps}
        kind="invoice"
        docNumber="INV-08127"
        primaryDateLabel="Invoice date"
        secondaryDateLabel="Due date"
      />
    );
    expect(screen.getByText('Invoice no.')).toBeTruthy();
    expect(screen.getByText('INV-08127')).toBeTruthy();
    expect(screen.getByText('Due date')).toBeTruthy();
    expect(screen.queryByText('Accepted by')).toBeNull();
    expect(screen.queryByText('P.O. Number')).toBeNull();
    expect(screen.queryByText('Sales Rep')).toBeNull();
  });
});

describe('SalesDocumentTotalsPanel', () => {
  it('shows subtotal, the taxable subtotal, the tax-rate selector, and the kind-specific total', () => {
    const onTaxCodeId = vi.fn();
    render(
      <SalesDocumentTotalsPanel
        kind="estimate"
        totals={TOTALS}
        taxCodes={TAX_CODES}
        taxCodeId="tc-1"
        onTaxCodeId={onTaxCodeId}
        hasDefaultTaxCode
      />
    );
    expect(screen.getByText('Subtotal')).toBeTruthy();
    // Taxable subtotal is the sum of taxable line nets only ($100.00), not the full $140.00.
    expect(screen.getByText('Taxable subtotal')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.getByText('Estimate total')).toBeTruthy();
    expect(screen.getByText('$147.25')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Sales tax rate'), { target: { value: '' } });
    expect(onTaxCodeId).toHaveBeenCalledWith('');
  });

  it('suppresses the tax selector and notes exemption for a tax-exempt customer', () => {
    render(
      <SalesDocumentTotalsPanel
        kind="invoice"
        totals={TOTALS}
        taxCodes={TAX_CODES}
        taxCodeId=""
        onTaxCodeId={noop}
        taxExempt
      />
    );
    expect(screen.queryByLabelText('Sales tax rate')).toBeNull();
    expect(screen.getByText(/tax-exempt/i)).toBeTruthy();
    expect(screen.getByText('Invoice total')).toBeTruthy();
  });
});

describe('SalesDocumentMessages', () => {
  it('renders the customer note and the hidden statement memo', () => {
    render(
      <SalesDocumentMessages
        kind="estimate"
        notes="Thanks"
        onNotes={noop}
        memo="internal"
        onMemo={noop}
      />
    );
    expect(screen.getByText('Note to customer')).toBeTruthy();
    expect(screen.getByText('Memo on statement (hidden)')).toBeTruthy();
    expect((screen.getByDisplayValue('Thanks') as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
  });
});
