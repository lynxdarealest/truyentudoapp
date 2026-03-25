# Cloudflare Relay Setup

TruyenForge hiện dùng repo worker riêng `proxymid` làm trung gian Cloudflare Worker + Durable Object.

Repo worker:

- [ductruonglynx-netizen/proxymid](https://github.com/ductruonglynx-netizen/proxymid)

## Triển khai nhanh

1. Clone repo worker:
   `git clone https://github.com/ductruonglynx-netizen/proxymid`
2. Cài dependencies:
   `npm install`
3. Đăng nhập Cloudflare:
   `wrangler login`
4. Nếu muốn khóa publish endpoint, tạo `.dev.vars`:
   ```env
   RELAY_SHARED_SECRET=your-strong-shared-secret
   ```
5. Deploy:
   `npm run deploy`

Sau khi deploy, bạn sẽ có domain kiểu:

`https://proxymid.<your-subdomain>.workers.dev`

## Cấu hình TruyenForge

Đặt vào `.env.local` hoặc biến môi trường deploy:

```env
VITE_RELAY_WS_BASE="wss://proxymid.<your-subdomain>.workers.dev/?code="
VITE_RELAY_WEB_BASE="https://proxymid.<your-subdomain>.workers.dev/"
```

## Luồng hoạt động chuẩn

1. TruyenForge tạo `relayCode`.
2. TruyenForge mở WebSocket tới worker:
   `wss://proxymid.<your-subdomain>.workers.dev/?code=<relayCode>`
3. TruyenForge mở AI Studio bridge với `?code=<relayCode>`.
   App hiện cũng gửi thêm:
   - `relay`: WS endpoint
   - `worker`: worker base URL
   - `publish`: `https://.../publish-token?code=<relayCode>`
4. AI Studio hoặc bridge của bạn gọi:
   `POST /publish-token?code=<relayCode>`
5. Worker broadcast payload:
   ```json
   {
     "type": "token",
     "code": "182004",
     "long": "182004",
     "token": "AIza...",
     "provider": "ai.studio"
   }
   ```
6. TruyenForge nhận token và lưu vào local storage runtime.

## Endpoint worker

- `GET /health`
- `GET /?code=1234`
- `GET /stats?code=1234`
- `POST /publish-token?code=1234`
- `WS /?code=1234`

## Lưu ý

- TruyenForge hiện đã tương thích với payload `type: "token"` của `proxymid`.
- Nếu bridge AI Studio của bạn vẫn hardcode endpoint cũ, hãy đổi sang `POST /publish-token`.
- Nếu dùng `RELAY_SHARED_SECRET`, bridge AI Studio cũng phải gửi `X-Relay-Secret` hoặc `Authorization`.
