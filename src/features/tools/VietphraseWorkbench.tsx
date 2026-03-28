import React from "react";
import { TFButton } from "../../ui/buttons";
import { TFInput, TFTextarea } from "../../ui/inputs";
import { TFAlert } from "./common/TFAlert";
import { notifyApp } from "../../notifications";
import { storage } from "../../storage";
import { getScopedStorageItem, setScopedStorageItem, shouldAllowLegacyScopeFallback } from "../../workspaceScope";
import {
  buildDictionaryBundle,
  convertChineseToVietnamese,
  createDefaultTranslateOptions,
  loadBundledDictionaries,
  parseUploadedDictionary,
  type DictionaryBundle,
  type DictionaryKind,
  type LuatNhanScope,
  type NameScopePriority,
  type NameVpPriority,
  type SplitMode,
  type TranslateOptions,
  type VpPreference,
} from "./vietphraseLocal";

type StoryLanguage = "zh" | "vi";

type LocalStoryDoc = {
  id: string;
  title: string;
  language: StoryLanguage;
  editedText: string;
  createdAt: string;
  updatedAt: string;
};

type StoredSettings = {
  defaultLanguage: StoryLanguage;
  useBundled: Record<DictionaryKind, boolean>;
  options: TranslateOptions;
};

type DictionaryMeta = {
  fileName: string;
  warnings: string[];
  entryCount: number;
};

const STORY_DOCS_KEY = "tools_story_docs_v1";
const SETTINGS_KEY = "tools_story_translate_settings_v1";

const dictionaryLabels: Record<DictionaryKind, string> = {
  vp: "VietPhrase (VP)",
  name: "Name (NE)",
  pronouns: "Pronouns",
  hv: "ChinesePhienAmWords (HV)",
  luatNhan: "Luật Nhân",
};

const defaultUseBundled: Record<DictionaryKind, boolean> = {
  vp: true,
  name: true,
  pronouns: true,
  hv: true,
  luatNhan: true,
};

