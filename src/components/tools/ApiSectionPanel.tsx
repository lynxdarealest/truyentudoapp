import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Trash2, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AiProfileMode, ApiModelOption, ApiProvider, StoredApiKeyRecord } from '../../apiVault';
import { PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS } from '../../apiVault';
import { IMAGE_AI_PROVIDER_META, IMAGE_AI_PROVIDER_ORDER, type ImageAiProvider } from '../../imageAiProviders';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function maskSensitive(value: string, head = 6, tail = 4): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (raw.length <= head + tail) return raw;
  return `${raw.slice(0, head)}...${raw.slice(-tail)}`;
}

const AIS_AUTH_BASE = 'https://ais-dev-qbnyavxszwzdl6ugpdjaxp-279055114293.asia-northeast1.run.app/';
const EVOLINK_HOME_URL = 'https://evolink.ai';
const EVOLINK_SIGNUP_URL = 'https://evolink.ai/signup';
const EVOLINK_IMAGE_DOCS_URL = 'https://docs.evolink.ai/en/api-manual/image-series/z-image-turbo/z-image-turbo-image-generate';
const CODE_REGEX = /\b(\d{4,8})\b/;

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

interface ApiSectionPanelProps {
  onBack: () => void;
  apiMode: 'manual' | 'relay';
  currentProviderLabel: string;
  currentModelLabel: string;
  vaultCount: number;
  currentStatusLabel: string;
  onSwitchToDirect: () => void;
  onSwitchToRelay: () => void;
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
  imageAiEnabled: boolean;
  imageAiApiKey: string;
  imageAiStatusLabel: string;
  imageAiProvider: ImageAiProvider;
  imageAiModel: string;
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
}

