const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });

export type DictionaryKind = "vp" | "name" | "pronouns" | "hv" | "luatNhan";
export type NameVpPriority = "name-vp" | "vp-name";
export type NameScopePriority = "story-first" | "global-first";
export type VpPreference = "prefer-long" | "none" | "min4" | "min5";
export type LuatNhanScope = "off" | "names" | "names-pronouns" | "names-pronouns-vp";
export type SplitMode = "sentence" | "paragraph";

export type TranslateOptions = {
  nameVpPriority: NameVpPriority;
  nameScopePriority: NameScopePriority;
  vpPreference: VpPreference;
  luatNhanScope: LuatNhanScope;
  maxPhraseLength: number;
  splitMode: SplitMode;
  convertTraditional: boolean;
};

export type DictionaryBundle = {
  vp: Map<string, string>;
  name: Map<string, string>;
  pronouns: Map<string, string>;
  hv: Map<string, string>;
  luatNhan: Map<string, string>;
  warnings: string[];
};

type LuatNhanRule = {
  source: string;
  target: string;
  prefix: string;
  suffix: string;
  hasPlaceholder: boolean;
};

const DEFAULT_DICT_FILES: Record<DictionaryKind, string> = {
  vp: "/dictionaries/defaults/VP.dic",
  name: "/dictionaries/defaults/NE.dic",
  pronouns: "/dictionaries/defaults/Pronouns.dic",
  hv: "/dictionaries/defaults/HV.dic",
  luatNhan: "/dictionaries/defaults/LuatNhan.dic",
};

const FALLBACK_PRONOUNS: Array<[string, string]> = [
  ["他", "hắn"],
  ["他们", "bọn hắn"],
  ["她", "nàng"],
  ["她们", "các nàng"],
  ["它", "nó"],
  ["它们", "chúng nó"],
  ["你", "ngươi"],
  ["你们", "các ngươi"],
  ["我", "ta"],
  ["我们", "chúng ta"],
  ["咱们", "chúng ta"],
  ["大家", "mọi người"],
  ["本人", "bản thân"],
  ["自己", "chính mình"],
  ["诸位", "chư vị"],
  ["各位", "các vị"],
  ["老师", "lão sư"],
  ["同学", "bạn học"],
];

const COMMON_TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  體: "体",
  裡: "里",
  國: "国",
  門: "门",
  開: "开",
  關: "关",
  與: "与",
  萬: "万",
  東: "东",
  來: "来",
  後: "后",
  時: "时",
  對: "对",
  說: "说",
  話: "话",
  愛: "爱",
  氣: "气",
  書: "书",
  畫: "画",
  點: "点",
  頭: "头",
  靈: "灵",
  龍: "龙",
  變: "变",
  業: "业",
  圓: "圆",
  會: "会",
  見: "见",
  長: "长",
  處: "处",
  強: "强",
  傷: "伤",
  醫: "医",
  試: "试",
  實: "实",
  經: "经",
  維: "维",
  級: "级",
  結: "结",
  終: "终",
  絕: "绝",
  統: "统",
  線: "线",
  練: "练",
  緣: "缘",
  續: "续",
  編: "编",
  網: "网",
  義: "义",
  習: "习",
  聖: "圣",
  聯: "联",
  聲: "声",
  聽: "听",
  腦: "脑",
  舉: "举",
  藥: "药",
  視: "视",
  親: "亲",
  覺: "觉",
  觀: "观",
  觸: "触",
  計: "计",
  訂: "订",
  討: "讨",
  訊: "讯",
  訓: "训",
  設: "设",
  許: "许",
  論: "论",
  請: "请",
  證: "证",
  識: "识",
  譯: "译",
  護: "护",
  讀: "读",
  貓: "猫",
  買: "买",
  費: "费",
  資: "资",
  質: "质",
  賽: "赛",
  贈: "赠",
  趙: "赵",
  車: "车",
  轉: "转",
  輕: "轻",
  這: "这",
  達: "达",
  過: "过",
  運: "运",
  道: "道",
  遙: "遥",
  鄉: "乡",
  鄭: "郑",
  錢: "钱",
  錯: "错",
  鎮: "镇",
  鏡: "镜",
  雖: "虽",
  離: "离",
  難: "难",
  電: "电",
  靜: "静",
  頁: "页",
  頂: "顶",
  順: "顺",
  顏: "颜",
  類: "类",
  顧: "顾",
  風: "风",
  飛: "飞",
  飲: "饮",
  養: "养",
  館: "馆",
  騎: "骑",
  驗: "验",
  驚: "惊",
  骨: "骨",
  魂: "魂",
  鬥: "斗",
  麵: "面",
  黃: "黄",
  齊: "齐",
  齒: "齿",
};

