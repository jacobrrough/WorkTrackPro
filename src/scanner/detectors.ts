import jsQR from 'jsqr';
import type { ReaderOptions, ReadInputBarcodeFormat } from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Detection layer for the scanner engine.
 *
 * Three strategies, chosen at runtime (most capable first):
 *  - `native`: the browser's `BarcodeDetector` (Chrome / Android / Edge). It runs
 *    off the main thread and reads both QR and common 1D barcodes. We hand it the
 *    `<video>` element directly so there is no per-frame pixel copy on our side.
 *    Used when it supports every requested format.
 *  - `zxing`: the ZXing-C++ WebAssembly reader, lazy-loaded only on browsers
 *    without a (fully capable) native detector — notably iOS Safari and desktop
 *    browsers, which otherwise could not read 1D barcodes at all. The .wasm is
 *    bundled and served from our own origin, so it works without a CDN.
 *  - `jsqr`: a pure-JS last resort (QR only) for when the wasm asset cannot be
 *    fetched. To keep it from freezing the UI we downscale every frame to a small
 *    working size before decoding — decode cost scales with pixel count, so a
 *    full 1080p frame is ~10x more expensive than a 640px one.
 */

export type ScannerFormat =
  | 'qr_code'
  | 'code_128'
  | 'code_39'
  | 'code_93'
  | 'codabar'
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'itf'
  | 'data_matrix'
  | 'pdf417'
  | 'aztec';

export const DEFAULT_FORMATS: ScannerFormat[] = [
  'qr_code',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'data_matrix',
  'pdf417',
  'aztec',
];

/** BarcodeDetector format names → zxing-wasm reader format names. */
const ZXING_FORMATS: Record<ScannerFormat, ReadInputBarcodeFormat> = {
  qr_code: 'QRCode',
  code_128: 'Code128',
  code_39: 'Code39',
  code_93: 'Code93',
  codabar: 'Codabar',
  ean_13: 'EAN13',
  ean_8: 'EAN8',
  upc_a: 'UPCA',
  upc_e: 'UPCE',
  itf: 'ITF',
  data_matrix: 'DataMatrix',
  pdf417: 'PDF417',
  aztec: 'Aztec',
};

export interface Detector {
  kind: 'native' | 'zxing' | 'jsqr';
  /** Returns the first decoded value in the frame, or null if nothing was found. */
  detect: (video: HTMLVideoElement) => Promise<string | null>;
}

/** Largest dimension (px) we downscale to before running the jsQR fallback. */
const JSQR_MAX_DIMENSION = 640;

/**
 * Largest dimension (px) for frames fed to the zxing fallback. Higher than jsQR
 * because 1D barcodes need horizontal resolution to resolve their narrow bars,
 * and the wasm decoder is fast enough to afford it at our throttled frame rate.
 */
const ZXING_MAX_DIMENSION = 1024;

interface FrameGrabber {
  grab: (video: HTMLVideoElement) => ImageData | null;
}

/** Reusable canvas that downscales the current video frame to `maxDimension`. */
function createFrameGrabber(maxDimension: number): FrameGrabber {
  const canvas = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    ctx = null;
  }
  return {
    grab: (video) => {
      if (!ctx) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      const scale = Math.min(1, maxDimension / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.drawImage(video, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    },
  };
}

interface NativeDetectorCandidate {
  detector: Detector;
  /** True when the browser's detector reads every requested format. */
  coversAllFormats: boolean;
}

async function tryCreateNativeDetector(
  formats: ScannerFormat[]
): Promise<NativeDetectorCandidate | null> {
  try {
    const Ctor = typeof window !== 'undefined' ? window.BarcodeDetector : undefined;
    if (!Ctor || typeof Ctor.getSupportedFormats !== 'function') return null;

    const supported = await Ctor.getSupportedFormats();
    const usable = formats.filter((f) => supported.includes(f));
    if (usable.length === 0) return null;

    const detector = new Ctor({ formats: usable });
    return {
      coversAllFormats: usable.length === formats.length,
      detector: {
        kind: 'native',
        detect: async (video) => {
          try {
            const codes = await detector.detect(video);
            for (const code of codes) {
              if (code?.rawValue) return code.rawValue;
            }
            return null;
          } catch {
            // Some frames (mid-resize, not yet ready) make detect throw — treat as "nothing yet".
            return null;
          }
        },
      },
    };
  } catch {
    return null;
  }
}

/**
 * Reconcile zxing's retail-code text with what the native rung produces, so the
 * same physical label yields the SAME string on every device (inventory barcodes
 * are stored and looked up as exact strings).
 *
 * zxing-cpp reports UPC-A as 13-digit EAN-13 text with a leading '0', and UPC-E
 * as a 13-digit '0' + UPC-A expansion. The native BarcodeDetector (GMS Vision on
 * Android) reports the printed values: 12 digits for UPC-A, 8 for UPC-E. We
 * match the native rung because existing stored barcodes came from it.
 */
export function normalizeZxingText(text: string, format: string): string {
  if (format === 'EAN13' && /^0\d{12}$/.test(text)) return text.slice(1);
  if (format === 'UPCE' && /^0\d{12}$/.test(text)) {
    return compressUpcAToUpcE(text.slice(1)) ?? text;
  }
  return text;
}

/**
 * 12-digit UPC-A → 8-digit UPC-E (number system + 6 symbol digits + check), the
 * form printed under a UPC-E symbol and returned by the native rung. Returns
 * null when the number is not zero-suppressible (cannot happen for text zxing
 * expanded FROM a real UPC-E symbol, but guard anyway). Cases follow the
 * standard GS1 zero-suppression rules, canonical order.
 */
function compressUpcAToUpcE(upca: string): string | null {
  const numberSystem = upca[0];
  const check = upca[11];
  if (numberSystem !== '0' && numberSystem !== '1') return null;
  const m = upca.slice(1, 6); // manufacturer digits
  const p = upca.slice(6, 11); // product digits

  let core: string | null = null;
  if (m[3] === '0' && m[4] === '0' && p.startsWith('00')) {
    if (m[2] <= '2') {
      core = m[0] + m[1] + p.slice(2) + m[2];
    } else if (p[2] === '0') {
      core = m.slice(0, 3) + p.slice(3) + '3';
    }
  } else if (m[4] === '0' && p.startsWith('0000')) {
    core = m.slice(0, 4) + p[4] + '4';
  } else if (p.startsWith('0000') && p[4] >= '5') {
    core = m + p[4];
  }
  return core ? numberSystem + core + check : null;
}

/** Picks the first valid decoded text out of a zxing read (normalized), or null. */
export function firstValidZxingText(
  results: ReadonlyArray<{ isValid: boolean; text: string; format: string }>
): string | null {
  for (const result of results) {
    if (result.isValid && result.text) {
      const normalized = normalizeZxingText(result.text, result.format);
      if (normalized) return normalized;
    }
  }
  return null;
}

// Module-scope so every prepareZXingModule call passes the same values:
// zxing-wasm caches the compiled module keyed by a SHALLOW equality check on
// `overrides`, so a fresh inline closure per call would re-compile the ~1MB
// wasm on every scanner open.
const ZXING_MODULE_OVERRIDES = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path,
};

