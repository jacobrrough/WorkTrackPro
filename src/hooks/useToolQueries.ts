import { useQuery } from '@tanstack/react-query';
import { toolsService } from '@/services/api/tools';

/**
 * Custody history for a single tool (inventory item). Fetched on demand (e.g. when the History
 * tab opens). The live tool list itself is derived from inventory in AppContext (`useApp().tools`).
 */
export function useToolHistory(inventoryId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tool-events', inventoryId],
    queryFn: () => toolsService.getToolHistory(inventoryId as string),
    enabled: enabled && !!inventoryId,
  });
}
