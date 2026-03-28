import { loadBudgetState, saveBudgetState, type BudgetState } from './finops';
import { loadPromptLibraryState, savePromptLibraryState } from './promptLibraryStore';
import { emitLocalWorkspaceChanged } from './localWorkspaceSync';
import { getScopedStorageItem, setScopedStorageItem, shouldAllowLegacyScopeFallback } from './workspaceScope';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

const SAFE_IMPORT_BACKUP_KEY = 'safe_import_backup_v1';
const STORIES_BACKUP_HISTORY_KEY = 'stories_backup_history_v1';
const STORIES_BACKUP_LIMIT = 12;
const STORIES_STORAGE_CODEC_PREFIX = 'lzutf16:';
const STORIES_STORAGE_COMPRESSION_THRESHOLD = 260_000;
const STORIES_KEY = 'stories';
const CHARACTERS_KEY = 'characters';
const AI_RULES_KEY = 'ai_rules';
const STYLE_REFERENCES_KEY = 'style_references';
const TRANSLATION_NAMES_KEY = 'translation_names';
const UI_PROFILE_KEY = 'ui_profile_v1';
const UI_THEME_KEY = 'ui_theme_v1';
const UI_VIEWPORT_MODE_KEY = 'ui_viewport_mode_v1';
const READER_PREFS_KEY = 'reader_prefs_v1';

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

const normalizeRevision = (value: unknown, fallback = 1) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return Math.max(1, fallback);
  return Math.max(1, Math.floor(next));
};

