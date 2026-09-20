-- CONVO live directory recovery
-- Run this entire file once in Supabase SQL Editor, then reload Convo in BOTH accounts.
-- Safe to rerun. It does not create student records for anybody else and it does not expose email addresses.

alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status_text text;
create unique index if not exists profiles_student_id_unique
on public.profiles(student_id) where student_id is not null;

create or replace function public.is_mtu_account()
returns boolean
language sql
stable
set search_path = pg_catalog, public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) ~ '^[^\\s@]+@mtu\\.edu\\.ng$'
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'ajewoletimothymtu@gmail.com';
$$;

alter table public.profiles enable row level security;
drop policy if exists "MTU users can read profiles" on public.profiles;
create policy "MTU users can read profiles" on public.profiles
for select to authenticated using (public.is_mtu_account());
drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile" on public.profiles
for all to authenticated using (auth.uid() = id and public.is_mtu_account())
with check (auth.uid() = id and public.is_mtu_account());
grant select, insert, update on public.profiles to authenticated;
grant select on public.conversation_members to authenticated;

create or replace function public.sync_my_mtu_profile()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  metadata jsonb;
  public_name text;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU users can synchronize a public profile';
  end if;
  select coalesce(u.raw_user_meta_data, '{}'::jsonb) into metadata
  from auth.users u where u.id = auth.uid();
  public_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  if public_name is null then return false; end if;
  insert into public.profiles (id, display_name, student_id, level, department, programme, avatar_url, bio)
  values (
    auth.uid(), public_name,
    coalesce(nullif(metadata ->> 'student_id', ''), 'MTU-' || upper(substr(replace(auth.uid()::text, '-', ''), 1, 8))),
    nullif(metadata ->> 'level', ''),
    nullif(coalesce(metadata ->> 'college', metadata ->> 'department'), ''),
    nullif(coalesce(metadata ->> 'programme', metadata ->> 'major'), ''),
    nullif(metadata ->> 'avatar_url', ''), nullif(metadata ->> 'bio', '')
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    student_id = coalesce(excluded.student_id, public.profiles.student_id),
    level = coalesce(excluded.level, public.profiles.level),
    department = coalesce(excluded.department, public.profiles.department),
    programme = coalesce(excluded.programme, public.profiles.programme),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    bio = coalesce(excluded.bio, public.profiles.bio);
  return true;
end;
$$;
revoke execute on function public.sync_my_mtu_profile() from public, anon;
grant execute on function public.sync_my_mtu_profile() to authenticated;

drop function if exists public.search_mtu_students(text);
create function public.search_mtu_students(p_query text default '')
returns table (
  id uuid, display_name text, student_id text, is_self boolean, level text,
  department text, programme text, avatar_url text, bio text, status_text text
)
language sql security definer stable
set search_path = pg_catalog, public, auth
as $$
  select p.id, p.display_name, p.student_id, p.id = auth.uid(), p.level,
    p.department, p.programme, p.avatar_url, p.bio, p.status_text
  from public.profiles p
  where public.is_mtu_account()
    and (
      nullif(trim(p_query), '') is null
      or p.display_name ilike '%' || trim(p_query) || '%'
      or coalesce(p.student_id, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%'
    )
  order by (p.id = auth.uid()) desc, p.display_name asc
  limit 48;
$$;
revoke execute on function public.search_mtu_students(text) from public, anon;
grant execute on function public.search_mtu_students(text) to authenticated;

-- Do not call sync_my_mtu_profile() from SQL Editor: SQL Editor has no Convo
-- browser session, so auth.uid() is intentionally empty there. The signed-in
-- Convo application calls this function automatically before every directory search.
