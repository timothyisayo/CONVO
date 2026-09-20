-- CONVO profile privacy + profile update repair
-- Run this entire file in Supabase Dashboard → SQL Editor.
-- Safe to rerun. It does not expose emails or create fake student profiles.

alter table public.profiles
add column if not exists profile_visibility jsonb not null default
  '{"programme": true, "college": true, "level": true, "bio": true}'::jsonb;

update public.profiles
set profile_visibility = '{"programme": true, "college": true, "level": true, "bio": true}'::jsonb
where profile_visibility is null;

create or replace function public.is_mtu_account()
returns boolean
language sql
stable
set search_path = pg_catalog, public, auth
as $$
  select
    right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@mtu.edu.ng'
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'ajewoletimothymtu@gmail.com';
$$;

-- Direct table reads are limited to the owner. Directory results are served by
-- the secure function below, which masks fields the profile owner made private.
alter table public.profiles enable row level security;
drop policy if exists "MTU users can read profiles" on public.profiles;
drop policy if exists "Students can read own or peer profiles" on public.profiles;
drop policy if exists "Students can read own profile" on public.profiles;
create policy "Students can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id and public.is_mtu_account());

drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile"
on public.profiles for all to authenticated
using (auth.uid() = id and public.is_mtu_account())
with check (auth.uid() = id and public.is_mtu_account());

create or replace function public.sync_my_mtu_profile()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  metadata jsonb;
  public_name text;
  visibility jsonb;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU users can synchronize a public profile';
  end if;

  select coalesce(u.raw_user_meta_data, '{}'::jsonb)
  into metadata
  from auth.users u
  where u.id = auth.uid();

  public_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  if public_name is null then return false; end if;

  visibility := jsonb_build_object(
    'programme', coalesce((metadata -> 'profile_visibility' ->> 'programme')::boolean, true),
    'college', coalesce((metadata -> 'profile_visibility' ->> 'college')::boolean, true),
    'level', coalesce((metadata -> 'profile_visibility' ->> 'level')::boolean, true),
    'bio', coalesce((metadata -> 'profile_visibility' ->> 'bio')::boolean, true)
  );

  insert into public.profiles (
    id, display_name, student_id, level, department, programme,
    avatar_url, bio, profile_visibility
  )
  values (
    auth.uid(), public_name,
    coalesce(nullif(metadata ->> 'student_id', ''), 'MTU-' || upper(substr(replace(auth.uid()::text, '-', ''), 1, 8))),
    nullif(metadata ->> 'level', ''),
    nullif(coalesce(metadata ->> 'college', metadata ->> 'department'), ''),
    nullif(coalesce(metadata ->> 'programme', metadata ->> 'major'), ''),
    nullif(metadata ->> 'avatar_url', ''), nullif(metadata ->> 'bio', ''), visibility
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    student_id = coalesce(excluded.student_id, public.profiles.student_id),
    level = coalesce(excluded.level, public.profiles.level),
    department = coalesce(excluded.department, public.profiles.department),
    programme = coalesce(excluded.programme, public.profiles.programme),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    bio = coalesce(excluded.bio, public.profiles.bio),
    profile_visibility = excluded.profile_visibility;
  return true;
end;
$$;

revoke execute on function public.sync_my_mtu_profile() from public, anon;
grant execute on function public.sync_my_mtu_profile() to authenticated;

drop function if exists public.search_mtu_students(text);
create function public.search_mtu_students(p_query text default '')
returns table (
  id uuid, display_name text, student_id text, is_self boolean,
  level text, department text, programme text, avatar_url text,
  bio text, status_text text
)
language sql security definer stable
set search_path = pg_catalog, public, auth
as $$
  with requester as (
    select level, programme
    from public.profiles
    where id = auth.uid()
  )
  select
    p.id,
    p.display_name,
    p.student_id,
    p.id = auth.uid() as is_self,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'level')::boolean, true) then p.level else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'college')::boolean, true) then p.department else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'programme')::boolean, true) then p.programme else null end,
    p.avatar_url,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'bio')::boolean, true) then p.bio else null end,
    p.status_text
  from public.profiles p
  cross join requester me
  where public.is_mtu_account()
    and (
      lower(trim(coalesce(p.student_id, ''))) = lower(trim(p_query))
      or (
        p.programme = me.programme
        and p.level = me.level
        and (
          nullif(trim(p_query), '') is null
          or p.display_name ilike '%' || trim(p_query) || '%'
          or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
          or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%'
          or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
        )
      )
    )
  order by (p.id = auth.uid()) desc, p.display_name asc
  limit 48;
$$;

revoke execute on function public.search_mtu_students(text) from public, anon;
grant execute on function public.search_mtu_students(text) to authenticated;

-- Do not call sync_my_mtu_profile() in SQL Editor. Convo calls it from the
-- signed-in browser after profile or privacy changes, where auth.uid() exists.
