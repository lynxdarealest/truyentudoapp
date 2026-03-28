import { getScopedStorageItem, setScopedStorageItem, shouldAllowLegacyScopeFallback } from './workspaceScope';

export const LOCAL_WORKSPACE_CHANGED_EVENT = 'truyenforge:local-workspace-changed';
const LOCAL_WORKSPACE_META_KEY = 'truyenforge:local-workspace-meta-v1';

export type LocalWorkspaceSection =
  | 'stories'
  | 'characters'
  | 'ai_rules'
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
  sections: Partial<Record<LocalWorkspaceSection, string>>;
}

function writeMeta(meta: LocalWorkspaceMeta): void {
  if (typeof window === 'undefined') return;
  setScopedStorageItem(LOCAL_WORKSPACE_META_KEY, JSON.stringify(meta));
}

function buildEmptySections(): Partial<Record<LocalWorkspaceSection, string>> {
  return {};
}

function sanitizeSections(raw: unknown): Partial<Record<LocalWorkspaceSection, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return buildEmptySections();
  const next: Partial<Record<LocalWorkspaceSection, string>> = {};
  (Object.entries(raw as Record<string, unknown>)).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    if (!value.trim()) return;
    next[key as LocalWorkspaceSection] = value;
  });
  return next;
}

export function loadLocalWorkspaceMeta(): LocalWorkspaceMeta {
  if (typeof window === 'undefined') {
    return {
      updatedAt: new Date(0).toISOString(),
      section: 'unknown',
      sections: buildEmptySections(),
    };
  }
  try {
    const raw = getScopedStorageItem(LOCAL_WORKSPACE_META_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    if (!raw) {
      return {
        updatedAt: new Date(0).toISOString(),
        section: 'unknown',
        sections: buildEmptySections(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<LocalWorkspaceMeta>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      section: typeof parsed.section === 'string' ? parsed.section : 'unknown',
      sections: sanitizeSections(parsed.sections),
    };
  } catch {
    return {
      updatedAt: new Date(0).toISOString(),
      section: 'unknown',
      sections: buildEmptySections(),
    };
  }
}

export function markLocalWorkspaceHydrated(
  updatedAt: string,
  section = 'cloud-hydrate',
  sections?: Partial<Record<LocalWorkspaceSection, string>>,
): void {
  const current = loadLocalWorkspaceMeta();
  writeMeta({
    updatedAt: updatedAt || new Date().toISOString(),
    section,
    sections: {
      ...current.sections,
      ...sanitizeSections(sections),
    },
  });
}

export function emitLocalWorkspaceChanged(section: LocalWorkspaceSection): void {
  if (typeof window === 'undefined') return;
  const current = loadLocalWorkspaceMeta();
  const timestamp = new Date().toISOString();
  const meta: LocalWorkspaceMeta = {
    updatedAt: timestamp,
    section,
    sections: {
      ...current.sections,
      [section]: timestamp,
    },
  };
  writeMeta(meta);
  window.dispatchEvent(new CustomEvent<LocalWorkspaceMeta>(LOCAL_WORKSPACE_CHANGED_EVENT, {
    detail: meta,
  }));
}
