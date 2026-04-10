import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const STORIES_TABLE = process.env.VITE_SUPABASE_STORIES_TABLE || 'stories';
const CHAPTERS_TABLE = process.env.VITE_SUPABASE_CHAPTERS_TABLE || 'story_chapters';
const IMPORT_EMAIL = String(process.env.IMPORT_EMAIL || '').trim();
const IMPORT_PASSWORD = String(process.env.IMPORT_PASSWORD || '').trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY');
}
if (!IMPORT_EMAIL || !IMPORT_PASSWORD) {
  throw new Error('Thiếu IMPORT_EMAIL hoặc IMPORT_PASSWORD trong .env.local');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanupTitle(value) {
  return String(value || '')
    .replace(/\.(?:epub|txt|docx?|pdf|prc|mobi|azw3)$/i, '')
    .replace(/^file\s+/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:full|end|convert|ban dich|ban convert)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeAuthor(value) {
  const text = String(value || '')
    .replace(/\s*(?:\||,|;).*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const key = normalize(text);
  if (!key || /^(?:unknown|chua ro|none|null|n a|na|admin)$/i.test(key)) return '';
  if (/\.(?:com|net|org|io|vn|xyz)\b/i.test(text) || /https?:\/\//i.test(text)) return '';
  if (/^[\W_]+$/i.test(text)) return '';
  return text.slice(0, 160);
}

function extractAuthor(intro) {
  const source = String(intro || '');
  const hit =
    source.match(/(?:^|\n)\s*t[aá]c\s*gi[aả]\s*:\s*([^\n]+)/i) ||
    source.match(/(?:^|\n)\s*tac\s*gia\s*:\s*([^\n]+)/i) ||
    source.match(/(?:^|\n)\s*author\s*:\s*([^\n]+)/i);
  return sanitizeAuthor(hit?.[1] || '');
}

function toTitleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

const OVERRIDES = [
  {
    keys: ['chu gioi tan the', 'chugioitanthe'],
    title: 'Chư Giới Tận Thế Online',
    genre: 'Mạt thế, Khoa huyễn, Huyền huyễn, Dị giới',
    author: 'Yên Hỏa Thành Thành',
  },
  {
    keys: ['file tatrothanhphunhidaiphanphai', 'ta tro thanh phu nhi dai phan phai'],
    title: 'Ta Trở Thành Phú Nhị Đại Phản Phái',
    genre: 'Đô thị, Hệ thống, Xuyên không',
    author: 'Tam Tam Đắc Cửu',
  },
  {
    keys: ['con th ny phi cht', 'con tho nay phai chet'],
    title: 'Con Thỏ Này Phải Chết',
    genre: 'Huyền huyễn, Hài hước, Tu tiên',
    author: 'Nhất Mộng Hoàng Lương',
  },
  {
    keys: ['huyen huyen ta la than thoai'],
    title: 'Huyền Huyễn Ta Là Thần Thoại',
    genre: 'Huyền huyễn, Hệ thống',
  },
  {
    keys: ['luoc thien ky'],
    title: 'Lược Thiên Ký',
    genre: 'Tiên hiệp',
  },
  {
    keys: ['quoc vuong van tue'],
    title: 'Quốc Vương Vạn Tuế',
    genre: 'Huyền huyễn',
  },
  {
    keys: ['ta thien menh dai phan phai'],
    title: 'Ta Thiên Mệnh Đại Phản Phái',
    genre: 'Huyền huyễn, Hệ thống, Phản phái',
  },
  {
    keys: ['ta bat dau sang tao thien co lau'],
    title: 'Ta Bắt Đầu Sáng Tạo Thiên Cơ Lâu',
    genre: 'Huyền huyễn, Hệ thống',
  },
  {
    keys: ['than cap dai ma dau 1000c', 'than cap dai ma dau'],
    title: 'Thần Cấp Đại Ma Đầu',
    genre: 'Huyền huyễn',
  },
  {
    keys: ['thon thien'],
    title: 'Thôn Thiên',
    genre: 'Huyền huyễn, Tiên hiệp',
  },
  {
    keys: ['tien ma bien tron bo 16 quyen', 'tien ma bien'],
    title: 'Tiên Ma Biến',
    genre: 'Tiên hiệp, Huyền huyễn',
  },
  {
    keys: ['tieu dao 1 1204', 'tieu dao'],
    title: 'Tiêu Dao',
    genre: 'Tiên hiệp',
  },
  {
    keys: ['tronh sinh chi phong luu thieu'],
    title: 'Trọng Sinh Chi Phong Lưu Thiếu',
    genre: 'Đô thị, Trọng sinh',
  },
  {
    keys: ['trung nhien'],
    title: 'Trùng Nhiên',
    genre: 'Đô thị, Trọng sinh',
  },
  {
    keys: ['dao quan'],
    title: 'Đạo Quân',
    genre: 'Tiên hiệp, Huyền huyễn',
  },
  {
    keys: ['do nhi vi su khong xuong nui'],
    title: 'Đồ Nhi Vi Sư Không Xuống Núi',
    genre: 'Huyền huyễn',
  },
  {
    keys: ['tha nu phu thuy kia ra ban dich', 'tha nu phu thuy kia ra'],
    title: 'Thả Nữ Phù Thủy Kia Ra (Bản Dịch)',
    genre: 'Khoa huyễn, Dị giới',
  },
];

function resolveOverride(title) {
  const key = normalize(cleanupTitle(title));
  return OVERRIDES.find((item) => item.keys.some((rawKey) => key.includes(normalize(rawKey))));
}

function candidateEmails(raw) {
  const email = String(raw || '').trim();
  if (!email) return [];
  if (email.includes('@')) return [email];
  const maybe = email.replace('2', '@');
  if (maybe.includes('@')) return [email, maybe];
  return [email];
}

async function getChapterCount(userId, storyId) {
  const { count, error } = await supabase
    .from(CHAPTERS_TABLE)
    .select('chapter_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('story_id', storyId);
  if (error) throw new Error(error.message);
  return Number(count || 0);
}

async function main() {
  let authData = null;
  let authError = null;
  for (const email of candidateEmails(IMPORT_EMAIL)) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: IMPORT_PASSWORD });
    if (error) {
      authError = error;
      continue;
    }
    authData = data;
    break;
  }
  if (!authData?.user) {
    throw new Error(`Đăng nhập thất bại: ${authError?.message || 'unknown error'}`);
  }
  const userId = String(authData.user.id);

  const { data: stories, error: storyError } = await supabase
    .from(STORIES_TABLE)
    .select('story_id,title,genre,introduction,is_public')
    .eq('user_id', userId)
    .eq('is_public', true);
  if (storyError) throw new Error(storyError.message);

  const counts = new Map();
  for (const story of stories || []) {
    counts.set(story.story_id, await getChapterCount(userId, story.story_id));
  }

  const chuGioiCandidates = (stories || [])
    .filter((item) => {
      const key = normalize(item.title);
      return key.includes('chugioitanthe') || key.includes('chu gioi tan the');
    })
    .sort((a, b) => (counts.get(b.story_id) || 0) - (counts.get(a.story_id) || 0));
  const keepId = chuGioiCandidates[0]?.story_id || null;
  const hideIds = new Set(chuGioiCandidates.slice(1).map((item) => item.story_id));

  let updated = 0;
  let hidden = 0;
  for (const story of stories || []) {
    if (hideIds.has(story.story_id)) {
      const { error } = await supabase
        .from(STORIES_TABLE)
        .update({ is_public: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('story_id', story.story_id);
      if (error) throw new Error(error.message);
      hidden += 1;
      process.stdout.write(`HIDE ${story.story_id} | ${story.title}\n`);
      continue;
    }

    const override = resolveOverride(story.title);
    let nextTitle = String(override?.title || '').trim();
    if (!nextTitle) {
      const cleaned = cleanupTitle(story.title);
      const cleanedKey = normalize(cleaned);
      const isAsciiOnly = /^[a-z0-9 ]+$/i.test(cleaned) && !/[\u00C0-\u1EF9]/.test(cleaned);
      nextTitle = isAsciiOnly ? toTitleCase(cleanedKey) : cleaned;
    }

    const nextGenre = String(override?.genre || story.genre || 'Chưa phân loại').trim().slice(0, 190) || 'Chưa phân loại';
    const nextAuthor = sanitizeAuthor(override?.author || extractAuthor(story.introduction)) || 'Chưa rõ';
    const nextIntroduction = `Tác giả: ${nextAuthor}\nThể loại: ${nextGenre}`;

    const currentGenre = String(story.genre || '').trim();
    const currentIntro = String(story.introduction || '').trim();
    const shouldUpdate = nextTitle !== story.title || nextGenre !== currentGenre || nextIntroduction !== currentIntro;
    if (!shouldUpdate) continue;

    const { error } = await supabase
      .from(STORIES_TABLE)
      .update({
        title: nextTitle.slice(0, 480),
        genre: nextGenre,
        introduction: nextIntroduction,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('story_id', story.story_id);
    if (error) throw new Error(error.message);
    updated += 1;
    process.stdout.write(`UPDATE ${story.story_id} | ${story.title} => ${nextTitle}\n`);
  }

  console.log(JSON.stringify({
    total: (stories || []).length,
    updated,
    hidden,
    keepId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

