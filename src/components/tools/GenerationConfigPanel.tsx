import React, { memo } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { shallow } from 'zustand/shallow';
import type { GenerationConfig } from '../../generationConfig';
import { GENERATION_HINTS, type GenerationNumericField, useApiStore } from './useApiStore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GenerationConfigPanel = memo(function GenerationConfigPanel() {
  const {
    generationConfig,
    openGenerationHint,
    generationNumberDraft,
    setGenerationHint,
    setGenerationDraftField,
    commitGenerationDraftField,
    patchGenerationConfig,
    resetGenerationConfig,
  } = useApiStore((state) => ({
    generationConfig: state.generation.generationConfig,
    openGenerationHint: state.generation.openGenerationHint,
    generationNumberDraft: state.generation.generationNumberDraft,
    setGenerationHint: state.actions.setGenerationHint,
    setGenerationDraftField: state.actions.setGenerationDraftField,
    commitGenerationDraftField: state.actions.commitGenerationDraftField,
    patchGenerationConfig: state.actions.patchGenerationConfig,
    resetGenerationConfig: state.actions.resetGenerationConfig,
  }), shallow);

  const renderGenerationHelpButton = (hintKey: keyof typeof GENERATION_HINTS) => (
    <button
      type="button"
      onClick={() => setGenerationHint(openGenerationHint === hintKey ? null : hintKey)}
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold transition-colors',
        openGenerationHint === hintKey
          ? 'border-indigo-300 bg-indigo-500/25 text-indigo-100'
          : 'border-white/20 bg-slate-900/60 text-slate-300 hover:border-indigo-300/70 hover:text-white',
      )}
      title="Giải thích"
      aria-label={`Giải thích ${hintKey}`}
    >
      !
    </button>
  );

  const renderGenerationHint = (hintKey: keyof typeof GENERATION_HINTS) =>
    openGenerationHint === hintKey ? (
      <p className="text-xs text-indigo-100/90 mt-2 rounded-lg border border-indigo-300/30 bg-indigo-500/10 px-3 py-2">
        {GENERATION_HINTS[hintKey]}
      </p>
    ) : null;

  const handleGenerationNumberKeyDown = (field: GenerationNumericField, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitGenerationDraftField(field);
    event.currentTarget.blur();
  };

  return (
    <div className="tf-card p-6 space-y-4 border border-indigo-400/20">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Thông số sinh văn bản (Generation Config)</h3>
          <p className="text-sm text-slate-300 mt-1">
            Bố cục này tối ưu cho chỉnh nhanh: mỗi chức năng có nút <span className="font-semibold text-white">!</span> ở cuối để xem giải thích.
          </p>
        </div>
        <button onClick={resetGenerationConfig} className="tf-btn tf-btn-ghost">
          Khôi phục mặc định
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Nhiệt độ (Temperature)</span>
            {renderGenerationHelpButton('temperature')}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={generationNumberDraft.temperature}
            onChange={(e) => setGenerationDraftField('temperature', e.target.value)}
            onBlur={() => commitGenerationDraftField('temperature')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('temperature', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('temperature')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Top P</span>
            {renderGenerationHelpButton('topP')}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={generationNumberDraft.topP}
            onChange={(e) => setGenerationDraftField('topP', e.target.value)}
            onBlur={() => commitGenerationDraftField('topP')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('topP', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('topP')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Top K</span>
            {renderGenerationHelpButton('topK')}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={generationNumberDraft.topK}
            onChange={(e) => setGenerationDraftField('topK', e.target.value)}
            onBlur={() => commitGenerationDraftField('topK')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('topK', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('topK')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Kích thước phản hồi tối đa (Max Output Tokens)</span>
            {renderGenerationHelpButton('maxOutputTokens')}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={generationNumberDraft.maxOutputTokens}
            onChange={(e) => setGenerationDraftField('maxOutputTokens', e.target.value)}
            onBlur={() => commitGenerationDraftField('maxOutputTokens')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('maxOutputTokens', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('maxOutputTokens')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Kích thước Context (token)</span>
            {renderGenerationHelpButton('contextWindowTokens')}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={generationNumberDraft.contextWindowTokens}
            onChange={(e) => setGenerationDraftField('contextWindowTokens', e.target.value)}
            onBlur={() => commitGenerationDraftField('contextWindowTokens')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('contextWindowTokens', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('contextWindowTokens')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Hạt giống (Seed)</span>
            {renderGenerationHelpButton('seed')}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={generationNumberDraft.seed}
            onChange={(e) => setGenerationDraftField('seed', e.target.value)}
            onBlur={() => commitGenerationDraftField('seed')}
            onKeyDown={(e) => handleGenerationNumberKeyDown('seed', e)}
            className="tf-input mt-2"
          />
          {renderGenerationHint('seed')}
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">Suy nghĩ AI (Thinking / Reasoning)</span>
            {renderGenerationHelpButton('reasoningLevel')}
          </div>
          <select
            value={generationConfig.reasoningLevel}
            onChange={(e) => patchGenerationConfig({ reasoningLevel: e.target.value as GenerationConfig['reasoningLevel'] })}
            className="tf-input mt-2"
          >
            <option value="low">Thấp (Low)</option>
            <option value="medium">Trung bình (Medium)</option>
            <option value="high">Cao (High)</option>
          </select>
          {renderGenerationHint('reasoningLevel')}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.enableGeminiWebSearch}
                onChange={(e) => patchGenerationConfig({ enableGeminiWebSearch: e.target.checked })}
              />
              <span>Bật Google Web Search (Gemini Direct API)</span>
            </span>
            {renderGenerationHelpButton('enableGeminiWebSearch')}
          </div>
          {renderGenerationHint('enableGeminiWebSearch')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.showThinking}
                onChange={(e) => patchGenerationConfig({ showThinking: e.target.checked })}
              />
              <span>Hiện thinking</span>
            </span>
            {renderGenerationHelpButton('showThinking')}
          </div>
          {renderGenerationHint('showThinking')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.inlineImages}
                onChange={(e) => patchGenerationConfig({ inlineImages: e.target.checked })}
              />
              <span>Yêu cầu AI tạo ảnh minh hoạ (Inline Images)</span>
            </span>
            {renderGenerationHelpButton('inlineImages')}
          </div>
          {renderGenerationHint('inlineImages')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.enableStreaming}
                onChange={(e) => patchGenerationConfig({ enableStreaming: e.target.checked })}
              />
              <span>Phát trực tiếp (Streaming)</span>
            </span>
            {renderGenerationHelpButton('enableStreaming')}
          </div>
          {renderGenerationHint('enableStreaming')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.autoCritique}
                onChange={(e) => patchGenerationConfig({ autoCritique: e.target.checked })}
              />
              <span>Tự động phê bình & chỉnh sửa (Auto-Critique)</span>
            </span>
            {renderGenerationHelpButton('autoCritique')}
          </div>
          {renderGenerationHint('autoCritique')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.multiDraft}
                onChange={(e) => patchGenerationConfig({ multiDraft: e.target.checked })}
              />
              <span>Multi-Draft cho cảnh quan trọng</span>
            </span>
            {renderGenerationHelpButton('multiDraft')}
          </div>
          {renderGenerationHint('multiDraft')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.rateLimitDelay}
                onChange={(e) => patchGenerationConfig({ rateLimitDelay: e.target.checked })}
              />
              <span>Chống giới hạn tốc độ (Rate Limit Delay)</span>
            </span>
            {renderGenerationHelpButton('rateLimitDelay')}
          </div>
          {renderGenerationHint('rateLimitDelay')}
        </label>

        <label className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={generationConfig.fullThinkingPrompt}
                onChange={(e) => patchGenerationConfig({ fullThinkingPrompt: e.target.checked })}
              />
              <span>Thinking Prompt đầy đủ (12 bước)</span>
            </span>
            {renderGenerationHelpButton('fullThinkingPrompt')}
          </div>
          {renderGenerationHint('fullThinkingPrompt')}
        </label>
      </div>
    </div>
  );
});