function readJsonSafe<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadStoredDocs(): LocalStoryDoc[] {
  const raw = getScopedStorageItem(STORY_DOCS_KEY, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
  const parsed = readJsonSafe<LocalStoryDoc[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((doc): LocalStoryDoc => ({
      id: String(doc?.id || `doc-${Date.now()}`),
      title: String(doc?.title || "Truyện chưa đặt tên").trim() || "Truyện chưa đặt tên",
      language: doc?.language === "vi" ? "vi" : "zh",
      editedText: String(doc?.editedText || ""),
      createdAt: String(doc?.createdAt || new Date().toISOString()),
      updatedAt: String(doc?.updatedAt || new Date().toISOString()),
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function loadStoredSettings(): StoredSettings {
  const fallback: StoredSettings = {
    defaultLanguage: "zh",
    useBundled: defaultUseBundled,
    options: createDefaultTranslateOptions(),
  };
  const raw = getScopedStorageItem(SETTINGS_KEY, {
    allowLegacyFallback: shouldAllowLegacyScopeFallback(),
  });
  const parsed = readJsonSafe<StoredSettings>(raw);
  if (!parsed || typeof parsed !== "object") return fallback;
  const mergedOptions: TranslateOptions = {
    ...fallback.options,
    ...(parsed.options || {}),
    maxPhraseLength: Number(parsed.options?.maxPhraseLength || fallback.options.maxPhraseLength),
  };
  return {
    defaultLanguage: parsed.defaultLanguage === "vi" ? "vi" : "zh",
    useBundled: {
      ...defaultUseBundled,
      ...(parsed.useBundled || {}),
    },
    options: mergedOptions,
  };
}

function toStoryScopedNameMap(): Map<string, string> {
  const rows = storage.getTranslationNames();
  const map = new Map<string, string>();
  rows.forEach((row: { original?: string; translation?: string }) => {
    const original = String(row?.original || "").trim();
    const translation = String(row?.translation || "").trim();
    if (!original || !translation) return;
    map.set(original, translation);
  });
  return map;
}

async function readFileTextSmart(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    const gb = new TextDecoder("gb18030", { fatal: false }).decode(bytes);
    if (gb && !gb.includes("\uFFFD")) return gb;
    return gb || utf8;
  } catch {
    return utf8;
  }
}

const initialCustomMap: Record<DictionaryKind, Map<string, string>> = {
  vp: new Map(),
  name: new Map(),
  pronouns: new Map(),
  hv: new Map(),
  luatNhan: new Map(),
};

const initialCustomMeta: Record<DictionaryKind, DictionaryMeta> = {
  vp: { fileName: "", warnings: [], entryCount: 0 },
  name: { fileName: "", warnings: [], entryCount: 0 },
  pronouns: { fileName: "", warnings: [], entryCount: 0 },
  hv: { fileName: "", warnings: [], entryCount: 0 },
  luatNhan: { fileName: "", warnings: [], entryCount: 0 },
};

export const VietphraseWorkbench: React.FC = () => {
  const [docs, setDocs] = React.useState<LocalStoryDoc[]>(() => loadStoredDocs());
  const [activeDocId, setActiveDocId] = React.useState<string>("");
  const [convertedText, setConvertedText] = React.useState("");
  const [bundled, setBundled] = React.useState<DictionaryBundle | null>(null);
  const [loadingBundled, setLoadingBundled] = React.useState(false);
  const [customMaps, setCustomMaps] = React.useState<Record<DictionaryKind, Map<string, string>>>(initialCustomMap);
  const [customMeta, setCustomMeta] = React.useState<Record<DictionaryKind, DictionaryMeta>>(initialCustomMeta);
  const settings = React.useMemo(() => loadStoredSettings(), []);
  const [defaultLanguage, setDefaultLanguage] = React.useState<StoryLanguage>(settings.defaultLanguage);
  const [useBundled, setUseBundled] = React.useState<Record<DictionaryKind, boolean>>(settings.useBundled);
  const [options, setOptions] = React.useState<TranslateOptions>(settings.options);

  const activeDoc = docs.find((doc) => doc.id === activeDocId) || null;
  const storyNameMap = React.useMemo(() => toStoryScopedNameMap(), [docs.length]);

  React.useEffect(() => {
    if (!activeDocId && docs.length) {
      setActiveDocId(docs[0].id);
    }
  }, [activeDocId, docs]);

  React.useEffect(() => {
    const payload: StoredSettings = { defaultLanguage, useBundled, options };
    setScopedStorageItem(SETTINGS_KEY, JSON.stringify(payload));
  }, [defaultLanguage, options, useBundled]);

  const persistDocs = React.useCallback((nextDocs: LocalStoryDoc[]) => {
    setDocs(nextDocs);
    setScopedStorageItem(STORY_DOCS_KEY, JSON.stringify(nextDocs));
  }, []);

  const loadDefaultDictionaries = React.useCallback(async () => {
    setLoadingBundled(true);
    try {
      const data = await loadBundledDictionaries();
      setBundled(data);
      if (data.warnings.length) {
        notifyApp({ tone: "warn", message: `Bộ từ điển mặc định tải kèm cảnh báo: ${data.warnings[0]}` });
      } else {
        notifyApp({ tone: "success", message: "Đã nạp bộ từ điển mặc định." });
      }
    } catch {
      notifyApp({ tone: "warn", message: "Không thể tải bộ từ điển mặc định." });
    } finally {
      setLoadingBundled(false);
    }
  }, []);

  React.useEffect(() => {
    loadDefaultDictionaries();
  }, [loadDefaultDictionaries]);

  const handleCreateEmptyDoc = React.useCallback(() => {
    const now = new Date().toISOString();
    const doc: LocalStoryDoc = {
      id: `doc-${Date.now()}`,
      title: `Truyện mới ${new Date().toLocaleTimeString("vi-VN")}`,
      language: defaultLanguage,
      editedText: "",
      createdAt: now,
      updatedAt: now,
    };
    const next = [doc, ...docs];
    persistDocs(next);
    setActiveDocId(doc.id);
    setConvertedText("");
  }, [defaultLanguage, docs, persistDocs]);

  const handleUploadStories = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      const created: LocalStoryDoc[] = [];
      for (const file of files) {
        const text = await readFileTextSmart(file);
        const now = new Date().toISOString();
        created.push({
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: file.name.replace(/\.[^/.]+$/, "") || "Truyện tải lên",
          language: defaultLanguage,
          editedText: text,
          createdAt: now,
          updatedAt: now,
        });
      }
      const next = [...created, ...docs];
      persistDocs(next);
      setActiveDocId(created[0].id);
      setConvertedText("");
      event.target.value = "";
      notifyApp({ tone: "success", message: `Đã tải ${created.length} truyện vào kho chỉnh sửa.` });
    },
    [defaultLanguage, docs, persistDocs],
  );

  const updateActiveDoc = React.useCallback(
    (patch: Partial<LocalStoryDoc>) => {
      if (!activeDoc) return;
      const next = docs.map((doc) =>
        doc.id === activeDoc.id
          ? {
              ...doc,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : doc,
      );
      persistDocs(next);
    },
    [activeDoc, docs, persistDocs],
  );

  const handleDeleteDoc = React.useCallback(
    (docId: string) => {
      const next = docs.filter((doc) => doc.id !== docId);
      persistDocs(next);
      if (activeDocId === docId) {
        setActiveDocId(next[0]?.id || "");
      }
      setConvertedText("");
    },
    [activeDocId, docs, persistDocs],
  );

  const handleUploadDictionary = React.useCallback(async (kind: DictionaryKind, file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseUploadedDictionary(kind, bytes);
    setCustomMaps((prev) => ({ ...prev, [kind]: parsed.map }));
    setCustomMeta((prev) => ({
      ...prev,
      [kind]: {
        fileName: file.name,
        warnings: parsed.warnings,
        entryCount: parsed.map.size,
      },
    }));
    notifyApp({ tone: "success", message: `Đã nạp ${kind.toUpperCase()} custom: ${parsed.map.size} mục.` });
  }, []);

  const effectiveBundle = React.useMemo(() => {
    if (!bundled) return null;
    return buildDictionaryBundle(bundled, customMaps, useBundled);
  }, [bundled, customMaps, useBundled]);

  const handleConvert = React.useCallback(() => {
    if (!activeDoc) {
      notifyApp({ tone: "warn", message: "Chọn truyện trước khi chạy convert." });
      return;
    }
    if (!effectiveBundle) {
      notifyApp({ tone: "warn", message: "Bộ từ điển chưa sẵn sàng." });
      return;
    }
    if (!activeDoc.editedText.trim()) {
      notifyApp({ tone: "warn", message: "Nội dung đang trống." });
      return;
    }
    if (activeDoc.language === "vi") {
      setConvertedText(activeDoc.editedText);
      notifyApp({ tone: "info", message: "Bản thảo đang là tiếng Việt, giữ nguyên nội dung." });
      return;
    }
    const output = convertChineseToVietnamese(activeDoc.editedText, options, effectiveBundle, storyNameMap);
    setConvertedText(output);
    notifyApp({ tone: "success", message: "Đã convert Trung -> Việt bằng bộ từ điển local." });
  }, [activeDoc, effectiveBundle, options, storyNameMap]);

  const bundleCount = (kind: DictionaryKind) => {
    if (!effectiveBundle) return 0;
    return effectiveBundle[kind].size;
  };

  return (
    <section className="space-y-4">
      <div className="tf-card p-4 md:p-5 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Tải truyện & chỉnh sửa trực tiếp</h3>
            <p className="tf-body">
              Bạn có thể tải truyện vào kho cục bộ, đọc/chỉnh sửa trực tiếp và convert Trung → Việt bằng kho từ điển.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300">Ngôn ngữ mặc định:</label>
            <select
              value={defaultLanguage}
              onChange={(event) => setDefaultLanguage(event.target.value === "vi" ? "vi" : "zh")}
              className="tf-input py-2"
            >
              <option value="zh">Text tiếng Trung</option>
              <option value="vi">Text tiếng Việt</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TFButton variant="primary" onClick={handleCreateEmptyDoc}>
            Tạo truyện trống
          </TFButton>
          <label className="tf-btn tf-btn-ghost cursor-pointer">
            Tải truyện từ máy
            <input type="file" accept=".txt,.md,.text" multiple className="hidden" onChange={handleUploadStories} />
          </label>
          <TFButton variant="ghost" onClick={loadDefaultDictionaries} disabled={loadingBundled}>
            {loadingBundled ? "Đang tải từ điển..." : "Tải lại bộ mặc định"}
          </TFButton>
        </div>
      </div>

      <section className="grid lg:grid-cols-[minmax(280px,360px)_1fr] gap-4">
        <div className="tf-card p-4 space-y-3">
          <h4 className="text-base font-semibold">Kho truyện đã tải</h4>
          <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
            {!docs.length ? (
              <p className="text-sm text-slate-400">Chưa có truyện nào trong kho.</p>
            ) : (
              docs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setActiveDocId(doc.id);
                    setConvertedText("");
                  }}
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                    activeDocId === doc.id
                      ? "border-indigo-400/60 bg-indigo-500/10"
                      : "border-white/10 bg-slate-950/30 hover:border-indigo-400/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{doc.title}</p>
                    <span className="text-[10px] uppercase text-cyan-200">{doc.language === "zh" ? "Trung" : "Việt"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Cập nhật: {new Date(doc.updatedAt).toLocaleString("vi-VN")}
                  </p>
                  <div className="mt-2 flex justify-end">
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteDoc(doc.id);
                      }}
                      className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                    >
                      Xóa
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="tf-card p-4 space-y-3">
            <h4 className="text-base font-semibold">Tuỳ chọn dịch Trung → Việt</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">1. Ưu tiên Name / VP</span>
                <select
                  className="tf-input py-2"
                  value={options.nameVpPriority}
                  onChange={(event) => setOptions((prev) => ({ ...prev, nameVpPriority: event.target.value as NameVpPriority }))}
                >
                  <option value="name-vp">Name - VP</option>
                  <option value="vp-name">VP - Name</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">2. Name riêng truyện / kho Name</span>
                <select
                  className="tf-input py-2"
                  value={options.nameScopePriority}
                  onChange={(event) => setOptions((prev) => ({ ...prev, nameScopePriority: event.target.value as NameScopePriority }))}
                >
                  <option value="story-first">Name riêng truyện trước</option>
                  <option value="global-first">Kho Name trước</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">3. Ưu tiên VP</span>
                <select
                  className="tf-input py-2"
                  value={options.vpPreference}
                  onChange={(event) => setOptions((prev) => ({ ...prev, vpPreference: event.target.value as VpPreference }))}
                >
                  <option value="prefer-long">Ưu tiên VP dài nhất</option>
                  <option value="none">Không ưu tiên độ dài</option>
                  <option value="min4">Ưu tiên VP &gt;= 4 ký tự</option>
                  <option value="min5">Ưu tiên VP &gt;= 5 ký tự</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">4. Áp dụng Luật Nhân</span>
                <select
                  className="tf-input py-2"
                  value={options.luatNhanScope}
                  onChange={(event) => setOptions((prev) => ({ ...prev, luatNhanScope: event.target.value as LuatNhanScope }))}
                >
                  <option value="off">Không áp dụng</option>
                  <option value="names">Names</option>
                  <option value="names-pronouns">Names + Pronouns</option>
                  <option value="names-pronouns-vp">Names + Pronouns + VP</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">5. Cụm từ dài nhất</span>
                <TFInput
                  type="number"
                  min={4}
                  max={24}
                  value={options.maxPhraseLength}
                  onChange={(event) => setOptions((prev) => ({ ...prev, maxPhraseLength: Number(event.target.value || 12) }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-300">5b. Chia đoạn</span>
                <select
                  className="tf-input py-2"
                  value={options.splitMode}
                  onChange={(event) => setOptions((prev) => ({ ...prev, splitMode: event.target.value as SplitMode }))}
                >
                  <option value="sentence">Theo câu</option>
                  <option value="paragraph">Theo đoạn</option>
                </select>
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={options.convertTraditional}
                onChange={(event) => setOptions((prev) => ({ ...prev, convertTraditional: event.target.checked }))}
              />
              6. Tự động chuyển chữ Phồn sang Giản trước khi dịch
            </label>
          </div>

          <div className="tf-card p-4 space-y-3">
            <h4 className="text-base font-semibold">Nguồn từ điển (mặc định hoặc tự tải lên)</h4>
            <div className="grid md:grid-cols-2 gap-3">
              {(Object.keys(dictionaryLabels) as DictionaryKind[]).map((kind) => (
                <div key={kind} className="rounded-2xl border border-white/10 bg-slate-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{dictionaryLabels[kind]}</p>
                    <label className="text-xs text-slate-300 inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(useBundled[kind])}
                        onChange={(event) =>
                          setUseBundled((prev) => ({
                            ...prev,
                            [kind]: event.target.checked,
                          }))
                        }
                      />
                      Dùng file mặc định
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">Đang dùng: {bundleCount(kind).toLocaleString("vi-VN")} mục</p>
                  <label className="text-xs text-cyan-200 cursor-pointer hover:text-cyan-100">
                    Tải file custom
                    <input
                      type="file"
                      accept=".txt,.dic,.text"
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        await handleUploadDictionary(kind, file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {customMeta[kind].fileName ? (
                    <div className="text-[11px] text-slate-300">
                      <p>Custom: {customMeta[kind].fileName}</p>
                      <p>{customMeta[kind].entryCount.toLocaleString("vi-VN")} mục</p>
                      {customMeta[kind].warnings[0] ? <p className="text-amber-300">{customMeta[kind].warnings[0]}</p> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <TFAlert tone="warn">
              Với file `.dic` nhị phân cũ, app sẽ tự đọc theo khả năng tối đa; nếu muốn chính xác tuyệt đối, nên import bản `.txt` cùng nội dung.
            </TFAlert>
          </div>
        </div>
      </section>

      <section className="tf-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <TFButton variant="primary" onClick={handleConvert} disabled={!activeDoc}>
            Convert Trung → Việt
          </TFButton>
          <TFButton
            variant="ghost"
            onClick={() => {
              if (!activeDoc) return;
              updateActiveDoc({ editedText: convertedText || activeDoc.editedText });
              notifyApp({ tone: "success", message: "Đã áp dụng kết quả convert vào bản thảo." });
            }}
            disabled={!activeDoc || !convertedText}
          >
            Áp dụng kết quả vào bản thảo
          </TFButton>
          <TFButton
            variant="ghost"
            onClick={async () => {
              if (!convertedText) return;
              try {
                await navigator.clipboard.writeText(convertedText);
                notifyApp({ tone: "success", message: "Đã copy kết quả convert." });
              } catch {
                notifyApp({ tone: "warn", message: "Không thể copy tự động. Hãy copy thủ công." });
              }
            }}
            disabled={!convertedText}
          >
            Copy kết quả
          </TFButton>
        </div>

        {!activeDoc ? (
          <TFAlert tone="warn">Hãy tạo mới hoặc tải truyện lên để bắt đầu chỉnh sửa.</TFAlert>
        ) : (
          <div className="grid xl:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TFInput
                  value={activeDoc.title}
                  onChange={(event) => updateActiveDoc({ title: event.target.value })}
                  placeholder="Tên truyện"
                />
                <select
                  className="tf-input py-2 max-w-[140px]"
                  value={activeDoc.language}
                  onChange={(event) => updateActiveDoc({ language: event.target.value === "vi" ? "vi" : "zh" })}
                >
                  <option value="zh">Tiếng Trung</option>
                  <option value="vi">Tiếng Việt</option>
                </select>
              </div>
              <TFTextarea
                value={activeDoc.editedText}
                onChange={(event) => updateActiveDoc({ editedText: event.target.value })}
                rows={18}
                placeholder="Nội dung truyện để đọc/chỉnh sửa trực tiếp..."
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-200">Kết quả convert</p>
              <TFTextarea
                value={convertedText}
                onChange={(event) => setConvertedText(event.target.value)}
                rows={18}
                placeholder="Kết quả sẽ xuất hiện ở đây sau khi convert..."
              />
            </div>
          </div>
        )}
      </section>
    </section>
  );
};