export function ApiSectionPanel({
  onBack,
  apiMode,
  currentProviderLabel,
  currentModelLabel,
  vaultCount,
  currentStatusLabel,
  onSwitchToDirect,
  onSwitchToRelay,
  apiEntryName,
  apiEntryText,
  displayedDraftProvider,
  effectiveDraftProvider,
  availableDraftModels,
  apiEntryModel,
  apiEntryBaseUrl,
  apiVault,
  currentApiEntry,
  relayStatus,
  relayStatusText,
  relayUrl,
  relayMatchedLong,
  relayMaskedToken,
  relayModel,
  relayModelOptions,
  relayWebBase,
  relaySocketBase,
  manualRelayTokenInput,
  imageAiEnabled,
  imageAiApiKey,
  imageAiStatusLabel,
  imageAiProvider,
  imageAiModel,
  onApiEntryNameChange,
  onApiEntryTextChange,
  onApiEntryProviderChange,
  onApiEntryModelChange,
  onApiEntryBaseUrlChange,
  onImageAiEnabledChange,
  onImageAiApiKeyChange,
  onImageAiProviderChange,
  onImageAiModelChange,
  onSaveImageAiConfig,
  onSaveApiEntry,
  onTestApiEntry,
  onActivateApiEntry,
  onDeleteApiEntry,
  onStoredApiModelChange,
  onStoredApiBaseUrlChange,
  onConnectRelay,
  onDisconnectRelay,
  onRelayUrlChange,
  onRelayModelChange,
  onManualRelayTokenInputChange,
  onSaveManualRelayToken,
}: ApiSectionPanelProps) {
  const [relayCode, setRelayCode] = useState('');
  const lastSyncedRelayUrlCodeRef = React.useRef('');
  const imageProviderMeta = IMAGE_AI_PROVIDER_META[imageAiProvider];
  const imageModelOptions = imageProviderMeta.models;

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('code') || '';
      const fromPath = window.location.pathname.split('/').filter(Boolean)[0] || '';
      const code = /^\d{4,8}$/.test(fromPath) ? fromPath : fromQuery;
      if (/^\d{4,8}$/.test(code)) {
        setRelayCode(code);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Cập nhật code nếu người dùng dán URL relay có chứa code
  useEffect(() => {
    if (relayUrl) {
      const match = relayUrl.match(CODE_REGEX);
      const nextCode = match?.[1] || '';
      if (!nextCode) {
        lastSyncedRelayUrlCodeRef.current = '';
        return;
      }
      if (nextCode !== lastSyncedRelayUrlCodeRef.current && nextCode !== relayCode) {
        lastSyncedRelayUrlCodeRef.current = nextCode;
        setRelayCode(nextCode);
      }
    }
  }, [relayUrl, relayCode]);

  const relayConnectUrl = useMemo(() => {
    const code = relayCode || '';
    return code ? buildRelaySocketUrl(relaySocketBase, code) : '';
  }, [relayCode, relaySocketBase]);

  const relayPublishUrl = useMemo(() => {
    const code = relayCode || '';
    return code ? buildRelayPublishUrl(relayWebBase, code) : '';
  }, [relayCode, relayWebBase]);

  const authLink = useMemo(() => {
    const code = relayCode || '';
    if (!code) return '';
    const url = new URL(AIS_AUTH_BASE);
    url.searchParams.set('code', code);
    url.searchParams.set('relay', relayConnectUrl);
    url.searchParams.set('worker', relayWebBase);
    url.searchParams.set('publish', relayPublishUrl);
    return url.toString();
  }, [relayCode, relayConnectUrl, relayPublishUrl, relayWebBase]);

  const handleStartRelayListening = () => {
    if (!relayCode) return;
    if (relayConnectUrl && relayUrl !== relayConnectUrl) {
      onRelayUrlChange(relayConnectUrl);
    }
    onConnectRelay(relayCode);
  };

  const handleOpenBridge = () => {
    if (!authLink) return;
    handleStartRelayListening();
    window.open(authLink, '_blank', 'noopener,noreferrer');
  };
  return (
    <div className="max-w-5xl mx-auto pt-28 pb-12 px-4 md:px-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 transition-colors shrink-0"><ChevronLeft /></button>
        <div>
          <h2 className="text-2xl font-serif font-bold">Kết nối AI</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="tf-card p-3 text-sm">
          <p className="text-slate-300">Nhà cung cấp</p>
          <p className="text-lg font-semibold text-white">{currentProviderLabel}</p>
        </div>
        <div className="tf-card p-3 text-sm">
          <p className="text-slate-300">Model</p>
          <p className="text-lg font-semibold text-white">{currentModelLabel}</p>
        </div>
        <div className="tf-card p-3 text-sm">
          <p className="text-slate-300">Trạng thái</p>
          <p className="text-lg font-semibold text-white">{currentStatusLabel}</p>
        </div>
      </div>

      <div className="tf-card p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-200">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Phương thức</p>
              <h3 className="text-lg font-semibold text-white">Trực tiếp / Relay</h3>
            </div>
          </div>
          <div className="tf-pill-tabs tf-scroll-tabs">
            <button
              onClick={onSwitchToDirect}
              className={cn("tf-pill-btn px-3 py-1.5", apiMode === 'manual' ? "bg-indigo-600 text-white shadow" : "text-slate-200 hover:bg-slate-800")}
            >
              Trực tiếp
            </button>
            <button
              onClick={onSwitchToRelay}
              className={cn("tf-pill-btn px-3 py-1.5", apiMode === 'relay' ? "bg-indigo-600 text-white shadow" : "text-slate-200 hover:bg-slate-800")}
            >
              Relay
            </button>
          </div>
        </div>

        {apiMode === 'manual' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={apiEntryName}
                onChange={(e) => onApiEntryNameChange(e.target.value)}
                className="tf-input"
                placeholder="Tên gợi nhớ (vd: Gemini chính)"
              />
              <select
                value={displayedDraftProvider}
                onChange={(e) => onApiEntryProviderChange(e.target.value as ApiProvider)}
                className="tf-input"
              >
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {effectiveDraftProvider === 'custom' ? (
                <input
                  value={apiEntryModel}
                  onChange={(e) => onApiEntryModelChange(e.target.value)}
                  className="tf-input"
                  placeholder="Model custom (vd: llama-3.1-70b)"
                />
              ) : (
                <select
                  value={apiEntryModel}
                  onChange={(e) => onApiEntryModelChange(e.target.value)}
                  className="tf-input"
                >
                  {availableDraftModels.map((model) => (
                    <option key={model.value} value={model.value}>{model.label}</option>
                  ))}
                </select>
              )}
              <input
                value={apiEntryBaseUrl}
                onChange={(e) => onApiEntryBaseUrlChange(e.target.value)}
                className="tf-input"
                placeholder="Base URL (để trống nếu không dùng proxy)"
              />
            </div>

            <textarea
              value={apiEntryText}
              onChange={(e) => onApiEntryTextChange(e.target.value)}
              className="tf-textarea"
              placeholder="Dán API key hoặc mã đăng nhập Google (ya29...)"
            />

            <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-end tf-actions-mobile">
              <button onClick={onSaveApiEntry} className="tf-btn tf-btn-primary">Lưu</button>
              <button
                onClick={() => currentApiEntry?.id && onTestApiEntry(currentApiEntry.id)}
                disabled={!currentApiEntry?.id}
                className="tf-btn tf-btn-ghost disabled:opacity-50"
              >
                Kiểm tra
              </button>
            </div>

            <div className="tf-card p-4 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="text-sm font-semibold text-white">Đã lưu ({vaultCount})</p>
                <span className="text-xs text-slate-400">Chọn “Dùng” để kích hoạt</span>
              </div>
              {currentStatusLabel ? (
                <p className="text-xs text-emerald-200">
                  Trạng thái kiểm tra gần nhất: <span className="font-semibold text-white">{currentStatusLabel}</span>
                </p>
              ) : null}
              <div className="divide-y divide-white/10">
                {apiVault.length === 0 && <p className="text-sm text-slate-400 py-2">Chưa có kết nối.</p>}
                {apiVault.map((item) => (
                  <div key={item.id} className="py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <p className="font-semibold text-white tf-break-long">{item.name || 'Chưa đặt tên'}</p>
                      <p className="text-xs text-slate-400 flex gap-2 flex-wrap items-center min-w-0">
                        <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-white">{PROVIDER_LABELS[item.provider]}</span>
                        <span className="tf-break-long">{item.model || 'Model?'}</span>
                        {item.baseUrl && <span className="text-[11px] text-slate-500 tf-break-all">{item.baseUrl}</span>}
                        <span className="text-[11px] text-slate-500 tf-break-all">•••{maskSensitive(item.key || '')}</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] font-semibold",
                          item.status === 'valid' ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/60" :
                          item.status === 'invalid' ? "bg-rose-500/10 text-rose-100 border border-rose-400/60" :
                          "bg-white/5 text-slate-200 border border-white/10"
                        )}>
                          {item.status === 'valid' ? 'OK' : item.status === 'invalid' ? 'Lỗi' : 'Chưa test'}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full md:w-auto">
                      <select
                        value={item.model || ''}
                        onChange={(e) => onStoredApiModelChange(item.id, e.target.value)}
                        className="text-xs rounded-md border border-white/10 bg-slate-900/60 text-white px-2 py-1 min-w-0"
                      >
                        {PROVIDER_MODEL_OPTIONS[item.provider || 'gemini']?.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <input
                        value={item.baseUrl || ''}
                        onChange={(e) => onStoredApiBaseUrlChange(item.id, e.target.value)}
                        className="text-xs rounded-md border border-white/10 bg-slate-900/60 text-white px-2 py-1 w-full sm:w-32 tf-break-all"
                        placeholder="Base URL"
                      />
                      <button
                        onClick={() => onActivateApiEntry(item.id)}
                        className={cn(
                          "px-3 py-1 rounded-md text-xs font-semibold",
                          currentApiEntry?.id === item.id ? "bg-emerald-600 text-white" : "border border-white/10 text-white hover:bg-white/5"
                        )}
                      >
                        Dùng
                      </button>
                      <button onClick={() => onTestApiEntry(item.id)} className="px-3 py-1 rounded-md text-xs border border-white/10 text-white/80 hover:bg-white/5">
                        {currentApiEntry?.id === item.id ? 'Test hiện tại' : 'Test'}
                      </button>
                      <button onClick={() => onDeleteApiEntry(item.id)} className="p-2 rounded-md text-white/60 hover:text-red-400 hover:bg-red-900/30">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="tf-card p-4 space-y-4 border border-emerald-400/30">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">Kết nối qua Cloudflare Worker</p>
                  <p className="text-xs text-slate-300">TruyenForge sẽ nghe WebSocket trước, sau đó mở AI Studio để worker `proxymid` đẩy gói `type: "token"` về đúng mã phòng.</p>
                </div>
                {relayCode ? (
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                    Code {relayCode}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
                <input
                  value={relayCode}
                  onChange={(e) => setRelayCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="tf-input"
                  placeholder="Code 4-8 số"
                />
                <select
                  value={relayModel}
                  onChange={(e) => onRelayModelChange(e.target.value)}
                  className="tf-input"
                >
                  {relayModelOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-3 tf-actions-mobile">
                <button
                  onClick={handleOpenBridge}
                  disabled={!authLink}
                  className="tf-btn tf-btn-primary disabled:opacity-50"
                >
                  Kết nối AI Studio
                </button>
                <button onClick={onDisconnectRelay} className="tf-btn tf-btn-ghost">
                  Ngắt
                </button>
              </div>
            </div>

            <div className="tf-card p-4 text-sm space-y-2">
              <p className="tf-break-long">WS Worker: <span className="text-slate-300">{relayConnectUrl || relaySocketBase}</span></p>
              <p className="tf-break-long">Publish URL: <span className="text-slate-300">{relayPublishUrl || `${String(relayWebBase || '').trim().replace(/\/+$/, '')}/publish-token/1234`}</span></p>
              <p className="tf-break-long">Trạng thái: <span className="font-semibold text-white">{relayStatusText}</span></p>
              <p className="tf-break-all">Token: <span className="text-slate-300">{relayMaskedToken}</span></p>
              <p className="tf-break-long">Phiên: <span className="text-slate-300">{relayMatchedLong || relayCode || '—'}</span></p>
            </div>
          </div>
        )}
      </div>

      <div className="tf-card p-6 space-y-4 border border-sky-400/20">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-sky-500/15 p-2 text-sky-200">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">AI Sinh ảnh</p>
                <p className="text-xs text-slate-300">Kênh riêng chỉ dùng cho việc tạo ảnh bìa. Không ảnh hưởng đến dịch truyện, Writer Pro hay các lệnh text AI khác.</p>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              Khi bật và có API key, nút <span className="font-semibold text-white">Tạo bìa bằng AI</span> sẽ ưu tiên gửi prompt sang nhà phát triển ảnh bạn chọn.
              Khi tắt, TruyenForge sẽ bỏ qua nhánh này và chuyển sang các đường tạo ảnh dự phòng khác.
            </p>
          </div>

          <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={imageAiEnabled}
              onChange={(e) => onImageAiEnabledChange(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-500 focus:ring-indigo-400"
            />
            <span className="text-sm font-semibold text-white">{imageAiEnabled ? 'Đang bật' : 'Đang tắt'}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Nhà phát triển</span>
            <select
              value={imageAiProvider}
              onChange={(e) => onImageAiProviderChange(e.target.value as ImageAiProvider)}
              className="tf-input"
            >
              {IMAGE_AI_PROVIDER_ORDER.map((provider) => (
                <option key={provider} value={provider}>
                  {IMAGE_AI_PROVIDER_META[provider].label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Model ảnh</span>
            <select
              value={imageAiModel}
              onChange={(e) => onImageAiModelChange(e.target.value)}
              className="tf-input"
            >
              {imageModelOptions.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{imageProviderMeta.label}</p>
            <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">
              {imageModelOptions.find((item) => item.value === imageAiModel)?.label || imageAiModel}
            </span>
          </div>
          <p className="text-sm text-slate-300">{imageProviderMeta.summary}</p>
          <p className="text-sm text-emerald-200">Ưu điểm: {imageProviderMeta.strengths}</p>
          <p className="text-sm text-amber-200">Lưu ý: {imageProviderMeta.tradeoffs}</p>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
            {imageModelOptions.find((item) => item.value === imageAiModel)?.description || 'Chọn model để xem mô tả chi tiết.'}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={imageAiApiKey}
            onChange={(e) => onImageAiApiKeyChange(e.target.value)}
            className="tf-input"
            placeholder={imageProviderMeta.keyPlaceholder}
          />
          <button onClick={onSaveImageAiConfig} className="tf-btn tf-btn-primary">
            Lưu AI Sinh ảnh
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Trạng thái hiện tại</p>
          <p className="text-sm text-white">{imageAiStatusLabel}</p>
          <p className="text-xs text-slate-400">{imageProviderMeta.keyLabel} này chỉ được lưu cục bộ trên trình duyệt/máy hiện tại, không dùng để thay thế khóa AI viết và dịch.</p>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <a href={imageProviderMeta.signupUrl} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">
            Mở Trang Nhà Phát Triển
          </a>
          <a href={imageProviderMeta.signupUrl} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">
            Đăng ký / Đăng nhập
          </a>
          <a href={imageProviderMeta.docsUrl} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">
            Xem tài liệu API ảnh
          </a>
        </div>

        <div className="rounded-2xl border border-indigo-400/20 bg-indigo-500/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-white">Cách lấy API key</p>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-300">
            <li>Mở trang <a href={imageProviderMeta.signupUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2">{imageProviderMeta.signupUrl.replace(/^https?:\/\//, '')}</a> rồi đăng ký hoặc đăng nhập.</li>
            <li>Vào dashboard của nhà phát triển và mở khu vực quản lý API key.</li>
            <li>Tạo hoặc sao chép khóa theo đúng định dạng mà nhà cung cấp đó cấp cho bạn.</li>
            <li>Chọn đúng <span className="font-semibold text-white">Nhà phát triển</span> và <span className="font-semibold text-white">Model ảnh</span>, dán key vào ô phía trên, bật <span className="font-semibold text-white">AI Sinh ảnh</span>, rồi bấm <span className="font-semibold text-white">Lưu AI Sinh ảnh</span>.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
