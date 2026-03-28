import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useAuth, AuthProvider } from './AuthContext';
import { supabase, hasSupabase } from './supabaseClient';
import { storage, type StorageBackupPayload, type StorageImportReport } from './storage';
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
  ImagePlus,
  Database,
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Navbar } from './components/Navbar';
import { ReleaseHistoryAccordion } from './components/ReleaseHistoryAccordion';
import { loadBudgetState, saveBudgetState } from './finops';
import { ApiSectionPanel } from './components/tools/ApiSectionPanel';
import { ToolsPage } from './features/tools/ToolsPage';
import { PromptLibraryModal as PromptLibraryModalNew } from './features/prompt/PromptLibrary';
import { CURRENT_WRITER_VERSION, WRITER_RELEASE_NOTES } from './phase3/releaseHistory';
import { APP_NOTICE_EVENT, notifyApp, type AppNoticePayload, type AppNoticeTone } from './notifications';
import { loadPromptLibraryState, savePromptLibraryState, type PromptLibraryState } from './promptLibraryStore';
import { LOCAL_WORKSPACE_CHANGED_EVENT, emitLocalWorkspaceChanged, loadLocalWorkspaceMeta, markLocalWorkspaceHydrated, type LocalWorkspaceMeta, type LocalWorkspaceSection } from './localWorkspaceSync';
import { WorkspaceConflictError, loadServerWorkspace, saveQaReport, saveServerWorkspace, SUPABASE_STORAGE_TABLES } from './supabaseWorkspace';
import { IMAGE_AI_PROVIDER_META, getDefaultImageAiModel, type ImageAiProvider } from './imageAiProviders';
import { createBackupSnapshot, getBackupSnapshot, listBackupSnapshots, updateBackupSnapshotDriveMeta, type BackupReason, type BackupSnapshot } from './backupVault';
import { buildDriveBackupFilename, connectGoogleDriveInteractive, disconnectGoogleDrive, ensureGoogleDriveAccessToken, hasGoogleDriveBackupConfig, hasUsableDriveToken, loadStoredDriveAuth, uploadBackupSnapshotToDrive, type GoogleDriveAuthState, type GoogleDriveAccountProfile } from './googleDriveBackups';
import { getScopedStorageItem, getWorkspaceScopeUser, setScopedStorageItem, setWorkspaceScopeUser, shouldAllowLegacyScopeFallback } from './workspaceScope';

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { handleRelayMessage, relayGenerateContent, setRelaySender, notifyRelayDisconnected } from './relayBridge';
import { QualityCenter, type QaIssue } from './components/QualityCenter';
import JSZip from 'jszip';
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

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await loadMammothModule();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return String(result?.value || '');
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
const DEFAULT_RELAY_WS_BASE = 'wss://proxymid.ductruong-lynx.workers.dev/';
const DEFAULT_RELAY_WEB_BASE = 'https://proxymid.ductruong-lynx.workers.dev/';
const LEGACY_RELAY_HOST_RE = /(relay2026\.up\.railway\.app|relay2026\.vercel\.app|proxymid\.your-subdomain\.workers\.dev)/i;
const RELAY_SOCKET_BASE = normalizeRelaySocketBase(import.meta.env.VITE_RELAY_WS_BASE || DEFAULT_RELAY_WS_BASE);
const RELAY_WEB_BASE = ((import.meta.env.VITE_RELAY_WEB_BASE || DEFAULT_RELAY_WEB_BASE).trim().replace(/\/+$/, '') + '/');
const RAPHAEL_API_BASE = 'https://api.evolink.ai/v1';
const DEFAULT_RAPHAEL_MODEL = 'z-image-turbo';
const DEFAULT_RAPHAEL_SIZE = '2:3';

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
const UI_PROFILE_KEY = 'ui_profile_v1';
const UI_THEME_KEY = 'ui_theme_v1';
const UI_VIEWPORT_MODE_KEY = 'ui_viewport_mode_v1';
const READER_PREFS_KEY = 'reader_prefs_v1';
const STORIES_UPDATED_EVENT = 'stories:updated';
const WORKSPACE_RECOVERY_KEY = 'truyenforge:workspace-recovery-v1';
const ACCOUNT_CLOUD_AUTOSYNC_ENABLED = String(import.meta.env.VITE_ACCOUNT_AUTOSYNC ?? '1').trim() !== '0';
const ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS = 1200;
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

type ThemeMode = 'light' | 'dark';
type ViewportMode = 'desktop' | 'mobile';

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
const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoSnapshotEnabled: true,
  autoUploadToDrive: true,
  staleAfterHours: 6,
  lastSuccessfulBackupAt: '',
  lastManualSyncAt: '',
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
  styleReferences: any[];
  translationNames: any[];
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
    translationNames: normalizeOwnedRows(snapshot.translationNames as Record<string, unknown>[], userId),
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

function mergeChaptersById(localChapters: Chapter[] = [], remoteChapters: Chapter[] = [], prefer: 'local' | 'remote'): Chapter[] {
  const localMap = new Map(localChapters.map((chapter) => [String(chapter.id || ''), chapter]));
  const remoteMap = new Map(remoteChapters.map((chapter) => [String(chapter.id || ''), chapter]));
  const merged: Chapter[] = [];
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()].filter(Boolean));

  ids.forEach((id) => {
    const localChapter = localMap.get(id);
    const remoteChapter = remoteMap.get(id);
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
      merged.push(remoteStory);
      return;
    }
    if (localStory && !remoteStory) {
      merged.push(localStory);
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
      merged.push(remoteStory);
      return;
    }

    const localUpdatedMs = toTimestampMs(localStory.updatedAt || localStory.createdAt);
    const remoteUpdatedMs = toTimestampMs(remoteStory.updatedAt || remoteStory.createdAt);
    const prefer = localUpdatedMs >= remoteUpdatedMs ? 'local' : 'remote';

    const base = prefer === 'local'
      ? { ...remoteStory, ...localStory }
      : { ...localStory, ...remoteStory };
    base.chapters = mergeChaptersById(localStory.chapters || [], remoteStory.chapters || [], prefer);
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
        merged.styleReferences = picked.value as any[];
        break;
      case 'translationNames':
        merged.translationNames = picked.value as any[];
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
    storage.saveStories(sanitizedSnapshot?.stories || snapshot.stories);
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
    const raw = localStorage.getItem(API_RUNTIME_CONFIG_KEY);
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
        parsed.selectedProvider === 'custom' ||
        parsed.selectedProvider === 'unknown'
          ? parsed.selectedProvider
          : 'gemini',
      selectedModel: parsed.selectedModel || '',
      activeApiKeyId: parsed.activeApiKeyId || '',
      enableCache: parsed.enableCache !== false,
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
    };
  }
}

