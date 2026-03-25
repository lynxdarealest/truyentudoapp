import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Check,
  CheckCheck,
  Download,
  KeyRound,
  Languages,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  addTmSegment,
  deleteGlossaryEntry,
  loadPhase1State,
  savePhase1State,
  setSegmentStatus,
  setSegmentTranslation,
  upsertGlossaryEntry,
} from './storage';
import type {
  Phase1GlossaryEntry,
  Phase1ProjectState,
  SegmentSuggestion,
  SegmentStatus,
} from './types';
import {
  buildTranslatedChapterText,
  hashSource,
  searchTmMatches,
  splitSourceToSegments,
  translateWithGlossary,
} from './translatorEngine';
import { loadPhase1ApiConfig, maskKey, reorderProviders, savePhase1ApiConfig, type ApiKeyProfile } from './apiConfig';
import { detectApiProvider, getUsageSnapshot, testApiConnection, type AiProvider } from '../phase0/aiGateway';
import { loadBudgetState, saveBudgetState, type BudgetState } from '../finops';

function newGlossaryRow(): Phase1GlossaryEntry {
  return {
    id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source: '',
    target: '',
    note: '',
    updatedAt: new Date().toISOString(),
  };
}

const STORY_CONTEXT_KEY = 'story_context_v1';
const GLOBAL_GLOSSARY_KEY = 'global_glossary_v1';

