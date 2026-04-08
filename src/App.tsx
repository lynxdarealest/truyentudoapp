import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useAuth, AuthProvider } from './AuthContext';
import { getSupabaseClient, hasSupabase } from './supabaseClient';
import {
  storage,
  STORAGE_SAVE_FAILED_EVENT,
  type StorageBackupPayload,
  type StorageImportReport,
  type StorageSaveFailedDetail,
  type StoryListItem,
} from './storage';
import { 
  Plus, 
  LogOut, 
  LogIn, 
  BookOpen, 
  Edit3, 
  Trash2, 
  Save, 
  User, 
  Users,
  Settings,
  Download,
  Upload,
  FileText,
  Info,
  ChevronLeft, 
  Eye, 
  EyeOff,
  Feather,
  Sparkles,
  FileJson,
  Loader2,
  List,
  X,
  Check,
  Languages,
  Library,
  ChevronRight,
  AlertTriangle,
  Shield,
  Zap,
  Clock,
  Target,
  Wifi,
  WifiOff,
  Sun,
  Moon,
  Search,
  ImagePlus,
  Database,
  Heart,
  History,
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Navbar } from './components/Navbar';
import { loadBudgetState, saveBudgetState } from './finops';
import { CURRENT_WRITER_VERSION, WRITER_RELEASE_NOTES } from './phase3/releaseHistory';
import { APP_NOTICE_EVENT, notifyApp, type AppNoticePayload, type AppNoticeTone } from './notifications';
import { trackApiRequestTelemetry } from './apiKeyTelemetry';
import { loadPromptLibraryState, savePromptLibraryState, type PromptLibraryState } from './promptLibraryStore';
import { LOCAL_WORKSPACE_CHANGED_EVENT, emitLocalWorkspaceChanged, loadLocalWorkspaceMeta, markLocalWorkspaceHydrated, type LocalWorkspaceMeta, type LocalWorkspaceSection } from './localWorkspaceSync';
import { WorkspaceConflictError, loadServerWorkspace, saveQaReport, saveServerWorkspace, SUPABASE_STORAGE_TABLES } from './supabaseWorkspace';
import { SUPABASE_NORMALIZED_TABLES, syncNormalizedWorkspaceRecords } from './supabaseNormalizedWorkspace';
import { IMAGE_AI_PROVIDER_META, getDefaultImageAiModel, type ImageAiProvider } from './imageAiProviders';
import { createBackupSnapshot, getBackupSnapshot, listBackupSnapshots, updateBackupSnapshotDriveMeta, type BackupReason, type BackupSnapshot } from './backupVault';
import { buildDriveBackupFilename, connectGoogleDriveInteractive, ensureGoogleDriveAccessToken, hasGoogleDriveBackupConfig, loadStoredDriveAuth, uploadBackupSnapshotToDrive, type GoogleDriveAuthState, type GoogleDriveAccountProfile } from './googleDriveBackups';
import { buildScopedStorageKey, getScopedStorageItem, getWorkspaceScopeUser, setScopedStorageItem, setWorkspaceScopeUser, shouldAllowLegacyScopeFallback } from './workspaceScope';
import { clearWorkspaceSyncQueue, enqueueWorkspaceSyncJob, getWorkspaceSyncQueueStats, processWorkspaceSyncQueue, subscribeWorkspaceSyncQueue, type WorkspaceSyncQueueStats } from './workspaceSyncQueue';
import { DEFAULT_GENERATION_CONFIG, sanitizeGenerationConfig, type GenerationConfig } from './generationConfig';

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { handleRelayMessage, relayGenerateContent, setRelaySender, notifyRelayDisconnected } from './relayBridge';
import type { QaIssue } from './components/QualityCenter';
import {
  type ApiProvider,
  type AiProfileMode,
  type StoredApiKeyRecord,
  PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  activateApiKeyRecord,
  detectApiProviderFromValue,
  getActiveApiKeyRecord,
  getDefaultModelForProvider,
  getProviderBaseUrl,
  normalizeStoredApiKeys,
} from './apiVault';
import type { AiTaskType } from './ai/types';
import { getPromptBlueprint } from './ai/promptCatalog';
import { prependPromptContract, buildTraceMetadata } from './ai/promptBuilder';
import { routeAiExecutionLane } from './ai/modelRouter';
import { validateChapterDraftArray, validateStoryAnalysis, validateStoryPlan } from './ai/schemas';
import { startAiTaskRun } from './ai/orchestrator';

const MarkdownRenderer = React.lazy(() => import('./components/MarkdownRenderer'));
const ApiSectionPanel = React.lazy(async () => {
  const module = await import('./components/tools/ApiSectionPanel');
  return { default: module.ApiSectionPanel };
});
const ToolsPage = React.lazy(async () => {
  const module = await import('./features/tools/ToolsPage');
  return { default: module.ToolsPage };
});
const PromptLibraryModalNew = React.lazy(async () => {
  const module = await import('./features/prompt/PromptLibrary');
  return { default: module.PromptLibraryModal };
});
const ReleaseHistoryAccordion = React.lazy(async () => {
  const module = await import('./components/ReleaseHistoryAccordion');
  return { default: module.ReleaseHistoryAccordion };
});

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AppToast {
  id: string;
  groupKey: string;
  title?: string;
  message: string;
  detail?: string;
  tone: AppNoticeTone;
  timeoutMs: number;
  count: number;
  persist?: boolean;
}

interface ActiveAiRun {
  id: string;
  controller: AbortController;
}

interface AiOverlayProgress {
  completed: number;
  total: number;
}

let mammothModulePromise: Promise<any> | null = null;
let pdfjsModulePromise: Promise<any> | null = null;
let epubModulePromise: Promise<any> | null = null;
let jsZipModulePromise: Promise<any> | null = null;
let pdfWorkerConfigured = false;
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

async function loadMammothModule(): Promise<any> {
  if (!mammothModulePromise) {
    mammothModulePromise = import('mammoth');
  }
  return mammothModulePromise;
}

async function yieldToMainThread(): Promise<void> {
  if (typeof window === 'undefined') return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function extractDocxTextViaWorker(arrayBuffer: ArrayBuffer): Promise<string> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('Web Worker không khả dụng.');
  }
  return await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./workers/docxParser.worker.ts', import.meta.url), { type: 'module' });
    const requestId = `docx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ requestId?: string; ok?: boolean; text?: string; error?: string }>) => {
      const payload = event.data || {};
      if (payload.requestId !== requestId) return;
      cleanup();
      if (payload.ok) {
        resolve(String(payload.text || ''));
      } else {
        reject(new Error(String(payload.error || 'Worker parse DOCX thất bại.')));
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Worker parse DOCX gặp lỗi.'));
    };
    const transferable = arrayBuffer.slice(0);
    worker.postMessage({ requestId, buffer: transferable }, [transferable]);
  });
}

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    return await extractDocxTextViaWorker(arrayBuffer);
  } catch {
    const mammoth = await loadMammothModule();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return String(result?.value || '');
  }
}

async function loadPdfJsModule(): Promise<any> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist');
  }
  const module = await pdfjsModulePromise;
  const api = module?.default || module;
  if (!pdfWorkerConfigured && api?.GlobalWorkerOptions && api?.version) {
    api.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${api.version}/pdf.worker.min.js`;
    pdfWorkerConfigured = true;
  }
  return api;
}

async function loadEpubFactory(): Promise<(input: ArrayBuffer) => any> {
  if (!epubModulePromise) {
    epubModulePromise = import('epubjs');
  }
  const module = await epubModulePromise;
  return (module?.default || module) as (input: ArrayBuffer) => any;
}

async function loadJSZipFactory(): Promise<any> {
  if (!jsZipModulePromise) {
    jsZipModulePromise = import('jszip');
  }
  const module = await jsZipModulePromise;
  return module?.default || module;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'truyen';
}

async function buildTxtExport(story: Story, includeToc: boolean): Promise<Blob> {
  const sorted = [...(story.chapters || [])].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  lines.push(`# ${story.title}`);
  if (story.introduction) lines.push('', story.introduction);
  if (includeToc && sorted.length) {
    lines.push('', '## Mục lục');
    sorted.forEach((ch, idx) => {
      lines.push(`${idx + 1}. ${ch.title || `Chương ${ch.order || idx + 1}`}`);
    });
  }
  sorted.forEach((ch, idx) => {
    lines.push('', `## ${ch.title || `Chương ${ch.order || idx + 1}`}`, '', normalizeAiJsonContent(ch.content, '').content || ch.content);
  });
  return new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
}

async function buildEpubExport(story: Story, includeToc: boolean): Promise<Blob> {
  const JSZip = await loadJSZipFactory();
  const zip = new JSZip();
  const sorted = [...(story.chapters || [])].sort((a, b) => a.order - b.order);

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const navItems: string[] = [];
  const spineItems: string[] = [];
  const manifestItems: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  ];

  sorted.forEach((ch, idx) => {
    const id = `chap${idx + 1}`;
    const href = `${id}.xhtml`;
    const title = ch.title || `Chương ${ch.order || idx + 1}`;
    const body = normalizeAiJsonContent(ch.content, '').content || ch.content;
    const html = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi">
<head><title>${title}</title><meta charset="utf-8"/></head>
<body>
<h2 id="${id}">${title}</h2>
${body.replace(/\n/g, '<br/>')}
</body></html>`;
    zip.file(`OEBPS/${href}`, html);
    manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="${href}#${id}">${idx + 1}. ${title}</a></li>`);
  });

  const navDoc = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi">
<head><meta charset="utf-8"/><title>Navigation</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>Mục lục</h1>
<ol>
${includeToc ? navItems.join('\n') : ''}
</ol>
</nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navDoc);

  const metadataId = `id-${Date.now()}`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="${metadataId}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="${metadataId}">${metadataId}</dc:identifier>
    <dc:title>${story.title}</dc:title>
    <dc:language>vi</dc:language>
    <dc:creator>TruyenForge AI</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  const content = await zip.generateAsync({ type: 'blob' });
  return content;
}


type ApiMode = 'manual' | 'relay';
const APP_ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

function readEnvString(key: string, fallback = ''): string {
  const raw = APP_ENV[key];
  if (typeof raw !== 'string') return fallback;
  const normalized = raw.trim();
  return normalized || fallback;
}

function readEnvFlag(key: string, fallback = false): boolean {
  const raw = readEnvString(key, fallback ? '1' : '0').toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

const DEFAULT_RELAY_WS_BASE = 'wss://your-relay.workers.dev/';
const DEFAULT_RELAY_WEB_BASE = 'https://your-relay.workers.dev/';
const LEGACY_RELAY_HOST_RE = /(relay2026\.up\.railway\.app|relay2026\.vercel\.app|proxymid\.your-subdomain\.workers\.dev)/i;
const RELAY_SOCKET_BASE = normalizeRelaySocketBase(readEnvString('VITE_RELAY_WS_BASE', DEFAULT_RELAY_WS_BASE));
const RELAY_WEB_BASE = (readEnvString('VITE_RELAY_WEB_BASE', DEFAULT_RELAY_WEB_BASE).replace(/\/+$/, '') + '/');
const RAPHAEL_API_BASE = 'https://api.evolink.ai/v1';
const DEFAULT_RAPHAEL_MODEL = 'z-image-turbo';
const DEFAULT_RAPHAEL_SIZE = '2:3';
const GEMINI_UNRESTRICTED_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

type ExportFormat = 'txt' | 'epub';

interface ApiRuntimeConfig {
  mode: ApiMode;
  relayUrl: string;
  identityHint: string;
  relayMatchedLong: string;
  relayToken: string;
  relayUpdatedAt: string;
  aiProfile: AiProfileMode;
  selectedProvider: ApiProvider;
  selectedModel: string;
  activeApiKeyId: string;
  enableCache: boolean;
  generation: GenerationConfig;
}

interface ImageApiConfig {
  enabled: boolean;
  provider: ImageAiProvider;
  size: string;
  providers: Record<ImageAiProvider, {
    apiKey: string;
    model: string;
  }>;
}

const API_RUNTIME_CONFIG_KEY = 'api_runtime_config_v1';
const IMAGE_API_CONFIG_KEY = 'image_api_config_v1';
const RELAY_TOKEN_CACHE_KEY = 'relay_token_cache_v1';
const GEMINI_RESPONSE_CACHE_KEY = 'gemini_response_cache_v1';
const MAIN_AI_USAGE_KEY = 'main_ai_usage_v1';
const MAIN_AI_USAGE_UPDATED_EVENT = 'main_ai_usage_updated';
const UI_PROFILE_KEY = 'ui_profile_v1';
const UI_THEME_KEY = 'ui_theme_v1';
const UI_VIEWPORT_MODE_KEY = 'ui_viewport_mode_v1';
const APP_MODE_KEY = 'app_mode_v1';
const READER_PREFS_KEY = 'reader_prefs_v1';
const READER_ACTIVITY_KEY = 'reader_activity_v1';
const READER_SEARCH_HISTORY_KEY = 'reader_search_history_v1';
const READER_FILTER_PRESETS_KEY = 'reader_filter_presets_v1';
const STORIES_UPDATED_EVENT = 'stories:updated';
const WORKSPACE_RECOVERY_KEY = 'truyenforge:workspace-recovery-v1';
const ACCOUNT_CLOUD_AUTOSYNC_ENABLED = readEnvFlag('VITE_ACCOUNT_AUTOSYNC', true);
const ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS = 5 * 60 * 1000;
const ACCOUNT_SYNC_QUEUE_STATS_DEBOUNCE_MS = 1200;
const MAINTENANCE_GLOBAL_ENABLED = readEnvFlag('VITE_MAINTENANCE_MODE_GLOBAL', false) || readEnvFlag('VITE_MAINTENANCE_MODE', false);
const MAINTENANCE_READER_ENABLED = readEnvFlag('VITE_MAINTENANCE_MODE_READER', false);
const MAINTENANCE_STUDIO_ENABLED = readEnvFlag('VITE_MAINTENANCE_MODE_STUDIO', false);
const MAINTENANCE_ETA = readEnvString('VITE_MAINTENANCE_ETA', '');
const MAINTENANCE_NOTICE_GLOBAL = readEnvString('VITE_MAINTENANCE_NOTICE_GLOBAL', readEnvString('VITE_MAINTENANCE_NOTICE', 'Hệ thống đang bảo trì để nâng cấp và sửa lỗi.'));
const MAINTENANCE_NOTICE_READER = readEnvString('VITE_MAINTENANCE_NOTICE_READER', MAINTENANCE_NOTICE_GLOBAL);
const MAINTENANCE_NOTICE_STUDIO = readEnvString('VITE_MAINTENANCE_NOTICE_STUDIO', MAINTENANCE_NOTICE_GLOBAL);
const MAINTENANCE_RUNTIME_STATE_KEY = 'truyenforge:maintenance-runtime-v1';
const ACCOUNT_AUTOSYNC_TRIGGER_SECTIONS: ReadonlySet<LocalWorkspaceSection> = new Set([
  'stories',
  'characters',
  'ai_rules',
  'style_references',
  'translation_names',
  'prompt_library',
  'finops_budget',
]);
const WORKSPACE_DEVICE_ID_KEY = 'truyenforge:workspace-device-id-v1';
const WORKSPACE_EDIT_LOCK_TTL_MS = 3 * 60 * 1000;
const STORY_IMPORT_MAX_FILE_BYTES = 18 * 1024 * 1024;
const STORY_IMPORT_MAX_STORIES = 180;
const STORY_IMPORT_MAX_CHAPTERS_PER_STORY = 1200;
const STORY_IMPORT_MAX_CHARACTERS = 6000;
const IMAGE_PROVIDER_WARNING_COOLDOWN_MS = 2 * 60 * 1000;
const PUBLIC_STORY_FEED_LIMIT = 48;
const READER_SEARCH_HISTORY_LIMIT = 12;
const READER_FILTER_PRESET_LIMIT = 8;
const READER_GENRE_BASE_OPTIONS = [
  'Tiên hiệp',
  'Huyền huyễn',
  'Kiếm hiệp',
  'Đô thị',
  'Ngôn tình',
  'Đam mỹ',
  'Bách hợp',
  'Hệ thống',
  'Trọng sinh',
  'Xuyên không',
  'Trinh thám',
  'Kinh dị',
  'Hài hước',
  'Lịch sử',
  'Quân sự',
];

interface MaintenanceRuntimeState {
  signature: string;
  startedAt: number;
}

function parseMaintenanceEtaToMs(rawValue: string): number | null {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.getTime();

  const normalized = raw
    .replace(/\((UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?\)/i, '$1$2:$3')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedDate = new Date(normalized);
  if (!Number.isNaN(normalizedDate.getTime())) return normalizedDate.getTime();

  const ddmmyyyy = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?)?$/i,
  );
  if (!ddmmyyyy) return null;

  const day = Number(ddmmyyyy[1]);
  const month = Number(ddmmyyyy[2]);
  const year = Number(ddmmyyyy[3]);
  const hour = Number(ddmmyyyy[4] || '0');
  const minute = Number(ddmmyyyy[5] || '0');
  const second = Number(ddmmyyyy[6] || '0');
  const tzHour = ddmmyyyy[7] ? Number(ddmmyyyy[7]) : null;
  const tzMinute = ddmmyyyy[8] ? Number(ddmmyyyy[8]) : 0;

  if (tzHour === null) {
    const localDate = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(localDate.getTime()) ? null : localDate.getTime();
  }

  const totalOffsetMinutes = (Math.abs(tzHour) * 60 + Math.abs(tzMinute || 0)) * (tzHour >= 0 ? 1 : -1);
  return Date.UTC(year, month - 1, day, hour, minute, second) - totalOffsetMinutes * 60 * 1000;
}

function formatCountdown(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  if (!parts.length) parts.push(`${seconds} giây`);
  return parts.slice(0, 3).join(' ');
}

function loadMaintenanceRuntimeState(): MaintenanceRuntimeState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MAINTENANCE_RUNTIME_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MaintenanceRuntimeState>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.signature !== 'string') return null;
    if (!Number.isFinite(parsed.startedAt)) return null;
    return {
      signature: parsed.signature,
      startedAt: Number(parsed.startedAt),
    };
  } catch {
    return null;
  }
}

function saveMaintenanceRuntimeState(next: MaintenanceRuntimeState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAINTENANCE_RUNTIME_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage write failure
  }
}

function readScopedAppStorage(baseKey: string): string | null {
  return getScopedStorageItem(baseKey, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
}

function writeScopedAppStorage(baseKey: string, value: string): void {
  setScopedStorageItem(baseKey, value);
}

type ThemeMode = 'light' | 'dark';
type ViewportMode = 'desktop' | 'mobile';
type AppMode = 'reader' | 'creator';

interface UiProfile {
  displayName: string;
  avatarUrl: string;
}

interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  fontFamily: 'serif' | 'sans' | 'mono';
  background: string;
  textColor: string;
  colorMode: 'auto' | 'custom';
}

interface BackupSettings {
  autoSnapshotEnabled: boolean;
  autoUploadToDrive: boolean;
  staleAfterHours: number;
  lastSuccessfulBackupAt: string;
  lastManualSyncAt: string;
}

interface TranslationSafetyProfileSettings {
  autoSafeModeEnabled: boolean;
  checkpointEveryChunks: number;
}

interface GoogleDriveBinding {
  sub: string;
  email: string;
  name: string;
  picture: string;
  lockedAt: string;
  lastValidatedAt: string;
}

interface WorkspaceEditLock {
  storyId: string;
  storyTitle: string;
  deviceId: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
}

const DEFAULT_PROFILE_AVATAR = 'https://api.dicebear.com/9.x/initials/svg?seed=User';
const BACKUP_SETTINGS_KEY = 'truyenforge:backup-settings-v1';
const DRIVE_BINDING_MAP_KEY = 'truyenforge:drive-binding-map-v1';
const ACCOUNT_SYNC_DISABLED_NOTICE_KEY = 'truyenforge:account-sync-disabled-notice-v1';
const TRANSLATION_SAFETY_PROFILE_KEY = 'truyenforge:translation-safety-profile-v1';
const TRANSLATION_PIPELINE_CHECKPOINT_KEY = 'truyenforge:translation-pipeline-checkpoint-v1';
const STORY_BIBLE_PREFIX = 'TF_STORY_BIBLE::';
const STORY_BIBLE_VERSION = 1;
const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoSnapshotEnabled: true,
  autoUploadToDrive: true,
  staleAfterHours: 6,
  lastSuccessfulBackupAt: '',
  lastManualSyncAt: '',
};

const DEFAULT_TRANSLATION_SAFETY_PROFILE_SETTINGS: TranslationSafetyProfileSettings = {
  autoSafeModeEnabled: true,
  checkpointEveryChunks: 10,
};

function loadBackupSettings(): BackupSettings {
  if (typeof window === 'undefined') return DEFAULT_BACKUP_SETTINGS;
  try {
    const raw = localStorage.getItem(BACKUP_SETTINGS_KEY);
    if (!raw) return DEFAULT_BACKUP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<BackupSettings>;
    return {
      autoSnapshotEnabled: true,
      autoUploadToDrive: true,
      staleAfterHours: Number(parsed.staleAfterHours) > 0 ? Number(parsed.staleAfterHours) : DEFAULT_BACKUP_SETTINGS.staleAfterHours,
      lastSuccessfulBackupAt: typeof parsed.lastSuccessfulBackupAt === 'string' ? parsed.lastSuccessfulBackupAt : '',
      lastManualSyncAt: typeof parsed.lastManualSyncAt === 'string' ? parsed.lastManualSyncAt : '',
    };
  } catch {
    return DEFAULT_BACKUP_SETTINGS;
  }
}

function saveBackupSettings(settings: BackupSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    BACKUP_SETTINGS_KEY,
    JSON.stringify({
      ...settings,
      autoSnapshotEnabled: true,
      autoUploadToDrive: true,
    }),
  );
}

function normalizeDriveBinding(value: unknown): GoogleDriveBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<GoogleDriveBinding>;
  const email = String(row.email || '').trim();
  const sub = String(row.sub || '').trim();
  if (!email || !sub) return null;
  return {
    sub,
    email,
    name: String(row.name || '').trim(),
    picture: String(row.picture || '').trim(),
    lockedAt: String(row.lockedAt || row.lastValidatedAt || new Date().toISOString()),
    lastValidatedAt: String(row.lastValidatedAt || row.lockedAt || new Date().toISOString()),
  };
}

function loadDriveBindingMap(): Record<string, GoogleDriveBinding> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DRIVE_BINDING_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, GoogleDriveBinding> = {};
    Object.entries(parsed || {}).forEach(([userId, value]) => {
      const normalized = normalizeDriveBinding(value);
      if (normalized) next[userId] = normalized;
    });
    return next;
  } catch {
    return {};
  }
}

function loadDriveBindingForUser(userId?: string | null): GoogleDriveBinding | null {
  if (!userId) return null;
  const map = loadDriveBindingMap();
  return map[userId] || null;
}

function saveDriveBindingForUser(userId: string, binding: GoogleDriveBinding | null): void {
  if (typeof window === 'undefined' || !userId) return;
  const next = loadDriveBindingMap();
  if (binding) {
    next[userId] = binding;
  } else {
    delete next[userId];
  }
  localStorage.setItem(DRIVE_BINDING_MAP_KEY, JSON.stringify(next));
}

function getWorkspaceDeviceId(): string {
  if (typeof window === 'undefined') return 'server-device';
  try {
    const existing = localStorage.getItem(WORKSPACE_DEVICE_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const generated = `device-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(WORKSPACE_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return `device-fallback-${Date.now().toString(36)}`;
  }
}

function normalizeWorkspaceEditLock(value: unknown): WorkspaceEditLock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<WorkspaceEditLock>;
  const storyId = String(row.storyId || '').trim();
  const deviceId = String(row.deviceId || '').trim();
  if (!storyId || !deviceId) return null;
  const nowIso = new Date().toISOString();
  return {
    storyId,
    storyTitle: String(row.storyTitle || '').trim(),
    deviceId,
    holder: String(row.holder || '').trim(),
    acquiredAt: String(row.acquiredAt || nowIso),
    expiresAt: String(row.expiresAt || nowIso),
  };
}

function isWorkspaceEditLockActive(lock: WorkspaceEditLock | null, nowMs = Date.now()): boolean {
  if (!lock) return false;
  const expMs = toTimestampMs(lock.expiresAt);
  return expMs > nowMs;
}

function toDriveBinding(account: GoogleDriveAccountProfile, current?: GoogleDriveBinding | null): GoogleDriveBinding {
  return {
    sub: account.sub,
    email: account.email,
    name: account.name || current?.name || '',
    picture: account.picture || current?.picture || '',
    lockedAt: current?.lockedAt || new Date().toISOString(),
    lastValidatedAt: new Date().toISOString(),
  };
}

function createBackupFingerprint(payload: StorageBackupPayload): string {
  return JSON.stringify({
    ...payload,
    exportDate: '',
    note: '',
  });
}

function getBackupReasonLabel(reason: BackupReason): string {
  switch (reason) {
    case 'manual':
      return 'Thủ công';
    case 'restore-point':
      return 'Mốc an toàn';
    default:
      return 'Tự động';
  }
}

function getDriveStatusLabel(snapshot: BackupSnapshot): string {
  switch (snapshot.drive?.status) {
    case 'uploaded':
      return 'Đã lưu lên Drive';
    case 'failed':
      return 'Cần lưu lại';
    case 'skipped':
      return 'Chưa dùng Drive';
    default:
      return 'Đang chờ';
  }
}

function formatBackupTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không rõ';
  return date.toLocaleString('vi-VN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildBackupWarningMessage(latestBackupAt: string, staleAfterHours: number): string {
  if (!latestBackupAt) {
    return 'Bạn chưa có bản sao lưu nào. Hãy lưu lại một bản trước khi tiếp tục làm việc.';
  }
  const ageMs = Date.now() - new Date(latestBackupAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= staleAfterHours * 3600 * 1000) {
    return '';
  }
  return `Đã hơn ${staleAfterHours} giờ kể từ lần lưu gần nhất (${formatBackupTimestamp(latestBackupAt)}). Bạn nên sao lưu lại để tránh mất dữ liệu mới.`;
}

function loadUiProfile(defaultName?: string, defaultAvatar?: string): UiProfile {
  try {
    const raw = getScopedStorageItem(UI_PROFILE_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    const parsed = raw ? (JSON.parse(raw) as Partial<UiProfile>) : {};
    return {
      displayName: parsed.displayName || defaultName || 'Người dùng',
      avatarUrl: parsed.avatarUrl || defaultAvatar || DEFAULT_PROFILE_AVATAR,
    };
  } catch {
    return {
      displayName: defaultName || 'Người dùng',
      avatarUrl: defaultAvatar || DEFAULT_PROFILE_AVATAR,
    };
  }
}

function saveUiProfile(profile: UiProfile): void {
  setScopedStorageItem(UI_PROFILE_KEY, JSON.stringify(profile));
  emitLocalWorkspaceChanged('ui_profile');
}

function getReaderDefaultColors(themeMode: ThemeMode): Pick<ReaderPrefs, 'background' | 'textColor'> {
  if (themeMode === 'dark') {
    return {
      background: '#111a2b',
      textColor: '#d3dceb',
    };
  }
  return {
    background: '#f6f9ff',
    textColor: '#0f172a',
  };
}

function createDefaultReaderPrefs(themeMode: ThemeMode): ReaderPrefs {
  const colors = getReaderDefaultColors(themeMode);
  return {
    fontSize: 17,
    lineHeight: 1.7,
    fontFamily: 'serif',
    background: colors.background,
    textColor: colors.textColor,
    colorMode: 'auto',
  };
}

function loadReaderPrefs(themeMode: ThemeMode = loadThemeMode()): ReaderPrefs {
  const defaults = createDefaultReaderPrefs(themeMode);
  try {
    const raw = getScopedStorageItem(READER_PREFS_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
      const colorMode = parsed.colorMode === 'custom' ? 'custom' : 'auto';
      return {
        fontSize: Number(parsed.fontSize) || 17,
        lineHeight: Number(parsed.lineHeight) || 1.7,
        fontFamily: (parsed.fontFamily as ReaderPrefs['fontFamily']) || 'serif',
        background: colorMode === 'custom' ? String(parsed.background || defaults.background) : defaults.background,
        textColor: colorMode === 'custom' ? String(parsed.textColor || defaults.textColor) : defaults.textColor,
        colorMode,
      };
    }
  } catch {
    // fallback below
  }
  return defaults;
}

function saveReaderPrefs(prefs: ReaderPrefs): void {
  setScopedStorageItem(READER_PREFS_KEY, JSON.stringify(prefs));
  emitLocalWorkspaceChanged('ui_theme');
}

async function resizeAvatarFile(file: File): Promise<string> {
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 5MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('File ảnh không hợp lệ.'));
    img.src = dataUrl;
  });

  const maxSize = 320;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const optimized = canvas.toDataURL('image/webp', 0.86);
  return optimized.startsWith('data:image/') ? optimized : canvas.toDataURL('image/png');
}

function loadThemeMode(): ThemeMode {
  const raw = getScopedStorageItem(UI_THEME_KEY, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
  return raw === 'dark' ? 'dark' : 'light';
}

function saveThemeMode(mode: ThemeMode): void {
  setScopedStorageItem(UI_THEME_KEY, mode);
  emitLocalWorkspaceChanged('ui_theme');
}

function loadViewportMode(): ViewportMode {
  const raw = getScopedStorageItem(UI_VIEWPORT_MODE_KEY, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
  return raw === 'mobile' ? 'mobile' : 'desktop';
}

function saveViewportMode(mode: ViewportMode): void {
  setScopedStorageItem(UI_VIEWPORT_MODE_KEY, mode);
  emitLocalWorkspaceChanged('ui_viewport_mode');
}

function loadAppMode(): AppMode {
  const raw = getScopedStorageItem(APP_MODE_KEY, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
  return raw === 'creator' ? 'creator' : 'reader';
}

function saveAppMode(mode: AppMode): void {
  setScopedStorageItem(APP_MODE_KEY, mode);
}

interface AccountWorkspaceSnapshot {
  schemaVersion: number;
  revision: number;
  modifiedByDeviceId: string;
  updatedAt: string;
  sectionUpdatedAt: Partial<Record<LocalWorkspaceSection, string>>;
  uiProfile: UiProfile;
  uiTheme: ThemeMode;
  uiViewportMode: ViewportMode;
  stories: Story[];
  characters: Character[];
  aiRules: AIRule[];
  styleReferences: StyleReference[];
  translationNames: TranslationName[];
  promptLibrary: PromptLibraryState;
  finopsBudget: ReturnType<typeof loadBudgetState>;
  driveBinding?: GoogleDriveBinding | null;
  editLock?: WorkspaceEditLock | null;
}

function normalizeOwnedRows<T>(rows: T[], userId?: string): T[] {
  if (!userId) return rows;
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const rowObj = row as Record<string, unknown>;
      const authorId = String(rowObj.authorId || '').trim();
      if (authorId && authorId !== userId) return null;
      return {
        ...rowObj,
        authorId: authorId || userId,
      } as unknown as T;
    })
    .filter((row): row is T => Boolean(row));
}

function sanitizeAccountWorkspaceForUser(snapshot: AccountWorkspaceSnapshot, userId?: string): AccountWorkspaceSnapshot {
  if (!userId) return snapshot;
  return {
    ...snapshot,
    stories: normalizeOwnedRows(snapshot.stories, userId),
    characters: normalizeOwnedRows(snapshot.characters, userId),
    aiRules: normalizeOwnedRows(snapshot.aiRules, userId),
    styleReferences: normalizeOwnedRows(snapshot.styleReferences, userId),
    translationNames: normalizeOwnedRows(snapshot.translationNames, userId),
  };
}

function buildWorkspacePayloadHash(snapshot: Partial<AccountWorkspaceSnapshot>): string {
  return JSON.stringify({
    // Chỉ hash dữ liệu nghiệp vụ để tránh vòng lặp sync do metadata (revision/editLock) thay đổi liên tục.
    uiProfile: snapshot.uiProfile || null,
    uiTheme: snapshot.uiTheme || null,
    uiViewportMode: snapshot.uiViewportMode || null,
    stories: Array.isArray(snapshot.stories) ? snapshot.stories : [],
    characters: Array.isArray(snapshot.characters) ? snapshot.characters : [],
    aiRules: Array.isArray(snapshot.aiRules) ? snapshot.aiRules : [],
    styleReferences: Array.isArray(snapshot.styleReferences) ? snapshot.styleReferences : [],
    translationNames: Array.isArray(snapshot.translationNames) ? snapshot.translationNames : [],
    promptLibrary: snapshot.promptLibrary || null,
    finopsBudget: snapshot.finopsBudget || null,
    driveBinding: normalizeDriveBinding(snapshot.driveBinding) || null,
  });
}

function buildWorkspaceSectionPayloadHash(
  snapshot: Partial<AccountWorkspaceSnapshot>,
  section: LocalWorkspaceSection,
): string {
  const binding = ACCOUNT_WORKSPACE_BINDINGS.find((item) => item.section === section);
  if (!binding) return 'null';
  return JSON.stringify(snapshot[binding.key] ?? null);
}

const ACCOUNT_WORKSPACE_BINDINGS = [
  { section: 'ui_profile', key: 'uiProfile' },
  { section: 'ui_theme', key: 'uiTheme' },
  { section: 'ui_viewport_mode', key: 'uiViewportMode' },
  { section: 'stories', key: 'stories' },
  { section: 'characters', key: 'characters' },
  { section: 'ai_rules', key: 'aiRules' },
  { section: 'style_references', key: 'styleReferences' },
  { section: 'translation_names', key: 'translationNames' },
  { section: 'prompt_library', key: 'promptLibrary' },
  { section: 'finops_budget', key: 'finopsBudget' },
] as const satisfies ReadonlyArray<{ section: LocalWorkspaceSection; key: keyof AccountWorkspaceSnapshot }>;

function shouldNotifyAccountSyncError(lastNotifiedAt: number, cooldownMs = 60_000): boolean {
  return Date.now() - lastNotifiedAt >= cooldownMs;
}

function toTimestampMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getSectionTimestampFromMeta(meta: ReturnType<typeof loadLocalWorkspaceMeta>, section: LocalWorkspaceSection): string {
  const sectionTimestamp = meta.sections?.[section];
  if (typeof sectionTimestamp === 'string' && toTimestampMs(sectionTimestamp) > 0) {
    return sectionTimestamp;
  }
  if (typeof meta.updatedAt === 'string' && toTimestampMs(meta.updatedAt) > 0) {
    return meta.updatedAt;
  }
  return new Date(0).toISOString();
}

function buildSectionUpdatedAt(meta: ReturnType<typeof loadLocalWorkspaceMeta>): Partial<Record<LocalWorkspaceSection, string>> {
  const next: Partial<Record<LocalWorkspaceSection, string>> = {};
  ACCOUNT_WORKSPACE_BINDINGS.forEach(({ section }) => {
    next[section] = getSectionTimestampFromMeta(meta, section);
  });
  return next;
}

function getSnapshotSectionTimestamp(snapshot: Partial<AccountWorkspaceSnapshot>, section: LocalWorkspaceSection): string {
  const sectionTimestamp = snapshot.sectionUpdatedAt?.[section];
  if (typeof sectionTimestamp === 'string' && toTimestampMs(sectionTimestamp) > 0) {
    return sectionTimestamp;
  }
  if (typeof snapshot.updatedAt === 'string' && toTimestampMs(snapshot.updatedAt) > 0) {
    return snapshot.updatedAt;
  }
  return new Date(0).toISOString();
}

function hasPromptLibraryEntries(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PromptLibraryState>;
  return ['core', 'genre', 'adult'].some((key) => Array.isArray(state[key as keyof PromptLibraryState]) && (state[key as keyof PromptLibraryState] as unknown[]).length > 0);
}

function isSectionPopulated(section: LocalWorkspaceSection, value: unknown): boolean {
  switch (section) {
    case 'stories':
    case 'characters':
    case 'ai_rules':
    case 'style_references':
    case 'translation_names':
      return Array.isArray(value) && value.length > 0;
    case 'prompt_library':
      return hasPromptLibraryEntries(value);
    case 'ui_profile':
      return Boolean(value && typeof value === 'object' && (
        String((value as Partial<UiProfile>).displayName || '').trim() ||
        String((value as Partial<UiProfile>).avatarUrl || '').trim()
      ));
    case 'finops_budget':
      return Boolean(value && typeof value === 'object');
    case 'ui_theme':
    case 'ui_viewport_mode':
      return typeof value === 'string' && value.trim().length > 0;
    default:
      return value !== undefined && value !== null;
  }
}

function chooseWorkspaceSectionValue<T>(
  section: LocalWorkspaceSection,
  localValue: T,
  remoteValue: T | undefined,
  localTimestamp: string,
  remoteTimestamp: string,
): { value: T; updatedAt: string } {
  if (typeof remoteValue === 'undefined') {
    return { value: localValue, updatedAt: localTimestamp };
  }

  const localMs = toTimestampMs(localTimestamp);
  const remoteMs = toTimestampMs(remoteTimestamp);
  const localPopulated = isSectionPopulated(section, localValue);
  const remotePopulated = isSectionPopulated(section, remoteValue);

  if (remoteMs > localMs) {
    // Bảo vệ dữ liệu local đang có: không để bản remote rỗng nhưng timestamp mới hơn ghi đè.
    if (!remotePopulated && localPopulated) {
      return { value: localValue, updatedAt: localTimestamp };
    }
    return { value: remoteValue, updatedAt: remoteTimestamp };
  }
  if (localMs > remoteMs) {
    return { value: localValue, updatedAt: localTimestamp };
  }

  if (remotePopulated && !localPopulated) {
    return { value: remoteValue, updatedAt: remoteTimestamp || localTimestamp };
  }
  return { value: localValue, updatedAt: localTimestamp || remoteTimestamp };
}

function normalizeDeletedChapterMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([chapterId, deletedAt]) => {
    const id = String(chapterId || '').trim();
    if (!id) return;
    const rawTimestamp = String(deletedAt || '').trim();
    if (!rawTimestamp) return;
    const parsed = new Date(rawTimestamp);
    if (Number.isNaN(parsed.getTime())) return;
    next[id] = rawTimestamp;
  });
  return next;
}

function mergeDeletedChapterMaps(localMap: unknown, remoteMap: unknown): Record<string, string> {
  const local = normalizeDeletedChapterMap(localMap);
  const remote = normalizeDeletedChapterMap(remoteMap);
  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  const merged: Record<string, string> = {};
  ids.forEach((id) => {
    const localTs = local[id];
    const remoteTs = remote[id];
    if (!localTs && remoteTs) {
      merged[id] = remoteTs;
      return;
    }
    if (localTs && !remoteTs) {
      merged[id] = localTs;
      return;
    }
    const localMs = toTimestampMs(localTs);
    const remoteMs = toTimestampMs(remoteTs);
    merged[id] = localMs >= remoteMs ? localTs : (remoteTs || localTs);
  });
  return merged;
}

function pruneDeletedChapterMap(map: Record<string, string>, ttlDays = 45): Record<string, string> {
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  const next: Record<string, string> = {};
  Object.entries(map || {}).forEach(([chapterId, deletedAt]) => {
    if (toTimestampMs(deletedAt) >= cutoff) {
      next[chapterId] = deletedAt;
    }
  });
  return next;
}

function isChapterDeletedByTombstone(
  chapterId: string,
  tombstoneMap: Record<string, string>,
  chapter: Chapter | undefined,
): boolean {
  const deletedAt = tombstoneMap[chapterId];
  if (!deletedAt) return false;
  const deletedAtMs = toTimestampMs(deletedAt);
  const chapterUpdatedMs = toTimestampMs(chapter?.updatedAt || chapter?.createdAt);
  return deletedAtMs >= chapterUpdatedMs;
}

function mergeChaptersById(
  localChapters: Chapter[] = [],
  remoteChapters: Chapter[] = [],
  prefer: 'local' | 'remote',
  localDeletedChapterIds?: Record<string, string>,
  remoteDeletedChapterIds?: Record<string, string>,
): Chapter[] {
  const localMap = new Map(localChapters.map((chapter) => [String(chapter.id || ''), chapter]));
  const remoteMap = new Map(remoteChapters.map((chapter) => [String(chapter.id || ''), chapter]));
  const mergedDeletedMap = pruneDeletedChapterMap(
    mergeDeletedChapterMaps(localDeletedChapterIds || {}, remoteDeletedChapterIds || {}),
  );
  const merged: Chapter[] = [];
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()].filter(Boolean));

  ids.forEach((id) => {
    const localChapter = localMap.get(id);
    const remoteChapter = remoteMap.get(id);
    const chapterForTombstone = localChapter || remoteChapter;
    if (isChapterDeletedByTombstone(id, mergedDeletedMap, chapterForTombstone)) {
      return;
    }
    if (localChapter && remoteChapter) {
      merged.push(prefer === 'local' ? localChapter : remoteChapter);
      return;
    }
    if (localChapter) merged.push(localChapter);
    if (remoteChapter) merged.push(remoteChapter);
  });

  return merged.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function mergeStoriesByEntity(
  localStories: Story[] = [],
  remoteStories: Story[] = [],
  lock: WorkspaceEditLock | null,
  deviceId?: string,
): Story[] {
  const localMap = new Map(localStories.map((story) => [String(story.id || ''), story]));
  const remoteMap = new Map(remoteStories.map((story) => [String(story.id || ''), story]));
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()].filter(Boolean));
  const merged: Story[] = [];

  ids.forEach((id) => {
    const localStory = localMap.get(id);
    const remoteStory = remoteMap.get(id);
    if (!localStory && remoteStory) {
      merged.push({
        ...remoteStory,
        deletedChapterIds: pruneDeletedChapterMap(normalizeDeletedChapterMap(remoteStory.deletedChapterIds || {})),
      });
      return;
    }
    if (localStory && !remoteStory) {
      merged.push({
        ...localStory,
        deletedChapterIds: pruneDeletedChapterMap(normalizeDeletedChapterMap(localStory.deletedChapterIds || {})),
      });
      return;
    }
    if (!localStory || !remoteStory) return;

    const lockByOtherDevice = Boolean(
      lock &&
      isWorkspaceEditLockActive(lock) &&
      lock.storyId === id &&
      lock.deviceId !== deviceId,
    );
    if (lockByOtherDevice) {
      merged.push({
        ...remoteStory,
        deletedChapterIds: pruneDeletedChapterMap(normalizeDeletedChapterMap(remoteStory.deletedChapterIds || {})),
      });
      return;
    }

    const localUpdatedMs = toTimestampMs(localStory.updatedAt || localStory.createdAt);
    const remoteUpdatedMs = toTimestampMs(remoteStory.updatedAt || remoteStory.createdAt);
    const prefer = localUpdatedMs >= remoteUpdatedMs ? 'local' : 'remote';

    const base = prefer === 'local'
      ? { ...remoteStory, ...localStory }
      : { ...localStory, ...remoteStory };
    const mergedDeletedChapterIds = pruneDeletedChapterMap(
      mergeDeletedChapterMaps(localStory.deletedChapterIds || {}, remoteStory.deletedChapterIds || {}),
    );
    base.deletedChapterIds = mergedDeletedChapterIds;
    base.chapters = mergeChaptersById(
      localStory.chapters || [],
      remoteStory.chapters || [],
      prefer,
      localStory.deletedChapterIds || {},
      remoteStory.deletedChapterIds || {},
    );
    merged.push(base);
  });

  return merged.sort((a, b) => toTimestampMs(b.updatedAt || b.createdAt) - toTimestampMs(a.updatedAt || a.createdAt));
}

function mergeAccountWorkspaceSnapshots(
  localSnapshot: AccountWorkspaceSnapshot,
  remoteSnapshot: Partial<AccountWorkspaceSnapshot>,
  options?: { deviceId?: string },
): AccountWorkspaceSnapshot {
  const localLock = normalizeWorkspaceEditLock(localSnapshot.editLock);
  const remoteLock = normalizeWorkspaceEditLock(remoteSnapshot.editLock);
  const mergedLock = (() => {
    if (!isWorkspaceEditLockActive(localLock) && !isWorkspaceEditLockActive(remoteLock)) return null;
    if (isWorkspaceEditLockActive(localLock) && !isWorkspaceEditLockActive(remoteLock)) return localLock;
    if (!isWorkspaceEditLockActive(localLock) && isWorkspaceEditLockActive(remoteLock)) return remoteLock;
    return toTimestampMs(localLock?.expiresAt) >= toTimestampMs(remoteLock?.expiresAt)
      ? localLock
      : remoteLock;
  })();

  const merged: AccountWorkspaceSnapshot = {
    ...localSnapshot,
    schemaVersion: Math.max(localSnapshot.schemaVersion || 1, Number(remoteSnapshot.schemaVersion) || 1),
    revision: Math.max(Number(localSnapshot.revision) || 0, Number(remoteSnapshot.revision) || 0),
    modifiedByDeviceId: String(localSnapshot.modifiedByDeviceId || remoteSnapshot.modifiedByDeviceId || ''),
    updatedAt: localSnapshot.updatedAt,
    sectionUpdatedAt: {
      ...buildSectionUpdatedAt(loadLocalWorkspaceMeta()),
      ...localSnapshot.sectionUpdatedAt,
    },
    driveBinding: localSnapshot.driveBinding || normalizeDriveBinding(remoteSnapshot.driveBinding) || null,
    editLock: mergedLock,
  };

  ACCOUNT_WORKSPACE_BINDINGS.forEach(({ section, key }) => {
    const picked = chooseWorkspaceSectionValue(
      section,
      localSnapshot[key],
      remoteSnapshot[key],
      getSnapshotSectionTimestamp(localSnapshot, section),
      getSnapshotSectionTimestamp(remoteSnapshot, section),
    );
    switch (key) {
      case 'uiProfile':
        merged.uiProfile = picked.value as UiProfile;
        break;
      case 'uiTheme':
        merged.uiTheme = picked.value as ThemeMode;
        break;
      case 'uiViewportMode':
        merged.uiViewportMode = picked.value as ViewportMode;
        break;
      case 'stories':
        {
          const localStoriesTimestamp = getSnapshotSectionTimestamp(localSnapshot, 'stories');
          const remoteStoriesTimestamp = getSnapshotSectionTimestamp(remoteSnapshot, 'stories');
          const localStoriesMs = toTimestampMs(localStoriesTimestamp);
          const remoteStoriesMs = toTimestampMs(remoteStoriesTimestamp);

          if (localStoriesMs > remoteStoriesMs) {
            // Local newer: tôn trọng xóa/sửa mới nhất ở máy hiện tại, tránh "hồi sinh" chương cũ từ remote.
            merged.stories = localSnapshot.stories;
            merged.sectionUpdatedAt.stories = localStoriesTimestamp;
          } else if (remoteStoriesMs > localStoriesMs) {
            merged.stories = Array.isArray(remoteSnapshot.stories) ? remoteSnapshot.stories : [];
            merged.sectionUpdatedAt.stories = remoteStoriesTimestamp;
          } else {
            // Timestamp bằng nhau: mới merge theo entity để giữ thay đổi ở 2 phía.
            merged.stories = mergeStoriesByEntity(
              localSnapshot.stories,
              Array.isArray(remoteSnapshot.stories) ? remoteSnapshot.stories : [],
              mergedLock,
              options?.deviceId,
            );
            merged.sectionUpdatedAt.stories = localStoriesTimestamp || remoteStoriesTimestamp;
          }
        }
        break;
      case 'characters':
        merged.characters = picked.value as Character[];
        break;
      case 'aiRules':
        merged.aiRules = picked.value as AIRule[];
        break;
      case 'styleReferences':
        merged.styleReferences = picked.value as StyleReference[];
        break;
      case 'translationNames':
        merged.translationNames = picked.value as TranslationName[];
        break;
      case 'promptLibrary':
        merged.promptLibrary = picked.value as PromptLibraryState;
        break;
      case 'finopsBudget':
        merged.finopsBudget = picked.value as ReturnType<typeof loadBudgetState>;
        break;
      default:
        break;
    }
    if (section !== 'stories') {
      merged.sectionUpdatedAt[section] = picked.updatedAt;
    }
  });

  const mergedUpdatedAt = ACCOUNT_WORKSPACE_BINDINGS.reduce((latest, { section }) => {
    const timestamp = merged.sectionUpdatedAt[section];
    return toTimestampMs(timestamp) > toTimestampMs(latest) ? String(timestamp) : latest;
  }, localSnapshot.updatedAt || remoteSnapshot.updatedAt || new Date().toISOString());

  merged.updatedAt = mergedUpdatedAt;
  return merged;
}

function storeWorkspaceRecoverySnapshot(snapshot: AccountWorkspaceSnapshot, source: string, userId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    setScopedStorageItem(WORKSPACE_RECOVERY_KEY, JSON.stringify({
      source,
      savedAt: new Date().toISOString(),
      payload: snapshot,
    }), userId);
  } catch {
    // Skip recovery cache if storage is unavailable.
  }
}

function loadWorkspaceRecoverySnapshot(userId?: string): AccountWorkspaceSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = getScopedStorageItem(WORKSPACE_RECOVERY_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(userId || getWorkspaceScopeUser()),
      scopeUser: userId,
    });
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: AccountWorkspaceSnapshot };
    if (parsed?.payload && typeof parsed.payload === 'object') {
      return parsed.payload as AccountWorkspaceSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

function buildAccountWorkspaceSnapshot(
  defaultName?: string,
  defaultAvatar?: string,
  userId?: string,
  context?: {
    deviceId?: string;
    baseRevision?: number;
    editLock?: WorkspaceEditLock | null;
  },
): AccountWorkspaceSnapshot {
  const meta = loadLocalWorkspaceMeta();
  return sanitizeAccountWorkspaceForUser({
    schemaVersion: 1,
    revision: Math.max(0, Number(context?.baseRevision) || 0),
    modifiedByDeviceId: String(context?.deviceId || ''),
    updatedAt: meta.updatedAt || new Date().toISOString(),
    sectionUpdatedAt: buildSectionUpdatedAt(meta),
    uiProfile: loadUiProfile(defaultName, defaultAvatar),
    uiTheme: loadThemeMode(),
    uiViewportMode: loadViewportMode(),
    stories: storage.getStories(),
    characters: storage.getCharacters(),
    aiRules: storage.getAIRules(),
    styleReferences: storage.getStyleReferences(),
    translationNames: storage.getTranslationNames(),
    promptLibrary: loadPromptLibraryState(),
    finopsBudget: loadBudgetState(),
    driveBinding: loadDriveBindingForUser(userId),
    editLock: normalizeWorkspaceEditLock(context?.editLock) || null,
  }, userId);
}

function applyAccountWorkspaceSnapshot(snapshot: Partial<AccountWorkspaceSnapshot>, defaultName?: string, defaultAvatar?: string, userId?: string): void {
  const sanitizedSnapshot = snapshot.stories || snapshot.characters || snapshot.aiRules || snapshot.translationNames
    ? sanitizeAccountWorkspaceForUser({
        schemaVersion: Number(snapshot.schemaVersion) || 1,
        revision: Math.max(0, Number(snapshot.revision) || 0),
        modifiedByDeviceId: String(snapshot.modifiedByDeviceId || ''),
        updatedAt: String(snapshot.updatedAt || new Date().toISOString()),
        sectionUpdatedAt: snapshot.sectionUpdatedAt || {},
        uiProfile: (snapshot.uiProfile || loadUiProfile(defaultName, defaultAvatar)) as UiProfile,
        uiTheme: (snapshot.uiTheme === 'dark' ? 'dark' : 'light') as ThemeMode,
        uiViewportMode: (snapshot.uiViewportMode === 'mobile' ? 'mobile' : 'desktop') as ViewportMode,
        stories: Array.isArray(snapshot.stories) ? snapshot.stories : [],
        characters: Array.isArray(snapshot.characters) ? snapshot.characters : [],
        aiRules: Array.isArray(snapshot.aiRules) ? snapshot.aiRules : [],
        styleReferences: Array.isArray(snapshot.styleReferences) ? snapshot.styleReferences : [],
        translationNames: Array.isArray(snapshot.translationNames) ? snapshot.translationNames : [],
        promptLibrary: (snapshot.promptLibrary || loadPromptLibraryState()) as PromptLibraryState,
        finopsBudget: (snapshot.finopsBudget || loadBudgetState()) as ReturnType<typeof loadBudgetState>,
        driveBinding: snapshot.driveBinding,
        editLock: normalizeWorkspaceEditLock(snapshot.editLock),
      }, userId)
    : null;

  const nextProfileRaw = snapshot.uiProfile;
  if (nextProfileRaw && typeof nextProfileRaw === 'object') {
    saveUiProfile({
      displayName: String(nextProfileRaw.displayName || defaultName || 'Người dùng').trim() || 'Người dùng',
      avatarUrl: String(nextProfileRaw.avatarUrl || defaultAvatar || DEFAULT_PROFILE_AVATAR).trim() || DEFAULT_PROFILE_AVATAR,
    });
  }
  if (snapshot.uiTheme === 'dark' || snapshot.uiTheme === 'light') {
    saveThemeMode(snapshot.uiTheme);
  }
  if (snapshot.uiViewportMode === 'desktop' || snapshot.uiViewportMode === 'mobile') {
    saveViewportMode(snapshot.uiViewportMode);
  }
  if (Array.isArray(snapshot.stories)) {
    saveStoriesAndRefresh(sanitizedSnapshot?.stories || snapshot.stories);
  }
  if (Array.isArray(snapshot.characters)) {
    storage.saveCharacters(sanitizedSnapshot?.characters || snapshot.characters);
  }
  if (Array.isArray(snapshot.aiRules)) {
    storage.saveAIRules(sanitizedSnapshot?.aiRules || snapshot.aiRules);
  }
  if (Array.isArray(snapshot.styleReferences)) {
    storage.saveStyleReferences(snapshot.styleReferences);
  }
  if (Array.isArray(snapshot.translationNames)) {
    storage.saveTranslationNames(sanitizedSnapshot?.translationNames || snapshot.translationNames);
  }
  if (snapshot.promptLibrary && typeof snapshot.promptLibrary === 'object') {
    savePromptLibraryState(snapshot.promptLibrary);
  }
  if (snapshot.finopsBudget && typeof snapshot.finopsBudget === 'object') {
    saveBudgetState(snapshot.finopsBudget);
  }
  if (userId && Object.prototype.hasOwnProperty.call(snapshot, 'driveBinding')) {
    saveDriveBindingForUser(userId, normalizeDriveBinding(snapshot.driveBinding));
  }
  markLocalWorkspaceHydrated(snapshot.updatedAt || new Date().toISOString(), 'cloud-hydrate', snapshot.sectionUpdatedAt);
}

function parseLongIdFromText(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  const m1 = value.match(/[?&]long=(\d+)/i);
  if (m1?.[1]) return m1[1];
  const m2 = value.match(/long\s*[=:]\s*(\d+)/i);
  if (m2?.[1]) return m2[1];
  const m3 = value.match(/=(\d+)(?:\D|$)/);
  return m3?.[1] || '';
}

function parseRelayCodeFromText(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  const c0 = value.match(/\/=(\d{4,8})(?:\D|$)/i);
  if (c0?.[1]) return c0[1];
  const c00 = value.match(/\/code=(\d{4,8})(?:\D|$)/i);
  if (c00?.[1]) return c00[1];
  const c01 = value.match(/\/(\d{4,8})(?:[/?#]|$)/i);
  if (c01?.[1]) return c01[1];
  const c1 = value.match(/[?&]code=(\d{4,8})/i);
  if (c1?.[1]) return c1[1];
  const c2 = value.match(/\/code=(\d{4,8})/i);
  if (c2?.[1]) return c2[1];
  if (/^\d{4,8}$/.test(value)) return value;
  const asLong = parseLongIdFromText(value);
  if (/^\d{4,8}$/.test(asLong)) return asLong;
  return '';
}

function normalizeRelaySocketBase(input: string): string {
  const raw = toWsUrl(String(input || '').trim() || DEFAULT_RELAY_WS_BASE);
  try {
    const url = new URL(raw);
    const prefersPathCode = !/[?&]code=/i.test(raw) && !/\/code=/i.test(raw);
    if (prefersPathCode) {
      url.searchParams.delete('code');
      url.pathname = `${url.pathname.replace(/\/\d{4,8}\/?$/i, '').replace(/\/+$/, '')}/`;
      return url.toString();
    }
    if (/\/code=$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/code=$/i, '/');
      url.searchParams.set('code', '');
      return url.toString().replace(/code=$/, 'code=');
    }
    if (!url.searchParams.has('code')) {
      url.searchParams.set('code', '');
    }
    return url.toString().replace(/code=$/, 'code=');
  } catch {
    return DEFAULT_RELAY_WS_BASE;
  }
}

function buildRelaySocketUrl(code: string): string {
  return buildRelayConnectUrl(RELAY_SOCKET_BASE, code);
}

function ensureRelayClientRole(rawUrl: string): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('role', 'client');
    return url.toString();
  } catch {
    const joiner = raw.includes('?') ? '&' : '?';
    return raw.includes('role=') ? raw : `${raw}${joiner}role=client`;
  }
}

function buildRelayConnectUrl(rawInput: string, code: string): string {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return ensureRelayClientRole(toWsUrl(rawInput || RELAY_SOCKET_BASE));
  const raw = normalizeRelaySocketBase(rawInput || RELAY_SOCKET_BASE);
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('code') && !/[?&]code=/i.test(raw)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${cleanCode}`;
      url.searchParams.set('role', 'client');
      return url.toString();
    }
    url.searchParams.set('code', cleanCode);
    url.searchParams.set('role', 'client');
    return url.toString();
  } catch {
    return ensureRelayClientRole(`${RELAY_SOCKET_BASE}${cleanCode}`);
  }
}

function extractGeminiKeyFromText(input: string): string {
  const found = String(input || '').match(/AIza[0-9A-Za-z\-_]{20,}/);
  return found?.[0] || '';
}

function extractGcliTokenFromText(input: string): string {
  const text = String(input || '').trim();
  if (!text) return '';
  const bearer = text.match(/Bearer\s+(ya29\.[0-9A-Za-z\-_\.]+)/i);
  if (bearer?.[1]) return bearer[1];
  const raw = text.match(/ya29\.[0-9A-Za-z\-_\.]+/);
  return raw?.[0] || '';
}
function maskSensitive(value: string, head = 8, tail = 6): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.length <= head + tail + 2) return `${v.slice(0, 3)}...`;
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function toWsUrl(url: string): string {
  const u = url.trim();
  if (u.startsWith('wss://') || u.startsWith('ws://')) return u;
  if (u.startsWith('https://')) return `wss://${u.slice('https://'.length)}`;
  if (u.startsWith('http://')) return `ws://${u.slice('http://'.length)}`;
  return `wss://${u.replace(/^\/+/, '')}`;
}

function normalizeOllamaLocalHostTypo(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if ((host === '127.0.0.1' || host === 'localhost') && parsed.port === '1143') {
      parsed.port = '11434';
      return parsed.toString().replace(/\/+$/, '');
    }
    return raw;
  } catch {
    return raw;
  }
}

function normalizeOllamaOpenAiBaseUrl(input: string): string {
  const raw = normalizeOllamaLocalHostTypo(input);
  if (!raw) return getProviderBaseUrl('ollama');
  const clean = raw.replace(/\/+$/, '');
  if (/\/v1$/i.test(clean) || /\/chat\/completions$/i.test(clean)) {
    return clean;
  }
  return `${clean}/v1`;
}

function normalizeOllamaApiBaseUrl(input: string): string {
  const raw = normalizeOllamaLocalHostTypo(input) || getProviderBaseUrl('ollama');
  const clean = raw.replace(/\/+$/, '');
  return clean
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');
}

function normalizeStoredRelayUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return buildRelaySocketUrl('');

  const code = parseRelayCodeFromText(raw);
  if (LEGACY_RELAY_HOST_RE.test(raw)) {
    return buildRelaySocketUrl(code);
  }

  return raw;
}

function getApiRuntimeConfig(): ApiRuntimeConfig {
  try {
    const raw = readScopedAppStorage(API_RUNTIME_CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ApiRuntimeConfig>) : {};
    return {
      mode: parsed.mode === 'relay' ? 'relay' : 'manual',
      relayUrl: normalizeStoredRelayUrl(parsed.relayUrl || buildRelaySocketUrl('')),
      identityHint: parsed.identityHint || '',
      relayMatchedLong: parsed.relayMatchedLong || '',
      relayToken: parsed.relayToken || '',
      relayUpdatedAt: parsed.relayUpdatedAt || '',
      aiProfile: parsed.aiProfile === 'economy' || parsed.aiProfile === 'quality' ? parsed.aiProfile : 'balanced',
      selectedProvider:
        parsed.selectedProvider === 'gcli' ||
        parsed.selectedProvider === 'openai' ||
        parsed.selectedProvider === 'anthropic' ||
        parsed.selectedProvider === 'xai' ||
        parsed.selectedProvider === 'groq' ||
        parsed.selectedProvider === 'deepseek' ||
        parsed.selectedProvider === 'openrouter' ||
        parsed.selectedProvider === 'mistral' ||
        parsed.selectedProvider === 'ollama' ||
        parsed.selectedProvider === 'custom' ||
        parsed.selectedProvider === 'unknown'
          ? parsed.selectedProvider
          : 'gemini',
      selectedModel: parsed.selectedModel || '',
      activeApiKeyId: parsed.activeApiKeyId || '',
      enableCache: parsed.enableCache !== false,
      generation: sanitizeGenerationConfig(parsed.generation),
    };
  } catch {
    return {
      mode: 'manual',
      relayUrl: buildRelaySocketUrl(''),
      identityHint: '',
      relayMatchedLong: '',
      relayToken: '',
      relayUpdatedAt: '',
      aiProfile: 'balanced',
      selectedProvider: 'gemini',
      selectedModel: '',
      activeApiKeyId: '',
      enableCache: true,
      generation: DEFAULT_GENERATION_CONFIG,
    };
  }
}

function saveApiRuntimeConfig(config: ApiRuntimeConfig): void {
  writeScopedAppStorage(API_RUNTIME_CONFIG_KEY, JSON.stringify(config));
}

function getDefaultImageProviderApiKey(provider: ImageAiProvider): string {
  if (provider === 'evolink') return readRaphaelEnv('VITE_RAPHAEL_API_KEY');
  if (provider === 'openai') return ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPENAI_API_KEY || '').trim();
  return '';
}

function createDefaultImageProvidersConfig(): ImageApiConfig['providers'] {
  return {
    evolink: {
      apiKey: getDefaultImageProviderApiKey('evolink'),
      model: readRaphaelEnv('VITE_RAPHAEL_MODEL') || getDefaultImageAiModel('evolink'),
    },
    openai: {
      apiKey: getDefaultImageProviderApiKey('openai'),
      model: getDefaultImageAiModel('openai'),
    },
    fal: {
      apiKey: '',
      model: getDefaultImageAiModel('fal'),
    },
    bfl: {
      apiKey: '',
      model: getDefaultImageAiModel('bfl'),
    },
  };
}

function getImageApiConfig(): ImageApiConfig {
  const defaults = createDefaultImageProvidersConfig();
  try {
    const raw = readScopedAppStorage(IMAGE_API_CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ImageApiConfig>) : {};
    const provider = parsed.provider === 'openai' || parsed.provider === 'fal' || parsed.provider === 'bfl' ? parsed.provider : 'evolink';
    const rawProviders = parsed.providers && typeof parsed.providers === 'object'
      ? parsed.providers as Partial<Record<ImageAiProvider, { apiKey?: string; model?: string }>>
      : {};
    const legacyKey = String((parsed as { apiKey?: string }).apiKey || '').trim();
    const legacyModel = String((parsed as { model?: string }).model || '').trim();
    const providers = {
      evolink: {
        apiKey: String(rawProviders.evolink?.apiKey || legacyKey || defaults.evolink.apiKey).trim(),
        model: String(rawProviders.evolink?.model || legacyModel || defaults.evolink.model).trim() || getDefaultImageAiModel('evolink'),
      },
      openai: {
        apiKey: String(rawProviders.openai?.apiKey || defaults.openai.apiKey).trim(),
        model: String(rawProviders.openai?.model || defaults.openai.model).trim() || getDefaultImageAiModel('openai'),
      },
      fal: {
        apiKey: String(rawProviders.fal?.apiKey || defaults.fal.apiKey).trim(),
        model: String(rawProviders.fal?.model || defaults.fal.model).trim() || getDefaultImageAiModel('fal'),
      },
      bfl: {
        apiKey: String(rawProviders.bfl?.apiKey || defaults.bfl.apiKey).trim(),
        model: String(rawProviders.bfl?.model || defaults.bfl.model).trim() || getDefaultImageAiModel('bfl'),
      },
    };
    const hasAnyKey = Object.values(providers).some((entry) => entry.apiKey);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : hasAnyKey,
      provider,
      size: String(parsed.size || '').trim() || readRaphaelEnv('VITE_RAPHAEL_SIZE') || DEFAULT_RAPHAEL_SIZE,
      providers,
    };
  } catch {
    return {
      enabled: Object.values(defaults).some((entry) => entry.apiKey),
      provider: 'evolink',
      size: readRaphaelEnv('VITE_RAPHAEL_SIZE') || DEFAULT_RAPHAEL_SIZE,
      providers: defaults,
    };
  }
}

function saveImageApiConfig(config: ImageApiConfig): void {
  writeScopedAppStorage(IMAGE_API_CONFIG_KEY, JSON.stringify(config));
}

function normalizeDateValue(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : value;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === 'function') {
      return maybe.toDate().toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeChaptersForLocal<T extends { createdAt?: unknown; updatedAt?: unknown }>(chapters: T[]): T[] {
  return chapters.map((chapter) => ({
    ...chapter,
    createdAt: normalizeDateValue(chapter.createdAt),
    updatedAt: normalizeDateValue(chapter.updatedAt || chapter.createdAt),
  })) as T[];
}

function bumpStoriesVersion(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STORIES_UPDATED_EVENT));
}

function createClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractRelayPayload(rawMessage: string): { longId: string; codeId: string; token: string } {
  const text = String(rawMessage || '').trim();
  let longId = parseLongIdFromText(text);
  let codeId = parseRelayCodeFromText(text);
  let token = '';

  const possibleToken = text.match(/AIza[0-9A-Za-z\-_]{20,}/);
  if (possibleToken?.[0]) {
    token = possibleToken[0];
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidates = [parsed.long, parsed.longId, parsed.id, parsed.session, parsed.code, parsed.url];
    for (const c of candidates) {
      const extracted = parseLongIdFromText(String(c || ''));
      if (extracted) {
        longId = extracted;
        break;
      }
    }
    const codeCandidates = [parsed.code, parsed.channel, parsed.sessionCode, parsed.url];
    for (const c of codeCandidates) {
      const extracted = parseRelayCodeFromText(String(c || ''));
      if (extracted) {
        codeId = extracted;
        break;
      }
    }
    const nested = (parsed.data && typeof parsed.data === 'object') ? (parsed.data as Record<string, unknown>) : {};
    const tokenCandidates = [
      parsed.token, parsed.apiKey, parsed.geminiKey, parsed.accessToken, parsed.authorization, parsed.bearerToken,
      nested.token, nested.apiKey, nested.accessToken, nested.authorization, nested.bearerToken,
    ];
    for (const t of tokenCandidates) {
      const value = String(t || '').trim();
      if (value) {
        const normalized = value.replace(/^Bearer\s+/i, '').trim();
        token = normalized;
        break;
      }
    }
  } catch {
    // Non-JSON payload is allowed.
  }

  return { longId, codeId, token };
}

function loadApiVault(profile: AiProfileMode = getApiRuntimeConfig().aiProfile): StoredApiKeyRecord[] {
  return normalizeStoredApiKeys(storage.getApiKeys(), profile);
}

function saveApiVault(list: StoredApiKeyRecord[]): void {
  storage.saveApiKeys(list);
}

function getRuntimeProvider(runtime: ApiRuntimeConfig, fallback?: ApiProvider): ApiProvider {
  if (runtime.mode === 'relay') return 'gemini';
  if (fallback && fallback !== 'unknown') return fallback;
  return runtime.selectedProvider === 'unknown' ? 'gemini' : runtime.selectedProvider;
}

function getProfileModel(kind: 'fast' | 'quality', provider?: ApiProvider): string {
  const runtime = getApiRuntimeConfig();
  const resolvedProvider = getRuntimeProvider(runtime, provider);
  if (runtime.selectedModel && (!provider || resolvedProvider === provider || provider === 'unknown')) {
    return runtime.selectedModel;
  }
  if (resolvedProvider === 'custom') {
    return runtime.selectedModel || 'custom-model';
  }
  if (runtime.aiProfile === 'quality' && kind === 'fast') {
    return getDefaultModelForProvider(resolvedProvider, 'balanced');
  }
  return getDefaultModelForProvider(resolvedProvider, runtime.aiProfile);
}

function readGeminiCache(): Record<string, { text: string; ts: number }> {
  try {
    const raw = readScopedAppStorage(GEMINI_RESPONSE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { text: string; ts: number }>) : {};
    return parsed || {};
  } catch {
    return {};
  }
}

function writeGeminiCache(cache: Record<string, { text: string; ts: number }>): void {
  writeScopedAppStorage(GEMINI_RESPONSE_CACHE_KEY, JSON.stringify(cache));
}

function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return `${h}`;
}

function stripJsonFence(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  return text.replace(/```/g, '').trim();
}

function normalizeJsonLikeText(raw: string): string {
  return stripJsonFence(raw)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/\u3000/g, ' ')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function tryParseJson<T = unknown>(raw: string, prefer: 'array' | 'object' | 'any' = 'any'): T | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const candidates: string[] = [];
  const normalized = normalizeJsonLikeText(text);
  if (normalized && normalized !== text) candidates.push(normalized);
  const fenced = stripJsonFence(text);
  if (fenced && fenced !== text) candidates.push(fenced);
  if (prefer !== 'object') {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) candidates.push(arrayMatch[0]);
    if (normalized && normalized !== text) {
      const normalizedArrayMatch = normalized.match(/\[[\s\S]*\]/);
      if (normalizedArrayMatch?.[0]) candidates.push(normalizedArrayMatch[0]);
    }
  }
  if (prefer !== 'array') {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) candidates.push(objMatch[0]);
    if (normalized && normalized !== text) {
      const normalizedObjMatch = normalized.match(/\{[\s\S]*\}/);
      if (normalizedObjMatch?.[0]) candidates.push(normalizedObjMatch[0]);
    }
  }
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

interface ChapterDraftPayloadItem {
  title?: string;
  content?: string;
  outline?: string;
}

function toChapterDraftPayloadItem(value: unknown): ChapterDraftPayloadItem | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = String(record.title || record.name || '').trim();
  const content = String(record.content || record.text || '').trim();
  const outline = String(record.outline || record.summary || record.brief || '').trim();
  if (!title && !content && !outline) return null;
  return {
    title: title || undefined,
    content: content || undefined,
    outline: outline || undefined,
  };
}

function extractChapterDraftItems(value: unknown): ChapterDraftPayloadItem[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toChapterDraftPayloadItem(item))
      .filter((item): item is ChapterDraftPayloadItem => Boolean(item));
  }
  const record = asRecord(value);
  if (!record) return [];
  const candidates: unknown[] = [record.chapters, record.items, record.data, record.result];
  for (const candidate of candidates) {
    const extracted = extractChapterDraftItems(candidate);
    if (extracted.length) return extracted;
  }
  const single = toChapterDraftPayloadItem(record);
  return single ? [single] : [];
}

function readErrorMessageFromPayload(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  const direct = String(record.message || record.error_description || '').trim();
  if (direct) return direct;
  const nestedError = asRecord(record.error);
  return String(nestedError?.message || '').trim();
}

function extractJsonContent(raw: string): { title?: string; content?: string } | null {
  const tryObject = (input: string) => tryParseJson<Record<string, unknown>>(input, 'object');
  const parsed = tryObject(raw) || tryObject(normalizeJsonLikeText(raw));
  if (parsed && (parsed.title != null || parsed.content != null)) {
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
    };
  }
  const text = normalizeJsonLikeText(raw);
  const contentMatch =
    text.match(/["']content["']\s*:\s*"([\s\S]*?)"\s*(?:,|\})/i) ||
    text.match(/["']content["']\s*:\s*'([\s\S]*?)'\s*(?:,|\})/i);
  const titleMatch =
    text.match(/["']title["']\s*:\s*"([\s\S]*?)"\s*(?:,|\})/i) ||
    text.match(/["']title["']\s*:\s*'([\s\S]*?)'\s*(?:,|\})/i);
  if (contentMatch?.[1] != null) {
    const unescapeJson = (value: string) => {
      const asJsonString = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      try {
        return JSON.parse(`"${asJsonString}"`) as string;
      } catch {
        return value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    };
    return {
      title: titleMatch?.[1] ? unescapeJson(titleMatch[1]) : undefined,
      content: unescapeJson(contentMatch[1]),
    };
  }
  return null;
}

function normalizeAiJsonContent(raw: string, fallbackTitle: string): { title: string; content: string } {
  const extracted = extractJsonContent(raw);
  const fallbackText = stripJsonFence(raw).trim();
  let content = String(extracted?.content || fallbackText || '').trim();
  const nested = extractJsonContent(content);
  if (nested?.content) {
    content = String(nested.content).trim();
  }
  content = content
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
  content = improveDialogueSpacing(content);
  content = improveBracketSystemSpacing(content);
  return {
    title: String(extracted?.title || fallbackTitle).trim() || fallbackTitle,
    content,
  };
}

function improveDialogueSpacing(text: string): string {
  if (!text) return text;
  let next = text;
  // Thêm ngắt dòng rõ giữa các câu thoại khi có dấu câu + dấu ngoặc kép tiếp theo.
  next = next.replace(/([.!?…。！？])\s+(["“”『「])/g, '$1\n\n$2');
  // Nếu vẫn còn nhiều hơn 2 dòng trống, co lại.
  next = next.replace(/\n{3,}/g, '\n\n');
  return next;
}

function improveBracketSystemSpacing(text: string): string {
  if (!text) return text;
  let next = text;
  // Tách các block [] đứng cạnh nhau thành từng đoạn riêng.
  next = next.replace(/\]\s*\[/g, ']\n\n[');
  // Nếu block [] dính với câu trước thì ép xuống đoạn mới.
  next = next.replace(/([^\n])\s+(\[[^\]\n]{2,220}\])/g, '$1\n\n$2');
  next = next.replace(/([.!?…。！？])(\[[^\]\n]{2,220}\])/g, '$1\n\n$2');
  // Nếu block [] dính với câu sau thì ép xuống đoạn mới.
  next = next.replace(/(\[[^\]\n]{2,220}\])\s+([^\n\s])/g, '$1\n\n$2');
  next = next.replace(/\n{3,}/g, '\n\n');
  return next;
}

interface DetectedChapterSection {
  title: string;
  content: string;
}

interface ChapterTranslationUnit {
  title: string;
  source: string;
  segments: string[];
}

interface TranslationDictionaryEntry {
  original: string;
  translation: string;
}

interface TranslationBatchEntry {
  index: number;
  text: string;
}

interface TranslationSegmentBatch {
  entries: TranslationBatchEntry[];
  sourceText: string;
}

type ChapterHeadingKind = 'chapter' | 'volume' | 'special';

interface ChapterHeadingPattern {
  regex: RegExp;
  kind: ChapterHeadingKind;
  requiresOrder: boolean;
  minScore: number;
}

interface ChapterHeadingCandidate {
  title: string;
  order: number | null;
  kind: ChapterHeadingKind;
  score: number;
}

const CHAPTER_HEADING_PATTERNS: ChapterHeadingPattern[] = [
  {
    regex: /^(?:#{1,6}\s*)?第\s*([0-9０-９一二三四五六七八九十百千万億亿萬萬兩两零〇IVXLCDMivxlcdm]+)\s*([章节回卷部集篇])(?:\s*(?:[:：\-—.．、]\s*|\s+)?(.*))?$/,
    kind: 'chapter',
    requiresOrder: true,
    minScore: 4,
  },
  {
    regex: /^(?:#{1,6}\s*)?(?:chương|chuong|chapter)\s*([0-9ivxlcdm]+)(?:\s*(?:[:：\-—.．、]\s*|\s+)?(.*))?$/i,
    kind: 'chapter',
    requiresOrder: true,
    minScore: 4,
  },
  {
    regex: /^(?:#{1,6}\s*)?(?:hồi|hoi)\s*([0-9ivxlcdm]+)(?:\s*(?:[:：\-—.．、]\s*|\s+)?(.*))?$/i,
    kind: 'chapter',
    requiresOrder: true,
    minScore: 4,
  },
  {
    regex: /^(?:#{1,6}\s*)?(?:quyển|quyen|volume|vol\.?)\s*([0-9ivxlcdm]+)(?:\s*(?:[:：\-—.．、]\s*|\s+)?(.*))?$/i,
    kind: 'volume',
    requiresOrder: true,
    minScore: 3,
  },
  {
    regex: /^(?:#{1,6}\s*)?(?:番外|ngoại truyện|phụ chương|special|extra|interlude)(?:\s*(?:[:：\-—.．、]\s*|\s+)(.*))?$/i,
    kind: 'special',
    requiresOrder: false,
    minScore: 4,
  },
];

const CHINESE_NUMERAL_DIGITS: Record<string, number> = {
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '兩': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
};

const CHINESE_NUMERAL_UNITS: Record<string, number> = {
  '十': 10,
  '百': 100,
  '千': 1000,
  '万': 10000,
  '萬': 10000,
  '亿': 100000000,
  '億': 100000000,
};

function cleanChapterHeading(rawLine: string): string {
  return String(rawLine || '')
    .replace(/^#+\s*/, '')
    .replace(/^[\[\(【「『]\s*/, '')
    .replace(/\s*[\]\)】」』]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFullWidthDigits(value: string): string {
  return String(value || '').replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function parseRomanNumeral(token: string): number | null {
  const normalized = String(token || '').trim().toUpperCase();
  if (!normalized || !/^[IVXLCDM]+$/.test(normalized)) return null;
  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  let prev = 0;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const value = values[normalized[i]] || 0;
    if (!value) return null;
    if (value < prev) total -= value;
    else total += value;
    prev = value;
  }
  return total > 0 ? total : null;
}

function parseChineseNumeral(token: string): number | null {
  const normalized = String(token || '').trim();
  if (!normalized || !/^[零〇一二两兩三四五六七八九十百千万萬亿億]+$/.test(normalized)) {
    return null;
  }
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of normalized) {
    if (char in CHINESE_NUMERAL_DIGITS) {
      number = CHINESE_NUMERAL_DIGITS[char];
      continue;
    }
    const unit = CHINESE_NUMERAL_UNITS[char];
    if (!unit) return null;
    if (unit >= 10000) {
      section += number;
      if (section === 0) section = 1;
      total += section * unit;
      section = 0;
      number = 0;
      continue;
    }
    if (number === 0) number = 1;
    section += number * unit;
    number = 0;
  }
  const parsed = total + section + number;
  return parsed > 0 ? parsed : null;
}

function parseChapterOrderToken(rawToken: string): number | null {
  const normalized = normalizeFullWidthDigits(String(rawToken || '').trim());
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const roman = parseRomanNumeral(normalized);
  if (roman) return roman;
  return parseChineseNumeral(normalized);
}

function extractChapterHeadingCandidate(lines: string[], index: number): ChapterHeadingCandidate | null {
  const line = String(lines[index] || '');
  const cleaned = cleanChapterHeading(line);
  if (!cleaned || cleaned.length > 150) return null;
  const prevLine = String(lines[index - 1] || '').trim();
  const nextLine = String(lines[index + 1] || '').trim();

  for (const descriptor of CHAPTER_HEADING_PATTERNS) {
    const match = cleaned.match(descriptor.regex);
    if (!match) continue;

    const orderToken = String(match[1] || '').trim();
    const order = descriptor.requiresOrder ? parseChapterOrderToken(orderToken) : null;
    if (descriptor.requiresOrder && !order) continue;

    let score = descriptor.kind === 'chapter' ? 4 : 3;
    const punctuationTailHits = (cleaned.match(/[。！？!?;；]/g) || []).length;
    const commaHits = (cleaned.match(/[,:，、]/g) || []).length;
    const headingWordCount = countWords(cleaned);
    if (!prevLine) score += 1;
    if (!nextLine) score += 1;
    if (cleaned.length <= 64) score += 1;
    if (punctuationTailHits >= 2) score -= 2;
    if (commaHits >= 4) score -= 1;
    if (headingWordCount >= 24) score -= 2;
    if (/["“”'‘’]/.test(cleaned)) score -= 1;
    if (/^[\d０-９]+(?:[.．、)]\s+).{24,}$/u.test(cleaned)) score -= 2;

    if (score < descriptor.minScore) continue;
    return {
      title: cleaned,
      order,
      kind: descriptor.kind,
      score,
    };
  }

  return null;
}

function splitTextIntoNaturalSentences(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const byLatinSpacing = normalized
    .split(/(?<=[.!?。！？；;])(?:\s+|(?=["'“”‘’「」『』（）()]))/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (byLatinSpacing.length >= 2) return byLatinSpacing;

  const byPunctuation = normalized
    .match(/[^。！？!?；;\n]+[。！？!?；;”"’'）)]*/g)
    ?.map((item) => item.trim())
    .filter(Boolean);
  if (byPunctuation?.length) return byPunctuation;

  return [normalized];
}

function splitLargeTextByParagraphs(text: string, maxChars: number): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let buffer = '';
  const parts = normalized.split(/\n{2,}/);

  const pushSegment = (segment: string) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    if (trimmed.length <= maxChars) {
      chunks.push(trimmed);
      return;
    }

    const sentences = splitTextIntoNaturalSentences(trimmed);

    if (!sentences.length) {
      for (let i = 0; i < trimmed.length; i += maxChars) {
        chunks.push(trimmed.slice(i, i + maxChars).trim());
      }
      return;
    }

    let sentenceBuffer = '';
    for (const sentence of sentences) {
      const nextSentence = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
      if (nextSentence.length > maxChars) {
        if (sentenceBuffer) chunks.push(sentenceBuffer.trim());
        if (sentence.length > maxChars) {
          for (let i = 0; i < sentence.length; i += maxChars) {
            chunks.push(sentence.slice(i, i + maxChars).trim());
          }
          sentenceBuffer = '';
        } else {
          sentenceBuffer = sentence;
        }
      } else {
        sentenceBuffer = nextSentence;
      }
    }
    if (sentenceBuffer.trim()) chunks.push(sentenceBuffer.trim());
  };

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const next = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    if (next.length > maxChars) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = '';
      }
      if (trimmed.length > maxChars) {
        pushSegment(trimmed);
      } else {
        buffer = trimmed;
      }
    } else {
      buffer = next;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.filter(Boolean);
}

function detectChapterSections(text: string): DetectedChapterSection[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const markers: Array<{ index: number; title: string; order: number | null; score: number }> = [];

  lines.forEach((_, index) => {
    const candidate = extractChapterHeadingCandidate(lines, index);
    if (!candidate) return;
    const prev = markers[markers.length - 1];
    if (prev && index - prev.index <= 1 && prev.title.toLowerCase() === candidate.title.toLowerCase()) return;
    if (prev && prev.order != null && candidate.order != null && index - prev.index <= 3 && prev.order === candidate.order) {
      return;
    }
    markers.push({ index, title: candidate.title, order: candidate.order, score: candidate.score });
  });

  if (!markers.length) return [];

  if (markers.length >= 4) {
    const orders = markers
      .map((marker) => marker.order)
      .filter((order): order is number => Number.isFinite(order));
    if (orders.length >= 4) {
      let nonDecreasing = 0;
      for (let i = 1; i < orders.length; i++) {
        if (orders[i] >= orders[i - 1]) nonDecreasing += 1;
      }
      const progressionRatio = nonDecreasing / Math.max(1, orders.length - 1);
      if (progressionRatio < 0.35) {
        return [];
      }
    }
  }

  const sections: DetectedChapterSection[] = [];
  if (markers[0].index > 0) {
    const intro = lines.slice(0, markers[0].index).join('\n').trim();
    if (intro.length >= 180 || countWords(intro) >= 45) {
      sections.push({ title: 'Mở đầu', content: intro });
    }
  }

  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const next = markers[i + 1];
    const content = lines
      .slice(current.index + 1, next ? next.index : lines.length)
      .join('\n')
      .trim();
    if (!content) continue;
    sections.push({
      title: current.title || `Chương ${i + 1}`,
      content,
    });
  }

  if (!sections.length) {
    const single = markers[0];
    const content = lines.slice(single.index + 1).join('\n').trim();
    return content ? [{ title: single.title || 'Chương 1', content }] : [];
  }

  const sectionWordCounts = sections.map((section) => countWords(section.content));
  const meaningfulSections = sections.filter((section, index) => {
    const words = sectionWordCounts[index] || 0;
    return words >= 14 || section.content.length >= 80;
  }).length;
  const averageSectionWords = sectionWordCounts.length
    ? sectionWordCounts.reduce((sum, current) => sum + current, 0) / sectionWordCounts.length
    : 0;
  const strongHeadingRatio = markers.filter((marker) => marker.score >= 5).length / markers.length;

  if (markers.length >= 4 && meaningfulSections < Math.max(2, Math.floor(markers.length * 0.3))) {
    return [];
  }
  if (markers.length >= 8 && averageSectionWords < 18 && strongHeadingRatio < 0.4) {
    return [];
  }

  return sections;
}

function splitTextIntoParagraphBoundChaptersByWords(sourceText: string, targetWordsPerChapter: number): DetectedChapterSection[] {
  const normalized = String(sourceText || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) return [{ title: 'Chương 1', content: normalized }];

  const target = Math.max(300, Math.min(12000, Math.round(Number(targetWordsPerChapter || 3000))));
  const sections: DetectedChapterSection[] = [];
  let buffer = '';
  let bufferWords = 0;

  const pushBuffer = () => {
    const clean = buffer.trim();
    if (!clean) return;
    sections.push({
      title: `Chương ${sections.length + 1}`,
      content: clean,
    });
    buffer = '';
    bufferWords = 0;
  };

  for (const paragraph of paragraphs) {
    const paragraphWords = countWords(paragraph);
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    bufferWords += paragraphWords;
    if (bufferWords >= target) {
      // Chỉ cắt ở ranh giới đoạn văn để không vỡ mạch câu.
      pushBuffer();
    }
  }

  pushBuffer();
  return sections.length ? sections : [{ title: 'Chương 1', content: normalized }];
}

function buildChapterTranslationUnits(sourceText: string, maxCharsPerSegment: number): ChapterTranslationUnit[] {
  const normalizedSource = String(sourceText || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedSource) return [];

  const detected = detectChapterSections(normalizedSource);
  const baseSections: DetectedChapterSection[] = detected.length
    ? detected
    : [{ title: 'Chương 1', content: normalizedSource }];

  return baseSections
    .map((section, index) => {
      const source = String(section.content || '').trim();
      if (!source) return null;
      const segments = splitLargeTextByParagraphs(source, maxCharsPerSegment);
      return {
        title: String(section.title || `Chương ${index + 1}`).trim() || `Chương ${index + 1}`,
        source,
        segments: (segments.length ? segments : [source]).filter((segment) => segment.trim().length >= 20),
      };
    })
    .filter((unit): unit is ChapterTranslationUnit => Boolean(unit));
}

function buildChapterTranslationUnitsByWords(
  sourceText: string,
  maxCharsPerSegment: number,
  targetWordsPerChapter: number,
): ChapterTranslationUnit[] {
  const normalizedSource = String(sourceText || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedSource) return [];
  const sections = splitTextIntoParagraphBoundChaptersByWords(normalizedSource, targetWordsPerChapter);
  return sections
    .map((section, index) => {
      const source = String(section.content || '').trim();
      if (!source) return null;
      const segments = splitLargeTextByParagraphs(source, maxCharsPerSegment);
      return {
        title: String(section.title || `Chương ${index + 1}`).trim() || `Chương ${index + 1}`,
        source,
        segments: (segments.length ? segments : [source]).filter((segment) => segment.trim().length >= 20),
      };
    })
    .filter((unit): unit is ChapterTranslationUnit => Boolean(unit));
}

function buildAnalysisExcerpt(rawText: string, units: ChapterTranslationUnit[]): string {
  if (!units.length) return String(rawText || '').substring(0, 14000);
  const excerpt = units
    .slice(0, 5)
    .map((unit, idx) => {
      const title = unit.title || `Chương ${idx + 1}`;
      return `[${title}]\n${unit.source.substring(0, 2000)}`;
    })
    .join('\n\n');
  return excerpt.substring(0, 14000);
}

function buildBalancedStoryExcerpt(rawText: string, maxChars = 16000): string {
  const normalized = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;

  const detected = detectChapterSections(normalized);
  if (detected.length >= 2) {
    const selectedSections = [...detected.slice(0, 2), ...detected.slice(-2)].filter(
      (section, index, arr) =>
        index === arr.findIndex((candidate) => candidate.title === section.title && candidate.content === section.content),
    );
    const perSectionChars = Math.max(900, Math.floor(maxChars / Math.max(selectedSections.length, 1)) - 140);
    const excerpt = selectedSections
      .map((section, index) => {
        const label =
          index < 2
            ? `Phần đầu · ${section.title || `Chương ${index + 1}`}`
            : `Diễn biến gần cuối · ${section.title || `Chương ${index + 1}`}`;
        return `[${label}]\n${String(section.content || '').trim().substring(0, perSectionChars)}`;
      })
      .join('\n\n');
    if (excerpt.trim()) return excerpt.substring(0, maxChars);
  }

  const headChars = Math.max(2200, Math.floor(maxChars * 0.48));
  const tailChars = Math.max(1800, Math.floor(maxChars * 0.34));
  const omitted = Math.max(0, normalized.length - headChars - tailChars);
  const head = normalized.slice(0, headChars).trim();
  const tail = normalized.slice(-tailChars).trim();
  return `${head}\n\n[...đã lược bớt khoảng ${omitted} ký tự ở giữa để giữ phần mở đầu và diễn biến gần cuối...]\n\n${tail}`.substring(0, maxChars + 120);
}

function splitTextForTranslation(text: string, maxChars: number): string[] {
  const units = buildChapterTranslationUnits(text, maxChars);
  if (!units.length) return [];
  return units.map((unit) => `${unit.title}\n${unit.source}`.trim());
}

type PipelinePhase = 'structure' | 'knowledge' | 'draft' | 'qa';

interface LocalStructureAnalysis {
  chapterCount: number;
  paragraphCount: number;
  dialogueCount: number;
  namedEntities: string[];
  timeMarkers: string[];
  hasExplicitChapters: boolean;
}

interface StoryBibleSummaryItem {
  title: string;
  summary: string;
}

interface StoryBiblePayload {
  version: number;
  fileFingerprint: string;
  createdAt: string;
  updatedAt: string;
  sourceStats: {
    words: number;
    chars: number;
    tokens: number;
  };
  structure: LocalStructureAnalysis;
  chapterSummaries: StoryBibleSummaryItem[];
  arcSummaries: StoryBibleSummaryItem[];
  globalSummary: string;
  keyMoments: string[];
}

interface TranslationPipelineCheckpoint {
  version: number;
  fileFingerprint: string;
  updatedAt: string;
  processedSegments: number;
  processedChunkCount: number;
  chapterStates: Record<string, {
    title: string;
    segments: string[];
    completedBatches: number;
    lastTail: string;
  }>;
}

interface LocalTranslationQaResult {
  normalizedContent: string;
  missingDictionaryTerms: string[];
  forbiddenPhraseHits: string[];
  totalIssues: number;
}

interface TranslationReleaseGateIssue {
  code: 'residual_cjk' | 'mixed_language_line' | 'empty_chapter' | 'chapter_order';
  severity: 'error' | 'warn';
  message: string;
  chapterOrder?: number;
  sample?: string;
}

interface TranslationReleaseGateReport {
  pass: boolean;
  stats: {
    chapterCount: number;
    cjkChars: number;
    cjkRatio: number;
    mixedLineCount: number;
  };
  blockingIssues: TranslationReleaseGateIssue[];
  warningIssues: TranslationReleaseGateIssue[];
}

function trimTextByTokenBudget(text: string, tokenBudget: number): string {
  const safeBudget = Math.max(120, Math.floor(tokenBudget));
  const maxChars = safeBudget * 4;
  const normalized = String(text || '').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}…`;
}

function trimTextHeadTailByTokenBudget(text: string, tokenBudget: number, headRatio = 0.38): string {
  const safeBudget = Math.max(120, Math.floor(tokenBudget));
  const maxChars = safeBudget * 4;
  const normalized = String(text || '').trim();
  if (normalized.length <= maxChars) return normalized;
  const safeHeadRatio = Math.min(0.75, Math.max(0.2, headRatio));
  const headChars = Math.max(220, Math.floor(maxChars * safeHeadRatio));
  const tailChars = Math.max(220, maxChars - headChars - 8);
  return `${normalized.slice(0, headChars).trim()}\n...\n${normalized.slice(-tailChars).trim()}`;
}

function compactPromptForOllama(prompt: string, kind: 'fast' | 'quality'): string {
  const normalized = String(prompt || '').trim();
  if (!normalized) return normalized;
  const inputBudget = kind === 'fast' ? 900 : 1180;
  if (estimateTextTokens(normalized) <= inputBudget) return normalized;

  const markers = ['NỘI DUNG CẦN DỊCH:', 'NỘI DUNG CẦN VIẾT:', 'NỘI DUNG:'];
  const upper = normalized.toUpperCase();
  const markerIndex = markers
    .map((marker) => upper.lastIndexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => b - a)[0] ?? -1;

  if (markerIndex >= 0) {
    const markerText = normalized.slice(markerIndex, markerIndex + 24).includes(':')
      ? normalized.slice(markerIndex, normalized.indexOf(':', markerIndex) + 1)
      : 'NỘI DUNG:';
    const prefix = normalized.slice(0, markerIndex).trim();
    const payload = normalized.slice(markerIndex + markerText.length).trim();
    const trimmedPrefix = trimTextByTokenBudget(prefix, Math.max(220, Math.floor(inputBudget * 0.35)));
    const remainingBudget = Math.max(340, inputBudget - estimateTextTokens(trimmedPrefix) - 24);
    const trimmedPayload = trimTextHeadTailByTokenBudget(payload, remainingBudget, 0.22);
    return `${trimmedPrefix}\n${markerText}\n${trimmedPayload}`.trim();
  }

  return trimTextHeadTailByTokenBudget(normalized, inputBudget, 0.35);
}

function extractNamedEntitiesLocal(text: string, maxItems = 80): string[] {
  const source = String(text || '');
  const pattern = /\b([A-ZÀ-ỴĐ][a-zà-ỹđ]+(?:\s+[A-ZÀ-ỴĐ][a-zà-ỹđ]+){0,3})\b/g;
  const blocked = new Set(['Chương', 'Quyển', 'Mở đầu', 'Nội dung', 'Giới thiệu', 'Truyện']);
  const counter = new Map<string, number>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const token = String(match[1] || '').trim();
    if (!token || blocked.has(token)) continue;
    counter.set(token, (counter.get(token) || 0) + 1);
  }
  return Array.from(counter.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([name]) => name);
}

function extractTimeMarkersLocal(text: string, maxItems = 60): string[] {
  const source = String(text || '');
  const patterns = [
    /\b(?:năm|tháng|ngày|đêm|sáng|chiều|tối|hôm nay|hôm sau|hôm qua)\b/gi,
    /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g,
    /(?:第?\s*\d+\s*(?:ngày|tháng|năm|h|giờ|phút))/gi,
    /(?:\d+年\d+月\d+日)/g,
  ];
  const counter = new Map<string, number>();
  patterns.forEach((pattern) => {
    const matches = source.match(pattern) || [];
    matches.forEach((item) => {
      const token = String(item || '').trim();
      if (!token) return;
      counter.set(token, (counter.get(token) || 0) + 1);
    });
  });
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([item]) => item);
}

function summarizeLocalText(text: string, fallback = 'Nội dung đang phát triển.'): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  const sentences = splitTextIntoNaturalSentences(normalized).filter(Boolean);
  if (!sentences.length) return trimTextByTokenBudget(normalized, 120);
  if (sentences.length === 1) return trimTextByTokenBudget(sentences[0], 120);
  const first = sentences[0];
  const middle = sentences[Math.floor(sentences.length / 2)];
  const last = sentences[sentences.length - 1];
  return trimTextByTokenBudget([first, middle, last].filter(Boolean).join(' '), 180);
}

function runLocalStructurePhase(text: string, units: ChapterTranslationUnit[]): LocalStructureAnalysis {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  const paragraphCount = normalized
    ? normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length
    : 0;
  const dialogueCount = (normalized.match(/[“"『「].{1,120}[”"』」]/g) || []).length;
  const namedEntities = extractNamedEntitiesLocal(normalized, 80);
  const timeMarkers = extractTimeMarkersLocal(normalized, 60);
  return {
    chapterCount: units.length,
    paragraphCount,
    dialogueCount,
    namedEntities,
    timeMarkers,
    hasExplicitChapters: detectChapterSections(normalized).length >= 2,
  };
}

function buildStoryBiblePayload(input: {
  text: string;
  units: ChapterTranslationUnit[];
  structure: LocalStructureAnalysis;
  fileFingerprint: string;
}): StoryBiblePayload {
  const text = String(input.text || '').trim();
  const chapterSummaries = input.units.map((unit, index) => {
    const paragraphs = String(unit.source || '')
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 32);
    const paragraphSummaries = paragraphs.map((paragraph) =>
      summarizeLocalText(paragraph, 'Đoạn văn cần rà soát thêm.'),
    );
    return {
      title: unit.title || `Chương ${index + 1}`,
      summary: summarizeLocalText(
        paragraphSummaries.join(' '),
        summarizeLocalText(unit.source, 'Chương này cần phân tích lại.'),
      ),
    };
  });
  const arcChunkSize = chapterSummaries.length >= 24 ? 6 : chapterSummaries.length >= 12 ? 4 : 3;
  const arcSummaries: StoryBibleSummaryItem[] = [];
  for (let i = 0; i < chapterSummaries.length; i += arcChunkSize) {
    const chunk = chapterSummaries.slice(i, i + arcChunkSize);
    const start = i + 1;
    const end = i + chunk.length;
    arcSummaries.push({
      title: `Arc ${Math.floor(i / arcChunkSize) + 1} (Chương ${start}-${end})`,
      summary: summarizeLocalText(chunk.map((item) => `${item.title}: ${item.summary}`).join(' ')),
    });
  }
  const keyMoments = chapterSummaries.slice(0, 18).map((item) => item.summary).filter(Boolean);
  const now = new Date().toISOString();
  return {
    version: STORY_BIBLE_VERSION,
    fileFingerprint: input.fileFingerprint,
    createdAt: now,
    updatedAt: now,
    sourceStats: {
      words: countWords(text),
      chars: text.length,
      tokens: estimateTextTokens(text),
    },
    structure: input.structure,
    chapterSummaries,
    arcSummaries,
    globalSummary: summarizeLocalText(
      [
        ...chapterSummaries.slice(0, 3).map((item) => item.summary),
        ...chapterSummaries.slice(-3).map((item) => item.summary),
      ].join(' '),
      'Tổng quan truyện đang được cập nhật.',
    ),
    keyMoments,
  };
}

function stripStoryBibleFromNotes(notes: string): string {
  const raw = String(notes || '').trim();
  const idx = raw.indexOf(STORY_BIBLE_PREFIX);
  if (idx < 0) return raw;
  return raw.slice(0, idx).trim();
}

function readStoryBibleFromNotes(notes?: string): StoryBiblePayload | null {
  const raw = String(notes || '').trim();
  const idx = raw.indexOf(STORY_BIBLE_PREFIX);
  if (idx < 0) return null;
  const jsonPart = raw.slice(idx + STORY_BIBLE_PREFIX.length).trim();
  const parsed = tryParseJson<StoryBiblePayload>(jsonPart, 'object');
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.fileFingerprint || !Array.isArray(parsed.chapterSummaries)) return null;
  return parsed;
}

function attachStoryBibleToNotes(existingNotes: string, bible: StoryBiblePayload): string {
  const cleaned = stripStoryBibleFromNotes(existingNotes || '');
  return [cleaned, `${STORY_BIBLE_PREFIX}${JSON.stringify(bible)}`].filter(Boolean).join('\n\n');
}

function buildBibleRetrievalContext(input: {
  bible: StoryBiblePayload | null;
  chapterIndex: number;
  topK: number;
  tokenBudget: number;
}): string {
  if (!input.bible) return '';
  const entries = input.bible.chapterSummaries || [];
  if (!entries.length) return '';
  const chapterIndex = Math.max(0, input.chapterIndex);
  const scored = entries.map((entry, index) => ({
    entry,
    score: 1 / (1 + Math.abs(index - chapterIndex)),
  }));
  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, input.topK))
    .map((item) => `- ${item.entry.title}: ${item.entry.summary}`);
  const payload = [
    `GLOBAL: ${input.bible.globalSummary}`,
    `ARC: ${(input.bible.arcSummaries || []).slice(0, 4).map((item) => `${item.title} => ${item.summary}`).join(' | ')}`,
    'CHƯƠNG LIÊN QUAN:',
    ...top,
  ].join('\n');
  return trimTextByTokenBudget(payload, Math.max(220, input.tokenBudget));
}

function scoreTranslationEntryComplexity(text: string): number {
  const source = String(text || '');
  const lengthScore = Math.min(1, source.length / 2200);
  const dialogueScore = Math.min(1, (source.match(/[“"『「]/g) || []).length / 10);
  const punctuationScore = Math.min(1, (source.match(/[,:;!?。！？]/g) || []).length / 50);
  const denseEntityScore = Math.min(1, extractNamedEntitiesLocal(source, 20).length / 10);
  return Number((lengthScore * 0.35 + dialogueScore * 0.25 + punctuationScore * 0.15 + denseEntityScore * 0.25).toFixed(3));
}

function buildAdaptiveTranslationSegmentBatches(
  entries: TranslationBatchEntry[],
  maxCharsPerBatch: number,
  maxItemsPerBatch: number,
): TranslationSegmentBatch[] {
  const safeMaxChars = Math.max(1000, maxCharsPerBatch);
  const safeMaxItems = Math.max(1, maxItemsPerBatch);
  const batches: TranslationSegmentBatch[] = [];
  let current: TranslationBatchEntry[] = [];
  let currentChars = 0;
  let dynamicCharCap = safeMaxChars;

  const flush = () => {
    if (!current.length) return;
    batches.push({
      entries: current,
      sourceText: current.map((entry, idx) => `[${idx + 1}]\n${entry.text}`).join('\n\n'),
    });
    current = [];
    currentChars = 0;
    dynamicCharCap = safeMaxChars;
  };

  entries.forEach((entry) => {
    const text = String(entry.text || '').trim();
    if (!text) return;
    const complexity = scoreTranslationEntryComplexity(text);
    const complexityMultiplier = complexity >= 0.66 ? 0.68 : complexity <= 0.28 ? 1.2 : 0.9;
    dynamicCharCap = Math.max(900, Math.min(safeMaxChars, Math.round(safeMaxChars * complexityMultiplier)));
    const entryChars = text.length;
    const wouldOverflow =
      current.length >= safeMaxItems ||
      (current.length > 0 && (currentChars + entryChars > dynamicCharCap));
    if (wouldOverflow) flush();
    current.push({ ...entry, text });
    currentChars += entryChars;
  });

  flush();
  return batches;
}

function loadTranslationPipelineCheckpoint(fileFingerprint: string): TranslationPipelineCheckpoint | null {
  if (typeof window === 'undefined') return null;
  const normalizedKey = String(fileFingerprint || '').trim();
  if (!normalizedKey) return null;
  try {
    const raw = localStorage.getItem(TRANSLATION_PIPELINE_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, TranslationPipelineCheckpoint>;
    const row = parsed?.[normalizedKey];
    if (!row || row.fileFingerprint !== normalizedKey) return null;
    return row;
  } catch {
    return null;
  }
}

function saveTranslationPipelineCheckpoint(checkpoint: TranslationPipelineCheckpoint): void {
  if (typeof window === 'undefined') return;
  const key = String(checkpoint.fileFingerprint || '').trim();
  if (!key) return;
  try {
    const raw = localStorage.getItem(TRANSLATION_PIPELINE_CHECKPOINT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, TranslationPipelineCheckpoint>) : {};
    parsed[key] = checkpoint;
    localStorage.setItem(TRANSLATION_PIPELINE_CHECKPOINT_KEY, JSON.stringify(parsed));
  } catch {
    // ignore checkpoint write failure
  }
}

function clearTranslationPipelineCheckpoint(fileFingerprint: string): void {
  if (typeof window === 'undefined') return;
  const key = String(fileFingerprint || '').trim();
  if (!key) return;
  try {
    const raw = localStorage.getItem(TRANSLATION_PIPELINE_CHECKPOINT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, TranslationPipelineCheckpoint>;
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      delete parsed[key];
      localStorage.setItem(TRANSLATION_PIPELINE_CHECKPOINT_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore checkpoint clear failure
  }
}

function buildChapterDagLayers(units: ChapterTranslationUnit[], maxParallel = 2): number[][] {
  if (!units.length) return [];
  const safeParallel = Math.max(1, Math.min(2, Math.floor(maxParallel)));
  const layers: number[][] = [];
  let currentLayer: number[] = [];
  const dependentPattern = /\b(?:hồi trước|chương trước|tiếp theo|to be continued|上一章|下回分解)\b/i;

  units.forEach((unit, index) => {
    const source = String(unit?.source || '').slice(0, 380);
    const mustRunSequential = dependentPattern.test(source);
    if (mustRunSequential) {
      if (currentLayer.length) {
        layers.push(currentLayer);
        currentLayer = [];
      }
      layers.push([index]);
      return;
    }

    currentLayer.push(index);
    if (currentLayer.length >= safeParallel) {
      layers.push(currentLayer);
      currentLayer = [];
    }
  });

  if (currentLayer.length) layers.push(currentLayer);
  return layers;
}

function estimateProcessingEtaSeconds(startedAtMs: number, completed: number, total: number): number {
  const safeCompleted = Math.max(0, completed);
  const safeTotal = Math.max(0, total);
  if (safeCompleted <= 0 || safeCompleted >= safeTotal) return 0;
  const elapsedSeconds = Math.max(1, (Date.now() - startedAtMs) / 1000);
  const rate = safeCompleted / elapsedSeconds;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const remaining = Math.max(0, safeTotal - safeCompleted);
  return Math.max(0, Math.round(remaining / rate));
}

function formatEtaShort(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (!safe) return '';
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  if (minutes < 60) return `${minutes}m${remain ? ` ${remain}s` : ''}`;
  const hours = Math.floor(minutes / 60);
  const minuteRemain = minutes % 60;
  return `${hours}h${minuteRemain ? ` ${minuteRemain}m` : ''}`;
}

function runLocalTranslationConsistencyQa(input: {
  sourceText: string;
  translatedText: string;
  dictionary: TranslationDictionaryEntry[];
  forbiddenPhrases: string[];
}): LocalTranslationQaResult {
  const source = String(input.sourceText || '');
  let normalizedContent = improveBracketSystemSpacing(improveDialogueSpacing(String(input.translatedText || ''))).trim();
  const dictionary = Array.isArray(input.dictionary) ? input.dictionary : [];
  const forbiddenPhrases = Array.isArray(input.forbiddenPhrases) ? input.forbiddenPhrases : [];

  const missingDictionaryTerms = dictionary
    .filter((entry) => source.includes(entry.original))
    .filter((entry) => !normalizedContent.includes(entry.translation))
    .slice(0, 12)
    .map((entry) => `${entry.original} -> ${entry.translation}`);

  const forbiddenPhraseHits = findForbiddenPhrasesInText(normalizedContent, forbiddenPhrases).slice(0, 12);

  if (missingDictionaryTerms.length) {
    normalizedContent = applyTranslationDictionaryToText(source, normalizedContent, dictionary);
  }

  return {
    normalizedContent,
    missingDictionaryTerms,
    forbiddenPhraseHits,
    totalIssues: missingDictionaryTerms.length + forbiddenPhraseHits.length,
  };
}

function countCjkChars(text: string): number {
  return (String(text || '').match(/[\u3400-\u9FFF]/g) || []).length;
}

function collectMixedLanguageLines(text: string, limit = 12): string[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 14);
  const output: string[] = [];
  for (const line of lines) {
    const hasCjk = /[\u3400-\u9FFF]/.test(line);
    const hasLatin = /[\p{Script=Latin}]/u.test(line);
    if (!hasCjk || !hasLatin) continue;
    output.push(line.slice(0, 200));
    if (output.length >= Math.max(1, limit)) break;
  }
  return output;
}

function runTranslationReleaseGate(chapters: Chapter[]): TranslationReleaseGateReport {
  const issues: TranslationReleaseGateIssue[] = [];
  const chapterList = Array.isArray(chapters) ? chapters : [];
  const mergedText = chapterList.map((chapter) => String(chapter?.content || '')).join('\n');
  const cjkChars = countCjkChars(mergedText);
  const nonWhitespaceChars = String(mergedText).replace(/\s+/g, '').length;
  const cjkRatio = nonWhitespaceChars > 0 ? cjkChars / nonWhitespaceChars : 0;
  const mixedLines = collectMixedLanguageLines(mergedText, 20);

  chapterList.forEach((chapter, index) => {
    const expectedOrder = index + 1;
    const chapterContent = String(chapter?.content || '');
    if (Number(chapter?.order || 0) !== expectedOrder) {
      issues.push({
        code: 'chapter_order',
        severity: 'error',
        message: `Thứ tự chương lỗi: chương ${expectedOrder} đang có order=${chapter?.order ?? 'null'}.`,
        chapterOrder: expectedOrder,
      });
    }
    if (chapterContent.trim().length < 40) {
      issues.push({
        code: 'empty_chapter',
        severity: 'error',
        message: `Chương ${expectedOrder} gần như rỗng hoặc quá ngắn.`,
        chapterOrder: expectedOrder,
      });
    }
    const chapterCjkChars = countCjkChars(chapterContent);
    if (chapterCjkChars > 0) {
      issues.push({
        code: 'residual_cjk',
        severity: chapterCjkChars >= 3 ? 'error' : 'warn',
        message: `Chương ${expectedOrder} còn ký tự CJK (${chapterCjkChars}).`,
        chapterOrder: expectedOrder,
        sample: (chapterContent.match(/.{0,80}[\u3400-\u9FFF].{0,80}/) || [])[0] || '',
      });
    }
    const chapterMixedLines = collectMixedLanguageLines(chapterContent, 4);
    if (chapterMixedLines.length > 0) {
      issues.push({
        code: 'mixed_language_line',
        severity: chapterMixedLines.length >= 2 ? 'error' : 'warn',
        message: `Chương ${expectedOrder} có ${chapterMixedLines.length} dòng trộn Việt + Trung.`,
        chapterOrder: expectedOrder,
        sample: chapterMixedLines[0],
      });
    }
  });

  if (cjkChars > 0 && !issues.some((item) => item.code === 'residual_cjk')) {
    const severity: TranslationReleaseGateIssue['severity'] = cjkChars >= 8 || cjkRatio >= 0.0005 ? 'error' : 'warn';
    issues.push({
      code: 'residual_cjk',
      severity,
      message: `Phát hiện còn chữ Trung sau dịch (${cjkChars} ký tự, tỷ lệ ${(cjkRatio * 100).toFixed(3)}%).`,
      sample: (String(mergedText).match(/.{0,80}[\u3400-\u9FFF].{0,80}/) || [])[0] || '',
    });
  }

  if (mixedLines.length > 0 && !issues.some((item) => item.code === 'mixed_language_line')) {
    issues.push({
      code: 'mixed_language_line',
      severity: mixedLines.length >= 2 ? 'error' : 'warn',
      message: `Phát hiện ${mixedLines.length} dòng trộn tiếng Việt + tiếng Trung.`,
      sample: mixedLines[0],
    });
  }

  const blockingIssues = issues.filter((item) => item.severity === 'error');
  const warningIssues = issues.filter((item) => item.severity === 'warn');
  return {
    pass: blockingIssues.length === 0,
    stats: {
      chapterCount: chapterList.length,
      cjkChars,
      cjkRatio,
      mixedLineCount: mixedLines.length,
    },
    blockingIssues,
    warningIssues,
  };
}

function normalizeTranslationDictionary(
  rows: Array<{ original?: string; translation?: string }>,
): TranslationDictionaryEntry[] {
  const seen = new Set<string>();
  return rows
    .map((row) => ({
      original: String(row?.original || '').trim(),
      translation: String(row?.translation || '').trim(),
    }))
    .filter((row) => row.original && row.translation)
    .filter((row) => {
      const key = `${row.original.toLowerCase()}=>${row.translation.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildStoryTranslationContext(dictionary: Array<{ original?: string; translation?: string }>): string {
  const normalized = normalizeTranslationDictionary(dictionary);
  if (!normalized.length) return '';
  return [
    'TỪ ĐIỂN RIÊNG CỦA BỘ TRUYỆN NÀY (phải giữ tuyệt đối nhất quán giữa các chương của đúng bộ truyện này):',
    ...normalized.map((entry) => `- ${entry.original} -> ${entry.translation}`),
    'Không tự ý dùng cách dịch khác cho các mục trên.',
  ].join('\n');
}

const DEFAULT_FORBIDDEN_CLICHE_PHRASES: string[] = [
  'ánh mắt kiên định',
  'nụ cười nửa miệng',
  'hành trình chông gai',
  'không thể tin vào mắt mình',
  'hít sâu một hơi',
  'tim đập thình thịch',
  'khóe môi khẽ cong',
  'khẽ mỉm cười',
  'sắc mặt đại biến',
  'im lặng bao trùm',
  'bầu không khí trở nên ngột ngạt',
  'lạnh sống lưng',
];

function parseForbiddenClichePhrases(raw: string): string[] {
  const combined = [
    ...DEFAULT_FORBIDDEN_CLICHE_PHRASES,
    ...String(raw || '')
      .split(/[\n,;|]+/)
      .map((item) => item.trim()),
  ];
  const seen = new Set<string>();
  const output: string[] = [];
  combined.forEach((item) => {
    const phrase = String(item || '').trim();
    if (!phrase || phrase.length < 3) return;
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(phrase);
  });
  return output;
}

function findForbiddenPhrasesInText(text: string, phrases: string[]): string[] {
  const source = String(text || '').toLowerCase();
  if (!source || !phrases.length) return [];
  return phrases.filter((phrase) => source.includes(String(phrase || '').toLowerCase()));
}

function applyTranslationDictionaryToText(
  sourceText: string,
  translatedText: string,
  dictionary: TranslationDictionaryEntry[],
): string {
  let output = String(translatedText || '');
  dictionary.forEach((entry) => {
    if (!sourceText.includes(entry.original) && !output.includes(entry.original)) return;
    output = output.replace(new RegExp(entry.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entry.translation);
  });
  return output.trim();
}

function buildScopedDictionaryContext(
  sourceText: string,
  dictionary: TranslationDictionaryEntry[],
  maxEntries = 24,
): string {
  const source = String(sourceText || '');
  if (!source.trim() || !dictionary.length) return '';
  const matched = dictionary
    .filter((entry) => source.includes(entry.original))
    .sort((a, b) => b.original.length - a.original.length)
    .slice(0, Math.max(1, maxEntries));
  if (!matched.length) return '';
  return "SỬ DỤNG TỪ ĐIỂN TÊN RIÊNG SAU ĐÂY (Ưu tiên tuyệt đối):\n" +
    matched.map((entry) => `- ${entry.original} -> ${entry.translation}`).join('\n');
}

function extractTranslationContextTail(text: string, maxChars = 900): string {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(clean.length - maxChars).trim();
}

function buildTranslationSegmentBatches(
  entries: TranslationBatchEntry[],
  maxCharsPerBatch: number,
  maxItemsPerBatch: number,
): TranslationSegmentBatch[] {
  const safeMaxChars = Math.max(1200, maxCharsPerBatch);
  const safeMaxItems = Math.max(1, maxItemsPerBatch);
  const batches: TranslationSegmentBatch[] = [];
  let current: TranslationBatchEntry[] = [];
  let currentChars = 0;

  const flush = () => {
    if (!current.length) return;
    batches.push({
      entries: current,
      sourceText: current.map((entry, idx) => `[${idx + 1}]\n${entry.text}`).join('\n\n'),
    });
    current = [];
    currentChars = 0;
  };

  entries.forEach((entry) => {
    const text = String(entry.text || '').trim();
    if (!text) return;
    const entryChars = text.length;
    const wouldOverflow =
      current.length >= safeMaxItems ||
      (current.length > 0 && currentChars + entryChars > safeMaxChars);
    if (wouldOverflow) flush();
    current.push({ ...entry, text });
    currentChars += entryChars;
  });

  flush();
  return batches;
}

function normalizeTranslationBatchItem(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const direct = ['content', 'translation', 'text', 'value', 'body']
    .map((key) => record[key])
    .find((item) => typeof item === 'string');
  return typeof direct === 'string' ? direct.trim() : '';
}

function normalizeTranslationBatchResponse(
  raw: string,
  expectedCount: number,
  fallbackTitle: string,
): { title: string; segments: string[] } {
  const parsed = tryParseJson<any>(raw, 'any') || tryParseJson<any>(normalizeJsonLikeText(raw), 'any');
  let title = fallbackTitle;

  const sortKey = (key: string): number => {
    const matched = key.match(/(\d+)/);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
  };

  const readCollection = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeTranslationBatchItem(item));
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .sort((a, b) => sortKey(a[0]) - sortKey(b[0]) || a[0].localeCompare(b[0]))
        .map(([, item]) => normalizeTranslationBatchItem(item));
    }
    return [];
  };

  let segments: string[] = [];
  if (Array.isArray(parsed)) {
    segments = readCollection(parsed);
  } else if (parsed && typeof parsed === 'object') {
    title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
    const candidateKeys = ['segments', 'translations', 'contents', 'items', 'parts', 'results'];
    for (const key of candidateKeys) {
      segments = readCollection((parsed as Record<string, unknown>)[key]);
      if (segments.length) break;
    }
    if (!segments.length && expectedCount === 1) {
      const fallbackSegment =
        normalizeTranslationBatchItem(parsed) ||
        (typeof parsed.content === 'string' ? parsed.content.trim() : '');
      if (fallbackSegment) segments = [fallbackSegment];
    }
  }

  if (!segments.length && expectedCount === 1) {
    const single = normalizeAiJsonContent(raw, fallbackTitle);
    return {
      title: single.title || fallbackTitle,
      segments: [single.content],
    };
  }

  return {
    title,
    segments: segments.slice(0, expectedCount),
  };
}

function parseStoryGenreAndPrompt(rawGenre: string, existingPrompt = ''): { genreLabel: string; promptNotes: string } {
  const source = String(rawGenre || '').trim();
  const inheritedPrompt = stripStoryBibleFromNotes(String(existingPrompt || '')).trim();
  if (!source) {
    return {
      genreLabel: '',
      promptNotes: inheritedPrompt,
    };
  }

  const lines = source
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const promptHintRe = /giọng văn|xưng hô|vai trò|yêu cầu|prompt|quy tắc|cảnh báo|phong cách/i;
  const looksLikePrompt = lines.length > 1 || /^[-*]/.test(source) || (source.length > 56 && promptHintRe.test(source));

  if (!looksLikePrompt) {
    return {
      genreLabel: source,
      promptNotes: inheritedPrompt,
    };
  }

  const cleanGenre = lines.find((line) => {
    if (/^[-*]/.test(line)) return false;
    if (promptHintRe.test(line)) return false;
    return line.length <= 40;
  }) || '';

  const promptLines = lines.filter((line) => line !== cleanGenre);
  const mergedPrompt = [inheritedPrompt, ...promptLines].filter(Boolean).join('\n').trim();

  return {
    genreLabel: cleanGenre,
    promptNotes: mergedPrompt,
  };
}

function toCharacterProfileId(): string {
  return createClientId('roster');
}

function normalizeCharacterRosterRows(rows: StoryCharacterProfile[]): StoryCharacterProfile[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.id || toCharacterProfileId()).trim() || toCharacterProfileId(),
      name: String(row?.name || '').trim(),
      role: String(row?.role || '').trim(),
      age: String(row?.age || '').trim(),
      identity: String(row?.identity || '').trim(),
    }))
    .filter((row) => row.name);
}

function analyzeCharacterRosterLocally(input: { title: string; introduction: string; content: string }): StoryCharacterProfile[] {
  const corpus = [input.title, input.introduction, input.content]
    .map((chunk) => String(chunk || '').replace(/\r/g, ' '))
    .join('\n');
  if (!corpus.trim()) return [];

  // Ưu tiên nhận diện tên riêng tiếng Việt/Trung viết hoa đầu mỗi từ, kèm bộ lọc từ khóa thường gặp.
  const candidatePattern = /\b([A-ZÀ-ỴĐ][a-zà-ỹđ]+(?:\s+[A-ZÀ-ỴĐ][a-zà-ỹđ]+){0,3})\b/g;
  const blockedTerms = new Set([
    'Chương',
    'Thiên Mệnh',
    'Giới Thiệu',
    'Nội Dung',
    'Bìa Truyện',
    'Tác Giả',
    'Truyện',
    'Đấu La',
    'Đường',
    'La',
    'Đại',
    'Lục',
    'Đấu',
    'Lạc',
    'Cốt Truyện',
  ]);

  const candidates = new Map<string, { count: number; firstIndex: number }>();
  let match: RegExpExecArray | null;
  while ((match = candidatePattern.exec(corpus)) !== null) {
    const rawName = String(match[1] || '').trim();
    if (!rawName || rawName.length < 3 || blockedTerms.has(rawName)) continue;
    const parts = rawName.split(/\s+/);
    if (parts.length === 1 && rawName.length < 5) continue;
    const current = candidates.get(rawName) || { count: 0, firstIndex: match.index };
    current.count += 1;
    current.firstIndex = Math.min(current.firstIndex, match.index);
    candidates.set(rawName, current);
  }

  const topNames = Array.from(candidates.entries())
    .filter(([, info]) => info.count >= 2)
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[1].firstIndex - b[1].firstIndex;
    })
    .slice(0, 8)
    .map(([name]) => name);

  const takeContext = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`.{0,160}${escaped}.{0,200}`, 'i');
    return corpus.match(regex)?.[0] || '';
  };

  const inferRole = (context: string, rank: number): string => {
    const text = context.toLowerCase();
    if (/phản diện|kẻ địch|tà tu|ma đầu|đối thủ/.test(text)) return 'Phản diện / đối thủ';
    if (/sư phụ|sư tôn|thầy|đạo sư/.test(text)) return 'Sư phụ / người dẫn dắt';
    if (/bằng hữu|đồng đội|tri kỷ|bạn thân/.test(text)) return 'Bạn đồng hành';
    if (/muội|tỷ|chị|em gái|công chúa|thánh nữ/.test(text)) return 'Nhân vật nữ quan trọng';
    if (/nữ chính|nữ chủ|thiếu nữ|thánh nữ/.test(text)) return 'Nữ chính / nữ chủ';
    if (/nam chính|thiếu niên|thiếu hiệp|công tử/.test(text)) return 'Nam chính / trung tâm';
    if (rank === 0) return 'Nhân vật trung tâm';
    if (rank === 1) return 'Nhân vật nòng cốt';
    return 'Nhân vật thường xuất hiện';
  };

  const inferAge = (context: string): string => {
    const normalized = context.toLowerCase();
    const ageMatch = normalized.match(/(\d{1,3})\s*(?:tuổi|age|years? old)/i);
    if (ageMatch?.[1]) return `${ageMatch[1]} tuổi`;
    if (/thiếu niên|thiếu nữ|teen|trẻ/.test(normalized)) return 'Khoảng 16-20 tuổi';
    if (/trung niên/.test(normalized)) return 'Khoảng 30-45 tuổi';
    if (/lão|già|ông|bà|tiên sinh|lão giả/.test(normalized)) return 'Trên 45 tuổi';
    return '';
  };

  const inferIdentity = (context: string): string => {
    const identityPatterns = [
      /(thiếu chủ|thánh nữ|thánh tử|công chúa|hoàng tử|vương gia|đế quân|đế tử)/i,
      /(đệ tử|trưởng lão|tông chủ|gia chủ|đường chủ|bang chủ|cung chủ)/i,
      /(giáo viên|học sinh|sinh viên|bác sĩ|cảnh sát|sát thủ|đạo sĩ|tu sĩ)/i,
    ];
    for (const pattern of identityPatterns) {
      const identity = context.match(pattern)?.[1];
      if (identity) return identity;
    }
    const isMatch = context.match(/\blà\s+([^,.:\n]{4,48})/i)?.[1];
    if (isMatch) return isMatch.trim();
    return '';
  };

  return topNames.map((name, index) => {
    const context = takeContext(name);
    return {
      id: toCharacterProfileId(),
      name,
      role: inferRole(context, index),
      age: inferAge(context),
      identity: inferIdentity(context),
    };
  });
}

function sanitizePromptForUrl(prompt: string): string {
  const raw = String(prompt || '');
  if (!raw) return '';
  let safe = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        safe += raw[i] + raw[i + 1];
        i += 1;
      } else {
        safe += ' ';
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      safe += ' ';
      continue;
    }
    safe += raw[i];
  }
  return safe.replace(/\s+/g, ' ').trim().slice(0, 420);
}

async function probeImageUrl(url: string, timeoutMs = 7000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return new Promise((resolve) => {
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = url;
  });
}

async function pickFirstReachableImageUrl(
  candidates: string[],
  timeoutMs = 7000,
  batchSize = 2,
): Promise<string> {
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
  for (let index = 0; index < uniqueCandidates.length; index += batchSize) {
    const batch = uniqueCandidates.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        ok: await probeImageUrl(candidate, timeoutMs),
      })),
    );
    const winner = results.find((result) => result.ok);
    if (winner) return winner.candidate;
  }
  return '';
}

type RaphaelTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface RaphaelTaskResponse {
  id?: string;
  status?: RaphaelTaskStatus | string;
  progress?: number;
  results?: string[];
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  task_info?: {
    estimated_time?: number;
    can_cancel?: boolean;
  };
}

function readRaphaelEnv(key: 'VITE_RAPHAEL_API_KEY' | 'VITE_RAPHAEL_MODEL' | 'VITE_RAPHAEL_SIZE'): string {
  return ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[key] || '').trim();
}

function getRaphaelApiKey(config = getImageApiConfig()): string {
  if (!config.enabled) return '';
  return config.providers.evolink.apiKey || getDefaultImageProviderApiKey('evolink');
}

function getRaphaelModel(config = getImageApiConfig()): string {
  return config.providers.evolink.model || readRaphaelEnv('VITE_RAPHAEL_MODEL') || DEFAULT_RAPHAEL_MODEL;
}

function getRaphaelSize(config = getImageApiConfig()): string {
  return config.size || readRaphaelEnv('VITE_RAPHAEL_SIZE') || DEFAULT_RAPHAEL_SIZE;
}

function extractRaphaelResultUrls(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const results = [
    record.results,
    record.images,
    record.output,
    (record.data && typeof record.data === 'object') ? (record.data as Record<string, unknown>).results : null,
  ].find((value) => Array.isArray(value));
  if (!Array.isArray(results)) return [];
  return results.map((item) => String(item || '').trim()).filter(Boolean);
}

async function readApiErrorMessage(resp: Response): Promise<string> {
  try {
    const text = (await resp.text()).trim();
    if (!text) return '';
    const parsed = tryParseJson<Record<string, unknown>>(text, 'object');
    const errorRecord = (parsed?.error && typeof parsed.error === 'object')
      ? parsed.error as Record<string, unknown>
      : null;
    const rawMessage =
      String(errorRecord?.message || parsed?.message || parsed?.error_description || text).trim();
    return rawMessage.slice(0, 260);
  } catch {
    return '';
  }
}

async function generateRaphaelCoverImage(prompt: string, imageConfig = getImageApiConfig()): Promise<string> {
  const apiKey = getRaphaelApiKey(imageConfig);
  if (!apiKey) return '';

  const createResponse = await fetchWithTimeout(`${RAPHAEL_API_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getRaphaelModel(imageConfig),
      prompt,
      size: getRaphaelSize(imageConfig),
      seed: Math.floor(Math.random() * 2147483646) + 1,
      nsfw_check: false,
      request_uuid: createClientId('raphael-cover'),
    }),
  }, 20000);

  if (!createResponse.ok) {
    const detail = await readApiErrorMessage(createResponse);
    throw new Error(detail || `Raphael trả về HTTP ${createResponse.status}.`);
  }

  const createdTask = await createResponse.json() as RaphaelTaskResponse;
  const immediateUrl = await pickFirstReachableImageUrl(extractRaphaelResultUrls(createdTask), 7000, 2);
  if (immediateUrl) return immediateUrl;

  const taskId = String(createdTask?.id || '').trim();
  if (!taskId) {
    throw new Error('Raphael không trả về task ID để theo dõi kết quả.');
  }

  const deadline = Date.now() + 65000;
  let waitMs = Math.min(
    3000,
    Math.max(1200, Math.round(Number(createdTask?.task_info?.estimated_time || 0) * 120)),
  );

  while (Date.now() < deadline) {
    await sleepMs(waitMs);
    const statusResponse = await fetchWithTimeout(`${RAPHAEL_API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }, 16000);

    if (!statusResponse.ok) {
      const detail = await readApiErrorMessage(statusResponse);
      if (statusResponse.status >= 500 || statusResponse.status === 429) {
        waitMs = Math.min(3200, waitMs + 400);
        continue;
      }
      throw new Error(detail || `Không đọc được trạng thái tác vụ Raphael (${statusResponse.status}).`);
    }

    const task = await statusResponse.json() as RaphaelTaskResponse;
    const urls = extractRaphaelResultUrls(task);
    if (task.status === 'completed') {
      if (!urls.length) {
        throw new Error('Raphael báo hoàn tất nhưng chưa trả về URL ảnh.');
      }
      const reachable = await pickFirstReachableImageUrl(urls, 8000, 2);
      return reachable || urls[0] || '';
    }
    if (task.status === 'failed') {
      const detail = String(task.error?.message || task.error?.code || '').trim();
      throw new Error(detail || 'Raphael từ chối hoặc không thể tạo ảnh với prompt hiện tại.');
    }

    waitMs = task.status === 'processing' ? 1400 : 1100;
  }

  throw new Error('Raphael xử lý quá lâu, hệ thống đã chuyển sang đường tạo bìa dự phòng.');
}

function resolveCoverImageSize(sizeHint: string): { width: number; height: number; openAiSize: string } {
  const raw = String(sizeHint || '').trim();
  const match = raw.match(/^(\d+)\s*:\s*(\d+)$/);
  if (match) {
    const w = Math.max(1, Number(match[1]));
    const h = Math.max(1, Number(match[2]));
    if (Number.isFinite(w) && Number.isFinite(h)) {
      const scale = Math.max(1, Math.round(1536 / h));
      const width = Math.max(512, Math.min(2048, w * scale));
      const height = Math.max(768, Math.min(2048, h * scale));
      return { width, height, openAiSize: `${width}x${height}` };
    }
  }
  return { width: 1024, height: 1536, openAiSize: '1024x1536' };
}

function extractImageUrlsFromUnknown(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    record.results,
    record.images,
    record.output,
    record.data,
    record.result,
  ];
  if (record.data && typeof record.data === 'object') {
    const dataRecord = record.data as Record<string, unknown>;
    candidates.push(dataRecord.images, dataRecord.results, dataRecord.output);
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  const collect = (value: unknown) => {
    if (!value) return;
    if (typeof value === 'string') {
      const next = value.trim();
      if (!next) return;
      if (next.startsWith('http') || next.startsWith('data:image/')) {
        if (!seen.has(next)) {
          seen.add(next);
          urls.push(next);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item));
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      collect(obj.url);
      collect(obj.image);
      collect(obj.src);
      collect(obj.b64_json ? `data:image/png;base64,${String(obj.b64_json)}` : '');
    }
  };
  candidates.forEach((item) => collect(item));
  return urls;
}

async function generateOpenAiCoverImage(input: {
  prompt: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  sizeHint?: string;
}): Promise<string> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) return '';
  const model = String(input.model || '').trim() || 'gpt-image-1';
  const baseUrl = String(input.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const size = resolveCoverImageSize(String(input.sizeHint || ''));
  const endpoint = /\/images\/generations$/i.test(baseUrl) ? baseUrl : `${baseUrl}/images/generations`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size: size.openAiSize,
    }),
  }, 24000);
  if (!response.ok) {
    const detail = await readApiErrorMessage(response);
    throw new Error(detail || `OpenAI image API trả về HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const urls = extractImageUrlsFromUnknown(payload);
  if (!urls.length) return '';
  const reachable = await pickFirstReachableImageUrl(urls, 8000, 2);
  return reachable || urls[0] || '';
}

async function generateFalCoverImage(input: {
  prompt: string;
  apiKey: string;
  model: string;
  sizeHint?: string;
}): Promise<string> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) return '';
  const model = String(input.model || '').trim();
  if (!model) return '';
  const size = resolveCoverImageSize(String(input.sizeHint || ''));
  const modelPath = model.replace(/^\/+/, '');
  const endpoint = `https://fal.run/${modelPath}`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      num_images: 1,
      image_size: {
        width: size.width,
        height: size.height,
      },
    }),
  }, 26000);
  if (!response.ok) {
    const detail = await readApiErrorMessage(response);
    throw new Error(detail || `fal trả về HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const immediate = extractImageUrlsFromUnknown(payload);
  if (immediate.length) {
    const reachable = await pickFirstReachableImageUrl(immediate, 8000, 2);
    if (reachable) return reachable;
  }
  const requestId = String(
    (payload as Record<string, unknown>)?.request_id
    || (payload as Record<string, unknown>)?.id
    || '',
  ).trim();
  if (!requestId) return immediate[0] || '';

  const pollUrls = [
    `https://queue.fal.run/${modelPath}/requests/${encodeURIComponent(requestId)}`,
    `https://fal.run/${modelPath}/requests/${encodeURIComponent(requestId)}`,
  ];
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    await sleepMs(1300);
    for (const pollUrl of pollUrls) {
      const poll = await fetchWithTimeout(pollUrl, {
        headers: {
          Authorization: `Key ${apiKey}`,
        },
      }, 15000);
      if (!poll.ok) continue;
      const pollPayload = await poll.json();
      const urls = extractImageUrlsFromUnknown(pollPayload);
      if (urls.length) {
        const reachable = await pickFirstReachableImageUrl(urls, 8000, 2);
        return reachable || urls[0] || '';
      }
      const status = String((pollPayload as Record<string, unknown>)?.status || '').toLowerCase();
      if (status.includes('failed') || status.includes('error')) {
        const reason = String((pollPayload as Record<string, unknown>)?.error || '').trim();
        throw new Error(reason || 'fal từ chối tác vụ tạo ảnh.');
      }
    }
  }
  throw new Error('fal xử lý quá lâu, đã chuyển sang đường dự phòng.');
}

async function generateBflCoverImage(input: {
  prompt: string;
  apiKey: string;
  model: string;
  sizeHint?: string;
}): Promise<string> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) return '';
  const model = String(input.model || '').trim();
  if (!model) return '';
  const size = resolveCoverImageSize(String(input.sizeHint || ''));
  const endpoint = `https://api.bfl.ai/v1/${encodeURIComponent(model)}`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      width: size.width,
      height: size.height,
    }),
  }, 24000);
  if (!response.ok) {
    const detail = await readApiErrorMessage(response);
    throw new Error(detail || `BFL trả về HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const immediate = extractImageUrlsFromUnknown(payload);
  if (immediate.length) {
    const reachable = await pickFirstReachableImageUrl(immediate, 8000, 2);
    if (reachable) return reachable;
  }
  const requestId = String(
    (payload as Record<string, unknown>)?.id
    || (payload as Record<string, unknown>)?.request_id
    || (payload as Record<string, unknown>)?.task_id
    || '',
  ).trim();
  if (!requestId) return immediate[0] || '';

  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    await sleepMs(1300);
    const poll = await fetchWithTimeout(`https://api.bfl.ai/v1/get_result?id=${encodeURIComponent(requestId)}`, {
      headers: {
        'x-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    }, 15000);
    if (!poll.ok) continue;
    const pollPayload = await poll.json();
    const urls = extractImageUrlsFromUnknown(pollPayload);
    if (urls.length) {
      const reachable = await pickFirstReachableImageUrl(urls, 8000, 2);
      return reachable || urls[0] || '';
    }
    const status = String((pollPayload as Record<string, unknown>)?.status || '').toLowerCase();
    if (status.includes('failed') || status.includes('error')) {
      const reason = String((pollPayload as Record<string, unknown>)?.error || '').trim();
      throw new Error(reason || 'BFL từ chối tác vụ tạo ảnh.');
    }
  }
  throw new Error('BFL xử lý quá lâu, đã chuyển sang đường dự phòng.');
}

function escapeSvgText(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapSvgText(input: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = String(input || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function getCoverGenrePalette(genre: string): { accent: string; accentSoft: string; mood: string } {
  const value = String(genre || '').toLowerCase();
  if (/tiên|kiem|kiếm|huyền|fantasy|ảo/.test(value)) {
    return { accent: '#7C3AED', accentSoft: '#C4B5FD', mood: 'epic fantasy atmosphere' };
  }
  if (/đô thị|lang man|lãng|romance|tình|thanh xuân/.test(value)) {
    return { accent: '#DB2777', accentSoft: '#F9A8D4', mood: 'romantic modern atmosphere' };
  }
  if (/kinh dị|horror|dark|u tối|trinh thám|bí ẩn/.test(value)) {
    return { accent: '#DC2626', accentSoft: '#FCA5A5', mood: 'dark mysterious atmosphere' };
  }
  if (/sci|khoa học|cyber|tương lai/.test(value)) {
    return { accent: '#0891B2', accentSoft: '#67E8F9', mood: 'futuristic sci-fi atmosphere' };
  }
  return { accent: '#0F766E', accentSoft: '#99F6E4', mood: 'cinematic literary atmosphere' };
}

function buildFallbackCoverDataUrl(title: string, genre: string, prompt: string): string {
  const safeTitle = String(title || 'Untitled Story').slice(0, 64);
  const safeGenre = String(genre || 'Fiction').slice(0, 32);
  const safeHint = String(prompt || '').replace(/\s+/g, ' ').slice(0, 78);
  const palette = getCoverGenrePalette(genre);
  const titleLines = wrapSvgText(safeTitle, 16, 3);
  const hintLines = wrapSvgText(safeHint, 42, 3);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="896" height="1344" viewBox="0 0 896 1344">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.accent}"/>
      <stop offset="55%" stop-color="#1f2937"/>
      <stop offset="100%" stop-color="#c2410c"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.25)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.05)"/>
    </linearGradient>
  </defs>
  <rect width="896" height="1344" fill="url(#bg)"/>
  <circle cx="760" cy="160" r="220" fill="rgba(255,255,255,0.14)"/>
  <circle cx="130" cy="1140" r="250" fill="rgba(255,255,255,0.08)"/>
  <circle cx="750" cy="1080" r="130" fill="${palette.accentSoft}" opacity="0.18"/>
  <rect x="70" y="70" width="756" height="1204" rx="38" fill="url(#glass)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
  <text x="110" y="220" fill="#ffffff" opacity="0.9" font-family="Georgia, serif" font-size="36" letter-spacing="4">${escapeSvgText(safeGenre.toUpperCase())}</text>
  ${titleLines.map((line, index) => `<text x="110" y="${470 + index * 100}" fill="#ffffff" font-family="Georgia, serif" font-weight="700" font-size="84">${escapeSvgText(line)}</text>`).join('\n  ')}
  <text x="110" y="1030" fill="${palette.accentSoft}" opacity="0.95" font-family="Verdana, sans-serif" font-size="22">${escapeSvgText(palette.mood)}</text>
  ${hintLines.map((line, index) => `<text x="110" y="${1090 + index * 34}" fill="#ffffff" opacity="0.85" font-family="Verdana, sans-serif" font-size="24">${escapeSvgText(line)}</text>`).join('\n  ')}
</svg>`;
  const encodedSvg = window.btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encodedSvg}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

function countWords(text: string): number {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;

  const whitespaceWords = normalized
    .split(/\s+/)
    .filter((word) => word.length > 0).length;

  // CJK (Trung/Nhật/Hàn) thường không có khoảng trắng giữa từ, nên chỉ split theo space sẽ sai nặng.
  const cjkMatches = normalized.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g) || [];
  const cjkCharCount = cjkMatches.length;
  const cjkRatio = cjkCharCount / Math.max(1, normalized.length);

  // Nếu văn bản không thiên về CJK thì giữ cách đếm truyền thống.
  if (cjkCharCount < 120 || cjkRatio < 0.22) {
    return whitespaceWords;
  }

  // Ưu tiên word segmentation native nếu runtime hỗ trợ.
  if (typeof Intl !== 'undefined' && typeof (Intl as typeof Intl & { Segmenter?: unknown }).Segmenter === 'function') {
    try {
      const SegmenterCtor = (Intl as typeof Intl & { Segmenter: new (locale?: string, options?: Intl.SegmenterOptions) => Intl.Segmenter }).Segmenter;
      const segmenter = new SegmenterCtor('zh', { granularity: 'word' });
      let segmentedWords = 0;
      for (const chunk of segmenter.segment(normalized)) {
        if (chunk.isWordLike) segmentedWords += 1;
      }
      if (segmentedWords > 0) {
        // Cộng thêm phần whitespace words để không hụt cụm Latin độc lập.
        return Math.max(whitespaceWords, segmentedWords + Math.round(whitespaceWords * 0.08));
      }
    } catch {
      // fallback bên dưới
    }
  }

  // Fallback gần đúng: 1 từ CJK ~ 1.6 ký tự CJK.
  const estimatedCjkWords = Math.max(1, Math.round(cjkCharCount / 1.6));
  return Math.max(whitespaceWords, estimatedCjkWords + Math.round(whitespaceWords * 0.1));
}

interface AutoContentLoadProfile {
  mode: 'normal' | 'turbo' | 'huge' | 'extreme';
  score: number;
  turboMode: boolean;
  hugeFileMode: boolean;
  extremeFileMode: boolean;
  reasons: string[];
}

function computeAutoContentLoadProfile(input: {
  text: string;
  provider: ApiProvider;
  detectedChapterCount?: number;
}): AutoContentLoadProfile {
  const normalized = String(input.text || '').replace(/\r\n/g, '\n').trim();
  const words = countWords(normalized);
  const chars = normalized.length;
  const tokens = estimateTextTokens(normalized);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const paragraphCount = paragraphs.length;
  const longestParagraphChars = paragraphs.reduce((max, item) => Math.max(max, item.length), 0);
  const detectedChapters = Math.max(0, Number(input.detectedChapterCount || 0));

  const wordPressure = words / 2600;
  const charPressure = chars / 42000;
  const tokenPressure = tokens / 10500;
  const paragraphPressure = paragraphCount / 85;
  const chapterPressure = detectedChapters >= 2 ? detectedChapters / 14 : (chars > 32000 ? 0.5 : 0.25);
  const longestParagraphPressure = longestParagraphChars / 2400;
  const providerMultiplier = input.provider === 'ollama'
    ? 1.22
    : input.provider === 'openrouter'
      ? 1.1
      : 1;

  let score =
    (wordPressure * 0.24) +
    (charPressure * 0.24) +
    (tokenPressure * 0.24) +
    (paragraphPressure * 0.15) +
    (chapterPressure * 0.08) +
    (longestParagraphPressure * 0.12);

  if (detectedChapters < 2 && chars > 32000) score += 0.3;
  if (longestParagraphChars > 3200) score += 0.25;
  score *= providerMultiplier;

  const normalizedScore = Number(score.toFixed(2));
  const mode: AutoContentLoadProfile['mode'] =
    normalizedScore >= 3.6 ? 'extreme'
    : normalizedScore >= 2.35 ? 'huge'
    : normalizedScore >= 1.35 ? 'turbo'
    : 'normal';

  const reasons: string[] = [];
  if (words > 0) reasons.push(`${words.toLocaleString('vi-VN')} từ`);
  if (chars > 0) reasons.push(`${chars.toLocaleString('vi-VN')} ký tự`);
  if (tokens > 0) reasons.push(`~${tokens.toLocaleString('vi-VN')} token`);
  if (paragraphCount > 0) reasons.push(`${paragraphCount.toLocaleString('vi-VN')} đoạn`);
  if (detectedChapters > 0) reasons.push(`${detectedChapters.toLocaleString('vi-VN')} mốc chương`);
  if (longestParagraphChars > 1800) reasons.push(`đoạn dài nhất ~${longestParagraphChars.toLocaleString('vi-VN')} ký tự`);
  if (input.provider === 'ollama' || input.provider === 'openrouter') {
    reasons.push(`provider ${PROVIDER_LABELS[input.provider]}`);
  }

  return {
    mode,
    score: normalizedScore,
    turboMode: mode !== 'normal',
    hugeFileMode: mode === 'huge' || mode === 'extreme',
    extremeFileMode: mode === 'extreme',
    reasons,
  };
}

function buildFallbackChapters(raw: string, targetCount: number): Array<{ title: string; content: string }> {
  const cleaned = stripJsonFence(raw);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?:^|\n)(?=Chương\s+\d+[:.\-]|#\s*Chương\s+\d+)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((chunk, idx) => {
      const firstLine = chunk.split('\n')[0] || `Chương mới ${idx + 1}`;
      const title = firstLine.replace(/^#+\s*/g, '').trim() || `Chương mới ${idx + 1}`;
      const content = chunk.replace(firstLine, '').trim() || chunk;
      return { title, content };
    });
  }
  return [{ title: `Chương mới ${Math.max(1, targetCount)}`, content: cleaned }];
}

function containsOutlineSignals(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  const outlineSignals = [
    'dàn ý',
    'ý tưởng',
    'gợi ý',
    'hướng phát triển',
    'mở bài',
    'thân bài',
    'kết bài',
    'plot twist',
    'checklist',
    'gạch đầu dòng',
  ];
  return outlineSignals.some((signal) => lower.includes(signal));
}

function getNarrativeQualityIssue(title: string, content: string, minChars = 900): string {
  const text = String(content || '').trim();
  if (!text) return 'Nội dung rỗng.';
  if (text.length < Math.max(280, minChars)) return 'Nội dung quá ngắn.';
  if (containsOutlineSignals(text) || /(?:dàn ý|ý tưởng|kịch bản|phác thảo)/i.test(String(title || ''))) {
    return 'Nội dung đang thiên về dàn ý thay vì văn xuôi.';
  }
  const bulletCount = (text.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/g) || []).length;
  if (bulletCount >= 3) return 'Nội dung chứa quá nhiều gạch đầu dòng.';
  const sentenceCount = text
    .replace(/\n+/g, ' ')
    .split(/[.!?。！？]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .length;
  if (sentenceCount < 8) return 'Nội dung chưa đủ mạch văn.';
  return '';
}

function validateNarrativeBatch(
  items: Array<{ title: string; content: string }>,
  minCharsPerChapter: number,
): { invalidCount: number; reasons: string[] } {
  const reasons = items
    .map((item) => getNarrativeQualityIssue(item.title, item.content, minCharsPerChapter))
    .filter(Boolean);
  return {
    invalidCount: reasons.length,
    reasons,
  };
}

function readMainAiUsage(): { requests: number; estTokens: number } {
  try {
    const raw = readScopedAppStorage(MAIN_AI_USAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<{ requests: number; estTokens: number }>) : {};
    return {
      requests: Number(parsed.requests || 0),
      estTokens: Number(parsed.estTokens || 0),
    };
  } catch {
    return { requests: 0, estTokens: 0 };
  }
}

function writeMainAiUsage(next: { requests: number; estTokens: number }): void {
  writeScopedAppStorage(MAIN_AI_USAGE_KEY, JSON.stringify(next));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MAIN_AI_USAGE_UPDATED_EVENT));
  }
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.round(String(text || '').length / 4));
}

function bumpMainAiUsage(inputText: string, outputText: string): { requests: number; estTokens: number } {
  const current = readMainAiUsage();
  const next = {
    requests: current.requests + 1,
    estTokens: current.estTokens + estimateTextTokens(inputText) + estimateTextTokens(outputText),
  };
  writeMainAiUsage(next);
  return next;
}

const inFlightAiRequests = new Map<string, Promise<string>>();
const OLLAMA_LOCAL_SAFE_TOKENS = {
  fast: 900,
  quality: 1400,
  retryFast: 1100,
  retryQuality: 1600,
};
const OLLAMA_LOCAL_SAFE_NUM_CTX = 2048;

const FULL_THINKING_12_STEPS_PROMPT = `
Khung suy luận nội bộ (12 bước) trước khi trả lời:
1) Mục tiêu đầu ra và định dạng phải bám đúng yêu cầu.
2) Xác định ràng buộc bắt buộc, điều cấm và độ dài.
3) Trích xuất bối cảnh, nhân vật, timeline và mối quan hệ.
4) Chọn chiến lược triển khai phù hợp với tác vụ.
5) Lập dàn khung logic ngắn gọn.
6) Sinh nội dung chi tiết theo dàn khung.
7) Kiểm tra tính nhất quán tên riêng, xưng hô, thuật ngữ.
8) Kiểm tra continuity giữa các đoạn/chương.
9) Loại bỏ câu sáo rỗng và chi tiết lặp.
10) Soát ngữ pháp, nhịp câu, dấu câu.
11) Soát lại theo đúng format đầu ra.
12) Chỉ trả nội dung cuối cùng, không thêm lời xin lỗi hoặc meta.
`.trim();

function applyContextWindowToPrompt(prompt: string, contextWindowTokens: number): string {
  const normalized = String(prompt || '').trim();
  if (!normalized) return '';
  const budget = Math.max(4096, Math.floor(Number(contextWindowTokens || 0)));
  const approxChars = budget * 4;
  if (normalized.length <= approxChars) return normalized;
  const headRatio = 0.46;
  return trimTextHeadTailByTokenBudget(normalized, budget, headRatio);
}

const buildDefaultGenConfig = (
  kind: 'fast' | 'quality',
  runtimeConfig: GenerationConfig,
  config?: Record<string, unknown>,
) => {
  const reasoningScale =
    runtimeConfig.reasoningLevel === 'high'
      ? 1.18
      : runtimeConfig.reasoningLevel === 'low'
        ? 0.88
        : 1;
  const base = kind === 'fast'
    ? { temperature: 0.55, topP: 0.92, maxOutputTokens: Math.round(1800 * reasoningScale) }
    : { temperature: 0.65, topP: 0.95, maxOutputTokens: Math.round(4200 * reasoningScale) };
  const runtimeDefaults: Record<string, unknown> = {
    temperature: runtimeConfig.temperature,
    topP: runtimeConfig.topP,
    topK: runtimeConfig.topK,
    maxOutputTokens: runtimeConfig.maxOutputTokens,
  };
  if (runtimeConfig.seed >= 0) {
    runtimeDefaults.seed = runtimeConfig.seed;
  }
  return { ...base, ...runtimeDefaults, ...(config || {}) };
};

function splitGenConfig(config?: Record<string, unknown>): {
  providerConfig: Record<string, unknown>;
  maxRetries: number;
  minOutputChars: number;
  taskType?: AiTaskType;
  promptVersion?: string;
  traceRunId?: string;
  traceStage?: string;
  traceMeta?: Record<string, unknown>;
  signal?: AbortSignal;
} {
  const raw = { ...(config || {}) } as Record<string, unknown>;
  const maxRetries =
    typeof raw.maxRetries === 'number'
      ? Math.min(3, Math.max(0, Math.round(raw.maxRetries)))
      : undefined;
  const minOutputChars =
    typeof raw.minOutputChars === 'number'
      ? Math.max(0, Math.round(raw.minOutputChars))
      : undefined;
  const signal = raw.signal instanceof AbortSignal ? raw.signal : undefined;
  const taskType = typeof raw.taskType === 'string' ? raw.taskType : undefined;
  const promptVersion = typeof raw.promptVersion === 'string' ? raw.promptVersion : undefined;
  const traceRunId = typeof raw.traceRunId === 'string' ? raw.traceRunId : undefined;
  const traceStage = typeof raw.traceStage === 'string' ? raw.traceStage : undefined;
  const traceMeta =
    raw.traceMeta && typeof raw.traceMeta === 'object' && !Array.isArray(raw.traceMeta)
      ? raw.traceMeta as Record<string, unknown>
      : undefined;

  delete raw.maxRetries;
  delete raw.minOutputChars;
  delete raw.signal;
  delete raw.taskType;
  delete raw.promptVersion;
  delete raw.traceRunId;
  delete raw.traceStage;
  delete raw.traceMeta;

  return {
    providerConfig: raw,
    maxRetries: maxRetries ?? 1,
    minOutputChars: minOutputChars ?? 0,
    taskType: taskType as AiTaskType | undefined,
    promptVersion,
    traceRunId,
    traceStage,
    traceMeta,
    signal,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new Error('AI operation cancelled by user.');
}

function extractTextFromModelPayload(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) return '';
  const dataRecord = asRecord(record.data);
  const responseRecord = asRecord(record.response);
  const direct = [
    record.text,
    record.output,
    record.result,
    dataRecord?.text,
    responseRecord?.text,
  ]
    .map((item) => String(item || '').trim())
    .find(Boolean);
  if (direct) return direct;

  const candidates = record.candidates || dataRecord?.candidates || responseRecord?.candidates;
  if (Array.isArray(candidates)) {
    const combined = candidates
      .map((candidate) => {
        const candidateRecord = asRecord(candidate);
        const candidateContent = asRecord(candidateRecord?.content);
        const partText = Array.isArray(candidateContent?.parts)
          ? candidateContent.parts
              .map((part) => String(asRecord(part)?.text || '').trim())
              .filter(Boolean)
              .join('')
          : '';
        return (
          partText ||
          String(
            candidateContent?.text
              || candidateRecord?.text
              || candidateRecord?.output
              || candidateRecord?.output_text
              || '',
          ).trim()
        );
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (combined) return combined;
  }

  return '';
}

function calculateAdaptiveMinOutputChars(
  prompt: string,
  kind: 'fast' | 'quality',
  explicitMinChars: number,
): number {
  if (explicitMinChars > 0) return explicitMinChars;
  const len = String(prompt || '').length;
  if (len < 500) return 0;
  if (kind === 'fast') return Math.min(1200, Math.max(90, Math.round(len * 0.06)));
  return Math.min(6000, Math.max(180, Math.round(len * 0.12)));
}

function calculateAdaptiveTimeoutMs(kind: 'fast' | 'quality', maxOutputTokens: number): number {
  const tokens = Math.max(512, Number(maxOutputTokens || 0));
  if (kind === 'fast') {
    return Math.min(90000, 18000 + Math.round(tokens * 10));
  }
  return Math.min(180000, 35000 + Math.round(tokens * 14));
}

function applyOllamaLocalGenTuning(kind: 'fast' | 'quality', config: Record<string, unknown>): Record<string, unknown> {
  const tuned = { ...config };
  const safeMax = kind === 'fast' ? OLLAMA_LOCAL_SAFE_TOKENS.fast : OLLAMA_LOCAL_SAFE_TOKENS.quality;
  const rawTokens = Number(tuned.maxOutputTokens || safeMax);
  tuned.maxOutputTokens = Math.max(320, Math.min(safeMax, Math.round(rawTokens)));
  const rawTemperature = typeof tuned.temperature === 'number' ? Number(tuned.temperature) : (kind === 'fast' ? 0.45 : 0.55);
  tuned.temperature = Math.min(0.7, Math.max(0.2, rawTemperature));
  const rawTopP = typeof tuned.topP === 'number' ? Number(tuned.topP) : 0.9;
  tuned.topP = Math.min(0.98, Math.max(0.6, rawTopP));
  const rawTopK = typeof tuned.topK === 'number' ? Number(tuned.topK) : 40;
  tuned.topK = Math.round(Math.min(120, Math.max(10, rawTopK)));
  return tuned;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface RequestTokenBucketState {
  tokens: number;
  capacity: number;
  refillPerSecond: number;
  lastRefillAt: number;
}

const REQUEST_TOKEN_BUCKETS = new Map<string, RequestTokenBucketState>();

function getRateLimitProfile(provider: ApiProvider): { capacity: number; refillPerSecond: number } {
  if (provider === 'ollama') return { capacity: 1, refillPerSecond: 0.45 };
  if (provider === 'openrouter') return { capacity: 3, refillPerSecond: 1.2 };
  if (provider === 'gemini' || provider === 'gcli') return { capacity: 4, refillPerSecond: 1.5 };
  return { capacity: 4, refillPerSecond: 1.6 };
}

async function acquireRequestToken(provider: ApiProvider, model: string): Promise<void> {
  const profile = getRateLimitProfile(provider);
  const key = `${provider}:${String(model || '').trim().toLowerCase()}`;
  const now = Date.now();
  const bucket = REQUEST_TOKEN_BUCKETS.get(key) || {
    tokens: profile.capacity,
    capacity: profile.capacity,
    refillPerSecond: profile.refillPerSecond,
    lastRefillAt: now,
  };
  const elapsed = Math.max(0, now - bucket.lastRefillAt) / 1000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSecond);
  bucket.lastRefillAt = now;
  if (bucket.tokens < 1) {
    const waitMs = Math.ceil(((1 - bucket.tokens) / bucket.refillPerSecond) * 1000);
    REQUEST_TOKEN_BUCKETS.set(key, bucket);
    await sleepMs(Math.max(120, waitMs));
    return acquireRequestToken(provider, model);
  }
  bucket.tokens -= 1;
  REQUEST_TOKEN_BUCKETS.set(key, bucket);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err || '');
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const message = stringifyError(err).toLowerCase();
  return message.includes('aborterror') || message.includes('aborted');
}

function extractRetryDelayMs(err: unknown): number {
  const message = stringifyError(err);
  const retryDelayMatch = message.match(/retryDelay["'\s:]*"?(\d+(?:\.\d+)?)s/i);
  if (retryDelayMatch?.[1]) {
    return Math.max(1000, Math.round(Number(retryDelayMatch[1]) * 1000));
  }
  const retryInMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (retryInMatch?.[1]) {
    return Math.max(1000, Math.round(Number(retryInMatch[1]) * 1000));
  }
  return 0;
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const message = stringifyError(err).toLowerCase();
  if (message.includes('resource_exhausted') || message.includes('quota exceeded') || message.includes('rate limit')) {
    return true;
  }
  return /\b429\b/.test(message);
}

function isDailyQuotaExceededError(err: unknown): boolean {
  const message = stringifyError(err).toLowerCase();
  return (
    message.includes('generaterequestsperday') ||
    message.includes('free_tier_requests') ||
    message.includes('perday') ||
    message.includes('per day per project')
  );
}

function isTransientAiServiceError(err: unknown): boolean {
  const message = stringifyError(err).toLowerCase();
  return (
    message.includes('currently experiencing high demand') ||
    message.includes('try again later') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('resource unavailable') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('deadline exceeded') ||
    message.includes('gateway timeout') ||
    message.includes('timed out') ||
    message.includes('networkerror') ||
    message.includes('failed to fetch') ||
    /\b503\b/.test(message) ||
    /\b504\b/.test(message)
  );
}

function loadTranslationSafetyProfileSettings(): TranslationSafetyProfileSettings {
  if (typeof window === 'undefined') return DEFAULT_TRANSLATION_SAFETY_PROFILE_SETTINGS;
  try {
    const raw = localStorage.getItem(TRANSLATION_SAFETY_PROFILE_KEY);
    if (!raw) return DEFAULT_TRANSLATION_SAFETY_PROFILE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TranslationSafetyProfileSettings>;
    return {
      autoSafeModeEnabled: parsed.autoSafeModeEnabled !== false,
      checkpointEveryChunks: Math.max(3, Math.min(30, Number(parsed.checkpointEveryChunks) || 10)),
    };
  } catch {
    return DEFAULT_TRANSLATION_SAFETY_PROFILE_SETTINGS;
  }
}

function saveTranslationSafetyProfileSettings(settings: TranslationSafetyProfileSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    TRANSLATION_SAFETY_PROFILE_KEY,
    JSON.stringify({
      autoSafeModeEnabled: settings.autoSafeModeEnabled !== false,
      checkpointEveryChunks: Math.max(3, Math.min(30, Number(settings.checkpointEveryChunks) || 10)),
    }),
  );
}

function isModelNotFoundError(err: unknown): boolean {
  const message = stringifyError(err).toLowerCase();
  const hasModelToken = message.includes('model') || message.includes('models/');
  const hasMissingPattern =
    /model\s+["'`]?[\w./:-]+["'`]?\s+(is\s+)?not found/i.test(message) ||
    /models\/[\w./:-]+\s+is not found/i.test(message) ||
    /model.+does not exist/i.test(message);
  return (
    hasModelToken &&
    hasMissingPattern
  );
}

function getGeminiFallbackModels(baseModel: string, kind: 'fast' | 'quality'): string[] {
  const normalizedBase = String(baseModel || '').trim().toLowerCase();
  const isFlashLiteFamily = normalizedBase.includes('flash-lite');
  const isFlashFamily = normalizedBase.includes('flash');
  const isProFamily = normalizedBase.includes('pro');
  const preferred = isFlashLiteFamily
    ? ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']
    : isFlashFamily
    ? ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
    : isProFamily
      ? ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']
      : kind === 'fast'
        ? ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash']
        : ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];
  const merged = [baseModel, ...preferred].map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

const NON_FALLBACK_MODEL_VALUES = new Set(['ollama-custom', 'custom-model']);

function getProviderFallbackModels(
  provider: ApiProvider,
  baseModel: string,
  kind: 'fast' | 'quality',
): string[] {
  const normalizedBase = String(baseModel || '').trim();
  if (!normalizedBase) return [];
  if (provider === 'unknown') return [normalizedBase];

  const listed = (PROVIDER_MODEL_OPTIONS[provider as Exclude<ApiProvider, 'unknown'>] || [])
    .map((option) => String(option?.value || '').trim())
    .filter((value) => value && !NON_FALLBACK_MODEL_VALUES.has(value.toLowerCase()));

  let preferred = listed;
  if (provider === 'openrouter') {
    preferred = ['openrouter/auto', ...listed.filter((value) => value !== 'openrouter/auto')];
  } else if (provider === 'ollama') {
    preferred = kind === 'quality'
      ? ['qwen2.5:7b', 'llama3.1:8b', 'gemma2:9b', ...listed]
      : ['qwen2.5:7b', 'llama3.1:8b', 'gemma2:9b', ...listed];
  }

  const merged = [normalizedBase, ...preferred].map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  let timedOut = false;
  const onTimeout = () => {
    timedOut = true;
    try {
      controller.abort(new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s`));
    } catch {
      controller.abort();
    }
  };
  const onOuterAbort = () => {
    try {
      controller.abort(outerSignal?.reason || new Error('AI operation cancelled by user.'));
    } catch {
      controller.abort();
    }
  };
  const timer = window.setTimeout(onTimeout, timeoutMs);
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    throwIfAborted(outerSignal);
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp;
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `AI request timed out after ${Math.round(timeoutMs / 1000)}s. Hãy thử lại hoặc giảm kích thước lô.`,
      );
    }
    if (isAbortLikeError(error) && outerSignal?.aborted) {
      throw new Error('AI operation cancelled by user.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
};

async function fetchOllamaInstalledModels(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const apiBase = normalizeOllamaApiBaseUrl(baseUrl);
    const endpoint = `${apiBase.replace(/\/+$/, '')}/api/tags`;
    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    const resp = await fetchWithTimeout(
      endpoint,
      {
        method: 'GET',
        headers,
      },
      Math.max(7000, Math.min(timeoutMs, 20000)),
      signal,
    );
    if (!resp.ok) return [];
    const payload = await resp.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models
      .map((item: unknown) => {
        if (typeof item === 'string') return item.trim();
        const record = asRecord(item);
        return String(record?.name || record?.model || '').trim();
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function callOllamaLocalWithFallback(
  input: {
    model: string;
    prompt: string;
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    signal?: AbortSignal;
    attemptConfig: Record<string, unknown>;
  },
): Promise<string> {
  const apiBase = normalizeOllamaApiBaseUrl(input.baseUrl || getProviderBaseUrl('ollama'));
  const openAiBase = normalizeOllamaOpenAiBaseUrl(input.baseUrl || getProviderBaseUrl('ollama'));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (String(input.apiKey || '').trim()) {
    headers.Authorization = `Bearer ${String(input.apiKey || '').trim()}`;
  }

  const temperature = typeof input.attemptConfig.temperature === 'number' ? input.attemptConfig.temperature : 0.55;
  const topP = typeof input.attemptConfig.topP === 'number' ? input.attemptConfig.topP : undefined;
  const topK = typeof input.attemptConfig.topK === 'number' ? Math.round(input.attemptConfig.topK) : undefined;
  const maxOutputTokens = typeof input.attemptConfig.maxOutputTokens === 'number' ? input.attemptConfig.maxOutputTokens : undefined;

  const chatResp = await fetchWithTimeout(
    `${apiBase}/api/chat`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: input.prompt }],
        stream: false,
        options: {
          temperature,
          top_p: topP,
          top_k: topK,
          num_predict: maxOutputTokens,
          num_ctx: OLLAMA_LOCAL_SAFE_NUM_CTX,
        },
      }),
    },
    input.timeoutMs,
    input.signal,
  );
  const chatBody = chatResp.ok ? '' : await chatResp.text();
  if (chatResp.ok) {
    const chatData = await chatResp.json();
    const chatText = String(chatData?.message?.content || '').trim() || extractTextFromModelPayload(chatData) || '';
    if (chatText) return chatText;
  }

  const generateResp = await fetchWithTimeout(
    `${apiBase}/api/generate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        stream: false,
        options: {
          temperature,
          top_p: topP,
          top_k: topK,
          num_predict: maxOutputTokens,
          num_ctx: OLLAMA_LOCAL_SAFE_NUM_CTX,
        },
      }),
    },
    input.timeoutMs,
    input.signal,
  );
  const generateBody = generateResp.ok ? '' : await generateResp.text();
  if (generateResp.ok) {
    const generateData = await generateResp.json();
    const generateText = String(generateData?.response || '').trim() || extractTextFromModelPayload(generateData) || '';
    if (generateText) return generateText;
  }

  const completionEndpoint = /\/chat\/completions$/i.test(openAiBase)
    ? openAiBase
    : `${openAiBase.replace(/\/+$/, '')}/chat/completions`;
  const v1Resp = await fetchWithTimeout(
    completionEndpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: input.prompt }],
        temperature,
        top_p: topP,
        max_tokens: maxOutputTokens,
      }),
    },
    input.timeoutMs,
    input.signal,
  );
  const v1Body = v1Resp.ok ? '' : await v1Resp.text();
  if (v1Resp.ok) {
    const v1Data = await v1Resp.json();
    const v1Text = String(v1Data?.choices?.[0]?.message?.content || '').trim() || extractTextFromModelPayload(v1Data) || '';
    if (v1Text) return v1Text;
  }

  const combined = [chatBody, generateBody, v1Body].filter(Boolean).join(' | ');
  if (isModelNotFoundError(combined)) {
    throw new Error(`Model "${input.model}" chưa có trong Ollama local. ${combined.slice(0, 260)}`);
  }
  throw new Error(
    `Ollama Local error: ` +
      `/api/chat=${chatResp.status}, /api/generate=${generateResp.status}, /v1/chat/completions=${v1Resp.status}. ` +
      `${combined.slice(0, 260)}`,
  );
}

type AiAuth = {
  provider: ApiProvider;
  apiKey: string;
  isApiKey: boolean;
  client?: GoogleGenAI;
  model: string;
  baseUrl: string;
  keyId?: string;
};

async function generateGeminiText(
  auth: AiAuth,
  kind: 'fast' | 'quality',
  contents: string,
  config?: Record<string, unknown>,
): Promise<string> {
  const taskStartedAt = Date.now();
  const runtime = getApiRuntimeConfig();
  const authRotationPool = buildAiAuthRotationPool(runtime, auth);
  let currentAuthIndex = 0;
  let currentAuth = authRotationPool[currentAuthIndex] || auth;
  let lastAuthUsed = currentAuth;
  const runtimeGeneration = sanitizeGenerationConfig(runtime.generation);
  const buildModelCandidates = (provider: ApiProvider, model: string): string[] =>
    provider === 'gemini' || provider === 'gcli'
      ? getGeminiFallbackModels(model, kind)
      : getProviderFallbackModels(provider, model, kind);
  let initialModel = String(currentAuth.model || getProfileModel(kind, currentAuth.provider) || '').trim();
  let modelCandidates = buildModelCandidates(currentAuth.provider, initialModel);
  const splitConfig = splitGenConfig(config);
  const wantsJsonResponse = String(splitConfig.providerConfig.responseMimeType || '').toLowerCase().includes('json');
  const promptWithThinking =
    runtimeGeneration.fullThinkingPrompt && kind === 'quality' && !wantsJsonResponse
      ? `${String(contents || '').trim()}\n\n${FULL_THINKING_12_STEPS_PROMPT}`
      : String(contents || '').trim();
  const runtimeHints: string[] = [];
  if (!wantsJsonResponse && runtimeGeneration.showThinking) {
    runtimeHints.push('Nếu model hỗ trợ thinking, hãy hiển thị phần suy luận ngắn gọn trước khi trả lời chính.');
  }
  if (!wantsJsonResponse && runtimeGeneration.enableGeminiWebSearch && (currentAuth.provider === 'gemini' || currentAuth.provider === 'gcli')) {
    runtimeHints.push('Nếu model hỗ trợ Search Grounding, hãy tra cứu web để tăng độ chính xác ở các thông tin thực tế.');
  }
  if (!wantsJsonResponse && runtimeGeneration.inlineImages && currentAuth.provider === 'gemini') {
    runtimeHints.push('Nếu model hỗ trợ phản hồi kèm ảnh minh hoạ, hãy ưu tiên trả cả ảnh minh hoạ phù hợp.');
  }
  const promptBase = applyContextWindowToPrompt(
    runtimeHints.length ? `${promptWithThinking}\n\n${runtimeHints.join('\n')}` : promptWithThinking,
    runtimeGeneration.contextWindowTokens,
  );
  let ollamaInstalledModels: string[] = [];
  if (currentAuth.provider === 'ollama') {
    ollamaInstalledModels = await fetchOllamaInstalledModels(
      currentAuth.baseUrl || getProviderBaseUrl('ollama'),
      currentAuth.apiKey || '',
      12000,
      splitConfig.signal,
    );
    if (ollamaInstalledModels.length) {
      const installedSet = new Set(ollamaInstalledModels.map((item) => item.toLowerCase()));
      const preferredInstalled =
        ollamaInstalledModels.find((item) => item.toLowerCase() === 'qwen2.5:7b') ||
        ollamaInstalledModels[0];
      const baseExists = Boolean(initialModel) && installedSet.has(initialModel.toLowerCase());
      const primaryModel = baseExists ? initialModel : (preferredInstalled || initialModel);
      if (primaryModel) {
        initialModel = primaryModel;
      }
      const orderedInstalled = [
        initialModel,
        ...ollamaInstalledModels.filter((item) => item.toLowerCase() !== initialModel.toLowerCase()),
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      // For Ollama, only rotate between models that are actually installed to avoid fake fallbacks.
      modelCandidates = Array.from(new Set(orderedInstalled));
    }
  }
  const traceTask = splitConfig.taskType || (kind === 'quality' ? 'story_generate' : 'story_translate');
  const initialConfig = buildDefaultGenConfig(kind, runtimeGeneration, splitConfig.providerConfig);
  let lastModelUsed = initialModel;
  const reqFingerprint = quickHash(
    JSON.stringify({
      provider: auth.provider,
      model: initialModel,
      contents: promptBase,
      config: initialConfig,
      maxRetries: splitConfig.maxRetries,
      minOutputChars: splitConfig.minOutputChars,
      promptVersion: splitConfig.promptVersion || '',
    }),
  );
  const cacheKey = `v1:${reqFingerprint}`;

  if (runtime.enableCache) {
    const cache = readGeminiCache();
    const cached = cache[cacheKey];
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (cached && Date.now() - cached.ts < maxAgeMs) {
      return cached.text;
    }
  }

  const inflight = inFlightAiRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  let text = '';

  const task = (async () => {
    let attemptConfig: Record<string, unknown> = { ...initialConfig };
    let promptForAttempt = promptBase;
    let expectedMinChars = calculateAdaptiveMinOutputChars(promptBase, kind, splitConfig.minOutputChars);
    if (currentAuth.provider === 'ollama') {
      expectedMinChars = Math.min(expectedMinChars, kind === 'fast' ? 320 : 560);
    }
    let currentModelIndex = 0;
    let currentModel = modelCandidates[currentModelIndex] || initialModel;
    const triedOllamaModels = new Set<string>();
    const extraRecoveryRetries =
      auth.provider === 'gemini' || auth.provider === 'gcli'
        ? 2
        : (auth.provider === 'openrouter' || auth.provider === 'ollama')
          ? 3
          : 2;
    const multiDraftRetries = runtimeGeneration.multiDraft && kind === 'quality' ? 1 : 0;
    const maxAttempts = splitConfig.maxRetries + Math.max(0, modelCandidates.length - 1) + extraRecoveryRetries + multiDraftRetries;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(splitConfig.signal);
      lastAuthUsed = currentAuth;
      lastModelUsed = currentModel;
      if (currentAuth.provider === 'ollama') {
        triedOllamaModels.add(String(currentModel || '').trim().toLowerCase());
        attemptConfig = applyOllamaLocalGenTuning(kind, attemptConfig);
      }
      const timeoutMs = calculateAdaptiveTimeoutMs(
        kind,
        Number(attemptConfig.maxOutputTokens || 0) || (kind === 'fast' ? 1800 : 4200),
      );
      if (runtimeGeneration.rateLimitDelay && currentAuth.provider === 'custom' && attempt > 0) {
        await sleepMs(15000);
      }
      await acquireRequestToken(currentAuth.provider, currentModel);
      try {
        if (runtime.mode === 'relay') {
          const body = {
            contents: [
              {
                parts: [{ text: promptForAttempt }],
              },
            ],
            generationConfig: attemptConfig,
          };
          const relayToken = getConfiguredGeminiApiKey();
          const relayEndpoint = `${getProviderBaseUrl('gcli').replace(/\/+$/, '')}/models/${currentModel}:generateContent`;

          const runDirectRelayToken = async () => {
            if (!relayToken) return false;
              const resp = await fetchWithTimeout(
                relayEndpoint,
                {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${relayToken}`,
                },
                body: JSON.stringify(body),
              },
              timeoutMs + 8000,
              splitConfig.signal,
            );
            if (!resp.ok) {
              throw new Error(`Direct bearer error ${resp.status}: ${await resp.text()}`);
            }
            const data = await resp.json();
            text = extractTextFromModelPayload(data) || '';
            return true;
          };

          let directRelayError = '';
          if (relayToken) {
            try {
              const usedDirectToken = await runDirectRelayToken();
              if (!usedDirectToken) {
                throw new Error('Relay token is unavailable.');
              }
            } catch (directErr) {
              directRelayError = stringifyError(directErr);
            }
          }

          if (!text) {
            try {
              const raw = await relayGenerateContent(currentModel, body, timeoutMs);
              throwIfAborted(splitConfig.signal);
              try {
                const parsed = JSON.parse(raw);
                if (parsed?.error?.message) {
                  throw new Error(`AI lỗi: ${parsed.error.message}`);
                }
                text = extractTextFromModelPayload(parsed) || '';
                if (!text && typeof raw === 'string') {
                  text = raw;
                }
              } catch (err) {
                if (err instanceof Error && /AI lỗi:/i.test(err.message)) {
                  throw err;
                }
                text = raw || '';
              }
            } catch (relayErr) {
              const relayMsg = stringifyError(relayErr);
              if (relayToken) {
                if (directRelayError) {
                  throw new Error(`Token relay failed (${directRelayError}); relay socket failed (${relayMsg}).`);
                }
                const usedDirectToken = await runDirectRelayToken();
                if (usedDirectToken && text) {
                  // Recovered via direct bearer token from relay cache.
                } else {
                  throw new Error(`Relay timeout. ${relayMsg} · Hãy kết nối lại Relay hoặc dán API key trực tiếp (Gemini).`);
                }
              }
              if (!relayToken) {
                throw new Error(`Relay timeout. ${relayMsg} · Hãy kết nối lại Relay hoặc dán API key trực tiếp (Gemini).`);
              }
            }
          }
        } else if (currentAuth.provider === 'gemini' && currentAuth.isApiKey && currentAuth.client) {
          const response = await currentAuth.client.models.generateContent({
            model: currentModel,
            contents: promptForAttempt,
            config: attemptConfig,
          });
          throwIfAborted(splitConfig.signal);
          text = response.text || extractTextFromModelPayload(response) || '';
        } else if (currentAuth.provider === 'gemini' || currentAuth.provider === 'gcli') {
          const geminiBase = currentAuth.baseUrl || getProviderBaseUrl('gcli');
          const geminiEndpoint = geminiBase.includes('/models/')
            ? geminiBase
            : `${geminiBase.replace(/\/+$/, '')}/models/${currentModel}:generateContent`;
          const resp = await fetchWithTimeout(geminiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentAuth.apiKey}`,
            },
              body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: promptForAttempt }],
                },
              ],
              generationConfig: attemptConfig,
              }),
          }, timeoutMs, splitConfig.signal);
          if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`${currentAuth.provider === 'gcli' ? 'GCLI' : 'Gemini'} (Bearer) error ${resp.status}: ${body.slice(0, 200)}`);
          }
          const data = await resp.json();
          text = extractTextFromModelPayload(data) || '';
        } else if (currentAuth.provider === 'ollama') {
          const compactPrompt = compactPromptForOllama(promptForAttempt, kind);
          text = await callOllamaLocalWithFallback({
            model: currentModel,
            prompt: compactPrompt,
            baseUrl: currentAuth.baseUrl || getProviderBaseUrl('ollama'),
            apiKey: currentAuth.apiKey,
            timeoutMs,
            signal: splitConfig.signal,
            attemptConfig,
          });
        } else if (
          currentAuth.provider === 'openai' ||
          currentAuth.provider === 'custom' ||
          currentAuth.provider === 'xai' ||
          currentAuth.provider === 'groq' ||
          currentAuth.provider === 'deepseek' ||
          currentAuth.provider === 'openrouter' ||
          currentAuth.provider === 'mistral'
        ) {
          const openAiBase = currentAuth.baseUrl || getProviderBaseUrl(currentAuth.provider);
          const completionEndpoint = /\/chat\/completions$/i.test(openAiBase)
            ? openAiBase
            : `${openAiBase.replace(/\/+$/, '')}/chat/completions`;
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (currentAuth.apiKey.trim()) {
            headers.Authorization = `Bearer ${currentAuth.apiKey}`;
          }
          if (currentAuth.provider === 'openrouter') {
            headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://truyenforge.local';
            headers['X-Title'] = 'TruyenForge';
          }
          const wantsJson = String(attemptConfig.responseMimeType || '').toLowerCase().includes('json');
          const bodyPayload: Record<string, unknown> = {
            model: currentModel,
            messages: [{ role: 'user', content: promptForAttempt }],
            temperature: typeof attemptConfig.temperature === 'number' ? attemptConfig.temperature : 0.7,
            top_p: typeof attemptConfig.topP === 'number' ? attemptConfig.topP : undefined,
            max_tokens: typeof attemptConfig.maxOutputTokens === 'number' ? attemptConfig.maxOutputTokens : undefined,
            seed: typeof attemptConfig.seed === 'number' ? Math.round(attemptConfig.seed) : undefined,
            stream: runtimeGeneration.enableStreaming ? false : false,
          };
          if (currentAuth.provider === 'openai' && wantsJson) {
            bodyPayload.response_format = { type: 'json_object' };
          }
          const resp = await fetchWithTimeout(completionEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyPayload),
          }, timeoutMs, splitConfig.signal);
          if (!resp.ok) {
            const body = await resp.text();
            const providerLabel = currentAuth.provider === 'custom'
              ? 'Custom endpoint'
              : (PROVIDER_LABELS[currentAuth.provider] || 'OpenAI-compatible provider');
            throw new Error(`${providerLabel} error ${resp.status}: ${body.slice(0, 220)}`);
          }
          const data = await resp.json();
          text = data?.choices?.[0]?.message?.content || extractTextFromModelPayload(data) || '';
        } else if (currentAuth.provider === 'anthropic') {
          const resp = await fetchWithTimeout(`${currentAuth.baseUrl || getProviderBaseUrl('anthropic')}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': currentAuth.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: currentModel,
              max_tokens: typeof attemptConfig.maxOutputTokens === 'number' ? attemptConfig.maxOutputTokens : 4096,
              temperature: typeof attemptConfig.temperature === 'number' ? attemptConfig.temperature : 0.7,
              top_p: typeof attemptConfig.topP === 'number' ? attemptConfig.topP : undefined,
              messages: [{ role: 'user', content: promptForAttempt }],
            }),
          }, timeoutMs, splitConfig.signal);
          if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Anthropic error ${resp.status}: ${body.slice(0, 220)}`);
          }
          const data = await resp.json();
          text = Array.isArray(data?.content)
            ? data.content.map((part: { text?: string }) => part?.text || '').join('\n').trim()
            : extractTextFromModelPayload(data) || '';
        } else {
          throw new Error('Nhà cung cấp hiện tại chưa được hỗ trợ.');
        }
      } catch (err) {
        if (isAbortLikeError(err)) {
          if (splitConfig.signal?.aborted) {
            throw new Error('AI operation cancelled by user.');
          }
          throw new Error(
            `AI request timed out after ${Math.round(timeoutMs / 1000)}s. Hãy thử lại, giảm kích thước lô hoặc đổi model nhanh hơn.`,
          );
        }
        const isQuotaError = isQuotaOrRateLimitError(err);
        const isTransientError = isTransientAiServiceError(err);
        const isMissingModelError = currentAuth.provider === 'ollama' && isModelNotFoundError(err);
        if (isMissingModelError) {
          if (ollamaInstalledModels.length) {
            const nextInstalled = ollamaInstalledModels.find((model) => {
              const normalized = String(model || '').trim().toLowerCase();
              return Boolean(normalized) && !triedOllamaModels.has(normalized);
            });
            if (nextInstalled) {
              const normalizedNext = String(nextInstalled || '').trim();
              modelCandidates = [...modelCandidates, normalizedNext]
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .filter((value, index, list) => list.indexOf(value) === index);
              currentModelIndex = modelCandidates.indexOf(normalizedNext);
              currentModel = normalizedNext;
              continue;
            }
          } else {
            const emergencyFallback = ['qwen2.5:7b', 'llama3.1:8b', 'gemma2:9b'].find((model) => {
              const normalized = model.toLowerCase();
              return !triedOllamaModels.has(normalized) && modelCandidates.some((candidate) => candidate.toLowerCase() === normalized);
            });
            if (emergencyFallback) {
              currentModelIndex = modelCandidates.findIndex((candidate) => candidate.toLowerCase() === emergencyFallback.toLowerCase());
              if (currentModelIndex < 0) {
                modelCandidates = [...modelCandidates, emergencyFallback];
                currentModelIndex = modelCandidates.length - 1;
              }
              currentModel = modelCandidates[currentModelIndex];
              continue;
            }
          }
          if (currentModelIndex < modelCandidates.length - 1) {
            currentModelIndex += 1;
            currentModel = modelCandidates[currentModelIndex];
            continue;
          }
          const available = ollamaInstalledModels.length
            ? ollamaInstalledModels.join(', ')
            : 'không đọc được danh sách model từ /api/tags';
          throw new Error(
            `Model "${currentModel}" chưa có trong Ollama local. Model khả dụng: ${available}. Hãy chạy "ollama pull <model>" rồi thử lại.`,
          );
        }
        if (isQuotaError || isTransientError) {
          const retryDelayMs = extractRetryDelayMs(err);
          if (isQuotaError && currentAuthIndex < authRotationPool.length - 1) {
            currentAuthIndex += 1;
            currentAuth = authRotationPool[currentAuthIndex];
            const rotatedModel = String(currentAuth.model || getProfileModel(kind, currentAuth.provider) || currentModel).trim();
            modelCandidates = buildModelCandidates(currentAuth.provider, rotatedModel);
            currentModelIndex = 0;
            currentModel = modelCandidates[currentModelIndex] || rotatedModel || currentModel;
            if (retryDelayMs > 0) {
              await sleepMs(Math.min(12000, retryDelayMs));
            }
            continue;
          }
          if (currentAuth.provider === 'ollama') {
            if (attempt < maxAttempts) {
              const waitMs = retryDelayMs || (isQuotaError
                ? Math.min(65000, 2500 * (attempt + 1))
                : Math.min(45000, 1800 * (attempt + 1)));
              await sleepMs(waitMs);
              continue;
            }
          } else if (currentModelIndex < modelCandidates.length - 1) {
            currentModelIndex += 1;
            currentModel = modelCandidates[currentModelIndex];
            continue;
          }
          if (attempt < maxAttempts) {
            const waitMs = retryDelayMs || (isQuotaError
              ? Math.min(65000, 2000 * (attempt + 1))
              : Math.min(30000, 1200 * (attempt + 1)));
            await sleepMs(waitMs);
            continue;
          }
          if (isQuotaError && isDailyQuotaExceededError(err)) {
            throw new Error(`Đã chạm quota của model ${currentModel}. Hãy đổi model/API key hoặc chờ quota reset rồi thử lại.`);
          }
          if (isTransientError) {
            const attemptedModels = modelCandidates.slice(0, currentModelIndex + 1).join(' -> ');
            if (currentAuth.provider === 'ollama') {
              throw new Error(
                `Model ${currentModel} đang quá tải hoặc lỗi runtime (5xx). Đã thử: ${attemptedModels}. Kiểm tra Ollama local (ollama ps), giảm kích thước lô/tokens hoặc đổi model nhẹ hơn.`,
              );
            }
            throw new Error(
              `Model ${currentModel} đang quá tải (high demand/503). Đã thử: ${attemptedModels}. Hãy thử lại sau 1-2 phút hoặc đổi model.`,
            );
          }
        }
        throw err;
      }

      text = String(text || '').trim();
      const wantsJson = String(attemptConfig.responseMimeType || '').toLowerCase().includes('json');
      const parsedAny = wantsJson ? tryParseJson<unknown>(text, 'any') : null;
      const parsedAnyRecord = asRecord(parsedAny);
      const issuesCandidate = parsedAnyRecord?.issues;
      const hasExplicitEmptyIssues = Array.isArray(issuesCandidate) && issuesCandidate.length === 0;
      const jsonOk = !wantsJson || Boolean(parsedAny);
      const isExplicitEmpty =
        wantsJson &&
        ((Array.isArray(parsedAny) && parsedAny.length === 0) ||
          hasExplicitEmptyIssues);
      const longEnough = isExplicitEmpty || expectedMinChars <= 0 || text.length >= expectedMinChars;
      if ((jsonOk && longEnough) || attempt >= maxAttempts) {
        break;
      }

      const currentMax = Number(attemptConfig.maxOutputTokens || 0) || (kind === 'fast' ? 1800 : 4200);
      attemptConfig = {
        ...attemptConfig,
        maxOutputTokens: auth.provider === 'ollama'
          ? Math.min(
              kind === 'fast' ? OLLAMA_LOCAL_SAFE_TOKENS.retryFast : OLLAMA_LOCAL_SAFE_TOKENS.retryQuality,
              Math.max(320, Math.round(currentMax * 1.18)),
            )
          : Math.min(16384, Math.round(currentMax * 1.8)),
      };
      promptForAttempt = `${promptBase}\n\nYÊU CẦU BỔ SUNG BẮT BUỘC: phản hồi trước quá ngắn hoặc chưa đúng định dạng. Hãy trả lại đầy đủ, chi tiết hơn và tuân thủ đúng format đã yêu cầu.`;
    }

    bumpMainAiUsage(promptBase, text);
    if (runtime.enableCache && text) {
      const cache = readGeminiCache();
      cache[cacheKey] = { text, ts: Date.now() };
      const entries = Object.entries(cache).sort((a, b) => b[1].ts - a[1].ts).slice(0, 120);
      writeGeminiCache(Object.fromEntries(entries));
    }

    return text;
  })();

  inFlightAiRequests.set(cacheKey, task);
  try {
    const output = await task;
    if (String(lastModelUsed || '').trim()) {
      const normalizedModel = String(lastModelUsed || '').trim();
      const runtimeNext = getApiRuntimeConfig();
      let runtimeChanged = false;
      if (lastAuthUsed?.provider && runtimeNext.selectedProvider === lastAuthUsed.provider && runtimeNext.selectedModel !== normalizedModel) {
        runtimeNext.selectedModel = normalizedModel;
        runtimeChanged = true;
      }
      if (lastAuthUsed?.keyId) {
        const vault = loadApiVault(runtimeNext.aiProfile);
        const targetIndex = vault.findIndex((entry) => entry.id === lastAuthUsed.keyId);
        if (targetIndex >= 0) {
          const patch: Partial<StoredApiKeyRecord> = {
            lastTested: new Date().toISOString(),
            status: 'valid',
          };
          if (vault[targetIndex].provider === 'ollama' && vault[targetIndex].model !== normalizedModel) {
            patch.model = normalizedModel;
          }
          const nextVault = activateApiKeyRecord(vault, lastAuthUsed.keyId, patch);
          saveApiVault(nextVault);
          if (runtimeNext.activeApiKeyId !== lastAuthUsed.keyId) {
            runtimeNext.activeApiKeyId = lastAuthUsed.keyId;
            runtimeNext.selectedProvider = vault[targetIndex].provider;
            runtimeChanged = true;
          }
        }
      }
      if (runtimeChanged) {
        saveApiRuntimeConfig(runtimeNext);
      }
    }
    trackApiRequestTelemetry({
      provider: lastAuthUsed.provider,
      model: lastModelUsed,
      apiKey: lastAuthUsed.apiKey,
      keyId: lastAuthUsed.keyId,
      task: traceTask,
      success: true,
      latencyMs: Date.now() - taskStartedAt,
      promptChars: String(contents || '').length,
      responseChars: String(output || '').length,
      metadata: {
        promptVersion: splitConfig.promptVersion || '',
        runId: splitConfig.traceRunId || '',
        stage: splitConfig.traceStage || '',
        lane: kind,
        ...(splitConfig.traceMeta || {}),
      },
    });
    return output;
  } catch (error) {
    trackApiRequestTelemetry({
      provider: lastAuthUsed.provider,
      model: lastModelUsed,
      apiKey: lastAuthUsed.apiKey,
      keyId: lastAuthUsed.keyId,
      task: traceTask,
      success: false,
      latencyMs: Date.now() - taskStartedAt,
      promptChars: String(contents || '').length,
      responseChars: 0,
      errorMessage: stringifyError(error),
      metadata: {
        promptVersion: splitConfig.promptVersion || '',
        runId: splitConfig.traceRunId || '',
        stage: splitConfig.traceStage || '',
        lane: kind,
        ...(splitConfig.traceMeta || {}),
      },
    });
    throw error;
  } finally {
    inFlightAiRequests.delete(cacheKey);
  }
}

function getConfiguredGeminiApiKey(): string {
  try {
    const runtime = getApiRuntimeConfig();
    if (runtime.mode === 'relay') {
      const relayToken = readScopedAppStorage(RELAY_TOKEN_CACHE_KEY)?.trim() || runtime.relayToken?.trim() || '';
      if (relayToken) return relayToken;
    }

    const keys = loadApiVault(runtime.aiProfile);
    const activeGemini = keys.find((item) => item.isActive && (item.provider === 'gemini' || item.provider === 'gcli'))?.key?.trim();
    const firstKey = keys.find((k) => (k.provider === 'gemini' || k.provider === 'gcli') && k?.key?.trim())?.key?.trim();
    const envKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GEMINI_API_KEY?.trim();
    return activeGemini || firstKey || envKey || '';
  } catch {
    return '';
  }
}

type AiTaskIntent = 'primary' | 'auxiliary';

function hasUsableApiKeyRecord(entry?: StoredApiKeyRecord | null): boolean {
  return Boolean(entry && String(entry.key || '').trim());
}

function resolveAuxiliaryOpenRouterEntry(
  vault: StoredApiKeyRecord[],
  activeEntry: StoredApiKeyRecord | null,
): StoredApiKeyRecord | null {
  if (activeEntry?.provider === 'openrouter' && hasUsableApiKeyRecord(activeEntry)) {
    return activeEntry;
  }
  const activeOpenRouter = vault.find((item) => item.provider === 'openrouter' && item.isActive && hasUsableApiKeyRecord(item));
  if (activeOpenRouter) return activeOpenRouter;
  return vault.find((item) => item.provider === 'openrouter' && hasUsableApiKeyRecord(item)) || null;
}

function resolveAiModel(
  runtime: ApiRuntimeConfig,
  provider: ApiProvider,
  entry?: StoredApiKeyRecord | null,
): string {
  const modelFromEntry = String(entry?.model || '').trim();
  if (modelFromEntry) return modelFromEntry;
  if (runtime.selectedModel && runtime.selectedProvider === provider) return runtime.selectedModel;
  if (provider === 'custom') return runtime.selectedModel || 'custom-model';
  if (provider === 'ollama') return runtime.selectedModel || 'qwen2.5:7b';
  return getDefaultModelForProvider(provider, runtime.aiProfile);
}

const KEY_ROTATION_PROVIDERS = new Set<ApiProvider>([
  'gemini',
  'gcli',
  'openai',
  'anthropic',
  'xai',
  'groq',
  'deepseek',
  'openrouter',
  'mistral',
]);

function buildAiAuthFromVaultEntry(runtime: ApiRuntimeConfig, entry: StoredApiKeyRecord): AiAuth {
  const provider = entry.provider;
  const apiKey = String(entry.key || '').trim();
  const model = resolveAiModel(runtime, provider, entry);
  const isApiKey = provider === 'gemini' && /^AIza[0-9A-Za-z\-_]{20,}$/.test(apiKey);
  return {
    provider,
    apiKey,
    isApiKey,
    client: provider === 'gemini' && isApiKey ? new GoogleGenAI({ apiKey }) : undefined,
    model,
    baseUrl: entry.baseUrl || getProviderBaseUrl(provider),
    keyId: entry.id,
  };
}

function buildAiAuthRotationPool(runtime: ApiRuntimeConfig, auth: AiAuth): AiAuth[] {
  if (runtime.mode === 'relay') return [auth];
  if (!KEY_ROTATION_PROVIDERS.has(auth.provider)) return [auth];

  const vault = loadApiVault(runtime.aiProfile)
    .filter((entry) => entry.provider === auth.provider && hasUsableApiKeyRecord(entry));
  if (!vault.length) return [auth];

  const ordered: StoredApiKeyRecord[] = [];
  const pushUnique = (entry: StoredApiKeyRecord) => {
    if (ordered.some((item) => item.id === entry.id)) return;
    ordered.push(entry);
  };

  if (auth.keyId) {
    const explicit = vault.find((entry) => entry.id === auth.keyId);
    if (explicit) pushUnique(explicit);
  }
  vault.filter((entry) => entry.isActive).forEach(pushUnique);
  vault.forEach(pushUnique);

  const mapped = ordered.map((entry) => buildAiAuthFromVaultEntry(runtime, entry));
  const authFromVault = auth.keyId
    ? mapped.some((item) => item.keyId === auth.keyId)
    : mapped.some((item) => item.apiKey === auth.apiKey && item.baseUrl === auth.baseUrl);
  if (!authFromVault) {
    mapped.unshift(auth);
  }

  const deduped: AiAuth[] = [];
  mapped.forEach((item) => {
    const key = `${item.keyId || ''}::${item.apiKey}::${item.baseUrl}::${item.model}`;
    if (deduped.some((existing) => `${existing.keyId || ''}::${existing.apiKey}::${existing.baseUrl}::${existing.model}` === key)) {
      return;
    }
    deduped.push(item);
  });
  return deduped.length ? deduped : [auth];
}

function createGeminiClient(intent: AiTaskIntent = 'primary'): AiAuth {
  const runtime = getApiRuntimeConfig();
  const vault = loadApiVault(runtime.aiProfile);
  const activeEntry = vault.find((item) => item.id === runtime.activeApiKeyId) || getActiveApiKeyRecord(vault);
  const auxiliaryOpenRouter = intent === 'auxiliary' ? resolveAuxiliaryOpenRouterEntry(vault, activeEntry) : null;
  if (auxiliaryOpenRouter) {
    const provider: ApiProvider = 'openrouter';
    const apiKey = String(auxiliaryOpenRouter.key || '').trim();
    return {
      provider,
      apiKey,
      isApiKey: false,
      model: resolveAiModel(runtime, provider, auxiliaryOpenRouter),
      baseUrl: auxiliaryOpenRouter.baseUrl || getProviderBaseUrl(provider),
      keyId: auxiliaryOpenRouter.id,
    };
  }

  if (runtime.mode === 'relay') {
    return {
      provider: 'gemini',
      apiKey: '',
      isApiKey: false,
      model: getProfileModel('quality', 'gemini'),
      baseUrl: '',
    };
  }

  const provider = activeEntry?.provider && activeEntry.provider !== 'unknown'
    ? activeEntry.provider
    : (runtime.selectedProvider === 'unknown' ? 'gemini' : runtime.selectedProvider);

  const apiKey = activeEntry?.key?.trim() || ((provider === 'gemini' || provider === 'gcli') ? getConfiguredGeminiApiKey() : '');
  const allowNoKeyProvider =
    (provider === 'custom' || provider === 'ollama') && Boolean(activeEntry?.baseUrl || runtime.selectedModel);
  if (!apiKey && !allowNoKeyProvider) {
    const mode = getApiRuntimeConfig().mode;
    if (mode === 'relay') {
      return {
        provider: 'gemini',
        apiKey: '',
        isApiKey: false,
        model: getProfileModel('quality', 'gemini'),
        baseUrl: '',
      };
    }
    throw new Error('Bạn chưa thiết lập API. Vào mục API để thêm khóa và chọn model.');
  }
  const isApiKey = provider === 'gemini' && /^AIza[0-9A-Za-z\-_]{20,}$/.test(apiKey);
  return {
    provider,
    apiKey,
    isApiKey,
    client: provider === 'gemini' && isApiKey ? new GoogleGenAI({ apiKey }) : undefined,
    model: resolveAiModel(runtime, provider, activeEntry),
    baseUrl: activeEntry?.baseUrl || getProviderBaseUrl(provider),
    keyId: activeEntry?.id,
  };
}

// --- Types ---
interface Chapter {
  id: string;
  title: string;
  content: string;
  order: number;
  aiInstructions?: string;
  script?: string;
  createdAt: any;
  updatedAt?: any;
}

interface StoryCharacterProfile {
  id: string;
  name: string;
  role: string;
  age: string;
  identity: string;
}

interface Story {
  id: string;
  slug?: string;
  authorId: string;
  title: string;
  content: string;
  coverImageUrl?: string;
  type?: 'original' | 'translated' | 'continued';
  genre?: string;
  introduction?: string;
  expectedChapters?: number;
  expectedWordCount?: number;
  chapters?: Chapter[];
  isPublic: boolean;
  isAdult?: boolean;
  isAI?: boolean;
  storyPromptNotes?: string;
  characterRoster?: StoryCharacterProfile[];
  translationMemory?: TranslationDictionaryEntry[];
  deletedChapterIds?: Record<string, string>;
  createdAt: any;
  updatedAt: any;
}

interface ReaderStoryActivity {
  storyId: string;
  storySlug: string;
  storyTitle: string;
  coverImageUrl?: string;
  type?: 'original' | 'translated' | 'continued';
  genre?: string;
  readChapterIds: string[];
  lastChapterId: string;
  lastChapterTitle: string;
  lastChapterOrder: number;
  totalChapters: number;
  followed: boolean;
  lastReadAt: string;
}

function getReaderActivityUserKey(userId?: string | null): string {
  const normalized = String(userId || '').trim();
  return normalized || 'guest';
}

function loadReaderActivityMap(userId?: string | null): Record<string, ReaderStoryActivity> {
  try {
    const raw = getScopedStorageItem(READER_ACTIVITY_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const userKey = getReaderActivityUserKey(userId);
    const scopedRaw = parsed?.[userKey];
    if (!scopedRaw || typeof scopedRaw !== 'object' || Array.isArray(scopedRaw)) return {};
    const next: Record<string, ReaderStoryActivity> = {};
    Object.entries(scopedRaw as Record<string, unknown>).forEach(([storyId, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const row = value as Partial<ReaderStoryActivity>;
      const normalizedStoryId = String(row.storyId || storyId || '').trim();
      if (!normalizedStoryId) return;
      const readChapterIds = Array.isArray(row.readChapterIds)
        ? row.readChapterIds.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      next[normalizedStoryId] = {
        storyId: normalizedStoryId,
        storySlug: sanitizeStorySlug(String(row.storySlug || '').trim()),
        storyTitle: String(row.storyTitle || '').trim(),
        coverImageUrl: String(row.coverImageUrl || '').trim() || undefined,
        type: row.type === 'translated' || row.type === 'continued' ? row.type : 'original',
        genre: String(row.genre || '').trim() || undefined,
        readChapterIds,
        lastChapterId: String(row.lastChapterId || '').trim(),
        lastChapterTitle: String(row.lastChapterTitle || '').trim(),
        lastChapterOrder: Math.max(0, Number(row.lastChapterOrder) || 0),
        totalChapters: Math.max(0, Number(row.totalChapters) || readChapterIds.length),
        followed: Boolean(row.followed),
        lastReadAt: String(row.lastReadAt || '').trim() || new Date(0).toISOString(),
      };
    });
    return next;
  } catch {
    return {};
  }
}

function saveReaderActivityMap(userId: string | null | undefined, map: Record<string, ReaderStoryActivity>): void {
  try {
    const raw = getScopedStorageItem(READER_ACTIVITY_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const userKey = getReaderActivityUserKey(userId);
    const next = {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      [userKey]: map,
    };
    setScopedStorageItem(READER_ACTIVITY_KEY, JSON.stringify(next));
  } catch {
    // ignore reader activity save failure
  }
}

function upsertReaderActivityEntry(
  userId: string | null | undefined,
  story: Pick<Story, 'id' | 'slug' | 'title' | 'coverImageUrl' | 'type' | 'genre' | 'chapters'>,
  updater: (current: ReaderStoryActivity | null) => ReaderStoryActivity | null,
): Record<string, ReaderStoryActivity> {
  const currentMap = loadReaderActivityMap(userId);
  const storyId = String(story.id || '').trim();
  if (!storyId) return currentMap;
  const current = currentMap[storyId] || null;
  const nextEntry = updater(current);
  if (!nextEntry) return currentMap;
  const normalized: ReaderStoryActivity = {
    ...nextEntry,
    storyId,
    storySlug: sanitizeStorySlug(String(story.slug || nextEntry.storySlug || '').trim()),
    storyTitle: String(nextEntry.storyTitle || story.title || '').trim() || String(story.title || '').trim() || 'Truyện chưa đặt tên',
    coverImageUrl: String(nextEntry.coverImageUrl || story.coverImageUrl || '').trim() || undefined,
    type: story.type === 'translated' || story.type === 'continued' ? story.type : 'original',
    genre: String(nextEntry.genre || story.genre || '').trim() || undefined,
    readChapterIds: Array.from(new Set((nextEntry.readChapterIds || []).map((item) => String(item || '').trim()).filter(Boolean))),
    lastChapterId: String(nextEntry.lastChapterId || '').trim(),
    lastChapterTitle: String(nextEntry.lastChapterTitle || '').trim(),
    lastChapterOrder: Math.max(0, Number(nextEntry.lastChapterOrder) || 0),
    totalChapters: Math.max(
      0,
      Number(nextEntry.totalChapters)
      || Number(story.chapters?.length || 0)
      || (nextEntry.readChapterIds || []).length,
    ),
    followed: Boolean(nextEntry.followed),
    lastReadAt: String(nextEntry.lastReadAt || '').trim() || new Date().toISOString(),
  };
  const nextMap: Record<string, ReaderStoryActivity> = {
    ...currentMap,
    [storyId]: normalized,
  };
  saveReaderActivityMap(userId, nextMap);
  return nextMap;
}

function areReaderActivityEntriesEqual(a: ReaderStoryActivity | null | undefined, b: ReaderStoryActivity | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (
    a.storyId !== b.storyId
    || a.storySlug !== b.storySlug
    || a.storyTitle !== b.storyTitle
    || a.coverImageUrl !== b.coverImageUrl
    || a.type !== b.type
    || a.genre !== b.genre
    || a.lastChapterId !== b.lastChapterId
    || a.lastChapterTitle !== b.lastChapterTitle
    || a.lastChapterOrder !== b.lastChapterOrder
    || a.totalChapters !== b.totalChapters
    || a.followed !== b.followed
    || a.lastReadAt !== b.lastReadAt
  ) {
    return false;
  }
  if (a.readChapterIds.length !== b.readChapterIds.length) return false;
  for (let i = 0; i < a.readChapterIds.length; i += 1) {
    if (a.readChapterIds[i] !== b.readChapterIds[i]) return false;
  }
  return true;
}

function areReaderActivityMapsEqual(
  a: Record<string, ReaderStoryActivity>,
  b: Record<string, ReaderStoryActivity>,
): boolean {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!areReaderActivityEntriesEqual(a[key], b[key])) return false;
  }
  return true;
}

function listReaderActivityHistory(map: Record<string, ReaderStoryActivity>, limit = 8): ReaderStoryActivity[] {
  return Object.values(map || {})
    .filter((item) => item.lastChapterId && item.lastReadAt)
    .sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime())
    .slice(0, Math.max(1, limit));
}

function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitGenreTags(rawGenre: string | undefined): string[] {
  const source = String(rawGenre || '').trim();
  if (!source) return [];
  return source
    .split(/[,;/|]+/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeAuthorLabel(rawAuthor?: string): string {
  let value = String(rawAuthor || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  value = value
    .replace(/\s*(?:•|\||;|,)\s*(?:th[eê]\s*lo[aạ]i|genre)\s*:.*$/i, '')
    .replace(/\s*(?:th[eê]\s*lo[aạ]i|genre)\s*:.*$/i, '')
    .replace(/\s*(?:•|\||;).*/, '')
    .trim();
  value = value.replace(/^[\s\-:•|,.;]+|[\s\-:•|,.;]+$/g, '').trim();
  if (!value) return '';
  const normalized = normalizeSearchText(value);
  if (!normalized) return '';
  if (/^(?:chua ro|unknown|none|n a|na|null)$/i.test(normalized)) return '';
  if (/(?:https?:\/\/|www\.)/i.test(value)) return '';
  if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(value)) return '';
  if (/\.(?:com|net|org|info|io|co|vn|xyz)(?:\b|$)/i.test(value) && !/\s/.test(value) && !/[À-ỹ]/.test(value)) return '';
  if (/^[\W_]+$/i.test(value)) return '';
  return value.slice(0, 160);
}

function normalizeStoryTitleForDisplay(rawTitle: string): string {
  let title = String(rawTitle || '').trim();
  if (!title) return '';
  title = title
    .replace(/\.(?:txt|docx|doc|pdf|epub|md|rtf)$/i, '')
    .replace(/^[\s\-_]*(?:file|truyen|novel)[\s\-_]+/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[–—-]+/g, ' ')
    .replace(/([A-Za-zÀ-ỹ])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-zÀ-ỹ])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
  for (let step = 0; step < 3; step += 1) {
    const nextTitle = title
      .replace(/\b(?:end|full|complete|completed|convert|raw|ban dich|ban convert)\b\s*$/i, '')
      .replace(/\b(?:chap(?:ter)?|chuong)\s*\d+\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (nextTitle === title) break;
    title = nextTitle;
  }
  if (!/[À-ỹ]/.test(title) && /^[A-Za-z0-9 ]+$/.test(title)) {
    title = title
      .split(' ')
      .map((token) => {
        if (!token) return '';
        if (/^[IVXLCDM]+$/i.test(token)) return token.toUpperCase();
        if (token.length <= 3 && token === token.toUpperCase()) return token;
        return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`;
      })
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return title.slice(0, 480);
}

function isSuspiciousStoryTitle(rawTitle?: string): boolean {
  const title = String(rawTitle || '').trim();
  if (!title) return true;
  if (/[a-z][A-Z]/.test(title)) return true;
  if (/[A-Za-z]\d|\d[A-Za-z]/.test(title)) return true;
  if (/_/.test(title)) return true;
  if (/\b(?:end|raw|convert|ban dich|ban convert)\b/i.test(title)) return true;
  if (/^[A-Za-z0-9-]{18,}$/.test(title)) return true;
  if (!/\s/.test(title) && title.length >= 16 && !/[À-ỹ]/.test(title) && /^[A-Za-z0-9-]+$/.test(title)) return true;
  return false;
}

function shouldLookupStoryCardMetadata(input: { title?: string; introduction?: string; genre?: string }): boolean {
  const author = extractAuthorFromIntroduction(input.introduction);
  const hasGenre = Boolean(String(input.genre || '').trim());
  return !author || !hasGenre || isSuspiciousStoryTitle(input.title);
}

function extractAuthorFromIntroduction(introduction?: string): string {
  const source = String(introduction || '').trim();
  if (!source) return '';
  const lineMatch = source.match(/(?:^|\n)\s*t[aá]c\s*gi[aả]\s*:\s*([^\n]+)/i);
  if (lineMatch?.[1]) return sanitizeAuthorLabel(lineMatch[1]);
  const inlineMatch = source.match(/(?:^|\s)t[aá]c\s*gi[aả]\s*:\s*([^•|,\n]+)/i);
  if (inlineMatch?.[1]) return sanitizeAuthorLabel(inlineMatch[1]);
  return '';
}

function buildStoryCardMetaLine(input: { introduction?: string; genre?: string }): string {
  const author = extractAuthorFromIntroduction(input.introduction) || 'Chưa rõ';
  const genre = String(input.genre || '').trim() || 'Chưa phân loại';
  return `Tác giả: ${author} • Thể loại: ${genre}`;
}

function matchesReaderQuery(query: string, chunks: Array<string | undefined>): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(chunks.filter(Boolean).join(' '));
  return haystack.includes(normalizedQuery);
}

function resolveReaderStatus(chapterCount: number, expectedChapters?: number): 'ongoing' | 'completed' {
  const expected = Math.max(0, Number(expectedChapters || 0));
  if (expected > 0 && chapterCount >= expected) return 'completed';
  return 'ongoing';
}

function resolveReaderLengthBucket(chapterCount: number, expectedWordCount?: number): ReaderLengthFilter {
  const expectedWords = Math.max(0, Number(expectedWordCount || 0));
  if (expectedWords >= 300_000 || chapterCount >= 300) return 'epic';
  if (expectedWords >= 120_000 || chapterCount >= 120) return 'long';
  if (expectedWords >= 35_000 || chapterCount >= 40) return 'medium';
  if (chapterCount <= 15 && expectedWords < 35_000) return 'short';
  return 'medium';
}

function matchesReaderDiscoveryFilters(
  item: {
    title: string;
    introduction?: string;
    genre?: string;
    type?: string;
    chapterCount: number;
    expectedChapters?: number;
    expectedWordCount?: number;
    isAdult?: boolean;
  },
  filters: ReaderDiscoveryFilters,
): boolean {
  if (filters.type !== 'all' && String(item.type || 'original') !== filters.type) return false;
  if (filters.adult === 'adult' && !item.isAdult) return false;
  if (filters.adult === 'safe' && item.isAdult) return false;

  const status = resolveReaderStatus(item.chapterCount, item.expectedChapters);
  if (filters.status !== 'all' && status !== filters.status) return false;

  const lengthBucket = resolveReaderLengthBucket(item.chapterCount, item.expectedWordCount);
  if (filters.length !== 'all' && lengthBucket !== filters.length) return false;

  if (filters.genre !== 'all') {
    const tagSet = new Set(splitGenreTags(item.genre).map((tag) => normalizeSearchText(tag)));
    if (!tagSet.has(normalizeSearchText(filters.genre))) return false;
  }

  return matchesReaderQuery(filters.query, [
    item.title,
    item.introduction,
    item.genre,
    splitGenreTags(item.genre).join(' '),
  ]);
}

function getReaderScopedRecord<T>(key: string, userId: string | null | undefined, fallback: T): T {
  try {
    const raw = getScopedStorageItem(key, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const userKey = getReaderActivityUserKey(userId);
    const scopedRaw = parsed?.[userKey];
    return (scopedRaw as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function setReaderScopedRecord<T>(key: string, userId: string | null | undefined, value: T): void {
  try {
    const raw = getScopedStorageItem(key, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const userKey = getReaderActivityUserKey(userId);
    const next = {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      [userKey]: value,
    };
    setScopedStorageItem(key, JSON.stringify(next));
  } catch {
    // ignore scoped save errors for optional reader settings
  }
}

function loadReaderSearchHistory(userId?: string | null): string[] {
  const raw = getReaderScopedRecord<unknown>(READER_SEARCH_HISTORY_KEY, userId, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim()).filter(Boolean).slice(0, READER_SEARCH_HISTORY_LIMIT);
}

function saveReaderSearchHistory(userId: string | null | undefined, history: string[]): void {
  const sanitized = Array.from(new Set((history || []).map((item) => String(item || '').trim()).filter(Boolean)))
    .slice(0, READER_SEARCH_HISTORY_LIMIT);
  setReaderScopedRecord(READER_SEARCH_HISTORY_KEY, userId, sanitized);
}

function loadReaderFilterPresets(userId?: string | null): ReaderFilterPreset[] {
  const raw = getReaderScopedRecord<unknown>(READER_FILTER_PRESETS_KEY, userId, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const data = row as Partial<ReaderFilterPreset>;
      const filters = (data.filters || {}) as Partial<ReaderDiscoveryFilters>;
      return {
        id: String(data.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        name: String(data.name || 'Bộ lọc đã lưu').trim() || 'Bộ lọc đã lưu',
        filters: {
          query: String(filters.query || '').trim(),
          genre: String(filters.genre || 'all').trim() || 'all',
          status: (filters.status === 'ongoing' || filters.status === 'completed') ? filters.status : 'all',
          adult: (filters.adult === 'safe' || filters.adult === 'adult') ? filters.adult : 'all',
          length: (filters.length === 'short' || filters.length === 'medium' || filters.length === 'long' || filters.length === 'epic') ? filters.length : 'all',
          type: (filters.type === 'original' || filters.type === 'translated' || filters.type === 'continued') ? filters.type : 'all',
          sort: (filters.sort === 'title' || filters.sort === 'chapters' || filters.sort === 'recent' || filters.sort === 'popular') ? filters.sort : 'updated',
        },
        createdAt: String(data.createdAt || new Date().toISOString()),
        updatedAt: String(data.updatedAt || data.createdAt || new Date().toISOString()),
      } as ReaderFilterPreset;
    })
    .filter((item): item is ReaderFilterPreset => Boolean(item))
    .slice(0, READER_FILTER_PRESET_LIMIT);
}

function saveReaderFilterPresets(userId: string | null | undefined, presets: ReaderFilterPreset[]): void {
  const sanitized = (presets || [])
    .slice(0, READER_FILTER_PRESET_LIMIT)
    .map((item) => ({
      id: String(item.id || `preset-${Date.now()}`),
      name: String(item.name || 'Bộ lọc đã lưu').trim() || 'Bộ lọc đã lưu',
      filters: item.filters,
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    }));
  setReaderScopedRecord(READER_FILTER_PRESETS_KEY, userId, sanitized);
}

interface PublicStoryFeedItem {
  id: string;
  slug?: string;
  authorId: string;
  title: string;
  introduction?: string;
  coverImageUrl?: string;
  type?: 'original' | 'translated' | 'continued';
  genre?: string;
  chapterCount: number;
  expectedChapters?: number;
  expectedWordCount?: number;
  isAdult?: boolean;
  updatedAt: string;
  createdAt?: string;
}

type ReaderStatusFilter = 'all' | 'ongoing' | 'completed';
type ReaderAdultFilter = 'all' | 'safe' | 'adult';
type ReaderLengthFilter = 'all' | 'short' | 'medium' | 'long' | 'epic';
type ReaderTypeFilter = 'all' | 'original' | 'translated' | 'continued';
type ReaderSortMode = 'updated' | 'title' | 'chapters' | 'recent' | 'popular';

interface ReaderDiscoveryFilters {
  query: string;
  genre: string;
  status: ReaderStatusFilter;
  adult: ReaderAdultFilter;
  length: ReaderLengthFilter;
  type: ReaderTypeFilter;
  sort: ReaderSortMode;
}

interface ReaderFilterPreset {
  id: string;
  name: string;
  filters: ReaderDiscoveryFilters;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_READER_DISCOVERY_FILTERS: ReaderDiscoveryFilters = {
  query: '',
  genre: 'all',
  status: 'all',
  adult: 'all',
  length: 'all',
  type: 'all',
  sort: 'updated',
};

type BreadcrumbItem = {
  label: string;
  to?: string;
};

const STORY_SLUG_ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

function sanitizeStorySlug(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function createRandomAlphaNumericId(length = 10): string {
  const size = Math.max(6, Math.min(24, Math.floor(length)));
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(size);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, (item) => STORY_SLUG_ALPHANUM[item % STORY_SLUG_ALPHANUM.length]).join('');
  }
  let output = '';
  for (let i = 0; i < size; i += 1) {
    const index = Math.floor(Math.random() * STORY_SLUG_ALPHANUM.length);
    output += STORY_SLUG_ALPHANUM[index];
  }
  return output;
}

function createStoryRouteSlug(existing: Set<string>): string {
  let attempts = 0;
  while (attempts < 32) {
    const candidate = createRandomAlphaNumericId(10);
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
    attempts += 1;
  }
  const fallback = `${createRandomAlphaNumericId(12)}${Date.now().toString(36)}`.slice(0, 18);
  existing.add(fallback);
  return fallback;
}

function resolveStorySlug(story: Pick<Story, 'id' | 'slug'>): string {
  const fromSaved = sanitizeStorySlug(story.slug || '');
  if (fromSaved.length >= 6) return fromSaved;

  const fromId = sanitizeStorySlug(String(story.id || '').replace(/^story/i, ''));
  if (fromId.length >= 6) return fromId.slice(0, 18);

  return createRandomAlphaNumericId(10);
}

function createStorySlugFromStories(stories: Array<Pick<Story, 'id' | 'slug'>>): string {
  const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
  return createStoryRouteSlug(usedSlugs);
}

function saveStoriesAndRefresh(nextStories: Story[]): void {
  storage.saveStories(nextStories);
  bumpStoriesVersion();
}

function normalizeStoriesWithSlug(stories: Story[]): { stories: Story[]; changed: boolean } {
  const used = new Set<string>();
  let changed = false;

  const normalized = stories.map((story) => {
    let nextSlug = sanitizeStorySlug(story.slug || '');
    if (nextSlug.length < 6 || used.has(nextSlug)) {
      nextSlug = createStoryRouteSlug(used);
    } else {
      used.add(nextSlug);
    }
    if (nextSlug !== story.slug) {
      changed = true;
      return { ...story, slug: nextSlug };
    }
    return story;
  });

  return { stories: normalized, changed };
}

function slugifySegment(value: string, fallback = 'noi-dung'): string {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function getChapterRouteSlug(chapter: Pick<Chapter, 'id' | 'title' | 'order'>): string {
  const order = Number.isFinite(Number(chapter.order)) ? Number(chapter.order) : 1;
  const titleSlug = slugifySegment(chapter.title || `chuong-${order}`, `chuong-${order}`).slice(0, 42);
  const idTail = sanitizeStorySlug(chapter.id || '').slice(-6) || createRandomAlphaNumericId(6);
  return `chuong-${order}-${titleSlug}-${idTail}`.replace(/-+/g, '-');
}

function findChapterByRouteSlug(chapters: Chapter[], chapterSlug: string): Chapter | null {
  const normalizedSlug = String(chapterSlug || '').trim().toLowerCase();
  if (!normalizedSlug) return null;

  return chapters.find((chapter) => {
    const chapterId = String(chapter.id || '').trim().toLowerCase();
    return chapterId === normalizedSlug || getChapterRouteSlug(chapter).toLowerCase() === normalizedSlug;
  }) || null;
}

interface TranslationName {
  id: string;
  authorId: string;
  original: string;
  translation: string;
  createdAt: any;
}

interface Character {
  id: string;
  authorId: string;
  storyId?: string;
  name: string;
  appearance: string;
  personality: string;
  createdAt: any;
}

interface JsonImportPayload {
  stories: Record<string, unknown>[];
  characters: Record<string, unknown>[];
  droppedStories: number;
  droppedCharacters: number;
}

function parseJsonImportPayload(rawText: string): JsonImportPayload {
  const parsed = tryParseJson<unknown>(rawText, 'any');
  const data = asRecord(parsed);
  if (!data) {
    throw new Error('File JSON không hợp lệ hoặc sai định dạng.');
  }
  const importedStoriesRaw = Array.isArray(data.stories) ? data.stories : [];
  const importedCharactersRaw = Array.isArray(data.characters) ? data.characters : [];

  const stories = importedStoriesRaw
    .slice(0, STORY_IMPORT_MAX_STORIES)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const characters = importedCharactersRaw
    .slice(0, STORY_IMPORT_MAX_CHARACTERS)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return {
    stories,
    characters,
    droppedStories: Math.max(0, importedStoriesRaw.length - stories.length),
    droppedCharacters: Math.max(0, importedCharactersRaw.length - characters.length),
  };
}

function buildImportedStoriesFromJson(input: {
  stories: Record<string, unknown>[];
  authorId: string;
  existingStories: Story[];
}): Story[] {
  const usedSlugs = new Set(input.existingStories.map((item) => resolveStorySlug(item)));
  const now = new Date().toISOString();
  return input.stories.map((storyRecord) => {
    const { id, ...rest } = storyRecord;
    const chaptersRaw = Array.isArray(rest.chapters)
      ? rest.chapters.slice(0, STORY_IMPORT_MAX_CHAPTERS_PER_STORY)
      : [];
    return {
      ...rest,
      id: createClientId('story'),
      slug: createStoryRouteSlug(usedSlugs),
      authorId: input.authorId,
      createdAt: now,
      updatedAt: now,
      chapters: normalizeChaptersForLocal(chaptersRaw as Chapter[]),
    } as Story;
  });
}

function buildImportedCharactersFromJson(input: {
  characters: Record<string, unknown>[];
  authorId: string;
}): Character[] {
  const now = new Date().toISOString();
  return input.characters.map((characterRecord) => {
    const { id, ...rest } = characterRecord;
    return {
      ...rest,
      id: createClientId('char'),
      authorId: input.authorId,
      createdAt: now,
    } as Character;
  });
}

type ImportedStoryMetadataSource = 'google-books' | 'filename' | 'fallback';

interface ImportedStoryMetadata {
  title: string;
  author: string;
  genre: string;
  source: ImportedStoryMetadataSource;
  confidence: number;
}

const importedStoryMetadataCache = new Map<string, ImportedStoryMetadata>();
const importedStoryTitleOverrides: Array<{ pattern: RegExp; title: string; genre?: string; author?: string }> = [
  {
    pattern: /^ta tro thanh phu nhi dai phan ph/i,
    title: 'Ta Trở Thành Phú Nhị Đại Phản Phái',
    author: 'Tam Tam Đắc Cửu',
    genre: 'Đô thị, Hệ thống, Xuyên không',
  },
  {
    pattern: /^chu gioi tan the(?: online)?(?: ngay tan cua the gioi)?(?: \d+)?(?: end)?$/i,
    title: 'Chư Giới Tận Thế Online',
    author: 'Yên Hỏa Thành Thành',
    genre: 'Mạt thế, Khoa huyễn, Huyền huyễn, Dị giới',
  },
];

function resolveImportedStoryTitleOverride(rawTitle: string): { pattern: RegExp; title: string; genre?: string; author?: string } | undefined {
  const normalizedTitle = normalizeSearchText(normalizeStoryTitleForDisplay(rawTitle));
  if (!normalizedTitle) return undefined;
  return importedStoryTitleOverrides.find((item) => item.pattern.test(normalizedTitle));
}

function normalizeImportedTitleFromFileName(fileName: string, extensionPattern: RegExp): string {
  const sanitized = normalizeStoryTitleForDisplay(
    String(fileName || '')
      .replace(extensionPattern, '')
      .trim(),
  );
  const override = resolveImportedStoryTitleOverride(sanitized);
  return String(override?.title || sanitized).trim().slice(0, 480);
}

function resolveStoryCardDisplayTitle(rawTitle: string, metadata?: ImportedStoryMetadata): string {
  const candidate = String(metadata?.title || rawTitle || '').trim();
  if (!candidate) return 'Truyện chưa đặt tên';
  const override = resolveImportedStoryTitleOverride(candidate);
  return String(override?.title || normalizeStoryTitleForDisplay(candidate) || 'Truyện chưa đặt tên').slice(0, 480);
}

function resolveStoryCardDisplayGenre(rawGenre?: string, metadata?: ImportedStoryMetadata, rawTitle?: string): string {
  const override = resolveImportedStoryTitleOverride(metadata?.title || rawTitle || '');
  const fromOverride = String(override?.genre || '').trim();
  if (fromOverride) return fromOverride.slice(0, 190);
  return String(metadata?.genre || rawGenre || '').trim().slice(0, 190);
}

function buildStoryCardDisplayIntroduction(input: {
  introduction?: string;
  genre?: string;
  title?: string;
  metadata?: ImportedStoryMetadata;
}): string {
  const explicitAuthor = sanitizeAuthorLabel(input.metadata?.author || '');
  const introAuthor = extractAuthorFromIntroduction(input.introduction);
  const author = explicitAuthor || introAuthor || 'Chưa rõ';
  const genre = resolveStoryCardDisplayGenre(input.genre, input.metadata, input.title) || 'Chưa phân loại';
  return `Tác giả: ${author}\nThể loại: ${genre}`;
}

function inferImportedGenre(title: string): string {
  const source = normalizeSearchText(title);
  const match = (pattern: RegExp) => pattern.test(source);
  if (match(/tien hiep|tu chan|kiem tien|dao ton|than ma/)) return 'Tiên hiệp';
  if (match(/huyen huyen|vo hon|than|ma|de ton|tu la|dau pha/)) return 'Huyền huyễn';
  if (match(/do thi|hao mon|tong tai|phu nhi dai/)) return 'Đô thị';
  if (match(/ngon tinh|co vo|cuoi truoc/)) return 'Ngôn tình';
  if (match(/trinh tham|hinh su|an mang/)) return 'Trinh thám';
  if (match(/xuyen khong|trong sinh|he thong|vo han luan hoi/)) return 'Xuyên không';
  if (match(/kinh di|linh di|quy|ac ma/)) return 'Kinh dị';
  return 'Dịch tổng hợp';
}

function mapGoogleCategoryToGenre(categories: string[]): string {
  const source = normalizeSearchText((categories || []).join(' '));
  if (!source) return '';
  if (/fantasy|huyen|xianxia|cultivation|supernatural/.test(source)) return 'Huyền huyễn';
  if (/romance|ngon tinh|love/.test(source)) return 'Ngôn tình';
  if (/mystery|detective|crime|thriller/.test(source)) return 'Trinh thám';
  if (/horror|ghost|paranormal/.test(source)) return 'Kinh dị';
  if (/science fiction|sci fi|cyberpunk/.test(source)) return 'Khoa học viễn tưởng';
  if (/urban|city|business/.test(source)) return 'Đô thị';
  return '';
}

function scoreImportedTitleCandidate(queryTitle: string, candidateTitle: string): number {
  const queryNorm = normalizeSearchText(queryTitle);
  const candidateNorm = normalizeSearchText(candidateTitle);
  if (!queryNorm || !candidateNorm) return 0;
  if (queryNorm === candidateNorm) return 1;
  const queryTokens = queryNorm.split(' ').filter(Boolean);
  const candidateTokenSet = new Set(candidateNorm.split(' ').filter(Boolean));
  const overlap = queryTokens.filter((token) => candidateTokenSet.has(token)).length;
  const overlapScore = overlap / Math.max(1, queryTokens.length);
  const includeBonus = candidateNorm.includes(queryNorm) || queryNorm.includes(candidateNorm) ? 0.25 : 0;
  const lengthPenalty = Math.min(0.2, Math.abs(candidateNorm.length - queryNorm.length) / 120);
  return Math.max(0, overlapScore + includeBonus - lengthPenalty);
}

async function resolveImportedStoryMetadata(fileName: string, extensionPattern: RegExp): Promise<ImportedStoryMetadata> {
  const normalizedTitle = normalizeImportedTitleFromFileName(fileName, extensionPattern);
  const cacheKey = normalizeSearchText(normalizedTitle);
  const cached = importedStoryMetadataCache.get(cacheKey);
  if (cached) return cached;

  const override = resolveImportedStoryTitleOverride(normalizedTitle);
  if (override) {
    const overridden: ImportedStoryMetadata = {
      title: override.title.slice(0, 480),
      author: sanitizeAuthorLabel(String(override.author || '')).slice(0, 160),
      genre: String(override.genre || inferImportedGenre(override.title)).slice(0, 190),
      source: 'filename',
      confidence: 0.95,
    };
    importedStoryMetadataCache.set(cacheKey, overridden);
    return overridden;
  }

  const fallback: ImportedStoryMetadata = {
    title: normalizedTitle || 'Truyện chưa đặt tên',
    author: '',
    genre: inferImportedGenre(normalizedTitle),
    source: normalizedTitle ? 'filename' : 'fallback',
    confidence: normalizedTitle ? 0.5 : 0.2,
  };
  if (!normalizedTitle) return fallback;

  try {
    const query = encodeURIComponent(`intitle:${normalizedTitle}`);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=6&langRestrict=vi&printType=books`;
    const response = await fetch(url);
    if (!response.ok) {
      importedStoryMetadataCache.set(cacheKey, fallback);
      return fallback;
    }
    const data = await response.json() as { items?: Array<{ volumeInfo?: any }> };
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      importedStoryMetadataCache.set(cacheKey, fallback);
      return fallback;
    }

    const ranked = items
      .map((item) => {
        const volume = item?.volumeInfo || {};
        const title = String(volume.title || '').trim();
        const authors = Array.isArray(volume.authors) ? volume.authors.map((a: unknown) => String(a || '').trim()).filter(Boolean) : [];
        const categories = Array.isArray(volume.categories) ? volume.categories.map((c: unknown) => String(c || '').trim()).filter(Boolean) : [];
        const score = scoreImportedTitleCandidate(normalizedTitle, title);
        return { title, authors, categories, score };
      })
      .filter((item) => item.title)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.56) {
      importedStoryMetadataCache.set(cacheKey, fallback);
      return fallback;
    }

    const metadata: ImportedStoryMetadata = {
      title: best.title.slice(0, 480),
      author: (best.authors[0] || '').slice(0, 160),
      genre: mapGoogleCategoryToGenre(best.categories) || fallback.genre,
      source: 'google-books',
      confidence: best.score,
    };
    importedStoryMetadataCache.set(cacheKey, metadata);
    return metadata;
  } catch {
    importedStoryMetadataCache.set(cacheKey, fallback);
    return fallback;
  }
}

function buildImportedTextStory(input: {
  fileName: string;
  extensionPattern: RegExp;
  text: string;
  authorId: string;
  existingStories: Story[];
  metadata?: ImportedStoryMetadata;
}): Story {
  const now = new Date().toISOString();
  const normalizedTitle = (input.metadata?.title || normalizeImportedTitleFromFileName(input.fileName, input.extensionPattern) || 'Truyện chưa đặt tên').slice(0, 480);
  const normalizedGenre = (input.metadata?.genre || inferImportedGenre(normalizedTitle) || 'Dịch tổng hợp').slice(0, 190);
  const authorLabel = (input.metadata?.author || '').trim() || 'Chưa rõ';
  return {
    id: createClientId('story'),
    slug: createStorySlugFromStories(input.existingStories),
    authorId: input.authorId,
    title: normalizedTitle,
    content: String(input.text).substring(0, 1_999_900),
    introduction: `Tác giả: ${authorLabel}\nThể loại: ${normalizedGenre}`,
    genre: normalizedGenre,
    type: 'translated',
    isPublic: false,
    createdAt: now,
    updatedAt: now,
    chapters: [],
  };
}

interface AIRule {
  id: string;
  authorId: string;
  name: string;
  content: string;
  createdAt: any;
}

interface StyleReference {
  id: string;
  authorId: string;
  name: string;
  content: string;
  createdAt: any;
}


// --- AI Story Creation ---

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Đã xảy ra lỗi không mong muốn.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.error.includes("Missing or insufficient permissions")) {
          errorMessage = "Bạn không có quyền thực hiện thao tác này. Vui lòng kiểm tra lại quyền truy cập.";
        } else if (parsed.error) {
          errorMessage = `Lỗi: ${parsed.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white p-8 rounded-[32px] border border-slate-200 shadow-xl text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-serif font-bold mb-4">Rất tiếc!</h2>
            <p className="text-slate-600 mb-8">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Components ---

const CharacterManager = ({ storyId, onBack, onRequireAuth }: { storyId?: string, onBack: () => void, onRequireAuth: () => void }) => {
  const { user } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');

  useEffect(() => {
    const list = storage.getCharacters();
    setCharacters(list);
  }, []);

  const handleSave = async () => {
    if (!user) return;
    const charData: Character = {
      id: editingChar?.id || `char-${Date.now()}`,
      authorId: user.uid,
      storyId: storyId || undefined,
      name,
      appearance,
      personality,
      createdAt: editingChar?.createdAt || new Date().toISOString(),
    };

    let newList;
    if (editingChar) {
      newList = characters.map(c => c.id === editingChar.id ? charData : c);
    } else {
      newList = [charData, ...characters];
    }
    
    setCharacters(newList);
    storage.saveCharacters(newList);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setAppearance('');
    setPersonality('');
    setIsAdding(false);
    setEditingChar(null);
  };

  const startEdit = (char: Character) => {
    setEditingChar(char);
    setName(char.name);
    setAppearance(char.appearance);
    setPersonality(char.personality);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Xóa nhân vật này?')) return;
    const newList = characters.filter(c => c.id !== id);
    setCharacters(newList);
    storage.saveCharacters(newList);
  };

  if (!user) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-4xl mx-auto pt-24 pb-12 px-6"
      >
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100"><ChevronLeft /></button>
          <h2 className="text-3xl font-serif font-bold">Nhân vật</h2>
        </div>
        <div className="bg-white p-12 rounded-[32px] border border-slate-200 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-xl font-serif font-bold mb-2">Bạn chưa đăng nhập</h3>
          <p className="text-slate-500 mb-8">Vui lòng đăng nhập để quản lý danh sách nhân vật của bạn.</p>
          <button 
            onClick={onRequireAuth}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20"
          >
            Đăng nhập ngay
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="max-w-4xl mx-auto pt-24 pb-12 px-6"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100"><ChevronLeft /></button>
          <h2 className="text-3xl font-serif font-bold">Nhân vật</h2>
        </div>
        {!isAdding && (
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-2 rounded-full bg-indigo-600 text-white font-medium shadow-md"
          >
            <Plus className="w-4 h-4" /> Thêm nhân vật
          </button>
        )}
      </div>

      {isAdding ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Tên nhân vật</label>
            <input 
              value={name} onChange={(e) => setName(e.target.value)}
              className="w-full text-2xl font-serif border-b border-slate-100 focus:border-indigo-500 focus:ring-0 outline-none pb-2"
              placeholder="Nhập tên..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Ngoại hình</label>
            <textarea 
              value={appearance} onChange={(e) => setAppearance(e.target.value)}
              className="w-full min-h-[100px] p-4 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500/20 outline-none"
              placeholder="Mô tả ngoại hình..."
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Tính cách</label>
            <textarea 
              value={personality} onChange={(e) => setPersonality(e.target.value)}
              className="w-full min-h-[100px] p-4 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500/20 outline-none"
              placeholder="Mô tả tính cách..."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button onClick={handleSave} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-900/10">Lưu nhân vật</button>
            <button onClick={resetForm} className="px-8 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Hủy</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {characters.map(char => (
            <div key={char.id} className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-serif font-bold text-slate-900">{char.name}</h3>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(char)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-indigo-600"><Edit3 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(char.id)} className="p-2 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Ngoại hình</span>
                  <p className="text-sm text-slate-600 line-clamp-2 italic">{char.appearance || 'Chưa có mô tả'}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Tính cách</span>
                  <p className="text-sm text-slate-600 line-clamp-2">{char.personality || 'Chưa có mô tả'}</p>
                </div>
              </div>
            </div>
          ))}
          {characters.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-400 italic">Chưa có nhân vật nào được tạo.</div>
          )}
        </div>
      )}
    </motion.div>
  );
};

const TranslationNameDictionary = () => {
  const { user } = useAuth();
  const [names, setNames] = useState<TranslationName[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOriginal, setNewOriginal] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    setNames(storage.getTranslationNames());
    setLoading(false);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newOriginal.trim() || !newTranslation.trim()) return;
    setIsAdding(true);
    const newName: TranslationName = {
      id: `trans-${Date.now()}`,
      authorId: user.uid,
      original: newOriginal.trim(),
      translation: newTranslation.trim(),
      createdAt: new Date().toISOString()
    };
    const newList = [newName, ...names];
    setNames(newList);
    storage.saveTranslationNames(newList);
    setNewOriginal('');
    setNewTranslation('');
    setIsAdding(false);
  };

  const handleDelete = async (id: string) => {
    const newList = names.filter(n => n.id !== id);
    setNames(newList);
    storage.saveTranslationNames(newList);
  };

  const handleExportTxt = () => {
    const content = names.map(n => `${n.original}=${n.translation}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tu-dien-ten-${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTxt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const decodeEntities = (input: string) => {
      const el = document.createElement('textarea');
      el.innerHTML = input;
      return el.value;
    };
    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.includes('='));
      if (window.confirm(`Bạn có muốn nhập ${lines.length} tên từ file này?`)) {
        const newNames: TranslationName[] = [];
        for (const line of lines) {
          const [rawOriginal, ...rawRest] = line.split('=');
          const original = decodeEntities((rawOriginal || '').trim());
          const translation = decodeEntities(rawRest.join('=').trim());
          if (original && translation) {
            newNames.push({
              id: `trans-${Date.now()}-${Math.random()}`,
              authorId: user.uid,
              original,
              translation,
              createdAt: new Date().toISOString()
            });
          }
        }
        const newList = [...newNames, ...names];
        setNames(newList);
        storage.saveTranslationNames(newList);
        notifyApp({ tone: 'success', message: "Nhập từ điển thành công!" });
      }
    } catch (error) {
      notifyApp({ tone: 'error', message: "Lỗi khi nhập file từ điển." });
    }
    e.target.value = '';
  };

  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="p-3 bg-amber-50 rounded-2xl">
            <Languages className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h3 className="text-xl font-serif font-bold">Kho Name</h3>
            <p className="text-xs text-slate-500 font-medium">Tự động thay thế tên khi dịch truyện</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleExportTxt}
            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
            title="Xuất file .txt"
          >
            <Download className="w-5 h-5" />
          </button>
          <label className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all cursor-pointer" title="Nhập file .txt">
            <Upload className="w-5 h-5" />
            <input type="file" accept=".txt" onChange={handleImportTxt} className="hidden" />
          </label>
        </div>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3 mb-8">
        <input 
          type="text" 
          placeholder="Tên gốc (VD: 林凡)" 
          value={newOriginal}
          onChange={e => setNewOriginal(e.target.value)}
          className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all"
        />
        <input 
          type="text" 
          placeholder="Tên dịch (VD: Lâm Phàm)" 
          value={newTranslation}
          onChange={e => setNewTranslation(e.target.value)}
          className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all"
        />
        <button 
          type="submit"
          disabled={isAdding}
          className="w-full md:w-auto px-6 py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition-all disabled:opacity-50"
        >
          {isAdding ? '...' : <Plus className="w-5 h-5" />}
        </button>
      </form>

      <div className="max-h-96 overflow-y-auto pr-2 space-y-2">
        {loading ? (
          <div className="text-center py-8 text-slate-400">Đang tải...</div>
        ) : names.length === 0 ? (
          <div className="text-center py-8 text-slate-400 italic">Chưa có tên nào trong từ điển</div>
        ) : (
          names.map(n => (
            <div key={n.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl group border border-transparent hover:border-amber-100 transition-all">
              <div className="flex items-center gap-4">
                <span className="font-medium text-slate-900">{n.original}</span>
                <ChevronRight className="w-4 h-4 text-slate-300" />
                <span className="font-bold text-amber-700">{n.translation}</span>
              </div>
              <button 
                onClick={() => handleDelete(n.id)}
                className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const parsePDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await loadPdfJsModule();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(' ') + '\n';
    if (i % 3 === 0) {
      await yieldToMainThread();
    }
  }
  return text;
};

const parseEPUB = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const ePub = await loadEpubFactory();
  const book = ePub(arrayBuffer);
  await book.ready;
  let text = '';
  const spine = book.spine;
  // @ts-ignore
  for (const item of spine.items) {
    const doc = await book.load(item.href);
    if (doc instanceof Document) {
      text += doc.body.innerText + '\n';
    } else if (typeof doc === 'string') {
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(doc, 'text/html');
      text += htmlDoc.body.innerText + '\n';
    }
    await yieldToMainThread();
  }
  return text;
};

const WriterProPanel = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'autocomplete' | 'plot' | 'tone' | 'context' | 'wiki'>('autocomplete');
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState('');

  const [autoContext, setAutoContext] = useState('');
  const [autoLength, setAutoLength] = useState(100);
  const [autoVariants, setAutoVariants] = useState<Array<{ label: string; text: string }>>([]);

  const [plotContext, setPlotContext] = useState('');
  const [plotResult, setPlotResult] = useState<{ directions: string[]; twists: string[]; risks: string[] } | null>(null);

  const [toneSource, setToneSource] = useState('');
  const [toneTarget, setToneTarget] = useState('vanhoc');
  const [toneResult, setToneResult] = useState('');

  const [queryContext, setQueryContext] = useState('');
  const [queryQuestion, setQueryQuestion] = useState('');
  const [queryResult, setQueryResult] = useState('');

  const [wikiSource, setWikiSource] = useState('');
  const [wikiResult, setWikiResult] = useState<{
    characters: Array<{ name: string; description?: string }>;
    locations: Array<{ name: string; description?: string }>;
    items: Array<{ name: string; description?: string }>;
  } | null>(null);
  const [wikiSavedNotice, setWikiSavedNotice] = useState('');

  if (!user) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Vui lòng đăng nhập để dùng Writer Pro.
      </div>
    );
  }

  const trimForAi = (text: string, max = 6000) => String(text || '').trim().slice(0, max);
  const extractJson = (raw: string): Record<string, unknown> | null => {
    return tryParseJson<Record<string, unknown>>(raw, 'object')
      || tryParseJson<Record<string, unknown>>(normalizeJsonLikeText(raw), 'object');
  };

  const normalizeNamedEntries = (value: unknown): Array<{ name: string; description: string }> => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        const row = asRecord(item);
        const name = String(row?.name || '').trim();
        const description = String(row?.description || '').trim();
        if (!name) return null;
        return { name, description };
      })
      .filter((item): item is { name: string; description: string } => Boolean(item));
  };

  const runAutocomplete = async () => {
    if (!autoContext.trim()) return;
    setIsRunning(true);
    setStatusText('Đang tạo gợi ý viết tiếp...');
    try {
      const ai = createGeminiClient('auxiliary');
      const prompt = `
Bạn là đồng tác giả văn học. Hãy viết tiếp khoảng ${autoLength} từ, giữ văn phong và mạch truyện hiện tại.
Trả về JSON đúng cấu trúc:
{
  "variants": [
    { "label": "Conservative", "text": "..." },
    { "label": "Balanced", "text": "..." },
    { "label": "Bold", "text": "..." }
  ]
}
NỘI DUNG TRƯỚC ĐÓ:
${trimForAi(autoContext, 7000)}
      `.trim();
      const raw = await generateGeminiText(ai, 'quality', prompt, {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: Math.min(4800, Math.max(1400, Math.round(autoLength * 14))),
        minOutputChars: Math.max(220, Math.round(autoLength * 2.8)),
        maxRetries: 2,
      });
      const parsed = extractJson(raw);
      const variants = Array.isArray(parsed?.variants)
        ? parsed.variants
            .map((item, idx: number) => {
              const row = asRecord(item);
              return {
                label: String(row?.label || `Gợi ý ${idx + 1}`),
                text: String(row?.text || ''),
              };
            })
            .filter((item: { text: string }) => item.text.trim())
        : [{ label: 'Gợi ý', text: raw }];
      setAutoVariants(variants);
    } catch (err) {
      setAutoVariants([{ label: 'Lỗi', text: err instanceof Error ? err.message : 'Không tạo được gợi ý.' }]);
    } finally {
      setIsRunning(false);
      setStatusText('');
    }
  };

  const runPlot = async () => {
    if (!plotContext.trim()) return;
    setIsRunning(true);
    setStatusText('Đang phân tích plot...');
    try {
      const ai = createGeminiClient('auxiliary');
      const prompt = `
Bạn là cố vấn biên kịch. Dựa trên bối cảnh dưới đây, hãy đề xuất:
1) 3 hướng phát triển tiếp theo,
2) 3 plot twist khả thi,
3) 3 rủi ro logic cần tránh.
Trả về JSON:
{
  "directions": ["..."],
  "twists": ["..."],
  "risks": ["..."]
}
BỐI CẢNH:
${trimForAi(plotContext, 7000)}
      `.trim();
      const raw = await generateGeminiText(ai, 'quality', prompt, {
        responseMimeType: 'application/json',
        temperature: 0.6,
        maxOutputTokens: 2600,
        minOutputChars: 260,
        maxRetries: 2,
      });
      const parsed = extractJson(raw);
      setPlotResult({
        directions: Array.isArray(parsed?.directions) ? parsed.directions.map(String) : [],
        twists: Array.isArray(parsed?.twists) ? parsed.twists.map(String) : [],
        risks: Array.isArray(parsed?.risks) ? parsed.risks.map(String) : [],
      });
    } catch (err) {
      setPlotResult({
        directions: [],
        twists: [],
        risks: [err instanceof Error ? err.message : 'Không tạo được gợi ý plot.'],
      });
    } finally {
      setIsRunning(false);
      setStatusText('');
    }
  };

  const runToneShift = async () => {
    if (!toneSource.trim()) return;
    setIsRunning(true);
    setStatusText('Đang chuyển giọng văn...');
    const toneMap: Record<string, string> = {
      vanhoc: 'văn học, giàu hình ảnh',
      langman: 'lãng mạn, mềm mại',
      gaygon: 'ngắn gọn, dứt khoát',
      noitam: 'nội tâm, sâu sắc',
    };
    try {
      const ai = createGeminiClient('auxiliary');
      const prompt = `
Hãy viết lại đoạn văn sau theo giọng ${toneMap[toneTarget] || toneTarget}.
Giữ nguyên ý chính, không thêm chi tiết mới.
ĐOẠN GỐC:
${trimForAi(toneSource, 6000)}
      `.trim();
      const raw = await generateGeminiText(ai, 'quality', prompt, {
        temperature: 0.65,
        maxOutputTokens: 3200,
        minOutputChars: Math.max(180, Math.round(trimForAi(toneSource, 6000).length * 0.35)),
        maxRetries: 2,
      });
      setToneResult(raw.trim());
    } catch (err) {
      setToneResult(err instanceof Error ? err.message : 'Không chuyển giọng được.');
    } finally {
      setIsRunning(false);
      setStatusText('');
    }
  };

  const runContextQuery = async () => {
    if (!queryContext.trim() || !queryQuestion.trim()) return;
    setIsRunning(true);
    setStatusText('Đang truy vấn bối cảnh...');
    try {
      const ai = createGeminiClient('auxiliary');
      const prompt = `
Trả lời câu hỏi dựa trên bối cảnh sau. Nếu thiếu dữ liệu, nói rõ phần thiếu.
CÂU HỎI: ${queryQuestion.trim()}
BỐI CẢNH:
${trimForAi(queryContext, 7000)}
      `.trim();
      const raw = await generateGeminiText(ai, 'quality', prompt, {
        temperature: 0.3,
        maxOutputTokens: 2200,
        minOutputChars: 220,
        maxRetries: 2,
      });
      setQueryResult(raw.trim());
    } catch (err) {
      setQueryResult(err instanceof Error ? err.message : 'Không truy vấn được.');
    } finally {
      setIsRunning(false);
      setStatusText('');
    }
  };

  const runWikiExtraction = async () => {
    if (!wikiSource.trim()) return;
    setIsRunning(true);
    setStatusText('Đang trích xuất wiki...');
    try {
      const ai = createGeminiClient('auxiliary');
      const prompt = `
Hãy trích xuất dữ liệu wiki từ nội dung sau. Trả về JSON:
{
  "characters": [{"name":"", "description":""}],
  "locations": [{"name":"", "description":""}],
  "items": [{"name":"", "description":""}]
}
NỘI DUNG:
${trimForAi(wikiSource, 9000)}
      `.trim();
      const raw = await generateGeminiText(ai, 'quality', prompt, {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 3200,
        minOutputChars: 260,
        maxRetries: 2,
      });
      const parsed = extractJson(raw);
      setWikiResult({
        characters: normalizeNamedEntries(parsed?.characters),
        locations: normalizeNamedEntries(parsed?.locations),
        items: normalizeNamedEntries(parsed?.items),
      });
      setWikiSavedNotice('');
    } catch (err) {
      setWikiResult({
        characters: [],
        locations: [],
        items: [],
      });
      setWikiSavedNotice(err instanceof Error ? err.message : 'Không trích xuất được.');
    } finally {
      setIsRunning(false);
      setStatusText('');
    }
  };

  const handleSaveWikiCharacters = () => {
    if (!wikiResult) return;
    const existing = storage.getCharacters();
    const existingNames = new Set(existing.map((c: Character) => c.name.toLowerCase()));
    const newChars = wikiResult.characters
      .filter((c) => !existingNames.has(c.name.toLowerCase()))
      .map((c) => ({
        id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        authorId: user.uid,
        name: c.name,
        appearance: c.description || '',
        personality: '',
        createdAt: new Date().toISOString(),
      }));
    if (newChars.length === 0) {
      setWikiSavedNotice('Không có nhân vật mới để lưu.');
      return;
    }
    storage.saveCharacters([...newChars, ...existing]);
    setWikiSavedNotice(`Đã lưu ${newChars.length} nhân vật vào kho nhân vật.`);
  };

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 rounded-2xl">
            <Sparkles className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-xl font-serif font-bold">Writer Pro (Phase 3)</h3>
            <p className="text-xs text-slate-500 font-medium">Co-writer, plot, tone shift, context query, wiki</p>
          </div>
        </div>
        <span className="text-xs text-slate-400">{statusText || 'Chế độ nhanh, phản hồi trong vài giây'}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'autocomplete', label: 'Viết tiếp', icon: Sparkles },
          { key: 'plot', label: 'Plot Generator', icon: Target },
          { key: 'tone', label: 'Đổi giọng', icon: Feather },
          { key: 'context', label: 'Hỏi bối cảnh', icon: Info },
          { key: 'wiki', label: 'Trích xuất Wiki', icon: Database },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all',
              activeTab === key
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/15'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'autocomplete' && (
        <div className="space-y-4">
          <textarea
            value={autoContext}
            onChange={(e) => setAutoContext(e.target.value)}
            placeholder="Dán đoạn truyện hiện tại để AI viết tiếp..."
            className="w-full min-h-[160px] p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-bold text-slate-600">Độ dài:</label>
            {[50, 100, 200].map((len) => (
              <button
                key={len}
                onClick={() => setAutoLength(len)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-bold transition-all',
                  autoLength === len ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600',
                )}
              >
                {len} từ
              </button>
            ))}
            <button
              onClick={runAutocomplete}
              disabled={isRunning}
              className="ml-auto px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-900/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {isRunning ? 'Đang xử lý...' : 'Tạo gợi ý'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {autoVariants.map((variant, idx) => (
              <div key={`${variant.label}-${idx}`} className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">{variant.label}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{variant.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'plot' && (
        <div className="space-y-4">
          <textarea
            value={plotContext}
            onChange={(e) => setPlotContext(e.target.value)}
            placeholder="Tóm tắt nhanh truyện hoặc bối cảnh hiện tại..."
            className="w-full min-h-[140px] p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={runPlot}
            disabled={isRunning}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {isRunning ? 'Đang phân tích...' : 'Tạo hướng plot'}
          </button>
          {plotResult && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Hướng phát triển</p>
                <ul className="text-sm text-slate-700 space-y-1 list-disc pl-4">
                  {plotResult.directions.map((item, idx) => <li key={`dir-${idx}`}>{item}</li>)}
                </ul>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Plot twist</p>
                <ul className="text-sm text-slate-700 space-y-1 list-disc pl-4">
                  {plotResult.twists.map((item, idx) => <li key={`tw-${idx}`}>{item}</li>)}
                </ul>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Rủi ro logic</p>
                <ul className="text-sm text-slate-700 space-y-1 list-disc pl-4">
                  {plotResult.risks.map((item, idx) => <li key={`risk-${idx}`}>{item}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'tone' && (
        <div className="space-y-4">
          <textarea
            value={toneSource}
            onChange={(e) => setToneSource(e.target.value)}
            placeholder="Dán đoạn cần đổi giọng..."
            className="w-full min-h-[140px] p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={toneTarget}
              onChange={(e) => setToneTarget(e.target.value)}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
            >
              <option value="vanhoc">Văn học</option>
              <option value="langman">Lãng mạn</option>
              <option value="gaygon">Gãy gọn</option>
              <option value="noitam">Nội tâm</option>
            </select>
            <button
              onClick={runToneShift}
              disabled={isRunning}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-900/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {isRunning ? 'Đang xử lý...' : 'Chuyển giọng'}
            </button>
          </div>
          {toneResult && (
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-700 whitespace-pre-wrap">
              {toneResult}
            </div>
          )}
        </div>
      )}

      {activeTab === 'context' && (
        <div className="space-y-4">
          <textarea
            value={queryContext}
            onChange={(e) => setQueryContext(e.target.value)}
            placeholder="Dán bối cảnh truyện (có thể là tóm tắt chương gần nhất)..."
            className="w-full min-h-[140px] p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <input
            value={queryQuestion}
            onChange={(e) => setQueryQuestion(e.target.value)}
            placeholder="Câu hỏi về bối cảnh..."
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={runContextQuery}
            disabled={isRunning}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {isRunning ? 'Đang truy vấn...' : 'Trả lời'}
          </button>
          {queryResult && (
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-700 whitespace-pre-wrap">
              {queryResult}
            </div>
          )}
        </div>
      )}

      {activeTab === 'wiki' && (
        <div className="space-y-4">
          <textarea
            value={wikiSource}
            onChange={(e) => setWikiSource(e.target.value)}
            placeholder="Dán nội dung truyện hoặc chương cần trích xuất..."
            className="w-full min-h-[160px] p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={runWikiExtraction}
              disabled={isRunning}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-900/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {isRunning ? 'Đang trích xuất...' : 'Trích xuất'}
            </button>
            {wikiResult && (
              <button
                onClick={handleSaveWikiCharacters}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all"
              >
                Lưu nhân vật vào kho
              </button>
            )}
            {wikiSavedNotice && <span className="text-xs text-slate-500">{wikiSavedNotice}</span>}
          </div>
          {wikiResult && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Nhân vật</p>
                <ul className="text-sm text-slate-700 space-y-1">
                  {wikiResult.characters.map((c, idx) => (
                    <li key={`char-${idx}`}><strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ''}</li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Địa điểm</p>
                <ul className="text-sm text-slate-700 space-y-1">
                  {wikiResult.locations.map((c, idx) => (
                    <li key={`loc-${idx}`}><strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ''}</li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Vật phẩm</p>
                <ul className="text-sm text-slate-700 space-y-1">
                  {wikiResult.items.map((c, idx) => (
                    <li key={`item-${idx}`}><strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ''}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PROMPT_VAULT_PREVIEW = [
  {
    title: 'Dịch truyện mượt, giữ văn phong',
    content: 'Hãy dịch đoạn sau sang tiếng Việt mượt mà, giữ phong cách của bản gốc. Giữ tên riêng và thuật ngữ nhất quán.',
  },
  {
    title: 'Tóm tắt chương nhanh',
    content: 'Tóm tắt nội dung chương dưới đây trong 5-7 gạch đầu dòng, giữ các mốc quan trọng.',
  },
  {
    title: 'Viết tiếp mạch truyện',
    content: 'Viết tiếp đoạn truyện dưới đây khoảng 150-200 từ, giữ đúng giọng văn và mạch sự kiện.',
  },
];

const PromptVaultPanel = () => {
  const [copied, setCopied] = useState('');

  const handleCopy = async (text: string, title: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Đã sao chép: ${title}`);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      setCopied('Không thể sao chép, hãy copy thủ công.');
      window.setTimeout(() => setCopied(''), 2000);
    }
  };

  return (
    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 rounded-2xl">
            <Library className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-xl font-serif font-bold">Kho Prompt mẫu</h3>
            <p className="text-xs text-slate-500">Dùng nhanh cho dịch thuật và viết truyện</p>
          </div>
        </div>
        {copied && <span className="text-xs text-slate-500">{copied}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROMPT_VAULT_PREVIEW.map((item) => (
          <div key={item.title} className="p-4 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
            <div>
              <p className="font-bold text-slate-800">{item.title}</p>
              <p className="text-xs text-slate-500 mt-1 line-clamp-3">{item.content}</p>
            </div>
            <button
              onClick={() => handleCopy(item.content, item.title)}
              className="mt-auto px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all"
            >
              Sao chép prompt
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const ToolsManager = ({
  onBack,
  onRequireAuth,
  profile,
  section = 'tools',
}: {
  onBack: () => void;
  onRequireAuth: () => void;
  profile: UiProfile;
  section?: 'tools' | 'api';
}) => {
  const { user } = useAuth();
  const isApiSection = section === 'api';
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [maskedGeminiKey, setMaskedGeminiKey] = useState('');
  const [apiMode, setApiMode] = useState<ApiMode>('manual');
  const [relayUrl, setRelayUrl] = useState(buildRelaySocketUrl(''));
  const [relayIdentityHint, setRelayIdentityHint] = useState('');
  const [relayMatchedLong, setRelayMatchedLong] = useState('');
  const [relayMaskedToken, setRelayMaskedToken] = useState('Chưa nhận token');
  const [relayStatus, setRelayStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [relayStatusText, setRelayStatusText] = useState('Chưa kết nối');
  const [manualRelayTokenInput, setManualRelayTokenInput] = useState('');
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const [aiCheckStatus, setAiCheckStatus] = useState('Chưa kiểm tra');
  const [aiUsageStats, setAiUsageStats] = useState<{ requests: number; estTokens: number }>({ requests: 0, estTokens: 0 });
  const [quickImportText, setQuickImportText] = useState('');
  const [quickImportResult, setQuickImportResult] = useState('');
  const [aiProfile, setAiProfile] = useState<AiProfileMode>('balanced');
  const [apiVault, setApiVault] = useState<StoredApiKeyRecord[]>([]);
  const [activeApiKeyId, setActiveApiKeyId] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ApiProvider>('gemini');
  const [selectedModel, setSelectedModel] = useState('');
  const [apiEntryName, setApiEntryName] = useState('');
  const [apiEntryText, setApiEntryText] = useState('');
  const [apiEntryProvider, setApiEntryProvider] = useState<ApiProvider>('gemini');
  const [apiEntryModel, setApiEntryModel] = useState(getDefaultModelForProvider('gemini'));
  const [apiEntryBaseUrl, setApiEntryBaseUrl] = useState('');
  const [testingApiId, setTestingApiId] = useState<string | null>(null);
  const [enablePromptCache, setEnablePromptCache] = useState(true);
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(DEFAULT_GENERATION_CONFIG);
  const [imageAiEnabled, setImageAiEnabled] = useState(false);
  const [imageAiApiKey, setImageAiApiKey] = useState('');
  const [imageAiProvider, setImageAiProvider] = useState<ImageAiProvider>('evolink');
  const [imageAiModel, setImageAiModel] = useState(getDefaultImageAiModel('evolink'));
  const relaySocketRef = useRef<WebSocket | null>(null);
  const relayPingRef = useRef<number | null>(null);
  const relayReconnectRef = useRef<number | null>(null);
  const relayShouldReconnectRef = useRef(false);
  const relayRequestReadyRef = useRef(false);
  const refreshAiUsageStats = useCallback(() => {
    const next = readMainAiUsage();
    setAiUsageStats((prev) => (
      prev.requests === next.requests && prev.estTokens === next.estTokens ? prev : next
    ));
  }, []);

  useEffect(() => {
    const runtime = getApiRuntimeConfig();
    if (runtime.mode === 'relay') {
      saveApiRuntimeConfig({
        ...runtime,
        mode: 'manual',
      });
      runtime.mode = 'manual';
    }
    try {
      const rawRuntime = readScopedAppStorage(API_RUNTIME_CONFIG_KEY);
      const parsedRuntime = rawRuntime ? (JSON.parse(rawRuntime) as Partial<ApiRuntimeConfig>) : {};
      const originalRelayUrl = String(parsedRuntime.relayUrl || '').trim();
      if (originalRelayUrl && originalRelayUrl !== runtime.relayUrl) {
        saveApiRuntimeConfig({
          ...runtime,
          relayUrl: runtime.relayUrl,
          identityHint: runtime.identityHint || runtime.relayUrl,
        });
      }
    } catch {
      // Ignore migration write failures and continue with normalized runtime in memory.
    }

    const vault = loadApiVault(runtime.aiProfile);
    const active = vault.find((item) => item.id === runtime.activeApiKeyId) || getActiveApiKeyRecord(vault);
    const current = active?.key?.trim() || '';
    if (current.length > 10) {
      setMaskedGeminiKey(`${current.slice(0, 6)}...${current.slice(-4)}`);
    } else {
      setMaskedGeminiKey(current ? 'Sẵn sàng' : 'Chưa cấu hình');
    }
    setApiVault(vault);
    setApiMode(runtime.mode);
    setRelayUrl(runtime.relayUrl);
    setRelayIdentityHint(runtime.identityHint);
    setRelayMatchedLong(runtime.relayMatchedLong);
    setAiProfile(runtime.aiProfile);
    setSelectedProvider(active?.provider || runtime.selectedProvider || 'gemini');
    setSelectedModel(active?.model || runtime.selectedModel || getDefaultModelForProvider(active?.provider || runtime.selectedProvider || 'gemini', runtime.aiProfile));
    setActiveApiKeyId(active?.id || runtime.activeApiKeyId || '');
    setEnablePromptCache(runtime.enableCache);
    setGenerationConfig(runtime.generation);
    const imageApi = getImageApiConfig();
    setImageAiEnabled(imageApi.enabled);
    setImageAiProvider(imageApi.provider);
    setImageAiModel(imageApi.providers[imageApi.provider]?.model || getDefaultImageAiModel(imageApi.provider));
    setImageAiApiKey(imageApi.providers[imageApi.provider]?.apiKey || '');
    const token = (readScopedAppStorage(RELAY_TOKEN_CACHE_KEY) || runtime.relayToken || '').trim();
    setRelayMaskedToken(token ? maskSensitive(token) : 'Chưa nhận token');
    refreshAiUsageStats();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUsageEvent = () => refreshAiUsageStats();
    const handleStorage = (event: StorageEvent) => {
      const scopedUsageKey = buildScopedStorageKey(MAIN_AI_USAGE_KEY);
      if (!event.key || event.key === MAIN_AI_USAGE_KEY || event.key === scopedUsageKey) {
        refreshAiUsageStats();
      }
    };
    window.addEventListener(MAIN_AI_USAGE_UPDATED_EVENT, handleUsageEvent as EventListener);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleUsageEvent);
    return () => {
      window.removeEventListener(MAIN_AI_USAGE_UPDATED_EVENT, handleUsageEvent as EventListener);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleUsageEvent);
    };
  }, []);

  const detectedDraftProvider = detectApiProviderFromValue(apiEntryText.trim());
  const autoDetectedDraftProvider =
    detectedDraftProvider === 'gemini' ||
    detectedDraftProvider === 'gcli' ||
    detectedDraftProvider === 'anthropic' ||
    detectedDraftProvider === 'groq' ||
    detectedDraftProvider === 'openrouter'
      ? detectedDraftProvider
      : 'unknown';
  const effectiveDraftProvider = autoDetectedDraftProvider !== 'unknown' ? autoDetectedDraftProvider : apiEntryProvider;
  const displayedDraftProvider = effectiveDraftProvider === 'gcli' ? 'gemini' : effectiveDraftProvider;
  const availableDraftModels = effectiveDraftProvider === 'unknown' ? [] : PROVIDER_MODEL_OPTIONS[effectiveDraftProvider];
  const currentApiEntry = apiVault.find((item) => item.id === activeApiKeyId) || getActiveApiKeyRecord(apiVault);

  useEffect(() => {
    if (effectiveDraftProvider === 'unknown') return;
    const providerModels = PROVIDER_MODEL_OPTIONS[effectiveDraftProvider];
    if (!providerModels?.some((item) => item.value === apiEntryModel)) {
      setApiEntryModel(getDefaultModelForProvider(effectiveDraftProvider, aiProfile));
    }
    if (!apiEntryBaseUrl.trim()) {
      setApiEntryBaseUrl(getProviderBaseUrl(effectiveDraftProvider));
    }
  }, [effectiveDraftProvider, aiProfile]);

  useEffect(() => {
    return () => {
      if (relaySocketRef.current) {
        relaySocketRef.current.close();
        relaySocketRef.current = null;
      }
      if (relayPingRef.current) {
        window.clearInterval(relayPingRef.current);
        relayPingRef.current = null;
      }
      if (relayReconnectRef.current) {
        window.clearTimeout(relayReconnectRef.current);
        relayReconnectRef.current = null;
      }
      relayRequestReadyRef.current = false;
      setRelaySender(null);
      notifyRelayDisconnected('Component unmounted');
    };
  }, []);

  const persistRuntimeConfig = (
    next: Partial<ApiRuntimeConfig> & { generation?: Partial<GenerationConfig> | GenerationConfig },
  ) => {
    const current = getApiRuntimeConfig();
    const nextGeneration = next.generation
      ? sanitizeGenerationConfig({ ...current.generation, ...next.generation })
      : current.generation;
    const merged: ApiRuntimeConfig = {
      ...current,
      ...next,
      generation: nextGeneration,
    };
    saveApiRuntimeConfig(merged);
  };

  const handleGenerationConfigPatch = (patch: Partial<GenerationConfig>) => {
    setGenerationConfig((prev) => {
      const nextGeneration = sanitizeGenerationConfig({ ...prev, ...patch });
      persistRuntimeConfig({ generation: nextGeneration });
      return nextGeneration;
    });
  };

  const handleGenerationConfigReset = () => {
    setGenerationConfig(DEFAULT_GENERATION_CONFIG);
    persistRuntimeConfig({ generation: DEFAULT_GENERATION_CONFIG });
    notifyApp({ tone: 'success', message: 'Đã khôi phục cấu hình sinh văn bản về mặc định.' });
  };

  const syncActiveApi = (entry: StoredApiKeyRecord | null, nextMode: ApiMode = apiMode) => {
    const provider = entry?.provider && entry.provider !== 'unknown' ? entry.provider : 'gemini';
    const model = entry?.model || getDefaultModelForProvider(provider, aiProfile);
    setSelectedProvider(provider);
    setSelectedModel(model);
    setActiveApiKeyId(entry?.id || '');
    setMaskedGeminiKey(entry?.key ? maskSensitive(entry.key, 6, 4) : 'Chưa cấu hình');
    persistRuntimeConfig({
      mode: nextMode,
      selectedProvider: provider,
      selectedModel: model,
      activeApiKeyId: entry?.id || '',
      aiProfile,
      enableCache: enablePromptCache,
    });
  };

  const persistApiVault = (nextVault: StoredApiKeyRecord[], nextMode: ApiMode = apiMode) => {
    setApiVault(nextVault);
    saveApiVault(nextVault);
    syncActiveApi(getActiveApiKeyRecord(nextVault), nextMode);
  };

  const buildAiAuthFromEntry = (entry: StoredApiKeyRecord): AiAuth => {
    const provider = entry.provider === 'unknown' ? detectApiProviderFromValue(entry.key) : entry.provider;
    const model = entry.model || getDefaultModelForProvider(provider, aiProfile);
    return {
      provider,
      apiKey: entry.key,
      isApiKey: provider === 'gemini' && /^AIza[0-9A-Za-z\-_]{20,}$/.test(entry.key),
      client: provider === 'gemini' && /^AIza[0-9A-Za-z\-_]{20,}$/.test(entry.key) ? new GoogleGenAI({ apiKey: entry.key }) : undefined,
      model,
      baseUrl: entry.baseUrl || getProviderBaseUrl(provider),
      keyId: entry.id,
    };
  };

  const handleSaveApiEntry = () => {
    const raw = apiEntryText.trim();
    const draftProvider = apiEntryProvider;
    const canSaveWithoutKey = draftProvider === 'custom' || draftProvider === 'ollama';
    if (!raw && !canSaveWithoutKey) return;
    const detected = detectApiProviderFromValue(raw);
    const provider = detected === 'gemini' || detected === 'gcli' || detected === 'anthropic' || detected === 'groq' || detected === 'openrouter'
      ? detected
      : draftProvider;
    const key = provider === 'gcli' ? (extractGcliTokenFromText(raw) || raw.replace(/^Bearer\s+/i, '').trim()) : raw;
    const model = (provider === 'custom' || provider === 'ollama' ? apiEntryModel.trim() : apiEntryModel) || getDefaultModelForProvider(provider, aiProfile);
    const baseUrl = apiEntryBaseUrl.trim() || getProviderBaseUrl(provider);
    const existingMatch = apiVault.find((item) => (
      provider === 'custom' || provider === 'ollama'
        ? item.provider === provider && item.baseUrl.trim() === baseUrl
        : item.key.trim() === key
    ));
    const nextEntry: StoredApiKeyRecord = {
      id: existingMatch?.id || `api-${Date.now()}`,
      name: apiEntryName.trim() || `${PROVIDER_LABELS[provider]} ${apiVault.length + (existingMatch ? 0 : 1)}`,
      key,
      provider,
      model,
      baseUrl,
      isActive: true,
      createdAt: existingMatch?.createdAt || new Date().toISOString(),
      lastTested: existingMatch?.lastTested,
      status: existingMatch?.status || 'idle',
      usage: existingMatch?.usage || { requests: 0, tokens: 0, limit: 1500 },
    };
    const withoutCurrent = apiVault.filter((item) => item.id !== nextEntry.id);
    const nextVault = activateApiKeyRecord([nextEntry, ...withoutCurrent], nextEntry.id);
    setApiMode('manual');
    persistApiVault(nextVault, 'manual');
    setApiEntryText('');
    setApiEntryName('');
    setApiEntryBaseUrl('');
    setApiEntryProvider(provider);
    setApiEntryModel(model);
    setQuickImportResult('API đã được lưu và chọn làm kết nối hiện tại.');
  };

  const handleSaveImageAiConfig = () => {
    const currentConfig = getImageApiConfig();
    const activeProvider = imageAiProvider;
    const nextConfig: ImageApiConfig = {
      ...currentConfig,
      enabled: imageAiEnabled,
      provider: activeProvider,
      size: currentConfig.size,
      providers: {
        ...currentConfig.providers,
        [activeProvider]: {
          ...currentConfig.providers[activeProvider],
          apiKey: imageAiApiKey.trim(),
          model: imageAiModel || getDefaultImageAiModel(activeProvider),
        },
      },
    };
    saveImageApiConfig(nextConfig);
    setImageAiEnabled(nextConfig.enabled);
    setImageAiProvider(activeProvider);
    setImageAiModel(nextConfig.providers[activeProvider]?.model || getDefaultImageAiModel(activeProvider));
    setImageAiApiKey(nextConfig.providers[activeProvider]?.apiKey || '');
    const providerMeta = IMAGE_AI_PROVIDER_META[activeProvider];
    if (nextConfig.enabled && nextConfig.providers[activeProvider]?.apiKey) {
      notifyApp({
        tone: 'success',
        message: `AI Sinh ảnh đã sẵn sàng. Từ giờ nút tạo bìa sẽ ưu tiên gọi ${providerMeta.label}.`,
      });
      return;
    }
    if (nextConfig.enabled) {
      notifyApp({
        tone: 'warn',
        message: `AI Sinh ảnh đã bật nhưng chưa có ${providerMeta.keyLabel}, nên hệ thống sẽ phải dùng đường dự phòng.`,
      });
      return;
    }
    notifyApp({
      tone: 'success',
      message: 'Đã tắt AI Sinh ảnh riêng. TruyenForge sẽ bỏ qua nhánh Evolink khi tạo bìa.',
    });
  };

  const handleDeleteApiEntry = (id: string) => {
    const nextVault = apiVault.filter((item) => item.id !== id);
    persistApiVault(nextVault, apiMode);
  };

  const handleActivateApiEntry = (id: string) => {
    const nextVault = activateApiKeyRecord(apiVault, id);
    setApiMode('manual');
    persistApiVault(nextVault, 'manual');
  };

  const handleApiModelChange = (id: string, model: string) => {
    const nextVault = apiVault.map((item) => item.id === id ? { ...item, model } : item);
    persistApiVault(nextVault, apiMode);
  };

  const handleApiBaseUrlChange = (id: string, baseUrl: string) => {
    const nextVault = apiVault.map((item) => item.id === id ? { ...item, baseUrl } : item);
    setApiVault(nextVault);
    saveApiVault(nextVault);
  };

  const handleTestApiEntry = async (id: string) => {
    const target = apiVault.find((item) => item.id === id);
    if (!target) return;
    setTestingApiId(id);
    const testingVault = apiVault.map((item) => item.id === id ? { ...item, status: 'testing' as const } : item);
    setApiVault(testingVault);
    saveApiVault(testingVault);
    try {
      const text = await generateGeminiText(
        buildAiAuthFromEntry(target),
        'fast',
        'Chỉ trả về đúng một từ OK.',
        { temperature: 0 },
      );
      const nextVault = apiVault.map((item) => item.id === id ? {
        ...item,
        status: String(text || '').toUpperCase().includes('OK') ? 'valid' as const : 'invalid' as const,
        lastTested: new Date().toISOString(),
      } : item);
      persistApiVault(nextVault, apiMode);
    } catch {
      const nextVault = apiVault.map((item) => item.id === id ? {
        ...item,
        status: 'invalid' as const,
        lastTested: new Date().toISOString(),
      } : item);
      persistApiVault(nextVault, apiMode);
    } finally {
      setTestingApiId(null);
    }
  };

  const handleQuickImportKeys = () => {
    const text = quickImportText.trim();
    if (!text) return;
    const keyCandidates = [
      ...(text.match(/AIza[0-9A-Za-z\-_]{20,}/g) || []),
      ...(text.match(/ya29\.[0-9A-Za-z\-_\.]+/g) || []),
      ...(text.match(/sk-ant-[A-Za-z0-9_\-]{20,}/g) || []),
      ...(text.match(/sk-(proj-)?[A-Za-z0-9_\-]{20,}/g) || []),
    ];
    const relayDetectedCode = parseRelayCodeFromText(text);
    const relayDetectedLong = parseLongIdFromText(text);
    let nextVault = [...apiVault];
    let updates = 0;

    keyCandidates.forEach((candidate) => {
      if (nextVault.some((item) => item.key === candidate)) return;
      const provider = detectApiProviderFromValue(candidate);
      const entry: StoredApiKeyRecord = {
        id: `api-${Date.now()}-${updates}`,
        name: `${PROVIDER_LABELS[provider]} import ${nextVault.length + 1}`,
        key: candidate,
        provider,
        model: getDefaultModelForProvider(provider, aiProfile),
        baseUrl: getProviderBaseUrl(provider),
        isActive: updates === 0 && relayDetectedCode === '' && relayDetectedLong === '',
        createdAt: new Date().toISOString(),
        status: 'idle',
        usage: { requests: 0, tokens: 0, limit: 1500 },
      };
      nextVault = [entry, ...nextVault.map((item) => ({ ...item, isActive: false }))];
      updates += 1;
    });

    if (relayDetectedCode || relayDetectedLong) {
      const nextCode = relayDetectedCode || relayDetectedLong;
      const nextRelayUrl = buildRelaySocketUrl(nextCode);
      setRelayUrl(nextRelayUrl);
      setRelayIdentityHint(text);
      persistRuntimeConfig({
        relayUrl: nextRelayUrl,
        identityHint: text,
      });
      updates += 1;
    }

    if (keyCandidates.length > 0) {
      setApiMode('manual');
      persistApiVault(nextVault, 'manual');
    }

    if (updates === 0) {
      setQuickImportResult(`Chưa nhận diện được thông tin phù hợp. Hãy dán API key, mã truy cập Google, địa chỉ máy chủ AI riêng hoặc URL trung chuyển dạng ${RELAY_WEB_BASE}1234.`);
    } else {
      setQuickImportResult(`Đã cập nhật ${updates} mục thông tin.`);
      setQuickImportText('');
    }
  };

  const openWsWithTimeout = (url: string, timeoutMs = 7000): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        try { ws.close(); } catch {}
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onopen = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(ws);
      };

      ws.onerror = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(new Error('websocket error'));
      };

      ws.onclose = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        reject(new Error('closed before open'));
      };
    });

  const buildRelayCandidateUrls = (rawInput: string, code: string): string[] => {
    const candidates = new Set<string>();
    const inferred = ensureRelayClientRole(toWsUrl(rawInput));
    if (inferred) candidates.add(inferred);
    candidates.add(buildRelayConnectUrl(rawInput, code));
    candidates.add(buildRelayConnectUrl(RELAY_SOCKET_BASE, code));
    try {
      const url = new URL(`${RELAY_SOCKET_BASE}${code}`);
      candidates.add(ensureRelayClientRole(`${url.origin}/${code}`));
    } catch {}
    return Array.from(candidates);
  };

  const handleConnectRelay = async (relayCodeOverride?: string) => {
    const baseRelayInput = (relayCodeOverride && /^\d{4,8}$/.test(relayCodeOverride))
      ? buildRelaySocketUrl(relayCodeOverride)
      : relayUrl;
    const inferredCode = (relayCodeOverride && /^\d{4,8}$/.test(relayCodeOverride))
      ? relayCodeOverride
      : parseRelayCodeFromText(baseRelayInput);
    if (!/^\d{4,8}$/.test(inferredCode)) {
      setRelayStatus('error');
      setRelayStatusText(`Vui lòng nhập mã 4-8 số hoặc URL dạng ${RELAY_WEB_BASE}1234.`);
      return;
    }
    const nextRelayUrl = buildRelaySocketUrl(inferredCode);
    const wsCandidates = buildRelayCandidateUrls(baseRelayInput, inferredCode);
    const longFromInput = parseLongIdFromText(baseRelayInput);
    relayShouldReconnectRef.current = true;
    setRelayUrl(nextRelayUrl);

    try {
      if (relaySocketRef.current) {
        relaySocketRef.current.close();
        relaySocketRef.current = null;
      }
      if (relayPingRef.current) {
        window.clearInterval(relayPingRef.current);
        relayPingRef.current = null;
      }
      setRelayStatus('connecting');
      setRelayStatusText(`Đang mở kết nối... (${wsCandidates[0]})`);

      let ws: WebSocket | null = null;
      let connectedUrl = '';
      let lastErr = '';
      for (const candidate of wsCandidates) {
        try {
          ws = await openWsWithTimeout(candidate, 7000);
          connectedUrl = candidate;
          break;
        } catch (error) {
          lastErr = error instanceof Error ? error.message : 'unknown';
        }
      }
      if (!ws) {
        throw new Error(
          `Không mở được websocket. Endpoint có thể chưa hỗ trợ WS handshake (101). ` +
          `Code: ${inferredCode}. Đã thử: ${wsCandidates.join(' | ')}. Lỗi cuối: ${lastErr}`,
        );
      }

      relaySocketRef.current = ws;
      setRelayStatus('connected');
      setRelayStatusText(`Kết nối thành công (${connectedUrl}), đang chờ khóa truy cập...`);
      relayRequestReadyRef.current = true;
      setRelaySender((payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
          return true;
        }
        return false;
      });
    const relayModel = selectedModel || getProfileModel('quality', 'gemini');
    persistRuntimeConfig({
      mode: 'relay',
      relayUrl: nextRelayUrl,
      identityHint: baseRelayInput,
      selectedProvider: 'gemini',
      selectedModel: relayModel,
      activeApiKeyId: '',
      aiProfile,
      enableCache: enablePromptCache,
    });
      ws.send(JSON.stringify({ type: 'subscribe', code: inferredCode, long: longFromInput || inferredCode }));
      ws.send(JSON.stringify({ type: 'auth', code: inferredCode }));
      ws.send(JSON.stringify({ type: 'ping' }));
      relayPingRef.current = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data || '{}'));
          handleRelayMessage(parsed);
        } catch (_) {}

        const payload = extractRelayPayload(String(event.data || ''));
        const expectedLong = parseLongIdFromText(nextRelayUrl);
        const expectedCode = parseRelayCodeFromText(nextRelayUrl);
        const hasPayloadIdentifier = Boolean(payload.codeId || payload.longId);
        const isCodeMatch = expectedCode
          ? (!hasPayloadIdentifier || payload.codeId === expectedCode || payload.longId === expectedCode)
          : true;
        const isLongMatch = expectedLong
          ? (!payload.longId || payload.longId === expectedLong)
          : true;
        const isMatch = isCodeMatch && isLongMatch;

        if (payload.token && isMatch) {
          const token = payload.token.trim();
          if (!token) return;
          writeScopedAppStorage(RELAY_TOKEN_CACHE_KEY, token);
          setRelayMatchedLong(payload.longId || expectedLong);
          setRelayMaskedToken(maskSensitive(token));
          setRelayStatusText(`Đã nhận khóa truy cập (mã: ${payload.codeId || expectedCode || 'n/a'}).`);
          const relayModel = selectedModel || getProfileModel('quality', 'gemini');
          persistRuntimeConfig({
            mode: 'relay',
            relayUrl: buildRelaySocketUrl(expectedCode || inferredCode),
            identityHint: baseRelayInput,
            relayMatchedLong: payload.longId || expectedLong,
            relayToken: token,
            relayUpdatedAt: new Date().toISOString(),
            selectedProvider: 'gemini',
            selectedModel: relayModel,
            activeApiKeyId: '',
            aiProfile,
            enableCache: enablePromptCache,
          });
          return;
        }

        if (expectedCode && payload.codeId && payload.codeId !== expectedCode) {
          setRelayStatusText(`Mã nhận được (${payload.codeId}) chưa trùng với mã bạn đã nhập (${expectedCode}).`);
          return;
        }
        if (expectedLong && payload.longId && payload.longId !== expectedLong) {
          setRelayStatusText(`Đã nhận dữ liệu nhưng chưa khớp phiên hiện tại.`);
        }
      };

      ws.onerror = () => {
        setRelayStatus('error');
        setRelayStatusText('Kết nối tạm thời gián đoạn. Vui lòng thử lại.');
        setRelaySender(null);
      };

      ws.onclose = () => {
        if (relayPingRef.current) {
          window.clearInterval(relayPingRef.current);
          relayPingRef.current = null;
        }
        relayRequestReadyRef.current = false;
        setRelaySender(null);
        notifyRelayDisconnected('Relay socket closed');
        if (relayShouldReconnectRef.current) {
          setRelayStatus('connecting');
          setRelayStatusText('Kết nối relay bị đóng, đang nghe lại để chờ token...');
          if (relayReconnectRef.current) {
            window.clearTimeout(relayReconnectRef.current);
          }
          relayReconnectRef.current = window.setTimeout(() => {
            void handleConnectRelay();
          }, 800);
          return;
        }
        setRelayStatus('disconnected');
        setRelayStatusText('Ngắt kết nối');
      };
    } catch (error) {
      setRelayStatus('error');
      setRelayStatusText(`Chưa thể kết nối lúc này: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`);
    }
  };

  const handleDisconnectRelay = () => {
    relayShouldReconnectRef.current = false;
    if (relayReconnectRef.current) {
      window.clearTimeout(relayReconnectRef.current);
      relayReconnectRef.current = null;
    }
    if (relayPingRef.current) {
      window.clearInterval(relayPingRef.current);
      relayPingRef.current = null;
    }
    if (relaySocketRef.current) {
      relaySocketRef.current.close();
      relaySocketRef.current = null;
    }
    relayRequestReadyRef.current = false;
    setRelaySender(null);
    notifyRelayDisconnected('Người dùng ngắt kết nối relay');
    setRelayStatus('disconnected');
    setRelayStatusText('Ngắt kết nối');
  };

  const handleSaveManualRelayToken = () => {
    const token = extractGeminiKeyFromText(manualRelayTokenInput.trim()) || manualRelayTokenInput.trim();
    if (!token) {
      setRelayStatusText('Bạn chưa dán khóa truy cập. Vui lòng thử lại.');
      return;
    }
    if (!/^AIza[0-9A-Za-z\-_]{20,}$/.test(token)) {
      setRelayStatusText('Khóa truy cập chưa đúng định dạng.');
      return;
    }
    writeScopedAppStorage(RELAY_TOKEN_CACHE_KEY, token);
    setRelayMaskedToken(maskSensitive(token));
    setManualRelayTokenInput('');
    setRelayStatus('connected');
    setRelayStatusText('Khóa thủ công đã được lưu.');
    const relayModel = selectedModel || getProfileModel('quality', 'gemini');
    persistRuntimeConfig({
      mode: 'relay',
      relayUrl,
      relayToken: token,
      relayUpdatedAt: new Date().toISOString(),
      selectedProvider: 'gemini',
      selectedModel: relayModel,
      activeApiKeyId: '',
      aiProfile,
      enableCache: enablePromptCache,
    });
  };

  const handleCheckAiHealth = async () => {
    setIsCheckingAi(true);
    setAiCheckStatus('Đang kiểm tra...');
    try {
      if (apiMode === 'relay' && relayStatus !== 'connected') {
        setAiCheckStatus(`Relay chưa sẵn sàng: ${relayStatusText || 'Vui lòng kết nối lại.'}`);
        return;
      }
      const ai = createGeminiClient();
      const runtime = getApiRuntimeConfig();
      const providerLabel = runtime.mode === 'relay' ? 'Relay' : PROVIDER_LABELS[ai.provider];
      const tests: Array<{
        name: string;
        run: () => Promise<boolean>;
      }> = [
        {
          name: 'Ping',
          run: async () => {
            const result = await generateGeminiText(
              ai,
              'fast',
              'Chỉ trả về đúng một từ OK (chữ hoa), không thêm ký tự khác.',
              { temperature: 0, responseMimeType: 'text/plain', maxOutputTokens: 32 },
            );
            return String(result || '').trim().toUpperCase().includes('OK');
          },
        },
        {
          name: 'JSON Story',
          run: async () => {
            const result = await generateGeminiText(
              ai,
              'fast',
              'Trả về JSON: { "title": "Tiêu đề ngắn", "content": "Nội dung 1-2 câu." }',
              { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 128 },
            );
            const parsed = tryParseJson<any>(result || '', 'object');
            return Boolean(parsed && parsed.title && parsed.content);
          },
        },
        {
          name: 'Outline',
          run: async () => {
            const result = await generateGeminiText(
              ai,
              'fast',
              'Trả về JSON array: [ { "title": "Chương 1", "content": "Tóm tắt 1 câu." } ]',
              { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 128 },
            );
            const parsed = tryParseJson<any>(result || '', 'array');
            return Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.content;
          },
        },
        {
          name: 'Dịch nhanh',
          run: async () => {
            const result = await generateGeminiText(
              ai,
              'fast',
              'Dịch câu sau sang tiếng Việt ngắn gọn: "The sun rises over the quiet lake."',
              { temperature: 0.3, responseMimeType: 'text/plain', maxOutputTokens: 64 },
            );
            return String(result || '').trim().length > 0;
          },
        },
      ];

      const results: Array<{ name: string; ok: boolean }> = [];
      let failedReason = '';
      let failedAt = '';
      for (const test of tests) {
        try {
          const ok = await test.run();
          results.push({ name: test.name, ok });
          if (!ok) {
            failedAt = test.name;
            break;
          }
        } catch (err) {
          results.push({ name: test.name, ok: false });
          failedAt = test.name;
          failedReason = err instanceof Error ? err.message : 'Lỗi không xác định';
          break;
        }
      }

      const passed = results.filter(r => r.ok);
      refreshAiUsageStats();
      if (failedAt) {
        const reasonText = failedReason ? ` (${failedReason})` : '';
        setAiCheckStatus(`Dừng ở bước ${failedAt}${reasonText} · ${providerLabel} / ${ai.model}`);
      } else {
        setAiCheckStatus(`Hoạt động tốt: ${passed.length}/${tests.length} bước đạt · ${providerLabel} / ${ai.model}`);
      }
    } catch (error) {
      setAiCheckStatus(`Không dùng được AI: ${error instanceof Error ? error.message : 'quota, model hoặc key hiện tại chưa hợp lệ.'}`);
    } finally {
      setIsCheckingAi(false);
    }
  };

  const parseQaJson = (text: string): QaIssue[] => {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.issues;
      if (!Array.isArray(list)) return [];
      return list
        .map((item, idx) => ({
          id: `qa-${Date.now()}-${idx}`,
          severity: (String(item.severity || 'medium').toLowerCase() as QaIssue['severity']) || 'medium',
          problem: String(item.problem || item.title || item.issue || '').trim(),
          suggestion: String(item.suggestion || item.fix || item.rewrite || '').trim(),
          quote: String(item.quote || item.span || item.text || '').trim(),
        }))
        .filter((i) => i.problem || i.suggestion);
    } catch {
      return [];
    }
  };

  const parseQaBullets = (text: string): QaIssue[] => {
    const lines = text.split('\n').filter((l) => l.trim().startsWith('-'));
    return lines.map((line, idx) => {
      const clean = line.replace(/^-+\s*/, '');
      return {
        id: `qa-${Date.now()}-${idx}`,
        severity: clean.toLowerCase().includes('high') ? 'high' : clean.toLowerCase().includes('low') ? 'low' : 'medium',
        problem: clean,
        suggestion: '',
        quote: '',
      };
    });
  };

  const handleRunQa = useCallback(async (inputText: string): Promise<QaIssue[]> => {
    const text = inputText.trim();
    if (!text) throw new Error('Bạn chưa dán nội dung cần quét.');
    const ai = createGeminiClient('auxiliary');
    const prompt = [
      'You are a Vietnamese proofreading assistant. Analyze the text and return JSON with issues.',
      'Return strictly JSON array named "issues" or plain array. Each item fields:',
      '{ severity: "low|medium|high", problem: string, suggestion: string, quote: string }',
      'Focus on: chính tả, ngữ pháp, từ lặp, câu khó đọc, xưng hô không phù hợp, vi phạm glossary nếu thấy.',
      'Nếu không có lỗi, trả []',
      'Text:',
      text,
    ].join('\n');
    const result = await generateGeminiText(ai, 'fast', prompt, {
      temperature: 0.2,
      responseMimeType: 'application/json',
    });
    const parsed = parseQaJson(result).length ? parseQaJson(result) : parseQaBullets(result);
    if (user?.uid) {
      try {
        await saveQaReport(user.uid, {
          textPreview: text.slice(0, 500),
          issueCount: parsed.length,
          issues: parsed,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Lưu QA report lên Supabase thất bại', err);
      }
    }
    return parsed;
  }, []);

  const handleResetAiUsage = () => {
    writeMainAiUsage({ requests: 0, estTokens: 0 });
    refreshAiUsageStats();
    setAiCheckStatus('Thống kê phiên đã được đặt lại.');
  };

  const handleRelayModelChange = (value: string) => {
    const nextModel = value || getProfileModel('quality', 'gemini');
    setSelectedModel(nextModel);
    persistRuntimeConfig({
      selectedModel: nextModel,
      selectedProvider: 'gemini',
    });
  };

  const handleExportJSON = async () => {
    if (!user) return;
    setIsExporting(true);
    try {
      const data = {
        exportDate: new Date().toISOString(),
        stories: storage.getStories().filter((story: Story) => story.authorId === user.uid),
        characters: storage.getCharacters().filter((character: Character) => character.authorId === user.uid),
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `truyenforge-backup-${new Date().getTime()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error);
      notifyApp({ tone: 'error', message: "Xuất dữ liệu thất bại." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    console.log("Bắt đầu nhập file:", file.name, file.type, file.size);
    console.log("Sẵn sàng trích xuất DOCX theo cơ chế tải động.");
    setIsImporting(true);
    const fileName = file.name.toLowerCase();

    try {
      if (fileName.endsWith('.json')) {
        console.log("Xử lý file JSON...");
        if (file.size > STORY_IMPORT_MAX_FILE_BYTES) {
          throw new Error(`File JSON quá lớn (${Math.round(file.size / 1024 / 1024)}MB). Vui lòng chia nhỏ file trước khi nhập.`);
        }
        const text = await file.text();
        const parsedPayload = parseJsonImportPayload(text);

        if (window.confirm(`Bạn có muốn nhập ${parsedPayload.stories.length} truyện và ${parsedPayload.characters.length} nhân vật?`)) {
          const existingStories = storage.getStories();
          const newStories = buildImportedStoriesFromJson({
            stories: parsedPayload.stories,
            authorId: user.uid,
            existingStories,
          });
          if (newStories.length > 0) {
            saveStoriesAndRefresh([...newStories, ...existingStories]);
          }

          const newChars = buildImportedCharactersFromJson({
            characters: parsedPayload.characters,
            authorId: user.uid,
          });
          if (newChars.length > 0) {
            const chars = storage.getCharacters();
            storage.saveCharacters([...newChars, ...chars]);
          }
          notifyApp({
            tone: 'success',
            message: "Nhập dữ liệu thành công!",
            detail: parsedPayload.droppedStories || parsedPayload.droppedCharacters
              ? `Đã giới hạn import: bỏ qua ${parsedPayload.droppedStories} truyện và ${parsedPayload.droppedCharacters} nhân vật vượt mức.`
              : undefined,
          });
        }
      } else if (fileName.endsWith('.docx')) {
        console.log("Xử lý file DOCX...");
        const arrayBuffer = await file.arrayBuffer();
        console.log("Đã đọc arrayBuffer, đang giải nén văn bản...");
        const text = await extractDocxText(arrayBuffer);
        console.log("Đã giải nén văn bản, độ dài:", text.length);
        
        if (!text.trim()) {
          throw new Error("File .docx không có nội dung văn bản.");
        }

        const stories = storage.getStories();
        const metadata = await resolveImportedStoryMetadata(file.name, /\.docx$/i);
        const importedStory = buildImportedTextStory({
          fileName: file.name,
          extensionPattern: /\.docx$/i,
          text,
          authorId: user.uid,
          existingStories: stories,
          metadata,
        });
        saveStoriesAndRefresh([importedStory, ...stories]);
        notifyApp({
          tone: 'success',
          message: "Nhập file .docx thành công!",
          detail: metadata.source === 'google-books'
            ? `Đã chuẩn hóa: ${metadata.title} • ${metadata.author || 'Tác giả chưa rõ'}`
            : undefined,
        });
      } else if (fileName.endsWith('.txt')) {
        console.log("Xử lý file TXT...");
        const text = await file.text();
        if (!text.trim()) {
          throw new Error("File .txt không có nội dung.");
        }
        const stories = storage.getStories();
        const metadata = await resolveImportedStoryMetadata(file.name, /\.txt$/i);
        const importedStory = buildImportedTextStory({
          fileName: file.name,
          extensionPattern: /\.txt$/i,
          text,
          authorId: user.uid,
          existingStories: stories,
          metadata,
        });
        saveStoriesAndRefresh([importedStory, ...stories]);
        notifyApp({
          tone: 'success',
          message: "Nhập file .txt thành công!",
          detail: metadata.source === 'google-books'
            ? `Đã chuẩn hóa: ${metadata.title} • ${metadata.author || 'Tác giả chưa rõ'}`
            : undefined,
        });
      } else {
        console.warn("Định dạng file không được hỗ trợ:", fileName);
        notifyApp({ tone: 'warn', message: "Định dạng file không được hỗ trợ." });
      }
    } catch (error) {
      console.error("Lỗi khi nhập file:", error);
      notifyApp({ tone: 'error', message: `Nhập file thất bại: ${error instanceof Error ? error.message : "Lỗi không xác định"}` });
    } finally {
      setIsImporting(false);
      e.target.value = '';
      console.log("Kết thúc xử lý nhập file.");
    }
  };

  if (!user && !isApiSection) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-4xl mx-auto pt-24 pb-12 px-6"
      >
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 transition-colors"><ChevronLeft /></button>
          <h2 className="text-3xl font-serif font-bold">Công cụ & Thiết lập</h2>
        </div>
        <div className="tf-card p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-200">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">Yêu cầu đăng nhập</h3>
              <p className="tf-body">Đăng nhập để dùng Công cụ.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <button 
              onClick={onRequireAuth}
              className="tf-btn tf-btn-primary"
            >
              Đăng nhập
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (isApiSection) {
    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
        <React.Suspense fallback={<div className="tf-card p-6 text-sm text-slate-300">Đang tải khu API...</div>}>
          <ApiSectionPanel
            onBack={onBack}
            apiMode={apiMode}
            currentProviderLabel={apiMode === 'relay' ? 'Trạm trung chuyển' : PROVIDER_LABELS[currentApiEntry?.provider || selectedProvider || 'gemini']}
            currentModelLabel={apiMode === 'relay' ? (selectedModel || getProfileModel('quality', 'gemini')) : (currentApiEntry?.model || selectedModel || 'Chưa chọn')}
            vaultCount={apiVault.length}
            currentStatusLabel={apiMode === 'relay' ? relayStatusText : (currentApiEntry ? currentApiEntry.name : 'Chưa cấu hình')}
            onSwitchToDirect={() => {
              setApiMode('manual');
              persistRuntimeConfig({ mode: 'manual' });
            }}
            onSwitchToRelay={() => {
              setApiMode('relay');
              persistRuntimeConfig({ mode: 'relay', selectedProvider: 'gemini', selectedModel: selectedModel || getProfileModel('quality', 'gemini') });
            }}
            apiEntryName={apiEntryName}
            apiEntryText={apiEntryText}
            displayedDraftProvider={displayedDraftProvider}
            effectiveDraftProvider={effectiveDraftProvider}
            availableDraftModels={availableDraftModels}
            apiEntryModel={apiEntryModel}
            apiEntryBaseUrl={apiEntryBaseUrl}
            aiProfile={aiProfile}
            apiVault={apiVault}
            currentApiEntry={currentApiEntry}
            testingApiId={testingApiId}
            relayStatus={relayStatus}
            relayStatusText={relayStatusText}
            relayUrl={relayUrl}
            relayMatchedLong={relayMatchedLong}
            relayMaskedToken={relayMaskedToken}
            relayModel={selectedModel || getProfileModel('quality', 'gemini')}
            relayModelOptions={PROVIDER_MODEL_OPTIONS.gemini}
            relayWebBase={RELAY_WEB_BASE}
            relaySocketBase={RELAY_SOCKET_BASE}
            manualRelayTokenInput={manualRelayTokenInput}
            isCheckingAi={isCheckingAi}
            aiCheckStatus={aiCheckStatus}
            aiUsageRequests={aiUsageStats.requests}
            aiUsageTokens={aiUsageStats.estTokens}
            quickImportText={quickImportText}
            quickImportResult={quickImportResult}
            generationConfig={generationConfig}
            imageAiEnabled={imageAiEnabled}
            imageAiApiKey={imageAiApiKey}
            imageAiProvider={imageAiProvider}
            imageAiModel={imageAiModel}
            imageAiStatusLabel={
              imageAiEnabled
                ? (imageAiApiKey.trim()
                  ? `Đang bật và sẽ ưu tiên dùng ${IMAGE_AI_PROVIDER_META[imageAiProvider].label} cho tạo ảnh bìa.`
                  : 'Đang bật nhưng chưa có API key, nên vẫn sẽ rơi xuống nhánh dự phòng.')
                : 'Đang tắt. TruyenForge sẽ bỏ qua nhánh AI sinh ảnh riêng khi tạo bìa.'
            }
            onApiEntryNameChange={setApiEntryName}
            onApiEntryTextChange={setApiEntryText}
            onApiEntryProviderChange={setApiEntryProvider}
            onApiEntryModelChange={setApiEntryModel}
            onApiEntryBaseUrlChange={setApiEntryBaseUrl}
            onImageAiEnabledChange={setImageAiEnabled}
            onImageAiApiKeyChange={setImageAiApiKey}
            onImageAiProviderChange={(value) => {
              const nextConfig = getImageApiConfig();
              setImageAiProvider(value);
              setImageAiModel(nextConfig.providers[value]?.model || getDefaultImageAiModel(value));
              setImageAiApiKey(nextConfig.providers[value]?.apiKey || '');
            }}
            onImageAiModelChange={setImageAiModel}
            onSaveImageAiConfig={handleSaveImageAiConfig}
            onSaveApiEntry={handleSaveApiEntry}
            onTestApiEntry={handleTestApiEntry}
            onActivateApiEntry={handleActivateApiEntry}
            onDeleteApiEntry={handleDeleteApiEntry}
            onStoredApiModelChange={handleApiModelChange}
            onStoredApiBaseUrlChange={handleApiBaseUrlChange}
            onConnectRelay={handleConnectRelay}
            onDisconnectRelay={handleDisconnectRelay}
            onRelayUrlChange={(value) => {
              setRelayUrl(value);
              setRelayIdentityHint(value);
              persistRuntimeConfig({ relayUrl: value, identityHint: value, selectedProvider: 'gemini', selectedModel: selectedModel || getProfileModel('quality', 'gemini') });
            }}
            onRelayModelChange={handleRelayModelChange}
            onManualRelayTokenInputChange={setManualRelayTokenInput}
            onSaveManualRelayToken={handleSaveManualRelayToken}
            onCheckAiHealth={handleCheckAiHealth}
            onResetAiUsage={handleResetAiUsage}
            onQuickImportTextChange={setQuickImportText}
            onQuickImportKeys={handleQuickImportKeys}
            onAiProfileChange={(next) => {
              setAiProfile(next);
              persistRuntimeConfig({ aiProfile: next });
            }}
            onGenerationConfigPatch={handleGenerationConfigPatch}
            onGenerationConfigReset={handleGenerationConfigReset}
          />
        </React.Suspense>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="max-w-5xl mx-auto pt-24 pb-12 px-6"
    >
      <React.Suspense fallback={<div className="tf-card p-6 text-sm text-slate-300">Đang tải Công cụ...</div>}>
        <ToolsPage onBack={onBack} onRequireAuth={onRequireAuth} />
      </React.Suspense>
    </motion.div>
  );
};

const AIRulesManager = () => {
  const { user } = useAuth();
  const [rules, setRules] = useState<AIRule[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [viewingRule, setViewingRule] = useState<AIRule | null>(null);

  useEffect(() => {
    setRules(storage.getAIRules());
  }, []);

  const handleAdd = async () => {
    if (!user || !newName || !newContent) return;
    const newRule: AIRule = {
      id: `rule-${Date.now()}`,
      authorId: user.uid,
      name: newName,
      content: newContent,
      createdAt: new Date().toISOString()
    };
    const newList = [newRule, ...rules];
    setRules(newList);
    storage.saveAIRules(newList);
    setNewName('');
    setNewContent('');
    setIsAdding(false);
    notifyApp({ tone: 'success', message: 'Thêm quy tắc AI thành công!' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa quy tắc này?')) return;
    const newList = rules.filter(r => r.id !== id);
    setRules(newList);
    storage.saveAIRules(newList);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-xl">
            <Shield className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-xl font-serif font-bold">Hệ thống quy tắc AI</h3>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all"
        >
          {isAdding ? 'Hủy' : <><Plus className="w-4 h-4" /> Thêm quy tắc</>}
        </button>
      </div>

      {isAdding && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4"
        >
          <input 
            type="text" 
            placeholder="Tên quy tắc (ví dụ: Quy tắc viết H, Quy tắc miêu tả nội tâm...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
          />
          <textarea 
            placeholder="Nội dung quy tắc chi tiết cho AI..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="w-full h-40 px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <button 
            onClick={handleAdd}
            disabled={!newName || !newContent}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-lg shadow-indigo-900/20"
          >
            Lưu quy tắc
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rules.map((rule) => (
          <div 
            key={rule.id}
            className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-200 transition-all group"
          >
            <div className="flex justify-between items-start mb-3">
              <h4 className="font-bold text-slate-800">{rule.name}</h4>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setViewingRule(rule)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDelete(rule.id)}
                  className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-500 line-clamp-2">{rule.content}</p>
          </div>
        ))}
      </div>

      {viewingRule && (
        <div className="fixed inset-0 z-[200] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="tf-modal-panel bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-serif font-bold tf-break-long pr-3">{viewingRule.name}</h3>
              <button onClick={() => setViewingRule(null)} className="p-2 hover:bg-white rounded-full shadow-sm">
                <Plus className="w-6 h-6 rotate-45 text-slate-400" />
              </button>
            </div>
            <div className="tf-modal-content p-6 md:p-8 overflow-y-auto">
              <div className="markdown-body text-slate-600 leading-relaxed whitespace-pre-wrap tf-break-long">
                {viewingRule.content}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const StyleReferenceLibrary = ({ 
  onSelect, 
  onClose 
}: { 
  onSelect?: (content: string) => void, 
  onClose?: () => void 
}) => {
  const { user } = useAuth();
  const [references, setReferences] = useState<StyleReference[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [viewingRef, setViewingRef] = useState<StyleReference | null>(null);

  useEffect(() => {
    setReferences(storage.getStyleReferences());
  }, []);

  const handleAdd = async () => {
    if (!user || !newName || !newContent) return;
    const newRef: StyleReference = {
      id: `style-${Date.now()}`,
      authorId: user.uid,
      name: newName,
      content: newContent,
      createdAt: new Date().toISOString()
    };
    const newList = [newRef, ...references];
    setReferences(newList);
    storage.saveStyleReferences(newList);
    setNewName('');
    setNewContent('');
    setIsAdding(false);
    notifyApp({ tone: 'success', message: 'Thêm văn mẫu thành công!' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa văn mẫu này?')) return;
    const newList = references.filter(r => r.id !== id);
    setReferences(newList);
    storage.saveStyleReferences(newList);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtracting(true);
    try {
      let content = '';
      if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        content = await extractDocxText(arrayBuffer);
      } else {
        content = await file.text();
      }
      setNewContent(content);
      if (!newName) setNewName(file.name.replace(/\.[^/.]+$/, ""));
    } catch (error) {
      notifyApp({ tone: 'error', message: 'Lỗi khi đọc file: ' + error });
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-serif font-bold">Kho văn mẫu tham khảo</h3>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all"
        >
          {isAdding ? 'Hủy' : <><Plus className="w-4 h-4" /> Thêm mới</>}
        </button>
      </div>

      {isAdding && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4"
        >
          <input 
            type="text" 
            placeholder="Tên văn mẫu (ví dụ: Phong cách Kim Dung...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-indigo-500"
          />
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-400 uppercase">Nội dung văn mẫu</label>
              <label className="text-xs font-bold text-indigo-600 cursor-pointer hover:underline">
                {isExtracting ? 'Đang trích xuất...' : 'Tải file (.docx, .txt)'}
                <input type="file" accept=".docx,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            <textarea 
              placeholder="Dán nội dung văn mẫu vào đây..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full h-40 px-4 py-2 rounded-xl border border-slate-200 focus:ring-indigo-500 resize-none"
            />
          </div>
          <button 
            onClick={handleAdd}
            disabled={!newName || !newContent}
            className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            Lưu vào kho
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {references.length === 0 ? (
          <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-100 rounded-3xl">
            Chưa có văn mẫu nào trong kho.
          </div>
        ) : (
          references.map(ref => (
            <div key={ref.id} className="p-4 bg-white border border-slate-100 rounded-2xl flex justify-between items-center group hover:border-indigo-200 transition-all">
              <div className="flex-grow">
                <h4 className="font-bold text-slate-800">{ref.name}</h4>
                <p className="text-xs text-slate-400 line-clamp-1">{ref.content}</p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setViewingRef(ref)}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-50 text-slate-500 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-all"
                >
                  <Eye className="w-3 h-3" />
                  Xem
                </button>
                {onSelect && (
                  <button 
                    onClick={() => onSelect(ref.content)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100"
                  >
                    Sử dụng
                  </button>
                )}
                <button 
                  onClick={() => handleDelete(ref.id)}
                  className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {viewingRef && (
        <div className="fixed inset-0 z-[250] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="tf-modal-panel bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-xl font-serif font-bold tf-break-long pr-3">{viewingRef.name}</h3>
              <button onClick={() => setViewingRef(null)} className="p-2 hover:bg-white rounded-full">
                <Plus className="w-6 h-6 rotate-45 text-slate-400" />
              </button>
            </div>
            <div className="tf-modal-content p-6 md:p-8 overflow-y-auto whitespace-pre-wrap text-slate-600 text-sm leading-relaxed tf-break-long">
              {viewingRef.content}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const StoryEditor = ({ story, onSave, onCancel }: { story?: Story, onSave: (data: Partial<Story>) => void, onCancel: () => void }) => {
  const parsedStoryMeta = parseStoryGenreAndPrompt(story?.genre || '', story?.storyPromptNotes || '');
  const [title, setTitle] = useState(story?.title || '');
  const [genre, setGenre] = useState(parsedStoryMeta.genreLabel || '');
  const [introduction, setIntroduction] = useState(story?.introduction || '');
  const [content, setContent] = useState(story?.content || '');
  const [coverImageUrl, setCoverImageUrl] = useState(story?.coverImageUrl || '');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [storyPromptNotes, setStoryPromptNotes] = useState(parsedStoryMeta.promptNotes || '');
  const [characterRoster, setCharacterRoster] = useState<StoryCharacterProfile[]>(normalizeCharacterRosterRows(story?.characterRoster || []));
  const [expectedChapters, setExpectedChapters] = useState(story?.expectedChapters || 0);
  const [expectedWordCount, setExpectedWordCount] = useState(story?.expectedWordCount || 0);
  const [isPublic, setIsPublic] = useState(story?.isPublic ?? false);
  const [isAdult, setIsAdult] = useState(story?.isAdult ?? false);
  const [preview, setPreview] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [isAnalyzingCharacters, setIsAnalyzingCharacters] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const imageProviderWarnRef = useRef<{ lastAt: number; signature: string }>({ lastAt: 0, signature: '' });

  const buildCoverPrompt = () => {
    const intro = String(introduction || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const palette = getCoverGenrePalette(genre);
    const promptParts = [
      title ? `book cover for "${title}"` : 'fantasy novel book cover',
      genre ? `genre ${genre}` : 'literary fiction',
      palette.mood,
      intro ? `story premise: ${intro}` : '',
      'single focal subject, elegant composition, premium illustration, cinematic lighting, high detail, vertical book cover, no text, no watermark, no logo',
    ];
    return promptParts.filter(Boolean).join(', ');
  };

  const shouldNotifyImageWarning = (signature: string): boolean => {
    const now = Date.now();
    const shouldNotify = now - imageProviderWarnRef.current.lastAt > IMAGE_PROVIDER_WARNING_COOLDOWN_MS
      || imageProviderWarnRef.current.signature !== signature;
    if (shouldNotify) {
      imageProviderWarnRef.current = { lastAt: now, signature };
    }
    return shouldNotify;
  };

  const resolveCoverPrompt = async (): Promise<string> => {
    const typedPrompt = sanitizePromptForUrl(String(coverPrompt || '').trim());
    if (typedPrompt) return typedPrompt;

    const basePrompt = sanitizePromptForUrl(buildCoverPrompt());
    let ai: AiAuth | null = null;
    try {
      ai = createGeminiClient('auxiliary');
    } catch {
      ai = null;
    }
    if (!ai) return basePrompt;

    try {
      const generatedPrompt = await generateGeminiText(
        ai,
        'fast',
        [
          'Write one concise English prompt for an AI book cover generator.',
          'Keep it under 220 characters, no markdown, no quotes.',
          'Must describe visual subject, mood, genre cues, and composition.',
          'Always include: vertical book cover, no text, no watermark.',
          `Title: ${title}`,
          `Genre: ${genre || 'literary fiction'}`,
          `Introduction: ${String(introduction || '').slice(0, 500)}`,
        ].join('\n'),
        {
          responseMimeType: 'text/plain',
          temperature: 0.6,
          maxOutputTokens: 120,
          minOutputChars: 70,
          maxRetries: 1,
        },
      );
      return sanitizePromptForUrl(generatedPrompt) || basePrompt;
    } catch (error) {
      console.warn('Không tạo được prompt ảnh bìa bằng AI, chuyển sang prompt nội suy.', error);
      return basePrompt;
    }
  };

  const generateCoverFromConfiguredProviders = async (prompt: string): Promise<{ imageUrl: string; providerErrors: string[] }> => {
    const imageConfig = getImageApiConfig();
    const providerErrors: string[] = [];
    let imageUrl = '';

    const tryImageProvider = async (provider: ImageAiProvider): Promise<string> => {
      const providerConfig = imageConfig.providers[provider];
      const apiKey = String(providerConfig?.apiKey || '').trim();
      if (!apiKey) return '';
      if (provider === 'evolink') {
        return generateRaphaelCoverImage(prompt, imageConfig);
      }
      if (provider === 'openai') {
        return generateOpenAiCoverImage({
          prompt,
          apiKey,
          model: providerConfig.model,
          sizeHint: imageConfig.size,
        });
      }
      if (provider === 'fal') {
        return generateFalCoverImage({
          prompt,
          apiKey,
          model: providerConfig.model,
          sizeHint: imageConfig.size,
        });
      }
      return generateBflCoverImage({
        prompt,
        apiKey,
        model: providerConfig.model,
        sizeHint: imageConfig.size,
      });
    };

    if (imageConfig.enabled) {
      const providerOrder: ImageAiProvider[] = [
        imageConfig.provider,
        ...(['evolink', 'openai', 'fal', 'bfl'] as ImageAiProvider[]).filter(
          (provider) => provider !== imageConfig.provider && Boolean(imageConfig.providers[provider]?.apiKey?.trim()),
        ),
      ];
      const dedupedOrder = Array.from(new Set(providerOrder));
      for (const provider of dedupedOrder) {
        if (imageUrl) break;
        try {
          imageUrl = await tryImageProvider(provider);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || '');
          providerErrors.push(`${IMAGE_AI_PROVIDER_META[provider].label}: ${message}`);
          console.warn(`Image provider ${provider} failed`, error);
        }
      }
    }

    return { imageUrl, providerErrors };
  };

  const handlePickCoverFile = () => {
    coverInputRef.current?.click();
  };

  const handleCoverFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notifyApp({ tone: 'warn', message: 'Chỉ hỗ trợ file ảnh (png, jpg, webp...).' });
      event.target.value = '';
      return;
    }
    const maxSize = 3 * 1024 * 1024;
    if (file.size > maxSize) {
      notifyApp({ tone: 'warn', message: 'Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 3MB.' });
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '').trim();
      if (!value) {
        notifyApp({ tone: 'error', message: 'Không đọc được file ảnh.' });
        return;
      }
      setCoverImageUrl(value);
    };
    reader.onerror = () => {
      notifyApp({ tone: 'error', message: 'Đọc file ảnh thất bại.' });
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleGenerateCover = async () => {
    if (!title.trim()) {
      notifyApp({ tone: 'warn', message: 'Hãy nhập tiêu đề truyện trước khi tạo ảnh bìa.' });
      return;
    }
    setIsGeneratingCover(true);
    try {
      const prompt = await resolveCoverPrompt();
      if (!prompt) {
        notifyApp({ tone: 'warn', message: 'Không đủ dữ liệu để tạo ảnh bìa.' });
        return;
      }
      const { imageUrl, providerErrors: imageProviderErrors } = await generateCoverFromConfiguredProviders(prompt);

      if (!imageUrl && imageProviderErrors.length > 0) {
        const signature = imageProviderErrors.slice(0, 2).join('|');
        if (shouldNotifyImageWarning(signature)) {
          notifyApp({
            tone: 'warn',
            message: 'Các nhà cung cấp AI sinh ảnh cấu hình trong app đều chưa trả kết quả.',
            detail: imageProviderErrors.slice(0, 2).join(' · '),
            timeoutMs: 5200,
            groupKey: 'image-provider-fallback',
          });
        }
      }

      if (!imageUrl) {
        const fallbackCover = buildFallbackCoverDataUrl(title, genre, prompt);
        setCoverImageUrl(fallbackCover);
        if (!coverPrompt.trim()) {
          setCoverPrompt(prompt);
        }
        const fallbackSignature = 'fallback-cover-active';
        if (shouldNotifyImageWarning(fallbackSignature)) {
          notifyApp({ tone: 'warn', message: 'Dịch vụ ảnh AI đang bận nên hệ thống đã chuyển sang bìa dự phòng ngay để bạn không phải chờ lâu. Bạn có thể bấm tạo lại sau ít phút nếu muốn lấy bìa AI.', timeoutMs: 5200 });
        }
        return;
      }
      setCoverImageUrl(imageUrl);
      imageProviderWarnRef.current = { lastAt: 0, signature: '' };
      if (!coverPrompt.trim()) {
        setCoverPrompt(prompt);
      }
    } catch (error) {
      console.error('Không thể tạo ảnh bìa AI', error);
      const message = error instanceof Error ? error.message : String(error || '');
      notifyApp({ tone: 'error', message: `Tạo ảnh bìa thất bại. ${message} Bạn có thể bấm thử lại hoặc tải ảnh từ thiết bị.`, timeoutMs: 5200 });
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleSuggestIdeas = async () => {
    if (!title || !genre || !introduction) {
      notifyApp({ tone: 'warn', message: "Vui lòng nhập Tiêu đề, Thể loại và Giới thiệu để AI có đủ thông tin gợi ý." });
      return;
    }

    setIsSuggesting(true);
    try {
      const ai = createGeminiClient('auxiliary');
      const suggestionText = await generateGeminiText(
        ai,
        'quality',
        `Dựa trên các thông tin sau:
        Tiêu đề: ${title}
        Thể loại: ${genre}
        Giới thiệu: ${introduction}
        
        Hãy gợi ý chi tiết để xây dựng bộ truyện này, bắt buộc gồm tối thiểu 8 mục, mỗi mục tối thiểu 50 từ, rõ ràng, không lời dẫn kiểu “Tuyệt vời, tôi sẽ...”:
        1. Cốt truyện chính (Plot): các giai đoạn quan trọng, nút thắt, cao trào.
        2. Tuyến nhân vật: chính/phụ/phản diện (tên, vai trò, tính cách, động cơ).
        3. Quan hệ và xung đột: cách các nhân vật va chạm, phát sinh mâu thuẫn, hòa giải hay leo thang.
        4. Thế giới & Bối cảnh: quy tắc thế giới, địa danh, công nghệ/pháp thuật (nếu có).
        5. Thế lực & Tổ chức/Phe phái: đồng minh, phản diện, mục tiêu và thủ đoạn.
        6. Chủ đề & sắc thái cảm xúc: thông điệp, tông màu cảm xúc chính (u ám/lạc quan/vừa).
        7. Phong cách hành văn gợi ý: giọng văn, nhịp, cách dùng từ, mức độ miêu tả, thoại.
        8. Điểm đặc sắc/độc đáo để câu kéo người đọc ngay từ đầu.
        9. (Nếu phù hợp) Lộ trình phát triển dài hạn: hướng mở cho phần tiếp theo hoặc spin-off.

        Yêu cầu bắt buộc:
        - Viết đủ ít nhất 8 mục; mỗi mục >= 50 từ.
        - Không cắt ngắn giữa chừng, không bỏ mục, không viết kiểu đối thoại với người dùng.
        
        Trả về kết quả dưới dạng Markdown chuyên nghiệp, rõ ràng.`,
        {
          maxOutputTokens: 7600,
          minOutputChars: 1600,
          maxRetries: 3,
        },
      );

      if (suggestionText) {
        setContent(prev => prev ? prev + "\n\n" + suggestionText : suggestionText);
      }
    } catch (error) {
      console.error("Suggestion failed", error);
      notifyApp({ tone: 'error', message: "Không thể tạo gợi ý lúc này." });
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleAnalyzeCharactersLocal = () => {
    setIsAnalyzingCharacters(true);
    try {
      const detected = analyzeCharacterRosterLocally({
        title,
        introduction,
        content,
      });
      if (!detected.length) {
        notifyApp({
          tone: 'warn',
          message: 'Chưa đủ dữ liệu để phân tích nhân vật cục bộ. Hãy thêm giới thiệu hoặc nội dung truyện trước.',
        });
        return;
      }
      setCharacterRoster(detected);
      notifyApp({
        tone: 'success',
        message: `Đã phân tích cục bộ ${detected.length} nhân vật thường xuất hiện.`,
      });
    } finally {
      setIsAnalyzingCharacters(false);
    }
  };

  const updateCharacterRosterRow = (id: string, field: keyof StoryCharacterProfile, value: string) => {
    setCharacterRoster((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addCharacterRosterRow = () => {
    setCharacterRoster((prev) => [
      ...prev,
      {
        id: toCharacterProfileId(),
        name: '',
        role: '',
        age: '',
        identity: '',
      },
    ]);
  };

  const removeCharacterRosterRow = (id: string) => {
    setCharacterRoster((prev) => prev.filter((row) => row.id !== id));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="max-w-4xl mx-auto pt-24 pb-12 px-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <button 
          onClick={onCancel}
          className="p-2 rounded-full hover:bg-slate-100 transition-colors shrink-0"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto tf-actions-mobile">
          <button 
            onClick={() => setPreview(!preview)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-medium"
          >
            {preview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {preview ? 'Chỉnh sửa' : 'Xem trước'}
          </button>
          <button 
            onClick={() => setIsAdult(!isAdult)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full border transition-colors text-sm font-medium",
              isAdult ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-200 text-slate-600"
            )}
          >
            <AlertTriangle className="w-4 h-4" />
            {isAdult ? 'Truyện 18+' : 'Truyện bình thường'}
          </button>
          <button 
            onClick={() => setIsPublic(!isPublic)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full border transition-colors text-sm font-medium",
              isPublic ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-slate-50 border-slate-200 text-slate-600"
            )}
          >
            {isPublic ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {isPublic ? 'Công khai' : 'Riêng tư'}
          </button>
          <button 
            onClick={() => onSave({
              title,
              genre,
              introduction,
              content,
              storyPromptNotes: storyPromptNotes.trim() || undefined,
              characterRoster: normalizeCharacterRosterRows(characterRoster),
              coverImageUrl: coverImageUrl.trim() || undefined,
              expectedChapters,
              expectedWordCount,
              isPublic,
              isAdult,
            })}
            disabled={!title}
            className="flex items-center gap-2 px-6 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors text-sm font-medium shadow-md"
          >
            <Save className="w-4 h-4" />
            Lưu truyện
          </button>
        </div>
      </div>

      {!preview ? (
        <div className="space-y-8">
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Tiêu đề truyện..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-4xl font-serif font-bold border-none focus:ring-0 placeholder:text-slate-300"
            />
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Thể loại / nhãn truyện</label>
                <textarea
                  placeholder="Ví dụ: Tiên hiệp, huyền huyễn, xuyên không..."
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  rows={2}
                  className="w-full resize-none border-none bg-transparent p-0 text-base font-semibold text-indigo-600 focus:ring-0 placeholder:text-slate-300 tf-mobile-textarea"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                  <label className="mb-2 block text-xs font-bold text-slate-400 uppercase tracking-widest">Số chương dự kiến</label>
                  <input 
                    type="number" 
                    value={expectedChapters}
                    onChange={(e) => setExpectedChapters(parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 p-0"
                  />
                </div>
                <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                  <label className="mb-2 block text-xs font-bold text-slate-400 uppercase tracking-widest">Số chữ dự kiến</label>
                  <input 
                    type="number" 
                    value={expectedWordCount}
                    onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 p-0"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Bảng nhân vật thường xuất hiện</label>
                <p className="mt-1 text-sm text-slate-500">Phân tích chạy cục bộ trên máy từ tiêu đề, giới thiệu và nội dung truyện, không gọi AI.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAnalyzeCharactersLocal}
                  disabled={isAnalyzingCharacters}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {isAnalyzingCharacters ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Phân tích local
                </button>
                <button
                  type="button"
                  onClick={addCharacterRosterRow}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold hover:bg-slate-50"
                >
                  Thêm dòng
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="hidden md:grid md:grid-cols-[1.3fr_1fr_0.8fr_1.2fr_auto] gap-3 px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-200">
                <span>Tên nhân vật</span>
                <span>Vai trò</span>
                <span>Tuổi</span>
                <span>Thân phận</span>
                <span></span>
              </div>
              <div className="divide-y divide-slate-100">
                {characterRoster.length ? characterRoster.map((row) => (
                  <div key={row.id} className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.8fr_1.2fr_auto] gap-3 px-4 py-4 items-start">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateCharacterRosterRow(row.id, 'name', e.target.value)}
                      placeholder="Tên nhân vật"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="text"
                      value={row.role}
                      onChange={(e) => updateCharacterRosterRow(row.id, 'role', e.target.value)}
                      placeholder="Vai trò"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="text"
                      value={row.age}
                      onChange={(e) => updateCharacterRosterRow(row.id, 'age', e.target.value)}
                      placeholder="Ví dụ: 18 tuổi"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="text"
                      value={row.identity}
                      onChange={(e) => updateCharacterRosterRow(row.id, 'identity', e.target.value)}
                      placeholder="Thân phận / xuất thân"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeCharacterRosterRow(row.id)}
                      className="px-3 py-2 rounded-xl border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50"
                    >
                      Xóa
                    </button>
                  </div>
                )) : (
                  <div className="px-4 py-10 text-center text-sm italic text-slate-400">
                    Chưa có dữ liệu nhân vật. Bạn có thể tự thêm tay hoặc bấm `Phân tích local`.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ảnh bìa truyện</label>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverFileChange}
              className="hidden"
            />
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="w-full md:w-40 aspect-[2/3] rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                  {coverImageUrl ? (
                    <img
                      src={coverImageUrl}
                      alt="Ảnh bìa truyện"
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="text-center text-slate-400 px-3">
                      <ImagePlus className="w-6 h-6 mx-auto mb-2" />
                      <p className="text-xs font-semibold">Chưa có ảnh bìa</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <input
                    type="url"
                    value={coverImageUrl}
                    onChange={(e) => setCoverImageUrl(e.target.value)}
                    placeholder="Dán URL ảnh bìa (https://...)"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 tf-break-all"
                  />
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 tf-actions-mobile">
                    <button
                      type="button"
                      onClick={handlePickCoverFile}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold hover:bg-slate-50"
                    >
                      Tải ảnh lên
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateCover}
                      disabled={isGeneratingCover}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                    >
                      {isGeneratingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Tạo bìa bằng AI
                    </button>
                    {coverImageUrl && (
                      <button
                        type="button"
                        onClick={() => setCoverImageUrl('')}
                        className="px-4 py-2 rounded-xl border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50"
                      >
                        Xóa ảnh bìa
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Giới thiệu ngắn</label>
            <textarea 
              placeholder="Nhập giới thiệu cho truyện..."
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              className="w-full min-h-[150px] text-lg leading-relaxed border border-slate-100 rounded-2xl p-4 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-300 resize-none tf-mobile-textarea"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Dàn ý / Nội dung tổng quát</label>
              <button 
                onClick={handleSuggestIdeas}
                disabled={isSuggesting}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all text-xs font-bold disabled:opacity-50"
              >
                {isSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Gợi ý ý tưởng
              </button>
            </div>
            <textarea 
              placeholder="Bắt đầu viết câu chuyện của bạn (hỗ trợ Markdown)..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[40vh] text-lg leading-relaxed border-none focus:ring-0 placeholder:text-slate-300 resize-none tf-editor-textarea"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Prompt nội bộ / ghi chú vận hành</label>
            <textarea
              placeholder="Các prompt, quy tắc giọng văn hoặc chỉ dẫn nội bộ sẽ nằm ở đây và không hiển thị ở trang xem thông tin chung."
              value={storyPromptNotes}
              onChange={(e) => setStoryPromptNotes(e.target.value)}
              className="w-full min-h-[120px] rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 resize-none tf-mobile-textarea"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Prompt tạo bìa</label>
            <textarea
              value={coverPrompt}
              onChange={(e) => setCoverPrompt(e.target.value)}
              placeholder="Prompt ảnh bìa (tùy chọn). Bỏ trống để tự tạo từ tiêu đề/thể loại."
              className="w-full min-h-[88px] rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 resize-none tf-mobile-textarea"
            />
          </div>
        </div>
      ) : (
        <div className="prose prose-slate max-w-none">
          <div className="mb-8">
            {coverImageUrl && (
              <div className="mb-6 max-w-sm">
                <img
                  src={coverImageUrl}
                  alt={`Bìa truyện ${title || ''}`}
                  className="w-full aspect-[2/3] object-contain bg-slate-100 rounded-2xl border border-slate-200 shadow-sm"
                  loading="lazy"
                />
              </div>
            )}
            <span className="text-indigo-600 font-bold uppercase tracking-wider text-sm">{genre || 'Chưa phân loại'}</span>
            <h1 className="font-serif text-4xl mt-2 mb-4">{title || 'Chưa có tiêu đề'}</h1>
            <div className="markdown-body italic text-slate-500 border-l-4 border-slate-200 pl-4">
              <React.Suspense fallback={<p className="text-sm text-slate-500">Đang tải nội dung...</p>}>
                <MarkdownRenderer content={introduction || '*Chưa có giới thiệu*'} />
              </React.Suspense>
            </div>
          </div>
          {characterRoster.length ? (
            <div className="not-prose rounded-3xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 text-lg font-bold text-slate-900">Bảng nhân vật thường xuất hiện</h3>
              <div className="space-y-3">
                {characterRoster.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-slate-900">{row.name}</p>
                      {row.role ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{row.role}</span> : null}
                      {row.age ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{row.age}</span> : null}
                    </div>
                    {row.identity ? <p className="mt-2 text-sm text-slate-600">Thân phận: {row.identity}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm italic text-slate-400">
              Chưa có bảng nhân vật. Bạn có thể quay lại phần chỉnh sửa và bấm `Phân tích local`.
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

const ConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void, 
  title: string, 
  message: string 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] tf-modal-overlay flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="tf-modal-panel relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl overflow-hidden p-6 md:p-8"
      >
        <h3 className="text-xl font-serif font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-500 mb-8 tf-break-long">{message}</p>
        <div className="flex gap-3 tf-modal-actions">
          <button 
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
          >
            Hủy
          </button>
          <button 
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-900/20"
          >
            Xóa
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const BreadcrumbTrail = ({ items }: { items: BreadcrumbItem[] }) => {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        {items.map((item, index) => (
          <React.Fragment key={`${item.label}-${index}`}>
            {index > 0 ? <ChevronRight className="h-4 w-4 text-slate-300" /> : null}
            {item.to ? (
              <Link to={item.to} className="font-semibold text-slate-500 transition-colors hover:text-indigo-600">
                {item.label}
              </Link>
            ) : (
              <span className="font-semibold text-slate-700">{item.label}</span>
            )}
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
};

const StoryDetail = ({ 
  story, 
  onBack, 
  onEdit, 
  onAddChapter,
  onUpdateStory,
  onExportStory,
  onOpenReaderPrefs,
  forcedChapterId,
  onOpenChapter,
  onReaderBack,
  onReaderNavigateChapter,
  currentUserId,
  readerActivity,
  onReaderMarkChapterRead,
  onReaderToggleFollow,
  breadcrumbs,
  isReadOnly = false,
}: { 
  story: Story, 
  onBack: () => void, 
  onEdit: () => void,
  onAddChapter: () => void,
  onUpdateStory: (story: Story) => void,
  onExportStory: (story: Story) => void,
  onOpenReaderPrefs: () => void,
  forcedChapterId?: string | null,
  onOpenChapter?: (chapter: Chapter) => void,
  onReaderBack?: () => void,
  onReaderNavigateChapter?: (chapterId: string, mode?: 'push' | 'replace') => void,
  currentUserId?: string | null,
  readerActivity?: ReaderStoryActivity | null,
  onReaderMarkChapterRead?: (story: Story, chapter: Chapter) => void,
  onReaderToggleFollow?: (story: Story, nextFollowed: boolean) => void,
  breadcrumbs?: BreadcrumbItem[],
  isReadOnly?: boolean,
}) => {
  const [manualSelectedChapter, setManualSelectedChapter] = useState<Chapter | null>(null);
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [chapterRenderLimit, setChapterRenderLimit] = useState(CHAPTER_RENDER_BATCH_SIZE);
  const [chapterSearchTerm, setChapterSearchTerm] = useState('');
  const displayGenre = parseStoryGenreAndPrompt(story.genre || '', story.storyPromptNotes || '').genreLabel || 'Chưa phân loại';
  const readChapterSet = React.useMemo(() => new Set(readerActivity?.readChapterIds || []), [readerActivity?.readChapterIds]);
  const followed = Boolean(readerActivity?.followed);
  const forcedSelectedChapter = React.useMemo(
    () => (forcedChapterId ? ((story.chapters || []).find((chapter) => chapter.id === forcedChapterId) || null) : null),
    [forcedChapterId, story.chapters],
  );
  const selectedChapter = forcedSelectedChapter || manualSelectedChapter;
  const selectedChapterId = String(selectedChapter?.id || '').trim();

  const getRenderableChapterContent = (content: string) => {
    if (!content) return '';
    return normalizeAiJsonContent(content, '').content || content;
  };

  const normalizeChapterTitleForDisplay = (raw: string) => {
    if (!raw) return '';
    const normalized = raw
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/([A-Za-zÀ-Ỹà-ỹĐđ])\s+([a-zà-ỹđ])(?=[A-ZÀ-ỸĐ])/g, '$1$2')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized
      .replace(/\bch\s*ương\b/gi, 'chương')
      .replace(/\bch\s*uong\b/gi, 'chuong');
  };

  const getDisplayChapterTitle = (chapter: Chapter) => {
    const baseTitle = String(chapter.title || '').trim();
    const parsed = extractJsonContent(chapter.content || '');
    const parsedTitle = String(parsed?.title || '').trim();
    const isGenericTitle = /^chương\s*\d+$/i.test(baseTitle) || /^chapter\s*\d+$/i.test(baseTitle);
    if (parsedTitle && (!baseTitle || isGenericTitle)) {
      const fixed = normalizeChapterTitleForDisplay(parsedTitle);
      const chapterNumberMatch = normalizeSearchText(fixed).match(/^chuong\s+(\d+)$/i);
      if (chapterNumberMatch?.[1]) return `Chương ${chapterNumberMatch[1]}`;
      return fixed;
    }
    const fixed = normalizeChapterTitleForDisplay(baseTitle || parsedTitle || `Chương ${chapter.order || ''}`.trim());
    const chapterNumberMatch = normalizeSearchText(fixed).match(/^chuong\s+(\d+)$/i);
    if (chapterNumberMatch?.[1]) return `Chương ${chapterNumberMatch[1]}`;
    return fixed;
  };

  const formatContent = (content: string) => {
    const normalized = getRenderableChapterContent(content);
    if (!normalized) return '';
    const sanitizeChapterLeadNoise = (raw: string, chapterTitle?: string) => {
      const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
      const titleNorm = normalizeSearchText(chapterTitle || '');
      let removed = 0;
      while (lines.length > 0 && removed < 8) {
        const head = String(lines[0] || '').trim();
        if (!head) {
          lines.shift();
          removed += 1;
          continue;
        }
        const headNorm = normalizeSearchText(head);
        const isCoverNoise = /^(cover|bia|book cover)$/.test(headNorm);
        const isMetaHeading = /^(muc luc|table of contents|toc|source|nguon)$/.test(headNorm);
        const isDuplicatedChapterLine = /^((chuong|chapter)\s*\d+)/.test(headNorm) && /(online|dich|full|tap|\(|\)|-)/.test(headNorm);
        const isDuplicatedTitle = Boolean(titleNorm) && (headNorm === titleNorm || headNorm.endsWith(titleNorm));
        if (isCoverNoise || isMetaHeading || isDuplicatedChapterLine || isDuplicatedTitle) {
          lines.shift();
          removed += 1;
          continue;
        }
        break;
      }
      return lines.join('\n').trim();
    };

    const canonical = sanitizeChapterLeadNoise(normalized, selectedChapter?.title || '')
      .replace(/\r\n?/g, '\n')
      .replace(/]\s+\[/g, ']\n[')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const hasStructuredParagraphs = canonical.split(/\n{2,}/).filter((item) => item.trim().length > 0).length >= 3;
    if (hasStructuredParagraphs) {
      return improveBracketSystemSpacing(canonical);
    }

    const rawLines = canonical
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const isDenseSingleBlock = rawLines.length <= 2 && getWordCount(canonical) >= 220;
    if (!isDenseSingleBlock) {
      return improveBracketSystemSpacing(rawLines.join('\n\n'));
    }

    const sentenceParts = canonical
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?…]["”'’»]*)\s+/u)
      .map((item) => item.trim())
      .filter(Boolean);

    const paragraphs: string[] = [];
    let buffer: string[] = [];
    let wordBudget = 0;

    const flushBuffer = () => {
      if (!buffer.length) return;
      paragraphs.push(buffer.join(' ').trim());
      buffer = [];
      wordBudget = 0;
    };

    const isDialogueLike = (sentence: string) => {
      const source = sentence.trim();
      return (
        /^["“'‘«]/.test(source)
        || /^[-–—]\s*["“'‘«]/.test(source)
        || /(?:nói|đáp|hỏi|thầm|quát|kêu|gào|lẩm bẩm|thì thầm)\s*[:：]?\s*["“'‘«]/i.test(source)
      );
    };

    const isSystemNotice = (sentence: string) => /^\[[^\]]{1,220}\]$/.test(sentence.trim());

    for (const sentence of sentenceParts) {
      const sentenceWords = getWordCount(sentence);
      const dialogueLike = isDialogueLike(sentence);
      const systemNotice = isSystemNotice(sentence);

      if ((dialogueLike || systemNotice) && buffer.length > 0) {
        flushBuffer();
      }

      buffer.push(sentence);
      wordBudget += sentenceWords;

      const hardLimit = dialogueLike || systemNotice ? 45 : 90;
      if (wordBudget >= hardLimit) {
        flushBuffer();
      }
    }
    flushBuffer();

    const rebuilt = paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return improveBracketSystemSpacing(rebuilt || canonical);
  };

  const getWordCount = (text: string) => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleNextChapter = () => {
    if (!selectedChapter || !sortedChapterList.length) return;
    const currentIndex = sortedChapterList.findIndex((c) => c.id === selectedChapter.id);
    if (currentIndex < sortedChapterList.length - 1) {
      const nextChapter = sortedChapterList[currentIndex + 1];
      if (!forcedChapterId) setManualSelectedChapter(nextChapter);
      onReaderNavigateChapter?.(nextChapter.id, 'replace');
      window.scrollTo(0, 0);
    }
  };

  const handlePrevChapter = () => {
    if (!selectedChapter || !sortedChapterList.length) return;
    const currentIndex = sortedChapterList.findIndex((c) => c.id === selectedChapter.id);
    if (currentIndex > 0) {
      const prevChapter = sortedChapterList[currentIndex - 1];
      if (!forcedChapterId) setManualSelectedChapter(prevChapter);
      onReaderNavigateChapter?.(prevChapter.id, 'replace');
      window.scrollTo(0, 0);
    }
  };

  const handleOpenChapter = (chapter: Chapter) => {
    if (onOpenChapter) {
      onOpenChapter(chapter);
      return;
    }
    if (!forcedChapterId) setManualSelectedChapter(chapter);
  };

  useEffect(() => {
    if (forcedChapterId) return;
    setManualSelectedChapter(null);
  }, [forcedChapterId, story.id]);

  useEffect(() => {
    setChapterRenderLimit(CHAPTER_RENDER_BATCH_SIZE);
    setChapterSearchTerm('');
  }, [story.id]);

  const sortedChapterList = React.useMemo(
    () => [...(story.chapters || [])].sort((a, b) => a.order - b.order),
    [story.chapters],
  );

  const resumeChapter = React.useMemo(() => {
    if (!readerActivity?.lastChapterId) return null;
    return sortedChapterList.find((chapter) => chapter.id === readerActivity.lastChapterId) || null;
  }, [readerActivity?.lastChapterId, sortedChapterList]);

  const readChapterCount = React.useMemo(
    () => {
      if (selectedChapterId) return 0;
      return sortedChapterList.filter((chapter) => readChapterSet.has(chapter.id)).length;
    },
    [readChapterSet, selectedChapterId, sortedChapterList],
  );

  const chapterSearchNormalized = chapterSearchTerm.trim().toLowerCase();
  const filteredChapterList = React.useMemo(() => {
    if (selectedChapterId) return sortedChapterList;
    if (!chapterSearchNormalized) return sortedChapterList;
    return sortedChapterList.filter((chapter) => {
      const displayTitle = getDisplayChapterTitle(chapter).toLowerCase();
      const chapterAlias = `chuong ${chapter.order}`;
      const chapterAliasVi = `chương ${chapter.order}`;
      return displayTitle.includes(chapterSearchNormalized)
        || chapterAlias.includes(chapterSearchNormalized)
        || chapterAliasVi.includes(chapterSearchNormalized);
    });
  }, [chapterSearchNormalized, selectedChapterId, sortedChapterList]);

  const persistUpdatedStory = (updatedStory: Story): void => {
    const stories = storage.getStories();
    const newList = stories.map((s: Story) => (s.id === story.id ? updatedStory : s));
    saveStoriesAndRefresh(newList);
    onUpdateStory(updatedStory);
  };

  const handleSaveChapterEdit = async () => {
    if (!selectedChapter || !story.chapters) return;
    const updatedAt = new Date().toISOString();
    
    const updatedChapters = story.chapters.map(c => 
      c.id === selectedChapter.id 
        ? { ...c, title: editTitle, content: editContent, updatedAt } 
        : c
    );

    const updatedStory = { ...story, chapters: updatedChapters, updatedAt };
    
    try {
      persistUpdatedStory(updatedStory);
      setManualSelectedChapter({ ...selectedChapter, title: editTitle, content: editContent });
      setIsEditingChapter(false);
    } catch (error) {
      console.error("Lỗi khi cập nhật chương:", error);
      notifyApp({ tone: 'error', message: "Không thể lưu thay đổi chương." });
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (isReadOnly) return;
    if (!story.chapters || !story.chapters.length) return;
    const target = story.chapters.find((item) => item.id === chapterId);
    if (!target) return;
    if (!window.confirm(`Xóa chương "${target.title || `Chương ${target.order}`}"?`)) return;

    try {
      const deletedAt = new Date().toISOString();
      const remaining = story.chapters
        .filter((item) => item.id !== chapterId)
        .sort((a, b) => a.order - b.order)
        .map((chapter, index) => ({
          ...chapter,
          order: index + 1,
          updatedAt: deletedAt,
        }));

      const nextDeletedMap = pruneDeletedChapterMap({
        ...normalizeDeletedChapterMap(story.deletedChapterIds || {}),
        [chapterId]: deletedAt,
      });

      const updatedStory: Story = {
        ...story,
        chapters: normalizeChaptersForLocal(remaining),
        deletedChapterIds: nextDeletedMap,
        updatedAt: deletedAt,
      };
      persistUpdatedStory(updatedStory);

      const wasReadingDeletedChapter = selectedChapter?.id === chapterId;
      if (wasReadingDeletedChapter) {
        setManualSelectedChapter(null);
        onReaderBack?.();
      } else if (selectedChapter) {
        const refreshed = updatedStory.chapters?.find((item) => item.id === selectedChapter.id) || null;
        setManualSelectedChapter(refreshed);
      }

      notifyApp({
        tone: 'success',
        message: 'Đã xóa chương.',
        groupKey: 'chapter-delete-success',
      });
    } catch (error) {
      console.error('Lỗi khi xóa chương:', error);
      notifyApp({
        tone: 'error',
        message: 'Không thể xóa chương.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'chapter-delete-failed',
      });
    }
  };

  const totalWords = React.useMemo(
    () => (story.chapters || []).reduce((acc, chap) => acc + getWordCount(chap.content || ''), 0),
    [story.chapters],
  );
  const selectedChapterDisplayTitle = React.useMemo(
    () => (selectedChapter ? getDisplayChapterTitle(selectedChapter) : ''),
    [selectedChapter],
  );
  const formattedSelectedChapterContent = React.useMemo(
    () => (selectedChapter ? formatContent(selectedChapter.content || '') : ''),
    [selectedChapter?.content, selectedChapter?.title, selectedChapterId],
  );
  const selectedChapterWordCount = React.useMemo(
    () => getWordCount(formattedSelectedChapterContent),
    [formattedSelectedChapterContent],
  );
  const formattedStoryIntroduction = React.useMemo(
    () => formatContent(story.introduction || '*Chưa có giới thiệu*'),
    [story.introduction],
  );

  useEffect(() => {
    if (!currentUserId || !selectedChapterId || !onReaderMarkChapterRead) return;
    const chapter = (story.chapters || []).find((item) => item.id === selectedChapterId);
    if (!chapter) return;
    onReaderMarkChapterRead(story, chapter);
  }, [currentUserId, onReaderMarkChapterRead, selectedChapterId, story]);

  if (selectedChapter) {
    const currentIndex = sortedChapterList.findIndex((c) => c.id === selectedChapter.id);
    const hasNext = currentIndex < sortedChapterList.length - 1;
    const hasPrev = currentIndex > 0;

    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-[min(96vw,1680px)] mx-auto pt-24 pb-12 px-2 sm:px-4 md:px-6"
      >
        {breadcrumbs?.length ? <BreadcrumbTrail items={breadcrumbs} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
          <button 
            onClick={() => {
              if (onReaderBack) {
                onReaderBack();
                return;
              }
              setManualSelectedChapter(null);
            }}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-bold"
          >
            <ChevronLeft className="w-6 h-6" /> Quay lại mục lục
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onOpenReaderPrefs}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors text-sm font-bold"
              title="Cài đặt đọc"
            >
              <Settings className="w-4 h-4" /> Giao diện đọc
            </button>
            {!selectedChapter && resumeChapter ? (
              <button
                onClick={() => handleOpenChapter(resumeChapter)}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors text-sm font-bold"
              >
                <History className="w-4 h-4" /> Đọc tiếp {`Chương ${resumeChapter.order}`}
              </button>
            ) : null}
            {onReaderToggleFollow ? (
              <button
                onClick={() => onReaderToggleFollow(story, !followed)}
                className={cn(
                  'flex items-center justify-center gap-2 px-4 py-2 rounded-xl border transition-colors text-sm font-bold',
                  followed
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                <Heart className={cn('w-4 h-4', followed ? 'fill-current' : '')} />
                {followed ? 'Đang theo dõi' : 'Theo dõi'}
              </button>
            ) : null}
            {!isReadOnly ? (
              <>
                <button 
                  onClick={() => {
                    setEditTitle(selectedChapterDisplayTitle);
                    setEditContent(formattedSelectedChapterContent);
                    setIsEditingChapter(true);
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-bold"
                >
                  <Edit3 className="w-4 h-4" /> Chỉnh sửa chương
                </button>
                <button
                  onClick={() => void handleDeleteChapter(selectedChapter.id)}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm font-bold"
                >
                  <Trash2 className="w-4 h-4" /> Xóa chương
                </button>
              </>
            ) : null}
          </div>
        </div>
        
        <div
          className="p-5 md:p-8 rounded-[32px] shadow-sm border border-slate-100 mb-8"
          style={{
            backgroundColor: 'var(--tf-reader-bg)',
            color: 'var(--tf-reader-text)',
          }}
        >
          <div className="max-w-[min(92vw,1320px)] mx-auto">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
              <h2 className="text-sm font-bold text-indigo-600 uppercase tracking-widest">Chương {selectedChapter.order}</h2>
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {selectedChapterWordCount} từ</span>
                <span className="flex items-center gap-1"><Loader2 className="w-3 h-3" /> {formatDateTime(selectedChapter.createdAt)}</span>
              </div>
            </div>
            
              <h1
                className="chapter-title text-3xl sm:text-4xl font-bold text-slate-900 mb-8 sm:mb-10"
                style={{ fontFamily: 'var(--tf-reader-font-family)' }}
              >
                {selectedChapterDisplayTitle}
              </h1>
            
            <div
            className="reader-markdown markdown-body text-lg leading-relaxed text-slate-700"
            style={{
              fontSize: 'var(--tf-reader-font-size)',
              lineHeight: 'var(--tf-reader-line-height)',
              fontFamily: 'var(--tf-reader-font-family)',
              color: 'var(--tf-reader-text)',
            }}
          >
              <React.Suspense fallback={<p className="text-sm opacity-75">Đang tải nội dung chương...</p>}>
                <MarkdownRenderer content={formattedSelectedChapterContent} />
              </React.Suspense>
            </div>
          </div>
        </div>

        <div className="chapter-nav flex items-center justify-between max-w-[min(92vw,1320px)] mx-auto">
          <button 
            onClick={handlePrevChapter}
            disabled={!hasPrev}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5" /> Chương trước
          </button>
          
          <button 
            onClick={handleNextChapter}
            disabled={!hasNext}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Chương sau <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <AnimatePresence>
          {isEditingChapter && (
            <div className="fixed inset-0 z-[200] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="tf-modal-panel bg-white w-full max-w-4xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center gap-3">
                  <h3 className="text-2xl font-serif font-bold text-slate-900">Chỉnh sửa chương</h3>
                  <button onClick={() => setIsEditingChapter(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                  </button>
                </div>
                
                <div className="tf-modal-content p-6 md:p-8 flex-grow overflow-y-auto space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Tiêu đề chương</label>
                    <input 
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Nội dung chương</label>
                    <textarea 
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={15}
                      className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 text-slate-700 leading-relaxed tf-editor-textarea"
                    />
                  </div>
                </div>

                <div className="p-6 md:p-8 border-t border-slate-100 flex gap-4 tf-modal-actions">
                  <button 
                    onClick={() => setIsEditingChapter(false)}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleSaveChapterEdit}
                    className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20"
                  >
                    Lưu thay đổi
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="story-detail max-w-5xl mx-auto pt-24 pb-12 px-4 sm:px-6"
    >
      {breadcrumbs?.length ? <BreadcrumbTrail items={breadcrumbs} /> : null}

      <div className="story-detail__header flex items-center justify-between mb-8">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-bold"
        >
          <ChevronLeft className="w-6 h-6" /> Quay lại thư viện
        </button>
        <div className="story-detail__actions flex gap-3">
          <button 
            onClick={() => onExportStory(story)}
            className="flex items-center gap-2 px-6 py-2 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-colors text-sm font-bold"
          >
            <Download className="w-4 h-4" /> Xuất truyện
          </button>
          {!isReadOnly ? (
            <>
              <button 
                onClick={onEdit}
                className="flex items-center gap-2 px-6 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-bold"
              >
                <Edit3 className="w-4 h-4" /> Chỉnh sửa thông tin
              </button>
              <button 
                onClick={onAddChapter}
                className="flex items-center gap-2 px-6 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white transition-colors text-sm font-bold shadow-md"
              >
                <Plus className="w-4 h-4" /> Viết chương mới
              </button>
            </>
          ) : (
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-indigo-700">
              Bản công khai
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-5 sm:p-8 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex flex-col md:flex-row gap-6">
              {story.coverImageUrl && (
                <div className="w-full md:w-52 flex-shrink-0">
                  <img
                    src={story.coverImageUrl}
                    alt={`Bìa truyện ${story.title}`}
                    className="w-full aspect-[2/3] object-contain bg-slate-100 rounded-2xl border border-slate-200 shadow-sm"
                    loading="lazy"
                  />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-full uppercase tracking-wider">
                    {displayGenre}
                  </span>
                  {story.isAdult && (
                    <span className="px-3 py-1 bg-red-100 text-red-600 text-[10px] font-black rounded-full uppercase tracking-tighter flex items-center gap-1 border border-red-200">
                      <AlertTriangle className="w-3 h-3" /> 18+
                    </span>
                  )}
                  <span className="text-slate-400 text-xs font-mono">
                    {story.chapters?.length || 0} / {story.expectedChapters || '?'} chương
                  </span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-slate-900 mb-6">{story.title}</h1>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">Giới thiệu</h3>
                    <div className="markdown-body text-slate-600 leading-relaxed">
                      <React.Suspense fallback={<p className="text-sm text-slate-500">Đang tải giới thiệu...</p>}>
                        <MarkdownRenderer content={formattedStoryIntroduction} />
                      </React.Suspense>
                    </div>
                  </div>
                  {story.characterRoster?.length ? (
                    <div>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">Nhân vật thường xuất hiện</h3>
                      <div className="space-y-3">
                        {story.characterRoster.map((row) => (
                          <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-bold text-slate-900">{row.name}</p>
                              {row.role ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{row.role}</span> : null}
                              {row.age ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{row.age}</span> : null}
                            </div>
                            {row.identity ? <p className="mt-2 text-sm text-slate-600">Thân phận: {row.identity}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 sm:p-8 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-serif font-bold text-slate-900 flex items-center gap-3">
                <List className="w-6 h-6 text-indigo-600" /> Mục lục
              </h3>
              <div className="text-right">
                <p className="text-xs font-mono text-slate-400">{totalWords.toLocaleString()} chữ</p>
                <p className="text-[11px] font-semibold text-emerald-600">
                  Đã đọc {readChapterCount}/{sortedChapterList.length} chương
                </p>
              </div>
            </div>
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={chapterSearchTerm}
                onChange={(event) => setChapterSearchTerm(event.target.value)}
                placeholder="Tìm nhanh chương theo số hoặc tên..."
                className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
              {chapterSearchTerm ? (
                <button
                  type="button"
                  onClick={() => setChapterSearchTerm('')}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                >
                  Xóa
                </button>
              ) : null}
            </div>
            <div className="space-y-2">
              {sortedChapterList.length > 0 ? (
                <>
                  {(chapterSearchNormalized ? filteredChapterList : filteredChapterList.slice(0, chapterRenderLimit)).map((chapter) => {
                    const chapterRowContent = (
                      <>
                        <div className="flex items-center gap-4">
                          <span className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xs font-bold group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                            {chapter.order}
                          </span>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-700 group-hover:text-slate-900 transition-colors">
                              {chapter.title}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              {getWordCount(chapter.content || '')} chữ
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {readChapterSet.has(chapter.id) ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                              Đã đọc
                            </span>
                          ) : null}
                          {!isReadOnly ? (
                            <button
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleDeleteChapter(chapter.id);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="Xóa chương"
                              aria-label={`Xóa ${chapter.title || `chương ${chapter.order}`}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                          <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                        </div>
                      </>
                    );

                    return (
                      <div
                        key={chapter.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenChapter(chapter)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleOpenChapter(chapter);
                          }
                        }}
                        className="chapter-row w-full flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-all text-left group cursor-pointer"
                        aria-label={`${chapter.title || `Chương ${chapter.order}`}${readChapterSet.has(chapter.id) ? ' (đã đọc)' : ''}`}
                      >
                        {chapterRowContent}
                      </div>
                    );
                  })}
                  {!chapterSearchNormalized && filteredChapterList.length > chapterRenderLimit ? (
                    <button
                      type="button"
                      onClick={() => setChapterRenderLimit((prev) => prev + CHAPTER_RENDER_BATCH_SIZE)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Tải thêm chương ({filteredChapterList.length - chapterRenderLimit} còn lại)
                    </button>
                  ) : null}
                  {chapterSearchNormalized && filteredChapterList.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                      Không tìm thấy chương phù hợp với từ khóa bạn nhập.
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-slate-400 italic">Chưa có chương nào được viết.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 p-5 sm:p-8 rounded-[32px] text-white">
            <h3 className="text-lg font-bold mb-4">Thông tin truyện</h3>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <span className="text-white/50">Phân loại</span>
                <span className={cn("font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider", story.isAdult ? "bg-red-500 text-white" : "bg-slate-700 text-slate-300")}>
                  {story.isAdult ? '18+' : 'Bình thường'}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <span className="text-white/50">Tổng số chữ</span>
                <span className="font-bold text-white">
                  {totalWords.toLocaleString()} / {(story.expectedWordCount || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <span className="text-white/50">Trạng thái</span>
                <span className="font-bold">{story.isPublic ? 'Công khai' : 'Riêng tư'}</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <span className="text-white/50">Ngày tạo</span>
                <span className="font-bold">{new Date(story.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-white/50">Nguồn</span>
                <span className="font-bold">{story.isAI ? 'AI Hỗ trợ' : 'Tự viết'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const PAGE_SIZE = 6;
const CHAPTER_RENDER_BATCH_SIZE = 80;

const StoryList = ({
  onView,
  refreshKey,
  readerActivityMap = {},
  showReaderMeta = false,
  onContinueFromActivity,
  storiesOverride = null,
}: {
  onView: (story: Story) => void;
  refreshKey: number;
  readerActivityMap?: Record<string, ReaderStoryActivity>;
  showReaderMeta?: boolean;
  onContinueFromActivity?: (activity: ReaderStoryActivity) => void;
  storiesOverride?: StoryListItem[] | null;
}) => {
  const { user } = useAuth();
  const [stories, setStories] = useState<StoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resolvedStoryMeta, setResolvedStoryMeta] = useState<Record<string, ImportedStoryMetadata>>({});
  const storyMetaLookupInFlightRef = useRef<Set<string>>(new Set());

  // Pagination limits
  const [originalLimit, setOriginalLimit] = useState(PAGE_SIZE);
  const [translatedLimit, setTranslatedLimit] = useState(PAGE_SIZE);
  const [continuedLimit, setContinuedLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    if (Array.isArray(storiesOverride)) {
      setStories(storiesOverride);
      setLoading(false);
      return;
    }
    const list = storage.getStoryListItems();
    setStories(list);
    setLoading(false);
  }, [refreshKey, storiesOverride]);

  useEffect(() => {
    const targets = stories
      .slice(0, 60)
      .filter((item) => shouldLookupStoryCardMetadata({
        title: item.title,
        introduction: item.introduction,
        genre: item.genre,
      }));
    targets.forEach((item) => {
      const storyId = String(item.id || '').trim();
      if (!storyId) return;
      if (resolvedStoryMeta[storyId]) return;
      if (storyMetaLookupInFlightRef.current.has(storyId)) return;
      storyMetaLookupInFlightRef.current.add(storyId);
      void resolveImportedStoryMetadata(`${item.title || storyId}.txt`, /\.txt$/i)
        .then((metadata) => {
          if (metadata.source === 'fallback') return;
          setResolvedStoryMeta((prev) => {
            if (prev[storyId]) return prev;
            return { ...prev, [storyId]: metadata };
          });
        })
        .finally(() => {
          storyMetaLookupInFlightRef.current.delete(storyId);
        });
    });
  }, [resolvedStoryMeta, stories]);

  const handleDelete = async () => {
    if (!deleteId) return;
    const allStories = storage.getStories();
    const newList = allStories.filter((s) => String(s.id) !== deleteId);
    saveStoriesAndRefresh(newList);
    setStories((prev) => prev.filter((s) => s.id !== deleteId));
    setDeleteId(null);
  };

  if (loading) return <div className="flex justify-center p-12">Đang tải...</div>;

  if (!user) {
    return (
      <div className="text-center py-24 px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-6">
          <User className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-xl font-serif font-medium text-slate-900 mb-2">Bạn chưa đăng nhập</h3>
        <p className="text-slate-500 max-w-xs mx-auto mb-8">Vui lòng đăng nhập để xem và quản lý truyện của bạn.</p>
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="text-center py-24 px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-6">
          <BookOpen className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-xl font-serif font-medium text-slate-900 mb-2">Chưa có truyện nào</h3>
        <p className="text-slate-500 max-w-xs mx-auto">Hãy bắt đầu viết câu chuyện đầu tiên của bạn ngay hôm nay.</p>
      </div>
    );
  }

  const originalStories = stories.filter(s => !s.type || s.type === 'original');
  const translatedStories = stories.filter(s => s.type === 'translated');
  const continuedStories = stories.filter(s => s.type === 'continued');

  const Column = ({ 
    title, 
    stories,
    icon: Icon, 
    color, 
    limit, 
    onLoadMore 
  }: { 
    title: string, 
    stories: StoryListItem[],
    icon: any, 
    color: string, 
    limit: number, 
    onLoadMore: () => void 
  }) => {
    const visibleStories = stories.slice(0, limit);
    const hasMore = stories.length > limit;

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 px-2">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-sm", color)}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-serif font-bold text-lg text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 font-medium">{stories.length} truyện</p>
          </div>
        </div>
        
        <div className="flex flex-col gap-4">
          {stories.length === 0 ? (
            <div className="bg-white/50 border-2 border-dashed border-slate-200 rounded-[24px] p-8 text-center">
              <p className="text-sm text-slate-400 font-medium">Chưa có truyện nào</p>
            </div>
          ) : (
            <>
              {visibleStories.map((story) => {
                const cardMetadata = resolvedStoryMeta[story.id];
                const displayTitle = resolveStoryCardDisplayTitle(story.title, cardMetadata);
                const displayGenre = resolveStoryCardDisplayGenre(story.genre, cardMetadata, story.title);
                const displayIntro = buildStoryCardDisplayIntroduction({
                  introduction: story.introduction,
                  genre: displayGenre,
                  title: story.title,
                  metadata: cardMetadata,
                });
                return (
                  <motion.div
                    key={story.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => {
                      const fullStory = storage.getStoryById(story.id);
                      if (!fullStory) {
                        notifyApp({
                          tone: 'warn',
                          message: 'Không thể mở truyện này, dữ liệu có thể đã bị thay đổi.',
                        });
                        return;
                      }
                      onView(fullStory);
                    }}
                    className="group relative bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-900/5 transition-all cursor-pointer flex flex-col min-h-[20rem]"
                  >
                  {(() => {
                    const readerActivity = readerActivityMap[story.id];
                    const readCount = readerActivity?.readChapterIds?.length || 0;
                    const chapterTotal = Math.max(0, Number(story.chapterCount || 0));
                    const hasContinue = Boolean(
                      readerActivity
                      && readerActivity.lastChapterId
                      && onContinueFromActivity,
                    );
                    return (
                      <>
                        {showReaderMeta && readerActivity ? (
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                              Đã đọc {Math.min(readCount, chapterTotal)}/{chapterTotal || '?'}
                            </span>
                            {readerActivity.lastChapterOrder > 0 ? (
                              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
                                Đọc đến chương {readerActivity.lastChapterOrder}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {hasContinue ? (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onContinueFromActivity?.(readerActivity);
                            }}
                            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            <History className="h-4 w-4" />
                            Đọc tiếp
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-2">
                      <div className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                        story.isPublic ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {story.isPublic ? 'Công khai' : 'Riêng tư'}
                      </div>
                      {story.isAdult && (
                        <div className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> 18+
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(story.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-full hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className={cn("mb-4 flex-grow", story.coverImageUrl ? "grid grid-cols-[6rem_1fr] gap-4 items-start" : "")}>
                    {story.coverImageUrl && (
                      <div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-100 aspect-[2/3] w-24 sm:w-24">
                        <img
                          src={story.coverImageUrl}
                          alt={`Bìa truyện ${displayTitle}`}
                          className="w-full h-full object-contain object-center"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3
                        className="text-xl font-serif font-bold text-slate-900 mb-3"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {displayTitle}
                      </h3>
                      <p
                        className="text-slate-500 text-sm"
                        style={{ display: '-webkit-box', WebkitLineClamp: story.coverImageUrl ? 4 : 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {buildStoryCardMetaLine({ introduction: displayIntro, genre: displayGenre })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>Cập nhật: {new Date(story.updatedAt).toLocaleDateString('vi-VN')}</span>
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {story.chapterCount || 0} chương
                    </span>
                  </div>
                </motion.div>
                );
              })}
              
              {hasMore && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadMore();
                  }}
                  className="w-full py-4 bg-white border border-slate-200 rounded-2xl text-slate-500 font-medium hover:bg-slate-50 hover:text-indigo-600 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Xem thêm ({stories.length - limit})
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <ConfirmModal 
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Xóa truyện"
        message="Bạn có chắc chắn muốn xóa truyện này? Hành động này không thể hoàn tác."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 px-6 max-w-7xl mx-auto pb-24">
        <Column 
          title="Truyện sáng tác" 
          stories={originalStories} 
          icon={Feather} 
          color="bg-indigo-600" 
          limit={originalLimit}
          onLoadMore={() => setOriginalLimit(prev => prev + PAGE_SIZE)}
        />
        <Column 
          title="Truyện dịch" 
          stories={translatedStories} 
          icon={BookOpen} 
          color="bg-emerald-600" 
          limit={translatedLimit}
          onLoadMore={() => setTranslatedLimit(prev => prev + PAGE_SIZE)}
        />
        <Column 
          title="Truyện viết tiếp" 
          stories={continuedStories} 
          icon={Sparkles} 
          color="bg-amber-600" 
          limit={continuedLimit}
          onLoadMore={() => setContinuedLimit(prev => prev + PAGE_SIZE)}
        />
      </div>
    </>
  );
};

const AILoadingOverlay = ({
  isVisible,
  message,
  stageLabel,
  detail,
  progress,
  timer,
  onCancel,
}: {
  isVisible: boolean,
  message: string,
  stageLabel?: string,
  detail?: string,
  progress?: AiOverlayProgress | null,
  timer: number,
  onCancel?: () => void,
}) => {
  if (!isVisible) return null;
  const progressPercent = progress?.total
    ? Math.max(6, Math.min(100, Math.round((progress.completed / progress.total) * 100)))
    : 0;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-12 rounded-[3rem] shadow-2xl flex flex-col items-center max-w-md w-full mx-4 text-center"
      >
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-indigo-100 rounded-full animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
            {stageLabel || "Đang xử lý"}
          </span>
          {progress ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
              {Math.min(progress.completed, progress.total)}/{progress.total} bước
            </span>
          ) : null}
        </div>
        <h3 className="text-2xl font-serif font-bold text-slate-900 mb-2">{message || "AI đang xử lý..."}</h3>
        <p className="text-slate-500 font-medium mb-4">{detail || "Vui lòng đợi trong giây lát"}</p>
        {progress ? (
          <div className="mb-5 w-full space-y-2">
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs font-semibold text-slate-500">
              Tiến độ hiện tại được cập nhật theo từng lô/chương để bạn biết AI đang chạy tới đâu.
            </p>
          </div>
        ) : null}
        <div className="px-6 py-3 bg-indigo-50 rounded-2xl text-indigo-600 font-bold text-sm tracking-widest uppercase">
          Thời gian: {timer} giây
        </div>
        {onCancel ? (
          <button
            onClick={onCancel}
            className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-2 text-sm font-bold text-rose-600 hover:bg-rose-100"
          >
            Hủy tác vụ
          </button>
        ) : null}
      </motion.div>
    </div>
  );
};

const AppToastStack = ({
  toasts,
  onDismiss,
}: {
  toasts: AppToast[],
  onDismiss: (groupKey: string) => void,
}) => {
  if (!toasts.length) return null;
  return (
    <div className="app-toast-stack fixed right-4 top-24 z-[260] flex w-[min(92vw,380px)] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'rounded-2xl border px-4 py-3 shadow-xl backdrop-blur',
            toast.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
            toast.tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-800',
            toast.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-800',
            toast.tone === 'info' && 'border-indigo-200 bg-white text-slate-800',
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-70">
                  {toast.title || (toast.tone === 'success'
                    ? 'Thành công'
                    : toast.tone === 'warn'
                      ? 'Lưu ý'
                      : toast.tone === 'error'
                        ? 'Lỗi'
                        : 'Thông tin')}
                </p>
                {toast.count > 1 ? (
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold">
                    x{toast.count}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-semibold leading-6">{toast.message}</p>
              {toast.detail ? (
                <p className="mt-1 text-xs leading-5 opacity-80">{toast.detail}</p>
              ) : null}
            </div>
            <button
              onClick={() => onDismiss(toast.groupKey)}
              className="rounded-full p-1.5 text-current/60 transition hover:bg-black/5 hover:text-current"
              aria-label="Đóng thông báo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

type PromptGroup = 'translate' | 'write' | 'common' | 'tone_rules' | 'adult';

const PREDEFINED_PROMPTS: Array<{ group: PromptGroup, category: string, prompts: Array<{ title: string, content: string }> }> = [
  // Translate prompts (Trung Quốc, Nhật Bản)
  {
    group: 'translate',
    category: 'Dịch · Tiên hiệp / Huyền huyễn (CN)',
    prompts: [
      { title: 'Tu chân chi tiết', content: 'Dịch sát nghĩa các khái niệm tu chân (cảnh giới, pháp bảo, linh căn, độ kiếp), giữ nguyên thuật ngữ phiên âm nếu không có tương đương Việt. Giữ mạch hành văn trang trọng, nhịp vừa.' },
      { title: 'Độ kiếp & khí tượng', content: 'Miêu tả rõ thiên kiếp, dị tượng, âm thanh, mùi, áp lực tâm thần. Tránh lược bỏ các bước chuẩn bị đan dược, trận pháp, linh thạch.' },
      { title: 'Tông môn & bối cảnh', content: 'Giữ nguyên tên tông môn, bí cảnh, gia tộc; thêm chú thích ngắn trong ngoặc nếu từ thuần Hán khó hiểu. Giữ giọng văn cổ điển, không hiện đại hóa.' },
    ],
  },
  {
    group: 'translate',
    category: 'Dịch · Đô thị / Hệ thống (CN)',
    prompts: [
      { title: 'Hệ thống nhiệm vụ', content: 'Giữ nguyên giao diện hệ thống, bảng thuộc tính, phần thưởng. Không tóm tắt log hệ thống; trình bày dạng danh sách rõ ràng. Giọng kể nhanh, dứt khoát.' },
      { title: 'Trọng sinh báo thù', content: 'Nhấn mạnh cảm xúc “đạp đổ số phận”, sắc bén khi đối thoại. Giữ các mánh lới làm giàu/công nghệ ở hiện đại; dịch gọn, không văn vẻ cổ điển.' },
      { title: 'Thương chiến & đầu tư', content: 'Giữ thuật ngữ tài chính/công nghệ; ưu tiên dịch sát nghĩa, có thể thêm chú giải ngắn khi cần. Giọng kể thực dụng, tốc độ nhanh.' },
    ],
  },
  {
    group: 'translate',
    category: 'Dịch · Cung đấu / Trạch đấu (CN)',
    prompts: [
      { title: 'Âm mưu cung đình', content: 'Giữ lời thoại kính ngữ, xưng hô chuẩn cổ phong (bản cung, vi thần...). Miêu tả diễn biến tâm lý, ánh mắt, động tác nhỏ. Nhịp chậm, căng thẳng.' },
      { title: 'Trạch đấu gia tộc', content: 'Nhấn mạnh quy tắc tông môn/ gia pháp, vai vế trong nhà. Giữ phép tắc lễ nghi, xưng hô chị-em-thím-cô chuẩn Việt.' },
      { title: 'Mưu kế và phản đòn', content: 'Chuyển tải mưu kế theo trình tự: dàn cảnh → gài bẫy → phản đòn. Lời thoại sắc lạnh, ẩn ý; tránh tóm tắt.' },
    ],
  },
  {
    group: 'translate',
    category: 'Dịch · Đam mỹ / Bách hợp (CN)',
    prompts: [
      { title: 'Cảm xúc tinh tế', content: 'Giữ chất giọng mềm, chú trọng nhịp thở, ánh mắt, cử chỉ. Dịch xưng hô phù hợp (hắn/y, y/nàng), tránh hiện đại hóa quá mức.' },
      { title: 'CP động thái', content: 'Làm rõ vai trò công/thụ hoặc switch; tôn trọng thiết lập giới (abo/giới giả). Giữ cảnh thân mật trọn vẹn, không né tránh.' },
      { title: 'Mâu thuẫn nội tâm', content: 'Đào sâu độc thoại nội tâm, day dứt, giằng xé. Giữ nguyên ẩn dụ/câu lửng của tác giả.' },
    ],
  },
  {
    group: 'adult',
    category: 'Prompt 18+ · Cổ đại / Tiên hiệp',
    prompts: [
      { title: 'Cổ phong cấm dục', content: 'Giữ giọng cổ phong, quyến rũ và nhiều sức gợi. Đào sâu cảm giác cấm dục, lễ pháp, thân phận và sự giằng co giữa lý trí với ham muốn. Khi vào cảnh thân mật, nhấn mạnh ánh mắt, tay áo, tóc, hơi thở, khí tức và sự mất kiểm soát dần của nội tâm.' },
      { title: 'Tiên hiệp song tu / linh lực', content: 'Nếu bối cảnh có tu luyện, hãy gắn cảm giác thân mật với khí tức, linh lực, tâm ma, song tu hoặc phản phệ. Miêu tả phản ứng cơ thể và tinh thần thật liền mạch, để cảnh 18+ vừa nóng vừa đúng chất tiên hiệp.' },
      { title: 'Dư âm sau cảnh', content: 'Sau cảnh thân mật, luôn để lại dư vị như xấu hổ, chấp niệm, lệ thuộc, ràng buộc đạo lữ hoặc tâm ma bùng lên. Không kết thúc cụt ở hành động; phải có hậu quả cảm xúc và quan hệ.' },
    ],
  },
  {
    group: 'translate',
    category: 'Dịch · Light Novel / Isekai (JP)',
    prompts: [
      { title: 'Isekai phiêu lưu', content: 'Giữ cách xưng “ore/atashi/boku” thành tôi/tớ phù hợp bối cảnh. Giữ nguyên skill/đòn đánh tiếng Anh/Nhật nếu là tên riêng. Nhịp nhanh, hài hước nhẹ.' },
      { title: 'Slice of life học đường', content: 'Giữ không khí nhẹ nhàng, hội thoại đời thường. Xưng hô bạn/hậu bối/đàn anh; giữ honorifics (-san, -kun, -senpai) khi cần.' },
      { title: 'Shounen/Seinen hành động', content: 'Miêu tả chi tiết combat, tốc độ cao; giữ tên tuyệt kỹ. Tránh lạm dụng từ Hán Việt, ưu tiên ngắn gọn.' },
    ],
  },
  {
    group: 'translate',
    category: 'Dịch · Kinh dị / Linh dị (CN/JP)',
    prompts: [
      { title: 'Không khí rùng rợn', content: 'Dịch giữ nhịp chậm, âm thanh, mùi, ánh sáng. Tránh giải thích thừa, để khoảng trống cho sự sợ hãi.' },
      { title: 'Phong tục/đạo thuật', content: 'Giữ nguyên thuật ngữ phong thủy, trận pháp, bùa chú; thêm chú giải ngắn nếu cần. Giọng kể nghiêm, tiết chế hài hước.' },
      { title: 'Điều tra siêu nhiên', content: 'Bố cục: hiện trường → manh mối → giả thuyết → đối chứng. Giữ chi tiết pháp y/logic điều tra.' },
    ],
  },
  // Writing prompts
  {
    group: 'write',
    category: 'Viết · Plot 3 hồi nhanh',
    prompts: [
      { title: 'Khởi động chương 1', content: 'Mở cảnh bằng mâu thuẫn lớn, thiết lập mục tiêu nhân vật và hook độc giả trong 120 từ. Giữ giọng nhất quán với outline đã có.' },
      { title: 'Leo thang xung đột', content: 'Tăng stakes bằng biến cố không đảo ngược, cắt cảnh trên đỉnh điểm. Nhịp nhanh, câu ngắn.' },
      { title: 'Kết chương hook', content: 'Đóng chương bằng câu hỏi mở/đe doạ/twist. Không giải thích dài dòng.' },
    ],
  },
  {
    group: 'write',
    category: 'Viết · Cung đấu/Trạch đấu',
    prompts: [
      { title: 'Mưu kế lớp lang', content: 'Xây 3 tầng kế: bẫy lộ → bẫy mồi → bẫy ẩn. Giữ thoại sắc bén, cài ẩn ý trong phép tắc.' },
      { title: 'Cảm xúc bị kìm nén', content: 'Miêu tả chi tiết ánh mắt, bàn tay, lễ nghi; cảm xúc giấu dưới lớp vỏ lễ độ.' },
      { title: 'Tiết tấu chậm căng', content: 'Nhịp vừa/chậm, trọng miêu tả cảnh trí, trang phục, bối cảnh quyền lực.' },
    ],
  },
  {
    group: 'write',
    category: 'Viết · Trinh thám/ly kỳ',
    prompts: [
      { title: 'Manh mối rải đều', content: 'Mỗi cảnh phải rải một clue hữu hình + một red herring. Giữ timeline logic, đánh số clue.' },
      { title: 'Điểm nhìn điều tra', content: 'Giữ POV nhất quán (thám tử hoặc người kể khách quan), tránh all-knowing.' },
      { title: 'Kịch tính cuối cảnh', content: 'Đóng cảnh bằng phát hiện bất ngờ hoặc mâu thuẫn mới để chuyển cảnh mượt.' },
    ],
  },
  {
    group: 'write',
    category: 'Viết · Romance chậm burn / Đam mỹ',
    prompts: [
      { title: 'Chemistry tinh tế', content: 'Tập trung vào khoảng cách cơ thể, ánh mắt, im lặng ngắn. Ít thổ lộ trực diện, nhiều hành động ngầm.' },
      { title: 'Nhịp cảm xúc', content: 'Lên xuống cảm xúc: căng → xả → căng. Giữ lời thoại ngắn, nhiều subtext.' },
      { title: 'Bối cảnh đời thường', content: 'Đặt tương tác vào sinh hoạt nhỏ (nấu ăn, đi chợ, chăm sóc khi ốm) để tăng gần gũi.' },
    ],
  },
  {
    group: 'adult',
    category: 'Prompt 18+ · Đô thị / Hiện đại',
    prompts: [
      { title: 'Đô thị nóng và trực diện', content: 'Giữ giọng hiện đại, trực diện hơn nhưng vẫn mượt và có nhịp. Nhấn vào khoảng cách cơ thể, giọng nói, bàn tay, nhịp thở, phản ứng da thịt, sự ngập ngừng rồi bị hút về. Hành động nào cũng phải kéo theo phản ứng nội tâm hoặc phản ứng thân thể rõ ràng.' },
      { title: 'Chiếm hữu, ghen và nghiện cảm giác', content: 'Nếu đúng cốt truyện, làm rõ lớp cảm xúc như ghen, chiếm hữu, nghiện cảm giác, tự dằn vặt, bối rối sau gần gũi. Giữ câu chữ quyến rũ, có khoảng lặng, không được biến cảnh 18+ thành một đoạn kể khô hay quá thô.' },
      { title: 'Hậu quả cảm xúc sau gần gũi', content: 'Sau cảnh thân mật phải có dư âm như ngại ngùng, lệ thuộc, né tránh, ám ảnh, muốn tiến thêm hoặc sợ mất đối phương. Để cảnh 18+ đẩy quan hệ đi tiếp, không chỉ đứng riêng như fanservice.' },
    ],
  },
  {
    group: 'write',
    category: 'Viết · Webnovel hệ thống / gamer',
    prompts: [
      { title: 'Bảng trạng thái', content: 'Luôn cập nhật bảng status sau mỗi milestone. Dùng bullet gọn. Tránh lặp dài dòng.' },
      { title: 'Phần thưởng & lựa chọn', content: 'Đưa ra 2-3 lựa chọn phần thưởng, ghi rõ ưu/nhược, để nhân vật quyết định. Giữ giọng vui nhộn.' },
      { title: 'Nhiệm vụ nhánh', content: 'Tạo side-quest ngắn tăng tốc độ, kết nối main quest. Giữ pacing nhanh.' },
    ],
  },
  // Common prompts
  {
    group: 'common',
    category: 'Chung · Glossary/Thuật ngữ',
    prompts: [
      { title: 'Khóa glossary', content: 'Trước khi viết/dịch, liệt kê và khóa tất cả thuật ngữ bắt buộc. Không tự ý đổi tên riêng. Nếu sai, tự sửa bằng regex fallback.' },
      { title: 'Nhất quán xưng hô', content: 'Kiểm tra và chuẩn hóa xưng hô theo bảng quy ước; giữ consistent trong toàn chương.' },
      { title: 'Kiểm lỗi nhanh', content: 'Quét lặp từ, câu quá dài, dấu câu bất thường; đề xuất sửa ngắn gọn.' },
    ],
  },
  {
    group: 'common',
    category: 'Chung · Mệnh lệnh tuyệt đối (áp dụng mọi tác vụ)',
    prompts: [
      { title: 'Mệnh lệnh TUYỆT ĐỐI', content: `Luôn tuân thủ thứ tự ưu tiên: (1) Quy tắc thể loại, (2) Kho Name, (3) Glossary/term lock, (4) Timeline/continuity. Không thay đổi/phiên âm sai tên riêng hoặc thuật ngữ đã khóa. Giữ nguyên fact, không bịa sự kiện mới. Nếu thiếu dữ liệu, hỏi lại hoặc đánh dấu [thiếu dữ liệu] thay vì bịa.` },
    ],
  },
  {
    group: 'common',
    category: 'Chung · Tuyệt đối CẤM',
    prompts: [
      { title: 'Những điều CẤM', content: `Cấm thêm nội dung nhạy cảm/18+ nếu đầu vào không có. Cấm chèn quảng cáo, link, contact. Cấm tiết lộ khóa API, token, thông tin cá nhân. Cấm bịa brand/giải thưởng/nhân vật thật. Cấm dịch/viết theo phong cách khác nhóm thể loại đã chọn. Nếu gặp yêu cầu trái luật hoặc vi phạm bản quyền, từ chối và cảnh báo.` },
    ],
  },
  {
    group: 'tone_rules',
    category: 'Quy tắc thể loại (soát giọng & từ vựng)',
    prompts: [
      { title: 'Cổ đại/Cung đấu/Giang hồ/Tiên hiệp', content: `Giọng: cổ phong, ước lệ; không wow/emoji. Xưng hô tôn ti (trẫm/vi thần/thần thiếp, bổn vương, tại hạ, sư tôn–đồ đệ); cấm mày-tao/ông-bạn. Từ vựng: Hán Việt chọn lọc (linh căn, sát chiêu), cấm công nghệ/meme. Cấu trúc: câu 2-3 vế, tả cảnh rồi tâm/cơ mưu; nhịp chậm-trung. Không cắt cảnh như MV.` },
      { title: 'Hiện đại/Đô thị/Hào môn/Giải trí', content: `Giọng: trực diện, nhịp nhanh; hào môn lạnh/sang, giải trí bóng bẩy. Từ: đời thường + business/showbiz (deal, rating, scandal) đúng cảnh; cấm Hán Việt cổ, viết tắt chat. Xưng: tôi-anh-em-cô; sếp/giám đốc khi công sở. Cấu trúc: đoạn 3-6 câu, thoại nhiều; cấm độc thoại dài >1/3 cảnh, cấm quá 2 brand/đoạn.` },
      { title: 'Võng du/Khoa học viễn tưởng/Dị năng', content: `Giọng: lý tính, hệ thống rõ. Từ: game chuẩn (level, cooldown, buff/debuff, PK, dungeon), sci-fi (cơ giáp, gene, warp). Cấm bùa tiên hiệp. Cấu trúc: log/bảng trạng thái ngắn; giải thích cơ chế ≤5 câu rồi có ví dụ. Dị năng phải có giới hạn (tầm, CD, cost).` },
      { title: 'Ngược luyến/Bi kịch/Báo thù/Hắc bang', content: `Giọng: trầm, gai; câu ngắn xen dài. Từ: u ám (rạn nứt, nghẹt thở); xưng khoảng cách (tôi-anh, hắn-cô ấy, tao-mày khi xung đột). Cấm đùa/meme, cấm tô hồng bạo lực. Cấu trúc: nhịp gấp cảnh truy sát, chậm ở hồi tưởng; kết quả trả giá rõ (pháp lý/đạo đức).` },
      { title: 'Hài kịch/Oan gia/Chủng điền', content: `Giọng: sáng, dí dỏm; chủng điền ấm & chậm. Từ: đời thường, chơi chữ nhẹ; cấm tục/meme thô. Cấu trúc: set-up → punchline 2-3 câu; chủng điền tả quy trình (gieo/chăm/thu). Oan gia: đối đáp kéo–đẩy, không để một phía thắng mãi. Cấm bi kịch hóa quá mức.` },
      { title: 'Trọng sinh/Xuyên không/Đồng nhân', content: `Giọng: hai lớp nhận thức (cũ vs mới). Từ: nghĩ hiện đại, nói theo bối cảnh; đồng nhân giữ khẩu đầu từ gốc. Cấm OOC không lý do. Cấu trúc: hồi tưởng ≤3 câu/cảnh; đối chiếu timeline. Vật phẩm/kiến thức xuyên sang phải có giới hạn; sự kiện gốc fandom phải được tôn trọng, thay đổi lớn cần điểm ngoặt hợp lý.` },
    ],
  },
];

const PROMPT_GROUP_TABS: Array<{ key: PromptGroup, label: string }> = [
  { key: 'common', label: 'Quy tắc Cốt lõi' },
  { key: 'tone_rules', label: 'Theo Thể loại' },
  { key: 'adult', label: 'Prompt 18+' },
];

type MasterItem = { id: string; title: string; content: string };

const PromptLibraryModal = ({ isOpen, onClose, onSelect }: { isOpen: boolean, onClose: () => void, onSelect: (prompt: string) => void }) => {
  const [selectedGroup, setSelectedGroup] = useState<PromptGroup>('common');
  const [coreRules, setCoreRules] = useState<MasterItem[]>([
    { id: 'terms', title: 'Danh từ riêng / Thuật ngữ', content: '- Giữ nguyên tên riêng, thuật ngữ khóa (Kho Name/Glossary).\n- Không phiên âm sai; nếu thiếu mapping, giữ nguyên gốc.\n- Thêm chú thích ngắn trong ngoặc khi cần làm rõ.' },
    { id: 'must', title: 'Yêu cầu bắt buộc', content: '- Ưu tiên: Quy tắc thể loại → Kho Name → Glossary/Term lock → Timeline.\n- Không bịa sự kiện khi thiếu dữ liệu; đánh dấu [thiếu dữ liệu] nếu cần.\n- Giữ consistency nhân xưng, địa danh, mốc thời gian.' },
    { id: 'blacklist', title: 'Các điều cấm (Blacklist)', content: '- Cấm thêm 18+/nhạy cảm nếu đầu vào không có.\n- Cấm chèn link/contact/quảng cáo/API key.\n- Cấm sai lệch fact gốc, phá OOC không lý do.\n- Cấm meme, viết tắt chat trong văn bản.' },
  ]);
  const [genreRules, setGenreRules] = useState<MasterItem[]>([
    { id: 'co-dai', title: 'Cổ đại / Tiên hiệp', content: '- Giọng văn: Cổ phong, ước lệ; nhịp chậm-trung.\n- Xưng hô: tôn ti (trẫm/vi thần/thần thiếp, bổn vương/tại hạ...).\n- Từ vựng: Hán Việt chọn lọc; tránh công nghệ/meme.\n- Cấu trúc: câu 2-3 vế, tả cảnh → tâm/cơ mưu.\n- Cấm: wow/emoji, tiếng lóng, pha tiếng Anh.' },
    { id: 'hien-dai', title: 'Hiện đại / Hào môn', content: '- Giọng văn: Nhanh, trực diện; hào môn lạnh/sang.\n- Xưng hô: tôi/anh/em/cô + chức danh (sếp/giám đốc).\n- Từ vựng: business/showbiz đúng cảnh; tránh Hán Việt cổ.\n- Cấu trúc: đoạn 3-6 câu, nhiều thoại.\n- Cấm: viết tắt chat (ko, j), lạm dụng brand >2/đoạn.' },
    { id: 'khoa-hoc', title: 'Võng du / Khoa học', content: '- Giọng văn: Lý tính, hệ thống rõ.\n- Xưng hô: linh hoạt theo thế giới thật/ảo.\n- Từ vựng: game chuẩn (level, cooldown, buff/debuff, PK), sci-fi (cơ giáp, gene, warp).\n- Cấu trúc: log/bảng trạng thái ngắn; ví dụ sau mô tả.\n- Cấm: bùa/thuật tiên hiệp mơ hồ; số liệu không khớp.' },
  ]);
  const [adultRules, setAdultRules] = useState<MasterItem[]>([
    { id: 'adult-ancient', title: '18+ · Cổ đại / Tiên hiệp', content: '- Giọng văn: cổ phong, quyến rũ, giàu sức gợi nhưng vẫn mềm và sang.\n- Xưng hô: giữ tôn ti, thân phận và chất cổ đại; tránh từ hiện đại hoặc quá thô.\n- Nội tâm: đào sâu cảm giác kìm nén, cấm dục, rung động, chiếm hữu, day dứt, cảm giác phạm giới hoặc vượt lễ pháp.\n- Miêu tả: tập trung ánh mắt, tay áo, đầu ngón tay, hơi thở, vạt áo, tóc, nhiệt độ da, khí tức, linh lực dao động.\n- Nhịp cảnh: chậm ở mở đầu, căng dần ở phần tiếp xúc, cao trào phải có cảm giác mất kiểm soát nhưng vẫn liền mạch.\n- Dư âm: sau cảnh thân mật cần có xấu hổ, chấp niệm, ràng buộc, tâm ma hoặc thay đổi quan hệ.\n- Cấm: dùng tiếng lóng hiện đại, câu chữ chợ búa, mô tả cơ học như liệt kê động tác.' },
    { id: 'adult-modern', title: '18+ · Đô thị / Hiện đại', content: '- Giọng văn: trực diện hơn cổ đại nhưng vẫn mượt, gợi cảm, có nhịp và có tiết chế.\n- Xưng hô: tự nhiên theo bối cảnh hiện đại; phải đúng tuổi, vai vế, quan hệ và mức độ thân mật.\n- Nội tâm: nhấn mạnh ham muốn, giằng co, ghen tuông, chiếm hữu, nghiện cảm giác, ngại ngùng hoặc tự dằn vặt sau gần gũi.\n- Miêu tả: chú ý ánh mắt, nhịp thở, tiếng nói, khoảng cách cơ thể, ngón tay, phản ứng da thịt, run nhẹ, né tránh rồi lại bị hút về.\n- Nhịp cảnh: mở nhanh hơn, nhiều kéo đẩy cảm xúc, phản ứng phải nối tiếp hành động chứ không rời rạc.\n- Dư âm: sau cảnh 18+ phải còn hậu quả tâm lý hoặc bước ngoặt quan hệ, không kết thúc cụt.\n- Cấm: viết như checklist động tác, lặp từ thô, biến nhân vật thành vô hồn hoặc mất tự nhiên.' },
  ]);
  const [selectedCoreId, setSelectedCoreId] = useState('terms');
  const [selectedGenreId, setSelectedGenreId] = useState('co-dai');
  const [selectedAdultId, setSelectedAdultId] = useState('adult-ancient');
  const [draftContent, setDraftContent] = useState<string>('');

  const getGroupList = (group: PromptGroup) => {
    if (group === 'common') return coreRules;
    if (group === 'adult') return adultRules;
    return genreRules;
  };

  const getSelectedIdForGroup = (group: PromptGroup) => {
    if (group === 'common') return selectedCoreId;
    if (group === 'adult') return selectedAdultId;
    return selectedGenreId;
  };

  const setSelectedIdForGroup = (group: PromptGroup, id: string) => {
    if (group === 'common') {
      setSelectedCoreId(id);
      return;
    }
    if (group === 'adult') {
      setSelectedAdultId(id);
      return;
    }
    setSelectedGenreId(id);
  };

  const setListForGroup = (group: PromptGroup, nextList: MasterItem[]) => {
    if (group === 'common') {
      setCoreRules(nextList);
      return;
    }
    if (group === 'adult') {
      setAdultRules(nextList);
      return;
    }
    setGenreRules(nextList);
  };

  useEffect(() => {
    const list = getGroupList(selectedGroup);
    const picked = list.find((i) => i.id === getSelectedIdForGroup(selectedGroup)) || list[0];
    setDraftContent(picked?.content || '');
  }, [adultRules, coreRules, genreRules, selectedAdultId, selectedCoreId, selectedGenreId, selectedGroup]);

  const currentList = getGroupList(selectedGroup);
  const selectedId = getSelectedIdForGroup(selectedGroup);
  const selectedItem = currentList.find((i) => i.id === selectedId) || currentList[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="tf-modal-panel bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center gap-3 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-indigo-100 rounded-xl">
              <Library className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-xl font-serif font-bold tf-break-long">Kho Prompt (Yêu cầu AI)</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full shadow-sm">
            <Plus className="w-6 h-6 rotate-45 text-slate-400" />
          </button>
        </div>

        <div className="px-4 md:px-6 pt-3 bg-slate-900 text-slate-100 border-b border-slate-800 tf-scroll-tabs flex gap-2">
          {PROMPT_GROUP_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedGroup(tab.key)}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold tracking-wide transition-all border border-slate-800 whitespace-nowrap',
                selectedGroup === tab.key ? 'bg-indigo-600 text-white shadow' : 'bg-slate-800 text-slate-200 hover:bg-slate-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        <div className="tf-modal-content flex flex-col md:flex-row flex-1 overflow-hidden min-h-[420px] bg-slate-950 text-slate-100">
          {/* Sidebar */}
          <div className="w-full md:w-[32%] border-b md:border-b-0 md:border-r border-slate-800 bg-slate-900 overflow-y-auto p-4 space-y-2">
            {currentList.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedIdForGroup(selectedGroup, item.id);
                  setDraftContent(item.content);
                }}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-xl font-semibold transition-all border border-transparent tf-break-long",
                  selectedId === item.id
                    ? "bg-indigo-600 text-white border-indigo-500 shadow"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                )}
              >
                {item.title}
              </button>
            ))}
            <button
              onClick={() => {
                const id = `new-${Date.now()}`;
                const title = selectedGroup === 'common' ? 'Quy tắc mới' : selectedGroup === 'adult' ? 'Prompt 18+ mới' : 'Nhóm mới';
                const newItem: MasterItem = { id, title, content: '' };
                setListForGroup(selectedGroup, [...currentList, newItem]);
                setSelectedIdForGroup(selectedGroup, id);
                setDraftContent('');
              }}
              className="mt-4 w-full px-4 py-3 rounded-xl border border-dashed border-indigo-500 text-indigo-200 hover:bg-indigo-500/10"
            >
              + Thêm {selectedGroup === 'common' ? 'quy tắc' : selectedGroup === 'adult' ? 'prompt 18+' : 'nhóm'} mới
            </button>
          </div>
          
          {/* Content */}
          <div className="w-full md:w-[68%] p-4 md:p-6 overflow-y-auto relative">
            <div className="flex items-center justify-between mb-4">
              <input
                value={selectedItem?.title || ''}
                onChange={(e) => {
                  const nextList = currentList.map((i) => i.id === selectedId ? { ...i, title: e.target.value } : i);
                  setListForGroup(selectedGroup, nextList);
                }}
                className="text-xl font-bold bg-transparent border-b border-slate-700 focus:border-indigo-400 outline-none w-full tf-break-long"
              />
            </div>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder={selectedGroup === 'common'
                ? '- Ghi rõ quy tắc bắt buộc...\n- ...'
                : selectedGroup === 'adult'
                  ? '- Giọng văn 18+: ...\n- Nội tâm: ...\n- Phản ứng: ...\n- Điều cấm: ...'
                : '- Giọng văn: ...\n- Xưng hô: ...\n- Từ vựng: ...\n- Cấm: ...'}
            className="w-full min-h-[260px] rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 outline-none resize-y tf-mobile-textarea"
            />
            <div className="flex justify-end gap-3 mt-4 tf-modal-actions">
              <button
                onClick={() => {
                  onSelect(draftContent);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-800 text-sm font-semibold"
              >
                Sao chép & đóng
              </button>
              <button
                onClick={() => {
                  const nextList = currentList.map((i) => i.id === selectedId ? { ...i, content: draftContent } : i);
                  setListForGroup(selectedGroup, nextList);
                  notifyApp({ tone: 'success', message: 'Đã lưu thay đổi' });
                }}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const ExportStoryModal = ({
  isOpen,
  onClose,
  format,
  onFormatChange,
  includeToc,
  onToggleToc,
  onConfirm,
  busy,
  storyTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  includeToc: boolean;
  onToggleToc: (v: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
  storyTitle: string;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[220] tf-modal-overlay flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="tf-modal-panel bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Xuất truyện</p>
            <h3 className="text-2xl font-serif font-bold text-slate-900 tf-break-long">{storyTitle || 'Truyện'}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="tf-modal-content p-6 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Định dạng</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['txt', 'epub'] as ExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => onFormatChange(fmt)}
                  className={cn(
                    'px-4 py-3 rounded-2xl border text-sm font-bold transition-all',
                    format === fmt
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200',
                  )}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={includeToc}
              onChange={(e) => onToggleToc(e.target.checked)}
            />
            <span className="text-sm text-slate-600">Bao gồm mục lục (nhảy đến chương)</span>
          </label>
          <p className="text-xs text-slate-400">EPUB sẽ tạo nav.xhtml với liên kết tới từng chương. TXT sẽ chèn mục lục dạng danh sách.</p>
        </div>
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 tf-modal-actions">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border text-sm font-bold text-slate-600 hover:bg-slate-100">
            Hủy
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? 'Đang xuất...' : 'Tải xuống'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const AuthModal = ({
  isOpen,
  onClose,
  mode,
  onModeChange,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onProvider,
  onForgotPassword,
  busy,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onModeChange: (m: 'login' | 'register') => void;
  email: string;
  password: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  onProvider: (p: 'google' | 'discord') => void;
  onForgotPassword: () => void;
  busy: boolean;
  error?: string;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[230] tf-modal-overlay flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="tf-modal-panel bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</p>
            <h3 className="text-2xl font-serif font-bold text-slate-900">TruyenForge Account</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="tf-modal-content p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => onModeChange('login')}
              className={cn(
                'py-2 rounded-xl font-bold text-sm border',
                mode === 'login' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200',
              )}
            >
              Đăng nhập
            </button>
            <button
              onClick={() => onModeChange('register')}
              className={cn(
                'py-2 rounded-xl font-bold text-sm border',
                mode === 'register' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
              )}
            >
              Đăng ký
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Mật khẩu"
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
            {mode === 'login' ? (
              <button
                type="button"
                className="text-xs font-semibold text-indigo-600 hover:underline"
                onClick={onForgotPassword}
              >
                Quên mật khẩu?
              </button>
            ) : null}
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => onProvider('google')}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold hover:border-indigo-200 hover:text-indigo-700 transition-all"
            >
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-5 h-5" />
              Google
            </button>
            <button
              type="button"
              onClick={() => onProvider('discord')}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold hover:border-indigo-200 hover:text-indigo-700 transition-all"
            >
              <img src="https://www.svgrepo.com/show/353655/discord-icon.svg" alt="" className="w-5 h-5" />
              Discord
            </button>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 tf-modal-actions">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border text-sm font-bold text-slate-600 hover:bg-slate-100">
            Hủy
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

interface TranslateStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: { 
    isAdult: boolean, 
    additionalInstructions: string,
    useDictionary: boolean,
    chapteringMode: 'auto' | 'words',
    wordsPerChapter: number,
    chapterRangeStart: number,
    chapterRangeEnd: number,
    autoSafeModeEnabled: boolean,
    checkpointEveryChunks: number,
  }) => void;
  fileName: string;
  fileContent: string;
  lastGateReport?: TranslationReleaseGateReport | null;
}

const AiFileActionModal = ({
  isOpen,
  onClose,
  onChooseTranslate,
  onChooseContinue,
  fileName,
  contentLength,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChooseTranslate: () => void;
  onChooseContinue: () => void;
  fileName: string;
  contentLength: number;
}) => {
  if (!isOpen) return null;

  const isLargeFile = contentLength >= 50000;

  return (
    <div className="fixed inset-0 z-[120] tf-modal-overlay flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="tf-modal-panel bg-white w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="p-6 md:p-8 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-slate-900 tracking-tight">Chọn cách xử lý file</h2>
              <p className="mt-1 text-sm text-slate-500 tf-break-all">File: {fileName}</p>
              <p className="mt-2 text-xs text-slate-400">
                Tệp đã được đọc xong. Chọn một luồng rõ ràng để hệ thống mở đúng bảng thiết lập.
              </p>
            </div>
            <button onClick={onClose} className="rounded-2xl p-3 transition-colors hover:bg-white">
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="tf-modal-content p-6 md:p-8 overflow-y-auto space-y-4">
          {isLargeFile ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              File khá lớn, nên app sẽ bật chế độ chia lô an toàn hơn để giảm lỗi khi dịch hoặc viết tiếp.
            </div>
          ) : null}

          <button
            onClick={onChooseTranslate}
            className="w-full rounded-[28px] border border-indigo-200 bg-indigo-50 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-100"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-indigo-600 p-3 text-white shadow-lg shadow-indigo-900/20">
                <Languages className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-bold text-slate-900">Dịch truyện</p>
                <p className="text-sm text-slate-600">
                  Dùng khi file là truyện gốc cần dịch sang tiếng Việt. Hệ thống sẽ tự chia chương, chia lô và giữ từ điển tên riêng.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={onChooseContinue}
            className="w-full rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-amber-600 p-3 text-white shadow-lg shadow-amber-900/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-bold text-slate-900">Viết tiếp truyện</p>
                <p className="text-sm text-slate-600">
                  Dùng khi file là phần truyện đã có sẵn và bạn muốn AI phân tích để viết thêm các chương tiếp theo.
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="p-6 md:p-8 border-t border-slate-100 bg-slate-50/70 tf-modal-actions">
          <button
            onClick={onClose}
            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-6 py-4 text-sm font-bold text-slate-600 transition-all hover:bg-slate-100"
          >
            Đóng
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const TranslateStoryModal: React.FC<TranslateStoryModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  fileContent,
  lastGateReport,
}) => {
  const [isAdult, setIsAdult] = useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [useDictionary, setUseDictionary] = useState(true);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [chapteringMode, setChapteringMode] = useState<'auto' | 'words'>('auto');
  const [wordsPerChapter, setWordsPerChapter] = useState(3000);
  const [chapterRangeStart, setChapterRangeStart] = useState(1);
  const [chapterRangeEnd, setChapterRangeEnd] = useState(1);
  const [safetySettings, setSafetySettings] = useState<TranslationSafetyProfileSettings>(() => loadTranslationSafetyProfileSettings());

  const sourceAnalysis = React.useMemo(() => {
    const normalized = String(fileContent || '').replace(/\r\n/g, '\n').trim();
    const charCount = normalized.length;
    const wordCount = countWords(normalized);
    const paragraphCount = normalized ? normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length : 0;
    const detectedChapters = detectChapterSections(normalized);
    const hasClearChapterStructure = detectedChapters.length >= 2;
    return {
      charCount,
      wordCount,
      paragraphCount,
      detectedChapterCount: detectedChapters.length,
      hasClearChapterStructure,
    };
  }, [fileContent]);

  useEffect(() => {
    if (!isOpen) return;
    setChapteringMode(sourceAnalysis.hasClearChapterStructure ? 'auto' : 'words');
  }, [isOpen, sourceAnalysis.hasClearChapterStructure]);

  useEffect(() => {
    if (!isOpen) return;
    if (chapterRangeStart <= chapterRangeEnd) return;
    setChapterRangeEnd(chapterRangeStart);
  }, [chapterRangeStart, chapterRangeEnd, isOpen]);

  const estimatedChapterCount = React.useMemo(() => {
    if (!sourceAnalysis.charCount) return 0;
    if (sourceAnalysis.hasClearChapterStructure) {
      return sourceAnalysis.detectedChapterCount;
    }
    if (chapteringMode === 'words') {
      const sections = splitTextIntoParagraphBoundChaptersByWords(fileContent, wordsPerChapter);
      return sections.length;
    }
    return 1;
  }, [chapteringMode, wordsPerChapter, fileContent, sourceAnalysis.charCount, sourceAnalysis.detectedChapterCount, sourceAnalysis.hasClearChapterStructure]);

  useEffect(() => {
    if (!isOpen) return;
    const total = Math.max(1, estimatedChapterCount || 1);
    setChapterRangeStart((prev) => Math.max(1, Math.min(total, prev || 1)));
    setChapterRangeEnd((prev) => Math.max(1, Math.min(total, prev || total)));
  }, [isOpen, estimatedChapterCount]);

  if (!isOpen) return null;

  return (
    <>
      <PromptLibraryModal 
        isOpen={showPromptLibrary} 
        onClose={() => setShowPromptLibrary(false)} 
        onSelect={(prompt) => setAdditionalInstructions(prev => prev ? prev + '\n' + prompt : prompt)} 
      />
      <div className="fixed inset-0 z-[100] tf-modal-overlay flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="tf-modal-panel bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 md:p-8 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          <div className="min-w-0">
            <h2 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Dịch truyện bằng AI</h2>
            <p className="text-slate-500 mt-1 font-medium tf-break-all">File: {fileName}</p>
            <p className="text-xs text-slate-400 mt-1">Hệ thống sẽ tự nhận diện mốc chương và tự chia phần nếu file quá dài.</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-colors shadow-sm">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        <div className="tf-modal-content p-6 md:p-8 overflow-y-auto space-y-8">
          {lastGateReport ? (
            <div className={cn(
              'rounded-2xl border px-4 py-4 space-y-2',
              lastGateReport.pass ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50',
            )}>
              <p className={cn(
                'text-sm font-bold',
                lastGateReport.pass ? 'text-emerald-800' : 'text-rose-800',
              )}>
                Kiểm tra chất lượng gần nhất: {lastGateReport.pass ? 'Đạt' : 'Chưa đạt'}
              </p>
              <p className={cn(
                'text-xs',
                lastGateReport.pass ? 'text-emerald-700' : 'text-rose-700',
              )}>
                Chương: {lastGateReport.stats.chapterCount} · Ký tự tiếng Trung còn sót: {lastGateReport.stats.cjkChars} ·
                Dòng trộn ngôn ngữ: {lastGateReport.stats.mixedLineCount}
              </p>
              {!lastGateReport.pass ? (
                <div className="space-y-1">
                  {lastGateReport.blockingIssues.slice(0, 4).map((issue, idx) => (
                    <p key={`${issue.code}-${issue.chapterOrder || 0}-${idx}`} className="text-xs text-rose-700">
                      - {issue.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 space-y-3">
              <p className="text-sm font-bold text-indigo-900">Cấu hình an toàn cho file lớn</p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={safetySettings.autoSafeModeEnabled}
                  onChange={(e) => {
                    const next = { ...safetySettings, autoSafeModeEnabled: e.target.checked };
                    setSafetySettings(next);
                    saveTranslationSafetyProfileSettings(next);
                  }}
                />
                Tự động bật chế độ an toàn theo độ nặng file
              </label>
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Checkpoint mỗi bao nhiêu chunk
                <input
                  type="number"
                  min={3}
                  max={30}
                  step={1}
                  value={safetySettings.checkpointEveryChunks}
                  onChange={(e) => {
                    const next = {
                      ...safetySettings,
                      checkpointEveryChunks: Math.max(3, Math.min(30, Number(e.target.value) || 10)),
                    };
                    setSafetySettings(next);
                    saveTranslationSafetyProfileSettings(next);
                  }}
                  className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Phân tích file trước khi dịch</p>
              <p className="mt-2 text-sm text-slate-700">
                Hệ thống nhận diện được <span className="font-bold">{sourceAnalysis.detectedChapterCount}</span> mốc chương
                {sourceAnalysis.hasClearChapterStructure ? ' rõ ràng' : ' (chưa rõ ràng)'} ·{' '}
                <span className="font-bold">{sourceAnalysis.paragraphCount}</span> đoạn ·{' '}
                <span className="font-bold">{sourceAnalysis.wordCount.toLocaleString('vi-VN')}</span> từ.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Tham chiếu kỹ thuật: {sourceAnalysis.charCount.toLocaleString('vi-VN')} ký tự.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Dự kiến sẽ tạo khoảng <span className="font-semibold">{estimatedChapterCount}</span> chương để dịch.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 space-y-3">
              <p className="text-sm font-bold text-indigo-900">Phạm vi chương cần dịch</p>
              <p className="text-xs text-indigo-800">
                Bạn có thể dịch theo khoảng chương mong muốn. Ví dụ: file 30 chương chỉ dịch từ chương 10 đến 20.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Từ chương
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, estimatedChapterCount || 1)}
                    step={1}
                    value={chapterRangeStart}
                    onChange={(e) => {
                      const total = Math.max(1, estimatedChapterCount || 1);
                      const next = Math.max(1, Math.min(total, Number(e.target.value) || 1));
                      setChapterRangeStart(next);
                      if (next > chapterRangeEnd) setChapterRangeEnd(next);
                    }}
                    className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Đến chương
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, estimatedChapterCount || 1)}
                    step={1}
                    value={chapterRangeEnd}
                    onChange={(e) => {
                      const total = Math.max(1, estimatedChapterCount || 1);
                      const next = Math.max(1, Math.min(total, Number(e.target.value) || total));
                      setChapterRangeEnd(next);
                      if (next < chapterRangeStart) setChapterRangeStart(next);
                    }}
                    className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                  />
                </label>
              </div>
              <p className="text-xs text-indigo-700">
                Sẽ dịch khoảng <span className="font-bold">{Math.max(1, chapterRangeEnd - chapterRangeStart + 1)}</span> chương trong phạm vi đã chọn.
              </p>
            </div>

            {!sourceAnalysis.hasClearChapterStructure ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-3">
                <p className="text-sm font-bold text-amber-900">File chưa có mốc chương rõ ràng</p>
                <p className="text-xs text-amber-800">
                  Bạn có thể tách chương theo số từ. Hệ thống sẽ giữ trọn đoạn văn: vượt mốc mới chỉ cắt ở đầu đoạn kế tiếp.
                </p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="translate-chaptering-mode"
                      checked={chapteringMode === 'words'}
                      onChange={() => setChapteringMode('words')}
                    />
                    Tách theo số từ/chương
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="translate-chaptering-mode"
                      checked={chapteringMode === 'auto'}
                      onChange={() => setChapteringMode('auto')}
                    />
                    Không tách thủ công (dịch dạng 1 chương lớn)
                  </label>
                </div>
                {chapteringMode === 'words' ? (
                  <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                    Số từ mục tiêu cho mỗi chương
                    <input
                      type="number"
                      min={300}
                      max={12000}
                      step={50}
                      value={wordsPerChapter}
                      onChange={(e) => setWordsPerChapter(Math.max(300, Math.min(12000, Number(e.target.value) || 3000)))}
                      className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                File đã có cấu trúc chương rõ, hệ thống sẽ ưu tiên giữ nguyên chương gốc.
              </div>
            )}

            <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-100 transition-all cursor-pointer group">
              <div className={cn(
                "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                useDictionary ? "bg-indigo-600 border-indigo-600" : "border-slate-300 group-hover:border-indigo-300"
              )}>
                {useDictionary && <Check className="w-4 h-4 text-white" />}
              </div>
              <input 
                type="checkbox" 
                className="hidden" 
                checked={useDictionary}
                onChange={(e) => setUseDictionary(e.target.checked)}
              />
              <div>
                <span className="font-bold text-slate-700 block text-lg">Sử dụng từ điển tên riêng</span>
                <span className="text-sm text-slate-500">Áp dụng các quy tắc dịch tên nhân vật đã lưu</span>
              </div>
            </label>

            <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-slate-100 hover:border-rose-100 transition-all cursor-pointer group">
              <div className={cn(
                "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                isAdult ? "bg-rose-500 border-rose-500" : "border-slate-300 group-hover:border-rose-300"
              )}>
                {isAdult && <Check className="w-4 h-4 text-white" />}
              </div>
              <input 
                type="checkbox" 
                className="hidden" 
                checked={isAdult}
                onChange={(e) => setIsAdult(e.target.checked)}
              />
              <div>
                <span className="font-bold text-slate-700 block text-lg">Nội dung 18+</span>
                <span className="text-sm text-slate-500">Cho phép AI dịch các nội dung nhạy cảm, bạo lực</span>
              </div>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Yêu cầu bổ sung cho AI
              </label>
              <button 
                onClick={() => setShowPromptLibrary(true)}
                className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline"
              >
                <Library className="w-3 h-3" /> Kho Prompt
              </button>
            </div>
            <textarea 
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              placeholder="Ví dụ: Dịch theo phong cách kiếm hiệp, giữ nguyên các từ Hán Việt,..."
              className="w-full h-32 p-5 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none font-medium tf-mobile-textarea"
            />
          </div>
        </div>

        <div className="p-6 md:p-8 bg-slate-50/50 border-t border-slate-100 flex gap-4 tf-modal-actions">
          <button 
            onClick={onClose}
            className="flex-1 px-8 py-4 rounded-2xl bg-white border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-100 transition-all"
          >
            Hủy bỏ
          </button>
          <button 
            onClick={() => onConfirm({
              isAdult,
              additionalInstructions,
              useDictionary,
              chapteringMode,
              wordsPerChapter,
              chapterRangeStart,
              chapterRangeEnd,
              autoSafeModeEnabled: safetySettings.autoSafeModeEnabled,
              checkpointEveryChunks: safetySettings.checkpointEveryChunks,
            })}
            className="flex-1 px-8 py-4 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-900/20"
          >
            Bắt đầu dịch
          </button>
        </div>
      </motion.div>
    </div>
    </>
  );
};

const AIContinueStoryModal = ({ 
  isOpen, 
  onClose, 
  onConfirm,
  fileName
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (options: {
    chapterCount: number,
    isAdult: boolean,
    additionalInstructions: string,
    selectedRuleId?: string
  }) => void,
  fileName: string
}) => {
  const { user } = useAuth();
  const [chapterCount, setChapterCount] = useState(5);
  const [isAdult, setIsAdult] = useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [aiRules, setAiRules] = useState<AIRule[]>([]);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      const rules = storage
        .getAIRules()
        .filter((rule: AIRule) => rule.authorId === user.uid)
        .sort((a: AIRule, b: AIRule) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
      setAiRules(rules);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  return (
    <>
      <PromptLibraryModal 
        isOpen={showPromptLibrary} 
        onClose={() => setShowPromptLibrary(false)} 
        onSelect={(prompt) => setAdditionalInstructions(prev => prev ? prev + '\n' + prompt : prompt)} 
      />
      <div className="fixed inset-0 z-[100] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="tf-modal-panel bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="tf-modal-content p-6 md:p-8 overflow-y-auto">
          <div className="flex justify-between items-center gap-3 mb-6">
            <div className="min-w-0">
              <h3 className="text-2xl font-serif font-bold text-slate-900">Viết tiếp truyện</h3>
              <p className="text-sm text-slate-500 mt-1 tf-break-all">File: <span className="font-bold text-indigo-600">{fileName}</span></p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>

          <div className="space-y-6 pr-2 custom-scrollbar">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3">Số lượng chương muốn viết tiếp</label>
              <div className="flex items-center gap-4">
                <input 
                  type="range" 
                  min="1" 
                  max="20" 
                  value={chapterCount} 
                  onChange={(e) => setChapterCount(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="w-12 text-center font-bold text-indigo-600 bg-indigo-50 py-1 rounded-lg">{chapterCount}</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="font-bold text-slate-800">Nội dung người lớn (18+)</p>
                  <p className="text-xs text-slate-500">Cho phép AI viết các cảnh nhạy cảm, bạo lực</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAdult(!isAdult)}
                className={cn(
                  "w-12 h-6 rounded-full transition-all relative",
                  isAdult ? "bg-red-500" : "bg-slate-300"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  isAdult ? "left-7" : "left-1"
                )} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-600" />
                Áp dụng AI Rules
              </label>
              <select 
                value={selectedRuleId}
                onChange={(e) => setSelectedRuleId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
              >
                <option value="">Không áp dụng</option>
                {aiRules.map(rule => (
                  <option key={rule.id} value={rule.id}>{rule.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1 ml-1 italic">AI Rules giúp định hướng văn phong và quy tắc viết cho AI.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-bold text-slate-700">Yêu cầu bổ sung (tùy chọn)</label>
                <button 
                  onClick={() => setShowPromptLibrary(true)}
                  className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline"
                >
                  <Library className="w-3 h-3" /> Kho Prompt
                </button>
              </div>
              <textarea 
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder="VD: Tập trung vào phát triển tình cảm giữa A và B, hoặc thêm một nhân vật phản diện mới..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-24 resize-none text-sm tf-mobile-textarea"
              />
            </div>
          </div>

          <div className="flex gap-4 mt-8 tf-modal-actions">
            <button 
              onClick={onClose}
              className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
            >
              Hủy
            </button>
            <button 
              onClick={() => onConfirm({ chapterCount, isAdult, additionalInstructions, selectedRuleId })}
              className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Bắt đầu phân tích & viết tiếp
            </button>
          </div>
        </div>
      </motion.div>
    </div>
    </>
  );
};

const AIStoryCreationModal = ({ 
  isOpen, 
  onClose, 
  onConfirm,
  fileName
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (options: {
    genre: string,
    pacing: string,
    tone: string,
    isAdult: boolean,
    customPacing?: string,
    customTone?: string,
    perspective: string,
    audience: string,
    styleReference: string
  }) => void,
  fileName: string
}) => {
  const [genre, setGenre] = useState('');
  const [pacing, setPacing] = useState('normal');
  const [tone, setTone] = useState('dramatic');
  const [isAdult, setIsAdult] = useState(false);
  const [customPacing, setCustomPacing] = useState('');
  const [customTone, setCustomTone] = useState('');
  const [perspective, setPerspective] = useState('third-person');
  const [audience, setAudience] = useState('general');
  const [styleReference, setStyleReference] = useState('');
  const [showStyleLibrary, setShowStyleLibrary] = useState(false);
  const [isExtractingStyle, setIsExtractingStyle] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);

  const handleStyleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingStyle(true);
    try {
      let content = '';
      if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        content = await extractDocxText(arrayBuffer);
      } else {
        content = await file.text();
      }
      setStyleReference(content);
    } catch (error) {
      notifyApp({ tone: 'error', message: 'Lỗi khi đọc file: ' + error });
    } finally {
      setIsExtractingStyle(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <PromptLibraryModal 
        isOpen={showPromptLibrary} 
        onClose={() => setShowPromptLibrary(false)} 
        onSelect={(prompt) => setGenre(prev => prev ? prev + ', ' + prompt : prompt)} 
      />
      <div className="fixed inset-0 z-[150] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="tf-modal-panel bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-6 md:p-8 border-b border-slate-100 bg-indigo-50/30">
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <h3 className="text-2xl font-serif font-bold text-slate-900">Thiết lập truyện mới</h3>
              <p className="text-sm text-indigo-600 mt-1 flex items-center gap-2 tf-break-all">
                <FileText className="w-4 h-4" /> {fileName}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors shadow-sm">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="tf-modal-content p-6 md:p-8 space-y-6 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-bold text-slate-700">Thể loại mong muốn / Yêu cầu thêm</label>
              <button 
                onClick={() => setShowPromptLibrary(true)}
                className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 flex items-center gap-1"
              >
                <Library className="w-3 h-3" /> Kho Prompt
              </button>
            </div>
            <input 
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Ví dụ: Tiên hiệp, Đô thị, Hệ thống, Ngôn tình..."
              className="w-full p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Nhịp điệu</label>
              <select 
                value={pacing}
                onChange={(e) => setPacing(e.target.value)}
                className="w-full p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="slow">Chậm rãi / Chi tiết</option>
                <option value="normal">Vừa phải / Cân bằng</option>
                <option value="fast">Nhanh / Dồn dập</option>
                <option value="custom">Tùy chỉnh...</option>
              </select>
              {pacing === 'custom' && (
                <input 
                  type="text"
                  value={customPacing}
                  onChange={(e) => setCustomPacing(e.target.value)}
                  placeholder="Nhập nhịp điệu riêng..."
                  className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Giọng văn</label>
              <select 
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="dramatic">Kịch tính</option>
                <option value="humorous">Hài hước</option>
                <option value="poetic">Thơ mộng</option>
                <option value="dark">U tối</option>
                <option value="mystery">Bí ẩn</option>
                <option value="custom">Tùy chỉnh...</option>
              </select>
              {tone === 'custom' && (
                <input 
                  type="text"
                  value={customTone}
                  onChange={(e) => setCustomTone(e.target.value)}
                  placeholder="Nhập giọng văn riêng..."
                  className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-sm"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Góc nhìn</label>
              <select 
                value={perspective}
                onChange={(e) => setPerspective(e.target.value)}
                className="w-full p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="first-person">Ngôi thứ nhất (Tôi)</option>
                <option value="third-person">Ngôi thứ ba (Hắn/Cô ấy)</option>
                <option value="omniscient">Ngôi thứ ba (Toàn tri)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Đối tượng độc giả</label>
              <select 
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="w-full p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="general">Đại chúng</option>
                <option value="teen">Thanh thiếu niên</option>
                <option value="adult">Người trưởng thành</option>
                <option value="hardcore">Độc giả lâu năm</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Phân loại nội dung</label>
            <div className="flex gap-4">
              <button 
                onClick={() => setIsAdult(false)}
                className={cn(
                  "flex-1 py-3 rounded-xl font-bold transition-all border",
                  !isAdult ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                )}
              >
                Bình thường
              </button>
              <button 
                onClick={() => setIsAdult(true)}
                className={cn(
                  "flex-1 py-3 rounded-xl font-bold transition-all border",
                  isAdult ? "bg-red-600 text-white border-red-600 shadow-lg shadow-red-900/20" : "bg-white text-slate-500 border-slate-200 hover:border-red-300"
                )}
              >
                Truyện 18+
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-bold text-slate-700">Văn mẫu tham khảo (Style Reference)</label>
              <div className="flex gap-2">
                <label className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200 cursor-pointer transition-colors">
                  {isExtractingStyle ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  Tải file
                  <input type="file" accept=".docx,.txt" onChange={handleStyleFileUpload} className="hidden" />
                </label>
                <button 
                  onClick={() => setShowStyleLibrary(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors"
                >
                  <Library className="w-3 h-3" />
                  Thư viện
                </button>
              </div>
            </div>
            <textarea 
              value={styleReference}
              onChange={(e) => setStyleReference(e.target.value)}
              placeholder="Dán một đoạn văn mẫu bạn muốn AI bắt chước phong cách..."
              className="w-full h-24 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm tf-mobile-textarea"
            />
          </div>

          {showStyleLibrary && (
            <div className="fixed inset-0 z-[200] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="tf-modal-panel bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              >
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-xl font-serif font-bold">Thư viện văn mẫu</h3>
                  <button onClick={() => setShowStyleLibrary(false)} className="p-2 hover:bg-slate-100 rounded-full">
                    <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                  </button>
                </div>
                <div className="tf-modal-content p-6 overflow-y-auto">
                  <StyleReferenceLibrary 
                    onSelect={(content) => {
                      setStyleReference(content);
                      setShowStyleLibrary(false);
                    }} 
                  />
                </div>
              </motion.div>
            </div>
          )}
        </div>

        <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-100 tf-modal-actions">
          <button 
            onClick={() => onConfirm({ genre, pacing, tone, isAdult, customPacing, customTone, perspective, audience, styleReference })}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-3"
          >
            <Sparkles className="w-5 h-5" />
            Tạo truyện bằng AI
          </button>
        </div>
      </motion.div>
    </div>
    </>
  );
};

const AIGenerationModal = ({ 
  isOpen, 
  onClose, 
  onGenerate,
  initialOutline = "",
  isAdult: initialIsAdult = false,
  lastChapterContent = ""
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onGenerate: (options: {
    outline: string, 
    chapterLength: string, 
    chapterCount: number, 
    isAdult: boolean,
    pacing: string,
    tone: string,
    focus: string,
    predictPlot: boolean,
    customPacing?: string,
    customTone?: string,
    customFocus?: string,
    selectedCharacters: string[],
    keyEvents: string,
    previousContext: string,
    perspective: string,
    audience: string,
    styleReference: string,
    aiInstructions: string,
    chapterScript: string,
    bannedPhrases: string,
    selectedRuleId?: string
  }) => void,
  initialOutline?: string,
  isAdult?: boolean,
  storyId?: string,
  lastChapterContent?: string
}) => {
  const { user } = useAuth();
  const [outline, setOutline] = useState(initialOutline);
  const [chapterLength, setChapterLength] = useState('1000');
  const [chapterCount, setChapterCount] = useState(1);
  const [isAdult, setIsAdult] = useState(initialIsAdult);
  const [pacing, setPacing] = useState('normal');
  const [tone, setTone] = useState('dramatic');
  const [focus, setFocus] = useState('plot');
  const [predictPlot, setPredictPlot] = useState(false);
  const [customPacing, setCustomPacing] = useState('');
  const [customTone, setCustomTone] = useState('');
  const [customFocus, setCustomFocus] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [keyEvents, setKeyEvents] = useState('');
  const [previousContext, setPreviousContext] = useState(lastChapterContent);
  const [perspective, setPerspective] = useState('third-person');
  const [audience, setAudience] = useState('general');
  const [styleReference, setStyleReference] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [chapterScript, setChapterScript] = useState('');
  const [bannedPhrases, setBannedPhrases] = useState(DEFAULT_FORBIDDEN_CLICHE_PHRASES.join('\n'));
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [aiRules, setAiRules] = useState<AIRule[]>([]);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isSuggestingOutline, setIsSuggestingOutline] = useState(false);
  const [showStyleLibrary, setShowStyleLibrary] = useState(false);
  const [isExtractingStyle, setIsExtractingStyle] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setOutline(initialOutline);
      setIsAdult(initialIsAdult);
      setPreviousContext(lastChapterContent);
      setShowAdvancedOptions(false);
    }
  }, [isOpen, initialOutline, initialIsAdult, lastChapterContent]);

  const readinessSignals = [
    {
      label: 'Dàn ý / ý tưởng chính',
      ready: Boolean(outline.trim()) || predictPlot,
      hint: predictPlot ? 'Đang bật chế độ dự đoán mạch truyện.' : 'Đây là đầu vào ảnh hưởng mạnh nhất đến chất lượng.',
    },
    {
      label: 'Bối cảnh trước đó',
      ready: Boolean(previousContext.trim()),
      hint: 'Giúp AI giữ continuity, tránh lặp lại hoặc nhảy mạch.',
    },
    {
      label: 'Chỉ đạo AI / Prompt hệ thống',
      ready: Boolean(aiInstructions.trim()) || Boolean(selectedRuleId),
      hint: 'Dùng để khóa style, giới hạn và yêu cầu bắt buộc.',
    },
    {
      label: 'Kịch bản hoặc văn mẫu',
      ready: Boolean(chapterScript.trim()) || Boolean(styleReference.trim()),
      hint: 'Rất hữu ích khi muốn giữ nhịp điệu và giọng văn ổn định.',
    },
  ];
  const readinessCount = readinessSignals.filter((item) => item.ready).length;
  const readinessLabel = readinessCount >= 4 ? 'Rất tốt' : readinessCount >= 3 ? 'Ổn định' : readinessCount >= 2 ? 'Tạm ổn' : 'Cần thêm context';
  const readinessClassName = readinessCount >= 4
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : readinessCount >= 3
      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
      : readinessCount >= 2
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-rose-200 bg-rose-50 text-rose-700';

  const handleGenerateScript = async () => {
    if (!outline.trim()) {
      notifyApp({ tone: 'warn', message: "Vui lòng nhập dàn ý trước khi tạo kịch bản." });
      return;
    }
    setIsGeneratingScript(true);
    try {
      const ai = createGeminiClient('auxiliary');
      const scriptText = await generateGeminiText(
        ai,
        'quality',
        `Dựa trên dàn ý sau, hãy xây dựng một kịch bản chi tiết cho chương này. 
        Kịch bản nên bao gồm các cảnh chính, diễn biến tâm lý và các điểm mấu chốt.
        
        Dàn ý: ${outline}
        Chỉ dẫn thêm: ${aiInstructions}
        
        Trả về kịch bản dưới dạng văn bản Markdown.`,
        {
          maxOutputTokens: 5200,
          minOutputChars: 700,
          maxRetries: 2,
          safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
        },
      );
      setChapterScript(scriptText || '');
    } catch (error) {
      console.error("Script generation failed", error);
      notifyApp({ tone: 'error', message: "Không thể tạo kịch bản." });
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleSuggestOutline = async () => {
    setIsSuggestingOutline(true);
    try {
      const ai = createGeminiClient('auxiliary');
      const outlineText = await generateGeminiText(
        ai,
        'quality',
        `Dựa trên nội dung chương trước, hãy gợi ý một dàn ý ngắn gọn cho chương tiếp theo.
        
        Nội dung chương trước: ${previousContext || "Đây là chương đầu tiên."}
        Chỉ dẫn thêm: ${aiInstructions}
        
        Trả về dàn ý dưới dạng danh sách gạch đầu dòng ngắn gọn.`,
        {
          maxOutputTokens: 2400,
          minOutputChars: 220,
          maxRetries: 2,
          safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
        },
      );
      setOutline(outlineText || '');
    } catch (error) {
      console.error("Outline suggestion failed", error);
      notifyApp({ tone: 'error', message: "Không thể gợi ý dàn ý." });
    } finally {
      setIsSuggestingOutline(false);
    }
  };

  const handleStyleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingStyle(true);
    try {
      let content = '';
      if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        content = await extractDocxText(arrayBuffer);
      } else {
        content = await file.text();
      }
      setStyleReference(content);
    } catch (error) {
      notifyApp({ tone: 'error', message: 'Lỗi khi đọc file: ' + error });
    } finally {
      setIsExtractingStyle(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      const nextCharacters = storage
        .getCharacters()
        .filter((character: Character) => character.authorId === user.uid);
      const nextRules = storage
        .getAIRules()
        .filter((rule: AIRule) => rule.authorId === user.uid)
        .sort((a: AIRule, b: AIRule) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
      setCharacters(nextCharacters);
      setAiRules(nextRules);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  return (
    <>
      <PromptLibraryModal 
        isOpen={showPromptLibrary} 
        onClose={() => setShowPromptLibrary(false)} 
        onSelect={(prompt) => setAiInstructions(prev => prev ? prev + '\n' + prompt : prompt)} 
      />
      <div className="fixed inset-0 z-[150] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="tf-modal-panel bg-white w-full max-w-3xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center gap-3 bg-slate-50/50">
          <div className="min-w-0">
            <h3 className="text-2xl font-serif font-bold text-slate-900">Tùy chỉnh viết chương AI</h3>
            <p className="text-sm text-slate-500 mt-1">Thiết lập phong cách và mạch truyện cho AI</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors shadow-sm">
            <Plus className="w-6 h-6 rotate-45 text-slate-400" />
          </button>
        </div>

        <div className="tf-modal-content p-6 md:p-8 overflow-y-auto space-y-8">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Writer Pro Guide</p>
                <h4 className="text-lg font-bold text-slate-900">3 thứ ảnh hưởng mạnh nhất tới chất lượng</h4>
                <p className="text-sm text-slate-600">
                  Ưu tiên điền theo thứ tự này: <strong>dàn ý</strong>, <strong>bối cảnh trước đó</strong>, rồi tới
                  <strong> chỉ đạo AI / văn mẫu</strong>. Phần còn lại là tinh chỉnh thêm, không bắt buộc ngay từ đầu.
                </p>
              </div>
              <div className={cn("rounded-2xl border px-4 py-3 text-sm font-semibold", readinessClassName)}>
                Mức sẵn sàng: {readinessLabel} ({readinessCount}/{readinessSignals.length})
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {readinessSignals.map((signal) => (
                <div
                  key={signal.label}
                  className={cn(
                    "rounded-2xl border px-4 py-3",
                    signal.ready ? "border-emerald-200 bg-white" : "border-slate-200 bg-white/80"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-800">{signal.label}</p>
                    <span className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em]",
                      signal.ready ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    )}>
                      {signal.ready ? 'Đã có' : 'Thiếu'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{signal.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="block text-sm font-bold text-slate-700">Dàn ý / Ý tưởng (Outline)</label>
                <button 
                  onClick={handleSuggestOutline}
                  disabled={isSuggestingOutline}
                  className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"
                >
                  {isSuggestingOutline ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Gợi ý dàn ý
                </button>
              </div>
              <button 
                onClick={() => {
                  const newPredict = !predictPlot;
                  setPredictPlot(newPredict);
                  if (newPredict && !outline.trim()) {
                    handleSuggestOutline();
                  }
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all",
                  predictPlot ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                )}
              >
                <Zap className="w-3 h-3" />
                {predictPlot ? "AI tự dự đoán mạch truyện: Bật" : "AI tự dự đoán mạch truyện: Tắt"}
              </button>
            </div>
            <textarea 
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder="Nhập dàn ý hoặc ý tưởng cho câu chuyện của bạn... (Dàn ý càng chi tiết, AI viết càng dài và hay)"
              className="w-full h-24 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-slate-700 tf-mobile-textarea"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-slate-700">Chỉ đạo AI (AI Instructions)</label>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowPromptLibrary(true)}
                    className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 flex items-center gap-1"
                  >
                    <Library className="w-3 h-3" /> Kho Prompt
                  </button>
                  <select 
                    value={selectedRuleId}
                    onChange={(e) => setSelectedRuleId(e.target.value)}
                    className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-1 rounded-lg border-none focus:ring-0"
                  >
                    <option value="">Áp dụng quy tắc hệ thống...</option>
                    {aiRules.map(rule => (
                      <option key={rule.id} value={rule.id}>{rule.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea 
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="Ví dụ: Tập trung vào miêu tả tâm lý, viết theo phong cách kiếm hiệp cổ điển..."
                className="w-full h-32 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm tf-mobile-textarea"
              />
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Cụm từ cấm (chống sáo rỗng)
                </label>
                <textarea
                  value={bannedPhrases}
                  onChange={(e) => setBannedPhrases(e.target.value)}
                  placeholder="Mỗi dòng một cụm từ cấm..."
                  className="w-full h-24 p-3 rounded-xl border border-rose-200 bg-rose-50/40 focus:ring-2 focus:ring-rose-400 resize-none text-xs tf-mobile-textarea"
                />
                <p className="text-[11px] text-slate-500">
                  Hệ thống sẽ ép AI tránh các cụm này và tự viết lại nếu còn dính.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-bold text-slate-700">Kịch bản chương (Script)</label>
                <button 
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript}
                  className="flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold hover:bg-indigo-100 transition-colors"
                >
                  {isGeneratingScript ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Tự xây dựng kịch bản
                </button>
              </div>
              <textarea 
                value={chapterScript}
                onChange={(e) => setChapterScript(e.target.value)}
                placeholder="Kịch bản chi tiết cho chương này (có thể tự viết hoặc dùng AI tạo)..."
                className="w-full h-32 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm tf-mobile-textarea"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">Cấu hình cơ bản</label>
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Độ dài chương</span>
                    <select 
                      value={chapterLength}
                      onChange={(e) => setChapterLength(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                    >
                      <option value="500">Ngắn (~500 từ)</option>
                      <option value="1000">Vừa (~1000 từ)</option>
                      <option value="2000">Dài (~2000 từ)</option>
                      <option value="3000">Rất dài (~3000 từ)</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Số lượng chương</span>
                    <input 
                      type="number" 
                      min="1" 
                      max="10"
                      value={chapterCount}
                      onChange={(e) => setChapterCount(parseInt(e.target.value))}
                      className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">Phân loại nội dung</label>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsAdult(false)}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border",
                      !isAdult ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    Bình thường
                  </button>
                  <button 
                    onClick={() => setIsAdult(true)}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border",
                      isAdult ? "bg-red-600 text-white border-red-600 shadow-lg shadow-red-900/20" : "bg-white text-slate-500 border-slate-200 hover:border-red-300"
                    )}
                  >
                    Truyện 18+
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Góc nhìn</label>
                  <select 
                    value={perspective}
                    onChange={(e) => setPerspective(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                  >
                    <option value="first-person">Ngôi thứ nhất (Tôi)</option>
                    <option value="third-person">Ngôi thứ ba (Hắn/Cô ấy)</option>
                    <option value="omniscient">Ngôi thứ ba (Toàn tri)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Đối tượng</label>
                  <select 
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                  >
                    <option value="general">Đại chúng</option>
                    <option value="teen">Thanh thiếu niên</option>
                    <option value="adult">Người trưởng thành</option>
                    <option value="hardcore">Độc giả lâu năm</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-bold text-slate-700">Bối cảnh trước đó (Previous Context)</label>
                <textarea 
                  value={previousContext}
                  onChange={(e) => setPreviousContext(e.target.value)}
                  placeholder="Tóm tắt các sự kiện đã diễn ra trước chương này để AI duy trì mạch truyện..."
                  className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none tf-mobile-textarea"
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[24px] border border-indigo-100 bg-indigo-50/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Tùy chỉnh nâng cao</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Mở phần này khi bạn muốn khóa chặt tone, pacing, nhân vật, sự kiện hoặc văn mẫu tham khảo.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAdvancedOptions((prev) => !prev)}
                    className={cn(
                      "rounded-full px-4 py-2 text-xs font-bold transition-colors",
                      showAdvancedOptions ? "bg-indigo-600 text-white" : "bg-white text-indigo-600 border border-indigo-200"
                    )}
                  >
                    {showAdvancedOptions ? 'Ẩn tùy chỉnh nâng cao' : 'Mở tùy chỉnh nâng cao'}
                  </button>
                </div>
              </div>

              {showAdvancedOptions ? (
                <>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">Phong cách viết</label>
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nhịp điệu (Pacing)</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['slow', 'normal', 'fast', 'custom'].map((p) => (
                        <button
                          key={p}
                          onClick={() => setPacing(p)}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-bold uppercase transition-all border",
                            pacing === p ? "bg-indigo-600 text-white border-indigo-600" : "bg-slate-50 text-slate-500 border-slate-100"
                          )}
                        >
                          {p === 'slow' ? 'Chậm' : p === 'fast' ? 'Nhanh' : p === 'custom' ? 'Tùy chỉnh' : 'Vừa'}
                        </button>
                      ))}
                    </div>
                    {pacing === 'custom' && (
                      <input 
                        type="text"
                        value={customPacing}
                        onChange={(e) => setCustomPacing(e.target.value)}
                        placeholder="Nhập nhịp điệu riêng..."
                        className="w-full mt-2 p-2 rounded-lg border border-slate-200 text-xs"
                      />
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Giọng văn (Tone)</span>
                    <div className="space-y-2">
                      <select 
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                        className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                      >
                        <option value="dramatic">Kịch tính / Nghiêm túc</option>
                        <option value="humorous">Hài hước / Trào phúng</option>
                        <option value="poetic">Lãng mạn / Thơ mộng</option>
                        <option value="dark">U tối / Kinh dị</option>
                        <option value="action-packed">Hành động / Dồn dập</option>
                        <option value="mystery">Bí ẩn / Hồi hộp</option>
                        <option value="custom">Tùy chỉnh riêng...</option>
                      </select>
                      {tone === 'custom' && (
                        <input 
                          type="text"
                          value={customTone}
                          onChange={(e) => setCustomTone(e.target.value)}
                          placeholder="Nhập giọng văn riêng..."
                          className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Trọng tâm chương (Focus)</span>
                    <div className="space-y-2">
                      <select 
                        value={focus}
                        onChange={(e) => setFocus(e.target.value)}
                        className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                      >
                        <option value="plot">Phát triển cốt truyện</option>
                        <option value="character">Phát triển nội tâm nhân vật</option>
                        <option value="world-building">Xây dựng thế giới / Bối cảnh</option>
                        <option value="dialogue">Tập trung vào đối thoại</option>
                        <option value="action">Tập trung vào hành động</option>
                        <option value="custom">Tùy chỉnh riêng...</option>
                      </select>
                      {focus === 'custom' && (
                        <input 
                          type="text"
                          value={customFocus}
                          onChange={(e) => setCustomFocus(e.target.value)}
                          placeholder="Nhập trọng tâm riêng..."
                          className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-sm text-slate-500">
                  Bạn đang ở chế độ cơ bản. Phần này đã ẩn bớt các nút ít quan trọng để dễ tập trung vào outline, context và chỉ đạo AI.
                </div>
              )}
            </div>
          </div>

          {showAdvancedOptions ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <label className="block text-sm font-bold text-slate-700">Nhân vật xuất hiện</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-slate-100 rounded-xl">
                    {characters.map(char => (
                      <button
                        key={char.id}
                        onClick={() => {
                          if (selectedCharacters.includes(char.id)) {
                            setSelectedCharacters(selectedCharacters.filter(id => id !== char.id));
                          } else {
                            setSelectedCharacters([...selectedCharacters, char.id]);
                          }
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-bold transition-all",
                          selectedCharacters.includes(char.id) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {char.name}
                      </button>
                    ))}
                    {characters.length === 0 && <p className="text-xs text-slate-400 italic">Chưa có nhân vật nào trong thư viện.</p>}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm font-bold text-slate-700">Sự kiện chính (Key Events)</label>
                  <textarea 
                    value={keyEvents}
                    onChange={(e) => setKeyEvents(e.target.value)}
                    placeholder="Các sự kiện bắt buộc xảy ra..."
                    className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none tf-mobile-textarea"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4 md:col-start-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-bold text-slate-700">Văn mẫu tham khảo (Style Reference)</label>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-200 cursor-pointer transition-colors">
                        {isExtractingStyle ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Tải file
                        <input type="file" accept=".docx,.txt" onChange={handleStyleFileUpload} className="hidden" />
                      </label>
                      <button 
                        onClick={() => setShowStyleLibrary(true)}
                        className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors"
                      >
                        <Library className="w-3 h-3" />
                        Thư viện
                      </button>
                    </div>
                  </div>
                  <textarea 
                    value={styleReference}
                    onChange={(e) => setStyleReference(e.target.value)}
                    placeholder="Dán một đoạn văn mẫu bạn muốn AI bắt chước phong cách..."
                    className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none tf-mobile-textarea"
                  />
                </div>

                {showStyleLibrary && (
                  <div className="fixed inset-0 z-[200] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="tf-modal-panel bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                    >
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="text-xl font-serif font-bold">Thư viện văn mẫu</h3>
                        <button onClick={() => setShowStyleLibrary(false)} className="p-2 hover:bg-slate-100 rounded-full">
                          <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                        </button>
                      </div>
                      <div className="tf-modal-content p-6 overflow-y-auto">
                        <StyleReferenceLibrary 
                          onSelect={(content) => {
                            setStyleReference(content);
                            setShowStyleLibrary(false);
                          }} 
                        />
                      </div>
                    </motion.div>
                  </div>
                )}
              </div>
            </>
          ) : null}

        </div>

        <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-100 tf-modal-actions space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Tối thiểu để chạy: có <strong>dàn ý</strong> hoặc bật <strong>AI tự dự đoán mạch truyện</strong>.
            Để kết quả ổn định hơn, nên thêm <strong>bối cảnh trước đó</strong> và <strong>chỉ đạo AI hoặc văn mẫu</strong>.
          </div>
          <button 
            onClick={() => onGenerate({
              outline, 
              chapterLength, 
              chapterCount, 
              isAdult,
              pacing,
              tone,
              focus,
              predictPlot,
              customPacing,
              customTone,
              customFocus,
              selectedCharacters,
              keyEvents,
              previousContext,
              perspective,
              audience,
              styleReference,
              aiInstructions,
              chapterScript,
              bannedPhrases,
              selectedRuleId
            })}
            disabled={!predictPlot && !outline.trim()}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <Sparkles className="w-5 h-5" />
            Bắt đầu tạo chương
          </button>
        </div>
      </motion.div>
    </div>
    </>
  );
};

const AppContent = () => {
  const { user, loading, login, logout, register, loginWithProvider, provider } = useAuth();
  const [appMode, setAppMode] = useState<AppMode>(() => loadAppMode());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() => loadViewportMode());
  const [profile, setProfile] = useState<UiProfile>(() => loadUiProfile(user?.displayName || undefined, user?.photoURL || undefined));
  const [finopsWarning, setFinopsWarning] = useState<string | undefined>(undefined);

  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [aiLoadingMessage, setAILoadingMessage] = useState('');
  const [aiLoadingStage, setAiLoadingStage] = useState('Đang chuẩn bị');
  const [aiLoadingDetail, setAiLoadingDetail] = useState('');
  const [aiLoadingProgress, setAiLoadingProgress] = useState<AiOverlayProgress | null>(null);
  const [aiTimer, setAiTimer] = useState(0);
  const [appToasts, setAppToasts] = useState<AppToast[]>([]);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showReleaseHistoryModal, setShowReleaseHistoryModal] = useState(false);
  const [showBackupCenterModal, setShowBackupCenterModal] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(profile.displayName);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState(profile.avatarUrl);
  const [profileAvatarError, setProfileAvatarError] = useState('');
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() => loadReaderPrefs(themeMode));
  const [readerActivityMap, setReaderActivityMap] = useState<Record<string, ReaderStoryActivity>>(() => loadReaderActivityMap(user?.uid));
  const [showReaderPrefsModal, setShowReaderPrefsModal] = useState(false);
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(() => loadBackupSettings());
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>([]);
  const [backupHistoryReady, setBackupHistoryReady] = useState(false);
  const [backupBusyAction, setBackupBusyAction] = useState('');
  const [accountLastSyncedAt, setAccountLastSyncedAt] = useState('');
  const [accountSyncQueueStats, setAccountSyncQueueStats] = useState<WorkspaceSyncQueueStats>({
    pending: 0,
    failed: 0,
    running: 0,
    nextRetryAt: null,
    lastSuccessAt: null,
  });
  const [driveAuth, setDriveAuth] = useState<GoogleDriveAuthState | null>(() => loadStoredDriveAuth());
  const [driveBinding, setDriveBinding] = useState<GoogleDriveBinding | null>(() => loadDriveBindingForUser(user?.uid));
  const [isUploadingProfileAvatar, setIsUploadingProfileAvatar] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportingStory, setIsExportingStory] = useState(false);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);
  const backupImportInputRef = useRef<HTMLInputElement>(null);
  const readerSearchInputRef = useRef<HTMLInputElement>(null);
  const readerDiscoveryControlsRef = useRef<HTMLDivElement>(null);
  const publicMetaLookupInFlightRef = useRef<Set<string>>(new Set());
  const activeAiRunRef = useRef<ActiveAiRun | null>(null);
  const toastTimeoutsRef = useRef<Map<string, number>>(new Map());
  const workspaceSyncRef = useRef({
    isHydrating: false,
    isSyncing: false,
    hasPendingSync: false,
    lastSerialized: '',
    lastErrorNotifiedAt: 0,
    lastSyncedAt: '',
    lastServerUpdatedAt: '',
    lastKnownRevision: 0,
    lastQueuedSectionHash: {} as Partial<Record<LocalWorkspaceSection, string>>,
    lastSyncedSectionHash: {} as Partial<Record<LocalWorkspaceSection, string>>,
  });
  const localBackupRestoreAttemptedRef = useRef<Set<string>>(new Set());
  const backupAutomationRef = useRef({
    isRestoring: false,
    lastFingerprint: '',
    startupSnapshotDone: false,
  });
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const prevLocationKeyRef = useRef<string>('');
  const lastHomeBackAttemptRef = useRef(0);
  const workspaceScopeRef = useRef<string>(getWorkspaceScopeUser());
  const syncUiTickRef = useRef(0);
  const workspaceDeviceIdRef = useRef<string>(getWorkspaceDeviceId());
  const activeStoryLockRef = useRef<WorkspaceEditLock | null>(null);
  const syncQueuePumpRef = useRef<{ timer: number | null; running: boolean }>({ timer: null, running: false });
  const queueStatsRefreshTimerRef = useRef<number | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const maintenanceConfigSignature = `${Number(MAINTENANCE_GLOBAL_ENABLED)}:${Number(MAINTENANCE_READER_ENABLED)}:${Number(MAINTENANCE_STUDIO_ENABLED)}:${MAINTENANCE_ETA}`;
  const [maintenanceNowMs, setMaintenanceNowMs] = useState(() => Date.now());
  const [maintenanceStartedAt, setMaintenanceStartedAt] = useState<number | null>(null);
  const maintenanceEtaAtMs = React.useMemo(() => parseMaintenanceEtaToMs(MAINTENANCE_ETA), []);
  const maintenanceConfigured = MAINTENANCE_GLOBAL_ENABLED || MAINTENANCE_READER_ENABLED || MAINTENANCE_STUDIO_ENABLED;
  const maintenanceExpiredByEta = maintenanceEtaAtMs !== null && maintenanceNowMs >= maintenanceEtaAtMs;
  const maintenanceGlobalActive = MAINTENANCE_GLOBAL_ENABLED && !maintenanceExpiredByEta;
  const maintenanceReaderActive = !maintenanceExpiredByEta && (maintenanceGlobalActive || MAINTENANCE_READER_ENABLED);
  const maintenanceStudioActive = !maintenanceExpiredByEta && (maintenanceGlobalActive || MAINTENANCE_STUDIO_ENABLED);
  const maintenanceCountdownMs = maintenanceEtaAtMs !== null ? Math.max(maintenanceEtaAtMs - maintenanceNowMs, 0) : null;

  useEffect(() => {
    setMaintenanceNowMs(Date.now());
  }, []);

  useEffect(() => {
    const cached = loadMaintenanceRuntimeState();
    if (!cached || cached.signature !== maintenanceConfigSignature) {
      setMaintenanceStartedAt(null);
      return;
    }
    setMaintenanceStartedAt(cached.startedAt);
  }, [maintenanceConfigSignature]);

  useEffect(() => {
    if (!maintenanceConfigured || maintenanceExpiredByEta) return;
    if (maintenanceStartedAt) return;
    const now = Date.now();
    const runtimeState: MaintenanceRuntimeState = {
      signature: maintenanceConfigSignature,
      startedAt: now,
    };
    saveMaintenanceRuntimeState(runtimeState);
    setMaintenanceStartedAt(now);
  }, [maintenanceConfigSignature, maintenanceConfigured, maintenanceExpiredByEta, maintenanceStartedAt]);

  useEffect(() => {
    if (!maintenanceConfigured || maintenanceEtaAtMs === null) return;
    const timer = window.setInterval(() => {
      setMaintenanceNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [maintenanceConfigured, maintenanceEtaAtMs]);

  const cachePublicStory = useCallback((story: Story) => {
    if (!story?.id) return;
    publicStoryCacheRef.current[String(story.id)] = story;
    setPublicStoryCacheVersion((prev) => prev + 1);
  }, []);

  const hydratePublicStoryFromRows = useCallback((storyRow: any, chapterRows: any[]): Story | null => {
    if (!storyRow || !storyRow.story_id) return null;
    const chapters: Chapter[] = (Array.isArray(chapterRows) ? chapterRows : [])
      .map((chapter: any) => ({
        id: String(chapter.chapter_id || ''),
        title: String(chapter.title || ''),
        content: String(chapter.content || ''),
        order: Number(chapter.sort_order || 0),
        aiInstructions: chapter.ai_instructions ? String(chapter.ai_instructions) : '',
        script: chapter.script ? String(chapter.script) : '',
        createdAt: chapter.created_at || new Date().toISOString(),
        updatedAt: chapter.updated_at || chapter.created_at || new Date().toISOString(),
      }))
      .filter((chapter) => chapter.id)
      .sort((a, b) => a.order - b.order);

    return {
      id: String(storyRow.story_id),
      slug: storyRow.slug ? String(storyRow.slug) : undefined,
      authorId: String(storyRow.user_id || ''),
      title: String(storyRow.title || 'Truyện chưa đặt tên'),
      content: String(storyRow.content || ''),
      coverImageUrl: storyRow.cover_image_url ? String(storyRow.cover_image_url) : undefined,
      type: (storyRow.type === 'translated' || storyRow.type === 'continued') ? storyRow.type : 'original',
      genre: storyRow.genre ? String(storyRow.genre) : '',
      introduction: storyRow.introduction ? String(storyRow.introduction) : '',
      expectedChapters: Number(storyRow.expected_chapters || 0),
      expectedWordCount: Number(storyRow.expected_word_count || 0),
      chapters,
      isPublic: Boolean(storyRow.is_public),
      isAdult: Boolean(storyRow.is_adult),
      isAI: Boolean(storyRow.is_ai),
      storyPromptNotes: storyRow.story_prompt_notes ? String(storyRow.story_prompt_notes) : '',
      characterRoster: Array.isArray(storyRow.character_roster) ? storyRow.character_roster : [],
      translationMemory: Array.isArray(storyRow.translation_memory) ? storyRow.translation_memory : [],
      createdAt: storyRow.created_at || new Date().toISOString(),
      updatedAt: storyRow.updated_at || storyRow.created_at || new Date().toISOString(),
    };
  }, []);

  const loadPublicStoryById = useCallback(async (storyId: string): Promise<Story | null> => {
    if (!hasSupabase) return null;
    const targetStoryId = String(storyId || '').trim();
    if (!targetStoryId) return null;
    const supabase = await getSupabaseClient();
    if (!supabase) return null;

    const { data: storyRow, error: storyError } = await supabase
      .from(SUPABASE_NORMALIZED_TABLES.stories)
      .select('story_id,slug,user_id,title,content,introduction,genre,type,is_public,is_adult,is_ai,expected_chapters,expected_word_count,story_prompt_notes,cover_image_url,character_roster,translation_memory,created_at,updated_at')
      .eq('story_id', targetStoryId)
      .eq('is_public', true)
      .maybeSingle();

    if (storyError || !storyRow) return null;

    const { data: chapterRows, error: chapterError } = await supabase
      .from(SUPABASE_NORMALIZED_TABLES.chapters)
      .select('chapter_id,title,content,sort_order,ai_instructions,script,created_at,updated_at')
      .eq('story_id', targetStoryId)
      .order('sort_order', { ascending: true });

    if (chapterError) return null;

    const story = hydratePublicStoryFromRows(storyRow, chapterRows || []);
    if (!story) return null;
    cachePublicStory(story);
    return story;
  }, [cachePublicStory, hydratePublicStoryFromRows, hasSupabase]);

  const loadPublicStoryBySlug = useCallback(async (storySlug: string): Promise<Story | null> => {
    if (!hasSupabase) return null;
    const normalizedSlug = sanitizeStorySlug(String(storySlug || '').trim());
    if (!normalizedSlug) return null;

    const cachedStories = Object.values(publicStoryCacheRef.current || {});
    const cached = cachedStories.find((story) => resolveStorySlug(story) === normalizedSlug) || null;
    if (cached) return cached;

    const supabase = await getSupabaseClient();
    if (!supabase) return null;

    const { data: row, error } = await supabase
      .from(SUPABASE_NORMALIZED_TABLES.stories)
      .select('story_id')
      .eq('is_public', true)
      .eq('slug', normalizedSlug)
      .maybeSingle();

    if (error || !row?.story_id) return null;
    return loadPublicStoryById(String(row.story_id));
  }, [hasSupabase, loadPublicStoryById]);

  const refreshPublicStoryFeed = useCallback(async () => {
    if (!hasSupabase) {
      setPublicStoryFeed([]);
      setPublicFeedError('Hệ thống chưa hoàn tất kết nối máy chủ nên chưa đọc được truyện công khai.');
      return;
    }
    setPublicFeedLoading(true);
    setPublicFeedError('');
    try {
      const supabase = await getSupabaseClient();
      if (!supabase) throw new Error('Không khởi tạo được Supabase client.');

      let query = supabase
        .from(SUPABASE_NORMALIZED_TABLES.stories)
        .select('story_id,slug,user_id,title,introduction,cover_image_url,type,genre,is_public,is_adult,expected_chapters,expected_word_count,created_at,updated_at')
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(PUBLIC_STORY_FEED_LIMIT);

      const { data: rows, error } = await query;
      if (error) throw error;

      const storyIds = (rows || []).map((row: any) => String(row.story_id || '')).filter(Boolean);
      let chapterCountMap: Record<string, number> = {};
      if (storyIds.length) {
        const { data: chapterRows } = await supabase
          .from(SUPABASE_NORMALIZED_TABLES.chapters)
          .select('story_id')
          .in('story_id', storyIds);
        chapterCountMap = (chapterRows || []).reduce((acc: Record<string, number>, row: any) => {
          const id = String(row.story_id || '');
          if (!id) return acc;
          acc[id] = (acc[id] || 0) + 1;
          return acc;
        }, {});
      }

      const feed: PublicStoryFeedItem[] = (rows || []).map((row: any) => ({
        id: String(row.story_id || ''),
        slug: row.slug ? String(row.slug) : undefined,
        authorId: String(row.user_id || ''),
        title: String(row.title || 'Truyện chưa đặt tên'),
        introduction: row.introduction ? String(row.introduction) : '',
        coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : undefined,
        type: (row.type === 'translated' || row.type === 'continued') ? row.type : 'original',
        genre: row.genre ? String(row.genre) : '',
        chapterCount: chapterCountMap[String(row.story_id || '')] || 0,
        expectedChapters: Number(row.expected_chapters || 0),
        expectedWordCount: Number(row.expected_word_count || 0),
        isAdult: Boolean(row.is_adult),
        createdAt: String(row.created_at || ''),
        updatedAt: String(row.updated_at || new Date().toISOString()),
      })).filter((item) => item.id);

      setPublicStoryFeed(feed);
    } catch (error) {
      setPublicStoryFeed([]);
      setPublicFeedError(error instanceof Error ? error.message : 'Không thể tải truyện công khai.');
    } finally {
      setPublicFeedLoading(false);
    }
  }, [hasSupabase, user?.uid]);

  useEffect(() => {
    setReaderActivityMap(loadReaderActivityMap(user?.uid));
  }, [user?.uid]);

  const updateReaderActivityMap = useCallback((
    story: Story,
    updater: (current: ReaderStoryActivity | null) => ReaderStoryActivity | null,
  ) => {
    const next = upsertReaderActivityEntry(user?.uid, story, updater);
    setReaderActivityMap((prev) => (areReaderActivityMapsEqual(prev, next) ? prev : next));
  }, [user?.uid]);

  const handleReaderMarkChapterRead = useCallback((story: Story, chapter: Chapter) => {
    updateReaderActivityMap(story, (current) => {
      const alreadyRead = Boolean(current?.readChapterIds?.includes(chapter.id));
      const currentTotal = Math.max(0, Number(current?.totalChapters || 0));
      const nextTotal = Math.max(0, Number(story.chapters?.length || 0));
      if (
        alreadyRead
        && current?.lastChapterId === chapter.id
        && current?.lastChapterOrder === (chapter.order || current?.lastChapterOrder || 0)
        && currentTotal === nextTotal
      ) {
        return null;
      }
      const readChapterIds = Array.from(new Set([
        ...(current?.readChapterIds || []),
        chapter.id,
      ]));
      return {
        storyId: story.id,
        storySlug: sanitizeStorySlug(story.slug || ''),
        storyTitle: story.title,
        coverImageUrl: story.coverImageUrl,
        type: story.type || 'original',
        genre: story.genre,
        readChapterIds,
        lastChapterId: chapter.id,
        lastChapterTitle: chapter.title || `Chương ${chapter.order}`,
        lastChapterOrder: chapter.order || readChapterIds.length,
        totalChapters: Math.max(0, Number(story.chapters?.length || 0)),
        followed: Boolean(current?.followed),
        lastReadAt: new Date().toISOString(),
      };
    });
  }, [updateReaderActivityMap]);

  const handleReaderToggleFollow = useCallback((story: Story, nextFollowed: boolean) => {
    updateReaderActivityMap(story, (current) => ({
      storyId: story.id,
      storySlug: sanitizeStorySlug(story.slug || ''),
      storyTitle: story.title,
      coverImageUrl: story.coverImageUrl,
      type: story.type || 'original',
      genre: story.genre,
      readChapterIds: current?.readChapterIds || [],
      lastChapterId: current?.lastChapterId || '',
      lastChapterTitle: current?.lastChapterTitle || '',
      lastChapterOrder: current?.lastChapterOrder || 0,
      totalChapters: Math.max(0, Number(story.chapters?.length || current?.totalChapters || 0)),
      followed: nextFollowed,
      lastReadAt: current?.lastReadAt || new Date().toISOString(),
    }));
    notifyApp({
      tone: 'success',
      message: nextFollowed
        ? `Đã theo dõi truyện "${story.title}".`
        : `Đã bỏ theo dõi truyện "${story.title}".`,
      groupKey: `reader-follow:${story.id}`,
    });
  }, [updateReaderActivityMap]);

  const openStoryFromReaderActivity = useCallback(async (activity: ReaderStoryActivity) => {
    const storyId = String(activity.storyId || '').trim();
    if (!storyId) return;

    const openStoryWithChapter = (story: Story) => {
      setSelectedStory(story);
      const storyPath = `/${resolveStorySlug(story)}`;
      const chapter = (story.chapters || []).find((row) => row.id === activity.lastChapterId) || null;
      if (chapter) {
        navigate(`${storyPath}/${getChapterRouteSlug(chapter)}`, { state: { storyId: story.id } });
        return;
      }
      navigate(storyPath, { state: { storyId: story.id } });
    };

    const localStory = storage.getStoryById(storyId) as Story | null;
    if (localStory) {
      openStoryWithChapter(localStory);
      return;
    }

    const remoteBySlug = activity.storySlug ? await loadPublicStoryBySlug(activity.storySlug) : null;
    if (remoteBySlug) {
      openStoryWithChapter(remoteBySlug);
      return;
    }

    const remoteById = await loadPublicStoryById(storyId);
    if (remoteById) {
      openStoryWithChapter(remoteById);
      return;
    }

    notifyApp({
      tone: 'warn',
      message: 'Không thể mở lại truyện từ lịch sử đọc. Truyện có thể đã bị xóa hoặc ẩn.',
      groupKey: `reader-history-open-failed:${storyId}`,
    });
  }, [loadPublicStoryById, loadPublicStoryBySlug, navigate]);

  useEffect(() => {
    saveAppMode(appMode);
  }, [appMode]);

  useEffect(() => {
    if (location.pathname.startsWith('/studio') && appMode !== 'creator') {
      setAppMode('creator');
    }
  }, [appMode, location.pathname]);

  const commitAccountSyncedAt = useCallback((syncedAt: string, force = false) => {
    workspaceSyncRef.current.lastSyncedAt = syncedAt;
    if (!force && !showBackupCenterModal) return;
    const now = Date.now();
    if (!force && now - syncUiTickRef.current < 5000) return;
    syncUiTickRef.current = now;
    setAccountLastSyncedAt(syncedAt);
  }, [showBackupCenterModal]);

  const applyAccountSyncQueueStats = useCallback((next: WorkspaceSyncQueueStats, force = false) => {
    setAccountSyncQueueStats((prev) => {
      const unchanged = prev.pending === next.pending
        && prev.failed === next.failed
        && prev.running === next.running
        && prev.nextRetryAt === next.nextRetryAt
        && prev.lastSuccessAt === next.lastSuccessAt
        && prev.lastError === next.lastError;
      if (unchanged) return prev;

      const hasQueueIssue = next.failed > 0 || next.pending > 0 || next.running > 0;
      if (!force && !showBackupCenterModal && !hasQueueIssue) {
        return prev;
      }
      return next;
    });
  }, [showBackupCenterModal]);

  const refreshAccountSyncQueueStats = useCallback(async () => {
    if (!user?.uid) {
      applyAccountSyncQueueStats({
        pending: 0,
        failed: 0,
        running: 0,
        nextRetryAt: null,
        lastSuccessAt: null,
      }, true);
      return;
    }
    try {
      const stats = await getWorkspaceSyncQueueStats(user.uid);
      applyAccountSyncQueueStats(stats);
    } catch (error) {
      console.warn('Không đọc được trạng thái queue autosync.', error);
    }
  }, [applyAccountSyncQueueStats, user?.uid]);

  const scheduleRefreshAccountSyncQueueStats = useCallback((delayMs = ACCOUNT_SYNC_QUEUE_STATS_DEBOUNCE_MS) => {
    if (typeof window === 'undefined') return;
    if (queueStatsRefreshTimerRef.current) {
      window.clearTimeout(queueStatsRefreshTimerRef.current);
    }
    queueStatsRefreshTimerRef.current = window.setTimeout(() => {
      queueStatsRefreshTimerRef.current = null;
      void refreshAccountSyncQueueStats();
    }, Math.max(0, delayMs));
  }, [refreshAccountSyncQueueStats]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isProcessingAI) {
      setAiTimer(0);
      interval = setInterval(() => {
        setAiTimer(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isProcessingAI]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const previousKey = prevLocationKeyRef.current;
    if (previousKey) {
      scrollPositionsRef.current[previousKey] = window.scrollY;
    }

    if (navigationType === 'POP') {
      const savedY = scrollPositionsRef.current[location.key] ?? 0;
      window.scrollTo(0, savedY);
    } else {
      window.scrollTo(0, 0);
    }

    prevLocationKeyRef.current = location.key;
  }, [location.key, navigationType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (location.pathname !== '/') return;

    if (!(window.history.state && window.history.state.tfHomeGuard)) {
      window.history.pushState({ ...(window.history.state || {}), tfHomeGuard: true }, '', window.location.href);
    }

    const handlePopOnHome = () => {
      const now = Date.now();
      if (now - lastHomeBackAttemptRef.current < 1600) {
        window.removeEventListener('popstate', handlePopOnHome);
        window.history.back();
        return;
      }
      lastHomeBackAttemptRef.current = now;
      notifyApp({
        tone: 'info',
        message: 'Bấm Back lần nữa để thoát ứng dụng.',
        groupKey: 'home-exit-guard',
      });
      window.history.pushState({ ...(window.history.state || {}), tfHomeGuard: true }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopOnHome);
    return () => window.removeEventListener('popstate', handlePopOnHome);
  }, [location.pathname]);

  const dismissToast = useCallback((groupKey: string) => {
    const existingTimer = toastTimeoutsRef.current.get(groupKey);
    if (typeof existingTimer === 'number') {
      window.clearTimeout(existingTimer);
      toastTimeoutsRef.current.delete(groupKey);
    }
    setAppToasts((prev) => prev.filter((item) => item.groupKey !== groupKey));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AppNoticePayload>).detail;
      if (!detail?.message) return;
      const groupKey = detail.groupKey || `${detail.tone || 'info'}:${detail.message}`;
      const toast: AppToast = {
        id: detail.id || groupKey,
        groupKey,
        title: detail.title,
        message: detail.message,
        detail: detail.detail,
        tone: detail.tone || 'info',
        timeoutMs: detail.timeoutMs ?? 3800,
        count: 1,
        persist: detail.persist,
      };
      setAppToasts((prev) => {
        const existingIndex = prev.findIndex((item) => item.groupKey === groupKey);
        if (existingIndex >= 0) {
          const next = [...prev];
          const current = next[existingIndex];
          next[existingIndex] = {
            ...current,
            ...toast,
            count: current.count + 1,
          };
          return next;
        }
        const next = [...prev, toast];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });

      const existingTimer = toastTimeoutsRef.current.get(groupKey);
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer);
      }
      if (!detail.persist) {
        const timeoutId = window.setTimeout(() => dismissToast(groupKey), toast.timeoutMs);
        toastTimeoutsRef.current.set(groupKey, timeoutId);
      }
    };
    window.addEventListener(APP_NOTICE_EVENT, handler as EventListener);
    return () => window.removeEventListener(APP_NOTICE_EVENT, handler as EventListener);
  }, [dismissToast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StorageSaveFailedDetail>).detail;
      if (!detail?.section) return;
      const estimatedMb = detail.estimatedBytes && detail.estimatedBytes > 0
        ? Math.max(1, Math.round(detail.estimatedBytes / 1024 / 1024))
        : 0;
      notifyApp({
        tone: 'error',
        message: 'Lưu dữ liệu thất bại: bộ nhớ cục bộ đã đầy hoặc bị từ chối ghi.',
        detail: estimatedMb
          ? `Mục lỗi: ${detail.section}. Kích thước ước tính khoảng ${estimatedMb}MB. Hãy Sao lưu ngay rồi dọn bớt dữ liệu cũ trước khi lưu lại.`
          : `Mục lỗi: ${detail.section}. Hãy Sao lưu ngay rồi dọn bớt dữ liệu cũ trước khi lưu lại.`,
        groupKey: `storage-save-failed:${detail.section}`,
        persist: true,
      });
    };
    window.addEventListener(STORAGE_SAVE_FAILED_EVENT, handler as EventListener);
    return () => window.removeEventListener(STORAGE_SAVE_FAILED_EVENT, handler as EventListener);
  }, []);

  useEffect(() => () => {
    toastTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    toastTimeoutsRef.current.clear();
  }, []);

  const refreshBackupHistory = useCallback(async () => {
    try {
      const items = await listBackupSnapshots(30);
      setBackupSnapshots(items);
      if (items[0]) {
        backupAutomationRef.current.lastFingerprint = createBackupFingerprint(items[0].payload);
        setBackupSettings((prev) => {
          const shouldReplace =
            !prev.lastSuccessfulBackupAt ||
            new Date(items[0].createdAt).getTime() > new Date(prev.lastSuccessfulBackupAt).getTime();
          return shouldReplace ? { ...prev, lastSuccessfulBackupAt: items[0].createdAt } : prev;
        });
      }
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không đọc được lịch sử sao lưu cục bộ.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-history-load-failed',
      });
    } finally {
      setBackupHistoryReady(true);
    }
  }, []);

  const closeBackupCenter = useCallback(() => {
    setShowBackupCenterModal(false);
    void refreshBackupHistory();
  }, [refreshBackupHistory]);

  const refreshWorkspaceUiFromStorage = useCallback(() => {
    const nextThemeMode = loadThemeMode();
    setProfile(loadUiProfile(user?.displayName || undefined, user?.photoURL || undefined));
    setThemeMode(nextThemeMode);
    setViewportMode(loadViewportMode());
    setReaderPrefs(loadReaderPrefs(nextThemeMode));
    setSelectedStory(null);
    setEditingStory(null);
    setIsCreating(false);
    bumpStoriesVersion();
  }, [user?.displayName, user?.photoURL]);

  const loadBoundDriveBinding = useCallback(async (): Promise<GoogleDriveBinding | null> => {
    const localBinding = loadDriveBindingForUser(user?.uid);
    if (!user || !hasSupabase) {
      setDriveBinding(localBinding);
      return localBinding;
    }

    try {
      const remoteSnapshot = await loadServerWorkspace<Partial<AccountWorkspaceSnapshot>>(user.uid);
      const remoteBinding = normalizeDriveBinding(remoteSnapshot.payload?.driveBinding);
      if (remoteBinding) {
        saveDriveBindingForUser(user.uid, remoteBinding);
        setDriveBinding(remoteBinding);
        return remoteBinding;
      }
    } catch (error) {
      console.warn('Không đọc được Drive binding từ tài khoản.', error);
    }

    setDriveBinding(localBinding);
    return localBinding;
  }, [user, hasSupabase]);

  const persistDriveBinding = useCallback(async (binding: GoogleDriveBinding | null) => {
    if (!user?.uid) {
      setDriveBinding(binding);
      return;
    }

    saveDriveBindingForUser(user.uid, binding);
    setDriveBinding(binding);

    if (!hasSupabase) return;

    const remoteSnapshot = await loadServerWorkspace<Partial<AccountWorkspaceSnapshot>>(user.uid);
    const baseSnapshot = remoteSnapshot.payload && typeof remoteSnapshot.payload === 'object'
      ? {
          ...(remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>),
        }
      : buildAccountWorkspaceSnapshot(
          user.displayName || undefined,
          user.photoURL || undefined,
          user.uid,
          {
            deviceId: workspaceDeviceIdRef.current,
            baseRevision: workspaceSyncRef.current.lastKnownRevision,
            editLock: activeStoryLockRef.current,
          },
        );

    const nextSnapshot: AccountWorkspaceSnapshot = {
      ...buildAccountWorkspaceSnapshot(
        user.displayName || undefined,
        user.photoURL || undefined,
        user.uid,
        {
          deviceId: workspaceDeviceIdRef.current,
          baseRevision: workspaceSyncRef.current.lastKnownRevision,
          editLock: activeStoryLockRef.current,
        },
      ),
      ...baseSnapshot,
      updatedAt: typeof baseSnapshot.updatedAt === 'string' ? baseSnapshot.updatedAt : new Date().toISOString(),
      driveBinding: binding,
    };
    await saveServerWorkspace(
      user.uid,
      sanitizeAccountWorkspaceForUser(nextSnapshot, user.uid),
      { expectedUpdatedAt: remoteSnapshot.updatedAt },
    );
  }, [hasSupabase, user]);

  const uploadSnapshotToDrive = useCallback(async (
    snapshot: BackupSnapshot,
    options?: { quiet?: boolean; interactive?: boolean },
  ): Promise<boolean> => {
    if (!user?.uid) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'skipped',
        error: 'Bạn cần đăng nhập TruyenForge trước khi dùng sao lưu lên Google Drive.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'warn',
          message: 'Hãy đăng nhập TruyenForge trước khi lưu dữ liệu lên Google Drive.',
          groupKey: 'backup-drive-login-required',
        });
      }
      return false;
    }

    if (!hasGoogleDriveBackupConfig()) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'skipped',
        error: 'Chưa có cấu hình Google Drive nên mốc này chưa thể lưu lên Drive.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'warn',
          message: 'Google Drive chưa được thiết lập xong nên chưa thể lưu bản sao này lên Drive.',
          groupKey: 'backup-drive-config-missing',
        });
      }
      return false;
    }

    const boundDrive = driveBinding || await loadBoundDriveBinding();
    if (!boundDrive) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'failed',
        error: 'Tài khoản này chưa liên kết với Google Drive nào. Hãy liên kết trước khi lưu bản sao lên Drive.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'warn',
          message: 'Tài khoản này chưa liên kết Google Drive. Hãy liên kết trước để tránh lưu nhầm Gmail.',
          groupKey: 'backup-drive-binding-missing',
        });
      }
      return false;
    }

    const accessToken = await ensureGoogleDriveAccessToken(Boolean(options?.interactive));
    const currentAuth = loadStoredDriveAuth();
    setDriveAuth(currentAuth);
    if (!accessToken) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'failed',
        error: 'Phiên Google Drive tạm thời chưa làm mới được. Hệ thống sẽ tự thử lại bằng tài khoản đã liên kết.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'warn',
          message: 'Google Drive tạm thời chưa sẵn sàng. Hệ thống sẽ tự thử lại tự động.',
          groupKey: 'backup-drive-token-missing',
        });
      }
      return false;
    }

    if (!currentAuth?.account?.sub || currentAuth.account.sub !== boundDrive.sub) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'failed',
        error: `Tài khoản TruyenForge này chỉ liên kết với Google Drive ${boundDrive.email}. Hãy đăng nhập đúng Gmail đó rồi thử lại.`,
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'error',
          message: `Bạn đang dùng sai Gmail. Tài khoản này chỉ lưu vào ${boundDrive.email}.`,
          groupKey: 'backup-drive-binding-mismatch',
        });
      }
      return false;
    }

    try {
      const uploaded = await uploadBackupSnapshotToDrive(
        accessToken,
        buildDriveBackupFilename(user.uid),
        snapshot.payload,
      );
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'uploaded',
        fileId: uploaded.id,
        fileName: uploaded.name,
        uploadedAt: new Date().toISOString(),
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'success',
          message: uploaded.replacedExisting
            ? 'Đã cập nhật bản sao lưu hiện hành trên Google Drive.'
            : 'Đã tạo bản sao lưu đầu tiên trên Google Drive.',
          detail: uploaded.cleanedDuplicates
            ? `${uploaded.name} · đã dọn ${uploaded.cleanedDuplicates} bản trùng cũ`
            : uploaded.name,
          groupKey: 'backup-drive-upload-success',
        });
      }
      return true;
    } catch (error) {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Upload Google Drive thất bại.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
      notifyApp({
        tone: 'error',
        message: 'Không thể lưu bản sao này lên Google Drive.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-drive-upload-failed',
      });
      }
      return false;
    }
  }, [driveBinding, loadBoundDriveBinding, refreshBackupHistory, user?.uid]);

  const createWorkspaceBackup = useCallback(async (
    reason: BackupReason,
    options?: {
      force?: boolean;
      quiet?: boolean;
    },
  ): Promise<BackupSnapshot | null> => {
    if (backupAutomationRef.current.isRestoring) return null;
    const payload = storage.buildBackupPayload();
    const fingerprint = createBackupFingerprint(payload);
    if (!options?.force && fingerprint === backupAutomationRef.current.lastFingerprint) {
      return null;
    }

    const snapshot = await createBackupSnapshot(payload, reason);
    backupAutomationRef.current.lastFingerprint = fingerprint;
    setBackupSettings((prev) => ({ ...prev, lastSuccessfulBackupAt: snapshot.createdAt }));

    if (backupSettings.autoUploadToDrive) {
      await uploadSnapshotToDrive(snapshot, { quiet: true });
    } else {
      await updateBackupSnapshotDriveMeta(snapshot.id, {
        status: 'skipped',
        error: 'Tự động đẩy Google Drive đang tắt.',
      });
    }

    await refreshBackupHistory();

    if (!options?.quiet) {
      notifyApp({
        tone: 'success',
        message: `Đã lưu một mốc ${reason === 'manual' ? 'thủ công' : 'an toàn'} lúc ${formatBackupTimestamp(snapshot.createdAt)}.`,
        groupKey: `backup-created:${reason}`,
      });
    }
    return snapshot;
  }, [backupSettings.autoUploadToDrive, refreshBackupHistory, uploadSnapshotToDrive]);

  const handleBackupNow = useCallback(async () => {
    setBackupBusyAction('backup-now');
    try {
      await createWorkspaceBackup('manual', { force: true });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể tạo bản sao lưu thủ công.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-manual-failed',
      });
    } finally {
      setBackupBusyAction('');
    }
  }, [createWorkspaceBackup]);

  const handleDownloadCurrentBackupJson = useCallback(() => {
    setIsExporting(true);
    try {
      const payload = storage.buildBackupPayload();
      const filename = storage.downloadBackupPayload(payload, `truyenforge-backup-${Date.now()}.json`);
      notifyApp({
        tone: 'success',
        message: 'Đã tải bản sao lưu về máy.',
        detail: filename,
        groupKey: 'backup-download-current',
      });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể tải bản sao lưu về máy.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-download-current-failed',
      });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleDownloadBackupSnapshot = useCallback(async (snapshotId: string) => {
    try {
      const snapshot = await getBackupSnapshot(snapshotId);
      if (!snapshot) throw new Error('Không tìm thấy snapshot cần tải.');
      const filename = storage.downloadBackupPayload(
        snapshot.payload,
        `truyenforge-backup-${snapshot.reason}-${snapshot.createdAt.replace(/[:.]/g, '-')}.json`,
      );
      notifyApp({
        tone: 'success',
        message: 'Đã tải xuống mốc sao lưu đã chọn.',
        detail: filename,
        groupKey: `backup-download-snapshot:${snapshotId}`,
      });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể tải mốc sao lưu này.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: `backup-download-snapshot-failed:${snapshotId}`,
      });
    }
  }, []);

  const restorePayloadIntoWorkspace = useCallback(async (
    payload: StorageBackupPayload,
  ): Promise<StorageImportReport> => {
    backupAutomationRef.current.isRestoring = true;
    workspaceSyncRef.current.isHydrating = true;
    let restoredSections: string[] = [];
    try {
      if (user?.uid) {
        await clearWorkspaceSyncQueue(user.uid);
      }
      workspaceSyncRef.current.lastQueuedSectionHash = {};
      workspaceSyncRef.current.lastSyncedSectionHash = {};
      const report = storage.importData(payload);
      restoredSections = report.restoredSections;
      refreshWorkspaceUiFromStorage();
      if (user?.uid) {
        await clearWorkspaceSyncQueue(user.uid);
        await refreshAccountSyncQueueStats();
      }
      return report;
    } finally {
      backupAutomationRef.current.isRestoring = false;
      workspaceSyncRef.current.isHydrating = false;
      if (restoredSections.length > 0) {
        const sectionMap: Partial<Record<string, LocalWorkspaceSection>> = {
          stories: 'stories',
          characters: 'characters',
          ai_rules: 'ai_rules',
          style_references: 'style_references',
          translation_names: 'translation_names',
          finops_budget: 'finops_budget',
        };
        restoredSections.forEach((sectionName) => {
          const section = sectionMap[sectionName];
          if (!section) return;
          emitLocalWorkspaceChanged(section);
        });
      }
    }
  }, [refreshAccountSyncQueueStats, refreshWorkspaceUiFromStorage, user?.uid]);

  const handleRestoreBackupSnapshot = useCallback(async (snapshotId: string) => {
    setBackupBusyAction(`restore:${snapshotId}`);
    try {
      const snapshot = await getBackupSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error('Không tìm thấy mốc sao lưu này.');
      }

      await createWorkspaceBackup('restore-point', { force: true, quiet: true });
      const report = await restorePayloadIntoWorkspace(snapshot.payload);
      await createWorkspaceBackup('manual', { force: true, quiet: true });
      await refreshBackupHistory();
      notifyApp({
        tone: 'success',
        message: 'Đã khôi phục dữ liệu từ mốc đã chọn.',
        detail: `Khôi phục ${report.restoredSections.join(', ')}.`,
        groupKey: `backup-restore-success:${snapshotId}`,
      });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể khôi phục dữ liệu từ mốc này.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: `backup-restore-failed:${snapshotId}`,
      });
    } finally {
      setBackupBusyAction('');
    }
  }, [createWorkspaceBackup, refreshBackupHistory, restorePayloadIntoWorkspace]);

  const handleImportBackupFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setBackupBusyAction('import-json');
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw) as StorageBackupPayload;
      await createWorkspaceBackup('restore-point', { force: true, quiet: true });
      const report = await restorePayloadIntoWorkspace(payload);
      await createWorkspaceBackup('manual', { force: true, quiet: true });
      await refreshBackupHistory();
      notifyApp({
        tone: 'success',
        message: 'Đã khôi phục dữ liệu từ file sao lưu.',
        detail: `Khôi phục ${report.restoredSections.join(', ')}.`,
        groupKey: 'backup-import-success',
      });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể khôi phục từ file sao lưu.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-import-failed',
      });
    } finally {
      setIsImporting(false);
      setBackupBusyAction('');
    }
  }, [createWorkspaceBackup, refreshBackupHistory, restorePayloadIntoWorkspace]);

  const handleConnectDrive = useCallback(async () => {
    if (!user?.uid) {
      notifyApp({
        tone: 'warn',
        message: 'Hãy đăng nhập TruyenForge trước khi liên kết Google Drive.',
        groupKey: 'backup-drive-connect-login-required',
      });
      return;
    }

    setBackupBusyAction('connect-drive');
    try {
      const boundDrive = driveBinding || await loadBoundDriveBinding();
      if (boundDrive) {
        notifyApp({
          tone: 'info',
          message: `Tài khoản này đã khóa với Google Drive ${boundDrive.email}.`,
          detail: 'Liên kết Drive chỉ thiết lập một lần và không thể đổi bằng giao diện người dùng.',
          groupKey: 'backup-drive-binding-already-locked',
        });
        return;
      }
      const auth = await connectGoogleDriveInteractive();
      const authBinding = toDriveBinding(auth.account);

      await persistDriveBinding(authBinding);
      setDriveAuth(auth);
      notifyApp({
        tone: 'success',
        message: `Đã liên kết tài khoản này với Google Drive ${auth.account.email}.`,
        detail: 'Liên kết này được khóa cố định cho tài khoản hiện tại và dùng lại tự động ở các lần đăng nhập sau.',
        groupKey: 'backup-drive-connect-success',
      });
      dismissToast('account-sync-disabled');
      const latest = backupSnapshots[0];
      if (latest && latest.drive?.status !== 'uploaded' && backupSettings.autoUploadToDrive) {
        await uploadSnapshotToDrive(latest, { quiet: true });
      }
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể liên kết Google Drive.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-drive-connect-failed',
      });
    } finally {
      setBackupBusyAction('');
    }
  }, [backupSettings.autoUploadToDrive, backupSnapshots, dismissToast, driveBinding, loadBoundDriveBinding, persistDriveBinding, uploadSnapshotToDrive, user?.uid]);

  const handleUploadSnapshotManually = useCallback(async (snapshotId: string) => {
    setBackupBusyAction(`drive-upload:${snapshotId}`);
    try {
      const snapshot = await getBackupSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error('Không tìm thấy snapshot cần đẩy lên Drive.');
      }
      const uploaded = await uploadSnapshotToDrive(snapshot, { quiet: false });
      if (!uploaded) return;
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể lưu mốc này lên Google Drive.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: `backup-drive-manual-failed:${snapshotId}`,
      });
    } finally {
      setBackupBusyAction('');
    }
  }, [uploadSnapshotToDrive]);

  const handleManualAccountSync = useCallback(async () => {
    if (!user || !hasSupabase) {
      notifyApp({
        tone: 'warn',
        message: 'Hãy đăng nhập trước khi đồng bộ dữ liệu với tài khoản.',
        groupKey: 'backup-manual-sync-no-account',
      });
      return;
    }

    setBackupBusyAction('manual-sync');
    workspaceSyncRef.current.isHydrating = true;
    try {
      await createWorkspaceBackup('restore-point', { force: true, quiet: true });
      const localSnapshot = buildAccountWorkspaceSnapshot(
        user.displayName || undefined,
        user.photoURL || undefined,
        user.uid,
        {
          deviceId: workspaceDeviceIdRef.current,
          baseRevision: workspaceSyncRef.current.lastKnownRevision,
          editLock: activeStoryLockRef.current,
        },
      );
      const remoteSnapshot = await loadServerWorkspace<AccountWorkspaceSnapshot>(user.uid);
      const remotePayload = remoteSnapshot.payload
        ? {
            ...(remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>),
            updatedAt: typeof (remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>).updatedAt === 'string'
              ? (remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>).updatedAt
              : (remoteSnapshot.updatedAt || new Date(0).toISOString()),
          }
        : null;
      const mergedSnapshot = sanitizeAccountWorkspaceForUser(remotePayload
        ? mergeAccountWorkspaceSnapshots(localSnapshot, remotePayload, { deviceId: workspaceDeviceIdRef.current })
        : localSnapshot, user.uid);
      mergedSnapshot.revision = Math.max(localSnapshot.revision || 0, Number(remotePayload?.revision) || 0) + 1;
      mergedSnapshot.modifiedByDeviceId = workspaceDeviceIdRef.current;
      mergedSnapshot.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);

      applyAccountWorkspaceSnapshot(mergedSnapshot, user.displayName || undefined, user.photoURL || undefined, user.uid);
      markLocalWorkspaceHydrated(mergedSnapshot.updatedAt, 'manual-sync', mergedSnapshot.sectionUpdatedAt);
      refreshWorkspaceUiFromStorage();
      await saveServerWorkspace(user.uid, mergedSnapshot, { expectedUpdatedAt: remoteSnapshot.updatedAt });
      try {
        await syncNormalizedWorkspaceRecords(user.uid, {
          stories: mergedSnapshot.stories || [],
          characters: mergedSnapshot.characters || [],
          aiRules: mergedSnapshot.aiRules || [],
          translationNames: mergedSnapshot.translationNames || [],
          styleReferences: mergedSnapshot.styleReferences || [],
        });
      } catch (normalizedError) {
        console.warn('Manual sync: cập nhật bảng theo bản ghi thất bại.', normalizedError);
      }
      storeWorkspaceRecoverySnapshot(mergedSnapshot, 'manual-sync', user.uid);
      workspaceSyncRef.current.lastSerialized = JSON.stringify(mergedSnapshot);
      workspaceSyncRef.current.lastKnownRevision = mergedSnapshot.revision || workspaceSyncRef.current.lastKnownRevision;
      workspaceSyncRef.current.lastServerUpdatedAt = mergedSnapshot.updatedAt || '';
      const syncedAt = new Date().toISOString();
      commitAccountSyncedAt(syncedAt, true);
      setBackupSettings((prev) => ({ ...prev, lastManualSyncAt: syncedAt }));
      await clearWorkspaceSyncQueue(user.uid);
      await refreshAccountSyncQueueStats();
      await createWorkspaceBackup('manual', { force: true, quiet: true });
      notifyApp({
        tone: 'success',
        message: 'Đã đồng bộ dữ liệu với tài khoản.',
        detail: 'App chỉ hợp nhất dữ liệu khi bạn bấm tay, nên an toàn hơn tự đồng bộ nền.',
        groupKey: 'backup-manual-sync-success',
      });
    } catch (error) {
      notifyApp({
        tone: 'error',
        message: 'Không thể đồng bộ dữ liệu với tài khoản.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-manual-sync-failed',
      });
    } finally {
      workspaceSyncRef.current.isHydrating = false;
      setBackupBusyAction('');
    }
  }, [commitAccountSyncedAt, createWorkspaceBackup, hasSupabase, refreshAccountSyncQueueStats, refreshWorkspaceUiFromStorage, user]);

  useEffect(() => {
    saveBackupSettings(backupSettings);
  }, [backupSettings]);

  useEffect(() => {
    if (!user?.uid) {
      setAccountLastSyncedAt('');
      return;
    }
    setAccountLastSyncedAt((prev) => prev || backupSettings.lastManualSyncAt || '');
  }, [backupSettings.lastManualSyncAt, user?.uid]);

  useEffect(() => {
    const nextScope = setWorkspaceScopeUser(user?.uid || 'guest');
    const scopeChanged = workspaceScopeRef.current !== nextScope;
    workspaceScopeRef.current = nextScope;

    setDriveBinding(loadDriveBindingForUser(user?.uid));
    void refreshBackupHistory();
    setDriveAuth(loadStoredDriveAuth());

    if (!scopeChanged) return;

    workspaceSyncRef.current.lastSerialized = '';
    workspaceSyncRef.current.isHydrating = false;
    workspaceSyncRef.current.lastErrorNotifiedAt = 0;
    workspaceSyncRef.current.lastSyncedAt = '';
    workspaceSyncRef.current.lastServerUpdatedAt = '';
    workspaceSyncRef.current.lastKnownRevision = 0;
    if (syncQueuePumpRef.current.timer) {
      window.clearTimeout(syncQueuePumpRef.current.timer);
      syncQueuePumpRef.current.timer = null;
    }
    syncQueuePumpRef.current.running = false;

    backupAutomationRef.current.lastFingerprint = '';
    backupAutomationRef.current.startupSnapshotDone = false;
    backupAutomationRef.current.isRestoring = false;

    setBackupHistoryReady(false);
    setAccountLastSyncedAt('');
    refreshWorkspaceUiFromStorage();
  }, [refreshBackupHistory, refreshWorkspaceUiFromStorage, user?.uid]);

  useEffect(() => {
    const configured = hasGoogleDriveBackupConfig();
    if (!user?.uid || !driveBinding || !configured) return;
    let cancelled = false;
    const warmupDriveToken = async () => {
      const token = await ensureGoogleDriveAccessToken(false);
      if (cancelled) return;
      if (token) {
        setDriveAuth(loadStoredDriveAuth());
      }
    };
    void warmupDriveToken();
    return () => {
      cancelled = true;
    };
  }, [driveBinding?.sub, user?.uid]);

  useEffect(() => {
    if (!backupHistoryReady || !backupSettings.autoSnapshotEnabled || backupAutomationRef.current.startupSnapshotDone) return;
    backupAutomationRef.current.startupSnapshotDone = true;
    void createWorkspaceBackup('auto', { quiet: true }).catch((error) => {
      console.warn('Không thể tạo snapshot khởi động.', error);
    });
  }, [backupHistoryReady, backupSettings.autoSnapshotEnabled, createWorkspaceBackup]);

  useEffect(() => {
    if (typeof window === 'undefined' || !backupSettings.autoSnapshotEnabled) return;
    let timer: number | null = null;
    const handler = (event: Event) => {
      if (workspaceSyncRef.current.isHydrating) return;
      if (backupAutomationRef.current.isRestoring) return;
      const detail = (event as CustomEvent<LocalWorkspaceMeta> | null)?.detail;
      const changedSection = typeof detail?.section === 'string'
        ? (detail.section as LocalWorkspaceSection)
        : null;
      if (!changedSection || !ACCOUNT_AUTOSYNC_TRIGGER_SECTIONS.has(changedSection)) {
        return;
      }
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void createWorkspaceBackup('auto', { quiet: true }).catch((error) => {
          console.warn('Không thể tạo auto backup.', error);
        });
      }, 1200);
    };
    window.addEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    };
  }, [backupSettings.autoSnapshotEnabled, createWorkspaceBackup]);

  const beginAiRun = useCallback((
    initialMessage: string,
    options?: {
      stageLabel?: string,
      detail?: string,
      progress?: AiOverlayProgress | null,
    },
  ) => {
    activeAiRunRef.current?.controller.abort();
    const nextRun: ActiveAiRun = {
      id: `ai-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: new AbortController(),
    };
    activeAiRunRef.current = nextRun;
    setIsProcessingAI(true);
    setAiTimer(0);
    setAILoadingMessage(initialMessage);
    setAiLoadingStage(options?.stageLabel || 'Đang chuẩn bị');
    setAiLoadingDetail(options?.detail || '');
    setAiLoadingProgress(options?.progress ?? null);
    return nextRun;
  }, []);

  const updateAiRun = useCallback((
    run: ActiveAiRun | null | undefined,
    payload: {
      message?: string,
      stageLabel?: string,
      detail?: string,
      progress?: AiOverlayProgress | null,
    },
  ) => {
    if (!run) return;
    if (activeAiRunRef.current?.id !== run.id) return;
    if (payload.message !== undefined) setAILoadingMessage(payload.message);
    if (payload.stageLabel !== undefined) setAiLoadingStage(payload.stageLabel);
    if (payload.detail !== undefined) setAiLoadingDetail(payload.detail);
    if (payload.progress !== undefined) setAiLoadingProgress(payload.progress);
  }, []);

  const finishAiRun = useCallback((run?: ActiveAiRun | null) => {
    if (!run) return;
    if (activeAiRunRef.current?.id !== run.id) return;
    activeAiRunRef.current = null;
    setIsProcessingAI(false);
    setAILoadingMessage('');
    setAiLoadingStage('Đã hoàn tất');
    setAiLoadingDetail('');
    setAiLoadingProgress(null);
  }, []);

  const cancelActiveAiRun = useCallback(() => {
    const active = activeAiRunRef.current;
    if (!active) return;
    active.controller.abort();
    activeAiRunRef.current = null;
    setIsProcessingAI(false);
    setAILoadingMessage('');
    setAiLoadingStage('Đã hủy');
    setAiLoadingDetail('');
    setAiLoadingProgress(null);
    notifyApp({ tone: 'warn', message: 'Đã hủy tác vụ AI đang chạy.' });
  }, []);

  useEffect(() => {
    setProfileNameDraft(profile.displayName);
    setProfileAvatarDraft(profile.avatarUrl);
    setProfileAvatarError('');
  }, [profile.displayName, profile.avatarUrl]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const budget = loadBudgetState();
      const remaining = Math.max(0, budget.monthlyBudgetUsd - budget.currentSpendUsd);
      if (budget.isExhausted) {
        setFinopsWarning('Hết budget · fallback model');
      } else if (remaining < budget.monthlyBudgetUsd * 0.15) {
        setFinopsWarning(`Còn $${remaining.toFixed(2)} budget`);
      } else {
        setFinopsWarning(undefined);
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);
  const [showAIGen, setShowAIGen] = useState(false);
  const [storiesVersion, setStoriesVersion] = useState(0);
  const [view, setView] = useState<'stories' | 'characters' | 'tools' | 'api'>('stories');
  const [readerFeedTab, setReaderFeedTab] = useState<'mine' | 'public'>('mine');
  const [readerNavMode, setReaderNavMode] = useState<'mine' | 'public' | 'search'>('mine');
  const [publicStoryFeed, setPublicStoryFeed] = useState<PublicStoryFeedItem[]>([]);
  const [resolvedPublicStoryMeta, setResolvedPublicStoryMeta] = useState<Record<string, ImportedStoryMetadata>>({});
  const [publicFeedLoading, setPublicFeedLoading] = useState(false);
  const [publicFeedError, setPublicFeedError] = useState('');
  const [loadingPublicStoryId, setLoadingPublicStoryId] = useState<string | null>(null);
  const [publicFeedGenreFilter, setPublicFeedGenreFilter] = useState('all');
  const [publicFeedSort, setPublicFeedSort] = useState<ReaderSortMode>('updated');
  const [readerQuery, setReaderQuery] = useState(DEFAULT_READER_DISCOVERY_FILTERS.query);
  const [readerStatusFilter, setReaderStatusFilter] = useState<ReaderStatusFilter>(DEFAULT_READER_DISCOVERY_FILTERS.status);
  const [readerAdultFilter, setReaderAdultFilter] = useState<ReaderAdultFilter>(DEFAULT_READER_DISCOVERY_FILTERS.adult);
  const [readerLengthFilter, setReaderLengthFilter] = useState<ReaderLengthFilter>(DEFAULT_READER_DISCOVERY_FILTERS.length);
  const [readerTypeFilter, setReaderTypeFilter] = useState<ReaderTypeFilter>(DEFAULT_READER_DISCOVERY_FILTERS.type);
  const [readerSearchHistory, setReaderSearchHistory] = useState<string[]>([]);
  const [readerFilterPresets, setReaderFilterPresets] = useState<ReaderFilterPreset[]>([]);
  const [publicStoryCacheVersion, setPublicStoryCacheVersion] = useState(0);
  const [showAIStoryModal, setShowAIStoryModal] = useState(false);
  const [showAIContinueModal, setShowAIContinueModal] = useState(false);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [showAiFileActionModal, setShowAiFileActionModal] = useState(false);
  const [translateFileContent, setTranslateFileContent] = useState('');
  const [translateFileName, setTranslateFileName] = useState('');
  const [translationGateLastReport, setTranslationGateLastReport] = useState<TranslationReleaseGateReport | null>(null);
  const [continueFileContent, setContinueFileContent] = useState('');
  const [continueFileName, setContinueFileName] = useState('');
  const [pendingAiFileContent, setPendingAiFileContent] = useState('');
  const [pendingAiFileName, setPendingAiFileName] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [exportIncludeToc, setExportIncludeToc] = useState(true);
  const [exportStory, setExportStory] = useState<Story | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const publicStoryCacheRef = useRef<Record<string, Story>>({});

  useEffect(() => {
    if (appMode !== 'reader') return;
    if (readerFeedTab !== 'public') return;
    void refreshPublicStoryFeed();
  }, [appMode, readerFeedTab, refreshPublicStoryFeed]);

  useEffect(() => {
    setReaderSearchHistory(loadReaderSearchHistory(user?.uid));
    setReaderFilterPresets(loadReaderFilterPresets(user?.uid));
  }, [user?.uid]);

  const currentReaderFilters = React.useMemo<ReaderDiscoveryFilters>(() => ({
    query: readerQuery,
    genre: publicFeedGenreFilter,
    status: readerStatusFilter,
    adult: readerAdultFilter,
    length: readerLengthFilter,
    type: readerTypeFilter,
    sort: publicFeedSort,
  }), [publicFeedGenreFilter, publicFeedSort, readerAdultFilter, readerLengthFilter, readerQuery, readerStatusFilter, readerTypeFilter]);

  const resetReaderFilters = useCallback(() => {
    setReaderQuery(DEFAULT_READER_DISCOVERY_FILTERS.query);
    setPublicFeedGenreFilter(DEFAULT_READER_DISCOVERY_FILTERS.genre);
    setReaderStatusFilter(DEFAULT_READER_DISCOVERY_FILTERS.status);
    setReaderAdultFilter(DEFAULT_READER_DISCOVERY_FILTERS.adult);
    setReaderLengthFilter(DEFAULT_READER_DISCOVERY_FILTERS.length);
    setReaderTypeFilter(DEFAULT_READER_DISCOVERY_FILTERS.type);
    setPublicFeedSort(DEFAULT_READER_DISCOVERY_FILTERS.sort);
  }, []);

  const pushReaderSearchHistory = useCallback((nextQuery: string) => {
    const cleaned = String(nextQuery || '').trim();
    if (!cleaned) return;
    setReaderSearchHistory((prev) => {
      const next = [cleaned, ...prev.filter((item) => normalizeSearchText(item) !== normalizeSearchText(cleaned))]
        .slice(0, READER_SEARCH_HISTORY_LIMIT);
      saveReaderSearchHistory(user?.uid, next);
      return next;
    });
  }, [user?.uid]);

  const saveCurrentReaderFilterPreset = useCallback(() => {
    const hasActiveFilter =
      currentReaderFilters.query
      || currentReaderFilters.genre !== 'all'
      || currentReaderFilters.status !== 'all'
      || currentReaderFilters.adult !== 'all'
      || currentReaderFilters.length !== 'all'
      || currentReaderFilters.type !== 'all'
      || currentReaderFilters.sort !== 'updated';
    if (!hasActiveFilter) {
      notifyApp({ tone: 'warn', message: 'Chưa có bộ lọc để lưu preset.' });
      return;
    }
    const timestamp = new Date();
    const quickName =
      currentReaderFilters.query
        ? `Từ khóa: ${currentReaderFilters.query.slice(0, 18)}`
        : `Bộ lọc ${timestamp.toLocaleDateString('vi-VN')}`;
    const preset: ReaderFilterPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: quickName,
      filters: currentReaderFilters,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    };
    setReaderFilterPresets((prev) => {
      const next = [preset, ...prev].slice(0, READER_FILTER_PRESET_LIMIT);
      saveReaderFilterPresets(user?.uid, next);
      return next;
    });
    notifyApp({ tone: 'success', message: 'Đã lưu preset bộ lọc Reader.' });
  }, [currentReaderFilters, user?.uid]);

  const applyReaderFilterPreset = useCallback((preset: ReaderFilterPreset) => {
    const filters = preset.filters;
    setReaderQuery(filters.query || '');
    setPublicFeedGenreFilter(filters.genre || 'all');
    setReaderStatusFilter(filters.status || 'all');
    setReaderAdultFilter(filters.adult || 'all');
    setReaderLengthFilter(filters.length || 'all');
    setReaderTypeFilter(filters.type || 'all');
    setPublicFeedSort(filters.sort || 'updated');
    if (filters.query) {
      pushReaderSearchHistory(filters.query);
    }
  }, [pushReaderSearchHistory]);

  const removeReaderFilterPreset = useCallback((presetId: string) => {
    setReaderFilterPresets((prev) => {
      const next = prev.filter((item) => item.id !== presetId);
      saveReaderFilterPresets(user?.uid, next);
      return next;
    });
  }, [user?.uid]);

  const mineStoryListItems = React.useMemo(() => {
    const rows = storage.getStoryListItems();
    if (!user?.uid) return rows;
    return rows.filter((item) => String(item.authorId || '').trim() === user.uid);
  }, [storiesVersion, user?.uid]);

  const publicFeedGenreOptions = React.useMemo(() => {
    const optionsMap = new Map<string, string>();
    READER_GENRE_BASE_OPTIONS.forEach((tag) => optionsMap.set(normalizeSearchText(tag), tag));
    [...publicStoryFeed, ...mineStoryListItems].forEach((item) => {
      splitGenreTags(item.genre).forEach((genreTag) => {
        const key = normalizeSearchText(genreTag);
        if (!key) return;
        if (!optionsMap.has(key)) optionsMap.set(key, genreTag);
      });
    });
    return Array.from(optionsMap.values()).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
  }, [mineStoryListItems, publicStoryFeed]);

  const readerFilters = React.useMemo<ReaderDiscoveryFilters>(() => ({
    query: readerQuery,
    genre: publicFeedGenreFilter,
    status: readerStatusFilter,
    adult: readerAdultFilter,
    length: readerLengthFilter,
    type: readerTypeFilter,
    sort: publicFeedSort,
  }), [publicFeedGenreFilter, publicFeedSort, readerAdultFilter, readerLengthFilter, readerQuery, readerStatusFilter, readerTypeFilter]);

  const appliedReaderFilters = React.useMemo<ReaderDiscoveryFilters>(() => (
    readerNavMode === 'search'
      ? readerFilters
      : {
          ...DEFAULT_READER_DISCOVERY_FILTERS,
          sort: 'updated',
        }
  ), [readerFilters, readerNavMode]);

  const sortReaderItems = useCallback(<T extends { title: string; chapterCount: number; updatedAt?: string; id?: string }>(rows: T[]) => {
    const sorted = [...rows];
    const getUpdatedMs = (item: { updatedAt?: string }) => {
      const ms = new Date(item.updatedAt || '').getTime();
      return Number.isFinite(ms) ? ms : 0;
    };
    const getPopularity = (item: { id?: string; chapterCount: number }) => {
      const id = String(item.id || '').trim();
      const activity = id ? readerActivityMap[id] : undefined;
      const followedBoost = activity?.followed ? 20 : 0;
      const readBoost = Math.min(20, (activity?.readChapterIds?.length || 0) * 2);
      return item.chapterCount * 4 + followedBoost + readBoost;
    };

    if (readerFilters.sort === 'title') {
      sorted.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'vi', { sensitivity: 'base' }));
      return sorted;
    }
    if (readerFilters.sort === 'chapters') {
      sorted.sort((a, b) => {
        if (b.chapterCount !== a.chapterCount) return b.chapterCount - a.chapterCount;
        return getUpdatedMs(b) - getUpdatedMs(a);
      });
      return sorted;
    }
    if (readerFilters.sort === 'recent') {
      sorted.sort((a, b) => getUpdatedMs(b) - getUpdatedMs(a));
      return sorted;
    }
    if (readerFilters.sort === 'popular') {
      sorted.sort((a, b) => {
        const scoreDiff = getPopularity(b) - getPopularity(a);
        if (scoreDiff !== 0) return scoreDiff;
        return getUpdatedMs(b) - getUpdatedMs(a);
      });
      return sorted;
    }
    sorted.sort((a, b) => getUpdatedMs(b) - getUpdatedMs(a));
    return sorted;
  }, [readerActivityMap, readerFilters.sort]);

  const mineFeedFilteredStories = React.useMemo(() => {
    const metadataFilters: ReaderDiscoveryFilters = { ...appliedReaderFilters, query: '' };
    const hasQuery = Boolean(String(appliedReaderFilters.query || '').trim());
    const filtered = mineStoryListItems.filter((item) => {
      const readerInput = {
        title: item.title,
        introduction: item.introduction,
        genre: item.genre,
        type: item.type,
        chapterCount: item.chapterCount,
        expectedChapters: item.expectedChapters,
        expectedWordCount: item.expectedWordCount,
        isAdult: item.isAdult,
      };
      if (!matchesReaderDiscoveryFilters(readerInput, metadataFilters)) return false;
      if (!hasQuery) return true;
      if (matchesReaderDiscoveryFilters(readerInput, appliedReaderFilters)) return true;
      const fullStory = storage.getStoryById(item.id);
      if (!fullStory) return false;
      return matchesReaderQuery(appliedReaderFilters.query, [
        fullStory.content,
        ...(Array.isArray(fullStory.chapters) ? fullStory.chapters.slice(0, 80).map((chapter: Chapter) => `${chapter.title || ''}\n${chapter.content || ''}`) : []),
      ]);
    });
    return sortReaderItems(filtered);
  }, [appliedReaderFilters, mineStoryListItems, sortReaderItems]);

  const publicFeedFilteredStories = React.useMemo(() => {
    const filtered = publicStoryFeed.filter((item) => matchesReaderDiscoveryFilters({
      title: item.title,
      introduction: item.introduction,
      genre: item.genre,
      type: item.type,
      chapterCount: item.chapterCount,
      expectedChapters: item.expectedChapters,
      expectedWordCount: item.expectedWordCount,
      isAdult: item.isAdult,
    }, appliedReaderFilters));
    return sortReaderItems(filtered);
  }, [appliedReaderFilters, publicStoryFeed, sortReaderItems]);

  useEffect(() => {
    const targets = publicFeedFilteredStories
      .slice(0, 30)
      .filter((item) => shouldLookupStoryCardMetadata({
        title: item.title,
        introduction: item.introduction,
        genre: item.genre,
      }));
    targets.forEach((item) => {
      const storyId = String(item.id || '').trim();
      if (!storyId) return;
      if (resolvedPublicStoryMeta[storyId]) return;
      if (publicMetaLookupInFlightRef.current.has(storyId)) return;
      publicMetaLookupInFlightRef.current.add(storyId);
      void resolveImportedStoryMetadata(`${item.title || storyId}.txt`, /\.txt$/i)
        .then((metadata) => {
          if (metadata.source === 'fallback') return;
          setResolvedPublicStoryMeta((prev) => {
            if (prev[storyId]) return prev;
            return { ...prev, [storyId]: metadata };
          });
        })
        .finally(() => {
          publicMetaLookupInFlightRef.current.delete(storyId);
        });
    });
  }, [publicFeedFilteredStories, resolvedPublicStoryMeta]);

  const publicFeedSections = React.useMemo(() => {
    const getUpdatedMs = (item: PublicStoryFeedItem) => {
      const ms = new Date(item.updatedAt || '').getTime();
      return Number.isFinite(ms) ? ms : 0;
    };
    const now = Date.now();
    const latest = [...publicFeedFilteredStories]
      .sort((a, b) => getUpdatedMs(b) - getUpdatedMs(a))
      .slice(0, 9);

    const hot = [...publicFeedFilteredStories]
      .sort((a, b) => {
        const activityA = readerActivityMap[a.id];
        const activityB = readerActivityMap[b.id];
        const scoreA = a.chapterCount * 4 + (activityA?.followed ? 18 : 0) + Math.min(20, (activityA?.readChapterIds?.length || 0) * 2);
        const scoreB = b.chapterCount * 4 + (activityB?.followed ? 18 : 0) + Math.min(20, (activityB?.readChapterIds?.length || 0) * 2);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return getUpdatedMs(b) - getUpdatedMs(a);
      })
      .slice(0, 9);

    const completed = [...publicFeedFilteredStories]
      .filter((item) => resolveReaderStatus(item.chapterCount, item.expectedChapters) === 'completed')
      .sort((a, b) => getUpdatedMs(b) - getUpdatedMs(a))
      .slice(0, 9);

    const suggested = [...publicFeedFilteredStories]
      .sort((a, b) => {
        const introA = Math.min(300, String(a.introduction || '').length);
        const introB = Math.min(300, String(b.introduction || '').length);
        const chapterA = Math.min(140, Number(a.chapterCount || 0) * 3);
        const chapterB = Math.min(140, Number(b.chapterCount || 0) * 3);
        const coverA = a.coverImageUrl ? 20 : 0;
        const coverB = b.coverImageUrl ? 20 : 0;
        const ageDaysA = Math.max(0, (now - getUpdatedMs(a)) / 86400000);
        const ageDaysB = Math.max(0, (now - getUpdatedMs(b)) / 86400000);
        const recencyA = Math.max(0, 120 - Math.floor(ageDaysA * 2));
        const recencyB = Math.max(0, 120 - Math.floor(ageDaysB * 2));
        const scoreA = introA + chapterA + coverA + recencyA;
        const scoreB = introB + chapterB + coverB + recencyB;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return getUpdatedMs(b) - getUpdatedMs(a);
      })
      .slice(0, 9);

    return { latest, hot, completed, suggested };
  }, [publicFeedFilteredStories, readerActivityMap]);

  const publicFeedRelatedStories = React.useMemo(() => {
    const interestMap = new Map<string, number>();
    Object.values(readerActivityMap || {}).forEach((entry) => {
      const scoreBase = (entry.followed ? 5 : 2) + Math.min(4, entry.readChapterIds.length);
      splitGenreTags(entry.genre).forEach((genreTag) => {
        const key = normalizeSearchText(genreTag);
        if (!key) return;
        interestMap.set(key, (interestMap.get(key) || 0) + scoreBase);
      });
    });
    if (interestMap.size === 0) return [] as PublicStoryFeedItem[];
    const topGenres = Array.from(interestMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => key);
    const related = publicStoryFeed
      .filter((item) => {
        if (readerActivityMap[item.id]?.readChapterIds?.length) return false;
        const tags = splitGenreTags(item.genre).map((tag) => normalizeSearchText(tag));
        return tags.some((tag) => topGenres.includes(tag));
      })
      .sort((a, b) => {
        const scoreA = splitGenreTags(a.genre)
          .map((tag) => interestMap.get(normalizeSearchText(tag)) || 0)
          .reduce((sum, val) => sum + val, 0);
        const scoreB = splitGenreTags(b.genre)
          .map((tag) => interestMap.get(normalizeSearchText(tag)) || 0)
          .reduce((sum, val) => sum + val, 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return new Date(b.updatedAt || '').getTime() - new Date(a.updatedAt || '').getTime();
      })
      .slice(0, 9);
    return related;
  }, [publicStoryFeed, readerActivityMap]);

  const readerTrendingGenres = React.useMemo(() => {
    const source = readerFeedTab === 'mine' ? mineFeedFilteredStories : publicFeedFilteredStories;
    const counter = new Map<string, { label: string; count: number }>();
    source.forEach((item) => {
      splitGenreTags(item.genre).forEach((tag) => {
        const key = normalizeSearchText(tag);
        if (!key) return;
        const current = counter.get(key);
        if (!current) {
          counter.set(key, { label: tag, count: 1 });
          return;
        }
        current.count += 1;
      });
    });
    return Array.from(counter.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [mineFeedFilteredStories, publicFeedFilteredStories, readerFeedTab]);

  useEffect(() => {
    const stories = storage.getStories();
    const normalized = normalizeStoriesWithSlug(stories);
    if (!normalized.changed) return;
    saveStoriesAndRefresh(normalized.stories);
  }, [storiesVersion]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const footerSections: { id: string; title: string; content: React.ReactNode }[] = [
    {
      id: 'contact',
      title: 'Liên hệ & Hỗ trợ',
      content: (
        <div className="space-y-3 leading-relaxed">
          <p className="text-sm">Vận hành cá nhân — phản hồi trực tiếp:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Email: <a className="text-indigo-600 font-semibold" href="mailto:ductruong.lynx@gmail.com">ductruong.lynx@gmail.com</a></li>
            <li>Facebook: <a className="text-indigo-600 font-semibold" href="https://www.facebook.com/lynxphuog/" target="_blank" rel="noreferrer">Đức Trường</a></li>
            <li>Discord: <span className="font-semibold text-slate-800">_lynxphg1314</span></li>
          </ul>
          <p className="text-xs text-slate-500">Ưu tiên lỗi kỹ thuật, đăng nhập, relay/API.</p>
        </div>
      ),
    },
    {
      id: 'feedback',
      title: 'Phản hồi & Góp ý',
      content: (
        <div className="space-y-3 leading-relaxed">
          <p className="text-sm">
            Nếu bạn thấy tính năng nào khó dùng, giao diện chưa rõ, hoặc cần thêm công cụ mới, hãy gửi góp ý trực tiếp để mình ưu tiên xử lý theo mức độ ảnh hưởng thực tế.
          </p>
          <p className="text-sm">
            Cảm ơn đồng hương{' '}
            <a
              className={cn(
                'font-semibold underline decoration-dotted underline-offset-2',
                themeMode === 'dark' ? 'text-cyan-300 hover:text-cyan-200' : 'text-indigo-600 hover:text-indigo-700',
              )}
              href="https://www.facebook.com/groups/1375173561043585/user/61577801115781"
              target="_blank"
              rel="noreferrer"
            >
              Thế Anh CTA
            </a>{' '}
            đã hỗ trợ cung cấp dịch vụ AI để phát triển web.
          </p>
        </div>
      ),
    },
    {
      id: 'ai',
      title: 'TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM VỀ AI',
      content: (
        <div className="space-y-3 leading-relaxed">
          <p>AI đóng vai trò trợ lý (co-writer/co-translator), không thay thế biên tập viên.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nội dung AI sinh dựa trên xác suất, có thể sai lệch logic/văn hóa.</li>
            <li>Bạn là vòng kiểm duyệt cuối: đọc lại, fact-check, sửa lỗi/hallucination trước khi xuất bản.</li>
            <li>TruyenForge AI không chịu trách nhiệm pháp lý cho việc dùng nguyên bản đầu ra AI mà không biên tập.</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'copyright',
      title: 'BẢN QUYỀN & SỞ HỮU TRÍ TUỆ',
      content: (
        <div className="space-y-3 leading-relaxed">
          <ul className="list-disc pl-5 space-y-1">
            <li>Bạn sở hữu 100% dữ liệu đầu vào (bản thảo, glossary, worldbuilding) và đầu ra đã biên tập.</li>
            <li>Cam kết chỉ nhập nội dung có quyền sử dụng; cấm dịch lậu/xào bài khi chưa được phép.</li>
            <li>DMCA: khi nhận khiếu nại hợp lệ, tài khoản có thể bị tạm khóa/xóa nội dung vi phạm.</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'privacy',
      title: 'QUYỀN RIÊNG TƯ & BẢO MẬT DỮ LIỆU',
      content: (
        <div className="space-y-3 leading-relaxed">
          <ul className="list-disc pl-5 space-y-1">
            <li>Zero Data Retention: không dùng bản thảo/thuật ngữ của bạn để train mô hình công cộng.</li>
            <li>Gọi model qua kênh doanh nghiệp, yêu cầu xóa dữ liệu ngay sau xử lý.</li>
            <li>Tài khoản & dự án lưu trên Supabase/PostgreSQL, mật khẩu được bảo vệ; không bán/chia sẻ dữ liệu cá nhân.</li>
          </ul>
          <p className="text-xs text-slate-500">Cập nhật: 03/2026. Điều khoản có thể thay đổi và sẽ được thông báo qua email.</p>
        </div>
      ),
    },
  ];
  const [footerOpen, setFooterOpen] = useState<Record<string, boolean>>(
    () => footerSections.reduce((acc, section) => ({ ...acc, [section.id]: false }), {} as Record<string, boolean>)
  );

  const handleOpenExportStory = (story: Story) => {
    setExportStory(story);
    setShowExportModal(true);
  };

  const handleExportStoryConfirm = async () => {
    if (!exportStory) return;
    try {
      setIsExportingStory(true);
      if (exportStory.type === 'translated' && Array.isArray(exportStory.chapters) && exportStory.chapters.length > 0) {
        const exportGateReport = runTranslationReleaseGate(normalizeChaptersForLocal(exportStory.chapters));
        setTranslationGateLastReport(exportGateReport);
        if (!exportGateReport.pass) {
          const summary = exportGateReport.blockingIssues.slice(0, 2).map((item) => item.message).join(' | ');
          notifyApp({
            tone: 'error',
            message: `Chưa thể xuất file vì bản dịch chưa sạch: ${summary || 'vẫn còn lỗi kiểm tra chất lượng.'}`,
            timeoutMs: 5600,
          });
          return;
        }
      }
      const blob =
        exportFormat === 'epub'
          ? await buildEpubExport(exportStory, exportIncludeToc)
          : await buildTxtExport(exportStory, exportIncludeToc);
      const ext = exportFormat;
      downloadBlob(blob, `${sanitizeFilename(exportStory.title)}.${ext}`);
      setShowExportModal(false);
    } catch (err) {
      notifyApp({ tone: 'error', message: `Xuất truyện thất bại: ${err instanceof Error ? err.message : err}` });
    } finally {
      setIsExportingStory(false);
    }
  };

  const handleAuthSubmit = async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      if (authMode === 'login') {
        const res = await login({ email: authEmailInput.trim(), password: authPasswordInput });
        if (!res.ok) {
          setAuthError(res.message || 'Đăng nhập thất bại.');
          return;
        }
      } else {
        const res = await register({ email: authEmailInput.trim(), password: authPasswordInput });
        if (!res.ok) {
          setAuthError(res.message || 'Đăng ký thất bại.');
          return;
        }
      }
      setShowAuthModal(false);
      setAuthPasswordInput('');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAuthProvider = async (providerName: 'google' | 'discord') => {
    setAuthBusy(true);
    setAuthError('');
    try {
      const res = await loginWithProvider(providerName);
      if (!res.ok) {
        setAuthError(res.message || 'Đăng nhập thất bại.');
        return;
      }
      setShowAuthModal(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = authEmailInput.trim();
    if (!email) {
      setAuthError('Nhập email để gửi link đặt lại mật khẩu.');
      return;
    }
    if (!hasSupabase) {
      setAuthError('Supabase chưa được cấu hình, không thể gửi email reset.');
      return;
    }
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setAuthError('Không thể khởi tạo kết nối Supabase để gửi email reset.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) {
      setAuthError(error.message);
    } else {
      setAuthError('Đã gửi email đặt lại mật khẩu (kiểm tra hộp thư/spam).');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setStoriesVersion((v) => v + 1);
    window.addEventListener(STORIES_UPDATED_EVENT, handler);
    return () => window.removeEventListener(STORIES_UPDATED_EVENT, handler);
  }, []);

  useEffect(() => {
    const scope = setWorkspaceScopeUser(user?.uid || 'guest');
    if (localBackupRestoreAttemptedRef.current.has(scope)) return;
    localBackupRestoreAttemptedRef.current.add(scope);
    const currentStories = storage.getStories();
    if (currentStories.length > 0) return;
    let cancelled = false;
    const tryRestoreStories = async () => {
      const legacyBackup = storage.getLatestStoriesBackup();
      if (legacyBackup.length) {
        saveStoriesAndRefresh(legacyBackup);
        notifyApp({
          tone: 'warn',
          message: 'Đã tự khôi phục truyện từ backup cục bộ gần nhất trên máy này.',
          groupKey: 'local-story-backup-restore',
          timeoutMs: 5600,
        });
        return;
      }

      const latestSnapshot = (await listBackupSnapshots(1))[0];
      const snapshotStories = Array.isArray(latestSnapshot?.payload?.stories)
        ? latestSnapshot.payload.stories
        : [];
      if (cancelled || !snapshotStories.length) return;
      saveStoriesAndRefresh(snapshotStories);
      notifyApp({
        tone: 'warn',
        message: 'Đã khôi phục truyện từ mốc sao lưu cục bộ gần nhất.',
        groupKey: 'local-story-backup-restore-vault',
        timeoutMs: 5600,
      });
    };
    void tryRestoreStories().catch((error) => {
      console.warn('Không thể tự khôi phục truyện từ backup cục bộ.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const syncWorkspaceToAccount = useCallback(async (changedSection?: LocalWorkspaceSection) => {
    if (!ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    if (!user || !hasSupabase || workspaceSyncRef.current.isHydrating || backupAutomationRef.current.isRestoring) return;
    if (workspaceSyncRef.current.isSyncing) {
      workspaceSyncRef.current.hasPendingSync = true;
      return;
    }
    workspaceSyncRef.current.isSyncing = true;
    try {
    if (activeStoryLockRef.current?.storyId) {
      activeStoryLockRef.current = {
        ...activeStoryLockRef.current,
        expiresAt: new Date(Date.now() + WORKSPACE_EDIT_LOCK_TTL_MS).toISOString(),
      };
    }
    const localSnapshot = buildAccountWorkspaceSnapshot(
      user.displayName || undefined,
      user.photoURL || undefined,
      user.uid,
      {
        deviceId: workspaceDeviceIdRef.current,
        baseRevision: workspaceSyncRef.current.lastKnownRevision,
        editLock: activeStoryLockRef.current,
      },
    );
    const sectionPayloadHash = changedSection
      ? buildWorkspaceSectionPayloadHash(localSnapshot, changedSection)
      : '';
    if (
      changedSection
      && workspaceSyncRef.current.lastSyncedSectionHash[changedSection] === sectionPayloadHash
    ) {
      return;
    }
    const remoteSnapshot = await loadServerWorkspace<AccountWorkspaceSnapshot>(user.uid);
    const remotePayload = remoteSnapshot.payload
      ? {
          ...(remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>),
          updatedAt: typeof (remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>).updatedAt === 'string'
            ? (remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>).updatedAt
            : (remoteSnapshot.updatedAt || new Date(0).toISOString()),
        }
      : null;
    const remoteLock = normalizeWorkspaceEditLock(remotePayload?.editLock);
    if (
      remoteLock &&
      isWorkspaceEditLockActive(remoteLock) &&
      remoteLock.deviceId !== workspaceDeviceIdRef.current &&
      activeStoryLockRef.current?.storyId &&
      activeStoryLockRef.current.storyId === remoteLock.storyId
    ) {
      notifyApp({
        tone: 'warn',
        message: `Truyện này đang được chỉnh trên thiết bị khác (${remoteLock.holder || 'thiết bị khác'}).`,
        detail: 'Bạn vẫn có thể đọc, nhưng nên tránh sửa cùng lúc để không bị xung đột dữ liệu.',
        groupKey: `workspace-edit-lock:${remoteLock.storyId}`,
        timeoutMs: 5200,
      });
    }

    const mergedSnapshot = sanitizeAccountWorkspaceForUser(remotePayload
      ? mergeAccountWorkspaceSnapshots(localSnapshot, remotePayload, { deviceId: workspaceDeviceIdRef.current })
      : localSnapshot, user.uid);
    mergedSnapshot.revision = Math.max(localSnapshot.revision || 0, Number(remotePayload?.revision) || 0) + 1;
    mergedSnapshot.modifiedByDeviceId = workspaceDeviceIdRef.current;
    mergedSnapshot.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);

    // Nếu cả local + remote đều trống phần stories/characters nhưng có recovery, ưu tiên recovery
    if ((!mergedSnapshot.stories?.length || mergedSnapshot.stories.length === 0) && !mergedSnapshot.characters?.length) {
      const recovery = loadWorkspaceRecoverySnapshot(user.uid);
      if (recovery && Array.isArray(recovery.stories) && recovery.stories.length > 0) {
        mergedSnapshot.stories = recovery.stories;
        mergedSnapshot.sectionUpdatedAt.stories = recovery.sectionUpdatedAt?.stories || recovery.updatedAt || new Date().toISOString();
        mergedSnapshot.updatedAt = recovery.updatedAt || mergedSnapshot.updatedAt;
        notifyApp({
          tone: 'warn',
          message: 'Đã khôi phục truyện từ bản sao lưu cục bộ.',
          groupKey: 'account-sync-restore-recovery',
        });
      }
    }

    const serialized = JSON.stringify(mergedSnapshot);
    if (serialized === workspaceSyncRef.current.lastSerialized) return;

    const localPayloadHash = buildWorkspacePayloadHash(localSnapshot);
    const mergedPayloadHash = buildWorkspacePayloadHash(mergedSnapshot);
    if (mergedPayloadHash !== localPayloadHash) {
      workspaceSyncRef.current.isHydrating = true;
      try {
        applyAccountWorkspaceSnapshot(mergedSnapshot, user.displayName || undefined, user.photoURL || undefined, user.uid);
        setProfile(loadUiProfile(user.displayName || undefined, user.photoURL || undefined));
        setThemeMode(loadThemeMode());
        setViewportMode(loadViewportMode());
      } finally {
        workspaceSyncRef.current.isHydrating = false;
      }
    }

    let savedSnapshot = mergedSnapshot;
    try {
      await saveServerWorkspace(user.uid, mergedSnapshot, {
        expectedUpdatedAt: remoteSnapshot.updatedAt || workspaceSyncRef.current.lastServerUpdatedAt || null,
      });
    } catch (error) {
      if (!(error instanceof WorkspaceConflictError)) throw error;
      const conflictPayload = error.remotePayload
        ? {
            ...(error.remotePayload as Partial<AccountWorkspaceSnapshot>),
            updatedAt: typeof (error.remotePayload as Partial<AccountWorkspaceSnapshot>).updatedAt === 'string'
              ? (error.remotePayload as Partial<AccountWorkspaceSnapshot>).updatedAt
              : (error.remoteUpdatedAt || new Date(0).toISOString()),
          }
        : null;
      const retriedMerged = sanitizeAccountWorkspaceForUser(
        conflictPayload
          ? mergeAccountWorkspaceSnapshots(localSnapshot, conflictPayload, { deviceId: workspaceDeviceIdRef.current })
          : mergedSnapshot,
        user.uid,
      );
      retriedMerged.revision = Math.max(localSnapshot.revision || 0, Number(conflictPayload?.revision) || 0) + 1;
      retriedMerged.modifiedByDeviceId = workspaceDeviceIdRef.current;
      retriedMerged.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);
      await saveServerWorkspace(user.uid, retriedMerged, {
        expectedUpdatedAt: error.remoteUpdatedAt,
      });
      savedSnapshot = retriedMerged;
      notifyApp({
        tone: 'warn',
        message: 'Phát hiện xung đột đồng bộ, app đã tự merge lại và lưu phiên bản mới.',
        groupKey: 'account-sync-conflict-resolved',
        timeoutMs: 5200,
      });
    }

    try {
      const normalizedResult = await syncNormalizedWorkspaceRecords(user.uid, {
        stories: savedSnapshot.stories || [],
        characters: savedSnapshot.characters || [],
        aiRules: savedSnapshot.aiRules || [],
        translationNames: savedSnapshot.translationNames || [],
        styleReferences: savedSnapshot.styleReferences || [],
      });
      if (normalizedResult.conflicts > 0) {
        notifyApp({
          tone: 'warn',
          message: `Có ${normalizedResult.conflicts} bản ghi mới hơn trên thiết bị khác, app đã giữ bản server để tránh ghi đè.`,
          groupKey: 'normalized-sync-conflicts',
          timeoutMs: 5200,
        });
      }
    } catch (error) {
      console.warn('Không thể cập nhật bảng đồng bộ theo bản ghi.', error);
      notifyApp({
        tone: 'warn',
        message: 'Đã lưu dữ liệu chính lên tài khoản, nhưng một phần dữ liệu phụ vẫn đang cập nhật.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'normalized-sync-failed',
        timeoutMs: 5200,
      });
    }

    storeWorkspaceRecoverySnapshot(savedSnapshot, 'account-sync-save', user.uid);
    workspaceSyncRef.current.lastSerialized = JSON.stringify(savedSnapshot);
    workspaceSyncRef.current.lastKnownRevision = savedSnapshot.revision || workspaceSyncRef.current.lastKnownRevision;
    workspaceSyncRef.current.lastServerUpdatedAt = savedSnapshot.updatedAt || '';
    if (changedSection) {
      workspaceSyncRef.current.lastSyncedSectionHash[changedSection] = sectionPayloadHash;
      workspaceSyncRef.current.lastQueuedSectionHash[changedSection] = sectionPayloadHash;
    }
    commitAccountSyncedAt(new Date().toISOString());
    } finally {
      workspaceSyncRef.current.isSyncing = false;
      if (workspaceSyncRef.current.hasPendingSync) {
        workspaceSyncRef.current.hasPendingSync = false;
        window.setTimeout(() => {
          void syncWorkspaceToAccount().catch((error) => {
            console.warn('Chạy lại autosync sau khi gộp thay đổi bị lỗi.', error);
          });
        }, ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS);
      }
    }
  }, [commitAccountSyncedAt, user, hasSupabase]);

  useEffect(() => {
    if (!user || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) {
      workspaceSyncRef.current.lastSerialized = '';
      workspaceSyncRef.current.isHydrating = false;
      workspaceSyncRef.current.isSyncing = false;
      workspaceSyncRef.current.hasPendingSync = false;
      workspaceSyncRef.current.lastServerUpdatedAt = '';
      workspaceSyncRef.current.lastKnownRevision = 0;
      workspaceSyncRef.current.lastQueuedSectionHash = {};
      workspaceSyncRef.current.lastSyncedSectionHash = {};
      return;
    }

    let cancelled = false;
    const hydrateWorkspace = async () => {
      workspaceSyncRef.current.isHydrating = true;
      try {
        const localSnapshot = buildAccountWorkspaceSnapshot(
          user.displayName || undefined,
          user.photoURL || undefined,
          user.uid,
          {
            deviceId: workspaceDeviceIdRef.current,
            baseRevision: workspaceSyncRef.current.lastKnownRevision,
            editLock: activeStoryLockRef.current,
          },
        );
        const localPayloadHash = buildWorkspacePayloadHash(localSnapshot);
        const remoteSnapshot = await loadServerWorkspace<AccountWorkspaceSnapshot>(user.uid);
        if (cancelled) return;

        if (!remoteSnapshot.payload) {
          const recovery = loadWorkspaceRecoverySnapshot(user.uid);
          const snapshotToSave = sanitizeAccountWorkspaceForUser(recovery && Array.isArray(recovery.stories) && recovery.stories.length > 0
            ? mergeAccountWorkspaceSnapshots(localSnapshot, recovery, { deviceId: workspaceDeviceIdRef.current })
            : localSnapshot, user.uid);
          snapshotToSave.revision = Math.max(localSnapshot.revision || 0, Number(recovery?.revision) || 0) + 1;
          snapshotToSave.modifiedByDeviceId = workspaceDeviceIdRef.current;
          snapshotToSave.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);
          await saveServerWorkspace(user.uid, snapshotToSave, { expectedUpdatedAt: remoteSnapshot.updatedAt });
          storeWorkspaceRecoverySnapshot(snapshotToSave, 'account-sync-bootstrap', user.uid);
          workspaceSyncRef.current.lastSerialized = JSON.stringify(snapshotToSave);
          workspaceSyncRef.current.lastKnownRevision = snapshotToSave.revision || workspaceSyncRef.current.lastKnownRevision;
          workspaceSyncRef.current.lastServerUpdatedAt = snapshotToSave.updatedAt || '';
          if (recovery && recovery.stories?.length) {
            applyAccountWorkspaceSnapshot(snapshotToSave, user.displayName || undefined, user.photoURL || undefined, user.uid);
            setProfile(loadUiProfile(user.displayName || undefined, user.photoURL || undefined));
            setThemeMode(loadThemeMode());
            setViewportMode(loadViewportMode());
            notifyApp({
              tone: 'warn',
              message: 'Đã khôi phục truyện từ bản sao lưu cục bộ và lưu lại lên tài khoản.',
              groupKey: 'account-sync-restore-recovery',
            });
          }
          return;
        }

        const remoteData = remoteSnapshot.payload as Partial<AccountWorkspaceSnapshot>;
        const remoteUpdatedAt = typeof remoteData.updatedAt === 'string'
          ? remoteData.updatedAt
          : (remoteSnapshot.updatedAt || new Date(0).toISOString());
        let mergedSnapshot = sanitizeAccountWorkspaceForUser(
          mergeAccountWorkspaceSnapshots(localSnapshot, { ...remoteData, updatedAt: remoteUpdatedAt }, { deviceId: workspaceDeviceIdRef.current }),
          user.uid,
        );
        mergedSnapshot.revision = Math.max(localSnapshot.revision || 0, Number(remoteData.revision) || 0) + 1;
        mergedSnapshot.modifiedByDeviceId = workspaceDeviceIdRef.current;
        mergedSnapshot.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);

        if ((!mergedSnapshot.stories?.length || mergedSnapshot.stories.length === 0) && !mergedSnapshot.characters?.length) {
          const recovery = loadWorkspaceRecoverySnapshot(user.uid);
          if (recovery && Array.isArray(recovery.stories) && recovery.stories.length > 0) {
            mergedSnapshot = sanitizeAccountWorkspaceForUser(
              mergeAccountWorkspaceSnapshots(mergedSnapshot, recovery, { deviceId: workspaceDeviceIdRef.current }),
              user.uid,
            );
            mergedSnapshot.revision = Math.max(mergedSnapshot.revision || 0, Number(recovery.revision) || 0) + 1;
            mergedSnapshot.modifiedByDeviceId = workspaceDeviceIdRef.current;
            mergedSnapshot.editLock = normalizeWorkspaceEditLock(activeStoryLockRef.current);
            notifyApp({
              tone: 'warn',
              message: 'Phát hiện dữ liệu trống, đã khôi phục truyện từ bản sao lưu cục bộ.',
              groupKey: 'account-sync-restore-recovery',
            });
          }
        }
        const mergedSerialized = JSON.stringify(mergedSnapshot);
        const mergedPayloadHash = buildWorkspacePayloadHash(mergedSnapshot);

        if (mergedPayloadHash !== localPayloadHash) {
          applyAccountWorkspaceSnapshot(mergedSnapshot, user.displayName || undefined, user.photoURL || undefined, user.uid);
          setProfile(loadUiProfile(user.displayName || undefined, user.photoURL || undefined));
          setThemeMode(loadThemeMode());
          setViewportMode(loadViewportMode());
          storeWorkspaceRecoverySnapshot(mergedSnapshot, 'account-sync-hydrate', user.uid);
          workspaceSyncRef.current.lastSerialized = JSON.stringify(
            buildAccountWorkspaceSnapshot(
              user.displayName || undefined,
              user.photoURL || undefined,
              user.uid,
              {
                deviceId: workspaceDeviceIdRef.current,
                baseRevision: workspaceSyncRef.current.lastKnownRevision,
                editLock: activeStoryLockRef.current,
              },
            ),
          );
        }

        await saveServerWorkspace(user.uid, mergedSnapshot, { expectedUpdatedAt: remoteSnapshot.updatedAt });
        storeWorkspaceRecoverySnapshot(mergedSnapshot, 'account-sync-save-after-hydrate', user.uid);
        workspaceSyncRef.current.lastSerialized = mergedSerialized;
        workspaceSyncRef.current.lastKnownRevision = mergedSnapshot.revision || workspaceSyncRef.current.lastKnownRevision;
        workspaceSyncRef.current.lastServerUpdatedAt = mergedSnapshot.updatedAt || '';
        commitAccountSyncedAt(new Date().toISOString());
      } catch (error) {
        console.warn('Không thể đồng bộ workspace theo tài khoản.', error);
        notifyApp({
          tone: 'warn',
          message: hasSupabase ? 'Không thể đồng bộ dữ liệu lên tài khoản lúc này. Vui lòng thử lại sau ít phút.' : 'Không thể đồng bộ dữ liệu cục bộ lên tài khoản ở thời điểm này.',
          detail: error instanceof Error ? error.message : undefined,
          groupKey: 'account-sync-failed',
          timeoutMs: 4800,
        });
      } finally {
        workspaceSyncRef.current.isHydrating = false;
      }
    };

    void hydrateWorkspace();
    return () => {
      cancelled = true;
    };
  }, [commitAccountSyncedAt, user, hasSupabase]);

  const runAccountSyncQueue = useCallback(async () => {
    if (!user?.uid || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    if (backupAutomationRef.current.isRestoring || workspaceSyncRef.current.isHydrating) return;
    if (syncQueuePumpRef.current.running) return;
    syncQueuePumpRef.current.running = true;
    try {
      const stats = await processWorkspaceSyncQueue(user.uid, async (job) => {
        await syncWorkspaceToAccount(job.section);
      }, {
        shouldPause: () => backupAutomationRef.current.isRestoring || workspaceSyncRef.current.isHydrating,
      });
      applyAccountSyncQueueStats(stats);
      if (stats.failed > 0 && shouldNotifyAccountSyncError(workspaceSyncRef.current.lastErrorNotifiedAt)) {
        workspaceSyncRef.current.lastErrorNotifiedAt = Date.now();
        notifyApp({
          tone: 'warn',
          message: 'Một lượt đồng bộ tự động bị lỗi, hệ thống sẽ tự thử lại sau.',
          detail: stats.lastError,
          groupKey: 'account-sync-queue-failed',
          timeoutMs: 5200,
        });
      }
    } finally {
      syncQueuePumpRef.current.running = false;
    }
  }, [applyAccountSyncQueueStats, hasSupabase, syncWorkspaceToAccount, user?.uid]);

  const scheduleAccountSyncQueue = useCallback((delayMs = ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS) => {
    if (typeof window === 'undefined') return;
    if (backupAutomationRef.current.isRestoring || workspaceSyncRef.current.isHydrating) return;
    if (syncQueuePumpRef.current.timer) {
      window.clearTimeout(syncQueuePumpRef.current.timer);
    }
    syncQueuePumpRef.current.timer = window.setTimeout(() => {
      syncQueuePumpRef.current.timer = null;
      void runAccountSyncQueue();
    }, delayMs);
  }, [runAccountSyncQueue]);

  useEffect(() => {
    if (!user?.uid) return;
    void refreshAccountSyncQueueStats();
    const unsubscribe = subscribeWorkspaceSyncQueue(() => {
      scheduleRefreshAccountSyncQueueStats();
    });
    return () => {
      unsubscribe();
      if (queueStatsRefreshTimerRef.current) {
        window.clearTimeout(queueStatsRefreshTimerRef.current);
        queueStatsRefreshTimerRef.current = null;
      }
    };
  }, [refreshAccountSyncQueueStats, scheduleRefreshAccountSyncQueueStats, user?.uid]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    const handler = (event: Event) => {
      if (workspaceSyncRef.current.isHydrating || backupAutomationRef.current.isRestoring) return;
      const detail = (event as CustomEvent<LocalWorkspaceMeta> | null)?.detail;
      const changedSection = typeof detail?.section === 'string'
        ? (detail.section as LocalWorkspaceSection)
        : null;
      if (!changedSection || !ACCOUNT_AUTOSYNC_TRIGGER_SECTIONS.has(changedSection)) {
        return;
      }
      const localSnapshot = buildAccountWorkspaceSnapshot(
        user.displayName || undefined,
        user.photoURL || undefined,
        user.uid,
        {
          deviceId: workspaceDeviceIdRef.current,
          baseRevision: workspaceSyncRef.current.lastKnownRevision,
          editLock: activeStoryLockRef.current,
        },
      );
      const sectionPayloadHash = buildWorkspaceSectionPayloadHash(localSnapshot, changedSection);
      if (workspaceSyncRef.current.lastQueuedSectionHash[changedSection] === sectionPayloadHash) {
        return;
      }
      workspaceSyncRef.current.lastQueuedSectionHash[changedSection] = sectionPayloadHash;
      const sectionUpdatedAt = detail?.sections?.[changedSection] || detail?.updatedAt || new Date().toISOString();
      const idempotencyKey = `${user.uid}:${changedSection}:${sectionUpdatedAt}:${sectionPayloadHash}`;
      void enqueueWorkspaceSyncJob({
        userId: user.uid,
        section: changedSection,
        idempotencyKey,
      }).then(() => {
        scheduleAccountSyncQueue();
      }).catch((error) => {
        delete workspaceSyncRef.current.lastQueuedSectionHash[changedSection];
        console.warn('Không thể enqueue autosync job.', error);
      });
    };
    window.addEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    return () => {
      if (syncQueuePumpRef.current.timer) {
        window.clearTimeout(syncQueuePumpRef.current.timer);
        syncQueuePumpRef.current.timer = null;
      }
      window.removeEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    };
  }, [hasSupabase, scheduleAccountSyncQueue, user]);

  useEffect(() => {
    if (!user?.uid || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    scheduleAccountSyncQueue(ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS);
  }, [hasSupabase, scheduleAccountSyncQueue, user?.uid]);

  useEffect(() => {
    if (!user || !hasSupabase || ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    let cancelled = false;
    const maybeWarnAboutManualSync = async () => {
      const currentBinding = driveBinding || await loadBoundDriveBinding();
      if (cancelled) return;
      if (currentBinding) {
        dismissToast('account-sync-disabled');
        return;
      }
      if (typeof window === 'undefined') return;
      const noticeKey = `${ACCOUNT_SYNC_DISABLED_NOTICE_KEY}:${user.uid}`;
      const lastShownAt = Number(localStorage.getItem(noticeKey) || 0);
      const hasShownRecently = Number.isFinite(lastShownAt) && lastShownAt > 0 && (Date.now() - lastShownAt) < 24 * 60 * 60 * 1000;
      if (hasShownRecently) return;
      localStorage.setItem(noticeKey, String(Date.now()));
      notifyApp({
        tone: 'warn',
        message: 'Đồng bộ tài khoản đang được tắt tạm thời để tránh mất dữ liệu.',
        detail: 'Hiện app vẫn giữ mốc sao lưu trên thiết bị. Nếu muốn có thêm một lớp an toàn, hãy liên kết Google Drive để các bản sao mới cũng được cập nhật lên đó.',
        groupKey: 'account-sync-disabled',
        timeoutMs: 6200,
      });
    };
    void maybeWarnAboutManualSync();
    return () => {
      cancelled = true;
    };
  }, [dismissToast, driveBinding, hasSupabase, loadBoundDriveBinding, user]);

  const readImportedStoryFile = async (file: File): Promise<string> => {
    if (file.name.endsWith('.pdf')) return parsePDF(file);
    if (file.name.endsWith('.epub')) return parseEPUB(file);
    if (file.name.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer();
      return extractDocxText(arrayBuffer);
    }
    return file.text();
  };

  const clearPendingAiFileAction = () => {
    setShowAiFileActionModal(false);
    setPendingAiFileContent('');
    setPendingAiFileName('');
  };

  const openTranslateFlowFromPendingFile = () => {
    if (!pendingAiFileContent.trim()) return;
    setTranslateFileContent(pendingAiFileContent);
    setTranslateFileName(pendingAiFileName);
    clearPendingAiFileAction();
    setShowTranslateModal(true);
  };

  const openContinueFlowFromPendingFile = () => {
    if (!pendingAiFileContent.trim()) return;
    setContinueFileContent(pendingAiFileContent);
    setContinueFileName(pendingAiFileName);
    clearPendingAiFileAction();
    setShowAIContinueModal(true);
  };

  const handleUnifiedAiFileFlow = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.txt,.pdf,.epub';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const aiRun = beginAiRun("Đang đọc file...", {
        stageLabel: 'Nạp dữ liệu',
        detail: 'Hệ thống đang mở tệp và nhận diện định dạng để quyết định luồng AI phù hợp.',
      });
      try {
        const content = String(await readImportedStoryFile(file) || '').trim();
        if (!content) {
          throw new Error('File không có nội dung văn bản để AI xử lý.');
        }
        setPendingAiFileContent(content);
        setPendingAiFileName(file.name);
        setShowAiFileActionModal(true);
      } catch (err) {
        notifyApp({ tone: "error", message: `Lỗi khi đọc file: ${String(err || '')}` });
      } finally {
        finishAiRun(aiRun);
      }
    };
    input.click();
  };

  useEffect(() => {
    setProfile((prev) => {
      const next = loadUiProfile(user?.displayName || undefined, user?.photoURL || undefined);
      return prev.displayName === next.displayName && prev.avatarUrl === next.avatarUrl ? prev : next;
    });
  }, [user?.displayName, user?.photoURL]);

  useEffect(() => {
    saveUiProfile(profile);
  }, [profile]);

  const handleProfileAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setProfileAvatarError('Chỉ hỗ trợ file ảnh (png, jpg, webp...).');
      return;
    }

    setIsUploadingProfileAvatar(true);
    setProfileAvatarError('');
    try {
      const optimizedAvatar = await resizeAvatarFile(file);
      setProfileAvatarDraft(optimizedAvatar);
    } catch (error) {
      setProfileAvatarError(error instanceof Error ? error.message : 'Không thể tải ảnh avatar.');
    } finally {
      setIsUploadingProfileAvatar(false);
    }
  };

  useEffect(() => {
    const targetStory = editingStory || selectedStory;
    if (!user?.uid || !targetStory?.id) {
      activeStoryLockRef.current = null;
      return;
    }
    const now = Date.now();
    activeStoryLockRef.current = {
      storyId: targetStory.id,
      storyTitle: String(targetStory.title || '').trim(),
      deviceId: workspaceDeviceIdRef.current,
      holder: String(profile.displayName || user.email || 'Thiết bị khác').trim() || 'Thiết bị khác',
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + WORKSPACE_EDIT_LOCK_TTL_MS).toISOString(),
    };
  }, [editingStory, profile.displayName, selectedStory, user?.email, user?.uid]);

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setProfileNameDraft(profile.displayName);
    setProfileAvatarDraft(profile.avatarUrl);
    setProfileAvatarError('');
  };

  const saveProfileDraft = () => {
    const normalizedAvatar = profileAvatarDraft.trim() || user?.photoURL || DEFAULT_PROFILE_AVATAR;
    setProfile({
      displayName: profileNameDraft.trim() || 'Người dùng',
      avatarUrl: normalizedAvatar,
    });
    setShowProfileModal(false);
    setProfileAvatarError('');
  };

  const resetReaderPrefs = () => {
    const defaults = createDefaultReaderPrefs(themeMode);
    setReaderPrefs(defaults);
  };

  const applyReaderPreset = (preset: 'book' | 'focus' | 'night') => {
    setReaderPrefs((prev) => {
      if (preset === 'book') {
        return {
          ...prev,
          fontFamily: 'serif',
          fontSize: 18,
          lineHeight: 1.85,
          colorMode: 'custom',
          background: '#f7f3eb',
          textColor: '#1f2937',
        };
      }
      if (preset === 'focus') {
        return {
          ...prev,
          fontFamily: 'sans',
          fontSize: 17,
          lineHeight: 1.8,
          colorMode: 'custom',
          background: '#f2f7ff',
          textColor: '#0f172a',
        };
      }
      return {
        ...prev,
        fontFamily: 'serif',
        fontSize: 18,
        lineHeight: 1.85,
        colorMode: 'custom',
        background: '#101826',
        textColor: '#dbe7f5',
      };
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    saveThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    setReaderPrefs((prev) => {
      if (prev.colorMode !== 'auto') return prev;
      const defaults = getReaderDefaultColors(themeMode);
      if (prev.background === defaults.background && prev.textColor === defaults.textColor) return prev;
      return {
        ...prev,
        background: defaults.background,
        textColor: defaults.textColor,
      };
    });
  }, [themeMode]);

  useEffect(() => {
    saveViewportMode(viewportMode);
  }, [viewportMode]);

  const handleToggleTheme = () => {
    setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleToggleViewportMode = () => {
    setViewportMode((prev) => (prev === 'desktop' ? 'mobile' : 'desktop'));
  };

  const handleSwitchAppMode = useCallback((nextMode: AppMode) => {
    if (maintenanceGlobalActive) {
      notifyApp({
        tone: 'warn',
        message: 'Hệ thống đang bảo trì toàn bộ, tạm thời chưa truy cập được.',
        groupKey: 'maintenance-global-switch-block',
      });
      navigate('/');
      return;
    }
    if (nextMode === 'reader' && maintenanceReaderActive) {
      notifyApp({
        tone: 'warn',
        message: 'Khu đọc đang bảo trì, tạm thời chưa truy cập được.',
        groupKey: 'maintenance-reader-switch-block',
      });
      setAppMode('reader');
      navigate('/');
      return;
    }
    if (nextMode === 'creator' && maintenanceStudioActive) {
      notifyApp({
        tone: 'warn',
        message: 'Studio đang bảo trì, tạm thời chưa truy cập được.',
        groupKey: 'maintenance-studio-switch-block',
      });
      setAppMode('creator');
      navigate('/studio');
      return;
    }
    setAppMode(nextMode);
    setView('stories');
    if (nextMode === 'reader') {
      setReaderFeedTab('mine');
      setReaderNavMode('mine');
    }
    setSelectedStory(null);
    setEditingStory(null);
    setIsCreating(false);
    navigate(nextMode === 'creator' ? '/studio' : '/');
  }, [maintenanceGlobalActive, maintenanceReaderActive, maintenanceStudioActive, navigate]);

  const openReaderFeedFromNavbar = useCallback((tab: 'mine' | 'public') => {
    if (appMode !== 'reader') {
      setAppMode('reader');
    }
    setReaderFeedTab(tab);
    setReaderNavMode(tab);
    setSelectedStory(null);
    setEditingStory(null);
    setIsCreating(false);
    navigate('/');
  }, [appMode, navigate]);

  const focusReaderSearchFromNavbar = useCallback(() => {
    if (appMode !== 'reader') {
      setAppMode('reader');
    }
    setReaderNavMode('search');
    setSelectedStory(null);
    setEditingStory(null);
    setIsCreating(false);
    navigate('/');
    window.setTimeout(() => {
      readerDiscoveryControlsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      readerSearchInputRef.current?.focus();
      readerSearchInputRef.current?.select();
    }, 80);
  }, [appMode, navigate]);

  const applyReaderPrefsToDom = useCallback((prefs: ReaderPrefs) => {
    const root = document.documentElement;
    root.style.setProperty('--tf-reader-font-size', `${prefs.fontSize}px`);
    root.style.setProperty('--tf-reader-line-height', `${prefs.lineHeight}`);
    root.style.setProperty('--tf-reader-bg', prefs.background);
    root.style.setProperty('--tf-reader-text', prefs.textColor);
    const fontStack =
      prefs.fontFamily === 'mono'
        ? `"Fira Code", "JetBrains Mono", Consolas, "SFMono-Regular", Menlo, monospace`
        : prefs.fontFamily === 'serif'
          ? `"Noto Serif", "Times New Roman", Georgia, serif`
          : `"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    root.style.setProperty('--tf-reader-font-family', fontStack);
  }, []);

  useEffect(() => {
    applyReaderPrefsToDom(readerPrefs);
    saveReaderPrefs(readerPrefs);
  }, [applyReaderPrefsToDom, readerPrefs]);

  const createAndStoreStory = (
    buildStory: (context: {
      existingStories: Story[];
      storyId: string;
      storySlug: string;
      now: string;
    }) => Story,
  ): Story => {
    const existingStories = storage.getStories();
    const now = new Date().toISOString();
    const newStory = buildStory({
      existingStories,
      storyId: createClientId('story'),
      storySlug: createStorySlugFromStories(existingStories),
      now,
    });
    saveStoriesAndRefresh([newStory, ...existingStories]);
    return newStory;
  };

  const handleTranslateStory = async (options: {
    isAdult: boolean,
    additionalInstructions: string,
    useDictionary: boolean,
    chapteringMode: 'auto' | 'words',
    wordsPerChapter: number,
    chapterRangeStart: number,
    chapterRangeEnd: number,
    autoSafeModeEnabled: boolean,
    checkpointEveryChunks: number,
  }) => {
    if (!user || !translateFileContent) return;
    
    setTranslationGateLastReport(null);
    setShowTranslateModal(false);
    const aiRun = beginAiRun("Đang chuẩn bị dịch thuật...", {
      stageLabel: 'Khởi tạo dịch',
      detail: 'Đang đọc cấu hình, từ điển và chuẩn bị chia truyện thành các lô dịch ổn định hơn.',
    });
    const abortSignal = aiRun.controller.signal;
    let translateTaskRun: ReturnType<typeof startAiTaskRun> | null = null;
    let checkpointFingerprint = '';
    let flushTranslationCheckpoint: (() => void) | null = null;

    try {
      const ai = createGeminiClient();
      const translateStartedAt = Date.now();
      const translateBlueprint = getPromptBlueprint('story_translate');
      const runtimeProfileMode = getApiRuntimeConfig().aiProfile;
      translateTaskRun = startAiTaskRun('story_translate', translateBlueprint.version, {
        provider: ai.provider,
        model: ai.model,
        fileName: String(translateFileName || ''),
      });
      const buildTranslateTraceConfig = (
        stage: 'analysis' | 'draft' | 'quality_gate',
        extra?: Record<string, unknown>,
      ) => ({
        taskType: 'story_translate' as AiTaskType,
        promptVersion: translateBlueprint.version,
        traceRunId: translateTaskRun.runId,
        traceStage: stage,
        traceMeta: buildTraceMetadata(translateTaskRun.traceFor(stage), extra),
      });
      
      let dictionaryEntries: TranslationDictionaryEntry[] = [];
      if (options.useDictionary) {
        const names = normalizeTranslationDictionary(
          storage
            .getTranslationNames()
            .filter((entry: TranslationName) => entry.authorId === user.uid),
        );
        if (names.length > 0) {
          dictionaryEntries = names;
        }
      }
      const storyTranslationMemory = normalizeTranslationDictionary(dictionaryEntries);

      const sourceCharCount = String(translateFileContent || '').length;
      const sourceTokenEstimate = estimateTextTokens(translateFileContent);
      const detectedSections = detectChapterSections(translateFileContent);
      const translateLoadProfile = computeAutoContentLoadProfile({
        text: translateFileContent,
        provider: ai.provider,
        detectedChapterCount: detectedSections.length,
      });
      const profileSafeMode = Boolean(options.autoSafeModeEnabled);
      const forcedSafeMode =
        profileSafeMode &&
        (translateLoadProfile.hugeFileMode || sourceTokenEstimate >= 14000 || sourceCharCount >= 58000);
      const hugeFileMode = translateLoadProfile.hugeFileMode || forcedSafeMode;
      const extremeFileMode = translateLoadProfile.extremeFileMode;
      const turboMode = translateLoadProfile.turboMode || forcedSafeMode;
      let segmentCharLimit = extremeFileMode ? 3400 : hugeFileMode ? 4300 : (turboMode ? 6000 : 3800);
      if (ai.provider === 'gemini' || ai.provider === 'gcli') {
        if (extremeFileMode) {
          segmentCharLimit = 4200;
        } else if (hugeFileMode) {
          segmentCharLimit = 5200;
        } else if (sourceCharCount >= 45000) {
          segmentCharLimit = 7200;
        }
      }
      const translationKind: 'fast' | 'quality' = turboMode ? 'fast' : 'quality';
      const analysisKind: 'fast' | 'quality' = turboMode ? 'fast' : 'quality';
      const analysisRouteDecision = routeAiExecutionLane({
        task: 'story_translate',
        stage: 'analysis',
        provider: ai.provider,
        profile: runtimeProfileMode,
        inputChars: sourceCharCount,
        preferredLane: analysisKind,
      });
      const translationRouteDecision = routeAiExecutionLane({
        task: 'story_translate',
        stage: 'draft',
        provider: ai.provider,
        profile: runtimeProfileMode,
        inputChars: sourceCharCount,
        preferredLane: translationKind,
      });
      const analysisLane = analysisRouteDecision.lane;
      const translationLane = translationRouteDecision.lane;
      const overloadSafeMode = ai.provider === 'ollama' || ai.provider === 'openrouter';
      const translationConcurrency = Math.max(
        1,
        Math.min(2, overloadSafeMode ? 1 : (hugeFileMode ? 1 : (turboMode ? 2 : 1))),
      );
      const requestSpacingMs = ai.provider === 'ollama' ? 1800 : (ai.provider === 'openrouter' ? 280 : 0);
      const overloadFallbackRetries = ai.provider === 'ollama' ? 3 : 2;
      const hasClearChapterStructure = detectedSections.length >= 2;
      const useManualChapterSplit = !hasClearChapterStructure && options.chapteringMode === 'words';
      const manualWordsPerChapter = Math.max(300, Math.min(12000, Math.round(Number(options.wordsPerChapter || 3000))));
      const translationUnits = useManualChapterSplit
        ? buildChapterTranslationUnitsByWords(translateFileContent, segmentCharLimit, manualWordsPerChapter)
        : buildChapterTranslationUnits(translateFileContent, segmentCharLimit);
      let effectiveUnits = translationUnits.length
        ? translationUnits
        : [{
            title: 'Chương 1',
            source: String(translateFileContent || '').trim(),
            segments: splitLargeTextByParagraphs(String(translateFileContent || '').trim(), segmentCharLimit),
          }];
      const totalDetectedUnits = effectiveUnits.length;
      const safeRangeStart = Math.max(1, Math.min(totalDetectedUnits, Math.round(Number(options.chapterRangeStart) || 1)));
      const safeRangeEnd = Math.max(safeRangeStart, Math.min(totalDetectedUnits, Math.round(Number(options.chapterRangeEnd) || totalDetectedUnits)));
      effectiveUnits = effectiveUnits.slice(safeRangeStart - 1, safeRangeEnd);
      if (!effectiveUnits.length) {
        throw new Error('Không có chương nào trong phạm vi bạn đã chọn để dịch.');
      }
      const totalSegments =
        effectiveUnits.reduce((acc, unit) => acc + unit.segments.filter((segment) => segment.trim().length >= 30).length, 0) ||
        effectiveUnits.length;
      const lowQuotaMode = (ai.provider === 'gemini' || ai.provider === 'gcli') && totalSegments >= 14;
      const shouldRunAnalysis = !turboMode && !lowQuotaMode && !hugeFileMode && effectiveUnits.length <= 6 && sourceTokenEstimate <= 9000;
      let batchCharLimit =
        ai.provider === 'gemini' || ai.provider === 'gcli'
          ? (extremeFileMode ? 5200 : hugeFileMode ? 6800 : (turboMode ? 12000 : 9000))
          : (extremeFileMode ? 4200 : hugeFileMode ? 5600 : (turboMode ? 9000 : 7200));
      if (overloadSafeMode) {
        batchCharLimit = Math.min(batchCharLimit, ai.provider === 'ollama' ? 1800 : 4800);
      }
      const batchItemLimit = overloadSafeMode ? 1 : (extremeFileMode ? 1 : lowQuotaMode ? 1 : hugeFileMode ? 2 : (turboMode ? 3 : 2));
      const translationRequestRetries = overloadSafeMode ? 0 : (lowQuotaMode && !hugeFileMode ? 0 : 1);
      const checkpointEveryChunks = Math.max(3, Math.min(30, Number(options.checkpointEveryChunks || 10)));
      const sharedSafetySettings = GEMINI_UNRESTRICTED_SAFETY_SETTINGS;
      const preparationLabel = shouldRunAnalysis ? 'Đang phân tích nội dung gốc...' : 'Đang chuẩn bị dịch theo lô...';

      const translationPreparationMessage = useManualChapterSplit
        ? `File chưa có mốc chương rõ ràng. Đang tách theo khoảng ${manualWordsPerChapter.toLocaleString('vi-VN')} từ/chương và giữ trọn đoạn văn.`
        : detectedSections.length >= 2 && turboMode && lowQuotaMode
        ? `Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ tiết kiệm quota + dịch nhanh.`
        : detectedSections.length >= 2 && turboMode
          ? `Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ dịch nhanh.`
          : detectedSections.length >= 2
            ? `Đã nhận diện ${effectiveUnits.length} chương và giữ nguyên cấu trúc chương.`
            : turboMode
            ? 'File lớn nên hệ thống sẽ tự chia đoạn và ưu tiên tốc độ.'
            : 'Chưa thấy mốc chương rõ ràng, hệ thống sẽ tự chia đoạn để dịch ổn định hơn.';
      const rangeMessage = `Phạm vi dịch: chương ${safeRangeStart} đến ${safeRangeEnd} (trên tổng ${totalDetectedUnits} chương).`;
      const translationProfileNote = extremeFileMode
        ? 'Đang dùng chế độ an toàn cao cho file rất lớn: giảm kích thước lô, dịch tuần tự và hạn chế prompt phình to.'
        : hugeFileMode
          ? 'Đang dùng chế độ an toàn cho file lớn: giảm số đoạn xử lý cùng lúc và chia lô nhỏ hơn để hạn chế lỗi.'
          : '';
      const autoProfileDetail = `Chế độ tự động: ${translateLoadProfile.mode.toUpperCase()}.`;
      const autoProfileReasons = translateLoadProfile.reasons.length
        ? `Dấu hiệu tải hệ thống: ${translateLoadProfile.reasons.join(' · ')}.`
        : '';

      checkpointFingerprint = quickHash(JSON.stringify({
        content: quickHash(String(translateFileContent || '')),
        file: String(translateFileName || '').toLowerCase(),
        mode: translateLoadProfile.mode,
        chapteringMode: useManualChapterSplit ? 'words' : 'auto',
        wordsPerChapter: useManualChapterSplit ? manualWordsPerChapter : 0,
        chapterRangeStart: safeRangeStart,
        chapterRangeEnd: safeRangeEnd,
        provider: ai.provider,
        model: ai.model,
        dictionary: storyTranslationMemory.map((item) => `${item.original}=>${item.translation}`),
        promptVersion: translateBlueprint.version,
      }));
      const resumedCheckpoint = loadTranslationPipelineCheckpoint(checkpointFingerprint);
      const checkpointChapterStates: TranslationPipelineCheckpoint['chapterStates'] = resumedCheckpoint?.chapterStates
        ? { ...resumedCheckpoint.chapterStates }
        : {};
      const structureAnalysis = runLocalStructurePhase(translateFileContent, effectiveUnits);
      const userStories = storage.getStories().filter((story: Story) => story.authorId === user.uid);
      let storyBible =
        userStories
          .map((story: Story) => readStoryBibleFromNotes(story.storyPromptNotes))
          .find((candidate): candidate is StoryBiblePayload => Boolean(candidate && candidate.fileFingerprint === checkpointFingerprint)) ||
        null;
      if (!storyBible) {
        storyBible = buildStoryBiblePayload({
          text: translateFileContent,
          units: effectiveUnits,
          structure: structureAnalysis,
          fileFingerprint: checkpointFingerprint,
        });
      } else {
        storyBible = {
          ...storyBible,
          updatedAt: new Date().toISOString(),
        };
      }
      let processedSegments = Math.max(0, resumedCheckpoint?.processedSegments || 0);
      let processedChunkCount = Math.max(0, resumedCheckpoint?.processedChunkCount || 0);
      processedSegments = Math.min(processedSegments, totalSegments);
      flushTranslationCheckpoint = () => {
        if (!checkpointFingerprint) return;
        saveTranslationPipelineCheckpoint({
          version: 1,
          fileFingerprint: checkpointFingerprint,
          updatedAt: new Date().toISOString(),
          processedSegments,
          processedChunkCount,
          chapterStates: checkpointChapterStates,
        });
      };
      updateAiRun(aiRun, {
        message: 'Đang chạy Pha 1/4: Phân tích cấu trúc...',
        stageLabel: 'Pha 1/4 · Cấu trúc',
        detail: `${translationPreparationMessage} ${rangeMessage} ${preparationLabel}${translationProfileNote ? ` ${translationProfileNote}` : ''} ${autoProfileDetail} ${autoProfileReasons} Nhận diện ${structureAnalysis.chapterCount} chương, ${structureAnalysis.paragraphCount} đoạn, ${structureAnalysis.dialogueCount} hội thoại, ${structureAnalysis.namedEntities.length} tên riêng và ${structureAnalysis.timeMarkers.length} mốc thời gian.`,
        progress: { completed: processedSegments, total: Math.max(totalSegments, 1) },
      });
      if (resumedCheckpoint) {
        notifyApp({
          tone: 'warn',
          message: `Phát hiện tiến độ đã lưu trước đó: tiếp tục từ ${processedSegments}/${totalSegments} đoạn đã xử lý.`,
          timeoutMs: 4200,
        });
      }
      updateAiRun(aiRun, {
        message: 'Đang chạy Pha 2/4: Trích xuất tri thức...',
        stageLabel: 'Pha 2/4 · Tri thức',
        detail: `Đã tạo bộ ghi nhớ nội dung gồm ${storyBible.chapterSummaries.length} chương và ${storyBible.arcSummaries.length} tuyến truyện. Dữ liệu này sẽ được tái sử dụng cho lần dịch sau của cùng file.`,
        progress: { completed: processedSegments, total: Math.max(totalSegments, 1) },
      });

      // 1. Analyze the story for metadata (skip on low quota mode)
      let analysis: {
        summary: string;
        genre: string;
        characters: string[];
      } = {
        summary: `Bản dịch tự động từ file "${String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "")}".`,
        genre: 'Dịch thuật',
        characters: [],
      };
      if (shouldRunAnalysis) {
        const analysisExcerpt = buildAnalysisExcerpt(translateFileContent, effectiveUnits);
        translateTaskRun.markStage('analysis', {
          lane: analysisLane,
          routeReason: analysisRouteDecision.reason,
          units: effectiveUnits.length,
        });
        const analysisPrompt = prependPromptContract(`
          Hãy phân tích nội dung truyện (tiếng Trung hoặc ngôn ngữ khác) sau đây:
          "${analysisExcerpt}"
          
          Yêu cầu:
          1. Tóm tắt cốt truyện.
          2. Xác định thể loại.
          3. Liệt kê các nhân vật chính.
          
          Trả về JSON:
          {
            "summary": "...",
            "genre": "...",
            "characters": ["..."]
          }
        `.trim(), {
          task: 'story_translate',
          stage: 'analysis',
          promptVersion: translateBlueprint.version,
          outputSchema: 'story_analysis_v1',
          strictJson: true,
        });

        const analysisTextRaw = await generateGeminiText(
          ai,
          analysisLane,
          analysisPrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: turboMode ? 1500 : 2600,
            minOutputChars: turboMode ? 120 : 200,
            maxRetries: 1,
            signal: abortSignal,
            ...buildTranslateTraceConfig('analysis', {
              lane: analysisLane,
              routeReason: analysisRouteDecision.reason,
            }),
          },
        );

        const analysisParsed = tryParseJson<Record<string, unknown>>(analysisTextRaw || '', 'object');
        const analysisCharacters = Array.isArray(analysisParsed?.characters)
          ? analysisParsed.characters.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        const normalizedAnalysis = validateStoryAnalysis({
          summary: String(analysisParsed?.summary || '').trim() || stripJsonFence(analysisTextRaw || '').trim(),
          writingStyle: '',
          currentContext: '',
          genre: String(analysisParsed?.genre || '').trim() || 'Dịch thuật',
          characters: analysisCharacters.map((name) => ({ name, personality: '' })),
        });
        analysis = {
          summary: normalizedAnalysis.data.summary || String(analysisParsed?.summary || '').trim() || stripJsonFence(analysisTextRaw || '').trim(),
          genre: normalizedAnalysis.data.genre || String(analysisParsed?.genre || '').trim() || 'Dịch thuật',
          characters: normalizedAnalysis.data.characters.map((item) => item.name).filter(Boolean),
        };
      }
      
      analysis.characters = Array.from(
        new Set([
          ...analysis.characters,
          ...(storyBible?.structure?.namedEntities || []),
        ]),
      ).slice(0, 24);

      // 3. Split content into chapters/chunks and translate
      const maxTranslateChunks = effectiveUnits.length;
      let runtimeConcurrency = translationConcurrency;
      let runtimeRequestSpacingMs = requestSpacingMs;
      let runtimeBatchCharLimit = batchCharLimit;
      let runtimeBatchItemLimit = batchItemLimit;
      let overloadStreak = 0;
      let degradeModeActive = false;
      let qaIssueCount = 0;

      const adultContentInstruction = options.isAdult 
        ? "CHẾ ĐỘ 18+ KHÔNG GIỚI HẠN: Bạn là một dịch giả chuyên nghiệp. Bạn ĐƯỢC PHÉP và NÊN dịch các nội dung nhạy cảm, bạo lực, tình dục một cách CHI TIẾT và TRẦN TRỤI. Tuyệt đối không được né tránh hoặc tóm tắt."
        : "CHẾ ĐỘ BÌNH THƯỜNG: Tuyệt đối không dịch nội dung khiêu dâm hoặc bạo lực cực đoan.";
      const translateSingleStorySegment = async (params: {
        unitTitle: string;
        fallbackTitle: string;
        segmentText: string;
        segmentPosition: number;
        totalSegmentsInUnit: number;
        previousTranslatedTail: string;
        includeTitleField: boolean;
        retrievalContext: string;
      }): Promise<{ title: string; content: string }> => {
        const scopedDictionaryContext = trimTextByTokenBudget(
          buildScopedDictionaryContext(params.segmentText, dictionaryEntries, 18),
          220,
        );
        const retrievalContext = trimTextByTokenBudget(params.retrievalContext, 320);
        const previousContext = trimTextByTokenBudget(params.previousTranslatedTail, 260);
        const additionalInstructions = trimTextByTokenBudget(options.additionalInstructions, 220);
        const segmentRouteDecision = routeAiExecutionLane({
          task: 'story_translate',
          stage: 'draft',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: params.segmentText.length,
          preferredLane: translationLane,
        });
        const translatePrompt = prependPromptContract(`
            Bạn là một dịch giả văn học cao cấp, chuyên dịch truyện từ tiếng Trung sang tiếng Việt.
            Hãy dịch toàn bộ đoạn sau sang tiếng Việt mượt mà, tự nhiên, giữ đúng nghĩa, đúng xưng hô và đúng sắc thái bản gốc.
            ĐÂY LÀ PHẦN ${params.segmentPosition}/${params.totalSegmentsInUnit} CỦA "${params.unitTitle}".
            KHÔNG được tóm tắt, KHÔNG bỏ đoạn, KHÔNG rút gọn.
            
            ${adultContentInstruction}
            ${scopedDictionaryContext}
            YÊU CẦU BỔ SUNG: ${additionalInstructions || 'Giữ mạch truyện tự nhiên, chuẩn xưng hô.'}
            ${retrievalContext ? `BỐI CẢNH TRUY HỒI TỪ STORY BIBLE (top-k):\n${retrievalContext}` : ''}
            ${previousContext ? `NGỮ CẢNH NGAY TRƯỚC (để giữ xưng hô, nhịp văn và continuity):\n${previousContext}` : ''}
            
            NỘI DUNG CẦN DỊCH:
            ${params.segmentText}
            
            Trả về JSON (không bọc bằng dấu 3 backtick):
            {
              ${params.includeTitleField ? '"title": "Tiêu đề chương (dịch sang tiếng Việt)",' : '"title": "",'}
              "content": "Nội dung phần đã dịch (Markdown)"
            }
          `.trim(), {
            task: 'story_translate',
            stage: 'draft',
            promptVersion: translateBlueprint.version,
            outputSchema: 'translated_segment_json_v1',
            strictJson: true,
          });

        const isOllamaLocal = ai.provider === 'ollama';
        const dynamicMaxTokens = isOllamaLocal
          ? (turboMode
            ? Math.min(1200, Math.max(700, Math.round(params.segmentText.length * 0.58)))
            : Math.min(1600, Math.max(900, Math.round(params.segmentText.length * 0.7))))
          : (turboMode
            ? Math.min(12288, Math.max(2600, Math.round(params.segmentText.length * 1.18)))
            : Math.min(16384, Math.max(3400, Math.round(params.segmentText.length * 1.55))));
        const dynamicMinChars = isOllamaLocal
          ? (turboMode
            ? Math.max(120, Math.round(params.segmentText.length * 0.1))
            : Math.max(170, Math.round(params.segmentText.length * 0.14)))
          : (turboMode
            ? Math.max(160, Math.round(params.segmentText.length * 0.14))
            : Math.max(240, Math.round(params.segmentText.length * 0.2)));
        const translateTextRaw = await generateGeminiText(
          ai,
          segmentRouteDecision.lane,
          translatePrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: dynamicMaxTokens,
            minOutputChars: dynamicMinChars,
            maxRetries: translationRequestRetries,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
            ...buildTranslateTraceConfig('draft', {
              lane: segmentRouteDecision.lane,
              routeReason: segmentRouteDecision.reason,
              segmentPosition: params.segmentPosition,
            }),
          },
        );

        let translated = normalizeAiJsonContent(translateTextRaw || '', params.fallbackTitle);
        translated = {
          title: applyTranslationDictionaryToText(params.unitTitle || params.fallbackTitle, translated.title, dictionaryEntries) || translated.title,
          content: applyTranslationDictionaryToText(params.segmentText, translated.content, dictionaryEntries),
        };
        const shortThreshold = turboMode
          ? Math.max(120, Math.round(dynamicMinChars * 0.55))
          : Math.max(180, Math.round(dynamicMinChars * 0.7));
        if (translationRequestRetries > 0 && translated.content.length < shortThreshold) {
          const retryRouteDecision = routeAiExecutionLane({
            task: 'story_translate',
            stage: 'quality_gate',
            provider: ai.provider,
            profile: runtimeProfileMode,
            inputChars: params.segmentText.length,
            preferredLane: turboMode ? 'quality' : segmentRouteDecision.lane,
          });
          const retryPrompt = prependPromptContract(
            `${translatePrompt}\n\nYÊU CẦU BẮT BUỘC: Bản dịch trước quá ngắn. Hãy dịch đầy đủ toàn bộ đoạn nguồn, không tóm tắt, không rút gọn.`,
            {
              task: 'story_translate',
              stage: 'quality_gate',
              promptVersion: translateBlueprint.version,
              outputSchema: 'translated_segment_json_v1',
              strictJson: true,
            },
          );
          const retryRaw = await generateGeminiText(ai, retryRouteDecision.lane, retryPrompt, {
            responseMimeType: "application/json",
            maxOutputTokens: isOllamaLocal
              ? Math.min(1700, Math.round(dynamicMaxTokens * 1.15))
              : Math.min(16384, Math.round(dynamicMaxTokens * 1.25)),
            minOutputChars: Math.round(dynamicMinChars * 1.08),
            maxRetries: 1,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
            ...buildTranslateTraceConfig('quality_gate', {
              lane: retryRouteDecision.lane,
              routeReason: retryRouteDecision.reason,
              segmentPosition: params.segmentPosition,
            }),
          });
          const retried = normalizeAiJsonContent(retryRaw || '', params.fallbackTitle);
          const normalizedRetried = {
            title: applyTranslationDictionaryToText(params.unitTitle || params.fallbackTitle, retried.title, dictionaryEntries) || retried.title,
            content: applyTranslationDictionaryToText(params.segmentText, retried.content, dictionaryEntries),
          };
          if (normalizedRetried.content.length > translated.content.length) translated = normalizedRetried;
        }

        return {
          title: String(translated.title || params.fallbackTitle).trim() || params.fallbackTitle,
          content: String(translated.content || '').trim(),
        };
      };

      const translateStoryBatch = async (params: {
        unitTitle: string;
        fallbackTitle: string;
        batch: TranslationSegmentBatch;
        batchIndex: number;
        totalBatches: number;
        totalSegmentsInUnit: number;
        previousTranslatedTail: string;
        retrievalContext: string;
      }): Promise<{ title: string; segments: string[] }> => {
        const scopedDictionaryContext = trimTextByTokenBudget(
          buildScopedDictionaryContext(params.batch.sourceText, dictionaryEntries, 24),
          260,
        );
        const retrievalContext = trimTextByTokenBudget(params.retrievalContext, 340);
        const previousContext = trimTextByTokenBudget(params.previousTranslatedTail, 240);
        const additionalInstructions = trimTextByTokenBudget(options.additionalInstructions, 220);
        const includeTitleField = params.batchIndex === 0;
        const batchRouteDecision = routeAiExecutionLane({
          task: 'story_translate',
          stage: 'draft',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: params.batch.sourceText.length,
          preferredLane: translationLane,
        });
        const translatePrompt = prependPromptContract(`
            Bạn là một dịch giả văn học cao cấp, chuyên dịch truyện từ tiếng Trung sang tiếng Việt.
            Hãy dịch đồng thời ${params.batch.entries.length} đoạn sau sang tiếng Việt mượt mà, thuần Việt, đúng nghĩa và đúng không khí bản gốc.
            ĐÂY LÀ LÔ ${params.batchIndex + 1}/${params.totalBatches} CỦA "${params.unitTitle}".
            KHÔNG được tóm tắt, KHÔNG bỏ đoạn, KHÔNG gộp các đoạn với nhau.

            ${adultContentInstruction}
            ${scopedDictionaryContext}
            YÊU CẦU BỔ SUNG: ${additionalInstructions || 'Giữ phong cách kể chuyện tự nhiên.'}
            ${retrievalContext ? `BỐI CẢNH TRUY HỒI TỪ STORY BIBLE (top-k):\n${retrievalContext}` : ''}
            ${previousContext ? `NGỮ CẢNH NGAY TRƯỚC (để giữ xưng hô, nhịp văn và continuity):\n${previousContext}` : ''}

            Trả về JSON (không bọc bằng dấu 3 backtick):
            {
              ${includeTitleField ? '"title": "Tiêu đề chương (dịch sang tiếng Việt)",' : '"title": "",'}
              "segments": [
                { "id": 1, "content": "Bản dịch đoạn 1" }
              ]
            }

            QUY TẮC BẮT BUỘC:
            - Phải trả đủ đúng ${params.batch.entries.length} phần trong mảng "segments".
            - Thứ tự phải khớp chính xác từ 1 đến ${params.batch.entries.length}.
            - Mỗi "content" chỉ chứa bản dịch của đúng một đoạn nguồn tương ứng.

            NỘI DUNG CẦN DỊCH:
            ${params.batch.sourceText}
          `.trim(), {
            task: 'story_translate',
            stage: 'draft',
            promptVersion: translateBlueprint.version,
            outputSchema: 'translated_segment_batch_json_v1',
            strictJson: true,
          });

        const sourceLength = params.batch.sourceText.length;
        const isOllamaLocal = ai.provider === 'ollama';
        const dynamicMaxTokens = isOllamaLocal
          ? (turboMode
            ? Math.min(1300, Math.max(800, Math.round(sourceLength * 0.52)))
            : Math.min(1800, Math.max(1000, Math.round(sourceLength * 0.65))))
          : (turboMode
            ? Math.min(14336, Math.max(3600, Math.round(sourceLength * 1.08)))
            : Math.min(16384, Math.max(4600, Math.round(sourceLength * 1.35))));
        const dynamicMinChars = isOllamaLocal
          ? Math.max(
              130 * params.batch.entries.length,
              Math.round(sourceLength * (turboMode ? 0.09 : 0.13)),
            )
          : Math.max(
              180 * params.batch.entries.length,
              Math.round(sourceLength * (turboMode ? 0.13 : 0.19)),
            );

        const batchRaw = await generateGeminiText(
          ai,
          batchRouteDecision.lane,
          translatePrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: dynamicMaxTokens,
            minOutputChars: dynamicMinChars,
            maxRetries: translationRequestRetries,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
            ...buildTranslateTraceConfig('draft', {
              lane: batchRouteDecision.lane,
              routeReason: batchRouteDecision.reason,
              batchIndex: params.batchIndex,
            }),
          },
        );

        const normalizedBatch = normalizeTranslationBatchResponse(
          batchRaw || '',
          params.batch.entries.length,
          params.fallbackTitle,
        );
        const translatedSegments = params.batch.entries.map((entry, localIndex) =>
          applyTranslationDictionaryToText(
            entry.text,
            normalizedBatch.segments[localIndex] || '',
            dictionaryEntries,
          ),
        );

        const weakIndexes = translatedSegments.reduce<number[]>((acc, translatedText, localIndex) => {
          const content = String(translatedText || '').trim();
          const minChars = Math.max(90, Math.round(params.batch.entries[localIndex].text.length * (turboMode ? 0.1 : 0.14)));
          if (!content || content.length < minChars) acc.push(localIndex);
          return acc;
        }, []);

        for (const localIndex of weakIndexes) {
          const entry = params.batch.entries[localIndex];
          const single = await translateSingleStorySegment({
            unitTitle: params.unitTitle,
            fallbackTitle: params.fallbackTitle,
            segmentText: entry.text,
            segmentPosition: entry.index + 1,
            totalSegmentsInUnit: params.totalSegmentsInUnit,
            previousTranslatedTail: params.previousTranslatedTail,
            includeTitleField: includeTitleField && localIndex === 0,
            retrievalContext: params.retrievalContext,
          });
          translatedSegments[localIndex] = single.content;
          if (includeTitleField && localIndex === 0 && single.title.trim()) {
            normalizedBatch.title = single.title.trim();
          }
        }

        return {
          title: String(normalizedBatch.title || params.fallbackTitle).trim() || params.fallbackTitle,
          segments: translatedSegments.map((item) => String(item || '').trim()),
        };
      };

      const containsCjkChars = (value: string): boolean => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(value || ''));
      const chapterTitleCache = new Map<string, string>();
      const resolveChapterOrderForTitle = (sourceTitle: string, fallbackOrder: number): number => {
        const cleaned = cleanChapterHeading(sourceTitle);
        const chapterMatch =
          cleaned.match(/^第\s*([0-9０-９一二三四五六七八九十百千万億亿萬萬兩两零〇IVXLCDMivxlcdm]+)\s*[章节回卷部集篇]/i) ||
          cleaned.match(/^(?:chương|chuong|chapter|hồi|hoi)\s*([0-9ivxlcdm]+)/i);
        if (chapterMatch?.[1]) {
          const parsed = parseChapterOrderToken(chapterMatch[1]);
          if (parsed && Number.isFinite(parsed)) return parsed;
        }
        return Math.max(1, fallbackOrder);
      };
      const sanitizeVietnameseChapterTitle = (rawTitle: string, fallbackOrder: number): string => {
        const normalized = String(rawTitle || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return `Chương ${Math.max(1, fallbackOrder)}`;
        if (containsCjkChars(normalized)) return `Chương ${Math.max(1, fallbackOrder)}`;
        return normalized;
      };
      const ensureVietnameseChapterTitle = async (params: {
        sourceTitle: string;
        translatedTitle: string;
        chapterOrder: number;
      }): Promise<string> => {
        const current = String(params.translatedTitle || '').trim();
        const source = String(params.sourceTitle || '').trim();
        const fallbackOrder = resolveChapterOrderForTitle(source || current, params.chapterOrder);
        if (!containsCjkChars(current)) {
          return sanitizeVietnameseChapterTitle(current, fallbackOrder);
        }

        const cacheKey = `${source}__${current}`.trim();
        const cached = chapterTitleCache.get(cacheKey);
        if (cached) return sanitizeVietnameseChapterTitle(cached, fallbackOrder);

        const titleRoute = routeAiExecutionLane({
          task: 'story_translate',
          stage: 'quality_gate',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: Math.max(source.length, current.length),
          preferredLane: 'fast',
        });

        const titlePrompt = prependPromptContract(
          `
          Bạn là dịch giả Trung-Việt. Chỉ dịch TIÊU ĐỀ CHƯƠNG sang tiếng Việt tự nhiên.
          Bắt buộc giữ số chương chính xác.
          Không được giữ nguyên tiếng Trung.
          Không giải thích, không thêm câu dư.

          Tiêu đề gốc:
          ${source || current}

          Trả về JSON:
          {
            "title": "Tiêu đề tiếng Việt"
          }
          `.trim(),
          {
            task: 'story_translate',
            stage: 'quality_gate',
            promptVersion: translateBlueprint.version,
            outputSchema: 'translated_segment_json_v1',
            strictJson: true,
          },
        );

        try {
          const titleRaw = await generateGeminiText(ai, titleRoute.lane, titlePrompt, {
            responseMimeType: 'application/json',
            maxOutputTokens: 220,
            minOutputChars: 8,
            maxRetries: 1,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
            ...buildTranslateTraceConfig('quality_gate', {
              lane: titleRoute.lane,
              routeReason: titleRoute.reason,
              phase: 'chapter_title_only',
              chapterOrder: params.chapterOrder,
            }),
          });
          const parsed = normalizeAiJsonContent(titleRaw || '', `Chương ${fallbackOrder}`);
          const dictionaryApplied = applyTranslationDictionaryToText(source || current, parsed.title || '', dictionaryEntries);
          const resolved = sanitizeVietnameseChapterTitle(dictionaryApplied || parsed.title || '', fallbackOrder);
          chapterTitleCache.set(cacheKey, resolved);
          return resolved;
        } catch {
          const fallback = sanitizeVietnameseChapterTitle(current, fallbackOrder);
          chapterTitleCache.set(cacheKey, fallback);
          return fallback;
        }
      };

      const translateSingleChapter = async (unit: ChapterTranslationUnit, chapterIndex: number): Promise<Chapter | null> => {
        const sourceSegments = unit.segments.length ? unit.segments : [unit.source];
        const meaningfulEntries = sourceSegments
          .map((segment, index) => ({ index, text: String(segment || '').trim() }))
          .filter((entry) => entry.text.length >= 30);
        if (!meaningfulEntries.length) return null;
        const chapterCheckpointKey = `chapter:${chapterIndex}`;
        const chapterCheckpoint = checkpointChapterStates[chapterCheckpointKey];
        const translatedSegments: string[] = Array.isArray(chapterCheckpoint?.segments)
          ? chapterCheckpoint.segments.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        let translatedTitle = String(unit.title || `Chương ${chapterIndex + 1}`).trim() || `Chương ${chapterIndex + 1}`;
        let previousTranslatedTail = String(chapterCheckpoint?.lastTail || '').trim();
        const retrievalContext = buildBibleRetrievalContext({
          bible: storyBible,
          chapterIndex,
          topK: degradeModeActive ? 3 : 6,
          tokenBudget: degradeModeActive ? 260 : 420,
        });
        const effectiveBatchCharLimit = degradeModeActive
          ? Math.max(1200, Math.round(runtimeBatchCharLimit * 0.75))
          : runtimeBatchCharLimit;
        const effectiveBatchItemLimit = degradeModeActive ? 1 : runtimeBatchItemLimit;
        const batches = buildAdaptiveTranslationSegmentBatches(
          meaningfulEntries,
          effectiveBatchCharLimit,
          effectiveBatchItemLimit,
        );
        const startBatchIndex = Math.max(0, Math.min(batches.length, Number(chapterCheckpoint?.completedBatches || 0)));

        for (let batchIndex = startBatchIndex; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          throwIfAborted(abortSignal);
          const etaSeconds = estimateProcessingEtaSeconds(translateStartedAt, processedSegments, totalSegments);
          const etaLabel = formatEtaShort(etaSeconds);
          updateAiRun(aiRun, {
            message: 'Đang dịch truyện...',
            stageLabel: `Pha 3/4 · Dịch chương ${chapterIndex + 1}/${maxTranslateChunks}`,
            detail:
              `Đã dịch ${processedSegments}/${totalSegments} đoạn · Lô ${batchIndex + 1}/${batches.length} với ${batch.entries.length} đoạn` +
              `${turboMode ? ' · Ưu tiên tốc độ' : ''}${lowQuotaMode ? ' · Tiết kiệm hạn mức' : ''}` +
              `${degradeModeActive ? ' · Chế độ ổn định đang bật' : ''}` +
              `${overloadStreak > 0 ? ' · Đang tự phục hồi' : ''}` +
              `${etaLabel ? ` · ETA ~${etaLabel}` : ''}.`,
            progress: {
              completed: Math.min(processedSegments + batch.entries.length, totalSegments),
              total: Math.max(totalSegments, 1),
            },
          });
          if (runtimeRequestSpacingMs > 0 && (chapterIndex > 0 || batchIndex > 0)) {
            await sleepMs(runtimeRequestSpacingMs);
          }
          let batchResult: { title: string; segments: string[] };
          try {
            batchResult = await translateStoryBatch({
              unitTitle: unit.title || translatedTitle,
              fallbackTitle: translatedTitle || `Chương ${chapterIndex + 1}`,
              batch,
              batchIndex,
              totalBatches: batches.length,
              totalSegmentsInUnit: meaningfulEntries.length,
              previousTranslatedTail,
              retrievalContext,
            });
            overloadStreak = Math.max(0, overloadStreak - 1);
          } catch (batchError) {
            if (!isTransientAiServiceError(batchError)) throw batchError;
            overloadStreak += 1;
            runtimeConcurrency = Math.max(1, runtimeConcurrency - 1);
            runtimeBatchItemLimit = Math.max(1, runtimeBatchItemLimit - 1);
            runtimeBatchCharLimit = Math.max(ai.provider === 'ollama' ? 900 : 1400, Math.round(runtimeBatchCharLimit * 0.82));
            runtimeRequestSpacingMs = Math.min(ai.provider === 'ollama' ? 4200 : 2400, runtimeRequestSpacingMs + (ai.provider === 'ollama' ? 340 : 240));
            if (overloadStreak >= 2) degradeModeActive = true;
            updateAiRun(aiRun, {
              message: 'Model đang quá tải, tự chuyển chế độ an toàn...',
              stageLabel: `Pha 3/4 · Dịch chương ${chapterIndex + 1}/${maxTranslateChunks}`,
              detail:
                `Lô ${batchIndex + 1}/${batches.length} đang quá tải. Hệ thống đã tự giảm tốc độ để tiếp tục dịch ổn định hơn.`,
              progress: {
                completed: Math.min(processedSegments, totalSegments),
                total: Math.max(totalSegments, 1),
              },
            });
            const recoveredSegments: string[] = [];
            let recoveredTitle = translatedTitle || `Chương ${chapterIndex + 1}`;
            for (let localIndex = 0; localIndex < batch.entries.length; localIndex++) {
              const entry = batch.entries[localIndex];
              let translatedSingle = '';
              let resolved = false;
              for (let retryIndex = 0; retryIndex <= overloadFallbackRetries; retryIndex++) {
                try {
                  if (runtimeRequestSpacingMs > 0) {
                    await sleepMs(runtimeRequestSpacingMs + retryIndex * 220);
                  }
                  const single = await translateSingleStorySegment({
                    unitTitle: unit.title || recoveredTitle,
                    fallbackTitle: recoveredTitle || `Chương ${chapterIndex + 1}`,
                    segmentText: entry.text,
                    segmentPosition: entry.index + 1,
                    totalSegmentsInUnit: meaningfulEntries.length,
                    previousTranslatedTail,
                    includeTitleField: batchIndex === 0 && localIndex === 0,
                    retrievalContext,
                  });
                  translatedSingle = single.content;
                  if (single.title.trim() && (localIndex === 0 || /^chương\s*\d+$/i.test(recoveredTitle))) {
                    recoveredTitle = single.title.trim();
                  }
                  resolved = true;
                  break;
                } catch (singleError) {
                  if (!isTransientAiServiceError(singleError)) throw singleError;
                  if (retryIndex >= overloadFallbackRetries) {
                    throw new Error(
                      `Model quá tải liên tục khi dịch đoạn ${entry.index + 1}. Vui lòng đổi model rồi thử lại.`,
                    );
                  }
                  const waitMs = Math.min(15000, 1800 * (retryIndex + 1));
                  updateAiRun(aiRun, {
                    message: 'Đang tự hồi phục do model quá tải...',
                    stageLabel: `Pha 3/4 · Dịch chương ${chapterIndex + 1}/${maxTranslateChunks}`,
                    detail: `Đoạn ${entry.index + 1}/${meaningfulEntries.length} tạm quá tải, thử lại sau ${Math.round(waitMs / 1000)}s.`,
                    progress: {
                      completed: Math.min(processedSegments + recoveredSegments.length, totalSegments),
                      total: Math.max(totalSegments, 1),
                    },
                  });
                  await sleepMs(waitMs);
                }
              }
              if (!resolved) {
                throw new Error(`Không thể dịch đoạn ${entry.index + 1} do model quá tải kéo dài.`);
              }
              recoveredSegments.push(translatedSingle.trim());
              previousTranslatedTail = extractTranslationContextTail(translatedSingle, turboMode ? 680 : 920);
            }
            batchResult = {
              title: recoveredTitle,
              segments: recoveredSegments,
            };
          }
          processedSegments += batch.entries.length;
          processedChunkCount += 1;

          const parsedTitle = String(batchResult.title || '').trim();
          if (parsedTitle && (batchIndex === 0 || /^chương\s*\d+$/i.test(translatedTitle))) {
            translatedTitle = parsedTitle;
          }

          batchResult.segments.forEach((content) => {
            if (!content.trim()) return;
            translatedSegments.push(content.trim());
            previousTranslatedTail = extractTranslationContextTail(content, turboMode ? 680 : 920);
          });
          checkpointChapterStates[chapterCheckpointKey] = {
            title: translatedTitle,
            segments: [...translatedSegments],
            completedBatches: batchIndex + 1,
            lastTail: previousTranslatedTail,
          };
          if (processedChunkCount % checkpointEveryChunks === 0) {
            flushTranslationCheckpoint?.();
          }
        }

        const mergedChapterContent = translatedSegments.join('\n\n').trim();
        if (!mergedChapterContent) return null;
        translatedTitle = await ensureVietnameseChapterTitle({
          sourceTitle: String(unit.title || '').trim(),
          translatedTitle,
          chapterOrder: chapterIndex + 1,
        });
        checkpointChapterStates[chapterCheckpointKey] = {
          title: translatedTitle,
          segments: [...translatedSegments],
          completedBatches: Number.MAX_SAFE_INTEGER,
          lastTail: previousTranslatedTail,
        };
        flushTranslationCheckpoint?.();

        return {
          id: createClientId('chapter'),
          title: translatedTitle,
          content: improveBracketSystemSpacing(improveDialogueSpacing(mergedChapterContent)),
          order: chapterIndex + 1,
          createdAt: new Date().toISOString(),
        } as Chapter;
      };
      const dagLayers = buildChapterDagLayers(effectiveUnits, runtimeConcurrency);
      const chapterResultMap = new Map<number, Chapter | null>();
      for (let layerIndex = 0; layerIndex < dagLayers.length; layerIndex++) {
        const layer = dagLayers[layerIndex];
        const chapterWorkItems = layer.map((index) => ({ index, unit: effectiveUnits[index] }));
        const layerConcurrency = Math.max(1, Math.min(runtimeConcurrency, 2, chapterWorkItems.length));
        updateAiRun(aiRun, {
          message: 'Đang sắp xếp thứ tự dịch...',
          stageLabel: 'Pha 3/4 · Xử lý theo lớp chương',
          detail: `Đang xử lý lớp ${layerIndex + 1}/${dagLayers.length}. Mỗi lớp sẽ được dịch theo nhịp an toàn.`,
          progress: { completed: Math.min(processedSegments, totalSegments), total: Math.max(totalSegments, 1) },
        });
        const layerResults = await mapWithConcurrency(chapterWorkItems, layerConcurrency, async (item) => (
          translateSingleChapter(item.unit, item.index)
        ));
        layerResults.forEach((chapter, localIndex) => {
          chapterResultMap.set(layer[localIndex], chapter);
        });
      }
      let translatedChapters = effectiveUnits
        .map((_, index) => chapterResultMap.get(index) || null)
        .filter((chapter): chapter is Chapter => Boolean(chapter));

      if (!translatedChapters.length) {
        throw new Error('Không thể nhận diện nội dung hợp lệ để dịch. Vui lòng kiểm tra lại file nguồn.');
      }

      updateAiRun(aiRun, {
        message: 'Đang chạy Pha 4/4: QA nhất quán...',
        stageLabel: 'Pha 4/4 · QA nhất quán',
        detail: 'Đang kiểm tra cục bộ tên riêng, cụm từ cấm và format hội thoại trước khi hoàn tất.',
        progress: { completed: Math.min(processedSegments, totalSegments), total: Math.max(totalSegments, 1) },
      });
      const forbiddenPhrases = parseForbiddenClichePhrases('');
      const qaReports: Array<{
        chapterIndex: number;
        missingTerms: string[];
        forbiddenHits: string[];
      }> = [];
      translatedChapters = translatedChapters.map((chapter) => {
        const sourceUnit = effectiveUnits[Math.max(0, chapter.order - 1)];
        const qa = runLocalTranslationConsistencyQa({
          sourceText: sourceUnit?.source || '',
          translatedText: chapter.content,
          dictionary: dictionaryEntries,
          forbiddenPhrases,
        });
        qaIssueCount += qa.totalIssues;
        if (qa.totalIssues > 0) {
          qaReports.push({
            chapterIndex: Math.max(0, chapter.order - 1),
            missingTerms: qa.missingDictionaryTerms,
            forbiddenHits: qa.forbiddenPhraseHits,
          });
        }
        return {
          ...chapter,
          content: qa.normalizedContent,
          updatedAt: new Date().toISOString(),
        };
      });

      const qaRepairCandidates = qaReports
        .filter((item) => item.missingTerms.length > 0 || item.forbiddenHits.length > 0)
        .slice(0, hugeFileMode ? 0 : 2);
      for (const candidate of qaRepairCandidates) {
        const chapter = translatedChapters.find((item) => item.order - 1 === candidate.chapterIndex);
        if (!chapter) continue;
        const sourceUnit = effectiveUnits[candidate.chapterIndex];
        const qaRoute = routeAiExecutionLane({
          task: 'story_translate',
          stage: 'quality_gate',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: chapter.content.length,
          preferredLane: 'quality',
        });
        const qaPrompt = prependPromptContract(`
          Bạn là biên tập viên hậu kỳ bản dịch.
          Hãy chỉnh lại chương đã dịch theo đúng các lỗi đã chỉ ra, KHÔNG thêm nội dung mới và KHÔNG đổi ý nghĩa.

          Danh sách lỗi cục bộ:
          ${candidate.missingTerms.length ? `- Thiếu thuật ngữ/tên riêng: ${candidate.missingTerms.join(' | ')}` : '- Không có lỗi tên riêng.'}
          ${candidate.forbiddenHits.length ? `- Cụm từ sáo rỗng cần loại bỏ: ${candidate.forbiddenHits.join(' | ')}` : '- Không có cụm từ cấm.'}

          TỪ ĐIỂN BẮT BUỘC:
          ${trimTextByTokenBudget(buildScopedDictionaryContext(sourceUnit?.source || '', dictionaryEntries, 24), 220)}

          NGUỒN GỐC:
          ${trimTextByTokenBudget(sourceUnit?.source || '', 460)}

          BẢN DỊCH HIỆN TẠI:
          ${trimTextByTokenBudget(chapter.content, 520)}

          Trả về JSON:
          {
            "title": "${chapter.title}",
            "content": "Bản đã sửa"
          }
        `.trim(), {
          task: 'story_translate',
          stage: 'quality_gate',
          promptVersion: translateBlueprint.version,
          outputSchema: 'translated_segment_json_v1',
          strictJson: true,
        });
        const repairedRaw = await generateGeminiText(ai, qaRoute.lane, qaPrompt, {
          responseMimeType: 'application/json',
          maxOutputTokens: 6200,
          minOutputChars: Math.max(220, Math.round(chapter.content.length * 0.78)),
          maxRetries: 1,
          safetySettings: sharedSafetySettings,
          signal: abortSignal,
          ...buildTranslateTraceConfig('quality_gate', {
            lane: qaRoute.lane,
            routeReason: qaRoute.reason,
            chapterIndex: candidate.chapterIndex,
            phase: 'qa_repair',
          }),
        });
        const repaired = normalizeAiJsonContent(repairedRaw || '', chapter.title);
        chapter.content = improveBracketSystemSpacing(
          improveDialogueSpacing(
            applyTranslationDictionaryToText(sourceUnit?.source || '', repaired.content || chapter.content, dictionaryEntries),
          ),
        );
      }

      const attemptReleaseGateAutoRepair = async (
        report: TranslationReleaseGateReport,
      ): Promise<TranslationReleaseGateReport> => {
        const chapterOrders = Array.from(
          new Set(
            report.blockingIssues
              .filter((item) => (item.code === 'residual_cjk' || item.code === 'mixed_language_line') && Number(item.chapterOrder))
              .map((item) => Number(item.chapterOrder))
              .filter((value) => Number.isFinite(value) && value > 0),
          ),
        ).slice(0, hugeFileMode ? 2 : 4);
        if (!chapterOrders.length) return report;

        updateAiRun(aiRun, {
          message: 'Hệ thống đang tự sửa lỗi trộn ngôn ngữ...',
          stageLabel: 'Pha 4/4 · QA nhất quán',
          detail: `Đang sửa tự động ${chapterOrders.length} chương bị lẫn ngôn ngữ trước khi lưu.`,
          progress: { completed: Math.min(processedSegments, totalSegments), total: Math.max(totalSegments, 1) },
        });

        for (const chapterOrder of chapterOrders) {
          const chapter = translatedChapters.find((item) => Number(item.order) === chapterOrder);
          if (!chapter) continue;
          const sourceUnit = effectiveUnits[Math.max(0, chapterOrder - 1)];
          const rawParagraphs = String(chapter.content || '')
            .split(/\n{2,}/)
            .map((item) => item.trim())
            .filter(Boolean);
          if (!rawParagraphs.length) continue;

          const flaggedIndexes = rawParagraphs.reduce<number[]>((acc, para, index) => {
            const hasCjk = /[\u3400-\u9FFF]/.test(para);
            const hasMixed = collectMixedLanguageLines(para, 1).length > 0;
            if (hasCjk || hasMixed) acc.push(index);
            return acc;
          }, []).slice(0, 8);
          if (!flaggedIndexes.length) continue;

          for (const paraIndex of flaggedIndexes) {
            const paragraph = rawParagraphs[paraIndex];
            const repairRoute = routeAiExecutionLane({
              task: 'story_translate',
              stage: 'quality_gate',
              provider: ai.provider,
              profile: runtimeProfileMode,
              inputChars: paragraph.length,
              preferredLane: 'quality',
            });
            const repairPrompt = prependPromptContract(`
              Bạn là biên tập viên hậu kỳ bản dịch.
              Đoạn dưới đang bị lẫn chữ Trung hoặc trộn ngôn ngữ. Hãy chuyển toàn bộ thành tiếng Việt tự nhiên.
              Không thêm nội dung mới, không rút gọn ý, giữ nguyên tên riêng và xưng hô.

              TỪ ĐIỂN ƯU TIÊN:
              ${trimTextByTokenBudget(buildScopedDictionaryContext(sourceUnit?.source || '', dictionaryEntries, 24), 220)}

              ĐOẠN CẦN SỬA:
              ${paragraph}

              Trả về JSON:
              {
                "title": "${chapter.title}",
                "content": "Đoạn đã sửa sạch, chỉ còn tiếng Việt"
              }
            `.trim(), {
              task: 'story_translate',
              stage: 'quality_gate',
              promptVersion: translateBlueprint.version,
              outputSchema: 'translated_segment_json_v1',
              strictJson: true,
            });
            const repairedRaw = await generateGeminiText(ai, repairRoute.lane, repairPrompt, {
              responseMimeType: 'application/json',
              maxOutputTokens: ai.provider === 'ollama' ? 1300 : 4200,
              minOutputChars: Math.max(90, Math.round(paragraph.length * 0.65)),
              maxRetries: 1,
              safetySettings: sharedSafetySettings,
              signal: abortSignal,
              ...buildTranslateTraceConfig('quality_gate', {
                lane: repairRoute.lane,
                routeReason: repairRoute.reason,
                chapterIndex: chapterOrder - 1,
                phase: 'qa_gate_auto_repair',
              }),
            });
            const repaired = normalizeAiJsonContent(repairedRaw || '', chapter.title);
            const cleanedParagraph = improveBracketSystemSpacing(
              improveDialogueSpacing(
                applyTranslationDictionaryToText(sourceUnit?.source || '', repaired.content || paragraph, dictionaryEntries),
              ),
            ).trim();
            if (cleanedParagraph) rawParagraphs[paraIndex] = cleanedParagraph;
          }

          chapter.content = improveBracketSystemSpacing(
            improveDialogueSpacing(rawParagraphs.join('\n\n')),
          );
          chapter.updatedAt = new Date().toISOString();
        }

        return runTranslationReleaseGate(translatedChapters);
      };

      let releaseGate = runTranslationReleaseGate(translatedChapters);
      if (!releaseGate.pass) {
        releaseGate = await attemptReleaseGateAutoRepair(releaseGate);
      }
      setTranslationGateLastReport(releaseGate);
      if (!releaseGate.pass) {
        const blockerSummary = releaseGate.blockingIssues
          .slice(0, 3)
          .map((item) => item.message)
          .join(' | ');
        updateAiRun(aiRun, {
          message: 'Kiểm tra chất lượng đã chặn xuất bản dịch',
          stageLabel: 'Pha 4/4 · QA nhất quán',
          detail: blockerSummary || 'Bản dịch chưa đạt mức chất lượng tối thiểu.',
          progress: { completed: Math.min(processedSegments, totalSegments), total: Math.max(totalSegments, 1) },
        });
        throw new Error(
          `Kiểm tra chất lượng chặn bản dịch: ${blockerSummary || 'Phát hiện lỗi cấu trúc hoặc còn chữ Trung trong kết quả.'}`,
        );
      }
      if (releaseGate.warningIssues.length > 0) {
        notifyApp({
          tone: 'warn',
          message: `Kiểm tra chất lượng: còn ${releaseGate.warningIssues.length} cảnh báo nhẹ. Bạn nên rà soát lại trước khi xuất bản.`,
          timeoutMs: 4200,
        });
      }

      // Save to local storage so it shows up in the UI
      const localChapters = normalizeChaptersForLocal(translatedChapters);
      const pipelineNotes = [
        'Pipeline dịch 4 pha đã chạy:',
        `1) Cấu trúc local: ${structureAnalysis.chapterCount} chương, ${structureAnalysis.paragraphCount} đoạn, ${structureAnalysis.dialogueCount} hội thoại.`,
        `Phạm vi đã dịch: chương ${safeRangeStart}-${safeRangeEnd} trên tổng ${totalDetectedUnits} chương đã nhận diện.`,
        `2) Ghi nhớ nội dung: đã tạo tóm tắt cho ${storyBible.chapterSummaries.length} chương và ${storyBible.arcSummaries.length} tuyến truyện.`,
        `3) Dịch: đã xử lý ${processedSegments}/${totalSegments} đoạn; chế độ ổn định ${degradeModeActive ? 'đang bật' : 'đang tắt'}.`,
        `4) Kiểm tra nhất quán: phát hiện ${qaIssueCount} cảnh báo cục bộ và đã xử lý hậu kỳ.`,
        `Kết quả kiểm tra trước khi lưu: đạt yêu cầu (ký tự tiếng Trung còn sót: ${releaseGate.stats.cjkChars}, dòng trộn ngôn ngữ: ${releaseGate.stats.mixedLineCount}, cảnh báo: ${releaseGate.warningIssues.length}).`,
      ].join('\n');
      const mergedStoryPromptNotes = attachStoryBibleToNotes(pipelineNotes, storyBible);
      createAndStoreStory(({ storyId, storySlug, now }) => ({
        id: storyId,
        slug: storySlug,
        authorId: user.uid,
        title: String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Bản dịch)",
        content: String(translateFileContent || "").substring(0, 5000) + "...",
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: String(analysis.genre || "Dịch thuật").substring(0, 190),
        type: 'translated',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        storyPromptNotes: mergedStoryPromptNotes,
        translationMemory: storyTranslationMemory,
        createdAt: now,
        updatedAt: now,
        chapters: localChapters,
      }));
      clearTranslationPipelineCheckpoint(checkpointFingerprint);

      const elapsedSeconds = Math.max(1, Math.round((Date.now() - translateStartedAt) / 1000));
      translateTaskRun.complete({
        chapters: translatedChapters.length,
        processedSegments,
        elapsedSeconds,
      });
      notifyApp({
        tone: 'success',
        message: `Đã dịch thành công ${translatedChapters.length} chương (${processedSegments} phân đoạn) trong ${elapsedSeconds} giây.`,
        timeoutMs: 5200,
      });
      setView('stories');
    } catch (error) {
      flushTranslationCheckpoint?.();
      translateTaskRun?.fail(error, {
        at: 'handleTranslateStory',
      });
      console.error("Lỗi khi dịch truyện:", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (/cancelled by user/i.test(rawMessage)) {
        notifyApp({ tone: 'warn', message: 'Đã hủy quá trình dịch truyện.' });
      } else if (isQuotaOrRateLimitError(error)) {
        notifyApp({ tone: 'warn', message: `AI đang chạm giới hạn tần suất hoặc hạn mức. ${rawMessage}` , timeoutMs: 5200});
      } else if (isTransientAiServiceError(error)) {
        notifyApp({ tone: 'warn', message: `Model AI đang quá tải tạm thời. ${rawMessage}`, timeoutMs: 5200 });
      } else {
        notifyApp({ tone: 'error', message: `Có lỗi khi AI dịch truyện: ${rawMessage.slice(0, 260)}`, timeoutMs: 5200 });
      }
    } finally {
      finishAiRun(aiRun);
    }
  };

  const handleAIContinueStory = async (options: {
    chapterCount: number,
    isAdult: boolean,
    additionalInstructions: string,
    selectedRuleId?: string
  }) => {
    if (!user || !continueFileContent) return;
    
    setShowAIContinueModal(false);
    const aiRun = beginAiRun("Đang phân tích nội dung truyện...", {
      stageLabel: 'Phân tích truyện',
      detail: 'Hệ thống đang đọc phần truyện gốc để hiểu văn phong, nhân vật và bối cảnh hiện tại.',
      progress: { completed: 1, total: 3 },
    });
    const abortSignal = aiRun.controller.signal;
    let continueTaskRun: ReturnType<typeof startAiTaskRun> | null = null;

    try {
      let finalInstructions = options.additionalInstructions;
      if (options.selectedRuleId) {
        const selectedRule = storage
          .getAIRules()
          .find((rule: AIRule) => rule.id === options.selectedRuleId && rule.authorId === user.uid);
        if (selectedRule?.content) {
          finalInstructions = selectedRule.content + "\n\n" + finalInstructions;
        }
      }

      const ai = createGeminiClient();
      const continueBlueprint = getPromptBlueprint('story_continue');
      const runtimeProfileMode = getApiRuntimeConfig().aiProfile;
      const runtimeGenerationConfig = getApiRuntimeConfig().generation;
      const autoCritiqueEnabled = runtimeGenerationConfig.autoCritique !== false;
      continueTaskRun = startAiTaskRun('story_continue', continueBlueprint.version, {
        provider: ai.provider,
        model: ai.model,
        fileName: String(continueFileName || ''),
      });
      const buildContinueTraceConfig = (
        stage: 'analysis' | 'plan' | 'draft' | 'quality_gate',
        extra?: Record<string, unknown>,
      ) => ({
        taskType: 'story_continue' as AiTaskType,
        promptVersion: continueBlueprint.version,
        traceRunId: continueTaskRun.runId,
        traceStage: stage,
        traceMeta: buildTraceMetadata(continueTaskRun.traceFor(stage), extra),
      });
      const continueCharCount = String(continueFileContent || '').length;
      const continueDetectedSections = detectChapterSections(continueFileContent);
      const continueLoadProfile = computeAutoContentLoadProfile({
        text: continueFileContent,
        provider: ai.provider,
        detectedChapterCount: continueDetectedSections.length,
      });
      const largeContinueMode = continueLoadProfile.turboMode;
      const extremeContinueMode = continueLoadProfile.extremeFileMode;
      const analysisExcerpt = buildBalancedStoryExcerpt(
        continueFileContent,
        extremeContinueMode ? 11000 : continueLoadProfile.hugeFileMode ? 13000 : largeContinueMode ? 15000 : 18000,
      );
      const recentStoryTail = String(continueFileContent || '')
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(-(extremeContinueMode ? 2600 : continueLoadProfile.hugeFileMode ? 3400 : largeContinueMode ? 4000 : 5200));
      
      // 1. Analyze the story
      const continueAnalysisRoute = routeAiExecutionLane({
        task: 'story_continue',
        stage: 'analysis',
        provider: ai.provider,
        profile: runtimeProfileMode,
        inputChars: analysisExcerpt.length,
        preferredLane: largeContinueMode ? 'fast' : 'quality',
      });
      continueTaskRun.markStage('analysis', {
        lane: continueAnalysisRoute.lane,
        routeReason: continueAnalysisRoute.reason,
        sourceChars: continueCharCount,
      });
      const analysisPrompt = prependPromptContract(`
        Hãy phân tích nội dung truyện sau đây.
        Lưu ý: đây có thể là bản trích cân bằng giữa phần đầu và phần gần cuối của file lớn, nên hãy ưu tiên nhận diện phong cách, nhân vật và tình tiết đang diễn ra.
        "${analysisExcerpt}"
        
        Yêu cầu:
        1. Tóm tắt cốt truyện chính.
        2. Phân tích văn phong (hành văn, nhịp điệu, cách dùng từ).
        3. Liệt kê danh sách các nhân vật chính và tính cách của họ.
        4. Xác định bối cảnh và các tình tiết quan trọng gần nhất.
        
        Trả về kết quả dưới dạng JSON với cấu trúc:
        {
          "summary": "...",
          "writingStyle": "...",
          "characters": [{"name": "...", "personality": "..."}],
          "currentContext": "..."
        }
        CHỈ TRẢ VỀ JSON thuần, KHÔNG bọc bằng dấu 3 backtick và KHÔNG thêm giải thích.
      `.trim(), {
        task: 'story_continue',
        stage: 'analysis',
        promptVersion: continueBlueprint.version,
        outputSchema: 'story_analysis_v1',
        strictJson: true,
      });

      const analysisText = await generateGeminiText(
        ai,
        continueAnalysisRoute.lane,
        analysisPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: largeContinueMode ? 2400 : 3200,
          minOutputChars: 260,
          maxRetries: extremeContinueMode ? 1 : 2,
          signal: abortSignal,
          ...buildContinueTraceConfig('analysis', {
            lane: continueAnalysisRoute.lane,
            routeReason: continueAnalysisRoute.reason,
          }),
        },
      ) || '{}';
      const analysisParsed = tryParseJson<Record<string, unknown>>(analysisText, 'object') || {};
      const analysisValidation = validateStoryAnalysis({
        summary: String(analysisParsed.summary || '').trim() || String(analysisText || '').trim(),
        writingStyle: String(analysisParsed.writingStyle || '').trim(),
        currentContext: String(analysisParsed.currentContext || '').trim(),
        genre: 'Viết tiếp',
        characters: Array.isArray(analysisParsed.characters) ? analysisParsed.characters : [],
      });
      const analysis = {
        summary: analysisValidation.data.summary || String(analysisText || '').trim(),
        writingStyle: analysisValidation.data.writingStyle,
        characters: analysisValidation.data.characters,
        currentContext: analysisValidation.data.currentContext,
      };
      updateAiRun(aiRun, {
        message: 'Đang lập kế hoạch các chương tiếp theo...',
        stageLabel: 'Lập kế hoạch',
        detail: `${largeContinueMode ? 'Đã phân tích theo chế độ file lớn, giữ cả phần đầu và diễn biến gần cuối. ' : ''}Chế độ tự động: ${continueLoadProfile.mode.toUpperCase()}. AI đang dựng kế hoạch chương mới.`,
        progress: { completed: 2, total: 3 },
      });

      // 2. Plan next chapters
      const compactCharacters = Array.isArray(analysis.characters)
        ? analysis.characters.slice(0, largeContinueMode ? 10 : 14).map((item: any) => ({
            name: String(item?.name || '').trim(),
            personality: String(item?.personality || '').trim(),
          }))
        : [];
      const compactCharacterGuide = compactCharacters.length
        ? compactCharacters
            .map((item) => `- ${item.name || 'Nhân vật'}: ${item.personality || 'chưa rõ tính cách'}`)
            .join('\n')
        : 'Chưa có dữ liệu nhân vật rõ ràng.';
      const continuePlanRoute = routeAiExecutionLane({
        task: 'story_continue',
        stage: 'plan',
        provider: ai.provider,
        profile: runtimeProfileMode,
        inputChars: `${analysis.summary}\n${analysis.currentContext}\n${finalInstructions}`.length,
        preferredLane: largeContinueMode ? 'fast' : 'quality',
      });
      continueTaskRun.markStage('plan', {
        lane: continuePlanRoute.lane,
        routeReason: continuePlanRoute.reason,
        chapterCount: options.chapterCount,
      });
      const planPrompt = prependPromptContract(`
        Dựa trên phân tích sau:
        Tóm tắt: ${analysis.summary}
        Văn phong: ${analysis.writingStyle}
        Bối cảnh hiện tại: ${analysis.currentContext}
        Nhân vật nòng cốt:
        ${compactCharacterGuide}
        
        Hãy lập kế hoạch cho ${options.chapterCount} chương tiếp theo.
        Yêu cầu bổ sung từ người dùng: ${finalInstructions}
        
        Trả về danh sách tiêu đề và tóm tắt ngắn gọn cho mỗi chương dưới dạng JSON:
        {
          "chapters": [{"title": "...", "outline": "..."}]
        }
        CHỈ TRẢ VỀ JSON thuần, KHÔNG bọc bằng dấu 3 backtick và KHÔNG thêm giải thích.
      `.trim(), {
        task: 'story_continue',
        stage: 'plan',
        promptVersion: continueBlueprint.version,
        outputSchema: 'story_plan_v1',
        strictJson: true,
      });

      const planText = await generateGeminiText(
        ai,
        continuePlanRoute.lane,
        planPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: Math.min(largeContinueMode ? 3600 : 5200, Math.max(1400, options.chapterCount * (largeContinueMode ? 520 : 700))),
          minOutputChars: Math.max(200, options.chapterCount * 70),
          maxRetries: extremeContinueMode ? 1 : 2,
          signal: abortSignal,
          ...buildContinueTraceConfig('plan', {
            lane: continuePlanRoute.lane,
            routeReason: continuePlanRoute.reason,
          }),
        },
      ) || '{}';
      const planParsed = tryParseJson<unknown>(planText, 'any');
      const planValidation = validateStoryPlan(planParsed, Math.max(1, options.chapterCount));
      let plannedChapters: Array<{ title: string; outline: string }> = planValidation.ok
        ? planValidation.data.chapters
        : [];
      if (!plannedChapters.length) {
        plannedChapters = buildFallbackChapters(planText, options.chapterCount).map((c) => ({
          title: c.title,
          outline: c.content,
        }));
      }
      if (!plannedChapters.length) {
        throw new Error('AI không trả về kế hoạch chương hợp lệ.');
      }
      plannedChapters = plannedChapters.slice(0, Math.max(1, options.chapterCount));
      
      // 3. Generate chapters
      const generatedChapters: Chapter[] = [];
      const minChapterWords = 1800;
      const chapterMaxTokens = Math.min(16384, Math.max(3600, Math.round(minChapterWords * 2.4)));
      const minChapterChars = Math.max(1100, Math.round(minChapterWords * 2.2));
      for (let i = 0; i < plannedChapters.length; i++) {
        throwIfAborted(abortSignal);
        const ch = plannedChapters[i];
        updateAiRun(aiRun, {
          message: `Đang viết chương ${i + 1}/${plannedChapters.length}`,
          stageLabel: 'Viết nội dung',
          detail: ch.title || `Chương ${i + 1}`,
          progress: { completed: i + 1, total: Math.max(plannedChapters.length, 1) },
        });
        
        const chapterPrompt = prependPromptContract(`
          Hãy viết chương "${ch.title}" cho truyện dựa trên các thông tin sau:
          
          Tóm tắt truyện: ${analysis.summary}
          Văn phong yêu cầu: ${analysis.writingStyle}
          Nhân vật nòng cốt:
          ${compactCharacterGuide}
          Bối cảnh hiện tại: ${analysis.currentContext}
          Trích đoạn gần cuối bản gốc để giữ continuity:
          ${recentStoryTail}
          Dàn ý chương này: ${ch.outline}
          Yêu cầu bổ sung: ${finalInstructions}
          Nội dung người lớn: ${options.isAdult ? 'CÓ (hãy viết chi tiết)' : 'KHÔNG'}
          
          Yêu cầu:
          - Viết ít nhất 2000 từ.
          - Sử dụng đúng văn phong đã phân tích.
          - Không tóm tắt, hãy viết chi tiết các hành động và lời thoại.
        `.trim(), {
          task: 'story_continue',
          stage: 'draft',
          promptVersion: continueBlueprint.version,
          outputSchema: 'chapter_markdown_text_v1',
          strictJson: false,
        });
        const chapterDraftRoute = routeAiExecutionLane({
          task: 'story_continue',
          stage: 'draft',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: chapterPrompt.length,
          preferredLane: largeContinueMode ? 'fast' : 'quality',
        });
        continueTaskRun.markStage('draft', {
          chapterIndex: i + 1,
          total: plannedChapters.length,
          lane: chapterDraftRoute.lane,
          routeReason: chapterDraftRoute.reason,
        });

        let chapterText = await generateGeminiText(
          ai,
          chapterDraftRoute.lane,
          chapterPrompt,
          {
            maxOutputTokens: chapterMaxTokens,
            minOutputChars: minChapterChars,
            maxRetries: extremeContinueMode ? 1 : 2,
            safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
            signal: abortSignal,
            ...buildContinueTraceConfig('draft', {
              chapterIndex: i + 1,
              lane: chapterDraftRoute.lane,
              routeReason: chapterDraftRoute.reason,
            }),
          },
        );

        if (autoCritiqueEnabled && countWords(chapterText || '') < Math.max(220, Math.round(minChapterWords * 0.55))) {
          const retryRoute = routeAiExecutionLane({
            task: 'story_continue',
            stage: 'quality_gate',
            provider: ai.provider,
            profile: runtimeProfileMode,
            inputChars: chapterPrompt.length,
            preferredLane: 'quality',
          });
          chapterText = await generateGeminiText(
            ai,
            retryRoute.lane,
            prependPromptContract(
              `${chapterPrompt}\n\nYÊU CẦU BẮT BUỘC: Bản trước quá ngắn. Hãy viết lại đầy đủ, chi tiết, đúng độ dài yêu cầu.`,
              {
                task: 'story_continue',
                stage: 'quality_gate',
                promptVersion: continueBlueprint.version,
                outputSchema: 'chapter_markdown_text_v1',
                strictJson: false,
              },
            ),
            {
              maxOutputTokens: Math.min(16384, Math.round(chapterMaxTokens * 1.35)),
              minOutputChars: Math.round(minChapterChars * 1.15),
              maxRetries: 1,
              safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
              signal: abortSignal,
              ...buildContinueTraceConfig('quality_gate', {
                chapterIndex: i + 1,
                lane: retryRoute.lane,
                routeReason: retryRoute.reason,
                reason: 'too_short',
              }),
            },
          );
        }

        const chapterQualityIssue = getNarrativeQualityIssue(ch.title, chapterText || '', Math.max(850, Math.round(minChapterChars * 0.7)));
        if (autoCritiqueEnabled && chapterQualityIssue) {
          const qualityGateRoute = routeAiExecutionLane({
            task: 'story_continue',
            stage: 'quality_gate',
            provider: ai.provider,
            profile: runtimeProfileMode,
            inputChars: chapterPrompt.length,
            preferredLane: 'quality',
          });
          chapterText = await generateGeminiText(
            ai,
            qualityGateRoute.lane,
            prependPromptContract(`${chapterPrompt}

YÊU CẦU SỬA LỖI:
- Bản trước bị lỗi: ${chapterQualityIssue}
- Tuyệt đối không trả dàn ý, không checklist, không gạch đầu dòng.
- Chỉ trả một chương truyện hoàn chỉnh, văn xuôi liền mạch, có hành động và đối thoại.`, {
              task: 'story_continue',
              stage: 'quality_gate',
              promptVersion: continueBlueprint.version,
              outputSchema: 'chapter_markdown_text_v1',
              strictJson: false,
            }),
            {
              maxOutputTokens: Math.min(16384, Math.round(chapterMaxTokens * 1.2)),
              minOutputChars: Math.round(minChapterChars * 1.1),
              maxRetries: 1,
              signal: abortSignal,
              ...buildContinueTraceConfig('quality_gate', {
                chapterIndex: i + 1,
                lane: qualityGateRoute.lane,
                routeReason: qualityGateRoute.reason,
                reason: chapterQualityIssue,
              }),
            },
          );
        }

        const finalChapterIssue = getNarrativeQualityIssue(ch.title, chapterText || '', Math.max(800, Math.round(minChapterChars * 0.55)));
        if (finalChapterIssue) {
          throw new Error(`AI trả chương "${ch.title}" chưa đạt chuẩn: ${finalChapterIssue}`);
        }

        generatedChapters.push({
          id: createClientId('chapter'),
          title: ch.title,
          content: chapterText || '',
          order: i + 1,
          createdAt: new Date().toISOString(),
        });
      }

      // Save to local storage so it shows up in the UI
      const localChapters = normalizeChaptersForLocal(generatedChapters);
      createAndStoreStory(({ storyId, storySlug, now }) => ({
        id: storyId,
        slug: storySlug,
        authorId: user.uid,
        title: String(continueFileName || "Truyện viết tiếp").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Viết tiếp)",
        content: String(continueFileContent || "").substring(0, 5000) + "...",
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: "Viết tiếp",
        type: 'continued',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        createdAt: now,
        updatedAt: now,
        chapters: localChapters,
      }));

      continueTaskRun.complete({
        chapters: generatedChapters.length,
        sourceChars: continueCharCount,
      });
      notifyApp({ tone: 'success', message: `Đã viết tiếp thành công ${options.chapterCount} chương!`, timeoutMs: 5200 });
      setView('stories');
    } catch (error) {
      continueTaskRun?.fail(error, {
        at: 'handleAIContinueStory',
      });
      console.error("Lỗi khi viết tiếp truyện:", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (/cancelled by user/i.test(rawMessage)) {
        notifyApp({ tone: 'warn', message: 'Đã hủy quá trình viết tiếp truyện.' });
      } else {
        notifyApp({ tone: 'error', message: `Có lỗi khi AI viết tiếp truyện: ${rawMessage.slice(0, 260)}`, timeoutMs: 5200 });
      }
    } finally {
      finishAiRun(aiRun);
    }
  };

  const handleAIGenerateChapters = async (options: {
    outline: string, 
    chapterLength: string, 
    chapterCount: number, 
    isAdult: boolean,
    pacing: string,
    tone: string,
    focus: string,
    predictPlot: boolean,
    customPacing?: string,
    customTone?: string,
    customFocus?: string,
    selectedCharacters: string[],
    keyEvents: string,
    previousContext: string,
    perspective: string,
    audience: string,
    styleReference: string,
    aiInstructions: string,
    chapterScript: string,
    bannedPhrases: string,
    selectedRuleId?: string
  }) => {
    const { 
      outline, chapterLength, chapterCount, isAdult, pacing, tone, focus, predictPlot,
      customPacing, customTone, customFocus, selectedCharacters, keyEvents, previousContext,
      perspective, audience, styleReference, aiInstructions, chapterScript, bannedPhrases, selectedRuleId
    } = options;
    if (!user || !selectedStory) return;
    const latestStory = (storage.getStories() as Story[]).find((story) => story.id === selectedStory.id) || selectedStory;
    const currentChapters = normalizeChaptersForLocal((latestStory.chapters || []) as Chapter[]);
    const latestChapterContext = currentChapters.length
      ? String(
          [...currentChapters]
            .sort((a, b) => Number(b.order || 0) - Number(a.order || 0))[0]?.content || '',
        ).trim()
      : '';
    const effectivePreviousContext = currentChapters.length
      ? (String(previousContext || '').trim() || latestChapterContext)
      : '';
    const forbiddenPhrases = parseForbiddenClichePhrases(bannedPhrases);
    const forbiddenPhraseInstruction = forbiddenPhrases.length
      ? [
          'QUY TẮC BẮT BUỘC VỀ VĂN PHONG (CHỐNG SÁO RỖNG):',
          'Tuyệt đối không sử dụng các cụm từ sau dưới bất kỳ biến thể nào:',
          ...forbiddenPhrases.map((phrase, index) => `${index + 1}. "${phrase}"`),
          'Nếu cần diễn đạt ý tương tự, phải đổi sang cách nói mới, cụ thể, có chi tiết hành động/giác quan.',
        ].join('\n')
      : '';
    const sanitizeChapterDrafts = (items: Array<{ title?: string; content?: string }>) => {
      return items.map((item, idx) => {
        const rawTitle = typeof item === 'object' && item ? String(item.title || '').trim() : '';
        const rawContent = typeof item === 'object' && item ? String(item.content || '') : String(item || '');
        const normalized = normalizeAiJsonContent(rawContent, rawTitle || `Chương mới ${idx + 1}`);
        return {
          title: String(rawTitle || normalized.title || `Chương mới ${idx + 1}`).trim(),
          content: String(normalized.content || rawContent || '').trim(),
        };
      });
    };
    setShowAIGen(false);
    const aiRun = beginAiRun("Đang chuẩn bị dữ liệu...", {
      stageLabel: 'Chuẩn bị đầu vào',
      detail: 'Đang gom outline, context, quy tắc và thông tin nhân vật trước khi gọi model viết chương.',
    });
    const abortSignal = aiRun.controller.signal;
    let generateTaskRun: ReturnType<typeof startAiTaskRun> | null = null;

    try {
      let finalInstructions = aiInstructions;
      if (selectedRuleId) {
        const selectedRule = storage
          .getAIRules()
          .find((rule: AIRule) => rule.id === selectedRuleId && rule.authorId === user.uid);
        if (selectedRule?.content) {
          finalInstructions = selectedRule.content + "\n\n" + finalInstructions;
        }
      }

      // Fetch character details
      let charContext = "";
      if (selectedCharacters.length > 0) {
        const selectedChars = storage
          .getCharacters()
          .filter((character: Character) => character.authorId === user.uid && selectedCharacters.includes(character.id));
        
        charContext = selectedChars.map(c => 
          `Nhân vật: ${c.name}\nNgoại hình: ${c.appearance}\nTính cách: ${c.personality}`
        ).join('\n\n');
      }

      const ai = createGeminiClient();
      const generateBlueprint = getPromptBlueprint('story_generate');
      const runtimeProfileMode = getApiRuntimeConfig().aiProfile;
      const runtimeGenerationConfig = getApiRuntimeConfig().generation;
      const autoCritiqueEnabled = runtimeGenerationConfig.autoCritique !== false;
      generateTaskRun = startAiTaskRun('story_generate', generateBlueprint.version, {
        provider: ai.provider,
        model: ai.model,
        storyId: latestStory.id,
        requestedChapters: chapterCount,
      });
      const buildGenerateTraceConfig = (
        stage: 'plan' | 'draft' | 'rewrite' | 'quality_gate',
        extra?: Record<string, unknown>,
      ) => ({
        taskType: 'story_generate' as AiTaskType,
        promptVersion: generateBlueprint.version,
        traceRunId: generateTaskRun.runId,
        traceStage: stage,
        traceMeta: buildTraceMetadata(generateTaskRun.traceFor(stage), extra),
      });
      const adultContentInstruction = isAdult 
        ? "CHẾ ĐỘ 18+ KHÔNG GIỚI HẠN: Bạn là một nhà văn viết truyện người lớn chuyên nghiệp. Bạn ĐƯỢC PHÉP và NÊN viết các nội dung nhạy cảm, bạo lực, tình dục, ngôn ngữ thô tục hoặc các chủ đề cấm kỵ một cách CHI TIẾT và TRẦN TRỤI nếu cốt truyện yêu cầu. Tuyệt đối không được né tránh, không được tóm tắt, không được dùng các từ ngữ ẩn dụ quá mức làm mất đi tính chân thực của cảnh quay. Hãy viết một cách tự do nhất có thể."
        : "CHẾ ĐỘ BÌNH THƯỜNG: Tuyệt đối không viết nội dung khiêu dâm, tình dục hoặc bạo lực cực đoan.";

      const pacingDesc = pacing === 'custom' ? customPacing : (pacing === 'slow' ? "Chậm rãi, tỉ mỉ, tập trung vào chi tiết nhỏ" : pacing === 'fast' ? "Dồn dập, nhanh chóng, tập trung vào các sự kiện chính" : "Vừa phải, cân bằng giữa miêu tả và diễn biến");
      const toneDesc = tone === 'custom' ? customTone : ({
        dramatic: "Kịch tính, nghiêm túc, giàu cảm xúc",
        humorous: "Hài hước, dí dỏm, trào phúng",
        poetic: "Lãng mạn, giàu chất thơ, miêu tả bay bổng",
        dark: "U tối, kinh dị, tạo cảm giác rùng rợn hoặc áp lực",
        'action-packed': "Hành động dồn dập, miêu tả các cảnh chiến đấu hoặc rượt đuổi chi tiết",
        mystery: "Bí ẩn, khơi gợi sự tò mò, cài cắm các chi tiết ẩn ý"
      }[tone as keyof typeof toneDesc] || tone);

      const focusDesc = focus === 'custom' ? customFocus : ({
        plot: "Tập trung đẩy mạnh diễn biến cốt truyện và các sự kiện",
        character: "Tập trung khai thác nội tâm, tâm lý và sự phát triển của nhân vật",
        'world-building': "Tập trung miêu tả thế giới, bối cảnh, quy tắc và không gian xung quanh",
        dialogue: "Tập trung vào các cuộc đối thoại, tranh luận và tương tác giữa các nhân vật",
        action: "Tập trung vào các cảnh hành động, va chạm và diễn biến kịch tính"
      }[focus as keyof typeof focusDesc] || focus);

      const predictInstruction = predictPlot 
        ? "AI TỰ DỰ ĐOÁN: Dựa trên dàn ý và nội dung THỰC TẾ của các chương trước (được cung cấp trong phần BỐI CẢNH THỰC TẾ), hãy tự sáng tạo và dự đoán các tình tiết tiếp theo một cách logic. LƯU Ý: Tuyệt đối không lặp lại các tình tiết đã xảy ra, hãy tập trung vào diễn biến MỚI."
        : "BÁM SÁT DÀN Ý: Hãy viết chính xác theo các tình tiết đã được cung cấp trong dàn ý, không tự ý thay đổi mạch truyện chính.";
      const storyTranslationContext = buildStoryTranslationContext(latestStory.translationMemory || []);

      updateAiRun(aiRun, {
        message: 'Đang tổng hợp chỉ dẫn viết chương...',
        stageLabel: 'Đóng gói prompt',
        detail: 'Đã nạp xong context và đang chuyển toàn bộ tuỳ chỉnh thành prompt nhất quán cho AI.',
      });
      generateTaskRun.markStage('plan', {
        chapterCount,
        chapterLength,
      });

      const chapterWordsTarget = Math.max(350, Number.parseInt(String(chapterLength || '1000'), 10) || 1000);
      const batchMinChars = Math.min(22000, Math.max(1200, Math.round(chapterCount * chapterWordsTarget * 1.5)));
      const generateDraftRoute = routeAiExecutionLane({
        task: 'story_generate',
        stage: 'draft',
        provider: ai.provider,
        profile: runtimeProfileMode,
        inputChars: `${outline}\n${effectivePreviousContext}\n${keyEvents}\n${chapterScript}`.length,
        preferredLane: 'quality',
      });
      generateTaskRun.markStage('draft', {
        lane: generateDraftRoute.lane,
        routeReason: generateDraftRoute.reason,
      });
      const generatePrompt = prependPromptContract(`Bạn là một nhà văn chuyên nghiệp, nổi tiếng với khả năng viết lách chi tiết, giàu hình ảnh và cảm xúc. 
        Dựa trên dàn ý và bối cảnh được cung cấp, hãy viết tiếp ${chapterCount} chương MỚI cho câu chuyện. 
        
        ${adultContentInstruction}
        
        PHONG CÁCH VIẾT YÊU CẦU:
        - Nhịp điệu: ${pacingDesc}
        - Giọng văn: ${toneDesc}
        - Trọng tâm: ${focusDesc}
        - Góc nhìn: ${perspective === 'first-person' ? 'Ngôi thứ nhất (Tôi)' : perspective === 'omniscient' ? 'Ngôi thứ ba (Toàn tri)' : 'Ngôi thứ ba (Toàn tri)'}
        - Đối tượng độc giả: ${audience === 'teen' ? 'Thanh thiếu niên' : audience === 'adult' ? 'Người trưởng thành' : audience === 'hardcore' ? 'Độc giả lâu năm' : 'Đại chúng'}
        - Chỉ dẫn mạch truyện: ${predictInstruction}
        
        ${styleReference ? `PHONG CÁCH VĂN MẪU (Hãy bắt chước giọng văn này):\n${styleReference}\n` : ""}
        ${finalInstructions ? `CHỈ DẪN THÊM CHO AI:\n${finalInstructions}\n` : ""}
        ${chapterScript ? `KỊCH BẢN CHI TIẾT CHO CHƯƠNG NÀY:\n${chapterScript}\n` : ""}
        ${storyTranslationContext ? `${storyTranslationContext}\n` : ""}
        ${forbiddenPhraseInstruction ? `${forbiddenPhraseInstruction}\n` : ""}

        BỐI CẢNH VÀ NHÂN VẬT:
        ${charContext ? `THÔNG TIN NHÂN VẬT THAM CHIẾU:\n${charContext}\n` : ""}
        ${effectivePreviousContext ? `BỐI CẢNH THỰC TẾ CỦA CHƯƠNG TRƯỚC (Hãy viết tiếp từ đây):\n${effectivePreviousContext}\n` : ""}
        ${keyEvents ? `CÁC SỰ KIỆN CHÍNH CẦN XẢY RA TRONG CHƯƠNG NÀY:\n${keyEvents}\n` : ""}

        YÊU CẦU VỀ ĐỘ DÀI VÀ CHI TIẾT:
        - Mỗi chương PHẢI đạt tối thiểu ${chapterLength} từ. Đây là yêu cầu bắt buộc.
        - Tuyệt đối KHÔNG ĐƯỢC tóm tắt diễn biến. Hãy viết chi tiết từng hành động, từng lời nói, từng suy nghĩ.
        - Tuyệt đối KHÔNG trả dàn ý, không trả ý tưởng, không trả checklist, không trả gạch đầu dòng.
        - Nếu bạn viết quá ngắn hoặc quá sơ sài, bạn đang vi phạm yêu cầu công việc. Hãy mở rộng các tình tiết một cách tối đa.
        
        HƯỚNG DẪN VIẾT CHI TIẾT:
        1. Miêu tả bối cảnh: Đừng chỉ nói "họ đang ở trong rừng", hãy miêu tả âm thanh của lá cây, mùi hương của đất ẩm, ánh sáng xuyên qua kẽ lá.
        2. Nội tâm nhân vật: Đào sâu vào suy nghĩ, cảm xúc, sự mâu thuẫn và những tính toán thầm kín của nhân vật.
        3. Đối thoại: Xây dựng các cuộc đối thoại tự nhiên, có phong cách riêng cho từng nhân vật.
        4. Nhịp độ: Đừng đẩy tình tiết đi quá nhanh. Hãy để các sự kiện diễn ra một cách từ tốn và có logic.
        5. TÍNH LIÊN TỤC: Đảm bảo chương mới kết nối mượt mà với nội dung thực tế của chương trước đó.
        
        Dàn ý tổng quát: ${outline}
        Thể loại truyện: ${latestStory.genre || 'Tự do'}
        Tiêu đề truyện: ${latestStory.title}
        Số chương hiện tại: ${currentChapters.length}
        
        QUY TẮC ĐỊNH DẠNG QUAN TRỌNG:
        Nếu trong nội dung có các đoạn thông tin nhân vật hoặc trạng thái nằm trong dấu ngoặc vuông như [Tên: ...] [Khí vận: ...] [Trạng thái: ...], bạn PHẢI tự động xuống dòng sau mỗi dấu ngoặc đóng ] để mỗi thông tin nằm trên một dòng riêng biệt.
        Ví dụ:
        [Tên: Thẩm Nhã Chi]
        [Khí vận: Kim sắc]
        [Trạng thái: Cô đơn]
        
        Trả về kết quả dưới dạng JSON array các chương: [ { "title": "Chương x: ...", "content": "..." }, ... ]
        CHỈ TRẢ VỀ JSON thuần, KHÔNG bọc bằng dấu 3 backtick và KHÔNG thêm giải thích.
        Nội dung nên được định dạng Markdown.`.trim(), {
        task: 'story_generate',
        stage: 'draft',
        promptVersion: generateBlueprint.version,
        outputSchema: generateBlueprint.outputSchema,
        strictJson: true,
      });
      const generatedChapterBatchText = await generateGeminiText(
        ai,
        generateDraftRoute.lane,
        generatePrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          minOutputChars: batchMinChars,
          maxRetries: 2,
          safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
          signal: abortSignal,
          ...buildGenerateTraceConfig('draft', {
            lane: generateDraftRoute.lane,
            routeReason: generateDraftRoute.reason,
            chapterCount,
          }),
        },
      );

      const textResponse = generatedChapterBatchText || '[]';
      const parsed = tryParseJson<unknown>(textResponse, 'any');
      let newChaptersData: Array<{ title?: string; content?: string }> = [];
      const chapterArrayValidation = validateChapterDraftArray(parsed, Math.max(1, chapterCount));
      if (chapterArrayValidation.ok) {
        newChaptersData = chapterArrayValidation.data.map((item) => ({
          title: item.title,
          content: item.content,
        }));
      } else {
        newChaptersData = extractChapterDraftItems(parsed).map((item) => ({
          title: item.title,
          content: item.content || item.outline,
        }));
      }

      if (!newChaptersData.length) {
        newChaptersData = buildFallbackChapters(textResponse, chapterCount);
      }
      if (!newChaptersData.length) {
        throw new Error("AI không trả về nội dung hợp lệ để tạo chương.");
      }
      let chapterDrafts = sanitizeChapterDrafts(newChaptersData);
      const chapterLengthTarget = Number.parseInt(String(chapterLength || '1000'), 10);
      const minimumChapterChars = Math.max(900, Math.round((Number.isFinite(chapterLengthTarget) ? chapterLengthTarget : 1000) * 1.6));
      const firstPassValidation = validateNarrativeBatch(chapterDrafts, minimumChapterChars);
      if (autoCritiqueEnabled && chapterDrafts.length > 0 && firstPassValidation.invalidCount >= Math.max(1, Math.ceil(chapterDrafts.length * 0.5))) {
        updateAiRun(aiRun, {
          message: 'Đang làm sạch đầu ra để đúng dạng chương truyện...',
          stageLabel: 'Sửa đầu ra',
          detail: 'Model vừa trả về thiên hướng dàn ý, hệ thống đang yêu cầu viết lại thành chương hoàn chỉnh.',
        });
        const rewritePrompt = `
Bạn vừa nhận đầu ra chưa đạt: nội dung đang giống dàn ý/ý tưởng thay vì chương truyện hoàn chỉnh.
Hãy viết lại thành ${chapterCount} chương truyện đầy đủ.

YÊU CẦU BẮT BUỘC:
- Mỗi chương là văn xuôi liền mạch, có bối cảnh, hành động, đối thoại, nội tâm.
- Không dùng gạch đầu dòng, không liệt kê ý tưởng, không ghi "dàn ý", "gợi ý", "hướng phát triển".
- Không giải thích cách viết. Chỉ trả nội dung truyện.
- Mỗi chương tối thiểu ${chapterLength} từ.
${forbiddenPhrases.length ? `- Tuyệt đối không dùng các cụm từ cấm sau:\n${forbiddenPhrases.map((phrase, index) => `  ${index + 1}. "${phrase}"`).join('\n')}` : ''}
- Tuyệt đối không dùng bất kỳ cụm nào trong danh sách cấm.

Bối cảnh truyện:
- Tiêu đề: ${latestStory.title}
- Thể loại: ${latestStory.genre || 'Tự do'}
- Dàn ý tổng quát: ${outline}
- Bối cảnh chương trước: ${effectivePreviousContext || 'Không có'}
- Sự kiện cần có: ${keyEvents || 'Tự suy luận hợp lý'}

Đầu ra chưa đạt cần viết lại:
${JSON.stringify(chapterDrafts)}

Trả về JSON array: [{"title":"Chương ...","content":"..."}]
CHỈ trả JSON thuần, không bọc markdown.
`.trim();
        const rewriteRoute = routeAiExecutionLane({
          task: 'story_generate',
          stage: 'rewrite',
          provider: ai.provider,
          profile: runtimeProfileMode,
          inputChars: rewritePrompt.length,
          preferredLane: 'quality',
        });
        generateTaskRun.markStage('rewrite', {
          lane: rewriteRoute.lane,
          routeReason: rewriteRoute.reason,
          reason: 'outline_like_output',
        });
        const rewritten = await generateGeminiText(
          ai,
          rewriteRoute.lane,
          prependPromptContract(rewritePrompt, {
            task: 'story_generate',
            stage: 'rewrite',
            promptVersion: generateBlueprint.version,
            outputSchema: 'chapter_draft_array_v1',
            strictJson: true,
          }),
          {
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            minOutputChars: batchMinChars,
            maxRetries: 1,
            signal: abortSignal,
            ...buildGenerateTraceConfig('rewrite', {
              lane: rewriteRoute.lane,
              routeReason: rewriteRoute.reason,
            }),
          },
        );
        const rewrittenParsed = tryParseJson<unknown>(rewritten || '[]', 'any');
        let rewrittenItems: Array<{ title?: string; content?: string }> = [];
        rewrittenItems = extractChapterDraftItems(rewrittenParsed).map((item) => ({
          title: item.title,
          content: item.content || item.outline,
        }));
        if (!rewrittenItems.length) {
          rewrittenItems = buildFallbackChapters(rewritten || '', chapterCount);
        }
        if (rewrittenItems.length) {
          chapterDrafts = sanitizeChapterDrafts(rewrittenItems);
        }
      }
      const finalValidation = validateNarrativeBatch(chapterDrafts, minimumChapterChars);
      if (chapterDrafts.length > 0 && finalValidation.invalidCount >= Math.max(1, Math.ceil(chapterDrafts.length * 0.5))) {
        throw new Error(`AI trả nội dung chưa đạt chuẩn chương truyện (${finalValidation.reasons[0] || 'đầu ra dạng dàn ý'}). Hãy thử lại với model mạnh hơn hoặc giảm số chương mỗi lượt.`);
      }

      const collectForbiddenHits = (items: Array<{ title: string; content: string }>) =>
        items
          .map((item, index) => ({
            index,
            title: item.title,
            content: item.content,
            hits: findForbiddenPhrasesInText(item.content, forbiddenPhrases),
          }))
          .filter((item) => item.hits.length > 0);

      if (autoCritiqueEnabled && forbiddenPhrases.length) {
        let violating = collectForbiddenHits(chapterDrafts);
        if (violating.length > 0) {
          updateAiRun(aiRun, {
            message: 'Đang loại bỏ cụm từ sáo rỗng...',
            stageLabel: 'Làm sạch văn phong',
            detail: 'Hệ thống phát hiện cụm từ cấm và đang yêu cầu AI viết lại đoạn vi phạm.',
          });
          const violatingPayload = violating.map((item) => ({
            title: item.title,
            content: item.content,
            violations: item.hits,
          }));
          const antiClicheRewritePrompt = `
Bạn là biên tập viên văn học. Nhiệm vụ: viết lại các đoạn văn dưới đây cho tự nhiên và có hồn hơn.

YÊU CẦU:
- Giữ nguyên ý nghĩa, tình tiết, thứ tự sự kiện, tên nhân vật.
- Tuyệt đối không dùng các cụm từ cấm:
${forbiddenPhrases.map((phrase, index) => `${index + 1}. "${phrase}"`).join('\n')}
- Tránh văn phong sáo rỗng, ưu tiên chi tiết cụ thể (hành động, giác quan, phản ứng tinh tế).
- Chỉ trả JSON array cùng số phần tử, mỗi phần tử có dạng {"title":"...","content":"..."}.
- Không thêm lời giải thích.

Các đoạn cần viết lại:
${JSON.stringify(violatingPayload)}
`.trim();
          const antiClicheRoute = routeAiExecutionLane({
            task: 'story_generate',
            stage: 'quality_gate',
            provider: ai.provider,
            profile: runtimeProfileMode,
            inputChars: antiClicheRewritePrompt.length,
            preferredLane: 'quality',
          });
          generateTaskRun.markStage('quality_gate', {
            lane: antiClicheRoute.lane,
            routeReason: antiClicheRoute.reason,
            reason: 'forbidden_phrase',
            violatingCount: violatingPayload.length,
          });

          const antiClicheRewriteRaw = await generateGeminiText(
            ai,
            antiClicheRoute.lane,
            prependPromptContract(antiClicheRewritePrompt, {
              task: 'story_generate',
              stage: 'quality_gate',
              promptVersion: generateBlueprint.version,
              outputSchema: 'chapter_draft_array_v1',
              strictJson: true,
            }),
            {
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              minOutputChars: Math.max(1200, Math.round(violatingPayload.length * 1200)),
              maxRetries: 1,
              signal: abortSignal,
              ...buildGenerateTraceConfig('quality_gate', {
                lane: antiClicheRoute.lane,
                routeReason: antiClicheRoute.reason,
                violatingCount: violatingPayload.length,
              }),
            },
          );
          const antiClicheParsed = tryParseJson<any>(antiClicheRewriteRaw || '[]', 'array');
          if (Array.isArray(antiClicheParsed) && antiClicheParsed.length) {
            const rewrittenClean = sanitizeChapterDrafts(antiClicheParsed);
            violating.forEach((item, idx) => {
              const candidate = rewrittenClean[idx];
              if (!candidate) return;
              chapterDrafts[item.index] = {
                title: candidate.title || chapterDrafts[item.index].title,
                content: candidate.content || chapterDrafts[item.index].content,
              };
            });
          }
          violating = collectForbiddenHits(chapterDrafts);
          if (violating.length > 0) {
            const uniqueHits = Array.from(new Set(violating.flatMap((item) => item.hits))).slice(0, 8);
            throw new Error(`Nội dung vẫn còn cụm từ sáo rỗng bị cấm: ${uniqueHits.join(', ')}.`);
          }
        }
      }

      const nextOrder = currentChapters.length + 1;
      
      const newChapters = chapterDrafts.map((c, i) => {
        const chapter: any = {
          id: createClientId('chapter'),
          title: String(c.title || `Chương mới ${i + 1}`),
          content: improveBracketSystemSpacing(String(c.content || '')),
          order: nextOrder + i,
          createdAt: new Date().toISOString(),
        };
        if (i === 0 && aiInstructions) chapter.aiInstructions = aiInstructions;
        if (i === 0 && chapterScript) chapter.script = chapterScript;
        return chapter;
      });

      const updatedChapters = [...currentChapters, ...newChapters];

      // Save to local storage
      const stories = storage.getStories();
      const updatedStory: Story = {
        ...latestStory,
        chapters: normalizeChaptersForLocal(updatedChapters),
        updatedAt: new Date().toISOString(),
      };
      const newList = stories.map(s => s.id === latestStory.id ? updatedStory : s);
      saveStoriesAndRefresh(newList);

      setSelectedStory(updatedStory);

      generateTaskRun.complete({
        generatedChapters: newChapters.length,
        totalChapters: updatedStory.chapters.length,
      });
      notifyApp({ tone: 'success', message: `Đã tạo thành công ${newChapters.length} chương mới!`, timeoutMs: 5200 });
    } catch (error) {
      generateTaskRun?.fail(error, {
        at: 'handleAIGenerateChapters',
      });
      console.error("AI Generation Error:", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (/cancelled by user/i.test(rawMessage)) {
        notifyApp({ tone: 'warn', message: 'Đã hủy quá trình tạo chương.' });
      } else {
        notifyApp({ tone: 'error', message: rawMessage || "Có lỗi xảy ra khi tạo chương bằng AI.", timeoutMs: 5200 });
      }
    } finally {
      finishAiRun(aiRun);
    }
  };

  const handleSaveStory = async (data: Partial<Story>) => {
    if (!user) return;

    const stories = storage.getStories();
    let newList;

    if (editingStory) {
      const existingBible = readStoryBibleFromNotes(editingStory.storyPromptNotes || '');
      const incomingPromptNotes = stripStoryBibleFromNotes(
        String(data.storyPromptNotes ?? editingStory.storyPromptNotes ?? ''),
      ).trim();
      const mergedPromptNotes = existingBible
        ? attachStoryBibleToNotes(incomingPromptNotes, existingBible)
        : incomingPromptNotes;
      const updatedStory: Story = {
        ...editingStory,
        ...data,
        slug: data.slug || editingStory.slug || resolveStorySlug(editingStory),
        storyPromptNotes: mergedPromptNotes || undefined,
        chapters: normalizeChaptersForLocal((data.chapters || editingStory.chapters || []) as Chapter[]),
        updatedAt: new Date().toISOString(),
      };
      newList = stories.map(s => s.id === editingStory.id ? updatedStory : s);
    } else {
      const newStorySlug = data.slug || createStorySlugFromStories(stories);
      const newStory: Story = {
        id: createClientId('story'),
        authorId: user.uid,
        title: data.title || 'Không tiêu đề',
        content: data.content || '',
        introduction: data.introduction || '',
        genre: data.genre || 'Chưa phân loại',
        chapters: normalizeChaptersForLocal((data.chapters || []) as Chapter[]),
        isAdult: data.isAdult || false,
        isPublic: data.isPublic || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
        storyPromptNotes: stripStoryBibleFromNotes(String(data.storyPromptNotes || '')).trim() || undefined,
        slug: newStorySlug,
      };
      newList = [newStory, ...stories];
    }

    setEditingStory(null);
    setIsCreating(false);
    saveStoriesAndRefresh(newList);
  };

  const handleAIStoryCreation = async (options: {
    file: File,
    genre: string,
    pacing: string,
    tone: string,
    isAdult: boolean,
    customPacing?: string,
    customTone?: string,
    perspective: string,
    audience: string,
    styleReference: string
  }) => {
    const { file, genre, pacing, tone, isAdult, customPacing, customTone, perspective, audience, styleReference } = options;
    if (!user) return;
    setShowAIStoryModal(false);
    const aiRun = beginAiRun("Đang xử lý file và tạo truyện...", {
      stageLabel: 'Đọc file nguồn',
      detail: 'Đang bóc tách nội dung từ tệp để chuẩn bị sinh truyện mới bằng AI.',
    });
    const abortSignal = aiRun.controller.signal;

    try {
      let content = "";
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        content = await extractDocxText(arrayBuffer);
      } else if (fileName.endsWith('.txt')) {
        content = await file.text();
      } else if (fileName.endsWith('.json')) {
        const text = await file.text();
        const data = JSON.parse(text);
        content = JSON.stringify(data);
      }

      if (!content.trim()) {
        throw new Error("File không có nội dung.");
      }

      // Initialize Gemini
      const ai = createGeminiClient();
      const adultContentInstruction = isAdult 
        ? "CHẾ ĐỘ 18+ KHÔNG GIỚI HẠN: Bạn là một nhà văn viết truyện người lớn chuyên nghiệp. Bạn ĐƯỢC PHÉP và NÊN viết các nội dung nhạy cảm, bạo lực, tình dục, ngôn ngữ thô tục hoặc các chủ đề cấm kỵ một cách CHI TIẾT và TRẦN TRỤI. Tuyệt đối không được né tránh, không được tóm tắt, không được dùng các từ ngữ ẩn dụ quá mức làm mất đi tính chân thực của cảnh quay. Hãy viết một cách tự do nhất có thể."
        : "CHẾ ĐỘ BÌNH THƯỜNG: Tuyệt đối không viết nội dung khiêu dâm, tình dục hoặc bạo lực cực đoan.";

      const pacingDesc = pacing === 'custom' ? customPacing : (pacing === 'slow' ? "Chậm rãi, tỉ mỉ" : pacing === 'fast' ? "Dồn dập, nhanh chóng" : "Vừa phải");
      const toneDesc = tone === 'custom' ? customTone : ({
        dramatic: "Kịch tính, nghiêm túc",
        humorous: "Hài hước, dí dỏm",
        poetic: "Lãng mạn, giàu chất thơ",
        dark: "U tối, kinh dị",
        'action-packed': "Hành động dồn dập",
        mystery: "Bí ẩn, hồi hộp"
      }[tone as keyof typeof toneDesc] || tone);

      const aiStoryText = await generateGeminiText(
        ai,
        'quality',
        `Bạn là một biên tập viên văn học và nhà văn chuyên nghiệp. Hãy đọc nội dung sau đây (có thể là dàn ý, nháp hoặc dữ liệu thô) và chuyển nó thành một câu chuyện có cấu trúc hoàn chỉnh, giàu chi tiết và hấp dẫn.
        
        THÔNG TIN YÊU CẦU:
        - Thể loại: ${genre || 'Tự do'}
        - Nhịp điệu: ${pacingDesc}
        - Giọng văn: ${toneDesc}
        - Góc nhìn: ${perspective === 'first-person' ? 'Ngôi thứ nhất (Tôi)' : perspective === 'omniscient' ? 'Ngôi thứ ba (Toàn tri)' : 'Ngôi thứ ba (Hắn/Cô ấy)'}
        - Đối tượng độc giả: ${audience === 'teen' ? 'Thanh thiếu niên' : audience === 'adult' ? 'Người trưởng thành' : audience === 'hardcore' ? 'Độc giả lâu năm' : 'Đại chúng'}
        - ${adultContentInstruction}
        
        ${styleReference ? `PHONG CÁCH VĂN MẪU (Hãy bắt chước giọng văn này):\n${styleReference}\n` : ""}

        YÊU CẦU CHI TIẾT:
        - Tạo Tiêu đề hấp dẫn.
        - Viết nội dung cực kỳ chi tiết, mở rộng tối đa các ý tưởng từ file gốc. 
        - Tuyệt đối KHÔNG ĐƯỢC tóm tắt. Hãy miêu tả kỹ lưỡng từng bối cảnh, tâm lý nhân vật và các cuộc đối thoại.
        - Sử dụng ngôn ngữ phong phú, giàu hình ảnh.
        
        QUY TẮC ĐỊNH DẠNG QUAN TRỌNG:
        Nếu trong nội dung có các đoạn thông tin nhân vật hoặc trạng thái nằm trong dấu ngoặc vuông như [Tên: ...] [Khí vận: ...] [Trạng thái: ...], bạn PHẢI tự động xuống dòng sau mỗi dấu ngoặc đóng ] để mỗi thông tin nằm trên một dòng riêng biệt.
        
        Trả về kết quả dưới dạng JSON với cấu trúc: { "title": "...", "content": "..." }. Nội dung nên được định dạng Markdown.
        
        Nội dung gốc:
        ${content}`,
        {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          minOutputChars: Math.min(12000, Math.max(900, Math.round(content.length * 0.35))),
          maxRetries: 2,
          safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
          signal: abortSignal,
        },
      );

      const textResponse = aiStoryText || '';
      const parsed = tryParseJson<unknown>(textResponse, 'object');
      const parsedRecord = asRecord(parsed);
      const payloadError = readErrorMessageFromPayload(parsedRecord);
      if (payloadError) {
        throw new Error(`AI lỗi: ${payloadError}`);
      }
      let resolvedTitle = parsedRecord ? String(parsedRecord.title || '').trim() : '';
      let resolvedContent = parsedRecord ? String(parsedRecord.content || '').trim() : '';

      if (!resolvedContent) {
        const cleaned = stripJsonFence(textResponse);
        const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!resolvedTitle && lines.length) {
          resolvedTitle = lines[0].replace(/^#+\s*/g, '').trim();
        }
        resolvedContent = cleaned.trim();
      }

      if (!resolvedContent) {
        const fallbackText = await generateGeminiText(
          ai,
          'quality',
          `Hãy viết lại nội dung thành một truyện hoàn chỉnh, giàu chi tiết.
          
          THÔNG TIN YÊU CẦU:
          - Thể loại: ${genre || 'Tự do'}
          - Nhịp điệu: ${pacingDesc}
          - Giọng văn: ${toneDesc}
          - Góc nhìn: ${perspective === 'first-person' ? 'Ngôi thứ nhất (Tôi)' : perspective === 'omniscient' ? 'Ngôi thứ ba (Toàn tri)' : 'Ngôi thứ ba (Hắn/Cô ấy)'}
          - Đối tượng độc giả: ${audience === 'teen' ? 'Thanh thiếu niên' : audience === 'adult' ? 'Người trưởng thành' : audience === 'hardcore' ? 'Độc giả lâu năm' : 'Đại chúng'}
          - ${adultContentInstruction}
          
          ${styleReference ? `PHONG CÁCH VĂN MẪU (Hãy bắt chước giọng văn này):\n${styleReference}\n` : ""}

          QUY TẮC TRẢ VỀ:
          Trả theo định dạng văn bản:
          TIÊU ĐỀ: ...
          NỘI DUNG:
          ...
          
          Nội dung gốc:
          ${content}`,
          {
            responseMimeType: "text/plain",
            maxOutputTokens: 8192,
            minOutputChars: Math.min(14000, Math.max(1200, Math.round(content.length * 0.4))),
            maxRetries: 2,
            safetySettings: GEMINI_UNRESTRICTED_SAFETY_SETTINGS,
            signal: abortSignal,
          },
        );
        const fallbackClean = stripJsonFence(fallbackText || '');
        const titleMatch = fallbackClean.match(/TIÊU\s*ĐỀ\s*:\s*(.+)/i);
        const contentMatch = fallbackClean.match(/NỘI\s*DUNG\s*:\s*([\s\S]*)/i);
        resolvedTitle = resolvedTitle || (titleMatch?.[1] || '').trim();
        resolvedContent = (contentMatch?.[1] || '').trim() || fallbackClean.trim();
      }

      if (!resolvedTitle) resolvedTitle = 'Truyện mới';

      if (resolvedTitle && resolvedContent) {
        // Save to local storage
        createAndStoreStory(({ storyId, storySlug, now }) => ({
          id: storyId,
          slug: storySlug,
          authorId: user.uid,
          title: resolvedTitle.substring(0, 480),
          content: resolvedContent.replace(/\]\s*\[/g, ']\n\n[').substring(0, 1999900),
          genre: String(genre || 'Tự do').substring(0, 190),
          isAdult: Boolean(isAdult),
          isPublic: false,
          isAI: true,
          createdAt: now,
          updatedAt: now,
          chapters: [],
        }));

        notifyApp({ tone: 'success', message: 'AI đã tạo truyện thành công từ file của bạn!', timeoutMs: 5200 });
      } else {
        throw new Error("Không nhận được phản hồi hợp lệ từ AI. Hãy kiểm tra kết nối Relay hoặc khóa API.");
      }
    } catch (error) {
      console.error("AI Creation failed", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (/cancelled by user/i.test(rawMessage)) {
        notifyApp({ tone: 'warn', message: 'Đã hủy quá trình AI tạo truyện.' });
      } else {
        notifyApp({ tone: 'error', message: `Lỗi khi xử lý AI: ${rawMessage || "Lỗi không xác định"}`, timeoutMs: 5200 });
      }
    } finally {
      finishAiRun(aiRun);
    }
  };

  const latestBackup = backupSnapshots[0] || null;
  const latestBackupAt = backupSettings.lastSuccessfulBackupAt || latestBackup?.createdAt || '';
  const backupWarningMessage = buildBackupWarningMessage(latestBackupAt, backupSettings.staleAfterHours);
  const driveConfigured = hasGoogleDriveBackupConfig();

  const routeTransitionClass = navigationType === 'POP' ? 'tf-route-pop' : 'tf-route-push';
  const oauthConsentRedirectTarget = `/${location.search}${location.hash}`;

  const renderHomeWorkspace = () => {
    if (view === 'characters') {
      return (
        <CharacterManager
          key="characters"
          onBack={() => setView('stories')}
          onRequireAuth={() => setShowAuthModal(true)}
        />
      );
    }

    if (view === 'api') {
      return (
        <ToolsManager
          key="api"
          section="api"
          onBack={() => setView('stories')}
          onRequireAuth={() => setShowAuthModal(true)}
          profile={profile}
        />
      );
    }

    if (view === 'tools') {
      if (user) {
        return (
          <React.Suspense fallback={<div className="tf-card p-6 text-sm text-slate-300">Đang tải Công cụ...</div>}>
            <ToolsPage
              onBack={() => setView('stories')}
              onRequireAuth={() => setShowAuthModal(true)}
            />
          </React.Suspense>
        );
      }
      return (
        <ToolsManager
          key="tools"
          section="tools"
          onBack={() => setView('stories')}
          onRequireAuth={() => setShowAuthModal(true)}
          profile={profile}
        />
      );
    }

    if (isCreating || editingStory) {
      return (
        <StoryEditor
          key="editor"
          story={editingStory || undefined}
          onSave={handleSaveStory}
          onCancel={() => {
            setEditingStory(null);
            setIsCreating(false);
          }}
        />
      );
    }

    return (
      <motion.div
        key="list"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pt-32"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-8 sm:mb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-3xl sm:text-5xl font-serif font-bold text-slate-900 mb-4 tracking-tight">Thư viện</h2>
            </div>
            <div className="flex flex-wrap gap-3 sm:gap-4">
              <button
                onClick={() => setIsCreating(true)}
                className="hero-action hero-action-primary glow-dot flex items-center justify-center gap-2 sm:gap-3 px-5 sm:px-8 py-3 sm:py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xl shadow-indigo-900/20 font-bold text-sm sm:text-lg group"
              >
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110" />
                Viết truyện mới
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="hero-action hero-action-outline glow-dot flex items-center justify-center gap-2 sm:gap-3 px-5 sm:px-8 py-3 sm:py-4 rounded-2xl text-white transition-all shadow-xl font-bold text-sm sm:text-lg group"
              >
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:rotate-12" />
                Tạo từ dàn ý (AI)
              </button>
              <button
                onClick={handleUnifiedAiFileFlow}
                className="hero-action hero-action-warm glow-dot flex items-center justify-center gap-2 sm:gap-3 px-5 sm:px-8 py-3 sm:py-4 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-xl shadow-amber-900/20 font-bold text-sm sm:text-lg group"
              >
                <Languages className="w-5 h-5 sm:w-6 sm:h-6 transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5" />
                AI từ file (Dịch / Viết tiếp)
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setPendingFile(file);
                    setShowAIStoryModal(true);
                    e.target.value = '';
                  }
                }}
                className="hidden"
                accept=".docx,.txt,.json"
              />
            </div>
          </div>
        </div>

        <StoryList
          refreshKey={storiesVersion}
          onView={(story) => {
            setSelectedStory(story);
            navigate(`/${resolveStorySlug(story)}`);
          }}
          readerActivityMap={readerActivityMap}
          onContinueFromActivity={openStoryFromReaderActivity}
        />
      </motion.div>
    );
  };

  const renderReaderWorkspace = () => {
    const readerHistory = listReaderActivityHistory(readerActivityMap, 8);
    const followedStories = Object.values(readerActivityMap || {})
      .filter((item) => item.followed)
      .sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime())
      .slice(0, 8);

    const formatReaderTime = (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Không rõ';
      return date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const handleOpenPublicStory = async (item: PublicStoryFeedItem) => {
      if (loadingPublicStoryId) return;
      setLoadingPublicStoryId(item.id);
      try {
        const story = await loadPublicStoryById(item.id);
        if (!story) {
          notifyApp({
            tone: 'warn',
            message: 'Không mở được truyện công khai này. Có thể truyện đã bị ẩn hoặc xóa.',
          });
          return;
        }
        setSelectedStory(story);
        const readerMeta = readerActivityMap[story.id] || null;
        const resumeChapter = readerMeta?.lastChapterId
          ? (story.chapters || []).find((chapter) => chapter.id === readerMeta.lastChapterId)
          : null;
        if (resumeChapter) {
          navigate(`/${resolveStorySlug(story)}/${getChapterRouteSlug(resumeChapter)}`, { state: { storyId: story.id } });
        } else {
          navigate(`/${resolveStorySlug(story)}`, { state: { storyId: story.id } });
        }
      } finally {
        setLoadingPublicStoryId(null);
      }
    };

    const formatPublicUpdatedAt = (updatedAt: string) => {
      if (!updatedAt) return 'N/A';
      const date = new Date(updatedAt);
      if (Number.isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('vi-VN');
    };

    const renderPublicStoryCard = (item: PublicStoryFeedItem) => {
      const isLoading = loadingPublicStoryId === item.id;
      const readerMeta = readerActivityMap[item.id] || null;
      const readCount = readerMeta?.readChapterIds?.length || 0;
      const chapterTotal = Math.max(item.chapterCount || 0, readerMeta?.totalChapters || 0);
      const resolvedMeta = resolvedPublicStoryMeta[item.id];
      const displayTitle = resolveStoryCardDisplayTitle(item.title, resolvedMeta);
      const displayGenre = resolveStoryCardDisplayGenre(item.genre, resolvedMeta, item.title);
      const displayIntro = buildStoryCardDisplayIntroduction({
        introduction: item.introduction,
        genre: displayGenre,
        title: item.title,
        metadata: resolvedMeta,
      });
      return (
        <article
          key={item.id}
          className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm transition-all hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-900/10"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 min-h-[3.4rem] text-lg sm:text-xl font-serif font-bold text-slate-900">{displayTitle}</h3>
              <p className="mt-1 line-clamp-2 min-h-[2.1rem] text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {displayGenre || 'Chưa phân loại'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.isAdult ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-600">
                  18+
                </span>
              ) : null}
              <button
                onClick={() => handleReaderToggleFollow(
                  {
                    id: item.id,
                    slug: item.slug,
                    authorId: item.authorId,
                    title: displayTitle,
                    content: '',
                    coverImageUrl: item.coverImageUrl,
                    type: item.type || 'original',
                    genre: displayGenre || '',
                    introduction: displayIntro || '',
                    chapters: [],
                    isPublic: true,
                    isAdult: Boolean(item.isAdult),
                    createdAt: item.createdAt || item.updatedAt,
                    updatedAt: item.updatedAt,
                  },
                  !Boolean(readerMeta?.followed),
                )}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
                  readerMeta?.followed
                    ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100',
                )}
                title={readerMeta?.followed ? 'Bỏ theo dõi truyện' : 'Theo dõi truyện'}
              >
                <Heart className={cn('h-4 w-4', readerMeta?.followed ? 'fill-current' : '')} />
              </button>
            </div>
          </div>

          {item.coverImageUrl ? (
            <div className="mb-4 mx-auto w-full max-w-[11.5rem] overflow-hidden rounded-2xl border border-slate-100 bg-slate-100">
              <img
                src={item.coverImageUrl}
                alt={`Bìa truyện ${displayTitle}`}
                className="aspect-[2/3] w-full object-cover object-center"
                loading="lazy"
              />
            </div>
          ) : null}

          <p className="line-clamp-2 min-h-[3.2rem] text-sm leading-relaxed text-slate-600">
            {buildStoryCardMetaLine({ introduction: displayIntro, genre: displayGenre })}
          </p>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-[11px] font-semibold text-slate-500">
            <span>{item.chapterCount} chương</span>
            <span>Cập nhật {formatPublicUpdatedAt(item.updatedAt)}</span>
          </div>
          {readerMeta ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em]">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                Đã đọc {Math.min(readCount, chapterTotal)}/{chapterTotal || '?'}
              </span>
              {readerMeta.lastChapterOrder > 0 ? (
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-indigo-700">
                  Đọc tới chương {readerMeta.lastChapterOrder}
                </span>
              ) : null}
            </div>
          ) : null}

          <button
            onClick={() => void handleOpenPublicStory(item)}
            disabled={isLoading}
            className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            {readerMeta?.lastChapterId ? 'Đọc tiếp' : 'Đọc truyện'}
          </button>
        </article>
      );
    };

    const renderPublicSection = (
      sectionTitle: string,
      sectionHint: string,
      icon: React.ReactNode,
      items: PublicStoryFeedItem[],
    ) => (
      <section className="mb-8">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              {icon}
            </span>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">{sectionTitle}</h3>
              <p className="text-[11px] sm:text-xs text-slate-500">{sectionHint}</p>
            </div>
          </div>
          <span className="self-start sm:self-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
            {items.length} truyện
          </span>
        </div>
        {items.length > 0 ? (
          <div className="grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => renderPublicStoryCard(item))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Chưa có truyện phù hợp với bộ lọc hiện tại.
          </div>
        )}
      </section>
    );

    return (
      <motion.div
        key="reader-home"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pt-24 sm:pt-28 md:pt-32"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-6 sm:mb-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="mb-2 text-3xl sm:text-4xl font-serif font-bold tracking-tight text-slate-900">Tủ truyện</h2>
              <p className="text-sm text-slate-500">Chọn truyện của bạn hoặc đọc truyện công khai từ cộng đồng.</p>
            </div>
            <button
              onClick={() => handleSwitchAppMode('creator')}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/20 hover:bg-indigo-700"
            >
              Mở Studio
            </button>
          </div>
          <div className="mt-5 sm:mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs sm:text-sm font-bold',
                readerNavMode === 'search'
                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : readerFeedTab === 'public'
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700',
              )}
            >
              {readerNavMode === 'search'
                ? <Search className="h-4 w-4" />
                : (readerFeedTab === 'public' ? <Users className="h-4 w-4" /> : <Library className="h-4 w-4" />)}
              {readerNavMode === 'search'
                ? 'Đang xem: Tìm kiếm'
                : (readerFeedTab === 'public' ? 'Đang xem: Khám phá' : 'Đang xem: Tủ truyện')}
            </span>
            {readerFeedTab === 'public' ? (
              <button
                onClick={() => void refreshPublicStoryFeed()}
                disabled={publicFeedLoading}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {publicFeedLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Làm mới truyện công khai
              </button>
            ) : null}
          </div>
          {readerNavMode === 'search' ? (
          <div ref={readerDiscoveryControlsRef} className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <label className="lg:col-span-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  ref={readerSearchInputRef}
                  value={readerQuery}
                  onChange={(event) => setReaderQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      pushReaderSearchHistory(readerQuery);
                    }
                  }}
                  placeholder="Tìm theo tên truyện, giới thiệu, thể loại..."
                  className="w-full bg-transparent text-sm font-medium text-slate-800 outline-none"
                />
                <button
                  onClick={() => pushReaderSearchHistory(readerQuery)}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                >
                  Lưu từ khóa
                </button>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Thể loại</span>
                <select
                  value={publicFeedGenreFilter}
                  onChange={(event) => setPublicFeedGenreFilter(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="all">Tất cả</option>
                  {publicFeedGenreOptions.map((genre) => (
                    <option key={genre} value={genre}>{genre}</option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Trạng thái</span>
                <select
                  value={readerStatusFilter}
                  onChange={(event) => setReaderStatusFilter(event.target.value as ReaderStatusFilter)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="all">Tất cả</option>
                  <option value="ongoing">Đang ra</option>
                  <option value="completed">Hoàn thành</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Độ dài</span>
                <select
                  value={readerLengthFilter}
                  onChange={(event) => setReaderLengthFilter(event.target.value as ReaderLengthFilter)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="all">Tất cả</option>
                  <option value="short">Ngắn</option>
                  <option value="medium">Vừa</option>
                  <option value="long">Dài</option>
                  <option value="epic">Rất dài</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Loại truyện</span>
                <select
                  value={readerTypeFilter}
                  onChange={(event) => setReaderTypeFilter(event.target.value as ReaderTypeFilter)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="all">Tất cả</option>
                  <option value="original">Sáng tác</option>
                  <option value="translated">Dịch</option>
                  <option value="continued">Viết tiếp</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Mức nội dung</span>
                <select
                  value={readerAdultFilter}
                  onChange={(event) => setReaderAdultFilter(event.target.value as ReaderAdultFilter)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="all">Tất cả</option>
                  <option value="safe">Bình thường</option>
                  <option value="adult">18+</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <span>Sắp xếp</span>
                <select
                  value={publicFeedSort}
                  onChange={(event) => setPublicFeedSort(event.target.value as ReaderSortMode)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-300"
                >
                  <option value="updated">Mới cập nhật</option>
                  <option value="recent">Mới đọc gần đây</option>
                  <option value="popular">Phổ biến</option>
                  <option value="chapters">Nhiều chương</option>
                  <option value="title">Tên A-Z</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={resetReaderFilters}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Reset bộ lọc
              </button>
              <button
                onClick={saveCurrentReaderFilterPreset}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
              >
                Lưu preset
              </button>
              <span className="text-xs text-slate-500">
                {readerFeedTab === 'mine'
                  ? `Hiển thị ${mineFeedFilteredStories.length}/${mineStoryListItems.length} truyện`
                  : `Hiển thị ${publicFeedFilteredStories.length}/${publicStoryFeed.length} truyện`}
              </span>
            </div>

            {publicFeedGenreOptions.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {publicFeedGenreOptions.slice(0, 12).map((genre) => (
                  <button
                    key={`genre-chip-${genre}`}
                    onClick={() => setPublicFeedGenreFilter(genre)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                      publicFeedGenreFilter === genre
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700',
                    )}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            ) : null}

            {readerTrendingGenres.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Thể loại nổi bật</span>
                {readerTrendingGenres.map((item) => (
                  <button
                    key={`trend-${item.label}`}
                    onClick={() => setPublicFeedGenreFilter(item.label)}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    {item.label} · {item.count}
                  </button>
                ))}
              </div>
            ) : null}

            {readerSearchHistory.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Tìm gần đây</span>
                {readerSearchHistory.slice(0, 8).map((history) => (
                  <button
                    key={`search-history-${history}`}
                    onClick={() => {
                      setReaderQuery(history);
                      pushReaderSearchHistory(history);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                  >
                    {history}
                  </button>
                ))}
              </div>
            ) : null}

            {readerFilterPresets.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Preset</span>
                {readerFilterPresets.map((preset) => (
                  <div key={preset.id} className="inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-white">
                    <button
                      onClick={() => applyReaderFilterPreset(preset)}
                      className="px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => removeReaderFilterPreset(preset.id)}
                      className="border-l border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      title="Xóa preset"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}
        </div>

        {readerFeedTab === 'mine' ? (
          <>
            {(readerHistory.length > 0 || followedStories.length > 0) ? (
              <div className="mx-auto mb-8 max-w-7xl px-4 sm:px-6 space-y-5">
                {readerHistory.length > 0 ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="inline-flex items-center gap-2 text-base sm:text-lg font-bold text-slate-900">
                        <History className="h-5 w-5 text-indigo-600" />
                        Lịch sử đọc gần đây
                      </h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                        {readerHistory.length} truyện
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {readerHistory.map((item) => (
                        <button
                          key={`history-${item.storyId}`}
                          onClick={() => void openStoryFromReaderActivity(item)}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                        >
                          <p className="line-clamp-2 text-sm font-bold text-slate-900">{item.storyTitle || 'Truyện chưa đặt tên'}</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">
                            Chương {item.lastChapterOrder || '?'} · {formatReaderTime(item.lastReadAt)}
                          </p>
                          <p className="mt-2 text-[11px] font-semibold text-emerald-700">
                            Đã đọc {item.readChapterIds.length}/{item.totalChapters || '?'} chương
                          </p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {followedStories.length > 0 ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="inline-flex items-center gap-2 text-base sm:text-lg font-bold text-slate-900">
                        <Heart className="h-5 w-5 text-rose-600" />
                        Truyện đang theo dõi
                      </h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                        {followedStories.length} truyện
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {followedStories.map((item) => (
                        <button
                          key={`follow-${item.storyId}`}
                          onClick={() => void openStoryFromReaderActivity(item)}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-rose-200 hover:bg-rose-50"
                        >
                          <p className="line-clamp-2 text-sm font-bold text-slate-900">{item.storyTitle || 'Truyện chưa đặt tên'}</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">
                            {item.genre || 'Chưa phân loại'}
                          </p>
                          {item.lastChapterOrder > 0 ? (
                            <p className="mt-2 text-[11px] font-semibold text-indigo-700">
                              Đọc tới chương {item.lastChapterOrder}
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] font-semibold text-slate-500">
                              Chưa có lịch sử đọc
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
            <StoryList
              refreshKey={storiesVersion}
              storiesOverride={mineFeedFilteredStories}
              onView={(story) => {
                setSelectedStory(story);
                navigate(`/${resolveStorySlug(story)}`);
              }}
              readerActivityMap={readerActivityMap}
              showReaderMeta
              onContinueFromActivity={openStoryFromReaderActivity}
            />
          </>
        ) : (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-24">
            {!hasSupabase ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                Hệ thống chưa hoàn tất kết nối máy chủ nên chưa tải được kho truyện công khai.
              </div>
            ) : null}
            {hasSupabase && publicFeedError ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
                {publicFeedError}
              </div>
            ) : null}
            {hasSupabase && !publicFeedError && publicFeedLoading && publicStoryFeed.length === 0 ? (
              <div className="flex min-h-[12rem] items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-600">
                <span className="inline-flex items-center gap-2 text-sm font-semibold">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tải truyện công khai...
                </span>
              </div>
            ) : null}
            {hasSupabase && !publicFeedError && !publicFeedLoading && publicStoryFeed.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                Chưa có truyện công khai nào để đọc.
              </div>
            ) : null}
            {hasSupabase && publicStoryFeed.length > 0 ? (
              <>
                <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <span>
                      Đang hiển thị <span className="font-bold text-slate-900">{publicFeedFilteredStories.length}</span> truyện từ kho công khai.
                    </span>
                    {publicFeedRelatedStories.length > 0 ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Có {publicFeedRelatedStories.length} truyện đề xuất theo gu đọc của bạn
                      </span>
                    ) : null}
                  </div>
                </div>
                {publicFeedRelatedStories.length > 0 ? (
                  renderPublicSection('Cùng gu bạn hay đọc', 'Đề xuất từ thể loại bạn theo dõi/đọc gần đây.', <Heart className="h-4 w-4" />, publicFeedRelatedStories)
                ) : null}
                {renderPublicSection('Mới cập nhật', 'Các truyện vừa có cập nhật gần nhất.', <Clock className="h-4 w-4" />, publicFeedSections.latest)}
                {renderPublicSection('Đang hot', 'Ưu tiên truyện có tiến độ chương cao và hoạt động tốt.', <Zap className="h-4 w-4" />, publicFeedSections.hot)}
                {renderPublicSection('Hoàn thành', 'Truyện đã đạt đủ số chương theo kế hoạch tác giả đặt ra.', <Check className="h-4 w-4" />, publicFeedSections.completed)}
                {renderPublicSection('Đề cử', 'Gợi ý đọc nhanh dựa trên độ hoàn thiện và chất lượng mô tả.', <Sparkles className="h-4 w-4" />, publicFeedSections.suggested)}
              </>
            ) : null}
          </div>
        )}
      </motion.div>
    );
  };

  const renderMaintenanceWorkspace = (scope: 'global' | 'reader' | 'studio') => {
    const title =
      scope === 'global'
        ? 'Hệ thống đang bảo trì'
        : scope === 'studio'
          ? 'Studio đang bảo trì'
          : 'Khu đọc truyện đang bảo trì';

    const description =
      scope === 'global'
        ? MAINTENANCE_NOTICE_GLOBAL
        : scope === 'studio'
          ? MAINTENANCE_NOTICE_STUDIO
          : MAINTENANCE_NOTICE_READER;

    const canOpenReader = !maintenanceReaderActive && scope !== 'reader';
    const canOpenStudio = !maintenanceStudioActive && scope !== 'studio';
    const etaLabel = maintenanceEtaAtMs ? new Date(maintenanceEtaAtMs).toLocaleString('vi-VN') : MAINTENANCE_ETA;
    const startedAtLabel = maintenanceStartedAt ? new Date(maintenanceStartedAt).toLocaleString('vi-VN') : '';
    const countdownLabel = maintenanceCountdownMs !== null ? formatCountdown(maintenanceCountdownMs) : '';

    return (
      <motion.div
        key={`maintenance-${scope}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="pt-32 px-6 pb-16"
      >
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-8 shadow-xl shadow-amber-900/10">
          <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <Clock className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-serif font-bold text-slate-900">{title}</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{description}</p>
          {etaLabel ? (
            <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-white/80 px-4 py-3 text-sm">
              <p className="font-semibold text-amber-700">Dự kiến mở lại: {etaLabel}</p>
              {countdownLabel ? (
                <p className="text-slate-600">
                  Còn lại: <span className="font-semibold text-slate-800">{countdownLabel}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {startedAtLabel ? (
            <p className="mt-3 text-xs font-medium text-slate-500">
              Bắt đầu bảo trì (tự ghi nhận): {startedAtLabel}
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Tải lại trang
            </button>
            {canOpenReader ? (
              <button
                onClick={() => handleSwitchAppMode('reader')}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
              >
                Chuyển sang khu đọc
              </button>
            ) : null}
            {canOpenStudio ? (
              <button
                onClick={() => handleSwitchAppMode('creator')}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
              >
                Chuyển sang Studio
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    );
  };

  const NotFoundRouteView = ({
    title = '404 - Không tìm thấy',
    message = 'Đường dẫn không hợp lệ hoặc nội dung đã bị xóa.',
  }: {
    title?: string;
    message?: string;
  }) => (
    <div className="mx-auto max-w-3xl pt-32 px-6 text-center">
      <h2 className="text-3xl font-bold text-slate-900">{title}</h2>
      <p className="mt-3 text-slate-500">{message}</p>
      <Link to="/" className="mt-6 inline-flex tf-btn tf-btn-primary">
        Về trang chủ
      </Link>
    </div>
  );

  const StoryRouteLayout = () => <Outlet />;

  const findStoryBySlugFromStorage = useCallback((storySlug: string): Story | null => {
    const normalizedSlug = sanitizeStorySlug(String(storySlug || '').trim());
    if (!normalizedSlug) return null;
    const storyIds = storage.getStoryIds();
    for (const storyId of storyIds) {
      const story = storage.getStoryById(storyId) as Story | null;
      if (!story) continue;
      if (resolveStorySlug(story) === normalizedSlug) return story;
    }
    const publicStories = Object.values(publicStoryCacheRef.current || {});
    for (const story of publicStories) {
      if (!story) continue;
      if (resolveStorySlug(story) === normalizedSlug) return story;
    }
    return null;
  }, [publicStoryCacheVersion]);

  const findStoryByChapterIdFromStorage = useCallback((chapterId: string): { story: Story; chapter: Chapter } | null => {
    const targetId = String(chapterId || '').trim();
    if (!targetId) return null;
    const storyIds = storage.getStoryIds();
    for (const storyId of storyIds) {
      const story = storage.getStoryById(storyId) as Story | null;
      if (!story) continue;
      const chapter = (story.chapters || []).find((item) => item.id === targetId);
      if (chapter) return { story, chapter };
    }
    const publicStories = Object.values(publicStoryCacheRef.current || {});
    for (const story of publicStories) {
      const chapter = (story.chapters || []).find((item) => item.id === targetId);
      if (chapter) return { story, chapter };
    }
    return null;
  }, [publicStoryCacheVersion]);

  const StoryRouteView = () => {
    const params = useParams<{ storySlug: string }>();
    const storySlug = sanitizeStorySlug(String(params.storySlug || '').trim());
    const [resolvingPublicStory, setResolvingPublicStory] = useState(false);
    const routeStory = React.useMemo(
      () => findStoryBySlugFromStorage(storySlug),
      [findStoryBySlugFromStorage, storySlug, storiesVersion],
    );

    useEffect(() => {
      let cancelled = false;
      if (routeStory || !storySlug) {
        setResolvingPublicStory(false);
        return () => {
          cancelled = true;
        };
      }
      setResolvingPublicStory(true);
      void loadPublicStoryBySlug(storySlug).finally(() => {
        if (!cancelled) setResolvingPublicStory(false);
      });
      return () => {
        cancelled = true;
      };
    }, [loadPublicStoryBySlug, routeStory, storySlug]);

    useEffect(() => {
      setSelectedStory((prev) => {
        if (!routeStory) return null;
        return prev?.id === routeStory.id ? prev : routeStory;
      });
    }, [routeStory]);

    if (resolvingPublicStory && !routeStory) {
      return (
        <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center px-6 pt-32">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải truyện công khai...
          </p>
        </div>
      );
    }

    if (!routeStory) {
      return <NotFoundRouteView title="Không tìm thấy truyện" message="Liên kết truyện không còn hợp lệ hoặc truyện đã bị xóa." />;
    }

    const storyPath = `/${resolveStorySlug(routeStory)}`;
    const canEdit = Boolean(user?.uid && routeStory.authorId && String(user.uid) === String(routeStory.authorId));
    if (maintenanceReaderActive && !canEdit) {
      return renderMaintenanceWorkspace('reader');
    }

    return (
      <StoryDetail
        story={routeStory}
        currentUserId={user?.uid}
        readerActivity={readerActivityMap[routeStory.id] || null}
        onReaderMarkChapterRead={handleReaderMarkChapterRead}
        onReaderToggleFollow={handleReaderToggleFollow}
        breadcrumbs={[
          { label: 'Trang chủ', to: '/' },
          { label: routeStory.title || 'Chi tiết truyện' },
        ]}
        onBack={() => navigate('/')}
        onEdit={() => {
          if (!canEdit) {
            notifyApp({ tone: 'warn', message: 'Bạn chỉ có quyền chỉnh sửa truyện của chính mình.' });
            return;
          }
          setEditingStory(routeStory);
          setSelectedStory(null);
          navigate('/');
        }}
        onAddChapter={() => {
          if (!canEdit) {
            notifyApp({ tone: 'warn', message: 'Bạn chỉ có thể thêm chương cho truyện của chính mình.' });
            return;
          }
          setSelectedStory(routeStory);
          setShowAIGen(true);
        }}
        onUpdateStory={(updated) => setSelectedStory(updated)}
        onExportStory={handleOpenExportStory}
        onOpenReaderPrefs={() => setShowReaderPrefsModal(true)}
        onOpenChapter={(chapter) => navigate(`${storyPath}/${getChapterRouteSlug(chapter)}`, { state: { storyId: routeStory.id } })}
        isReadOnly={!canEdit}
      />
    );
  };

  const ReaderRouteView = () => {
    const params = useParams<{ storySlug: string; chapterSlug: string }>();
    const storySlug = sanitizeStorySlug(String(params.storySlug || '').trim());
    const chapterSlug = String(params.chapterSlug || '').trim().toLowerCase();
    const routeState = (location.state || {}) as { storyId?: string };
    const [resolvingPublicStory, setResolvingPublicStory] = useState(false);
    const storyByState = React.useMemo(
      () => {
        if (!routeState.storyId) return null;
        const local = storage.getStoryById(routeState.storyId) as Story | null;
        if (local) return local;
        return publicStoryCacheRef.current[routeState.storyId] || null;
      },
      [routeState.storyId, storiesVersion, publicStoryCacheVersion],
    );
    const storyBySlug = React.useMemo(
      () => findStoryBySlugFromStorage(storySlug),
      [findStoryBySlugFromStorage, storySlug, storiesVersion],
    );
    const routeStory = storyBySlug || storyByState;
    const routeChapter = routeStory ? findChapterByRouteSlug(routeStory.chapters || [], chapterSlug) : null;

    useEffect(() => {
      let cancelled = false;
      if (routeStory || !storySlug) {
        setResolvingPublicStory(false);
        return () => {
          cancelled = true;
        };
      }
      setResolvingPublicStory(true);
      void loadPublicStoryBySlug(storySlug).finally(() => {
        if (!cancelled) setResolvingPublicStory(false);
      });
      return () => {
        cancelled = true;
      };
    }, [loadPublicStoryBySlug, routeStory, storySlug]);

    useEffect(() => {
      setSelectedStory((prev) => {
        if (!routeStory) return null;
        return prev?.id === routeStory.id ? prev : routeStory;
      });
    }, [routeStory]);

    if (resolvingPublicStory && !routeStory) {
      return (
        <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center px-6 pt-32">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải chương truyện công khai...
          </p>
        </div>
      );
    }

    if (!routeStory || !routeChapter) {
      return <NotFoundRouteView title="Không tìm thấy chương" message="Liên kết chương không còn hợp lệ hoặc chương đã được cập nhật." />;
    }

    const storyPath = `/${resolveStorySlug(routeStory)}`;
    const canEdit = Boolean(user?.uid && routeStory.authorId && String(user.uid) === String(routeStory.authorId));
    if (maintenanceReaderActive && !canEdit) {
      return renderMaintenanceWorkspace('reader');
    }

    return (
      <StoryDetail
        story={routeStory}
        forcedChapterId={routeChapter.id}
        currentUserId={user?.uid}
        readerActivity={readerActivityMap[routeStory.id] || null}
        onReaderMarkChapterRead={handleReaderMarkChapterRead}
        onReaderToggleFollow={handleReaderToggleFollow}
        breadcrumbs={[
          { label: 'Trang chủ', to: '/' },
          { label: routeStory.title || 'Chi tiết truyện', to: storyPath },
          { label: routeChapter.title || 'Nội dung chương' },
        ]}
        onBack={() => navigate('/')}
        onEdit={() => {
          if (!canEdit) {
            notifyApp({ tone: 'warn', message: 'Bạn chỉ có quyền chỉnh sửa truyện của chính mình.' });
            return;
          }
          setEditingStory(routeStory);
          setSelectedStory(null);
          navigate('/');
        }}
        onAddChapter={() => {
          if (!canEdit) {
            notifyApp({ tone: 'warn', message: 'Bạn chỉ có thể thêm chương cho truyện của chính mình.' });
            return;
          }
          setSelectedStory(routeStory);
          setShowAIGen(true);
        }}
        onUpdateStory={(updated) => setSelectedStory(updated)}
        onExportStory={handleOpenExportStory}
        onOpenReaderPrefs={() => setShowReaderPrefsModal(true)}
        onReaderBack={() => navigate(storyPath)}
        onReaderNavigateChapter={(nextChapterId, mode) => {
          const nextChapter = (routeStory.chapters || []).find((chapter) => chapter.id === nextChapterId);
          if (!nextChapter) return;
          navigate(`${storyPath}/${getChapterRouteSlug(nextChapter)}`, {
            replace: mode === 'replace',
            state: { storyId: routeStory.id },
          });
        }}
        isReadOnly={!canEdit}
      />
    );
  };

  const LegacyStoryRouteRedirect = () => {
    const params = useParams<{ id: string }>();
    const legacyId = String(params.id || '').trim();
    const legacyStory = React.useMemo(
      () => storage.getStoryById(legacyId) as Story | null,
      [legacyId, storiesVersion],
    );
    if (!legacyStory) return <NotFoundRouteView title="Không tìm thấy truyện" message="Liên kết truyện cũ không còn dùng được." />;
    return <Navigate to={`/${resolveStorySlug(legacyStory)}`} replace />;
  };

  const LegacyReaderRouteRedirect = () => {
    const params = useParams<{ chapterId: string }>();
    const chapterId = String(params.chapterId || '').trim();
    const resolved = React.useMemo(
      () => findStoryByChapterIdFromStorage(chapterId),
      [chapterId, findStoryByChapterIdFromStorage, storiesVersion],
    );
    if (!resolved) return <NotFoundRouteView title="Không tìm thấy chương" message="Liên kết chương cũ không còn dùng được." />;
    return <Navigate to={`/${resolveStorySlug(resolved.story)}/${getChapterRouteSlug(resolved.chapter)}`} replace />;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center font-serif">Đang khởi động...</div>;

  return (
    <div className={cn(
      'app-shell min-h-screen',
      viewportMode === 'mobile' ? 'app-shell--mobile' : 'app-shell--desktop',
      themeMode === 'dark' ? 'night-bg text-slate-100' : 'day-bg text-slate-900'
    )}>
      <AIGenerationModal 
        isOpen={showAIGen} 
        onClose={() => setShowAIGen(false)} 
        onGenerate={handleAIGenerateChapters}
        initialOutline={selectedStory?.content || ""}
        isAdult={selectedStory?.isAdult}
        lastChapterContent={selectedStory?.chapters?.length ? [...selectedStory.chapters].sort((a, b) => b.order - a.order)[0].content : ""}
      />

      <AIStoryCreationModal 
        isOpen={showAIStoryModal}
        onClose={() => {
          setShowAIStoryModal(false);
          setPendingFile(null);
        }}
        onConfirm={(options) => {
          if (pendingFile) {
            handleAIStoryCreation({ ...options, file: pendingFile });
          }
        }}
        fileName={pendingFile?.name || ""}
      />

      {isProcessingAI && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white/80 backdrop-blur-md">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
            <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-indigo-600 animate-pulse" />
          </div>
          <h3 className="mt-8 text-2xl font-serif font-bold text-slate-900">AI đang xử lý...</h3>
          <p className="mt-2 text-slate-500">Vui lòng đợi trong giây lát ({aiTimer} giây)...</p>
          <p className="text-xs text-slate-400 mt-1 italic">Thông thường mất khoảng 10-30 giây tùy độ dài.</p>
        </div>
      )}

      {showPromptManager && (
        <React.Suspense fallback={null}>
          <PromptLibraryModalNew
            isOpen={showPromptManager}
            onClose={() => setShowPromptManager(false)}
            onSelect={() => setShowPromptManager(false)}
          />
        </React.Suspense>
      )}

      <input
        ref={backupImportInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportBackupFile}
      />

      <ExportStoryModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        format={exportFormat}
        onFormatChange={setExportFormat}
        includeToc={exportIncludeToc}
        onToggleToc={setExportIncludeToc}
        onConfirm={handleExportStoryConfirm}
        busy={isExportingStory}
        storyTitle={exportStory?.title || ''}
      />

      {showProfileModal && (
        <div className="fixed inset-0 z-[260] tf-modal-overlay bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="tf-modal-panel w-full max-w-lg tf-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Thiết lập cá nhân</h3>
              <button className="tf-btn tf-btn-ghost px-3 py-1" onClick={closeProfileModal}>Đóng</button>
            </div>
            <div className="space-y-3">
              <label className="text-sm text-slate-300">Avatar</label>
              <input
                ref={profileAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleProfileAvatarFileChange}
              />
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <img
                  src={profileAvatarDraft || user?.photoURL || DEFAULT_PROFILE_AVATAR}
                  alt="Avatar xem trước"
                  className="h-24 w-24 rounded-full object-cover border border-white/10 bg-slate-800"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-slate-400 tf-break-long">Bạn có thể tải ảnh trực tiếp từ thiết bị hoặc dán URL như trước. Ảnh tải lên sẽ được tối ưu và lưu cục bộ trong trình duyệt này.</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      className="tf-btn tf-btn-primary"
                      onClick={() => profileAvatarInputRef.current?.click()}
                      disabled={isUploadingProfileAvatar}
                    >
                      {isUploadingProfileAvatar ? 'Đang xử lý ảnh...' : 'Tải ảnh từ thiết bị'}
                    </button>
                    <button
                      type="button"
                      className="tf-btn tf-btn-ghost"
                      onClick={() => {
                        setProfileAvatarDraft(user?.photoURL || DEFAULT_PROFILE_AVATAR);
                        setProfileAvatarError('');
                      }}
                    >
                      Dùng avatar mặc định
                    </button>
                  </div>
                  {profileAvatarError ? <p className="text-sm text-rose-400 tf-break-long">{profileAvatarError}</p> : null}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Tên hiển thị</label>
              <input
                className="tf-input"
                value={profileNameDraft}
                onChange={(e) => setProfileNameDraft(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Avatar URL</label>
              <input
                className="tf-input tf-break-all"
                value={profileAvatarDraft}
                onChange={(e) => {
                  setProfileAvatarDraft(e.target.value);
                  setProfileAvatarError('');
                }}
                placeholder="https://... hoặc data:image/..."
              />
            </div>
            <div className="flex justify-end gap-2 tf-modal-actions">
              <button className="tf-btn tf-btn-ghost" onClick={closeProfileModal}>Hủy</button>
              <button
                className="tf-btn tf-btn-primary"
                onClick={saveProfileDraft}
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
      {showReleaseHistoryModal && (
        <div className="fixed inset-0 z-[265] tf-modal-overlay bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="tf-modal-panel w-full max-w-2xl tf-card p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Phiên bản hiện tại</p>
                <h3 className="text-xl font-bold">TruyenForge {CURRENT_WRITER_VERSION}</h3>
              </div>
              <button className="tf-btn tf-btn-ghost px-3 py-1" onClick={() => setShowReleaseHistoryModal(false)}>Đóng</button>
            </div>
            <div className="space-y-3">
              <React.Suspense fallback={<div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">Đang tải lịch sử cập nhật...</div>}>
                <ReleaseHistoryAccordion
                  notes={WRITER_RELEASE_NOTES}
                  currentVersion={CURRENT_WRITER_VERSION}
                  variant="dark"
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      {showBackupCenterModal && (
        <div
          className="fixed inset-0 z-[266] tf-modal-overlay bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeBackupCenter();
            }
          }}
        >
          <div className="tf-modal-panel relative w-full max-w-[1100px] max-h-[92vh] overflow-hidden tf-card p-4 sm:p-5 md:p-6">
            <button
              type="button"
              aria-label="Đóng bảng sao lưu"
              className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-slate-950/85 text-slate-200 shadow-lg transition hover:border-indigo-400/60 hover:bg-slate-900 hover:text-white"
              onClick={closeBackupCenter}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="space-y-4 overflow-y-auto pr-1 sm:pr-2 max-h-[calc(92vh-2.25rem)]">
            <div className="space-y-3 pr-14">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sao lưu & khôi phục</p>
              <h3 className="text-2xl font-bold">Sao lưu và khôi phục dữ liệu</h3>
              <p className="text-sm text-slate-400 max-w-3xl">
                Bản tối giản: chỉ giữ thao tác quan trọng để tránh rối. Khi đã liên kết Drive, liên kết đó sẽ được khóa cố định cho tài khoản và app tự dùng lại ở các lần đăng nhập sau.
              </p>
            </div>

            {backupWarningMessage ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold text-rose-50">Nhắc bạn sao lưu</p>
                    <p>{backupWarningMessage}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-indigo-500/15 px-3 py-1 font-semibold text-indigo-100">
                  Mốc gần nhất: {latestBackupAt ? formatBackupTimestamp(latestBackupAt) : 'Chưa có'}
                </span>
                <span className={cn(
                  'rounded-full px-3 py-1 font-semibold',
                  driveBinding ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-300'
                )}>
                  Drive: {driveBinding ? 'Đã liên kết' : 'Chưa liên kết'}
                </span>
                <span className={cn(
                  'rounded-full px-3 py-1 font-semibold',
                  user && hasSupabase && ACCOUNT_CLOUD_AUTOSYNC_ENABLED ? 'bg-cyan-500/15 text-cyan-200' : 'bg-slate-800 text-slate-300'
                )}>
                  Đồng bộ tài khoản: {user && hasSupabase && ACCOUNT_CLOUD_AUTOSYNC_ENABLED ? 'Đang bật' : 'Tạm chưa sẵn sàng'}
                </span>
                <span className={cn(
                  'rounded-full px-3 py-1 font-semibold',
                  accountSyncQueueStats.failed > 0
                    ? 'bg-rose-500/15 text-rose-200'
                    : accountSyncQueueStats.pending > 0 || accountSyncQueueStats.running > 0
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'bg-emerald-500/15 text-emerald-200'
                )}>
                  Trạng thái đồng bộ: {accountSyncQueueStats.failed > 0
                    ? `${accountSyncQueueStats.failed} lỗi`
                    : accountSyncQueueStats.pending > 0 || accountSyncQueueStats.running > 0
                      ? `${accountSyncQueueStats.pending + accountSyncQueueStats.running} đang chờ`
                      : 'Ổn định'}
                </span>
              </div>
              {accountSyncQueueStats.failed > 0 && accountSyncQueueStats.nextRetryAt ? (
                <p className="text-xs text-rose-200">
                  Hệ thống sẽ tự thử lại lúc {formatBackupTimestamp(accountSyncQueueStats.nextRetryAt)}.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  className="tf-btn tf-btn-primary"
                  onClick={handleBackupNow}
                  disabled={backupBusyAction === 'backup-now'}
                >
                  {backupBusyAction === 'backup-now' ? 'Đang sao lưu...' : 'Sao lưu ngay'}
                </button>
                <button
                  className="tf-btn tf-btn-ghost"
                  onClick={handleDownloadCurrentBackupJson}
                  disabled={isExporting}
                >
                  {isExporting ? 'Đang chuẩn bị...' : 'Tải file sao lưu'}
                </button>
                <button
                  className="tf-btn tf-btn-ghost"
                  onClick={() => backupImportInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? 'Đang đọc file...' : 'Khôi phục từ file'}
                </button>
                <button
                  className="tf-btn tf-btn-ghost"
                  onClick={() => void handleManualAccountSync()}
                  disabled={!user || !hasSupabase || backupBusyAction === 'manual-sync'}
                >
                  {backupBusyAction === 'manual-sync' ? 'Đang đồng bộ...' : 'Đồng bộ ngay lên tài khoản'}
                </button>
                <button
                  className="tf-btn tf-btn-ghost"
                  onClick={handleConnectDrive}
                  disabled={!user || !driveConfigured || Boolean(driveBinding) || backupBusyAction === 'connect-drive'}
                >
                  {backupBusyAction === 'connect-drive'
                    ? 'Đang kết nối...'
                    : driveBinding
                      ? `Đã khóa với ${driveBinding.email}`
                      : 'Liên kết Drive (một lần)'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold">Lịch sử sao lưu</h4>
                    <p className="text-sm text-slate-400">Tại đây bạn có thể xem từng mốc đã lưu, tải về máy hoặc khôi phục lại ngay khi cần.</p>
                  </div>
                  <button
                    className="tf-btn tf-btn-ghost"
                    onClick={() => void refreshBackupHistory()}
                  >
                    Làm mới
                  </button>
                </div>

                {!backupHistoryReady ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-8 text-center text-sm text-slate-400">
                    Đang nạp lịch sử sao lưu...
                  </div>
                ) : backupSnapshots.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/50 px-4 py-8 text-center text-sm text-slate-400">
                    Chưa có mốc sao lưu nào. Hãy bấm <strong className="text-white">Sao lưu ngay</strong> để tạo bản đầu tiên.
                  </div>
                ) : (
                  <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-2">
                    {backupSnapshots.map((snapshot) => {
                      const restoreBusy = backupBusyAction === `restore:${snapshot.id}`;
                      return (
                        <div key={snapshot.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 space-y-3">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-200">
                                  {getBackupReasonLabel(snapshot.reason)}
                                </span>
                                <span className={cn(
                                  'rounded-full px-3 py-1 text-xs font-semibold',
                                  snapshot.drive?.status === 'uploaded'
                                    ? 'bg-emerald-500/15 text-emerald-200'
                                    : snapshot.drive?.status === 'failed'
                                      ? 'bg-rose-500/15 text-rose-200'
                                      : 'bg-slate-800 text-slate-300'
                                )}>
                                  {getDriveStatusLabel(snapshot)}
                                </span>
                              </div>
                              <p className="text-base font-semibold text-white">{formatBackupTimestamp(snapshot.createdAt)}</p>
                              <p className="text-sm text-slate-400">
                                {(snapshot.payload.stories || []).length} truyện · {(snapshot.payload.characters || []).length} nhân vật · {(snapshot.payload.translation_names || []).length} tên dịch
                              </p>
                              {snapshot.drive?.status === 'uploaded' ? (
                                <p className="text-xs text-emerald-300">Mốc này hiện đã có cả trên máy và trên Google Drive.</p>
                              ) : null}
                              {snapshot.drive?.error ? (
                                <p className="text-xs text-amber-300">
                                  {driveConfigured && (
                                    snapshot.drive.error.includes('VITE_GOOGLE_DRIVE_CLIENT_ID')
                                    || snapshot.drive.error.includes('Chưa có cấu hình Google Drive')
                                  )
                                    ? 'Mốc này được tạo trước khi bạn bật Google Drive. Tạo một mốc sao lưu mới để cập nhật trạng thái Drive.'
                                    : snapshot.drive.error}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="tf-btn tf-btn-ghost"
                                onClick={() => void handleDownloadBackupSnapshot(snapshot.id)}
                              >
                                Tải về
                              </button>
                              <button
                                className="tf-btn tf-btn-primary"
                                onClick={() => void handleRestoreBackupSnapshot(snapshot.id)}
                                disabled={restoreBusy}
                              >
                                {restoreBusy ? 'Đang khôi phục...' : 'Khôi phục mốc này'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode={authMode}
        onModeChange={setAuthMode}
        email={authEmailInput}
        password={authPasswordInput}
        onEmailChange={setAuthEmailInput}
        onPasswordChange={setAuthPasswordInput}
        onSubmit={handleAuthSubmit}
        onProvider={handleAuthProvider}
        onForgotPassword={handleForgotPassword}
        busy={authBusy}
        error={authError}
      />

      <Navbar 
        currentView={view} 
        setView={(v) => {
          if (appMode !== 'creator') {
            handleSwitchAppMode('creator');
          }
          setView(v);
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(false);
          navigate('/studio');
        }} 
        onHome={() => {
          setView('stories');
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(false);
          navigate(appMode === 'creator' ? '/studio' : '/');
        }}
        onCreateStory={() => {
          if (appMode !== 'creator') {
            setAppMode('creator');
          }
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(true);
          navigate('/studio');
        }}
        appMode={appMode}
        onSwitchAppMode={handleSwitchAppMode}
        readerNavKey={
          appMode === 'reader'
            ? (readerNavMode === 'search'
              ? 'reader-search'
              : (readerFeedTab === 'public' ? 'reader-public' : 'reader-mine'))
            : undefined
        }
        onOpenReaderMine={() => openReaderFeedFromNavbar('mine')}
        onOpenReaderPublic={() => openReaderFeedFromNavbar('public')}
        onOpenReaderSearch={focusReaderSearchFromNavbar}
        themeMode={themeMode}
        onToggleTheme={handleToggleTheme}
        viewportMode={viewportMode}
        onToggleViewportMode={handleToggleViewportMode}
        profile={profile}
        versionLabel={CURRENT_WRITER_VERSION}
        finopsWarning={finopsWarning}
        authEmail={user?.email}
        onShowAuth={() => setShowAuthModal(true)} 
        onLogout={logout}
        onOpenProfile={() => setShowProfileModal(true)} 
        onOpenPromptManager={() => setShowPromptManager(true)}
        onOpenReleaseHistory={() => setShowReleaseHistoryModal(true)}
        onOpenBackupCenter={() => {
          setDriveAuth(loadStoredDriveAuth());
          setShowBackupCenterModal(true);
          void refreshBackupHistory();
          void loadBoundDriveBinding();
        }}
      />

      <div className="app-shell__body">
      {backupWarningMessage ? (
        <div className="mx-auto max-w-7xl px-6 pt-6">
          <div className="rounded-2xl border border-rose-400/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-rose-50">Đã lâu chưa sao lưu</p>
                <p>{backupWarningMessage}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <Routes>
        {maintenanceGlobalActive ? (
          <Route path="*" element={renderMaintenanceWorkspace('global')} />
        ) : (
          <Route element={<div className={cn('tf-route-scene', routeTransitionClass)}><Outlet /></div>}>
            <Route
              path="/"
              element={
                appMode === 'creator'
                  ? (maintenanceStudioActive ? renderMaintenanceWorkspace('studio') : <Navigate to="/studio" replace />)
                  : (maintenanceReaderActive ? renderMaintenanceWorkspace('reader') : renderReaderWorkspace())
              }
            />
            <Route
              path="/studio"
              element={maintenanceStudioActive ? renderMaintenanceWorkspace('studio') : renderHomeWorkspace()}
            />
            <Route path="/oauth/consent" element={<Navigate to={oauthConsentRedirectTarget} replace />} />
            <Route path="/oauth/consent/" element={<Navigate to={oauthConsentRedirectTarget} replace />} />
            <Route
              path="/story/:id"
              element={maintenanceReaderActive ? renderMaintenanceWorkspace('reader') : <LegacyStoryRouteRedirect />}
            />
            <Route
              path="/reader/:chapterId"
              element={maintenanceReaderActive ? renderMaintenanceWorkspace('reader') : <LegacyReaderRouteRedirect />}
            />
            <Route path="/:storySlug" element={<StoryRouteLayout />}>
              <Route index element={<StoryRouteView />} />
              <Route path=":chapterSlug" element={<ReaderRouteView />} />
            </Route>
            <Route path="*" element={<NotFoundRouteView />} />
          </Route>
        )}
      </Routes>
      </div>

      <AiFileActionModal
        isOpen={showAiFileActionModal}
        onClose={clearPendingAiFileAction}
        onChooseTranslate={openTranslateFlowFromPendingFile}
        onChooseContinue={openContinueFlowFromPendingFile}
        fileName={pendingAiFileName}
        contentLength={pendingAiFileContent.length}
      />

      <AIContinueStoryModal 
        isOpen={showAIContinueModal}
        onClose={() => setShowAIContinueModal(false)}
        onConfirm={handleAIContinueStory}
        fileName={continueFileName}
      />

      <TranslateStoryModal
        isOpen={showTranslateModal}
        onClose={() => setShowTranslateModal(false)}
        onConfirm={handleTranslateStory}
        fileName={translateFileName}
        fileContent={translateFileContent}
        lastGateReport={translationGateLastReport}
      />

      <AppToastStack toasts={appToasts} onDismiss={dismissToast} />

      {showReaderPrefsModal ? (
        <div className="fixed inset-0 z-[240] flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4">
          <div className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl border border-indigo-100 bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">Cài đặt giao diện đọc</p>
                  <p className="text-xs text-indigo-100">Nội dung sẽ được thụt đầu dòng và hiển thị gần toàn màn hình.</p>
                </div>
                <button
                  onClick={() => setShowReaderPrefsModal(false)}
                  className="rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20"
                >
                  Đóng
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Preset nhanh</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => applyReaderPreset('book')}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 text-left"
                  >
                    Sách giấy
                  </button>
                  <button
                    onClick={() => applyReaderPreset('focus')}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 text-left"
                  >
                    Tập trung
                  </button>
                  <button
                    onClick={() => applyReaderPreset('night')}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 text-left"
                  >
                    Đêm dịu mắt
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Kích thước chữ ({readerPrefs.fontSize}px)
                  <input
                    type="range"
                    min={14}
                    max={24}
                    step={1}
                    value={readerPrefs.fontSize}
                    onChange={(e) => setReaderPrefs((prev) => ({ ...prev, fontSize: Number(e.target.value) }))}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Dãn dòng ({readerPrefs.lineHeight.toFixed(2)})
                  <input
                    type="range"
                    min={1.4}
                    max={2.2}
                    step={0.05}
                    value={readerPrefs.lineHeight}
                    onChange={(e) => setReaderPrefs((prev) => ({ ...prev, lineHeight: Number(e.target.value) }))}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Font chữ
                <select
                  value={readerPrefs.fontFamily}
                  onChange={(e) => setReaderPrefs((prev) => ({ ...prev, fontFamily: e.target.value as ReaderPrefs['fontFamily'] }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="serif">Serif (đọc truyện mềm mại)</option>
                  <option value="sans">Sans (gọn gàng, hiện đại)</option>
                  <option value="mono">Mono (soát nội dung)</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Màu nền
                  <input
                    type="color"
                    value={readerPrefs.background}
                    onChange={(e) => setReaderPrefs((prev) => ({ ...prev, background: e.target.value, colorMode: 'custom' }))}
                    className="h-10 w-full rounded-xl border border-slate-200"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Màu chữ
                  <input
                    type="color"
                    value={readerPrefs.textColor}
                    onChange={(e) => setReaderPrefs((prev) => ({ ...prev, textColor: e.target.value, colorMode: 'custom' }))}
                    className="h-10 w-full rounded-xl border border-slate-200"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4" style={{ background: readerPrefs.background, color: readerPrefs.textColor }}>
                <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Xem trước</p>
                <p
                  style={{
                    fontSize: `${readerPrefs.fontSize}px`,
                    lineHeight: readerPrefs.lineHeight,
                    fontFamily: 'var(--tf-reader-font-family)',
                    textIndent: '1.8em',
                  }}
                >
                  Đây là đoạn xem trước. Mỗi đoạn khi đọc truyện sẽ tự thụt đầu dòng để dễ theo dõi, đỡ mỏi mắt và nhìn giống bố cục sách hơn.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 bg-slate-50">
              <button
                onClick={resetReaderPrefs}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Khôi phục mặc định
              </button>
              <button
                onClick={() => setShowReaderPrefsModal(false)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AILoadingOverlay 
        isVisible={isProcessingAI}
        message={aiLoadingMessage}
        stageLabel={aiLoadingStage}
        detail={aiLoadingDetail}
        progress={aiLoadingProgress}
        timer={aiTimer}
        onCancel={cancelActiveAiRun}
      />

      <footer className={cn(
        "mt-10 border-t px-6 py-10 text-sm",
        themeMode === 'dark'
          ? 'border-slate-800 bg-slate-900 text-slate-200'
          : 'border-slate-200 bg-white/95 text-slate-600'
      )}>
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1 text-white text-xs font-bold shadow">
                TruyenForge
              </div>
              <p className={themeMode === 'dark' ? 'text-slate-200' : 'text-slate-700'}>Playground AI cho viết, dịch, QA, worldbuilding. Vận hành cá nhân nên ưu tiên minh bạch, bảo mật và FinOps rõ ràng.</p>
              <p className={themeMode === 'dark' ? 'text-slate-400' : 'text-xs text-slate-500'}>© 2026 TruyenForge · Người xây dựng: Lynx</p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                onClick={handleToggleViewportMode}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all",
                  themeMode === 'dark'
                    ? 'border border-slate-700 bg-slate-800 text-slate-100 hover:border-indigo-400 hover:bg-slate-700'
                    : 'border border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50'
                )}
              >
                {viewportMode === 'mobile' ? 'Chuyển sang Desktop' : 'Chuyển sang Mobile'}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {footerSections.map((section) => (
              <div key={section.id} className={cn(
                "border rounded-2xl shadow-sm",
                themeMode === 'dark' ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white/90'
              )}>
                <button
                  onClick={() => setFooterOpen((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 text-left font-semibold",
                    themeMode === 'dark' ? 'text-slate-100' : 'text-slate-800'
                  )}
                  aria-expanded={footerOpen[section.id]}
                >
                  <span>{section.title}</span>
                  <ChevronRight className={cn('w-5 h-5 transition-transform', themeMode === 'dark' ? 'text-slate-500' : 'text-slate-400', footerOpen[section.id] ? 'rotate-90 text-indigo-500' : '')} />
                </button>
                {footerOpen[section.id] ? (
                  <div className={cn(
                    "px-4 pb-4 pt-1 text-sm space-y-3",
                    themeMode === 'dark' ? 'text-slate-300' : 'text-slate-600'
                  )}>
                    {section.content}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center pt-2">
            <a href="//www.dmca.com/Protection/Status.aspx?ID=2b90d0c4-d934-44b2-a095-dd5eca05debc" title="DMCA.com Protection Status" className="dmca-badge">
              <img src="https://images.dmca.com/Badges/dmca_protected_sml_120n.png?ID=2b90d0c4-d934-44b2-a095-dd5eca05debc" alt="DMCA.com Protection Status" />
            </a>
            <script src="https://images.dmca.com/Badges/DMCABadgeHelper.min.js"></script>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <MotionConfig reducedMotion="always">
      <AuthProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </AuthProvider>
    </MotionConfig>
  );
}
