import React from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface AiOverlayProgress {
  completed: number;
  total: number;
}

interface AILoadingOverlayProps {
  isVisible: boolean;
  message: string;
  stageLabel?: string;
  detail?: string;
  progress?: AiOverlayProgress | null;
  timer: number;
  onCancel?: () => void;
}

export function AILoadingOverlay({
  isVisible,
  message,
  stageLabel,
  detail,
  progress,
  timer,
  onCancel,
}: AILoadingOverlayProps) {
  if (!isVisible) return null;
  const progressPercent = progress?.total
    ? Math.max(6, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
    : 0;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-12 rounded-[3rem] shadow-2xl flex flex-col items-center max-w-md w-full mx-4 text-center"
      >
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-indigo-100 rounded-full animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
            {stageLabel || 'Đang xử lý'}
          </span>
          {progress ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {Math.min(progress.completed, progress.total)}/{progress.total} bước
            </span>
          ) : null}
        </div>
        <h3 className="text-2xl font-serif font-bold text-slate-900 mb-2">{message || 'AI đang xử lý...'}</h3>
        <p className="text-slate-500 font-medium mb-4">{detail || 'Vui lòng đợi trong giây lát'}</p>
        {progress ? (
          <div className="mb-5 w-full space-y-2">
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs font-semibold text-slate-500">
              Tiến độ hiện tại được cập nhật theo từng lô/chương để bạn biết AI đang chạy tới đâu.
            </p>
          </div>
        ) : null}
        <div className="px-6 py-3 bg-indigo-50 rounded-2xl text-indigo-600 font-bold text-sm tracking-widest uppercase">
          Thời gian: {timer} giây
        </div>
        {onCancel ? (
          <button
            onClick={onCancel}
            className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-2 text-sm font-bold text-rose-600 hover:bg-rose-100"
          >
            Hủy tác vụ
          </button>
        ) : null}
      </motion.div>
    </div>
  );
}
