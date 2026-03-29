import { hasSupabase, supabase } from './supabaseClient';
import type { StoredApiKeyRecord } from './apiVault';

type ApiTelemetryEventType = 'key_registered' | 'request_success' | 'request_error';

interface ApiTelemetryQueueEvent {
  eventType: ApiTelemetryEventType;
  provider: string;
  model: string;
  keyFingerprint: string;
  keyHint: string;
  keyId: string;
  task: string;
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  promptChars: number;
  responseChars: number;
  estimatedTokens: number;
  errorMessage: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ApiTelemetryInsertRow extends Omit<ApiTelemetryQueueEvent, 'payload'> {
  user_id: string;
  payload: Record<string, unknown>;
}

interface TrackApiRequestInput {
  provider: string;
  model?: string;
  apiKey?: string;
  keyId?: string;
  task?: string;
  success: boolean;
  statusCode?: number | null;
  latencyMs?: number;
  promptChars?: number;
  responseChars?: number;
  estimatedTokens?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface TrackApiVaultInput {
  source?: string;
}

const ENABLE_API_TELEMETRY = String(import.meta.env.VITE_ENABLE_API_TELEMETRY ?? '1').trim() !== '0';
const API_TELEMETRY_TABLE = (import.meta.env.VITE_SUPABASE_API_TELEMETRY_TABLE || 'api_key_telemetry_events').trim();
const API_TELEMETRY_QUEUE_KEY = 'truyenforge:api-telemetry:queue:v1';
const API_TELEMETRY_LAST_INVENTORY_HASH_KEY = 'truyenforge:api-telemetry:last-inventory-hash:v1';
const API_TELEMETRY_QUEUE_LIMIT = 600;
const API_TELEMETRY_FLUSH_BATCH_SIZE = 60;
const API_TELEMETRY_FLUSH_COOLDOWN_MS = 2500;

let flushTimer: number | null = null;
let flushInFlight = false;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function readSafeNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return next;
}

function normalizeProvider(value: unknown): string {
  const provider = readText(value).toLowerCase();
  return provider || 'unknown';
}

function quickHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildKeyFingerprint(provider: string, key: string): string {
  const cleanProvider = normalizeProvider(provider);
  const cleanKey = readText(key);
  if (!cleanKey) return `${cleanProvider}:none`;
  return `${cleanProvider}:${quickHash(`${cleanProvider}:${cleanKey}`)}`;
}

function buildKeyHint(key: string): string {
  const clean = readText(key);
  if (!clean) return '';
  const tail = clean.slice(-4);
  return tail ? `***${tail}` : '';
}

function estimateTokensByChars(promptChars: number, responseChars: number): number {
  return Math.max(1, Math.round((Math.max(0, promptChars) + Math.max(0, responseChars)) / 4));
}

function extractStatusCodeFromMessage(message: string): number | null {
  const text = readText(message);
  if (!text) return null;
  const patterns = [
    /\b(?:http|error)\s*[:\-]?\s*(\d{3})\b/i,
    /\b(\d{3})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) return parsed;
    }
  }
  return null;
}

function normalizeErrorMessage(value: unknown): string {
  const text = readText(value);
  if (!text) return '';
  if (text.length <= 320) return text;
  return `${text.slice(0, 317)}...`;
}

