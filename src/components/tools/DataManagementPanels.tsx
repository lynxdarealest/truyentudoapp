import type { ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';

interface DataManagementPanelsProps {
  isImporting: boolean;
  isExporting: boolean;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onExportJson: () => void;
}

export function DataManagementPanels({
  isImporting,
  isExporting,
  onImportFile,
  onExportJson,
}: DataManagementPanelsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-50 rounded-2xl">
            <Upload className="w-6 h-6 text-indigo-600" />
          </div>
          <h3 className="text-xl font-serif font-bold">Nhập dữ liệu</h3>
        </div>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          Khôi phục dữ liệu người dùng từ tệp sao lưu <b>.json</b> (đúng định dạng đã xuất).
        </p>
        <label className="block w-full py-4 px-6 bg-slate-900 text-white text-center rounded-2xl font-bold cursor-pointer hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20">
          {isImporting ? 'Đang xử lý...' : 'Chọn file .json để nhập'}
          <input type="file" accept=".json" onChange={onImportFile} className="hidden" disabled={isImporting} />
        </label>
      </div>

      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-50 rounded-2xl">
            <Download className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-xl font-serif font-bold">Xuất dữ liệu</h3>
        </div>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          Lưu toàn bộ truyện và nhân vật về máy để sao lưu hoặc chuyển sang thiết bị khác.
        </p>
        <button
          onClick={onExportJson}
          disabled={isExporting}
          className="w-full py-4 px-6 bg-slate-100 text-slate-900 text-center rounded-2xl font-bold hover:bg-slate-200 transition-all"
        >
          {isExporting ? 'Đang chuẩn bị...' : 'Tải xuống bản sao lưu'}
        </button>
      </div>
    </div>
  );
}
