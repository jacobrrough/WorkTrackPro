import type { User } from '../../core/types';
import { supabase } from './supabaseClient';

function mapProfileToUser(profile: {
  id: string;
  email: string | null;
  name: string | null;
  initials: string | null;
  is_admin: boolean;
}): User {
  return {
    id: profile.id,
    email: profile.email ?? '',
    name: profile.name ?? undefined,
    initials: profile.initials ?? undefined,
    isAdmin: profile.is_admin,
  };
}

export const authService = {
  async checkAuth(): Promise<User | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin')
      .eq('id', session.user.id)
      .single();
    if (!profile)
      return mapProfileToUser({
        id: session.user.id,
        email: session.user.email ?? null,
        name: session.user.user_metadata?.name ?? null,
        initials: session.user.user_metadata?.initials ?? null,
        is_admin: false,
      });
    return mapProfileToUser(profile);
  },

  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin')
      .eq('id', data.user.id)
      .single();
    if (!profile)
      return mapProfileToUser({
        id: data.user.id,
        email: data.user.email ?? null,
        name: data.user.user_metadata?.name ?? null,
        initials: data.user.user_metadata?.initials ?? null,
        is_admin: false,
      });
    return mapProfileToUser(profile);
  },

  logout(): void {
    supabase.auth.signOut();
  },
};
