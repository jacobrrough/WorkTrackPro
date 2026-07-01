import { useCallback } from 'react';
import { useBarcodeScanner } from '@/scanner/useBarcodeScanner';
import { ScannerViewport } from '@/scanner/ScannerViewport';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => void;
  showToast: (message: string, type: 'error') => void;
}

/**
 * Modal barcode/QR scanner used when assigning a barcode to an inventory item or
 * scanning to find one. Backed by the shared `useBarcodeScanner` engine, which
 * reads 1D barcodes too on browsers with the native BarcodeDetector.
 */
export function BarcodeScannerModal({
  open,
  onClose,
  onScanned,
  showToast,
}: BarcodeScannerModalProps) {
  const handleResult = useCallback(
    (value: string) => {
      onScanned(value);
      onClose();
    },
    [onScanned, onClose]
  );

  const handleError = useCallback(
    (message: string) => {
      showToast(message, 'error');
    },
    [showToast]
  );

  const scanner = useBarcodeScanner({
    active: open,
    onResult: handleResult,
    onError: handleError,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
      <div className="w-full max-w-md rounded-lg bg-card-dark p-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
          <button type="button" onClick={onClose} className="text-white" aria-label="Close scanner">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg">
          <ScannerViewport
            scanner={scanner}
            fit="cover"
            hint="Position the barcode or QR code in view."
          />
        </div>
        <p className="mt-4 text-center text-sm text-muted">Camera will auto-detect.</p>
      </div>
    </div>
  );
}
