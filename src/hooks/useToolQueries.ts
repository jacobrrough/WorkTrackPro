import { useQuery } from '@tanstack/react-query';
import { toolsService } from '@/services/api/tools';

/**
 * Custody history for a single tool. Fetched on demand (e.g. when the History tab opens).
 * The live tool list itself comes from AppContext (`useApp().tools`).
 */
export function useToolHistory(toolId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tool-events', toolId],
    queryFn: () => toolsService.getToolHistory(toolId as string),
    enabled: enabled && !!toolId,
  });
}
