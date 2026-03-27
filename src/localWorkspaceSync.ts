export const LOCAL_WORKSPACE_CHANGED_EVENT = 'truyenforge:local-workspace-changed';
const LOCAL_WORKSPACE_META_KEY = 'truyenforge:local-workspace-meta-v1';

export type LocalWorkspaceSection =
  | 'style_references'
  | 'translation_names'
  | 'prompt_library'
  | 'ui_profile'
  | 'ui_theme'
  | 'ui_viewport_mode'
  | 'finops_budget';

export interface LocalWorkspaceMeta {
  updatedAt: string;
  section: string;
}

function writeMeta(meta: LocalWorkspaceMeta): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_WORKSPACE_META_KEY, JSON.stringify(meta));
}

export function loadLocalWorkspaceMeta(): LocalWorkspaceMeta {
  if (typeof window === 'undefined') {
    return {
      updatedAt: new Date(0).toISOString(),
      section: 'unknown',
    };
  }
  try {
    const raw = localStorage.getItem(LOCAL_WORKSPACE_META_KEY);
    if (!raw) {
      return {
        updatedAt: new Date(0).toISOString(),
        section: 'unknown',
      };
    }
    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceMeta>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      section: typeof parsed.section === 'string' ? parsed.section : 'unknown',
    };
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      section: 'unknown',
    };
  }
}

export function markLocalWorkspaceHydrated(updatedAt: string, section = 'cloud-hydrate'): void {
  writeMeta({
    updatedAt: updatedAt || new Date().toISOString(),
    section,
  });
}

export function emitLocalWorkspaceChanged(section: LocalWorkspaceSection): void {
  if (typeof window === 'undefined') return;
  const meta: LocalWorkspaceMeta = {
    updatedAt: new Date().toISOString(),
    section,
  };
  writeMeta(meta);
  window.dispatchEvent(new CustomEvent<LocalWorkspaceMeta>(LOCAL_WORKSPACE_CHANGED_EVENT, {
    detail: meta,
  }));
}
