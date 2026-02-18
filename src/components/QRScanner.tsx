import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { useToast } from '../Toast';
import { validateBinLocation } from '../core/validation';

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

/**
 * Unified QR code scanner component for inventory, jobs, bin locations, and general scanning.
 * Handles camera access, QR detection, and validation based on scan type.
 */
const QRScanner: React.FC<QRScannerProps> = ({
  scanType = 'any',
  onScanComplete,
  onClose,
  currentValue = '',
  title,
  description,
}) => {
  const { showToast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [debugInfo, setDebugInfo] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);

  const updateDebug = useCallback((message: string) => {
    setDebugInfo((prev) => `${message}\n${prev}`.split('\n').slice(0, 10).join('\n'));
  }, []);

  const stopScan = useCallback(() => {
    updateDebug('🛑 Stopping scan');
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

  const startScan = async () => {
    updateDebug('🎬 Starting scan...');
    setIsScanning(true);
    setScanAttempts(0);
    scanningRef.current = true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported. Use HTTPS on mobile devices.');
      }

      updateDebug('📷 Requesting camera access...');

      let stream: MediaStream | null = null;

      // Try rear camera first (best for scanning)
      try {
        updateDebug('Trying rear camera (high res)...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        updateDebug('Rear camera failed, trying front...');
      }

      // Try front camera
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          updateDebug('Front camera failed, trying any...');
        }
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

      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      updateDebug(`📹 Video: ${settings.width}x${settings.height}`);

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
            updateDebug('📼 Video metadata loaded');
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

      // Try to detect QR code
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (code && code.data) {
        updateDebug(`✅ QR CODE DETECTED: ${code.data}`);

        let scannedData = code.data.trim();

        // Process based on scan type
        if (scanType === 'bin') {
          // Remove BIN: prefix if present
          if (scannedData.startsWith('BIN:')) {
            scannedData = scannedData.substring(4).trim();
          }

          // Validate bin location format
          const error = validateBinLocation(scannedData);
          if (error) {
            updateDebug(`❌ Invalid bin location: ${error}`);
            showToast(`Invalid bin location: ${error}`, 'error');
            // Continue scanning instead of stopping
            requestAnimationFrame(scanFrame);
            return;
          }
        } else if (scanType === 'inventory' || scanType === 'job') {
          // For inventory/job, expect UUID format (basic check)
          // Allow any string but could add stricter validation if needed
          if (scannedData.length < 10) {
            updateDebug(`❌ Code too short: ${scannedData}`);
            showToast('Invalid code format', 'error');
            requestAnimationFrame(scanFrame);
            return;
          }
        }

        // Success - stop scanning and return result
        scanningRef.current = false;
        stopScan();

        if (mountedRef.current) {
          onScanComplete(scannedData);
        }
        return;
      }

      // Try inverted colors every 10th frame
      if (attempts % 10 === 0) {
        const invertedData = new Uint8ClampedArray(imageData.data);
        for (let i = 0; i < invertedData.length; i += 4) {
          invertedData[i] = 255 - invertedData[i];
          invertedData[i + 1] = 255 - invertedData[i + 1];
          invertedData[i + 2] = 255 - invertedData[i + 2];
        }

        const invertedCode = jsQR(invertedData, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (invertedCode && invertedCode.data) {
          updateDebug(`✅ QR CODE DETECTED (inverted): ${invertedCode.data}`);
          scanningRef.current = false;
          stopScan();

          let scannedData = invertedCode.data.trim();
          if (scanType === 'bin' && scannedData.startsWith('BIN:')) {
            scannedData = scannedData.substring(4).trim();
          }

          if (scanType === 'bin') {
            const error = validateBinLocation(scannedData);
            if (error) {
              showToast(`Invalid bin location: ${error}`, 'error');
              return;
            }
          }

          if (mountedRef.current) {
            onScanComplete(scannedData);
          }
          return;
        }
      }
    } catch (err) {
      console.error('Scan frame error:', err);
      updateDebug(`⚠️ Frame error: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    if (scanningRef.current) {
      requestAnimationFrame(scanFrame);
    }
  }, [scanAttempts, scanType, updateDebug, showToast, stopScan, onScanComplete]);

  // Auto-start scanning when component mounts
  useEffect(() => {
    startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getTitle = () => {
    if (title) return title;
    switch (scanType) {
      case 'inventory':
        return 'Scan Inventory QR Code';
      case 'job':
        return 'Scan Job QR Code';
      case 'bin':
        return 'Scan Bin Location QR Code';
      default:
        return 'Scan QR Code';
    }
  };

  const getDescription = () => {
    if (description) return description;
    switch (scanType) {
      case 'inventory':
        return 'Point camera at inventory item QR code';
      case 'job':
        return 'Point camera at job QR code';
      case 'bin':
        return 'Point camera at bin location QR code (format: A4c)';
      default:
        return 'Point camera at QR code';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-b from-black to-transparent p-4">
        <div>
          <h2 className="text-lg font-bold text-white">{getTitle()}</h2>
          <p className="text-xs text-slate-400">{scanAttempts} frames scanned</p>
        </div>
        <button
          onClick={() => {
            stopScan();
            onClose();
          }}
          className="flex size-10 items-center justify-center rounded-sm bg-white/10 text-white hover:bg-white/20"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Video viewport */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="max-h-full max-w-full object-contain"
        />

        {/* Scanning overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {/* Scanning frame */}
            <div className="relative h-64 w-64 rounded-md border-4 border-primary/50">
              {/* Corner brackets */}
              <div className="absolute -left-1 -top-1 h-12 w-12 rounded-tl-2xl border-l-4 border-t-4 border-white"></div>
              <div className="absolute -right-1 -top-1 h-12 w-12 rounded-tr-2xl border-r-4 border-t-4 border-white"></div>
              <div className="absolute -bottom-1 -left-1 h-12 w-12 rounded-bl-2xl border-b-4 border-l-4 border-white"></div>
              <div className="absolute -bottom-1 -right-1 h-12 w-12 rounded-br-2xl border-b-4 border-r-4 border-white"></div>

              {/* Scanning line animation */}
              <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-primary shadow-lg shadow-primary/50"></div>

              {/* Center target */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 rounded-sm border-2 border-white opacity-50"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-gradient-to-t from-black to-transparent p-6">
        <div className="space-y-3">
          <div className="rounded-sm bg-white/10 p-4 backdrop-blur">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-2xl text-primary">qr_code</span>
              <div className="flex-1">
                <p className="mb-1 font-bold text-white">Position code in frame</p>
                <p className="text-sm text-slate-300">{getDescription()}</p>
                <p className="mt-1 text-xs text-slate-400">Hold steady. Scanner will detect automatically.</p>
              </div>
            </div>
          </div>

          {/* Debug info toggle */}
          <details className="rounded-sm bg-white/5 backdrop-blur">
            <summary className="cursor-pointer p-3 text-xs text-slate-400 hover:text-white">
              Debug Info ({scanAttempts} frames)
            </summary>
            <div className="border-t border-white/10 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-300">
                {debugInfo || 'No debug info yet...'}
              </pre>
            </div>
          </details>
        </div>
      </div>

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default QRScanner;
