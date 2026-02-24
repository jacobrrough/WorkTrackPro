import type { User } from '../../core/types';
import { supabase } from './supabaseClient';

function mapProfileToUser(profile: {
  id: string;
  email: string | null;
  name: string | null;
  initials: string | null;
  is_admin: boolean;
  is_approved?: boolean;
}): User {
  return {
    id: profile.id,
    email: profile.email ?? '',
    name: profile.name ?? undefined,
    initials: profile.initials ?? undefined,
    isAdmin: profile.is_admin,
    isApproved: profile.is_approved ?? true,
  };
}

export const authService = {
  async checkAuth(): Promise<User | null> {
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null;
    try {
      const {
        data: { session: activeSession },
      } = await supabase.auth.getSession();
      session = activeSession;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isInvalidRefreshToken = /invalid refresh token|refresh token not found/i.test(message);
      if (isInvalidRefreshToken) {
        // Local browser token can become stale; clear only local auth state and continue as logged-out.
        await supabase.auth.signOut({ scope: 'local' });
        return null;
      }
      throw error;
    }

    if (!session?.user) return null;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin, is_approved')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profileError) {
      // Backwards compatibility: if migration hasn't been applied yet, don't block login.
      const msg = profileError.message ?? '';
      const missingApprovalColumn = /column .*is_approved.* does not exist/i.test(msg);
      if (missingApprovalColumn) {
        return mapProfileToUser({
          id: session.user.id,
          email: session.user.email ?? null,
          name: session.user.user_metadata?.name ?? null,
          initials: session.user.user_metadata?.initials ?? null,
          is_admin: false,
          is_approved: true,
        });
      }
      throw profileError;
    }
    if (!profile)
      return mapProfileToUser({
        id: session.user.id,
        email: session.user.email ?? null,
        name: session.user.user_metadata?.name ?? null,
        initials: session.user.user_metadata?.initials ?? null,
        is_admin: false,
        // If profile row is missing, treat as unapproved so the UI shows the approval gate
        // instead of rendering empty lists due to RLS.
        is_approved: false,
      });
    return mapProfileToUser(profile);
  },

  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name, initials, is_admin, is_approved')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) {
      const msg = profileError.message ?? '';
      const missingApprovalColumn = /column .*is_approved.* does not exist/i.test(msg);
      if (missingApprovalColumn) {
        return mapProfileToUser({
          id: data.user.id,
          email: data.user.email ?? null,
          name: data.user.user_metadata?.name ?? null,
          initials: data.user.user_metadata?.initials ?? null,
          is_admin: false,
          is_approved: true,
        });
      }
      throw profileError;
    }
    if (!profile)
      return mapProfileToUser({
        id: data.user.id,
        email: data.user.email ?? null,
        name: data.user.user_metadata?.name ?? null,
        initials: data.user.user_metadata?.initials ?? null,
        is_admin: false,
        is_approved: false,
      });
    return mapProfileToUser(profile);
  },

  logout(): void {
    supabase.auth.signOut();
  },

  /**
   * Sign up a new user. If email confirmation is disabled in Supabase, returns the user and they are logged in.
   * If email confirmation is required, returns { user: null, needsEmailConfirmation: true }.
   */
  async signUp(
    email: string,
    password: string,
    options?: { name?: string }
  ): Promise<{ user: User | null; needsEmailConfirmation: boolean }> {
    const name = options?.name?.trim() || undefined;
    const initials = name
      ? name
          .split(/\s+/)
          .map((s) => s[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : undefined;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || undefined, initials: initials || undefined },
      },
    });
    if (error) throw error;
    const needsEmailConfirmation = !data.session && !!data.user;
    if (data.session?.user) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, name, initials, is_admin, is_approved')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) {
        const msg = profileError.message ?? '';
        const missingApprovalColumn = /column .*is_approved.* does not exist/i.test(msg);
        if (missingApprovalColumn) {
          const user = mapProfileToUser({
            id: data.user.id,
            email: data.user.email ?? null,
            name: data.user.user_metadata?.name ?? name ?? null,
            initials: data.user.user_metadata?.initials ?? initials ?? null,
            is_admin: false,
            is_approved: true,
          });
          return { user, needsEmailConfirmation: false };
        }
        throw profileError;
      }
      const user = profile
        ? mapProfileToUser(profile)
        : mapProfileToUser({
            id: data.user.id,
            email: data.user.email ?? null,
            name: data.user.user_metadata?.name ?? name ?? null,
            initials: data.user.user_metadata?.initials ?? initials ?? null,
            is_admin: false,
            is_approved: false,
          });
      return { user, needsEmailConfirmation: false };
    }
    return { user: null, needsEmailConfirmation };
  },

  /** Send a password reset email. Does not throw if email is unknown (security). */
  async resetPasswordForEmail(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/app`,
    });
    if (error) throw error;
  },
};
