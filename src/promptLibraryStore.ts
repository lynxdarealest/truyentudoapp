import { emitLocalWorkspaceChanged } from './localWorkspaceSync';

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
  adult: [
    {
      id: 'adult-emotion',
      title: '18+ · Cảm xúc rất chi tiết',
      content: '- Giọng văn: trưởng thành, gợi cảm, mượt; tránh thô và tránh liệt kê cơ học.\n- Trọng tâm: lớp cảm xúc nối tiếp nhau như chờ đợi, giằng co, mất kiểm soát, xấu hổ, lệ thuộc, day dứt.\n- Miêu tả: ánh mắt, hơi thở, khoảng cách cơ thể, nhịp tim, cử chỉ ngập ngừng, thay đổi trong giọng nói.\n- Cấu trúc cảnh: mở nhịp -> leo thang -> cao trào -> dư âm sau cảnh.\n- Cấm: nhảy cảnh quá gấp, lặp từ thô, làm nhân vật phản ứng vô hồn.',
    },
    {
      id: 'adult-consent',
      title: '18+ · Consent & phản ứng',
      content: '- Luôn làm rõ tín hiệu đồng thuận, ngập ngừng, chủ động/bị động và điểm chuyển cảm xúc.\n- Hành động phải kéo theo phản ứng nội tâm hoặc phản ứng thân thể rõ ràng.\n- Hội thoại cần giữ sắc thái quyến rũ, căng thẳng hoặc chiếm hữu đúng bối cảnh.\n- Sau cảnh thân mật phải có dư âm: bối rối, nghiện cảm giác, hối hận, ám ảnh hoặc muốn tiến thêm.\n- Cấm: biến cảnh nóng thành mô tả khô, rỗng hoặc không có hậu quả tâm lý.',
    },
    {
      id: 'adult-tone',
      title: '18+ · Câu chữ sang, nhịp nóng',
      content: '- Ưu tiên câu văn có nhịp, có khoảng lặng và có sức gợi.\n- Dùng từ chọn lọc để giữ sự cuốn hút và cảm giác gần gũi, không rơi vào giọng máy hoặc giọng chợ.\n- Khi viết/dịch cảnh nóng, giữ mạch cảm xúc liền nhau và liên kết với quan hệ giữa hai nhân vật.\n- Mỗi cảnh 18+ phải phục vụ phát triển quan hệ, mâu thuẫn hoặc bước ngoặt cảm xúc.\n- Cấm: cắt rời cảnh thân mật khỏi cốt truyện, hoặc chỉ mô tả động tác mà thiếu nội tâm.',
    },
  ],
};

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
    const raw = localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY);
    if (!raw) return DEFAULT_PROMPT_LIBRARY;
    const parsed = JSON.parse(raw) as Partial<PromptLibraryState>;
    return {
      core: sanitizePromptItems(parsed.core, DEFAULT_PROMPT_LIBRARY.core),
      genre: sanitizePromptItems(parsed.genre, DEFAULT_PROMPT_LIBRARY.genre),
      adult: sanitizePromptItems(parsed.adult, DEFAULT_PROMPT_LIBRARY.adult),
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
  localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(normalized));
  emitLocalWorkspaceChanged('prompt_library');
}

export function resetPromptLibraryState(): PromptLibraryState {
  savePromptLibraryState(DEFAULT_PROMPT_LIBRARY);
  return DEFAULT_PROMPT_LIBRARY;
}
