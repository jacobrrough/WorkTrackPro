import type { SystemNotification, SystemNotificationType } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRow(row: Record<string, unknown>): SystemNotification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as SystemNotificationType,
    title: row.title as string,
    message: row.message as string,
    link: (row.link as string) ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    readAt: (row.read_at as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export const systemNotificationService = {
  async getNotifications(limit = 50, before?: string): Promise<SystemNotification[]> {
    let query = supabase
      .from('system_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to get notifications:', error);
      return [];
    }
    return (data ?? []).map(mapRow);
  },

  async getUnreadCount(): Promise<number> {
    const { count, error } = await supabase
      .from('system_notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null);

    if (error) {
      console.error('Failed to get unread count:', error);
      return 0;
    }
    return count ?? 0;
  },

  async markRead(ids: string[]): Promise<boolean> {
    const { error } = await supabase
      .from('system_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);

    if (error) {
      console.error('Failed to mark notifications read:', error);
      return false;
    }
    return true;
  },

  async markAllRead(): Promise<boolean> {
    const { error } = await supabase
      .from('system_notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);

    if (error) {
      console.error('Failed to mark all notifications read:', error);
      return false;
    }
    return true;
  },

  async createNotification(data: {
    userId: string;
    type: SystemNotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SystemNotification | null> {
    const row = {
      user_id: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link ?? null,
      metadata: data.metadata ?? {},
    };

    const { data: result, error } = await supabase
      .from('system_notifications')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('Failed to create notification:', error);
      return null;
    }
    return mapRow(result);
  },

  async notifyMention(data: {
    mentionedUserId: string;
    jobId: string;
    commenterName: string;
    jobCode: number;
    commentPreview: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('notify_mention', {
      p_mentioned_user_id: data.mentionedUserId,
      p_job_id: data.jobId,
      p_commenter_name: data.commenterName,
      p_job_code: data.jobCode,
      p_comment_preview: data.commentPreview,
    });

    if (error) {
      console.error('Failed to send mention notification:', error);
    }
  },
};
