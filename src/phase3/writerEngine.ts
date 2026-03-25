import type {
  ContextAnswer,
  ContextReference,
  PlotSuggestion,
  TonePreset,
  ToneShiftResult,
  UniverseWikiState,
  WikiEntity,
  WikiExtractionResult,
  WriterVariant,
  WriterVariantMode,
} from './types';
import { canSpend, chargeBudget, estimateCostUsd } from '../finops';

type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'mock';

interface RuntimeApiConfig {
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
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
  graphContext?: string[];
  bundleContext?: string;
}

const TASK_CACHE_KEY = 'phase3_writer_task_cache_v1';
const TASK_CACHE_TTL_MS = 1000 * 60 * 20;
const TASK_CACHE_LIMIT = 200;
const GRAPH_CONTEXT_LIMIT = 12;

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
  if (/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'anthropic';
  if (/^sk-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'openai';
  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(value)) return 'gemini';
  return null;
}

function normalizeProviderOrder(order?: AiProvider[]): Array<Exclude<AiProvider, 'mock'>> {
  const supported: Array<Exclude<AiProvider, 'mock'>> = ['openai', 'anthropic', 'gemini'];
  const unique = (order || []).filter((p): p is Exclude<AiProvider, 'mock'> => supported.includes(p as Exclude<AiProvider, 'mock'>));
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
  const append = (list: ProviderCandidate[], provider: Exclude<AiProvider, 'mock'>, key?: string, baseUrl?: string) => {
    const clean = readText(key);
    if (!clean) return;
    list.push({
      provider,
      key: clean,
      baseUrl: normalizeBaseUrl(baseUrl || runtime.relayBaseUrl) || undefined,
    });
  };

  const all: ProviderCandidate[] = [];
  append(all, 'openai', runtime.openaiKey);
  append(all, 'anthropic', runtime.anthropicKey);
  append(all, 'gemini', runtime.geminiKey);

  loadStoredKeys().forEach((row) => {
    const key = readText(row.key);
    if (!key) return;
    const provider = (row.provider && row.provider !== 'mock' ? row.provider : detectProviderFromKey(key)) || 'gemini';
    append(all, provider, key, row.baseUrl);
  });

  const dedupe = new Set<string>();
  const ordered = normalizeProviderOrder(runtime.providerOrder);
  return ordered
    .flatMap((provider) => all.filter((item) => item.provider === provider))
    .filter((item) => {
      const id = `${item.provider}:${item.key}`;
      if (dedupe.has(id)) return false;
      dedupe.add(id);
      return true;
    })
    .slice(0, 8);
}

