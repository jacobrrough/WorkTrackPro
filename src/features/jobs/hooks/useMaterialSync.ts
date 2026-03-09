import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Part } from '../../../core/types';
import {
  syncJobInventoryFromPart,
  syncJobInventoryFromParts,
  computeRequiredMaterials,
  computeRequiredMaterialsForParts,
  type PartWithDashQuantities,
} from '../../../lib/partsCalculations';
import { normalizeDashQuantities } from '../../../lib/variantMath';

interface UseMaterialSyncParams {
  jobId: string;
  linkedPart: Part | null;
  dashQuantities: Record<string, number>;
  /** When job has multiple parts, pass array of { part, dashQuantities }. Takes precedence over linkedPart + dashQuantities for sync and required map. */
  partsWithPartData?: PartWithDashQuantities[];
  onReloadJob?: () => Promise<void> | void;
}

export function useMaterialSync({
  jobId,
  linkedPart,
  dashQuantities,
  partsWithPartData,
  onReloadJob,
}: UseMaterialSyncParams) {
  const onReloadJobRef = useRef<typeof onReloadJob>(onReloadJob);
  useEffect(() => {
    onReloadJobRef.current = onReloadJob;
  }, [onReloadJob]);

  const isMultiPart = partsWithPartData != null && partsWithPartData.length > 0;

  const requiredMaterialsMap = useMemo(() => {
    if (isMultiPart) {
      return computeRequiredMaterialsForParts(partsWithPartData!);
    }
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || Object.keys(normalizedDash).length === 0) {
      return new Map<string, { quantity: number; unit: string }>();
    }
    return computeRequiredMaterials(linkedPart, normalizedDash);
  }, [isMultiPart, partsWithPartData, linkedPart, dashQuantities]);

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
    if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
    const requestId = ++syncRequestIdRef.current;
    if (isMultiPart) {
      const hasAnyQty = partsWithPartData!.some((p) =>
        Object.values(normalizeDashQuantities(p.dashQuantities)).some((q) => q > 0)
      );
      if (!hasAnyQty) return;
      syncAfterDashChangeRef.current = setTimeout(async () => {
        syncAfterDashChangeRef.current = null;
        try {
          await syncJobInventoryFromParts(jobId, partsWithPartData!, { replace: true });
          if (requestId === syncRequestIdRef.current) {
            await onReloadJobRef.current?.();
          }
        } catch (e) {
          console.error('Auto-sync materials (multi-part):', e);
        }
      }, 1200);
      return () => {
        if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
      };
    }
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || !Object.values(normalizedDash).some((q) => q > 0)) return;
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
  }, [jobId, linkedPart, dashQuantities, isMultiPart, partsWithPartData]);

  return { requiredMaterialsMap, isMaterialAuto };
}
