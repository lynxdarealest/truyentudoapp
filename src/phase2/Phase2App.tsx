import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Sparkles, UserCheck, XCircle } from 'lucide-react';
import { glossaryToTerms, splitSourceToSegments } from '../phase1/translatorEngine';
import { loadPhase1State, savePhase1State, setSegmentTranslation } from '../phase1/storage';
import type { Phase1ProjectState } from '../phase1/types';
import { runConsistencyScan, runProofreadScan } from './qaEngine';
import { appendApprovalEvent, loadPhase2State, mergeIssuesFromScan, savePhase2State } from './storage';
import type { ChapterReviewStatus, Phase2Issue, Phase2SegmentSnapshot, Phase2WorkspaceState, QaIssueOrigin, QaIssueStatus, QaSeverity, QaTaskKey, QaTaskRunResult } from './types';
import { loadBudgetState } from '../finops';

type RunningTask = QaTaskKey | 'full' | null;

function buildPhase1Segments(state: Phase1ProjectState): Phase2SegmentSnapshot[] {
  return splitSourceToSegments(state.sourceDocument).map((segment) => {
    const row = state.translations[segment.id];
    return {
      id: segment.id,
      sourceText: segment.text,
      targetText: row?.text?.trim() || segment.text,
      translationStatus: row?.status || 'draft',
      provider: row?.provider || 'local-draft',
    };
  });
}

function buildCustomSegments(text: string): Phase2SegmentSnapshot[] {
  return splitSourceToSegments(text).map((segment) => ({
    id: segment.id,
    sourceText: '',
    targetText: segment.text,
    translationStatus: 'draft',
    provider: 'custom-input',
  }));
}

function severityRank(severity: QaSeverity): number {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[severity];
}

