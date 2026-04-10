import { create } from 'zustand';
import type { AiProfileMode, ApiModelOption, ApiProvider, StoredApiKeyRecord } from '../../apiVault';
import { PROVIDER_MODEL_OPTIONS } from '../../apiVault';
import type { GenerationConfig } from '../../generationConfig';
import { DEFAULT_GENERATION_CONFIG } from '../../generationConfig';
import type { ImageAiProvider } from '../../imageAiProviders';

const RELAY_AUTH_BASE = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_RELAY_AUTH_BASE || '').trim();
const CODE_REGEX = /\b(\d{4,8})\b/;

export const OPENROUTER_CUSTOM_MODEL_OPTION = '__openrouter_custom_model__';
export const GENERATION_HINTS: Record<string, string> = {
  temperature: 'Điều chỉnh độ sáng tạo của câu trả lời. Cao thì bay bổng hơn, thấp thì chặt chẽ hơn.',
  topP: 'Giới hạn phạm vi từ vựng được cân nhắc ở mỗi bước. Mốc 0.9-1.0 thường cân bằng.',
  topK: 'Giới hạn số từ tiếp theo mà model được phép cân nhắc. Giá trị thấp cho văn ngắn gọn hơn.',
  maxOutputTokens: 'Số token tối đa model được trả về cho một lần gọi. Tăng quá cao sẽ chậm và tốn chi phí.',
  contextWindowTokens: 'Ngân sách context gửi lên model (prompt + dữ liệu truyện). Nhỏ hơn sẽ tiết kiệm token.',
  seed: 'Đặt số cố định để kết quả lặp lại gần giống nhau. Để -1 nếu muốn ngẫu nhiên mỗi lần.',
  reasoningLevel: 'Mức suy luận nội bộ. High cho chất lượng tốt hơn nhưng thường chậm hơn.',
  enableGeminiWebSearch: 'Cho phép Gemini tra web khi cần dữ liệu thực tế/historical. Chỉ áp dụng nhánh Gemini direct.',
  showThinking: 'Khi model hỗ trợ, sẽ ưu tiên lộ trình suy luận ngắn trước câu trả lời chính.',
  inlineImages: 'Yêu cầu model trả kèm ảnh minh hoạ nếu nhà cung cấp hỗ trợ inline image.',
  enableStreaming: 'Bật để nhận phản hồi dạng streaming từng phần. Tắt để nhận một cục hoàn chỉnh.',
  autoCritique: 'Sau khi sinh bản đầu, hệ thống có thể tự kiểm tra và viết lại nếu chất lượng chưa đạt.',
  multiDraft: 'Tăng số lượt thử để chọn bản tốt hơn cho đoạn khó; đổi lại tốn thêm thời gian.',
  rateLimitDelay: 'Chèn khoảng chờ giữa các call khi dùng proxy/custom endpoint để giảm lỗi 429.',
  fullThinkingPrompt: 'Thêm khung thinking 12 bước cho tác vụ dài/chất lượng cao; token tăng đáng kể.',
};

export type GenerationNumericField =
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'maxOutputTokens'
  | 'contextWindowTokens'
  | 'seed';

