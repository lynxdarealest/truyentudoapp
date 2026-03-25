import { ChevronLeft, Download, Link2, Shield, Trash2, Upload, Wifi, WifiOff, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AiProfileMode, ApiModelOption, ApiProvider, StoredApiKeyRecord } from '../../apiVault';
import { PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS } from '../../apiVault';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function maskSensitive(value: string, head = 8, tail = 6): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Chưa có';
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
  testingApiId: string | null;
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
  isCheckingAi: boolean;
  aiCheckStatus: string;
  aiUsageRequests: number;
  aiUsageTokens: number;
  quickImportText: string;
  quickImportResult: string;
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
  onCheckAiHealth: () => void;
  onResetAiUsage: () => void;
  onQuickImportTextChange: (value: string) => void;
  onQuickImportKeys: () => void;
  onAiProfileChange: (value: AiProfileMode) => void;
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
  aiProfile,
  apiVault,
  currentApiEntry,
  testingApiId,
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
  isCheckingAi,
  aiCheckStatus,
  aiUsageRequests,
  aiUsageTokens,
  quickImportText,
  quickImportResult,
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
  onCheckAiHealth,
  onResetAiUsage,
  onQuickImportTextChange,
  onQuickImportKeys,
  onAiProfileChange,
}: ApiSectionPanelProps) {
  return (
    <div className="max-w-6xl mx-auto pt-24 pb-12 px-6 space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 transition-colors"><ChevronLeft /></button>
        <div>
          <h2 className="text-3xl font-serif font-bold">Thiết lập AI</h2>
          <p className="text-sm text-slate-500">Lưu kết nối AI, chọn model đang dùng và đổi cách kết nối tại một nơi.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="tf-card p-4 text-sm">
          <p className="text-slate-300">Nhà cung cấp</p>
          <strong className="text-slate-50 text-lg">{currentProviderLabel}</strong>
        </div>
        <div className="tf-card p-4 text-sm">
          <p className="text-slate-300">Model hiện tại</p>
          <strong className="text-slate-50 text-lg">{currentModelLabel}</strong>
        </div>
        <div className="tf-card p-4 text-sm">
          <p className="text-slate-300">Đã lưu</p>
          <strong className="text-slate-50 text-lg">{vaultCount.toLocaleString('vi-VN')} kết nối</strong>
        </div>
        <div className="tf-card p-4 text-sm">
          <p className="text-slate-300">Trạng thái</p>
          <strong className="text-slate-50 text-lg">{currentStatusLabel}</strong>
        </div>
      </div>

      <div className="tf-card p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-50 rounded-2xl">
            <Zap className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-xl font-serif font-bold">Kết nối AI</h3>
            <p className="text-sm text-slate-500">Chọn cách kết nối phù hợp rồi lưu lại để dùng nhanh ở các lần sau.</p>
          </div>
        </div>

        <div className="tf-pill-tabs">
          <button
            onClick={onSwitchToDirect}
            className={cn(
              "tf-pill-btn",
              apiMode === 'manual' ? "bg-indigo-600 text-white shadow" : "text-slate-200 hover:bg-slate-800"
            )}
          >
            Gọi trực tiếp
          </button>
          <button
            onClick={onSwitchToRelay}
            className={cn(
              "tf-pill-btn",
              apiMode === 'relay' ? "bg-indigo-600 text-white shadow" : "text-slate-200 hover:bg-slate-800"
            )}
          >
            Qua trung chuyển
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="tf-card p-4 text-slate-200">
            <p className="font-bold text-slate-50 mb-1">Gọi trực tiếp</p>
            <p className="tf-body">Dùng API key Gemini/OpenAI/Anthropic, mã truy cập Google <code>ya29...</code>, hoặc địa chỉ máy chủ AI riêng do bạn nhập. Ứng dụng gọi thẳng, không qua trung chuyển.</p>
          </div>
          <div className="rounded-lg border border-amber-500/50 bg-amber-900/20 p-4 text-amber-100">
            <p className="font-bold mb-1">Qua trung chuyển</p>
            <p className="leading-relaxed">Ứng dụng chỉ nối vào máy chủ trung chuyển <code>relay2026...</code>; phía trung chuyển giữ khóa hoặc tự gọi AI thay cho trình duyệt.</p>
          </div>
        </div>

        {apiMode === 'manual' ? (
          <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1.35fr] gap-6">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thêm kết nối mới</p>
                <h4 className="text-lg font-bold text-slate-900 mt-1">Một biểu mẫu cho mọi kiểu gọi trực tiếp</h4>
              </div>
              <input
                value={apiEntryName}
                onChange={(e) => onApiEntryNameChange(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-emerald-500"
                placeholder="Tên gợi nhớ, ví dụ: Gemini chính"
              />
              <textarea
                value={apiEntryText}
                onChange={(e) => onApiEntryTextChange(e.target.value)}
                className="w-full min-h-28 px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-emerald-500"
                placeholder="Dán API key hoặc mã truy cập Google `ya29...`. Nếu dùng máy chủ AI riêng không cần xác thực thì có thể để trống."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nhận diện</p>
                  <p className="mt-1 font-bold text-slate-900">{PROVIDER_LABELS[effectiveDraftProvider]}</p>
                  {effectiveDraftProvider === 'gcli' ? <p className="text-[11px] text-slate-500 mt-1">Mã <code>ya29...</code> được hiểu là đăng nhập Google trực tiếp cho Gemini.</p> : null}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mode mặc định</p>
                  <p className="mt-1 font-bold text-slate-900">{aiProfile === 'economy' ? 'Nhanh' : aiProfile === 'quality' ? 'Chất lượng cao' : 'Cân bằng'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select
                  value={displayedDraftProvider}
                  onChange={(e) => onApiEntryProviderChange(e.target.value as ApiProvider)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="gemini">Gemini (API key)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="custom">Máy chủ AI riêng</option>
                </select>
                {effectiveDraftProvider === 'custom' ? (
                  <input
                    value={apiEntryModel}
                    onChange={(e) => onApiEntryModelChange(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                    placeholder="Tên model custom, ví dụ: llama-3.1-70b"
                  />
                ) : (
                  <select
                    value={apiEntryModel}
                    onChange={(e) => onApiEntryModelChange(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                  >
                    {availableDraftModels.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <input
                value={apiEntryBaseUrl}
                onChange={(e) => onApiEntryBaseUrlChange(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                placeholder={effectiveDraftProvider === 'custom' ? 'Địa chỉ máy chủ AI riêng, ví dụ: http://127.0.0.1:11434/v1/chat/completions' : 'Base URL tùy chỉnh (để trống nếu dùng mặc định)'}
              />
              <button
                onClick={onSaveApiEntry}
                disabled={!apiEntryText.trim() && !(effectiveDraftProvider === 'custom' && apiEntryBaseUrl.trim())}
                className="w-full px-6 py-3 rounded-2xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                Lưu vào kho kết nối
              </button>
              <p className="text-xs text-slate-500">
                Mã <code>ya29...</code> hoặc <code>Bearer ...</code> được xếp vào nhóm Gemini gọi trực tiếp. Máy chủ AI riêng là URL bạn tự nhập, không phải trạm trung chuyển.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kho kết nối</p>
                    <h4 className="text-lg font-bold text-slate-900 mt-1">Các kết nối đã lưu</h4>
                  </div>
                  <span className="text-xs px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-600 font-semibold">
                    Hiện tại: {currentApiEntry?.name || 'Chưa có'}
                  </span>
                </div>
                <div className="space-y-3 max-h-[30rem] overflow-y-auto pr-1">
                  {apiVault.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                      Chưa có kết nối nào trong kho. Dán khóa hoặc địa chỉ máy chủ ở form bên trái để bắt đầu.
                    </div>
                  ) : apiVault.map((entry) => (
                    <div key={entry.id} className={cn(
                      'rounded-2xl border p-4 bg-white space-y-3 transition-all',
                      entry.isActive ? 'border-emerald-300 shadow-lg shadow-emerald-100' : 'border-slate-200',
                    )}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-900">{entry.name}</p>
                            <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">
                              {PROVIDER_LABELS[entry.provider]}
                            </span>
                            {entry.status === 'valid' ? <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold">OK</span> : null}
                            {entry.status === 'invalid' ? <span className="text-[11px] px-2 py-1 rounded-full bg-rose-100 text-rose-700 font-semibold">Lỗi</span> : null}
                            {entry.isActive ? <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold">Hiện tại</span> : null}
                          </div>
                          <p className="text-xs text-slate-500 font-mono mt-1">{maskSensitive(entry.key, 6, 4)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => onTestApiEntry(entry.id)}
                            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:border-emerald-300 hover:text-emerald-700"
                          >
                            {testingApiId === entry.id ? 'Đang thử...' : 'Kiểm tra'}
                          </button>
                          <button
                            onClick={() => onActivateApiEntry(entry.id)}
                            className={cn(
                              'px-3 py-2 rounded-xl text-xs font-bold',
                              entry.isActive ? 'bg-slate-900 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700',
                            )}
                          >
                            {entry.isActive ? 'Đang chọn' : 'Dùng kết nối này'}
                          </button>
                          <button
                            onClick={() => onDeleteApiEntry(entry.id)}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                        {entry.provider === 'custom' ? (
                          <input
                            value={entry.model}
                            onChange={(e) => onStoredApiModelChange(entry.id, e.target.value)}
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                            placeholder="Tên model tự nhập"
                          />
                        ) : (
                          <select
                            value={entry.model}
                            onChange={(e) => onStoredApiModelChange(entry.id, e.target.value)}
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                          >
                            {PROVIDER_MODEL_OPTIONS[(entry.provider === 'unknown' ? 'gemini' : entry.provider) as 'gemini' | 'gcli' | 'openai' | 'anthropic' | 'custom'].map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </select>
                        )}
                        <input
                          value={entry.baseUrl}
                          onChange={(e) => onStoredApiBaseUrlChange(entry.id, e.target.value)}
                          className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                          placeholder="Base URL hoặc địa chỉ máy chủ"
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        {PROVIDER_MODEL_OPTIONS[(entry.provider === 'unknown' ? 'gemini' : entry.provider) as 'gemini' | 'gcli' | 'openai' | 'anthropic' | 'custom'].find((item) => item.value === entry.model)?.description || 'Model hoặc địa chỉ tùy chỉnh.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <button
                  onClick={relayStatus === 'connected' ? onDisconnectRelay : onConnectRelay}
                  className={`px-6 py-3 rounded-2xl text-white font-bold ${relayStatus === 'connected' ? 'bg-slate-700 hover:bg-slate-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  {relayStatus === 'connected' ? (
                    <span className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4" /> Tạm ngắt kết nối</span>
                  ) : (
                    <span className="inline-flex items-center gap-2"><Wifi className="w-4 h-4" /> Kết nối trung chuyển</span>
                  )}
                </button>
                <a
                  href={relayWebBase}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-3 rounded-2xl bg-fuchsia-600 text-white font-bold hover:bg-fuchsia-700 text-center"
                >
                  Mở trang trung chuyển
                </a>
              </div>
              <input
                type="text"
                value={relayUrl}
                onChange={(e) => onRelayUrlChange(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                placeholder={`${relaySocketBase}18101412`}
              />
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <select
                  value={relayModel}
                  onChange={(e) => onRelayModelChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
                >
                  {relayModelOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 flex items-center">
                  Model qua relay
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
                <p><Link2 className="inline w-3 h-3 mr-1" /> Mã kết nối: <b>{relayUrl.match(/code=(\d{4,8})/)?.[1] || 'chưa có'}</b></p>
                <p><Zap className="inline w-3 h-3 mr-1" /> Mã đã nhận diện: <b>{relayMatchedLong || 'chưa có'}</b></p>
                <p><Shield className="inline w-3 h-3 mr-1" /> Khóa hiện tại: <b>{relayMaskedToken}</b></p>
                <p>Tiến trình: <b>{relayStatusText}</b></p>
              </div>
            </div>

            <details className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-900">Không vào được trung chuyển? Tạm dùng Gemini trực tiếp</summary>
              <div className="mt-3 space-y-3">
                <div className="text-xs text-amber-900 leading-relaxed space-y-1">
                  <p>1. Lấy API key tại <a className="text-indigo-600 underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.</p>
                  <p>2. Nếu dùng đăng nhập Google qua trung chuyển: bật <a className="text-indigo-600 underline" href="https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com" target="_blank" rel="noreferrer">Generative Language API</a>.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                  <input
                    type="text"
                    value={manualRelayTokenInput}
                    onChange={(e) => onManualRelayTokenInputChange(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-amber-300 focus:ring-2 focus:ring-amber-500"
                    placeholder="Dán khóa AIza... hoặc đoạn văn bản có chứa key"
                  />
                  <button
                    onClick={onSaveManualRelayToken}
                    className="px-5 py-3 rounded-2xl bg-amber-600 text-white font-bold hover:bg-amber-700"
                  >
                    Lưu khóa tạm
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Kiểm tra AI & Mức sử dụng</p>
            <div className="flex items-center gap-2">
              <button
                onClick={onCheckAiHealth}
                disabled={isCheckingAi}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60"
              >
                {isCheckingAi ? 'Đang kiểm tra...' : 'Kiểm tra AI'}
              </button>
              <button
                onClick={onResetAiUsage}
                className="px-4 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-700 text-sm font-bold hover:bg-emerald-100"
              >
                Đặt lại thống kê
              </button>
            </div>
          </div>
          <p className="text-sm text-emerald-800">
            Trạng thái: <b>{aiCheckStatus}</b>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-emerald-900">
            <p>Số lượt gọi trong phiên: <b>{aiUsageRequests.toLocaleString('vi-VN')}</b></p>
            <p>Token ước tính đã dùng: <b>{aiUsageTokens.toLocaleString('vi-VN')}</b></p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_auto] gap-3 pt-2">
            <textarea
              value={quickImportText}
              onChange={(e) => onQuickImportTextChange(e.target.value)}
              className="w-full min-h-24 px-4 py-3 rounded-2xl border border-emerald-200 focus:ring-2 focus:ring-emerald-500"
              placeholder={`Dán hàng loạt key hoặc URL relay, ví dụ ${relaySocketBase}1234`}
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={onQuickImportKeys}
                className="px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
              >
                Tự nhận diện & lưu
              </button>
              <select
                value={aiProfile}
                onChange={(e) => onAiProfileChange(e.target.value as AiProfileMode)}
                className="px-4 py-3 rounded-xl border border-emerald-200 text-sm font-medium"
              >
                <option value="economy">Mode nhanh</option>
                <option value="balanced">Mode cân bằng</option>
                <option value="quality">Mode chất lượng</option>
              </select>
            </div>
          </div>
          {quickImportResult ? <p className="text-xs text-emerald-700">{quickImportResult}</p> : null}
        </div>
      </div>
    </div>
  );
}