const normalizeChapters = (chapters: any[]) =>
  (Array.isArray(chapters) ? chapters : []).map((chapter) => ({
    ...chapter,
    id: String(chapter?.id || `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    title: String(chapter?.title || '').trim(),
    content: String(chapter?.content || ''),
    order: Number.isFinite(Number(chapter?.order)) ? Number(chapter.order) : 0,
    createdAt: normalizeDate(chapter?.createdAt),
    revision: normalizeRevision(chapter?.revision, 1),
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

const normalizeCharacterRoster = (rows: any[]) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      id: String(row?.id || `roster-${index}-${Date.now()}`),
      name: String(row?.name || '').trim(),
      role: String(row?.role || '').trim(),
      age: String(row?.age || '').trim(),
      identity: String(row?.identity || '').trim(),
    }))
    .filter((row) => row.name);

const normalizeStory = (story: any) => ({
  ...story,
  id: String(story?.id || `story-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  title: String(story?.title || '').trim(),
  content: String(story?.content || ''),
  coverImageUrl: normalizeCoverImageUrl(story?.coverImageUrl),
  createdAt: normalizeDate(story?.createdAt),
  updatedAt: normalizeDate(story?.updatedAt),
  revision: normalizeRevision(story?.revision, 1),
  chapters: normalizeChapters(story?.chapters),
  translationMemory: normalizeTranslationMemory(story?.translationMemory),
  storyPromptNotes: String(story?.storyPromptNotes || '').trim(),
  characterRoster: normalizeCharacterRoster(story?.characterRoster),
});

function areChapterContentsEqual(a: any, b: any): boolean {
  return String(a?.title || '') === String(b?.title || '')
    && String(a?.content || '') === String(b?.content || '')
    && Number(a?.order || 0) === Number(b?.order || 0)
    && String(a?.aiInstructions || '') === String(b?.aiInstructions || '')
    && String(a?.script || '') === String(b?.script || '');
}

function areStoriesEquivalent(a: any, b: any): boolean {
  const aChapters = Array.isArray(a?.chapters) ? a.chapters : [];
  const bChapters = Array.isArray(b?.chapters) ? b.chapters : [];
  if (aChapters.length !== bChapters.length) return false;
  for (let i = 0; i < aChapters.length; i += 1) {
    if (!areChapterContentsEqual(aChapters[i], bChapters[i])) return false;
  }
  return String(a?.title || '') === String(b?.title || '')
    && String(a?.content || '') === String(b?.content || '')
    && String(a?.introduction || '') === String(b?.introduction || '')
    && String(a?.genre || '') === String(b?.genre || '')
    && String(a?.type || '') === String(b?.type || '')
    && String(a?.coverImageUrl || '') === String(b?.coverImageUrl || '')
    && String(a?.storyPromptNotes || '') === String(b?.storyPromptNotes || '')
    && Boolean(a?.isPublic) === Boolean(b?.isPublic)
    && Boolean(a?.isAdult) === Boolean(b?.isAdult)
    && Boolean(a?.isAI) === Boolean(b?.isAI)
    && Number(a?.expectedChapters || 0) === Number(b?.expectedChapters || 0)
    && Number(a?.expectedWordCount || 0) === Number(b?.expectedWordCount || 0)
    && JSON.stringify(Array.isArray(a?.translationMemory) ? a.translationMemory : []) === JSON.stringify(Array.isArray(b?.translationMemory) ? b.translationMemory : [])
    && JSON.stringify(Array.isArray(a?.characterRoster) ? a.characterRoster : []) === JSON.stringify(Array.isArray(b?.characterRoster) ? b.characterRoster : []);
}

function withRevisionBumps(nextStories: any[], previousStories: any[]): any[] {
  const previousById = new Map(
    (Array.isArray(previousStories) ? previousStories : [])
      .map((story) => [String(story?.id || ''), story]),
  );
  return (Array.isArray(nextStories) ? nextStories : []).map((nextStory) => {
    const current = normalizeStory(nextStory);
    const previous = previousById.get(current.id);
    if (!previous) {
      const chapters = normalizeChapters(current.chapters).map((chapter) => ({
        ...chapter,
        revision: normalizeRevision(chapter.revision, 1),
      }));
      return {
        ...current,
        revision: normalizeRevision(current.revision, 1),
        chapters,
      };
    }

    const previousChaptersById = new Map(
      (Array.isArray(previous.chapters) ? previous.chapters : [])
        .map((chapter: any) => [String(chapter?.id || ''), chapter]),
    );
    const chapters = normalizeChapters(current.chapters).map((chapter) => {
      const previousChapter = previousChaptersById.get(chapter.id);
      if (!previousChapter) {
        return {
          ...chapter,
          revision: normalizeRevision(chapter.revision, 1),
        };
      }
      const changed = !areChapterContentsEqual(chapter, previousChapter);
      const previousRevision = normalizeRevision((previousChapter as any)?.revision, 1);
      return {
        ...chapter,
        revision: changed ? previousRevision + 1 : previousRevision,
      };
    });

    const changed = !areStoriesEquivalent({ ...current, chapters }, previous);
    const previousRevision = normalizeRevision(previous.revision, 1);
    return {
      ...current,
      revision: changed ? previousRevision + 1 : previousRevision,
      chapters,
    };
  });
}

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

function getScopedRaw(baseKey: string): string | null {
  return getScopedStorageItem(baseKey, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
}

function setScopedRaw(baseKey: string, value: string): void {
  setScopedStorageItem(baseKey, value);
}

function decodeStoriesPayload(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const decoded = raw.startsWith(STORIES_STORAGE_CODEC_PREFIX)
      ? (decompressFromUTF16(raw.slice(STORIES_STORAGE_CODEC_PREFIX.length)) || '[]')
      : raw;
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function encodeStoriesPayload(stories: any[]): string {
  const normalizedStories = Array.isArray(stories) ? stories.map(normalizeStory) : [];
  const json = JSON.stringify(normalizedStories);
  if (json.length < STORIES_STORAGE_COMPRESSION_THRESHOLD) {
    return json;
  }
  const compressed = compressToUTF16(json);
  if (!compressed) {
    return json;
  }
  return `${STORIES_STORAGE_CODEC_PREFIX}${compressed}`;
}

function buildStoriesFingerprint(stories: any[]): string {
  const normalizedStories = Array.isArray(stories) ? stories : [];
  const storyCount = normalizedStories.length;
  const chapterCount = normalizedStories.reduce((sum, story) => sum + (Array.isArray(story?.chapters) ? story.chapters.length : 0), 0);
  const totalChars = normalizedStories.reduce((sum, story) => sum + Number(String(story?.content || '').length), 0);
  const storyIds = normalizedStories
    .slice(0, 8)
    .map((story) => String(story?.id || '').trim())
    .join('|');
  return `${storyCount}:${chapterCount}:${totalChars}:${storyIds}`;
}

function backupStoriesSnapshot(stories: any[]): void {
  try {
    const normalizedStories = Array.isArray(stories) ? stories.map(normalizeStory) : [];
    const existingRaw = getScopedRaw(STORIES_BACKUP_HISTORY_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    const legacyHistory = Array.isArray(existing) ? existing : [];
    const history = Array.isArray((existing as { entries?: unknown })?.entries)
      ? ((existing as { entries: Array<{ savedAt?: string; storyCount?: number; chapterCount?: number; totalChars?: number; fingerprint?: string }> }).entries)
      : legacyHistory
        .map((item) => ({
          savedAt: typeof item?.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
          storyCount: Array.isArray(item?.stories) ? item.stories.length : 0,
          chapterCount: Array.isArray(item?.stories)
            ? item.stories.reduce((sum: number, story: any) => sum + (Array.isArray(story?.chapters) ? story.chapters.length : 0), 0)
            : 0,
          totalChars: Array.isArray(item?.stories)
            ? item.stories.reduce((sum: number, story: any) => sum + Number(String(story?.content || '').length), 0)
            : 0,
          fingerprint: Array.isArray(item?.stories) ? buildStoriesFingerprint(item.stories) : '',
        }))
        .filter((item) => item.fingerprint);

    const storyCount = normalizedStories.length;
    const chapterCount = normalizedStories.reduce((sum, story) => sum + (Array.isArray(story?.chapters) ? story.chapters.length : 0), 0);
    const totalChars = normalizedStories.reduce((sum, story) => sum + Number(String(story?.content || '').length), 0);
    const fingerprint = buildStoriesFingerprint(normalizedStories);
    const lastEntry = history[history.length - 1];
    if (lastEntry?.fingerprint === fingerprint) return;

    const nextHistory = [
      ...history,
      {
        savedAt: new Date().toISOString(),
        storyCount,
        chapterCount,
        totalChars,
        fingerprint,
      },
    ].slice(-STORIES_BACKUP_LIMIT);

    setScopedRaw(STORIES_BACKUP_HISTORY_KEY, JSON.stringify({
      schemaVersion: 2,
      entries: nextHistory,
    }));
  } catch {
    // Keep primary save path alive even if backup history fails.
  }
}

export interface StorageExportReport {
  filename: string;
  excludedSecrets: string[];
}

export interface StorageImportReport {
  restoredSections: string[];
  skippedSections: string[];
}

export interface StorageBackupPayload {
  schemaVersion: number;
  stories: any[];
  characters: any[];
  ai_rules: any[];
  style_references: any[];
  translation_names: any[];
  prompt_library: ReturnType<typeof loadPromptLibraryState>;
  ui_profile: Record<string, unknown> | null;
  ui_theme: string;
  ui_viewport_mode: string;
  reader_prefs: Record<string, unknown> | null;
  finops_budget: BudgetState;
  exportDate: string;
  note: string;
}

function buildBackupPayload(): StorageBackupPayload {
  const profileRaw = getScopedRaw(UI_PROFILE_KEY);
  const themeRaw = getScopedRaw(UI_THEME_KEY);
  const viewportRaw = getScopedRaw(UI_VIEWPORT_MODE_KEY);
  const readerPrefsRaw = getScopedRaw(READER_PREFS_KEY);
  return {
    schemaVersion: 2,
    stories: storage.getStories(),
    characters: storage.getCharacters(),
    ai_rules: storage.getAIRules(),
    style_references: storage.getStyleReferences(),
    translation_names: storage.getTranslationNames(),
    prompt_library: loadPromptLibraryState(),
    ui_profile: profileRaw ? JSON.parse(profileRaw) : null,
    ui_theme: themeRaw || 'light',
    ui_viewport_mode: viewportRaw || 'desktop',
    reader_prefs: readerPrefsRaw ? JSON.parse(readerPrefsRaw) : null,
    finops_budget: loadBudgetState(),
    exportDate: new Date().toISOString(),
    note: 'API keys va runtime secrets duoc loai khoi backup de tranh ro ri thong tin nhay cam.',
  };
}

function downloadBackupPayload(payload: StorageBackupPayload, filename?: string): string {
  const resolvedFilename = filename || `truyenforge-backup-${new Date().toISOString().split('T')[0]}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = resolvedFilename;
  a.click();
  URL.revokeObjectURL(url);
  return resolvedFilename;
}

export const storage = {
  getStories: () => {
    const data = getScopedRaw(STORIES_KEY);
    const parsed = decodeStoriesPayload(data);
    return Array.isArray(parsed) ? parsed.map(normalizeStory) : [];
  },
  getLatestStoriesBackup: () => {
    try {
      const raw = getScopedRaw(STORIES_BACKUP_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const history = Array.isArray(parsed) ? parsed : [];
      const latest = history[history.length - 1];
      return Array.isArray(latest?.stories) ? latest.stories.map(normalizeStory) : [];
    } catch {
      return [];
    }
  },
  saveStories: (stories: any[]) => {
    const previousStories = storage.getStories();
    const normalizedStories = withRevisionBumps(
      Array.isArray(stories) ? stories.map(normalizeStory) : [],
      previousStories,
    );
    const encodedStories = encodeStoriesPayload(normalizedStories);
    try {
      setScopedRaw(STORIES_KEY, encodedStories);
    } catch {
      try {
        setScopedRaw(STORIES_BACKUP_HISTORY_KEY, JSON.stringify({
          schemaVersion: 2,
          entries: [],
        }));
        setScopedRaw(STORIES_KEY, encodedStories);
      } catch {
        throw new Error('Không thể lưu vì dung lượng trình duyệt đã đầy. Hãy mở Sao lưu để tải JSON ra máy hoặc xóa bớt dữ liệu cũ.');
      }
    }
    backupStoriesSnapshot(normalizedStories);
    emitLocalWorkspaceChanged('stories');
  },
  getCharacters: () => safeParseArray(getScopedRaw(CHARACTERS_KEY)),
  saveCharacters: (characters: any[]) => {
    setScopedRaw(CHARACTERS_KEY, JSON.stringify(characters));
    emitLocalWorkspaceChanged('characters');
  },
  getAIRules: () => safeParseArray(getScopedRaw(AI_RULES_KEY)),
  saveAIRules: (rules: any[]) => {
    setScopedRaw(AI_RULES_KEY, JSON.stringify(rules));
    emitLocalWorkspaceChanged('ai_rules');
  },
  getStyleReferences: () => safeParseArray(getScopedRaw(STYLE_REFERENCES_KEY)),
  saveStyleReferences: (refs: any[]) => {
    setScopedRaw(STYLE_REFERENCES_KEY, JSON.stringify(refs));
    emitLocalWorkspaceChanged('style_references');
  },
  getTranslationNames: () => safeParseArray(getScopedRaw(TRANSLATION_NAMES_KEY)),
  saveTranslationNames: (names: any[]) => {
    setScopedRaw(TRANSLATION_NAMES_KEY, JSON.stringify(names));
    emitLocalWorkspaceChanged('translation_names');
  },
  getApiKeys: () => safeParseArray(localStorage.getItem('api_keys')),
  saveApiKeys: (keys: any[]) => {
    localStorage.setItem('api_keys', JSON.stringify(keys));
  },

  exportData: (): StorageExportReport => {
    const payload = buildBackupPayload();
    const filename = downloadBackupPayload(payload);
    return {
      filename,
      excludedSecrets: ['api_keys', 'api_runtime_config'],
    };
  },
  buildBackupPayload,
  downloadBackupPayload,

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
      ui_profile: getScopedRaw(UI_PROFILE_KEY),
      ui_theme: getScopedRaw(UI_THEME_KEY),
      ui_viewport_mode: getScopedRaw(UI_VIEWPORT_MODE_KEY),
      reader_prefs: getScopedRaw(READER_PREFS_KEY),
      finops_budget: loadBudgetState(),
    };
    setScopedRaw(SAFE_IMPORT_BACKUP_KEY, JSON.stringify(backupSnapshot));

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
        adult: Array.isArray(jsonData.prompt_library.adult) ? jsonData.prompt_library.adult : [],
      });
      restoredSections.push('prompt_library');
    }
    if (isPlainObject(jsonData.ui_profile)) {
      setScopedRaw(UI_PROFILE_KEY, JSON.stringify(jsonData.ui_profile));
      restoredSections.push('ui_profile');
    }
    if (typeof jsonData.ui_theme === 'string') {
      setScopedRaw(UI_THEME_KEY, jsonData.ui_theme);
      restoredSections.push('ui_theme');
    }
    if (typeof jsonData.ui_viewport_mode === 'string') {
      setScopedRaw(UI_VIEWPORT_MODE_KEY, jsonData.ui_viewport_mode);
      restoredSections.push('ui_viewport_mode');
    }
    if (isPlainObject(jsonData.reader_prefs)) {
      setScopedRaw(READER_PREFS_KEY, JSON.stringify(jsonData.reader_prefs));
      restoredSections.push('reader_prefs');
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