function readQueue(): ApiTelemetryQueueEvent[] {
  if (!canUseBrowserStorage()) return [];
  try {
    const raw = localStorage.getItem(API_TELEMETRY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApiTelemetryQueueEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        eventType: item?.eventType === 'request_error' || item?.eventType === 'request_success' || item?.eventType === 'key_registered'
          ? item.eventType
          : 'request_success',
        provider: normalizeProvider(item?.provider),
        model: readText(item?.model),
        keyFingerprint: readText(item?.keyFingerprint),
        keyHint: readText(item?.keyHint),
        keyId: readText(item?.keyId),
        task: readText(item?.task),
        success: Boolean(item?.success),
        statusCode: Number.isFinite(Number(item?.statusCode)) ? Number(item.statusCode) : null,
        latencyMs: Math.max(0, Math.round(readSafeNumber(item?.latencyMs))),
        promptChars: Math.max(0, Math.round(readSafeNumber(item?.promptChars))),
        responseChars: Math.max(0, Math.round(readSafeNumber(item?.responseChars))),
        estimatedTokens: Math.max(0, Math.round(readSafeNumber(item?.estimatedTokens))),
        errorMessage: normalizeErrorMessage(item?.errorMessage),
        payload: item?.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
          ? (item.payload as Record<string, unknown>)
          : {},
        createdAt: readText(item?.createdAt) || new Date().toISOString(),
      }))
      .filter((item) => item.provider && item.keyFingerprint);
  } catch {
    return [];
  }
}

function writeQueue(nextQueue: ApiTelemetryQueueEvent[]): void {
  if (!canUseBrowserStorage()) return;
  const trimmed = nextQueue.slice(-API_TELEMETRY_QUEUE_LIMIT);
  localStorage.setItem(API_TELEMETRY_QUEUE_KEY, JSON.stringify(trimmed));
}

function enqueueEvent(event: ApiTelemetryQueueEvent): void {
  const current = readQueue();
  current.push(event);
  writeQueue(current);
}

function scheduleFlush(delayMs = API_TELEMETRY_FLUSH_COOLDOWN_MS): void {
  if (!ENABLE_API_TELEMETRY || typeof window === 'undefined') return;
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushApiKeyTelemetryQueue();
  }, Math.max(0, delayMs));
}

async function resolveActiveUserId(): Promise<string | null> {
  if (!hasSupabase || !supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    return readText(userId) || null;
  } catch {
    return null;
  }
}

function buildInsertRows(userId: string, events: ApiTelemetryQueueEvent[]): ApiTelemetryInsertRow[] {
  return events.map((event) => ({
    user_id: userId,
    eventType: event.eventType,
    provider: normalizeProvider(event.provider),
    model: readText(event.model),
    keyFingerprint: readText(event.keyFingerprint),
    keyHint: readText(event.keyHint),
    keyId: readText(event.keyId),
    task: readText(event.task),
    success: event.success,
    statusCode: Number.isFinite(Number(event.statusCode)) ? Number(event.statusCode) : null,
    latencyMs: Math.max(0, Math.round(readSafeNumber(event.latencyMs))),
    promptChars: Math.max(0, Math.round(readSafeNumber(event.promptChars))),
    responseChars: Math.max(0, Math.round(readSafeNumber(event.responseChars))),
    estimatedTokens: Math.max(0, Math.round(readSafeNumber(event.estimatedTokens))),
    errorMessage: normalizeErrorMessage(event.errorMessage),
    payload: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : {},
    createdAt: readText(event.createdAt) || new Date().toISOString(),
  }));
}

export async function flushApiKeyTelemetryQueue(): Promise<void> {
  if (!ENABLE_API_TELEMETRY) return;
  if (!hasSupabase || !supabase) return;
  if (flushInFlight) return;
  const queue = readQueue();
  if (!queue.length) return;

  flushInFlight = true;
  try {
    const userId = await resolveActiveUserId();
    if (!userId) return;

    const chunk = queue.slice(0, API_TELEMETRY_FLUSH_BATCH_SIZE);
    const rows = buildInsertRows(userId, chunk);
    const { error } = await supabase
      .from(API_TELEMETRY_TABLE)
      .insert(rows.map((row) => ({
        user_id: row.user_id,
        event_type: row.eventType,
        provider: row.provider,
        model: row.model,
        key_fingerprint: row.keyFingerprint,
        key_hint: row.keyHint,
        key_id: row.keyId,
        task: row.task,
        success: row.success,
        status_code: row.statusCode,
        latency_ms: row.latencyMs,
        prompt_chars: row.promptChars,
        response_chars: row.responseChars,
        estimated_tokens: row.estimatedTokens,
        error_message: row.errorMessage,
        payload: row.payload,
        created_at: row.createdAt,
      })));
    if (error) return;

    writeQueue(queue.slice(chunk.length));
  } finally {
    flushInFlight = false;
    if (readQueue().length > 0) scheduleFlush();
  }
}

