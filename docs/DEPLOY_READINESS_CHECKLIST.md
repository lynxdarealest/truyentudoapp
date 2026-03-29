# Deploy Readiness Checklist

Updated: 2026-03-29

## A) Đã làm tự động trong codebase
- [x] Bỏ `.env` khỏi repo và chuyển sang dùng `.env.local` (local only).
- [x] `.env.example` đã đổi về placeholder, không còn key thật.
- [x] Gỡ config Firebase thật khỏi file source (`firebase-applet-config.json`, `.firebaserc`).
- [x] Bỏ inject `process.env.GEMINI_API_KEY` vào frontend bundle.
- [x] Thêm security headers ở `vercel.json` (CSP, HSTS, XFO, XCTO, Referrer, Permissions, COOP/CORP).
- [x] Siết Service Worker: chỉ cache static same-origin, tránh cache response API/auth.
- [x] Siết error monitoring:
  - chỉ user đăng nhập mới được đẩy lỗi lên DB,
  - có redaction token/JWT,
  - giảm tần suất gửi.
- [x] Siết RLS cho `client_error_events` trong `supabase/schema.sql`.
- [x] Thêm gate CI bảo mật:
  - Gitleaks secret scan,
  - `npm audit` mức high+.
- [x] Dọn dependency risk hiện tại (audit về 0 high/critical).

## B) Kết quả kiểm tra mới nhất
- [x] `npm run lint` pass
- [x] `npm run build` pass
- [x] `npm run security:audit` pass
- [x] `npm run test:e2e` pass (2 smoke tests)

## C) Việc bắt buộc bạn làm thủ công trước deploy

### 1) Rotate các key đã từng lộ trước đây
Làm ngay cả khi key hiện đã bị xóa khỏi code.

1. Supabase:
   - Vào Project Settings -> API.
   - Rotate `anon` key (và service role key nếu đã từng lộ).
2. Google OAuth (Drive client):
   - Vào Google Cloud Console -> Credentials.
   - Tạo OAuth Client mới hoặc rotate nếu có thể.
3. Firebase Web API key:
   - Tạo key mới, giới hạn referrer/domain.
4. API keys AI (OpenAI/Anthropic/OpenRouter/Gemini/Evolink...):
   - Revoke key cũ, tạo key mới.

### 2) Purge lịch sử git có chứa secret cũ
Nếu repo từng push commit chứa `.env`/key thật, phải rewrite history.

1. Clone mirror repo:
```bash
git clone --mirror <your-repo-url> repo-mirror.git
cd repo-mirror.git
```
2. Dùng BFG để xóa file `.env` khỏi lịch sử:
```bash
java -jar bfg.jar --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --all
git push --force --tags
```
3. Vào GitHub/Git provider:
   - Invalidate cache nếu có,
   - yêu cầu team re-clone hoặc reset nhánh local.

### 3) Cập nhật env thật trên môi trường deploy
Vercel -> Project Settings -> Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (key mới sau rotate)
- `VITE_GOOGLE_DRIVE_CLIENT_ID` (client mới)
- `VITE_RELAY_WS_BASE`
- `VITE_RELAY_WEB_BASE`
- các key AI nếu cần dùng.

Sau đó redeploy production.

### 4) Chạy patch SQL bảo mật trên Supabase đang chạy
Chạy file:
- `supabase/security_patch_20260329.sql`

Hoặc copy nguyên nội dung file này vào Supabase SQL Editor và execute.

### 5) Kiểm tra header bảo mật sau deploy
Chạy:
```bash
curl -I https://truyenforge.vercel.app
```
Xác nhận có:
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

### 6) Cấu hình Google OAuth consent screen
Nếu gặp `Error 403: access_denied`:
1. Google Cloud Console -> OAuth consent screen.
2. Đổi app từ Testing sang Production (hoặc thêm test users).
3. Thêm đúng Authorized JavaScript origins và redirect URIs theo domain deploy.

### 7) Siết relay (nếu relay chạy repo riêng)
- Dùng snippet mẫu: [RELAY_SECURITY_HARDENING_SNIPPET.md](/Users/phand/Downloads/ai/truyentudoapp/docs/RELAY_SECURITY_HARDENING_SNIPPET.md)
- Tối thiểu phải có:
  - origin allowlist,
  - rate limit theo IP/user,
  - trả mã 429 khi vượt ngưỡng.

## D) Khuyến nghị kế tiếp (không bắt buộc ngay)
- Tách `src/App.tsx` thành nhiều module nhỏ để giảm rủi ro regression.
- Thêm test bảo mật:
  - assert headers qua Playwright,
  - test upload/import payload size limit.
- Nếu triển khai relay API riêng: thêm rate-limit cứng theo IP/user + origin allowlist ở edge.
