-- Per-user rate limiting for API endpoints (e.g. /api/optimize-route).
-- Designed for short windows (seconds–minutes); cleanup is handled by ttl,
-- not by retention policy.

create table public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, endpoint, window_start)
);

create index idx_api_rate_limits_window_start on public.api_rate_limits(window_start);

alter table public.api_rate_limits enable row level security;
-- No policies: only service-role (bypasses RLS) can access.

create or replace function public.increment_and_check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_window_seconds integer,
  p_max_count integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_current_count integer;
begin
  -- Bucket the current time into a fixed window starting at an epoch boundary.
  v_window_start := to_timestamp(
    (extract(epoch from now())::bigint / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (user_id, endpoint, window_start, count)
  values (p_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set count = api_rate_limits.count + 1
  returning count into v_current_count;

  return v_current_count <= p_max_count;
end;
$$;

-- Cleanup: delete buckets older than 1 hour. Run periodically via pg_cron
-- or a scheduled Edge Function. Storage is small either way; this just
-- prevents long-term row accumulation.
create or replace function public.cleanup_api_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_rate_limits
  where window_start < now() - interval '1 hour';
$$;
