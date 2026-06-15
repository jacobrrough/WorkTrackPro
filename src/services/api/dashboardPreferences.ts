import type { DashboardPreferences, UserDashboardPreferences } from '../../core/types';
import { supabase } from './supabaseClient';
import { AuthSessionError } from '../../lib/authErrors';

const DEFAULT_PREFERENCES: DashboardPreferences = {
  quickActionOrder: [],
  hiddenQuickActions: [],
};

export const dashboardPreferencesService = {
  async getPreferences(): Promise<UserDashboardPreferences> {
    const { data, error } = await supabase
      .from('user_dashboard_preferences')
      .select('*')
      .maybeSingle();

    if (error) {
      // Propagate so React Query treats this as an error (and retries) instead
      // of caching a fake default. A swallowed read error used to surface as an
      // empty default that the sync mistook for "no customization" and locked
      // in, blanking a real saved layout — especially on flaky mobile networks.
      console.error('Failed to get dashboard preferences:', error);
      throw error;
    }

    if (!data) {
      // No row yet (new profile before the auto-create trigger fires). An empty
      // updatedAt sorts as the oldest possible version, so the sync never treats
      // a missing row as a fresh server state that should win over local edits.
      return {
        userId: '',
        preferences: DEFAULT_PREFERENCES,
        updatedAt: '',
      };
    }

    const stored = data.preferences as Partial<DashboardPreferences> | null;

    return {
      userId: data.user_id as string,
      preferences: {
        quickActionOrder: stored?.quickActionOrder ?? [],
        hiddenQuickActions: stored?.hiddenQuickActions ?? [],
      },
      updatedAt: data.updated_at as string,
    };
  },

  async updatePreferences(
    preferences: DashboardPreferences,
    updatedAt: string = new Date().toISOString()
  ): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Throw (rather than silently no-op) so the mutation rejects and the caller
    // can surface the failure: a missing user means an expired session, and the
    // write the user just made was NOT saved. A typed AuthSessionError lets the
    // mutation's onError distinguish "session gone" (e.g. mid-logout) from a real
    // save failure and stay silent instead of firing a misleading error toast.
    if (!user) {
      throw new AuthSessionError('Not authenticated — dashboard preferences were not saved.');
    }

    // Persist the caller-supplied timestamp so the value written here matches
    // the marker the sync records locally — that exact-version match is what
    // lets a device tell "server changed elsewhere" from "this is my own write".
    const { error } = await supabase.from('user_dashboard_preferences').upsert(
      {
        user_id: user.id,
        preferences,
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      // Propagate so React Query's onError fires — that both rolls back the
      // optimistic cache and lets the hook show the user an error toast instead
      // of leaving them believing a failed save succeeded.
      console.error('Failed to update dashboard preferences:', error);
      throw error;
    }
  },
};
