import type { StorageBackupPayload } from './storage';

const DB_NAME = 'truyenforge-backup-vault';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const MAX_SNAPSHOTS = 30;

export type BackupReason = 'auto' | 'manual' | 'restore-point';
export type DriveSyncStatus = 'pending' | 'uploaded' | 'failed' | 'skipped';

export interface BackupSnapshotMeta {
  status: DriveSyncStatus;
  fileId?: string;
  fileName?: string;
  uploadedAt?: string;
  error?: string;
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  reason: BackupReason;
  payload: StorageBackupPayload;
  drive?: BackupSnapshotMeta;
}

let openPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Không thể mở backup vault.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return openPromise;
}

function withStore<T>(mode: IDBTransactionMode, runner: (store: IDBObjectStore) => void): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let settled = false;
    tx.oncomplete = () => {
      if (!settled) resolve(undefined as T);
    };
    tx.onerror = () => reject(tx.error || new Error('Lỗi khi thao tác backup vault.'));
    tx.onabort = () => reject(tx.error || new Error('Backup vault bị hủy.'));
    runner(store);
  }));
}

function makeId(): string {
  return `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createBackupSnapshot(payload: StorageBackupPayload, reason: BackupReason): Promise<BackupSnapshot> {
  const snapshot: BackupSnapshot = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    reason,
    payload,
    drive: {
      status: 'pending',
    },
  };

  await withStore<void>('readwrite', (store) => {
    store.put(snapshot);
  });
  await pruneBackupSnapshots(MAX_SNAPSHOTS);
  return snapshot;
}

export async function listBackupSnapshots(limit = MAX_SNAPSHOTS): Promise<BackupSnapshot[]> {
  const db = await openDatabase();
  return new Promise<BackupSnapshot[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onerror = () => reject(request.error || new Error('Không đọc được lịch sử backup.'));
    request.onsuccess = () => {
      const items = Array.isArray(request.result) ? request.result as BackupSnapshot[] : [];
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(items.slice(0, limit));
    };
  });
}

export async function getBackupSnapshot(id: string): Promise<BackupSnapshot | null> {
  const db = await openDatabase();
  return new Promise<BackupSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onerror = () => reject(request.error || new Error('Không đọc được backup.'));
    request.onsuccess = () => resolve((request.result as BackupSnapshot | undefined) || null);
  });
}

export async function updateBackupSnapshot(snapshot: BackupSnapshot): Promise<void> {
  await withStore<void>('readwrite', (store) => {
    store.put(snapshot);
  });
}

export async function updateBackupSnapshotDriveMeta(id: string, drive: BackupSnapshotMeta): Promise<void> {
  const current = await getBackupSnapshot(id);
  if (!current) return;
  await updateBackupSnapshot({
    ...current,
    drive,
  });
}

export async function pruneBackupSnapshots(limit = MAX_SNAPSHOTS): Promise<void> {
  const items = await listBackupSnapshots(limit + 20);
  if (items.length <= limit) return;
  const toDelete = items.slice(limit);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    toDelete.forEach((item) => store.delete(item.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Không thể dọn backup cũ.'));
    tx.onabort = () => reject(tx.error || new Error('Dọn backup cũ bị hủy.'));
  });
}
