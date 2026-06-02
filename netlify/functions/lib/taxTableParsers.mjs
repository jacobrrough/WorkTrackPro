// WorkTrackAccounting — TAX-SYNC source parsers (server-side, advisory-only)
// ============================================================================
// Per-source, BEST-EFFORT parsers that turn an official CDTFA / CA EDD tax-table
// file into the normalized entry set the scheduled function snapshots + diffs:
//
//     { jurisdiction: string|null, rate: number|null, effectiveDate: string|null, ...extra }
//
// `rate` is a DECIMAL fraction (0.0725 == 7.25%). `effectiveDate` is `YYYY-MM-DD`
// or null. Extra parser fields (label, county, component) are preserved verbatim
// for the UI/debugging — they do not affect the diff, which keys off the
// normalized rate-name derived in the scheduled function.
//
// ⚠️⚠️⚠️  VERIFY EACH PARSER AGAINST THE LIVE FILE  ⚠️⚠️⚠️
// ----------------------------------------------------------------------------
// CDTFA and CA EDD publish their rate data in formats that change without notice
// (column order, header wording, file type, PDF layout). The framework around
// these parsers — fetch → snapshot → content-hash → diff → open-drift alert — is
// fully mechanical and unit-tested, but the PARSERS THEMSELVES cannot be
// mechanically verified here. A human MUST open the current official file and
// confirm the column/field mapping below before this module is graduated and the
// server gate ACCOUNTING_TAX_SYNC_ENABLED is turned on. Each parser carries a
// `VERIFY` banner restating exactly what to check.
//
// SECURITY: every byte handled here is UNTRUSTED external input. Parsers must
// never throw on malformed data (they return [] or skip the bad row), never
// interpret embedded HTML/script, cap how much they scan, and coerce all numbers
// defensively. The scheduled function additionally size-caps the fetch body and
// records a snapshot.error rather than corrupting stored rates (fail-safe).
//
// This file has NO Supabase / network imports — it is a pure transform so it can
// be reasoned about and (later) unit-tested in isolation. The scheduled function
// owns all I/O.
// ============================================================================

import { createHash } from 'node:crypto';

// ── Limits (defensive against hostile / huge external payloads) ──────────────
const MAX_PARSE_BYTES = 8 * 1024 * 1024; // never scan more than ~8MB of a body
const MAX_ROWS = 20000; // never emit more than this many entries
const MIN_PLAUSIBLE_RATE = 0; // a tax rate fraction is >= 0 ...
const MAX_PLAUSIBLE_RATE = 1; // ... and < 1 (100%). Anything outside is rejected.

// ── Small, dependency-free coercion helpers ──────────────────────────────────

/** Coerce an arbitrary cell to a finite decimal rate fraction, or null.
 * Accepts a number, a decimal string ("0.0725"), or a percent string ("7.25%"
 * / "7.25") which is divided by 100. Rejects anything outside [0,1). */
export function coerceRate(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= MIN_PLAUSIBLE_RATE && value < MAX_PLAUSIBLE_RATE
      ? value
      : null;
  }
  let s = String(value).trim();
  if (s === '') return null;
  let isPercent = false;
  if (s.endsWith('%')) {
    isPercent = true;
    s = s.slice(0, -1).trim();
  }
  // strip thousands separators / stray spaces; keep digits, dot, leading sign
  s = s.replace(/[, ]+/g, '');
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  // A bare ">=1" value is almost certainly a percent written without the sign
  // (e.g. "7.25" meaning 7.25%); treat it as percent. Values already in [0,1)
  // are taken as fractions.
  if (isPercent || n >= 1) n = n / 100;
  return n >= MIN_PLAUSIBLE_RATE && n < MAX_PLAUSIBLE_RATE ? n : null;
}

/** Trim + collapse a string cell to a non-empty value, or null. Caps length so a
 * pathological cell cannot bloat a snapshot. */
export function coerceText(value, maxLen = 200) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Coerce a date-ish cell to `YYYY-MM-DD`, or null. Accepts ISO and US
 * (M/D/YYYY) forms. Never throws. */
