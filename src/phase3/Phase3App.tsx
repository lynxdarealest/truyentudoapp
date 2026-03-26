import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  Database,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { CURRENT_WRITER_VERSION, WRITER_RELEASE_NOTES } from './releaseHistory';
import {
  extractWiki,
  generateAutocomplete,
  generatePlotSuggestions,
  rewriteTone,
  runContextQuery,
} from './writerEngine';
import { loadUniverseWikiState, loadWriterWorkspaceState, saveUniverseWikiState, saveWriterWorkspaceState } from './storage';
import type {
  ContextAnswer,
  PlotSuggestion,
  TonePreset,
  ToneShiftResult,
  UniverseWikiState,
  WikiExtractionResult,
  WriterVariant,
  WriterWorkspaceState,
} from './types';
import { loadBudgetState, saveBudgetState } from '../finops';

type TaskMeta = {
  provider: string;
  model: string;
  fromCache: boolean;
  failoverTrail: string[];
};

type TabKey = 'autocomplete' | 'plot' | 'tone' | 'context' | 'wiki';

type ContextReadiness = {
  score: number;
  statusLabel: string;
  summary: string;
  checks: Array<{ label: string; ready: boolean; detail: string }>;
};

function mergeUniqueByName<T extends { name: string }>(oldRows: T[], newRows: T[]): T[] {
  const map = new Map<string, T>();
  [...oldRows, ...newRows].forEach((row) => {
    const key = row.name.trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, row);
      return;
    }
    const current = map.get(key)!;
    map.set(key, {
      ...current,
      ...row,
      aliases: Array.from(new Set([...(current as any).aliases || [], ...(row as any).aliases || []])),
    } as T);
  });
  return [...map.values()];
}

function mergeWikiState(current: UniverseWikiState, incoming: WikiExtractionResult): UniverseWikiState {
  return {
    characters: mergeUniqueByName(current.characters, incoming.characters),
    locations: mergeUniqueByName(current.locations, incoming.locations),
    items: mergeUniqueByName(current.items, incoming.items),
    timeline: [...current.timeline, ...incoming.timeline].slice(-200),
    updatedAt: new Date().toISOString(),
  };
}

const tonePresets: Array<{ value: TonePreset; label: string }> = [
  { value: 'u-am', label: 'U am' },
  { value: 'lang-man', label: 'Lang man' },
  { value: 'gay-gon', label: 'Gay gon' },
  { value: 'van-hoc', label: 'Van hoc' },
];

