import { hasSupabase, supabase } from './supabaseClient';

const WORKSPACES_TABLE = (import.meta.env.VITE_SUPABASE_WORKSPACES_TABLE || 'user_workspaces').trim();
const QA_REPORTS_TABLE = (import.meta.env.VITE_SUPABASE_QA_REPORTS_TABLE || 'qa_reports').trim();

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return new Date().toISOString();
}

function requireSupabase() {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase chưa được cấu hình đầy đủ.');
  }
  return supabase;
}

export function hasServerWorkspaceStorage(): boolean {
  return hasSupabase && Boolean(supabase);
}

export class WorkspaceConflictError<T = unknown> extends Error {
  remotePayload: T | null;
  remoteUpdatedAt: string | null;
  constructor(message: string, remotePayload: T | null, remoteUpdatedAt: string | null) {
    super(message);
    this.name = 'WorkspaceConflictError';
    this.remotePayload = remotePayload;
    this.remoteUpdatedAt = remoteUpdatedAt;
  }
}

export async function loadServerWorkspace<T>(userId: string): Promise<{ payload: T | null; updatedAt: string | null }> {
  const client = requireSupabase();
  const { data, error } = await client
    .from(WORKSPACES_TABLE)
    .select('payload, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  return {
    payload: (data?.payload as T | null) || null,
    updatedAt: data?.updated_at ? toIsoString(data.updated_at) : null,
  };
}

export async function saveServerWorkspace<T extends { updatedAt?: string }>(
  userId: string,
  payload: T,
  options?: {
    expectedUpdatedAt?: string | null;
  },
): Promise<void> {
  const client = requireSupabase();
  const updatedAt = toIsoString(payload?.updatedAt);
  const expectedUpdatedAt = typeof options?.expectedUpdatedAt === 'string' && options.expectedUpdatedAt.trim()
    ? options.expectedUpdatedAt
    : null;

  if (!expectedUpdatedAt) {
    const { error } = await client
      .from(WORKSPACES_TABLE)
      .upsert(
        {
          user_id: userId,
          payload,
          updated_at: updatedAt,
        },
        { onConflict: 'user_id' },
      );
    if (error) throw error;
    return;
  }

  const { data, error } = await client
    .from(WORKSPACES_TABLE)
    .update({
      payload,
      updated_at: updatedAt,
    })
    .eq('user_id', userId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at')
    .maybeSingle();

  if (error) throw error;
  if (data) return;

  const latest = await loadServerWorkspace<T>(userId);
  throw new WorkspaceConflictError<T>(
    'Dữ liệu trên server đã thay đổi ở thiết bị khác. Cần tải bản mới nhất và merge lại trước khi ghi.',
    latest.payload,
    latest.updatedAt,
  );
}

export async function saveQaReport(userId: string, report: {
  textPreview: string;
  issueCount: number;
  issues: unknown[];
  createdAt?: string;
}): Promise<void> {
  if (!hasServerWorkspaceStorage()) return;
  const client = requireSupabase();
  const createdAt = toIsoString(report.createdAt);
  const { error } = await client
    .from(QA_REPORTS_TABLE)
    .insert({
      author_id: userId,
      text_preview: report.textPreview,
      issue_count: report.issueCount,
      payload: {
        issues: report.issues,
      },
      created_at: createdAt,
    });

  if (error) throw error;
}

export const SUPABASE_STORAGE_TABLES = {
  workspaces: WORKSPACES_TABLE,
  qaReports: QA_REPORTS_TABLE,
};
