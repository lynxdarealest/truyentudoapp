import type {
  Phase2ApprovalEvent,
  Phase2GeneratedIssue,
  Phase2Issue,
  QaIssueOrigin,
  Phase2WorkspaceState,
} from './types';

const STORAGE_KEY = 'phase2_quality_center_state_v1';

const defaultState: Phase2WorkspaceState = {
  inputMode: 'phase1',
  customChapterText: '',
  selectedIssueId: '',
  chapterStatus: 'DRAFT',
  defaultAssignee: 'Proofreader A',
  assigneePool: ['Proofreader A', 'Translator Owner', 'Editor Lead'],
  issues: [],
  lastProofreadScan: null,
  lastConsistencyScan: null,
  approvalHistory: [],
};

function readText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeIssue(issue: Partial<Phase2Issue>, index: number): Phase2Issue | null {
  const title = readText(issue.title);
  const description = readText(issue.description);
  const evidence = readText(issue.evidence);
  const origin = issue.origin === 'consistency' ? 'consistency' : issue.origin === 'proofreader' ? 'proofreader' : null;
  const type = issue.type || 'STYLE';
  const severity = issue.severity || 'MEDIUM';
  if (!title || !description || !evidence || !origin) return null;
  const now = new Date().toISOString();
  return {
    id: issue.id || `phase2-issue-${index + 1}`,
    origin,
    type,
    severity,
    title,
    description,
    evidence,
    currentText: readText(issue.currentText),
    suggestedText: readText(issue.suggestedText),
    segmentId: readText(issue.segmentId),
    status: issue.status || 'open',
    assignee: readText(issue.assignee) || defaultState.defaultAssignee,
    createdAt: issue.createdAt || now,
    updatedAt: issue.updatedAt || now,
  };
}

function normalizeApprovalEvent(row: Partial<Phase2ApprovalEvent>, index: number): Phase2ApprovalEvent | null {
  const action = readText(row.action);
  if (!action) return null;
  return {
    id: row.id || `phase2-event-${index + 1}`,
    action,
    actor: readText(row.actor) || 'System',
    note: readText(row.note),
    createdAt: row.createdAt || new Date().toISOString(),
  };
}

function normalizeAssigneePool(input?: string[]): string[] {
  const unique = new Set<string>();
  (Array.isArray(input) ? input : defaultState.assigneePool).forEach((row) => {
    const clean = readText(row);
    if (!clean) return;
    unique.add(clean);
  });
  if (!unique.size) {
    defaultState.assigneePool.forEach((row) => unique.add(row));
  }
  return [...unique];
}

export function loadPhase2State(): Phase2WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<Phase2WorkspaceState>;
    const assigneePool = normalizeAssigneePool(parsed.assigneePool);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((row, index) => normalizeIssue(row, index))
          .filter((row): row is Phase2Issue => Boolean(row))
      : [];
    const approvalHistory = Array.isArray(parsed.approvalHistory)
      ? parsed.approvalHistory
          .map((row, index) => normalizeApprovalEvent(row, index))
          .filter((row): row is Phase2ApprovalEvent => Boolean(row))
      : [];
    return {
      inputMode: parsed.inputMode === 'custom' ? 'custom' : 'phase1',
      customChapterText: readText(parsed.customChapterText),
      selectedIssueId: readText(parsed.selectedIssueId),
      chapterStatus:
        parsed.chapterStatus === 'IN_REVIEW' ||
        parsed.chapterStatus === 'REVIEWED' ||
        parsed.chapterStatus === 'PUBLISHED'
          ? parsed.chapterStatus
          : 'DRAFT',
      defaultAssignee: readText(parsed.defaultAssignee) || assigneePool[0],
      assigneePool,
      issues,
      lastProofreadScan: parsed.lastProofreadScan || null,
      lastConsistencyScan: parsed.lastConsistencyScan || null,
      approvalHistory,
    };
  } catch {
    return defaultState;
  }
}

export function savePhase2State(state: Phase2WorkspaceState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      assigneePool: normalizeAssigneePool(state.assigneePool),
    }),
  );
}

function fingerprintIssue(issue: Pick<Phase2GeneratedIssue, 'origin' | 'segmentId' | 'type' | 'title' | 'evidence'>): string {
  return [
    issue.origin,
    readText(issue.segmentId).toLowerCase(),
    issue.type,
    readText(issue.title).toLowerCase(),
    readText(issue.evidence).toLowerCase(),
  ].join('::');
}

function createIssueRecord(issue: Phase2GeneratedIssue, defaultAssignee: string): Phase2Issue {
  const now = new Date().toISOString();
  return {
    ...issue,
    id: `phase2-issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'open',
    assignee: defaultAssignee,
    currentText: readText(issue.currentText),
    suggestedText: readText(issue.suggestedText),
    segmentId: readText(issue.segmentId),
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeIssuesFromScan(
  currentIssues: Phase2Issue[],
  origin: QaIssueOrigin,
  nextIssues: Phase2GeneratedIssue[],
  defaultAssignee: string,
): Phase2Issue[] {
  const now = new Date().toISOString();
  const existingByFingerprint = new Map<string, Phase2Issue>();
  currentIssues.forEach((issue) => {
    existingByFingerprint.set(fingerprintIssue(issue), issue);
  });

  const nextFingerprints = new Set<string>();
  const mergedFresh = nextIssues.map((issue) => {
    const normalizedIssue: Phase2GeneratedIssue = {
      ...issue,
      origin,
      currentText: readText(issue.currentText),
      suggestedText: readText(issue.suggestedText),
      segmentId: readText(issue.segmentId),
    };
    const fingerprint = fingerprintIssue(normalizedIssue);
    nextFingerprints.add(fingerprint);
    const existing = existingByFingerprint.get(fingerprint);
    if (!existing) {
      return createIssueRecord(normalizedIssue, defaultAssignee);
    }
    return {
      ...existing,
      ...normalizedIssue,
      status: existing.status === 'resolved' || existing.status === 'rejected' ? 'open' : existing.status,
      updatedAt: now,
    };
  });

  const untouched = currentIssues
    .filter((issue) => issue.origin !== origin)
    .map((issue) => ({ ...issue }));

  const resolvedOut = currentIssues
    .filter((issue) => issue.origin === origin)
    .filter((issue) => !nextFingerprints.has(fingerprintIssue(issue)))
    .map((issue) => {
      if (issue.status === 'open' || issue.status === 'assigned') {
        return {
          ...issue,
          status: 'resolved' as const,
          updatedAt: now,
        };
      }
      return issue;
    });

  return [...mergedFresh, ...untouched, ...resolvedOut];
}

export function appendApprovalEvent(
  state: Phase2WorkspaceState,
  action: string,
  actor: string,
  note: string,
): Phase2WorkspaceState {
  const nextEvent: Phase2ApprovalEvent = {
    id: `phase2-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    actor,
    note,
    createdAt: new Date().toISOString(),
  };
  return {
    ...state,
    approvalHistory: [nextEvent, ...state.approvalHistory].slice(0, 100),
  };
}
