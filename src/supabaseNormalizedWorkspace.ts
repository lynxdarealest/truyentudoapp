import { hasSupabase, supabase } from './supabaseClient';

const STORIES_TABLE = (import.meta.env.VITE_SUPABASE_STORIES_TABLE || 'stories').trim();
const CHAPTERS_TABLE = (import.meta.env.VITE_SUPABASE_CHAPTERS_TABLE || 'story_chapters').trim();
const CHARACTERS_TABLE = (import.meta.env.VITE_SUPABASE_CHARACTERS_TABLE || 'workspace_characters').trim();
const AI_RULES_TABLE = (import.meta.env.VITE_SUPABASE_AI_RULES_TABLE || 'workspace_ai_rules').trim();
const TRANSLATION_NAMES_TABLE = (import.meta.env.VITE_SUPABASE_TRANSLATION_NAMES_TABLE || 'workspace_translation_names').trim();
const STYLE_REFERENCES_TABLE = (import.meta.env.VITE_SUPABASE_STYLE_REFERENCES_TABLE || 'workspace_style_references').trim();

function requireSupabase() {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase chưa được cấu hình đầy đủ.');
  }
  return supabase;
}

function toIso(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return new Date().toISOString();
}

function normalizeString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function normalizeBool(value: unknown): boolean {
  return Boolean(value);
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function safeHash(input: unknown): string {
  const raw = JSON.stringify(input);
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
}

interface ExistingRevisionRow {
  id: string;
  revision: number;
  updatedAt: string;
  syncHash: string;
}

async function loadExistingStoryRows(userId: string, storyIds: string[]): Promise<Map<string, ExistingRevisionRow>> {
  if (!storyIds.length) return new Map();
  const client = requireSupabase();
  const { data, error } = await client
    .from(STORIES_TABLE)
    .select('story_id, revision, updated_at, sync_hash')
    .eq('user_id', userId)
    .in('story_id', storyIds);
  if (error) throw error;
  const map = new Map<string, ExistingRevisionRow>();
  (data || []).forEach((row: any) => {
    map.set(String(row.story_id), {
      id: String(row.story_id),
      revision: normalizeNumber(row.revision, 1),
      updatedAt: toIso(row.updated_at),
      syncHash: normalizeString(row.sync_hash),
    });
  });
  return map;
}

async function loadExistingChapterRows(userId: string, chapterIds: string[]): Promise<Map<string, ExistingRevisionRow>> {
  if (!chapterIds.length) return new Map();
  const client = requireSupabase();
  const { data, error } = await client
    .from(CHAPTERS_TABLE)
    .select('chapter_id, revision, updated_at, sync_hash')
    .eq('user_id', userId)
    .in('chapter_id', chapterIds);
  if (error) throw error;
  const map = new Map<string, ExistingRevisionRow>();
  (data || []).forEach((row: any) => {
    map.set(String(row.chapter_id), {
      id: String(row.chapter_id),
      revision: normalizeNumber(row.revision, 1),
      updatedAt: toIso(row.updated_at),
      syncHash: normalizeString(row.sync_hash),
    });
  });
  return map;
}

async function deleteMissingRows(
  table: string,
  idField: string,
  userId: string,
  ids: string[],
): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client
    .from(table)
    .select(idField)
    .eq('user_id', userId);
  if (error) throw error;
  const serverIds = new Set((data || []).map((row: any) => String(row[idField] || '')));
  const localIds = new Set(ids.map((item) => String(item)));
  const stale = Array.from(serverIds).filter((id) => id && !localIds.has(id));
  if (!stale.length) return;
  const { error: deleteError } = await client
    .from(table)
    .delete()
    .eq('user_id', userId)
    .in(idField, stale);
  if (deleteError) throw deleteError;
}

export interface NormalizedSyncResult {
  storiesSynced: number;
  chaptersSynced: number;
  conflicts: number;
}

