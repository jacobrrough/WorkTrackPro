import jsQR from 'jsqr';

/**
 * Detection layer for the scanner engine.
 *
 * Two strategies, chosen at runtime:
 *  - `native`: the browser's `BarcodeDetector` (Chrome / Android / Edge). It runs
 *    off the main thread and reads both QR and common 1D barcodes. We hand it the
 *    `<video>` element directly so there is no per-frame pixel copy on our side.
 *  - `jsqr`: a pure-JS fallback (QR only) for browsers without `BarcodeDetector`
 *    (notably iOS Safari). To keep it from freezing the UI we downscale every
 *    frame to a small working size before decoding — jsQR cost scales with pixel
 *    count, so a full 1080p frame is ~10x more expensive than a 640px one.
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

export interface Detector {
  kind: 'native' | 'jsqr';
  /** Returns the first decoded value in the frame, or null if nothing was found. */
  detect: (video: HTMLVideoElement) => Promise<string | null>;
}

/** Largest dimension (px) we downscale to before running the jsQR fallback. */
const JSQR_MAX_DIMENSION = 640;

async function tryCreateNativeDetector(formats: ScannerFormat[]): Promise<Detector | null> {
  try {
    const Ctor = typeof window !== 'undefined' ? window.BarcodeDetector : undefined;
    if (!Ctor || typeof Ctor.getSupportedFormats !== 'function') return null;

    const supported = await Ctor.getSupportedFormats();
    const usable = formats.filter((f) => supported.includes(f));
    if (usable.length === 0) return null;

    const detector = new Ctor({ formats: usable });
    return {
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
    };
  } catch {
    return null;
  }
}

function createJsqrDetector(): Detector {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Alternate the (expensive) inverted pass across frames so most frames stay cheap
  // while still catching light-on-dark codes within a couple of frames.
  let attemptInverted = false;

  return {
    kind: 'jsqr',
    detect: async (video) => {
      if (!ctx) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      const scale = Math.min(1, JSQR_MAX_DIMENSION / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);

      attemptInverted = !attemptInverted;
      const code = jsQR(image.data, w, h, {
        inversionAttempts: attemptInverted ? 'attemptBoth' : 'dontInvert',
      });
      return code?.data ?? null;
    },
  };
}

/**
 * Build the best available detector for this browser. Never throws — falls back
 * to the jsQR strategy if the native API is missing or unusable.
 */
export async function createDetector(
  formats: ScannerFormat[] = DEFAULT_FORMATS
): Promise<Detector> {
  const native = await tryCreateNativeDetector(formats);
  return native ?? createJsqrDetector();
}
