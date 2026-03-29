-- TruyenForge - Verify Supabase setup
-- Chạy file này trong Supabase SQL Editor sau khi chạy schema.sql

-- 1) Kiểm tra bảng đã tồn tại chưa
select
  'user_workspaces' as table_name,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'user_workspaces'
  ) as table_exists
union all
select
  'qa_reports' as table_name,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'qa_reports'
  ) as table_exists
union all
select
  'api_key_telemetry_events' as table_name,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'api_key_telemetry_events'
  ) as table_exists;

-- 2) Kiểm tra RLS
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('user_workspaces', 'qa_reports', 'api_key_telemetry_events')
order by tablename;

-- 3) Kiểm tra policy
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('user_workspaces', 'qa_reports', 'api_key_telemetry_events')
order by tablename, policyname;

-- 4) Kiểm tra index quan trọng
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('qa_reports', 'api_key_telemetry_events')
order by indexname;

-- 5) Snapshot nhanh số bản ghi (để quan sát)
select
  'user_workspaces' as table_name,
  count(*)::bigint as total_rows
from public.user_workspaces
union all
select
  'qa_reports' as table_name,
  count(*)::bigint as total_rows
from public.qa_reports
union all
select
  'api_key_telemetry_events' as table_name,
  count(*)::bigint as total_rows
from public.api_key_telemetry_events;
