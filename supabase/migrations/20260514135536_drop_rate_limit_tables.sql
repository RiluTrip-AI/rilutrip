-- Drop the rate-limit and ban tables and helper functions created by the
-- earlier rate-limit migrations. The optimize-route Edge Function no longer
-- enforces per-user rate limiting, so these objects are unused.

-- Unschedule any pg_cron job that called cleanup_api_rate_limits, ignoring
-- environments where pg_cron is not installed.
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where command like '%cleanup_api_rate_limits%'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
exception
  when others then null;
end $$;

drop function if exists public.cleanup_api_rate_limits();
drop function if exists public.increment_and_check_rate_limit(uuid, text, integer, integer, integer);
drop function if exists public.increment_and_check_rate_limit(uuid, text, integer, integer);

drop table if exists public.api_rate_limit_bans;
drop table if exists public.api_rate_limits;
