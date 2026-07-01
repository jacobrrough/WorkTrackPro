import React, { useCallback, useState } from 'react';
import { validateBinLocation, formatBinLocation } from '@/core/validation';
import { useToast } from './Toast';
import { useBarcodeScanner } from './scanner/useBarcodeScanner';
import { ScannerViewport } from './scanner/ScannerViewport';

interface BinLocationScannerProps {
  currentLocation?: string;
  onLocationUpdate: (location: string) => void;
  onClose: () => void;
}

const stripBinPrefix = (raw: string): string =>
  raw.startsWith('BIN:') ? raw.slice(4).trim() : raw;

const BinLocationScanner: React.FC<BinLocationScannerProps> = ({
  currentLocation = '',
  onLocationUpdate,
  onClose,
}) => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'manual' | 'scan'>('manual');
  const [inputValue, setInputValue] = useState(currentLocation);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleResult = useCallback((value: string) => {
    // value is already prefix-stripped and validated by the engine.
    setInputValue(value);
    setValidationError(null);
    setMode('manual');
  }, []);

  const handleReject = useCallback(
    (reason: string) => {
      showToast(`Invalid bin location: ${reason}`, 'error');
      setMode('manual');
    },
    [showToast]
  );

  const handleError = useCallback(
    (message: string) => {
      showToast(message, 'error');
      setMode('manual');
    },
    [showToast]
  );

  const scanner = useBarcodeScanner({
    active: mode === 'scan',
    onResult: handleResult,
    onReject: handleReject,
    onError: handleError,
    transform: stripBinPrefix,
    validate: validateBinLocation,
  });

  const handleInputChange = (value: string) => {
    setInputValue(value.toUpperCase());
    setValidationError(validateBinLocation(value.toUpperCase()));
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    const error = validateBinLocation(trimmed);
    if (error) {
      setValidationError(error);
      return;
    }
    onLocationUpdate(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-background-dark">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line p-4">
          <h3 className="text-lg font-bold text-white">
            {mode === 'scan' ? 'Scan Bin Location' : 'Set Bin Location'}
          </h3>
          <button
            onClick={() => (mode === 'scan' ? setMode('manual') : onClose())}
            className="text-muted hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'manual' && (
            <div className="space-y-4">
              {/* Instructions */}
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-xl text-primary">info</span>
                  <div className="flex-1">
                    <p className="mb-1 font-bold text-white">Bin Location Format</p>
                    <p className="mb-2 text-sm text-muted">
                      Use format:{' '}
                      <span className="rounded bg-white/10 px-2 py-0.5 font-mono">A4c</span>
                    </p>
                    <ul className="space-y-1 text-xs text-muted">
                      <li>• First letter (A-Z) = Rack</li>
                      <li>• Number (1-99) = Shelf</li>
                      <li>• Last letter (a-z) = Section</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Manual Input */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-muted">
                  Bin Location
                </label>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  placeholder="e.g., A4c"
                  className={`h-12 w-full rounded-lg border bg-white/10 px-4 font-mono text-lg uppercase text-white ${
                    validationError ? 'border-red-500' : 'border-line-strong'
                  }`}
                  maxLength={10}
                />
                {validationError && <p className="mt-1 text-xs text-red-400">{validationError}</p>}
                {inputValue && !validationError && (
                  <p className="mt-1 text-xs text-green-400">✓ {formatBinLocation(inputValue)}</p>
                )}
              </div>

              {/* Scan Button */}
              <button
                onClick={() => setMode('scan')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary/20 py-3 font-bold text-white transition-colors hover:bg-primary/30"
              >
                <span className="material-symbols-outlined">qr_code_scanner</span>
                <span>Scan Bin Location QR</span>
              </button>

              {/* Info Box */}
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <p className="text-xs text-blue-200">
                  <span className="font-bold">💡 Tip:</span> To find what's at a bin location, use
                  the main scanner button on the dashboard (bottom right).
                </p>
              </div>
            </div>
          )}

          {mode === 'scan' && (
            <div className="space-y-4">
              {/* Video Scanner */}
              <div
                className="relative overflow-hidden rounded-lg bg-black"
                style={{ aspectRatio: '4/3' }}
              >
                <ScannerViewport
                  scanner={scanner}
                  fit="cover"
                  hint="Point the camera at the bin's QR code (format A4c)."
                  onManualEntry={() => setMode('manual')}
                />
              </div>

              {/* Cancel Button */}
              <button
                onClick={() => setMode('manual')}
                className="w-full rounded-lg border border-red-500 bg-red-500/20 py-3 font-bold text-white transition-colors hover:bg-red-500/30"
              >
                Cancel Scan
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions (only in manual mode) */}
        {mode === 'manual' && (
          <div className="flex gap-3 border-t border-line p-4">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-line-strong bg-white/10 py-3 font-bold text-white transition-colors hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!inputValue || !!validationError}
              className="flex-1 rounded-lg bg-primary py-3 font-bold text-on-accent transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Location
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BinLocationScanner;
