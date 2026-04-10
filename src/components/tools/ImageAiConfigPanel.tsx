import React, { memo } from 'react';
import { Zap } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { IMAGE_AI_PROVIDER_META, IMAGE_AI_PROVIDER_ORDER } from '../../imageAiProviders';
import { useApiStore } from './useApiStore';

export const ImageAiConfigPanel = memo(function ImageAiConfigPanel() {
  const {
    imageAiEnabled,
    imageAiApiKey,
    imageAiStatusLabel,
    imageAiProvider,
    imageAiModel,
    setImageAiEnabled,
    setImageAiApiKey,
    setImageAiProvider,
    setImageAiModel,
    saveImageAiConfig,
  } = useApiStore((state) => ({
    imageAiEnabled: state.imageAi.imageAiEnabled,
    imageAiApiKey: state.imageAi.imageAiApiKey,
    imageAiStatusLabel: state.imageAi.imageAiStatusLabel,
    imageAiProvider: state.imageAi.imageAiProvider,
    imageAiModel: state.imageAi.imageAiModel,
    setImageAiEnabled: state.actions.setImageAiEnabled,
    setImageAiApiKey: state.actions.setImageAiApiKey,
    setImageAiProvider: state.actions.setImageAiProvider,
    setImageAiModel: state.actions.setImageAiModel,
    saveImageAiConfig: state.actions.saveImageAiConfig,
  }), shallow);

  const imageProviderMeta = IMAGE_AI_PROVIDER_META[imageAiProvider];
  const imageModelOptions = imageProviderMeta.models;

  return (
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
            onChange={(e) => setImageAiEnabled(e.target.checked)}
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
            onChange={(e) => setImageAiProvider(e.target.value as typeof imageAiProvider)}
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
            onChange={(e) => setImageAiModel(e.target.value)}
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
          onChange={(e) => setImageAiApiKey(e.target.value)}
          className="tf-input"
          placeholder={imageProviderMeta.keyPlaceholder}
        />
        <button onClick={saveImageAiConfig} className="tf-btn tf-btn-primary">
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
  );
});