function pickTaskModel(provider: Exclude<AiProvider, 'mock'>, preferStrongModel: boolean): string {
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
    .replace(/```$/, '')
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

function tokenize(input: string): string[] {
  return readText(input)
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\u1EF9]+/i)
    .filter((w) => w.length >= 3)
    .slice(0, 120);
}

function scoreByTokens(text: string, tokens: string[]): number {
  const lower = readText(text).toLowerCase();
  if (!tokens.length) return 0;
  return tokens.reduce((acc, token) => (lower.includes(token) ? acc + 1 : acc), 0);
}

function formatEntity(kind: string, row: WikiEntity): string {
  const alias = row.aliases?.length ? ` · aka ${row.aliases.slice(0, 2).join(', ')}` : '';
  return `${kind}: ${row.name}${alias}${row.description ? ` — ${row.description}` : ''}`;
}

function buildGraphContext(seed: string, wiki: UniverseWikiState): string[] {
  const tokens = tokenize(seed);
  const pickTop = (entities: WikiEntity[], label: string, limit: number): string[] => {
    const scored = entities.map((row) => ({
      row,
      score: scoreByTokens(`${row.name} ${row.description} ${(row.aliases || []).join(' ')}`, tokens),
    }));
    scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
    const slice = scored.slice(0, limit).filter((row, idx) => tokens.length === 0 || row.score > 0 || idx < 2);
    return slice.map((row) => formatEntity(label, row.row));
  };

  const timelineLines = (wiki.timeline || [])
    .map((row) => ({
      row,
      score: scoreByTokens(`${row.title} ${row.detail} ${row.when}`, tokens),
    }))
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title))
    .slice(0, 4)
    .filter((row, idx) => tokens.length === 0 || row.score > 0 || idx < 2)
    .map((row) => `Edge[timeline]: ${row.row.title}${row.row.when ? ` @ ${row.row.when}` : ''}${row.row.detail ? ` — ${row.row.detail}` : ''}`);

  const nodes = [
    ...pickTop(wiki.characters || [], 'Node[character]', 4),
    ...pickTop(wiki.locations || [], 'Node[location]', 3),
    ...pickTop(wiki.items || [], 'Node[item]', 3),
  ].slice(0, GRAPH_CONTEXT_LIMIT);

  const merged = [...nodes, ...timelineLines].slice(0, GRAPH_CONTEXT_LIMIT);
  if (!merged.length) return ['(empty graph context)'];
  return merged;
}

function trimText(input: string, limit: number): string {
  const clean = readText(input);
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 3)}...`;
}

function buildHierarchicalContext(input: {
  chapterObjective: string;
  styleProfile: string;
  recentChapterSummaries: string;
  timelineNotes: string;
  glossaryTerms?: string;
}): string {
  const paragraphs = readText(input.recentChapterSummaries)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const tier1 = trimText(paragraphs.slice(0, 2).join(' '), 380);
  const tier2 = trimText(paragraphs.slice(-2).join(' ') || input.recentChapterSummaries, 520);
  const timeline = trimText(input.timelineNotes, 260);
  const glossary = trimText(readText(input.glossaryTerms || ''), 260);
  return [
    `Tier1 summary: ${tier1 || '(none)'}`,
    `Tier2 (recent focus): ${tier2 || '(none)'}`,
    `Timeline cues: ${timeline || '(none)'}`,
    glossary ? `Glossary lock: ${glossary}` : 'Glossary lock: (empty)',
    `Objective: ${trimText(input.chapterObjective, 220)}`,
    `Style: ${trimText(input.styleProfile, 160)}`,
  ].join('\n');
}

async function runProviderJson(
  candidate: ProviderCandidate,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  if (candidate.provider === 'openai') {
    const res = await withTimeout(resolveOpenAiEndpoint(candidate.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${candidate.key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}`);
    }
    const data = await res.json();
    const text = readText(data?.choices?.[0]?.message?.content);
    return parseLooseJson(text);
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
        max_tokens: 1400,
        temperature: 0.5,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}`);
    }
    const data = await res.json();
    const text = readText(data?.content?.[0]?.text);
    return parseLooseJson(text);
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
        temperature: 0.55,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = readText(data?.candidates?.[0]?.content?.parts?.[0]?.text);
  return parseLooseJson(text);
}

async function runTaskWithFallback<T>(input: {
  taskKey: string;
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
      input.taskKey,
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
        failoverTrail: ['cache_hit:writer_task'],
      };
    }
  }

  if (!candidates.length) {
    return {
      provider: 'mock',
      model: 'mock-local',
      payload: input.fallback(),
      fromCache: false,
      failoverTrail: ['No API key available. Fallback to local heuristics.'],
    };
  }

  for (const candidate of candidates) {
    const model = pickTaskModel(candidate.provider, Boolean(input.preferStrongModel));
    try {
      const promptChars = (input.systemPrompt?.length || 0) + (input.userPrompt?.length || 0);
      const estCost = estimateCostUsd(candidate.provider as 'openai', model, promptChars, 900);
      const spendCheck = canSpend(estCost);
      if (!spendCheck.allowed) {
        failoverTrail.push(`budget_exhausted:${candidate.provider}(${model}) need ${estCost.toFixed(3)} remaining ${spendCheck.remaining.toFixed(3)}`);
        continue;
      }
      const raw = await runProviderJson(candidate, model, input.systemPrompt, input.userPrompt);
      const normalized = input.normalize(raw);
      if (!normalized) {
        failoverTrail.push(`${candidate.provider}(${model}) returned invalid JSON payload`);
        continue;
      }
      chargeBudget(estCost, `writer:${input.taskKey}`);
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
      failoverTrail.push(`${candidate.provider}(${model}) failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return {
    provider: 'mock',
    model: 'mock-local',
    payload: input.fallback(),
    fromCache: false,
    failoverTrail: [...failoverTrail, 'Fallback to local heuristics'],
  };
}

function takeLastWords(input: string, wordLimit: number): string {
  const words = readText(input).split(/\s+/).filter(Boolean);
  return words.slice(Math.max(0, words.length - wordLimit)).join(' ');
}

function estimateConfidence(text: string): number {
  const len = readText(text).length;
  if (len > 900) return 0.91;
  if (len > 600) return 0.87;
  if (len > 350) return 0.82;
  return 0.76;
}

function fallbackAutocomplete(input: {
  chapterObjective: string;
  draftText: string;
  desiredWords: 50 | 100 | 200;
}): { variants: WriterVariant[] } {
  const anchor = takeLastWords(input.draftText, 48);
  const objective = readText(input.chapterObjective) || 'Day tiep canh theo huong bang chung va cam xuc.';
  const base = readText(anchor) || 'Canh vat vang, nhan vat phai dua ra lua chon.';
  const mk = (mode: WriterVariantMode, style: string, confidenceOffset: number) => {
    const words = Math.max(45, input.desiredWords - 10);
    const body = `${base}. ${style}. Muc tieu chuong: ${objective}.`;
    return {
      mode,
      text: takeLastWords(body.repeat(4), words + 30),
      confidence: Math.max(0.5, Math.min(0.95, estimateConfidence(body) + confidenceOffset)),
    };
  };
  return {
    variants: [
      mk('conservative', 'Giu nhat quan su kien da co, uu tien logic lien mach', -0.04),
      mk('balanced', 'Can bang giua tien trien plot va phat trien tam ly nhan vat', 0),
      mk('bold', 'Day cao xung dot va them mot bien so bat ngo nhung van hop timeline', 0.03),
    ],
  };
}

function normalizeVariants(raw: unknown): { variants: WriterVariant[] } | null {
  const payload = raw as { variants?: Array<{ mode?: string; text?: string; confidence?: number }> };
  if (!Array.isArray(payload?.variants)) return null;
  const modes: WriterVariantMode[] = ['conservative', 'balanced', 'bold'];
  const variants = payload.variants
    .map((row, idx) => {
      const mode = modes.includes(row.mode as WriterVariantMode) ? (row.mode as WriterVariantMode) : modes[Math.min(idx, 2)];
      const text = readText(row.text);
      if (!text) return null;
      const confidence = Number(row.confidence || 0);
      return {
        mode,
        text,
        confidence: Math.max(0.01, Math.min(0.99, confidence || estimateConfidence(text))),
      };
    })
    .filter((row): row is WriterVariant => Boolean(row));
  if (!variants.length) return null;
  while (variants.length < 3) {
    variants.push(variants[variants.length - 1]);
  }
  return {
    variants: variants.slice(0, 3),
  };
}

function fallbackPlot(input: { objective: string; recentSummary: string }): PlotSuggestion {
  const objective = readText(input.objective) || 'Day manh xung dot nhan vat chinh.';
  const summary = takeLastWords(input.recentSummary, 60);
  return {
    directions: [
      `Huong 1: Cho nhan vat chinh uu tien nhiem vu hien tai de tien toi ${objective}.`,
      `Huong 2: Mo mot nhanh thu cap tu he qua cua su kien gan day: ${summary || 'su kien cua chuong truoc'}.`,
      'Huong 3: Tao canh doi dau nho de thu nghiem long tin giua hai nhan vat trong tam.',
    ],
    twists: [
      'Plot twist A: Dong minh cuc ky trung thanh hoa ra da doi ben tu truoc.',
      'Plot twist B: Vat pham duoc tin la da mat that ra dang o ngay trong thanh.',
      'Plot twist C: Mot nhan vat phu tiet lo thong tin lam dao chieu dong co chinh.',
    ],
    risks: [
      'Rui ro 1: Neu dua twist qua som co the vo nhip build-up.',
      'Rui ro 2: Canh doi dau lien tiep de lam giam do tin cay cua tam ly nhan vat.',
      'Rui ro 3: De xuat moi co the xung dot voi timeline neu thieu moc thoi gian ro rang.',
    ],
  };
}

function normalizePlot(raw: unknown): PlotSuggestion | null {
  const payload = raw as { directions?: string[]; twists?: string[]; risks?: string[] };
  if (!Array.isArray(payload?.directions) || !Array.isArray(payload?.twists) || !Array.isArray(payload?.risks)) {
    return null;
  }
  const clean = (rows: string[]) => rows.map((row) => readText(row)).filter(Boolean).slice(0, 6);
  const directions = clean(payload.directions);
  const twists = clean(payload.twists);
  const risks = clean(payload.risks);
  if (!directions.length || !twists.length || !risks.length) return null;
  return { directions, twists, risks };
}

function fallbackToneShift(input: { text: string; preset: TonePreset }): ToneShiftResult {
  const source = readText(input.text);
  if (!source) {
    return {
      rewritten: '',
      notes: ['Input text is empty.'],
    };
  }
  const presetMap: Record<TonePreset, string> = {
    'u-am': 'Sac thai toi hon, nhieu ngat nhip ngan, tap trung vao suc nang cua khong khi.',
    'lang-man': 'Tang hinh anh, nhip cau mem, uu tien cam xuc va cham.',
    'gay-gon': 'Rut gon mo ta, uu tien dong tu manh va cau ngan.',
    'van-hoc': 'Tang tinh tao hinh, bo cuc cau co chu y, giu van phong chau chuot.',
  };
  return {
    rewritten: `${source}\n\n[Rephrase (${input.preset})]: ${presetMap[input.preset]}`,
    notes: ['Fallback mode used. Please review and polish manually.'],
  };
}

function normalizeToneShift(raw: unknown): ToneShiftResult | null {
  const payload = raw as { rewritten?: string; notes?: string[] };
  const rewritten = readText(payload?.rewritten);
  if (!rewritten) return null;
  return {
    rewritten,
    notes: Array.isArray(payload.notes) ? payload.notes.map((n) => readText(n)).filter(Boolean).slice(0, 6) : [],
  };
}

function fallbackContext(input: { question: string; chapters: string; timeline: string }): ContextAnswer {
  const q = readText(input.question);
  const lines = `${input.chapters}\n${input.timeline}`
    .split('\n')
    .map((line) => readText(line))
    .filter(Boolean);
  const keywords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const refs: ContextReference[] = [];
  lines.forEach((line, idx) => {
    const lower = line.toLowerCase();
    const score = keywords.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
    if (score > 0 && refs.length < 3) {
      refs.push({
        source: idx % 2 === 0 ? 'recent_chapters' : 'timeline',
        lineHint: line.slice(0, 140),
      });
    }
  });
  return {
    answer: refs.length
      ? `Tim thay ${refs.length} manh context lien quan den cau hoi: "${q}".`
      : 'Khong du context de tra loi chac chan. Nen bo sung tom tat chuong hoac timeline chi tiet hon.',
    references: refs,
  };
}

function normalizeContext(raw: unknown): ContextAnswer | null {
  const payload = raw as { answer?: string; references?: Array<{ source?: string; lineHint?: string }> };
  const answer = readText(payload?.answer);
  if (!answer) return null;
  const references = Array.isArray(payload.references)
    ? payload.references
        .map((row) => ({
          source: readText(row.source) || 'chapter',
          lineHint: readText(row.lineHint),
        }))
        .filter((row) => row.lineHint)
        .slice(0, 6)
    : [];
  return {
    answer,
    references,
  };
}

function normalizeEntityList(rows: unknown): WikiEntity[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const item = row as { name?: string; description?: string; aliases?: string[] };
      const name = readText(item.name);
      if (!name) return null;
      return {
        name,
        description: readText(item.description),
        aliases: Array.isArray(item.aliases) ? item.aliases.map((v) => readText(v)).filter(Boolean).slice(0, 6) : [],
      };
    })
    .filter((row): row is WikiEntity => Boolean(row));
}

function fallbackWikiExtraction(input: { source: string }): WikiExtractionResult {
  const text = readText(input.source);
  const tokens = Array.from(new Set((text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g) || []).slice(0, 18)));
  const characters = tokens.slice(0, 6).map((name) => ({
    name,
    description: `Nhan vat duoc trich xuat tu ban thao: ${name}.`,
    aliases: [],
  }));
  const locations = tokens.slice(6, 10).map((name) => ({
    name,
    description: `Dia diem tiem nang: ${name}.`,
    aliases: [],
  }));
  const items = tokens.slice(10, 14).map((name) => ({
    name,
    description: `Vat pham/khai niem duoc phat hien: ${name}.`,
    aliases: [],
  }));
  return {
    characters,
    locations,
    items,
    timeline: [
      {
        title: 'Su kien mo dau',
        when: 'chua ro',
        detail: takeLastWords(text, 30) || 'Chua co du du lieu de trich xuat moc thoi gian.',
      },
    ],
  };
}

function normalizeWikiExtraction(raw: unknown): WikiExtractionResult | null {
  const payload = raw as {
    characters?: unknown;
    locations?: unknown;
    items?: unknown;
    timeline?: Array<{ title?: string; when?: string; detail?: string }>;
  };
  const characters = normalizeEntityList(payload.characters);
  const locations = normalizeEntityList(payload.locations);
  const items = normalizeEntityList(payload.items);
  const timeline = Array.isArray(payload.timeline)
    ? payload.timeline
        .map((row) => ({
          title: readText(row.title),
          when: readText(row.when),
          detail: readText(row.detail),
        }))
        .filter((row) => row.title || row.detail)
        .slice(0, 16)
    : [];
  if (!characters.length && !locations.length && !items.length && !timeline.length) return null;
  return { characters, locations, items, timeline };
}

export async function generateAutocomplete(input: {
  chapterObjective: string;
  styleProfile: string;
  recentChapterSummaries: string;
  timelineNotes: string;
  glossaryTerms: string;
  draftText: string;
  desiredWords: 50 | 100 | 200;
  universe: UniverseWikiState;
}): Promise<TaskRunResult<{ variants: WriterVariant[] }>> {
  const bundleContext = buildHierarchicalContext({
    chapterObjective: input.chapterObjective,
    styleProfile: input.styleProfile,
    recentChapterSummaries: input.recentChapterSummaries,
    timelineNotes: input.timelineNotes,
    glossaryTerms: input.glossaryTerms,
  });
  const graphContext = buildGraphContext(
    [input.chapterObjective, input.recentChapterSummaries, input.draftText, input.timelineNotes].join(' '),
    input.universe,
  );
  const result = await runTaskWithFallback({
    taskKey: 'autocomplete',
    preferStrongModel: false,
    systemPrompt: [
      'Ban la dong tac gia van hoc chuyen nghiep.',
      'Nhiem vu: viet tiep dung giong dieu va khong pha vo fact.',
      'Tra ve JSON: {"variants":[{"mode":"conservative|balanced|bold","text":"...","confidence":0.0}]}',
      'Moi text nen gan do dai yeu cau va co tinh lien mach.',
    ].join('\n'),
    userPrompt: [
      `Desired words: ${input.desiredWords}`,
      `Chapter objective:\n${readText(input.chapterObjective)}`,
      `Style profile:\n${readText(input.styleProfile)}`,
      `Hierarchical context (da rut gon nhieu cap):\n${bundleContext}`,
      `GraphRAG nodes/edges:\n${graphContext.join('\n')}`,
      `Must-use glossary terms (se giu nguyen trong dau ra):\n${readText(input.glossaryTerms)}`,
      `Current draft context:\n${readText(input.draftText)}`,
    ].join('\n\n'),
    normalize: normalizeVariants,
    fallback: () =>
      fallbackAutocomplete({
        chapterObjective: input.chapterObjective,
        draftText: input.draftText,
        desiredWords: input.desiredWords,
      }),
  });
  return {
    ...result,
    graphContext,
    bundleContext,
  };
}

export async function generatePlotSuggestions(input: {
  chapterObjective: string;
  recentChapterSummaries: string;
  timelineNotes: string;
  universe: UniverseWikiState;
}): Promise<TaskRunResult<PlotSuggestion>> {
  const bundleContext = buildHierarchicalContext({
    chapterObjective: input.chapterObjective,
    styleProfile: '',
    recentChapterSummaries: input.recentChapterSummaries,
    timelineNotes: input.timelineNotes,
  });
  const graphContext = buildGraphContext(
    [input.chapterObjective, input.recentChapterSummaries, input.timelineNotes].join(' '),
    input.universe,
  );
  const result = await runTaskWithFallback({
    taskKey: 'plot',
    preferStrongModel: true,
    systemPrompt: [
      'Ban la story architect.',
      'Phan tich boi canh va de xuat 3 huong tiep theo + plot twist + risk logic.',
      'Tra ve JSON: {"directions":["..."],"twists":["..."],"risks":["..."]}',
    ].join('\n'),
    userPrompt: [
      `Chapter objective:\n${readText(input.chapterObjective)}`,
      `Hierarchical context (rut gon):\n${bundleContext}`,
      `Timeline notes:\n${readText(input.timelineNotes)}`,
      `GraphRAG nodes/edges:\n${graphContext.join('\n')}`,
    ].join('\n\n'),
    normalize: normalizePlot,
    fallback: () =>
      fallbackPlot({
        objective: input.chapterObjective,
        recentSummary: input.recentChapterSummaries,
      }),
  });
  return {
    ...result,
    graphContext,
    bundleContext,
  };
}

export async function rewriteTone(input: {
  sourceText: string;
  tonePreset: TonePreset;
}): Promise<TaskRunResult<ToneShiftResult>> {
  return runTaskWithFallback({
    taskKey: `tone:${input.tonePreset}`,
    preferStrongModel: false,
    systemPrompt: [
      'Ban la bien tap vien van hoc.',
      'Nhiem vu: doi giong dieu nhung khong thay doi fact/su kien/chu the.',
      'Tra ve JSON: {"rewritten":"...","notes":["..."]}',
    ].join('\n'),
    userPrompt: [
      `Tone preset: ${input.tonePreset}`,
      `Source text:\n${readText(input.sourceText)}`,
    ].join('\n\n'),
    normalize: normalizeToneShift,
    fallback: () =>
      fallbackToneShift({
        text: input.sourceText,
        preset: input.tonePreset,
      }),
  });
}

export async function runContextQuery(input: {
  question: string;
  recentChapterSummaries: string;
  timelineNotes: string;
  glossaryTerms: string;
  universe: UniverseWikiState;
}): Promise<TaskRunResult<ContextAnswer>> {
  const graphContext = buildGraphContext(
    [input.question, input.recentChapterSummaries, input.timelineNotes, input.glossaryTerms].join(' '),
    input.universe,
  );
  const result = await runTaskWithFallback({
    taskKey: 'context_query',
    preferStrongModel: true,
    systemPrompt: [
      'Ban la context analyst cho truyen dai ky.',
      'Chi tra loi dua tren du lieu boi canh da cho. Neu thieu thong tin, noi ro.',
      'Tra ve JSON: {"answer":"...","references":[{"source":"chapter|timeline|wiki","lineHint":"..."}]}',
    ].join('\n'),
    userPrompt: [
      `Question:\n${readText(input.question)}`,
      `Recent chapter summaries:\n${readText(input.recentChapterSummaries)}`,
      `Timeline notes:\n${readText(input.timelineNotes)}`,
      `Glossary terms:\n${readText(input.glossaryTerms)}`,
      `GraphRAG nodes/edges tu Universe:\n${graphContext.join('\n')}`,
    ].join('\n\n'),
    normalize: normalizeContext,
    fallback: () =>
      fallbackContext({
        question: input.question,
        chapters: input.recentChapterSummaries,
        timeline: input.timelineNotes,
      }),
  });
  return {
    ...result,
    graphContext,
  };
}

export async function extractWiki(input: {
  sourceText: string;
}): Promise<TaskRunResult<WikiExtractionResult>> {
  return runTaskWithFallback({
    taskKey: 'wiki_extract',
    preferStrongModel: true,
    systemPrompt: [
      'Ban la worldbuilding extractor.',
      'Trich xuat character/location/item/timeline tu ban thao.',
      'Tra ve JSON: {"characters":[{"name":"","description":"","aliases":[]}],"locations":[...],"items":[...],"timeline":[{"title":"","when":"","detail":""}]}',
      'Khong du doan vuot qua noi dung da cho.',
    ].join('\n'),
    userPrompt: `Source manuscript:\n${readText(input.sourceText)}`,
    normalize: normalizeWikiExtraction,
    fallback: () =>
      fallbackWikiExtraction({
        source: input.sourceText,
      }),
  });
}
