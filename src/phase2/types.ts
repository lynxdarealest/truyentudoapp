import type { SegmentStatus } from '../phase1/types';

export type QaIssueOrigin = 'proofreader' | 'consistency';
export type QaIssueType = 'SPELLING' | 'GRAMMAR' | 'STYLE' | 'GLOSSARY' | 'CONSISTENCY' | 'TIMELINE';
export type QaSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type QaIssueStatus = 'open' | 'assigned' | 'resolved' | 'rejected';
export type ChapterReviewStatus = 'DRAFT' | 'IN_REVIEW' | 'REVIEWED' | 'PUBLISHED';
export type QaInputMode = 'phase1' | 'custom';
export type QaTaskKey = 'proofread' | 'consistency';

export interface Phase2SegmentSnapshot {
  id: string;
  sourceText: string;
  targetText: string;
  translationStatus: SegmentStatus | 'draft';
  provider: string;
}

export interface Phase2GeneratedIssue {
  segmentId?: string;
  origin: QaIssueOrigin;
  type: QaIssueType;
  severity: QaSeverity;
  title: string;
  description: string;
  evidence: string;
  currentText?: string;
  suggestedText?: string;
}

export interface Phase2Issue extends Phase2GeneratedIssue {
  id: string;
  status: QaIssueStatus;
  assignee: string;
  createdAt: string;
  updatedAt: string;
}

export interface QaTaskPayload {
  summary: string;
  issues: Phase2GeneratedIssue[];
}

export interface QaTaskRunResult {
  provider: string;
  model: string;
  fromCache: boolean;
  failoverTrail: string[];
  durationMs: number;
  payload: QaTaskPayload;
}

export interface QaScanSummary {
  task: QaTaskKey;
  provider: string;
  model: string;
  fromCache: boolean;
  durationMs: number;
  issueCount: number;
  failoverTrail: string[];
  summary: string;
  runAt: string;
}

export interface Phase2ApprovalEvent {
  id: string;
  action: string;
  actor: string;
  note: string;
  createdAt: string;
}

export interface Phase2WorkspaceState {
  inputMode: QaInputMode;
  customChapterText: string;
  selectedIssueId: string;
  chapterStatus: ChapterReviewStatus;
  defaultAssignee: string;
  assigneePool: string[];
  issues: Phase2Issue[];
  lastProofreadScan: QaScanSummary | null;
  lastConsistencyScan: QaScanSummary | null;
  approvalHistory: Phase2ApprovalEvent[];
}