export default function Phase3App() {
  const [workspace, setWorkspace] = useState<WriterWorkspaceState>(() => loadWriterWorkspaceState());
  const [wikiStore, setWikiStore] = useState<UniverseWikiState>(() => loadUniverseWikiState());
  const [activeTab, setActiveTab] = useState<TabKey>('autocomplete');
  const [tonePreset, setTonePreset] = useState<TonePreset>('van-hoc');
  const [desiredWords, setDesiredWords] = useState<50 | 100 | 200>(100);
  const [toneInput, setToneInput] = useState('');
  const [runningTask, setRunningTask] = useState<TabKey | null>(null);
  const [taskMeta, setTaskMeta] = useState<TaskMeta | null>(null);

  const [autocompleteResult, setAutocompleteResult] = useState<WriterVariant[]>([]);
  const [plotResult, setPlotResult] = useState<PlotSuggestion | null>(null);
  const [toneResult, setToneResult] = useState<ToneShiftResult | null>(null);
  const [contextResult, setContextResult] = useState<ContextAnswer | null>(null);
  const [wikiResult, setWikiResult] = useState<WikiExtractionResult | null>(null);
  const [notice, setNotice] = useState('');
  const [budget, setBudget] = useState(() => loadBudgetState());
  const [budgetMonthly, setBudgetMonthly] = useState<number>(() => loadBudgetState().monthlyBudgetUsd);
  const [graphContext, setGraphContext] = useState<string[]>([]);
  const [bundleContext, setBundleContext] = useState('');

  useEffect(() => {
    saveWriterWorkspaceState(workspace);
  }, [workspace]);

  useEffect(() => {
    saveUniverseWikiState(wikiStore);
  }, [wikiStore]);

  useEffect(() => {
    const timer = window.setInterval(() => setBudget(loadBudgetState()), 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setBudgetMonthly(budget.monthlyBudgetUsd);
  }, [budget.monthlyBudgetUsd]);

  const contextBundlePreview = useMemo(() => {
    const sections = [
      `Objective: ${workspace.chapterObjective || '(empty)'}`,
      `Style profile: ${workspace.styleProfile || '(empty)'}`,
      `Recent chapters: ${workspace.recentChapterSummaries || '(empty)'}`,
      `Timeline notes: ${workspace.timelineNotes || '(empty)'}`,
      `Glossary terms: ${workspace.glossaryTerms || '(empty)'}`,
    ];
    return sections.join('\n');
  }, [workspace]);

  const contextReadiness = useMemo<ContextReadiness>(() => {
    const checks = [
      {
        label: 'Objective',
        ready: workspace.chapterObjective.trim().length >= 20,
        detail: workspace.chapterObjective.trim().length >= 20 ? 'Da co muc tieu chuong ro.' : 'Nen ghi ro muc tieu chuong hien tai.',
      },
      {
        label: 'Style profile',
        ready: workspace.styleProfile.trim().length >= 16,
        detail: workspace.styleProfile.trim().length >= 16 ? 'AI da co tone/style anchor.' : 'Them huong dan van phong de giam drift.',
      },
      {
        label: 'Recent summaries',
        ready: workspace.recentChapterSummaries.trim().length >= 120,
        detail: workspace.recentChapterSummaries.trim().length >= 120 ? 'Da co ngu canh chuong gan day.' : 'Tom tat chuong gan day de AI bam continuity tot hon.',
      },
      {
        label: 'Timeline',
        ready: workspace.timelineNotes.trim().length >= 40,
        detail: workspace.timelineNotes.trim().length >= 40 ? 'Timeline du de khoa logic co ban.' : 'Them moc thoi gian/su kien quan trong.',
      },
      {
        label: 'Glossary',
        ready: workspace.glossaryTerms.trim().length >= 8,
        detail: workspace.glossaryTerms.trim().length >= 8 ? 'Da co thuat ngu/ten rieng can giu.' : 'Them glossary neu truyen co ten rieng hoac thuat ngu lap lai.',
      },
      {
        label: 'Universe Wiki',
        ready: wikiStore.characters.length + wikiStore.locations.length + wikiStore.items.length + wikiStore.timeline.length >= 3,
        detail:
          wikiStore.characters.length + wikiStore.locations.length + wikiStore.items.length + wikiStore.timeline.length >= 3
            ? 'GraphRAG da co du lieu de neo ket qua.'
            : 'Nen trich xuat wiki hoac them tay de tang grounding.',
      },
    ];
    const readyCount = checks.filter((item) => item.ready).length;
    const score = Math.round((readyCount / checks.length) * 100);
    const statusLabel = score >= 84 ? 'AI grounded' : score >= 60 ? 'On dinh' : 'Can bo sung context';
    const summary =
      score >= 84
        ? 'Bo context hien tai du tot de AI giu continuity va glossary.'
        : score >= 60
          ? 'AI co the cho ket qua on, nhung van nen bo sung them timeline/wiki.'
          : 'Nen bo sung objective, tom tat hoac glossary truoc khi chay task lon.';
    return { score, statusLabel, summary, checks };
  }, [wikiStore, workspace]);

  const applyMeta = (meta: TaskMeta) => {
    setTaskMeta(meta);
    if (meta.failoverTrail.length) {
      setNotice(meta.failoverTrail[meta.failoverTrail.length - 1]);
    } else {
      setNotice(meta.fromCache ? 'Loaded from cache.' : `Provider: ${meta.provider} · Model: ${meta.model}`);
    }
  };

  const runAutocompleteTask = async () => {
    setRunningTask('autocomplete');
    setNotice('Dang tao 3 phuong an viet tiep...');
    try {
      const result = await generateAutocomplete({
        chapterObjective: workspace.chapterObjective,
        styleProfile: workspace.styleProfile,
        recentChapterSummaries: workspace.recentChapterSummaries,
        timelineNotes: workspace.timelineNotes,
        glossaryTerms: workspace.glossaryTerms,
        draftText: workspace.draftText,
        desiredWords,
        universe: wikiStore,
      });
      setAutocompleteResult(result.payload.variants);
      setGraphContext(result.graphContext || []);
      setBundleContext(result.bundleContext || '');
      applyMeta({
        provider: result.provider,
        model: result.model,
        fromCache: result.fromCache,
        failoverTrail: result.failoverTrail,
      });
    } finally {
      setRunningTask(null);
    }
  };

  const runPlotTask = async () => {
    setRunningTask('plot');
    setNotice('Dang tao huong plot...');
    try {
      const result = await generatePlotSuggestions({
        chapterObjective: workspace.chapterObjective,
        recentChapterSummaries: workspace.recentChapterSummaries,
        timelineNotes: workspace.timelineNotes,
        glossaryTerms: workspace.glossaryTerms,
        universe: wikiStore,
      });
      setPlotResult(result.payload);
      setGraphContext(result.graphContext || []);
      setBundleContext(result.bundleContext || '');
      applyMeta({
        provider: result.provider,
        model: result.model,
        fromCache: result.fromCache,
        failoverTrail: result.failoverTrail,
      });
    } finally {
      setRunningTask(null);
    }
  };

  const runToneTask = async () => {
    setRunningTask('tone');
    setNotice('Dang doi giong dieu...');
    try {
      const result = await rewriteTone({
        sourceText: toneInput || workspace.draftText,
        tonePreset,
        chapterObjective: workspace.chapterObjective,
        styleProfile: workspace.styleProfile,
        timelineNotes: workspace.timelineNotes,
        glossaryTerms: workspace.glossaryTerms,
        universe: wikiStore,
      });
      setToneResult(result.payload);
      applyMeta({
        provider: result.provider,
        model: result.model,
        fromCache: result.fromCache,
        failoverTrail: result.failoverTrail,
      });
    } finally {
      setRunningTask(null);
    }
  };

  const runContextTask = async () => {
    setRunningTask('context');
    setNotice('Dang truy van context...');
    try {
      const result = await runContextQuery({
        question: workspace.contextQuestion,
        chapterObjective: workspace.chapterObjective,
        styleProfile: workspace.styleProfile,
        recentChapterSummaries: workspace.recentChapterSummaries,
        timelineNotes: workspace.timelineNotes,
        glossaryTerms: workspace.glossaryTerms,
        universe: wikiStore,
      });
      setContextResult(result.payload);
      setGraphContext(result.graphContext || []);
      applyMeta({
        provider: result.provider,
        model: result.model,
        fromCache: result.fromCache,
        failoverTrail: result.failoverTrail,
      });
    } finally {
      setRunningTask(null);
    }
  };

  const runWikiTask = async () => {
    setRunningTask('wiki');
    setNotice('Dang trich xuat wiki...');
    try {
      const result = await extractWiki({
        sourceText: workspace.wikiSource || workspace.draftText,
      });
      setWikiResult(result.payload);
      applyMeta({
        provider: result.provider,
        model: result.model,
        fromCache: result.fromCache,
        failoverTrail: result.failoverTrail,
      });
    } finally {
      setRunningTask(null);
    }
  };

  const saveWikiExtraction = () => {
    if (!wikiResult) return;
    setWikiStore((prev) => mergeWikiState(prev, wikiResult));
    setNotice('Da luu ket qua trich xuat vao Universe Wiki local store.');
  };

  const updateBudgetMonthly = () => {
    const monthly = Math.max(1, Number(budgetMonthly) || 0);
    const next = {
      ...budget,
      monthlyBudgetUsd: monthly,
      isExhausted: budget.currentSpendUsd >= monthly,
      lastChargeNote: 'manual_budget_update',
    };
    setBudget(next);
    saveBudgetState(next);
    setNotice('Da cap nhat han muc FinOps (local).');
  };

  const resetBudgetCycle = () => {
    const now = new Date();
    const next = {
      ...budget,
      currentSpendUsd: 0,
      billingCycleStart: now.toISOString(),
      billingCycleEnd: new Date(now.getTime() + 28 * 24 * 3600 * 1000).toISOString(),
      isExhausted: false,
      lastChargeUsd: 0,
      lastChargeAt: '',
      lastChargeNote: 'reset_cycle',
    };
    setBudget(next);
    saveBudgetState(next);
    setNotice('Da reset chu ky FinOps 28 ngay (mock).');
  };

  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#1F2933] p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl border border-[#D9E2EC] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#52606D]">Phase 3 - Writer Pro</p>
              <h1 className="font-serif text-2xl font-bold text-[#1F2933]">Co-writer · Plot · Tone · Context · Wiki</h1>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#D9E2EC] px-3 py-1 bg-[#EEF2FF] text-[#4338CA]">
                Version {CURRENT_WRITER_VERSION}
              </span>
              <span className="rounded-full border border-[#D9E2EC] px-3 py-1 bg-[#DFF6F4] text-[#0F766E]">
                Universe chars: {wikiStore.characters.length}
              </span>
              <span className="rounded-full border border-[#D9E2EC] px-3 py-1 bg-[#FFF4ED] text-[#C2410C]">
                Timeline events: {wikiStore.timeline.length}
              </span>
              <span className="rounded-full border border-[#D9E2EC] px-3 py-1 bg-white text-[#52606D]">
                Budget ${budget.monthlyBudgetUsd.toFixed(2)} · Remain ${Math.max(0, budget.monthlyBudgetUsd - budget.currentSpendUsd).toFixed(2)}
              </span>
              {budget.isExhausted ? (
                <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-rose-700 font-semibold">
                  Budget exhausted (fallback)
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1.2fr_1fr] text-xs text-[#52606D]">
            <div className="flex flex-wrap items-center gap-2">
              <label className="font-semibold">Hạn mức tháng (USD)</label>
              <input
                className="rounded border border-[#D9E2EC] px-2 py-1 w-24"
                type="number"
                min={1}
                value={budgetMonthly}
                onChange={(e) => setBudgetMonthly(Number(e.target.value) || 0)}
              />
              <button
                onClick={updateBudgetMonthly}
                className="rounded bg-[#0F766E] px-3 py-1 font-semibold text-white disabled:opacity-60"
              >
                Lưu hạn mức
              </button>
              <button
                onClick={resetBudgetCycle}
                className="rounded border border-[#D9E2EC] px-3 py-1 font-semibold text-[#52606D]"
              >
                Reset chu kỳ 28 ngày
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <span>Cycle: {new Date(budget.billingCycleStart).toLocaleDateString()} → {new Date(budget.billingCycleEnd).toLocaleDateString()}</span>
              <span className="rounded-full bg-white border border-[#D9E2EC] px-2 py-1">
                Last charge: ${budget.lastChargeUsd.toFixed(3)} {budget.lastChargeNote ? `(${budget.lastChargeNote})` : ''}
              </span>
            </div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Context Bundle Preview</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-[#52606D]">{contextBundlePreview}</pre>
            </div>
            <div className="rounded-xl border border-[#D9E2EC] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Context Readiness</p>
                  <p className="mt-1 text-2xl font-bold text-[#0F766E]">{contextReadiness.score}%</p>
                </div>
                <span className="rounded-full bg-[#DFF6F4] px-3 py-1 text-xs font-semibold text-[#0F766E]">
                  {contextReadiness.statusLabel}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#52606D]">{contextReadiness.summary}</p>
              <div className="mt-3 space-y-2">
                {contextReadiness.checks.map((item) => (
                  <div key={item.label} className="rounded-lg border border-[#D9E2EC] bg-[#F6F7F4] px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span>{item.label}</span>
                      <span className={item.ready ? 'text-[#0F766E]' : 'text-[#C2410C]'}>
                        {item.ready ? 'OK' : 'Can them'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#52606D]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_1.35fr_0.8fr]">
          <aside className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Input Bundle</h2>
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-20"
              placeholder="Chapter objective"
              value={workspace.chapterObjective}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, chapterObjective: e.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-20"
              placeholder="Style profile"
              value={workspace.styleProfile}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, styleProfile: e.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-28"
              placeholder="Recent chapter summaries"
              value={workspace.recentChapterSummaries}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, recentChapterSummaries: e.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-20"
              placeholder="Timeline notes"
              value={workspace.timelineNotes}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, timelineNotes: e.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-20"
              placeholder="Glossary terms (must-use)"
              value={workspace.glossaryTerms}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, glossaryTerms: e.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-32"
              placeholder="Draft text"
              value={workspace.draftText}
              onChange={(e) => setWorkspace((prev) => ({ ...prev, draftText: e.target.value }))}
            />
          </aside>

          <main className="rounded-2xl border border-[#D9E2EC] bg-white p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('autocomplete')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'autocomplete' ? 'bg-[#0F766E] text-white' : 'bg-[#DFF6F4] text-[#0F766E]'}`}
              >
                <Sparkles className="mr-2 inline-block h-4 w-4" />
                Auto-complete
              </button>
              <button
                onClick={() => setActiveTab('plot')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'plot' ? 'bg-[#0F766E] text-white' : 'bg-[#DFF6F4] text-[#0F766E]'}`}
              >
                <BookOpen className="mr-2 inline-block h-4 w-4" />
                Plot
              </button>
              <button
                onClick={() => setActiveTab('tone')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'tone' ? 'bg-[#0F766E] text-white' : 'bg-[#DFF6F4] text-[#0F766E]'}`}
              >
                <Wand2 className="mr-2 inline-block h-4 w-4" />
                Tone
              </button>
              <button
                onClick={() => setActiveTab('context')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'context' ? 'bg-[#0F766E] text-white' : 'bg-[#DFF6F4] text-[#0F766E]'}`}
              >
                <Search className="mr-2 inline-block h-4 w-4" />
                Context Q/A
              </button>
              <button
                onClick={() => setActiveTab('wiki')}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'wiki' ? 'bg-[#0F766E] text-white' : 'bg-[#DFF6F4] text-[#0F766E]'}`}
              >
                <Database className="mr-2 inline-block h-4 w-4" />
                Wiki Extract
              </button>
            </div>

            {activeTab === 'autocomplete' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {[50, 100, 200].map((n) => (
                    <button
                      key={n}
                      onClick={() => setDesiredWords(n as 50 | 100 | 200)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold border ${desiredWords === n ? 'bg-[#0F766E] text-white border-[#0F766E]' : 'bg-white text-[#52606D] border-[#D9E2EC]'}`}
                    >
                      {n} words
                    </button>
                  ))}
                  <button
                    onClick={runAutocompleteTask}
                    disabled={runningTask === 'autocomplete'}
                    className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                  >
                    {runningTask === 'autocomplete' ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : <Bot className="h-4 w-4 inline-block mr-1" />}
                    Run
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {autocompleteResult.map((variant) => (
                    <div key={variant.mode} className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3">
                      <p className="text-xs uppercase tracking-wide text-[#52606D]">{variant.mode}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{variant.text}</p>
                      <p className="mt-2 text-xs text-[#52606D]">Confidence: {(variant.confidence * 100).toFixed(1)}%</p>
                      <button
                        onClick={() => setWorkspace((prev) => ({ ...prev, draftText: `${prev.draftText}\n\n${variant.text}`.trim() }))}
                        className="mt-2 rounded-lg border border-[#D9E2EC] px-2 py-1 text-xs"
                      >
                        Append to Draft
                      </button>
                    </div>
                  ))}
                  {!autocompleteResult.length && <p className="text-sm text-[#52606D]">Chua co ket qua.</p>}
                </div>
              </div>
            )}

            {activeTab === 'plot' && (
              <div className="space-y-3">
                <button
                  onClick={runPlotTask}
                  disabled={runningTask === 'plot'}
                  className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                >
                  {runningTask === 'plot' ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : <BookOpen className="h-4 w-4 inline-block mr-1" />}
                  Generate plot
                </button>
                {plotResult ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Directions</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {plotResult.directions.map((item, idx) => <li key={`d-${idx}`}>{item}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Twists</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {plotResult.twists.map((item, idx) => <li key={`t-${idx}`}>{item}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Risks</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {plotResult.risks.map((item, idx) => <li key={`r-${idx}`}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#52606D]">Chua co ket qua plot.</p>
                )}
              </div>
            )}

            {activeTab === 'tone' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={tonePreset}
                    onChange={(e) => setTonePreset(e.target.value as TonePreset)}
                    className="rounded-lg border border-[#D9E2EC] px-2 py-1 text-sm"
                  >
                    {tonePresets.map((tone) => (
                      <option key={tone.value} value={tone.value}>{tone.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={runToneTask}
                    disabled={runningTask === 'tone'}
                    className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                  >
                    {runningTask === 'tone' ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : <Wand2 className="h-4 w-4 inline-block mr-1" />}
                    Rephrase
                  </button>
                </div>
                <textarea
                  className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-32"
                  placeholder="Text for tone shift (blank = use draft)"
                  value={toneInput}
                  onChange={(e) => setToneInput(e.target.value)}
                />
                {toneResult ? (
                  <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3">
                    <p className="whitespace-pre-wrap text-sm">{toneResult.rewritten}</p>
                    {toneResult.notes.length > 0 && (
                      <div className="mt-2 text-xs text-[#52606D]">
                        {toneResult.notes.map((note, idx) => <p key={`n-${idx}`}>- {note}</p>)}
                      </div>
                    )}
                    <button
                      onClick={() => setWorkspace((prev) => ({ ...prev, draftText: toneResult.rewritten }))}
                      className="mt-2 rounded-lg border border-[#D9E2EC] px-2 py-1 text-xs"
                    >
                      Replace Draft
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-[#52606D]">Chua co ket qua tone shift.</p>
                )}
              </div>
            )}

            {activeTab === 'context' && (
              <div className="space-y-3">
                <textarea
                  className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-24"
                  placeholder="Question for context query"
                  value={workspace.contextQuestion}
                  onChange={(e) => setWorkspace((prev) => ({ ...prev, contextQuestion: e.target.value }))}
                />
                <button
                  onClick={runContextTask}
                  disabled={runningTask === 'context'}
                  className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                >
                  {runningTask === 'context' ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : <MessageSquare className="h-4 w-4 inline-block mr-1" />}
                  Ask context
                </button>
                {contextResult ? (
                  <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 space-y-2">
                    <p className="text-sm">{contextResult.answer}</p>
                    {contextResult.references.length > 0 && (
                      <div className="text-xs text-[#52606D] space-y-1">
                        {contextResult.references.map((ref, idx) => (
                          <p key={`ref-${idx}`}>[{ref.source}] {ref.lineHint}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#52606D]">Chua co ket qua context.</p>
                )}
              </div>
            )}

            {activeTab === 'wiki' && (
              <div className="space-y-3">
                <textarea
                  className="w-full rounded-xl border border-[#D9E2EC] p-2 text-sm min-h-36"
                  placeholder="Text source for wiki extraction (blank = use draft)"
                  value={workspace.wikiSource}
                  onChange={(e) => setWorkspace((prev) => ({ ...prev, wikiSource: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    onClick={runWikiTask}
                    disabled={runningTask === 'wiki'}
                    className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                  >
                    {runningTask === 'wiki' ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : <Database className="h-4 w-4 inline-block mr-1" />}
                    Extract wiki
                  </button>
                  <button
                    onClick={saveWikiExtraction}
                    disabled={!wikiResult}
                    className="rounded-lg border border-[#D9E2EC] px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                  >
                    Save to Universe
                  </button>
                </div>
                {wikiResult ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Characters</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {wikiResult.characters.map((item) => <li key={`c-${item.name}`}>{item.name}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Locations</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {wikiResult.locations.map((item) => <li key={`l-${item.name}`}>{item.name}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Items</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {wikiResult.items.map((item) => <li key={`i-${item.name}`}>{item.name}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#D9E2EC] p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Timeline</p>
                      <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                        {wikiResult.timeline.map((item, idx) => <li key={`t-${idx}`}>{item.title} ({item.when || 'N/A'})</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#52606D]">Chua co ket qua wiki extraction.</p>
                )}
              </div>
            )}
          </main>

          <aside className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Runtime</h2>
            {taskMeta ? (
              <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-xs space-y-1">
                <p><b>Provider:</b> {taskMeta.provider}</p>
                <p><b>Model:</b> {taskMeta.model}</p>
                <p><b>Cache:</b> {taskMeta.fromCache ? 'hit' : 'miss'}</p>
              </div>
            ) : (
              <p className="text-xs text-[#52606D]">Chua co task nao duoc chay.</p>
            )}
            {notice && (
              <div className="rounded-xl border border-[#D9E2EC] bg-white p-3 text-xs text-[#52606D]">
                {notice}
              </div>
            )}
            {taskMeta?.failoverTrail?.length ? (
              <div className="rounded-xl border border-[#D9E2EC] bg-white p-3 text-xs text-[#52606D]">
                <p className="font-semibold mb-1">Failover Trail</p>
                {taskMeta.failoverTrail.slice(-8).map((row, idx) => <p key={`f-${idx}`}>- {row}</p>)}
              </div>
            ) : null}
            {bundleContext ? (
              <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-xs text-[#52606D]">
                <p className="font-semibold mb-1">Hierarchical Context Used</p>
                <pre className="whitespace-pre-wrap text-[11px] leading-4">{bundleContext}</pre>
              </div>
            ) : null}
            {graphContext.length ? (
              <div className="rounded-xl border border-[#D9E2EC] bg-white p-3 text-xs text-[#52606D]">
                <p className="font-semibold mb-1">GraphRAG nodes/edges</p>
                <ul className="list-disc pl-4 space-y-1">
                  {graphContext.slice(0, 10).map((row, idx) => <li key={`g-${idx}`}>{row}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-xs text-[#52606D]">
              <p className="font-semibold">Universe Wiki Snapshot</p>
              <p>Characters: {wikiStore.characters.length}</p>
              <p>Locations: {wikiStore.locations.length}</p>
              <p>Items: {wikiStore.items.length}</p>
              <p>Timeline events: {wikiStore.timeline.length}</p>
              <p>Updated: {wikiStore.updatedAt === new Date(0).toISOString() ? 'N/A' : new Date(wikiStore.updatedAt).toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-[#D9E2EC] bg-white p-3 text-xs text-[#52606D]">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold uppercase tracking-wide">Lịch sử cập nhật</p>
                <span className="rounded-full bg-[#EEF2FF] px-2 py-1 text-[11px] font-semibold text-[#4338CA]">
                  {CURRENT_WRITER_VERSION}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {WRITER_RELEASE_NOTES.map((note) => (
                  <div key={note.version} className="rounded-lg border border-[#D9E2EC] bg-[#F6F7F4] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-[#1F2933]">v{note.version}</p>
                      <span>{note.dateLabel}</span>
                    </div>
                    <p className="mt-1 text-[#1F2933]">{note.title}</p>
                    <div className="mt-2 space-y-1">
                      {note.items.map((item, idx) => (
                        <p key={`${note.version}-${idx}`}>- {item}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
