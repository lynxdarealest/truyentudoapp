import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Users, Settings, Sun, Moon, Menu, ChevronLeft, Zap, Plus, Library, History } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { storage } from '../storage';
import { notifyApp } from '../notifications';

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
  onHome: () => void;
  onCreateStory: () => void;
  onOpenPromptManager: () => void;
  onOpenReleaseHistory: () => void;
  onShowAuth: () => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  viewportMode: ViewportMode;
  onToggleViewportMode: () => void;
  profile: UiProfile;
  finopsWarning?: string;
  authEmail?: string;
  versionLabel?: string;
}

export function Navbar({
  currentView,
  setView,
  onHome,
  onCreateStory,
  onOpenPromptManager,
  onOpenReleaseHistory,
  onShowAuth,
  onLogout,
  onOpenProfile,
  themeMode,
  onToggleTheme,
  viewportMode,
  onToggleViewportMode,
  profile,
  finopsWarning,
  authEmail,
  versionLabel,
}: NavbarProps) {
  const viewportModeValue: ViewportMode = viewportMode;
  const isMobile = viewportModeValue === 'mobile';
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
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const isDark = themeMode === 'dark';
  const navItems = useMemo(
    () => [
      { key: 'stories', label: 'Trang chủ', icon: BookOpen, action: onHome },
      { key: 'api', label: 'API', icon: Zap, action: () => setView('api') },
      { key: 'tools', label: 'Công cụ', icon: Settings, action: () => setView('tools') },
      { key: 'characters', label: 'Nhân vật', icon: Users, action: () => setView('characters') },
    ] as const,
    [onHome, setView],
  );
  const quickActions = useMemo(
    () => [
      ...(isMobile
        ? [
            { key: 'home', label: 'Trang chủ', icon: BookOpen, action: onHome, tone: 'neutral' as const },
            { key: 'api', label: 'API', icon: Zap, action: () => setView('api'), tone: 'neutral' as const },
            { key: 'tools', label: 'Công cụ', icon: Settings, action: () => setView('tools'), tone: 'neutral' as const },
            { key: 'characters', label: 'Nhân vật', icon: Users, action: () => setView('characters'), tone: 'neutral' as const },
          ]
        : []),
      { key: 'create', label: 'Viết truyện mới', icon: Plus, action: onCreateStory, tone: 'brand' as const },
      { key: 'prompt', label: 'Kho prompt', icon: Library, action: onOpenPromptManager, tone: 'neutral' as const },
      { key: 'release', label: 'Cập nhật', icon: History, action: onOpenReleaseHistory, tone: 'neutral' as const },
      { key: 'theme', label: isDark ? 'Nền sáng' : 'Nền tối', icon: isDark ? Sun : Moon, action: onToggleTheme, tone: 'neutral' as const },
    ],
    [isDark, isMobile, onCreateStory, onHome, onOpenPromptManager, onOpenReleaseHistory, onToggleTheme, setView],
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

  const runAction = (fn: () => void) => {
    fn();
    if (isMobile) setShowQuickActions(false);
  };

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
  const activeIndex = navItems.findIndex((item) => item.key === currentView);
  const indicatorStyle = {
    width: `${100 / navItems.length}%`,
  };
  const isCompact = navDensity !== 'normal';

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
    const result = storage.exportData();
    notifyApp({
      tone: 'success',
      message: `Đã xuất backup ${result.filename}. Secret đã được loại khỏi file.`,
      timeoutMs: 5200,
    });
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
          const report = storage.importData(data);
          notifyApp({
            tone: 'success',
            message: `Đã khôi phục ${report.restoredSections.join(', ')}${report.skippedSections.length ? `. Bỏ qua ${report.skippedSections.join(', ')} vì chứa secret.` : ''}`,
            timeoutMs: 5200,
          });
          window.setTimeout(() => window.location.reload(), 600);
        } catch {
          notifyApp({ tone: 'error', message: 'Lỗi khi đọc hoặc khôi phục file backup.' });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleBackupJson() {
    const shouldExport = window.confirm('Nhấn OK để xuất backup JSON, hoặc Cancel để nhập backup JSON.');
    if (shouldExport) {
      handleExport();
      return;
    }
    handleImport();
  }

  return (
    <>
      {isMobile && (
      <div className={cn('app-shell__quick-rail fixed left-4 z-[60] flex items-start gap-3', isMobile ? 'top-4 bottom-4' : 'top-24 bottom-4')}>
        <div className="fixed right-4 top-4 z-[65]">
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu((v) => !v)}
              className={cn('w-12 h-12 rounded-full border shadow-lg overflow-hidden transition-all duration-300 hover:scale-105', isDark ? 'bg-white/8 border-white/10' : 'bg-white border-indigo-100')}
              title="Tài khoản"
            >
              <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            </button>
            {showProfileMenu ? (
              <div className={cn('absolute right-0 mt-2 w-56 rounded-2xl border z-50 p-2 backdrop-blur-xl', dropdownClass)}>
                <div className="px-3 py-2">
                  <p className="font-bold text-slate-800 truncate">{authEmail || 'Chưa đăng nhập'}</p>
                  {versionLabel ? (
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-500">{versionLabel}</p>
                  ) : null}
                </div>
                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    onShowAuth();
                  }}
                  className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                >
                  {authEmail ? 'Đổi tài khoản' : 'Đăng nhập / Đăng ký'}
                </button>
                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    handleBackupJson();
                  }}
                  className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                >
                  Backup JSON
                </button>
                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    onOpenProfile();
                  }}
                  className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                >
                  Đổi tên / Avatar
                </button>
                {authEmail ? (
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Đăng xuất
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
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
                {versionLabel ? (
                  <p className={cn('mt-1 text-[11px] font-semibold uppercase tracking-[0.16em]', isDark ? 'text-cyan-200' : 'text-indigo-600')}>
                    {versionLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto pr-1">
              {quickActions.map(({ key, label, icon: Icon, action, tone }) => (
                <button
                  key={key}
                  onClick={() => runAction(action)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5',
                    tone === 'brand'
                      ? isDark
                        ? 'bg-gradient-to-r from-cyan-500/80 to-blue-500/80 text-slate-950 shadow-lg shadow-cyan-500/25'
                        : 'bg-gradient-to-r from-teal-500 to-sky-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/35'
                      : key === currentView
                        ? (isDark
                            ? 'bg-emerald-500/20 text-white border border-emerald-400/40 shadow-emerald-500/20'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-emerald-100')
                        : isDark
                          ? 'bg-white/5 text-slate-200 hover:text-white hover:bg-cyan-500/12'
                          : 'bg-white/70 text-slate-700 hover:text-indigo-700 hover:bg-indigo-50/70',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
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
      )}

      {!isMobile && (
      <nav ref={navRef} data-density={navDensity} className={cn('app-navbar fixed top-0 left-0 right-0 z-50 flex h-20 items-center justify-between border-b px-6 backdrop-blur-xl navbar-appear', surfaceClass)}>
        <div ref={leftRef} className="app-navbar__left flex items-center gap-5 lg:gap-8">
          <div
            className="flex items-center gap-3 cursor-pointer group transition-all duration-300"
            onClick={onHome}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onHome();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <img
              src={themeMode === 'dark' ? '/logo-dark.jpg' : '/logo-light.jpg'}
              alt="TruyenForge"
              className="w-11 h-11 rounded-2xl shadow-lg shadow-indigo-900/40 group-hover:scale-105 transition-transform duration-300 object-cover"
            />
            <div className={cn('hidden sm:flex sm:flex-col sm:gap-1', isCompact && 'hidden')}>
              <span className={cn('text-xl font-serif font-bold tracking-tight', titleClass)}>TruyenForge</span>
              {versionLabel ? (
                <span className={cn('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', isDark ? 'bg-cyan-500/12 text-cyan-200' : 'bg-indigo-100 text-indigo-700')}>
                  {versionLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div ref={segmentsRef} className={cn('app-navbar__segments relative grid grid-cols-4 gap-1 p-1 rounded-2xl overflow-hidden flex-shrink-0', segmentedClass)}>
            <motion.div
              layout
              layoutId="navbar-indicator"
              className={cn(
                'absolute top-1 bottom-1 rounded-xl pointer-events-none',
                isDark ? 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/30' : 'bg-gradient-to-r from-emerald-500 to-green-500 shadow-lg shadow-emerald-400/30',
              )}
              style={indicatorStyle}
              animate={{
                left: `${Math.max(0, activeIndex) * (100 / navItems.length)}%`,
              }}
              transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.6 }}
            />
            {navItems.map(({ key, label, icon: Icon, action }) => (
              <button
                key={key}
                onClick={() => runAction(action)}
                className={cn(
                  'relative z-10 flex items-center justify-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 transform-gpu hover:-translate-y-0.5',
                  currentView === key ? activeButtonClass : inactiveButtonClass,
                )}
                title={label}
                aria-current={currentView === key}
              >
                <Icon className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div ref={rightRef} className="app-navbar__right flex items-center gap-3 flex-shrink-0">
          {finopsWarning ? (
            <span className="hidden lg:inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
              {finopsWarning}
            </span>
          ) : null}
          {!isCompact && (
            <>
              <button
                onClick={onOpenPromptManager}
                className={cn(
                  'hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300',
                  isDark ? 'text-cyan-200 border border-cyan-400/25 hover:bg-cyan-500/10' : 'text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100',
                )}
                title="Kho prompt"
              >
                <Library className="w-4 h-4" /> Prompt
              </button>
              <button
                onClick={onOpenReleaseHistory}
                className={cn(
                  'hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300',
                  isDark ? 'text-cyan-200 border border-cyan-400/25 hover:bg-cyan-500/10' : 'text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100',
                )}
                title="Lịch sử cập nhật"
              >
                <History className="w-4 h-4" /> Cập nhật
              </button>
            </>
          )}
          <div className={cn('app-navbar-divider h-8 w-[1px] mx-1 md:mx-2', dividerClass)} />
          <button
            onClick={onToggleTheme}
            className={cn('w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300', utilityButtonClass)}
            title={themeMode === 'dark' ? 'Đổi sang giao diện sáng' : 'Đổi sang giao diện tối'}
          >
            {themeMode === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className={cn('app-navbar-divider h-8 w-[1px] mx-1 md:mx-2', dividerClass)} />
          <div className="flex items-center gap-3">
            <div className={cn('text-right hidden sm:block whitespace-nowrap', isCompact && 'hidden')}>
              <p className={cn('text-sm font-bold leading-none', titleClass)}>{profile.displayName}</p>
              <p className={cn('text-[10px] uppercase tracking-widest mt-1', subTextClass)}>{authEmail || 'Chưa đăng nhập'}</p>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu((v) => !v)}
                className={cn('w-10 h-10 rounded-full flex items-center justify-center overflow-hidden border shadow-sm transition-all duration-300 hover:scale-105 flex-shrink-0', isDark ? 'bg-white/8 border-white/10' : 'bg-slate-100 border-indigo-100')}
                title="Tài khoản"
              >
                <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              </button>
              {showProfileMenu ? (
                <div className={cn('absolute right-0 mt-2 w-56 rounded-2xl border z-50 p-2 backdrop-blur-xl', dropdownClass)}>
                  <div className="px-3 py-2">
                    <p className="font-bold text-slate-800 truncate">{authEmail || 'Khách/Local'}</p>
                    {versionLabel ? (
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-500">{versionLabel}</p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      onShowAuth();
                    }}
                    className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                  >
                    {authEmail ? 'Đổi tài khoản' : 'Đăng nhập / Đăng ký'}
                  </button>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      handleBackupJson();
                    }}
                    className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                  >
                    Backup JSON
                  </button>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      onOpenProfile();
                    }}
                    className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors', isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100')}
                  >
                    Đổi tên / Avatar
                  </button>
                  {authEmail ? (
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Đăng xuất
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </nav>
      )}
    </>
  );
}
