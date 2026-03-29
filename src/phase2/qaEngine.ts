import type { GlossaryTerm } from '../phase0/aiGateway';
import { findGlossaryViolations } from '../phase0/aiGateway';
import { canSpend, chargeBudget, estimateCostUsd } from '../finops';
import { trackApiRequestTelemetry } from '../apiKeyTelemetry';
import type {
  Phase2GeneratedIssue,
  Phase2SegmentSnapshot,
  QaIssueOrigin,
  QaIssueType,
  QaSeverity,
  QaTaskPayload,
  QaTaskRunResult,
} from './types';

type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'mock';

interface RuntimeApiConfig {
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
  openrouterKey?: string;
  providerOrder?: AiProvider[];
  relayBaseUrl?: string;
}

interface StoredApiKey {
  id: string;
  key: string;
  provider?: AiProvider;
  isActive?: boolean;
  baseUrl?: string;
}

interface ProviderCandidate {
  provider: Exclude<AiProvider, 'mock'>;
  key: string;
  baseUrl?: string;
}

interface TaskCacheEntry {
  provider: AiProvider;
  model: string;
  payload: unknown;
  cachedAt: number;
}

interface TaskRunResult<T> {
  provider: AiProvider;
  model: string;
  payload: T;
  fromCache: boolean;
  failoverTrail: string[];
}

interface QaScanInput {
  segments: Phase2SegmentSnapshot[];
  glossary: GlossaryTerm[];
  chapterText: string;
}

const TASK_CACHE_KEY = 'phase2_qa_task_cache_v1';
const TASK_CACHE_TTL_MS = 1000 * 60 * 20;
const TASK_CACHE_LIMIT = 160;

function readText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBaseUrl(input?: string): string {
  const raw = readText(input);
  if (!raw || raw.startsWith('ws://') || raw.startsWith('wss://')) return '';
  return raw.replace(/\/+$/, '');
}

