export type ApiProvider = 'gemini' | 'gcli' | 'openai' | 'anthropic' | 'custom' | 'unknown';
export type AiProfileMode = 'economy' | 'balanced' | 'quality';

export interface StoredApiKeyRecord {
  id: string;
  name: string;
  key: string;
  provider: ApiProvider;
  model: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: string;
  lastTested?: string;
  status?: 'valid' | 'invalid' | 'testing' | 'idle';
  usage?: {
    requests: number;
    tokens: number;
    limit: number;
  };
}

export interface ApiModelOption {
  value: string;
  label: string;
  description: string;
}

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  gemini: 'Gemini trực tiếp',
  gcli: 'Gemini trực tiếp (GCLI token)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  custom: 'Endpoint riêng (không phải Relay)',
  unknown: 'Không rõ',
};

export const PROVIDER_MODEL_OPTIONS: Record<Exclude<ApiProvider, 'unknown'>, ApiModelOption[]> = {
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Nhanh, tiết kiệm, hợp viết gợi ý và thao tác thường xuyên.' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Cân bằng giữa tốc độ và chất lượng.' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Ưu tiên chất lượng cho viết dài và xử lý phức tạp.' },
  ],
  gcli: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Dùng access token từ GCLI/gcloud để gọi model Gemini nhanh.' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Cân bằng giữa tốc độ và chất lượng cho token GCLI.' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Ưu tiên chất lượng khi dùng bearer token từ GCLI.' },
  ],
  openai: [
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Nhanh, gọn, hợp thao tác hàng ngày.' },
    { value: 'gpt-4.1', label: 'GPT-4.1', description: 'Cân bằng tốt cho tác vụ sáng tác và biên tập.' },
    { value: 'gpt-4o', label: 'GPT-4o', description: 'Phản hồi linh hoạt, phù hợp nhiều loại prompt.' },
  ],
  anthropic: [
    { value: 'claude-3-5-haiku-latest', label: 'Claude Haiku', description: 'Nhanh, chi phí thấp, hợp tóm tắt và xử lý nhanh.' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude Sonnet', description: 'Cân bằng giữa độ ổn định và chất lượng.' },
    { value: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', description: 'Mạnh hơn cho văn dài và lập kế hoạch nội dung.' },
  ],
  custom: [
    { value: 'custom-model', label: 'Custom model', description: 'Tự nhập model khi dùng endpoint tương thích OpenAI hoặc gateway riêng.' },
  ],
};

export function detectApiProviderFromValue(input: string): ApiProvider {
  const value = String(input || '').trim();
  if (!value) return 'unknown';
  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(value)) return 'gemini';
  if (/^(Bearer\s+)?ya29\.[0-9A-Za-z\-_\.]+$/i.test(value)) return 'gcli';
  if (/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'anthropic';
  if (/^sk-(proj-)?[A-Za-z0-9_\-]{20,}$/.test(value)) return 'openai';
  return 'unknown';
}

export function getProviderBaseUrl(provider: ApiProvider): string {
  if (provider === 'gcli') return 'https://generativelanguage.googleapis.com/v1beta';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'custom') return 'https://api.openai.com/v1/chat/completions';
  return '';
}

export function getDefaultModelForProvider(provider: ApiProvider, profile: AiProfileMode = 'balanced'): string {
  if (provider === 'gemini') {
    if (profile === 'economy') return 'gemini-2.0-flash';
    if (profile === 'quality') return 'gemini-3.1-pro-preview';
    return 'gemini-2.5-flash';
  }
  if (provider === 'gcli') {
    if (profile === 'economy') return 'gemini-2.0-flash';
    if (profile === 'quality') return 'gemini-3.1-pro-preview';
    return 'gemini-2.5-flash';
  }
  if (provider === 'openai') {
    if (profile === 'economy') return 'gpt-4.1-mini';
    if (profile === 'quality') return 'gpt-4.1';
    return 'gpt-4o';
  }
  if (provider === 'anthropic') {
    if (profile === 'economy') return 'claude-3-5-haiku-latest';
    if (profile === 'quality') return 'claude-3-7-sonnet-latest';
    return 'claude-3-5-sonnet-latest';
  }
  if (provider === 'custom') {
    return 'custom-model';
  }
  return '';
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function inferDefaultName(provider: ApiProvider, index: number): string {
  const label = PROVIDER_LABELS[provider] || 'API';
  return `${label} ${index + 1}`;
}

export function normalizeStoredApiKeys(input: unknown, profile: AiProfileMode = 'balanced'): StoredApiKeyRecord[] {
  if (!Array.isArray(input)) return [];
  const normalized: Array<StoredApiKeyRecord | null> = input
    .map((row, index) => {
      const item = row as Partial<StoredApiKeyRecord> & { usage?: Partial<StoredApiKeyRecord['usage']> };
      const key = readText(item.key);
      const explicitProvider = item.provider && item.provider !== 'unknown'
        ? item.provider
        : detectApiProviderFromValue(key);
      const provider = explicitProvider || 'unknown';
      const baseUrl = readText(item.baseUrl) || getProviderBaseUrl(provider);
      if (!key && !(provider === 'custom' && baseUrl)) return null;
      const createdAt = readText(item.createdAt) || new Date().toISOString();
      return {
        id: readText(item.id) || `api-${createdAt}-${index}`,
        name: readText(item.name) || inferDefaultName(provider, index),
        key,
        provider,
        model: readText(item.model) || getDefaultModelForProvider(provider, profile),
        baseUrl,
        isActive: item.isActive === true,
        createdAt,
        lastTested: readText(item.lastTested) || undefined,
        status: item.status || 'idle',
        usage: {
          requests: Number(item.usage?.requests || 0),
          tokens: Number(item.usage?.tokens || 0),
          limit: Number(item.usage?.limit || 1500),
        },
      } satisfies StoredApiKeyRecord;
    });

  return normalized
    .filter((item): item is StoredApiKeyRecord => item !== null)
    .map((item, index, all) => {
      if (all.some((row) => row.isActive)) return item;
      return index === 0 ? { ...item, isActive: true } : item;
    });
}

export function activateApiKeyRecord(
  list: StoredApiKeyRecord[],
  id: string,
  patch?: Partial<StoredApiKeyRecord>,
): StoredApiKeyRecord[] {
  return list.map((item) => ({
    ...item,
    ...(item.id === id ? patch : null),
    isActive: item.id === id,
  }));
}

export function getActiveApiKeyRecord(list: StoredApiKeyRecord[]): StoredApiKeyRecord | null {
  return list.find((item) => item.isActive) || list[0] || null;
}
