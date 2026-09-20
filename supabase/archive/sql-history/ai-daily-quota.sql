-- Timothy's daily AI usage quota. Apply this migration in Supabase before using the assistant.
create table if not exists public.mtu_ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0),
  session_started_at timestamptz,
  cooldown_until timestamptz,
  primary key (user_id, usage_date)
);

alter table public.mtu_ai_daily_usage enable row level security;

create or replace function public.consume_mtu_ai_quota(p_session_minutes integer default 120, p_cooldown_minutes integer default 60)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
  session_started timestamptz;
  cooldown_ends timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_session_minutes < 1 or p_cooldown_minutes < 1 then
    raise exception 'Invalid session settings' using errcode = '22023';
  end if;

  insert into public.mtu_ai_daily_usage(user_id, usage_date, request_count, session_started_at)
  values (auth.uid(), current_date, 1, now())
  on conflict (user_id, usage_date) do nothing;
  select session_started_at, cooldown_until into session_started, cooldown_ends
  from public.mtu_ai_daily_usage
  where user_id = auth.uid() and usage_date = current_date
  for update;

  if cooldown_ends is not null and cooldown_ends > now() then
    return jsonb_build_object('allowed', false, 'cooldown_seconds', greatest(1, extract(epoch from (cooldown_ends - now()))::integer));
  end if;

  if session_started is not null and now() >= session_started + make_interval(mins => p_session_minutes) and cooldown_ends is null then
    update public.mtu_ai_daily_usage
    set cooldown_until = now() + make_interval(mins => p_cooldown_minutes)
    where user_id = auth.uid() and usage_date = current_date;
    return jsonb_build_object('allowed', false, 'cooldown_seconds', p_cooldown_minutes * 60);
  end if;

  if session_started is null or (now() >= session_started + make_interval(mins => p_session_minutes) and cooldown_ends <= now()) then
    update public.mtu_ai_daily_usage
    set session_started_at = now(),
        cooldown_until = null,
        request_count = request_count + 1
    where user_id = auth.uid() and usage_date = current_date;
    return jsonb_build_object('allowed', true, 'session_seconds', p_session_minutes * 60, 'cooldown_seconds', 0);
  end if;

  update public.mtu_ai_daily_usage
  set request_count = request_count + 1
  where user_id = auth.uid() and usage_date = current_date;
  return jsonb_build_object('allowed', true, 'session_seconds', greatest(1, extract(epoch from (session_started + make_interval(mins => p_session_minutes) - now()))::integer), 'cooldown_seconds', 0);
end;
$$;

revoke all on function public.consume_mtu_ai_quota(integer, integer) from public;
grant execute on function public.consume_mtu_ai_quota(integer, integer) to authenticated;
