import type { BarcodeScanner } from './useBarcodeScanner';

interface ScannerViewportProps {
  scanner: BarcodeScanner;
  /** Short helper text shown along the bottom edge. */
  hint?: string;
  /** When provided, an "Enter manually" button appears in the error overlay. */
  onManualEntry?: () => void;
  /** How the video fills its box. `cover` for boxed modals, `contain` for full-screen. */
  fit?: 'contain' | 'cover';
  className?: string;
}

/**
 * Presentational camera viewport shared by every scanner: live video, a framing
 * reticle, a torch toggle, and — crucially — a recoverable error state with a
 * Retry button so a stalled/blocked camera is never a dead end.
 */
export function ScannerViewport({
  scanner,
  hint,
  onManualEntry,
  fit = 'contain',
  className = '',
}: ScannerViewportProps) {
  const { videoRef, status, error, frameCount, retry, torchSupported, torchOn, toggleTorch } =
    scanner;

  return (
    <div
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-black ${className}`}
    >
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className={
          fit === 'cover' ? 'h-full w-full object-cover' : 'max-h-full max-w-full object-contain'
        }
      />

      {/* Framing reticle (hidden while showing an error) */}
      {status !== 'error' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-60 w-60 max-w-[70vw] rounded-md border-4 border-primary/40">
            <div className="absolute -left-1 -top-1 h-10 w-10 rounded-tl-2xl border-l-4 border-t-4 border-white" />
            <div className="absolute -right-1 -top-1 h-10 w-10 rounded-tr-2xl border-r-4 border-t-4 border-white" />
            <div className="absolute -bottom-1 -left-1 h-10 w-10 rounded-bl-2xl border-b-4 border-l-4 border-white" />
            <div className="absolute -bottom-1 -right-1 h-10 w-10 rounded-br-2xl border-b-4 border-r-4 border-white" />
            <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-primary shadow-lg shadow-primary/50" />
          </div>
        </div>
      )}

      {/* Starting indicator */}
      {status === 'starting' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            Starting camera…
          </span>
        </div>
      )}

      {/* Live status chip */}
      {status === 'scanning' && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-xs text-white">
          Scanning… ({frameCount})
        </div>
      )}

      {/* Torch toggle */}
      {torchSupported && status === 'scanning' && (
        <button
          type="button"
          onClick={toggleTorch}
          className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
        >
          <span className="material-symbols-outlined">
            {torchOn ? 'flashlight_on' : 'flashlight_off'}
          </span>
        </button>
      )}

      {/* Recoverable error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center">
          <span className="material-symbols-outlined text-4xl text-red-400">videocam_off</span>
          <p className="max-w-xs text-sm text-white">{error || 'Camera error'}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="flex min-h-[44px] items-center gap-2 rounded-sm bg-primary px-4 font-bold text-on-accent"
            >
              <span className="material-symbols-outlined">refresh</span>
              Retry
            </button>
            {onManualEntry && (
              <button
                type="button"
                onClick={onManualEntry}
                className="min-h-[44px] rounded-sm border border-white/20 bg-white/10 px-4 font-bold text-white"
              >
                Enter manually
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom hint */}
      {hint && status !== 'error' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          <p className="rounded bg-black/50 px-3 py-1 text-center text-xs text-white/90">{hint}</p>
        </div>
      )}
    </div>
  );
}
