-- Bans table: when a user exceeds a rate limit, they are blocked from the
-- endpoint until banned_until passes. One ban per (user, endpoint).
create table public.api_rate_limit_bans (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  banned_until timestamptz not null,
  primary key (user_id, endpoint)
);

create index idx_api_rate_limit_bans_until on public.api_rate_limit_bans(banned_until);

alter table public.api_rate_limit_bans enable row level security;
-- No policies: only service-role (bypasses RLS) can access.

-- Replace the previous RPC: now optionally accepts p_ban_seconds.
-- When > 0 and the count exceeds the limit, the user is banned for that
-- duration and subsequent calls are rejected without further increment.
drop function if exists public.increment_and_check_rate_limit(uuid, text, integer, integer);

create or replace function public.increment_and_check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_window_seconds integer,
  p_max_count integer,
  p_ban_seconds integer default 0
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_current_count integer;
  v_banned_until timestamptz;
begin
  -- 1. Reject if currently banned.
  select banned_until into v_banned_until
  from public.api_rate_limit_bans
  where user_id = p_user_id and endpoint = p_endpoint
  and banned_until > now();

  if found then
    return false;
  end if;

  -- 2. Bucket the current time and atomically increment the counter.
  v_window_start := to_timestamp(
    (extract(epoch from now())::bigint / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (user_id, endpoint, window_start, count)
  values (p_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set count = api_rate_limits.count + 1
  returning count into v_current_count;

  -- 3. If exceeded and a ban duration is configured, ban the user.
  if v_current_count > p_max_count and p_ban_seconds > 0 then
    insert into public.api_rate_limit_bans (user_id, endpoint, banned_until)
    values (p_user_id, p_endpoint, now() + (p_ban_seconds || ' seconds')::interval)
    on conflict (user_id, endpoint) do update
      set banned_until = excluded.banned_until;
    return false;
  end if;

  return v_current_count <= p_max_count;
end;
$$;

revoke execute on function public.increment_and_check_rate_limit(uuid, text, integer, integer, integer)
from public;
revoke execute on function public.increment_and_check_rate_limit(uuid, text, integer, integer, integer)
from anon;
revoke execute on function public.increment_and_check_rate_limit(uuid, text, integer, integer, integer)
from authenticated;
grant execute on function public.increment_and_check_rate_limit(uuid, text, integer, integer, integer)
to service_role;

-- Extend cleanup to also drop expired bans.
create or replace function public.cleanup_api_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_rate_limits
  where window_start < now() - interval '1 hour';

  delete from public.api_rate_limit_bans
  where banned_until < now() - interval '1 hour';
$$;
