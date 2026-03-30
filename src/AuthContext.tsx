import React, { createContext, useContext, useEffect, useState } from 'react';

import { getSupabaseClient, hasSupabase } from './supabaseClient';

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
const SUPABASE_USER_CACHE_KEY = 'truyenforge:supabase-user-cache:v1';

function toLocalUser(input: {
  id?: string;
  email?: string | null;
  avatarUrl?: string | null;
}): LocalUser | null {
  const uid = String(input.id || '').trim();
  if (!uid) return null;
  const email = String(input.email || '').trim() || 'unknown';
  return {
    uid,
    displayName: email || 'Supabase user',
    email,
    photoURL: String(input.avatarUrl || '').trim() || GUEST_USER.photoURL,
  };
}

function loadCachedSupabaseUser(): LocalUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SUPABASE_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalUser>;
    const normalized = toLocalUser({
      id: parsed.uid,
      email: parsed.email,
      avatarUrl: parsed.photoURL,
    });
    return normalized;
  } catch {
    return null;
  }
}

function saveCachedSupabaseUser(next: LocalUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!next) {
      window.localStorage.removeItem(SUPABASE_USER_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(SUPABASE_USER_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage write errors
  }
}

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
    if (!hasSupabase) {
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

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const cachedUser = loadCachedSupabaseUser();
    if (cachedUser) {
      setUser(cachedUser);
      setLoading(false);
    }

    void (async () => {
      try {
        const supabase = await getSupabaseClient();
        if (!supabase) {
          if (!disposed) {
            setUser(null);
            setLoading(false);
          }
          return;
        }

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (disposed) return;
          const mapped = session?.user
            ? toLocalUser({
                id: session.user.id,
                email: session.user.email,
                avatarUrl: session.user.user_metadata?.avatar_url,
              })
            : null;
          if (mapped) {
            setUser(mapped);
            saveCachedSupabaseUser(mapped);
          } else {
            setUser(null);
            saveCachedSupabaseUser(null);
          }
          setLoading(false);
        });
        unsubscribe = () => listener?.subscription?.unsubscribe();

        const { data } = await supabase.auth.getSession();
        if (!disposed) {
          const mapped = data.session?.user
            ? toLocalUser({
                id: data.session.user.id,
                email: data.session.user.email,
                avatarUrl: data.session.user.user_metadata?.avatar_url,
              })
            : null;
          if (mapped) {
            setUser(mapped);
            saveCachedSupabaseUser(mapped);
          } else {
            setUser((prev) => prev ?? null);
          }
          setLoading(false);
        }
      } catch {
        if (!disposed) {
          setUser((prev) => prev ?? null);
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const login = async ({ email, password }: { email: string; password: string }) => {
    if (!hasSupabase) {
      setUser(GUEST_USER);
      localStorage.setItem('story_app_user', JSON.stringify(GUEST_USER));
      return { ok: true, message: 'local-login' };
    }
    const supabase = await getSupabaseClient();
    if (!supabase) return { ok: false, message: 'Supabase init failed' };
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
      const mapped = toLocalUser({
        id: data.user.id,
        email: data.user.email,
        avatarUrl: data.user.user_metadata?.avatar_url,
      });
      if (mapped) {
        setUser(mapped);
        saveCachedSupabaseUser(mapped);
      }
    }
    return { ok: true };
  };

  const loginWithProvider = async (provider: 'google' | 'discord') => {
    if (!hasSupabase) {
      return { ok: false, message: 'Supabase credentials missing' };
    }
    const supabase = await getSupabaseClient();
    if (!supabase) return { ok: false, message: 'Supabase init failed' };
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
    if (!hasSupabase) {
      return { ok: false, message: 'Supabase credentials missing' };
    }
    const supabase = await getSupabaseClient();
    if (!supabase) return { ok: false, message: 'Supabase init failed' };
    const { error, data } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    if (data.user) {
      const mapped = toLocalUser({
        id: data.user.id,
        email: data.user.email,
        avatarUrl: data.user.user_metadata?.avatar_url,
      });
      if (mapped) {
        setUser(mapped);
        saveCachedSupabaseUser(mapped);
      }
    }
    return { ok: true };
  };

  const logout = async () => {
    if (hasSupabase) {
      const supabase = await getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
    }
    setUser(null);
    localStorage.removeItem('story_app_user');
    saveCachedSupabaseUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithProvider, logout, provider: hasSupabase ? 'supabase' : 'local' }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