export interface ApiPanelExternalState {
  apiMode: 'manual' | 'relay';
  currentProviderLabel: string;
  currentModelLabel: string;
  vaultCount: number;
  currentStatusLabel: string;
  apiEntryName: string;
  apiEntryText: string;
  displayedDraftProvider: ApiProvider;
  effectiveDraftProvider: ApiProvider;
  availableDraftModels: ApiModelOption[];
  apiEntryModel: string;
  apiEntryBaseUrl: string;
  aiProfile: AiProfileMode;
  apiVault: StoredApiKeyRecord[];
  currentApiEntry?: StoredApiKeyRecord;
  testingApiId?: string | null;
  relayStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  relayStatusText: string;
  relayUrl: string;
  relayMatchedLong: string;
  relayMaskedToken: string;
  relayModel: string;
  relayModelOptions: ApiModelOption[];
  relayWebBase: string;
  relaySocketBase: string;
  manualRelayTokenInput: string;
  isCheckingAi?: boolean;
  aiCheckStatus?: string;
  aiUsageRequests?: number;
  aiUsageTokens?: number;
  quickImportText?: string;
  quickImportResult?: string;
  generationConfig: GenerationConfig;
  imageAiEnabled: boolean;
  imageAiApiKey: string;
  imageAiStatusLabel: string;
  imageAiProvider: ImageAiProvider;
  imageAiModel: string;
  onSwitchToDirect: () => void;
  onSwitchToRelay: () => void;
  onApiEntryNameChange: (value: string) => void;
  onApiEntryTextChange: (value: string) => void;
  onApiEntryProviderChange: (value: ApiProvider) => void;
  onApiEntryModelChange: (value: string) => void;
  onApiEntryBaseUrlChange: (value: string) => void;
  onImageAiEnabledChange: (value: boolean) => void;
  onImageAiApiKeyChange: (value: string) => void;
  onImageAiProviderChange: (value: ImageAiProvider) => void;
  onImageAiModelChange: (value: string) => void;
  onSaveImageAiConfig: () => void;
  onSaveApiEntry: () => void;
  onTestApiEntry: (id: string) => void;
  onActivateApiEntry: (id: string) => void;
  onDeleteApiEntry: (id: string) => void;
  onStoredApiModelChange: (id: string, value: string) => void;
  onStoredApiBaseUrlChange: (id: string, value: string) => void;
  onConnectRelay: (relayCode?: string) => void;
  onDisconnectRelay: () => void;
  onRelayUrlChange: (value: string) => void;
  onRelayModelChange: (value: string) => void;
  onManualRelayTokenInputChange: (value: string) => void;
  onSaveManualRelayToken: () => void;
  onCheckAiHealth?: () => void;
  onResetAiUsage?: () => void;
  onQuickImportTextChange?: (value: string) => void;
  onQuickImportKeys?: () => void;
  onAiProfileChange?: (value: AiProfileMode) => void;
  onGenerationConfigPatch: (patch: Partial<GenerationConfig>) => void;
  onGenerationConfigReset: () => void;
}

interface ApiPanelHandlers {
  onSwitchToDirect: () => void;
  onSwitchToRelay: () => void;
  onApiEntryNameChange: (value: string) => void;
  onApiEntryTextChange: (value: string) => void;
  onApiEntryProviderChange: (value: ApiProvider) => void;
  onApiEntryModelChange: (value: string) => void;
  onApiEntryBaseUrlChange: (value: string) => void;
  onImageAiEnabledChange: (value: boolean) => void;
  onImageAiApiKeyChange: (value: string) => void;
  onImageAiProviderChange: (value: ImageAiProvider) => void;
  onImageAiModelChange: (value: string) => void;
  onSaveImageAiConfig: () => void;
  onSaveApiEntry: () => void;
  onTestApiEntry: (id: string) => void;
  onActivateApiEntry: (id: string) => void;
  onDeleteApiEntry: (id: string) => void;
  onStoredApiModelChange: (id: string, value: string) => void;
  onStoredApiBaseUrlChange: (id: string, value: string) => void;
  onConnectRelay: (relayCode?: string) => void;
  onDisconnectRelay: () => void;
  onRelayUrlChange: (value: string) => void;
  onRelayModelChange: (value: string) => void;
  onManualRelayTokenInputChange: (value: string) => void;
  onSaveManualRelayToken: () => void;
  onCheckAiHealth?: () => void;
  onResetAiUsage?: () => void;
  onQuickImportTextChange?: (value: string) => void;
  onQuickImportKeys?: () => void;
  onAiProfileChange?: (value: AiProfileMode) => void;
  onGenerationConfigPatch: (patch: Partial<GenerationConfig>) => void;
  onGenerationConfigReset: () => void;
}

