/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Pure presentation + client-parse helpers for the
 *     FLAG-DARK import/migration screens. Every screen that uses these ALSO renders the
 *     UnverifiedBanner. No money posts here — the only ledger write is the admin commit RPC.
 *
 * Framework-free helpers for the import/migration UI (the JSX status pills live alongside in
 * importPills.tsx). Money is integer CENTS (G6); these only DIVIDE by 100 for display.
 */
import { formatMoney } from '../accountingViewModel';
import {
  IMPORT_ENTITY_TYPE_LABELS,
  IMPORT_SOURCE_LABELS,
  type ImportEntityType,
  type ImportParseResult,
  type ImportSource,
} from '../types';
import { parseImport, ImportParseError } from '@/services/api/accounting';

// ── Money (integer cents → display dollars) ────────────────────────────────────

/** Format integer CENTS as a USD dollar string (e.g. 1400000 → "$14,000.00"). */
export function formatCents(cents: number | null | undefined): string {
  const c = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return formatMoney(c / 100);
}

/** Format integer CENTS accounting-style (negative parenthesized). */
export function formatCentsAccounting(cents: number | null | undefined): string {
  const c = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  if (c < 0) return `(${formatMoney(-c / 100)})`;
  return formatMoney(c / 100);
}

// ── Labels ─────────────────────────────────────────────────────────────────────

export function sourceLabel(source: ImportSource): string {
  return IMPORT_SOURCE_LABELS[source] ?? source;
}

export function entityTypeLabel(entityType: ImportEntityType): string {
  return IMPORT_ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

/** A friendly local date-time string for a row; falls back to the raw value. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ── Client-side parse glue ───────────────────────────────────────────────────────

export interface ReadParseResult {
  parsed: ImportParseResult | null;
  /** Whole-file size in bytes (for file_meta). */
  bytes: number;
  /** A friendly parse error, or null on success. */
  error: string | null;
}

/**
 * Read a chosen File's text in the BROWSER and run the pure `parseImport` parser. Nothing
 * is uploaded here — parsing is local; the caller stages the result via the import service
 * (which dedups). Surfaces an ImportParseError (or any read failure) as a friendly message.
 */
export async function readAndParseImportFile(file: File): Promise<ReadParseResult> {
  try {
    const text = await file.text();
    const parsed = parseImport(text, file.name);
    return { parsed, bytes: file.size, error: null };
  } catch (e) {
    if (e instanceof ImportParseError) return { parsed: null, bytes: file.size, error: e.message };
    return {
      parsed: null,
      bytes: file.size,
      error: e instanceof Error ? e.message : 'Could not read or parse this file.',
    };
  }
}

/**
 * Count the postable (money-moving) records in a parse result — opening balances + historical
 * journal entries. The wizard surfaces this so a human sees exactly how many rows will post.
 */
export function countPostable(parsed: ImportParseResult): {
  openingBalances: number;
  journalEntries: number;
} {
  let openingBalances = 0;
  let journalEntries = 0;
  for (const r of parsed.records) {
    if (r.entityType === 'opening_balance') openingBalances += 1;
    else if (r.entityType === 'journal_entry') journalEntries += 1;
  }
  return { openingBalances, journalEntries };
}