function saveApiRuntimeConfig(config: ApiRuntimeConfig): void {
  localStorage.setItem(API_RUNTIME_CONFIG_KEY, JSON.stringify(config));
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
    const raw = localStorage.getItem(IMAGE_API_CONFIG_KEY);
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
  localStorage.setItem(IMAGE_API_CONFIG_KEY, JSON.stringify(config));
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

function normalizeChaptersForLocal<T extends { createdAt?: unknown }>(chapters: T[]): T[] {
  return chapters.map((chapter) => ({
    ...chapter,
    createdAt: normalizeDateValue(chapter.createdAt),
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
    const raw = localStorage.getItem(GEMINI_RESPONSE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { text: string; ts: number }>) : {};
    return parsed || {};
  } catch {
    return {};
  }
}

function writeGeminiCache(cache: Record<string, { text: string; ts: number }>): void {
  localStorage.setItem(GEMINI_RESPONSE_CACHE_KEY, JSON.stringify(cache));
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

const CHAPTER_HEADING_PATTERNS: RegExp[] = [
  /^(?:#{1,6}\s*)?第\s*[0-9０-９一二三四五六七八九十百千万兩两零〇IVXLCDMivxlcdm]+\s*[章节回卷部集篇](?:\s*(?:[:：\-—.．、]\s*|\s+).*)?$/,
  /^(?:#{1,6}\s*)?(?:chương|chuong)\s*[0-9ivxlcdm]+(?:\s*[:：\-—.．、]\s*.*)?$/i,
  /^(?:#{1,6}\s*)?chapter\s*[0-9ivxlcdm]+(?:\s*[:：\-—.．、]\s*.*)?$/i,
  /^(?:#{1,6}\s*)?(?:quyển|quyen|volume|vol\.)\s*[0-9ivxlcdm]+(?:\s*[:：\-—.．、]\s*.*)?$/i,
];

function cleanChapterHeading(rawLine: string): string {
  return String(rawLine || '')
    .replace(/^#+\s*/, '')
    .replace(/^[\[\(【「『]\s*/, '')
    .replace(/\s*[\]\)】」』]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isChapterHeadingLine(line: string): boolean {
  const cleaned = cleanChapterHeading(line);
  if (!cleaned || cleaned.length > 140) return false;
  return CHAPTER_HEADING_PATTERNS.some((pattern) => pattern.test(cleaned));
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
  const markers: Array<{ index: number; title: string }> = [];

  lines.forEach((line, index) => {
    if (!isChapterHeadingLine(line)) return;
    const title = cleanChapterHeading(line);
    if (!title) return;
    const prev = markers[markers.length - 1];
    if (prev && index - prev.index <= 1 && prev.title.toLowerCase() === title.toLowerCase()) return;
    markers.push({ index, title });
  });

  if (!markers.length) return [];

  const sections: DetectedChapterSection[] = [];
  if (markers[0].index > 0) {
    const intro = lines.slice(0, markers[0].index).join('\n').trim();
    if (intro.length >= 180) {
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

  const meaningfulSections = sections.filter((section) => section.content.length >= 80).length;
  if (markers.length >= 2 && meaningfulSections < Math.max(1, Math.floor(markers.length * 0.5))) {
    return [];
  }

  return sections;
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
  const inheritedPrompt = String(existingPrompt || '').trim();
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

function getRaphaelApiKey(): string {
  const config = getImageApiConfig();
  if (!config.enabled || config.provider !== 'evolink') return '';
  return config.providers.evolink.apiKey || getDefaultImageProviderApiKey('evolink');
}

function getRaphaelModel(): string {
  return getImageApiConfig().providers.evolink.model || readRaphaelEnv('VITE_RAPHAEL_MODEL') || DEFAULT_RAPHAEL_MODEL;
}

function getRaphaelSize(): string {
  return getImageApiConfig().size || readRaphaelEnv('VITE_RAPHAEL_SIZE') || DEFAULT_RAPHAEL_SIZE;
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

async function generateRaphaelCoverImage(prompt: string): Promise<string> {
  const apiKey = getRaphaelApiKey();
  if (!apiKey) return '';

  const createResponse = await fetchWithTimeout(`${RAPHAEL_API_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getRaphaelModel(),
      prompt,
      size: getRaphaelSize(),
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
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
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

function readMainAiUsage(): { requests: number; estTokens: number } {
  try {
    const raw = localStorage.getItem(MAIN_AI_USAGE_KEY);
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
  localStorage.setItem(MAIN_AI_USAGE_KEY, JSON.stringify(next));
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

const buildDefaultGenConfig = (kind: 'fast' | 'quality', config?: Record<string, unknown>) => {
  const base = kind === 'fast'
    ? { temperature: 0.55, topP: 0.92, maxOutputTokens: 1800 }
    : { temperature: 0.65, topP: 0.95, maxOutputTokens: 4200 };
  return { ...base, ...(config || {}) };
};

function splitGenConfig(config?: Record<string, unknown>): {
  providerConfig: Record<string, unknown>;
  maxRetries: number;
  minOutputChars: number;
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

  delete raw.maxRetries;
  delete raw.minOutputChars;
  delete raw.signal;

  return {
    providerConfig: raw,
    maxRetries: maxRetries ?? 1,
    minOutputChars: minOutputChars ?? 0,
    signal,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new Error('AI operation cancelled by user.');
}

function extractTextFromModelPayload(payload: any): string {
  if (!payload) return '';
  const direct = [
    payload?.text,
    payload?.output,
    payload?.result,
    payload?.data?.text,
    payload?.response?.text,
  ]
    .map((item) => String(item || '').trim())
    .find(Boolean);
  if (direct) return direct;

  const candidates = payload?.candidates || payload?.data?.candidates || payload?.response?.candidates;
  if (Array.isArray(candidates)) {
    const combined = candidates
      .map((candidate: any) => {
        const partText = Array.isArray(candidate?.content?.parts)
          ? candidate.content.parts.map((p: any) => String(p?.text || '').trim()).filter(Boolean).join('')
          : '';
        return (
          partText ||
          String(candidate?.content?.text || candidate?.text || candidate?.output || candidate?.output_text || '').trim()
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err || '');
  }
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

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = window.setTimeout(abort, timeoutMs);
  outerSignal?.addEventListener('abort', abort, { once: true });
  try {
    throwIfAborted(outerSignal);
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp;
  } finally {
    window.clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
};

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
  const runtime = getApiRuntimeConfig();
  const initialModel = auth.model || getProfileModel(kind, auth.provider);
  const modelCandidates = auth.provider === 'gemini' || auth.provider === 'gcli'
    ? getGeminiFallbackModels(initialModel, kind)
    : [initialModel];
  const splitConfig = splitGenConfig(config);
  const initialConfig = buildDefaultGenConfig(kind, splitConfig.providerConfig);
  const reqFingerprint = quickHash(
    JSON.stringify({
      provider: auth.provider,
      model: initialModel,
      contents,
      config: initialConfig,
      maxRetries: splitConfig.maxRetries,
      minOutputChars: splitConfig.minOutputChars,
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
    let promptForAttempt = contents;
    const expectedMinChars = calculateAdaptiveMinOutputChars(contents, kind, splitConfig.minOutputChars);
    let currentModelIndex = 0;
    let currentModel = modelCandidates[currentModelIndex] || initialModel;
    const extraRecoveryRetries = (auth.provider === 'gemini' || auth.provider === 'gcli') ? 2 : 1;
    const maxAttempts = splitConfig.maxRetries + Math.max(0, modelCandidates.length - 1) + extraRecoveryRetries;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(splitConfig.signal);
      const timeoutMs = calculateAdaptiveTimeoutMs(
        kind,
        Number(attemptConfig.maxOutputTokens || 0) || (kind === 'fast' ? 1800 : 4200),
      );
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
        } else if (auth.provider === 'gemini' && auth.isApiKey && auth.client) {
          const response = await auth.client.models.generateContent({
            model: currentModel,
            contents: promptForAttempt,
            config: attemptConfig,
          });
          throwIfAborted(splitConfig.signal);
          text = response.text || extractTextFromModelPayload(response as any) || '';
        } else if (auth.provider === 'gemini' || auth.provider === 'gcli') {
          const geminiBase = auth.baseUrl || getProviderBaseUrl('gcli');
          const geminiEndpoint = geminiBase.includes('/models/')
            ? geminiBase
            : `${geminiBase.replace(/\/+$/, '')}/models/${currentModel}:generateContent`;
          const resp = await fetchWithTimeout(geminiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.apiKey}`,
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
            throw new Error(`${auth.provider === 'gcli' ? 'GCLI' : 'Gemini'} (Bearer) error ${resp.status}: ${body.slice(0, 200)}`);
          }
          const data = await resp.json();
          text = extractTextFromModelPayload(data) || '';
        } else if (
          auth.provider === 'openai' ||
          auth.provider === 'custom' ||
          auth.provider === 'xai' ||
          auth.provider === 'groq' ||
          auth.provider === 'deepseek' ||
          auth.provider === 'openrouter' ||
          auth.provider === 'mistral'
        ) {
          const openAiBase = auth.baseUrl || getProviderBaseUrl(auth.provider);
          const completionEndpoint = /\/chat\/completions$/i.test(openAiBase)
            ? openAiBase
            : `${openAiBase.replace(/\/+$/, '')}/chat/completions`;
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (auth.apiKey.trim()) {
            headers.Authorization = `Bearer ${auth.apiKey}`;
          }
          if (auth.provider === 'openrouter') {
            headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://truyenforge.local';
            headers['X-Title'] = 'TruyenForge';
          }
          const wantsJson = String(attemptConfig.responseMimeType || '').toLowerCase().includes('json');
          const bodyPayload: Record<string, unknown> = {
            model: currentModel,
            messages: [{ role: 'user', content: promptForAttempt }],
            temperature: typeof attemptConfig.temperature === 'number' ? attemptConfig.temperature : 0.7,
            max_tokens: typeof attemptConfig.maxOutputTokens === 'number' ? attemptConfig.maxOutputTokens : undefined,
          };
          if (auth.provider === 'openai' && wantsJson) {
            bodyPayload.response_format = { type: 'json_object' };
          }
          const resp = await fetchWithTimeout(completionEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyPayload),
          }, timeoutMs, splitConfig.signal);
          if (!resp.ok) {
            const body = await resp.text();
            const providerLabel = auth.provider === 'custom'
              ? 'Custom endpoint'
              : (PROVIDER_LABELS[auth.provider] || 'OpenAI-compatible provider');
            throw new Error(`${providerLabel} error ${resp.status}: ${body.slice(0, 220)}`);
          }
          const data = await resp.json();
          text = data?.choices?.[0]?.message?.content || extractTextFromModelPayload(data) || '';
        } else if (auth.provider === 'anthropic') {
          const resp = await fetchWithTimeout(`${auth.baseUrl || getProviderBaseUrl('anthropic')}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': auth.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: currentModel,
              max_tokens: typeof attemptConfig.maxOutputTokens === 'number' ? attemptConfig.maxOutputTokens : 4096,
              temperature: typeof attemptConfig.temperature === 'number' ? attemptConfig.temperature : 0.7,
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
        const isQuotaError = isQuotaOrRateLimitError(err);
        const isTransientError = isTransientAiServiceError(err);
        if (isQuotaError || isTransientError) {
          const retryDelayMs = extractRetryDelayMs(err);
          if (currentModelIndex < modelCandidates.length - 1) {
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
            throw new Error(`Model ${currentModel} đang quá tải (high demand/503). Hãy thử lại sau 1-2 phút hoặc đổi model.`);
          }
        }
        throw err;
      }

      text = String(text || '').trim();
      const wantsJson = String(attemptConfig.responseMimeType || '').toLowerCase().includes('json');
      const parsedAny = wantsJson ? tryParseJson<any>(text, 'any') : null;
      const jsonOk = !wantsJson || Boolean(parsedAny);
      const isExplicitEmpty =
        wantsJson &&
        ((Array.isArray(parsedAny) && parsedAny.length === 0) ||
          (parsedAny &&
            typeof parsedAny === 'object' &&
            Array.isArray((parsedAny as any).issues) &&
            (parsedAny as any).issues.length === 0));
      const longEnough = isExplicitEmpty || expectedMinChars <= 0 || text.length >= expectedMinChars;
      if ((jsonOk && longEnough) || attempt >= maxAttempts) {
        break;
      }

      const currentMax = Number(attemptConfig.maxOutputTokens || 0) || (kind === 'fast' ? 1800 : 4200);
      attemptConfig = {
        ...attemptConfig,
        maxOutputTokens: Math.min(16384, Math.round(currentMax * 1.8)),
      };
      promptForAttempt = `${contents}\n\nYÊU CẦU BỔ SUNG BẮT BUỘC: phản hồi trước quá ngắn hoặc chưa đúng định dạng. Hãy trả lại đầy đủ, chi tiết hơn và tuân thủ đúng format đã yêu cầu.`;
    }

    bumpMainAiUsage(contents, text);

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
    return await task;
  } finally {
    inFlightAiRequests.delete(cacheKey);
  }
}

function getConfiguredGeminiApiKey(): string {
  try {
    const runtime = getApiRuntimeConfig();
    if (runtime.mode === 'relay') {
      const relayToken = localStorage.getItem(RELAY_TOKEN_CACHE_KEY)?.trim() || runtime.relayToken?.trim() || '';
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
  return getDefaultModelForProvider(provider, runtime.aiProfile);
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
  if (!apiKey && !(provider === 'custom' && (activeEntry?.baseUrl || runtime.selectedModel))) {
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
  createdAt: any;
  updatedAt: any;
}

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
  const extractJson = (raw: string) => {
    return tryParseJson<any>(raw, 'object') || tryParseJson<any>(normalizeJsonLikeText(raw), 'object');
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
        ? parsed.variants.map((item: any, idx: number) => ({
          label: String(item?.label || `Gợi ý ${idx + 1}`),
          text: String(item?.text || ''),
        })).filter((item: { text: string }) => item.text.trim())
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
        characters: Array.isArray(parsed?.characters) ? parsed.characters.map((c: any) => ({
          name: String(c?.name || '').trim(),
          description: String(c?.description || '').trim(),
        })).filter((c: { name: string }) => c.name) : [],
        locations: Array.isArray(parsed?.locations) ? parsed.locations.map((c: any) => ({
          name: String(c?.name || '').trim(),
          description: String(c?.description || '').trim(),
        })).filter((c: { name: string }) => c.name) : [],
        items: Array.isArray(parsed?.items) ? parsed.items.map((c: any) => ({
          name: String(c?.name || '').trim(),
          description: String(c?.description || '').trim(),
        })).filter((c: { name: string }) => c.name) : [],
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
  const [imageAiEnabled, setImageAiEnabled] = useState(false);
  const [imageAiApiKey, setImageAiApiKey] = useState('');
  const [imageAiProvider, setImageAiProvider] = useState<ImageAiProvider>('evolink');
  const [imageAiModel, setImageAiModel] = useState(getDefaultImageAiModel('evolink'));
  const relaySocketRef = useRef<WebSocket | null>(null);
  const relayPingRef = useRef<number | null>(null);
  const relayReconnectRef = useRef<number | null>(null);
  const relayShouldReconnectRef = useRef(false);
  const relayRequestReadyRef = useRef(false);

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
      const rawRuntime = localStorage.getItem(API_RUNTIME_CONFIG_KEY);
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
    const imageApi = getImageApiConfig();
    setImageAiEnabled(imageApi.enabled);
    setImageAiProvider(imageApi.provider);
    setImageAiModel(imageApi.providers[imageApi.provider]?.model || getDefaultImageAiModel(imageApi.provider));
    setImageAiApiKey(imageApi.providers[imageApi.provider]?.apiKey || '');
    const token = (localStorage.getItem(RELAY_TOKEN_CACHE_KEY) || runtime.relayToken || '').trim();
    setRelayMaskedToken(token ? maskSensitive(token) : 'Chưa nhận token');
    setAiUsageStats(readMainAiUsage());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAiUsageStats(readMainAiUsage());
    }, 1500);
    return () => window.clearInterval(timer);
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

  const persistRuntimeConfig = (next: Partial<ApiRuntimeConfig>) => {
    const current = getApiRuntimeConfig();
    const merged: ApiRuntimeConfig = {
      ...current,
      ...next,
    };
    saveApiRuntimeConfig(merged);
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
    if (!raw) return;
    const detected = detectApiProviderFromValue(raw);
    const provider = detected === 'gemini' || detected === 'gcli' || detected === 'anthropic' || detected === 'groq' || detected === 'openrouter'
      ? detected
      : apiEntryProvider;
    const key = provider === 'gcli' ? (extractGcliTokenFromText(raw) || raw.replace(/^Bearer\s+/i, '').trim()) : raw;
    const model = (provider === 'custom' ? apiEntryModel.trim() : apiEntryModel) || getDefaultModelForProvider(provider, aiProfile);
    const baseUrl = apiEntryBaseUrl.trim() || getProviderBaseUrl(provider);
    const existingMatch = apiVault.find((item) => (
      provider === 'custom'
        ? item.provider === 'custom' && item.baseUrl.trim() === baseUrl
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
          localStorage.setItem(RELAY_TOKEN_CACHE_KEY, token);
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
    localStorage.setItem(RELAY_TOKEN_CACHE_KEY, token);
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
      setAiUsageStats(readMainAiUsage());
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
    setAiUsageStats({ requests: 0, estTokens: 0 });
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
        const text = await file.text();
        const data = JSON.parse(text);
        if (window.confirm(`Bạn có muốn nhập ${data.stories?.length || 0} truyện và ${data.characters?.length || 0} nhân vật?`)) {
          const existingStories = storage.getStories();
          const usedSlugs = new Set(existingStories.map((item) => resolveStorySlug(item)));
          const newStories: Story[] = [];
          for (const story of (data.stories || [])) {
            const { id, ...rest } = story;
            newStories.push({
              ...rest,
              id: createClientId('story'),
              slug: createStoryRouteSlug(usedSlugs),
              authorId: user.uid,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              chapters: normalizeChaptersForLocal(Array.isArray(rest.chapters) ? rest.chapters : []),
            } as Story);
          }
          if (newStories.length > 0) {
            storage.saveStories([...newStories, ...existingStories]);
            bumpStoriesVersion();
          }

          const newChars: Character[] = [];
          for (const char of (data.characters || [])) {
            const { id, ...rest } = char;
            newChars.push({
              ...rest,
              id: createClientId('char'),
              authorId: user.uid,
              createdAt: new Date().toISOString(),
            } as Character);
          }
          if (newChars.length > 0) {
            const chars = storage.getCharacters();
            storage.saveCharacters([...newChars, ...chars]);
          }
          notifyApp({ tone: 'success', message: "Nhập dữ liệu thành công!" });
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
        const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
        storage.saveStories([{
          id: createClientId('story'),
          slug: createStoryRouteSlug(usedSlugs),
          authorId: user.uid,
          title: String(file.name).replace(/\.docx$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chapters: []
        }, ...stories]);
        bumpStoriesVersion();
        notifyApp({ tone: 'success', message: "Nhập file .docx thành công!" });
      } else if (fileName.endsWith('.txt')) {
        console.log("Xử lý file TXT...");
        const text = await file.text();
        if (!text.trim()) {
          throw new Error("File .txt không có nội dung.");
        }
        const stories = storage.getStories();
        const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
        storage.saveStories([{
          id: createClientId('story'),
          slug: createStoryRouteSlug(usedSlugs),
          authorId: user.uid,
          title: String(file.name).replace(/\.txt$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chapters: []
        }, ...stories]);
        bumpStoriesVersion();
        notifyApp({ tone: 'success', message: "Nhập file .txt thành công!" });
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
        />
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="max-w-5xl mx-auto pt-24 pb-12 px-6"
    >
      <ToolsPage onBack={onBack} onRequireAuth={onRequireAuth} />
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
      const typedPrompt = sanitizePromptForUrl(String(coverPrompt || '').trim());
      const basePrompt = sanitizePromptForUrl(buildCoverPrompt());
      let prompt = typedPrompt;
      let ai: AiAuth | null = null;

      try {
        ai = createGeminiClient('auxiliary');
      } catch {
        ai = null;
      }

      if (!prompt && ai) {
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
          prompt = sanitizePromptForUrl(generatedPrompt);
        } catch (error) {
          console.warn('Không tạo được prompt ảnh bìa bằng AI, chuyển sang prompt nội suy.', error);
        }
      }

      if (!prompt) {
        prompt = basePrompt;
      }
      if (!prompt) {
        notifyApp({ tone: 'warn', message: 'Không đủ dữ liệu để tạo ảnh bìa.' });
        return;
      }
      let imageUrl = '';

      try {
        imageUrl = await generateRaphaelCoverImage(prompt);
      } catch (error) {
        console.warn('Raphael image generation not available, fallback to existing cover services.', error);
      }

      // Try OpenAI image API next when user is configured with OpenAI/custom endpoint.
      try {
        if (!imageUrl && ai && (ai.provider === 'openai' || ai.provider === 'custom') && ai.apiKey.trim()) {
          const openAiBase = ai.baseUrl || getProviderBaseUrl(ai.provider === 'custom' ? 'custom' : 'openai');
          const imageEndpoint = /\/images\/generations$/i.test(openAiBase)
            ? openAiBase
            : `${openAiBase.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '')}/images/generations`;
          const model = /gpt-image|dall-e/i.test(ai.model) ? ai.model : 'gpt-image-1';
          const resp = await fetchWithTimeout(imageEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ai.apiKey}`,
            },
            body: JSON.stringify({
              model,
              prompt,
              size: '1024x1536',
            }),
          }, 18000);
          if (resp.ok) {
            const data = await resp.json();
            const url = String(data?.data?.[0]?.url || '').trim();
            const b64 = String(data?.data?.[0]?.b64_json || '').trim();
            if (url && await probeImageUrl(url, 9000)) {
              imageUrl = url;
            } else if (b64) {
              imageUrl = `data:image/png;base64,${b64}`;
            }
          }
        }
      } catch (error) {
        console.warn('OpenAI image generation not available, fallback to public image service.', error);
      }

      // Fallback to public AI image service.
      if (!imageUrl) {
        const seed = Math.floor(Math.random() * 1000000000);
        const promptVariants = Array.from(new Set([prompt, basePrompt].filter(Boolean))).slice(0, 2);
        const buildCandidates = (variant: string, offset: number) => {
          const encoded = encodeURIComponent(variant);
          return [
            `https://image.pollinations.ai/prompt/${encoded}?width=896&height=1344&seed=${seed + offset}&nologo=true&enhance=true&model=flux`,
            `https://image.pollinations.ai/prompt/${encoded}?width=896&height=1344&seed=${seed + offset}&nologo=true&enhance=true&model=turbo`,
          ];
        };

        for (let attempt = 0; attempt < 2 && !imageUrl; attempt += 1) {
          for (const variant of promptVariants) {
            const candidates = buildCandidates(variant, attempt * 97);
            imageUrl = await pickFirstReachableImageUrl(candidates, 6000, 2);
            if (imageUrl) break;
          }
          if (!imageUrl && attempt < 1) {
            await sleepMs(450);
          }
        }
      }

      if (!imageUrl) {
        const fallbackCover = buildFallbackCoverDataUrl(title, genre, prompt);
        setCoverImageUrl(fallbackCover);
        if (!coverPrompt.trim()) {
          setCoverPrompt(prompt);
        }
        notifyApp({ tone: 'warn', message: 'Dịch vụ ảnh AI đang bận nên hệ thống đã chuyển sang bìa dự phòng ngay để bạn không phải chờ lâu. Bạn có thể bấm tạo lại sau ít phút nếu muốn lấy bìa AI.', timeoutMs: 5200 });
        return;
      }
      setCoverImageUrl(imageUrl);
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
              <ReactMarkdown>{introduction || '*Chưa có giới thiệu*'}</ReactMarkdown>
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
  breadcrumbs,
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
  breadcrumbs?: BreadcrumbItem[],
}) => {
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [showDictionaryPopup, setShowDictionaryPopup] = useState(false);
  const displayGenre = parseStoryGenreAndPrompt(story.genre || '', story.storyPromptNotes || '').genreLabel || 'Chưa phân loại';

  const getRenderableChapterContent = (content: string) => {
    if (!content) return '';
    return normalizeAiJsonContent(content, '').content || content;
  };

  const getDisplayChapterTitle = (chapter: Chapter) => {
    const baseTitle = String(chapter.title || '').trim();
    const parsed = extractJsonContent(chapter.content || '');
    const parsedTitle = String(parsed?.title || '').trim();
    const isGenericTitle = /^chương\s*\d+$/i.test(baseTitle) || /^chapter\s*\d+$/i.test(baseTitle);
    if (parsedTitle && (!baseTitle || isGenericTitle)) {
      return parsedTitle;
    }
    return baseTitle || parsedTitle || `Chương ${chapter.order || ''}`.trim();
  };

  const formatContent = (content: string) => {
    const normalized = getRenderableChapterContent(content);
    if (!normalized) return '';
    return improveBracketSystemSpacing(normalized);
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
    if (!selectedChapter || !story.chapters) return;
    const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
    const currentIndex = sorted.findIndex(c => c.id === selectedChapter.id);
    if (currentIndex < sorted.length - 1) {
      const nextChapter = sorted[currentIndex + 1];
      setSelectedChapter(nextChapter);
      onReaderNavigateChapter?.(nextChapter.id, 'replace');
      window.scrollTo(0, 0);
    }
  };

  const handlePrevChapter = () => {
    if (!selectedChapter || !story.chapters) return;
    const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
    const currentIndex = sorted.findIndex(c => c.id === selectedChapter.id);
    if (currentIndex > 0) {
      const prevChapter = sorted[currentIndex - 1];
      setSelectedChapter(prevChapter);
      onReaderNavigateChapter?.(prevChapter.id, 'replace');
      window.scrollTo(0, 0);
    }
  };

  const handleOpenChapter = (chapter: Chapter) => {
    if (onOpenChapter) {
      onOpenChapter(chapter);
      return;
    }
    setSelectedChapter(chapter);
  };

  useEffect(() => {
    if (!forcedChapterId) {
      setSelectedChapter(null);
      return;
    }
    const nextChapter = (story.chapters || []).find((chapter) => chapter.id === forcedChapterId) || null;
    setSelectedChapter(nextChapter);
  }, [forcedChapterId, story.chapters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncHashState = () => setShowDictionaryPopup(window.location.hash === '#dictionary');
    syncHashState();
    window.addEventListener('hashchange', syncHashState);
    window.addEventListener('popstate', syncHashState);
    return () => {
      window.removeEventListener('hashchange', syncHashState);
      window.removeEventListener('popstate', syncHashState);
    };
  }, []);

  const openDictionaryPopup = () => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#dictionary') {
      setShowDictionaryPopup(true);
      return;
    }
    const url = `${window.location.pathname}${window.location.search}#dictionary`;
    window.history.pushState({ ...(window.history.state || {}), tfPopup: 'dictionary' }, '', url);
    setShowDictionaryPopup(true);
  };

  const closeDictionaryPopup = () => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#dictionary') {
      window.history.back();
      return;
    }
    setShowDictionaryPopup(false);
  };

  const persistUpdatedStory = (updatedStory: Story): void => {
    const stories = storage.getStories();
    const newList = stories.map((s: Story) => (s.id === story.id ? updatedStory : s));
    storage.saveStories(newList);
    bumpStoriesVersion();
    onUpdateStory(updatedStory);
  };

  const handleSaveChapterEdit = async () => {
    if (!selectedChapter || !story.chapters) return;
    
    const updatedChapters = story.chapters.map(c => 
      c.id === selectedChapter.id 
        ? { ...c, title: editTitle, content: editContent } 
        : c
    );

    const updatedStory = { ...story, chapters: updatedChapters, updatedAt: new Date().toISOString() };
    
    try {
      persistUpdatedStory(updatedStory);
      setSelectedChapter({ ...selectedChapter, title: editTitle, content: editContent });
      setIsEditingChapter(false);
    } catch (error) {
      console.error("Lỗi khi cập nhật chương:", error);
      notifyApp({ tone: 'error', message: "Không thể lưu thay đổi chương." });
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!story.chapters || !story.chapters.length) return;
    const target = story.chapters.find((item) => item.id === chapterId);
    if (!target) return;
    if (!window.confirm(`Xóa chương "${target.title || `Chương ${target.order}`}"?`)) return;

    try {
      const remaining = story.chapters
        .filter((item) => item.id !== chapterId)
        .sort((a, b) => a.order - b.order)
        .map((chapter, index) => ({
          ...chapter,
          order: index + 1,
        }));

      const updatedStory: Story = {
        ...story,
        chapters: normalizeChaptersForLocal(remaining),
        updatedAt: new Date().toISOString(),
      };
      persistUpdatedStory(updatedStory);

      const wasReadingDeletedChapter = selectedChapter?.id === chapterId;
      if (wasReadingDeletedChapter) {
        setSelectedChapter(null);
        onReaderBack?.();
      } else if (selectedChapter) {
        const refreshed = updatedStory.chapters?.find((item) => item.id === selectedChapter.id) || null;
        setSelectedChapter(refreshed);
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

  const totalWords = story.chapters?.reduce((acc, chap) => acc + getWordCount(chap.content), 0) || 0;

  if (selectedChapter) {
    const sortedChapters = [...(story.chapters || [])].sort((a, b) => a.order - b.order);
    const currentIndex = sortedChapters.findIndex(c => c.id === selectedChapter.id);
    const hasNext = currentIndex < sortedChapters.length - 1;
    const hasPrev = currentIndex > 0;

    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-[min(96vw,1680px)] mx-auto pt-24 pb-12 px-3 md:px-6"
      >
        {breadcrumbs?.length ? <BreadcrumbTrail items={breadcrumbs} /> : null}

        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => {
              if (onReaderBack) {
                onReaderBack();
                return;
              }
              setSelectedChapter(null);
            }}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-bold"
          >
            <ChevronLeft className="w-6 h-6" /> Quay lại mục lục
          </button>
          
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenReaderPrefs}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors text-sm font-bold"
              title="Cài đặt đọc"
            >
              <Settings className="w-4 h-4" /> Giao diện đọc
            </button>
            <button
              onClick={openDictionaryPopup}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-bold"
            >
              <BookOpen className="w-4 h-4" /> Tra nhanh
            </button>
            <button 
              onClick={() => {
                setEditTitle(getDisplayChapterTitle(selectedChapter));
                setEditContent(formatContent(selectedChapter.content));
                setIsEditingChapter(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-bold"
            >
              <Edit3 className="w-4 h-4" /> Chỉnh sửa chương
            </button>
            <button
              onClick={() => void handleDeleteChapter(selectedChapter.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm font-bold"
            >
              <Trash2 className="w-4 h-4" /> Xóa chương
            </button>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-indigo-600 uppercase tracking-widest">Chương {selectedChapter.order}</h2>
              <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {getWordCount(formatContent(selectedChapter.content))} từ</span>
                <span className="flex items-center gap-1"><Loader2 className="w-3 h-3" /> {formatDateTime(selectedChapter.createdAt)}</span>
              </div>
            </div>
            
              <h1 className="chapter-title text-4xl font-serif font-bold text-slate-900 mb-10">{getDisplayChapterTitle(selectedChapter)}</h1>
            
            <div
            className="reader-markdown markdown-body text-lg leading-relaxed text-slate-700"
            style={{
              fontSize: 'var(--tf-reader-font-size)',
              lineHeight: 'var(--tf-reader-line-height)',
              fontFamily: 'var(--tf-reader-font-family)',
              color: 'var(--tf-reader-text)',
            }}
          >
              <ReactMarkdown>{formatContent(selectedChapter.content)}</ReactMarkdown>
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

        {showDictionaryPopup ? (
          <div className="fixed inset-0 z-[215] bg-slate-950/45 backdrop-blur-sm p-4">
            <div className="mx-auto mt-20 max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-base font-bold text-slate-900">Tra từ điển nhanh</h4>
                <button
                  onClick={closeDictionaryPopup}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
              <p className="text-sm text-slate-600">
                Đây là popup mẫu dùng URL hash <code>#dictionary</code>. Bấm nút Back vật lý sẽ đóng popup trước, không thoát trang đọc.
              </p>
            </div>
          </div>
        ) : null}

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
      className="story-detail max-w-5xl mx-auto pt-24 pb-12 px-6"
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
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
                <h1 className="text-4xl font-serif font-bold text-slate-900 mb-6">{story.title}</h1>
                
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">Giới thiệu</h3>
                    <div className="markdown-body text-slate-600 leading-relaxed">
                      <ReactMarkdown>{formatContent(story.introduction || '*Chưa có giới thiệu*')}</ReactMarkdown>
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

          <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-serif font-bold text-slate-900 flex items-center gap-3">
                <List className="w-6 h-6 text-indigo-600" /> Mục lục
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {totalWords.toLocaleString()} chữ
              </span>
            </div>
            <div className="space-y-2">
              {story.chapters && story.chapters.length > 0 ? (
                [...story.chapters].sort((a, b) => a.order - b.order).map((chapter) => {
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
                            {getWordCount(formatContent(chapter.content || ''))} chữ
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
                    >
                      {chapterRowContent}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12">
                  <p className="text-slate-400 italic">Chưa có chương nào được viết.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 p-8 rounded-[32px] text-white">
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

const StoryList = ({ onView, refreshKey }: { onView: (story: Story) => void; refreshKey: number }) => {
  const { user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Pagination limits
  const [originalLimit, setOriginalLimit] = useState(PAGE_SIZE);
  const [translatedLimit, setTranslatedLimit] = useState(PAGE_SIZE);
  const [continuedLimit, setContinuedLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    const list = storage.getStories();
    setStories(list);
    setLoading(false);
  }, [refreshKey]);

  const handleDelete = async () => {
    if (!deleteId) return;
    const newList = stories.filter(s => s.id !== deleteId);
    setStories(newList);
    storage.saveStories(newList);
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
    stories: Story[], 
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
              {visibleStories.map((story) => (
                <motion.div 
                  key={story.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => onView(story)}
                  className="group relative bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-900/5 transition-all cursor-pointer flex flex-col min-h-[20rem]"
                >
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
                          alt={`Bìa truyện ${story.title}`}
                          className="w-full h-full object-cover object-center"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3
                        className="text-xl font-serif font-bold text-slate-900 mb-3"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {story.title}
                      </h3>
                      <p
                        className="text-slate-500 text-sm whitespace-pre-line"
                        style={{ display: '-webkit-box', WebkitLineClamp: story.coverImageUrl ? 4 : 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {story.introduction || 'Chưa có giới thiệu ngắn.'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>Cập nhật: {story.updatedAt?.toDate ? story.updatedAt.toDate().toLocaleDateString('vi-VN') : new Date(story.updatedAt).toLocaleDateString('vi-VN')}</span>
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {story.chapters?.length || 0} chương
                    </span>
                  </div>
                </motion.div>
              ))}
              
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
    <div className="fixed right-4 top-24 z-[260] flex w-[min(92vw,380px)] flex-col gap-3">
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
    useDictionary: boolean
  }) => void;
  fileName: string;
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

const TranslateStoryModal: React.FC<TranslateStoryModalProps> = ({ isOpen, onClose, onConfirm, fileName }) => {
  const [isAdult, setIsAdult] = useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [useDictionary, setUseDictionary] = useState(true);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);

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
          <div className="space-y-4">
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
            onClick={() => onConfirm({ isAdult, additionalInstructions, useDictionary })}
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
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
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
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
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
  const [showReaderPrefsModal, setShowReaderPrefsModal] = useState(false);
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(() => loadBackupSettings());
  const [backupSnapshots, setBackupSnapshots] = useState<BackupSnapshot[]>([]);
  const [backupHistoryReady, setBackupHistoryReady] = useState(false);
  const [backupBusyAction, setBackupBusyAction] = useState('');
  const [accountLastSyncedAt, setAccountLastSyncedAt] = useState('');
  const [driveAuth, setDriveAuth] = useState<GoogleDriveAuthState | null>(() => loadStoredDriveAuth());
  const [driveBinding, setDriveBinding] = useState<GoogleDriveBinding | null>(() => loadDriveBindingForUser(user?.uid));
  const [isUploadingProfileAvatar, setIsUploadingProfileAvatar] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportingStory, setIsExportingStory] = useState(false);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);
  const backupImportInputRef = useRef<HTMLInputElement>(null);
  const activeAiRunRef = useRef<ActiveAiRun | null>(null);
  const toastTimeoutsRef = useRef<Map<string, number>>(new Map());
  const workspaceSyncRef = useRef({
    isHydrating: false,
    lastSerialized: '',
    lastErrorNotifiedAt: 0,
    lastSyncedAt: '',
    lastServerUpdatedAt: '',
    lastKnownRevision: 0,
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

  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  const commitAccountSyncedAt = useCallback((syncedAt: string, force = false) => {
    workspaceSyncRef.current.lastSyncedAt = syncedAt;
    if (!force && !showBackupCenterModal) return;
    const now = Date.now();
    if (!force && now - syncUiTickRef.current < 5000) return;
    syncUiTickRef.current = now;
    setAccountLastSyncedAt(syncedAt);
  }, [showBackupCenterModal]);

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
        error: 'Phiên Google Drive đã hết hạn. Hãy kết nối lại để tiếp tục sao lưu tự động.',
      });
      await refreshBackupHistory();
      if (!options?.quiet) {
        notifyApp({
          tone: 'warn',
          message: 'Google Drive chưa sẵn sàng. Hãy kết nối lại để tiếp tục tự động sao lưu.',
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
    try {
      const report = storage.importData(payload);
      refreshWorkspaceUiFromStorage();
      return report;
    } finally {
      backupAutomationRef.current.isRestoring = false;
    }
  }, [refreshWorkspaceUiFromStorage]);

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
      const auth = await connectGoogleDriveInteractive();
      const authBinding = toDriveBinding(auth.account, boundDrive);
      if (boundDrive && authBinding.sub !== boundDrive.sub) {
        await disconnectGoogleDrive();
        setDriveAuth(null);
        notifyApp({
          tone: 'error',
          message: `Tài khoản này đã liên kết với Google Drive ${boundDrive.email}.`,
          detail: `Bạn vừa chọn ${auth.account.email}. Hãy đăng nhập lại đúng Gmail đã liên kết nếu muốn tiếp tục sao lưu.`,
          groupKey: 'backup-drive-binding-locked',
        });
        return;
      }

      await persistDriveBinding(authBinding);
      setDriveAuth(auth);
      notifyApp({
        tone: 'success',
        message: `Đã liên kết tài khoản này với Google Drive ${auth.account.email}.`,
        detail: 'Từ giờ app sẽ chỉ dùng đúng Gmail này để sao lưu dữ liệu của tài khoản hiện tại.',
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

  const handleDisconnectDrive = useCallback(async () => {
    setBackupBusyAction('disconnect-drive');
    try {
      await disconnectGoogleDrive();
      setDriveAuth(null);
      notifyApp({
        tone: 'info',
        message: 'Đã ngắt kết nối Google Drive trên trình duyệt này.',
        detail: driveBinding ? `Tài khoản TruyenForge vẫn đang liên kết với ${driveBinding.email}. Khi kết nối lại, bạn phải dùng đúng Gmail đó.` : 'Bạn có thể kết nối lại Google Drive sau.',
        groupKey: 'backup-drive-disconnect',
      });
    } catch (error) {
      notifyApp({
        tone: 'warn',
        message: 'Chưa thể ngắt kết nối Google Drive trọn vẹn, nhưng phiên cục bộ đã được xóa.',
        detail: error instanceof Error ? error.message : undefined,
        groupKey: 'backup-drive-disconnect-warn',
      });
      setDriveAuth(loadStoredDriveAuth());
    } finally {
      setBackupBusyAction('');
    }
  }, [driveBinding]);

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
      storeWorkspaceRecoverySnapshot(mergedSnapshot, 'manual-sync', user.uid);
      workspaceSyncRef.current.lastSerialized = JSON.stringify(mergedSnapshot);
      workspaceSyncRef.current.lastKnownRevision = mergedSnapshot.revision || workspaceSyncRef.current.lastKnownRevision;
      workspaceSyncRef.current.lastServerUpdatedAt = mergedSnapshot.updatedAt || '';
      const syncedAt = new Date().toISOString();
      commitAccountSyncedAt(syncedAt, true);
      setBackupSettings((prev) => ({ ...prev, lastManualSyncAt: syncedAt }));
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
  }, [commitAccountSyncedAt, createWorkspaceBackup, hasSupabase, refreshWorkspaceUiFromStorage, user]);

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

    backupAutomationRef.current.lastFingerprint = '';
    backupAutomationRef.current.startupSnapshotDone = false;
    backupAutomationRef.current.isRestoring = false;

    setBackupHistoryReady(false);
    setAccountLastSyncedAt('');
    refreshWorkspaceUiFromStorage();
  }, [refreshBackupHistory, refreshWorkspaceUiFromStorage, user?.uid]);

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
  const [showAIStoryModal, setShowAIStoryModal] = useState(false);
  const [showAIContinueModal, setShowAIContinueModal] = useState(false);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [showAiFileActionModal, setShowAiFileActionModal] = useState(false);
  const [translateFileContent, setTranslateFileContent] = useState('');
  const [translateFileName, setTranslateFileName] = useState('');
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

  useEffect(() => {
    const stories = storage.getStories();
    const normalized = normalizeStoriesWithSlug(stories);
    if (!normalized.changed) return;
    storage.saveStories(normalized.stories);
    bumpStoriesVersion();
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
    if (!hasSupabase || !supabase) {
      setAuthError('Supabase chưa được cấu hình, không thể gửi email reset.');
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
    const latestBackup = storage.getLatestStoriesBackup();
    if (!latestBackup.length) return;
    storage.saveStories(latestBackup);
    notifyApp({
      tone: 'warn',
      message: 'Đã tự khôi phục truyện từ backup cục bộ gần nhất trên máy này.',
      groupKey: 'local-story-backup-restore',
      timeoutMs: 5600,
    });
  }, [user?.uid]);

  const syncWorkspaceToAccount = useCallback(async () => {
    if (!ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    if (!user || !hasSupabase || workspaceSyncRef.current.isHydrating) return;
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

    storeWorkspaceRecoverySnapshot(savedSnapshot, 'account-sync-save', user.uid);
    workspaceSyncRef.current.lastSerialized = JSON.stringify(savedSnapshot);
    workspaceSyncRef.current.lastKnownRevision = savedSnapshot.revision || workspaceSyncRef.current.lastKnownRevision;
    workspaceSyncRef.current.lastServerUpdatedAt = savedSnapshot.updatedAt || '';
    commitAccountSyncedAt(new Date().toISOString());
  }, [commitAccountSyncedAt, user, hasSupabase]);

  useEffect(() => {
    if (!user || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) {
      workspaceSyncRef.current.lastSerialized = '';
      workspaceSyncRef.current.isHydrating = false;
      workspaceSyncRef.current.lastServerUpdatedAt = '';
      workspaceSyncRef.current.lastKnownRevision = 0;
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
          message: hasSupabase ? `Không thể đồng bộ dữ liệu lên Supabase (${SUPABASE_STORAGE_TABLES.workspaces}).` : 'Không thể đồng bộ dữ liệu cục bộ lên tài khoản ở thời điểm này.',
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

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !hasSupabase || !ACCOUNT_CLOUD_AUTOSYNC_ENABLED) return;
    let syncTimer: number | null = null;
    const handler = (event: Event) => {
      if (workspaceSyncRef.current.isHydrating) return;
      const detail = (event as CustomEvent<LocalWorkspaceMeta> | null)?.detail;
      const changedSection = typeof detail?.section === 'string'
        ? (detail.section as LocalWorkspaceSection)
        : null;
      if (!changedSection || !ACCOUNT_AUTOSYNC_TRIGGER_SECTIONS.has(changedSection)) {
        return;
      }
      if (syncTimer) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        void syncWorkspaceToAccount().catch((error) => {
          console.warn('Tự động lưu workspace lên tài khoản thất bại.', error);
          if (!shouldNotifyAccountSyncError(workspaceSyncRef.current.lastErrorNotifiedAt)) return;
          workspaceSyncRef.current.lastErrorNotifiedAt = Date.now();
          notifyApp({
            tone: 'warn',
            message: 'Tự động đồng bộ lên tài khoản bị lỗi, dữ liệu vẫn đang ở máy này.',
            detail: error instanceof Error ? error.message : undefined,
            groupKey: 'account-sync-autosave-failed',
            timeoutMs: 5200,
          });
        });
      }, ACCOUNT_CLOUD_AUTOSYNC_DEBOUNCE_MS);
    };
    window.addEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    return () => {
      if (syncTimer) window.clearTimeout(syncTimer);
      window.removeEventListener(LOCAL_WORKSPACE_CHANGED_EVENT, handler as EventListener);
    };
  }, [syncWorkspaceToAccount, user, hasSupabase]);

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
          ? `"Merriweather", "Times New Roman", Georgia, serif`
          : `"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    root.style.setProperty('--tf-reader-font-family', fontStack);
  }, []);

  useEffect(() => {
    applyReaderPrefsToDom(readerPrefs);
    saveReaderPrefs(readerPrefs);
  }, [applyReaderPrefsToDom, readerPrefs]);

  const handleTranslateStory = async (options: {
    isAdult: boolean,
    additionalInstructions: string,
    useDictionary: boolean
  }) => {
    if (!user || !translateFileContent) return;
    
    setShowTranslateModal(false);
    const aiRun = beginAiRun("Đang chuẩn bị dịch thuật...", {
      stageLabel: 'Khởi tạo dịch',
      detail: 'Đang đọc cấu hình, từ điển và chuẩn bị chia truyện thành các lô dịch ổn định hơn.',
    });
    const abortSignal = aiRun.controller.signal;

    try {
      const ai = createGeminiClient();
      const translateStartedAt = Date.now();
      
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

      const sourceWordCount = countWords(translateFileContent);
      const sourceCharCount = String(translateFileContent || '').length;
      const sourceTokenEstimate = estimateTextTokens(translateFileContent);
      const hugeFileMode = sourceWordCount >= 6500 || sourceCharCount >= 90000 || sourceTokenEstimate >= 22000;
      const extremeFileMode = sourceWordCount >= 11000 || sourceCharCount >= 160000 || sourceTokenEstimate >= 36000;
      const turboMode = hugeFileMode || sourceWordCount >= 3200 || sourceCharCount >= 45000 || sourceTokenEstimate >= 12000;
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
      const translationConcurrency = hugeFileMode ? 1 : (turboMode ? 2 : 1);
      const detectedSections = detectChapterSections(translateFileContent);
      const translationUnits = buildChapterTranslationUnits(translateFileContent, segmentCharLimit);
      const effectiveUnits = translationUnits.length
        ? translationUnits
        : [{
            title: 'Chương 1',
            source: String(translateFileContent || '').trim(),
            segments: splitLargeTextByParagraphs(String(translateFileContent || '').trim(), segmentCharLimit),
          }];
      const totalSegments =
        effectiveUnits.reduce((acc, unit) => acc + unit.segments.filter((segment) => segment.trim().length >= 30).length, 0) ||
        effectiveUnits.length;
      const lowQuotaMode = (ai.provider === 'gemini' || ai.provider === 'gcli') && totalSegments >= 14;
      const shouldRunAnalysis = !turboMode && !lowQuotaMode && !hugeFileMode && effectiveUnits.length <= 6 && sourceTokenEstimate <= 9000;
      const batchCharLimit =
        ai.provider === 'gemini' || ai.provider === 'gcli'
          ? (extremeFileMode ? 5200 : hugeFileMode ? 6800 : (turboMode ? 12000 : 9000))
          : (extremeFileMode ? 4200 : hugeFileMode ? 5600 : (turboMode ? 9000 : 7200));
      const batchItemLimit = extremeFileMode ? 1 : lowQuotaMode ? 1 : hugeFileMode ? 2 : (turboMode ? 3 : 2);
      const translationRequestRetries = lowQuotaMode && !hugeFileMode ? 0 : 1;
      const sharedSafetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ];
      const preparationLabel = shouldRunAnalysis ? 'Đang phân tích nội dung gốc...' : 'Đang chuẩn bị dịch theo lô...';

      const translationPreparationMessage = detectedSections.length >= 2 && turboMode && lowQuotaMode
        ? `Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ tiết kiệm quota + dịch nhanh.`
        : detectedSections.length >= 2 && turboMode
          ? `Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ dịch nhanh.`
          : detectedSections.length >= 2
            ? `Đã nhận diện ${effectiveUnits.length} chương và giữ nguyên cấu trúc chương.`
            : turboMode
              ? 'File lớn nên hệ thống sẽ tự chia đoạn và ưu tiên tốc độ.'
              : 'Chưa thấy mốc chương rõ ràng, hệ thống sẽ tự chia đoạn để dịch ổn định hơn.';
      const translationProfileNote = extremeFileMode
        ? 'Đang dùng chế độ an toàn cao cho file rất lớn: giảm kích thước lô, dịch tuần tự và hạn chế prompt phình to.'
        : hugeFileMode
          ? 'Đang dùng chế độ an toàn cho file lớn: giảm concurrency và chia lô nhỏ hơn để hạn chế lỗi trả về.'
          : '';
      updateAiRun(aiRun, {
        message: 'Đang phân tích cấu trúc truyện...',
        stageLabel: 'Phân tích cấu trúc',
        detail: `${translationPreparationMessage} ${preparationLabel}${translationProfileNote ? ` ${translationProfileNote}` : ''}`,
        progress: { completed: 0, total: Math.max(totalSegments, 1) },
      });

      // 1. Analyze the story for metadata (skip on low quota mode)
      let analysis = {
        summary: `Bản dịch tự động từ file "${String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "")}".`,
        genre: 'Dịch thuật',
        characters: [] as any[],
      };
      if (shouldRunAnalysis) {
        const analysisExcerpt = buildAnalysisExcerpt(translateFileContent, effectiveUnits);
        const analysisPrompt = `
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
        `;

        const analysisTextRaw = await generateGeminiText(
          ai,
          analysisKind,
          analysisPrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: turboMode ? 1500 : 2600,
            minOutputChars: turboMode ? 120 : 200,
            maxRetries: 1,
            signal: abortSignal,
          },
        );

        const analysisParsed = tryParseJson<any>(analysisTextRaw || '', 'object');
        analysis = {
          summary: String(analysisParsed?.summary || '').trim() || stripJsonFence(analysisTextRaw || '').trim(),
          genre: String(analysisParsed?.genre || '').trim() || 'Dịch thuật',
          characters: Array.isArray(analysisParsed?.characters) ? analysisParsed.characters : [],
        };
      }
      
      const storyId = createClientId('story');

      // 3. Split content into chapters/chunks and translate
      const maxTranslateChunks = effectiveUnits.length;
      let processedSegments = 0;

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
      }): Promise<{ title: string; content: string }> => {
        const scopedDictionaryContext = buildScopedDictionaryContext(params.segmentText, dictionaryEntries, 18);
        const translatePrompt = `
            Bạn là một dịch giả văn học cao cấp, chuyên dịch truyện từ tiếng Trung sang tiếng Việt.
            Hãy dịch toàn bộ đoạn sau sang tiếng Việt mượt mà, tự nhiên, giữ đúng nghĩa, đúng xưng hô và đúng sắc thái bản gốc.
            ĐÂY LÀ PHẦN ${params.segmentPosition}/${params.totalSegmentsInUnit} CỦA "${params.unitTitle}".
            KHÔNG được tóm tắt, KHÔNG bỏ đoạn, KHÔNG rút gọn.
            
            ${adultContentInstruction}
            ${scopedDictionaryContext}
            YÊU CẦU BỔ SUNG: ${options.additionalInstructions}
            ${params.previousTranslatedTail ? `NGỮ CẢNH NGAY TRƯỚC (để giữ xưng hô, nhịp văn và continuity):\n${params.previousTranslatedTail}` : ''}
            
            NỘI DUNG CẦN DỊCH:
            ${params.segmentText}
            
            Trả về JSON (không bọc bằng dấu 3 backtick):
            {
              ${params.includeTitleField ? '"title": "Tiêu đề chương (dịch sang tiếng Việt)",' : '"title": "",'}
              "content": "Nội dung phần đã dịch (Markdown)"
            }
          `;

        const dynamicMaxTokens = turboMode
          ? Math.min(12288, Math.max(2600, Math.round(params.segmentText.length * 1.18)))
          : Math.min(16384, Math.max(3400, Math.round(params.segmentText.length * 1.55)));
        const dynamicMinChars = turboMode
          ? Math.max(160, Math.round(params.segmentText.length * 0.14))
          : Math.max(240, Math.round(params.segmentText.length * 0.2));
        const translateTextRaw = await generateGeminiText(
          ai,
          translationKind,
          translatePrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: dynamicMaxTokens,
            minOutputChars: dynamicMinChars,
            maxRetries: translationRequestRetries,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
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
          const retryPrompt = `${translatePrompt}\n\nYÊU CẦU BẮT BUỘC: Bản dịch trước quá ngắn. Hãy dịch đầy đủ toàn bộ đoạn nguồn, không tóm tắt, không rút gọn.`;
          const retryRaw = await generateGeminiText(ai, turboMode ? 'quality' : translationKind, retryPrompt, {
            responseMimeType: "application/json",
            maxOutputTokens: Math.min(16384, Math.round(dynamicMaxTokens * 1.25)),
            minOutputChars: Math.round(dynamicMinChars * 1.08),
            maxRetries: 1,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
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
      }): Promise<{ title: string; segments: string[] }> => {
        const scopedDictionaryContext = buildScopedDictionaryContext(params.batch.sourceText, dictionaryEntries, 24);
        const includeTitleField = params.batchIndex === 0;
        const translatePrompt = `
            Bạn là một dịch giả văn học cao cấp, chuyên dịch truyện từ tiếng Trung sang tiếng Việt.
            Hãy dịch đồng thời ${params.batch.entries.length} đoạn sau sang tiếng Việt mượt mà, thuần Việt, đúng nghĩa và đúng không khí bản gốc.
            ĐÂY LÀ LÔ ${params.batchIndex + 1}/${params.totalBatches} CỦA "${params.unitTitle}".
            KHÔNG được tóm tắt, KHÔNG bỏ đoạn, KHÔNG gộp các đoạn với nhau.

            ${adultContentInstruction}
            ${scopedDictionaryContext}
            YÊU CẦU BỔ SUNG: ${options.additionalInstructions}
            ${params.previousTranslatedTail ? `NGỮ CẢNH NGAY TRƯỚC (để giữ xưng hô, nhịp văn và continuity):\n${params.previousTranslatedTail}` : ''}

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
          `;

        const sourceLength = params.batch.sourceText.length;
        const dynamicMaxTokens = turboMode
          ? Math.min(14336, Math.max(3600, Math.round(sourceLength * 1.08)))
          : Math.min(16384, Math.max(4600, Math.round(sourceLength * 1.35)));
        const dynamicMinChars = Math.max(
          180 * params.batch.entries.length,
          Math.round(sourceLength * (turboMode ? 0.13 : 0.19)),
        );

        const batchRaw = await generateGeminiText(
          ai,
          translationKind,
          translatePrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: dynamicMaxTokens,
            minOutputChars: dynamicMinChars,
            maxRetries: translationRequestRetries,
            safetySettings: sharedSafetySettings,
            signal: abortSignal,
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

      const chapterResults = await mapWithConcurrency(effectiveUnits, translationConcurrency, async (unit, chapterIndex) => {
        const sourceSegments = unit.segments.length ? unit.segments : [unit.source];
        const meaningfulEntries = sourceSegments
          .map((segment, index) => ({ index, text: String(segment || '').trim() }))
          .filter((entry) => entry.text.length >= 30);
        if (!meaningfulEntries.length) return null;
        const translatedSegments: string[] = [];
        let translatedTitle = String(unit.title || `Chương ${chapterIndex + 1}`).trim() || `Chương ${chapterIndex + 1}`;
        let previousTranslatedTail = '';
        const batches = buildTranslationSegmentBatches(meaningfulEntries, batchCharLimit, batchItemLimit);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          throwIfAborted(abortSignal);
          updateAiRun(aiRun, {
            message: 'Đang dịch truyện...',
            stageLabel: `Dịch chương ${chapterIndex + 1}/${maxTranslateChunks}`,
            detail: `Lô ${batchIndex + 1}/${batches.length} với ${batch.entries.length} đoạn${turboMode ? ' · Turbo' : ''}${lowQuotaMode ? ' · Quota-safe' : ''}.`,
            progress: {
              completed: Math.min(processedSegments + batch.entries.length, totalSegments),
              total: Math.max(totalSegments, 1),
            },
          });
          const batchResult = await translateStoryBatch({
            unitTitle: unit.title || translatedTitle,
            fallbackTitle: translatedTitle || `Chương ${chapterIndex + 1}`,
            batch,
            batchIndex,
            totalBatches: batches.length,
            totalSegmentsInUnit: meaningfulEntries.length,
            previousTranslatedTail,
          });
          processedSegments += batch.entries.length;

          const parsedTitle = String(batchResult.title || '').trim();
          if (parsedTitle && (batchIndex === 0 || /^chương\s*\d+$/i.test(translatedTitle))) {
            translatedTitle = parsedTitle;
          }

          batchResult.segments.forEach((content) => {
            if (!content.trim()) return;
            translatedSegments.push(content.trim());
            previousTranslatedTail = extractTranslationContextTail(content, turboMode ? 680 : 920);
          });
        }

        const mergedChapterContent = translatedSegments.join('\n\n').trim();
        if (!mergedChapterContent) return null;

        return {
          id: createClientId('chapter'),
          title: translatedTitle,
          content: mergedChapterContent,
          order: chapterIndex + 1,
          createdAt: new Date().toISOString(),
        } as Chapter;
      });
      const translatedChapters = chapterResults.filter((chapter): chapter is Chapter => Boolean(chapter));

      if (!translatedChapters.length) {
        throw new Error('Không thể nhận diện nội dung hợp lệ để dịch. Vui lòng kiểm tra lại file nguồn.');
      }

      // Save to local storage so it shows up in the UI
      const localChapters = normalizeChaptersForLocal(translatedChapters);
      const stories = storage.getStories();
      const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
      const newStory = {
        id: storyId,
        slug: createStoryRouteSlug(usedSlugs),
        authorId: user.uid,
        title: String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Bản dịch)",
        content: String(translateFileContent || "").substring(0, 5000) + "...",
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: String(analysis.genre || "Dịch thuật").substring(0, 190),
        type: 'translated',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        translationMemory: storyTranslationMemory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chapters: localChapters
      };
      storage.saveStories([newStory, ...stories]);
      bumpStoriesVersion();

      const elapsedSeconds = Math.max(1, Math.round((Date.now() - translateStartedAt) / 1000));
      notifyApp({
        tone: 'success',
        message: `Đã dịch thành công ${translatedChapters.length} chương (${processedSegments} phân đoạn) trong ${elapsedSeconds}s${turboMode ? ' [Turbo]' : ''}.`,
        timeoutMs: 5200,
      });
      setView('stories');
    } catch (error) {
      console.error("Lỗi khi dịch truyện:", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (/cancelled by user/i.test(rawMessage)) {
        notifyApp({ tone: 'warn', message: 'Đã hủy quá trình dịch truyện.' });
      } else if (isQuotaOrRateLimitError(error)) {
        notifyApp({ tone: 'warn', message: `AI đang chạm quota/rate limit. ${rawMessage}` , timeoutMs: 5200});
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
      const continueWordCount = countWords(continueFileContent);
      const continueCharCount = String(continueFileContent || '').length;
      const continueTokenEstimate = estimateTextTokens(continueFileContent);
      const largeContinueMode = continueWordCount >= 4500 || continueCharCount >= 70000 || continueTokenEstimate >= 17000;
      const extremeContinueMode = continueWordCount >= 9000 || continueCharCount >= 140000 || continueTokenEstimate >= 32000;
      const analysisExcerpt = buildBalancedStoryExcerpt(
        continueFileContent,
        extremeContinueMode ? 11000 : largeContinueMode ? 14500 : 18000,
      );
      const recentStoryTail = String(continueFileContent || '')
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(-(extremeContinueMode ? 2600 : largeContinueMode ? 3800 : 5200));
      
      // 1. Analyze the story
      const analysisPrompt = `
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
      `;

      const analysisText = await generateGeminiText(
        ai,
        largeContinueMode ? 'fast' : 'quality',
        analysisPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: largeContinueMode ? 2400 : 3200,
          minOutputChars: 260,
          maxRetries: extremeContinueMode ? 1 : 2,
          signal: abortSignal,
        },
      ) || '{}';
      const analysisParsed = tryParseJson<any>(analysisText, 'object') || {};
      const analysis = {
        summary: String(analysisParsed.summary || '').trim() || String(analysisText || '').trim(),
        writingStyle: String(analysisParsed.writingStyle || '').trim(),
        characters: Array.isArray(analysisParsed.characters) ? analysisParsed.characters : [],
        currentContext: String(analysisParsed.currentContext || '').trim(),
      };
      updateAiRun(aiRun, {
        message: 'Đang lập kế hoạch các chương tiếp theo...',
        stageLabel: 'Lập kế hoạch',
        detail: `${largeContinueMode ? 'Đã phân tích theo chế độ file lớn, giữ cả phần đầu và diễn biến gần cuối. ' : ''}AI đang dựng roadmap cho các chương mới.`,
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
      const planPrompt = `
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
      `;

      const planText = await generateGeminiText(
        ai,
        largeContinueMode ? 'fast' : 'quality',
        planPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: Math.min(largeContinueMode ? 3600 : 5200, Math.max(1400, options.chapterCount * (largeContinueMode ? 520 : 700))),
          minOutputChars: Math.max(200, options.chapterCount * 70),
          maxRetries: extremeContinueMode ? 1 : 2,
          signal: abortSignal,
        },
      ) || '{}';
      const planParsed = tryParseJson<any>(planText, 'object');
      let plannedChapters = Array.isArray(planParsed?.chapters) ? planParsed.chapters : (Array.isArray(planParsed) ? planParsed : []);
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
      
      // 3. Create the story
      const storyId = createClientId('story');

      // 4. Generate chapters
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
        
        const chapterPrompt = `
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
        `;

        let chapterText = await generateGeminiText(
          ai,
          largeContinueMode ? 'fast' : 'quality',
          chapterPrompt,
          {
            maxOutputTokens: chapterMaxTokens,
            minOutputChars: minChapterChars,
            maxRetries: extremeContinueMode ? 1 : 2,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ],
            signal: abortSignal,
          },
        );

        if (countWords(chapterText || '') < Math.max(220, Math.round(minChapterWords * 0.55))) {
          chapterText = await generateGeminiText(
            ai,
            'quality',
            `${chapterPrompt}\n\nYÊU CẦU BẮT BUỘC: Bản trước quá ngắn. Hãy viết lại đầy đủ, chi tiết, đúng độ dài yêu cầu.`,
            {
              maxOutputTokens: Math.min(16384, Math.round(chapterMaxTokens * 1.35)),
              minOutputChars: Math.round(minChapterChars * 1.15),
              maxRetries: 1,
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
              signal: abortSignal,
            },
          );
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
      const stories = storage.getStories();
      const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
      const newStory = {
        id: storyId,
        slug: createStoryRouteSlug(usedSlugs),
        authorId: user.uid,
        title: String(continueFileName || "Truyện viết tiếp").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Viết tiếp)",
        content: String(continueFileContent || "").substring(0, 5000) + "...",
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: "Viết tiếp",
        type: 'continued',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chapters: localChapters
      };
      storage.saveStories([newStory, ...stories]);
      bumpStoriesVersion();

      notifyApp({ tone: 'success', message: `Đã viết tiếp thành công ${options.chapterCount} chương!`, timeoutMs: 5200 });
      setView('stories');
    } catch (error) {
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
    const looksLikeOutlineChapter = (title: string, content: string) => {
      const text = String(content || '').trim();
      if (!text) return true;
      const lower = text.toLowerCase();
      const outlineSignals = [
        'dàn ý',
        'ý tưởng',
        'gợi ý',
        'hướng phát triển',
        'plot twist',
        'mở bài',
        'thân bài',
        'kết bài',
      ];
      const hasOutlineSignal = outlineSignals.some((signal) => lower.includes(signal));
      const bulletCount = (text.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/g) || []).length;
      const dialogCount = (text.match(/[“"«»]/g) || []).length;
      const paragraphCount = text.split(/\n{2,}/).filter(Boolean).length;
      const shortBody = text.length < 1100;
      const sparseNarrative = paragraphCount <= 2 && dialogCount <= 1;
      const titleLooksPlanning = /(?:dàn ý|ý tưởng|kịch bản|phác thảo)/i.test(String(title || ''));
      return titleLooksPlanning || hasOutlineSignal || (bulletCount >= 3 && shortBody) || (shortBody && sparseNarrative);
    };
    setShowAIGen(false);
    const aiRun = beginAiRun("Đang chuẩn bị dữ liệu...", {
      stageLabel: 'Chuẩn bị đầu vào',
      detail: 'Đang gom outline, context, quy tắc và thông tin nhân vật trước khi gọi model viết chương.',
    });
    const abortSignal = aiRun.controller.signal;

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

      const chapterWordsTarget = Math.max(350, Number.parseInt(String(chapterLength || '1000'), 10) || 1000);
      const batchMinChars = Math.min(22000, Math.max(1200, Math.round(chapterCount * chapterWordsTarget * 1.5)));
      const generatedChapterBatchText = await generateGeminiText(
        ai,
        'quality',
        `Bạn là một nhà văn chuyên nghiệp, nổi tiếng với khả năng viết lách chi tiết, giàu hình ảnh và cảm xúc. 
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
        Nội dung nên được định dạng Markdown.`,
        {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          minOutputChars: batchMinChars,
          maxRetries: 2,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
          signal: abortSignal,
        },
      );

      const textResponse = generatedChapterBatchText || '[]';
      const parsed = tryParseJson<any>(textResponse, 'array');
      let newChaptersData: Array<{ title?: string; content?: string }> = [];
      if (Array.isArray(parsed)) {
        newChaptersData = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray((parsed as any).chapters)) newChaptersData = (parsed as any).chapters;
        if (Array.isArray((parsed as any).items) && !newChaptersData.length) newChaptersData = (parsed as any).items;
      }

      if (!newChaptersData.length) {
        newChaptersData = buildFallbackChapters(textResponse, chapterCount);
      }
      if (!newChaptersData.length) {
        throw new Error("AI không trả về nội dung hợp lệ để tạo chương.");
      }
      let chapterDrafts = sanitizeChapterDrafts(newChaptersData);
      const outlineLikeCount = chapterDrafts.filter((item) => looksLikeOutlineChapter(item.title, item.content)).length;
      if (chapterDrafts.length > 0 && outlineLikeCount >= Math.max(1, Math.ceil(chapterDrafts.length * 0.5))) {
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
        const rewritten = await generateGeminiText(
          ai,
          'quality',
          rewritePrompt,
          {
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            minOutputChars: batchMinChars,
            maxRetries: 1,
            signal: abortSignal,
          },
        );
        const rewrittenParsed = tryParseJson<any>(rewritten || '[]', 'array');
        let rewrittenItems: Array<{ title?: string; content?: string }> = [];
        if (Array.isArray(rewrittenParsed)) {
          rewrittenItems = rewrittenParsed;
        } else if (rewrittenParsed && typeof rewrittenParsed === 'object') {
          if (Array.isArray((rewrittenParsed as any).chapters)) rewrittenItems = (rewrittenParsed as any).chapters;
          if (Array.isArray((rewrittenParsed as any).items) && !rewrittenItems.length) rewrittenItems = (rewrittenParsed as any).items;
        }
        if (!rewrittenItems.length) {
          rewrittenItems = buildFallbackChapters(rewritten || '', chapterCount);
        }
        if (rewrittenItems.length) {
          chapterDrafts = sanitizeChapterDrafts(rewrittenItems);
        }
      }
      const unresolvedOutlineCount = chapterDrafts.filter((item) => looksLikeOutlineChapter(item.title, item.content)).length;
      if (chapterDrafts.length > 0 && unresolvedOutlineCount >= Math.max(1, Math.ceil(chapterDrafts.length * 0.5))) {
        throw new Error('AI vẫn đang trả kết quả dạng dàn ý. Hãy thử lại với model mạnh hơn hoặc giảm số chương mỗi lượt.');
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

      if (forbiddenPhrases.length) {
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

          const antiClicheRewriteRaw = await generateGeminiText(
            ai,
            'quality',
            antiClicheRewritePrompt,
            {
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              minOutputChars: Math.max(1200, Math.round(violatingPayload.length * 1200)),
              maxRetries: 1,
              signal: abortSignal,
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
      storage.saveStories(newList);
      bumpStoriesVersion();

      setSelectedStory(updatedStory);

      notifyApp({ tone: 'success', message: `Đã tạo thành công ${newChapters.length} chương mới!`, timeoutMs: 5200 });
    } catch (error) {
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
      const updatedStory: Story = {
        ...editingStory,
        ...data,
        slug: data.slug || editingStory.slug || resolveStorySlug(editingStory),
        chapters: normalizeChaptersForLocal((data.chapters || editingStory.chapters || []) as Chapter[]),
        updatedAt: new Date().toISOString(),
      };
      newList = stories.map(s => s.id === editingStory.id ? updatedStory : s);
    } else {
      const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));
      const newStorySlug = data.slug || createStoryRouteSlug(usedSlugs);
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
        slug: newStorySlug,
      };
      newList = [newStory, ...stories];
    }

    setEditingStory(null);
    setIsCreating(false);
    storage.saveStories(newList);
    bumpStoriesVersion();
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
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
          signal: abortSignal,
        },
      );

      const textResponse = aiStoryText || '';
      const parsed = tryParseJson<any>(textResponse, 'object');
      if (parsed && typeof parsed === 'object' && (parsed as any).error?.message) {
        throw new Error(`AI lỗi: ${(parsed as any).error.message}`);
      }
      let resolvedTitle = parsed && typeof parsed === 'object' ? String(parsed.title || '').trim() : '';
      let resolvedContent = parsed && typeof parsed === 'object' ? String(parsed.content || '').trim() : '';

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
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
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
        const storyId = createClientId('story');
        const stories = storage.getStories();
        const usedSlugs = new Set(stories.map((item) => resolveStorySlug(item)));

        // Save to local storage
        const newStory = {
          id: storyId,
          slug: createStoryRouteSlug(usedSlugs),
          authorId: user.uid,
          title: resolvedTitle.substring(0, 480),
          content: resolvedContent.replace(/\]\s*\[/g, ']\n\n[').substring(0, 1999900),
          genre: String(genre || 'Tự do').substring(0, 190),
          isAdult: Boolean(isAdult),
          isPublic: false,
          isAI: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chapters: []
        };
        storage.saveStories([newStory, ...stories]);
        bumpStoriesVersion();

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
  const driveConnected = hasUsableDriveToken(driveAuth);
  const latestBackupStoredOnDrive = latestBackup?.drive?.status === 'uploaded';
  const accountAutosyncLabel = !user
    ? 'Cần đăng nhập'
    : !hasSupabase
      ? 'Thiếu cấu hình Supabase'
      : ACCOUNT_CLOUD_AUTOSYNC_ENABLED
        ? 'Đang bật'
        : 'Đang tắt';

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
          <ToolsPage
            onBack={() => setView('stories')}
            onRequireAuth={() => setShowAuthModal(true)}
          />
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
        <div className="max-w-7xl mx-auto px-6 mb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-5xl font-serif font-bold text-slate-900 mb-4 tracking-tight">Thư viện</h2>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setIsCreating(true)}
                className="hero-action hero-action-primary glow-dot flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xl shadow-indigo-900/20 font-bold text-lg group"
              >
                <Plus className="w-6 h-6 transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110" />
                Viết truyện mới
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="hero-action hero-action-outline glow-dot flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-white transition-all shadow-xl font-bold text-lg group"
              >
                <Sparkles className="w-6 h-6 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:rotate-12" />
                Tạo từ dàn ý (AI)
              </button>
              <button
                onClick={handleUnifiedAiFileFlow}
                className="hero-action hero-action-warm glow-dot flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-xl shadow-amber-900/20 font-bold text-lg group"
              >
                <Languages className="w-6 h-6 transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5" />
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
        />
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

  const StoryRouteView = () => {
    const params = useParams<{ storySlug: string }>();
    const storySlug = sanitizeStorySlug(String(params.storySlug || '').trim());
    const routeStories = React.useMemo(() => storage.getStories(), [storiesVersion]);
    const routeStory = React.useMemo(
      () => routeStories.find((item) => resolveStorySlug(item) === storySlug) || null,
      [routeStories, storySlug],
    );

    useEffect(() => {
      setSelectedStory((prev) => {
        if (!routeStory) return null;
        return prev?.id === routeStory.id ? prev : routeStory;
      });
    }, [routeStory]);

    if (!routeStory) {
      return <NotFoundRouteView title="Không tìm thấy truyện" message="Story slug không tồn tại hoặc truyện đã bị xóa." />;
    }

    const storyPath = `/${resolveStorySlug(routeStory)}`;

    return (
      <StoryDetail
        story={routeStory}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: routeStory.title || 'Chi tiết truyện' },
        ]}
        onBack={() => navigate('/')}
        onEdit={() => {
          setEditingStory(routeStory);
          setSelectedStory(null);
          navigate('/');
        }}
        onAddChapter={() => {
          setSelectedStory(routeStory);
          setShowAIGen(true);
        }}
        onUpdateStory={(updated) => setSelectedStory(updated)}
        onExportStory={handleOpenExportStory}
        onOpenReaderPrefs={() => setShowReaderPrefsModal(true)}
        onOpenChapter={(chapter) => navigate(`${storyPath}/${getChapterRouteSlug(chapter)}`, { state: { storyId: routeStory.id } })}
      />
    );
  };

  const ReaderRouteView = () => {
    const params = useParams<{ storySlug: string; chapterSlug: string }>();
    const storySlug = sanitizeStorySlug(String(params.storySlug || '').trim());
    const chapterSlug = String(params.chapterSlug || '').trim().toLowerCase();
    const routeState = (location.state || {}) as { storyId?: string };
    const stories = React.useMemo(() => storage.getStories(), [storiesVersion]);
    const storyByState = routeState.storyId ? stories.find((item) => item.id === routeState.storyId) : null;
    const storyBySlug = stories.find((item) => resolveStorySlug(item) === storySlug) || null;
    const routeStory = storyBySlug || storyByState;
    const routeChapter = routeStory ? findChapterByRouteSlug(routeStory.chapters || [], chapterSlug) : null;

    useEffect(() => {
      setSelectedStory((prev) => {
        if (!routeStory) return null;
        return prev?.id === routeStory.id ? prev : routeStory;
      });
    }, [routeStory]);

    if (!routeStory || !routeChapter) {
      return <NotFoundRouteView title="Không tìm thấy chương" message="Chapter slug không hợp lệ hoặc chương đã bị thay đổi." />;
    }

    const storyPath = `/${resolveStorySlug(routeStory)}`;

    return (
      <StoryDetail
        story={routeStory}
        forcedChapterId={routeChapter.id}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: routeStory.title || 'Chi tiết truyện', to: storyPath },
          { label: routeChapter.title || 'Nội dung chương' },
        ]}
        onBack={() => navigate('/')}
        onEdit={() => {
          setEditingStory(routeStory);
          setSelectedStory(null);
          navigate('/');
        }}
        onAddChapter={() => {
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
      />
    );
  };

  const LegacyStoryRouteRedirect = () => {
    const params = useParams<{ id: string }>();
    const legacyId = String(params.id || '').trim();
    const stories = React.useMemo(() => storage.getStories(), [storiesVersion]);
    const legacyStory = stories.find((item) => item.id === legacyId) || null;
    if (!legacyStory) return <NotFoundRouteView title="Không tìm thấy truyện" message="ID truyện cũ không còn tồn tại." />;
    return <Navigate to={`/${resolveStorySlug(legacyStory)}`} replace />;
  };

  const LegacyReaderRouteRedirect = () => {
    const params = useParams<{ chapterId: string }>();
    const chapterId = String(params.chapterId || '').trim();
    const stories = React.useMemo(() => storage.getStories(), [storiesVersion]);
    const ownerStory = stories.find((item) => (item.chapters || []).some((chapter) => chapter.id === chapterId)) || null;
    if (!ownerStory) return <NotFoundRouteView title="Không tìm thấy chương" message="ID chương cũ không còn tồn tại." />;
    const chapter = (ownerStory.chapters || []).find((item) => item.id === chapterId);
    if (!chapter) return <NotFoundRouteView title="Không tìm thấy chương" message="ID chương cũ không còn tồn tại." />;
    return <Navigate to={`/${resolveStorySlug(ownerStory)}/${getChapterRouteSlug(chapter)}`} replace />;
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

      <PromptLibraryModalNew
        isOpen={showPromptManager}
        onClose={() => setShowPromptManager(false)}
        onSelect={() => setShowPromptManager(false)}
      />

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
              <ReleaseHistoryAccordion
                notes={WRITER_RELEASE_NOTES}
                currentVersion={CURRENT_WRITER_VERSION}
                variant="dark"
              />
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
            <div className="space-y-5 overflow-y-auto pr-1 sm:pr-2 max-h-[calc(92vh-2.25rem)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2 pr-14">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sao lưu & khôi phục</p>
                <h3 className="text-2xl font-bold">Sao lưu và khôi phục dữ liệu</h3>
                <p className="text-sm text-slate-400 max-w-3xl">
                  Đây là nơi giữ cho công sức của bạn không biến mất vô lý. Dữ liệu sẽ tự đồng bộ với tài khoản Supabase khi bạn đăng nhập, đồng thời bạn vẫn có thể giữ thêm bản sao trên thiết bị và Google Drive.
                </p>
              </div>
              <button
                className="tf-btn tf-btn-ghost px-3 py-1 self-start"
                onClick={closeBackupCenter}
              >
                Đóng
              </button>
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

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Lần sao lưu gần nhất</p>
                <p className="text-lg font-bold text-white">{latestBackupAt ? formatBackupTimestamp(latestBackupAt) : 'Chưa có'}</p>
                <p className="text-sm text-slate-400">
                  {latestBackup
                    ? `${(latestBackup.payload.stories || []).length} truyện · ${(latestBackup.payload.characters || []).length} nhân vật · ${latestBackupStoredOnDrive ? 'đã có trên máy và trên Drive' : 'đang có trên máy'}`
                    : 'Chưa có bản sao lưu nào trên thiết bị này.'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Google Drive</p>
                <p className="text-lg font-bold text-white">
                  {!user ? 'Cần đăng nhập' : !driveConfigured ? 'Chưa thiết lập' : driveBinding ? 'Đã liên kết' : 'Chưa liên kết'}
                </p>
                <p className="text-sm text-slate-400">
                  {!user
                    ? 'Đăng nhập TruyenForge trước để liên kết đúng một Gmail cho tài khoản này.'
                    : !driveConfigured
                      ? 'Thiếu cấu hình Google Drive ở môi trường triển khai nên chưa thể sử dụng.'
                      : driveBinding
                        ? `Tài khoản này đang liên kết với ${driveBinding.email}${driveConnected ? ` và hiện đang đăng nhập đúng Gmail đó` : ''}.`
                        : 'Tài khoản này chưa liên kết với Google Drive nào.'}
                </p>
                <p className="text-xs text-emerald-300">Auto sync Drive: đang bật.</p>
                <p className="text-xs text-slate-400">
                  File sao lưu mới sẽ nằm trong thư mục <strong className="text-white">TruyenForge Backups</strong> ở My Drive.
                  Nếu chưa thấy, hãy bấm <strong className="text-white">Kết nối lại Drive</strong> để cấp lại quyền.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    className="tf-btn tf-btn-ghost px-3 py-1 text-xs"
                    onClick={handleConnectDrive}
                    disabled={!user || !driveConfigured || backupBusyAction === 'connect-drive'}
                  >
                    {backupBusyAction === 'connect-drive'
                      ? 'Đang kết nối...'
                      : driveBinding
                        ? (driveConnected ? 'Xác nhận lại Gmail' : 'Kết nối lại Drive')
                        : 'Kết nối Drive'}
                  </button>
                  {driveConnected ? (
                    <button
                      className="tf-btn tf-btn-ghost px-3 py-1 text-xs"
                      onClick={handleDisconnectDrive}
                      disabled={backupBusyAction === 'disconnect-drive'}
                    >
                      {backupBusyAction === 'disconnect-drive' ? 'Đang ngắt...' : 'Ngắt kết nối'}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-2 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Đồng bộ tài khoản Supabase</p>
                <p className="text-lg font-bold text-white">{accountAutosyncLabel}</p>
                <p className="text-sm text-slate-400">
                  {!user
                    ? 'Đăng nhập để bật autosync tài khoản.'
                    : !hasSupabase
                      ? 'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY nên chưa thể autosync.'
                      : ACCOUNT_CLOUD_AUTOSYNC_ENABLED
                        ? 'App chỉ tự đẩy lên Supabase khi bạn thực hiện thao tác lưu dữ liệu (lưu truyện/chương/nhân vật/rule/prompt...).'
                        : 'Autosync đã tắt qua cấu hình môi trường.'}
                </p>
                {user?.uid ? (
                  <p className="text-xs text-slate-500">
                    Mã tài khoản sync: <span className="font-mono">{user.uid}</span>
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    className="tf-btn tf-btn-ghost px-3 py-1 text-xs"
                    onClick={() => void handleManualAccountSync()}
                    disabled={!user || !hasSupabase || backupBusyAction === 'manual-sync'}
                  >
                    {backupBusyAction === 'manual-sync' ? 'Đang đồng bộ...' : 'Đồng bộ ngay với Supabase'}
                  </button>
                  <p className="text-xs text-slate-400">
                    Lần sync gần nhất: {accountLastSyncedAt ? formatBackupTimestamp(accountLastSyncedAt) : 'Chưa có'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-cyan-300" />
                    <h4 className="text-lg font-semibold">Sao lưu</h4>
                  </div>
                  <div className="flex flex-wrap gap-3">
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
                      {isExporting ? 'Đang chuẩn bị file...' : 'Tải file sao lưu'}
                    </button>
                    <button
                      className="tf-btn tf-btn-ghost"
                      onClick={() => backupImportInputRef.current?.click()}
                      disabled={isImporting}
                    >
                      {isImporting ? 'Đang đọc file...' : 'Khôi phục từ file'}
                    </button>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                    Mỗi lần bấm <strong className="text-white">Sao lưu ngay</strong>, hệ thống sẽ tạo mốc mới để bạn có thể khôi phục nhanh khi cần.
                  </div>
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
          setView(v);
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(false);
          navigate('/');
        }} 
        onHome={() => {
          setView('stories');
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(false);
          navigate('/');
        }}
        onCreateStory={() => {
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(true);
          navigate('/');
        }}
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
        <Route element={<div className={cn('tf-route-scene', routeTransitionClass)}><Outlet /></div>}>
          <Route path="/" element={renderHomeWorkspace()} />
          <Route path="/oauth/consent" element={<Navigate to={oauthConsentRedirectTarget} replace />} />
          <Route path="/oauth/consent/" element={<Navigate to={oauthConsentRedirectTarget} replace />} />
          <Route path="/story/:id" element={<LegacyStoryRouteRedirect />} />
          <Route path="/reader/:chapterId" element={<LegacyReaderRouteRedirect />} />
          <Route path="/:storySlug" element={<StoryRouteLayout />}>
            <Route index element={<StoryRouteView />} />
            <Route path=":chapterSlug" element={<ReaderRouteView />} />
          </Route>
          <Route path="*" element={<NotFoundRouteView />} />
        </Route>
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
