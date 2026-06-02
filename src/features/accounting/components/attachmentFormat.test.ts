import { describe, it, expect } from 'vitest';
import {
  fileKindIcon,
  formatBytes,
  isImage,
  isPdf,
  maxSizeLabel,
  previewKindFor,
} from './attachmentFormat';

describe('previewKindFor', () => {
  it('classifies every image/* MIME as an image (case-insensitive)', () => {
    expect(previewKindFor('image/png')).toBe('image');
    expect(previewKindFor('image/jpeg')).toBe('image');
    expect(previewKindFor('image/gif')).toBe('image');
    expect(previewKindFor('image/webp')).toBe('image');
    expect(previewKindFor('IMAGE/PNG')).toBe('image');
  });

  it('classifies application/pdf as pdf (case-insensitive)', () => {
    expect(previewKindFor('application/pdf')).toBe('pdf');
    expect(previewKindFor('APPLICATION/PDF')).toBe('pdf');
  });

  it('treats null / unknown / non-previewable types as other', () => {
    expect(previewKindFor(null)).toBe('other');
    expect(previewKindFor(undefined)).toBe('other');
    expect(previewKindFor('')).toBe('other');
    expect(previewKindFor('application/zip')).toBe('other');
    expect(previewKindFor('text/csv')).toBe('other');
  });
});

describe('isImage / isPdf', () => {
  it('isImage is true only for images', () => {
    expect(isImage('image/png')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isImage(null)).toBe(false);
  });

  it('isPdf is true only for PDFs', () => {
    expect(isPdf('application/pdf')).toBe(true);
    expect(isPdf('image/png')).toBe(false);
    expect(isPdf(null)).toBe(false);
  });
});

describe('fileKindIcon', () => {
  it('maps each kind to its Material Symbol glyph', () => {
    expect(fileKindIcon('image/png')).toBe('image');
    expect(fileKindIcon('application/pdf')).toBe('picture_as_pdf');
    expect(fileKindIcon('application/octet-stream')).toBe('description');
    expect(fileKindIcon(null)).toBe('description');
  });
});

describe('formatBytes', () => {
  it('shows whole bytes under 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('shows KB for 1 KiB up to <1 MiB, one decimal, trailing .0 dropped', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB'); // 1.5 KiB
    expect(formatBytes(10 * 1024)).toBe('10 KB');
  });

  it('shows MB for 1 MiB and up', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(Math.round(2.5 * 1024 * 1024))).toBe('2.5 MB');
  });

  it('shows GB for 1 GiB and up', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('returns an em-dash placeholder for unknown / invalid sizes (null preserved, not 0)', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('maxSizeLabel', () => {
  it('derives the picker hint from ATTACHMENT_MAX_BYTES (10 MiB → "10 MB")', () => {
    expect(maxSizeLabel()).toBe('10 MB');
  });
});