export function trackApiVaultTelemetry(apiKeys: StoredApiKeyRecord[], options?: TrackApiVaultInput): void {
  if (!ENABLE_API_TELEMETRY) return;
  const list = Array.isArray(apiKeys) ? apiKeys : [];
  const normalized = list
    .map((item) => {
      const provider = normalizeProvider(item.provider);
      const key = readText(item.key);
      return {
        id: readText(item.id),
        provider,
        model: readText(item.model),
        isActive: Boolean(item.isActive),
        keyFingerprint: buildKeyFingerprint(provider, key),
        keyHint: buildKeyHint(key),
      };
    })
    .filter((item) => item.keyFingerprint && item.keyFingerprint !== 'unknown:none');

  const inventoryHash = quickHash(JSON.stringify(normalized));
  if (canUseBrowserStorage()) {
    const lastHash = readText(localStorage.getItem(API_TELEMETRY_LAST_INVENTORY_HASH_KEY));
    if (lastHash && lastHash === inventoryHash) {
      scheduleFlush(1200);
      return;
    }
    localStorage.setItem(API_TELEMETRY_LAST_INVENTORY_HASH_KEY, inventoryHash);
  }

  const source = readText(options?.source) || 'api_vault';
  const createdAt = new Date().toISOString();
  normalized.forEach((entry) => {
    enqueueEvent({
      eventType: 'key_registered',
      provider: entry.provider,
      model: entry.model,
      keyFingerprint: entry.keyFingerprint,
      keyHint: entry.keyHint,
      keyId: entry.id,
      task: 'api_key_inventory',
      success: true,
      statusCode: null,
      latencyMs: 0,
      promptChars: 0,
      responseChars: 0,
      estimatedTokens: 0,
      errorMessage: '',
      payload: {
        source,
        isActive: entry.isActive,
        totalKeys: normalized.length,
      },
      createdAt,
    });
  });
  scheduleFlush();
}

export function trackApiRequestTelemetry(input: TrackApiRequestInput): void {
  if (!ENABLE_API_TELEMETRY) return;
  const provider = normalizeProvider(input.provider);
  const model = readText(input.model);
  const apiKey = readText(input.apiKey);
  const promptChars = Math.max(0, Math.round(readSafeNumber(input.promptChars)));
  const responseChars = Math.max(0, Math.round(readSafeNumber(input.responseChars)));
  const estimatedTokens = Math.max(
    1,
    Math.round(readSafeNumber(input.estimatedTokens, estimateTokensByChars(promptChars, responseChars))),
  );
  const errorMessage = normalizeErrorMessage(input.errorMessage);
  const statusCodeFromInput = Number.isFinite(Number(input.statusCode)) ? Number(input.statusCode) : null;
  const statusCode = statusCodeFromInput ?? extractStatusCodeFromMessage(errorMessage);

  enqueueEvent({
    eventType: input.success ? 'request_success' : 'request_error',
    provider,
    model,
    keyFingerprint: buildKeyFingerprint(provider, apiKey),
    keyHint: buildKeyHint(apiKey),
    keyId: readText(input.keyId),
    task: readText(input.task) || 'unknown_task',
    success: Boolean(input.success),
    statusCode,
    latencyMs: Math.max(0, Math.round(readSafeNumber(input.latencyMs))),
    promptChars,
    responseChars,
    estimatedTokens,
    errorMessage,
    payload: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {},
    createdAt: new Date().toISOString(),
  });
  scheduleFlush();
}
