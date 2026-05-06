import type { JobStatusHistoryEntry } from '../../core/types';
import { supabase } from './supabaseClient';

export const jobStatusHistoryService = {
  async createHistory(data: {
    jobId: string;
    userId: string;
    previousStatus: string;
    newStatus: string;
  }): Promise<boolean> {
    const row = {
      job_id: data.jobId,
      user_id: data.userId,
      previous_status: data.previousStatus,
      new_status: data.newStatus,
    };
    const { error } = await supabase.from('job_status_history').insert(row);
    if (error) {
      console.error('Failed to create job status history:', error);
      return false;
    }
    return true;
  },

  async getByJob(jobId: string, limit = 50): Promise<JobStatusHistoryEntry[]> {
    const { data, error } = await supabase
      .from('job_status_history')
      .select('*, profiles:user_id ( name, initials )')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('Failed to get job status history:', error);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      jobId: row.job_id as string,
      userId: row.user_id as string,
      userName: (row.profiles as { name?: string })?.name,
      userInitials: (row.profiles as { initials?: string })?.initials,
      previousStatus: row.previous_status as JobStatusHistoryEntry['previousStatus'],
      newStatus: row.new_status as JobStatusHistoryEntry['newStatus'],
      createdAt: row.created_at as string,
    }));
  },
};
