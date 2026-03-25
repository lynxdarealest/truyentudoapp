export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'mock';
import { canSpend, chargeBudget, estimateCostUsd } from '../finops';

export interface GlossaryTerm {
  source: string;
  target: string;
}

export interface TranslateRequest {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  glossary: GlossaryTerm[];
  tone?: string;
  parallelProviders?: number;
  forceStrongModel?: boolean;
}

export interface ProviderComparison {
  provider: AiProvider;
  model: string;
  text: string;
  latencyMs: number;
}

export interface UsageSnapshot {
  sessionRequests: number;
  estimatedTokens: number;
  byProvider: Record<string, number>;
  byKey: Record<string, number>;
}

export interface TranslateResponse {
  provider: AiProvider;
  alternatives: string[];
  routedModel?: string;
  failoverTrail?: string[];
  comparisons?: ProviderComparison[];
  usage?: UsageSnapshot;
}

interface StoredApiKey {
  id: string;
  key: string;
  isActive?: boolean;
  provider?: AiProvider;
  model?: string;
  name?: string;
  baseUrl?: string;
}

interface RuntimeApiConfig {
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
  providerOrder?: AiProvider[];
  relayBaseUrl?: string;
}

interface ProviderCandidate {
  provider: Exclude<AiProvider, 'mock'>;
  key: string;
  keyName: string;
  baseUrl?: string;
}

interface ApiHttpErrorLike extends Error {
  status?: number;
}

const USAGE_KEY = 'phase1_usage_counter_v1';
const STORY_CONTEXT_KEY = 'story_context_v1';
const GLOBAL_GLOSSARY_KEY = 'global_glossary_v1';
const TRANSLATION_CACHE_KEY = 'phase1_translation_cache_v1';
const TRANSLATION_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const TRANSLATION_CACHE_LIMIT = 400;

interface TranslationCacheEntry {
  provider: AiProvider;
  routedModel?: string;
  alternatives: string[];
  cachedAt: number;
}

