import { describe, it, expect } from 'vitest';
import {
  buildStoragePath,
  extensionFor,
  validateAttachmentFile,
  ACCOUNTING_PATH_PREFIX,
} from './attachments';
import { ATTACHMENT_MAX_BYTES } from '../../../features/accounting/types';

/**
 * Unit tests for the PURE helpers of the attachments service (the path builder + the
 * client-side upload guard). The storage/metadata round-trip is integration-level (it needs a
 * live bucket + RLS) and is proven on the Supabase dev branch / by the Reviewer; these tests
 * pin the deterministic logic the upload control depends on. HELD / UNVERIFIED — NOT FOR
 * FILING: this module is flag-dark; nothing here moves money or posts a journal entry.
 */

describe('extensionFor', () => {
  it('returns the lower-cased extension without the dot', () => {
    expect(extensionFor('receipt.PDF')).toBe('pdf');
    expect(extensionFor('photo.JPG')).toBe('jpg');
    expect(extensionFor('a.b.c.png')).toBe('png'); // last segment wins
  });

  it('falls back to "bin" when there is no usable extension', () => {
    expect(extensionFor('noext')).toBe('bin');
    expect(extensionFor('trailingdot.')).toBe('bin');
    expect(extensionFor('')).toBe('bin');
  });
});

describe('buildStoragePath', () => {
  it('namespaces objects under accounting/<entity_type>/<entity_id>/<uuid>.<ext>', () => {
    const path = buildStoragePath('invoice', 'inv-1', 'receipt.pdf', 'fixed-uuid');
    expect(path).toBe(`${ACCOUNTING_PATH_PREFIX}/invoice/inv-1/fixed-uuid.pdf`);
  });

  it('uses the entity type in the prefix so each kind has its own folder', () => {
    expect(buildStoragePath('bill', 'b1', 'x.png', 'u')).toBe('accounting/bill/b1/u.png');
    expect(buildStoragePath('fixed_asset', 'fa1', 'x.png', 'u')).toBe(
      'accounting/fixed_asset/fa1/u.png'
    );
    expect(buildStoragePath('journal_entry', 'je1', 'x.png', 'u')).toBe(
      'accounting/journal_entry/je1/u.png'
    );
  });

  it('generates a unique uuid per call when none is supplied (no path collision for the same file)', () => {
    const a = buildStoragePath('invoice', 'inv-1', 'same.pdf');
    const b = buildStoragePath('invoice', 'inv-1', 'same.pdf');
    expect(a).not.toBe(b);
    // Both still carry the right prefix + extension.
    expect(a.startsWith('accounting/invoice/inv-1/')).toBe(true);
    expect(a.endsWith('.pdf')).toBe(true);
  });

  it('defaults a no-extension filename to .bin', () => {
    expect(buildStoragePath('payment', 'p1', 'scan', 'u')).toBe('accounting/payment/p1/u.bin');
  });
});

describe('validateAttachmentFile', () => {
  const make = (size: number, type: string, name = 'f'): Pick<File, 'size' | 'type' | 'name'> => ({
    size,
    type,
    name,
  });

  it('accepts an in-bounds image and PDF', () => {
    expect(validateAttachmentFile(make(1024, 'image/png')).ok).toBe(true);
    expect(validateAttachmentFile(make(1024, 'application/pdf')).ok).toBe(true);
    expect(validateAttachmentFile(make(1024, 'image/jpeg')).ok).toBe(true);
  });

  it('rejects an empty (0-byte) file', () => {
    const r = validateAttachmentFile(make(0, 'image/png'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });

  it('rejects a file over the size cap (boundary: exactly at the cap is allowed)', () => {
    expect(validateAttachmentFile(make(ATTACHMENT_MAX_BYTES, 'application/pdf')).ok).toBe(true);
    const over = validateAttachmentFile(make(ATTACHMENT_MAX_BYTES + 1, 'application/pdf'));
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/larger than/i);
  });

  it('rejects a disallowed MIME type when the browser provided one', () => {
    const r = validateAttachmentFile(make(1024, 'application/x-msdownload', 'evil.exe'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/images.*PDF/i);
  });

  it('allows an empty MIME string through the accept-list (browser omitted type) but still size-checks it', () => {
    // No type → cannot enforce the allow-list client-side; row content_type will be null.
    expect(validateAttachmentFile(make(1024, '')).ok).toBe(true);
    // …but an empty-type file is still rejected if it is over the cap.
    expect(validateAttachmentFile(make(ATTACHMENT_MAX_BYTES + 1, '')).ok).toBe(false);
  });
});
