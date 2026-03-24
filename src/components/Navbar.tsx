import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Users, Settings, Download, Upload, Info, Feather, Database, Sun, Moon, Menu, ChevronLeft, Zap, Plus, Monitor, Smartphone } from 'lucide-react';
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
type ViewportMode = 'desktop' | 'mobile';

interface NavbarProps {
  currentView: string;
  setView: (view: 'stories' | 'characters' | 'tools' | 'api') => void;
  onShowHelp: () => void;
  onHome: () => void;
  onCreateStory: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  viewportMode: ViewportMode;
  onToggleViewportMode: () => void;
  profile: UiProfile;
}

export function Navbar({
  currentView,
  setView,
  onShowHelp,
  onHome,
  onCreateStory,
  themeMode,
  onToggleTheme,
  viewportMode,
  onToggleViewportMode,
  profile,
}: NavbarProps) {
  const computeAspectTag = () => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio >= 2.15) return 'tall'; // 19.5:9, 20:9
    if (ratio >= 1.95) return 'mid'; // 18:9
    if (ratio >= 1.74) return 'wide'; // 16:9
    return 'standard';
  };
  const navRef = useRef<HTMLElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const segmentsRef = useRef<HTMLDivElement | null>(null);
  const [navDensity, setNavDensity] = useState<'normal' | 'compact' | 'tiny'>('normal');
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);

  const isDark = themeMode === 'dark';
  const navItems = useMemo(
    () => [
      { key: 'stories', label: 'Trang chủ', icon: BookOpen, action: onHome },
      { key: 'characters', label: 'Nhân vật', icon: Users, action: () => setView('characters') },
      { key: 'api', label: 'API', icon: Zap, action: () => setView('api') },
      { key: 'tools', label: 'Công cụ', icon: Settings, action: () => setView('tools') },
    ] as const,
    [onHome, setView],
  );
  const quickActions = useMemo(
    () => [
      { key: 'create', label: 'Viết truyện mới', icon: Plus, action: onCreateStory, tone: 'brand' as const },
      { key: 'api', label: 'Mở thiết lập AI', icon: Zap, action: () => setView('api'), tone: 'neutral' as const },
      { key: 'help', label: 'Xem hướng dẫn', icon: Info, action: onShowHelp, tone: 'neutral' as const },
      { key: 'theme', label: isDark ? 'Chuyển nền sáng' : 'Chuyển nền tối', icon: isDark ? Sun : Moon, action: onToggleTheme, tone: 'neutral' as const },
      { key: 'viewport', label: viewportMode === 'mobile' ? 'Chế độ máy tính' : 'Chế độ điện thoại', icon: viewportMode === 'mobile' ? Monitor : Smartphone, action: onToggleViewportMode, tone: 'neutral' as const },
      { key: 'backup', label: 'Sao lưu dữ liệu', icon: Download, action: handleExport, tone: 'neutral' as const },
      { key: 'restore', label: 'Khôi phục dữ liệu', icon: Upload, action: handleImport, tone: 'neutral' as const },
    ],
    [handleExport, handleImport, isDark, onCreateStory, onShowHelp, onToggleTheme, onToggleViewportMode, setView, viewportMode],
  );

  const surfaceClass = isDark
    ? 'bg-slate-950/78 border-cyan-400/15 shadow-[0_12px_40px_rgba(8,145,178,0.18)]'
    : 'bg-gradient-to-r from-white/92 via-indigo-50/84 to-cyan-50/84 border-indigo-100 shadow-[0_8px_30px_rgba(79,70,229,0.10)]';

  const segmentedClass = isDark
    ? 'bg-slate-900/70 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
    : 'bg-white/82 border border-indigo-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]';

  const inactiveButtonClass = isDark
    ? 'text-slate-300 hover:text-white hover:bg-cyan-500/12'
    : 'text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/70';

  const activeButtonClass = isDark
    ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 shadow-lg shadow-cyan-500/30'
    : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30';

  const utilityButtonClass = isDark
    ? 'border-white/10 bg-white/5 text-slate-200 hover:text-white hover:border-cyan-400/35 hover:bg-cyan-500/12 hover:shadow-[0_0_20px_rgba(34,211,238,0.16)]'
    : 'border-indigo-100 bg-white/80 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-md';

  const dropdownClass = isDark
    ? 'border-white/10 bg-slate-950/96 text-slate-100 shadow-2xl'
    : 'border-slate-200 bg-white text-slate-700 shadow-xl';

  const dividerClass = isDark ? 'bg-white/10' : 'bg-slate-200';
  const titleClass = isDark ? 'text-slate-100' : 'text-slate-900';
  const subTextClass = isDark ? 'text-slate-400' : 'text-slate-400';

  useEffect(() => {
    if (!navRef.current) return;
    const updateDensity = () => {
      if (!navRef.current || !leftRef.current || !rightRef.current) return;
      const navWidth = navRef.current.clientWidth;
      const leftWidth = leftRef.current.scrollWidth;
      const rightWidth = rightRef.current.scrollWidth;
      const slack = navWidth - (leftWidth + rightWidth + 24);
      let next: 'normal' | 'compact' | 'tiny' = 'normal';
      if (navWidth < 720 || slack < 40) next = 'compact';
      if (navWidth < 600 || slack < -40) next = 'tiny';
      setNavDensity(next);
      navRef.current.dataset.density = next;
      navRef.current.dataset.aspect = computeAspectTag();
    };

    updateDensity();
    const observer = new ResizeObserver(() => updateDensity());
    observer.observe(navRef.current);
    if (leftRef.current) observer.observe(leftRef.current);
    if (rightRef.current) observer.observe(rightRef.current);
    if (segmentsRef.current) observer.observe(segmentsRef.current);
    window.addEventListener('orientationchange', updateDensity);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', updateDensity);
    };
  }, []);

  function handleExport() {
    storage.exportData();
  }

  function handleImport() {
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
  }

  return (
    <>
      <div className="app-shell__quick-rail fixed left-4 top-24 bottom-4 z-[60] flex items-start gap-3">
        <div
          className={cn(
            'origin-left h-full transition-all duration-300 ease-out overflow-hidden',
            showQuickActions ? 'w-64 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4',
          )}
        >
          <div
            className={cn(
              'h-full rounded-[28px] border backdrop-blur-xl p-3 flex flex-col',
              isDark
                ? 'border-cyan-400/15 bg-slate-950/72 shadow-[0_16px_48px_rgba(6,182,212,0.18)]'
                : 'border-white/70 bg-white/78 shadow-[0_20px_60px_rgba(99,102,241,0.18)]',
            )}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <div>
                <p className={cn('text-[11px] font-bold uppercase tracking-[0.25em]', isDark ? 'text-cyan-300/70' : 'text-indigo-500/70')}>
                  Bảng nhanh
                </p>
                <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>Các thao tác hay dùng</p>
              </div>
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {quickActions.map(({ key, label, icon: Icon, action, tone }) => (
                <button
                  key={key}
                  onClick={action}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5',
                    tone === 'brand'
                      ? isDark
                        ? 'bg-gradient-to-r from-cyan-500/88 to-blue-500/88 text-slate-950 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/35'
                        : 'bg-gradient-to-r from-teal-500 to-sky-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/35'
                      : isDark
                        ? 'bg-white/5 text-slate-200 hover:text-white hover:bg-cyan-500/12'
                        : 'bg-white/70 text-slate-700 hover:text-slate-900 hover:bg-white',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className={cn('mt-3 rounded-2xl px-4 py-3 text-xs leading-relaxed', isDark ? 'bg-white/5 text-slate-400' : 'bg-slate-50 text-slate-500')}>
              Mở khi cần, đóng khi không dùng để giao diện chính gọn hơn.
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowQuickActions((value) => !value)}
          className={cn(
            'mt-1 flex h-12 w-12 items-center justify-center rounded-2xl border backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5',
            utilityButtonClass,
            isDark ? 'shadow-[0_10px_32px_rgba(6,182,212,0.18)]' : 'shadow-[0_10px_32px_rgba(99,102,241,0.18)]',
          )}
          title={showQuickActions ? 'Thu gọn tác vụ nhanh' : 'Mở tác vụ nhanh'}
        >
          {showQuickActions ? <ChevronLeft className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <nav ref={navRef} data-density={navDensity} className={cn('app-navbar fixed top-0 left-0 right-0 z-50 flex h-20 items-center justify-between border-b px-6 backdrop-blur-xl navbar-appear', surfaceClass)}>
        <div ref={leftRef} className="app-navbar__left flex items-center gap-5 lg:gap-8">
          <div className="flex items-center gap-3 cursor-pointer group transition-all duration-300" onClick={onHome}>
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/30 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
              <Feather className="w-6 h-6 text-white" />
            </div>
            <span className={cn('text-xl font-serif font-bold tracking-tight hidden sm:block', titleClass)}>Truyện Tự Do</span>
          </div>

          <div ref={segmentsRef} className={cn('app-navbar__segments flex items-center gap-1 p-1 rounded-2xl', segmentedClass)}>
            {navItems.map(({ key, label, icon: Icon, action }) => (
              <button
                key={key}
                onClick={action}
                className={cn(
                  'flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 transform-gpu hover:-translate-y-0.5',
                  currentView === key ? activeButtonClass : inactiveButtonClass,
                )}
                title={label}
              >
                <Icon className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div ref={rightRef} className="app-navbar__right flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowDataMenu((v) => !v)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300',
                isDark ? 'text-slate-200 hover:bg-cyan-500/10 hover:text-white' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700',
              )}
              title="Dữ liệu"
            >
              <Database className="w-4 h-4" /> <span className="hidden md:inline">Dữ liệu</span>
            </button>
            {showDataMenu ? (
              <div className={cn('absolute right-0 mt-2 w-48 rounded-xl border z-50 p-1 backdrop-blur-xl', dropdownClass)}>
                <button
                  onClick={() => {
                    setShowDataMenu(false);
                    handleExport();
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                    isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100',
                  )}
                >
                  <Download className="w-4 h-4 inline mr-2" />
                  Sao lưu dữ liệu
                </button>
                <button
                  onClick={() => {
                    setShowDataMenu(false);
                    handleImport();
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                    isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100',
                  )}
                >
                  <Upload className="w-4 h-4 inline mr-2" />
                  Khôi phục dữ liệu
                </button>
              </div>
            ) : null}
          </div>
          <div className={cn('h-8 w-[1px] mx-1 md:mx-2', dividerClass)} />
          <button
            onClick={onToggleViewportMode}
            className={cn(
              'h-10 rounded-full border flex items-center justify-center gap-2 px-3 transition-all duration-300',
              utilityButtonClass,
            )}
            title={viewportMode === 'mobile' ? 'Chuyển sang bố cục máy tính' : 'Chuyển sang bố cục điện thoại'}
          >
            {viewportMode === 'mobile' ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
            <span className="hidden lg:inline text-xs font-bold">
              {viewportMode === 'mobile' ? 'Máy tính' : 'Điện thoại'}
            </span>
          </button>
          <button
            onClick={onToggleTheme}
            className={cn('w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300', utilityButtonClass)}
            title={themeMode === 'dark' ? 'Đổi sang giao diện sáng' : 'Đổi sang giao diện tối'}
          >
            {themeMode === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={onShowHelp}
            className={cn('w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300', utilityButtonClass)}
            title="Hướng dẫn"
          >
            <Info className="w-5 h-5" />
          </button>
          <div className={cn('h-8 w-[1px] mx-1 md:mx-2', dividerClass)} />
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className={cn('text-sm font-bold leading-none', titleClass)}>{profile.displayName}</p>
              <p className={cn('text-[10px] uppercase tracking-widest mt-1', subTextClass)}>Local Storage</p>
            </div>
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center overflow-hidden border shadow-sm transition-all duration-300 hover:scale-105', isDark ? 'bg-white/8 border-white/10' : 'bg-slate-100 border-indigo-100')}>
              <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
