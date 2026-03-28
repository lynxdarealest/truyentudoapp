const WORKSPACE_SCOPE_USER_KEY = 'truyenforge:workspace-scope-user-v1';
const DEFAULT_WORKSPACE_SCOPE = 'guest';

let activeWorkspaceScopeUser = DEFAULT_WORKSPACE_SCOPE;

function normalizeWorkspaceScopeUser(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_WORKSPACE_SCOPE;
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function loadInitialScopeUser(): string {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_SCOPE;
  try {
    const raw = localStorage.getItem(WORKSPACE_SCOPE_USER_KEY);
    return normalizeWorkspaceScopeUser(raw);
  } catch {
    return DEFAULT_WORKSPACE_SCOPE;
  }
}

activeWorkspaceScopeUser = loadInitialScopeUser();

function persistScopeUser(scopeUser: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WORKSPACE_SCOPE_USER_KEY, scopeUser);
  } catch {
    // Ignore quota/storage errors; scope stays in memory for this session.
  }
}

export function setWorkspaceScopeUser(userId?: string | null): string {
  const next = normalizeWorkspaceScopeUser(userId);
  activeWorkspaceScopeUser = next;
  persistScopeUser(next);
  return next;
}

export function getWorkspaceScopeUser(): string {
  return activeWorkspaceScopeUser || DEFAULT_WORKSPACE_SCOPE;
}

export function buildScopedStorageKey(baseKey: string, scopeUser = getWorkspaceScopeUser()): string {
  const scope = normalizeWorkspaceScopeUser(scopeUser);
  return `truyenforge:${scope}:${baseKey}`;
}

export function getScopedStorageItem(baseKey: string, options?: { allowLegacyFallback?: boolean; scopeUser?: string }): string | null {
  if (typeof window === 'undefined') return null;
  const scopedKey = buildScopedStorageKey(baseKey, options?.scopeUser);
  const scopedValue = localStorage.getItem(scopedKey);
  if (scopedValue !== null) return scopedValue;

  if (!options?.allowLegacyFallback) return null;
  const legacyValue = localStorage.getItem(baseKey);
  if (legacyValue === null) return null;

  localStorage.setItem(scopedKey, legacyValue);
  return legacyValue;
}

export function setScopedStorageItem(baseKey: string, value: string, scopeUser?: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(buildScopedStorageKey(baseKey, scopeUser), value);
}

export function removeScopedStorageItem(baseKey: string, scopeUser?: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(buildScopedStorageKey(baseKey, scopeUser));
}

export function shouldAllowLegacyScopeFallback(scopeUser = getWorkspaceScopeUser()): boolean {
  return scopeUser === 'guest' || scopeUser === 'local-user';
}
