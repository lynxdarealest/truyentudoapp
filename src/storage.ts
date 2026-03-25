
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

const normalizeStory = (story: any) => ({
  ...story,
  coverImageUrl: normalizeCoverImageUrl(story?.coverImageUrl),
  createdAt: normalizeDate(story?.createdAt),
  updatedAt: normalizeDate(story?.updatedAt),
  chapters: normalizeChapters(story?.chapters),
});

export const storage = {
  getStories: () => {
    const data = localStorage.getItem('stories');
    const parsed = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeStory) : [];
  },
  saveStories: (stories: any[]) => {
    localStorage.setItem('stories', JSON.stringify(stories));
  },
  getCharacters: () => {
    const data = localStorage.getItem('characters');
    return data ? JSON.parse(data) : [];
  },
  saveCharacters: (characters: any[]) => {
    localStorage.setItem('characters', JSON.stringify(characters));
  },
  getAIRules: () => {
    const data = localStorage.getItem('ai_rules');
    return data ? JSON.parse(data) : [];
  },
  saveAIRules: (rules: any[]) => {
    localStorage.setItem('ai_rules', JSON.stringify(rules));
  },
  getStyleReferences: () => {
    const data = localStorage.getItem('style_references');
    return data ? JSON.parse(data) : [];
  },
  saveStyleReferences: (refs: any[]) => {
    localStorage.setItem('style_references', JSON.stringify(refs));
  },
  getTranslationNames: () => {
    const data = localStorage.getItem('translation_names');
    return data ? JSON.parse(data) : [];
  },
  saveTranslationNames: (names: any[]) => {
    localStorage.setItem('translation_names', JSON.stringify(names));
  },
  getApiKeys: () => {
    const data = localStorage.getItem('api_keys');
    return data ? JSON.parse(data) : [];
  },
  saveApiKeys: (keys: any[]) => {
    localStorage.setItem('api_keys', JSON.stringify(keys));
  },
  
  // Export all data to JSON
  exportData: () => {
    const profileRaw = localStorage.getItem('ui_profile_v1');
    const apiRuntimeRaw = localStorage.getItem('api_runtime_config_v1');
    const themeRaw = localStorage.getItem('ui_theme_v1');
    const viewportRaw = localStorage.getItem('ui_viewport_mode_v1');
    const finops = loadBudgetState();
    const data = {
      stories: storage.getStories(),
      characters: storage.getCharacters(),
      ai_rules: storage.getAIRules(),
      style_references: storage.getStyleReferences(),
      translation_names: storage.getTranslationNames(),
      api_keys: storage.getApiKeys(),
      api_runtime_config: apiRuntimeRaw ? JSON.parse(apiRuntimeRaw) : null,
      ui_profile: profileRaw ? JSON.parse(profileRaw) : null,
      ui_theme: themeRaw || 'light',
      ui_viewport_mode: viewportRaw || 'desktop',
      finops_budget: finops,
      exportDate: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `truyenforge-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  
  // Import data from JSON
  importData: (jsonData: any) => {
    if (jsonData.stories) storage.saveStories(jsonData.stories);
    if (jsonData.characters) storage.saveCharacters(jsonData.characters);
    if (jsonData.ai_rules) storage.saveAIRules(jsonData.ai_rules);
    if (jsonData.style_references) storage.saveStyleReferences(jsonData.style_references);
    if (jsonData.translation_names) storage.saveTranslationNames(jsonData.translation_names);
    if (jsonData.api_keys) storage.saveApiKeys(jsonData.api_keys);
    if (jsonData.api_runtime_config) localStorage.setItem('api_runtime_config_v1', JSON.stringify(jsonData.api_runtime_config));
    if (jsonData.ui_profile) localStorage.setItem('ui_profile_v1', JSON.stringify(jsonData.ui_profile));
    if (jsonData.ui_theme) localStorage.setItem('ui_theme_v1', jsonData.ui_theme);
    if (jsonData.ui_viewport_mode) localStorage.setItem('ui_viewport_mode_v1', jsonData.ui_viewport_mode);
    if (jsonData.finops_budget) saveBudgetState(jsonData.finops_budget);
    window.location.reload();
  }
};
import { loadBudgetState, saveBudgetState } from './finops';
