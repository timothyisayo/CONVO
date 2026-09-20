-- Convo profile-save repair
-- Run this once in Supabase SQL Editor.
-- This does not delete data or relax access for arbitrary Gmail addresses.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  level text,
  department text,
  programme text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status_text text;

create unique index if not exists profiles_student_id_unique
on public.profiles(student_id)
where student_id is not null;

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
create policy "MTU users can read profiles"
on public.profiles for select
to authenticated
using (public.is_mtu_account());

drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile"
on public.profiles for all
to authenticated
using (auth.uid() = id and public.is_mtu_account())
with check (auth.uid() = id and public.is_mtu_account());

grant select, insert, update on public.profiles to authenticated;

-- Avatar storage: public reads are allowed, but uploads must be authenticated,
-- MTU-approved, and stored under avatars/<auth-user-id>/.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "MTU users can upload avatars" on storage.objects;
create policy "MTU users can upload avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and public.is_mtu_account()
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- Optional one-time backfill for an already-authenticated test account.
-- It is intentionally omitted because the app supplies the student's real values.
-- After running this patch, reload Convo and click Complete Profile again.

select
  c.relname as table_name,
  has_table_privilege('authenticated', c.oid, 'SELECT') as can_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as can_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as can_update
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'profiles';

select
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by policyname;

-- Expected result: one profiles row, authenticated INSERT/UPDATE true,
-- and the two policies listed above.

-- Security note: the Gmail exception is intentionally limited to the one
-- address used for testing. Remove that OR clause before production if the
-- account is no longer needed as a test exception.
-- Keep the auth.users email-enforcement trigger unchanged; this patch only
-- governs profile persistence and does not bypass Supabase Auth verification.

-- If your project already has a different is_mtu_account signature or policy
-- names, this script remains rerunnable because policies are dropped first.
