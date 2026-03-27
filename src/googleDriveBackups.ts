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

export function buildDriveBackupFilename(createdAt: string, reason: string): string {
  const stamp = createdAt.replace(/[:.]/g, '-');
  return `truyenforge-backup-${reason}-${stamp}.json`;
}

export async function uploadBackupSnapshotToDrive(
  accessToken: string,
  fileName: string,
  payload: StorageBackupPayload,
): Promise<GoogleDriveUploadResult> {
  const boundary = `truyenforge-${Date.now()}`;
  const metadata = {
    name: fileName,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  };
  const body = [
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

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
    method: 'POST',
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

  return await response.json() as GoogleDriveUploadResult;
}