export function coerceDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  // ISO yyyy-mm-dd (optionally with time)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return isValidYmd(+y, +m, +d) ? `${y}-${m}-${d}` : null;
  }
  // US m/d/yyyy or m-d-yyyy
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    let [, m, d, y] = us;
    let yr = +y;
    if (yr < 100) yr += 2000;
    const mm = String(+m).padStart(2, '0');
    const dd = String(+d).padStart(2, '0');
    return isValidYmd(yr, +m, +d) ? `${yr}-${mm}-${dd}` : null;
  }
  return null;
}

function isValidYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

// ── Minimal, defensive CSV reader ────────────────────────────────────────────
// A small RFC-4180-ish reader (quotes, escaped quotes, CRLF). We deliberately do
// NOT pull a CSV dependency (stack-lock + supply-chain surface): the official
// files are simple delimited tables and this reader is easy to audit.

/** Parse CSV text into an array of string[] rows. Bounded by MAX_PARSE_BYTES /
 * MAX_ROWS. Never throws. */
export function parseCsv(text, delimiter = ',') {
  const out = [];
  if (typeof text !== 'string' || text === '') return out;
  const src = text.length > MAX_PARSE_BYTES ? text.slice(0, MAX_PARSE_BYTES) : text;
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      if (out.length >= MAX_ROWS) break;
    } else if (c === '\r') {
      // swallow; the \n (if any) finalizes the row
    } else {
      field += c;
    }
  }
  // flush trailing field/row (file without trailing newline)
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Find the index of the first header whose normalized text matches one of
 * `names` (case-insensitive, non-alphanumerics ignored). -1 when absent. */
function headerIndex(header, names) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = names.map(norm);
  for (let i = 0; i < header.length; i++) {
    if (wanted.includes(norm(header[i]))) return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER 1 — CDTFA "California City & County Sales & Use Tax Rates" (sales)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * VERIFY AGAINST THE LIVE FILE:
 *   • Source: CDTFA publishes the combined city/county sales-and-use-tax rates as
 *     a downloadable data file (open-data CSV export of the "Effective Sales &
 *     Use Tax Rates" dataset). Confirm the official_file_url on the seeded source
 *     still resolves to a CSV (or update the fetcher/parser if it is XLSX/JSON).
 *   • Confirm the column headers. This parser looks (case/punctuation-insensitive)
 *     for a jurisdiction column among: "City"/"County"/"Jurisdiction"/"Area" and
 *     a rate column among: "Rate"/"Tax Rate"/"Combined Rate"/"Total Rate". If the
 *     live file labels them differently, extend the header-name lists below.
 *   • Confirm the rate format: this handles a decimal fraction (0.0725), a percent
 *     string ("7.25%"), or a bare percent number ("7.25"). If CDTFA switches to
 *     basis points or another unit, adjust coerceRate / the post-scale here.
 *   • Confirm whether an effective-date column exists; map it if so (optional).
 *
 * Returns normalized entries. `jurisdiction` is the city/county label; `rate` is
 * the combined decimal rate; extra `county` kept when present.
 */
export function parseCdtfaSalesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  // locate the header row (first row that has a recognizable rate column within
  // the first few rows — CDTFA files sometimes carry title/preamble lines).
  let headerRow = -1;
  let jIdx = -1;
  let cIdx = -1;
  let rIdx = -1;
  let eIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i];
    const r = headerIndex(h, ['rate', 'taxrate', 'combinedrate', 'totalrate', 'salesanduseTaxRate', 'salesandusetaxrate']);
    if (r === -1) continue;
    const j = headerIndex(h, ['city', 'jurisdiction', 'area', 'cityname', 'place']);
    const c = headerIndex(h, ['county', 'countyname']);
    if (j === -1 && c === -1) continue;
    headerRow = i;
    jIdx = j;
    cIdx = c;
    rIdx = r;
    eIdx = headerIndex(h, ['effectivedate', 'effective', 'beginning', 'startdate']);
    break;
  }
  if (headerRow === -1) return [];

  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.length === 0) continue;
    const rate = coerceRate(rIdx >= 0 ? cells[rIdx] : null);
    if (rate == null) continue; // skip rows without a usable rate (blank/footer)
    const city = jIdx >= 0 ? coerceText(cells[jIdx]) : null;
    const county = cIdx >= 0 ? coerceText(cells[cIdx]) : null;
    const jurisdiction = city || county;
    if (!jurisdiction) continue;
    const effectiveDate = eIdx >= 0 ? coerceDate(cells[eIdx]) : null;
    const entry = { jurisdiction, rate, effectiveDate };
    if (county && county !== jurisdiction) entry.county = county;
    out.push(entry);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER 2 — CA EDD payroll rate sheet (DE 201): UI / ETT / SDI / PIT (payroll)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * VERIFY AGAINST THE LIVE FILE:
 *   • Source: CA EDD publishes the annual employer rates on the "Rates &
 *     Withholding" page and in the DE 201 rate sheet (currently a PDF). The seeded
 *     official_file_url points at the DE 201 PDF. PDFs are NOT reliably parseable
 *     as text without a PDF extractor (a dependency we intentionally do NOT add —
 *     stack-lock). Therefore this parser operates on TEXT: it scans whatever text
 *     the fetcher could extract (e.g. an HTML rates page, a plaintext mirror, or a
 *     future CSV/JSON export) for the four California employer rates.
 *   • If EDD only offers the numbers inside a binary PDF, a human must either
 *     (a) point official_file_url at a text/HTML/CSV representation, or (b) add a
 *     vetted PDF-text step in the dedicated security/graduation phase. Until then
 *     this parser yields [] for a binary PDF body (and the snapshot records that),
 *     which is the safe, advisory outcome — never a wrong rate.
 *   • Confirm the labels/values: it looks for "SDI"/"State Disability Insurance",
 *     "ETT"/"Employment Training Tax", and "UI"/"Unemployment Insurance" rates,
 *     plus an optional effective year. EDD wording changes yearly — re-confirm.
 *
 * Returns normalized entries keyed by component, e.g.
 *   { jurisdiction: 'CA SDI', rate: 0.011, effectiveDate: '2026-01-01', component: 'SDI' }
 * UI is published as a range/schedule (employer-specific), so when only a range is
 * present we DO NOT emit a single UI rate (advisory: never invent a number).
 */