interface TextAiSlice {
  apiMode: 'manual' | 'relay';
  currentProviderLabel: string;
  currentModelLabel: string;
  vaultCount: number;
  currentStatusLabel: string;
  apiEntryName: string;
  apiEntryText: string;
  displayedDraftProvider: ApiProvider;
  effectiveDraftProvider: ApiProvider;
  availableDraftModels: ApiModelOption[];
  apiEntryModel: string;
  apiEntryBaseUrl: string;
  aiProfile: AiProfileMode;
  apiVault: StoredApiKeyRecord[];
  currentApiEntry?: StoredApiKeyRecord;
  testingApiId?: string | null;
  draftOpenRouterCustomModel: boolean;
  storedOpenRouterCustomModels: Record<string, boolean>;
}

interface GenerationConfigSlice {
  generationConfig: GenerationConfig;
  openGenerationHint: string | null;
  generationNumberDraft: Record<GenerationNumericField, string>;
}

interface ImageAiSlice {
  imageAiEnabled: boolean;
  imageAiApiKey: string;
  imageAiStatusLabel: string;
  imageAiProvider: ImageAiProvider;
  imageAiModel: string;
}

interface RelayNodeSlice {
  relayStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  relayStatusText: string;
  relayUrl: string;
  relayMatchedLong: string;
  relayMaskedToken: string;
  relayModel: string;
  relayModelOptions: ApiModelOption[];
  relayWebBase: string;
  relaySocketBase: string;
  manualRelayTokenInput: string;
  relayCode: string;
  relayConnectUrl: string;
  relayPublishUrl: string;
  authLink: string;
  lastSyncedRelayUrlCode: string;
}

interface MetaSlice {
  isCheckingAi?: boolean;
  aiCheckStatus?: string;
  aiUsageRequests?: number;
  aiUsageTokens?: number;
  quickImportText?: string;
  quickImportResult?: string;
}

interface ApiStoreActions {
  hydrateFromExternal: (payload: ApiPanelExternalState) => void;
  setApiEntryName: (value: string) => void;
  setApiEntryText: (value: string) => void;
  setApiEntryProvider: (value: ApiProvider) => void;
  setApiEntryModel: (value: string) => void;
  setApiEntryBaseUrl: (value: string) => void;
  setDraftOpenRouterCustomModel: (value: boolean) => void;
  setStoredOpenRouterCustomModel: (id: string, value: boolean) => void;
  saveApiEntry: () => void;
  testApiEntry: (id: string) => void;
  activateApiEntry: (id: string) => void;
  deleteApiEntry: (id: string) => void;
  setStoredApiModel: (id: string, value: string) => void;
  setStoredApiBaseUrl: (id: string, value: string) => void;
  setGenerationHint: (value: string | null) => void;
  setGenerationDraftField: (field: GenerationNumericField, value: string) => void;
  commitGenerationDraftField: (field: GenerationNumericField) => void;
  patchGenerationConfig: (patch: Partial<GenerationConfig>) => void;
  resetGenerationConfig: () => void;
  setImageAiEnabled: (value: boolean) => void;
  setImageAiApiKey: (value: string) => void;
  setImageAiProvider: (value: ImageAiProvider) => void;
  setImageAiModel: (value: string) => void;
  saveImageAiConfig: () => void;
  setRelayCode: (value: string) => void;
  setRelayUrl: (value: string) => void;
  setRelayModel: (value: string) => void;
  setManualRelayTokenInput: (value: string) => void;
  saveManualRelayToken: () => void;
  connectRelay: (relayCode?: string) => void;
  disconnectRelay: () => void;
  switchToDirect: () => void;
  switchToRelay: () => void;
  startRelayListening: () => void;
  openBridge: () => void;
}

interface ApiStoreState {
  textAi: TextAiSlice;
  generation: GenerationConfigSlice;
  imageAi: ImageAiSlice;
  relayNode: RelayNodeSlice;
  meta: MetaSlice;
  handlers: Partial<ApiPanelHandlers>;
  actions: ApiStoreActions;
}

