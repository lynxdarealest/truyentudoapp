import React, { createContext, useContext, useEffect, useState } from 'react';

import { supabase, hasSupabase } from './supabaseClient';

interface LocalUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface AuthContextType {
  user: LocalUser | null;
  loading: boolean;
  login: (opts: { email: string; password: string }) => Promise<{ ok: boolean; message?: string }>;
  register: (opts: { email: string; password: string }) => Promise<{ ok: boolean; message?: string }>;
  loginWithProvider: (provider: 'google' | 'discord') => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  provider: 'supabase' | 'local';
}

const GUEST_USER: LocalUser = {
  uid: 'local-user',
  displayName: 'Tác giả (Local)',
  email: 'local@example.com',
  photoURL: 'https://picsum.photos/seed/author/100/100',
};

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  loading: true,
  login: async () => ({ ok: false, message: 'not-ready' }),
  register: async () => ({ ok: false, message: 'not-ready' }),
  loginWithProvider: async () => ({ ok: false, message: 'not-ready' }),
  logout: async () => {},
  provider: hasSupabase ? 'supabase' : 'local',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasSupabase || !supabase) {
      const savedUser = localStorage.getItem('story_app_user');
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      } else {
        setUser(GUEST_USER);
        localStorage.setItem('story_app_user', JSON.stringify(GUEST_USER));
      }
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const sess = data.session;
      if (sess?.user) {
        setUser({
          uid: sess.user.id,
          displayName: sess.user.email || 'Supabase user',
          email: sess.user.email || 'unknown',
          photoURL: sess.user.user_metadata?.avatar_url || GUEST_USER.photoURL,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          uid: session.user.id,
          displayName: session.user.email || 'Supabase user',
          email: session.user.email || 'unknown',
          photoURL: session.user.user_metadata?.avatar_url || GUEST_USER.photoURL,
        });
      } else {
        setUser(null);
      }
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  const login = async ({ email, password }: { email: string; password: string }) => {
    if (!hasSupabase || !supabase) {
      setUser(GUEST_USER);
      localStorage.setItem('story_app_user', JSON.stringify(GUEST_USER));
      return { ok: true, message: 'local-login' };
    }
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
      setUser({
        uid: data.user.id,
        displayName: data.user.email || 'Supabase user',
        email: data.user.email || 'unknown',
        photoURL: data.user.user_metadata?.avatar_url || GUEST_USER.photoURL,
      });
    }
    return { ok: true };
  };

  const loginWithProvider = async (provider: 'google' | 'discord') => {
    if (!hasSupabase || !supabase) {
      return { ok: false, message: 'Supabase credentials missing' };
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/oauth/consent` : undefined,
      },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  };

  const register = async ({ email, password }: { email: string; password: string }) => {
    if (!hasSupabase || !supabase) {
      return { ok: false, message: 'Supabase credentials missing' };
    }
    const { error, data } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
      setUser({
        uid: data.user.id,
        displayName: data.user.email || 'Supabase user',
        email: data.user.email || 'unknown',
        photoURL: data.user.user_metadata?.avatar_url || GUEST_USER.photoURL,
      });
    }
    return { ok: true };
  };

  const logout = async () => {
    if (hasSupabase && supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    localStorage.removeItem('story_app_user');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithProvider, logout, provider: hasSupabase ? 'supabase' : 'local' }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
