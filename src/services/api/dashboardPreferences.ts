import type { DashboardPreferences, UserDashboardPreferences } from '../../core/types';
import { supabase } from './supabaseClient';

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
  ): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

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
      console.error('Failed to update dashboard preferences:', error);
      return false;
    }
    return true;
  },
};