function buildGenerationNumberDraft(config: GenerationConfig): Record<GenerationNumericField, string> {
  return {
    temperature: String(config.temperature),
    topP: String(config.topP),
    topK: String(config.topK),
    maxOutputTokens: String(config.maxOutputTokens),
    contextWindowTokens: String(config.contextWindowTokens),
    seed: String(config.seed),
  };
}

function parseLocaleNumber(raw: string): number {
  return Number(String(raw || '').trim().replace(',', '.'));
}

function toWsUrl(url: string): string {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('wss://') || u.startsWith('ws://')) return u;
  if (u.startsWith('https://')) return `wss://${u.slice('https://'.length)}`;
  if (u.startsWith('http://')) return `ws://${u.slice('http://'.length)}`;
  return `wss://${u.replace(/^\/+/, '')}`;
}

function buildRelaySocketUrl(base: string, code: string): string {
  const cleanBase = toWsUrl(base).trim();
  const cleanCode = String(code || '').trim();
  if (!cleanBase || !cleanCode) return cleanBase;

  try {
    const url = new URL(cleanBase);
    if (/[?&]code=/i.test(cleanBase)) {
      url.searchParams.set('code', cleanCode);
      return url.toString();
    }
    url.searchParams.delete('code');
    url.pathname = `${url.pathname.replace(/\/\d{4,8}\/?$/i, '').replace(/\/+$/, '')}/${cleanCode}`;
    return url.toString();
  } catch {
    return `${cleanBase.replace(/\/+$/, '')}/${cleanCode}`;
  }
}

function buildRelayPublishUrl(base: string, code: string): string {
  const cleanBase = String(base || '').trim().replace(/\/+$/, '');
  const cleanCode = String(code || '').trim();
  if (!cleanBase || !cleanCode) return '';
  return `${cleanBase}/publish-token/${cleanCode}`;
}

function buildAuthLink(relayCode: string, relayConnectUrl: string, relayPublishUrl: string, relayWebBase: string): string {
  if (!relayCode || !RELAY_AUTH_BASE) return '';
  try {
    const url = new URL(RELAY_AUTH_BASE);
    url.searchParams.set('code', relayCode);
    url.searchParams.set('relay', relayConnectUrl);
    url.searchParams.set('worker', relayWebBase);
    url.searchParams.set('publish', relayPublishUrl);
    return url.toString();
  } catch {
    return '';
  }
}

function extractCodeFromRelayUrl(relayUrl: string): string {
  const match = String(relayUrl || '').match(CODE_REGEX);
  return match?.[1] || '';
}

function resolveRelayCodeFromLocation(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('code') || '';
    const fromPath = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const code = /^\d{4,8}$/.test(fromPath) ? fromPath : fromQuery;
    return /^\d{4,8}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}

function hasGenerationNumericChanged(prev: GenerationConfig, next: GenerationConfig): boolean {
  return (
    prev.temperature !== next.temperature
    || prev.topP !== next.topP
    || prev.topK !== next.topK
    || prev.maxOutputTokens !== next.maxOutputTokens
    || prev.contextWindowTokens !== next.contextWindowTokens
    || prev.seed !== next.seed
  );
}

function reconcileStoredOpenRouterCustomModels(
  previous: Record<string, boolean>,
  apiVault: StoredApiKeyRecord[],
): Record<string, boolean> {
  const listedOpenRouterModels = PROVIDER_MODEL_OPTIONS.openrouter || [];
  const next: Record<string, boolean> = { ...previous };
  apiVault.forEach((item) => {
    if (item.provider !== 'openrouter') return;
    const listed = listedOpenRouterModels.some((model) => model.value === item.model);
    if (Boolean(item.model?.trim()) && !listed) {
      next[item.id] = true;
    } else if (!(item.id in next)) {
      next[item.id] = false;
    }
  });
  Object.keys(next).forEach((id) => {
    const exists = apiVault.some((item) => item.id === id && item.provider === 'openrouter');
    if (!exists) delete next[id];
  });
  return next;
}

