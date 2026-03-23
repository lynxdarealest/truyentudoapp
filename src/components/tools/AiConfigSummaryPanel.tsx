import { Zap } from 'lucide-react';

interface AiConfigSummaryPanelProps {
  currentConnectionName: string;
  currentModel: string;
  onOpenApi: () => void;
}

export function AiConfigSummaryPanel({
  currentConnectionName,
  currentModel,
  onOpenApi,
}: AiConfigSummaryPanelProps) {
  return (
    <div className="mb-8 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-emerald-50 rounded-2xl">
          <Zap className="w-6 h-6 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-xl font-serif font-bold">Cấu hình AI</h3>
          <p className="text-sm text-slate-500">Thiết lập kết nối AI và model trong mục API.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p>Kết nối hiện tại: <b>{currentConnectionName}</b></p>
          <p className="mt-1">Model hiện tại: <b>{currentModel}</b></p>
        </div>
        <button
          onClick={onOpenApi}
          className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-center hover:bg-emerald-700"
        >
          Mở mục API
        </button>
      </div>
    </div>
  );
}
