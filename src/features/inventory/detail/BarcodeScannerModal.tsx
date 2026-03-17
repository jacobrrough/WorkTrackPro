import React, { useEffect, useRef, useCallback, useState } from 'react';
import jsQR from 'jsqr';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => void;
  showToast: (message: string, type: 'error') => void;
}

export function BarcodeScannerModal({
  open,
  onClose,
  onScanned,
  showToast,
}: BarcodeScannerModalProps) {
  const [scanAttempts, setScanAttempts] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const mountedRef = useRef(true);
  const onScannedRef = useRef(onScanned);
  const onCloseRef = useRef(onClose);
  onScannedRef.current = onScanned;
  onCloseRef.current = onClose;

  const stopScan = useCallback(() => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const scanFrame = useCallback(() => {
    if (!scanningRef.current || !mountedRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      requestAnimationFrame(scanFrame);
      return;
    }
    if (video.readyState !== video.HAVE_ENOUGH_DATA || video.videoWidth === 0) {
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
      setScanAttempts((a) => a + 1);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code?.data) {
        scanningRef.current = false;
        stopScan();
        onScannedRef.current(code.data);
        onCloseRef.current();
        return;
      }
      if (scanningRef.current) requestAnimationFrame(scanFrame);
    } catch {
      if (scanningRef.current) requestAnimationFrame(scanFrame);
    }
  }, [stopScan]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopScan();
    };
  }, [stopScan]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setScanAttempts(0);
    scanningRef.current = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          showToast('Camera requires HTTPS. On iOS, use https://your-ip:port', 'error');
          return;
        }
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        }
        if (!stream || !mountedRef.current || !open) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video || !mountedRef.current) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.setAttribute('muted', 'true');
        await video.play();
        if (!scanningRef.current || !mountedRef.current) return;
        scanFrame();
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        showToast(err instanceof Error ? err.message : 'Camera access failed', 'error');
        stopScan();
      }
    })();
    return () => {
      cancelled = true;
      stopScan();
    };
  }, [open, showToast, scanFrame, stopScan]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
      <div className="w-full max-w-md rounded-sm bg-card-dark p-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Scan Barcode</h3>
          <button
            type="button"
            onClick={() => {
              stopScan();
              onClose();
            }}
            className="text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="relative">
          <video ref={videoRef} className="w-full rounded-sm" playsInline muted autoPlay />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
            Scanning... ({scanAttempts} frames)
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-slate-400">
          Position barcode in view. Camera will auto-detect.
        </p>
      </div>
    </div>
  );
}