const initialGenerationDraft = buildGenerationNumberDraft(DEFAULT_GENERATION_CONFIG);

const initialState: Omit<ApiStoreState, 'actions'> = {
  textAi: {
    apiMode: 'manual',
    currentProviderLabel: '',
    currentModelLabel: '',
    vaultCount: 0,
    currentStatusLabel: '',
    apiEntryName: '',
    apiEntryText: '',
    displayedDraftProvider: 'gemini',
    effectiveDraftProvider: 'gemini',
    availableDraftModels: PROVIDER_MODEL_OPTIONS.gemini || [],
    apiEntryModel: '',
    apiEntryBaseUrl: '',
    aiProfile: 'balanced',
    apiVault: [],
    currentApiEntry: undefined,
    testingApiId: null,
    draftOpenRouterCustomModel: false,
    storedOpenRouterCustomModels: {},
  },
  generation: {
    generationConfig: DEFAULT_GENERATION_CONFIG,
    openGenerationHint: null,
    generationNumberDraft: initialGenerationDraft,
  },
  imageAi: {
    imageAiEnabled: false,
    imageAiApiKey: '',
    imageAiStatusLabel: '',
    imageAiProvider: 'evolink',
    imageAiModel: '',
  },
  relayNode: {
    relayStatus: 'disconnected',
    relayStatusText: 'Chưa kết nối',
    relayUrl: '',
    relayMatchedLong: '',
    relayMaskedToken: '',
    relayModel: '',
    relayModelOptions: [],
    relayWebBase: '',
    relaySocketBase: '',
    manualRelayTokenInput: '',
    relayCode: '',
    relayConnectUrl: '',
    relayPublishUrl: '',
    authLink: '',
    lastSyncedRelayUrlCode: '',
  },
  meta: {
    isCheckingAi: false,
    aiCheckStatus: '',
    aiUsageRequests: 0,
    aiUsageTokens: 0,
    quickImportText: '',
    quickImportResult: '',
  },
  handlers: {},
};

