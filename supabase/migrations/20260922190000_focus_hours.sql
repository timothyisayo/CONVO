-- Individual Focus Hour sessions. Sessions are intentionally not shared rooms:
-- the row belongs to one student and the list RPC only exposes eligible peers.
create table if not exists public.mtu_focus_hours (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (30, 45, 60)),
  active boolean not null default true,
  ended_at timestamptz,
  check (ends_at > started_at)
);
alter table public.mtu_focus_hours add column if not exists duration_minutes integer;
alter table public.mtu_focus_hours add column if not exists active boolean not null default true;
update public.mtu_focus_hours set duration_minutes = greatest(30, least(60, ceil(extract(epoch from (ends_at - started_at)) / 60)::integer)) where duration_minutes is null;
alter table public.mtu_focus_hours alter column duration_minutes set not null;
alter table public.mtu_focus_hours add constraint mtu_focus_hours_duration_check check (duration_minutes in (30, 45, 60));

create index if not exists mtu_focus_hours_active_idx
  on public.mtu_focus_hours (ends_at) where ended_at is null;

alter table public.mtu_focus_hours enable row level security;
drop policy if exists "focus hours own row" on public.mtu_focus_hours;
create policy "focus hours own row" on public.mtu_focus_hours
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "focus hours eligible rows" on public.mtu_focus_hours;
create policy "focus hours eligible rows" on public.mtu_focus_hours
  for select using (
    auth.uid() is not null and public.is_mtu_account()
    and active and ended_at is null and ends_at > now()
    and exists (
      select 1 from public.profiles p
      where p.id = user_id
        and coalesce((p.profile_visibility ->> 'programme')::boolean, true)
        and coalesce((p.profile_visibility ->> 'focus_hour')::boolean, false)
    )
    and not exists (
      select 1 from public.student_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = user_id)
         or (b.blocker_id = user_id and b.blocked_id = auth.uid())
    )
  );

create or replace function public.start_mtu_focus_hour(p_minutes integer)
returns public.mtu_focus_hours
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.mtu_focus_hours;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to start a focus hour'; end if;
  if p_minutes not in (30, 45, 60) then raise exception 'Choose 30, 45, or 60 minutes'; end if;
  insert into public.mtu_focus_hours(user_id, started_at, ends_at, ended_at)
  values (auth.uid(), now(), now() + make_interval(mins => p_minutes), p_minutes, true, null)
  on conflict (user_id) do update set started_at = excluded.started_at, ends_at = excluded.ends_at, duration_minutes = excluded.duration_minutes, active = true, ended_at = null
  returning * into result;
  return result;
end;
$$;

create or replace function public.end_mtu_focus_hour()
returns public.mtu_focus_hours
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.mtu_focus_hours;
begin
  update public.mtu_focus_hours set ended_at = now(), active = false
  where user_id = auth.uid() and active and ended_at is null and ends_at > now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.get_my_mtu_focus_hour()
returns public.mtu_focus_hours
language sql security definer set search_path = pg_catalog, public, auth
as $$
  select * from public.mtu_focus_hours
  where user_id = auth.uid() and active and ended_at is null and ends_at > now();
$$;

create or replace function public.list_mtu_focus_hours()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  programme text,
  level text,
  started_at timestamptz,
  ends_at timestamptz
)
language sql security definer set search_path = pg_catalog, public, auth
as $$
  select f.user_id, p.display_name, p.avatar_url, p.programme, p.level, f.started_at, f.ends_at
  from public.mtu_focus_hours f
  join public.profiles p on p.id = f.user_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and f.active and f.ended_at is null and f.ends_at > now()
    and f.user_id <> auth.uid()
    and coalesce((p.profile_visibility ->> 'programme')::boolean, true)
    and coalesce((p.profile_visibility ->> 'focus_hour')::boolean, false)
    and not exists (
      select 1 from public.student_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = f.user_id)
         or (b.blocker_id = f.user_id and b.blocked_id = auth.uid())
    )
  order by f.started_at desc;
$$;

revoke all on public.mtu_focus_hours from anon, authenticated;
grant select on public.mtu_focus_hours to authenticated;
revoke execute on function public.start_mtu_focus_hour(integer), public.end_mtu_focus_hour(), public.get_my_mtu_focus_hour(), public.list_mtu_focus_hours() from public, anon;
grant execute on function public.start_mtu_focus_hour(integer), public.end_mtu_focus_hour(), public.get_my_mtu_focus_hour(), public.list_mtu_focus_hours() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.mtu_focus_hours;
exception when duplicate_object then null;
end $$;
