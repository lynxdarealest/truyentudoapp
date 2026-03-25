import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, AuthProvider } from './AuthContext';
import { supabase, hasSupabase } from './supabaseClient';
import { storage } from './storage';
import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, getDocFromServer, doc, Timestamp, updateDoc, orderBy, onSnapshot } from 'firebase/firestore';
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
  Link2,
  Sun,
  Moon,
  ImagePlus,
  Database,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Navbar } from './components/Navbar';
import { loadBudgetState } from './finops';
import { HelpModal } from './components/HelpModal';
import { ApiSectionPanel } from './components/tools/ApiSectionPanel';
import { ProfileSettingsPanel } from './components/tools/ProfileSettingsPanel';
import { ToolsPage } from './features/tools/ToolsPage';
import { PromptLibraryModal as PromptLibraryModalNew } from './features/prompt/PromptLibrary';

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
const DEFAULT_RELAY_WS_BASE = 'wss://relay2026.up.railway.app/?code=';
const DEFAULT_RELAY_WEB_BASE = 'https://relay2026.vercel.app/';
const RELAY_SOCKET_BASE = normalizeRelaySocketBase(import.meta.env.VITE_RELAY_WS_BASE || DEFAULT_RELAY_WS_BASE);
const RELAY_WEB_BASE = ((import.meta.env.VITE_RELAY_WEB_BASE || DEFAULT_RELAY_WEB_BASE).trim().replace(/\/+$/, '') + '/');

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

const API_RUNTIME_CONFIG_KEY = 'api_runtime_config_v1';
const RELAY_TOKEN_CACHE_KEY = 'relay_token_cache_v1';
const GEMINI_RESPONSE_CACHE_KEY = 'gemini_response_cache_v1';
const MAIN_AI_USAGE_KEY = 'main_ai_usage_v1';
const UI_PROFILE_KEY = 'ui_profile_v1';
const UI_THEME_KEY = 'ui_theme_v1';
const UI_VIEWPORT_MODE_KEY = 'ui_viewport_mode_v1';
const STORIES_UPDATED_EVENT = 'stories:updated';

type ThemeMode = 'light' | 'dark';
type ViewportMode = 'desktop' | 'mobile';

interface UiProfile {
  displayName: string;
  avatarUrl: string;
}

function loadUiProfile(defaultName?: string, defaultAvatar?: string): UiProfile {
  try {
    const raw = localStorage.getItem(UI_PROFILE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<UiProfile>) : {};
    return {
      displayName: parsed.displayName || defaultName || 'Người dùng',
      avatarUrl: parsed.avatarUrl || defaultAvatar || 'https://api.dicebear.com/9.x/initials/svg?seed=User',
    };
  } catch {
    return {
      displayName: defaultName || 'Người dùng',
      avatarUrl: defaultAvatar || 'https://api.dicebear.com/9.x/initials/svg?seed=User',
    };
  }
}

function saveUiProfile(profile: UiProfile): void {
  localStorage.setItem(UI_PROFILE_KEY, JSON.stringify(profile));
}

function loadThemeMode(): ThemeMode {
  const raw = localStorage.getItem(UI_THEME_KEY);
  return raw === 'dark' ? 'dark' : 'light';
}

function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(UI_THEME_KEY, mode);
}

function loadViewportMode(): ViewportMode {
  const raw = localStorage.getItem(UI_VIEWPORT_MODE_KEY);
  return raw === 'mobile' ? 'mobile' : 'desktop';
}

