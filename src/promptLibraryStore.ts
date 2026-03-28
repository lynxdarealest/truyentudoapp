import { emitLocalWorkspaceChanged } from './localWorkspaceSync';
import { getScopedStorageItem, setScopedStorageItem, shouldAllowLegacyScopeFallback } from './workspaceScope';

export type PromptLibraryTabKey = 'core' | 'genre' | 'adult';

export interface PromptLibraryItem {
  id: string;
  title: string;
  content: string;
}

export interface PromptLibraryState {
  core: PromptLibraryItem[];
  genre: PromptLibraryItem[];
  adult: PromptLibraryItem[];
}

const PROMPT_LIBRARY_STORAGE_KEY = 'prompt_library_v1';

const DEFAULT_ADULT_PROMPTS: PromptLibraryItem[] = [
  {
    id: 'adult-ancient',
    title: '18+ · Cổ đại / Tiên hiệp',
    content: '- Giọng văn: cổ phong, quyến rũ, giàu sức gợi nhưng vẫn mềm và sang.\n- Xưng hô: giữ tôn ti, thân phận và chất cổ đại; tránh từ hiện đại hoặc quá thô.\n- Nội tâm: đào sâu cảm giác kìm nén, cấm dục, rung động, chiếm hữu, day dứt, cảm giác phạm giới hoặc vượt lễ pháp.\n- Miêu tả: tập trung ánh mắt, tay áo, đầu ngón tay, hơi thở, vạt áo, tóc, nhiệt độ da, khí tức, linh lực dao động.\n- Nhịp cảnh: chậm ở mở đầu, căng dần ở phần tiếp xúc, cao trào phải có cảm giác mất kiểm soát nhưng vẫn liền mạch.\n- Dư âm: sau cảnh thân mật cần có xấu hổ, chấp niệm, ràng buộc, tâm ma hoặc thay đổi quan hệ.\n- Cấm: dùng tiếng lóng hiện đại, câu chữ chợ búa, mô tả cơ học như liệt kê động tác.',
  },
  {
    id: 'adult-modern',
    title: '18+ · Đô thị / Hiện đại',
    content: '- Giọng văn: trực diện hơn cổ đại nhưng vẫn mượt, gợi cảm, có nhịp và có tiết chế.\n- Xưng hô: tự nhiên theo bối cảnh hiện đại; phải đúng tuổi, vai vế, quan hệ và mức độ thân mật.\n- Nội tâm: nhấn mạnh ham muốn, giằng co, ghen tuông, chiếm hữu, nghiện cảm giác, ngại ngùng hoặc tự dằn vặt sau gần gũi.\n- Miêu tả: chú ý ánh mắt, nhịp thở, tiếng nói, khoảng cách cơ thể, ngón tay, phản ứng da thịt, run nhẹ, né tránh rồi lại bị hút về.\n- Nhịp cảnh: mở nhanh hơn, nhiều kéo đẩy cảm xúc, phản ứng phải nối tiếp hành động chứ không rời rạc.\n- Dư âm: sau cảnh 18+ phải còn hậu quả tâm lý hoặc bước ngoặt quan hệ, không kết thúc cụt.\n- Cấm: viết như checklist động tác, lặp từ thô, biến nhân vật thành vô hồn hoặc mất tự nhiên.',
  },
];

