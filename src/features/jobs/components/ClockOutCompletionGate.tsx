import { useEffect, useMemo, useState } from 'react';
import type { Job, Part } from '@/core/types';
import { useApp } from '@/AppContext';
import { useSettings } from '@/contexts/SettingsContext';
import { partsService } from '@/services/api/parts';
import { ClockOutCompletionModal } from './ClockOutCompletionModal';

/**
 * App-level wrapper for the clock-out completion popup: loads the departing job's part (with
 * variants + materials, needed for accurate per-variant distribution), then renders the modal.
 * Renders nothing until the part is resolved to avoid logging against an even-split fallback when
 * a real per-variant spec exists.
 */
export function ClockOutCompletionGate({ job, onComplete }: { job: Job; onComplete: () => void }) {
  const { inventory } = useApp();
  const { settings } = useSettings();
  const [part, setPart] = useState<Part | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolved: Part | null = null;
      try {
        if (job.partId) {
          resolved = await partsService.getPartWithVariantsAndMaterials(job.partId);
        } else if (job.partNumber) {
          const base = await partsService.getPartByNumber(job.partNumber);
          if (base) resolved = await partsService.getPartWithVariantsAndMaterials(base.id);
        }
      } catch {
        resolved = null;
      }
      if (!cancelled) {
        setPart(resolved);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.partId, job.partNumber]);

  const cncAbleCategories = useMemo(
    () => new Set(settings.cncAbleCategories ?? ['foam']),
    [settings.cncAbleCategories]
  );

  if (!ready) return null;

  return (
    <ClockOutCompletionModal
      job={job}
      part={part}
      inventory={inventory}
      cncAbleCategories={cncAbleCategories}
      onComplete={onComplete}
    />
  );
}