function saveViewportMode(mode: ViewportMode): void {
  localStorage.setItem(UI_VIEWPORT_MODE_KEY, mode);
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

function buildRelayConnectUrl(rawInput: string, code: string): string {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return toWsUrl(rawInput || RELAY_SOCKET_BASE);
  const raw = normalizeRelaySocketBase(rawInput || RELAY_SOCKET_BASE);
  try {
    const url = new URL(raw);
    url.searchParams.set('code', cleanCode);
    return url.toString();
  } catch {
    return `${RELAY_SOCKET_BASE}${cleanCode}`;
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

function getApiRuntimeConfig(): ApiRuntimeConfig {
  try {
    const raw = localStorage.getItem(API_RUNTIME_CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ApiRuntimeConfig>) : {};
    return {
      mode: parsed.mode === 'relay' ? 'relay' : 'manual',
      relayUrl: parsed.relayUrl || buildRelaySocketUrl(''),
      identityHint: parsed.identityHint || '',
      relayMatchedLong: parsed.relayMatchedLong || '',
      relayToken: parsed.relayToken || '',
      relayUpdatedAt: parsed.relayUpdatedAt || '',
      aiProfile: parsed.aiProfile === 'economy' || parsed.aiProfile === 'quality' ? parsed.aiProfile : 'balanced',
      selectedProvider: parsed.selectedProvider === 'gcli' || parsed.selectedProvider === 'openai' || parsed.selectedProvider === 'anthropic' || parsed.selectedProvider === 'custom' || parsed.selectedProvider === 'unknown' ? parsed.selectedProvider : 'gemini',
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
  if (resolvedProvider === 'gemini') {
    if (runtime.aiProfile === 'economy') return 'gemini-2.0-flash';
    if (runtime.aiProfile === 'quality') return kind === 'fast' ? 'gemini-2.0-flash' : 'gemini-3.1-pro-preview';
    return kind === 'fast' ? 'gemini-2.0-flash' : 'gemini-2.5-flash';
  }
  if (resolvedProvider === 'gcli') {
    if (runtime.aiProfile === 'economy') return 'gemini-2.0-flash';
    if (runtime.aiProfile === 'quality') return kind === 'fast' ? 'gemini-2.0-flash' : 'gemini-3.1-pro-preview';
    return kind === 'fast' ? 'gemini-2.0-flash' : 'gemini-2.5-flash';
  }
  if (resolvedProvider === 'openai') {
    if (runtime.aiProfile === 'economy') return 'gpt-4.1-mini';
    if (runtime.aiProfile === 'quality') return 'gpt-4.1';
    return kind === 'fast' ? 'gpt-4.1-mini' : 'gpt-4o';
  }
  if (resolvedProvider === 'anthropic') {
    if (runtime.aiProfile === 'economy') return 'claude-3-5-haiku-latest';
    if (runtime.aiProfile === 'quality') return 'claude-3-7-sonnet-latest';
    return kind === 'fast' ? 'claude-3-5-haiku-latest' : 'claude-3-5-sonnet-latest';
  }
  if (resolvedProvider === 'custom') {
    return runtime.selectedModel || 'custom-model';
  }
  return getDefaultModelForProvider('gemini', runtime.aiProfile);
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
  return {
    title: String(extracted?.title || fallbackTitle).trim() || fallbackTitle,
    content,
  };
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

const CHAPTER_HEADING_PATTERNS: RegExp[] = [
  /^(?:#{1,6}\s*)?第\s*[0-9０-９一二三四五六七八九十百千万兩两零〇IVXLCDMivxlcdm]+\s*[章节回卷部集篇](?:\s*[:：\-—.．、]\s*.*)?$/,
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

    const sentences = trimmed
      .split(/(?<=[.!?。！？])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

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

function splitTextForTranslation(text: string, maxChars: number): string[] {
  const units = buildChapterTranslationUnits(text, maxChars);
  if (!units.length) return [];
  return units.map((unit) => `${unit.title}\n${unit.source}`.trim());
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

async function probeImageUrl(url: string, timeoutMs = 18000): Promise<boolean> {
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

function buildFallbackCoverDataUrl(title: string, genre: string, prompt: string): string {
  const safeTitle = String(title || 'Untitled Story').slice(0, 64);
  const safeGenre = String(genre || 'Fiction').slice(0, 32);
  const safeHint = String(prompt || '').replace(/\s+/g, ' ').slice(0, 78);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="896" height="1344" viewBox="0 0 896 1344">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f766e"/>
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
  <rect x="70" y="70" width="756" height="1204" rx="38" fill="url(#glass)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
  <text x="110" y="220" fill="#ffffff" opacity="0.9" font-family="Georgia, serif" font-size="36" letter-spacing="4">${safeGenre.toUpperCase()}</text>
  <text x="110" y="520" fill="#ffffff" font-family="Georgia, serif" font-weight="700" font-size="84">${safeTitle}</text>
  <text x="110" y="1100" fill="#ffffff" opacity="0.85" font-family="Verdana, sans-serif" font-size="24">${safeHint}</text>
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

  delete raw.maxRetries;
  delete raw.minOutputChars;

  return {
    providerConfig: raw,
    maxRetries: maxRetries ?? 1,
    minOutputChars: minOutputChars ?? 0,
  };
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
  const preferred = kind === 'fast'
    ? ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.1-pro-preview']
    : ['gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.0-flash'];
  const merged = [baseModel, ...preferred].map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp;
  } finally {
    window.clearTimeout(timer);
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
      const timeoutMs = calculateAdaptiveTimeoutMs(
        kind,
        Number(attemptConfig.maxOutputTokens || 0) || (kind === 'fast' ? 1800 : 4200),
      );
      try {
        // If in relay mode, send request through relay WebSocket; no token exposed to browser.
        if (runtime.mode === 'relay') {
          const body = {
            contents: [
              {
                parts: [{ text: promptForAttempt }],
              },
            ],
            generationConfig: attemptConfig,
          };
          try {
            const raw = await relayGenerateContent(currentModel, body, timeoutMs);
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
            const fallbackKey = getConfiguredGeminiApiKey();
            const fallbackEndpoint = `${getProviderBaseUrl('gcli').replace(/\/+$/, '')}/models/${currentModel}:generateContent`;
            const relayMsg = stringifyError(relayErr);
            if (fallbackKey) {
              const resp = await fetchWithTimeout(
                fallbackEndpoint,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${fallbackKey}`,
                  },
                  body: JSON.stringify(body),
                },
                timeoutMs + 8000,
              );
              if (!resp.ok) {
                throw new Error(`Relay timeout; fallback bearer error ${resp.status}: ${await resp.text()}`);
              }
              const data = await resp.json();
              text = extractTextFromModelPayload(data) || '';
            } else {
              throw new Error(`Relay timeout. ${relayMsg} · Hãy kết nối lại Relay hoặc dán API key trực tiếp (Gemini).`);
            }
          }
        } else if (auth.provider === 'gemini' && auth.isApiKey && auth.client) {
          const response = await auth.client.models.generateContent({
            model: currentModel,
            contents: promptForAttempt,
            config: attemptConfig,
          });
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
          }, timeoutMs);
          if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`${auth.provider === 'gcli' ? 'GCLI' : 'Gemini'} (Bearer) error ${resp.status}: ${body.slice(0, 200)}`);
          }
          const data = await resp.json();
          text = extractTextFromModelPayload(data) || '';
        } else if (auth.provider === 'openai' || auth.provider === 'custom') {
          const openAiBase = auth.baseUrl || getProviderBaseUrl(auth.provider === 'custom' ? 'custom' : 'openai');
          const completionEndpoint = /\/chat\/completions$/i.test(openAiBase)
            ? openAiBase
            : `${openAiBase.replace(/\/+$/, '')}/chat/completions`;
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (auth.apiKey.trim()) {
            headers.Authorization = `Bearer ${auth.apiKey}`;
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
          }, timeoutMs);
          if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`${auth.provider === 'custom' ? 'Custom endpoint' : 'OpenAI'} error ${resp.status}: ${body.slice(0, 220)}`);
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
          }, timeoutMs);
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

function createGeminiClient(): AiAuth {
  const runtime = getApiRuntimeConfig();
  if (runtime.mode === 'relay') {
    return {
      provider: 'gemini',
      apiKey: '',
      isApiKey: false,
      model: getProfileModel('quality', 'gemini'),
      baseUrl: '',
    };
  }

  const vault = loadApiVault(runtime.aiProfile);
  const activeEntry = vault.find((item) => item.id === runtime.activeApiKeyId) || getActiveApiKeyRecord(vault);
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
    model: activeEntry?.model || runtime.selectedModel || getProfileModel('quality', provider),
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

interface Story {
  id: string;
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
  createdAt: any;
  updatedAt: any;
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
        alert("Nhập từ điển thành công!");
      }
    } catch (error) {
      alert("Lỗi khi nhập file từ điển.");
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
      const ai = createGeminiClient();
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
      const ai = createGeminiClient();
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
      const ai = createGeminiClient();
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
      const ai = createGeminiClient();
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
      const ai = createGeminiClient();
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

const SectionHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="flex items-center justify-between">
    <div>
      <h2 className="text-2xl font-serif font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  </div>
);

const ToolsManager = ({
  onBack,
  onRequireAuth,
  profile,
  onSaveProfile,
  section = 'tools',
}: {
  onBack: () => void;
  onRequireAuth: () => void;
  profile: UiProfile;
  onSaveProfile: (next: UiProfile) => void;
  section?: 'tools' | 'api';
}) => {
  const { user } = useAuth();
  const isApiSection = section === 'api';
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [profileName, setProfileName] = useState(profile.displayName);
  const [profileAvatar, setProfileAvatar] = useState(profile.avatarUrl);
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
  const relaySocketRef = useRef<WebSocket | null>(null);
  const relayPingRef = useRef<number | null>(null);
  const relayReconnectRef = useRef<number | null>(null);
  const relayShouldReconnectRef = useRef(false);
  const relayRequestReadyRef = useRef(false);
  const avatarUploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setProfileName(profile.displayName);
    setProfileAvatar(profile.avatarUrl);
  }, [profile.displayName, profile.avatarUrl]);

  useEffect(() => {
    const runtime = getApiRuntimeConfig();
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
  const effectiveDraftProvider = detectedDraftProvider !== 'unknown' ? detectedDraftProvider : apiEntryProvider;
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
    const provider = detected !== 'unknown' ? detected : apiEntryProvider;
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
      setQuickImportResult(`Chưa nhận diện được thông tin phù hợp. Hãy dán API key, mã truy cập Google, địa chỉ máy chủ AI riêng hoặc URL trung chuyển dạng ${RELAY_SOCKET_BASE}1234.`);
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
    const inferred = toWsUrl(rawInput);
    if (inferred) candidates.add(inferred);
    candidates.add(buildRelayConnectUrl(rawInput, code));
    candidates.add(`${RELAY_SOCKET_BASE}${code}`);
    try {
      const url = new URL(`${RELAY_SOCKET_BASE}${code}`);
      candidates.add(`${url.origin}/code=${code}`);
    } catch {}
    return Array.from(candidates);
  };

  const handleConnectRelay = async () => {
    const inferredCode = parseRelayCodeFromText(relayUrl);
    if (!/^\d{4,8}$/.test(inferredCode)) {
      setRelayStatus('error');
      setRelayStatusText(`Vui lòng nhập đúng mẫu ${RELAY_SOCKET_BASE}1234 (mã 4-8 số).`);
      return;
    }
    const wsCandidates = buildRelayCandidateUrls(relayUrl, inferredCode);
    const longFromInput = parseLongIdFromText(relayUrl);
    relayShouldReconnectRef.current = true;
    setRelayUrl(buildRelaySocketUrl(inferredCode));

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
      relayUrl: buildRelaySocketUrl(inferredCode),
      identityHint: relayUrl,
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
        const expectedLong = parseLongIdFromText(relayUrl);
        const expectedCode = parseRelayCodeFromText(relayUrl);
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
            identityHint: relayUrl,
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
        setRelayStatus('disconnected');
        setRelayStatusText('Ngắt kết nối');
        if (relayShouldReconnectRef.current) {
          if (relayReconnectRef.current) {
            window.clearTimeout(relayReconnectRef.current);
          }
          relayReconnectRef.current = window.setTimeout(() => {
            void handleConnectRelay();
          }, 5000);
        }
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
    const ai = createGeminiClient();
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
    // Lưu Firestore nếu có user
    if (user?.uid) {
      try {
        await addDoc(collection(db, 'qa_reports'), {
          authorId: user.uid,
          textPreview: text.slice(0, 500),
          issueCount: parsed.length,
          issues: parsed,
          createdAt: Timestamp.now(),
        });
      } catch (err) {
        console.warn('Lưu QA report thất bại', err);
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
      // Fetch all stories and characters
      const storiesQ = query(collection(db, 'stories'), where('authorId', '==', user.uid));
      const charsQ = query(collection(db, 'characters'), where('authorId', '==', user.uid));
      
      const storiesDocs = await getDocs(storiesQ);
      const charsDocs = await getDocs(charsQ);

      const data = {
        exportDate: new Date().toISOString(),
        stories: storiesDocs.docs.map(d => ({ id: d.id, ...d.data() })),
        characters: charsDocs.docs.map(d => ({ id: d.id, ...d.data() })),
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
      alert("Xuất dữ liệu thất bại.");
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
          const newStories = [];
          for (const story of (data.stories || [])) {
            const { id, ...rest } = story;
            const docRef = await addDoc(collection(db, 'stories'), { ...rest, authorId: user.uid, updatedAt: Timestamp.now() });
            newStories.push({ ...rest, id: docRef.id, authorId: user.uid, updatedAt: new Date().toISOString() });
          }
          if (newStories.length > 0) {
            const stories = storage.getStories();
            storage.saveStories([...newStories, ...stories]);
            bumpStoriesVersion();
          }

          const newChars = [];
          for (const char of (data.characters || [])) {
            const { id, ...rest } = char;
            const docRef = await addDoc(collection(db, 'characters'), { ...rest, authorId: user.uid, createdAt: Timestamp.now() });
            newChars.push({ ...rest, id: docRef.id, authorId: user.uid, createdAt: new Date().toISOString() });
          }
          if (newChars.length > 0) {
            const chars = storage.getCharacters();
            storage.saveCharacters([...newChars, ...chars]);
          }
          alert("Nhập dữ liệu thành công!");
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

        const docRef = await addDoc(collection(db, 'stories'), {
          authorId: user.uid,
          title: String(file.name).replace(/\.docx$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        const stories = storage.getStories();
        storage.saveStories([{
          id: docRef.id,
          authorId: user.uid,
          title: String(file.name).replace(/\.docx$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chapters: []
        }, ...stories]);
        bumpStoriesVersion();
        alert("Nhập file .docx thành công!");
      } else if (fileName.endsWith('.txt')) {
        console.log("Xử lý file TXT...");
        const text = await file.text();
        if (!text.trim()) {
          throw new Error("File .txt không có nội dung.");
        }
        const docRef = await addDoc(collection(db, 'stories'), {
          authorId: user.uid,
          title: String(file.name).replace(/\.txt$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        const stories = storage.getStories();
        storage.saveStories([{
          id: docRef.id,
          authorId: user.uid,
          title: String(file.name).replace(/\.txt$/i, '').substring(0, 480),
          content: String(text).substring(0, 1999900),
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chapters: []
        }, ...stories]);
        bumpStoriesVersion();
        alert("Nhập file .txt thành công!");
      } else {
        console.warn("Định dạng file không được hỗ trợ:", fileName);
        alert("Định dạng file không được hỗ trợ.");
      }
    } catch (error) {
      console.error("Lỗi khi nhập file:", error);
      alert(`Nhập file thất bại: ${error instanceof Error ? error.message : "Lỗi không xác định"}`);
    } finally {
      setIsImporting(false);
      e.target.value = '';
      console.log("Kết thúc xử lý nhập file.");
    }
  };

  const handleSaveProfileInfo = () => {
    const cleanedName = profileName.trim() || 'Người dùng';
    const cleanedAvatar = profileAvatar.trim() || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(cleanedName)}`;
    onSaveProfile({
      displayName: cleanedName,
      avatarUrl: cleanedAvatar,
    });
    alert('Đã lưu hồ sơ hiển thị.');
  };

  const handlePickAvatarFile = () => {
    avatarUploadInputRef.current?.click();
  };

  const handleAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Chỉ hỗ trợ file ảnh (png, jpg, webp...).');
      event.target.value = '';
      return;
    }
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 2MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextAvatar = String(reader.result || '').trim();
      if (!nextAvatar) {
        alert('Không đọc được file ảnh.');
        return;
      }
      setProfileAvatar(nextAvatar);
    };
    reader.onerror = () => {
      alert('Đọc file ảnh thất bại.');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
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
        <div className="mb-8 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-violet-50 rounded-2xl">
              <ImagePlus className="w-6 h-6 text-violet-600" />
            </div>
            <div>
              <h3 className="text-xl font-serif font-bold">Hồ sơ hiển thị</h3>
              <p className="text-sm text-slate-500">Bạn vẫn có thể đổi tên và avatar kể cả khi chưa đăng nhập.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-violet-500"
              placeholder="Tên hiển thị"
            />
            <input
              value={profileAvatar}
              onChange={(e) => setProfileAvatar(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-violet-500"
              placeholder="Link ảnh đại diện (https://...)"
            />
            <button
              onClick={handleSaveProfileInfo}
              className="px-6 py-3 rounded-2xl bg-violet-600 text-white font-bold hover:bg-violet-700"
            >
              Lưu hồ sơ
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={avatarUploadInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handlePickAvatarFile}
              className="px-4 py-2 rounded-xl border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 text-sm font-semibold"
            >
              Tải ảnh từ thiết bị
            </button>
            <p className="text-xs text-slate-500">
              Có thể dán URL hoặc tải ảnh từ máy (khuyến nghị dưới 2MB).
            </p>
          </div>
        </div>
        <div className="bg-white p-12 rounded-[32px] border border-slate-200 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Settings className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-xl font-serif font-bold mb-2">Bạn chưa đăng nhập</h3>
          <p className="text-slate-500 mb-8">Vui lòng đăng nhập để sử dụng các công cụ nhập/xuất dữ liệu.</p>
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
          onApiEntryNameChange={setApiEntryName}
          onApiEntryTextChange={setApiEntryText}
          onApiEntryProviderChange={setApiEntryProvider}
          onApiEntryModelChange={setApiEntryModel}
          onApiEntryBaseUrlChange={setApiEntryBaseUrl}
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
      className="max-w-4xl mx-auto pt-24 pb-12 px-6"
    >
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 transition-colors"><ChevronLeft /></button>
        <h2 className="text-3xl font-serif font-bold">Công cụ & Thiết lập</h2>
      </div>

      <div className="space-y-12">
        <div className="space-y-6">
          <SectionHeader
            title="Thiết lập cá nhân"
            subtitle="Quản lý hồ sơ, avatar và các tùy chọn hiển thị."
          />
          <ProfileSettingsPanel
            profileName={profileName}
            profileAvatar={profileAvatar}
            onProfileNameChange={setProfileName}
            onProfileAvatarChange={setProfileAvatar}
            onSave={handleSaveProfileInfo}
            onPickAvatarFile={handlePickAvatarFile}
            onAvatarFileChange={handleAvatarFileChange}
            avatarInputRef={avatarUploadInputRef}
          />
        </div>

        <div className="space-y-6">
          <SectionHeader
            title="Kho prompt"
            subtitle="Lưu và quản lý prompt dùng chung cho viết và dịch."
          />
          <PromptVaultPanel />
        </div>

        <div className="space-y-6">
          <SectionHeader
            title="Hỗ trợ dịch"
            subtitle="Công cụ dành riêng cho dịch thuật và hậu kỳ."
          />
          <TranslationNameDictionary />
          <QualityCenter onRun={handleRunQa} />
        </div>

        <div className="space-y-6">
          <SectionHeader
            title="Hỗ trợ viết truyện"
            subtitle="Co-writer, văn mẫu, quy tắc AI và công cụ sáng tác."
          />
          <WriterProPanel />
          <AIRulesManager />
          <StyleReferenceLibrary />
        </div>

        <div className="p-8 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-slate-400" />
            <h4 className="font-bold text-slate-700">Lưu ý về định dạng</h4>
          </div>
          <ul className="text-sm text-slate-500 space-y-2 list-disc pl-5">
            <li>File <b>.docx</b> và <b>.txt</b> sẽ được nhập dưới dạng một truyện mới.</li>
            <li>Hãy dùng tệp sao lưu được tạo từ ứng dụng này để đảm bảo khôi phục đầy đủ.</li>
            <li>Tiến trình nhập có thể mất vài giây tùy thuộc vào dung lượng file.</li>
          </ul>
        </div>
      </div>
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
    alert('Thêm quy tắc AI thành công!');
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-serif font-bold">{viewingRule.name}</h3>
              <button onClick={() => setViewingRule(null)} className="p-2 hover:bg-white rounded-full shadow-sm">
                <Plus className="w-6 h-6 rotate-45 text-slate-400" />
              </button>
            </div>
            <div className="p-8 overflow-y-auto">
              <div className="markdown-body text-slate-600 leading-relaxed whitespace-pre-wrap">
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
    alert('Thêm văn mẫu thành công!');
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
      alert('Lỗi khi đọc file: ' + error);
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
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-xl font-serif font-bold">{viewingRef.name}</h3>
              <button onClick={() => setViewingRef(null)} className="p-2 hover:bg-white rounded-full">
                <Plus className="w-6 h-6 rotate-45 text-slate-400" />
              </button>
            </div>
            <div className="p-8 overflow-y-auto whitespace-pre-wrap text-slate-600 text-sm leading-relaxed">
              {viewingRef.content}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const StoryEditor = ({ story, onSave, onCancel }: { story?: Story, onSave: (data: Partial<Story>) => void, onCancel: () => void }) => {
  const [title, setTitle] = useState(story?.title || '');
  const [genre, setGenre] = useState(story?.genre || '');
  const [introduction, setIntroduction] = useState(story?.introduction || '');
  const [content, setContent] = useState(story?.content || '');
  const [coverImageUrl, setCoverImageUrl] = useState(story?.coverImageUrl || '');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [expectedChapters, setExpectedChapters] = useState(story?.expectedChapters || 0);
  const [expectedWordCount, setExpectedWordCount] = useState(story?.expectedWordCount || 0);
  const [isPublic, setIsPublic] = useState(story?.isPublic ?? false);
  const [isAdult, setIsAdult] = useState(story?.isAdult ?? false);
  const [preview, setPreview] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const buildCoverPrompt = () => {
    const intro = String(introduction || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const promptParts = [
      title ? `Bìa truyện "${title}"` : 'Bìa truyện fantasy',
      genre ? `thể loại ${genre}` : 'văn học hiện đại',
      intro ? `bối cảnh: ${intro}` : '',
      'illustration, cinematic, high detail, dramatic lighting, vertical book cover, no text, no watermark',
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
      alert('Chỉ hỗ trợ file ảnh (png, jpg, webp...).');
      event.target.value = '';
      return;
    }
    const maxSize = 3 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 3MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '').trim();
      if (!value) {
        alert('Không đọc được file ảnh.');
        return;
      }
      setCoverImageUrl(value);
    };
    reader.onerror = () => {
      alert('Đọc file ảnh thất bại.');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleGenerateCover = async () => {
    if (!title.trim()) {
      alert('Hãy nhập tiêu đề truyện trước khi tạo ảnh bìa.');
      return;
    }
    setIsGeneratingCover(true);
    try {
      const prompt = sanitizePromptForUrl(String(coverPrompt || buildCoverPrompt()).trim());
      if (!prompt) {
        alert('Không đủ dữ liệu để tạo ảnh bìa.');
        return;
      }
      let imageUrl = '';

      // Try OpenAI image API first when user is configured with OpenAI/custom endpoint.
      try {
        const ai = createGeminiClient();
        if ((ai.provider === 'openai' || ai.provider === 'custom') && ai.apiKey.trim()) {
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
          }, 50000);
          if (resp.ok) {
            const data = await resp.json();
            const url = String(data?.data?.[0]?.url || '').trim();
            const b64 = String(data?.data?.[0]?.b64_json || '').trim();
            if (url) {
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
        const encoded = encodeURIComponent(prompt);
        const buildCandidates = (offset: number) => ([
          `https://image.pollinations.ai/prompt/${encoded}?width=896&height=1344&seed=${seed + offset}&nologo=true&enhance=true&model=flux`,
          `https://image.pollinations.ai/prompt/${encoded}?width=896&height=1344&seed=${seed + offset}&nologo=true&enhance=true&model=turbo`,
          `https://image.pollinations.ai/prompt/${encoded}?width=768&height=1152&seed=${seed + offset}&nologo=true&model=sdxl`,
          `https://image.pollinations.ai/prompt/${encoded}?width=768&height=1152&seed=${seed + offset}&nologo=true`,
        ]);

        for (let attempt = 0; attempt < 3 && !imageUrl; attempt += 1) {
          const candidates = buildCandidates(attempt * 97);
          for (const candidate of candidates) {
            const ok = await probeImageUrl(candidate, 45000);
            if (ok) {
              imageUrl = candidate;
              break;
            }
          }
          if (!imageUrl && attempt < 2) {
            await sleepMs(1200 * (attempt + 1));
          }
        }
      }

      if (!imageUrl) {
        const fallbackCover = buildFallbackCoverDataUrl(title, genre, prompt);
        setCoverImageUrl(fallbackCover);
        if (!coverPrompt.trim()) {
          setCoverPrompt(prompt);
        }
        alert('Dịch vụ ảnh AI đang bận, hệ thống đã tạo bìa dự phòng để bạn dùng ngay. Bạn có thể bấm tạo lại sau 1-2 phút để lấy bìa AI.');
        return;
      }
      setCoverImageUrl(imageUrl);
      if (!coverPrompt.trim()) {
        setCoverPrompt(prompt);
      }
    } catch (error) {
      console.error('Không thể tạo ảnh bìa AI', error);
      const message = error instanceof Error ? error.message : String(error || '');
      alert(`Tạo ảnh bìa thất bại. ${message}\nBạn có thể bấm thử lại hoặc tải ảnh từ thiết bị.`);
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleSuggestIdeas = async () => {
    if (!title || !genre || !introduction) {
      alert("Vui lòng nhập Tiêu đề, Thể loại và Giới thiệu để AI có đủ thông tin gợi ý.");
      return;
    }

    setIsSuggesting(true);
    try {
      const ai = createGeminiClient();
      const suggestionText = await generateGeminiText(
        ai,
        'quality',
        `Dựa trên các thông tin sau:
        Tiêu đề: ${title}
        Thể loại: ${genre}
        Giới thiệu: ${introduction}
        
        Hãy gợi ý chi tiết để xây dựng bộ truyện này, bao gồm:
        1. Cốt truyện chính (Plot): Các giai đoạn quan trọng, nút thắt.
        2. Tuyến nhân vật: Nhân vật chính, phụ, phản diện (tên, vai trò, tính cách).
        3. Thế giới & Bối cảnh: Quy tắc thế giới, địa danh quan trọng.
        4. Thế lực & Tổ chức: Các phe phái đối lập hoặc đồng minh.
        5. Phong cách hành văn gợi ý: Giọng văn, cách dùng từ.
        6. Các yếu tố đặc sắc khác.
        
        Trả về kết quả dưới dạng Markdown chuyên nghiệp, rõ ràng.`,
        {
          maxOutputTokens: 3800,
          minOutputChars: 320,
          maxRetries: 2,
        },
      );

      if (suggestionText) {
        setContent(prev => prev ? prev + "\n\n" + suggestionText : suggestionText);
      }
    } catch (error) {
      console.error("Suggestion failed", error);
      alert("Không thể tạo gợi ý lúc này.");
    } finally {
      setIsSuggesting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="max-w-4xl mx-auto pt-24 pb-12 px-6"
    >
      <div className="flex items-center justify-between mb-8">
        <button 
          onClick={onCancel}
          className="p-2 rounded-full hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3">
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
            onClick={() => onSave({ title, genre, introduction, content, coverImageUrl: coverImageUrl.trim() || undefined, expectedChapters, expectedWordCount, isPublic, isAdult })}
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input 
                type="text" 
                placeholder="Thể loại (ví dụ: Tiên hiệp...)"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full text-lg font-bold border-none focus:ring-0 placeholder:text-slate-300 text-indigo-600"
              />
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase whitespace-nowrap">Số chương dự kiến:</span>
                <input 
                  type="number" 
                  value={expectedChapters}
                  onChange={(e) => setExpectedChapters(parseInt(e.target.value) || 0)}
                  className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700"
                />
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase whitespace-nowrap">Số chữ dự kiến:</span>
                <input 
                  type="number" 
                  value={expectedWordCount}
                  onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || 0)}
                  className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700"
                />
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
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                  <textarea
                    value={coverPrompt}
                    onChange={(e) => setCoverPrompt(e.target.value)}
                    placeholder="Prompt ảnh bìa (tùy chọn). Bỏ trống để tự tạo từ tiêu đề/thể loại."
                    className="w-full min-h-[88px] rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <div className="flex flex-wrap gap-2">
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
              className="w-full min-h-[150px] text-lg leading-relaxed border border-slate-100 rounded-2xl p-4 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-300 resize-none"
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
              className="w-full min-h-[40vh] text-lg leading-relaxed border-none focus:ring-0 placeholder:text-slate-300 resize-none"
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
          <div className="markdown-body">
            <ReactMarkdown>{content || '*Chưa có nội dung*'}</ReactMarkdown>
          </div>
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
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
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
        className="relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl overflow-hidden p-8"
      >
        <h3 className="text-xl font-serif font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-500 mb-8">{message}</p>
        <div className="flex gap-3">
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

const StoryDetail = ({ 
  story, 
  onBack, 
  onEdit, 
  onAddChapter,
  onUpdateStory,
  onExportStory,
}: { 
  story: Story, 
  onBack: () => void, 
  onEdit: () => void,
  onAddChapter: () => void,
  onUpdateStory: (story: Story) => void,
  onExportStory: (story: Story) => void,
}) => {
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

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
    // Tự động xuống dòng đôi giữa các ngoặc vuông để Markdown nhận diện
    return normalized.replace(/\]\s*\[/g, ']\n\n[');
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
      setSelectedChapter(sorted[currentIndex + 1]);
      window.scrollTo(0, 0);
    }
  };

  const handlePrevChapter = () => {
    if (!selectedChapter || !story.chapters) return;
    const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
    const currentIndex = sorted.findIndex(c => c.id === selectedChapter.id);
    if (currentIndex > 0) {
      setSelectedChapter(sorted[currentIndex - 1]);
      window.scrollTo(0, 0);
    }
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
      const stories = storage.getStories();
      const newList = stories.map((s: Story) => s.id === story.id ? updatedStory : s);
      storage.saveStories(newList);
      bumpStoriesVersion();
      
      onUpdateStory(updatedStory);
      setSelectedChapter({ ...selectedChapter, title: editTitle, content: editContent });
      setIsEditingChapter(false);
    } catch (error) {
      console.error("Lỗi khi cập nhật chương:", error);
      alert("Không thể lưu thay đổi chương.");
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
        className="max-w-4xl mx-auto pt-24 pb-12 px-6"
      >
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => setSelectedChapter(null)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-bold"
          >
            <ChevronLeft className="w-6 h-6" /> Quay lại mục lục
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
        </div>
        
        <div className="bg-white p-10 rounded-[40px] shadow-sm border border-slate-100 mb-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-indigo-600 uppercase tracking-widest">Chương {selectedChapter.order}</h2>
              <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {getWordCount(formatContent(selectedChapter.content))} từ</span>
                <span className="flex items-center gap-1"><Loader2 className="w-3 h-3" /> {formatDateTime(selectedChapter.createdAt)}</span>
              </div>
            </div>
            
              <h1 className="chapter-title text-4xl font-serif font-bold text-slate-900 mb-10">{getDisplayChapterTitle(selectedChapter)}</h1>
            
            <div className="markdown-body text-lg leading-relaxed text-slate-700">
              <ReactMarkdown>{formatContent(selectedChapter.content)}</ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="chapter-nav flex items-center justify-between max-w-2xl mx-auto">
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
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-4xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-2xl font-serif font-bold text-slate-900">Chỉnh sửa chương</h3>
                  <button onClick={() => setIsEditingChapter(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                  </button>
                </div>
                
                <div className="p-8 flex-grow overflow-y-auto space-y-6">
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
                      className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 text-slate-700 leading-relaxed"
                    />
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100 flex gap-4">
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
                    {story.genre || 'Chưa phân loại'}
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
                story.chapters.sort((a, b) => a.order - b.order).map((chapter) => (
                  <button 
                    key={chapter.id}
                    onClick={() => setSelectedChapter(chapter)}
                    className="chapter-row w-full flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-all text-left group"
                  >
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
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                  </button>
                ))
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
                        {story.content}
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

const AILoadingOverlay = ({ isVisible, message, timer }: { isVisible: boolean, message: string, timer: number }) => {
  if (!isVisible) return null;
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
        <h3 className="text-2xl font-serif font-bold text-slate-900 mb-2">AI đang xử lý...</h3>
        <p className="text-slate-500 font-medium mb-6">{message || "Vui lòng đợi trong giây lát"}</p>
        <div className="px-6 py-3 bg-indigo-50 rounded-2xl text-indigo-600 font-bold text-sm tracking-widest uppercase">
          Thời gian: {timer} giây
        </div>
      </motion.div>
    </div>
  );
};

type PromptGroup = 'translate' | 'write' | 'common' | 'tone_rules';

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
  const [selectedCoreId, setSelectedCoreId] = useState('terms');
  const [selectedGenreId, setSelectedGenreId] = useState('co-dai');
  const [draftContent, setDraftContent] = useState<string>('');

  useEffect(() => {
    const list = selectedGroup === 'common' ? coreRules : genreRules;
    const picked = list.find((i) => i.id === (selectedGroup === 'common' ? selectedCoreId : selectedGenreId)) || list[0];
    setDraftContent(picked?.content || '');
  }, [selectedGroup, selectedCoreId, selectedGenreId]);

  const currentList = selectedGroup === 'common' ? coreRules : genreRules;
  const selectedId = selectedGroup === 'common' ? selectedCoreId : selectedGenreId;
  const setList = selectedGroup === 'common' ? setCoreRules : setGenreRules;
  const selectedItem = currentList.find((i) => i.id === selectedId) || currentList[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-xl">
              <Library className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="text-xl font-serif font-bold">Kho Prompt (Yêu cầu AI)</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full shadow-sm">
            <Plus className="w-6 h-6 rotate-45 text-slate-400" />
          </button>
        </div>

        <div className="px-6 pt-3 bg-slate-900 text-slate-100 border-b border-slate-800 flex flex-wrap gap-2">
          {PROMPT_GROUP_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedGroup(tab.key)}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold tracking-wide transition-all border border-slate-800',
                selectedGroup === tab.key ? 'bg-indigo-600 text-white shadow' : 'bg-slate-800 text-slate-200 hover:bg-slate-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        <div className="flex flex-1 overflow-hidden min-h-[420px] bg-slate-950 text-slate-100">
          {/* Sidebar */}
          <div className="w-[32%] border-r border-slate-800 bg-slate-900 overflow-y-auto p-4 space-y-2">
            {(selectedGroup === 'common' ? coreRules : genreRules).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (selectedGroup === 'common') setSelectedCoreId(item.id);
                  else setSelectedGenreId(item.id);
                  setDraftContent(item.content);
                }}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-xl font-semibold transition-all border border-transparent",
                  (selectedGroup === 'common' ? selectedCoreId : selectedGenreId) === item.id
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
                const title = selectedGroup === 'common' ? 'Quy tắc mới' : 'Nhóm mới';
                const newItem: MasterItem = { id, title, content: '' };
                if (selectedGroup === 'common') {
                  setCoreRules((p) => [...p, newItem]);
                  setSelectedCoreId(id);
                } else {
                  setGenreRules((p) => [...p, newItem]);
                  setSelectedGenreId(id);
                }
                setDraftContent('');
              }}
              className="mt-4 w-full px-4 py-3 rounded-xl border border-dashed border-indigo-500 text-indigo-200 hover:bg-indigo-500/10"
            >
              + Thêm {selectedGroup === 'common' ? 'quy tắc' : 'nhóm'} mới
            </button>
          </div>
          
          {/* Content */}
          <div className="w-[68%] p-6 overflow-y-auto relative">
            <div className="flex items-center justify-between mb-4">
              <input
                value={selectedItem?.title || ''}
                onChange={(e) => {
                  const nextList = currentList.map((i) => i.id === selectedId ? { ...i, title: e.target.value } : i);
                  setList(nextList);
                }}
                className="text-xl font-bold bg-transparent border-b border-slate-700 focus:border-indigo-400 outline-none w-full"
              />
            </div>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder={selectedGroup === 'common'
                ? '- Ghi rõ quy tắc bắt buộc...\n- ...'
                : '- Giọng văn: ...\n- Xưng hô: ...\n- Từ vựng: ...\n- Cấm: ...'}
              className="w-full min-h-[260px] rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500 outline-none resize-vertical"
            />
            <div className="flex justify-end gap-3 mt-4">
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
                  setList(nextList);
                  alert('Đã lưu thay đổi');
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
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Xuất truyện</p>
            <h3 className="text-2xl font-serif font-bold text-slate-900">{storyTitle || 'Truyện'}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">Định dạng</p>
            <div className="grid grid-cols-2 gap-3">
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
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
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
    <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
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
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
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
          <div className="grid grid-cols-2 gap-3 pt-2">
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
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Dịch truyện bằng AI</h2>
            <p className="text-slate-500 mt-1 font-medium">File: {fileName}</p>
            <p className="text-xs text-slate-400 mt-1">Hệ thống sẽ tự nhận diện mốc chương và tự chia phần nếu file quá dài.</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-colors shadow-sm">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        <div className="p-8 overflow-y-auto space-y-8">
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
              className="w-full h-32 p-5 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none font-medium"
            />
          </div>
        </div>

        <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex gap-4">
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
      const q = query(collection(db, 'ai_rules'), where('authorId', '==', user.uid));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setAiRules(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AIRule)));
      });
      return unsubscribe;
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-2xl font-serif font-bold text-slate-900">Viết tiếp truyện</h3>
              <p className="text-sm text-slate-500 mt-1">File: <span className="font-bold text-indigo-600">{fileName}</span></p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>

          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-24 resize-none text-sm"
              />
            </div>
          </div>

          <div className="flex gap-4 mt-8">
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
      alert('Lỗi khi đọc file: ' + error);
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
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="p-8 border-b border-slate-100 bg-indigo-50/30">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-2xl font-serif font-bold text-slate-900">Thiết lập truyện mới</h3>
              <p className="text-sm text-indigo-600 mt-1 flex items-center gap-2">
                <FileText className="w-4 h-4" /> {fileName}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors shadow-sm">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto">
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

          <div className="grid grid-cols-2 gap-6">
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

          <div className="grid grid-cols-2 gap-6">
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
              className="w-full h-24 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm"
            />
          </div>

          {showStyleLibrary && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              >
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-xl font-serif font-bold">Thư viện văn mẫu</h3>
                  <button onClick={() => setShowStyleLibrary(false)} className="p-2 hover:bg-slate-100 rounded-full">
                    <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto">
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

        <div className="p-8 bg-slate-50 border-t border-slate-100">
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
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [aiRules, setAiRules] = useState<AIRule[]>([]);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isSuggestingOutline, setIsSuggestingOutline] = useState(false);
  const [showStyleLibrary, setShowStyleLibrary] = useState(false);
  const [isExtractingStyle, setIsExtractingStyle] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setOutline(initialOutline);
      setIsAdult(initialIsAdult);
      setPreviousContext(lastChapterContent);
    }
  }, [isOpen, initialOutline, initialIsAdult, lastChapterContent]);

  const handleGenerateScript = async () => {
    if (!outline.trim()) {
      alert("Vui lòng nhập dàn ý trước khi tạo kịch bản.");
      return;
    }
    setIsGeneratingScript(true);
    try {
      const ai = createGeminiClient();
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
      alert("Không thể tạo kịch bản.");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleSuggestOutline = async () => {
    setIsSuggestingOutline(true);
    try {
      const ai = createGeminiClient();
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
      alert("Không thể gợi ý dàn ý.");
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
      alert('Lỗi khi đọc file: ' + error);
    } finally {
      setIsExtractingStyle(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      const q = query(
        collection(db, 'characters'),
        where('authorId', '==', user.uid)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: Character[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Character);
        });
        setCharacters(list);
      });

      const qRules = query(
        collection(db, 'ai_rules'),
        where('authorId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      const unsubscribeRules = onSnapshot(qRules, (snapshot) => {
        setAiRules(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AIRule)));
      });

      return () => {
        unsubscribe();
        unsubscribeRules();
      };
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
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-3xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-2xl font-serif font-bold text-slate-900">Tùy chỉnh viết chương AI</h3>
            <p className="text-sm text-slate-500 mt-1">Thiết lập phong cách và mạch truyện cho AI</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors shadow-sm">
            <Plus className="w-6 h-6 rotate-45 text-slate-400" />
          </button>
        </div>

        <div className="p-8 overflow-y-auto space-y-8">
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
              className="w-full h-24 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-slate-700"
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
                className="w-full h-32 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm"
              />
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
                className="w-full h-32 p-4 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 resize-none text-sm"
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

              <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-3">Phong cách viết</label>
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nhịp điệu (Pacing)</span>
                    <div className="grid grid-cols-4 gap-2">
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
            </div>
          </div>

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
                className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">Bối cảnh trước đó (Previous Context)</label>
              <textarea 
                value={previousContext}
                onChange={(e) => setPreviousContext(e.target.value)}
                placeholder="Tóm tắt các sự kiện đã diễn ra trước chương này để AI duy trì mạch truyện..."
                className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none"
              />
            </div>
            <div className="space-y-4">
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
                className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none"
              />
            </div>

            {showStyleLibrary && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-xl font-serif font-bold">Thư viện văn mẫu</h3>
                    <button onClick={() => setShowStyleLibrary(false)} className="p-2 hover:bg-slate-100 rounded-full">
                      <Plus className="w-6 h-6 rotate-45 text-slate-400" />
                    </button>
                  </div>
                  <div className="p-6 overflow-y-auto">
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
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100">
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
              selectedRuleId
            })}
            disabled={!predictPlot && !outline.trim()}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <Sparkles className="w-5 h-5" />
            Bắt đầu tạo chương với tùy chỉnh
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
  const [aiTimer, setAiTimer] = useState(0);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(profile.displayName);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState(profile.avatarUrl);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportingStory, setIsExportingStory] = useState(false);

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

  useEffect(() => {
    setProfileNameDraft(profile.displayName);
    setProfileAvatarDraft(profile.avatarUrl);
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
  const [showHelp, setShowHelp] = useState(false);
  const [showAIStoryModal, setShowAIStoryModal] = useState(false);
  const [showAIContinueModal, setShowAIContinueModal] = useState(false);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [translateFileContent, setTranslateFileContent] = useState('');
  const [translateFileName, setTranslateFileName] = useState('');
  const [continueFileContent, setContinueFileContent] = useState('');
  const [continueFileName, setContinueFileName] = useState('');
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const footerSections: { id: string; title: string; content: React.ReactNode }[] = [
    {
      id: 'support',
      title: 'TRUNG TÂM HỖ TRỢ & ĐIỀU KHOẢN DỊCH VỤ CƠ BẢN',
      content: (
        <div className="space-y-3 leading-relaxed">
          <p>TruyenForge AI được vận hành cá nhân, ưu tiên phản hồi nhanh cho tác giả/dịch giả.</p>
          <div className="space-y-1">
            <p className="font-semibold text-slate-800">Kênh liên hệ duy nhất</p>
            <p>Email: <a className="text-indigo-600 font-semibold" href="mailto:ductruong.lynx@gmail.com">ductruong.lynx@gmail.com</a></p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-800">Phạm vi hỗ trợ</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Kỹ thuật & bug: giao diện, đồng bộ, lưu bản thảo, lỗi AI/Relay.</li>
              <li>Góp ý & yêu cầu tính năng: phím tắt, workflow biên tập, đề xuất model.</li>
              <li>Tài khoản & hạn mức: đăng nhập, bảo mật, quên mật khẩu, quota FinOps.</li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-slate-800">Cách gửi yêu cầu</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Email đăng ký, mô tả bước gây lỗi (steps), trình duyệt + thiết bị.</li>
              <li>Đính kèm screenshot/video nếu có; nêu mã lỗi/relay code nếu hiển thị.</li>
            </ul>
          </div>
          <p className="text-xs text-slate-500">SLA: phản hồi 24-48h; sự cố toàn hệ thống được ưu tiên ngay.</p>
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
      alert(`Xuất truyện thất bại: ${err instanceof Error ? err.message : err}`);
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

  const readImportedStoryFile = async (file: File): Promise<string> => {
    if (file.name.endsWith('.pdf')) return parsePDF(file);
    if (file.name.endsWith('.epub')) return parseEPUB(file);
    if (file.name.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer();
      return extractDocxText(arrayBuffer);
    }
    return file.text();
  };

  const handleUnifiedAiFileFlow = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.txt,.pdf,.epub';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsProcessingAI(true);
      setAILoadingMessage("Đang đọc file...");
      try {
        const content = await readImportedStoryFile(file);
        const shouldTranslate = window.confirm('Nhấn OK để DỊCH truyện, hoặc Cancel để VIẾT TIẾP truyện.');
        if (shouldTranslate) {
          setTranslateFileContent(content);
          setTranslateFileName(file.name);
          setShowTranslateModal(true);
        } else {
          setContinueFileContent(content);
          setContinueFileName(file.name);
          setShowAIContinueModal(true);
        }
      } catch (err) {
        alert("Lỗi khi đọc file: " + err);
      } finally {
        setIsProcessingAI(false);
        setAILoadingMessage('');
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    saveThemeMode(themeMode);
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

  const isFirestorePermissionError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || '');
    const code = (err as { code?: string })?.code;
    return code === 'permission-denied' || message.includes('Missing or insufficient permissions');
  };

  const handleTranslateStory = async (options: {
    isAdult: boolean,
    additionalInstructions: string,
    useDictionary: boolean
  }) => {
    if (!user || !translateFileContent) return;
    
    setShowTranslateModal(false);
    setIsProcessingAI(true);
    setAILoadingMessage("Đang chuẩn bị dịch thuật...");

    try {
      const ai = createGeminiClient();
      const translateStartedAt = Date.now();
      
      let dictionaryContext = "";
      if (options.useDictionary) {
        try {
          const q = query(collection(db, 'translation_names'), where('authorId', '==', user.uid));
          const namesSnapshot = await getDocs(q);
          const names = namesSnapshot.docs.map(doc => doc.data());
          if (names.length > 0) {
            dictionaryContext = "SỬ DỤNG TỪ ĐIỂN TÊN RIÊNG SAU ĐÂY (Ưu tiên tuyệt đối):\n" +
              names.map(n => `- ${n.original} -> ${n.translation}`).join('\n');
          }
        } catch (err) {
          if (isFirestorePermissionError(err)) {
            const names = storage.getTranslationNames();
            if (names.length > 0) {
              dictionaryContext = "SỬ DỤNG TỪ ĐIỂN TÊN RIÊNG SAU ĐÂY (Ưu tiên tuyệt đối):\n" +
                names.map((n: { original: string; translation: string }) => `- ${n.original} -> ${n.translation}`).join('\n');
            }
          } else {
            console.warn("Không thể tải từ điển tên riêng", err);
          }
        }
      }

      const sourceWordCount = countWords(translateFileContent);
      const sourceCharCount = String(translateFileContent || '').length;
      const sourceTokenEstimate = estimateTextTokens(translateFileContent);
      const turboMode = sourceWordCount >= 3200 || sourceCharCount >= 45000 || sourceTokenEstimate >= 12000;
      let segmentCharLimit = turboMode ? 5200 : 3200;
      if ((ai.provider === 'gemini' || ai.provider === 'gcli') && sourceCharCount >= 45000) {
        segmentCharLimit = 6800;
      }
      const translationKind: 'fast' | 'quality' = turboMode ? 'fast' : 'quality';
      const analysisKind: 'fast' | 'quality' = turboMode ? 'fast' : 'quality';
      const translationConcurrency = turboMode ? 2 : 1;
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

      if (detectedSections.length >= 2 && turboMode && lowQuotaMode) {
        setAILoadingMessage(`Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ tiết kiệm quota + dịch nhanh...`);
      } else if (detectedSections.length >= 2 && turboMode) {
        setAILoadingMessage(`Đã nhận diện ${effectiveUnits.length} chương. Bật chế độ dịch nhanh, đang phân tích nội dung...`);
      } else if (detectedSections.length >= 2) {
        setAILoadingMessage(`Đã nhận diện ${effectiveUnits.length} chương. Đang phân tích nội dung gốc...`);
      } else if (turboMode) {
        setAILoadingMessage("File lớn nên hệ thống bật chế độ dịch nhanh và tự chia đoạn. Đang phân tích nội dung...");
      } else {
        setAILoadingMessage("Chưa thấy mốc chương rõ ràng, hệ thống sẽ tự chia đoạn. Đang phân tích nội dung...");
      }

      // 1. Analyze the story for metadata (skip on low quota mode)
      let analysis = {
        summary: `Bản dịch tự động từ file "${String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "")}".`,
        genre: 'Dịch thuật',
        characters: [] as any[],
      };
      if (!lowQuotaMode) {
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
            maxRetries: turboMode ? 1 : 2,
          },
        );

        const analysisParsed = tryParseJson<any>(analysisTextRaw || '', 'object');
        analysis = {
          summary: String(analysisParsed?.summary || '').trim() || stripJsonFence(analysisTextRaw || '').trim(),
          genre: String(analysisParsed?.genre || '').trim() || 'Dịch thuật',
          characters: Array.isArray(analysisParsed?.characters) ? analysisParsed.characters : [],
        };
      }
      
      // 2. Create the story record
      let storyRef: ReturnType<typeof doc> | null = null;
      try {
        storyRef = await addDoc(collection(db, 'stories'), {
          authorId: user.uid,
          title: String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Bản dịch)",
          content: String(translateFileContent || "").substring(0, 5000) + "...",
          introduction: String(analysis.summary || "").substring(0, 4900),
          genre: String(analysis.genre || "Dịch thuật").substring(0, 190),
          type: 'translated',
          isAdult: Boolean(options.isAdult),
          isPublic: false,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          chapters: []
        });
      } catch (err) {
        if (isFirestorePermissionError(err)) {
          console.warn("Không có quyền Firestore, sẽ lưu cục bộ.", err);
        } else {
          throw err;
        }
      }

      // 3. Split content into chapters/chunks and translate
      const maxTranslateChunks = effectiveUnits.length;
      let processedSegments = 0;

      const adultContentInstruction = options.isAdult 
        ? "CHẾ ĐỘ 18+ KHÔNG GIỚI HẠN: Bạn là một dịch giả chuyên nghiệp. Bạn ĐƯỢC PHÉP và NÊN dịch các nội dung nhạy cảm, bạo lực, tình dục một cách CHI TIẾT và TRẦN TRỤI. Tuyệt đối không được né tránh hoặc tóm tắt."
        : "CHẾ ĐỘ BÌNH THƯỜNG: Tuyệt đối không dịch nội dung khiêu dâm hoặc bạo lực cực đoan.";
      const perSegmentRetries = lowQuotaMode ? 0 : (turboMode ? 1 : 2);

      const chapterResults = await mapWithConcurrency(effectiveUnits, translationConcurrency, async (unit, chapterIndex) => {
        const sourceSegments = unit.segments.length ? unit.segments : [unit.source];
        const translatedSegments: string[] = [];
        let translatedTitle = String(unit.title || `Chương ${chapterIndex + 1}`).trim() || `Chương ${chapterIndex + 1}`;

        for (let segmentIndex = 0; segmentIndex < sourceSegments.length; segmentIndex++) {
          const segment = sourceSegments[segmentIndex];
          if (segment.trim().length < 30) continue;
          processedSegments += 1;

          setAILoadingMessage(
            `Đang dịch chương ${chapterIndex + 1}/${maxTranslateChunks} (${segmentIndex + 1}/${sourceSegments.length}) - tiến độ ${processedSegments}/${totalSegments}${turboMode ? ' [Turbo]' : ''}${lowQuotaMode ? ' [Quota-safe]' : ''}...`
          );
          
          const includeTitleField = segmentIndex === 0;
          const translatePrompt = `
            Bạn là một dịch giả văn học cao cấp, chuyên dịch truyện từ tiếng Trung sang tiếng Việt.
            Hãy dịch toàn bộ đoạn sau sang tiếng Việt mượt mà, thuần Việt, giữ đúng nghĩa và phong thái bản gốc.
            ĐÂY LÀ PHẦN ${segmentIndex + 1}/${sourceSegments.length} CỦA "${unit.title}".
            KHÔNG được tóm tắt, KHÔNG bỏ đoạn, KHÔNG rút gọn.
            
            ${adultContentInstruction}
            ${dictionaryContext}
            YÊU CẦU BỔ SUNG: ${options.additionalInstructions}
            
            NỘI DUNG CẦN DỊCH:
            ${segment}
            
            Trả về JSON (không bọc bằng dấu 3 backtick):
            {
              ${includeTitleField ? '"title": "Tiêu đề chương (dịch sang tiếng Việt)",' : '"title": "",'}
              "content": "Nội dung phần đã dịch (Markdown)"
            }
          `;

          const dynamicMaxTokens = turboMode
            ? Math.min(10240, Math.max(2400, Math.round(segment.length * 1.2)))
            : Math.min(16384, Math.max(3200, Math.round(segment.length * 1.7)));
          const dynamicMinChars = turboMode
            ? Math.max(160, Math.round(segment.length * 0.15))
            : Math.max(240, Math.round(segment.length * 0.22));
          const translateTextRaw = await generateGeminiText(
            ai,
            translationKind,
            translatePrompt,
            { 
              responseMimeType: "application/json",
              maxOutputTokens: dynamicMaxTokens,
              minOutputChars: dynamicMinChars,
              maxRetries: perSegmentRetries,
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ]
            },
          );

          let translated = normalizeAiJsonContent(translateTextRaw || '', translatedTitle || `Chương ${chapterIndex + 1}`);
          const shortThreshold = turboMode
            ? Math.max(120, Math.round(dynamicMinChars * 0.55))
            : Math.max(180, Math.round(dynamicMinChars * 0.7));
          if (perSegmentRetries > 0 && translated.content.length < shortThreshold) {
            const retryPrompt = `${translatePrompt}\n\nYÊU CẦU BẮT BUỘC: Bản dịch trước quá ngắn. Hãy dịch đầy đủ toàn bộ đoạn nguồn, không tóm tắt, không rút gọn.`;
            const retryRaw = await generateGeminiText(ai, turboMode ? 'quality' : translationKind, retryPrompt, {
              responseMimeType: "application/json",
              maxOutputTokens: Math.min(16384, Math.round(dynamicMaxTokens * 1.35)),
              minOutputChars: Math.round(dynamicMinChars * 1.1),
              maxRetries: 1,
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ]
            });
            const retried = normalizeAiJsonContent(retryRaw || '', translatedTitle || `Chương ${chapterIndex + 1}`);
            if (retried.content.length > translated.content.length) translated = retried;
          }

          const parsedTitle = String(translated.title || '').trim();
          if (parsedTitle && (segmentIndex === 0 || /^chương\s*\d+$/i.test(translatedTitle))) {
            translatedTitle = parsedTitle;
          }
          if (translated.content.trim()) {
            translatedSegments.push(translated.content.trim());
          }
        }

        const mergedChapterContent = translatedSegments.join('\n\n').trim();
        if (!mergedChapterContent) return null;

        return {
          id: `tr-${Date.now()}-${chapterIndex}`,
          title: translatedTitle,
          content: mergedChapterContent,
          order: chapterIndex + 1,
          createdAt: Timestamp.now()
        } as Chapter;
      });
      const translatedChapters = chapterResults.filter((chapter): chapter is Chapter => Boolean(chapter));

      if (!translatedChapters.length) {
        throw new Error('Không thể nhận diện nội dung hợp lệ để dịch. Vui lòng kiểm tra lại file nguồn.');
      }

      if (storyRef) {
        try {
          await updateDoc(storyRef, {
            chapters: translatedChapters,
            updatedAt: Timestamp.now()
          });
        } catch (err) {
          if (isFirestorePermissionError(err)) {
            console.warn("Không có quyền Firestore khi cập nhật chương, đã lưu cục bộ.", err);
          } else {
            throw err;
          }
        }
      }

      // Save to local storage so it shows up in the UI
      const localChapters = normalizeChaptersForLocal(translatedChapters);
      const newStory = {
        id: storyRef ? storyRef.id : `local-${Date.now()}`,
        authorId: user.uid,
        title: String(translateFileName || "Truyện dịch").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Bản dịch)",
        content: String(translateFileContent || "").substring(0, 5000) + "...",
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: String(analysis.genre || "Dịch thuật").substring(0, 190),
        type: 'translated',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chapters: localChapters
      };
      const stories = storage.getStories();
      storage.saveStories([newStory, ...stories]);
      bumpStoriesVersion();

      const elapsedSeconds = Math.max(1, Math.round((Date.now() - translateStartedAt) / 1000));
      alert(`Đã dịch thành công ${translatedChapters.length} chương (${processedSegments} phân đoạn) trong ${elapsedSeconds}s${turboMode ? ' [Turbo]' : ''}.`);
      setView('stories');
    } catch (error) {
      console.error("Lỗi khi dịch truyện:", error);
      const rawMessage = error instanceof Error ? error.message : String(error || '');
      if (isQuotaOrRateLimitError(error)) {
        alert(`AI đang chạm giới hạn quota/rate limit.\n${rawMessage}\n\nBạn có thể đổi model trong phần API hoặc chờ quota reset rồi dịch lại.`);
      } else if (isTransientAiServiceError(error)) {
        alert(`Model AI đang quá tải tạm thời (503/high demand).\n${rawMessage}\n\nMình đã tự retry nhiều lần nhưng vẫn chưa ổn. Bạn thử lại sau 1-2 phút hoặc đổi model khác trong mục API.`);
      } else {
        alert(`Có lỗi xảy ra trong quá trình AI dịch truyện.\n${rawMessage.slice(0, 260)}`);
      }
    } finally {
      setIsProcessingAI(false);
      setAILoadingMessage('');
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
    setIsProcessingAI(true);
    setAILoadingMessage("Đang phân tích nội dung truyện...");

    try {
      let finalInstructions = options.additionalInstructions;
      if (options.selectedRuleId) {
        try {
          const ruleDoc = await getDocFromServer(doc(db, 'ai_rules', options.selectedRuleId));
          if (ruleDoc.exists()) {
            finalInstructions = ruleDoc.data().content + "\n\n" + finalInstructions;
          }
        } catch (e) {
          console.warn("Could not fetch AI rule", e);
        }
      }

      const ai = createGeminiClient();
      
      // 1. Analyze the story
      const analysisPrompt = `
        Hãy phân tích nội dung truyện sau đây:
        "${continueFileContent.substring(0, 15000)}"
        
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
        'quality',
        analysisPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: 3200,
          minOutputChars: 260,
          maxRetries: 2,
        },
      ) || '{}';
      const analysisParsed = tryParseJson<any>(analysisText, 'object') || {};
      const analysis = {
        summary: String(analysisParsed.summary || '').trim() || String(analysisText || '').trim(),
        writingStyle: String(analysisParsed.writingStyle || '').trim(),
        characters: Array.isArray(analysisParsed.characters) ? analysisParsed.characters : [],
        currentContext: String(analysisParsed.currentContext || '').trim(),
      };
      setAILoadingMessage("Đang lập kế hoạch các chương tiếp theo...");

      // 2. Plan next chapters
      const planPrompt = `
        Dựa trên phân tích sau:
        Tóm tắt: ${analysis.summary}
        Văn phong: ${analysis.writingStyle}
        Bối cảnh hiện tại: ${analysis.currentContext}
        
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
        'quality',
        planPrompt,
        {
          responseMimeType: "application/json",
          maxOutputTokens: Math.min(5200, Math.max(1600, options.chapterCount * 700)),
          minOutputChars: Math.max(200, options.chapterCount * 70),
          maxRetries: 2,
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
      
      // 3. Create the story
      const storyRef = await addDoc(collection(db, 'stories'), {
        authorId: user.uid,
        title: String(continueFileName || "Truyện viết tiếp").replace(/\.[^/.]+$/, "").substring(0, 480) + " (Viết tiếp)",
        content: String(continueFileContent || "").substring(0, 5000) + "...", // Store a snippet as content
        introduction: String(analysis.summary || "").substring(0, 4900),
        genre: "Viết tiếp",
        type: 'continued',
        isAdult: Boolean(options.isAdult),
        isPublic: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        chapters: []
      });

      // 4. Generate chapters
      const generatedChapters: Chapter[] = [];
      const minChapterWords = 1800;
      const chapterMaxTokens = Math.min(16384, Math.max(3600, Math.round(minChapterWords * 2.4)));
      const minChapterChars = Math.max(1100, Math.round(minChapterWords * 2.2));
      for (let i = 0; i < plannedChapters.length; i++) {
        const ch = plannedChapters[i];
        setAILoadingMessage(`Đang viết chương ${i + 1}/${plannedChapters.length}: ${ch.title}...`);
        
        const chapterPrompt = `
          Hãy viết chương "${ch.title}" cho truyện dựa trên các thông tin sau:
          
          Tóm tắt truyện: ${analysis.summary}
          Văn phong yêu cầu: ${analysis.writingStyle}
          Nhân vật: ${JSON.stringify(analysis.characters)}
          Bối cảnh hiện tại: ${analysis.currentContext}
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
          'quality',
          chapterPrompt,
          {
            maxOutputTokens: chapterMaxTokens,
            minOutputChars: minChapterChars,
            maxRetries: 2,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
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
              ]
            },
          );
        }

        generatedChapters.push({
          id: `ch-${Date.now()}-${i}`,
          title: ch.title,
          content: chapterText || '',
          order: i + 1,
          createdAt: Timestamp.now()
        });
      }

      await updateDoc(storyRef, {
        chapters: generatedChapters,
        updatedAt: Timestamp.now()
      });

      // Save to local storage so it shows up in the UI
      const localChapters = normalizeChaptersForLocal(generatedChapters);
      const newStory = {
        id: storyRef.id,
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
      const stories = storage.getStories();
      storage.saveStories([newStory, ...stories]);
      bumpStoriesVersion();

      alert(`Đã viết tiếp thành công ${options.chapterCount} chương!`);
      setView('stories');
    } catch (error) {
      console.error("Lỗi khi viết tiếp truyện:", error);
      alert("Có lỗi xảy ra trong quá trình AI viết tiếp truyện.");
    } finally {
      setIsProcessingAI(false);
      setAILoadingMessage('');
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
    selectedRuleId?: string
  }) => {
    const { 
      outline, chapterLength, chapterCount, isAdult, pacing, tone, focus, predictPlot,
      customPacing, customTone, customFocus, selectedCharacters, keyEvents, previousContext,
      perspective, audience, styleReference, aiInstructions, chapterScript, selectedRuleId
    } = options;
    if (!user || !selectedStory) return;
    setShowAIGen(false);
    setIsProcessingAI(true);
    setAiTimer(0);
    setAILoadingMessage("Đang chuẩn bị dữ liệu...");

    try {
      let finalInstructions = aiInstructions;
      if (selectedRuleId) {
        try {
          const ruleDoc = await getDocFromServer(doc(db, 'ai_rules', selectedRuleId));
          if (ruleDoc.exists()) {
            finalInstructions = ruleDoc.data().content + "\n\n" + finalInstructions;
          }
        } catch (e) {
          console.warn("Could not fetch AI rule", e);
        }
      }

      // Fetch character details
      let charContext = "";
      if (selectedCharacters.length > 0) {
        const charDocs = await getDocs(query(collection(db, 'characters'), where('authorId', '==', user.uid)));
        const selectedChars = charDocs.docs
          .map(d => ({ id: d.id, ...d.data() } as Character))
          .filter(c => selectedCharacters.includes(c.id));
        
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

        BỐI CẢNH VÀ NHÂN VẬT:
        ${charContext ? `THÔNG TIN NHÂN VẬT THAM CHIẾU:\n${charContext}\n` : ""}
        ${previousContext ? `BỐI CẢNH THỰC TẾ CỦA CHƯƠNG TRƯỚC (Hãy viết tiếp từ đây):\n${previousContext}\n` : ""}
        ${keyEvents ? `CÁC SỰ KIỆN CHÍNH CẦN XẢY RA TRONG CHƯƠNG NÀY:\n${keyEvents}\n` : ""}

        YÊU CẦU VỀ ĐỘ DÀI VÀ CHI TIẾT:
        - Mỗi chương PHẢI đạt tối thiểu ${chapterLength} từ. Đây là yêu cầu bắt buộc.
        - Tuyệt đối KHÔNG ĐƯỢC tóm tắt diễn biến. Hãy viết chi tiết từng hành động, từng lời nói, từng suy nghĩ.
        - Nếu bạn viết quá ngắn hoặc quá sơ sài, bạn đang vi phạm yêu cầu công việc. Hãy mở rộng các tình tiết một cách tối đa.
        
        HƯỚNG DẪN VIẾT CHI TIẾT:
        1. Miêu tả bối cảnh: Đừng chỉ nói "họ đang ở trong rừng", hãy miêu tả âm thanh của lá cây, mùi hương của đất ẩm, ánh sáng xuyên qua kẽ lá.
        2. Nội tâm nhân vật: Đào sâu vào suy nghĩ, cảm xúc, sự mâu thuẫn và những tính toán thầm kín của nhân vật.
        3. Đối thoại: Xây dựng các cuộc đối thoại tự nhiên, có phong cách riêng cho từng nhân vật.
        4. Nhịp độ: Đừng đẩy tình tiết đi quá nhanh. Hãy để các sự kiện diễn ra một cách từ tốn và có logic.
        5. TÍNH LIÊN TỤC: Đảm bảo chương mới kết nối mượt mà với nội dung thực tế của chương trước đó.
        
        Dàn ý tổng quát: ${outline}
        Thể loại truyện: ${selectedStory.genre || 'Tự do'}
        Tiêu đề truyện: ${selectedStory.title}
        Số chương hiện tại: ${selectedStory.chapters?.length || 0}
        
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
          ]
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

      const currentChapters = selectedStory.chapters || [];
      const nextOrder = currentChapters.length + 1;
      
      const newChapters = newChaptersData.map((c, i) => {
        const sourceTitle = typeof c === 'object' && c ? String((c as any).title || '').trim() : '';
        const sourceContent = typeof c === 'object' && c ? String((c as any).content || '') : String(c || '');
        const normalizedChapter = normalizeAiJsonContent(sourceContent, sourceTitle || `Chương mới ${i + 1}`);
        const chapter: any = {
          id: Math.random().toString(36).substr(2, 9),
          title: String(sourceTitle || normalizedChapter.title || `Chương mới ${i + 1}`),
          content: String(normalizedChapter.content || sourceContent || '').replace(/\]\s*\[/g, ']\n\n['), // Tự động xuống dòng đôi giữa các ngoặc vuông để Markdown nhận diện
          order: nextOrder + i,
          createdAt: Timestamp.now(),
        };
        if (i === 0 && aiInstructions) chapter.aiInstructions = aiInstructions;
        if (i === 0 && chapterScript) chapter.script = chapterScript;
        return chapter;
      });

      const updatedChapters = [...currentChapters, ...newChapters];
      
      await updateDoc(doc(db, 'stories', selectedStory.id), {
        chapters: updatedChapters,
        updatedAt: Timestamp.now(),
      });

      // Save to local storage
      const stories = storage.getStories();
      const updatedStory: Story = {
        ...selectedStory,
        chapters: normalizeChaptersForLocal(updatedChapters),
        updatedAt: new Date().toISOString(),
      };
      const newList = stories.map(s => s.id === selectedStory.id ? updatedStory : s);
      storage.saveStories(newList);
      bumpStoriesVersion();

      setSelectedStory(updatedStory);

      alert(`Đã tạo thành công ${newChapters.length} chương mới!`);
    } catch (error) {
      console.error("AI Generation Error:", error);
      alert(error instanceof Error ? error.message : "Có lỗi xảy ra khi tạo chương bằng AI.");
    } finally {
      setIsProcessingAI(false);
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
        chapters: normalizeChaptersForLocal((data.chapters || editingStory.chapters || []) as Chapter[]),
        updatedAt: new Date().toISOString(),
      };
      newList = stories.map(s => s.id === editingStory.id ? updatedStory : s);
    } else {
      const newStory: Story = {
        id: `story-${Date.now()}`,
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
        ...data
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
    setIsProcessingAI(true);

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
          ]
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
            ]
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
        let storyId = `local-${Date.now()}`;
        try {
          const storyRef = await addDoc(collection(db, 'stories'), {
            authorId: user.uid,
            title: resolvedTitle.substring(0, 480),
            content: resolvedContent.replace(/\]\s*\[/g, ']\n\n[').substring(0, 1999900), // Tự động xuống dòng đôi giữa các ngoặc vuông để Markdown nhận diện
            genre: String(genre || 'Tự do').substring(0, 190),
            isAdult: Boolean(isAdult),
            isPublic: false,
            isAI: true,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
          storyId = storyRef.id;
        } catch (err) {
          if (isFirestorePermissionError(err)) {
            console.warn("Không có quyền Firestore, sẽ lưu cục bộ.", err);
          } else {
            throw err;
          }
        }

        // Save to local storage
        const newStory = {
          id: storyId,
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
        const stories = storage.getStories();
        storage.saveStories([newStory, ...stories]);
        bumpStoriesVersion();

        alert("AI đã tạo truyện thành công từ file của bạn!");
      } else {
        throw new Error("Không nhận được phản hồi hợp lệ từ AI. Hãy kiểm tra kết nối Relay hoặc khóa API.");
      }
    } catch (error) {
      console.error("AI Creation failed", error);
      alert(`Lỗi khi xử lý AI: ${error instanceof Error ? error.message : "Lỗi không xác định"}`);
    } finally {
      setIsProcessingAI(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center font-serif">Đang khởi động...</div>;

  return (
    <div className={cn(
      'app-shell min-h-screen',
      viewportMode === 'mobile' ? 'app-shell--mobile' : 'app-shell--desktop',
      themeMode === 'dark' ? 'night-bg text-slate-100' : 'day-bg text-slate-900'
    )}>
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
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
        onSelect={(prompt) => {
          try {
            navigator.clipboard?.writeText(prompt);
          } catch {
            // ignore
          }
          alert('Đã sao chép prompt vào clipboard.');
        }}
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
        <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg tf-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Thiết lập cá nhân</h3>
              <button className="tf-btn tf-btn-ghost px-3 py-1" onClick={() => setShowProfileModal(false)}>Đóng</button>
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
                className="tf-input"
                value={profileAvatarDraft}
                onChange={(e) => setProfileAvatarDraft(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="tf-btn tf-btn-ghost" onClick={() => setShowProfileModal(false)}>Hủy</button>
              <button
                className="tf-btn tf-btn-primary"
                onClick={() => {
                  setProfile({ displayName: profileNameDraft, avatarUrl: profileAvatarDraft });
                  setShowProfileModal(false);
                }}
              >
                Lưu
              </button>
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
        }} 
        onShowHelp={() => setShowHelp(true)} 
        onHome={() => {
          setView('stories');
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(false);
        }}
        onCreateStory={() => {
          setSelectedStory(null);
          setEditingStory(null);
          setIsCreating(true);
        }}
        themeMode={themeMode}
        onToggleTheme={handleToggleTheme}
        viewportMode={viewportMode}
        onToggleViewportMode={handleToggleViewportMode}
        profile={profile}
        finopsWarning={finopsWarning}
        authEmail={user?.email}
        onShowAuth={() => setShowAuthModal(true)} 
        onLogout={logout}
        onOpenProfile={() => setShowProfileModal(true)} 
        onOpenPromptManager={() => setShowPromptManager(true)}
      />

      <div className="app-shell__body">
      <AnimatePresence mode="wait">
        {selectedStory ? (
          <StoryDetail 
            story={selectedStory} 
            onBack={() => setSelectedStory(null)}
            onEdit={() => {
              setEditingStory(selectedStory);
              setSelectedStory(null);
            }}
            onAddChapter={() => setShowAIGen(true)}
            onUpdateStory={(updated) => setSelectedStory(updated)}
            onExportStory={handleOpenExportStory}
          />
        ) : view === 'characters' ? (
          <CharacterManager key="characters" onBack={() => setView('stories')} onRequireAuth={() => setShowAuthModal(true)} />
        ) : view === 'api' ? (
          <ToolsManager
            key="api"
            section="api"
            onBack={() => setView('stories')}
            onRequireAuth={() => setShowAuthModal(true)}
            profile={profile}
            onSaveProfile={setProfile}
          />
        ) : view === 'tools' ? (
          <ToolsManager
            key="tools"
            section="tools"
            onBack={() => setView('stories')}
            onRequireAuth={() => setShowAuthModal(true)}
            profile={profile}
            onSaveProfile={setProfile}
          />
        ) : (isCreating || editingStory) ? (
          <StoryEditor 
            key="editor"
            story={editingStory || undefined}
            onSave={handleSaveStory}
            onCancel={() => {
              setEditingStory(null);
              setIsCreating(false);
            }}
          />
        ) : (
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
                  <p className="max-w-xl text-sm md:text-base text-slate-600">
                    Điều hướng chính nằm trên thanh đầu trang. Dùng thanh tác vụ nhanh ở góc trái để mở ngay Trang chủ, Nhân vật, API hoặc Công cụ.
                  </p>
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
                        e.target.value = ''; // Reset input
                      }
                    }}
                    className="hidden" 
                    accept=".docx,.txt,.json"
                  />
                </div>
              </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 mb-10">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="text-xl font-serif font-bold text-slate-900">Bắt đầu nhanh</h3>
                  <span className="text-xs px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-semibold">Hướng dẫn nhanh</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                    <p className="font-bold text-slate-800 mb-1">1. Chuẩn bị trong API</p>
                    <p className="text-slate-600">Mở <b>API</b>, thêm khóa, mã đăng nhập Google hoặc kết nối trung chuyển rồi chọn model bạn muốn dùng.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                    <p className="font-bold text-slate-800 mb-1">2. Chọn workflow AI</p>
                    <p className="text-slate-600">Dùng nút <b>AI từ file</b> để chọn nhanh Dịch truyện hoặc Viết tiếp.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                    <p className="font-bold text-slate-800 mb-1">3. Cá nhân hóa UI</p>
                    <p className="text-slate-600">Đổi tên, avatar và chuyển ngày/đêm để dùng thoải mái hơn.</p>
                  </div>
                </div>
              </div>
            </div>
             
            <StoryList refreshKey={storiesVersion} onView={setSelectedStory} />
          </motion.div>
        )}
      </AnimatePresence>
      </div>

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

      <AILoadingOverlay 
        isVisible={isProcessingAI}
        message={aiLoadingMessage}
        timer={aiTimer}
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
              <p className={themeMode === 'dark' ? 'text-slate-400' : 'text-xs text-slate-500'}>© 2026 TruyenForge · Người vận hành: ductruong.lynx@gmail.com</p>
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
    <AuthProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </AuthProvider>
  );
}
