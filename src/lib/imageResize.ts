/**
 * Resize an uploaded image to a bounded size and return it as a base64 data URL.
 *
 * Used for the packing-slip logo: a data URL embeds the image directly in the
 * settings row, so it prints/exports without CORS taint (html2canvas) and works
 * offline. We cap the dimensions so the stored string stays small.
 */

const DEFAULT_MAX_DIM = 512;

export interface ResizeResult {
  dataUrl: string;
  width: number;
  height: number;
  /** Approximate decoded byte size of the data URL payload. */
  bytes: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

/** Rough byte size of a data URL's base64 payload (3 bytes per 4 base64 chars). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Read, decode and downscale an image file to fit within `maxDim` px on its
 * longest side. PNG output preserves logo transparency. Falls back to the raw
 * data URL if the browser can't provide a 2D canvas context.
 */
export async function resizeImageFile(
  file: File,
  maxDim: number = DEFAULT_MAX_DIM
): Promise<ResizeResult> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(originalDataUrl);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) {
    return { dataUrl: originalDataUrl, width: 0, height: 0, bytes: dataUrlBytes(originalDataUrl) };
  }

  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: originalDataUrl, width, height, bytes: dataUrlBytes(originalDataUrl) };
  }
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, width, height, bytes: dataUrlBytes(dataUrl) };
}
