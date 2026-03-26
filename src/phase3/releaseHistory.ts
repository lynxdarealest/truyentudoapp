export interface ReleaseNote {
  version: string;
  dateLabel: string;
  title: string;
  items: string[];
}

export const CURRENT_WRITER_VERSION = '0.0a';

export const WRITER_RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.0a',
    dateLabel: '2026-03-26',
    title: 'Tăng độ bám context cho Writer Pro',
    items: [
      'Nâng cấp prompt Writer Pro để bám chặt objective, timeline, glossary và Universe Wiki trước khi sinh nội dung.',
      'Tự động khóa glossary sau khi AI trả về, giảm tình trạng tên riêng và thuật ngữ bị trôi lại về bản gốc.',
      'Bổ sung Context Readiness để cảnh báo khi dữ liệu đầu vào còn thiếu, giúp AI hoạt động ổn định hơn.',
      'Thêm mục Lịch sử cập nhật nhỏ ngay trong giao diện để theo dõi thay đổi của sản phẩm.',
    ],
  },
];