function detectProviderFromKey(key: string): Exclude<AiProvider, 'mock'> | null {
  const value = readText(key);
  if (!value) return null;
  if (/^sk-or-v1-[A-Za-z0-9_\-]+$/i.test(value)) return 'openrouter';
  if (/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'anthropic';
  if (/^sk-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'openai';
  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(value)) return 'gemini';
  return null;
}

function normalizeProviderOrder(order?: AiProvider[]): Array<Exclude<AiProvider, 'mock'>> {
  const supported: Array<Exclude<AiProvider, 'mock'>> = ['openrouter', 'openai', 'anthropic', 'gemini'];
  const unique = (order || []).filter((item): item is Exclude<AiProvider, 'mock'> => supported.includes(item as Exclude<AiProvider, 'mock'>));
  const seen = new Set<Exclude<AiProvider, 'mock'>>();
  const result: Array<Exclude<AiProvider, 'mock'>> = [];
  unique.forEach((item) => {
    if (seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  supported.forEach((item) => {
    if (!seen.has(item)) result.push(item);
  });
  return result;
}

function loadRuntimeApiConfig(): RuntimeApiConfig {
  try {
    const raw = localStorage.getItem('phase1_ai_config_v1');
    if (!raw) return {};
    return JSON.parse(raw) as RuntimeApiConfig;
  } catch {
    return {};
  }
}

function loadStoredKeys(): StoredApiKey[] {
  try {
    const raw = localStorage.getItem('api_keys');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredApiKey[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadProviderCandidates(runtime: RuntimeApiConfig): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];
  const append = (provider: Exclude<AiProvider, 'mock'>, key?: string, baseUrl?: string) => {
    const clean = readText(key);
    if (!clean) return;
    candidates.push({
      provider,
      key: clean,
      baseUrl: normalizeBaseUrl(baseUrl || runtime.relayBaseUrl) || undefined,
    });
  };

  append('openrouter', runtime.openrouterKey);
  append('openai', runtime.openaiKey);
  append('anthropic', runtime.anthropicKey);
  append('gemini', runtime.geminiKey);

  loadStoredKeys().forEach((row) => {
    const key = readText(row.key);
    if (!key) return;
    const provider = (row.provider && row.provider !== 'mock' ? row.provider : detectProviderFromKey(key)) || 'gemini';
    append(provider, key, row.baseUrl);
  });

  const ordered = normalizeProviderOrder(runtime.providerOrder);
  const dedupe = new Set<string>();
  const prioritized = ordered
    .flatMap((provider) => candidates.filter((item) => item.provider === provider))
    .filter((item) => {
      const id = `${item.provider}:${item.key}`;
      if (dedupe.has(id)) return false;
      dedupe.add(id);
      return true;
    })
    .slice(0, 8);
  return [
    ...prioritized.filter((item) => item.provider === 'openrouter'),
    ...prioritized.filter((item) => item.provider !== 'openrouter'),
  ];
}

function pickTaskModel(provider: Exclude<AiProvider, 'mock'>, preferStrongModel: boolean): string {
  if (provider === 'openrouter') {
    return preferStrongModel ? 'anthropic/claude-3.5-sonnet' : 'openrouter/auto';
  }
  if (provider === 'openai') {
    return preferStrongModel ? 'gpt-4.1' : 'gpt-4.1-mini';
  }
  if (provider === 'anthropic') {
    return preferStrongModel ? 'claude-3-5-sonnet-latest' : 'claude-3-5-haiku-latest';
  }
  return preferStrongModel ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
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

async function withTimeout(url: string, init: RequestInit, timeoutMs = 25000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function parseLooseJson(raw: string): unknown | null {
  const text = readText(raw)
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h-${(hash >>> 0).toString(16)}`;
}

function loadTaskCache(): Record<string, TaskCacheEntry> {
  try {
    const raw = sessionStorage.getItem(TASK_CACHE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, TaskCacheEntry>) || {};
  } catch {
    return {};
  }
}

function saveTaskCache(entries: Record<string, TaskCacheEntry>): void {
  sessionStorage.setItem(TASK_CACHE_KEY, JSON.stringify(entries));
}

function compactTaskCache(entries: Record<string, TaskCacheEntry>): Record<string, TaskCacheEntry> {
  const now = Date.now();
  const alive = Object.entries(entries).filter(([, value]) => now - Number(value.cachedAt || 0) <= TASK_CACHE_TTL_MS);
  if (alive.length <= TASK_CACHE_LIMIT) return Object.fromEntries(alive);
  alive.sort((a, b) => Number(b[1].cachedAt || 0) - Number(a[1].cachedAt || 0));
  return Object.fromEntries(alive.slice(0, TASK_CACHE_LIMIT));
}

function getTaskCacheEntry(cacheKey: string): TaskCacheEntry | null {
  const cache = loadTaskCache();
  const found = cache[cacheKey];
  if (!found) return null;
  if (Date.now() - Number(found.cachedAt || 0) > TASK_CACHE_TTL_MS) {
    delete cache[cacheKey];
    saveTaskCache(cache);
    return null;
  }
  return found;
}

function setTaskCacheEntry(cacheKey: string, entry: Omit<TaskCacheEntry, 'cachedAt'>): void {
  const cache = loadTaskCache();
  cache[cacheKey] = {
    ...entry,
    cachedAt: Date.now(),
  };
  saveTaskCache(compactTaskCache(cache));
}

function normalizeSeverity(value: unknown): QaSeverity {
  const key = readText(value).toUpperCase();
  if (key === 'LOW' || key === 'MEDIUM' || key === 'HIGH' || key === 'CRITICAL') return key;
  return 'MEDIUM';
}

function normalizeType(value: unknown, fallback: QaIssueType): QaIssueType {
  const key = readText(value).toUpperCase();
  if (key === 'SPELLING' || key === 'GRAMMAR' || key === 'STYLE' || key === 'GLOSSARY' || key === 'CONSISTENCY' || key === 'TIMELINE') {
    return key;
  }
  return fallback;
}

function normalizeIssueList(raw: unknown, origin: QaIssueOrigin, fallbackType: QaIssueType, segments: Phase2SegmentSnapshot[]): QaTaskPayload | null {
  const payload = raw as { summary?: string; issues?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload?.issues)) return null;
  const segmentMap = new Map<string, Phase2SegmentSnapshot>(segments.map((segment) => [segment.id, segment]));
  const issues = payload.issues
    .map((row) => {
      const title = readText(row.title);
      const description = readText(row.description);
      const evidence = readText(row.evidence);
      if (!title || !description || !evidence) return null;
      const segmentId = readText(row.segmentId);
      const mapped = segmentMap.get(segmentId);
      return {
        origin,
        type: normalizeType(row.type, fallbackType),
        severity: normalizeSeverity(row.severity),
        segmentId,
        title,
        description,
        evidence,
        currentText: readText(row.currentText) || mapped?.targetText || '',
        suggestedText: readText(row.suggestedText),
      } satisfies Phase2GeneratedIssue;
    })
    .filter(Boolean) as Phase2GeneratedIssue[];
  return {
    summary: readText(payload.summary) || `Detected ${issues.length} issues.`,
    issues,
  };
}

async function runProviderJson(
  candidate: ProviderCandidate,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  if (candidate.provider === 'openai' || candidate.provider === 'openrouter') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${candidate.key}`,
    };
    if (candidate.provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://truyenforge.local';
      headers['X-Title'] = 'TruyenForge';
    }
    const res = await withTimeout(resolveOpenAiEndpoint(candidate.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${candidate.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} HTTP ${res.status}`);
    }
    const data = await res.json();
    return parseLooseJson(readText(data?.choices?.[0]?.message?.content));
  }

  if (candidate.provider === 'anthropic') {
    const res = await withTimeout(resolveAnthropicEndpoint(candidate.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': candidate.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}`);
    }
    const data = await res.json();
    return parseLooseJson(readText(data?.content?.[0]?.text));
  }

  const res = await withTimeout(resolveGeminiEndpoint(candidate.key, model, candidate.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}`);
  }
  const data = await res.json();
  return parseLooseJson(readText(data?.candidates?.[0]?.content?.parts?.[0]?.text));
}

async function runTaskWithFallback<T>(input: {
  taskCode: string;
  systemPrompt: string;
  userPrompt: string;
  normalize: (raw: unknown) => T | null;
  fallback: () => T;
  preferStrongModel?: boolean;
}): Promise<TaskRunResult<T>> {
  const runtime = loadRuntimeApiConfig();
  const candidates = loadProviderCandidates(runtime);
  const failoverTrail: string[] = [];
  const cacheKey = hashText(
    [
      input.taskCode,
      normalizeProviderOrder(runtime.providerOrder).join(','),
      input.preferStrongModel ? '1' : '0',
      input.systemPrompt,
      input.userPrompt,
    ].join('||'),
  );
  const cached = getTaskCacheEntry(cacheKey);
  if (cached) {
    const normalized = input.normalize(cached.payload);
    if (normalized) {
      return {
        provider: cached.provider,
        model: cached.model,
        payload: normalized,
        fromCache: true,
        failoverTrail: ['cache_hit:phase2_qa'],
      };
    }
  }

  if (!candidates.length) {
    return {
      provider: 'mock',
      model: 'mock-local',
      payload: input.fallback(),
      fromCache: false,
      failoverTrail: ['No API key available. Fallback to local QA heuristics.'],
    };
  }

  for (const candidate of candidates) {
    const model = pickTaskModel(candidate.provider, Boolean(input.preferStrongModel));
    const promptChars = (input.systemPrompt?.length || 0) + (input.userPrompt?.length || 0);
    const startedAt = Date.now();
    try {
      const providerForPricing = candidate.provider === 'openrouter' ? 'openai' : candidate.provider;
      const estCost = estimateCostUsd(providerForPricing, model, promptChars, 1200);
      const spendCheck = canSpend(estCost);
      if (!spendCheck.allowed) {
        failoverTrail.push(`budget_exhausted:${candidate.provider}(${model}) need ${estCost.toFixed(3)} remaining ${spendCheck.remaining.toFixed(3)}`);
        continue;
      }
      const raw = await runProviderJson(candidate, model, input.systemPrompt, input.userPrompt);
      const normalized = input.normalize(raw);
      if (!normalized) {
        failoverTrail.push(`${candidate.provider}(${model}) returned invalid QA payload`);
        continue;
      }
      chargeBudget(estCost, `qa:${input.taskCode}`);
      const responseChars = JSON.stringify(normalized).length;
      trackApiRequestTelemetry({
        provider: candidate.provider,
        model,
        apiKey: candidate.key,
        task: `phase2:${input.taskCode}`,
        success: true,
        latencyMs: Date.now() - startedAt,
        promptChars,
        responseChars,
        estimatedTokens: Math.max(1, Math.round((promptChars + responseChars) / 4)),
      });
      setTaskCacheEntry(cacheKey, {
        provider: candidate.provider,
        model,
        payload: raw,
      });
      return {
        provider: candidate.provider,
        model,
        payload: normalized,
        fromCache: false,
        failoverTrail,
      };
    } catch (error) {
      trackApiRequestTelemetry({
        provider: candidate.provider,
        model,
        apiKey: candidate.key,
        task: `phase2:${input.taskCode}`,
        success: false,
        latencyMs: Date.now() - startedAt,
        promptChars,
        responseChars: 0,
        estimatedTokens: Math.max(1, Math.round(promptChars / 4)),
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      });
      failoverTrail.push(`${candidate.provider}(${model}) failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return {
    provider: 'mock',
    model: 'mock-local',
    payload: input.fallback(),
    fromCache: false,
    failoverTrail: [...failoverTrail, 'Fallback to local QA heuristics'],
  };
}

function createIssue(input: {
  origin: QaIssueOrigin;
  type: QaIssueType;
  severity: QaSeverity;
  segmentId?: string;
  title: string;
  description: string;
  evidence: string;
  currentText?: string;
  suggestedText?: string;
}): Phase2GeneratedIssue {
  return {
    origin: input.origin,
    type: input.type,
    severity: input.severity,
    segmentId: readText(input.segmentId),
    title: readText(input.title),
    description: readText(input.description),
    evidence: readText(input.evidence),
    currentText: readText(input.currentText),
    suggestedText: readText(input.suggestedText),
  };
}

function dedupeIssues(issues: Phase2GeneratedIssue[]): Phase2GeneratedIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.origin,
      issue.segmentId || '',
      issue.type,
      issue.title.toLowerCase(),
      issue.evidence.toLowerCase(),
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([(\["“‘])\s+/g, '$1')
    .replace(/\s+([)\]"”’])/g, '$1')
    .trim();
}

function replaceFirstRegex(text: string, pattern: RegExp, replacement: string): string {
  let replaced = false;
  return text.replace(pattern, (match) => {
    if (replaced) return match;
    replaced = true;
    return replacement;
  });
}

function containsChinese(text: string): boolean {
  return /[\u3400-\u9FFF]/u.test(text);
}

function countWords(text: string): number {
  return readText(text).split(/\s+/).filter(Boolean).length;
}

function findRepeatedWord(text: string): { word: string; fixed: string } | null {
  const match = text.match(/\b([\p{L}\p{N}_-]{2,})\s+\1\b/iu);
  if (!match?.[1]) return null;
  return {
    word: match[1],
    fixed: replaceFirstRegex(text, new RegExp(`\\b(${match[1]})\\s+\\1\\b`, 'iu'), match[1]),
  };
}

function findTimelineBuckets(text: string): string[] {
  const lower = text.toLowerCase();
  const buckets = [
    { name: 'night', tokens: ['dem', 'toi', 'nua dem'] },
    { name: 'morning', tokens: ['sang', 'binh minh', 'rang dong'] },
    { name: 'noon', tokens: ['trua', 'giua trua'] },
    { name: 'afternoon', tokens: ['chieu', 'xam chieu'] },
  ];
  return buckets.filter((bucket) => bucket.tokens.some((token) => lower.includes(token))).map((bucket) => bucket.name);
}

function detectPronounGroups(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const groups = [
    { name: 'toi-ban', tokens: [' toi ', ' ban '] },
    { name: 'anh-em', tokens: [' anh ', ' em '] },
    { name: 'ta-nguoi', tokens: [' ta ', ' nguoi ', ' bon toa '] },
    { name: 'tao-may', tokens: [' tao ', ' may '] },
  ];
  return groups.filter((group) => group.tokens.some((token) => lower.includes(token))).map((group) => group.name);
}

function buildProofreadHeuristics(input: QaScanInput): QaTaskPayload {
  const issues: Phase2GeneratedIssue[] = [];

  input.segments.forEach((segment) => {
    const text = readText(segment.targetText);
    if (!text) return;

    const normalized = normalizeWhitespace(text);
    if (normalized !== text) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'SPELLING',
          severity: 'LOW',
          segmentId: segment.id,
          title: 'Can don lai khoang trang va dau cau',
          description: 'Doan van co khoang trang thua hoac dau cau dat chua dung, de mat nhin va doc khong muot.',
          evidence: text,
          currentText: text,
          suggestedText: normalized,
        }),
      );
    }

    const repeated = findRepeatedWord(text);
    if (repeated) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'STYLE',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Lap tu lien tiep',
          description: `Tu "${repeated.word}" lap lai lien tiep, de tao cam giac loi nhip va giam chat luong van phong.`,
          evidence: text,
          currentText: text,
          suggestedText: repeated.fixed,
        }),
      );
    }

    if (/[!?]{2,}|\.{4,}/.test(text)) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'STYLE',
          severity: 'LOW',
          segmentId: segment.id,
          title: 'Dau cau dang bi dung qua tay',
          description: 'Phat hien chuoi dau cau lap lai, de lam giong van bi gay va thieu tiet che.',
          evidence: text.match(/[!?]{2,}|\.{4,}/)?.[0] || text,
          currentText: text,
          suggestedText: text.replace(/[!?]{2,}/g, '!').replace(/\.{4,}/g, '...'),
        }),
      );
    }

    if (containsChinese(text)) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'GRAMMAR',
          severity: 'HIGH',
          segmentId: segment.id,
          title: 'Van con sot ky tu nguon',
          description: 'Ban dich van con ky tu tieng Trung/chua dich het, can sua truoc khi dua sang review.',
          evidence: text,
          currentText: text,
        }),
      );
    }

    const quoteCount = (text.match(/["“”]/g) || []).length;
    if (quoteCount % 2 === 1) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'GRAMMAR',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Dau ngoac kep chua can',
          description: 'So luong dau ngoac kep le, de gay cam giac doan hoi thoai dang mo ma chua dong.',
          evidence: text,
          currentText: text,
        }),
      );
    }

    if (countWords(text) > 38 && !/[,:;!?]/.test(text)) {
      issues.push(
        createIssue({
          origin: 'proofreader',
          type: 'STYLE',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Cau van qua dai va thieu diem ngat',
          description: 'Doan van co qua nhieu tu nhung thieu diem ngat, de lam giam do ro va toc do doc.',
          evidence: text,
          currentText: text,
        }),
      );
    }
  });

  const deduped = dedupeIssues(issues);
  return {
    summary: deduped.length
      ? `Rule-based proofreader flagged ${deduped.length} items can review.`
      : 'Rule-based proofreader did not detect obvious wording problems.',
    issues: deduped,
  };
}

