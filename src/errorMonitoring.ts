import { hasSupabase, supabase } from './supabaseClient';

const ENABLE_MONITORING = String(import.meta.env.VITE_ENABLE_ERROR_MONITORING ?? '1').trim() !== '0';
const ERROR_TABLE = (import.meta.env.VITE_SUPABASE_CLIENT_ERRORS_TABLE || 'client_error_events').trim();
const LOCAL_RING_KEY = 'truyenforge:client-errors:v1';
const LOCAL_RING_LIMIT = 40;

interface ClientErrorPayload {
  level: 'error' | 'warn';
  source: 'window-error' | 'unhandledrejection' | 'manual';
  message: string;
  stack?: string;
  href: string;
  userAgent: string;
  createdAt: string;
}

let initialized = false;
let lastSentAt = 0;

function buildPayload(input: {
  level?: 'error' | 'warn';
  source: ClientErrorPayload['source'];
  message: string;
  stack?: string;
}): ClientErrorPayload {
  return {
    level: input.level || 'error',
    source: input.source,
    message: String(input.message || 'Unknown client error').slice(0, 1200),
    stack: typeof input.stack === 'string' ? input.stack.slice(0, 6000) : undefined,
    href: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    createdAt: new Date().toISOString(),
  };
}

function writeLocalRing(payload: ClientErrorPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(LOCAL_RING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(parsed) ? parsed : [];
    next.push(payload);
    localStorage.setItem(LOCAL_RING_KEY, JSON.stringify(next.slice(-LOCAL_RING_LIMIT)));
  } catch {
    // Ignore local ring failures.
  }
}

async function uploadToSupabase(payload: ClientErrorPayload): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const now = Date.now();
  if (now - lastSentAt < 1000) return;
  lastSentAt = now;

  let userId: string | null = null;
  try {
    const session = await supabase.auth.getSession();
    userId = session.data.session?.user?.id || null;
  } catch {
    userId = null;
  }

  const { error } = await supabase
    .from(ERROR_TABLE)
    .insert({
      user_id: userId,
      level: payload.level,
      source: payload.source,
      message: payload.message,
      stack: payload.stack || null,
      href: payload.href,
      user_agent: payload.userAgent,
      created_at: payload.createdAt,
    });
  if (error) {
    console.warn('Không thể gửi client error report lên Supabase.', error);
  }
}

export async function reportClientError(input: {
  source: ClientErrorPayload['source'];
  message: string;
  stack?: string;
  level?: 'error' | 'warn';
}): Promise<void> {
  if (!ENABLE_MONITORING) return;
  const payload = buildPayload(input);
  writeLocalRing(payload);
  await uploadToSupabase(payload);
}

export function initClientErrorMonitoring(): void {
  if (!ENABLE_MONITORING || initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('error', (event) => {
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    void reportClientError({
      source: 'window-error',
      message: event.message || 'Window error',
      stack,
      level: 'error',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    void reportClientError({
      source: 'unhandledrejection',
      message,
      stack,
      level: 'error',
    });
  });
}

