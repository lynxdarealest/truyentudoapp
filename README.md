# Truyện Tự Do (Web)

Ứng dụng viết/dịch truyện có 2 chế độ AI:

- `Tự nhập API`: nhập key trực tiếp trong web.
- `Relay WebSocket`: dùng relay backend để nhận token và gọi AI.

## 1) Chạy local

```bash
npm install
npm run dev
```

Mở: `http://localhost:3000`

## 2) Kiến trúc relay (quan trọng)

Hệ thống dùng 2 endpoint khác nhau:

1. Relay WebSocket backend (Railway):
   - `wss://relay2026.up.railway.app/?code=1234`
   - Dùng để kết nối realtime giữa app Truyện và proxy app.

2. Relay web UI (Vercel):
   - `https://relay2026.vercel.app/`
   - Dùng để đăng nhập Google và lấy token.

Lưu ý: Railway không xử lý OAuth Google.

## 3) Biến môi trường (Vercel)

Thêm 2 biến cho project Truyện:

- `VITE_RELAY_WS_BASE=wss://relay2026.up.railway.app/?code=`
- `VITE_RELAY_WEB_BASE=https://relay2026.vercel.app/`

Sau khi thêm biến, redeploy Vercel.

## 4) Cách nhập URL trong app

Trong tab `Relay WebSocket`, nhập URL dạng:

- `wss://relay2026.up.railway.app/?code=1810`

`code` phải là 4-8 chữ số.

## 5) Kiểm tra relay backend

Mở:

- `https://relay2026.up.railway.app/health`

Nếu trả về `{ "ok": true }` là relay backend đang chạy.
