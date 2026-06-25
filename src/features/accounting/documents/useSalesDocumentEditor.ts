import { useMemo, useState } from 'react';
import { useTaxCodes } from '../hooks/useAccountingQueries';
import { computeInvoiceTotals, type InvoiceTotals } from '../posting';
import type { EditorLine } from './SalesLineItemsEditor';
import type { PerDocLayout } from './salesDocumentTypes';
import type {
  Estimate,
  EstimateLine,
  Invoice,
  InvoiceLine,
  NewInvoiceLineInput,
  UpdateEstimateInput,
  UpdateInvoiceInput,
} from '../types';

let keySeq = 0;
/** A fresh transient dnd key for a seeded line (never persisted). */
function nextKey(): string {
  keySeq += 1;
  return `seed-${keySeq}`;
}

/** Map a persisted invoice/estimate line to the editor's NewInvoiceLineInput shape (incl. partId). */
function seedLine(line: InvoiceLine | EstimateLine): EditorLine {
  return {
    _key: nextKey(),
    itemId: line.itemId ?? null,
    partId: line.partId ?? null,
    description: line.description ?? '',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    // A persisted line carries an explicit lineTotal; keep it so an imported amount survives a
    // round-trip until the user edits qty/price (which clears it back to qty*price).
    lineTotal: line.lineTotal,
    discount: line.discount ?? 0,
    taxCodeId: line.taxCodeId ?? null,
    taxable: line.taxable !== false,
    incomeAccountId: line.incomeAccountId ?? null,
    jobId: line.jobId ?? null,
    classId: line.classId ?? null,
    locationId: line.locationId ?? null,
    departmentId: line.departmentId ?? null,
  };
}

/** Strip the editor's transient `_key` so only persistable fields reach the update input. */
function toLineInput({ _key, ...rest }: EditorLine): NewInvoiceLineInput {
  void _key; // transient dnd id — never persisted
  return rest;
}

export interface SalesDocumentEditor {
  // Header fields + setters.
  customerId: string;
  setCustomerId: (v: string) => void;
  /** Primary date: invoiceDate / estimateDate (ISO yyyy-mm-dd). */
  date: string;
  setDate: (v: string) => void;
  /** Secondary date: dueDate (invoice) / expiryDate (estimate); '' = none. */
  secondaryDate: string;
  setSecondaryDate: (v: string) => void;
  terms: string;
  setTerms: (v: string) => void;
  memo: string;
  setMemo: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  /** Raw header tax code ('' = no tax). */
  taxCodeId: string;
  setTaxCodeId: (v: string) => void;

  /** Estimate-only QuickBooks header fields. For an invoice these stay '' and are not persisted. */
  poNumber: string;
  setPoNumber: (v: string) => void;
  salesRep: string;
  setSalesRep: (v: string) => void;
  acceptedBy: string;
  setAcceptedBy: (v: string) => void;
  acceptedDate: string;
  setAcceptedDate: (v: string) => void;

  lines: EditorLine[];
  setLines: (lines: EditorLine[]) => void;

  layout: PerDocLayout | null;
  setLayout: (layout: PerDocLayout | null) => void;

  /** Live totals via the same pure function the service uses on send. */
  totals: InvoiceTotals;

  /** Build the draft patch (header + lines + layout) for the existing update-draft mutation. */
  toUpdateInput: () => UpdateInvoiceInput | UpdateEstimateInput;
}

/**
 * Framework-light hook powering the detail-view DRAFT edit for an invoice or estimate. Holds
 * the editable header + lines (seeded from the document, partId included) + per-document layout,
 * and derives live totals with `computeInvoiceTotals` using the SAME taxRateByCode pattern the
 * create views use. It performs NO Supabase calls — the caller persists via the existing
 * useUpdate{Invoice,Estimate}Draft hooks, passing toUpdateInput().
 */
