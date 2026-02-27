import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Part } from '../../../core/types';
import { syncJobInventoryFromPart, computeRequiredMaterials } from '../../../lib/materialFromPart';
import { normalizeDashQuantities } from '../../../lib/variantMath';

interface UseMaterialSyncParams {
  jobId: string;
  linkedPart: Part | null;
  dashQuantities: Record<string, number>;
  onReloadJob?: () => Promise<void> | void;
}

export function useMaterialSync({
  jobId,
  linkedPart,
  dashQuantities,
  onReloadJob,
}: UseMaterialSyncParams) {
  const onReloadJobRef = useRef<typeof onReloadJob>(onReloadJob);
  useEffect(() => {
    onReloadJobRef.current = onReloadJob;
  }, [onReloadJob]);

  const requiredMaterialsMap = useMemo(() => {
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || Object.keys(normalizedDash).length === 0) {
      return new Map<string, { quantity: number; unit: string }>();
    }
    return computeRequiredMaterials(linkedPart, normalizedDash);
  }, [linkedPart, dashQuantities]);

  const isMaterialAuto = useCallback(
    (inventoryId: string, quantity: number) => {
      const req = requiredMaterialsMap.get(inventoryId);
      return req != null && Math.abs(req.quantity - quantity) < 0.0001;
    },
    [requiredMaterialsMap]
  );

  const syncAfterDashChangeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRequestIdRef = useRef(0);

  useEffect(() => {
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || !Object.values(normalizedDash).some((q) => q > 0)) return;
    if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
    const requestId = ++syncRequestIdRef.current;
    syncAfterDashChangeRef.current = setTimeout(async () => {
      syncAfterDashChangeRef.current = null;
      try {
        await syncJobInventoryFromPart(jobId, linkedPart, normalizedDash, { replace: true });
        if (requestId === syncRequestIdRef.current) {
          await onReloadJobRef.current?.();
        }
      } catch (e) {
        console.error('Auto-sync materials:', e);
      }
    }, 1200);
    return () => {
      if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
    };
  }, [jobId, linkedPart, dashQuantities]);

  return { requiredMaterialsMap, isMaterialAuto };
}
