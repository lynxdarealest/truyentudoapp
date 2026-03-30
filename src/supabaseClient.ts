import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const normalizedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
const normalizedAnonKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';

export const hasSupabase = Boolean(normalizedUrl && normalizedAnonKey);

let cachedClient: SupabaseClient | null = null;
let loadingClientPromise: Promise<SupabaseClient | null> | null = null;

async function createSupabaseClient(): Promise<SupabaseClient | null> {
  if (!hasSupabase) return null;
  const module = await import('@supabase/supabase-js');
  const createClient = module.createClient;
  const storage =
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
      ? window.localStorage
      : undefined;
  return createClient(normalizedUrl, normalizedAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'truyenforge-supabase-auth',
      ...(storage ? { storage } : {}),
    },
  });
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (!hasSupabase) return null;
  if (cachedClient) return cachedClient;
  if (!loadingClientPromise) {
    loadingClientPromise = createSupabaseClient()
      .then((client) => {
        cachedClient = client;
        return client;
      })
      .finally(() => {
        loadingClientPromise = null;
      });
  }
  return await loadingClientPromise;
}