type ParsedDictionary = {
  map: Map<string, string>;
  warnings: string[];
};

let cachedDefaultBundle: Promise<DictionaryBundle> | null = null;

function hasChinese(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function isChineseChar(ch: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

function sanitizeLine(raw: string): string {
  return String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/\uFEFF/g, "")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function parsePrefixCountSplitDictionary(bytes: Uint8Array): Map<string, string> {
  if (bytes.length < 12) return new Map();
  const count = readUint32BE(bytes, 0);
  if (!Number.isFinite(count) || count <= 0 || count > 2_500_000) return new Map();
  const text = UTF8_DECODER.decode(bytes.slice(4));
  const lines = text.split(/\r?\n/).map(sanitizeLine).filter(Boolean);
  if (lines.length < count * 2) return new Map();

  const entries = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const source = sanitizeLine(lines[i] || "");
    const target = sanitizeLine(lines[i + count] || "");
    if (!source || !target) continue;
    entries.set(source, target);
  }
  return entries;
}

function parseSlashStylePair(line: string): { source: string; target: string } | null {
  const parts = line.split("/").map(sanitizeLine).filter(Boolean);
  if (parts.length < 2) return null;
  const chineseParts = parts.filter(hasChinese);
  if (!chineseParts.length) return null;
  const source = chineseParts[chineseParts.length - 1];
  const targetCandidate = parts.find((part) => part !== source && !hasChinese(part)) || parts[0];
  const target = sanitizeLine(targetCandidate);
  if (!source || !target || source === target) return null;
  return { source, target };
}

function parseDelimiterPair(line: string): { source: string; target: string } | null {
  const separators = ["\t", "=>", "=", "|"];
  for (const sep of separators) {
    const idx = line.indexOf(sep);
    if (idx <= 0) continue;
    const source = sanitizeLine(line.slice(0, idx));
    const target = sanitizeLine(line.slice(idx + sep.length));
    if (!source || !target) continue;
    return { source, target };
  }
  return parseSlashStylePair(line);
}

function parseTextDictionary(bytes: Uint8Array, kind: DictionaryKind): ParsedDictionary {
  const text = UTF8_DECODER.decode(bytes);
  const lines = text.split(/\r?\n/);
  const map = new Map<string, string>();
  const warnings: string[] = [];
  let malformed = 0;

  lines.forEach((rawLine) => {
    const line = sanitizeLine(rawLine);
    if (!line || line.length < 2 || line.includes("\uFFFD")) return;

    const pair = parseDelimiterPair(line);
    if (!pair) {
      malformed += 1;
      return;
    }

    const source = sanitizeLine(pair.source);
    const target = sanitizeLine(pair.target);
    if (!source || !target) return;
    if (source.length > 80 || target.length > 160) return;
    if (kind !== "hv" && kind !== "luatNhan" && !hasChinese(source)) return;
    map.set(source, target);
  });

  if (!map.size && malformed > 2000) {
    warnings.push("File có vẻ là định dạng nhị phân không phải txt chuẩn. Hãy ưu tiên file txt/tách cột.");
  }
  return { map, warnings };
}

function parsePronounsFromSuffix(bytes: Uint8Array): Map<string, string> {
  let splitAt = -1;
  for (let i = bytes.length - 2; i >= 0; i -= 1) {
    if (bytes[i] === 0 && bytes[i + 1] !== 0) {
      splitAt = i + 1;
      break;
    }
  }
  if (splitAt < 0) return new Map(FALLBACK_PRONOUNS);

  const suffixText = UTF8_DECODER.decode(bytes.slice(splitAt)).replace(/^\u0000+/, "");
  const lines = suffixText
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(Boolean);

  const bySuffix = new Map<string, string>();
  const commonKeys = [
    "他",
    "其他人",
    "他们",
    "你",
    "你们",
    "人家",
    "同学",
    "同学们",
    "我",
    "我们",
    "大家",
    "众人",
    "她",
    "她们",
    "它",
    "它们",
    "您",
    "诸位",
    "本人",
    "自己",
    "各位",
  ];

  for (let i = 0; i < Math.min(commonKeys.length, lines.length); i += 1) {
    bySuffix.set(commonKeys[i], lines[i]);
  }
  FALLBACK_PRONOUNS.forEach(([source, target]) => {
    if (!bySuffix.has(source)) bySuffix.set(source, target);
  });
  return bySuffix;
}

function parseBinaryDictionary(bytes: Uint8Array, kind: DictionaryKind): ParsedDictionary {
  const countSplitMap = parsePrefixCountSplitDictionary(bytes);
  if (countSplitMap.size > 0) {
    return { map: countSplitMap, warnings: [] };
  }
  if (kind === "pronouns") {
    return { map: parsePronounsFromSuffix(bytes), warnings: [] };
  }
  return parseTextDictionary(bytes, kind);
}

function mergeMap(base: Map<string, string>, override: Map<string, string>): Map<string, string> {
  const merged = new Map(base);
  override.forEach((value, key) => {
    merged.set(key, value);
  });
  return merged;
}

function maybeTraditionalToSimplified(text: string): string {
  const chars = [...String(text || "")];
  return chars.map((ch) => COMMON_TRADITIONAL_TO_SIMPLIFIED[ch] || ch).join("");
}

function splitTextByMode(text: string, mode: SplitMode): string[] {
  if (!text) return [""];
  if (mode === "paragraph") {
    return text.split(/(\n{2,})/g).filter((item) => item !== "");
  }
  return text.split(/([。！？!?；;：:\n]+)/g).filter((item) => item !== "");
}

function toLuatNhanRules(entries: Map<string, string>): LuatNhanRule[] {
  const rules: LuatNhanRule[] = [];
  entries.forEach((target, source) => {
    const sourcePattern = sanitizeLine(source);
    const targetPattern = sanitizeLine(target);
    if (!sourcePattern || !targetPattern) return;
    const markerIndex = sourcePattern.indexOf("{0}");
    if (markerIndex < 0) {
      rules.push({
        source: sourcePattern,
        target: targetPattern,
        prefix: sourcePattern,
        suffix: "",
        hasPlaceholder: false,
      });
      return;
    }
    rules.push({
      source: sourcePattern,
      target: targetPattern,
      prefix: sourcePattern.slice(0, markerIndex),
      suffix: sourcePattern.slice(markerIndex + 3),
      hasPlaceholder: true,
    });
  });
  return rules;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveRuleToken(token: string, scope: LuatNhanScope, maps: { name: Map<string, string>; pronouns: Map<string, string>; vp: Map<string, string> }): string {
  const clean = sanitizeLine(token);
  if (!clean) return clean;
  if (maps.name.has(clean)) return maps.name.get(clean) || clean;
  if (scope === "names-pronouns" || scope === "names-pronouns-vp") {
    if (maps.pronouns.has(clean)) return maps.pronouns.get(clean) || clean;
  }
  if (scope === "names-pronouns-vp" && maps.vp.has(clean)) {
    return maps.vp.get(clean) || clean;
  }
  return clean;
}

function applyLuatNhan(
  source: string,
  rules: LuatNhanRule[],
  scope: LuatNhanScope,
  maps: { name: Map<string, string>; pronouns: Map<string, string>; vp: Map<string, string> },
): string {
  if (scope === "off" || !rules.length) return source;
  let output = source;
  const filtered = rules.filter((rule) => {
    if (!rule.hasPlaceholder) return output.includes(rule.source);
    if (rule.prefix && !output.includes(rule.prefix)) return false;
    if (rule.suffix && !output.includes(rule.suffix)) return false;
    return true;
  });

  filtered.slice(0, 1800).forEach((rule) => {
    if (!rule.hasPlaceholder) {
      output = output.split(rule.source).join(rule.target);
      return;
    }
    const pattern = `${escapeRegex(rule.prefix)}(.+?)${escapeRegex(rule.suffix)}`;
    const regex = new RegExp(pattern, "g");
    output = output.replace(regex, (_whole, captured: string) => {
      const convertedToken = resolveRuleToken(captured, scope, maps);
      return rule.target.replace("{0}", convertedToken);
    });
  });
  return output;
}

function findLongest(map: Map<string, string>, chars: string[], index: number, maxLen: number): { length: number; value: string } | null {
  const limit = Math.min(maxLen, chars.length - index);
  for (let length = limit; length >= 1; length -= 1) {
    const key = chars.slice(index, index + length).join("");
    const value = map.get(key);
    if (value) return { length, value };
  }
  return null;
}

function findShortest(map: Map<string, string>, chars: string[], index: number, maxLen: number): { length: number; value: string } | null {
  const limit = Math.min(maxLen, chars.length - index);
  for (let length = 1; length <= limit; length += 1) {
    const key = chars.slice(index, index + length).join("");
    const value = map.get(key);
    if (value) return { length, value };
  }
  return null;
}

function findVpCandidate(
  map: Map<string, string>,
  chars: string[],
  index: number,
  maxLen: number,
  preference: VpPreference,
): { length: number; value: string } | null {
  if (preference === "none") {
    return findShortest(map, chars, index, maxLen);
  }
  const baseLongest = findLongest(map, chars, index, maxLen);
  if (!baseLongest) return null;
  if (preference === "prefer-long") return baseLongest;
  if (preference === "min4" && baseLongest.length >= 4) return baseLongest;
  if (preference === "min5" && baseLongest.length >= 5) return baseLongest;

  if (preference === "min4") {
    const limit = Math.min(maxLen, chars.length - index);
    for (let length = limit; length >= 4; length -= 1) {
      const key = chars.slice(index, index + length).join("");
      const value = map.get(key);
      if (value) return { length, value };
    }
  }
  if (preference === "min5") {
    const limit = Math.min(maxLen, chars.length - index);
    for (let length = limit; length >= 5; length -= 1) {
      const key = chars.slice(index, index + length).join("");
      const value = map.get(key);
      if (value) return { length, value };
    }
  }
  return baseLongest;
}

function translateSegment(
  source: string,
  options: TranslateOptions,
  maps: {
    storyName: Map<string, string>;
    globalName: Map<string, string>;
    vp: Map<string, string>;
    pronouns: Map<string, string>;
    hv: Map<string, string>;
    luatNhan: Map<string, string>;
  },
): string {
  const rules = toLuatNhanRules(maps.luatNhan);
  const luatApplied = applyLuatNhan(source, rules, options.luatNhanScope, {
    name: mergeMap(maps.globalName, maps.storyName),
    pronouns: maps.pronouns,
    vp: maps.vp,
  });
  const chars = [...luatApplied];
  const orderedNameMaps =
    options.nameScopePriority === "story-first"
      ? [maps.storyName, maps.globalName]
      : [maps.globalName, maps.storyName];

  const dictOrder: Array<{ type: "name" | "vp" | "pronouns"; map: Map<string, string> }> =
    options.nameVpPriority === "name-vp"
      ? [
          { type: "name", map: orderedNameMaps[0] },
          { type: "name", map: orderedNameMaps[1] },
          { type: "pronouns", map: maps.pronouns },
          { type: "vp", map: maps.vp },
        ]
      : [
          { type: "vp", map: maps.vp },
          { type: "name", map: orderedNameMaps[0] },
          { type: "name", map: orderedNameMaps[1] },
          { type: "pronouns", map: maps.pronouns },
        ];

  const maxLen = Math.max(1, Math.min(24, Number(options.maxPhraseLength || 12)));
  let index = 0;
  let out = "";

  while (index < chars.length) {
    const current = chars[index];
    if (!isChineseChar(current)) {
      out += current;
      index += 1;
      continue;
    }

    let matched: { length: number; value: string } | null = null;
    for (const entry of dictOrder) {
      if (!entry.map.size) continue;
      if (entry.type === "vp") {
        matched = findVpCandidate(entry.map, chars, index, maxLen, options.vpPreference);
      } else {
        matched = findLongest(entry.map, chars, index, maxLen);
      }
      if (matched) break;
    }

    if (matched) {
      out += matched.value;
      index += matched.length;
      continue;
    }

    const hv = maps.hv.get(current);
    out += hv || current;
    index += 1;
  }

  return out;
}

export async function loadBundledDictionaries(): Promise<DictionaryBundle> {
  if (cachedDefaultBundle) return cachedDefaultBundle;
  cachedDefaultBundle = (async () => {
    const warnings: string[] = [];
    const loaded = await Promise.all(
      (Object.keys(DEFAULT_DICT_FILES) as DictionaryKind[]).map(async (kind) => {
        const path = DEFAULT_DICT_FILES[kind];
        try {
          const resp = await fetch(path, { cache: "force-cache" });
          if (!resp.ok) {
            warnings.push(`Không tải được ${kind.toUpperCase()} mặc định (${resp.status}).`);
            return [kind, new Map<string, string>()] as const;
          }
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const parsed = parseBinaryDictionary(bytes, kind);
          parsed.warnings.forEach((w) => warnings.push(`${kind.toUpperCase()}: ${w}`));
          return [kind, parsed.map] as const;
        } catch {
          warnings.push(`Không tải được ${kind.toUpperCase()} mặc định do lỗi mạng.`);
          return [kind, new Map<string, string>()] as const;
        }
      }),
    );

    const byKind = Object.fromEntries(loaded) as Record<DictionaryKind, Map<string, string>>;
    if (!byKind.pronouns.size) {
      byKind.pronouns = new Map(FALLBACK_PRONOUNS);
    }
    return {
      vp: byKind.vp,
      name: byKind.name,
      pronouns: byKind.pronouns,
      hv: byKind.hv,
      luatNhan: byKind.luatNhan,
      warnings,
    };
  })();
  return cachedDefaultBundle;
}

export function parseUploadedDictionary(kind: DictionaryKind, content: string | Uint8Array): ParsedDictionary {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return parseBinaryDictionary(bytes, kind);
}

export function buildDictionaryBundle(
  defaults: DictionaryBundle,
  custom: Partial<Record<DictionaryKind, Map<string, string>>>,
  useBundled: Partial<Record<DictionaryKind, boolean>>,
): DictionaryBundle {
  const warnings: string[] = [...defaults.warnings];
  const merged = (kind: DictionaryKind): Map<string, string> => {
    const base = useBundled[kind] === false ? new Map<string, string>() : defaults[kind];
    const customMap = custom[kind] || new Map<string, string>();
    return mergeMap(base, customMap);
  };

  return {
    vp: merged("vp"),
    name: merged("name"),
    pronouns: merged("pronouns"),
    hv: merged("hv"),
    luatNhan: merged("luatNhan"),
    warnings,
  };
}

export function convertChineseToVietnamese(
  sourceText: string,
  options: TranslateOptions,
  bundle: DictionaryBundle,
  storyScopedNames?: Map<string, string>,
): string {
  const normalizedSource = options.convertTraditional ? maybeTraditionalToSimplified(sourceText) : sourceText;
  const segments = splitTextByMode(String(normalizedSource || ""), options.splitMode);
  const storyNameMap = storyScopedNames || new Map<string, string>();
  const translated = segments.map((segment) => {
    if (/^[。！？!?；;：:\n\s]+$/.test(segment)) return segment;
    return translateSegment(segment, options, {
      storyName: storyNameMap,
      globalName: bundle.name,
      vp: bundle.vp,
      pronouns: bundle.pronouns,
      hv: bundle.hv,
      luatNhan: bundle.luatNhan,
    });
  });
  return normalizeWhitespace(translated.join(""));
}

export function createDefaultTranslateOptions(): TranslateOptions {
  return {
    nameVpPriority: "name-vp",
    nameScopePriority: "story-first",
    vpPreference: "prefer-long",
    luatNhanScope: "names-pronouns-vp",
    maxPhraseLength: 12,
    splitMode: "sentence",
    convertTraditional: true,
  };
}
