import { useQuery } from '@tanstack/react-query';
import { deliveryService } from '@/services/api/deliveries';

export function useJobDeliveries(jobId: string | undefined) {
  return useQuery({
    queryKey: ['deliveries', jobId],
    queryFn: () => deliveryService.getByJob(jobId!),
    enabled: !!jobId,
  });
}
