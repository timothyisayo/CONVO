-- CONVO: LIVE STUDENT DIRECTORY + PUBLIC STUDENT-ID SEARCH
-- Run this in Supabase SQL Editor after profile-save-fix.sql.
-- Safe to rerun. It does not create or seed profiles.

alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status_text text;

create unique index if not exists profiles_student_id_unique
on public.profiles(student_id)
where student_id is not null;

-- The former RPC excluded auth.uid(), which made it impossible for a student
-- to verify that their own completed profile and generated public ID existed.
drop function if exists public.search_mtu_students(text);

create function public.search_mtu_students(p_query text default '')
returns table (
  id uuid,
  display_name text,
  student_id text,
  is_self boolean,
  level text,
  department text,
  programme text,
  avatar_url text,
  bio text,
  status_text text
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    p.id,
    p.display_name,
    p.student_id,
    p.id = auth.uid() as is_self,
    p.level,
    p.department,
    p.programme,
    p.avatar_url,
    p.bio,
    p.status_text
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

-- Diagnostics: your own completed profile should appear as is_self = true.
select id, display_name, student_id, is_self, level, department, programme
from public.search_mtu_students('');
