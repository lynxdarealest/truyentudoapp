import { loadBudgetState, saveBudgetState, type BudgetState } from './finops';
import { loadPromptLibraryState, savePromptLibraryState } from './promptLibraryStore';
import { emitLocalWorkspaceChanged } from './localWorkspaceSync';

const SAFE_IMPORT_BACKUP_KEY = 'safe_import_backup_v1';

const normalizeDate = (value: any) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : value;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return new Date().toISOString();
};

const normalizeChapters = (chapters: any[]) =>
  (Array.isArray(chapters) ? chapters : []).map((chapter) => ({
    ...chapter,
    createdAt: normalizeDate(chapter?.createdAt),
  }));

const normalizeCoverImageUrl = (value: any) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeTranslationMemory = (rows: any[]) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      original: String(row?.original || '').trim(),
      translation: String(row?.translation || '').trim(),
    }))
    .filter((row) => row.original && row.translation);

const normalizeStory = (story: any) => ({
  ...story,
  coverImageUrl: normalizeCoverImageUrl(story?.coverImageUrl),
  createdAt: normalizeDate(story?.createdAt),
  updatedAt: normalizeDate(story?.updatedAt),
  chapters: normalizeChapters(story?.chapters),
  translationMemory: normalizeTranslationMemory(story?.translationMemory),
});

function safeParseArray(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface StorageExportReport {
  filename: string;
  excludedSecrets: string[];
}

export interface StorageImportReport {
  restoredSections: string[];
  skippedSections: string[];
}

export const storage = {
  getStories: () => {
    const data = localStorage.getItem('stories');
    const parsed = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeStory) : [];
  },
  saveStories: (stories: any[]) => {
    localStorage.setItem('stories', JSON.stringify(stories));
  },
  getCharacters: () => safeParseArray(localStorage.getItem('characters')),
  saveCharacters: (characters: any[]) => {
    localStorage.setItem('characters', JSON.stringify(characters));
  },
  getAIRules: () => safeParseArray(localStorage.getItem('ai_rules')),
  saveAIRules: (rules: any[]) => {
    localStorage.setItem('ai_rules', JSON.stringify(rules));
  },
  getStyleReferences: () => safeParseArray(localStorage.getItem('style_references')),
  saveStyleReferences: (refs: any[]) => {
    localStorage.setItem('style_references', JSON.stringify(refs));
    emitLocalWorkspaceChanged('style_references');
  },
  getTranslationNames: () => safeParseArray(localStorage.getItem('translation_names')),
  saveTranslationNames: (names: any[]) => {
    localStorage.setItem('translation_names', JSON.stringify(names));
    emitLocalWorkspaceChanged('translation_names');
  },
  getApiKeys: () => safeParseArray(localStorage.getItem('api_keys')),
  saveApiKeys: (keys: any[]) => {
    localStorage.setItem('api_keys', JSON.stringify(keys));
  },

  exportData: (): StorageExportReport => {
    const profileRaw = localStorage.getItem('ui_profile_v1');
    const themeRaw = localStorage.getItem('ui_theme_v1');
    const viewportRaw = localStorage.getItem('ui_viewport_mode_v1');
    const finops = loadBudgetState();
    const promptLibrary = loadPromptLibraryState();
    const data = {
      schemaVersion: 2,
      stories: storage.getStories(),
      characters: storage.getCharacters(),
      ai_rules: storage.getAIRules(),
      style_references: storage.getStyleReferences(),
      translation_names: storage.getTranslationNames(),
      prompt_library: promptLibrary,
      ui_profile: profileRaw ? JSON.parse(profileRaw) : null,
      ui_theme: themeRaw || 'light',
      ui_viewport_mode: viewportRaw || 'desktop',
      finops_budget: finops,
      exportDate: new Date().toISOString(),
      note: 'API keys va runtime secrets duoc loai khoi backup de tranh ro ri thong tin nhay cam.',
    };
    const filename = `truyenforge-backup-${new Date().toISOString().split('T')[0]}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return {
      filename,
      excludedSecrets: ['api_keys', 'api_runtime_config'],
    };
  },

  importData: (jsonData: any): StorageImportReport => {
    if (!isPlainObject(jsonData)) {
      throw new Error('File backup khong hop le.');
    }

    const backupSnapshot = {
      exportedAt: new Date().toISOString(),
      stories: storage.getStories(),
      characters: storage.getCharacters(),
      ai_rules: storage.getAIRules(),
      style_references: storage.getStyleReferences(),
      translation_names: storage.getTranslationNames(),
      prompt_library: loadPromptLibraryState(),
      ui_profile: localStorage.getItem('ui_profile_v1'),
      ui_theme: localStorage.getItem('ui_theme_v1'),
      ui_viewport_mode: localStorage.getItem('ui_viewport_mode_v1'),
      finops_budget: loadBudgetState(),
    };
    localStorage.setItem(SAFE_IMPORT_BACKUP_KEY, JSON.stringify(backupSnapshot));

    const restoredSections: string[] = [];
    const skippedSections: string[] = [];

    if (Array.isArray(jsonData.stories)) {
      storage.saveStories(jsonData.stories.map(normalizeStory));
      restoredSections.push('stories');
    }
    if (Array.isArray(jsonData.characters)) {
      storage.saveCharacters(jsonData.characters);
      restoredSections.push('characters');
    }
    if (Array.isArray(jsonData.ai_rules)) {
      storage.saveAIRules(jsonData.ai_rules);
      restoredSections.push('ai_rules');
    }
    if (Array.isArray(jsonData.style_references)) {
      storage.saveStyleReferences(jsonData.style_references);
      restoredSections.push('style_references');
    }
    if (Array.isArray(jsonData.translation_names)) {
      storage.saveTranslationNames(jsonData.translation_names);
      restoredSections.push('translation_names');
    }
    if (isPlainObject(jsonData.prompt_library)) {
      savePromptLibraryState({
        core: Array.isArray(jsonData.prompt_library.core) ? jsonData.prompt_library.core : [],
        genre: Array.isArray(jsonData.prompt_library.genre) ? jsonData.prompt_library.genre : [],
      });
      restoredSections.push('prompt_library');
    }
    if (isPlainObject(jsonData.ui_profile)) {
      localStorage.setItem('ui_profile_v1', JSON.stringify(jsonData.ui_profile));
      restoredSections.push('ui_profile');
    }
    if (typeof jsonData.ui_theme === 'string') {
      localStorage.setItem('ui_theme_v1', jsonData.ui_theme);
      restoredSections.push('ui_theme');
    }
    if (typeof jsonData.ui_viewport_mode === 'string') {
      localStorage.setItem('ui_viewport_mode_v1', jsonData.ui_viewport_mode);
      restoredSections.push('ui_viewport_mode');
    }
    if (isPlainObject(jsonData.finops_budget)) {
      saveBudgetState(jsonData.finops_budget as unknown as BudgetState);
      restoredSections.push('finops_budget');
    }

    if ('api_keys' in jsonData) skippedSections.push('api_keys');
    if ('api_runtime_config' in jsonData) skippedSections.push('api_runtime_config');

    if (!restoredSections.length) {
      throw new Error('Backup khong chua du lieu hop le de khoi phuc.');
    }

    return { restoredSections, skippedSections };
  },
};