function applyGlossarySuggestion(sourceText: string, translatedText: string, glossary: GlossaryTerm[]): string {
  let next = translatedText;
  glossary.forEach((term) => {
    if (!sourceText.includes(term.source)) return;
    if (next.includes(term.target)) return;
    const escaped = term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(escaped, 'g'), term.target);
  });
  return next;
}

function buildConsistencyHeuristics(input: QaScanInput): QaTaskPayload {
  const issues: Phase2GeneratedIssue[] = [];
  const duplicateTargetMap = new Map<string, string>();

  input.segments.forEach((segment) => {
    const sourceText = readText(segment.sourceText);
    const targetText = readText(segment.targetText);

    if (!targetText) {
      issues.push(
        createIssue({
          origin: 'consistency',
          type: 'CONSISTENCY',
          severity: 'HIGH',
          segmentId: segment.id,
          title: 'Segment chua co ban dich',
          description: 'Doan nay chua co target text, khong nen day sang review status.',
          evidence: sourceText || segment.id,
          currentText: targetText,
        }),
      );
      return;
    }

    const glossaryViolations = findGlossaryViolations(sourceText, targetText, input.glossary);
    if (glossaryViolations.length > 0) {
      issues.push(
        createIssue({
          origin: 'consistency',
          type: 'GLOSSARY',
          severity: 'HIGH',
          segmentId: segment.id,
          title: 'Vi pham glossary bat buoc',
          description: glossaryViolations.join(' '),
          evidence: targetText,
          currentText: targetText,
          suggestedText: applyGlossarySuggestion(sourceText, targetText, input.glossary),
        }),
      );
    }

    const pronounGroups = detectPronounGroups(targetText);
    if (pronounGroups.length >= 2) {
      issues.push(
        createIssue({
          origin: 'consistency',
          type: 'CONSISTENCY',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Xung ho co dau hieu dao giong',
          description: 'Doan nay dang tron nhieu he xung ho, can xac nhan voice cua nhan vat co bi lech hay khong.',
          evidence: targetText,
          currentText: targetText,
        }),
      );
    }

    const timelineBuckets = findTimelineBuckets(targetText);
    if (timelineBuckets.length >= 2) {
      issues.push(
        createIssue({
          origin: 'consistency',
          type: 'TIMELINE',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Moc thoi gian trong mot doan dang xung dot',
          description: 'Doan nay chua nhieu dau hieu ve thoi diem khac nhau, can doi chieu timeline.',
          evidence: targetText,
          currentText: targetText,
        }),
      );
    }

    const normalizedTarget = targetText.toLowerCase().replace(/\s+/g, ' ').trim();
    const duplicateFrom = duplicateTargetMap.get(normalizedTarget);
    if (normalizedTarget && duplicateFrom && duplicateFrom !== segment.id && sourceText !== input.segments.find((row) => row.id === duplicateFrom)?.sourceText) {
      issues.push(
        createIssue({
          origin: 'consistency',
          type: 'CONSISTENCY',
          severity: 'MEDIUM',
          segmentId: segment.id,
          title: 'Hai segment khac nhau dang co cung target text',
          description: `Target text cua ${segment.id} trung hoan toan voi ${duplicateFrom}, co the do apply nham suggestion.`,
          evidence: targetText,
          currentText: targetText,
        }),
      );
    } else if (normalizedTarget) {
      duplicateTargetMap.set(normalizedTarget, segment.id);
    }
  });

  const deduped = dedupeIssues(issues);
  return {
    summary: deduped.length
      ? `Rule-based consistency guard flagged ${deduped.length} risks.`
      : 'Rule-based consistency guard did not detect obvious cross-segment risks.',
    issues: deduped,
  };
}

