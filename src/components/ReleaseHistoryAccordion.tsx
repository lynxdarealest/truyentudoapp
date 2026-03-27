import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { ReleaseNote } from '../phase3/releaseHistory';

type Variant = 'dark' | 'light';

const variantStyles: Record<Variant, {
  panel: string;
  button: string;
  title: string;
  meta: string;
  body: string;
  badge: string;
  current: string;
}> = {
  dark: {
    panel: 'border border-white/10 bg-slate-900/40',
    button: 'hover:bg-white/5',
    title: 'text-white',
    meta: 'text-slate-400',
    body: 'text-slate-200',
    badge: 'bg-indigo-500/15 text-indigo-200',
    current: 'bg-emerald-500/15 text-emerald-200',
  },
  light: {
    panel: 'border border-[#D9E2EC] bg-[#F6F7F4]',
    button: 'hover:bg-white/80',
    title: 'text-[#1F2933]',
    meta: 'text-[#52606D]',
    body: 'text-[#1F2933]',
    badge: 'bg-[#EEF2FF] text-[#4338CA]',
    current: 'bg-emerald-100 text-emerald-700',
  },
};

export const ReleaseHistoryAccordion: React.FC<{
  notes: ReleaseNote[];
  currentVersion: string;
  variant?: Variant;
}> = ({ notes, currentVersion, variant = 'dark' }) => {
  const [expandedVersion, setExpandedVersion] = React.useState<string | null>(null);
  const styles = variantStyles[variant];

  return (
    <div className="space-y-3">
      {notes.map((note) => {
        const isExpanded = expandedVersion === note.version;
        const isCurrent = currentVersion === note.version;
        return (
          <div key={note.version} className={`rounded-2xl ${styles.panel}`}>
            <button
              onClick={() => setExpandedVersion((prev) => prev === note.version ? null : note.version)}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-4 text-left transition-colors ${styles.button}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-semibold ${styles.title}`}>v{note.version}</p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles.badge}`}>
                    {note.dateLabel}
                  </span>
                  {isCurrent ? (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles.current}`}>
                      Hiện tại
                    </span>
                  ) : null}
                </div>
                <p className={`mt-2 text-sm ${styles.meta}`}>{note.title}</p>
              </div>
              <ChevronRight className={`h-5 w-5 shrink-0 transition-transform ${styles.meta} ${isExpanded ? 'rotate-90' : ''}`} />
            </button>
            {isExpanded ? (
              <div className={`border-t px-4 pb-4 pt-3 text-sm ${styles.body} ${variant === 'dark' ? 'border-white/10' : 'border-[#D9E2EC]'}`}>
                <div className={`max-h-72 overflow-y-auto pr-1 space-y-2 ${variant === 'dark' ? 'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/15' : 'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300'}`}>
                  {note.items.map((item, idx) => (
                    <p key={`${note.version}-${idx}`}>- {item}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
