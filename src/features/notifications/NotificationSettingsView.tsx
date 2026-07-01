import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  NotificationChannel,
  NotificationPreferences,
  SystemNotificationType,
  UserNotificationPreferences,
  ViewState,
} from '@/core/types';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { getDefaultPreferences } from '@/services/api/notificationPreferences';
import Accordion from '@/components/Accordion';
import { useScrollRestore } from '@/hooks/useScrollRestore';

interface NotificationSettingsViewProps {
  onNavigate: (view: ViewState, id?: string) => void;
  onBack: () => void;
}

interface NotificationTypeConfig {
  type: SystemNotificationType;
  label: string;
  description: string;
  adminOnly?: boolean;
}

interface NotificationGroup {
  key: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  types: NotificationTypeConfig[];
}

const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    key: 'jobs',
    label: 'Jobs & Boards',
    icon: 'assignment',
    types: [
      {
        type: 'status_change',
        label: 'Status changes',
        description: 'When a job moves to a new status',
      },
      { type: 'assignment', label: 'Assignments', description: 'When you are assigned to a job' },
      {
        type: 'unassignment',
        label: 'Unassignments',
        description: 'When you are removed from a job',
      },
      { type: 'rush', label: 'Rush jobs', description: 'When a job is marked as rush priority' },
      { type: 'overdue', label: 'Overdue jobs', description: 'When a job passes its due date' },
      {
        type: 'comment_mention',
        label: 'Comment mentions',
        description: 'When someone @mentions you in a comment',
      },
      {
        type: 'checklist_complete',
        label: 'Checklist complete',
        description: 'When a job checklist is fully completed',
      },
      {
        type: 'delivery_update',
        label: 'Delivery updates',
        description: 'When a job delivery status changes',
      },
      {
        type: 'variant_update',
        label: 'Variant updates',
        description: 'When a job variant is modified',
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: 'inventory_2',
    types: [
      {
        type: 'low_stock',
        label: 'Low stock alerts',
        description: 'When an item drops below reorder point',
      },
      {
        type: 'critical_stock',
        label: 'Critical stock',
        description: 'When an item reaches critical levels',
        adminOnly: true,
      },
      {
        type: 'allocation_complete',
        label: 'Allocation complete',
        description: 'When inventory is allocated to a job',
        adminOnly: true,
      },
      {
        type: 'allocation_reversal',
        label: 'Allocation reversed',
        description: 'When a job allocation is reversed',
        adminOnly: true,
      },
      {
        type: 'reorder_point_hit',
        label: 'Reorder point hit',
        description: 'When stock hits the reorder threshold',
      },
    ],
  },
  {
    key: 'time',
    label: 'Time Clock & Shifts',
    icon: 'schedule',
    types: [
      {
        type: 'shift_edit_approved',
        label: 'Shift edit approved',
        description: 'When your shift edit request is approved',
      },
      {
        type: 'shift_edit_requested',
        label: 'Shift edit requested',
        description: 'When an employee requests a shift edit',
      },
      {
        type: 'clock_anomaly',
        label: 'Clock anomalies',
        description: 'When unusual clock-in/out patterns are detected',
      },
      {
        type: 'lunch_break_reminder',
        label: 'Lunch break reminder',
        description: 'Reminder to take your lunch break',
      },
    ],
  },
  {
    key: 'chat',
    label: 'Chat',
    icon: 'chat',
    types: [
      {
        type: 'chat_mention',
        label: 'Chat mentions',
        description: 'When someone @mentions you in chat',
      },
      {
        type: 'new_direct_message',
        label: 'Direct messages',
        description: 'When you receive a new direct message',
      },
      {
        type: 'thread_reply',
        label: 'Thread replies',
        description: 'When someone replies to your thread',
      },
    ],
  },
  {
    key: 'admin',
    label: 'Admin & Users',
    icon: 'admin_panel_settings',
    adminOnly: true,
    types: [
      {
        type: 'new_user_pending_approval',
        label: 'New user pending',
        description: 'When a new user signs up and needs approval',
      },
      {
        type: 'user_approved',
        label: 'User approved',
        description: 'When a user account is approved',
      },
      {
        type: 'user_rejected',
        label: 'User rejected',
        description: 'When a user account is rejected',
      },
      {
        type: 'proposal_submitted',
        label: 'Proposal submitted',
        description: 'When a customer submits a new proposal',
      },
    ],
  },
  {
    key: 'quotes',
    label: 'Quotes & Proposals',
    icon: 'request_quote',
    types: [
      {
        type: 'new_customer_proposal',
        label: 'New proposals',
        description: 'When a customer submits a proposal via storefront',
      },
      {
        type: 'quote_assigned',
        label: 'Quote assigned',
        description: 'When a quote is assigned to you',
      },
      {
        type: 'quote_updated',
        label: 'Quote updated',
        description: 'When a quote you are involved with is updated',
      },
    ],
  },
  {
    key: 'deliveries',
    label: 'Deliveries',
    icon: 'local_shipping',
    types: [
      {
        type: 'delivery_scheduled',
        label: 'Delivery scheduled',
        description: 'When a delivery is scheduled',
      },
      {
        type: 'delivery_completed',
        label: 'Delivery completed',
        description: 'When a delivery is marked complete',
      },
      {
        type: 'delivery_delayed',
        label: 'Delivery delayed',
        description: 'When a delivery is delayed',
      },
    ],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    icon: 'receipt_long',
    adminOnly: true,
    types: [
      {
        type: 'invoice_sent',
        label: 'Invoice sent',
        description: 'When an invoice is sent to a customer',
      },
      {
        type: 'invoice_payment_received',
        label: 'Payment received',
        description: 'When a partial payment is applied to an invoice',
      },
      {
        type: 'invoice_paid',
        label: 'Invoice paid',
        description: 'When an invoice is paid in full',
      },
      {
        type: 'invoice_voided',
        label: 'Invoice voided',
        description: 'When an invoice is voided',
      },
      {
        type: 'bill_received',
        label: 'Bill recorded',
        description: 'When a new vendor bill is recorded',
      },
      { type: 'bill_paid', label: 'Bill paid', description: 'When a vendor bill is paid' },
      {
        type: 'invoice_overdue',
        label: 'Invoice overdue',
        description: 'When a sent invoice passes its due date (internal alert)',
      },
      {
        type: 'bill_due_soon',
        label: 'Bill due soon',
        description: 'When a vendor bill is due within 3 days or already overdue',
      },
    ],
  },
  {
    key: 'system',
    label: 'Dashboard & System',
    icon: 'settings',
    types: [
      {
        type: 'daily_summary',
        label: 'Daily summary',
        description: 'Daily overview of activity and stats',
      },
      {
        type: 'system_alert',
        label: 'System alerts',
        description: 'Important system-wide announcements',
      },
      {
        type: 'maintenance_notice',
        label: 'Maintenance notices',
        description: 'Planned maintenance and downtime alerts',
      },
    ],
  },
];

