# Relay Security Hardening (CORS + Rate Limit) – Snippet

Nếu bạn dùng relay ở repo khác (ví dụ Cloudflare Worker), có thể áp dụng mẫu này để chặn abuse cơ bản.

```ts
// src/index.ts (Cloudflare Worker)
export interface Env {
  ALLOWED_ORIGINS: string; // comma-separated, ví dụ: https://truyenforge.vercel.app,https://www.truyenforge.vercel.app
}

const ipBucket = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const LIMIT_PER_MINUTE = 60;

function getOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const row = ipBucket.get(ip);
  if (!row || now >= row.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (row.count >= LIMIT_PER_MINUTE) return false;
  row.count += 1;
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (!getOriginAllowed(origin, env)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin!) });
    }

    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('x-forwarded-for') ||
      'unknown';
    if (!checkRateLimit(ip)) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { ...corsHeaders(origin!), 'Retry-After': '60' },
      });
    }

    // TODO: xử lý relay thật tại đây.
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin!) },
    });
  },
};
```

## Checklist áp dụng nhanh
1. Set biến môi trường `ALLOWED_ORIGINS` trên Worker.
2. Không dùng wildcard `*` cho origin nếu endpoint có auth/token.
3. Thêm Cloudflare WAF/rate-limit rule ở dashboard để có lớp bảo vệ thứ hai.
