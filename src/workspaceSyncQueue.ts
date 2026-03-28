import type { LocalWorkspaceSection } from './localWorkspaceSync';

const DB_NAME = 'truyenforge-workspace-sync-v1';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 1_200;
const LOCK_TTL_MS = 15_000;

const QUEUE_UPDATED_EVENT = 'truyenforge:workspace-sync-queue-updated';
const QUEUE_LOCK_KEY_PREFIX = 'truyenforge:workspace-sync-queue-lock:';
const QUEUE_LAST_SUCCESS_KEY_PREFIX = 'truyenforge:workspace-sync-queue-last-success:';

export interface WorkspaceSyncJob {
  id: string;
  userId: string;
  section: LocalWorkspaceSection;
  idempotencyKey: string;
  status: 'pending' | 'running' | 'failed';
  attempts: number;
  nextRunAt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface WorkspaceSyncQueueStats {
  pending: number;
  failed: number;
  running: number;
  nextRetryAt: string | null;
  lastError?: string;
  lastSuccessAt: string | null;
}

let openPromise: Promise<IDBDatabase> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `ws-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dispatchQueueUpdate(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUEUE_UPDATED_EVENT));
}

function getLockKey(userId: string): string {
  return `${QUEUE_LOCK_KEY_PREFIX}${userId}`;
}

function getLastSuccessKey(userId: string): string {
  return `${QUEUE_LAST_SUCCESS_KEY_PREFIX}${userId}`;
}

function readLastSuccessAt(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(getLastSuccessKey(userId));
  return raw && raw.trim() ? raw : null;
}

function writeLastSuccessAt(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getLastSuccessKey(userId), nowIso());
}

function tryAcquireQueueLock(userId: string): boolean {
  if (typeof window === 'undefined') return true;
  const key = getLockKey(userId);
  const now = Date.now();
  try {
    const existingRaw = localStorage.getItem(key);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as { expiresAt?: number };
      if (Number(existing?.expiresAt) > now) return false;
    }
    localStorage.setItem(key, JSON.stringify({ expiresAt: now + LOCK_TTL_MS }));
    return true;
  } catch {
    return true;
  }
}

function releaseQueueLock(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getLockKey(userId));
  } catch {
    // no-op
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Không thể mở queue đồng bộ.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId');
        store.createIndex('idempotencyKey', 'idempotencyKey');
        store.createIndex('nextRunAt', 'nextRunAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return openPromise;
}

async function getJobsForUser(userId: string): Promise<WorkspaceSyncJob[]> {
  const db = await openDatabase();
  return await new Promise<WorkspaceSyncJob[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onerror = () => reject(request.error || new Error('Không thể đọc queue đồng bộ.'));
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result as WorkspaceSyncJob[] : [];
      resolve(rows.filter((item) => item.userId === userId));
    };
  });
}

async function putJob(job: WorkspaceSyncJob): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Không thể cập nhật queue đồng bộ.'));
    tx.onabort = () => reject(tx.error || new Error('Queue đồng bộ bị hủy.'));
  });
}

async function deleteJob(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Không thể xóa job đồng bộ.'));
    tx.onabort = () => reject(tx.error || new Error('Xóa job đồng bộ bị hủy.'));
  });
}

function computeBackoff(attempts: number): number {
  const power = Math.max(1, attempts);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** (power - 1)));
}

export async function enqueueWorkspaceSyncJob(input: {
  userId: string;
  section: LocalWorkspaceSection;
  idempotencyKey: string;
}): Promise<void> {
  const jobs = await getJobsForUser(input.userId);
  const duplicated = jobs.find((job) => job.idempotencyKey === input.idempotencyKey && job.status !== 'running');
  if (duplicated) {
    await putJob({
      ...duplicated,
      status: 'pending',
      nextRunAt: Date.now(),
      updatedAt: nowIso(),
    });
    dispatchQueueUpdate();
    return;
  }

  const job: WorkspaceSyncJob = {
    id: makeId(),
    userId: input.userId,
    section: input.section,
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    attempts: 0,
    nextRunAt: Date.now(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await putJob(job);
  dispatchQueueUpdate();
}

export async function getWorkspaceSyncQueueStats(userId: string): Promise<WorkspaceSyncQueueStats> {
  const jobs = await getJobsForUser(userId);
  const pending = jobs.filter((item) => item.status === 'pending').length;
  const failed = jobs.filter((item) => item.status === 'failed').length;
  const running = jobs.filter((item) => item.status === 'running').length;
  const nextRetry = jobs
    .filter((item) => item.status === 'failed')
    .sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
  const latestError = jobs
    .filter((item) => item.lastError)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  return {
    pending,
    failed,
    running,
    nextRetryAt: nextRetry ? new Date(nextRetry.nextRunAt).toISOString() : null,
    lastError: latestError?.lastError,
    lastSuccessAt: readLastSuccessAt(userId),
  };
}

export async function clearWorkspaceSyncQueue(userId: string): Promise<void> {
  const jobs = await getJobsForUser(userId);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    jobs.forEach((item) => store.delete(item.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Không thể dọn queue đồng bộ.'));
    tx.onabort = () => reject(tx.error || new Error('Dọn queue đồng bộ bị hủy.'));
  });
  dispatchQueueUpdate();
}

export async function processWorkspaceSyncQueue(
  userId: string,
  runner: (job: WorkspaceSyncJob) => Promise<void>,
): Promise<WorkspaceSyncQueueStats> {
  if (!tryAcquireQueueLock(userId)) {
    return await getWorkspaceSyncQueueStats(userId);
  }

  try {
    const jobs = (await getJobsForUser(userId))
      .sort((a, b) => a.nextRunAt - b.nextRunAt || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const now = Date.now();

    for (const job of jobs) {
      if (job.nextRunAt > now) continue;

      const runningJob: WorkspaceSyncJob = {
        ...job,
        status: 'running',
        updatedAt: nowIso(),
      };
      await putJob(runningJob);
      dispatchQueueUpdate();

      try {
        await runner(runningJob);
        await deleteJob(runningJob.id);
        writeLastSuccessAt(userId);
        dispatchQueueUpdate();
      } catch (error) {
        const attempts = runningJob.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await putJob({
            ...runningJob,
            status: 'failed',
            attempts,
            nextRunAt: Date.now() + MAX_BACKOFF_MS,
            updatedAt: nowIso(),
            lastError: error instanceof Error ? error.message : String(error || 'Lỗi đồng bộ không xác định.'),
          });
        } else {
          await putJob({
            ...runningJob,
            status: 'failed',
            attempts,
            nextRunAt: Date.now() + computeBackoff(attempts),
            updatedAt: nowIso(),
            lastError: error instanceof Error ? error.message : String(error || 'Lỗi đồng bộ không xác định.'),
          });
        }
        dispatchQueueUpdate();
      }
    }

    return await getWorkspaceSyncQueueStats(userId);
  } finally {
    releaseQueueLock(userId);
  }
}

export function subscribeWorkspaceSyncQueue(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(QUEUE_UPDATED_EVENT, handler as EventListener);
  return () => window.removeEventListener(QUEUE_UPDATED_EVENT, handler as EventListener);
}

