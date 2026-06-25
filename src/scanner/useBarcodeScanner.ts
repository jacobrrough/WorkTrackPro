import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createDetector, type Detector, type ScannerFormat } from './detectors';

export type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'error';

export type ScannerErrorKind =
  | 'insecure'
  | 'permission'
  | 'notfound'
  | 'inuse'
  | 'stalled'
  | 'unknown';

export interface UseBarcodeScannerOptions {
  /** When true the camera runs and scanning is active. Flip to false to release it. */
  active: boolean;
  /** Called once with a decoded, transformed, validated value. The loop halts after this. */
  onResult: (value: string) => void;
  /** Called when a decoded value fails `validate` (scanning continues). */
  onReject?: (reason: string) => void;
  /** Called when the camera cannot run (permission, busy, stalled, …). */
  onError?: (message: string, kind: ScannerErrorKind) => void;
  /** Normalize a raw decode before validation/delivery (e.g. strip a "BIN:" prefix). */
  transform?: (raw: string) => string;
  /** Return a reason string to reject (keep scanning), or null to accept. */
  validate?: (value: string) => string | null;
  /**
   * Keep scanning after delivering a result instead of halting (single-shot).
   * Use for find-by-scan screens that scan many codes in a row. The cooldown
   * debounces repeats of the same value. Defaults to false.
   */
  continuous?: boolean;
  /** Barcode formats to look for. Defaults to QR + common 1D formats. */
  formats?: ScannerFormat[];
  /** Minimum gap between decode attempts (ms). Throttles CPU so the UI stays responsive. */
  scanIntervalMs?: number;
  /** Ignore a repeat of the same value within this window (ms). */
  cooldownMs?: number;
}

export interface BarcodeScanner {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  error: string | null;
  /** Count of decode attempts since start — a lightweight "is it alive" signal for the UI. */
  frameCount: number;
  retry: () => void;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
}

/** If no decodable frame arrives within this window, we declare the camera stalled. */
const WATCHDOG_MS = 10000;

/** Resolve once the video can render frames, or after `timeoutMs` (the watchdog handles true stalls). */
function waitForVideoReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onReady = () => {
      if (video.videoWidth > 0) finish();
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      clearTimeout(timer);
    };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Robust camera + barcode scanning engine shared by every scanner in the app.
 *
 * Hardened against the failure modes that made the old scanners "freeze":
 *  - decode work is downscaled + throttled so it never saturates the main thread;
 *  - the loop reads everything from refs, so it can never get pinned to a stale render;
 *  - the camera is always released — including when the component unmounts *while*
 *    `getUserMedia` is still resolving (the leak that left the camera locked and the
 *    next open black/frozen);
 *  - a watchdog surfaces a Retry affordance instead of spinning forever;
 *  - the camera is released on tab/app backgrounding and reacquired on return.
 */