function hydrateMissingCurrentText(issues: Phase2GeneratedIssue[], segments: Phase2SegmentSnapshot[]): Phase2GeneratedIssue[] {
  const segmentMap = new Map<string, Phase2SegmentSnapshot>(segments.map((segment) => [segment.id, segment]));
  return issues.map((issue) => {
    if (readText(issue.currentText)) return issue;
    if (!issue.segmentId) return issue;
    return {
      ...issue,
      currentText: segmentMap.get(issue.segmentId)?.targetText || '',
    };
  });
}

function buildSegmentBundle(segments: Phase2SegmentSnapshot[]): string {
  return segments
    .slice(0, 36)
    .map((segment) => {
      const sourceText = readText(segment.sourceText);
      const targetText = readText(segment.targetText);
      return [
        `[${segment.id}]`,
        sourceText ? `source: ${sourceText}` : 'source: (custom chapter input)',
        `target: ${targetText || '(empty)'}`,
      ].join('\n');
    })
    .join('\n\n');
}

function buildGlossaryBundle(glossary: GlossaryTerm[]): string {
  if (!glossary.length) return '(empty)';
  return glossary
    .slice(0, 40)
    .map((term) => `- ${term.source} => ${term.target}`)
    .join('\n');
}

export async function runProofreadScan(input: QaScanInput): Promise<QaTaskRunResult> {
  const rulePayload = buildProofreadHeuristics(input);
  const started = performance.now();
  const result = await runTaskWithFallback<QaTaskPayload>({
    taskCode: 'phase2-proofread',
    preferStrongModel: false,
    systemPrompt: [
      'Ban la AI proofreader cho ban dich van hoc tieng Viet.',
      'Nhiem vu: tim loi chinh ta, ngu phap, lap tu, van phong khong tu nhien.',
      'Chi tra ve cac loi co evidence ro rang. Khong sua fact.',
      'Tra ve JSON: {"summary":"...","issues":[{"segmentId":"seg-1","type":"SPELLING|GRAMMAR|STYLE","severity":"LOW|MEDIUM|HIGH|CRITICAL","title":"...","description":"...","evidence":"...","suggestedText":"..."}]}',
    ].join('\n'),
    userPrompt: [
      `Chapter text:\n${readText(input.chapterText).slice(0, 7000)}`,
      `Segments:\n${buildSegmentBundle(input.segments)}`,
    ].join('\n\n'),
    normalize: (raw) => normalizeIssueList(raw, 'proofreader', 'STYLE', input.segments),
    fallback: () => rulePayload,
  });
  const mergedIssues = dedupeIssues(
    hydrateMissingCurrentText([...result.payload.issues, ...rulePayload.issues], input.segments),
  );
  return {
    provider: result.provider,
    model: result.model,
    fromCache: result.fromCache,
    failoverTrail: result.failoverTrail,
    durationMs: Math.max(1, Math.round(performance.now() - started)),
    payload: {
      summary:
        result.provider === 'mock'
          ? rulePayload.summary
          : `${result.payload.summary} Rule guard cross-check kept ${mergedIssues.length} issues.`,
      issues: mergedIssues,
    },
  };
}

