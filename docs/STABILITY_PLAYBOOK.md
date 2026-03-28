# TruyenForge Stability Playbook

## 1) Mục tiêu ổn định
- Không mất dữ liệu khi đổi thiết bị hoặc mạng chập chờn.
- Sync có hàng đợi, retry/backoff, tránh spam request.
- Có theo dõi lỗi runtime để xử lý theo dữ liệu thực.
- Có pipeline CI bắt lỗi trước khi merge/deploy.

## 2) Checklist hạ tầng Supabase
1. Mở SQL Editor và chạy toàn bộ file [`supabase/schema.sql`](../supabase/schema.sql).
2. Điền biến môi trường:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_WORKSPACES_TABLE`
  - `VITE_SUPABASE_QA_REPORTS_TABLE`
  - `VITE_SUPABASE_STORIES_TABLE`
  - `VITE_SUPABASE_CHAPTERS_TABLE`
  - `VITE_SUPABASE_CHARACTERS_TABLE`
  - `VITE_SUPABASE_AI_RULES_TABLE`
  - `VITE_SUPABASE_TRANSLATION_NAMES_TABLE`
  - `VITE_SUPABASE_STYLE_REFERENCES_TABLE`
  - `VITE_SUPABASE_CLIENT_ERRORS_TABLE`
3. Deploy lại project sau khi cập nhật env.

## 3) Checklist ứng dụng
1. Đăng nhập cùng 1 tài khoản trên 2 thiết bị.
2. Thiết bị A: sửa truyện/chương rồi bấm lưu.
3. Thiết bị B: refresh và kiểm tra thay đổi đã lên.
4. Mở modal Sao lưu:
  - `Queue sync` phải về trạng thái `Ổn định`.
  - Nếu có lỗi, app sẽ hiện `Queue sẽ tự thử lại`.
5. Tạo thêm 1 chương mới, chờ sync, kiểm tra lại trên thiết bị còn lại.

## 4) Checklist CI
Pipeline chuẩn:
1. `npm ci`
2. `npm run lint`
3. `npm run build`
4. `npm run test:e2e`

Nếu 1 bước fail thì không merge.

## 5) Vận hành khi lỗi
1. Kiểm tra `Queue sync` trong app.
2. Kiểm tra bảng `client_error_events` trên Supabase.
3. Nếu queue fail liên tục:
  - Bấm `Đồng bộ ngay với Supabase`.
  - Nếu vẫn lỗi, export JSON thủ công ngay để tránh rủi ro.
4. Sau khi fix, kiểm tra lại 2 thiết bị cùng tài khoản.

