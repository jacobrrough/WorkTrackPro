import type {
  NotificationPreferences,
  SystemNotificationType,
  UserNotificationPreferences,
} from '../../core/types';
import { supabase } from './supabaseClient';

const ALL_NOTIFICATION_TYPES: SystemNotificationType[] = [
  'status_change',
  'assignment',
  'unassignment',
  'rush',
  'overdue',
  'comment_mention',
  'checklist_complete',
  'delivery_update',
  'variant_update',
  'low_stock',
  'critical_stock',
  'allocation_complete',
  'allocation_reversal',
  'reorder_point_hit',
  'shift_edit_approved',
  'shift_edit_requested',
  'clock_anomaly',
  'lunch_break_reminder',
  'chat_mention',
  'new_direct_message',
  'thread_reply',
  'new_user_pending_approval',
  'user_approved',
  'user_rejected',
  'proposal_submitted',
  'new_customer_proposal',
  'quote_assigned',
  'quote_updated',
  'delivery_scheduled',
  'delivery_completed',
  'delivery_delayed',
  // Accounting (AR/AP)
  'invoice_sent',
  'invoice_payment_received',
  'invoice_paid',
  'invoice_voided',
  'bill_received',
  'bill_paid',
  'invoice_overdue',
  'bill_due_soon',
  'daily_summary',
  'system_alert',
  'maintenance_notice',
];

// Types whose in-app default is on only for admins. This MUST stay in parity
// with the SQL seed in supabase/migrations/20260511000001_notification_preferences.sql
// (build_default_notification_preferences), which is the realized source of truth:
// every profile gets that seed stored on insert (trigger) + backfill, and stored
// values win in mergeWithDefaults. NOTE: 'user_approved'/'user_rejected' are
// intentionally NOT admin-only — they notify the *affected* user about their own
// account status, so the seed defaults both to true for everyone.
const ADMIN_ONLY_TYPES: SystemNotificationType[] = [
  'new_user_pending_approval',
  'proposal_submitted',
  'critical_stock',
  'allocation_complete',
  'allocation_reversal',
  // Accounting types reach accounting users only; default-on for admins.
  'invoice_sent',
  'invoice_payment_received',
  'invoice_paid',
  'invoice_voided',
  'bill_received',
  'bill_paid',
  'invoice_overdue',
  'bill_due_soon',
];

const DISABLED_BY_DEFAULT: SystemNotificationType[] = ['daily_summary', 'maintenance_notice'];

export function getDefaultPreferences(isAdmin: boolean): NotificationPreferences {
  const inApp: Partial<Record<SystemNotificationType, boolean>> = {};
  const email: Partial<Record<SystemNotificationType, boolean>> = {};

  for (const type of ALL_NOTIFICATION_TYPES) {
    const isAdminOnly = ADMIN_ONLY_TYPES.includes(type);
    const isDisabledDefault = DISABLED_BY_DEFAULT.includes(type);
    inApp[type] = isDisabledDefault ? false : isAdminOnly ? isAdmin : true;
    email[type] = false;
  }

  return { in_app: inApp, email };
}

function mergeWithDefaults(
  stored: Partial<NotificationPreferences>,
  isAdmin: boolean
): NotificationPreferences {
  const defaults = getDefaultPreferences(isAdmin);
  return {
    in_app: { ...defaults.in_app, ...(stored.in_app ?? {}) },
    email: { ...defaults.email, ...(stored.email ?? {}) },
  };
}

export const notificationPreferencesService = {
  async getPreferences(isAdmin: boolean): Promise<UserNotificationPreferences> {
    const { data, error } = await supabase
      .from('user_notification_preferences')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Failed to get notification preferences:', error);
      return {
        userId: '',
        preferences: getDefaultPreferences(isAdmin),
        updatedAt: new Date().toISOString(),
      };
    }

    if (!data) {
      return {
        userId: '',
        preferences: getDefaultPreferences(isAdmin),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      userId: data.user_id as string,
      preferences: mergeWithDefaults(data.preferences as Partial<NotificationPreferences>, isAdmin),
      updatedAt: data.updated_at as string,
    };
  },

  async updatePreferences(preferences: NotificationPreferences): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from('user_notification_preferences').upsert(
      {
        user_id: user.id,
        preferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      console.error('Failed to update notification preferences:', error);
      return false;
    }
    return true;
  },
};
