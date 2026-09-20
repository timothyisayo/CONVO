-- Convo live campus-data repair
-- Run this in Supabase SQL Editor to resolve 404s for campus_posts,
-- campus_stories, campus_groups, and get_my_campus_group_memberships.
-- It creates no sample content and does not delete existing data.

create table if not exists public.campus_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  author_meta text not null,
  body text not null check (char_length(body) between 1 and 2000),
  tone text not null default 'rose',
  likes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.campus_stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  initials text not null,
  tone text not null default 'rose',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.campus_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meta text not null,
  tone text not null default 'sage',
  members integer not null default 0,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.campus_group_memberships (
  group_id uuid not null references public.campus_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.campus_posts enable row level security;
alter table public.campus_stories enable row level security;
alter table public.campus_groups enable row level security;
alter table public.campus_group_memberships enable row level security;

drop policy if exists "MTU users can read posts" on public.campus_posts;
create policy "MTU users can read posts"
on public.campus_posts for select to authenticated
using (public.is_mtu_account());

drop policy if exists "MTU users can create posts" on public.campus_posts;
create policy "MTU users can create posts"
on public.campus_posts for insert to authenticated
with check (auth.uid() = author_id and public.is_mtu_account());

drop policy if exists "Authors can update posts" on public.campus_posts;
create policy "Authors can update posts"
on public.campus_posts for update to authenticated
using (auth.uid() = author_id and public.is_mtu_account())
with check (auth.uid() = author_id and public.is_mtu_account());

drop policy if exists "MTU users can read active stories" on public.campus_stories;
create policy "MTU users can read active stories"
on public.campus_stories for select to authenticated
using (public.is_mtu_account() and is_active = true);

drop policy if exists "MTU users can create stories" on public.campus_stories;
create policy "MTU users can create stories"
on public.campus_stories for insert to authenticated
with check (auth.uid() = author_id and public.is_mtu_account());

drop policy if exists "MTU users can read groups" on public.campus_groups;
create policy "MTU users can read groups"
on public.campus_groups for select to authenticated
using (public.is_mtu_account());

drop policy if exists "MTU users can read own memberships" on public.campus_group_memberships;
create policy "MTU users can read own memberships"
on public.campus_group_memberships for select to authenticated
using (auth.uid() = user_id and public.is_mtu_account());

drop policy if exists "MTU users can join groups" on public.campus_group_memberships;
create policy "MTU users can join groups"
on public.campus_group_memberships for insert to authenticated
with check (auth.uid() = user_id and public.is_mtu_account());

drop policy if exists "Users can leave their groups" on public.campus_group_memberships;
create policy "Users can leave their groups"
on public.campus_group_memberships for delete to authenticated
using (auth.uid() = user_id and public.is_mtu_account());

create or replace function public.get_my_campus_group_memberships()
returns table (group_id uuid, joined_at timestamptz)
language sql security definer stable
set search_path = pg_catalog, public, auth
as $$
  select m.group_id, m.joined_at
  from public.campus_group_memberships m
  where m.user_id = auth.uid() and public.is_mtu_account()
  order by m.joined_at desc;
$$;

create or replace function public.join_campus_group(p_group_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare inserted boolean := false;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU users can join groups';
  end if;

  insert into public.campus_group_memberships (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke execute on function public.get_my_campus_group_memberships() from public, anon;
revoke execute on function public.join_campus_group(uuid) from public, anon;
grant execute on function public.get_my_campus_group_memberships() to authenticated;
grant execute on function public.join_campus_group(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.campus_posts;
exception
  when duplicate_object then null;
end;
$$;

-- Expected after execution: the browser console no longer has 404s for
-- campus_posts, campus_stories, campus_groups, or get_my_campus_group_memberships.
