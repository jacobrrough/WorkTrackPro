import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDetector,
  firstValidZxingText,
  normalizeZxingText,
  DEFAULT_FORMATS,
} from './detectors';

const zxingMocks = vi.hoisted(() => ({
  prepareZXingModule: vi.fn(),
  readBarcodes: vi.fn(),
}));

vi.mock('zxing-wasm/reader', () => ({
  prepareZXingModule: zxingMocks.prepareZXingModule,
  readBarcodes: zxingMocks.readBarcodes,
}));
vi.mock('zxing-wasm/reader/zxing_reader.wasm?url', () => ({ default: 'zxing_reader.wasm' }));

/** Minimal stand-in for the browser's BarcodeDetector. */
function installFakeBarcodeDetector(supported: string[]) {
  class FakeBarcodeDetector {
    static getSupportedFormats() {
      return Promise.resolve(supported);
    }
    detect() {
      return Promise.resolve([]);
    }
  }
  (window as { BarcodeDetector?: unknown }).BarcodeDetector = FakeBarcodeDetector;
}

afterEach(() => {
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.clearAllMocks();
});

describe('createDetector ladder', () => {
  it('uses the native detector when it supports every requested format', async () => {
    installFakeBarcodeDetector([...DEFAULT_FORMATS]);
    const detector = await createDetector();
    expect(detector.kind).toBe('native');
    expect(zxingMocks.prepareZXingModule).not.toHaveBeenCalled();
  });

  it('falls back to zxing when there is no native detector', async () => {
    zxingMocks.prepareZXingModule.mockResolvedValue({});
    const detector = await createDetector();
    expect(detector.kind).toBe('zxing');
  });

  it('prefers zxing over a native detector that only reads a subset (e.g. QR only)', async () => {
    installFakeBarcodeDetector(['qr_code']);
    zxingMocks.prepareZXingModule.mockResolvedValue({});
    const detector = await createDetector();
    expect(detector.kind).toBe('zxing');
  });

  it('keeps the partial native detector when the zxing wasm cannot load', async () => {
    installFakeBarcodeDetector(['qr_code']);
    zxingMocks.prepareZXingModule.mockRejectedValue(new Error('wasm fetch failed'));
    const detector = await createDetector();
    expect(detector.kind).toBe('native');
  });

  it('falls back to jsQR when neither native nor zxing is available', async () => {
    zxingMocks.prepareZXingModule.mockRejectedValue(new Error('wasm fetch failed'));
    const detector = await createDetector();
    expect(detector.kind).toBe('jsqr');
  });

  it('falls through to the next rung when the zxing load stalls instead of failing', async () => {
    vi.useFakeTimers();
    try {
      // Never settles — simulates a hung chunk/wasm fetch on a flaky network.
      zxingMocks.prepareZXingModule.mockReturnValue(new Promise(() => {}));
      const pending = createDetector();
      await vi.advanceTimersByTimeAsync(8000);
      const detector = await pending;
      expect(detector.kind).toBe('jsqr');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('firstValidZxingText', () => {
  it('returns the first valid, non-empty decode', () => {
    expect(
      firstValidZxingText([
        { isValid: false, text: 'checksum-error', format: 'Code128' },
        { isValid: true, text: '', format: 'QRCode' },
        { isValid: true, text: 'BIN:A4c', format: 'QRCode' },
        { isValid: true, text: 'second', format: 'QRCode' },
      ])
    ).toBe('BIN:A4c');
  });

  it('returns null when nothing decoded cleanly', () => {
    expect(firstValidZxingText([])).toBeNull();
    expect(firstValidZxingText([{ isValid: false, text: 'bad', format: 'ITF' }])).toBeNull();
  });
});

describe('normalizeZxingText (cross-rung parity with the native BarcodeDetector)', () => {
  it('strips the leading zero zxing adds to UPC-A (reported as 13-digit EAN13)', () => {
    // zxing-cpp reads UPC-A '036000291452' back as EAN13 text '0036000291452'.
    expect(normalizeZxingText('0036000291452', 'EAN13')).toBe('036000291452');
  });

  it('leaves genuine EAN-13 values untouched', () => {
    expect(normalizeZxingText('4006381333931', 'EAN13')).toBe('4006381333931');
  });

  it('re-compresses the UPC-A expansion zxing reports for UPC-E symbols', () => {
    // zxing-cpp reads UPC-E '01234565' back as text '0012345000065' (0 + UPC-A
    // expansion); the native rung reports the printed 8 digits.
    expect(normalizeZxingText('0012345000065', 'UPCE')).toBe('01234565');
    // Zero-suppression case 1 (manufacturer x-x-0-0-0, product 00xxx):
    expect(normalizeZxingText('0012000005672', 'UPCE')).toBe('01256702');
    // Case 3 (manufacturer x-x-x-0-0, product 000xx):
    expect(normalizeZxingText('0012300000459', 'UPCE')).toBe('01234539');
    // Case 4 (manufacturer x-x-x-x-0, product 0000x):
    expect(normalizeZxingText('0012340000091', 'UPCE')).toBe('01234941');
  });

  it('does not touch non-retail formats or odd shapes', () => {
    expect(normalizeZxingText('0123456789', 'Code128')).toBe('0123456789');
    expect(normalizeZxingText('ABC-123', 'QRCode')).toBe('ABC-123');
    expect(normalizeZxingText('036000291452', 'UPCA')).toBe('036000291452');
  });
});