export function useBarcodeScanner(options: UseBarcodeScannerOptions): BarcodeScanner {
  const { active, scanIntervalMs = 100, cooldownMs = 1500 } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const torchTrackRef = useRef<MediaStreamTrack | null>(null);

  const rafRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  // Bumped on every start/stop so in-flight async work from a superseded run bails out.
  const generationRef = useRef(0);
  const decodingRef = useRef(false);
  const lastDetectAtRef = useRef(0);
  const lastReadyAtRef = useRef(0);
  const lastValueRef = useRef<{ value: string; at: number } | null>(null);
  const frameCountRef = useRef(0);
  const loopRef = useRef<() => void>(() => {});

  // Latest options/callbacks, so the loop and stable callbacks never go stale and
  // identity churn in the consumer's callbacks never restarts the camera.
  const optRef = useRef(options);
  optRef.current = options;

  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const clearTimers = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (watchdogRef.current != null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    torchTrackRef.current = null;
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    generationRef.current += 1;
    decodingRef.current = false;
    clearTimers();
    releaseStream();
    setTorchSupported(false);
    setTorchOn(false);
  }, [clearTimers, releaseStream]);

  const fail = useCallback(
    (message: string, kind: ScannerErrorKind) => {
      runningRef.current = false;
      generationRef.current += 1;
      decodingRef.current = false;
      clearTimers();
      releaseStream();
      setTorchSupported(false);
      setTorchOn(false);
      setStatus('error');
      setError(message);
      optRef.current.onError?.(message, kind);
    },
    [clearTimers, releaseStream]
  );

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, []);

  // The detection loop. Reassigned every render so it always sees fresh refs, but
  // it is only ever invoked via `loopRef.current()` so scheduling stays stable.
  loopRef.current = () => {
    if (!runningRef.current) return;
    const gen = generationRef.current;
    const video = videoRef.current;
    const detector = detectorRef.current;

    if (
      !video ||
      !detector ||
      video.readyState < video.HAVE_ENOUGH_DATA ||
      video.videoWidth === 0
    ) {
      scheduleNext();
      return;
    }

    const now = performance.now();
    lastReadyAtRef.current = now; // a renderable frame arrived → reset the stall watchdog
    if (decodingRef.current || now - lastDetectAtRef.current < scanIntervalMs) {
      scheduleNext();
      return;
    }

    lastDetectAtRef.current = now;
    decodingRef.current = true;
    detector
      .detect(video)
      .then((raw) => {
        decodingRef.current = false;
        if (!runningRef.current || gen !== generationRef.current) return;

        frameCountRef.current += 1;
        if (frameCountRef.current % 4 === 0) setFrameCount(frameCountRef.current);

        if (raw) {
          const opt = optRef.current;
          let value = raw.trim();
          if (opt.transform) value = opt.transform(value);
          if (value) {
            const last = lastValueRef.current;
            const isDuplicate = last != null && last.value === value && now - last.at < cooldownMs;
            if (!isDuplicate) {
              lastValueRef.current = { value, at: now };
              const reason = opt.validate ? opt.validate(value) : null;
              if (reason) {
                opt.onReject?.(reason);
              } else {
                opt.onResult(value);
                if (!opt.continuous) {
                  // Single-shot: halt the loop. The consumer typically unmounts us
                  // (which releases the camera); if it doesn't, the cooldown guard
                  // above already prevents re-delivering the same value.
                  runningRef.current = false;
                  clearTimers();
                  return;
                }
                // Continuous (find-by-scan): keep scanning; the cooldown debounces repeats.
              }
            }
          }
        }
        scheduleNext();
      })
      .catch(() => {
        decodingRef.current = false;
        if (!runningRef.current || gen !== generationRef.current) return;
        scheduleNext();
      });
  };

  const startWatchdog = useCallback(() => {
    if (watchdogRef.current != null) clearTimeout(watchdogRef.current);
    const tick = () => {
      if (!runningRef.current) return;
      if (performance.now() - lastReadyAtRef.current > WATCHDOG_MS) {
        fail('Camera stalled — no video. Tap Retry, or enter the code manually.', 'stalled');
        return;
      }
      watchdogRef.current = window.setTimeout(tick, 2500);
    };
    watchdogRef.current = window.setTimeout(tick, 2500);
  }, [fail]);

  const getStream = useCallback(async (): Promise<MediaStream> => {
    // Prefer the rear camera at a modest resolution (high res only makes decode slower).
    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { video: { facingMode: 'environment' } },
      { video: { facingMode: 'user' } },
      { video: true },
    ];
    let lastErr: unknown;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        const name = (err as { name?: string } | null)?.name;
        // A permission/security denial won't be fixed by trying other constraints.
        if (name === 'NotAllowedError' || name === 'SecurityError') throw err;
      }
    }
    throw lastErr ?? new Error('Could not access camera');
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    const gen = ++generationRef.current;
    runningRef.current = true;
    frameCountRef.current = 0;
    lastDetectAtRef.current = 0;
    lastValueRef.current = null;
    setFrameCount(0);
    setError(null);
    setStatus('starting');

    const superseded = () => !runningRef.current || gen !== generationRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      fail(
        'Camera needs a secure (https) connection. Open the app over https and allow camera access.',
        'insecure'
      );
      return;
    }

    // Build the detector once and reuse it across restarts.
    if (!detectorRef.current) {
      try {
        detectorRef.current = await createDetector(optRef.current.formats);
      } catch {
        /* createDetector is defensive and shouldn't throw, but never let it kill startup */
      }
      if (superseded()) return;
    }

    let stream: MediaStream;
    try {
      stream = await getStream();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        fail(
          'Camera permission was blocked. Allow camera access in your browser settings, then tap Retry.',
          'permission'
        );
      } else if (
        name === 'NotFoundError' ||
        name === 'OverconstrainedError' ||
        name === 'DevicesNotFoundError'
      ) {
        fail('No camera was found on this device.', 'notfound');
      } else if (
        name === 'NotReadableError' ||
        name === 'TrackStartError' ||
        name === 'AbortError'
      ) {
        fail(
          'The camera is busy in another app or browser tab. Close it, then tap Retry.',
          'inuse'
        );
      } else {
        fail(
          err instanceof Error && err.message ? err.message : 'Could not start the camera.',
          'unknown'
        );
      }
      return;
    }

    // Released/closed while getUserMedia was resolving → stop the just-acquired tracks
    // immediately so the camera never stays locked (the old "next open is frozen" bug).
    if (superseded()) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      return;
    }

    streamRef.current = stream;

    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        if (caps?.torch) {
          torchTrackRef.current = track;
          setTorchSupported(true);
        }
      } catch {
        /* capability probing is best-effort */
      }
      track.addEventListener('ended', () => {
        if (runningRef.current && gen === generationRef.current) {
          fail('The camera was disconnected. Tap Retry.', 'unknown');
        }
      });
    }

    const video = videoRef.current;
    if (!video) {
      stop();
      return;
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;

    await waitForVideoReady(video, 8000);
    if (superseded()) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      return;
    }

    try {
      await video.play();
    } catch {
      // Autoplay may be deferred by the browser; frames can still flow. The watchdog
      // will surface a Retry if they never do.
    }
    if (superseded()) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      return;
    }

    lastReadyAtRef.current = performance.now();
    setStatus('scanning');
    startWatchdog();
    scheduleNext();
  }, [fail, getStream, scheduleNext, startWatchdog, stop]);

  const retry = useCallback(() => {
    stop();
    setStatus('idle');
    setError(null);
    if (optRef.current.active) {
      // Restart on a microtask so the stop() teardown settles first.
      Promise.resolve().then(() => {
        if (optRef.current.active) start();
      });
    }
  }, [start, stop]);

  const toggleTorch = useCallback(() => {
    const track = torchTrackRef.current;
    if (!track) return;
    const next = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {
        /* torch toggle is best-effort */
      });
  }, [torchOn]);

  // Run while active; always release on inactive/unmount.
  useEffect(() => {
    if (active) {
      start();
    } else {
      stop();
      setStatus('idle');
      setError(null);
    }
    return () => stop();
  }, [active, start, stop]);

  // Release the camera when the tab/app is backgrounded; reacquire on return.
  // Mobile browsers kill camera tracks in the background, leaving a frozen frame.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setStatus('idle');
      } else {
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, start, stop]);

  return { videoRef, status, error, frameCount, retry, torchSupported, torchOn, toggleTorch };
}
