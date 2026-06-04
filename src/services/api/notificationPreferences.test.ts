import { describe, expect, it } from 'vitest';
import type { SystemNotificationType } from '../../core/types';
import { getDefaultPreferences } from './notificationPreferences';

/**
 * Source-of-truth parity guard.
 *
 * The client default builder `getDefaultPreferences` must agree with the SQL seed
 * `build_default_notification_preferences` in
 * supabase/migrations/20260511000001_notification_preferences.sql. That seed is the
 * realized source of truth: every profile gets it stored on insert (trigger) + backfill,
 * and stored values win in mergeWithDefaults — so a divergence only bites on the no-row /
 * error fallback path, which is exactly what this test pins down.
 *
 * EXPECTED_IN_APP mirrors the `in_app` block of the SQL seed verbatim. Values are either a
 * literal boolean (same for everyone) or 'admin' (the SQL `p_is_admin` gate). Keep this in
 * lockstep with the migration if either the seed or ALL_NOTIFICATION_TYPES changes.
 */
const EXPECTED_IN_APP: Record<SystemNotificationType, boolean | 'admin'> = {
  // Jobs & Boards
  status_change: true,
  assignment: true,
  unassignment: true,
  rush: true,
  overdue: true,
  comment_mention: true,
  checklist_complete: true,
  delivery_update: true,
  variant_update: true,
  // Inventory
  low_stock: true,
  critical_stock: 'admin',
  allocation_complete: 'admin',
  allocation_reversal: 'admin',
  reorder_point_hit: true,
  // Time Clock & Shifts
  shift_edit_approved: true,
  shift_edit_requested: true,
  clock_anomaly: true,
  lunch_break_reminder: true,
  // Chat
  chat_mention: true,
  new_direct_message: true,
  thread_reply: true,
  // Admin & Users
  new_user_pending_approval: 'admin',
  // user_approved / user_rejected notify the *affected* user about their own account
  // status, so the seed defaults them on for everyone (NOT admin-gated).
  user_approved: true,
  user_rejected: true,
  proposal_submitted: 'admin',
  // Quotes & Proposals
  new_customer_proposal: true,
  quote_assigned: true,
  quote_updated: true,
  // Deliveries
  delivery_scheduled: true,
  delivery_completed: true,
  delivery_delayed: true,
  // Dashboard & System
  daily_summary: false,
  system_alert: true,
  maintenance_notice: false,
  // Legacy types are not seeded; merged-in only via stored rows.
  mention: true,
  delivery: true,
  po_received: true,
};

function expectedFor(value: boolean | 'admin', isAdmin: boolean): boolean {
  return value === 'admin' ? isAdmin : value;
}

describe('getDefaultPreferences', () => {
  it.each([
    ['non-admin', false],
    ['admin', true],
  ] as const)('matches the SQL seed in_app defaults for %s users', (_label, isAdmin) => {
    const { in_app } = getDefaultPreferences(isAdmin);
    for (const [type, seed] of Object.entries(EXPECTED_IN_APP) as [
      SystemNotificationType,
      boolean | 'admin',
    ][]) {
      // Only assert over types the client actually seeds (ALL_NOTIFICATION_TYPES);
      // legacy types are intentionally absent from the client default.
      if (in_app[type] === undefined) continue;
      expect(in_app[type], `in_app.${type} (isAdmin=${isAdmin})`).toBe(expectedFor(seed, isAdmin));
    }
  });

  it('defaults user_approved / user_rejected on for non-admins (parity with SQL seed)', () => {
    const { in_app } = getDefaultPreferences(false);
    expect(in_app.user_approved).toBe(true);
    expect(in_app.user_rejected).toBe(true);
  });

  it('keeps genuinely admin-only types off for non-admins and on for admins', () => {
    const nonAdmin = getDefaultPreferences(false).in_app;
    const admin = getDefaultPreferences(true).in_app;
    for (const type of [
      'new_user_pending_approval',
      'proposal_submitted',
      'critical_stock',
      'allocation_complete',
      'allocation_reversal',
    ] as const) {
      expect(nonAdmin[type], `non-admin ${type}`).toBe(false);
      expect(admin[type], `admin ${type}`).toBe(true);
    }
  });

  it('disables daily_summary and maintenance_notice by default regardless of role', () => {
    for (const isAdmin of [false, true]) {
      const { in_app } = getDefaultPreferences(isAdmin);
      expect(in_app.daily_summary).toBe(false);
      expect(in_app.maintenance_notice).toBe(false);
    }
  });

  it('defaults every email channel preference to off', () => {
    const { email } = getDefaultPreferences(true);
    for (const value of Object.values(email)) {
      expect(value).toBe(false);
    }
  });
});
