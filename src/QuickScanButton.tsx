import React, { useCallback, useState } from 'react';
import { useBarcodeScanner } from './scanner/useBarcodeScanner';
import { ScannerViewport } from './scanner/ScannerViewport';

interface QuickScanButtonProps {
  onScanComplete: (barcode: string) => void;
  onError?: (message: string) => void;
}

/**
 * Floating quick-scan button. Opens a full-screen scanner backed by the shared
 * `useBarcodeScanner` engine.
 */
const QuickScanButton: React.FC<QuickScanButtonProps> = ({ onScanComplete, onError }) => {
  const [isScanning, setIsScanning] = useState(false);

  const handleResult = useCallback(
    (value: string) => {
      setIsScanning(false);
      onScanComplete(value);
    },
    [onScanComplete]
  );

  const handleError = useCallback(
    (message: string) => {
      if (onError) onError(message);
    },
    [onError]
  );

  const scanner = useBarcodeScanner({
    active: isScanning,
    onResult: handleResult,
    onError: handleError,
  });

  return (
    <>
      <button
        onClick={() => setIsScanning(true)}
        disabled={isScanning}
        className="fixed bottom-24 right-6 z-40 flex size-14 items-center justify-center rounded-sm bg-primary shadow-xl transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
        title="Scan QR Code or Barcode"
      >
        <span className="material-symbols-outlined text-2xl text-white">
          {isScanning ? 'stop_circle' : 'qr_code_scanner'}
        </span>
      </button>

      {isScanning && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-b from-black to-transparent p-4">
            <div>
              <h2 className="text-lg font-bold text-white">Scanner</h2>
              <p className="text-xs text-muted">{scanner.frameCount} frames scanned</p>
            </div>
            <button
              onClick={() => setIsScanning(false)}
              className="flex size-10 items-center justify-center rounded-sm bg-white/10 text-white hover:bg-white/20"
              aria-label="Close scanner"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Video viewport */}
          <div className="min-h-0 flex-1">
            <ScannerViewport scanner={scanner} fit="contain" />
          </div>

          {/* Instructions */}
          <div className="bg-gradient-to-t from-black to-transparent p-6">
            <div className="rounded-sm bg-white/10 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-2xl text-primary">qr_code</span>
                <div className="flex-1">
                  <p className="mb-1 font-bold text-white">Position code in frame</p>
                  <p className="text-sm text-muted">
                    Hold steady. Scanner will detect automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QuickScanButton;
