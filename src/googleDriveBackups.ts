import type { StorageBackupPayload } from './storage';

const GOOGLE_DRIVE_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_AUTH_STORAGE_KEY = 'truyenforge:drive-auth-v1';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
          }) => {
            requestAccessToken: (opts?: { prompt?: string }) => void;
          };
          revoke?: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

export interface GoogleDriveAuthState {
  accessToken: string;
  expiresAt: string;
  account: GoogleDriveAccountProfile;
}

export interface GoogleDriveAccountProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export interface GoogleDriveUploadResult {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  replacedExisting?: boolean;
  cleanedDuplicates?: number;
}

interface GoogleDriveFileRef {
  id: string;
  name: string;
  modifiedTime?: string;
}

function getClientId(): string {
  return String(import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || '').trim();
}

export function hasGoogleDriveBackupConfig(): boolean {
  return Boolean(getClientId());
}

export function loadStoredDriveAuth(): GoogleDriveAuthState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRIVE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleDriveAuthState>;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.account?.email || !parsed.account?.sub) return null;
    return {
      accessToken: String(parsed.accessToken),
      expiresAt: String(parsed.expiresAt),
      account: {
        sub: String(parsed.account.sub),
        email: String(parsed.account.email),
        emailVerified: Boolean(parsed.account.emailVerified),
        name: String(parsed.account.name || ''),
        picture: String(parsed.account.picture || ''),
      },
    };
  } catch {
    return null;
  }
}

export function clearStoredDriveAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DRIVE_AUTH_STORAGE_KEY);
}

export function hasUsableDriveToken(state = loadStoredDriveAuth()): boolean {
  if (!state?.accessToken) return false;
  const expiresAt = new Date(state.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

function storeDriveAuth(state: GoogleDriveAuthState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DRIVE_AUTH_STORAGE_KEY, JSON.stringify(state));
}

async function loadGoogleIdentity(): Promise<NonNullable<Window['google']>> {
  if (window.google?.accounts?.oauth2) return window.google;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Không thể tải Google Identity Services.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Không thể tải Google Identity Services.'));
    document.head.appendChild(script);
  });

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services chưa sẵn sàng.');
  }
  return window.google;
}

async function fetchGoogleDriveAccountProfile(accessToken: string): Promise<GoogleDriveAccountProfile> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Không lấy được thông tin tài khoản Google Drive.');
  }

  const payload = await response.json() as Record<string, unknown>;
  const email = String(payload.email || '').trim();
  const sub = String(payload.sub || '').trim();
  if (!email || !sub) {
    throw new Error('Google không trả về email/sub để khóa tài khoản Drive.');
  }

  return {
    sub,
    email,
    emailVerified: Boolean(payload.email_verified),
    name: String(payload.name || ''),
    picture: String(payload.picture || ''),
  };
}

async function requestAccessToken(prompt: '' | 'consent'): Promise<GoogleDriveAuthState> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Thiếu VITE_GOOGLE_DRIVE_CLIENT_ID để dùng sao lưu lên Google Drive.');
  }
  const google = await loadGoogleIdentity();
  return new Promise<GoogleDriveAuthState>((resolve, reject) => {
    const tokenClient = google.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Không lấy được access token Google Drive.'));
          return;
        }
        const accessToken = response.access_token;
        const expiresIn = Number(response.expires_in || 3600);
        void fetchGoogleDriveAccountProfile(accessToken)
          .then((account) => {
            const state = {
              accessToken,
              expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
              account,
            };
            storeDriveAuth(state);
            resolve(state);
          })
          .catch((error) => {
            reject(error instanceof Error ? error : new Error('Không đọc được thông tin tài khoản Google.'));
          });
      },
    });
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function connectGoogleDriveInteractive(): Promise<GoogleDriveAuthState> {
  return requestAccessToken('consent');
}

export function getDriveAccessToken(): string | null {
  const state = loadStoredDriveAuth();
  return hasUsableDriveToken(state) ? state!.accessToken : null;
}

export async function ensureGoogleDriveAccessToken(interactive = false): Promise<string | null> {
  const state = loadStoredDriveAuth();
  if (hasUsableDriveToken(state)) {
    return state!.accessToken;
  }

  try {
    const nextState = await requestAccessToken(interactive ? 'consent' : '');
    return nextState.accessToken;
  } catch (error) {
    if (interactive) {
      throw error;
    }
    return null;
  }
}

export async function disconnectGoogleDrive(): Promise<void> {
  const state = loadStoredDriveAuth();
  clearStoredDriveAuth();
  try {
    const google = await loadGoogleIdentity();
    if (state?.accessToken && google.accounts?.oauth2?.revoke) {
      google.accounts.oauth2.revoke(state.accessToken);
    }
  } catch {
    // Local disconnect is enough if GIS is unavailable.
  }
}

function escapeDriveQueryValue(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listBackupFilesByName(accessToken: string, fileName: string): Promise<GoogleDriveFileRef[]> {
  const query = `'appDataFolder' in parents and name = '${escapeDriveQueryValue(fileName)}' and trashed = false`;
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('spaces', 'appDataFolder');
  url.searchParams.set('pageSize', '20');
  url.searchParams.set('fields', 'files(id,name,modifiedTime)');
  url.searchParams.set('q', query);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Không thể kiểm tra file backup hiện có trên Google Drive.');
  }

  const payload = await response.json() as { files?: GoogleDriveFileRef[] };
  return Array.isArray(payload.files)
    ? payload.files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
    : [];
}

async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Không thể dọn file backup Google Drive cũ.');
  }
}

function buildMultipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  payload: StorageBackupPayload,
): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(payload, null, 2),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function buildDriveBackupFilename(ownerKey: string): string {
  const safeOwnerKey = String(ownerKey || 'default').trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `truyenforge-backup-${safeOwnerKey}.json`;
}

export async function uploadBackupSnapshotToDrive(
  accessToken: string,
  fileName: string,
  payload: StorageBackupPayload,
): Promise<GoogleDriveUploadResult> {
  const boundary = `truyenforge-${Date.now()}`;
  const existingFiles = await listBackupFilesByName(accessToken, fileName);
  const current = existingFiles[0];
  const metadata = current
    ? {
        name: fileName,
        mimeType: 'application/json',
      }
    : {
        name: fileName,
        parents: ['appDataFolder'],
        mimeType: 'application/json',
      };
  const body = buildMultipartBody(boundary, metadata, payload);
  const endpoint = current
    ? `https://www.googleapis.com/upload/drive/v3/files/${current.id}?uploadType=multipart&fields=id,name,createdTime,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime';
  const response = await fetch(endpoint, {
    method: current ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Không thể upload backup lên Google Drive.');
  }

  const uploaded = await response.json() as GoogleDriveUploadResult;
  const duplicates = existingFiles.slice(1);
  for (const file of duplicates) {
    try {
      await deleteDriveFile(accessToken, file.id);
    } catch {
      // Keep the latest backup safe even if old duplicates couldn't be removed.
    }
  }

  return {
    ...uploaded,
    replacedExisting: Boolean(current),
    cleanedDuplicates: duplicates.length,
  };
}
