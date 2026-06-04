/**
 * Maps QuickBooks Online Customer List / Vendor List CSV exports into our party
 * masters (accounting.customers / accounting.vendors). Pure + unit-tested: column
 * detection, row building, the create payloads, and idempotent duplicate matching.
 */
import type { Customer, NewCustomerInput, NewVendorInput, Vendor } from '../types';
import { columnTaker, normHeader } from './columnDetect';
import type { AnyColumnMap } from './importKit';

export type PartyKind = 'customer' | 'vendor';

// ── Column detection ─────────────────────────────────────────────────────────

export function autoDetectCustomerColumns(headers: string[]): AnyColumnMap {
  const { map, take, takeExact } = columnTaker(headers);
  // Name first (display name is the only required field).
  takeExact('displayName', [
    'customer',
    'customername',
    'displayname',
    'name',
    'fullname',
    'customerfullname',
  ]);
  take('displayName', (c) => c.n.includes('customer') && c.n.includes('name'));
  take('displayName', (c) => c.n === 'customer');
  takeExact('companyName', ['company', 'companyname']);
  takeExact('contactName', ['contact', 'contactname', 'primarycontact', 'fullname']);
  take('contactName', (c) => c.n.includes('contact'));
  takeExact('email', ['email', 'emailaddress', 'mainemail']);
  take('email', (c) => c.n.includes('email'));
  takeExact('phone', ['phone', 'phonenumber', 'phonenumbers', 'mainphone', 'mobile']);
  take('phone', (c) => c.n.includes('phone'));
  takeExact('terms', ['terms', 'paymentterms']);
  takeExact('notes', ['notes', 'note', 'memo']);
  return map;
}

export function autoDetectVendorColumns(headers: string[]): AnyColumnMap {
  const { map, take, takeExact } = columnTaker(headers);
  takeExact('displayName', [
    'vendor',
    'vendorname',
    'displayname',
    'name',
    'fullname',
    'vendorfullname',
    'supplier',
  ]);
  take('displayName', (c) => c.n.includes('vendor') && c.n.includes('name'));
  take('displayName', (c) => c.n === 'vendor' || c.n === 'supplier');
  takeExact('companyName', ['company', 'companyname']);
  takeExact('email', ['email', 'emailaddress', 'mainemail']);
  take('email', (c) => c.n.includes('email'));
  takeExact('phone', ['phone', 'phonenumber', 'phonenumbers', 'mainphone', 'mobile']);
  take('phone', (c) => c.n.includes('phone'));
  takeExact('terms', ['terms', 'paymentterms']);
  takeExact('taxId', ['taxid', 'businessidno', 'businessid', 'taxidno', 'ein', 'ssn']);
  take('taxId', (c) => c.n.includes('taxid') || c.n.includes('businessid'));
  takeExact('is1099', ['1099', 'track1099', 'trackpaymentsfor1099', 'is1099', 'eligible1099']);
  take('is1099', (c) => c.n.includes('1099'));
  takeExact('notes', ['notes', 'note', 'memo']);
  return map;
}

// ── Row building ─────────────────────────────────────────────────────────────

export interface CustomerImportRow {
  rowNumber: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  terms: string | null;
  notes: string | null;
  problem: string | null;
}

export interface VendorImportRow {
  rowNumber: number;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  terms: string | null;
  taxId: string | null;
  is1099: boolean;
  notes: string | null;
  problem: string | null;
}

const cellGetter = (r: Record<string, string>, map: AnyColumnMap) => (role: string) =>
  map[role] ? (r[map[role]!] ?? '').trim() : '';

/** Parse a QBO yes/no-ish cell into a boolean (Yes, Y, True, 1099, X => true). */
export function parseYesNo(value: string): boolean {
  const v = normHeader(value);
  return v === 'yes' || v === 'y' || v === 'true' || v === '1' || v === 'x' || v === '1099';
}

export function buildCustomerRows(
  rows: Record<string, string>[],
  map: AnyColumnMap
): CustomerImportRow[] {
  return rows.map((r, i) => {
    const cell = cellGetter(r, map);
    const displayName = cell('displayName') || cell('companyName');
    return {
      rowNumber: i + 2,
      displayName,
      companyName: cell('companyName') || null,
      contactName: cell('contactName') || null,
      email: cell('email') || null,
      phone: cell('phone') || null,
      terms: cell('terms') || null,
      notes: cell('notes') || null,
      problem: displayName ? null : 'Missing customer name',
    };
  });
}

export function buildVendorRows(
  rows: Record<string, string>[],
  map: AnyColumnMap
): VendorImportRow[] {
  return rows.map((r, i) => {
    const cell = cellGetter(r, map);
    const displayName = cell('displayName') || cell('companyName');
    return {
      rowNumber: i + 2,
      displayName,
      companyName: cell('companyName') || null,
      email: cell('email') || null,
      phone: cell('phone') || null,
      terms: cell('terms') || null,
      taxId: cell('taxId') || null,
      is1099: parseYesNo(cell('is1099')),
      notes: cell('notes') || null,
      problem: displayName ? null : 'Missing vendor name',
    };
  });
}

// ── Create payloads ──────────────────────────────────────────────────────────

export function toNewCustomerInput(row: CustomerImportRow): NewCustomerInput | null {
  if (!row.displayName) return null;
  return {
    displayName: row.displayName,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    terms: row.terms,
    notes: row.notes,
  };
}

export function toNewVendorInput(row: VendorImportRow): NewVendorInput | null {
  if (!row.displayName) return null;
  return {
    displayName: row.displayName,
    companyName: row.companyName,
    email: row.email,
    phone: row.phone,
    terms: row.terms,
    taxId: row.taxId,
    is1099: row.is1099,
    notes: row.notes,
  };
}

// ── Idempotent duplicate matching ────────────────────────────────────────────

function nameKey(s: string): string {
  return s.trim().toLowerCase();
}

/** Match by case-insensitive display name, or by email when both have one. */
export function findDuplicateParty<T extends { displayName: string; email: string | null }>(
  row: { displayName: string; email: string | null },
  existing: T[]
): T | null {
  const name = nameKey(row.displayName);
  const email = row.email ? row.email.trim().toLowerCase() : null;
  return (
    existing.find((e) => nameKey(e.displayName) === name) ??
    (email ? existing.find((e) => e.email && e.email.trim().toLowerCase() === email) : undefined) ??
    null
  );
}

export type { Customer, Vendor };
