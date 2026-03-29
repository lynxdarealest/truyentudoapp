# API Telemetry Setup (TruyenForge)

## Mục tiêu
- Theo dõi usage API theo user/provider/model để kiểm soát số liệu.
- Không lưu API key thô.
- Chỉ lưu `key_fingerprint` và `key_hint` (đuôi đã che).

## 1) Biến môi trường
Khai báo trong `.env.local` hoặc Vercel Environment Variables:

```env
VITE_ENABLE_API_TELEMETRY="1"
VITE_SUPABASE_API_TELEMETRY_TABLE="api_key_telemetry_events"
```

## 2) SQL bắt buộc
- Nếu project mới: chạy toàn bộ [schema.sql](/Users/phand/Downloads/ai/truyentudoapp/supabase/schema.sql).
- Nếu project cũ đã chạy schema trước đó: chạy thêm [security_patch_20260329.sql](/Users/phand/Downloads/ai/truyentudoapp/supabase/security_patch_20260329.sql).

## 3) Verify nhanh
Chạy [verify_setup.sql](/Users/phand/Downloads/ai/truyentudoapp/supabase/verify_setup.sql), cần thấy:
- bảng `api_key_telemetry_events` tồn tại
- RLS bật
- policy insert/select cho user own
- policy select cho admin email `ductruong.lynx@gmail.com`

## 4) Query mẫu để theo dõi số liệu

```sql
-- Tổng request theo provider trong 24h
select
  provider,
  count(*) as total_requests,
  sum(case when success then 1 else 0 end) as success_count,
  sum(case when success then 0 else 1 end) as error_count,
  sum(estimated_tokens) as total_estimated_tokens
from public.api_key_telemetry_events
where created_at >= now() - interval '24 hours'
group by provider
order by total_requests desc;
```

```sql
-- Top fingerprint đang dùng nhiều nhất (không lộ key thật)
select
  key_fingerprint,
  provider,
  model,
  count(*) as calls
from public.api_key_telemetry_events
where created_at >= now() - interval '7 days'
group by key_fingerprint, provider, model
order by calls desc
limit 30;
```

```sql
-- Tỷ lệ lỗi theo task
select
  task,
  count(*) as total,
  round(100.0 * sum(case when success then 0 else 1 end)::numeric / nullif(count(*), 0), 2) as error_rate_percent
from public.api_key_telemetry_events
where created_at >= now() - interval '7 days'
group by task
order by error_rate_percent desc, total desc;
```

## 5) Lưu ý vận hành
- Dữ liệu telemetry được queue ở client rồi mới đẩy lên Supabase.
- Nếu user chưa đăng nhập, event sẽ chờ trong queue local.
- Khi user đăng nhập lại, app tự flush queue.