export function parseEddPayrollText(text) {
  if (typeof text !== 'string' || text === '') return [];
  // Reject an obviously-binary body (e.g. a raw PDF) — never scan binary as text.
  if (looksBinary(text)) return [];
  const src = text.length > MAX_PARSE_BYTES ? text.slice(0, MAX_PARSE_BYTES) : text;
  // strip tags if we were handed HTML, so labels/numbers sit adjacent
  const flat = src.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

  const out = [];
  const year = (flat.match(/\b(20\d{2})\b/) || [])[1] || null;
  const eff = year ? `${year}-01-01` : null;

  // Each spec: a label regex + the canonical jurisdiction/component name. We pull
  // the FIRST percent that appears within a short window AFTER the label.
  const specs = [
    { re: /\bSDI\b|State Disability Insurance/i, name: 'CA SDI', component: 'SDI' },
    { re: /\bETT\b|Employment Training Tax/i, name: 'CA ETT', component: 'ETT' },
    {
      re: /\bUI\b|Unemployment Insurance/i,
      name: 'CA UI (new-employer)',
      component: 'UI',
      // UI is often a range ("3.4%"-"6.2%"); only accept a single explicit
      // "new employer" rate to avoid emitting an employer-specific number.
      requireNewEmployer: true,
    },
  ];

  for (const spec of specs) {
    const m = spec.re.exec(flat);
    if (!m) continue;
    const start = m.index;
    const window = flat.slice(start, start + 160);
    if (spec.requireNewEmployer && !/new\s*employer/i.test(window)) continue;
    const pct = window.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pct) continue;
    const rate = coerceRate(`${pct[1]}%`);
    if (rate == null) continue;
    out.push({ jurisdiction: spec.name, rate, effectiveDate: eff, component: spec.component });
  }
  return out;
}

