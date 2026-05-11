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
      console.error('Failed to get dashboard preferences:', error);
      return {
        userId: '',
        preferences: DEFAULT_PREFERENCES,
        updatedAt: new Date().toISOString(),
      };
    }

    if (!data) {
      return {
        userId: '',
        preferences: DEFAULT_PREFERENCES,
        updatedAt: new Date().toISOString(),
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

  async updatePreferences(preferences: DashboardPreferences): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from('user_dashboard_preferences').upsert(
      {
        user_id: user.id,
        preferences,
        updated_at: new Date().toISOString(),
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
