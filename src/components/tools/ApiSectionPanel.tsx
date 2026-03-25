import { ChevronLeft, Trash2, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AiProfileMode, ApiModelOption, ApiProvider, StoredApiKeyRecord } from '../../apiVault';
import { PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS } from '../../apiVault';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function maskSensitive(value: string, head = 6, tail = 4): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (raw.length <= head + tail) return raw;
  return `${raw.slice(0, head)}...${raw.slice(-tail)}`;
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
  onApiEntryNameChange: (value: string) => void;
  onApiEntryTextChange: (value: string) => void;
  onApiEntryProviderChange: (value: ApiProvider) => void;
  onApiEntryModelChange: (value: string) => void;
  onApiEntryBaseUrlChange: (value: string) => void;
  onSaveApiEntry: () => void;
  onTestApiEntry: (id: string) => void;
  onActivateApiEntry: (id: string) => void;
  onDeleteApiEntry: (id: string) => void;
  onStoredApiModelChange: (id: string, value: string) => void;
  onStoredApiBaseUrlChange: (id: string, value: string) => void;
  onConnectRelay: () => void;
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
  onApiEntryNameChange,
  onApiEntryTextChange,
  onApiEntryProviderChange,
  onApiEntryModelChange,
  onApiEntryBaseUrlChange,
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
                      <button onClick={() => onTestApiEntry(item.id)} className="px-3 py-1 rounded-md text-xs border border-white/10 text-white/80 hover:bg-white/5">Test</button>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={relayUrl}
                onChange={(e) => onRelayUrlChange(e.target.value)}
                className="tf-input"
                placeholder="wss://relay.yourserver.com"
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

            <textarea
              value={manualRelayTokenInput}
              onChange={(e) => onManualRelayTokenInputChange(e.target.value)}
              className="tf-textarea"
              placeholder="Token relay (nếu có)"
            />

            <div className="flex flex-col sm:flex-row flex-wrap justify-end gap-3 tf-actions-mobile">
              <button onClick={onSaveManualRelayToken} className="tf-btn tf-btn-ghost">Lưu token</button>
              <button onClick={onConnectRelay} className="tf-btn tf-btn-primary">Kết nối</button>
              <button onClick={onDisconnectRelay} className="tf-btn tf-btn-ghost">Ngắt</button>
            </div>

            <div className="tf-card p-4 text-sm space-y-1">
              <p className="tf-break-long">Trạng thái: <span className="font-semibold text-white">{relayStatusText}</span></p>
              <p className="tf-break-all">Token: <span className="text-slate-300">{relayMaskedToken}</span></p>
              <p className="tf-break-long">Phiên: <span className="text-slate-300">{relayMatchedLong || '—'}</span></p>
              <div className="flex flex-col sm:flex-row gap-2 pt-2 tf-actions-mobile">
                <a href={relayWebBase} target="_blank" rel="noreferrer" className="tf-btn tf-btn-primary">Mở trang relay</a>
                <a href={relaySocketBase} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">Xem endpoint</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