/** Heuristic: does this look like binary (e.g. a PDF) rather than parseable text?
 * PDFs start with "%PDF-"; binary bodies carry many NUL/control bytes. */
function looksBinary(text) {
  if (text.startsWith('%PDF-')) return true;
  const sample = text.slice(0, 2000);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0) return true;
    if (code < 9 || (code > 13 && code < 32)) control++;
  }
  return control > sample.length * 0.02;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser registry — map a seeded source to its parser by kind + a key.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolve the parser for a source row. We match on `kind` first (sales|payroll)
 * and refine by a hint in the source name/jurisdiction. Unknown sources fall back
 * to a kind-appropriate parser. Returns a function (rawText) => entries[], or null
 * when the kind is unrecognized (the function records that and skips — fail-safe).
 */
export function resolveParser(source) {
  const kind = source?.kind;
  const name = `${source?.name ?? ''} ${source?.jurisdiction ?? ''}`.toLowerCase();
  if (kind === 'sales') {
    // Today only CDTFA; the registry leaves room for other states' sales files.
    return parseCdtfaSalesCsv;
  }
  if (kind === 'payroll') {
    if (name.includes('edd') || name.includes('ca ') || name.includes('california')) {
      return parseEddPayrollText;
    }
    return parseEddPayrollText;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization + content hashing (stable across pulls)
// ─────────────────────────────────────────────────────────────────────────────

/** Canonicalize one parsed entry to the snapshot shape, dropping unusable rows
 * (no jurisdiction or no rate). Numbers are rounded to 5 dp to match the DB
 * `numeric(7,5)` rate precision so the content-hash is stable across cosmetic
 * float noise. */
export function normalizeParsedEntry(raw) {
  const jurisdiction = coerceText(raw?.jurisdiction);
  const rate = coerceRate(raw?.rate);
  if (jurisdiction == null || rate == null) return null;
  const rounded = Math.round(rate * 1e5) / 1e5;
  const effectiveDate = coerceDate(raw?.effectiveDate);
  const entry = { jurisdiction, rate: rounded, effectiveDate };
  // preserve a couple of known-safe extras for display (already length-capped)
  if (raw && typeof raw === 'object') {
    if (raw.county) entry.county = coerceText(raw.county);
    if (raw.component) entry.component = coerceText(raw.component);
    if (raw.label) entry.label = coerceText(raw.label);
  }
  return entry;
}

/** Normalize + sort a parser's output into the canonical, deduped snapshot set.
 * Sorting makes the content-hash order-independent (two pulls of the same data in
 * a different row order hash identically → no false drift). */
export function normalizeParsedSet(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawEntries) {
    const e = normalizeParsedEntry(raw);
    if (!e) continue;
    const key = `${e.jurisdiction}|${e.component ?? ''}`.toLowerCase();
    if (seen.has(key)) continue; // first wins; later dup rows ignored
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_ROWS) break;
  }
  out.sort((a, b) => {
    const ka = `${a.jurisdiction}|${a.component ?? ''}`.toLowerCase();
    const kb = `${b.jurisdiction}|${b.component ?? ''}`.toLowerCase();
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}

/** sha-256 (hex) of a normalized parsed set — the snapshot.content_hash used for
 * no-op/dedupe detection across pulls. Hashes the canonical JSON of the sorted
 * set so it is stable regardless of source row order / cosmetic differences. */
export function contentHashOf(normalizedSet) {
  const canonical = JSON.stringify(
    (normalizedSet ?? []).map((e) => ({
      jurisdiction: e.jurisdiction,
      rate: e.rate,
      effectiveDate: e.effectiveDate ?? null,
      component: e.component ?? null,
    }))
  );
  return createHash('sha256').update(canonical).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff — normalized snapshot set  vs  active accounting.tax_rates
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build the drift `diff` array (the admin alert payload) by comparing the freshly
 * parsed rates against the currently-active stored rates. Produces ONLY entries
 * the admin should review — i.e. where a matched stored rate differs, OR a parsed
 * jurisdiction has no stored rate yet (a proposed new rate).
 *
 * MATCHING (must mirror the apply RPC, which targets accounting.tax_rates by exact
 * `name`): we match a parsed entry to a stored rate by exact, case-insensitive
 * name equality between the parsed `jurisdiction` and the stored rate `name`. Each
 * emitted diff entry therefore carries the EXACT stored `rate_name` to target
 * (snake_case keys — the shape the DB RPC + the client's taxTableDiff normalizer
 * both read): { rate_name, jurisdiction, current_rate, new_rate, effective_date, label }.
 *
 * IMPORTANT (advisory-only, no false alarms):
 *   • Rates are compared at 5-dp (DB numeric(7,5) precision); a sub-ulp float
 *     difference is NOT drift.
 *   • A stored rate that the parsed set does NOT mention is left untouched and is
 *     NOT reported (we never propose deletions — advisory + additive).
 *   • A parsed jurisdiction with NO matching stored rate becomes an INSERT-style
 *     proposal (current_rate: null) so the admin can choose to add it; the apply
 *     RPC inserts a new active rate for an unmatched name.
 *
 * @param {Array} parsedSet      normalized snapshot entries (normalizeParsedSet output)
 * @param {Array} activeRates    [{ name, rate, jurisdiction, effective_date }] active rows
 * @returns {Array} diff entries (snake_case), possibly empty (== no drift)
 */
export function buildDiff(parsedSet, activeRates) {
  const EPS = 1e-9;
  const byName = new Map();
  for (const r of activeRates ?? []) {
    const nm = coerceText(r?.name);
    if (nm == null) continue;
    if (!byName.has(nm.toLowerCase())) byName.set(nm.toLowerCase(), r);
  }

  const diff = [];
  for (const entry of parsedSet ?? []) {
    const newRate = coerceRate(entry?.rate);
    if (newRate == null) continue;
    const jurisdiction = coerceText(entry?.jurisdiction);
    if (jurisdiction == null) continue;

    const match = byName.get(jurisdiction.toLowerCase());
    if (match) {
      const current = coerceRate(match.rate);
      // numeric(7,5) precision: compare rounded to 5 dp.
      const a = current == null ? null : Math.round(current * 1e5);
      const b = Math.round(newRate * 1e5);
      if (current != null && Math.abs(a - b) <= EPS) {
        continue; // unchanged within precision → not drift
      }
      diff.push({
        rate_name: coerceText(match.name) ?? jurisdiction,
        jurisdiction,
        current_rate: current,
        new_rate: newRate,
        effective_date: coerceDate(entry?.effectiveDate),
        label:
          current == null
            ? `Proposed rate ${fmtPct(newRate)} for ${match.name}`
            : `Rate change ${fmtPct(current)} → ${fmtPct(newRate)} for ${match.name}`,
      });
    } else {
      // No active rate by that name → advisory INSERT proposal.
      diff.push({
        rate_name: jurisdiction,
        jurisdiction,
        current_rate: null,
        new_rate: newRate,
        effective_date: coerceDate(entry?.effectiveDate),
        label: `New jurisdiction ${jurisdiction} @ ${fmtPct(newRate)} (no stored rate yet)`,
      });
    }
    if (diff.length >= MAX_ROWS) break;
  }
  return diff;
}

/** Severity for a drift, from the magnitude of the largest rate move. A brand-new
 * proposed rate or a big swing is 'warning'/'critical'; small moves are 'info'. */
export function severityOf(diff) {
  let maxDelta = 0;
  let hasInsert = false;
  for (const d of diff ?? []) {
    if (d.current_rate == null) {
      hasInsert = true;
      continue;
    }
    const delta = Math.abs((d.new_rate ?? 0) - (d.current_rate ?? 0));
    if (delta > maxDelta) maxDelta = delta;
  }
  if (maxDelta >= 0.01) return 'critical'; // a >= 1 percentage-point move
  if (maxDelta > 0 || hasInsert) return 'warning';
  return 'info';
}

function fmtPct(rate) {
  if (rate == null) return 'n/a';
  return `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}
