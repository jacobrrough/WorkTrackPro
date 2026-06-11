/**
 * Pure mappers from QuickBooks Online API JSON entities to our create/update payloads.
 *
 * The qbo-sync proxy returns raw Intuit `/query` records (loosely typed QboJson); these
 * functions narrow them into `New*Input` payloads plus the metadata the sync engine
 * needs (qboId, active flag, problem string when a record can't be imported as-is).
 *
 * Everything here is UI-free and side-effect-free so it unit-tests without React or
 * network. Account classification reuses the CSV importer's classifyQboAccount — the
 * API's AccountType/AccountSubType strings normalise identically to the CSV "Type" /
 * "Detail Type" labels.
 */
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import type {
  ItemType,
  NewAccountInput,
  NewCustomerInput,
  NewItemInput,
  NewVendorInput,
} from '../../types';
import { classifyQboAccount } from '../../import/qboAccountMapping';

// ── JSON narrowing helpers ───────────────────────────────────────────────────

const qstr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const qnum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const qbool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Extract the id out of a QBO Ref object ({ value: "79", name?: "..." }). */
export const refValue = (v: unknown): string | null => {
  if (v == null || typeof v !== 'object') return null;
  return qstr((v as Record<string, unknown>).value);
};

/** Extract the display name out of a QBO Ref object. */
export const refName = (v: unknown): string | null => {
  if (v == null || typeof v !== 'object') return null;
  return qstr((v as Record<string, unknown>).name);
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * QBO BillAddr/ShipAddr → our flat address jsonb ({line1..line3, city, state, zip,
 * country}) — the exact key set parseCustomerAddress() (tax-code resolution) tolerates.
 * Returns null when there is no usable component.
 */
export function qboAddressToJson(v: unknown): Record<string, unknown> | null {
  const a = obj(v);
  if (!a) return null;
  const out: Record<string, unknown> = {};
  const set = (key: string, value: string | null) => {
    if (value != null) out[key] = value;
  };
  set('line1', qstr(a.Line1));
  set('line2', qstr(a.Line2));
  set('line3', qstr(a.Line3));
  set('city', qstr(a.City));
  set('state', qstr(a.CountrySubDivisionCode));
  set('zip', qstr(a.PostalCode));
  set('country', qstr(a.Country));
  return Object.keys(out).length > 0 ? out : null;
}

// ── Terms lookup ─────────────────────────────────────────────────────────────

/** Map QBO Term records to an Id → Name lookup (customers/vendors store terms as text). */
export function buildTermLookup(terms: QboJson[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of terms) {
    const id = qstr(t.Id);
    const name = qstr(t.Name);
    if (id && name) map.set(id, name);
  }
  return map;
}

// ── Mapped-record envelope ───────────────────────────────────────────────────

/** The sync engine's per-record working shape: payload or problem, never both. */
export interface MappedRecord<TInput> {
  qboId: string;
  /** QBO Active flag (false → our is_active=false). Defaults true. */
  active: boolean;
  /** Create/update payload; null when the record can't be imported (see problem). */
  input: TInput | null;
  /** Why the record was skipped (logged + counted as failed/skipped). */
  problem: string | null;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface MappedAccount extends MappedRecord<NewAccountInput> {
  /** QBO AcctNum — the strong duplicate-match key against the existing chart. */
  accountNumber: string | null;
  name: string;
}

/** Map a QBO Account API record (AccountType/AccountSubType/AcctNum/Name/Active). */
export function mapQboAccount(json: QboJson): MappedAccount {
  const qboId = qstr(json.Id) ?? '';
  const name = qstr(json.Name) ?? '';
  const accountNumber = qstr(json.AcctNum);
  const active = qbool(json.Active, true);

  if (!qboId || !name) {
    return { qboId, name, accountNumber, active, input: null, problem: 'Missing id or name' };
  }

  const classification = classifyQboAccount(
    qstr(json.AccountType) ?? '',
    qstr(json.AccountSubType) ?? ''
  );
  if (!classification) {
    return {
      qboId,
      name,
      accountNumber,
      active,
      input: null,
      problem: `Unrecognised account type "${qstr(json.AccountType) ?? ''}"`,
    };
  }

  return {
    qboId,
    name,
    accountNumber,
    active,
    problem: null,
    input: {
      name,
      accountNumber,
      accountType: classification.accountType,
      accountSubtype: classification.accountSubtype,
      normalBalance: classification.normalBalance,
      description: qstr(json.Description),
      externalQboId: qboId,
    },
  };
}

// ── Items ────────────────────────────────────────────────────────────────────

/** QBO Item.Type → accounting.items.item_type. Category rows are hierarchy nodes, not items. */
export function mapQboItemType(qboType: string | null): ItemType | 'category' | null {
  switch ((qboType ?? '').toLowerCase()) {
    case 'inventory':
      return 'inventory';
    case 'noninventory':
      return 'non_inventory';
    case 'service':
      return 'service';
    case 'group':
    case 'bundle':
      return 'bundle';
    case 'assembly':
      return 'assembly';
    case 'category':
      return 'category';
    default:
      return null;
  }
}

export interface MappedItem extends MappedRecord<NewItemInput> {
  name: string;
}

/**
 * Map a QBO Item API record. Account refs are resolved through the caller-supplied
 * lookup (QBO account id → our accounting.accounts id), built by the accounts phase.
 */
export function mapQboItem(
  json: QboJson,
  resolveAccountId: (qboAccountId: string | null) => string | null
): MappedItem {
  const qboId = qstr(json.Id) ?? '';
  const name = qstr(json.Name) ?? '';
  const active = qbool(json.Active, true);

  if (!qboId || !name) {
    return { qboId, name, active, input: null, problem: 'Missing id or name' };
  }

  const itemType = mapQboItemType(qstr(json.Type));
  if (itemType === 'category') {
    return { qboId, name, active, input: null, problem: 'Category (hierarchy node, not an item)' };
  }

  return {
    qboId,
    name,
    active,
    problem: null,
    input: {
      name,
      sku: qstr(json.Sku),
      itemType: itemType ?? 'service',
      incomeAccountId: resolveAccountId(refValue(json.IncomeAccountRef)),
      expenseAccountId: resolveAccountId(refValue(json.ExpenseAccountRef)),
      inventoryAssetAccountId: resolveAccountId(refValue(json.AssetAccountRef)),
      salesPrice: qnum(json.UnitPrice),
      purchaseCost: qnum(json.PurchaseCost),
      externalQboId: qboId,
    },
  };
}

// ── Customers ────────────────────────────────────────────────────────────────

export interface MappedCustomer extends MappedRecord<NewCustomerInput> {
  displayName: string;
  email: string | null;
}

/** Map a QBO Customer API record (incl. sub-customers/projects — they sync flat). */
export function mapQboCustomer(
  json: QboJson,
  termName: (termId: string | null) => string | null
): MappedCustomer {
  const qboId = qstr(json.Id) ?? '';
  const displayName = qstr(json.DisplayName) ?? qstr(json.FullyQualifiedName) ?? '';
  const email = qstr(obj(json.PrimaryEmailAddr)?.Address);
  const active = qbool(json.Active, true);

  if (!qboId || !displayName) {
    return {
      qboId,
      displayName,
      email,
      active,
      input: null,
      problem: 'Missing id or display name',
    };
  }

  const given = qstr(json.GivenName);
  const family = qstr(json.FamilyName);
  const contactName = [given, family].filter(Boolean).join(' ') || null;

  return {
    qboId,
    displayName,
    email,
    active,
    problem: null,
    input: {
      displayName,
      companyName: qstr(json.CompanyName),
      contactName,
      email,
      phone: qstr(obj(json.PrimaryPhone)?.FreeFormNumber),
      // QBO Taxable=false → tax-exempt customer.
      taxExempt: qbool(json.Taxable, true) === false,
      resaleCertificate: qstr(json.ResaleNum),
      terms: termName(refValue(json.SalesTermRef)),
      notes: qstr(json.Notes),
      billingAddress: qboAddressToJson(json.BillAddr),
      shippingAddress: qboAddressToJson(json.ShipAddr),
      externalQboId: qboId,
    },
  };
}

// ── Vendors ──────────────────────────────────────────────────────────────────

export interface MappedVendor extends MappedRecord<NewVendorInput> {
  displayName: string;
  email: string | null;
}

/** Map a QBO Vendor API record. */
export function mapQboVendor(
  json: QboJson,
  termName: (termId: string | null) => string | null
): MappedVendor {
  const qboId = qstr(json.Id) ?? '';
  const displayName = qstr(json.DisplayName) ?? '';
  const email = qstr(obj(json.PrimaryEmailAddr)?.Address);
  const active = qbool(json.Active, true);

  if (!qboId || !displayName) {
    return {
      qboId,
      displayName,
      email,
      active,
      input: null,
      problem: 'Missing id or display name',
    };
  }

  return {
    qboId,
    displayName,
    email,
    active,
    problem: null,
    input: {
      displayName,
      companyName: qstr(json.CompanyName),
      email,
      phone: qstr(obj(json.PrimaryPhone)?.FreeFormNumber),
      terms: termName(refValue(json.TermRef)),
      taxId: qstr(json.TaxIdentifier),
      is1099: qbool(json.Vendor1099, false),
      address: qboAddressToJson(json.BillAddr),
      externalQboId: qboId,
    },
  };
}