export async function syncNormalizedWorkspaceRecords(userId: string, payload: {
  stories: any[];
  characters: any[];
  aiRules: any[];
  translationNames: any[];
  styleReferences: any[];
}): Promise<NormalizedSyncResult> {
  if (!hasSupabase || !supabase) {
    return { storiesSynced: 0, chaptersSynced: 0, conflicts: 0 };
  }

  const client = requireSupabase();
  const stories = Array.isArray(payload.stories) ? payload.stories : [];
  const storyIds = stories.map((story) => normalizeString(story?.id)).filter(Boolean);
  const existingStories = await loadExistingStoryRows(userId, storyIds);

  const chapterRows: any[] = [];
  const storyRows: any[] = [];
  let conflicts = 0;

  for (const rawStory of stories) {
    const storyId = normalizeString(rawStory?.id);
    if (!storyId) continue;
    const updatedAt = toIso(rawStory?.updatedAt);
    const incomingRevision = Math.max(1, normalizeNumber(rawStory?.revision, 1));
    const storySyncHash = safeHash({
      title: normalizeString(rawStory?.title),
      content: normalizeString(rawStory?.content),
      introduction: normalizeString(rawStory?.introduction),
      genre: normalizeString(rawStory?.genre),
      coverImageUrl: normalizeString(rawStory?.coverImageUrl),
      expectedChapters: normalizeNumber(rawStory?.expectedChapters, 0),
      expectedWordCount: normalizeNumber(rawStory?.expectedWordCount, 0),
      chapters: Array.isArray(rawStory?.chapters) ? rawStory.chapters.map((chapter: any) => ({
        id: normalizeString(chapter?.id),
        title: normalizeString(chapter?.title),
        content: normalizeString(chapter?.content),
        order: normalizeNumber(chapter?.order, 0),
      })) : [],
    });
    const current = existingStories.get(storyId);
    if (current?.syncHash && current.syncHash === storySyncHash) {
      continue;
    }
    if (current && current.revision > incomingRevision && new Date(current.updatedAt).getTime() > new Date(updatedAt).getTime()) {
      conflicts += 1;
      continue;
    }

    const nextRevision = current ? Math.max(current.revision + 1, incomingRevision) : incomingRevision;
    storyRows.push({
      user_id: userId,
      story_id: storyId,
      slug: normalizeString(rawStory?.slug),
      title: normalizeString(rawStory?.title),
      content: normalizeString(rawStory?.content),
      introduction: normalizeString(rawStory?.introduction),
      genre: normalizeString(rawStory?.genre),
      type: normalizeString(rawStory?.type, 'original'),
      is_public: normalizeBool(rawStory?.isPublic),
      is_adult: normalizeBool(rawStory?.isAdult),
      is_ai: normalizeBool(rawStory?.isAI),
      expected_chapters: normalizeNumber(rawStory?.expectedChapters, 0),
      expected_word_count: normalizeNumber(rawStory?.expectedWordCount, 0),
      story_prompt_notes: normalizeString(rawStory?.storyPromptNotes),
      cover_image_url: normalizeString(rawStory?.coverImageUrl),
      translation_memory: Array.isArray(rawStory?.translationMemory) ? rawStory.translationMemory : [],
      character_roster: Array.isArray(rawStory?.characterRoster) ? rawStory.characterRoster : [],
      revision: nextRevision,
      sync_hash: storySyncHash,
      created_at: toIso(rawStory?.createdAt),
      updated_at: updatedAt,
    });

    const chapters = Array.isArray(rawStory?.chapters) ? rawStory.chapters : [];
    for (const chapter of chapters) {
      const chapterId = normalizeString(chapter?.id);
      if (!chapterId) continue;
      chapterRows.push({
        user_id: userId,
        story_id: storyId,
        chapter_id: chapterId,
        title: normalizeString(chapter?.title),
        content: normalizeString(chapter?.content),
        sort_order: normalizeNumber(chapter?.order, 0),
        ai_instructions: normalizeString(chapter?.aiInstructions),
        script: normalizeString(chapter?.script),
        revision: Math.max(1, normalizeNumber(chapter?.revision, 1)),
        created_at: toIso(chapter?.createdAt),
        updated_at: updatedAt,
      });
    }
  }

  const existingChapters = await loadExistingChapterRows(userId, chapterRows.map((row) => row.chapter_id));
  const chapterRowsToUpsert = chapterRows
    .map((row) => {
      const chapterSyncHash = safeHash({
        title: row.title,
        content: row.content,
        sort_order: row.sort_order,
        ai_instructions: row.ai_instructions,
        script: row.script,
      });
      const current = existingChapters.get(row.chapter_id);
      if (current?.syncHash && current.syncHash === chapterSyncHash) return null;
      if (current && current.revision > row.revision && new Date(current.updatedAt).getTime() > new Date(row.updated_at).getTime()) {
        conflicts += 1;
        return null;
      }
      return {
        ...row,
        revision: current ? Math.max(current.revision + 1, row.revision) : row.revision,
        sync_hash: chapterSyncHash,
      };
    })
    .filter(Boolean) as any[];

  if (storyRows.length > 0) {
    const { error } = await client
      .from(STORIES_TABLE)
      .upsert(storyRows, { onConflict: 'user_id,story_id' });
    if (error) throw error;
  }

  if (chapterRowsToUpsert.length > 0) {
    const { error } = await client
      .from(CHAPTERS_TABLE)
      .upsert(chapterRowsToUpsert, { onConflict: 'user_id,chapter_id' });
    if (error) throw error;
  }

  await deleteMissingRows(STORIES_TABLE, 'story_id', userId, storyIds);
  await deleteMissingRows(CHAPTERS_TABLE, 'chapter_id', userId, chapterRows.map((row) => row.chapter_id));

  const characters = (Array.isArray(payload.characters) ? payload.characters : []).map((item) => ({
    user_id: userId,
    character_id: normalizeString(item?.id),
    story_id: normalizeString(item?.storyId),
    name: normalizeString(item?.name),
    appearance: normalizeString(item?.appearance),
    personality: normalizeString(item?.personality),
    created_at: toIso(item?.createdAt),
    updated_at: toIso(item?.updatedAt || item?.createdAt),
  })).filter((item) => item.character_id);

  const aiRules = (Array.isArray(payload.aiRules) ? payload.aiRules : []).map((item) => ({
    user_id: userId,
    rule_id: normalizeString(item?.id),
    name: normalizeString(item?.name),
    content: normalizeString(item?.content),
    created_at: toIso(item?.createdAt),
    updated_at: toIso(item?.updatedAt || item?.createdAt),
  })).filter((item) => item.rule_id);

  const translationNames = (Array.isArray(payload.translationNames) ? payload.translationNames : []).map((item) => ({
    user_id: userId,
    translation_id: normalizeString(item?.id),
    original: normalizeString(item?.original),
    translation: normalizeString(item?.translation),
    created_at: toIso(item?.createdAt),
    updated_at: toIso(item?.updatedAt || item?.createdAt),
  })).filter((item) => item.translation_id);

  const styleReferences = (Array.isArray(payload.styleReferences) ? payload.styleReferences : []).map((item) => ({
    user_id: userId,
    reference_id: normalizeString(item?.id),
    name: normalizeString(item?.name),
    content: normalizeString(item?.content),
    created_at: toIso(item?.createdAt),
    updated_at: toIso(item?.updatedAt || item?.createdAt),
  })).filter((item) => item.reference_id);

  await deleteMissingRows(CHARACTERS_TABLE, 'character_id', userId, characters.map((item) => item.character_id));
  await deleteMissingRows(AI_RULES_TABLE, 'rule_id', userId, aiRules.map((item) => item.rule_id));
  await deleteMissingRows(TRANSLATION_NAMES_TABLE, 'translation_id', userId, translationNames.map((item) => item.translation_id));
  await deleteMissingRows(STYLE_REFERENCES_TABLE, 'reference_id', userId, styleReferences.map((item) => item.reference_id));

  if (characters.length) {
    const { error } = await client.from(CHARACTERS_TABLE).upsert(characters, { onConflict: 'user_id,character_id' });
    if (error) throw error;
  }
  if (aiRules.length) {
    const { error } = await client.from(AI_RULES_TABLE).upsert(aiRules, { onConflict: 'user_id,rule_id' });
    if (error) throw error;
  }
  if (translationNames.length) {
    const { error } = await client.from(TRANSLATION_NAMES_TABLE).upsert(translationNames, { onConflict: 'user_id,translation_id' });
    if (error) throw error;
  }
  if (styleReferences.length) {
    const { error } = await client.from(STYLE_REFERENCES_TABLE).upsert(styleReferences, { onConflict: 'user_id,reference_id' });
    if (error) throw error;
  }

  return {
    storiesSynced: storyRows.length,
    chaptersSynced: chapterRowsToUpsert.length,
    conflicts,
  };
}

export const SUPABASE_NORMALIZED_TABLES = {
  stories: STORIES_TABLE,
  chapters: CHAPTERS_TABLE,
  characters: CHARACTERS_TABLE,
  aiRules: AI_RULES_TABLE,
  translationNames: TRANSLATION_NAMES_TABLE,
  styleReferences: STYLE_REFERENCES_TABLE,
};

