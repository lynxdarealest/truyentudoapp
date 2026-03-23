export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'mock';

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
}

export interface TranslateResponse {
  provider: AiProvider;
  alternatives: string[];
}

interface StoredApiKey {
  id: string;
  key: string;
  isActive?: boolean;
}

interface RuntimeApiConfig {
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
  providerOrder?: AiProvider[];
}

function pickActiveStoredKey(): string | undefined {
  try {
    const raw = localStorage.getItem('api_keys');
    if (!raw) return undefined;
    const list = JSON.parse(raw) as StoredApiKey[];
    const active = list.find((k) => k.isActive) || list[0];
    return active?.key;
  } catch {
    return undefined;
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

function normalizeProviderOrder(order?: AiProvider[]): AiProvider[] {
  const supported: AiProvider[] = ['openai', 'anthropic', 'gemini'];
  const unique = (order || []).filter((p): p is AiProvider => supported.includes(p as AiProvider));
  const seen = new Set<AiProvider>();
  const result: AiProvider[] = [];

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

function buildPrompt(input: TranslateRequest): string {
  const mustUse = input.glossary
    .filter((t) => t.source.trim() && t.target.trim())
    .map((t) => `- "${t.source}" => "${t.target}"`)
    .join('\n');

  return [
    'You are a professional literary translator.',
    `Translate from ${input.sourceLang} to ${input.targetLang}.`,
    input.tone ? `Tone preference: ${input.tone}.` : '',
    'Rules:',
    '1) Return exactly 3 alternatives with natural Vietnamese wording.',
    '2) If a source term appears, target output MUST use mapped term exactly.',
    '3) Keep character voice consistent and fluent.',
    '4) Output only JSON: {"alternatives":["...","...","..."]}.',
    mustUse ? `Glossary mappings:\n${mustUse}` : 'No glossary mappings provided.',
    'Source text:',
    input.sourceText,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function translateWithOpenAI(input: TranslateRequest, key: string): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: buildPrompt(input),
        },
      ],
      response_format: {
        type: 'json_object',
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonFromText(text);
  return (parsed.alternatives || []).slice(0, 3);
}

async function translateWithAnthropic(input: TranslateRequest, key: string): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1000,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: buildPrompt(input),
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  return (parsed.alternatives || []).slice(0, 3);
}

async function translateWithGemini(input: TranslateRequest, key: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(input) }],
          },
        ],
        generationConfig: {
          temperature: 0.5,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  return (parsed.alternatives || []).slice(0, 3);
}

function makeMockAlternatives(input: TranslateRequest): string[] {
  const base = input.sourceText.trim();
  if (!base) return [];

  const appended = input.glossary
    .filter((t) => t.source && t.target && base.includes(t.source))
    .map((t) => `${t.source} -> ${t.target}`)
    .join(', ');

  return [
    `Ban dich thu nghiem (smooth): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
    `Ban dich thu nghiem (faithful): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
    `Ban dich thu nghiem (creative): ${base}${appended ? `\n\n[Glossary]: ${appended}` : ''}`,
  ];
}

export async function translateSegment(input: TranslateRequest): Promise<TranslateResponse> {
  const runtime = loadRuntimeApiConfig();
  const localKey = pickActiveStoredKey();
  const metaEnv: Record<string, string | undefined> =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const geminiKey = runtime.geminiKey || metaEnv['VITE_GEMINI_API_KEY'] || localKey;
  const openaiKey = runtime.openaiKey || metaEnv['VITE_OPENAI_API_KEY'];
  const anthropicKey = runtime.anthropicKey || metaEnv['VITE_ANTHROPIC_API_KEY'];

  const providerOrder = normalizeProviderOrder(runtime.providerOrder);

  const providerMap: Record<'openai' | 'anthropic' | 'gemini', { name: AiProvider; run: () => Promise<string[]>; enabled: boolean }> = {
    openai: {
      name: 'openai',
      enabled: Boolean(openaiKey),
      run: () => translateWithOpenAI(input, openaiKey as string),
    },
    anthropic: {
      name: 'anthropic',
      enabled: Boolean(anthropicKey),
      run: () => translateWithAnthropic(input, anthropicKey as string),
    },
    gemini: {
      name: 'gemini',
      enabled: Boolean(geminiKey),
      run: () => translateWithGemini(input, geminiKey as string),
    },
  };

  const providers = providerOrder.map((name) => providerMap[name as 'openai' | 'anthropic' | 'gemini']);

  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      const alternatives = await provider.run();
      if (alternatives.length >= 1) {
        return {
          provider: provider.name,
          alternatives: alternatives.slice(0, 3),
        };
      }
    } catch {
      // Try next provider in the chain.
    }
  }

  return {
    provider: 'mock',
    alternatives: makeMockAlternatives(input),
  };
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
