export type ApiProvider =
  | 'gemini'
  | 'gcli'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'groq'
  | 'deepseek'
  | 'openrouter'
  | 'mistral'
  | 'custom'
  | 'unknown';
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

export interface ApiProviderMeta {
  title: string;
  strengths: string;
  tradeoffs: string;
  docsUrl: string;
  keyUrl: string;
}

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  gemini: 'Gemini (API key)',
  gcli: 'Gemini (đăng nhập Google)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  mistral: 'Mistral AI',
  custom: 'Máy chủ AI riêng',
  unknown: 'Không rõ',
};

export const API_PROVIDER_META: Record<Exclude<ApiProvider, 'unknown'>, ApiProviderMeta> = {
  gemini: {
    title: 'Google Gemini API',
    strengths: 'Nhanh, ổn định, hợp viết thường ngày và xử lý ngữ cảnh dài với chi phí khá mềm.',
    tradeoffs: 'Các model preview có thể đổi hành vi theo thời gian và đôi lúc quota/free tier khó đoán hơn.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  gcli: {
    title: 'Google AI Studio / mã đăng nhập',
    strengths: 'Tiện cho người đang dùng Google AI Studio và muốn thử nhanh mà chưa tạo key riêng.',
    tradeoffs: 'Ít ổn định hơn API key chính thức; mã truy cập có thể hết hạn và không phù hợp workflow lâu dài.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  openai: {
    title: 'OpenAI',
    strengths: 'Tài liệu rõ, hệ sinh thái mạnh, chất lượng đều và phù hợp nhiều bài toán sáng tác/lập kế hoạch.',
    tradeoffs: 'Chi phí thường không phải lựa chọn rẻ nhất nếu chạy volume lớn liên tục.',
    docsUrl: 'https://platform.openai.com/docs/overview',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    title: 'Anthropic',
    strengths: 'Mạnh về viết dài, phân tích tài liệu, giữ giọng văn ổn và lập luận khá sạch.',
    tradeoffs: 'Thường chậm hơn nhóm model tối ưu tốc độ và giá cũng không phải lựa chọn nhẹ nhất.',
    docsUrl: 'https://docs.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  xai: {
    title: 'xAI / Grok',
    strengths: 'Mạnh về phản hồi trực diện, độ bám prompt cao và context rất lớn ở các model mới.',
    tradeoffs: 'Một số model reasoning có tham số khác OpenAI truyền thống, nên cần để ý tương thích prompt.',
    docsUrl: 'https://docs.x.ai/overview',
    keyUrl: 'https://console.x.ai',
  },
  groq: {
    title: 'Groq',
    strengths: 'Rất nhanh, hợp tác vụ cần tốc độ phản hồi cao và request volume lớn.',
    tradeoffs: 'Danh mục model phụ thuộc model partner đang được Groq host, không phải lúc nào cũng là model frontier mạnh nhất.',
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/keys',
  },
  deepseek: {
    title: 'DeepSeek',
    strengths: 'Rất đáng tiền cho coding, reasoning và workload nhiều token.',
    tradeoffs: 'Danh mục model gọn hơn, chủ yếu xoay quanh chat/reasoner thay vì quá nhiều lựa chọn families.',
    docsUrl: 'https://api-docs.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  openrouter: {
    title: 'OpenRouter',
    strengths: 'Một khóa truy cập rất nhiều model/provider, hợp khi muốn fallback hoặc thử nhiều model nhanh.',
    tradeoffs: 'Độ ổn định và hành vi còn phụ thuộc provider đứng sau model bạn chọn.',
    docsUrl: 'https://openrouter.ai/docs/quick-start',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  mistral: {
    title: 'Mistral AI',
    strengths: 'Nhiều model tốt cho coding, multilingual và một số model open-weight rất thực dụng.',
    tradeoffs: 'Danh mục model thay đổi khá nhanh theo vòng đời release, nên cần theo dõi model cũ/mới kỹ hơn.',
    docsUrl: 'https://docs.mistral.ai/getting-started/introduction',
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  custom: {
    title: 'Máy chủ AI riêng',
    strengths: 'Linh hoạt nhất, hợp khi bạn có gateway nội bộ hoặc muốn nối provider riêng.',
    tradeoffs: 'Bạn tự chịu trách nhiệm tương thích endpoint, auth và model naming.',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat/create',
    keyUrl: '',
  },
};

export const PROVIDER_MODEL_OPTIONS: Record<Exclude<ApiProvider, 'unknown'>, ApiModelOption[]> = {
  gemini: [
    // Gemini v1.5 deprecated trên API v1beta, giữ họ 2.x trở lên để tránh lỗi 404
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', description: 'Rất tiết kiệm, hợp dịch nhanh hoặc xử lý khối lượng lớn với chi phí thấp hơn.' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Nhanh, tiết kiệm, hợp viết gợi ý và thao tác thường xuyên.' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Nhanh nhất và tiết kiệm nhất trong họ 2.5, hợp file dài khi ưu tiên giảm chi phí hơn độ mượt.' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Cân bằng giữa tốc độ và chất lượng.' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: 'Ưu tiên chất lượng cho viết dài và xử lý phức tạp.' },
  ],
  gcli: [
    // Loại bỏ model 1.5 vì v1beta không còn hỗ trợ generateContent
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', description: 'Tiết kiệm hơn, hợp batch lớn khi bạn muốn giảm chi phí tối đa.' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Dùng mã truy cập Google `ya29...` để gọi Gemini nhanh.' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Nhanh và budget-friendly trong họ 2.5 khi dùng đăng nhập Google.' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Cân bằng giữa tốc độ và chất lượng khi dùng đăng nhập Google.' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: 'Ưu tiên chất lượng khi dùng mã truy cập Google.' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Model cũ hơn một chút nhưng vẫn rất hợp việc thường ngày và tiết kiệm.' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Nhanh, gọn, hợp thao tác hàng ngày.' },
    { value: 'gpt-4.1', label: 'GPT-4.1', description: 'Cân bằng tốt cho tác vụ sáng tác và biên tập.' },
    { value: 'gpt-4o', label: 'GPT-4o', description: 'Phản hồi linh hoạt, phù hợp nhiều loại prompt.' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: 'Model cũ nhưng vẫn hợp các dự án cần hành vi quen thuộc của GPT-4.' },
  ],
  anthropic: [
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', description: 'Đời cũ hơn, hợp task nhanh và chi phí thấp.' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Nhanh, chi phí thấp, hợp tóm tắt và xử lý nhanh.' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet', description: 'Model cũ nhưng vẫn ổn cho viết và phân tích tổng quát.' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'Cân bằng giữa độ ổn định và chất lượng.' },
    { value: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', description: 'Mạnh hơn cho văn dài và lập kế hoạch nội dung.' },
  ],
  xai: [
    { value: 'grok-3-mini', label: 'Grok 3 Mini', description: 'Nhẹ và nhanh hơn, hợp thao tác thường nhật.' },
    { value: 'grok-3', label: 'Grok 3', description: 'Mạnh về tóm tắt, coding và trả lời trực diện.' },
    { value: 'grok-4', label: 'Grok 4', description: 'Model mới mạnh hơn cho tác vụ khó và ngữ cảnh lớn.' },
    { value: 'grok-4.20-beta-latest-non-reasoning', label: 'Grok 4.20 Beta Non-Reasoning', description: 'Bản mới theo docs xAI, hợp khi muốn hành vi nhanh, bám prompt mà không bật reasoning mode.' },
  ],
  groq: [
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', description: 'Cực nhanh, hợp UI phản hồi thời gian thực.' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', description: 'Cân bằng giữa tốc độ Groq và chất lượng văn bản.' },
    { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', description: 'Open-weight, mạnh hơn cho reasoning và output có cấu trúc.' },
    { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', description: 'Mẫu lớn hơn, hợp nghiên cứu và workflow agentic nặng.' },
    { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', description: 'Model mới trên Groq, rất nhanh và hợp tác vụ tổng quát.' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat', description: 'DeepSeek-V3.2 không-thinking mode, hợp chi phí tốt và coding hằng ngày.' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', description: 'Thinking mode mạnh hơn cho bài toán nhiều bước.' },
  ],
  openrouter: [
    { value: 'openrouter/auto', label: 'OpenRouter Auto', description: 'Để OpenRouter tự chọn model tốt trong tập chất lượng cao.' },
    { value: 'openai/gpt-4o', label: 'OpenAI GPT-4o qua OpenRouter', description: 'Hành vi quen thuộc của GPT-4o nhưng đi qua router/fallback.' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet qua OpenRouter', description: 'Phù hợp viết dài, lập kế hoạch và biên tập.' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash qua OpenRouter', description: 'Nhanh, cân bằng, tiện khi bạn muốn một khóa dùng nhiều hệ.' },
    { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 qua OpenRouter', description: 'Giá/hiệu năng tốt, hợp coding và task dài.' },
  ],
  mistral: [
    { value: 'mistral-small-2503', label: 'Mistral Small 3.1', description: 'Model cũ hơn nhưng vẫn rất thực dụng cho viết nhanh và tiết kiệm.' },
    { value: 'mistral-small-3.2', label: 'Mistral Small 3.2', description: 'Nhỏ nhưng mới hơn, hợp tác vụ tổng quát và multilingual.' },
    { value: 'mistral-large-2407', label: 'Mistral Large 2.0', description: 'Model cũ mạnh hơn cho tác vụ phức tạp cần hành vi ổn định.' },
    { value: 'mistral-large-latest', label: 'Mistral Large Latest', description: 'Ưu tiên chất lượng và suy luận tốt hơn trong hệ Mistral.' },
    { value: 'open-mixtral-8x22b', label: 'Mixtral 8x22B', description: 'Mẫu cũ nhưng vẫn đáng giá cho ai thích open-weight lớn.' },
  ],
  custom: [
    { value: 'custom-model', label: 'Model tự nhập', description: 'Tự nhập model khi dùng máy chủ AI riêng hoặc gateway tương thích OpenAI.' },
  ],
};

export function detectApiProviderFromValue(input: string): ApiProvider {
  const value = String(input || '').trim();
  if (!value) return 'unknown';
  if (/^AIza[0-9A-Za-z\-_]{20,}$/.test(value)) return 'gemini';
  if (/^(Bearer\s+)?ya29\.[0-9A-Za-z\-_\.]+$/i.test(value)) return 'gcli';
  if (/^gsk_[A-Za-z0-9_\-]{20,}$/i.test(value)) return 'groq';
  if (/^sk-or-v1-[A-Za-z0-9_\-]+$/i.test(value)) return 'openrouter';
  if (/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(value)) return 'anthropic';
  if (/^sk-(proj-)?[A-Za-z0-9_\-]{20,}$/.test(value)) return 'openai';
  return 'unknown';
}

export function getProviderBaseUrl(provider: ApiProvider): string {
  if (provider === 'gcli') return 'https://generativelanguage.googleapis.com/v1beta';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'xai') return 'https://api.x.ai/v1';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (provider === 'deepseek') return 'https://api.deepseek.com/v1';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'mistral') return 'https://api.mistral.ai/v1';
  if (provider === 'custom') return 'https://api.openai.com/v1/chat/completions';
  return '';
}

export function getDefaultModelForProvider(provider: ApiProvider, profile: AiProfileMode = 'balanced'): string {
  if (provider === 'gemini') {
    if (profile === 'economy') return 'gemini-2.5-flash-lite';
    if (profile === 'quality') return 'gemini-3.1-pro-preview';
    return 'gemini-2.5-flash';
  }
  if (provider === 'gcli') {
    if (profile === 'economy') return 'gemini-2.5-flash-lite';
    if (profile === 'quality') return 'gemini-3.1-pro-preview';
    return 'gemini-2.5-flash';
  }
  if (provider === 'openai') {
    if (profile === 'economy') return 'gpt-4o-mini';
    if (profile === 'quality') return 'gpt-4.1';
    return 'gpt-4o';
  }
  if (provider === 'xai') {
    if (profile === 'economy') return 'grok-3-mini';
    if (profile === 'quality') return 'grok-4';
    return 'grok-3';
  }
  if (provider === 'groq') {
    if (profile === 'economy') return 'llama-3.1-8b-instant';
    if (profile === 'quality') return 'openai/gpt-oss-120b';
    return 'llama-3.3-70b-versatile';
  }
  if (provider === 'deepseek') {
    if (profile === 'economy') return 'deepseek-chat';
    if (profile === 'quality') return 'deepseek-reasoner';
    return 'deepseek-chat';
  }
  if (provider === 'openrouter') {
    if (profile === 'economy') return 'google/gemini-2.5-flash';
    if (profile === 'quality') return 'anthropic/claude-3.5-sonnet';
    return 'openrouter/auto';
  }
  if (provider === 'mistral') {
    if (profile === 'economy') return 'mistral-small-2503';
    if (profile === 'quality') return 'mistral-large-latest';
    return 'mistral-small-3.2';
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
