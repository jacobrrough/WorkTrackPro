import { isThemeId, type ThemeId } from '../../theme/themes';
import { supabase } from './supabaseClient';

// Per-user theme choice, stored in public.user_theme_preferences so it follows
// the user across devices. Mirrors the user_notification_preferences pattern.
export const userThemePreferencesService = {
  async getTheme(): Promise<ThemeId | null> {
    const { data, error } = await supabase
      .from('user_theme_preferences')
      .select('theme')
      .maybeSingle();

    if (error) {
      console.error('Failed to load theme preference:', error);
      return null;
    }
    const theme = data?.theme;
    return isThemeId(theme) ? theme : null;
  },

  async setTheme(theme: ThemeId): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase.from('user_theme_preferences').upsert(
      {
        user_id: user.id,
        theme,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      console.error('Failed to save theme preference:', error);
      return false;
    }
    return true;
  },
};