function Toggle({
  enabled,
  disabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={`h-6 w-12 shrink-0 rounded-full transition-colors ${
        enabled ? 'bg-primary' : 'bg-overlay/20'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const NotificationSettingsView: React.FC<NotificationSettingsViewProps> = ({ onBack }) => {
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore('notification-settings');
  const isAdmin = currentUser?.isAdmin ?? false;
  const [activeTab, setActiveTab] = useState<NotificationChannel>('in_app');

  const { data: prefsData, isLoading } = useNotificationPreferences(true, isAdmin);
  const updateMutation = useUpdateNotificationPreferences();
  const queryClient = useQueryClient();

  const preferences = prefsData?.preferences ?? getDefaultPreferences(isAdmin);

  // Apply an update against the freshest cached preferences (which the mutation
  // keeps optimistically current), not the render-time `preferences` closure. This
  // prevents two rapid toggles from both branching off a stale base and clobbering
  // each other.
  const applyUpdate = useCallback(
    (
      transform: (draft: NotificationPreferences) => NotificationPreferences,
      successMessage: string
    ) => {
      const base =
        queryClient.getQueryData<UserNotificationPreferences>(['notification-preferences'])
          ?.preferences ?? preferences;
      const updated = transform({
        in_app: { ...base.in_app },
        email: { ...base.email },
      });
      updateMutation.mutate(updated, {
        onSuccess: () => showToast(successMessage, 'success'),
        onError: () => showToast('Failed to save preference', 'error'),
      });
    },
    [queryClient, preferences, updateMutation, showToast]
  );

  const handleToggle = useCallback(
    (type: SystemNotificationType, channel: NotificationChannel) => {
      applyUpdate((draft) => {
        draft[channel][type] = !draft[channel][type];
        return draft;
      }, 'Preference saved');
    },
    [applyUpdate]
  );

  const handleResetDefaults = useCallback(() => {
    const defaults = getDefaultPreferences(isAdmin);
    updateMutation.mutate(defaults, {
      onSuccess: () => showToast('Reset to defaults', 'success'),
      onError: () => showToast('Failed to reset preferences', 'error'),
    });
  }, [isAdmin, updateMutation, showToast]);

  const handleToggleGroup = useCallback(
    (types: SystemNotificationType[], channel: NotificationChannel, nextEnabled: boolean) => {
      applyUpdate(
        (draft) => {
          for (const type of types) {
            draft[channel][type] = nextEnabled;
          }
          return draft;
        },
        nextEnabled ? 'Category enabled' : 'Category disabled'
      );
    },
    [applyUpdate]
  );

  const visibleGroups = NOTIFICATION_GROUPS.filter((g) => !g.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col bg-app">
      {/* Header */}
      <header className="app-header px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="app-icon-btn border border-line bg-overlay/5 text-white"
              aria-label="Go back"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1 className="app-section-title text-white">Notification Settings</h1>
          </div>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-overlay/10 hover:text-white"
          >
            Reset to Defaults
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-line px-4">
        <button
          type="button"
          onClick={() => setActiveTab('in_app')}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'in_app'
              ? 'border-b-2 border-primary text-white'
              : 'text-muted hover:text-white'
          }`}
        >
          In-App
        </button>
        <button
          type="button"
          disabled
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-subtle"
        >
          Email
          <span className="rounded bg-overlay/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            Coming soon
          </span>
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-overlay/5" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleGroups.map((group) => {
              const visibleTypes = group.types.filter((t) => !t.adminOnly || isAdmin);
              if (visibleTypes.length === 0) return null;

              const groupTypeKeys = visibleTypes.map((t) => t.type);
              const groupAllEnabled = groupTypeKeys.every((t) => preferences[activeTab][t] ?? true);
              const isEmailTab = activeTab === 'email';

              return (
                <Accordion
                  key={group.key}
                  title={group.label}
                  defaultExpanded={group.key === 'jobs'}
                >
                  <div className="space-y-1">
                    <div className="mb-1 flex items-center justify-between gap-3 rounded-lg bg-overlay/5 px-2 py-2.5">
                      <p className="text-sm font-semibold text-white">All {group.label}</p>
                      <Toggle
                        enabled={groupAllEnabled}
                        disabled={isEmailTab}
                        onToggle={() =>
                          handleToggleGroup(groupTypeKeys, activeTab, !groupAllEnabled)
                        }
                        ariaLabel={`Toggle all ${group.label} notifications`}
                      />
                    </div>
                    {visibleTypes.map((config) => {
                      const isEnabled = preferences[activeTab][config.type] ?? true;

                      return (
                        <div
                          key={config.type}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-overlay/5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">{config.label}</p>
                            <p className="text-xs text-muted">{config.description}</p>
                          </div>
                          <Toggle
                            enabled={isEnabled}
                            disabled={isEmailTab}
                            onToggle={() => handleToggle(config.type, activeTab)}
                            ariaLabel={`${config.label} ${activeTab === 'in_app' ? 'in-app' : 'email'} notifications`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </Accordion>
              );
            })}

            {/* Group toggle helpers */}
            <div className="mt-6 rounded-2xl border border-line bg-overlay/5 p-4">
              <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    applyUpdate(
                      (draft) => ({
                        ...draft,
                        in_app: Object.fromEntries(Object.keys(draft.in_app).map((k) => [k, true])),
                      }),
                      'All in-app notifications enabled'
                    )
                  }
                  className="rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/30"
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyUpdate(
                      (draft) => ({
                        ...draft,
                        in_app: Object.fromEntries(
                          Object.keys(draft.in_app).map((k) => [k, false])
                        ),
                      }),
                      'All in-app notifications disabled'
                    )
                  }
                  className="rounded-lg bg-overlay/10 px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-overlay/20"
                >
                  Disable All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationSettingsView;