function severityClass(severity: QaSeverity): string {
  if (severity === 'CRITICAL') return 'bg-rose-100 text-rose-700';
  if (severity === 'HIGH') return 'bg-orange-100 text-orange-700';
  if (severity === 'MEDIUM') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function statusClass(status: QaIssueStatus): string {
  if (status === 'resolved') return 'bg-emerald-100 text-emerald-700';
  if (status === 'assigned') return 'bg-sky-100 text-sky-700';
  if (status === 'rejected') return 'bg-slate-200 text-slate-700';
  return 'bg-white text-slate-700';
}

function ensureSelectedIssue(state: Phase2WorkspaceState): Phase2WorkspaceState {
  const exists = state.selectedIssueId && state.issues.some((issue) => issue.id === state.selectedIssueId);
  return exists ? state : { ...state, selectedIssueId: state.issues[0]?.id || '' };
}

function applyTaskResult(state: Phase2WorkspaceState, task: QaTaskKey, result: QaTaskRunResult): Phase2WorkspaceState {
  const origin: QaIssueOrigin = task === 'proofread' ? 'proofreader' : 'consistency';
  const issues = mergeIssuesFromScan(state.issues, origin, result.payload.issues, state.defaultAssignee).sort((a, b) => {
    const severityCompare = severityRank(a.severity) - severityRank(b.severity);
    if (severityCompare !== 0) return severityCompare;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
  return ensureSelectedIssue({
    ...state,
    issues,
    lastProofreadScan:
      task === 'proofread'
        ? { task, provider: result.provider, model: result.model, fromCache: result.fromCache, durationMs: result.durationMs, issueCount: result.payload.issues.length, failoverTrail: result.failoverTrail, summary: result.payload.summary, runAt: new Date().toISOString() }
        : state.lastProofreadScan,
    lastConsistencyScan:
      task === 'consistency'
        ? { task, provider: result.provider, model: result.model, fromCache: result.fromCache, durationMs: result.durationMs, issueCount: result.payload.issues.length, failoverTrail: result.failoverTrail, summary: result.payload.summary, runAt: new Date().toISOString() }
        : state.lastConsistencyScan,
  });
}

export default function Phase2App() {
  const [phase1State, setPhase1State] = useState<Phase1ProjectState>(() => loadPhase1State());
  const [workspace, setWorkspace] = useState<Phase2WorkspaceState>(() => ensureSelectedIssue(loadPhase2State()));
  const [runningTask, setRunningTask] = useState<RunningTask>(null);
  const [severityFilter, setSeverityFilter] = useState<'ALL' | QaSeverity>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | QaIssueStatus>('ALL');
  const [originFilter, setOriginFilter] = useState<'ALL' | QaIssueOrigin>('ALL');
  const [searchText, setSearchText] = useState('');
  const [budget, setBudget] = useState(() => loadBudgetState());

  const glossary = useMemo(() => glossaryToTerms(phase1State.glossary), [phase1State.glossary]);
  const phase1Segments = useMemo(() => buildPhase1Segments(phase1State), [phase1State]);
  const phase1ChapterText = useMemo(() => phase1Segments.map((segment) => segment.targetText).filter(Boolean).join('\n\n'), [phase1Segments]);

  useEffect(() => {
    if (!workspace.customChapterText.trim() && phase1ChapterText.trim()) {
      setWorkspace((prev) => ({ ...prev, customChapterText: phase1ChapterText }));
    }
  }, [phase1ChapterText, workspace.customChapterText]);

  useEffect(() => {
    const timer = window.setInterval(() => setBudget(loadBudgetState()), 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    savePhase2State(workspace);
  }, [workspace]);

  const activeSegments = useMemo(
    () => (workspace.inputMode === 'phase1' ? phase1Segments : buildCustomSegments(workspace.customChapterText)),
    [phase1Segments, workspace.customChapterText, workspace.inputMode],
  );
  const activeChapterText = useMemo(() => activeSegments.map((segment) => segment.targetText).filter(Boolean).join('\n\n'), [activeSegments]);

  const stats = useMemo(() => {
    const total = workspace.issues.length;
    const open = workspace.issues.filter((issue) => issue.status === 'open' || issue.status === 'assigned').length;
    const resolved = workspace.issues.filter((issue) => issue.status === 'resolved').length;
    const blocking = workspace.issues.filter((issue) => (issue.status === 'open' || issue.status === 'assigned') && (issue.severity === 'HIGH' || issue.severity === 'CRITICAL')).length;
    const gain = total ? Math.min(40, Math.round((workspace.issues.filter((issue) => issue.status === 'resolved' && issue.suggestedText).length / total) * 40)) : 0;
    return { total, open, resolved, blocking, gain };
  }, [workspace.issues]);

  const filteredIssues = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return workspace.issues.filter((issue) => {
      if (severityFilter !== 'ALL' && issue.severity !== severityFilter) return false;
      if (statusFilter !== 'ALL' && issue.status !== statusFilter) return false;
      if (originFilter !== 'ALL' && issue.origin !== originFilter) return false;
      if (!query) return true;
      return [issue.title, issue.description, issue.evidence, issue.segmentId || ''].join(' ').toLowerCase().includes(query);
    });
  }, [originFilter, searchText, severityFilter, statusFilter, workspace.issues]);

  const selectedIssue = useMemo(
    () => workspace.issues.find((issue) => issue.id === workspace.selectedIssueId) || filteredIssues[0] || null,
    [filteredIssues, workspace.issues, workspace.selectedIssueId],
  );

  useEffect(() => {
    if (filteredIssues.length && !filteredIssues.some((issue) => issue.id === workspace.selectedIssueId)) {
      setWorkspace((prev) => ({ ...prev, selectedIssueId: filteredIssues[0].id }));
    }
  }, [filteredIssues, workspace.selectedIssueId]);

  const runTask = async (task: RunningTask) => {
    if (!activeSegments.length || !activeChapterText.trim()) return;
    setRunningTask(task);
    try {
      let nextState = workspace;
      if (task === 'proofread' || task === 'full') {
        nextState = applyTaskResult(nextState, 'proofread', await runProofreadScan({ segments: activeSegments, glossary, chapterText: activeChapterText }));
      }
      if (task === 'consistency' || task === 'full') {
        nextState = applyTaskResult(nextState, 'consistency', await runConsistencyScan({ segments: activeSegments, glossary, chapterText: activeChapterText }));
      }
      setWorkspace(nextState);
    } finally {
      setRunningTask(null);
    }
  };

  const setIssueStatus = (issueId: string, status: QaIssueStatus) => {
    setWorkspace((prev) => ({
      ...prev,
      issues: prev.issues.map((issue) => (issue.id === issueId ? { ...issue, status, updatedAt: new Date().toISOString() } : issue)),
    }));
  };

  const assignIssue = (issueId: string, assignee: string) => {
    setWorkspace((prev) => ({
      ...prev,
      issues: prev.issues.map((issue) => (issue.id === issueId ? { ...issue, assignee, status: 'assigned', updatedAt: new Date().toISOString() } : issue)),
    }));
  };

  const applyFix = (issue: Phase2Issue) => {
    const suggested = issue.suggestedText?.trim();
    if (!suggested) return;
    if (workspace.inputMode === 'phase1' && issue.segmentId) {
      const nextPhase1 = setSegmentTranslation(phase1State, issue.segmentId, suggested, `qa:${issue.origin}`, 'translated');
      savePhase1State(nextPhase1);
      setPhase1State(nextPhase1);
    } else if (issue.currentText?.trim()) {
      setWorkspace((prev) => ({ ...prev, customChapterText: prev.customChapterText.replace(issue.currentText || '', suggested) }));
    }
    setIssueStatus(issue.id, 'resolved');
  };

  const transitionChapter = (nextStatus: ChapterReviewStatus, actor: string, note: string) => {
    setWorkspace((prev) => appendApprovalEvent({ ...prev, chapterStatus: nextStatus }, `Chapter -> ${nextStatus}`, actor, note));
  };

  const canMoveToReview = Boolean(workspace.lastProofreadScan || workspace.lastConsistencyScan) && !!activeChapterText.trim();
  const canApproveReviewed = workspace.chapterStatus === 'IN_REVIEW' && stats.blocking === 0;
  const canPublish = workspace.chapterStatus === 'REVIEWED' && stats.open === 0;

  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#1F2933] p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="rounded-2xl border border-[#D9E2EC] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#52606D]">Phase 2 - QA va hau ky</p>
              <h1 className="font-serif text-2xl font-bold">Quality Center · Assignment Workflow · Approval Pipeline</h1>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#D9E2EC] bg-[#DFF6F4] px-3 py-1 text-[#0F766E]">Glossary v{phase1State.glossaryVersion}</span>
              <span className="rounded-full border border-[#D9E2EC] bg-white px-3 py-1 text-[#52606D]">Status: {workspace.chapterStatus}</span>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ['Total Issues', `${stats.total}`, 'text-[#1F2933]'],
            ['Blocking', `${stats.blocking}`, 'text-[#B91C1C]'],
            ['Resolved', `${stats.resolved}`, 'text-[#2F855A]'],
            ['KPI Gain', `${stats.gain}%`, stats.gain >= 30 ? 'text-[#0F766E]' : 'text-[#C2410C]'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl border border-[#D9E2EC] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#52606D]">{label}</p>
              <p className={`mt-2 text-3xl font-bold ${tone}`}>{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.05fr_0.95fr]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">QA Control</h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#52606D]">
                <span className="rounded-full border border-[#D9E2EC] px-2 py-1">Budget ${budget.monthlyBudgetUsd.toFixed(2)}</span>
                <span className={`rounded-full border px-2 py-1 ${budget.isExhausted ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {budget.isExhausted ? 'Exhausted' : `Remain $${Math.max(0, budget.monthlyBudgetUsd - budget.currentSpendUsd).toFixed(2)}`}
                </span>
                {budget.lastChargeUsd > 0 ? (
                  <span className="rounded-full border border-[#D9E2EC] px-2 py-1">
                    Last ${budget.lastChargeUsd.toFixed(3)}
                  </span>
                ) : null}
                <button onClick={() => setPhase1State(loadPhase1State())} className="rounded-lg border border-[#D9E2EC] px-3 py-1.5 text-[11px] font-semibold">
                  <RefreshCw className="mr-1 inline-block h-4 w-4" />
                  Reload
                </button>
              </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setWorkspace((prev) => ({ ...prev, inputMode: 'phase1' }))} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${workspace.inputMode === 'phase1' ? 'border-[#0F766E] bg-[#DFF6F4] text-[#0F766E]' : 'border-[#D9E2EC] bg-white text-[#52606D]'}`}>Phase1</button>
                <button onClick={() => setWorkspace((prev) => ({ ...prev, inputMode: 'custom' }))} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${workspace.inputMode === 'custom' ? 'border-[#0F766E] bg-[#DFF6F4] text-[#0F766E]' : 'border-[#D9E2EC] bg-white text-[#52606D]'}`}>Custom</button>
              </div>
              {workspace.inputMode === 'custom' ? (
                <textarea className="w-full rounded-xl border border-[#D9E2EC] p-3 text-sm min-h-[180px]" value={workspace.customChapterText} onChange={(e) => setWorkspace((prev) => ({ ...prev, customChapterText: e.target.value }))} placeholder="Dan chuong can QA vao day..." />
              ) : (
                <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-xs text-[#52606D]">
                  <p>Segments: {phase1Segments.length}</p>
                  <p>Glossary terms: {glossary.length}</p>
                  <p>Target source: Phase 1 translated chapter</p>
                </div>
              )}
              <div className="grid gap-2">
                <button onClick={() => runTask('full')} disabled={runningTask !== null} className="rounded-xl bg-[#0F766E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
                  {runningTask === 'full' ? <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 inline-block h-4 w-4" />}
                  Run QA
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => runTask('proofread')} disabled={runningTask !== null} className="rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold disabled:opacity-70">
                    {runningTask === 'proofread' ? <Loader2 className="mr-1 inline-block h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 inline-block h-4 w-4" />}
                    Proofread
                  </button>
                  <button onClick={() => runTask('consistency')} disabled={runningTask !== null} className="rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold disabled:opacity-70">
                    {runningTask === 'consistency' ? <Loader2 className="mr-1 inline-block h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 inline-block h-4 w-4" />}
                    Consistency
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Filters</h2>
              <input className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm" placeholder="Search issue..." value={searchText} onChange={(e) => setSearchText(e.target.value)} />
              <select className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as 'ALL' | QaSeverity)}>
                <option value="ALL">All severities</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
              </select>
              <select className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | QaIssueStatus)}>
                <option value="ALL">All statuses</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option>
              </select>
              <select className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm" value={originFilter} onChange={(e) => setOriginFilter(e.target.value as 'ALL' | QaIssueOrigin)}>
                <option value="ALL">All origins</option><option value="proofreader">Proofreader</option><option value="consistency">Consistency</option>
              </select>
            </section>
          </aside>

          <main className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Issue Queue</h2>
                <p className="text-xs text-[#52606D]">{filteredIssues.length} item(s) match current filters</p>
              </div>
              <span className="rounded-full border border-[#D9E2EC] px-3 py-1 text-xs text-[#52606D]">Open {stats.open} · Blocking {stats.blocking}</span>
            </div>
            <div className="space-y-2 max-h-[820px] overflow-y-auto pr-1">
              {filteredIssues.map((issue) => (
                <button key={issue.id} onClick={() => setWorkspace((prev) => ({ ...prev, selectedIssueId: issue.id }))} className={`w-full rounded-2xl border p-3 text-left ${issue.id === selectedIssue?.id ? 'border-[#0F766E] bg-[#DFF6F4]' : 'border-[#D9E2EC] bg-[#F6F7F4] hover:border-[#0F766E]'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${severityClass(issue.severity)}`}>{issue.severity}</span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(issue.status)}`}>{issue.status}</span>
                      <span className="rounded-full border border-[#D9E2EC] bg-white px-2 py-1 text-[11px] font-semibold text-[#52606D]">{issue.origin}</span>
                    </div>
                    <span className="text-[11px] text-[#52606D]">{issue.segmentId || 'chapter'}</span>
                  </div>
                  <p className="mt-2 font-semibold">{issue.title}</p>
                  <p className="mt-1 text-sm text-[#52606D] line-clamp-2">{issue.description}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-[#52606D]"><span>Assignee: {issue.assignee}</span><span>{formatOriginLabel(issue.origin)}</span></div>
                </button>
              ))}
              {!filteredIssues.length && <div className="rounded-2xl border border-dashed border-[#D9E2EC] p-5 text-sm text-[#52606D]">Khong co issue nao theo bo loc hien tai.</div>}
            </div>
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Issue Detail</h2>
              {selectedIssue ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${severityClass(selectedIssue.severity)}`}>{selectedIssue.severity}</span>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(selectedIssue.status)}`}>{selectedIssue.status}</span>
                    <span className="rounded-full border border-[#D9E2EC] px-2 py-1 text-[11px] font-semibold text-[#52606D]">{selectedIssue.type}</span>
                  </div>
                  <div><p className="text-lg font-semibold">{selectedIssue.title}</p><p className="mt-1 text-sm text-[#52606D]">{selectedIssue.description}</p></div>
                  <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Evidence</p><p className="mt-2 whitespace-pre-wrap">{selectedIssue.evidence}</p></div>
                  {selectedIssue.currentText ? <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#52606D]">Current Text</p><p className="mt-2 whitespace-pre-wrap">{selectedIssue.currentText}</p></div> : null}
                  {selectedIssue.suggestedText ? <div className="rounded-xl border border-[#D9E2EC] bg-[#FFF4ED] p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-[#C2410C]">Suggested Fix</p><p className="mt-2 whitespace-pre-wrap">{selectedIssue.suggestedText}</p></div> : null}
                  <select className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm" value={selectedIssue.assignee} onChange={(e) => assignIssue(selectedIssue.id, e.target.value)}>
                    {workspace.assigneePool.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => assignIssue(selectedIssue.id, selectedIssue.assignee)} className="rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold"><UserCheck className="mr-1 inline-block h-4 w-4" />Assign</button>
                    <button onClick={() => setIssueStatus(selectedIssue.id, 'resolved')} className="rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold"><CheckCircle2 className="mr-1 inline-block h-4 w-4" />Resolve</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setIssueStatus(selectedIssue.id, 'rejected')} className="rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold"><XCircle className="mr-1 inline-block h-4 w-4" />Reject</button>
                    <button onClick={() => applyFix(selectedIssue)} disabled={!selectedIssue.suggestedText} className="rounded-xl bg-[#0F766E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="mr-1 inline-block h-4 w-4" />Apply Fix</button>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-[#D9E2EC] p-5 text-sm text-[#52606D]">Chon mot issue de xem chi tiet.</div>
              )}
            </section>

            <section className="rounded-2xl border border-[#D9E2EC] bg-white p-4 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#52606D]">Approval Pipeline</h2>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {(['DRAFT', 'IN_REVIEW', 'REVIEWED', 'PUBLISHED'] as ChapterReviewStatus[]).map((status) => (
                  <div key={status} className={`rounded-xl border px-2 py-2 text-center font-semibold ${workspace.chapterStatus === status ? 'border-[#0F766E] bg-[#DFF6F4] text-[#0F766E]' : 'border-[#D9E2EC] bg-white text-[#52606D]'}`}>{status}</div>
                ))}
              </div>
              <div className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-sm text-[#52606D]">
                <p>Blocking issues: {stats.blocking}</p>
                <p>Open issues: {stats.open}</p>
                <p>KPI gate: {stats.gain >= 30 ? 'On track' : 'Need more resolved fixes'}</p>
              </div>
              <div className="space-y-2">
                <button onClick={() => transitionChapter('IN_REVIEW', 'Proofreader A', 'QA run completed and chapter moved to in review.')} disabled={!canMoveToReview || workspace.chapterStatus !== 'DRAFT'} className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold disabled:opacity-50">Move to In Review</button>
                <button onClick={() => transitionChapter('REVIEWED', 'Editor Lead', 'High and critical issues are closed.')} disabled={!canApproveReviewed} className="w-full rounded-xl border border-[#D9E2EC] px-3 py-2 text-sm font-semibold disabled:opacity-50">Approve Reviewed</button>
                <button onClick={() => transitionChapter('PUBLISHED', 'Editor Lead', 'All issues are closed and chapter is ready for publishing.')} disabled={!canPublish} className="w-full rounded-xl bg-[#0F766E] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Publish Chapter</button>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto">
                {workspace.approvalHistory.map((event) => (
                  <div key={event.id} className="rounded-xl border border-[#D9E2EC] bg-[#F6F7F4] p-3 text-xs text-[#52606D]">
                    <p className="font-semibold text-[#1F2933]">{event.action}</p>
                    <p className="mt-1">{event.note}</p>
                    <p className="mt-1">{event.actor} · {new Date(event.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {!workspace.approvalHistory.length && <div className="rounded-xl border border-dashed border-[#D9E2EC] p-4 text-xs text-[#52606D]">Chua co approval event nao.</div>}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  );
}

function formatOriginLabel(origin: QaIssueOrigin): string {
  return origin === 'proofreader' ? 'Proofreader' : 'Consistency';
}
