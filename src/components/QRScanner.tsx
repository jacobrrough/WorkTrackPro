import React, { useCallback } from 'react';
import { useToast } from '../Toast';
import { validateBinLocation } from '../core/validation';
import { useBarcodeScanner } from '../scanner/useBarcodeScanner';
import { ScannerViewport } from '../scanner/ScannerViewport';
import type { ScannerFormat } from '../scanner/detectors';

// Bin and job labels are app-generated QR codes. Restricting those scan types
// keeps a stray 1D product barcode on a nearby box from being decoded first and
// rejected (which would bounce the user out of the scan).
const QR_ONLY: ScannerFormat[] = ['qr_code'];

export type ScanType = 'inventory' | 'job' | 'bin' | 'any';

interface QRScannerProps {
  /** What type of scan this is - determines validation and behavior */
  scanType?: ScanType;
  /** Callback when QR code is successfully scanned */
  onScanComplete: (data: string) => void;
  /** Callback to close scanner */
  onClose: () => void;
  /** Optional: current value to show */
  currentValue?: string;
  /** Optional: title override */
  title?: string;
  /** Optional: description override */
  description?: string;
}

const transformForType =
  (scanType: ScanType) =>
  (raw: string): string => {
    if (scanType === 'bin' && raw.startsWith('BIN:')) return raw.slice(4).trim();
    return raw;
  };

const validateForType =
  (scanType: ScanType) =>
  (value: string): string | null => {
    if (scanType === 'bin') return validateBinLocation(value);
    if (scanType === 'inventory' || scanType === 'job') {
      if (value.length < 10) return 'That code looks too short — try again';
    }
    return null;
  };

const getTitle = (scanType: ScanType, title?: string) => {
  if (title) return title;
  switch (scanType) {
    case 'inventory':
      return 'Scan Inventory Code';
    case 'job':
      return 'Scan Job QR Code';
    case 'bin':
      return 'Scan Bin Location QR Code';
    default:
      return 'Scan Code';
  }
};

const getDescription = (scanType: ScanType, description?: string) => {
  if (description) return description;
  switch (scanType) {
    case 'inventory':
      return "Point camera at the item's QR code or barcode";
    case 'job':
      return 'Point camera at job QR code';
    case 'bin':
      return 'Point camera at bin location QR code (format: A4c)';
    default:
      return 'Point camera at a QR code or barcode';
  }
};

/**
 * Unified full-screen scanner for inventory, jobs, bin locations, and general
 * scanning. Camera handling, throttled detection, error recovery, and torch are
 * all provided by the shared `useBarcodeScanner` engine.
 */
const QRScanner: React.FC<QRScannerProps> = ({
  scanType = 'any',
  onScanComplete,
  onClose,
  currentValue: _currentValue = '',
  title,
  description,
}) => {
  const { showToast } = useToast();

  const handleResult = useCallback(
    (value: string) => {
      onScanComplete(value);
    },
    [onScanComplete]
  );

  const handleReject = useCallback(
    (reason: string) => {
      showToast(reason, 'error');
    },
    [showToast]
  );

  const handleError = useCallback(
    (message: string) => {
      showToast(message, 'error');
    },
    [showToast]
  );

  const scanner = useBarcodeScanner({
    active: true,
    onResult: handleResult,
    onReject: handleReject,
    onError: handleError,
    transform: transformForType(scanType),
    validate: validateForType(scanType),
    formats: scanType === 'bin' || scanType === 'job' ? QR_ONLY : undefined,
    // "any" is the find-by-scan mode (Dashboard / Scanner tab) — keep scanning so an
    // unrecognized code doesn't dead-end the screen. Specific types are single-shot.
    continuous: scanType === 'any',
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-b from-black to-transparent p-4">
        <div>
          <h2 className="text-lg font-bold text-white">{getTitle(scanType, title)}</h2>
          <p className="text-xs text-muted">{scanner.frameCount} frames scanned</p>
        </div>
        <button
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-lg bg-overlay/10 text-white hover:bg-overlay/20"
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
        <div className="rounded-lg bg-overlay/10 p-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-2xl text-primary">qr_code</span>
            <div className="flex-1">
              <p className="mb-1 font-bold text-white">Position code in frame</p>
              <p className="text-sm text-muted">{getDescription(scanType, description)}</p>
              <p className="mt-1 text-xs text-muted">
                Hold steady. Scanner will detect automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
