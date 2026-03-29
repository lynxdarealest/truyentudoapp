# TruyenForge - Checklist Setup Database Từng Bước

Tài liệu này dành cho lúc bạn ngồi làm thật. Cứ đi theo thứ tự từ trên xuống, xong bước nào tick bước đó.

---

## A. Chuẩn bị

- [ ] Có tài khoản [Supabase](https://supabase.com/)
- [ ] Có tài khoản [Vercel](https://vercel.com/) (nếu deploy)
- [ ] Đã clone project TruyenForge về máy
- [ ] Máy đã có Node.js và npm

---

## B. Tạo project Supabase

1. Vào Supabase Dashboard -> `New project`.
2. Chọn Organization.
3. Đặt tên project, mật khẩu database, region.
4. Bấm `Create new project`.
5. Chờ project sẵn sàng (thường vài phút).

- [ ] Đã tạo xong project Supabase

---

## C. Tạo bảng + policy

1. Mở `SQL Editor` trong Supabase.
2. Mở file [`supabase/schema.sql`](/C:/Users/phand/Downloads/ai/truyentudoapp/supabase/schema.sql).
3. Copy toàn bộ SQL, dán vào editor.
4. Bấm `Run`.

- [ ] `user_workspaces` đã tạo
- [ ] `qa_reports` đã tạo
- [ ] RLS đã bật
- [ ] Policy đã tạo

---

## D. Bật Auth

1. Vào `Authentication -> Providers`.
2. Bật `Email`.
3. Nếu cần đăng nhập Google: bật `Google` và điền Client ID/Secret.
4. Vào `URL Configuration`, điền đúng `Site URL` (domain app của bạn).

- [ ] Email auth đã bật
- [ ] (Tuỳ chọn) Google auth đã bật
- [ ] Site URL đã đúng

---

## E. Lấy biến môi trường

1. Vào `Project Settings -> API`.
2. Copy:
   - `Project URL`
   - `anon public key`
3. Cập nhật file `.env` local:

```bash
VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_ANON_KEY"
VITE_SUPABASE_WORKSPACES_TABLE="user_workspaces"
VITE_SUPABASE_QA_REPORTS_TABLE="qa_reports"
```

- [ ] `.env` local đã đúng 4 biến

---

## F. Chạy local và test cơ bản

1. Chạy:

```bash
npm install
npm run dev
```

2. Đăng ký/đăng nhập account A.
3. Tạo hoặc sửa dữ liệu trong app.

- [ ] Local chạy bình thường
- [ ] Đăng nhập được
- [ ] Có dữ liệu được lưu

---

## G. Kiểm tra DB bằng SQL

1. Vào SQL Editor.
2. Chạy file [`supabase/verify_setup.sql`](/C:/Users/phand/Downloads/ai/truyentudoapp/supabase/verify_setup.sql).
3. Xem kết quả.

Kỳ vọng:
- `table_exists = true`
- `rls_enabled = true`
- Có policy cho `select/insert/update`.

- [ ] Verify SQL pass

---

## H. Test bảo mật RLS (bắt buộc)

1. Đăng nhập account A, tạo dữ liệu.
2. Đăng xuất.
3. Đăng nhập account B.
4. Đảm bảo account B không thấy dữ liệu của A.

- [ ] Tài khoản B không đọc được dữ liệu tài khoản A

---

## I. Cấu hình Vercel

1. Vào Vercel Project -> `Settings -> Environment Variables`.
2. Thêm 4 biến `VITE_SUPABASE_*` giống local.
3. Chọn `All Environments` hoặc ít nhất `Production + Preview`.
4. Redeploy.

- [ ] Env trên Vercel đã thêm
- [ ] Đã redeploy
- [ ] App production đăng nhập/lưu được

---

## J. Chốt trước khi dùng thật

- [ ] Có backup JSON định kỳ
- [ ] Có backup Drive
- [ ] Test restore từ backup thành công ít nhất 1 lần
- [ ] Có 2 account test để kiểm tra phân quyền

---

## K. Nếu gặp lỗi

Mở tài liệu chính: [`docs/DATABASE_SETUP_GUIDE.md`](/C:/Users/phand/Downloads/ai/truyentudoapp/docs/DATABASE_SETUP_GUIDE.md)

Các lỗi hay gặp:
- Thiếu env -> app báo chưa cấu hình Supabase
- Sai policy RLS -> lỗi insert/select
- Chưa chạy schema -> không có bảng
- Quên redeploy Vercel -> production vẫn dùng biến cũ
