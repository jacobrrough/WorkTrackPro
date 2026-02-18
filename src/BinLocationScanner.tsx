import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { validateBinLocation, formatBinLocation } from '@/core/validation';
import { useToast } from './Toast';

interface BinLocationScannerProps {
  currentLocation?: string;
  onLocationUpdate: (location: string) => void;
  onClose: () => void;
}

const BinLocationScanner: React.FC<BinLocationScannerProps> = ({
  currentLocation = '',
  onLocationUpdate,
  onClose,
}) => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'manual' | 'scan'>('manual');
  const [inputValue, setInputValue] = useState(currentLocation);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [, setDebugInfo] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  const updateDebug = useCallback((message: string) => {
    setDebugInfo((prev) => `${message}\n${prev}`.split('\n').slice(0, 10).join('\n'));
  }, []);

  const stopScan = useCallback(() => {
    updateDebug('Stopping scan');
    scanningRef.current = false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
    setScanAttempts(0);
  }, [updateDebug]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopScan();
    };
  }, [stopScan]);

  const handleInputChange = (value: string) => {
    setInputValue(value.toUpperCase());
    const error = validateBinLocation(value.toUpperCase());
    setValidationError(error);
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

  const startScan = async () => {
    updateDebug('🎬 Starting scan...');
    setIsScanning(true);
    setScanAttempts(0);
    scanningRef.current = true;
    setMode('scan');

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported on this device');
      }

      updateDebug('📷 Requesting camera access...');

      let stream: MediaStream | null = null;

      // Try rear camera first
      try {
        updateDebug('Trying rear camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        updateDebug('Rear camera failed, trying any camera...');
      }

      // Try any camera
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
      }

      if (!stream) {
        throw new Error('Could not access camera');
      }

      streamRef.current = stream;
      updateDebug('✅ Camera access granted');

      if (videoRef.current && mountedRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.setAttribute('muted', 'true');

        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video ref lost'));
            return;
          }

          const video = videoRef.current;

          const onLoadedMetadata = () => {
            updateDebug('📼 Video ready');
            resolve();
          };

          const onError = () => {
            updateDebug('❌ Video error');
            reject(new Error('Video playback error'));
          };

          video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
          video.addEventListener('error', onError, { once: true });

          video.play().catch(reject);

          setTimeout(() => reject(new Error('Video load timeout')), 5000);
        });

        updateDebug('▶️ Video playing');
        scanFrame();
      }
    } catch (err) {
      console.error('Camera error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Camera access denied';
      updateDebug(`❌ Error: ${errorMessage}`);
      showToast(errorMessage, 'error');
      setIsScanning(false);
      scanningRef.current = false;
      setMode('manual');
    }
  };

  const scanFrame = useCallback(() => {
    if (!scanningRef.current || !mountedRef.current) {
      updateDebug('Scanning stopped');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      requestAnimationFrame(scanFrame);
      return;
    }

    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanFrame);
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      requestAnimationFrame(scanFrame);
      return;
    }

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        requestAnimationFrame(scanFrame);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const attempts = scanAttempts + 1;
      setScanAttempts(attempts);

      if (attempts % 30 === 0) {
        updateDebug(`🔍 Scanning... (${attempts} frames)`);
      }

      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (code && code.data) {
        updateDebug(`✅ QR CODE DETECTED: ${code.data}`);

        let scannedData = code.data;

        // Remove BIN: prefix if present
        if (scannedData.startsWith('BIN:')) {
          scannedData = scannedData.substring(4);
        }

        // Validate as bin location
        const error = validateBinLocation(scannedData);
        if (error) {
          updateDebug(`❌ Invalid bin location: ${error}`);
          showToast(
            `Invalid bin location: ${error}. Use format A4c (Rack A, Shelf 4, Section c)`,
            'error'
          );
          stopScan();
          setMode('manual');
        } else {
          scanningRef.current = false;
          stopScan();
          setInputValue(scannedData);
          setValidationError(null);
          setMode('manual');
          updateDebug(`✅ Valid bin location: ${scannedData}`);
        }
        return;
      }
    } catch (err) {
      console.error('Scan frame error:', err);
    }

    if (scanningRef.current) {
      requestAnimationFrame(scanFrame);
    }
  }, [scanAttempts, updateDebug, showToast, stopScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-white/10 bg-background-dark">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h3 className="text-lg font-bold text-white">
            {mode === 'scan' ? 'Scan Bin Location' : 'Set Bin Location'}
          </h3>
          <button
            onClick={() => {
              if (isScanning) {
                stopScan();
                setMode('manual');
              } else {
                onClose();
              }
            }}
            className="text-slate-400 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'manual' && (
            <div className="space-y-4">
              {/* Instructions */}
              <div className="rounded-sm border border-primary/30 bg-primary/10 p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-xl text-primary">info</span>
                  <div className="flex-1">
                    <p className="mb-1 font-bold text-white">Bin Location Format</p>
                    <p className="mb-2 text-sm text-slate-300">
                      Use format:{' '}
                      <span className="rounded bg-white/10 px-2 py-0.5 font-mono">A4c</span>
                    </p>
                    <ul className="space-y-1 text-xs text-slate-400">
                      <li>• First letter (A-Z) = Rack</li>
                      <li>• Number (1-99) = Shelf</li>
                      <li>• Last letter (a-z) = Section</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Manual Input */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                  Bin Location
                </label>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  placeholder="e.g., A4c"
                  className={`h-12 w-full rounded-sm border bg-white/10 px-4 font-mono text-lg uppercase text-white ${
                    validationError ? 'border-red-500' : 'border-white/20'
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
                onClick={startScan}
                className="flex w-full items-center justify-center gap-2 rounded-sm border border-primary bg-primary/20 py-3 font-bold text-white transition-colors hover:bg-primary/30"
              >
                <span className="material-symbols-outlined">qr_code_scanner</span>
                <span>Scan Bin Location QR</span>
              </button>

              {/* Info Box */}
              <div className="rounded-sm border border-blue-500/30 bg-blue-500/10 p-3">
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
                className="relative overflow-hidden rounded-sm bg-black"
                style={{ aspectRatio: '4/3' }}
              >
                <video
                  ref={videoRef}
                  playsInline
                  autoPlay
                  muted
                  className="h-full w-full object-cover"
                />

                {/* Scanning overlay */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    <div className="relative h-48 w-48 rounded-md border-4 border-primary/50">
                      {/* Corner brackets */}
                      <div className="absolute -left-1 -top-1 h-10 w-10 rounded-tl-2xl border-l-4 border-t-4 border-white"></div>
                      <div className="absolute -right-1 -top-1 h-10 w-10 rounded-tr-2xl border-r-4 border-t-4 border-white"></div>
                      <div className="absolute -bottom-1 -left-1 h-10 w-10 rounded-bl-2xl border-b-4 border-l-4 border-white"></div>
                      <div className="absolute -bottom-1 -right-1 h-10 w-10 rounded-br-2xl border-b-4 border-r-4 border-white"></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div className="rounded-sm bg-white/10 p-4 backdrop-blur">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-xl text-primary">qr_code</span>
                  <div className="flex-1">
                    <p className="mb-1 font-bold text-white">Scan Bin Location QR Code</p>
                    <p className="mb-2 text-sm text-slate-300">
                      Point camera at the QR code on the physical bin location
                    </p>
                    <p className="text-xs text-slate-400">{scanAttempts} frames scanned</p>
                  </div>
                </div>
              </div>

              {/* Cancel Button */}
              <button
                onClick={() => {
                  stopScan();
                  setMode('manual');
                }}
                className="w-full rounded-sm border border-red-500 bg-red-500/20 py-3 font-bold text-white transition-colors hover:bg-red-500/30"
              >
                Cancel Scan
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions (only in manual mode) */}
        {mode === 'manual' && (
          <div className="flex gap-3 border-t border-white/10 p-4">
            <button
              onClick={onClose}
              className="flex-1 rounded-sm border border-white/20 bg-white/10 py-3 font-bold text-white transition-colors hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!inputValue || !!validationError}
              className="flex-1 rounded-sm bg-primary py-3 font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Location
            </button>
          </div>
        )}

        {/* Hidden canvas for QR scanning */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default BinLocationScanner;
