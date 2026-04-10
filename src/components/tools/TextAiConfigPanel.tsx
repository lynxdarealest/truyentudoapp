import React, { memo, useMemo } from 'react';
import { Trash2, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { shallow } from 'zustand/shallow';
import { API_PROVIDER_META, PROVIDER_LABELS, PROVIDER_MODEL_OPTIONS } from '../../apiVault';
import { OPENROUTER_CUSTOM_MODEL_OPTION, useApiStore } from './useApiStore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function maskSensitive(value: string, head = 6, tail = 4): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (raw.length <= head + tail) return raw;
  return `${raw.slice(0, head)}...${raw.slice(-tail)}`;
}

export const TextAiConfigPanel = memo(function TextAiConfigPanel() {
  const {
    currentProviderLabel,
    currentModelLabel,
    currentStatusLabel,
    vaultCount,
    apiEntryName,
    apiEntryText,
    displayedDraftProvider,
    effectiveDraftProvider,
    availableDraftModels,
    apiEntryModel,
    apiEntryBaseUrl,
    apiVault,
    currentApiEntry,
    draftOpenRouterCustomModel,
    storedOpenRouterCustomModels,
    setApiEntryName,
    setApiEntryText,
    setApiEntryProvider,
    setApiEntryModel,
    setApiEntryBaseUrl,
    setDraftOpenRouterCustomModel,
    setStoredOpenRouterCustomModel,
    saveApiEntry,
    testApiEntry,
    activateApiEntry,
    deleteApiEntry,
    setStoredApiModel,
    setStoredApiBaseUrl,
  } = useApiStore((state) => ({
    currentProviderLabel: state.textAi.currentProviderLabel,
    currentModelLabel: state.textAi.currentModelLabel,
    currentStatusLabel: state.textAi.currentStatusLabel,
    vaultCount: state.textAi.vaultCount,
    apiEntryName: state.textAi.apiEntryName,
    apiEntryText: state.textAi.apiEntryText,
    displayedDraftProvider: state.textAi.displayedDraftProvider,
    effectiveDraftProvider: state.textAi.effectiveDraftProvider,
    availableDraftModels: state.textAi.availableDraftModels,
    apiEntryModel: state.textAi.apiEntryModel,
    apiEntryBaseUrl: state.textAi.apiEntryBaseUrl,
    apiVault: state.textAi.apiVault,
    currentApiEntry: state.textAi.currentApiEntry,
    draftOpenRouterCustomModel: state.textAi.draftOpenRouterCustomModel,
    storedOpenRouterCustomModels: state.textAi.storedOpenRouterCustomModels,
    setApiEntryName: state.actions.setApiEntryName,
    setApiEntryText: state.actions.setApiEntryText,
    setApiEntryProvider: state.actions.setApiEntryProvider,
    setApiEntryModel: state.actions.setApiEntryModel,
    setApiEntryBaseUrl: state.actions.setApiEntryBaseUrl,
    setDraftOpenRouterCustomModel: state.actions.setDraftOpenRouterCustomModel,
    setStoredOpenRouterCustomModel: state.actions.setStoredOpenRouterCustomModel,
    saveApiEntry: state.actions.saveApiEntry,
    testApiEntry: state.actions.testApiEntry,
    activateApiEntry: state.actions.activateApiEntry,
    deleteApiEntry: state.actions.deleteApiEntry,
    setStoredApiModel: state.actions.setStoredApiModel,
    setStoredApiBaseUrl: state.actions.setStoredApiBaseUrl,
  }), shallow);

  const isDraftOpenRouter = effectiveDraftProvider === 'openrouter';
  const listedOpenRouterModels = PROVIDER_MODEL_OPTIONS.openrouter || [];
  const textProviderMeta = API_PROVIDER_META[effectiveDraftProvider === 'unknown' ? 'gemini' : effectiveDraftProvider];
  const selectedTextModelMeta = useMemo(
    () => availableDraftModels.find((item) => item.value === apiEntryModel),
    [availableDraftModels, apiEntryModel],
  );

  return (
    <>
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
              <h3 className="text-lg font-semibold text-white">AI Văn bản</h3>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={apiEntryName}
                onChange={(e) => setApiEntryName(e.target.value)}
                className="tf-input"
                placeholder="Tên gợi nhớ (vd: Gemini chính)"
              />
              <select
                value={displayedDraftProvider}
                onChange={(e) => setApiEntryProvider(e.target.value as typeof displayedDraftProvider)}
                className="tf-input"
              >
                <option value="gemini">Gemini</option>
                <option value="xai">xAI / Grok</option>
                <option value="groq">Groq</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openrouter">OpenRouter</option>
                <option value="mistral">Mistral AI</option>
                <option value="ollama">Ollama Local</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{textProviderMeta.title}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                  {selectedTextModelMeta?.label || apiEntryModel || 'Chưa chọn model'}
                </span>
              </div>
              <p className="text-sm text-slate-300">Ưu điểm: {textProviderMeta.strengths}</p>
              <p className="text-sm text-amber-200">Điểm yếu / lưu ý: {textProviderMeta.tradeoffs}</p>
              {selectedTextModelMeta ? (
                <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                  {selectedTextModelMeta.description}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3 text-sm">
                {textProviderMeta.keyUrl ? (
                  <a href={textProviderMeta.keyUrl} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">
                    Lấy API key
                  </a>
                ) : null}
                <a href={textProviderMeta.docsUrl} target="_blank" rel="noreferrer" className="tf-btn tf-btn-ghost">
                  Xem tài liệu
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {effectiveDraftProvider === 'custom' || effectiveDraftProvider === 'ollama' ? (
                <input
                  value={apiEntryModel}
                  onChange={(e) => setApiEntryModel(e.target.value)}
                  className="tf-input"
                  placeholder={
                    effectiveDraftProvider === 'ollama'
                      ? 'Model Ollama (vd: qwen2.5:7b)'
                      : 'Model custom (vd: llama-3.1-70b)'
                  }
                />
              ) : (
                <select
                  value={
                    isDraftOpenRouter && draftOpenRouterCustomModel
                      ? OPENROUTER_CUSTOM_MODEL_OPTION
                      : apiEntryModel
                  }
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (isDraftOpenRouter && nextValue === OPENROUTER_CUSTOM_MODEL_OPTION) {
                      setDraftOpenRouterCustomModel(true);
                      setApiEntryModel('');
                      return;
                    }
                    setDraftOpenRouterCustomModel(false);
                    setApiEntryModel(nextValue);
                  }}
                  className="tf-input"
                >
                  {availableDraftModels.map((model) => (
                    <option key={model.value} value={model.value}>{model.label}</option>
                  ))}
                  {isDraftOpenRouter ? (
                    <option value={OPENROUTER_CUSTOM_MODEL_OPTION}>Tự nhập model OpenRouter…</option>
                  ) : null}
                </select>
              )}
              <input
                value={apiEntryBaseUrl}
                onChange={(e) => setApiEntryBaseUrl(e.target.value)}
                className="tf-input"
                placeholder="Base URL (để trống nếu không dùng proxy)"
              />
            </div>

            {isDraftOpenRouter && draftOpenRouterCustomModel ? (
              <input
                value={apiEntryModel}
                onChange={(e) => setApiEntryModel(e.target.value)}
                className="tf-input"
                placeholder="Model OpenRouter (vd: meta-llama/llama-3.1-70b-instruct)"
              />
            ) : null}

            <textarea
              value={apiEntryText}
              onChange={(e) => setApiEntryText(e.target.value)}
              className="tf-textarea"
              placeholder={
                effectiveDraftProvider === 'ollama'
                  ? 'Ollama local không bắt buộc API key. Có thể để trống.'
                  : 'Dán API key hoặc mã đăng nhập Google (ya29...)'
              }
            />

            <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-end tf-actions-mobile">
              <button onClick={saveApiEntry} className="tf-btn tf-btn-primary">Lưu</button>
              <button
                onClick={() => currentApiEntry?.id && testApiEntry(currentApiEntry.id)}
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
                          'px-2 py-0.5 rounded-full text-[11px] font-semibold',
                          item.status === 'valid' ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/60' :
                          item.status === 'invalid' ? 'bg-rose-500/10 text-rose-100 border border-rose-400/60' :
                          'bg-white/5 text-slate-200 border border-white/10',
                        )}>
                          {item.status === 'valid' ? 'OK' : item.status === 'invalid' ? 'Lỗi' : 'Chưa test'}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full md:w-auto">
                      <select
                        value={
                          item.provider === 'openrouter' && storedOpenRouterCustomModels[item.id]
                            ? OPENROUTER_CUSTOM_MODEL_OPTION
                            : (item.model || '')
                        }
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (item.provider === 'openrouter' && nextValue === OPENROUTER_CUSTOM_MODEL_OPTION) {
                            setStoredOpenRouterCustomModel(item.id, true);
                            setStoredApiModel(item.id, '');
                            return;
                          }
                          if (item.provider === 'openrouter') {
                            setStoredOpenRouterCustomModel(item.id, false);
                          }
                          setStoredApiModel(item.id, nextValue);
                        }}
                        className="text-xs rounded-md border border-white/10 bg-slate-900/60 text-white px-2 py-1 min-w-0"
                      >
                        {PROVIDER_MODEL_OPTIONS[item.provider || 'gemini']?.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        {item.provider === 'openrouter' ? (
                          <option value={OPENROUTER_CUSTOM_MODEL_OPTION}>Tự nhập model OpenRouter…</option>
                        ) : null}
                      </select>
                      {item.provider === 'openrouter' && storedOpenRouterCustomModels[item.id] ? (
                        <input
                          value={item.model || ''}
                          onChange={(e) => setStoredApiModel(item.id, e.target.value)}
                          className="text-xs rounded-md border border-white/10 bg-slate-900/60 text-white px-2 py-1 w-full sm:w-52"
                          placeholder="Model OpenRouter tùy chỉnh"
                        />
                      ) : null}
                      <input
                        value={item.baseUrl || ''}
                        onChange={(e) => setStoredApiBaseUrl(item.id, e.target.value)}
                        className="text-xs rounded-md border border-white/10 bg-slate-900/60 text-white px-2 py-1 w-full sm:w-32 tf-break-all"
                        placeholder="Base URL"
                      />
                      <button
                        onClick={() => activateApiEntry(item.id)}
                        className={cn(
                          'px-3 py-1 rounded-md text-xs font-semibold',
                          currentApiEntry?.id === item.id ? 'bg-emerald-600 text-white' : 'border border-white/10 text-white hover:bg-white/5',
                        )}
                      >
                        Dùng
                      </button>
                      <button onClick={() => testApiEntry(item.id)} className="px-3 py-1 rounded-md text-xs border border-white/10 text-white/80 hover:bg-white/5">
                        {currentApiEntry?.id === item.id ? 'Test hiện tại' : 'Test'}
                      </button>
                      <button onClick={() => deleteApiEntry(item.id)} className="p-2 rounded-md text-white/60 hover:text-red-400 hover:bg-red-900/30">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