export default function Phase1App() {
  const [state, setState] = useState<Phase1ProjectState>(() => loadPhase1State());
  const [apiConfig, setApiConfig] = useState(() => loadPhase1ApiConfig());
  const [selectedSegmentId, setSelectedSegmentId] = useState('seg-1');
  const [draftTargetText, setDraftTargetText] = useState('');
  const [provider, setProvider] = useState('N/A');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [suggestions, setSuggestions] = useState<SegmentSuggestion[]>([]);
  const [parallelComparisons, setParallelComparisons] = useState<Array<{ provider: string; model: string; text: string; latencyMs: number }>>([]);
  const [failoverTrail, setFailoverTrail] = useState<string[]>([]);
  const [usage, setUsage] = useState(() => getUsageSnapshot());
  const [budget, setBudget] = useState<BudgetState>(() => loadBudgetState());
  const [connectionStatus, setConnectionStatus] = useState<{ state: 'idle' | 'testing' | 'live' | 'dead'; message: string }>({
    state: 'idle',
    message: 'Chưa test kết nối',
  });

  const [profileName, setProfileName] = useState('Default API');
  const [profileKey, setProfileKey] = useState('');
  const [profileCountry, setProfileCountry] = useState('');
  const [profileModel, setProfileModel] = useState('');
  const [profilePros, setProfilePros] = useState('');
  const [profileCons, setProfileCons] = useState('');
  const [budgetMonthly, setBudgetMonthly] = useState<number>(() => loadBudgetState().monthlyBudgetUsd);

  const [storyContext, setStoryContext] = useState(() => localStorage.getItem(STORY_CONTEXT_KEY) || '');
  const [globalGlossaryText, setGlobalGlossaryText] = useState(() => {
    try {
      const raw = localStorage.getItem(GLOBAL_GLOSSARY_KEY);
      if (!raw) return '';
      const rows = JSON.parse(raw) as Array<{ source?: string; target?: string }>;
      return rows.map((row) => `${row.source || ''} => ${row.target || ''}`).join('\n');
    } catch {
      return '';
    }
  });

  useEffect(() => {
    savePhase1State(state);
  }, [state]);

  useEffect(() => {
    savePhase1ApiConfig(apiConfig);
  }, [apiConfig]);

  useEffect(() => {
    localStorage.setItem(STORY_CONTEXT_KEY, storyContext);
  }, [storyContext]);

  useEffect(() => {
    const rows = globalGlossaryText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [source, target] = line.split(/\s*=>\s*/);
        return {
          source: (source || '').trim(),
          target: (target || '').trim(),
        };
      })
      .filter((row) => row.source && row.target);
    localStorage.setItem(GLOBAL_GLOSSARY_KEY, JSON.stringify(rows));
  }, [globalGlossaryText]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setUsage(getUsageSnapshot());
      setBudget(loadBudgetState());
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  const segments = useMemo(() => splitSourceToSegments(state.sourceDocument), [state.sourceDocument]);

  useEffect(() => {
    if (!segments.length) return;
    const exists = segments.some((seg) => seg.id === selectedSegmentId);
    if (!exists) {
      setSelectedSegmentId(segments[0].id);
    }
  }, [segments, selectedSegmentId]);

  const selectedSegment = useMemo(
    () => segments.find((seg) => seg.id === selectedSegmentId),
    [segments, selectedSegmentId],
  );

  useEffect(() => {
    if (!selectedSegment) {
      setDraftTargetText('');
      return;
    }
    setDraftTargetText(state.translations[selectedSegment.id]?.text || '');
  }, [selectedSegment, state.translations]);

  const tmMatches = useMemo(() => {
    if (!selectedSegment?.text) return [];
    return searchTmMatches(selectedSegment.text, state.tmSegments);
  }, [selectedSegment, state.tmSegments]);

  const activeViolations = useMemo(() => {
    if (!selectedSegment?.text || !draftTargetText.trim()) return [];
    const glossaryTerms = state.glossary
      .filter((row) => row.source.trim() && row.target.trim())
      .map((row) => ({ source: row.source.trim(), target: row.target.trim() }));

    return glossaryTerms
      .filter((term) => selectedSegment.text.includes(term.source) && !draftTargetText.includes(term.target))
      .map((term) => `Term "${term.source}" must be "${term.target}".`);
  }, [selectedSegment, draftTargetText, state.glossary]);

  const stats = useMemo(() => {
    const total = segments.length;
    let translated = 0;
    let reviewed = 0;

    segments.forEach((seg) => {
      const record = state.translations[seg.id];
      if (!record?.text?.trim()) return;
      translated += 1;
      if (record.status === 'reviewed') reviewed += 1;
    });

    return {
      total,
      translated,
      reviewed,
      pending: Math.max(total - translated, 0),
    };
  }, [segments, state.translations]);

  const onTranslateSegment = async () => {
    if (!selectedSegment?.text) return;
    setIsTranslating(true);

    try {
      const result = await translateWithGlossary({
        sourceText: selectedSegment.text,
        glossary: state.glossary,
        tone: state.tone,
        parallelMode: apiConfig.parallelMode,
      });

      setProvider(result.provider);
      setParallelComparisons(result.comparisons);
      setFailoverTrail(result.failoverTrail);
      if (result.usage) setUsage(result.usage);
      const mapped: SegmentSuggestion[] = result.alternatives.map((text, idx) => ({
        text,
        provider: result.provider,
        violations: result.violationsByOption[idx] || [],
      }));
      setSuggestions(mapped);

      const firstValid = mapped.find((s) => s.violations.length === 0) || mapped[0];
      if (firstValid) {
        setDraftTargetText(firstValid.text);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const onAddApiProfile = () => {
    const key = profileKey.trim();
    if (!key) return;
    const detected = detectApiProvider(key);
    const provider: ApiKeyProfile['provider'] = detected === 'unknown' || detected === 'mock' ? 'unknown' : detected;
    const profile: ApiKeyProfile = {
      id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: profileName.trim() || `API ${apiConfig.keyProfiles.length + 1}`,
      key,
      provider,
      country: profileCountry.trim(),
      model: profileModel.trim(),
      pros: profilePros.trim(),
      cons: profileCons.trim(),
      baseUrl: apiConfig.relayBaseUrl,
      isActive: true,
    };

    const nextProfiles = [profile, ...apiConfig.keyProfiles.map((p) => ({ ...p, isActive: false }))];
    const nextConfig = {
      ...apiConfig,
      keyProfiles: nextProfiles,
    };
    if (provider === 'openai') nextConfig.openaiKey = key;
    if (provider === 'anthropic') nextConfig.anthropicKey = key;
    if (provider === 'gemini') nextConfig.geminiKey = key;
    setApiConfig(nextConfig);

    const storedApiKeys = nextProfiles.map((item) => ({
      id: item.id,
      key: item.key,
      isActive: item.isActive,
      provider: item.provider,
      model: item.model,
      name: item.name,
      baseUrl: item.baseUrl,
    }));
    localStorage.setItem('api_keys', JSON.stringify(storedApiKeys));

    setProfileKey('');
    setProfileModel('');
    setProfileCountry('');
    setProfilePros('');
    setProfileCons('');
  };

  const onSetActiveProfile = (profile: ApiKeyProfile) => {
    const nextProfiles = apiConfig.keyProfiles.map((item) => ({ ...item, isActive: item.id === profile.id }));
    const nextConfig = {
      ...apiConfig,
      keyProfiles: nextProfiles,
    };

    if (profile.provider === 'openai') {
      nextConfig.openaiKey = profile.key;
    } else if (profile.provider === 'anthropic') {
      nextConfig.anthropicKey = profile.key;
    } else if (profile.provider === 'gemini') {
      nextConfig.geminiKey = profile.key;
    }

    setApiConfig(nextConfig);
    localStorage.setItem(
      'api_keys',
      JSON.stringify(
        nextProfiles.map((item) => ({
          id: item.id,
          key: item.key,
          isActive: item.isActive,
          provider: item.provider,
          model: item.model,
          name: item.name,
          baseUrl: item.baseUrl,
        })),
      ),
    );
  };

  const onTestConnection = async () => {
    const activeProfile = apiConfig.keyProfiles.find((p) => p.isActive) || apiConfig.keyProfiles[0];
    if (!activeProfile || activeProfile.provider === 'unknown') {
      setConnectionStatus({ state: 'dead', message: 'Chưa có key hợp lệ để test.' });
      return;
    }
    setConnectionStatus({ state: 'testing', message: 'Đang test kết nối...' });
    const result = await testApiConnection({
      provider: activeProfile.provider,
      key: activeProfile.key,
      baseUrl: apiConfig.relayBaseUrl,
    });
    if (result.ok) {
      setConnectionStatus({ state: 'live', message: `Live (${result.latencyMs}ms)` });
    } else {
      setConnectionStatus({ state: 'dead', message: `Dead: ${result.message}` });
    }
  };

  const onApplySuggestion = (option: SegmentSuggestion) => {
    if (!selectedSegment) return;
    if (option.violations.length > 0) return;

    setDraftTargetText(option.text);
    setState((prev) =>
      setSegmentTranslation(prev, selectedSegment.id, option.text, option.provider, 'translated'),
    );
  };

  const onSaveManualTranslation = (status: SegmentStatus = 'translated') => {
    if (!selectedSegment || !draftTargetText.trim()) return;
    if (activeViolations.length > 0) return;

    setState((prev) => setSegmentTranslation(prev, selectedSegment.id, draftTargetText.trim(), 'manual', status));
  };

  const onMarkReviewed = () => {
    if (!selectedSegment) return;
    setState((prev) => setSegmentStatus(prev, selectedSegment.id, 'reviewed'));
  };

  const onTranslateAllSegments = async () => {
    if (!segments.length) return;
    setIsTranslatingAll(true);
    setBulkProgress({ done: 0, total: segments.length });

    try {
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        const result = await translateWithGlossary({
          sourceText: seg.text,
          glossary: state.glossary,
          tone: state.tone,
          parallelMode: apiConfig.parallelMode,
        });

        const options = result.alternatives.map((text, idx) => ({
          text,
          violations: result.violationsByOption[idx] || [],
        }));

        const firstClean = options.find((o) => o.violations.length === 0);
        const chosen = firstClean || options[0];

        if (chosen?.text) {
          setState((prev) =>
            setSegmentTranslation(
              prev,
              seg.id,
              chosen.text,
              result.provider,
              chosen.violations.length ? 'pending' : 'translated',
            ),
          );
        }

        setBulkProgress({ done: i + 1, total: segments.length });
        if (result.usage) setUsage(result.usage);
      }
    } finally {
      setIsTranslatingAll(false);
    }
  };

  const onCommitToTm = () => {
    if (!selectedSegment?.text || !draftTargetText.trim() || activeViolations.length > 0) return;
    setState((prev) => {
      const withTranslation = setSegmentTranslation(prev, selectedSegment.id, draftTargetText.trim(), 'manual', 'translated');
      return addTmSegment(withTranslation, {
        id: `tm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: selectedSegment.text,
        target: draftTargetText.trim(),
        sourceHash: hashSource(selectedSegment.text),
        createdAt: new Date().toISOString(),
      });
    });
  };

  const onExportChapter = () => {
    const text = buildTranslatedChapterText(segments, state.translations);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phase1-translation-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onGlossaryChange = (index: number, key: keyof Phase1GlossaryEntry, value: string) => {
    const row = state.glossary[index];
    if (!row) return;

    setState((prev) =>
      upsertGlossaryEntry(prev, {
        ...row,
        [key]: value,
      }),
    );
  };

  const selectedRecord = selectedSegment ? state.translations[selectedSegment.id] : undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        const firstValid = suggestions.find((s) => s.violations.length === 0);
        if (firstValid) {
          event.preventDefault();
          onApplySuggestion(firstValid);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [suggestions, selectedSegment]);

  return (
    <div className="phase1-shell min-h-screen p-3 md:p-6">
      <div className="mx-auto max-w-[1450px] space-y-3">
        <header className="phase1-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="phase1-eyebrow">Phase 1 - Translator MVP (Completed)</p>
            <h1 className="phase1-title">Split-screen + Glossary Lock + AI 3 Options + TM + Bulk Translate</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="phase1-pill"><Languages className="h-4 w-4" /> zh-CN -&gt; vi-VN</span>
            <span className="phase1-pill"><BookMarked className="h-4 w-4" /> Glossary v{state.glossaryVersion}</span>
            <span className="phase1-pill"><Sparkles className="h-4 w-4" /> Provider: {provider}</span>
            <span className="phase1-pill"><KeyRound className="h-4 w-4" /> Order: {apiConfig.providerOrder.join(' > ')}</span>
          </div>
        </header>

        <section className="phase1-card p-3">
          <div className="phase1-stats-grid">
            <div className="phase1-stat"><p>Total Segments</p><strong>{stats.total}</strong></div>
            <div className="phase1-stat"><p>Translated</p><strong>{stats.translated}</strong></div>
            <div className="phase1-stat"><p>Reviewed</p><strong>{stats.reviewed}</strong></div>
            <div className="phase1-stat"><p>Pending</p><strong>{stats.pending}</strong></div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input
              className="phase1-input"
              value={state.tone}
              onChange={(e) => setState((prev) => ({ ...prev, tone: e.target.value }))}
              placeholder="Tone instruction"
            />
            <button className="phase1-primary-btn" onClick={onTranslateAllSegments} disabled={isTranslatingAll || !segments.length}>
              {isTranslatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isTranslatingAll ? `Translating ${bulkProgress.done}/${bulkProgress.total}` : 'Translate Whole Chapter'}
            </button>
            <button className="phase1-ghost-btn" onClick={onExportChapter} disabled={!stats.translated}>
              <Download className="h-4 w-4" /> Export TXT
            </button>
          </div>
        </section>

        <section className="phase1-layout">
          <aside className="phase1-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="phase1-section-title">Segments</h2>
              <span className="text-xs text-slate-500">{segments.length} items</span>
            </div>
            <textarea
              className="phase1-input mb-3 min-h-28"
              value={state.sourceDocument}
              onChange={(e) => setState((prev) => ({ ...prev, sourceDocument: e.target.value }))}
              placeholder="Paste source chapter here..."
            />
            <div className="phase1-segment-list">
              {segments.map((seg) => {
                const row = state.translations[seg.id];
                const status = row?.status || 'pending';
                return (
                  <button
                    key={seg.id}
                    className={`phase1-segment ${seg.id === selectedSegmentId ? 'is-active' : ''}`}
                    onClick={() => setSelectedSegmentId(seg.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500">{seg.id}</p>
                      <span className={`phase1-chip phase1-chip-${status}`}>{status}</span>
                    </div>
                    <p className="line-clamp-3 text-sm text-slate-700">{seg.text}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="space-y-3">
            <section className="phase1-card p-3">
              <div className="mb-2 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                <button className="phase1-primary-btn" onClick={onTranslateSegment} disabled={isTranslating || !selectedSegment}>
                  {isTranslating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isTranslating ? 'Translating...' : 'Translate Segment'}
                </button>
                <button className="phase1-ghost-btn" onClick={() => onSaveManualTranslation('translated')} disabled={!draftTargetText.trim() || activeViolations.length > 0}>
                  <Save className="h-4 w-4" /> Save Segment
                </button>
                <button className="phase1-ghost-btn" onClick={onMarkReviewed} disabled={!selectedRecord?.text || selectedRecord.status === 'reviewed'}>
                  <CheckCheck className="h-4 w-4" /> Mark Reviewed
                </button>
                <button className="phase1-ghost-btn" onClick={onCommitToTm} disabled={!draftTargetText.trim() || activeViolations.length > 0}>
                  <Save className="h-4 w-4" /> Save to TM
                </button>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Source</p>
                  <div className="phase1-box min-h-36 whitespace-pre-wrap">{selectedSegment?.text || 'No segment selected.'}</div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Target {selectedRecord?.status ? `(${selectedRecord.status})` : ''}
                  </p>
                  <textarea
                    className="phase1-input min-h-36"
                    value={draftTargetText}
                    onChange={(e) => setDraftTargetText(e.target.value)}
                    placeholder="Target translation..."
                  />
                </div>
              </div>

              {activeViolations.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
                  {activeViolations.map((v) => (
                    <p key={v}>{v}</p>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">
                  <Check className="mr-1 inline-block h-4 w-4" /> Glossary hard lock passed.
                </div>
              )}
            </section>

            <section className="phase1-card p-3">
              <h2 className="phase1-section-title mb-2">AI suggestions (Ctrl/Cmd + Enter to apply first valid option)</h2>
              <div className="grid gap-2 md:grid-cols-3">
                {suggestions.map((item, idx) => (
                  <div key={`s-${idx}`} className="phase1-alt">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Option {idx + 1}</p>
                    <p className="text-sm text-slate-700">{item.text}</p>
                    {item.violations.length > 0 ? (
                      <p className="mt-2 text-xs text-amber-700">Blocked: glossary violations</p>
                    ) : (
                      <button className="phase1-primary-btn mt-2" onClick={() => onApplySuggestion(item)}>
                        Apply
                      </button>
                    )}
                  </div>
                ))}
                {suggestions.length === 0 && <div className="phase1-box text-sm text-slate-500">No suggestions yet.</div>}
              </div>
              {parallelComparisons.length > 0 ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Parallel Comparison</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    {parallelComparisons.map((row, idx) => (
                      <div key={`${row.provider}-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                        <p><b>{row.provider}</b> · {row.model}</p>
                        <p>Latency: {row.latencyMs}ms</p>
                        <p className="mt-1 line-clamp-4">{row.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {failoverTrail.length > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <p className="font-semibold mb-1">Failover trail</p>
                  {failoverTrail.slice(-6).map((row, idx) => (
                    <p key={`trail-${idx}`}>• {row}</p>
                  ))}
                </div>
              ) : null}
            </section>
          </main>

          <aside className="space-y-3">
    <section className="phase1-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="phase1-section-title">API Control Panel</h2>
        <span className="text-xs text-slate-500">Smart routing + failover + FinOps</span>
      </div>
      <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600">Relay Socket URL</label>
                <input
                  className="phase1-input"
                  value={apiConfig.relayBaseUrl}
                  onChange={(e) => setApiConfig((prev) => ({ ...prev, relayBaseUrl: e.target.value }))}
                  placeholder="wss://relay2026.up.railway.app/?code=1234"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-slate-500">Định dạng chuẩn: <code>wss://relay2026.up.railway.app/?code=CODE</code> (CODE từ 4 đến 8 số).</p>
                  <a
                    href="https://relay2026.vercel.app/"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-fuchsia-600 px-3 py-1 text-xs font-semibold text-white hover:bg-fuchsia-700"
                  >
                    Mở web relay
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <button className="phase1-primary-btn" onClick={onTestConnection} disabled={connectionStatus.state === 'testing'}>
                    {connectionStatus.state === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      connectionStatus.state === 'live'
                        ? 'bg-emerald-100 text-emerald-700'
                        : connectionStatus.state === 'dead'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {connectionStatus.message}
                  </span>
                </div>

                <div className="phase1-box text-xs text-slate-700">
                  <p><b>Usage Counter (session)</b></p>
                  <p>Requests: {usage.sessionRequests}</p>
                  <p>Estimated Tokens: {usage.estimatedTokens}</p>
                  <p>By Provider: {Object.entries(usage.byProvider).map(([k, v]) => `${k}=${v}`).join(' | ') || 'N/A'}</p>
                </div>
                <div className="phase1-box text-xs text-slate-700">
                  <p><b>Budget (FinOps)</b></p>
                  <p>Monthly: ${budget.monthlyBudgetUsd.toFixed(2)}</p>
                  <p>Spent: ${budget.currentSpendUsd.toFixed(3)}</p>
                  <p>Remaining: ${Math.max(0, budget.monthlyBudgetUsd - budget.currentSpendUsd).toFixed(3)}</p>
                  <p>Status: {budget.isExhausted ? 'Exhausted (fallback to mock)' : 'Active'}</p>
                  {budget.lastChargeUsd > 0 ? (
                    <p>Last charge: ${budget.lastChargeUsd.toFixed(3)} @ {budget.lastChargeAt || 'n/a'}</p>
                  ) : null}
                </div>
                <div className="phase1-box text-xs text-slate-700 space-y-2">
                  <p className="font-semibold text-slate-800">Chỉnh ngân sách</p>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={budgetMonthly}
                    onChange={(e) => setBudgetMonthly(Number(e.target.value) || 0)}
                    className="phase1-input"
                    placeholder="Monthly budget (USD)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="phase1-ghost-btn"
                      onClick={() => {
                        const next = {
                          ...budget,
                          monthlyBudgetUsd: Math.max(1, budgetMonthly),
                          isExhausted: budget.currentSpendUsd >= Math.max(1, budgetMonthly),
                        };
                        setBudget(next);
                        saveBudgetState(next);
                      }}
                    >
                      Save budget
                    </button>
                    <button
                      className="phase1-ghost-btn"
                      onClick={() => {
                        const next = {
                          ...budget,
                          currentSpendUsd: 0,
                          isExhausted: false,
                          billingCycleStart: new Date().toISOString(),
                          billingCycleEnd: new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString(),
                        };
                        setBudget(next);
                        saveBudgetState(next);
                      }}
                    >
                      Reset cycle
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <input
                    className="phase1-input"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Tên API (ví dụ: OpenAI Chính)"
                  />
                  <input
                    className="phase1-input"
                    value={profileKey}
                    onChange={(e) => setProfileKey(e.target.value.trim())}
                    placeholder="Nhập API key (auto nhận diện provider)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="phase1-input"
                      value={profileCountry}
                      onChange={(e) => setProfileCountry(e.target.value)}
                      placeholder="Quốc gia / vùng"
                    />
                    <input
                      className="phase1-input"
                      value={profileModel}
                      onChange={(e) => setProfileModel(e.target.value)}
                      placeholder="Model gợi ý (tuỳ chọn)"
                    />
                  </div>
                  <input
                    className="phase1-input"
                    value={profilePros}
                    onChange={(e) => setProfilePros(e.target.value)}
                    placeholder="Ưu điểm"
                  />
                  <input
                    className="phase1-input"
                    value={profileCons}
                    onChange={(e) => setProfileCons(e.target.value)}
                    placeholder="Nhược điểm"
                  />
                  <button className="phase1-primary-btn" onClick={onAddApiProfile} disabled={!profileKey.trim()}>
                    <Plus className="h-4 w-4" /> Add API Profile
                  </button>
                </div>

                <div className="space-y-2">
                  {apiConfig.keyProfiles.map((row) => (
                    <div key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{row.name} · {row.provider}</p>
                        <button className="phase1-ghost-btn" onClick={() => onSetActiveProfile(row)}>
                          {row.isActive ? 'Active' : 'Set Active'}
                        </button>
                      </div>
                      <p>Key: {maskKey(row.key)}</p>
                      <p>Country: {row.country || 'N/A'}</p>
                      <p>Model: {row.model || 'Auto route'}</p>
                      <p>Pros: {row.pros || '-'}</p>
                      <p>Cons: {row.cons || '-'}</p>
                    </div>
                  ))}
                  {apiConfig.keyProfiles.length === 0 ? (
                    <div className="phase1-box text-sm text-slate-500">Chưa có API profile nào.</div>
                  ) : null}
                </div>

                <input
                  className="phase1-input"
                  type="password"
                  value={apiConfig.openaiKey}
                  onChange={(e) => setApiConfig((prev) => ({ ...prev, openaiKey: e.target.value.trim() }))}
                  placeholder="OpenAI API Key (sk-...)"
                />
                <input
                  className="phase1-input"
                  type="password"
                  value={apiConfig.anthropicKey}
                  onChange={(e) => setApiConfig((prev) => ({ ...prev, anthropicKey: e.target.value.trim() }))}
                  placeholder="Anthropic API Key"
                />
                <input
                  className="phase1-input"
                  type="password"
                  value={apiConfig.geminiKey}
                  onChange={(e) => setApiConfig((prev) => ({ ...prev, geminiKey: e.target.value.trim() }))}
                  placeholder="Gemini API Key"
                />
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={apiConfig.parallelMode}
                    onChange={(e) => setApiConfig((prev) => ({ ...prev, parallelMode: e.target.checked }))}
                  />
                  Parallel mode (gọi 2-3 API cùng lúc để so sánh)
                </label>
                <div className="phase1-box space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700">Provider Priority</p>
                  {[0, 1, 2].map((idx) => (
                    <div key={`order-${idx}`} className="grid grid-cols-[80px_1fr] items-center gap-2">
                      <span>Step {idx + 1}</span>
                      <select
                        className="phase1-input"
                        value={apiConfig.providerOrder[idx]}
                        onChange={(e) =>
                          setApiConfig((prev) =>
                            reorderProviders(prev, idx, e.target.value as AiProvider),
                          )
                        }
                      >
                        <option value="openai">openai</option>
                        <option value="anthropic">anthropic</option>
                        <option value="gemini">gemini</option>
                      </select>
                    </div>
                  ))}
                  <p>OpenAI: {maskKey(apiConfig.openaiKey)}</p>
                  <p>Anthropic: {maskKey(apiConfig.anthropicKey)}</p>
                  <p>Gemini: {maskKey(apiConfig.geminiKey)}</p>
                </div>
              </div>
            </section>

            <section className="phase1-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="phase1-section-title">Glossary CRUD</h2>
                <button className="phase1-ghost-btn" onClick={() => setState((prev) => upsertGlossaryEntry(prev, newGlossaryRow()))}>
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
              <div className="space-y-2">
                {state.glossary.map((row, idx) => (
                  <div key={row.id} className="rounded-lg border border-slate-200 p-2">
                    <input
                      className="phase1-input mb-1"
                      value={row.source}
                      onChange={(e) => onGlossaryChange(idx, 'source', e.target.value)}
                      placeholder="Source term"
                    />
                    <input
                      className="phase1-input mb-1"
                      value={row.target}
                      onChange={(e) => onGlossaryChange(idx, 'target', e.target.value)}
                      placeholder="Target term"
                    />
                    <input
                      className="phase1-input"
                      value={row.note || ''}
                      onChange={(e) => onGlossaryChange(idx, 'note', e.target.value)}
                      placeholder="Note"
                    />
                    <button className="phase1-danger-btn mt-2" onClick={() => setState((prev) => deleteGlossaryEntry(prev, row.id))}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="phase1-card p-3">
              <h2 className="phase1-section-title mb-2">Long-term Context</h2>
              <div className="space-y-2">
                <textarea
                  className="phase1-input min-h-24"
                  value={storyContext}
                  onChange={(e) => setStoryContext(e.target.value)}
                  placeholder="Story context: tóm tắt cốt truyện, mốc timeline, vai trò nhân vật..."
                />
                <textarea
                  className="phase1-input min-h-24"
                  value={globalGlossaryText}
                  onChange={(e) => setGlobalGlossaryText(e.target.value)}
                  placeholder={'Global Glossary mỗi dòng: term => bản dịch\\nví dụ: Thanh Long => Rồng Xanh'}
                />
                <div className="phase1-box text-xs text-slate-600">
                  Mọi request dịch sẽ tự đính kèm hai khối dữ liệu này vào system prompt để giữ nhất quán toàn bộ chương.
                </div>
              </div>
            </section>

            <section className="phase1-card p-3">
              <h2 className="phase1-section-title mb-2">Translation Memory (Exact + Fuzzy)</h2>
              <div className="space-y-2">
                {tmMatches.map((m) => (
                  <button
                    key={m.tmId}
                    className="phase1-alt"
                    onClick={() => {
                      setDraftTargetText(m.target);
                      if (selectedSegment) {
                        setState((prev) => setSegmentTranslation(prev, selectedSegment.id, m.target, 'tm', 'translated'));
                      }
                    }}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {m.matchType} ({Math.round(m.score * 100)}%)
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{m.source}</p>
                    <p className="mt-1 text-sm text-slate-700">{m.target}</p>
                  </button>
                ))}
                {tmMatches.length === 0 && <div className="phase1-box text-sm text-slate-500">No TM matches for this segment.</div>}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  );
}
