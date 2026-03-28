import { APP_VERSION_LABEL } from '../version';

export interface ReleaseNote {
  version: string;
  dateLabel: string;
  title: string;
  items: string[];
}

export const CURRENT_WRITER_VERSION = APP_VERSION_LABEL;

export const WRITER_RELEASE_NOTES: ReleaseNote[] = [
  {
    version: APP_VERSION_LABEL,
    dateLabel: '2026-03-28',
    title: 'Thêm luồng tải truyện và tự convert Trung → Việt ngay trong app',
    items: [
      'Bổ sung mục “Tải truyện & Convert” để bạn có thể đưa file truyện lên trực tiếp, lưu thành từng bản thảo trong kho cục bộ, mở lại bất cứ lúc nào và chỉnh sửa ngay trên màn hình mà không cần đổi qua công cụ khác.',
      'Thêm luồng tự convert Trung → Việt chạy cục bộ: chỉ cần chọn truyện tiếng Trung rồi bấm convert là hệ thống xử lý ngay trong app, trả kết quả liền để bạn đọc lại, sửa tay hoặc áp dụng ngược vào bản thảo chỉ với một nút bấm.',
      'Nâng phần convert theo hướng thực dụng hơn: cho phép giữ bộ từ điển mặc định để dùng ngay từ đầu, đồng thời vẫn hỗ trợ nạp file từ điển riêng để tinh chỉnh kết quả theo cách dịch của từng người dùng và từng bộ truyện.',
      'Mục tiêu của bản 0.1c là gom việc tải truyện, đọc, sửa và convert về cùng một chỗ để thao tác liền mạch hơn: ít bước trung gian, đỡ gián đoạn, và tiết kiệm thời gian khi xử lý các chương dài.',
    ],
  },
  {
    version: '0.1b',
    dateLabel: '2026-03-28',
    title: 'Sửa vài lỗi nhỏ và thêm lớp bảo vệ dữ liệu',
    items: [
      'Tinh chỉnh lại một số lỗi giao diện nhỏ để app nhìn gọn, dễ đọc và bấm đỡ rối hơn.',
      'Thêm luồng sao lưu Google Drive để dữ liệu truyện có thêm một lớp an toàn khi dùng lâu dài.',
    ],
  },
  {
    version: '0.1a',
    dateLabel: '2026-03-28',
    title: 'Tăng AI trust, quan sát tiến trình và độ rõ ràng của workflow',
    items: [
      'Thêm Trung tâm sao lưu mới: có nút Sao lưu ngay, lịch sử backup ngay trong app, khôi phục theo từng mốc thời gian và cảnh báo đỏ khi để quá lâu chưa backup.',
      'Chuyển hướng từ autosync rủi ro sang manual sync: dữ liệu tài khoản giờ chỉ đồng bộ khi người dùng tự bấm tay, giúp tránh ghi đè âm thầm trong nền.',
      'Dựng lớp backup cục bộ nhiều mốc bằng IndexedDB và cho phép đẩy file JSON lên Google Drive sau mỗi lần lưu dữ liệu khi người dùng đã kết nối Drive.',
      'Chuyển lưu trữ workspace tài khoản từ Firestore/Google sang Supabase: truyện, nhân vật, AI Rules, từ điển dịch, văn mẫu và các cấu hình cục bộ giờ đồng bộ về một server thống nhất hơn.',
      'Bổ sung schema Supabase mẫu cho user_workspaces và qa_reports để việc triển khai backend lưu trữ mới rõ ràng, dễ kiểm tra và ít phụ thuộc hơn vào cấu hình cũ của Firebase.',
      'Nâng overlay AI để hiển thị rõ giai đoạn xử lý, tiến độ thực tế và phần việc đang chạy thay vì chỉ có spinner và số giây.',
      'Làm hệ thống thông báo bớt ồn hơn: gom nhóm toast trùng lặp, giới hạn số lượng hiển thị và cho phép đóng tay khi cần.',
      'Sửa Kho Prompt theo hướng dễ tin cậy hơn: có trạng thái Chưa lưu/Đã đồng bộ, tự động lưu khi đổi mục hoặc đóng modal, đồng thời nút Lưu chỉ sáng khi thực sự có thay đổi.',
      'Làm rõ trang Công cụ là bộ tool cục bộ: gắn nhãn không gọi AI, đổi tên các thao tác dễ gây hiểu nhầm và thêm lối đi rõ ràng sang luồng AI nâng cao.',
      'Giảm cảm giác quá tải ở form tạo chương bằng cách tách phần cơ bản/nâng cao và bổ sung checklist chỉ ra các trường ảnh hưởng mạnh nhất tới chất lượng đầu ra.',
      'Đổi Lịch sử cập nhật sang kiểu bấm theo từng phiên bản: mặc định chỉ hiện tên version, khi bấm mới mở nội dung và chỉ mở một phiên bản tại một thời điểm.',
      'Bổ sung tự động lưu workspace cục bộ vào tài khoản đã đăng nhập, bao gồm hồ sơ giao diện, từ điển dịch, văn mẫu, kho prompt và cấu hình ngân sách AI.',
      'Thêm translation memory theo từng bộ truyện dịch để tên riêng/thuật ngữ đã khóa ở truyện A tiếp tục được giữ nhất quán trong các chương sau mà không làm ảnh hưởng truyện B.',
      'Tích hợp luồng tạo ảnh bìa qua Raphael/Evolink API theo kiểu chạy nền trong app: bấm tạo bìa là gửi task trực tiếp, chờ kết quả trả về ngay trong giao diện, không bật popup hay tab ngoài.',
      'Đồng bộ phiên bản sản phẩm lên 0.1a và cập nhật Lịch sử cập nhật để người dùng theo dõi những thay đổi vừa triển khai.',
    ],
  },
  {
    version: '0.0a',
    dateLabel: '2026-03-26',
    title: 'Tăng độ bám context cho Writer Pro',
    items: [
      'Nâng cấp prompt Writer Pro để bám chặt objective, timeline, glossary và Universe Wiki trước khi sinh nội dung.',
      'Tự động khóa glossary sau khi AI trả về, giảm tình trạng tên riêng và thuật ngữ bị trôi lại về bản gốc.',
      'Bổ sung Context Readiness để cảnh báo khi dữ liệu đầu vào còn thiếu, giúp AI hoạt động ổn định hơn.',
      'Cải thiện tạo ảnh bìa: tự dựng prompt hình ảnh tốt hơn và fallback bìa dự phòng rõ bố cục hơn khi dịch vụ ảnh AI bị lỗi.',
      'Cải thiện dịch truyện: gom nhiều đoạn vào một lượt dịch, giữ ngữ cảnh giữa các lô và chỉ nạp từ điển tên riêng đúng phần đang xuất hiện để dịch nhanh và ổn định hơn.',
      'Bổ sung khả năng hủy tác vụ AI đang chạy, thay thông báo chặn bằng toast nhẹ hơn để các nút dịch/viết/tạo truyện phản hồi rõ ràng hơn.',
      'Sửa Kho Prompt để Lưu thay đổi ghi bền vào local storage, đồng thời các nút trong trang Công cụ giờ đã có hành vi thực tế thay vì chỉ là placeholder.',
      'Siết an toàn backup/import: loại secret khỏi file sao lưu, validate dữ liệu khi nhập và lưu sẵn một bản backup an toàn trước khi khôi phục.',
      'Khắc phục 2 mục trong Writer Pro: tab Tone và Context giờ cập nhật đúng runtime/context, đồng thời cho phép đẩy kết quả về workspace nhanh hơn.',
      'Thêm mục Lịch sử cập nhật nhỏ ngay trong giao diện để theo dõi thay đổi của sản phẩm.',
    ],
  },
];