async function tryCreateZxingDetector(formats: ScannerFormat[]): Promise<Detector | null> {
  try {
    // Lazy import: browsers served by the native detector never download the
    // zxing chunk or its wasm.
    const zxing = await import('zxing-wasm/reader');

    // Serve the wasm from our own bundle instead of the default CDN, and await
    // instantiation so a fetch failure here falls through to the jsQR ladder rung.
    await zxing.prepareZXingModule({
      overrides: ZXING_MODULE_OVERRIDES,
      fireImmediately: true,
    });

    const readerOptions: ReaderOptions = {
      formats: formats.map((f) => ZXING_FORMATS[f]),
      maxNumberOfSymbols: 1,
      // Match the native rung's rawValue: the default 'HRI' renders GS1 content
      // parenthesized ("(01)0950…"), which would never match a barcode stored
      // from an Android scan.
      textMode: 'Plain',
    };
    const grabber = createFrameGrabber(ZXING_MAX_DIMENSION);

    return {
      kind: 'zxing',
      detect: async (video) => {
        const image = grabber.grab(video);
        if (!image) return null;
        try {
          const results = await zxing.readBarcodes(image, readerOptions);
          return firstValidZxingText(results);
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

function createJsqrDetector(): Detector {
  const grabber = createFrameGrabber(JSQR_MAX_DIMENSION);
  // Alternate the (expensive) inverted pass across frames so most frames stay cheap
  // while still catching light-on-dark codes within a couple of frames.
  let attemptInverted = false;

  return {
    kind: 'jsqr',
    detect: async (video) => {
      const image = grabber.grab(video);
      if (!image) return null;

      attemptInverted = !attemptInverted;
      const code = jsQR(image.data, image.width, image.height, {
        inversionAttempts: attemptInverted ? 'attemptBoth' : 'dontInvert',
      });
      return code?.data ?? null;
    },
  };
}

/**
 * Cap on the zxing chunk + wasm download during detector creation. The scanner
 * engine awaits createDetector inside start() BEFORE the camera opens and
 * before its stall watchdog is armed, so an unbounded fetch on a flaky network
 * would freeze the UI at "Starting camera…" with no Retry. On timeout we fall
 * through to the next rung; the load keeps going in the background, so the
 * next scanner open usually gets the cached module.
 */
const ZXING_LOAD_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * Build the best available detector for this browser. Never throws.
 *
 * Ladder, most capable first:
 *  1. native `BarcodeDetector`, if it reads every requested format;
 *  2. zxing wasm (QR + 1D everywhere, including iOS Safari);
 *  3. a partially-capable native detector (better than QR-only jsQR);
 *  4. jsQR (QR only).
 */
export async function createDetector(
  formats: ScannerFormat[] = DEFAULT_FORMATS
): Promise<Detector> {
  const native = await tryCreateNativeDetector(formats);
  if (native?.coversAllFormats) return native.detector;

  const zxing = await withTimeout(tryCreateZxingDetector(formats), ZXING_LOAD_TIMEOUT_MS, null);
  if (zxing) return zxing;

  return native?.detector ?? createJsqrDetector();
}
