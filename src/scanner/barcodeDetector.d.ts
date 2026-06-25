/**
 * Ambient typings for the browser-native Shape Detection API (`BarcodeDetector`).
 *
 * The standard DOM lib does not yet ship these definitions, so we declare the
 * subset we use. Access it through `window.BarcodeDetector` (it is undefined on
 * browsers that do not implement it, e.g. iOS Safari) — never reference the bare
 * global, which would throw a ReferenceError where it is unsupported.
 */
export {};

declare global {
  interface DetectedBarcode {
    rawValue: string;
    format: string;
    boundingBox: DOMRectReadOnly;
    cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  }

  interface BarcodeDetectorOptions {
    formats?: string[];
  }

  class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions);
    static getSupportedFormats(): Promise<string[]>;
    detect(source: CanvasImageSource | Blob | ImageData): Promise<DetectedBarcode[]>;
  }

  interface Window {
    BarcodeDetector?: typeof BarcodeDetector;
  }
}
