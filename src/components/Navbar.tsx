import { useState } from 'react';
import { BookOpen, Users, Settings, Download, Upload, Info, Feather, Database, Sun, Moon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { storage } from '../storage';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UiProfile {
  displayName: string;
  avatarUrl: string;
}

type ThemeMode = 'light' | 'dark';

interface NavbarProps {
  currentView: string;
  setView: (view: 'stories' | 'characters' | 'tools') => void;
  onShowHelp: () => void;
  onHome: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  profile: UiProfile;
}

export function Navbar({
  currentView,
  setView,
  onShowHelp,
  onHome,
  themeMode,
  onToggleTheme,
  profile,
}: NavbarProps) {
  const [showDataMenu, setShowDataMenu] = useState(false);

  const handleExport = () => {
    storage.exportData();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse((event.target?.result as string) || '{}');
          storage.importData(data);
        } catch {
          alert('Lỗi khi đọc file backup.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <nav className="fixed top-0 left-0 right-0 h-20 bg-gradient-to-r from-white/90 via-indigo-50/80 to-cyan-50/80 backdrop-blur-xl border-b border-indigo-100 shadow-[0_8px_30px_rgba(79,70,229,0.10)] z-50 flex items-center justify-between px-6 navbar-appear">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3 cursor-pointer group transition-all duration-300" onClick={onHome}>
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
            <Feather className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-serif font-bold tracking-tight text-slate-900 hidden sm:block">Truyện Tự Do</span>
        </div>

        <div className="flex items-center gap-1 bg-white/80 p-1 rounded-2xl border border-indigo-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <button
            onClick={onHome}
            className={cn(
              'flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 transform-gpu hover:-translate-y-0.5',
              currentView === 'stories'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/70',
            )}
            title="Trang chủ"
          >
            <BookOpen className="w-4 h-4" /> <span className="hidden sm:inline">Trang chủ</span>
          </button>
          <button
            onClick={() => setView('characters')}
            className={cn(
              'flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 transform-gpu hover:-translate-y-0.5',
              currentView === 'characters'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/70',
            )}
            title="Nhân vật"
          >
            <Users className="w-4 h-4" /> <span className="hidden sm:inline">Nhân vật</span>
          </button>
          <button
            onClick={() => setView('tools')}
            className={cn(
              'flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 transform-gpu hover:-translate-y-0.5',
              currentView === 'tools'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/70',
            )}
            title="Công cụ"
          >
            <Settings className="w-4 h-4" /> <span className="hidden sm:inline">Công cụ</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            onClick={() => setShowDataMenu((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-all duration-300"
            title="Dữ liệu"
          >
            <Database className="w-4 h-4" /> <span className="hidden md:inline">Dữ liệu</span>
          </button>
          {showDataMenu ? (
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-1">
              <button
                onClick={() => {
                  setShowDataMenu(false);
                  handleExport();
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Download className="w-4 h-4 inline mr-2" />
                Sao lưu JSON
              </button>
              <button
                onClick={() => {
                  setShowDataMenu(false);
                  handleImport();
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Upload className="w-4 h-4 inline mr-2" />
                Khôi phục JSON
              </button>
            </div>
          ) : null}
        </div>
        <div className="h-8 w-[1px] bg-slate-200 mx-2" />
        <button
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-full border border-indigo-100 bg-white/80 flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-md transition-all duration-300"
          title={themeMode === 'dark' ? 'Đổi sang giao diện sáng' : 'Đổi sang giao diện tối'}
        >
          {themeMode === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="h-8 w-[1px] bg-slate-200 mx-2" />
        <button
          onClick={onShowHelp}
          className="w-10 h-10 rounded-full border border-indigo-100 bg-white/80 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-md transition-all duration-300"
          title="Hướng dẫn"
        >
          <Info className="w-5 h-5" />
        </button>
        <div className="h-8 w-[1px] bg-slate-200 mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold leading-none">{profile.displayName}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Local Storage</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-indigo-100 shadow-sm transition-all duration-300 hover:scale-105">
            <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
    </nav>
  );
}