const DEFAULT_PROMPT_LIBRARY: PromptLibraryState = {
  core: [
    {
      id: 'terms',
      title: 'Danh từ riêng / Thuật ngữ',
      content: '- Giữ nguyên tên riêng, thuật ngữ khóa (Kho Name/Glossary).\n- Không phiên âm sai; nếu thiếu mapping, giữ nguyên gốc.\n- Thêm chú thích ngắn trong ngoặc khi cần làm rõ.',
    },
    {
      id: 'must',
      title: 'Yêu cầu bắt buộc',
      content: '- Ưu tiên: Quy tắc thể loại -> Kho Name -> Glossary/Term lock -> Timeline.\n- Không bịa sự kiện; nếu thiếu dữ liệu đánh dấu [thiếu dữ liệu].\n- Giữ consistency nhân xưng, địa danh, mốc thời gian.',
    },
    {
      id: 'blacklist',
      title: 'Các điều cấm (Blacklist)',
      content: '- Cấm thêm 18+/nhạy cảm nếu đầu vào không có.\n- Cấm chèn link/contact/API key.\n- Cấm sai lệch fact, phá OOC không lý do.\n- Cấm meme, viết tắt chat trong văn bản.',
    },
  ],
  genre: [
    {
      id: 'co-dai',
      title: 'Cổ đại / Tiên hiệp',
      content: '- Giọng văn: Cổ phong, ước lệ; nhịp chậm-trung.\n- Xưng hô: tôn ti (trẫm/vi thần/thần thiếp, bổn vương/tại hạ...).\n- Từ vựng: Hán Việt chọn lọc; tránh công nghệ/meme.\n- Cấu trúc: câu 2-3 vế, tả cảnh -> tâm/cơ mưu.\n- Cấm: wow/emoji, tiếng lóng, pha tiếng Anh.',
    },
    {
      id: 'hien-dai',
      title: 'Hiện đại / Hào môn',
      content: '- Giọng văn: Nhanh, trực diện; hào môn lạnh/sang.\n- Xưng hô: tôi/anh/em/cô + chức danh.\n- Từ vựng: business/showbiz đúng cảnh; tránh Hán Việt cổ.\n- Cấu trúc: đoạn 3-6 câu, nhiều thoại.\n- Cấm: viết tắt chat (ko, j), brand >2/đoạn.',
    },
    {
      id: 'khoa-hoc',
      title: 'Võng du / Khoa học',
      content: '- Giọng văn: Lý tính, mô tả hệ thống rõ.\n- Xưng hô: linh hoạt theo thế giới thật/ảo.\n- Từ vựng: game chuẩn (level, cooldown, buff/debuff, PK), sci-fi (cơ giáp, gene, warp).\n- Cấu trúc: log/bảng trạng thái ngắn; ví dụ sau mô tả.\n- Cấm: bùa tiên hiệp mơ hồ; số liệu không khớp.',
    },
  ],
  adult: DEFAULT_ADULT_PROMPTS,
};

function shouldUpgradeAdultPrompts(items: PromptLibraryItem[]): boolean {
  if (!items.length) return true;
  const legacyIds = new Set(['adult-emotion', 'adult-consent', 'adult-tone']);
  return items.every((item) => legacyIds.has(String(item.id || '').trim()));
}

function sanitizePromptItems(items: unknown, fallback: PromptLibraryItem[]): PromptLibraryItem[] {
  if (!Array.isArray(items)) return fallback;
  const sanitized = items
    .map((item, index) => {
      const row = item as Partial<PromptLibraryItem> | null | undefined;
      const title = String(row?.title || '').trim();
      const content = String(row?.content || '').trim();
      const id = String(row?.id || `prompt-${Date.now()}-${index}`).trim();
      if (!title && !content) return null;
      return {
        id: id || `prompt-${Date.now()}-${index}`,
        title: title || `Mục ${index + 1}`,
        content,
      };
    })
    .filter((item): item is PromptLibraryItem => Boolean(item));
  return sanitized.length ? sanitized : fallback;
}

export function loadPromptLibraryState(): PromptLibraryState {
  if (typeof window === 'undefined') return DEFAULT_PROMPT_LIBRARY;
  try {
    const raw = getScopedStorageItem(PROMPT_LIBRARY_STORAGE_KEY, {
      allowLegacyFallback: shouldAllowLegacyScopeFallback(),
    });
    if (!raw) return DEFAULT_PROMPT_LIBRARY;
    const parsed = JSON.parse(raw) as Partial<PromptLibraryState>;
    const adultItems = sanitizePromptItems(parsed.adult, DEFAULT_PROMPT_LIBRARY.adult);
    return {
      core: sanitizePromptItems(parsed.core, DEFAULT_PROMPT_LIBRARY.core),
      genre: sanitizePromptItems(parsed.genre, DEFAULT_PROMPT_LIBRARY.genre),
      adult: shouldUpgradeAdultPrompts(adultItems) ? DEFAULT_ADULT_PROMPTS : adultItems,
    };
  } catch {
    return DEFAULT_PROMPT_LIBRARY;
  }
}

export function savePromptLibraryState(state: PromptLibraryState): void {
  if (typeof window === 'undefined') return;
  const normalized: PromptLibraryState = {
    core: sanitizePromptItems(state.core, DEFAULT_PROMPT_LIBRARY.core),
    genre: sanitizePromptItems(state.genre, DEFAULT_PROMPT_LIBRARY.genre),
    adult: sanitizePromptItems(state.adult, DEFAULT_PROMPT_LIBRARY.adult),
  };
  setScopedStorageItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(normalized));
  emitLocalWorkspaceChanged('prompt_library');
}

export function resetPromptLibraryState(): PromptLibraryState {
  savePromptLibraryState(DEFAULT_PROMPT_LIBRARY);
  return DEFAULT_PROMPT_LIBRARY;
}