export const useApiStore = create<ApiStoreState>((set, get) => ({
  ...initialState,
  actions: {
    hydrateFromExternal: (payload) => {
      set((state) => {
        const listedOpenRouterModels = PROVIDER_MODEL_OPTIONS.openrouter || [];
        const isDraftOpenRouter = payload.effectiveDraftProvider === 'openrouter';
        const listedDraftModel = listedOpenRouterModels.some((model) => model.value === payload.apiEntryModel);
        const draftOpenRouterCustomModel = isDraftOpenRouter && Boolean(payload.apiEntryModel.trim()) && !listedDraftModel;

        const previousRelayCode = state.relayNode.relayCode;
        const fromLocation = resolveRelayCodeFromLocation();
        const relayCodeFromRelayUrl = extractCodeFromRelayUrl(payload.relayUrl);
        let relayCode = previousRelayCode || fromLocation;
        let lastSyncedRelayUrlCode = state.relayNode.lastSyncedRelayUrlCode;
        if (!relayCodeFromRelayUrl) {
          lastSyncedRelayUrlCode = '';
        } else if (relayCodeFromRelayUrl !== lastSyncedRelayUrlCode && relayCodeFromRelayUrl !== relayCode) {
          relayCode = relayCodeFromRelayUrl;
          lastSyncedRelayUrlCode = relayCodeFromRelayUrl;
        }

        const relayConnectUrl = relayCode ? buildRelaySocketUrl(payload.relaySocketBase, relayCode) : '';
        const relayPublishUrl = relayCode ? buildRelayPublishUrl(payload.relayWebBase, relayCode) : '';
        const authLink = buildAuthLink(relayCode, relayConnectUrl, relayPublishUrl, payload.relayWebBase);

        const nextGenerationDraft = hasGenerationNumericChanged(state.generation.generationConfig, payload.generationConfig)
          ? buildGenerationNumberDraft(payload.generationConfig)
          : state.generation.generationNumberDraft;

        return {
          textAi: {
            ...state.textAi,
            apiMode: payload.apiMode,
            currentProviderLabel: payload.currentProviderLabel,
            currentModelLabel: payload.currentModelLabel,
            vaultCount: payload.vaultCount,
            currentStatusLabel: payload.currentStatusLabel,
            apiEntryName: payload.apiEntryName,
            apiEntryText: payload.apiEntryText,
            displayedDraftProvider: payload.displayedDraftProvider,
            effectiveDraftProvider: payload.effectiveDraftProvider,
            availableDraftModels: payload.availableDraftModels,
            apiEntryModel: payload.apiEntryModel,
            apiEntryBaseUrl: payload.apiEntryBaseUrl,
            aiProfile: payload.aiProfile,
            apiVault: payload.apiVault,
            currentApiEntry: payload.currentApiEntry,
            testingApiId: payload.testingApiId ?? null,
            draftOpenRouterCustomModel,
            storedOpenRouterCustomModels: reconcileStoredOpenRouterCustomModels(
              state.textAi.storedOpenRouterCustomModels,
              payload.apiVault,
            ),
          },
          generation: {
            ...state.generation,
            generationConfig: payload.generationConfig,
            generationNumberDraft: nextGenerationDraft,
          },
          imageAi: {
            imageAiEnabled: payload.imageAiEnabled,
            imageAiApiKey: payload.imageAiApiKey,
            imageAiStatusLabel: payload.imageAiStatusLabel,
            imageAiProvider: payload.imageAiProvider,
            imageAiModel: payload.imageAiModel,
          },
          relayNode: {
            relayStatus: payload.relayStatus,
            relayStatusText: payload.relayStatusText,
            relayUrl: payload.relayUrl,
            relayMatchedLong: payload.relayMatchedLong,
            relayMaskedToken: payload.relayMaskedToken,
            relayModel: payload.relayModel,
            relayModelOptions: payload.relayModelOptions,
            relayWebBase: payload.relayWebBase,
            relaySocketBase: payload.relaySocketBase,
            manualRelayTokenInput: payload.manualRelayTokenInput,
            relayCode,
            relayConnectUrl,
            relayPublishUrl,
            authLink,
            lastSyncedRelayUrlCode,
          },
          meta: {
            isCheckingAi: payload.isCheckingAi,
            aiCheckStatus: payload.aiCheckStatus,
            aiUsageRequests: payload.aiUsageRequests,
            aiUsageTokens: payload.aiUsageTokens,
            quickImportText: payload.quickImportText,
            quickImportResult: payload.quickImportResult,
          },
          handlers: {
            onSwitchToDirect: payload.onSwitchToDirect,
            onSwitchToRelay: payload.onSwitchToRelay,
            onApiEntryNameChange: payload.onApiEntryNameChange,
            onApiEntryTextChange: payload.onApiEntryTextChange,
            onApiEntryProviderChange: payload.onApiEntryProviderChange,
            onApiEntryModelChange: payload.onApiEntryModelChange,
            onApiEntryBaseUrlChange: payload.onApiEntryBaseUrlChange,
            onImageAiEnabledChange: payload.onImageAiEnabledChange,
            onImageAiApiKeyChange: payload.onImageAiApiKeyChange,
            onImageAiProviderChange: payload.onImageAiProviderChange,
            onImageAiModelChange: payload.onImageAiModelChange,
            onSaveImageAiConfig: payload.onSaveImageAiConfig,
            onSaveApiEntry: payload.onSaveApiEntry,
            onTestApiEntry: payload.onTestApiEntry,
            onActivateApiEntry: payload.onActivateApiEntry,
            onDeleteApiEntry: payload.onDeleteApiEntry,
            onStoredApiModelChange: payload.onStoredApiModelChange,
            onStoredApiBaseUrlChange: payload.onStoredApiBaseUrlChange,
            onConnectRelay: payload.onConnectRelay,
            onDisconnectRelay: payload.onDisconnectRelay,
            onRelayUrlChange: payload.onRelayUrlChange,
            onRelayModelChange: payload.onRelayModelChange,
            onManualRelayTokenInputChange: payload.onManualRelayTokenInputChange,
            onSaveManualRelayToken: payload.onSaveManualRelayToken,
            onCheckAiHealth: payload.onCheckAiHealth,
            onResetAiUsage: payload.onResetAiUsage,
            onQuickImportTextChange: payload.onQuickImportTextChange,
            onQuickImportKeys: payload.onQuickImportKeys,
            onAiProfileChange: payload.onAiProfileChange,
            onGenerationConfigPatch: payload.onGenerationConfigPatch,
            onGenerationConfigReset: payload.onGenerationConfigReset,
          },
        };
      });
    },
    setApiEntryName: (value) => {
      set((state) => ({ textAi: { ...state.textAi, apiEntryName: value } }));
      get().handlers.onApiEntryNameChange?.(value);
    },
    setApiEntryText: (value) => {
      set((state) => ({ textAi: { ...state.textAi, apiEntryText: value } }));
      get().handlers.onApiEntryTextChange?.(value);
    },
    setApiEntryProvider: (value) => {
      set((state) => ({
        textAi: {
          ...state.textAi,
          displayedDraftProvider: value,
          effectiveDraftProvider: value,
          availableDraftModels: PROVIDER_MODEL_OPTIONS[value] || [],
        },
      }));
      get().handlers.onApiEntryProviderChange?.(value);
    },
    setApiEntryModel: (value) => {
      set((state) => ({ textAi: { ...state.textAi, apiEntryModel: value } }));
      get().handlers.onApiEntryModelChange?.(value);
    },
    setApiEntryBaseUrl: (value) => {
      set((state) => ({ textAi: { ...state.textAi, apiEntryBaseUrl: value } }));
      get().handlers.onApiEntryBaseUrlChange?.(value);
    },
    setDraftOpenRouterCustomModel: (value) => {
      set((state) => ({ textAi: { ...state.textAi, draftOpenRouterCustomModel: value } }));
    },
    setStoredOpenRouterCustomModel: (id, value) => {
      set((state) => ({
        textAi: {
          ...state.textAi,
          storedOpenRouterCustomModels: { ...state.textAi.storedOpenRouterCustomModels, [id]: value },
        },
      }));
    },
    saveApiEntry: () => {
      get().handlers.onSaveApiEntry?.();
    },
    testApiEntry: (id) => {
      get().handlers.onTestApiEntry?.(id);
    },
    activateApiEntry: (id) => {
      get().handlers.onActivateApiEntry?.(id);
    },
    deleteApiEntry: (id) => {
      get().handlers.onDeleteApiEntry?.(id);
    },
    setStoredApiModel: (id, value) => {
      get().handlers.onStoredApiModelChange?.(id, value);
    },
    setStoredApiBaseUrl: (id, value) => {
      get().handlers.onStoredApiBaseUrlChange?.(id, value);
    },
    setGenerationHint: (value) => {
      set((state) => ({ generation: { ...state.generation, openGenerationHint: value } }));
    },
    setGenerationDraftField: (field, value) => {
      set((state) => ({
        generation: {
          ...state.generation,
          generationNumberDraft: { ...state.generation.generationNumberDraft, [field]: value },
        },
      }));
    },
    commitGenerationDraftField: (field) => {
      const { generation } = get();
      const raw = String(generation.generationNumberDraft[field] || '').trim();
      if (!raw) {
        set((state) => ({
          generation: {
            ...state.generation,
            generationNumberDraft: buildGenerationNumberDraft(state.generation.generationConfig),
          },
        }));
        return;
      }
      const parsed = parseLocaleNumber(raw);
      if (!Number.isFinite(parsed)) {
        set((state) => ({
          generation: {
            ...state.generation,
            generationNumberDraft: buildGenerationNumberDraft(state.generation.generationConfig),
          },
        }));
        return;
      }
      get().actions.patchGenerationConfig({ [field]: parsed } as Partial<GenerationConfig>);
    },
    patchGenerationConfig: (patch) => {
      set((state) => ({
        generation: {
          ...state.generation,
          generationConfig: { ...state.generation.generationConfig, ...patch },
        },
      }));
      get().handlers.onGenerationConfigPatch?.(patch);
    },
    resetGenerationConfig: () => {
      set((state) => ({
        generation: {
          ...state.generation,
          generationConfig: DEFAULT_GENERATION_CONFIG,
          generationNumberDraft: buildGenerationNumberDraft(DEFAULT_GENERATION_CONFIG),
          openGenerationHint: null,
        },
      }));
      get().handlers.onGenerationConfigReset?.();
    },
    setImageAiEnabled: (value) => {
      set((state) => ({ imageAi: { ...state.imageAi, imageAiEnabled: value } }));
      get().handlers.onImageAiEnabledChange?.(value);
    },
    setImageAiApiKey: (value) => {
      set((state) => ({ imageAi: { ...state.imageAi, imageAiApiKey: value } }));
      get().handlers.onImageAiApiKeyChange?.(value);
    },
    setImageAiProvider: (value) => {
      set((state) => ({ imageAi: { ...state.imageAi, imageAiProvider: value } }));
      get().handlers.onImageAiProviderChange?.(value);
    },
    setImageAiModel: (value) => {
      set((state) => ({ imageAi: { ...state.imageAi, imageAiModel: value } }));
      get().handlers.onImageAiModelChange?.(value);
    },
    saveImageAiConfig: () => {
      get().handlers.onSaveImageAiConfig?.();
    },
    setRelayCode: (value) => {
      set((state) => {
        const relayCode = String(value || '').trim();
        const relayConnectUrl = relayCode ? buildRelaySocketUrl(state.relayNode.relaySocketBase, relayCode) : '';
        const relayPublishUrl = relayCode ? buildRelayPublishUrl(state.relayNode.relayWebBase, relayCode) : '';
        const authLink = buildAuthLink(relayCode, relayConnectUrl, relayPublishUrl, state.relayNode.relayWebBase);
        return {
          relayNode: {
            ...state.relayNode,
            relayCode,
            relayConnectUrl,
            relayPublishUrl,
            authLink,
          },
        };
      });
    },
    setRelayUrl: (value) => {
      set((state) => ({ relayNode: { ...state.relayNode, relayUrl: value } }));
      get().handlers.onRelayUrlChange?.(value);
    },
    setRelayModel: (value) => {
      set((state) => ({ relayNode: { ...state.relayNode, relayModel: value } }));
      get().handlers.onRelayModelChange?.(value);
    },
    setManualRelayTokenInput: (value) => {
      set((state) => ({ relayNode: { ...state.relayNode, manualRelayTokenInput: value } }));
      get().handlers.onManualRelayTokenInputChange?.(value);
    },
    saveManualRelayToken: () => {
      get().handlers.onSaveManualRelayToken?.();
    },
    connectRelay: (relayCode) => {
      get().handlers.onConnectRelay?.(relayCode);
    },
    disconnectRelay: () => {
      get().handlers.onDisconnectRelay?.();
    },
    switchToDirect: () => {
      get().handlers.onSwitchToDirect?.();
    },
    switchToRelay: () => {
      get().handlers.onSwitchToRelay?.();
    },
    startRelayListening: () => {
      const state = get();
      const relayCode = state.relayNode.relayCode;
      const relayConnectUrl = state.relayNode.relayConnectUrl;
      if (!relayCode) return;
      if (relayConnectUrl && state.relayNode.relayUrl !== relayConnectUrl) {
        get().actions.setRelayUrl(relayConnectUrl);
      }
      get().handlers.onConnectRelay?.(relayCode);
    },
    openBridge: () => {
      const authLink = get().relayNode.authLink;
      if (!authLink) return;
      get().actions.startRelayListening();
      window.open(authLink, '_blank', 'noopener,noreferrer');
    },
  },
}));