export function useSalesDocumentEditor(
  kind: 'invoice' | 'estimate',
  seed: Invoice | Estimate
): SalesDocumentEditor {
  const { data: taxCodes = [] } = useTaxCodes();

  const seedSecondaryDate =
    kind === 'invoice' ? ((seed as Invoice).dueDate ?? '') : ((seed as Estimate).expiryDate ?? '');
  const seedDate =
    kind === 'invoice' ? (seed as Invoice).invoiceDate : (seed as Estimate).estimateDate;

  const [customerId, setCustomerId] = useState(seed.customerId);
  const [date, setDate] = useState(seedDate);
  const [secondaryDate, setSecondaryDate] = useState(seedSecondaryDate);
  const [terms, setTerms] = useState(seed.terms ?? '');
  const [memo, setMemo] = useState(seed.memo ?? '');
  const [notes, setNotes] = useState(seed.notes ?? '');
  const [taxCodeId, setTaxCodeId] = useState(seed.taxCodeId ?? '');
  // Estimate-only header fields (the invoices table carries no such columns).
  const seedEstimate = kind === 'estimate' ? (seed as Estimate) : null;
  const [poNumber, setPoNumber] = useState(seedEstimate?.poNumber ?? '');
  const [salesRep, setSalesRep] = useState(seedEstimate?.salesRep ?? '');
  const [acceptedBy, setAcceptedBy] = useState(seedEstimate?.acceptedBy ?? '');
  const [acceptedDate, setAcceptedDate] = useState(seedEstimate?.acceptedDate ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => {
    // seed.lines is InvoiceLine[] | EstimateLine[]; normalize the union so .map type-checks.
    const seeded = (seed.lines ?? []) as (InvoiceLine | EstimateLine)[];
    return seeded.map(seedLine);
  });
  const [layout, setLayout] = useState<PerDocLayout | null>(seed.layout ?? null);

  // Live totals — reuse the exact pure function the service uses so the on-screen total equals
  // the persisted document. Tax rate is resolved from the tax-code list exactly as the create
  // views do (isTaxable ? rate : 0); defaultIncomeAccountId is null here (resolved on send).
  const totals = useMemo<InvoiceTotals>(() => {
    const rateById = new Map(taxCodes.map((t) => [t.id, t.isTaxable ? t.rate : 0]));
    return computeInvoiceTotals({
      lines,
      defaultIncomeAccountId: null,
      headerTaxCodeId: taxCodeId || null,
      taxRateByCode: (id) => (id ? (rateById.get(id) ?? 0) : 0),
    });
  }, [lines, taxCodes, taxCodeId]);

  const toUpdateInput = (): UpdateInvoiceInput | UpdateEstimateInput => {
    const lineInputs = lines.map(toLineInput);
    if (kind === 'invoice') {
      const input: UpdateInvoiceInput = {
        customerId,
        invoiceDate: date,
        dueDate: secondaryDate || null,
        terms: terms.trim() || null,
        taxCodeId: taxCodeId || null,
        memo: memo.trim() || null,
        notes: notes.trim() || null,
        layout,
        lines: lineInputs,
      };
      return input;
    }
    const input: UpdateEstimateInput = {
      customerId,
      estimateDate: date,
      expiryDate: secondaryDate || null,
      terms: terms.trim() || null,
      taxCodeId: taxCodeId || null,
      poNumber: poNumber.trim() || null,
      salesRep: salesRep.trim() || null,
      acceptedBy: acceptedBy.trim() || null,
      acceptedDate: acceptedDate || null,
      memo: memo.trim() || null,
      notes: notes.trim() || null,
      layout,
      lines: lineInputs,
    };
    return input;
  };

  return {
    customerId,
    setCustomerId,
    date,
    setDate,
    secondaryDate,
    setSecondaryDate,
    terms,
    setTerms,
    memo,
    setMemo,
    notes,
    setNotes,
    taxCodeId,
    setTaxCodeId,
    poNumber,
    setPoNumber,
    salesRep,
    setSalesRep,
    acceptedBy,
    setAcceptedBy,
    acceptedDate,
    setAcceptedDate,
    lines,
    setLines,
    layout,
    setLayout,
    totals,
    toUpdateInput,
  };
}