export async function runConsistencyScan(input: QaScanInput): Promise<QaTaskRunResult> {
  const rulePayload = buildConsistencyHeuristics(input);
  const started = performance.now();
  const result = await runTaskWithFallback<QaTaskPayload>({
    taskCode: 'phase2-consistency',
    preferStrongModel: true,
    systemPrompt: [
      'Ban la QA editor cho workspace dich truyen dai tap.',
      'Nhiem vu: phat hien loi glossary, xung ho, voice, timeline va consistency giua cac segment.',
      'Chi bao loi neu co evidence ro rang. Khong viet lai ca chuong.',
      'Tra ve JSON: {"summary":"...","issues":[{"segmentId":"seg-1","type":"GLOSSARY|CONSISTENCY|TIMELINE","severity":"LOW|MEDIUM|HIGH|CRITICAL","title":"...","description":"...","evidence":"...","suggestedText":"..."}]}',
    ].join('\n'),
    userPrompt: [
      `Glossary:\n${buildGlossaryBundle(input.glossary)}`,
      `Chapter text:\n${readText(input.chapterText).slice(0, 7000)}`,
      `Segments:\n${buildSegmentBundle(input.segments)}`,
    ].join('\n\n'),
    normalize: (raw) => normalizeIssueList(raw, 'consistency', 'CONSISTENCY', input.segments),
    fallback: () => rulePayload,
  });
  const mergedIssues = dedupeIssues(
    hydrateMissingCurrentText([...result.payload.issues, ...rulePayload.issues], input.segments),
  );
  return {
    provider: result.provider,
    model: result.model,
    fromCache: result.fromCache,
    failoverTrail: result.failoverTrail,
    durationMs: Math.max(1, Math.round(performance.now() - started)),
    payload: {
      summary:
        result.provider === 'mock'
          ? rulePayload.summary
          : `${result.payload.summary} Rule guard cross-check kept ${mergedIssues.length} issues.`,
      issues: mergedIssues,
    },
  };
}
