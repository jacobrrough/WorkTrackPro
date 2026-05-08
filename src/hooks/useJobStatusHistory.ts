import { useQuery } from '@tanstack/react-query';
import { jobStatusHistoryService } from '@/services/api/jobStatusHistory';

export function useJobStatusHistory(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['job-status-history', jobId],
    queryFn: () => jobStatusHistoryService.getByJob(jobId!),
    enabled: !!jobId && enabled,
  });
}
