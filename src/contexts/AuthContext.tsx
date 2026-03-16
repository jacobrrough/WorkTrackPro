import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '@/core/types';
import { authService } from '@/services/api/auth';
import { supabase } from '@/services/api/supabaseClient';

export interface AuthContextType {
  currentUser: User | null;
  isLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  signUp: (
    email: string,
    password: string,
    options?: { name?: string }
  ) => Promise<boolean | 'needs_email_confirmation'>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    setIsLoading(true);
    try {
      const user = await authService.login(email, password);
      setCurrentUser(user);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setAuthError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      options?: { name?: string }
    ): Promise<boolean | 'needs_email_confirmation'> => {
      setAuthError(null);
      setIsLoading(true);
      try {
        const { user, needsEmailConfirmation } = await authService.signUp(email, password, options);
        if (user) {
          setCurrentUser(user);
          return true;
        }
        return needsEmailConfirmation ? 'needs_email_confirmation' : false;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
        setAuthError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const resetPasswordForEmail = useCallback(async (email: string): Promise<void> => {
    setAuthError(null);
    await authService.resetPasswordForEmail(email);
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setCurrentUser(null);
  }, []);

  // Initial auth check
  useEffect(() => {
    const initApp = async () => {
      setIsLoading(true);
      try {
        const user = await authService.checkAuth();
        if (user) setCurrentUser(user);
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    initApp();
  }, []);

  // Auth state listener: session expiry and token refresh
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setCurrentUser(null);
      }
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        authService.checkAuth().then((user) => {
          if (user) setCurrentUser(user);
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auth refresh + idle timeout
  useEffect(() => {
    if (!currentUser) return;

    let lastActivity = Date.now();

    const refreshAuthWithRetry = async (retries = 2): Promise<boolean> => {
      for (let i = 0; i <= retries; i++) {
        try {
          const user = await authService.checkAuth();
          if (user) return true;
        } catch (error) {
          if (i === retries) {
            console.error('Auth refresh failed after retries:', error);
            return false;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      return false;
    };

    const authRefreshInterval = setInterval(
      async () => {
        const ok = await refreshAuthWithRetry();
        if (!ok) logout();
      },
      20 * 60 * 1000
    );

    const updateActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener('mousedown', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    window.addEventListener('scroll', updateActivity);

    const idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      const idleLimit = 60 * 60 * 1000;
      if (idleTime >= idleLimit) logout();
    }, 60 * 1000);

    return () => {
      clearInterval(authRefreshInterval);
      clearInterval(idleCheckInterval);
      window.removeEventListener('mousedown', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [currentUser, logout]);

  const value: AuthContextType = {
    currentUser,
    isLoading,
    authError,
    login,
    signUp,
    resetPasswordForEmail,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