function makeHttpError(provider: string, status: number, body: string): ApiHttpErrorLike {
  const error = new Error(`${provider} error: ${status} ${body.slice(0, 140)}`) as ApiHttpErrorLike;
  error.status = status;
  return error;
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBaseUrl(input?: string): string {
  const raw = readText(input);
  if (!raw) return '';
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return '';
  return raw.replace(/\/+$/, '');
}

function detectProviderFromKey(key: string): Exclude<AiProvider, 'mock'> | null {
  const value = readText(key);
  if (!value) return null;
  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(value)) return 'gemini';
  if (/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'anthropic';
  if (/^sk-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'openai';
  return null;
}

export function detectApiProvider(key: string): AiProvider | 'unknown' {
  return detectProviderFromKey(key) || 'unknown';
}

function pickActiveStoredKey(): StoredApiKey | undefined {
  try {
    const raw = localStorage.getItem('api_keys');
    if (!raw) return undefined;
    const list = JSON.parse(raw) as StoredApiKey[];
    return list.find((k) => k.isActive && readText(k.key)) || list.find((k) => readText(k.key));
  } catch {
    return undefined;
  }
}

function loadAllStoredKeys(): StoredApiKey[] {
  try {
    const raw = localStorage.getItem('api_keys');
    if (!raw) return [];
    const list = JSON.parse(raw) as StoredApiKey[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function loadRuntimeApiConfig(): RuntimeApiConfig {
  try {
    const raw = localStorage.getItem('phase1_ai_config_v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RuntimeApiConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

function normalizeProviderOrder(order?: AiProvider[]): Array<Exclude<AiProvider, 'mock'>> {
  const supported: Array<Exclude<AiProvider, 'mock'>> = ['openai', 'anthropic', 'gemini'];
  const unique = (order || []).filter((p): p is Exclude<AiProvider, 'mock'> => supported.includes(p as Exclude<AiProvider, 'mock'>));
  const seen = new Set<Exclude<AiProvider, 'mock'>>();
  const result: Array<Exclude<AiProvider, 'mock'>> = [];

  unique.forEach((p) => {
    if (seen.has(p)) return;
    seen.add(p);
    result.push(p);
  });

  supported.forEach((p) => {
    if (!seen.has(p)) result.push(p);
  });

  return result;
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h-${(hash >>> 0).toString(16)}`;
}

function loadTranslationCache(): Record<string, TranslationCacheEntry> {
  try {
    const raw = sessionStorage.getItem(TRANSLATION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TranslationCacheEntry>;
    return parsed || {};
  } catch {
    return {};
  }
}

function saveTranslationCache(next: Record<string, TranslationCacheEntry>): void {
  sessionStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(next));
}

function compactTranslationCache(entries: Record<string, TranslationCacheEntry>): Record<string, TranslationCacheEntry> {
  const now = Date.now();
  const alive = Object.entries(entries).filter(([, value]) => now - Number(value.cachedAt || 0) <= TRANSLATION_CACHE_TTL_MS);
  if (alive.length <= TRANSLATION_CACHE_LIMIT) {
    return Object.fromEntries(alive);
  }
  alive.sort((a, b) => Number(b[1].cachedAt || 0) - Number(a[1].cachedAt || 0));
  return Object.fromEntries(alive.slice(0, TRANSLATION_CACHE_LIMIT));
}

function normalizeGlossaryForCache(glossary: GlossaryTerm[]): string {
  return glossary
    .map((term) => ({
      source: readText(term.source).toLowerCase(),
      target: readText(term.target).toLowerCase(),
    }))
    .filter((term) => term.source && term.target)
    .sort((a, b) => `${a.source}=>${a.target}`.localeCompare(`${b.source}=>${b.target}`))
    .map((term) => `${term.source}=>${term.target}`)
    .join('|');
}

function makeTranslateCacheKey(input: TranslateRequest, runtime: RuntimeApiConfig): string {
  const payload = [
    input.sourceLang,
    input.targetLang,
    readText(input.tone),
    input.forceStrongModel ? '1' : '0',
    String(Math.min(Math.max(1, input.parallelProviders || 1), 3)),
    normalizeProviderOrder(runtime.providerOrder).join(','),
    normalizeGlossaryForCache(input.glossary),
    input.sourceText,
  ].join('||');
  return hashText(payload);
}

function getCachedTranslation(cacheKey: string): TranslationCacheEntry | null {
  const cache = loadTranslationCache();
  const row = cache[cacheKey];
  if (!row) return null;
  const age = Date.now() - Number(row.cachedAt || 0);
  if (age > TRANSLATION_CACHE_TTL_MS) {
    delete cache[cacheKey];
    saveTranslationCache(cache);
    return null;
  }
  return row;
}

function setCachedTranslation(cacheKey: string, row: Omit<TranslationCacheEntry, 'cachedAt'>): void {
  const cache = loadTranslationCache();
  cache[cacheKey] = {
    ...row,
    cachedAt: Date.now(),
  };
  saveTranslationCache(compactTranslationCache(cache));
}

function parseJsonFromText(text: string): { alternatives?: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function parseGlobalGlossaryFromStorage(): GlossaryTerm[] {
  try {
    const raw = localStorage.getItem(GLOBAL_GLOSSARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ source?: string; target?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({ source: readText(row.source), target: readText(row.target) }))
      .filter((row) => row.source && row.target);
  } catch {
    return [];
  }
}

function parseStoryContextFromStorage(): string {
  return readText(localStorage.getItem(STORY_CONTEXT_KEY));
}

function mergeGlossary(inputGlossary: GlossaryTerm[]): GlossaryTerm[] {
  const merged: GlossaryTerm[] = [];
  const seen = new Set<string>();
  [...inputGlossary, ...parseGlobalGlossaryFromStorage()].forEach((row) => {
    const source = readText(row.source);
    const target = readText(row.target);
    if (!source || !target) return;
    const key = `${source}::${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ source, target });
  });
  return merged;
}

function buildPrompt(input: TranslateRequest): string {
  const glossaryRows = mergeGlossary(input.glossary)
    .map((t) => `- "${t.source}" => "${t.target}"`)
    .join('\n');

  const storyContext = parseStoryContextFromStorage();

  return [
    'You are a professional literary translator.',
    `Translate from ${input.sourceLang} to ${input.targetLang}.`,
    input.tone ? `Tone preference: ${input.tone}.` : '',
    storyContext ? `Story context (must keep consistent):\n${storyContext}` : '',
    'Rules:',
    '1) Return exactly 3 alternatives with natural Vietnamese wording.',
    '2) If a source term appears, target output MUST use mapped term exactly.',
    '3) Keep character voice consistent and fluent.',
    '4) Output only JSON: {"alternatives":["...","...","..."]}.',
    glossaryRows ? `Glossary mappings:\n${glossaryRows}` : 'No glossary mappings provided.',
    'Source text:',
    input.sourceText,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function estimatePromptChars(input: TranslateRequest): number {
  const glossaryText = mergeGlossary(input.glossary)
    .map((t) => `${t.source}=>${t.target}`)
    .join(',');
  const toneText = input.tone || '';
  return (input.sourceText?.length || 0) + glossaryText.length + toneText.length + 120;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function keyFingerprint(provider: string, key: string): string {
  const tail = key.slice(-6) || 'none';
  return `${provider}:${tail}`;
}

function readUsage(): UsageSnapshot {
  try {
    const raw = sessionStorage.getItem(USAGE_KEY);
    if (!raw) {
      return { sessionRequests: 0, estimatedTokens: 0, byProvider: {}, byKey: {} };
    }
    const parsed = JSON.parse(raw) as UsageSnapshot;
    return {
      sessionRequests: Number(parsed.sessionRequests || 0),
      estimatedTokens: Number(parsed.estimatedTokens || 0),
      byProvider: parsed.byProvider || {},
      byKey: parsed.byKey || {},
    };
  } catch {
    return { sessionRequests: 0, estimatedTokens: 0, byProvider: {}, byKey: {} };
  }
}

function writeUsage(next: UsageSnapshot): UsageSnapshot {
  sessionStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}

function bumpUsage(provider: string, key: string, prompt: string, output: string): UsageSnapshot {
  const current = readUsage();
  const keyId = keyFingerprint(provider, key);
  const estimated = estimateTokens(prompt) + estimateTokens(output);

  return writeUsage({
    sessionRequests: current.sessionRequests + 1,
    estimatedTokens: current.estimatedTokens + estimated,
    byProvider: {
      ...current.byProvider,
      [provider]: (current.byProvider[provider] || 0) + 1,
    },
    byKey: {
      ...current.byKey,
      [keyId]: (current.byKey[keyId] || 0) + 1,
    },
  });
}

export function getUsageSnapshot(): UsageSnapshot {
  return readUsage();
}

function isTransientStatus(status?: number): boolean {
  if (!status) return false;
  return status === 429 || status >= 500;
}

function chooseModel(provider: Exclude<AiProvider, 'mock'>, input: TranslateRequest): string {
  const len = input.sourceText.length;
  const strong = Boolean(input.forceStrongModel) || len > 1800;
  const short = len < 450;

  if (provider === 'openai') {
    if (strong) return 'gpt-4.1';
    return short ? 'gpt-4o-mini' : 'gpt-4.1-mini';
  }

  if (provider === 'anthropic') {
    if (strong) return 'claude-3-5-sonnet-latest';
    return short ? 'claude-3-5-haiku-latest' : 'claude-3-5-sonnet-latest';
  }

  if (strong) return 'gemini-2.5-pro';
  return short ? 'gemini-2.0-flash' : 'gemini-2.5-flash';
}

function resolveOpenAiEndpoint(baseUrl?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return 'https://api.openai.com/v1/chat/completions';
  if (base.includes('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

function resolveAnthropicEndpoint(baseUrl?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return 'https://api.anthropic.com/v1/messages';
  if (base.includes('/messages')) return base;
  return `${base}/messages`;
}

function resolveGeminiEndpoint(key: string, model: string, baseUrl?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (base && /generativelanguage|googleapis/i.test(base)) {
    return `${base}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

async function withTimeoutJson(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function translateWithOpenAI(input: TranslateRequest, key: string, model: string, baseUrl?: string): Promise<string[]> {
  const prompt = buildPrompt(input);
  const res = await withTimeoutJson(resolveOpenAiEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    throw makeHttpError('OpenAI', res.status, await res.text());
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonFromText(text);
  bumpUsage('openai', key, prompt, text);
  return (parsed.alternatives || []).slice(0, 3);
}

async function translateWithAnthropic(input: TranslateRequest, key: string, model: string, baseUrl?: string): Promise<string[]> {
  const prompt = buildPrompt(input);
  const res = await withTimeoutJson(resolveAnthropicEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw makeHttpError('Anthropic', res.status, await res.text());
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  bumpUsage('anthropic', key, prompt, text);
  return (parsed.alternatives || []).slice(0, 3);
}

async function translateWithGemini(input: TranslateRequest, key: string, model: string, baseUrl?: string): Promise<string[]> {
  const prompt = buildPrompt(input);
  const res = await withTimeoutJson(resolveGeminiEndpoint(key, model, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    throw makeHttpError('Gemini', res.status, await res.text());
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  bumpUsage('gemini', key, prompt, text);
  return (parsed.alternatives || []).slice(0, 3);
}

function makeMockAlternatives(input: TranslateRequest): string[] {
  const base = input.sourceText.trim();
  if (!base) return [];

  const appended = mergeGlossary(input.glossary)
    .filter((t) => t.source && t.target && base.includes(t.source))
    .map((t) => `${t.source} -> ${t.target}`)
    .join(', ');

  return [
    `Ban dich thu nghiem (smooth): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
    `Ban dich thu nghiem (faithful): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
    `Ban dich thu nghiem (creative): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
  ];
}

function loadCandidates(runtime: RuntimeApiConfig): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];

  const append = (provider: Exclude<AiProvider, 'mock'>, key: string | undefined, keyName: string, baseUrl?: string) => {
    const normalized = readText(key);
    if (!normalized) return;
    candidates.push({ provider, key: normalized, keyName, baseUrl: normalizeBaseUrl(baseUrl || runtime.relayBaseUrl) || undefined });
  };

  append('openai', runtime.openaiKey, 'openai.runtime');
  append('anthropic', runtime.anthropicKey, 'anthropic.runtime');
  append('gemini', runtime.geminiKey, 'gemini.runtime');

  const stored = loadAllStoredKeys();
  stored.forEach((entry, idx) => {
    const key = readText(entry.key);
    if (!key) return;
    const provider = (entry.provider && entry.provider !== 'mock' ? entry.provider : detectProviderFromKey(key)) || 'gemini';
    append(provider, key, entry.name || entry.id || `stored-${idx + 1}`, entry.baseUrl);
  });

  const active = pickActiveStoredKey();
  if (active?.key) {
    const provider = (active.provider && active.provider !== 'mock' ? active.provider : detectProviderFromKey(active.key)) || 'gemini';
    append(provider, active.key, active.name || 'active-stored', active.baseUrl);
  }

  const dedupe = new Set<string>();
  return candidates.filter((item) => {
    const id = `${item.provider}:${item.key}`;
    if (dedupe.has(id)) return false;
    dedupe.add(id);
    return true;
  });
}

async function runProvider(candidate: ProviderCandidate, input: TranslateRequest, model: string): Promise<string[]> {
  if (candidate.provider === 'openai') {
    return translateWithOpenAI(input, candidate.key, model, candidate.baseUrl);
  }
  if (candidate.provider === 'anthropic') {
    return translateWithAnthropic(input, candidate.key, model, candidate.baseUrl);
  }
  return translateWithGemini(input, candidate.key, model, candidate.baseUrl);
}

function selectCandidatesByOrder(runtime: RuntimeApiConfig, candidates: ProviderCandidate[]): ProviderCandidate[] {
  const order = normalizeProviderOrder(runtime.providerOrder);
  return order
    .flatMap((provider) => candidates.filter((c) => c.provider === provider))
    .slice(0, 8);
}

export async function translateSegment(input: TranslateRequest): Promise<TranslateResponse> {
  const runtime = loadRuntimeApiConfig();
  const candidates = selectCandidatesByOrder(runtime, loadCandidates(runtime));
  const failoverTrail: string[] = [];
  const cacheKey = makeTranslateCacheKey(input, runtime);
  const promptChars = estimatePromptChars(input);
  const expectedOutputChars = Math.max(400, Math.round(input.sourceText.length * 1.2));
  const cached = getCachedTranslation(cacheKey);
  if (cached?.alternatives?.length) {
    return {
      provider: cached.provider,
      alternatives: cached.alternatives.slice(0, 3),
      routedModel: cached.routedModel,
      failoverTrail: ['cache_hit:translation'],
      usage: getUsageSnapshot(),
    };
  }

  if (!candidates.length) {
    return {
      provider: 'mock',
      alternatives: makeMockAlternatives(input),
      failoverTrail: ['No API key available. Fallback to mock.'],
      usage: getUsageSnapshot(),
    };
  }

  const parallelCount = Math.min(Math.max(1, input.parallelProviders || 1), 3);
  if (parallelCount > 1) {
    const selected = candidates.slice(0, parallelCount);
    const settled = await Promise.allSettled(
      selected.map(async (candidate) => {
        const model = chooseModel(candidate.provider, input);
        const estCost = estimateCostUsd(candidate.provider, model, promptChars, expectedOutputChars);
        const spendCheck = canSpend(estCost);
        if (!spendCheck.allowed) {
          throw new Error(`budget_exhausted:${estCost.toFixed(3)}/${spendCheck.remaining.toFixed(3)}`);
        }
        const started = performance.now();
        const options = await runProvider(candidate, input, model);
        const latencyMs = Math.max(1, Math.round(performance.now() - started));
        return {
          provider: candidate.provider as AiProvider,
          model,
          alternatives: options,
          latencyMs,
          keyName: candidate.keyName,
          estCost,
        };
      }),
    );

    const comparisons: ProviderComparison[] = [];
    let chosen: { provider: AiProvider; model: string; alternatives: string[]; latencyMs: number; estCost: number } | null = null;

    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        const first = result.value.alternatives[0] || '';
        comparisons.push({
          provider: result.value.provider,
          model: result.value.model,
          text: first,
          latencyMs: result.value.latencyMs,
        });
        if (
          result.value.alternatives.length &&
          (!chosen || result.value.latencyMs < chosen.latencyMs)
        ) {
          chosen = {
            provider: result.value.provider,
            model: result.value.model,
            alternatives: result.value.alternatives,
            latencyMs: result.value.latencyMs,
            estCost: result.value.estCost,
          };
        }
      } else {
        failoverTrail.push(`parallel_error: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}`);
      }
    });

    if (chosen) {
      const alternatives = chosen.alternatives.slice(0, 3);
      chargeBudget(chosen.estCost, `translate:${chosen.provider}:${chosen.model}`);
      setCachedTranslation(cacheKey, {
        provider: chosen.provider,
        alternatives,
        routedModel: chosen.model,
      });
      return {
        provider: chosen.provider,
        alternatives,
        routedModel: chosen.model,
        comparisons,
        failoverTrail,
        usage: getUsageSnapshot(),
      };
    }
  }

  for (const candidate of candidates) {
    const model = chooseModel(candidate.provider, input);
    const estCost = estimateCostUsd(candidate.provider, model, promptChars, expectedOutputChars);
    const spendCheck = canSpend(estCost);
    if (!spendCheck.allowed) {
      failoverTrail.push(`budget_exhausted:${candidate.provider}(${model}) need ${estCost.toFixed(3)} remaining ${spendCheck.remaining.toFixed(3)}`);
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const alternatives = await runProvider(candidate, input, model);
        if (alternatives.length >= 1) {
          const topAlternatives = alternatives.slice(0, 3);
          chargeBudget(estCost, `translate:${candidate.provider}:${model}`);
          setCachedTranslation(cacheKey, {
            provider: candidate.provider,
            alternatives: topAlternatives,
            routedModel: model,
          });
          return {
            provider: candidate.provider,
            alternatives: topAlternatives,
            routedModel: model,
            failoverTrail,
            usage: getUsageSnapshot(),
          };
        }
        failoverTrail.push(`${candidate.provider}(${model}) returned empty alternatives`);
        break;
      } catch (error) {
        const status = (error as ApiHttpErrorLike)?.status;
        const message = error instanceof Error ? error.message : 'unknown';
        failoverTrail.push(`${candidate.provider}(${model}) attempt ${attempt + 1} failed: ${message}`);

        if (isTransientStatus(status) && attempt === 0) {
          continue;
        }
        break;
      }
    }
  }

  return {
    provider: 'mock',
    alternatives: makeMockAlternatives(input),
    failoverTrail,
    usage: getUsageSnapshot(),
  };
}

export async function testApiConnection(input: {
  provider: Exclude<AiProvider, 'mock'>;
  key: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; status?: number; latencyMs: number; message: string }> {
  const provider = input.provider;
  const key = readText(input.key);
  if (!key) {
    return { ok: false, latencyMs: 0, message: 'Missing key.' };
  }

  const started = performance.now();
  try {
    if (provider === 'openai') {
      const endpoint = resolveOpenAiEndpoint(input.baseUrl).replace(/\/chat\/completions$/, '/models');
      const res = await withTimeoutJson(endpoint, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      if (!res.ok) return { ok: false, status: res.status, latencyMs, message: `HTTP ${res.status}` };
      return { ok: true, status: res.status, latencyMs, message: 'Live' };
    }

    if (provider === 'anthropic') {
      const res = await withTimeoutJson(resolveAnthropicEndpoint(input.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      if (!res.ok) return { ok: false, status: res.status, latencyMs, message: `HTTP ${res.status}` };
      return { ok: true, status: res.status, latencyMs, message: 'Live' };
    }

    const model = 'gemini-2.0-flash';
    const res = await withTimeoutJson(resolveGeminiEndpoint(key, model, input.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    if (!res.ok) return { ok: false, status: res.status, latencyMs, message: `HTTP ${res.status}` };
    return { ok: true, status: res.status, latencyMs, message: 'Live' };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      message: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export function findGlossaryViolations(sourceText: string, translatedText: string, glossary: GlossaryTerm[]): string[] {
  const violations: string[] = [];

  glossary.forEach((term) => {
    const src = term.source.trim();
    const tgt = term.target.trim();
    if (!src || !tgt) return;
    if (!sourceText.includes(src)) return;
    if (!translatedText.includes(tgt)) {
      violations.push(`Term "${src}" must be translated as "${tgt}".`);
    }
  });

  return violations;
}
