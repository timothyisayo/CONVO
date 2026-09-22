-- CONVO — CANONICAL SUPABASE DATABASE SETUP`n-- Sole authoritative fresh-project setup. Run this entire file once in Supabase SQL Editor.`n-- Historical SQL is archived under supabase/archive/sql-history.`n
-- CONVO: COMPLETE SUPABASE SETUP
-- Run this entire file in Supabase Dashboard â†’ SQL Editor.
-- Order: messaging foundation â†’ campus data â†’ profile/storage â†’ directory search.
-- This bundle is composed from the projectâ€™s validated rerun-safe handoff files.

-- ===== 1. MESSAGING FOUNDATION =====
-- Convo complete messaging setup for Supabase
-- Run this entire file in Supabase Dashboard -> SQL Editor.
-- Do not run it in the Manus internal database console.
-- It is designed to be safe to re-run after the base Convo schema.
-- If the base profile migration has not been run yet, this file creates the
-- minimum profile table required by discovery and messaging first.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  level text,
  department text,
  programme text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Required profile fields for private MTU discovery.
alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists status_text text;
alter table public.profiles add column if not exists profile_visibility jsonb not null default
  '{"programme": true, "college": true, "level": true, "bio": true, "focus_hour": false}'::jsonb;

update public.profiles
set student_id = 'MTU-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where student_id is null;

create unique index if not exists profiles_student_id_unique
on public.profiles(student_id)
where student_id is not null;

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

alter table public.profiles enable row level security;
drop policy if exists "Students can read own profile" on public.profiles;
drop policy if exists "MTU users can read profiles" on public.profiles;
drop policy if exists "Students can read own profile" on public.profiles;
create policy "Students can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id and public.is_mtu_account());

drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile"
on public.profiles for all to authenticated
using (auth.uid() = id and public.is_mtu_account())
with check (auth.uid() = id and public.is_mtu_account());

-- Student connection requests.
create table if not exists public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

alter table public.connection_requests enable row level security;

drop policy if exists "MTU users can read their connection requests" on public.connection_requests;
create policy "MTU users can read their connection requests"
on public.connection_requests for select to authenticated
using (
  public.is_mtu_account()
  and (auth.uid() = requester_id or auth.uid() = recipient_id)
);

drop policy if exists "MTU users can create connection requests" on public.connection_requests;
create policy "MTU users can create connection requests"
on public.connection_requests for insert to authenticated
with check (
  public.is_mtu_account()
  and auth.uid() = requester_id
  and requester_id <> recipient_id
);

drop policy if exists "Recipients can update connection requests" on public.connection_requests;
drop policy if exists "Recipients can accept connection requests" on public.connection_requests;
create policy "Recipients can update connection requests"
on public.connection_requests for update to authenticated
using (public.is_mtu_account() and auth.uid() = recipient_id)
with check (public.is_mtu_account() and auth.uid() = recipient_id);

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
set search_path = public
as $$
  select p.id, p.display_name, p.student_id, p.id = auth.uid() as is_self, p.level, p.department,
    p.programme, p.avatar_url, p.bio, p.status_text
  from public.profiles p
  where public.is_mtu_account()
    and (
      nullif(trim(p_query), '') is null
      or p.display_name ilike '%' || trim(p_query) || '%'
      or p.student_id ilike '%' || trim(p_query) || '%'
      or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%'
    )
  order by (p.id = auth.uid()) desc, p.display_name asc
  limit 24;
$$;

grant execute on function public.search_mtu_students(text) to authenticated;

create or replace function public.send_connection_request(p_recipient_id uuid)
returns public.connection_requests
language plpgsql
security definer
set search_path = public
as $$
declare result public.connection_requests;
begin
  if not public.is_mtu_account() or auth.uid() is null
     or auth.uid() = p_recipient_id then
    raise exception 'Only verified MTU users can send connection requests';
  end if;

  insert into public.connection_requests (requester_id, recipient_id)
  values (auth.uid(), p_recipient_id)
  on conflict (requester_id, recipient_id)
  do update set status = 'pending', updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.send_connection_request(uuid) to authenticated;

create or replace function public.cancel_connection_request(p_recipient_id uuid)
returns public.connection_requests
language plpgsql
security definer
set search_path = public
as $$
declare result public.connection_requests;
begin
  if not public.is_mtu_account() or auth.uid() is null then
    raise exception 'Only verified MTU users can cancel connection requests';
  end if;
  update public.connection_requests
  set status = 'declined', updated_at = now()
  where requester_id = auth.uid()
    and recipient_id = p_recipient_id
    and status = 'pending'
  returning * into result;
  if result.id is null then
    raise exception 'No pending connection request found';
  end if;
  return result;
end;
$$;

grant execute on function public.cancel_connection_request(uuid) to authenticated;

create or replace function public.accept_connection_request(p_request_id uuid)
returns public.connection_requests
language plpgsql
security definer
set search_path = public
as $$
declare result public.connection_requests;
begin
  update public.connection_requests
  set status = 'accepted', updated_at = now()
  where id = p_request_id
    and recipient_id = auth.uid()
    and public.is_mtu_account()
    and status = 'pending'
  returning * into result;

  if result.id is null then
    raise exception 'This connection request cannot be accepted';
  end if;

  return result;
end;
$$;

grant execute on function public.accept_connection_request(uuid) to authenticated;

-- Conversations and persisted messages.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct', 'group')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(trim(body)) between 0 and 4000),
  attachment_url text,
  attachment_path text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_body_or_attachment check (char_length(trim(body)) between 1 and 4000 or (char_length(trim(body)) = 0 and attachment_url is not null))
);
alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_or_attachment;
alter table public.messages add constraint messages_body_or_attachment check (char_length(trim(body)) between 1 and 4000 or (char_length(trim(body)) = 0 and attachment_url is not null)) not valid;

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "MTU users can upload message attachments" on storage.objects;
create policy "MTU users can upload message attachments"
on storage.objects for insert to authenticated
with check (bucket_id = 'message-attachments' and public.is_mtu_account() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "MTU users can update message attachments" on storage.objects;
create policy "MTU users can update message attachments"
on storage.objects for update to authenticated
using (bucket_id = 'message-attachments' and public.is_mtu_account() and owner_id = auth.uid()::text)
with check (bucket_id = 'message-attachments' and public.is_mtu_account() and owner_id = auth.uid()::text);
drop policy if exists "MTU users can delete message attachments" on storage.objects;
create policy "MTU users can delete message attachments"
on storage.objects for delete to authenticated
using (bucket_id = 'message-attachments' and public.is_mtu_account() and owner_id = auth.uid()::text);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reads add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
update public.message_reads mr set conversation_id = m.conversation_id from public.messages m where mr.message_id = m.id and mr.conversation_id is null;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

drop policy if exists "Members can read conversations" on public.conversations;
create policy "Members can read conversations"
on public.conversations for select to authenticated
using (
  public.is_mtu_account()
  and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = id and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can read membership" on public.conversation_members;
create policy "Members can read membership"
on public.conversation_members for select to authenticated
using (public.is_mtu_account() and user_id = auth.uid());

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
on public.messages for select to authenticated
using (
  public.is_mtu_account()
  and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = messages.conversation_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
on public.messages for insert to authenticated
with check (
  public.is_mtu_account()
  and sender_id = auth.uid()
  and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = messages.conversation_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Members can manage their message reads" on public.message_reads;
drop policy if exists "Members can read message receipts" on public.message_reads;
drop policy if exists "Users can write own message receipts" on public.message_reads;
drop policy if exists "Users can update own message receipts" on public.message_reads;
create policy "Members can read message receipts"
on public.message_reads for select to authenticated
using (
  public.is_mtu_account()
  and exists (
    select 1 from public.messages msg
    join public.conversation_members member on member.conversation_id = msg.conversation_id
    where msg.id = message_reads.message_id and member.user_id = auth.uid()
  )
);
create policy "Users can write own message receipts"
on public.message_reads for insert to authenticated
with check (public.is_mtu_account() and user_id = auth.uid());
create policy "Users can update own message receipts"
on public.message_reads for update to authenticated
using (public.is_mtu_account() and user_id = auth.uid())
with check (public.is_mtu_account() and user_id = auth.uid());

create or replace function public.start_mtu_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare result_id uuid;
begin
  if not public.is_mtu_account() or auth.uid() is null
     or auth.uid() = p_other_user_id then
    raise exception 'Only verified MTU students can start conversations';
  end if;

  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'Student profile not found';
  end if;

  if not exists (
    select 1 from public.connection_requests r
    where r.status = 'accepted'
      and ((r.requester_id = auth.uid() and r.recipient_id = p_other_user_id)
        or (r.requester_id = p_other_user_id and r.recipient_id = auth.uid()))
  ) then
    raise exception 'Accept the connection request before messaging this student';
  end if;

  select c.id into result_id
  from public.conversations c
  where c.kind = 'direct'
    and exists (select 1 from public.conversation_members m
                where m.conversation_id = c.id and m.user_id = auth.uid())
    and exists (select 1 from public.conversation_members m
                where m.conversation_id = c.id and m.user_id = p_other_user_id)
    and (select count(*) from public.conversation_members m
         where m.conversation_id = c.id) = 2
  limit 1;

  if result_id is null then
    insert into public.conversations (kind)
    values ('direct') returning id into result_id;
    insert into public.conversation_members (conversation_id, user_id)
    values (result_id, auth.uid()), (result_id, p_other_user_id);
  end if;

  return result_id;
end;
$$;

grant execute on function public.start_mtu_direct_conversation(uuid) to authenticated;

create or replace function public.create_mtu_group_conversation(
  p_title text,
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare result_id uuid;
begin
  if not public.is_mtu_account() or auth.uid() is null
     or char_length(trim(p_title)) not between 1 and 80 then
    raise exception 'Enter a valid MTU group name';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_member_ids, '{}')) member_id
    where not exists (select 1 from public.profiles p where p.id = member_id)
  ) then
    raise exception 'Every group member must have an MTU profile';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_member_ids, '{}')) member_id
    where member_id <> auth.uid()
      and not exists (
        select 1 from public.connection_requests r
        where r.status = 'accepted'
          and ((r.requester_id = auth.uid() and r.recipient_id = member_id)
            or (r.requester_id = member_id and r.recipient_id = auth.uid()))
      )
  ) then
    raise exception 'Group members must be accepted MTU connections';
  end if;

  insert into public.conversations (kind, title)
  values ('group', trim(p_title)) returning id into result_id;

  insert into public.conversation_members (conversation_id, user_id)
  select result_id, member_id
  from unnest(array_append(coalesce(p_member_ids, '{}'), auth.uid())) member_id
  on conflict do nothing;

  return result_id;
end;
$$;

grant execute on function public.create_mtu_group_conversation(text, uuid[]) to authenticated;

drop function if exists public.send_mtu_message(uuid, text);
create or replace function public.send_mtu_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_path text default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare result public.messages;
begin
  if not public.is_mtu_account() or auth.uid() is null
     or not exists (
       select 1 from public.conversation_members
       where conversation_id = p_conversation_id and user_id = auth.uid()
     ) then
    raise exception 'You are not a member of this conversation';
  end if;

  if char_length(trim(coalesce(p_body, ''))) > 4000 then
    raise exception 'Messages must be 4,000 characters or fewer';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then
    raise exception 'Add a message or image before sending';
  end if;

  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path)
  returning * into result;

  update public.conversations
  set updated_at = now()
  where id = p_conversation_id;

  return result;
end;
$$;

grant execute on function public.send_mtu_message(uuid, text, text, text) to authenticated;

drop function if exists public.edit_mtu_message(uuid, text);
create or replace function public.edit_mtu_message(p_message_id uuid, p_body text)
returns public.messages
language plpgsql security definer set search_path = public
as $$
declare result public.messages;
begin
  if not public.is_mtu_account() or char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Enter a message up to 4,000 characters'; end if;
  update public.messages set body = trim(p_body), edited_at = now()
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null and created_at > now() - interval '15 minutes'
  returning * into result;
  if result.id is null then raise exception 'Messages can only be edited by you within 15 minutes'; end if;
  update public.conversations set updated_at = now() where id = result.conversation_id;
  return result;
end;
$$;
grant execute on function public.edit_mtu_message(uuid, text) to authenticated;

drop function if exists public.delete_mtu_message(uuid);
create or replace function public.delete_mtu_message(p_message_id uuid)
returns public.messages
language plpgsql security definer set search_path = public
as $$
declare result public.messages;
begin
  update public.messages set body = 'Message deleted', attachment_url = null, attachment_path = null, deleted_at = now()
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null and created_at > now() - interval '15 minutes'
  returning * into result;
  if result.id is null then raise exception 'Messages can only be deleted by you within 15 minutes'; end if;
  update public.conversations set updated_at = now() where id = result.conversation_id;
  return result;
end;
$$;
grant execute on function public.delete_mtu_message(uuid) to authenticated;

create or replace function public.list_mtu_conversations_v2()
returns table (
  id uuid,
  kind text,
  title text,
  updated_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.kind, c.title, c.updated_at,
    lm.body, lm.created_at,
    coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id = c.id
        and unread.sender_id <> auth.uid()
        and not exists (
          select 1 from public.message_reads mr
          where mr.message_id = unread.id and mr.user_id = auth.uid()
        )
    ), 0) as unread_count
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid()
  left join lateral (
    select m.body, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where public.is_mtu_account()
  order by c.updated_at desc;
$$;

grant execute on function public.list_mtu_conversations_v2() to authenticated;

drop function if exists public.list_mtu_messages(uuid);
create or replace function public.list_mtu_messages(p_conversation_id uuid)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  attachment_url text,
  attachment_path text,
  edited_at timestamptz,
  deleted_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    max(mr.read_at) filter (where mr.user_id <> m.sender_id) as read_at,
    m.attachment_url, m.attachment_path, m.edited_at, m.deleted_at
  from public.messages m
  left join public.message_reads mr on mr.message_id = m.id
  where public.is_mtu_account()
    and m.conversation_id = p_conversation_id
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = m.conversation_id
        and cm.user_id = auth.uid()
    )
  group by m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_path, m.edited_at, m.deleted_at
  order by m.created_at asc;
$$;

grant execute on function public.list_mtu_messages(uuid) to authenticated;

create or replace function public.mark_mtu_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  if not public.is_mtu_account()
     or not exists (
       select 1 from public.conversation_members
       where conversation_id = p_conversation_id and user_id = auth.uid()
     ) then
    raise exception 'You are not a member of this conversation';
  end if;

  insert into public.message_reads (message_id, user_id, conversation_id)
  select m.id, auth.uid(), m.conversation_id
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> auth.uid()
  on conflict (message_id, user_id) do update set read_at = now(), conversation_id = excluded.conversation_id;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

grant execute on function public.mark_mtu_conversation_read(uuid) to authenticated;

-- Realtime publication: guarded so this can be run repeatedly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end $$;

-- ===== 2. CAMPUS DATA FOUNDATION =====
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

-- RLS policies do not grant table privileges by themselves. These grants allow
-- the authenticated role to reach the campus tables, while the policies above
-- remain the access-control boundary.
grant select, insert, update on public.campus_posts to authenticated;
grant select, insert on public.campus_stories to authenticated;
grant select on public.campus_groups to authenticated;
grant select, insert, delete on public.campus_group_memberships to authenticated;

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

-- ===== 3. PROFILE, AVATAR STORAGE, AND TEST-ACCOUNT POLICY =====
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
  select lower(coalesce(auth.jwt() ->> 'email', '')) ~ '^[^\s@]+@mtu\.edu\.ng$'
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'ajewoletimothymtu@gmail.com';
$$;

alter table public.profiles enable row level security;
drop policy if exists "Students can read own profile" on public.profiles;
drop policy if exists "MTU users can read profiles" on public.profiles;
create policy "Students can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id and public.is_mtu_account());

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

-- ===== 4. STUDENT DIRECTORY SEARCH =====
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
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'level')::boolean, true) then p.level else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'college')::boolean, true) then p.department else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'programme')::boolean, true) then p.programme else null end,
    p.avatar_url,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'bio')::boolean, true) then p.bio else null end,
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
  select coalesce(u.raw_user_meta_data, '{}'::jsonb) into metadata
  from auth.users u where u.id = auth.uid();
  public_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  if public_name is null then return false; end if;
  visibility := jsonb_build_object(
    'programme', coalesce((metadata -> 'profile_visibility' ->> 'programme')::boolean, true),
    'college', coalesce((metadata -> 'profile_visibility' ->> 'college')::boolean, true),
    'level', coalesce((metadata -> 'profile_visibility' ->> 'level')::boolean, true),
    'bio', coalesce((metadata -> 'profile_visibility' ->> 'bio')::boolean, true),
    'focus_hour', coalesce((metadata -> 'profile_visibility' ->> 'focus_hour')::boolean, false)
  );
  insert into public.profiles (id, display_name, student_id, level, department, programme, avatar_url, bio, profile_visibility)
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

-- Keep the directory current as soon as a verified MTU user registers.
create or replace function public.handle_new_mtu_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  public_name text;
begin
  if right(lower(coalesce(new.email, '')), 11) <> '@mtu.edu.ng'
     and lower(coalesce(new.email, '')) <> 'ajewoletimothymtu@gmail.com' then
    return new;
  end if;

  public_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'nickname',
    new.raw_user_meta_data ->> 'display_name',
    ''
  )), '');
  if public_name is null then
    return new;
  end if;

  insert into public.profiles (
    id, display_name, student_id, level, department, programme, avatar_url, bio
  )
  values (
    new.id,
    public_name,
    coalesce(nullif(new.raw_user_meta_data ->> 'student_id', ''),
      'MTU-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))),
    nullif(new.raw_user_meta_data ->> 'level', ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'college',
      new.raw_user_meta_data ->> 'department'), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'programme',
      new.raw_user_meta_data ->> 'major'), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'bio', '')
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    student_id = coalesce(excluded.student_id, public.profiles.student_id),
    level = coalesce(excluded.level, public.profiles.level),
    department = coalesce(excluded.department, public.profiles.department),
    programme = coalesce(excluded.programme, public.profiles.programme),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    bio = coalesce(excluded.bio, public.profiles.bio);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_mtu_profile on auth.users;
create trigger on_auth_user_created_mtu_profile
after insert on auth.users
for each row execute function public.handle_new_mtu_profile();

-- Do not call sync_my_mtu_profile() from SQL Editor: SQL Editor has no Convo
-- browser session, so auth.uid() is intentionally empty there. The signed-in
-- Convo application calls this function automatically before every directory search.


-- ===== CONSOLIDATED: convo-messaging-live-upgrade.sql =====
-- CONVO LIVE MESSAGING UPGRADE
-- Paste this entire script into Supabase Dashboard -> SQL Editor and click Run ONCE.
-- Prerequisite: the original Convo messaging foundation (conversations, conversation_members,
-- messages, message_reads, connection_requests, profiles, is_mtu_account) already exists.
-- Do NOT call the RPC functions manually in SQL Editor: they require a signed-in student auth.uid().
-- This script is safe to rerun. It only exposes public nickname/student ID, never legal name or email.

-- 1) Connection-request public identity.
drop function if exists public.list_mtu_connection_requests();
create function public.list_mtu_connection_requests()
returns table (id uuid, requester_id uuid, recipient_id uuid, status text, direction text, updated_at timestamptz, requester_display_name text, requester_student_id text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select r.id, r.requester_id, r.recipient_id, r.status,
    case when r.requester_id = auth.uid() then 'sent' else 'received' end,
    r.updated_at, p.display_name, p.student_id
  from public.connection_requests r
  left join public.profiles p on p.id = r.requester_id
  where r.requester_id = auth.uid() or r.recipient_id = auth.uid()
  order by r.updated_at desc;
$$;
revoke execute on function public.list_mtu_connection_requests() from public, anon;
grant execute on function public.list_mtu_connection_requests() to authenticated;

-- 2) Direct-chat safety: block and report are private to the reporter/blocker.
create table if not exists public.student_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create table if not exists public.student_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 600),
  created_at timestamptz not null default now(), check (reporter_id <> reported_id)
);
alter table public.student_blocks enable row level security;
alter table public.student_reports enable row level security;
drop policy if exists "Students manage their own blocks" on public.student_blocks;
create policy "Students manage their own blocks" on public.student_blocks for all to authenticated
  using (blocker_id = auth.uid() and public.is_mtu_account())
  with check (blocker_id = auth.uid() and public.is_mtu_account());
drop policy if exists "Students create own reports" on public.student_reports;
create policy "Students create own reports" on public.student_reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_mtu_account());

create or replace function public.block_mtu_student(p_student_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then raise exception 'Only verified MTU students can block another student'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then raise exception 'Student profile not found'; end if;
  insert into public.student_blocks (blocker_id, blocked_id) values (auth.uid(), p_student_id) on conflict do nothing;
  update public.connection_requests set status = 'blocked', updated_at = now()
  where (requester_id = auth.uid() and recipient_id = p_student_id) or (requester_id = p_student_id and recipient_id = auth.uid());
  return true;
end;
$$;
create or replace function public.report_mtu_student(p_student_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare report_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then raise exception 'Only verified MTU students can submit this report'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then raise exception 'Student profile not found'; end if;
  insert into public.student_reports (reporter_id, reported_id, reason) values (auth.uid(), p_student_id, trim(p_reason)) returning id into report_id;
  return report_id;
end;
$$;
create or replace function public.start_mtu_direct_conversation(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_other_user_id then raise exception 'Only verified MTU students can start conversations'; end if;
  if exists (select 1 from public.student_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p_other_user_id) or (b.blocker_id = p_other_user_id and b.blocked_id = auth.uid())) then raise exception 'This conversation is unavailable'; end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then raise exception 'Student profile not found'; end if;
  if not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = p_other_user_id) or (r.requester_id = p_other_user_id and r.recipient_id = auth.uid()))) then raise exception 'Accept the connection request before messaging this student'; end if;
  select c.id into result_id from public.conversations c where c.kind = 'direct'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other_user_id)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2 limit 1;
  if result_id is null then
    insert into public.conversations (kind) values ('direct') returning id into result_id;
    insert into public.conversation_members (conversation_id, user_id) values (result_id, auth.uid()), (result_id, p_other_user_id);
  end if;
  return result_id;
end;
$$;

-- 3) Reactions, saved messages, pins, replies, private labels, and bounded media metadata.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(), primary key (message_id, user_id, emoji)
);
create table if not exists public.saved_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, message_id)
);
create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (conversation_id, message_id)
);
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists attachment_mime text;
create index if not exists messages_reply_to_id_idx on public.messages(reply_to_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachment_mime_check') then
    alter table public.messages add constraint messages_attachment_mime_check check (attachment_mime is null or attachment_mime in ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime'));
  end if;
end $$;
create table if not exists public.conversation_member_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  private_label text, is_archived boolean not null default false, updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id), constraint conversation_member_preferences_label_length check (private_label is null or char_length(trim(private_label)) between 1 and 80)
);
alter table public.message_reactions enable row level security;
alter table public.saved_messages enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.conversation_member_preferences enable row level security;
drop policy if exists "Members can view message reactions" on public.message_reactions;
create policy "Members can view message reactions" on public.message_reactions for select to authenticated using (public.is_mtu_account() and exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = message_reactions.message_id and cm.user_id = auth.uid()));
drop policy if exists "Members manage own message reactions" on public.message_reactions;
create policy "Members manage own message reactions" on public.message_reactions for all to authenticated using (user_id = auth.uid() and public.is_mtu_account()) with check (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = message_reactions.message_id and cm.user_id = auth.uid()));
drop policy if exists "Students manage their own saved messages" on public.saved_messages;
create policy "Students manage their own saved messages" on public.saved_messages for all to authenticated using (user_id = auth.uid() and public.is_mtu_account()) with check (user_id = auth.uid() and public.is_mtu_account());
drop policy if exists "Members can view pinned messages" on public.pinned_messages;
create policy "Members can view pinned messages" on public.pinned_messages for select to authenticated using (public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = pinned_messages.conversation_id and cm.user_id = auth.uid()));
drop policy if exists "Members can pin messages" on public.pinned_messages;
create policy "Members can pin messages" on public.pinned_messages for insert to authenticated with check (pinned_by = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = pinned_messages.conversation_id and cm.user_id = auth.uid()));
drop policy if exists "Pinners can unpin messages" on public.pinned_messages;
create policy "Pinners can unpin messages" on public.pinned_messages for delete to authenticated using (pinned_by = auth.uid() and public.is_mtu_account());
drop policy if exists "Members manage their own conversation preferences" on public.conversation_member_preferences;
create policy "Members manage their own conversation preferences" on public.conversation_member_preferences for all to authenticated using (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_member_preferences.conversation_id and cm.user_id = auth.uid())) with check (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_member_preferences.conversation_id and cm.user_id = auth.uid()));

create or replace function public.toggle_mtu_message_reaction(p_message_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = p_message_id and cm.user_id = auth.uid()) then raise exception 'You cannot react to this message'; end if;
  if exists (select 1 from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji) then delete from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji; return false; end if;
  insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, auth.uid(), p_emoji); return true;
end $$;
create or replace function public.toggle_mtu_saved_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = p_message_id and cm.user_id = auth.uid()) then raise exception 'You cannot save this message'; end if;
  if exists (select 1 from public.saved_messages where user_id = auth.uid() and message_id = p_message_id) then delete from public.saved_messages where user_id = auth.uid() and message_id = p_message_id; return false; end if;
  insert into public.saved_messages (user_id, message_id) values (auth.uid(), p_message_id); return true;
end $$;
create or replace function public.toggle_mtu_pinned_message(p_conversation_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) or not exists (select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id) then raise exception 'You cannot pin this message'; end if;
  if exists (select 1 from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid()) then delete from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid(); return false; end if;
  insert into public.pinned_messages (conversation_id, message_id, pinned_by) values (p_conversation_id, p_message_id, auth.uid()); return true;
end $$;
create or replace function public.set_mtu_conversation_preference(p_conversation_id uuid, p_private_label text default null, p_is_archived boolean default false)
returns public.conversation_member_preferences language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare result public.conversation_member_preferences; begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You cannot update this conversation'; end if;
  insert into public.conversation_member_preferences (conversation_id, user_id, private_label, is_archived, updated_at) values (p_conversation_id, auth.uid(), nullif(trim(p_private_label), ''), p_is_archived, now()) on conflict (conversation_id, user_id) do update set private_label = excluded.private_label, is_archived = excluded.is_archived, updated_at = now() returning * into result; return result;
end $$;

-- 4) Group ownership, selected members, administrators, and @mention membership source.
alter table public.conversation_members add column if not exists group_role text not null default 'member';
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_members_group_role_check') then alter table public.conversation_members add constraint conversation_members_group_role_check check (group_role in ('owner','admin','member')); end if; end $$;
with first_group_member as (
  select distinct on (cm.conversation_id) cm.conversation_id, cm.user_id from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id and c.kind = 'group' order by cm.conversation_id, cm.user_id
)
update public.conversation_members cm set group_role = 'owner' from first_group_member first_member where cm.conversation_id = first_member.conversation_id and cm.user_id = first_member.user_id and not exists (select 1 from public.conversation_members owner_member where owner_member.conversation_id = cm.conversation_id and owner_member.group_role = 'owner');
drop function if exists public.create_mtu_group_conversation(text, uuid[]);
create or replace function public.list_mtu_group_members(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, group_role text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$ select cm.user_id,p.display_name,p.student_id,cm.group_role from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id and c.kind = 'group' join public.profiles p on p.id = cm.user_id where cm.conversation_id = p_conversation_id and public.is_mtu_account() and exists (select 1 from public.conversation_members me where me.conversation_id = p_conversation_id and me.user_id = auth.uid()) order by case cm.group_role when 'owner' then 0 when 'admin' then 1 else 2 end,p.display_name $$;
create or replace function public.add_mtu_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare added integer; actor_role text; can_invite boolean; begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to manage this group'; end if;
  select actor.group_role into actor_role from public.conversation_members actor join public.conversations c on c.id = actor.conversation_id and c.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid();
  if actor_role is null then raise exception 'You are not a member of this group'; end if;
  select coalesce(permissions.allow_member_invites, true) into can_invite from public.group_permissions permissions where permissions.conversation_id = p_conversation_id;
  if actor_role not in ('owner','admin') and not coalesce(can_invite, true) then raise exception 'Only group admins can add members'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = member_id) or (r.requester_id = member_id and r.recipient_id = auth.uid())))) then raise exception 'New members must be accepted MTU connections'; end if;
  insert into public.conversation_members (conversation_id,user_id,group_role) select p_conversation_id,member_id,'member' from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() on conflict (conversation_id,user_id) do nothing; get diagnostics added = row_count; return added;
end $$;
create or replace function public.set_mtu_group_member_role(p_conversation_id uuid,p_member_id uuid,p_group_role text)
returns text language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if p_group_role not in ('admin','member') then raise exception 'Choose admin or member'; end if;
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members actor join public.conversations c on c.id = actor.conversation_id and c.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role = 'owner') then raise exception 'Only the group owner can change admin roles'; end if;
  update public.conversation_members set group_role = p_group_role where conversation_id = p_conversation_id and user_id = p_member_id and group_role <> 'owner'; if not found then raise exception 'That member cannot have their role changed'; end if; return p_group_role;
end $$;
create or replace function public.remove_mtu_group_member(p_conversation_id uuid,p_member_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare actor_role text; target_role text; begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to manage this group'; end if;
  select member.group_role into target_role from public.conversation_members member join public.conversations c on c.id = member.conversation_id and c.kind = 'group' where member.conversation_id = p_conversation_id and member.user_id = p_member_id;
  if target_role is null then raise exception 'That member is not in this group'; end if;
  if target_role = 'owner' then raise exception 'The owner cannot be removed'; end if;
  if p_member_id <> auth.uid() then
    select member.group_role into actor_role from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
    if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Only owners and admins can remove other members'; end if;
    if actor_role <> 'owner' and target_role <> 'member' then raise exception 'Only the owner can remove a group admin'; end if;
  end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_member_id; return found;
end $$;

-- 5) Final live message/send/list contracts. This version retains safety checks AND reply/video support.
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime'] where id = 'message-attachments';
drop function if exists public.send_mtu_message(uuid,text,text,text);
drop function if exists public.send_mtu_message(uuid,text,text,text,uuid);
create or replace function public.list_mtu_message_interactions(p_conversation_id uuid)
returns table (message_id uuid,emoji text,reaction_count bigint,reacted_by_me boolean,saved_by_me boolean,pinned_by_me boolean)
language sql security definer stable set search_path = public
as $$ select m.id,reaction.emoji,coalesce(reaction.reaction_count,0),coalesce(reaction.reacted_by_me,false),exists(select 1 from public.saved_messages s where s.message_id = m.id and s.user_id = auth.uid()),exists(select 1 from public.pinned_messages p where p.message_id = m.id and p.conversation_id = m.conversation_id and p.pinned_by = auth.uid()) from public.messages m left join lateral (select mr.emoji,count(*)::bigint reaction_count,bool_or(mr.user_id = auth.uid()) reacted_by_me from public.message_reactions mr where mr.message_id = m.id group by mr.emoji) reaction on true where m.conversation_id = p_conversation_id and public.is_mtu_account() and exists(select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid()) $$;
-- 6) Lock down execution to signed-in MTU sessions only.
revoke execute on function public.block_mtu_student(uuid),public.report_mtu_student(uuid,text),public.start_mtu_direct_conversation(uuid),public.list_mtu_messages(uuid),public.list_mtu_message_interactions(uuid),public.toggle_mtu_message_reaction(uuid,text),public.toggle_mtu_saved_message(uuid),public.toggle_mtu_pinned_message(uuid,uuid),public.set_mtu_conversation_preference(uuid,text,boolean),public.list_mtu_conversations_v2(),public.list_mtu_group_members(uuid),public.add_mtu_group_members(uuid,uuid[]),public.set_mtu_group_member_role(uuid,uuid,text),public.remove_mtu_group_member(uuid,uuid) from public,anon;
grant execute on function public.block_mtu_student(uuid),public.report_mtu_student(uuid,text),public.start_mtu_direct_conversation(uuid),public.list_mtu_messages(uuid),public.list_mtu_message_interactions(uuid),public.toggle_mtu_message_reaction(uuid,text),public.toggle_mtu_saved_message(uuid),public.toggle_mtu_pinned_message(uuid,uuid),public.set_mtu_conversation_preference(uuid,text,boolean),public.list_mtu_conversations_v2(),public.list_mtu_group_members(uuid),public.add_mtu_group_members(uuid,uuid[]),public.set_mtu_group_member_role(uuid,uuid,text),public.remove_mtu_group_member(uuid,uuid) to authenticated;


-- ===== CONSOLIDATED: messaging-group-invites-and-permissions.sql =====
-- CONVO GROUP INVITES + PERMISSIONS
-- Run this AFTER convo-messaging-live-upgrade.sql in Supabase SQL Editor.
-- Safe to rerun. It adds private group invitations, owner controls, join review,
-- and admins-only posting without exposing message history to non-members.

create table if not exists public.group_permissions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  allow_member_messages boolean not null default true,
  allow_member_invites boolean not null default false,
  require_join_approval boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.conversations
  add column if not exists is_private boolean not null default false;

create or replace function public.set_mtu_group_privacy(p_conversation_id uuid, p_is_private boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if not exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
      and group_role = 'owner'
  ) then
    raise exception 'Only the group owner can change group privacy';
  end if;
  update public.conversations
    set is_private = coalesce(p_is_private, false), updated_at = now()
  where id = p_conversation_id and kind = 'group';
  return found;
end;
$$;

create table if not exists public.group_invites (
  token uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists group_invites_conversation_idx on public.group_invites(conversation_id);

create table if not exists public.group_join_requests (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.group_permissions enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_join_requests enable row level security;

-- RPCs below are the only access path. No raw invite records or pending requests
-- are readable by ordinary members outside the requested operation.
drop policy if exists "No direct group permission access" on public.group_permissions;
create policy "No direct group permission access" on public.group_permissions for select to authenticated using (false);
drop policy if exists "No direct group invite access" on public.group_invites;
create policy "No direct group invite access" on public.group_invites for select to authenticated using (false);
drop policy if exists "Requesters view their join requests" on public.group_join_requests;
create policy "Requesters view their join requests" on public.group_join_requests for select to authenticated using (user_id = auth.uid() and public.is_mtu_account());

-- Ensure every existing group has conservative invite defaults while preserving open posting.
insert into public.group_permissions (conversation_id)
select id from public.conversations where kind = 'group'
on conflict (conversation_id) do nothing;

create or replace function public.get_mtu_group_permissions(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.group_permissions;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_permissions (conversation_id) values (p_conversation_id) on conflict do nothing;
  select * into result from public.group_permissions where conversation_id = p_conversation_id;
  return jsonb_build_object(
    'allow_member_messages', result.allow_member_messages,
    'allow_member_invites', result.allow_member_invites,
    'require_join_approval', result.require_join_approval
  );
end;
$$;

create or replace function public.set_mtu_group_permissions(
  p_conversation_id uuid,
  p_allow_member_messages boolean,
  p_allow_member_invites boolean,
  p_require_join_approval boolean
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.group_permissions;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role = 'owner'
  ) then raise exception 'Only the group owner can change permissions'; end if;
  insert into public.group_permissions (conversation_id, allow_member_messages, allow_member_invites, require_join_approval, updated_by, updated_at)
  values (p_conversation_id, p_allow_member_messages, p_allow_member_invites, p_require_join_approval, auth.uid(), now())
  on conflict (conversation_id) do update set
    allow_member_messages = excluded.allow_member_messages,
    allow_member_invites = excluded.allow_member_invites,
    require_join_approval = excluded.require_join_approval,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into result;
  return jsonb_build_object(
    'allow_member_messages', result.allow_member_messages,
    'allow_member_invites', result.allow_member_invites,
    'require_join_approval', result.require_join_approval
  );
end;
$$;

create or replace function public.create_mtu_group_invite(p_conversation_id uuid)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; can_invite boolean; invite_token uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create an invite'; end if;
  select member.group_role into role_value
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  insert into public.group_permissions (conversation_id) values (p_conversation_id) on conflict do nothing;
  select allow_member_invites into can_invite from public.group_permissions where conversation_id = p_conversation_id;
  if role_value not in ('owner', 'admin') and not can_invite then raise exception 'Only group admins can create invite links'; end if;
  insert into public.group_invites (conversation_id, created_by) values (p_conversation_id, auth.uid()) returning token into invite_token;
  return invite_token::text;
end;
$$;

create or replace function public.join_mtu_group_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare invite_record public.group_invites; permissions public.group_permissions; title_value text;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in with your MTU account to open this invitation'; end if;
  select invite.* into invite_record
  from public.group_invites invite join public.conversations conversation on conversation.id = invite.conversation_id and conversation.kind = 'group'
  where invite.token = p_token::uuid and invite.revoked_at is null and invite.expires_at > now();
  if invite_record.token is null then raise exception 'This group invitation has expired or is unavailable'; end if;
  select title into title_value from public.conversations where id = invite_record.conversation_id;
  if exists (select 1 from public.conversation_members where conversation_id = invite_record.conversation_id and user_id = auth.uid()) then
    return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', true, 'pending', false);
  end if;
  insert into public.group_permissions (conversation_id) values (invite_record.conversation_id) on conflict do nothing;
  select * into permissions from public.group_permissions where conversation_id = invite_record.conversation_id;
  if permissions.require_join_approval then
    insert into public.group_join_requests (conversation_id, user_id, status, reviewed_by, reviewed_at)
    values (invite_record.conversation_id, auth.uid(), 'pending', null, null)
    on conflict (conversation_id, user_id) do update set status = 'pending', reviewed_by = null, reviewed_at = null;
    return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', false, 'pending', true);
  end if;
  insert into public.conversation_members (conversation_id, user_id, group_role)
  values (invite_record.conversation_id, auth.uid(), 'member') on conflict do nothing;
  return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', true, 'pending', false);
end;
$$;

create or replace function public.list_mtu_group_join_requests(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, created_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select request.user_id, profile.display_name, profile.student_id, request.created_at
  from public.group_join_requests request
  join public.conversation_members actor on actor.conversation_id = request.conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner','admin')
  join public.profiles profile on profile.id = request.user_id
  where request.conversation_id = p_conversation_id and request.status = 'pending' and public.is_mtu_account()
  order by request.created_at asc;
$$;

create or replace function public.review_mtu_group_join_request(p_conversation_id uuid, p_user_id uuid, p_approve boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can review join requests'; end if;
  update public.group_join_requests set status = case when p_approve then 'approved' else 'declined' end, reviewed_by = auth.uid(), reviewed_at = now()
  where conversation_id = p_conversation_id and user_id = p_user_id and status = 'pending';
  if not found then raise exception 'No pending join request was found'; end if;
  if p_approve then insert into public.conversation_members (conversation_id, user_id, group_role) values (p_conversation_id, p_user_id, 'member') on conflict do nothing; end if;
  return p_approve;
end;
$$;

revoke execute on function public.get_mtu_group_permissions(uuid), public.set_mtu_group_permissions(uuid,boolean,boolean,boolean), public.create_mtu_group_invite(uuid), public.join_mtu_group_invite(text), public.list_mtu_group_join_requests(uuid), public.review_mtu_group_join_request(uuid,uuid,boolean) from public, anon;
grant execute on function public.get_mtu_group_permissions(uuid), public.set_mtu_group_permissions(uuid,boolean,boolean,boolean), public.create_mtu_group_invite(uuid), public.join_mtu_group_invite(text), public.list_mtu_group_join_requests(uuid), public.review_mtu_group_join_request(uuid,uuid,boolean) to authenticated;


-- ===== CONSOLIDATED: messaging-privacy-settings.sql =====
-- CONVO PRIVACY SETTINGS
-- Run after the base Convo messaging SQL. Safe to rerun.
-- Values are private per-user controls; no legal names or emails are exposed.

create table if not exists public.mtu_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allow_messages text not null default 'connections' check (allow_messages in ('everyone', 'connections', 'nobody')),
  allow_calls text not null default 'connections' check (allow_calls in ('everyone', 'connections', 'nobody')),
  show_read_receipts boolean not null default true,
  show_online_status boolean not null default true,
  allow_group_invites boolean not null default true,
  disappearing_messages_seconds integer not null default 0 check (disappearing_messages_seconds in (0, 86400, 604800, 2592000)),
  updated_at timestamptz not null default now()
);

alter table public.mtu_privacy_settings enable row level security;

create or replace function public.get_mtu_privacy_settings()
returns jsonb
language plpgsql security definer volatile set search_path = pg_catalog, public, auth
as $$
declare settings public.mtu_privacy_settings;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Verified MTU access required'; end if;
  insert into public.mtu_privacy_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into settings from public.mtu_privacy_settings where user_id = auth.uid();
  return jsonb_build_object(
    'allow_messages', settings.allow_messages,
    'allow_calls', settings.allow_calls,
    'show_read_receipts', settings.show_read_receipts,
    'show_online_status', settings.show_online_status,
    'allow_group_invites', settings.allow_group_invites,
    'disappearing_messages_seconds', settings.disappearing_messages_seconds
  );
end;
$$;

create or replace function public.set_mtu_privacy_settings(
  p_allow_messages text,
  p_allow_calls text,
  p_show_read_receipts boolean,
  p_show_online_status boolean,
  p_allow_group_invites boolean,
  p_disappearing_messages_seconds integer default 0
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare settings public.mtu_privacy_settings;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Verified MTU access required'; end if;
  if p_allow_messages not in ('everyone', 'connections', 'nobody') or p_allow_calls not in ('everyone', 'connections', 'nobody') then raise exception 'Invalid privacy audience'; end if;
  if p_disappearing_messages_seconds not in (0, 86400, 604800, 2592000) then raise exception 'Invalid disappearing-message duration'; end if;
  insert into public.mtu_privacy_settings (user_id, allow_messages, allow_calls, show_read_receipts, show_online_status, allow_group_invites, disappearing_messages_seconds, updated_at)
  values (auth.uid(), p_allow_messages, p_allow_calls, p_show_read_receipts, p_show_online_status, p_allow_group_invites, p_disappearing_messages_seconds, now())
  on conflict (user_id) do update set
    allow_messages = excluded.allow_messages,
    allow_calls = excluded.allow_calls,
    show_read_receipts = excluded.show_read_receipts,
    show_online_status = excluded.show_online_status,
    allow_group_invites = excluded.allow_group_invites,
    disappearing_messages_seconds = excluded.disappearing_messages_seconds,
    updated_at = now();
  select * into settings from public.mtu_privacy_settings where user_id = auth.uid();
  return jsonb_build_object(
    'allow_messages', settings.allow_messages,
    'allow_calls', settings.allow_calls,
    'show_read_receipts', settings.show_read_receipts,
    'show_online_status', settings.show_online_status,
    'allow_group_invites', settings.allow_group_invites,
    'disappearing_messages_seconds', settings.disappearing_messages_seconds
  );
end;
$$;

revoke all on public.mtu_privacy_settings from anon, authenticated;
revoke execute on function public.get_mtu_privacy_settings(), public.set_mtu_privacy_settings(text,text,boolean,boolean,boolean,integer) from public, anon;
grant execute on function public.get_mtu_privacy_settings(), public.set_mtu_privacy_settings(text,text,boolean,boolean,boolean,integer) to authenticated;


-- ===== CONSOLIDATED: messaging-rail-state.sql =====
-- CONVO CONVERSATION RAIL STATE
-- Run after convo-messaging-live-upgrade.sql and messaging-block-persistence-fix.sql.
-- Safe to rerun. Keeps rail state private to the authenticated member.

alter table public.conversation_member_preferences
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_marked_unread boolean not null default false,
  add column if not exists draft_body text;

create or replace function public.set_mtu_conversation_rail_state(
  p_conversation_id uuid,
  p_pinned boolean default null,
  p_archived boolean default null,
  p_draft_body text default null,
  p_mark_unread boolean default null
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare state_record public.conversation_member_preferences;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if p_draft_body is not null and char_length(p_draft_body) > 4000 then
    raise exception 'Drafts must be 4,000 characters or fewer';
  end if;
  insert into public.conversation_member_preferences (conversation_id, user_id, is_pinned, is_archived, draft_body, is_marked_unread)
  values (p_conversation_id, auth.uid(), coalesce(p_pinned, false), coalesce(p_archived, false), p_draft_body, coalesce(p_mark_unread, false))
  on conflict (conversation_id, user_id) do update set
    is_pinned = case when p_pinned is null then public.conversation_member_preferences.is_pinned else p_pinned end,
    is_archived = case when p_archived is null then public.conversation_member_preferences.is_archived else p_archived end,
    draft_body = case when p_draft_body is null then public.conversation_member_preferences.draft_body else p_draft_body end,
    is_marked_unread = case when p_mark_unread is null then public.conversation_member_preferences.is_marked_unread else p_mark_unread end;
  select * into state_record from public.conversation_member_preferences
  where conversation_id = p_conversation_id and user_id = auth.uid();
  return jsonb_build_object('is_pinned', state_record.is_pinned, 'is_archived', state_record.is_archived, 'draft_body', state_record.draft_body, 'is_marked_unread', state_record.is_marked_unread);
end;
$$;

revoke execute on function public.list_mtu_conversations_v2(), public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) from public, anon;
grant execute on function public.list_mtu_conversations_v2(), public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) to authenticated;


-- ===== CONSOLIDATED: messaging-conversation-appearance.sql =====
-- CONVO per-conversation appearance preferences
-- Run after messaging-rail-state.sql. Safe to rerun.

alter table public.conversation_member_preferences
  add column if not exists chat_theme text not null default 'convo',
  add column if not exists wallpaper_variant text not null default 'plain';

alter table public.conversation_member_preferences
  drop constraint if exists conversation_member_preferences_chat_theme_check;
alter table public.conversation_member_preferences
  add constraint conversation_member_preferences_chat_theme_check
  check (chat_theme in ('convo', 'cream', 'peach', 'sage', 'lavender', 'midnight'));

alter table public.conversation_member_preferences
  drop constraint if exists conversation_member_preferences_wallpaper_variant_check;
alter table public.conversation_member_preferences
  add constraint conversation_member_preferences_wallpaper_variant_check
  check (wallpaper_variant in ('plain', 'organic', 'campus', 'gradient'));

create or replace function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table (chat_theme text, wallpaper_variant text)
language sql
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(preference.chat_theme, 'convo'), coalesce(preference.wallpaper_variant, 'plain')
  from (select 1) anchor
  left join public.conversation_member_preferences preference
    on preference.conversation_id = p_conversation_id
   and preference.user_id = auth.uid()
  where auth.uid() is not null
    and public.is_mtu_account()
    and exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid())
$$;

create or replace function public.set_mtu_conversation_appearance(
  p_conversation_id uuid,
  p_chat_theme text,
  p_wallpaper_variant text
)
returns table (chat_theme text, wallpaper_variant text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result_record record;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid()) then
    raise exception 'You cannot change this conversation appearance';
  end if;
  if p_chat_theme not in ('convo', 'cream', 'peach', 'sage', 'lavender', 'midnight') then raise exception 'Unsupported conversation theme'; end if;
  if p_wallpaper_variant not in ('plain', 'organic', 'campus', 'gradient') then raise exception 'Unsupported wallpaper'; end if;
  insert into public.conversation_member_preferences(conversation_id, user_id, chat_theme, wallpaper_variant, updated_at)
  values (p_conversation_id, auth.uid(), p_chat_theme, p_wallpaper_variant, now())
  on conflict (conversation_id, user_id) do update set chat_theme = excluded.chat_theme, wallpaper_variant = excluded.wallpaper_variant, updated_at = now()
  returning conversation_member_preferences.chat_theme, conversation_member_preferences.wallpaper_variant into result_record;
  return query select result_record.chat_theme, result_record.wallpaper_variant;
end;
$$;

revoke execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid,text,text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid,text,text) to authenticated;


-- ===== CONSOLIDATED: messaging-retained-chat-blocking.sql =====
-- Run after the current Convo messaging, safety, and attachment migrations.
-- This replaces the prior direct-message block behavior. It preserves both
-- inbox rows and history, but suppresses any future direct-message delivery
-- across a block. Blocked-period messages never back-deliver after unblocking.

alter table public.messages
  add column if not exists delivery_state text not null default 'delivered';

alter table public.messages
  drop constraint if exists messages_delivery_state_check;

alter table public.messages
  add constraint messages_delivery_state_check
  check (delivery_state in ('delivered', 'blocked'));

-- The source of a blocked-period direct message may read it. The other direct
-- participant cannot read it through REST or Realtime, even though the direct
-- conversation itself remains visible to both participants.
drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
on public.messages for select to authenticated
using (
  public.is_mtu_account()
  and exists (
    select 1 from public.conversation_members member
    where member.conversation_id = messages.conversation_id
      and member.user_id = auth.uid()
  )
  and (messages.delivery_state <> 'blocked' or messages.sender_id = auth.uid())
);

-- Client writes must not bypass send_mtu_message(), which is the single place
-- that decides whether a direct message is deliverable or sender-only pending.
drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
on public.messages for insert to authenticated
with check (
  public.is_mtu_account()
  and sender_id = auth.uid()
  and exists (
    select 1 from public.conversation_members member
    where member.conversation_id = messages.conversation_id
      and member.user_id = auth.uid()
  )
  and not exists (
    select 1
    from public.conversations conversation
    join public.conversation_members other_member
      on other_member.conversation_id = conversation.id
      and other_member.user_id <> auth.uid()
    join public.student_blocks block
      on (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id)
      or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
    where conversation.id = messages.conversation_id
      and conversation.kind = 'direct'
  )
);

create or replace function public.list_mtu_blocked_students()
returns table(
  blocked_id uuid,
  display_name text,
  nickname text,
  student_id text,
  avatar_url text,
  blocked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU students can view blocked students';
  end if;

  return query
  select block.blocked_id, profile.display_name, profile.display_name, profile.student_id,
    profile.avatar_url, block.created_at
  from public.student_blocks block
  join public.profiles profile on profile.id = block.blocked_id
  where block.blocker_id = auth.uid()
  order by block.created_at desc;
end;
$$;

drop function if exists public.block_mtu_student(uuid);
create function public.block_mtu_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can block another student';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Student profile not found';
  end if;

  insert into public.student_blocks (blocker_id, blocked_id)
  values (auth.uid(), p_student_id)
  on conflict do nothing;

  -- Deliberately do not alter conversation membership, delete history,
  -- archive a chat, or alter the connection request here.
  return true;
end;
$$;

drop function if exists public.unblock_mtu_student(uuid);
create function public.unblock_mtu_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can unblock a student';
  end if;

  delete from public.student_blocks
  where blocker_id = auth.uid()
    and blocked_id = p_student_id;

  -- No connection is created or restored here. Direct-conversation membership
  -- is preserved; messages sent after this moment can be delivered normally.
  return true;
end;
$$;

drop function if exists public.list_mtu_message_interactions(uuid);
create function public.list_mtu_message_interactions(p_conversation_id uuid)
returns table(message_id uuid,emoji text,reaction_count bigint,reacted_by_me boolean,saved_by_me boolean,pinned_by_me boolean)
language sql security definer stable set search_path = pg_catalog, public, auth as $$
  select message.id,reaction.emoji,coalesce(reaction.reaction_count,0),coalesce(reaction.reacted_by_me,false),
    exists(select 1 from public.saved_messages saved where saved.message_id=message.id and saved.user_id=auth.uid()),
    exists(select 1 from public.pinned_messages pinned where pinned.message_id=message.id and pinned.conversation_id=message.conversation_id and pinned.pinned_by=auth.uid())
  from public.messages message
  left join lateral (
    select reaction_row.emoji,count(*)::bigint reaction_count,bool_or(reaction_row.user_id=auth.uid()) reacted_by_me
    from public.message_reactions reaction_row where reaction_row.message_id=message.id group by reaction_row.emoji
  ) reaction on true
  where message.conversation_id=p_conversation_id and public.is_mtu_account()
    and exists(select 1 from public.conversation_members member where member.conversation_id=p_conversation_id and member.user_id=auth.uid())
    and (message.delivery_state <> 'blocked' or message.sender_id = auth.uid());
$$;

revoke execute on function public.list_mtu_blocked_students(), public.block_mtu_student(uuid), public.unblock_mtu_student(uuid), public.list_mtu_message_interactions(uuid) from public, anon;
grant execute on function public.list_mtu_blocked_students(), public.block_mtu_student(uuid), public.unblock_mtu_student(uuid), public.list_mtu_message_interactions(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ===== CONSOLIDATED: convo-live-repair.sql =====
-- CONVO LIVE REPAIR â€” AUGUST 2026
-- Paste this entire file into Supabase SQL Editor and click Run.
-- Prerequisite: convo-complete-supabase-setup.sql has already been run.
-- This is rerun-safe and repairs the live RPC/storage contracts used by the
-- current Convo interface. It exposes no legal names or email addresses.

-- 1) Complete attachment contract: image, video, voice, documents and ZIP.
alter table public.messages add column if not exists attachment_mime text;
alter table public.messages drop constraint if exists messages_attachment_mime_check;
alter table public.messages add constraint messages_attachment_mime_check check (
  attachment_mime is null or attachment_mime in (
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments','message-attachments',true,26214400,array[
  'image/png','image/jpeg','image/webp','image/gif',
  'video/mp4','video/webm','video/quicktime',
  'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg',
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]) on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Convo members upload their own attachments" on storage.objects;
create policy "Convo members upload their own attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Convo members update their own attachments" on storage.objects;
create policy "Convo members update their own attachments" on storage.objects for update to authenticated
using (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Convo members delete their own attachments" on storage.objects;
create policy "Convo members delete their own attachments" on storage.objects for delete to authenticated
using (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2) Personal rail state, archive, pin, drafts and unread markers.
alter table public.conversation_member_preferences
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_marked_unread boolean not null default false,
  add column if not exists draft_body text,
  add column if not exists chat_theme text not null default 'convo',
  add column if not exists wallpaper_variant text not null default 'plain';

drop function if exists public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean);
create function public.set_mtu_conversation_rail_state(
  p_conversation_id uuid, p_pinned boolean default null, p_archived boolean default null,
  p_draft_body text default null, p_mark_unread boolean default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare state_record public.conversation_member_preferences;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if p_draft_body is not null and char_length(p_draft_body) > 4000 then raise exception 'Drafts must be 4,000 characters or fewer'; end if;
  insert into public.conversation_member_preferences(conversation_id,user_id,is_pinned,is_archived,draft_body,is_marked_unread)
  values(p_conversation_id,auth.uid(),coalesce(p_pinned,false),coalesce(p_archived,false),p_draft_body,coalesce(p_mark_unread,false))
  on conflict(conversation_id,user_id) do update set
    is_pinned = case when p_pinned is null then public.conversation_member_preferences.is_pinned else p_pinned end,
    is_archived = case when p_archived is null then public.conversation_member_preferences.is_archived else p_archived end,
    draft_body = case when p_draft_body is null then public.conversation_member_preferences.draft_body else p_draft_body end,
    is_marked_unread = case when p_mark_unread is null then public.conversation_member_preferences.is_marked_unread else p_mark_unread end,
    updated_at = now();
  select * into state_record from public.conversation_member_preferences where conversation_id = p_conversation_id and user_id = auth.uid();
  return jsonb_build_object('is_pinned',state_record.is_pinned,'is_archived',state_record.is_archived,'draft_body',state_record.draft_body,'is_marked_unread',state_record.is_marked_unread);
end;
$$;
revoke execute on function public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) from public, anon;
grant execute on function public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) to authenticated;

-- Return persisted group artwork during inbox hydration.
revoke execute on function public.list_mtu_conversations_v2() from public,anon;
grant execute on function public.list_mtu_conversations_v2() to authenticated;

create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id,message_id,pinned_by)
);
alter table public.pinned_messages enable row level security;
drop policy if exists "No direct Convo pinned message access" on public.pinned_messages;
create policy "No direct Convo pinned message access" on public.pinned_messages for all to authenticated using(false) with check(false);
create or replace function public.toggle_mtu_pinned_message(p_conversation_id uuid,p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) or not exists (select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id) then raise exception 'You cannot pin this message'; end if;
  if exists(select 1 from public.pinned_messages where conversation_id=p_conversation_id and message_id=p_message_id and pinned_by=auth.uid()) then
    delete from public.pinned_messages where conversation_id=p_conversation_id and message_id=p_message_id and pinned_by=auth.uid(); return false;
  end if;
  insert into public.pinned_messages(conversation_id,message_id,pinned_by) values(p_conversation_id,p_message_id,auth.uid()); return true;
end;
$$;
revoke execute on function public.toggle_mtu_pinned_message(uuid,uuid) from public, anon;
grant execute on function public.toggle_mtu_pinned_message(uuid,uuid) to authenticated;

-- 3) Per-member chat appearance.
alter table public.conversation_member_preferences drop constraint if exists conversation_member_preferences_chat_theme_check;
alter table public.conversation_member_preferences add constraint conversation_member_preferences_chat_theme_check check(chat_theme in ('convo','cream','peach','sage','lavender','midnight'));
alter table public.conversation_member_preferences drop constraint if exists conversation_member_preferences_wallpaper_variant_check;
alter table public.conversation_member_preferences add constraint conversation_member_preferences_wallpaper_variant_check check(wallpaper_variant in ('plain','organic','campus','gradient'));
create or replace function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table(chat_theme text,wallpaper_variant text) language sql security definer stable set search_path = pg_catalog, public, auth as $$
  select coalesce(pref.chat_theme,'convo'),coalesce(pref.wallpaper_variant,'plain') from (select 1) anchor
  left join public.conversation_member_preferences pref on pref.conversation_id=p_conversation_id and pref.user_id=auth.uid()
  where auth.uid() is not null and public.is_mtu_account() and exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid())
$$;
create or replace function public.set_mtu_conversation_appearance(p_conversation_id uuid,p_chat_theme text,p_wallpaper_variant text)
returns table(chat_theme text,wallpaper_variant text) language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'You cannot change this conversation appearance'; end if;
  if p_chat_theme not in ('convo','cream','peach','sage','lavender','midnight') or p_wallpaper_variant not in ('plain','organic','campus','gradient') then raise exception 'Unsupported appearance option'; end if;
  insert into public.conversation_member_preferences(conversation_id,user_id,chat_theme,wallpaper_variant,updated_at) values(p_conversation_id,auth.uid(),p_chat_theme,p_wallpaper_variant,now())
  on conflict(conversation_id,user_id) do update set chat_theme=excluded.chat_theme,wallpaper_variant=excluded.wallpaper_variant,updated_at=now();
  return query select p_chat_theme,p_wallpaper_variant;
end;
$$;
revoke execute on function public.get_mtu_conversation_appearance(uuid),public.set_mtu_conversation_appearance(uuid,text,text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid),public.set_mtu_conversation_appearance(uuid,text,text) to authenticated;

-- 4) Group notes and announcements.
create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,updated_by uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 1 and 160),body text not null default '' check(char_length(body)<=12000),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,title text not null check(char_length(trim(title)) between 1 and 160),
  body text not null check(char_length(trim(body)) between 1 and 4000),publish_at timestamptz not null default now(),expires_at timestamptz,created_at timestamptz not null default now(),check(expires_at is null or expires_at > publish_at)
);
alter table public.group_notes enable row level security;
alter table public.group_announcements enable row level security;
drop policy if exists "No direct Convo note access" on public.group_notes;
create policy "No direct Convo note access" on public.group_notes for all to authenticated using(false) with check(false);
drop policy if exists "No direct Convo announcement access" on public.group_announcements;
create policy "No direct Convo announcement access" on public.group_announcements for all to authenticated using(false) with check(false);
create or replace function public.create_mtu_group_note(p_conversation_id uuid,p_title text,p_body text default '') returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare result_id uuid; begin
 if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member join public.conversations conversation on conversation.id=member.conversation_id and conversation.kind='group' where member.conversation_id=p_conversation_id and member.user_id=auth.uid()) then raise exception 'You are not a member of this group'; end if;
 insert into public.group_notes(conversation_id,created_by,updated_by,title,body) values(p_conversation_id,auth.uid(),auth.uid(),trim(p_title),coalesce(p_body,'')) returning id into result_id; return result_id;
end; $$;
create or replace function public.list_mtu_group_notes(p_conversation_id uuid) returns table(id uuid,title text,body text,created_by uuid,updated_by uuid,created_at timestamptz,updated_at timestamptz) language sql security definer stable set search_path=pg_catalog,public,auth as $$
 select note.id,note.title,note.body,note.created_by,note.updated_by,note.created_at,note.updated_at from public.group_notes note where public.is_mtu_account() and note.conversation_id=p_conversation_id and exists(select 1 from public.conversation_members member where member.conversation_id=note.conversation_id and member.user_id=auth.uid()) order by note.updated_at desc
$$;
create or replace function public.create_mtu_group_announcement(p_conversation_id uuid,p_title text,p_body text,p_expires_at timestamptz default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare result_id uuid; begin
 if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member where member.conversation_id=p_conversation_id and member.user_id=auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can publish announcements'; end if;
 if p_expires_at is not null and p_expires_at <= now() then raise exception 'Announcement expiry must be in the future'; end if;
 insert into public.group_announcements(conversation_id,created_by,title,body,expires_at) values(p_conversation_id,auth.uid(),trim(p_title),trim(p_body),p_expires_at) returning id into result_id; return result_id;
end; $$;
create or replace function public.list_mtu_group_announcements(p_conversation_id uuid) returns table(id uuid,title text,body text,created_by uuid,publish_at timestamptz,expires_at timestamptz) language sql security definer stable set search_path=pg_catalog,public,auth as $$
 select announcement.id,announcement.title,announcement.body,announcement.created_by,announcement.publish_at,announcement.expires_at from public.group_announcements announcement where public.is_mtu_account() and announcement.conversation_id=p_conversation_id and announcement.publish_at<=now() and (announcement.expires_at is null or announcement.expires_at>now()) and exists(select 1 from public.conversation_members member where member.conversation_id=announcement.conversation_id and member.user_id=auth.uid()) order by announcement.publish_at desc
$$;
revoke execute on function public.create_mtu_group_note(uuid,text,text),public.list_mtu_group_notes(uuid),public.create_mtu_group_announcement(uuid,text,text,timestamptz),public.list_mtu_group_announcements(uuid) from public, anon;
grant execute on function public.create_mtu_group_note(uuid,text,text),public.list_mtu_group_notes(uuid),public.create_mtu_group_announcement(uuid,text,text,timestamptz),public.list_mtu_group_announcements(uuid) to authenticated;

-- 5) Persisted group images; only a group owner or admin can replace one.
alter table public.conversations add column if not exists group_image_url text;
alter table public.conversations add column if not exists group_image_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('group-images','group-images',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Convo group admins upload images" on storage.objects;
create policy "Convo group admins upload images" on storage.objects for insert to authenticated with check (
  bucket_id='group-images' and (storage.foldername(name))[1]=auth.uid()::text and exists(
    select 1 from public.conversation_members member where member.conversation_id=((storage.foldername(name))[2])::uuid and member.user_id=auth.uid() and member.group_role in ('owner','admin')
  )
);
drop policy if exists "Convo group admins delete images" on storage.objects;
create policy "Convo group admins delete images" on storage.objects for delete to authenticated using (
  bucket_id='group-images' and (storage.foldername(name))[1]=auth.uid()::text
);
create or replace function public.set_mtu_group_image(p_conversation_id uuid,p_image_url text,p_image_path text) returns text language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member join public.conversations conversation on conversation.id=member.conversation_id and conversation.kind='group' where member.conversation_id=p_conversation_id and member.user_id=auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can update the group image'; end if;
  if p_image_path not like auth.uid()::text || '/' || p_conversation_id::text || '/%' then raise exception 'Invalid group image path'; end if;
  update public.conversations set group_image_url=p_image_url,group_image_path=p_image_path,updated_at=now() where id=p_conversation_id;
  return p_image_url;
end; $$;
revoke execute on function public.set_mtu_group_image(uuid,text,text) from public, anon;
grant execute on function public.set_mtu_group_image(uuid,text,text) to authenticated;

-- Refresh PostgREST's schema cache after the new RPCs are created.
notify pgrst, 'reload schema';


-- ===== CONSOLIDATED: mtu_required_sql_bundle.sql =====
-- MTU Campus Universe: required group/event/community database repair
-- Run in Supabase SQL Editor after the project base messaging migrations are installed.
-- Order: community utilities -> collaboration/events -> full-scope repair.
-- Safe to rerun where the source migrations are marked rerun-safe.

-- ===== messaging-community-utilities.sql =====
-- CONVO COMMUNITY MESSAGING UTILITIES
-- Run AFTER convo-messaging-live-upgrade.sql and messaging-group-invites-and-permissions.sql.
-- Safe to rerun. All raw tables are closed behind SECURITY DEFINER RPCs.
-- This migration adds: group polls, group tasks, saved-message retrieval, per-chat mute,
-- private invite rotation/revocation, and scoped in-thread message search.

alter table public.conversation_member_preferences
  add column if not exists muted_until timestamptz;

create table if not exists public.group_polls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 240),
  closes_at timestamptz,
  anonymous_voters boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.group_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.group_polls(id) on delete cascade,
  position smallint not null check (position between 1 and 8),
  label text not null check (char_length(trim(label)) between 1 and 100),
  unique (poll_id, position)
);

create table if not exists public.group_poll_votes (
  poll_id uuid not null references public.group_polls(id) on delete cascade,
  option_id uuid not null references public.group_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_polls_conversation_idx on public.group_polls(conversation_id, created_at desc);
create index if not exists group_poll_options_poll_idx on public.group_poll_options(poll_id, position);
create index if not exists group_poll_votes_poll_idx on public.group_poll_votes(poll_id, option_id);
create index if not exists group_tasks_conversation_idx on public.group_tasks(conversation_id, completed_at, due_at);
create index if not exists saved_messages_user_idx on public.saved_messages(user_id, created_at desc);
create index if not exists messages_conversation_body_idx on public.messages(conversation_id, created_at desc);

alter table public.group_polls enable row level security;
alter table public.group_poll_options enable row level security;
alter table public.group_poll_votes enable row level security;
alter table public.group_tasks enable row level security;

drop policy if exists "No direct Convo poll access" on public.group_polls;
create policy "No direct Convo poll access" on public.group_polls for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo poll option access" on public.group_poll_options;
create policy "No direct Convo poll option access" on public.group_poll_options for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo poll vote access" on public.group_poll_votes;
create policy "No direct Convo poll vote access" on public.group_poll_votes for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo task access" on public.group_tasks;
create policy "No direct Convo task access" on public.group_tasks for all to authenticated using (false) with check (false);

create or replace function public.get_mtu_conversation_notification_preference(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare muted_value timestamptz;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  select muted_until into muted_value from public.conversation_member_preferences
  where conversation_id = p_conversation_id and user_id = auth.uid();
  return jsonb_build_object(
    'muted_until', case when muted_value = 'infinity'::timestamptz then null else muted_value end,
    'is_muted', muted_value is not null and muted_value > now()
  );
end;
$$;

create or replace function public.set_mtu_conversation_notification_preference(
  p_conversation_id uuid,
  p_muted boolean,
  p_muted_until timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare muted_value timestamptz;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if p_muted and p_muted_until is not null and p_muted_until <= now() then
    raise exception 'Choose a future mute time';
  end if;
  muted_value := case when p_muted then coalesce(p_muted_until, 'infinity'::timestamptz) else null end;
  insert into public.conversation_member_preferences (conversation_id, user_id, muted_until)
  values (p_conversation_id, auth.uid(), muted_value)
  on conflict (conversation_id, user_id) do update set muted_until = excluded.muted_until;
  return jsonb_build_object('muted_until', case when muted_value = 'infinity'::timestamptz then null else muted_value end, 'is_muted', p_muted);
end;
$$;

create or replace function public.list_mtu_saved_messages(p_limit integer default 100)
returns table (
  message_id uuid, conversation_id uuid, conversation_title text, sender_id uuid,
  sender_display_name text, body text, created_at timestamptz,
  attachment_url text, attachment_mime text
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select m.id, m.conversation_id,
    coalesce(pref.private_label, case when c.kind = 'direct' then coalesce(other_profile.display_name, 'MTU connection') else c.title end),
    m.sender_id, coalesce(sender_profile.display_name, 'MTU connection'), m.body, m.created_at,
    m.attachment_url, m.attachment_mime
  from public.saved_messages saved
  join public.messages m on m.id = saved.message_id and m.deleted_at is null
  join public.conversations c on c.id = m.conversation_id
  join public.conversation_members member on member.conversation_id = c.id and member.user_id = auth.uid()
  left join public.conversation_member_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid()
  left join lateral (
    select profile.display_name from public.conversation_members counterpart
    join public.profiles profile on profile.id = counterpart.user_id
    where counterpart.conversation_id = c.id and counterpart.user_id <> auth.uid() limit 1
  ) other_profile on c.kind = 'direct'
  left join public.profiles sender_profile on sender_profile.id = m.sender_id
  where saved.user_id = auth.uid() and public.is_mtu_account()
    and not exists (
      select 1 from public.conversations direct_conversation
      join public.conversation_members counterpart on counterpart.conversation_id = direct_conversation.id and counterpart.user_id <> auth.uid()
      join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = counterpart.user_id) or (block.blocker_id = counterpart.user_id and block.blocked_id = auth.uid())
      where direct_conversation.id = c.id and direct_conversation.kind = 'direct'
    )
  order by saved.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

create or replace function public.search_mtu_conversation_messages(p_conversation_id uuid, p_query text)
returns table (
  id uuid, sender_id uuid, sender_display_name text, body text, created_at timestamptz,
  attachment_url text, attachment_mime text, reply_to_id uuid
)
language plpgsql security definer stable set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or char_length(trim(coalesce(p_query, ''))) < 2 then
    raise exception 'Enter at least two characters to search this conversation';
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'You are not a member of this conversation';
  end if;
  if exists (
    select 1 from public.conversations c
    join public.conversation_members counterpart on counterpart.conversation_id = c.id and counterpart.user_id <> auth.uid()
    join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = counterpart.user_id) or (block.blocker_id = counterpart.user_id and block.blocked_id = auth.uid())
    where c.id = p_conversation_id and c.kind = 'direct'
  ) then raise exception 'This conversation is unavailable'; end if;
  return query
    select m.id, m.sender_id, coalesce(profile.display_name, 'MTU connection'), m.body, m.created_at,
      m.attachment_url, m.attachment_mime, m.reply_to_id
    from public.messages m
    left join public.profiles profile on profile.id = m.sender_id
    where m.conversation_id = p_conversation_id and m.deleted_at is null
      and m.body ilike '%' || trim(p_query) || '%'
    order by m.created_at desc
    limit 60;
end;
$$;

create or replace function public.create_mtu_group_poll(
  p_conversation_id uuid,
  p_question text,
  p_options text[],
  p_closes_at timestamptz default null,
  p_anonymous_voters boolean default false
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; member_messages boolean; message_record public.messages; poll_record public.group_polls; option_text text; option_position integer := 0;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create a poll'; end if;
  select member.group_role into role_value from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  select coalesce(permissions.allow_member_messages, true) into member_messages from public.group_permissions permissions where permissions.conversation_id = p_conversation_id;
  if role_value not in ('owner','admin') and coalesce(member_messages, true) = false then raise exception 'Only group admins can create polls in this group'; end if;
  if char_length(trim(coalesce(p_question, ''))) not between 1 and 240 then raise exception 'A poll question must be between 1 and 240 characters'; end if;
  if coalesce(array_length(p_options, 1), 0) < 2 or coalesce(array_length(p_options, 1), 0) > 8 then raise exception 'A poll needs between 2 and 8 options'; end if;
  if exists (select 1 from unnest(p_options) option_value where char_length(trim(coalesce(option_value, ''))) not between 1 and 100) then raise exception 'Each poll option must be between 1 and 100 characters'; end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'Choose a future poll deadline'; end if;
  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, auth.uid(), 'Poll: ' || trim(p_question)) returning * into message_record;
  insert into public.group_polls (conversation_id, message_id, created_by, question, closes_at, anonymous_voters)
  values (p_conversation_id, message_record.id, auth.uid(), trim(p_question), p_closes_at, coalesce(p_anonymous_voters, false)) returning * into poll_record;
  foreach option_text in array p_options loop
    option_position := option_position + 1;
    insert into public.group_poll_options (poll_id, position, label) values (poll_record.id, option_position, trim(option_text));
  end loop;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return jsonb_build_object('poll_id', poll_record.id, 'message_id', message_record.id);
end;
$$;

create or replace function public.list_mtu_group_polls(p_conversation_id uuid)
returns table (
  poll_id uuid, message_id uuid, question text, closes_at timestamptz, is_closed boolean,
  anonymous_voters boolean, created_by uuid, option_id uuid, option_label text,
  option_position smallint, vote_count bigint, selected_by_me boolean
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select poll.id, poll.message_id, poll.question, poll.closes_at,
    poll.closes_at is not null and poll.closes_at <= now(), poll.anonymous_voters, poll.created_by,
    option_row.id, option_row.label, option_row.position,
    count(vote.user_id)::bigint, coalesce(bool_or(vote.user_id = auth.uid()), false)
  from public.group_polls poll
  join public.conversations conversation on conversation.id = poll.conversation_id and conversation.kind = 'group'
  join public.conversation_members member on member.conversation_id = poll.conversation_id and member.user_id = auth.uid()
  join public.group_poll_options option_row on option_row.poll_id = poll.id
  left join public.group_poll_votes vote on vote.poll_id = poll.id and vote.option_id = option_row.id
  where poll.conversation_id = p_conversation_id and public.is_mtu_account()
  group by poll.id, poll.message_id, poll.question, poll.closes_at, poll.anonymous_voters, poll.created_by, option_row.id, option_row.label, option_row.position
  order by poll.created_at desc, option_row.position asc;
$$;

create or replace function public.cast_mtu_group_poll_vote(p_poll_id uuid, p_option_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare poll_record public.group_polls;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to vote'; end if;
  select * into poll_record from public.group_polls where id = p_poll_id;
  if poll_record.id is null then raise exception 'This poll is unavailable'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = poll_record.conversation_id and user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  if poll_record.closes_at is not null and poll_record.closes_at <= now() then raise exception 'Voting has closed'; end if;
  if not exists (select 1 from public.group_poll_options where id = p_option_id and poll_id = p_poll_id) then raise exception 'That option does not belong to this poll'; end if;
  delete from public.group_poll_votes where poll_id = p_poll_id and user_id = auth.uid();
  insert into public.group_poll_votes (poll_id, option_id, user_id) values (p_poll_id, p_option_id, auth.uid());
  return jsonb_build_object('poll_id', p_poll_id, 'option_id', p_option_id);
end;
$$;

create or replace function public.create_mtu_group_task(
  p_conversation_id uuid,
  p_title text,
  p_assignee_id uuid default null,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; task_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create a task'; end if;
  select member.group_role into role_value from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  if role_value not in ('owner','admin') and exists (
    select 1 from public.group_permissions permissions
    where permissions.conversation_id = p_conversation_id
      and permissions.allow_member_messages = false
  ) then raise exception 'Only group admins can create tasks in this group'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'A task must be between 1 and 240 characters'; end if;
  if p_due_at is not null and p_due_at <= now() then raise exception 'Choose a future task deadline'; end if;
  if p_assignee_id is not null and not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = p_assignee_id) then raise exception 'Assign tasks only to current group members'; end if;
  insert into public.group_tasks (conversation_id, created_by, assignee_id, title, due_at)
  values (p_conversation_id, auth.uid(), p_assignee_id, trim(p_title), p_due_at) returning id into task_id;
  return task_id;
end;
$$;

create or replace function public.list_mtu_group_tasks(p_conversation_id uuid)
returns table (
  task_id uuid, title text, due_at timestamptz, completed_at timestamptz,
  created_by uuid, assignee_id uuid, assignee_display_name text, completed_by uuid, created_at timestamptz
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select task.id, task.title, task.due_at, task.completed_at, task.created_by, task.assignee_id,
    assignee.display_name, task.completed_by, task.created_at
  from public.group_tasks task
  join public.conversations conversation on conversation.id = task.conversation_id and conversation.kind = 'group'
  join public.conversation_members member on member.conversation_id = task.conversation_id and member.user_id = auth.uid()
  left join public.profiles assignee on assignee.id = task.assignee_id
  where task.conversation_id = p_conversation_id and public.is_mtu_account()
  order by task.completed_at nulls first, task.due_at nulls last, task.created_at desc;
$$;

create or replace function public.set_mtu_group_task_completed(p_task_id uuid, p_completed boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare task_record public.group_tasks; role_value text;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to update a task'; end if;
  select * into task_record from public.group_tasks where id = p_task_id;
  if task_record.id is null then raise exception 'This task is unavailable'; end if;
  select group_role into role_value from public.conversation_members where conversation_id = task_record.conversation_id and user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  if role_value not in ('owner','admin') and task_record.created_by <> auth.uid() and coalesce(task_record.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() then
    raise exception 'Only the assignee, creator, or a group admin can complete this task';
  end if;
  update public.group_tasks
  set completed_at = case when p_completed then now() else null end,
      completed_by = case when p_completed then auth.uid() else null end,
      updated_at = now()
  where id = p_task_id;
  return p_completed;
end;
$$;

create or replace function public.revoke_mtu_group_invite(p_conversation_id uuid, p_token text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can revoke invitation links'; end if;
  update public.group_invites set revoked_at = now()
  where conversation_id = p_conversation_id and token = p_token::uuid and revoked_at is null;
  return found;
end;
$$;

create or replace function public.rotate_mtu_group_invite(p_conversation_id uuid)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare token_value uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can rotate invitation links'; end if;
  update public.group_invites set revoked_at = now() where conversation_id = p_conversation_id and revoked_at is null;
  insert into public.group_invites (conversation_id, created_by) values (p_conversation_id, auth.uid()) returning token into token_value;
  return token_value::text;
end;
$$;

revoke execute on function public.get_mtu_conversation_notification_preference(uuid), public.set_mtu_conversation_notification_preference(uuid,boolean,timestamptz), public.list_mtu_saved_messages(integer), public.search_mtu_conversation_messages(uuid,text), public.create_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.list_mtu_group_polls(uuid), public.cast_mtu_group_poll_vote(uuid,uuid), public.create_mtu_group_task(uuid,text,uuid,timestamptz), public.list_mtu_group_tasks(uuid), public.set_mtu_group_task_completed(uuid,boolean), public.revoke_mtu_group_invite(uuid,text), public.rotate_mtu_group_invite(uuid) from public, anon;
grant execute on function public.get_mtu_conversation_notification_preference(uuid), public.set_mtu_conversation_notification_preference(uuid,boolean,timestamptz), public.list_mtu_saved_messages(integer), public.search_mtu_conversation_messages(uuid,text), public.create_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.list_mtu_group_polls(uuid), public.cast_mtu_group_poll_vote(uuid,uuid), public.create_mtu_group_task(uuid,text,uuid,timestamptz), public.list_mtu_group_tasks(uuid), public.set_mtu_group_task_completed(uuid,boolean), public.revoke_mtu_group_invite(uuid,text), public.rotate_mtu_group_invite(uuid) to authenticated;

-- ===== messaging-group-collaboration.sql =====
-- CONVO group collaboration extensions
-- Run after messaging-community-utilities.sql.
-- Safe to rerun. Tables are private and all access is through member-checked RPCs.

create table if not exists public.group_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 240),
  created_at timestamptz not null default now()
);

create table if not exists public.group_event_attendees (
  event_id uuid not null references public.group_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  response text not null default 'going' check (response in ('going','maybe','declined')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > publish_at)
);

create index if not exists group_events_conversation_idx on public.group_events(conversation_id, starts_at);
create index if not exists group_event_attendees_event_idx on public.group_event_attendees(event_id, response);
create index if not exists group_notes_conversation_idx on public.group_notes(conversation_id, updated_at desc);
create index if not exists group_announcements_conversation_idx on public.group_announcements(conversation_id, publish_at desc);

alter table public.group_events enable row level security;
alter table public.group_event_attendees enable row level security;
alter table public.group_notes enable row level security;
alter table public.group_announcements enable row level security;

drop policy if exists "No direct Convo event access" on public.group_events;
create policy "No direct Convo event access" on public.group_events for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo event attendee access" on public.group_event_attendees;
create policy "No direct Convo event attendee access" on public.group_event_attendees for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo note access" on public.group_notes;
create policy "No direct Convo note access" on public.group_notes for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo announcement access" on public.group_announcements;
create policy "No direct Convo announcement access" on public.group_announcements for all to authenticated using (false) with check (false);

create or replace function public.create_mtu_group_event(
  p_conversation_id uuid,
  p_title text,
  p_description text default '',
  p_starts_at timestamptz default null,
  p_location text default ''
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create an event'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future event time'; end if;
  if not exists (select 1 from public.conversation_members member join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group' where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can create events'; end if;
  insert into public.group_events(conversation_id, created_by, title, description, starts_at, location)
  values (p_conversation_id, auth.uid(), trim(p_title), trim(coalesce(p_description,'')), p_starts_at, trim(coalesce(p_location,''))) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.list_mtu_group_events(p_conversation_id uuid)
returns table (id uuid, title text, description text, starts_at timestamptz, location text, created_by uuid, going_count bigint, my_response text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select event.id, event.title, event.description, event.starts_at, event.location, event.created_by,
    (select count(*) from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.response = 'going'),
    (select attendee.response from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.user_id = auth.uid())
  from public.group_events event
  where public.is_mtu_account() and exists (select 1 from public.conversation_members member where member.conversation_id = event.conversation_id and member.user_id = auth.uid())
    and event.conversation_id = p_conversation_id
  order by event.starts_at asc;
$$;

create or replace function public.set_mtu_group_event_response(p_event_id uuid, p_response text)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare conversation_id_value uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to respond to this event'; end if;
  if p_response not in ('going','maybe','declined') then raise exception 'Choose going, maybe, or declined'; end if;
  select event.conversation_id into conversation_id_value from public.group_events event where event.id = p_event_id;
  if conversation_id_value is null or not exists (select 1 from public.conversation_members member where member.conversation_id = conversation_id_value and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_event_attendees(event_id, user_id, response) values (p_event_id, auth.uid(), p_response)
  on conflict (event_id, user_id) do update set response = excluded.response, updated_at = now();
  return p_response;
end;
$$;

create or replace function public.create_mtu_group_note(p_conversation_id uuid, p_title text, p_body text default '')
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group' where member.conversation_id = p_conversation_id and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_notes(conversation_id, created_by, updated_by, title, body) values (p_conversation_id, auth.uid(), auth.uid(), trim(p_title), coalesce(p_body,'')) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.update_mtu_group_note(p_note_id uuid, p_title text, p_body text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare conversation_id_value uuid;
begin
  select note.conversation_id into conversation_id_value from public.group_notes note where note.id = p_note_id;
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to edit this note'; end if;
  if conversation_id_value is null or not exists (select 1 from public.conversation_members member where member.conversation_id = conversation_id_value and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  if not exists (select 1 from public.group_notes note where note.id = p_note_id and (note.created_by = auth.uid() or exists (select 1 from public.conversation_members member where member.conversation_id = note.conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')))) then raise exception 'Only the note author or a group admin can edit this note'; end if;
  update public.group_notes set title = trim(p_title), body = p_body, updated_by = auth.uid(), updated_at = now() where id = p_note_id;
  return found;
end;
$$;

create or replace function public.list_mtu_group_notes(p_conversation_id uuid)
returns table (id uuid, title text, body text, created_by uuid, updated_by uuid, created_at timestamptz, updated_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select note.id, note.title, note.body, note.created_by, note.updated_by, note.created_at, note.updated_at from public.group_notes note
  where public.is_mtu_account() and note.conversation_id = p_conversation_id and exists (select 1 from public.conversation_members member where member.conversation_id = note.conversation_id and member.user_id = auth.uid())
  order by note.updated_at desc;
$$;

create or replace function public.create_mtu_group_announcement(p_conversation_id uuid, p_title text, p_body text, p_expires_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can publish announcements'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Announcement expiry must be in the future'; end if;
  insert into public.group_announcements(conversation_id, created_by, title, body, expires_at) values (p_conversation_id, auth.uid(), trim(p_title), trim(p_body), p_expires_at) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.list_mtu_group_announcements(p_conversation_id uuid)
returns table (id uuid, title text, body text, created_by uuid, publish_at timestamptz, expires_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select announcement.id, announcement.title, announcement.body, announcement.created_by, announcement.publish_at, announcement.expires_at from public.group_announcements announcement
  where public.is_mtu_account() and announcement.conversation_id = p_conversation_id and announcement.publish_at <= now() and (announcement.expires_at is null or announcement.expires_at > now()) and exists (select 1 from public.conversation_members member where member.conversation_id = announcement.conversation_id and member.user_id = auth.uid())
  order by announcement.publish_at desc;
$$;

revoke execute on function public.create_mtu_group_event(uuid,text,text,timestamptz,text), public.list_mtu_group_events(uuid), public.set_mtu_group_event_response(uuid,text), public.create_mtu_group_note(uuid,text,text), public.update_mtu_group_note(uuid,text,text), public.list_mtu_group_notes(uuid), public.create_mtu_group_announcement(uuid,text,text,timestamptz), public.list_mtu_group_announcements(uuid) from public, anon;
grant execute on function public.create_mtu_group_event(uuid,text,text,timestamptz,text), public.list_mtu_group_events(uuid), public.set_mtu_group_event_response(uuid,text), public.create_mtu_group_note(uuid,text,text), public.update_mtu_group_note(uuid,text,text), public.list_mtu_group_notes(uuid), public.create_mtu_group_announcement(uuid,text,text,timestamptz), public.list_mtu_group_announcements(uuid) to authenticated;

-- ===== convo-full-scope-repair.sql =====
-- CONVO full-scope reliability repair
-- Run after the existing CONVO messaging/group migrations.
-- Safe to rerun. This migration does not seed or fabricate any data.

-- 1) Group creation metadata and lifecycle.
alter table public.conversations add column if not exists group_category text;
alter table public.conversations add column if not exists ended_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_group_category_check'
  ) then
    alter table public.conversations add constraint conversations_group_category_check
      check (group_category is null or group_category in ('academic','social','sports','technology','business','arts','club','project','code_tech','cruise'));
  end if;
end;
$$;

create index if not exists conversations_group_category_idx
  on public.conversations(kind, group_category, updated_at desc)
  where kind = 'group' and ended_at is null;

-- 2) Privacy-safe activity timestamp. The client calls this only for the signed-in user.
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_mtu_last_seen()
returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result timestamptz;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU users can update activity';
  end if;
  update public.profiles
    set last_seen_at = now()
  where id = auth.uid()
  returning last_seen_at into result;
  return result;
end;
$$;

-- 3) Category-aware group creation. The existing two-argument function is retained
-- for compatibility; new clients should call this three-argument version.
drop function if exists public.create_mtu_group_conversation(text, text, uuid[]);
-- 4) Searchable group directory. Only verified MTU users can query it. Membership
-- and ended groups are returned as state, never as private message content.
create or replace function public.search_mtu_groups(
  p_query text default '',
  p_category text default 'all'
)
returns table (
  conversation_id uuid,
  title text,
  category text,
  group_image_url text,
  member_count bigint,
  is_member boolean,
  my_request_status text
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select conversation.id,
    conversation.title,
    conversation.group_category,
    conversation.group_image_url,
    (select count(*) from public.conversation_members member where member.conversation_id = conversation.id),
    exists (select 1 from public.conversation_members mine where mine.conversation_id = conversation.id and mine.user_id = auth.uid()),
    (select request.status from public.group_join_requests request where request.conversation_id = conversation.id and request.user_id = auth.uid())
  from public.conversations conversation
  where public.is_mtu_account()
    and conversation.kind = 'group'
    and conversation.ended_at is null
    and not coalesce(conversation.is_private, false)
    and (nullif(trim(coalesce(p_query, '')), '') is null or conversation.title ilike '%' || trim(p_query) || '%')
    and (coalesce(p_category, 'all') = 'all' or conversation.group_category = p_category)
  order by conversation.updated_at desc, conversation.title asc
  limit 100;
$$;

create or replace function public.request_mtu_group_join(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare title_value text; approval_required boolean;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with your MTU account to request group access';
  end if;
  select conversation.title into title_value
    from public.conversations conversation
    where conversation.id = p_conversation_id
      and conversation.kind = 'group'
      and conversation.ended_at is null;
  if title_value is null then raise exception 'This group is unavailable'; end if;
  if exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'member', 'group_title', title_value);
  end if;
  insert into public.group_permissions(conversation_id) values (p_conversation_id) on conflict do nothing;
  select require_join_approval into approval_required from public.group_permissions where conversation_id = p_conversation_id;
  if not coalesce(approval_required, true) then
    insert into public.conversation_members(conversation_id, user_id, group_role)
      values (p_conversation_id, auth.uid(), 'member') on conflict do nothing;
    return jsonb_build_object('status', 'member', 'group_title', title_value);
  end if;
  insert into public.group_join_requests(conversation_id, user_id, status, reviewed_by, reviewed_at)
    values (p_conversation_id, auth.uid(), 'pending', null, null)
    on conflict (conversation_id, user_id) do update set status = 'pending', reviewed_by = null, reviewed_at = null;
  return jsonb_build_object('status', 'pending', 'group_title', title_value);
end;
$$;

create or replace function public.list_mtu_my_group_join_requests()
returns table (conversation_id uuid, group_title text, category text, status text, created_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select request.conversation_id, conversation.title, conversation.group_category, request.status, request.created_at
  from public.group_join_requests request
  join public.conversations conversation on conversation.id = request.conversation_id and conversation.kind = 'group'
  where public.is_mtu_account() and request.user_id = auth.uid()
  order by request.created_at desc;
$$;

-- 5) Owner-only soft end. Existing messages remain auditable, but new message/group
-- writes should be rejected by the client and the send RPC after this migration.
create or replace function public.end_mtu_group(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to end this group'; end if;
  if not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role = 'owner'
  ) then raise exception 'Only the group owner can end this group'; end if;
  update public.conversations set ended_at = coalesce(ended_at, now()), updated_at = now()
    where id = p_conversation_id and kind = 'group';
  return found;
end;
$$;

-- 6) Owner/admin message moderation. This is a reversible tombstone, not a physical
-- delete, so the conversation timeline stays consistent for every member.
create or replace function public.delete_mtu_group_message(p_message_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare conversation_id_value uuid;
begin
  select message.conversation_id into conversation_id_value
    from public.messages message
    where message.id = p_message_id;
  if conversation_id_value is null then raise exception 'Message not found'; end if;
  if not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = conversation_id_value and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group owners and admins can remove group messages'; end if;
  update public.messages
    set body = 'Message removed by a group moderator', deleted_at = coalesce(deleted_at, now()), edited_at = now()
    where id = p_message_id and conversation_id = conversation_id_value;
  return found;
end;
$$;

-- 7) Optional helper for the clientâ€™s shared-files page. It exposes only messages
-- already visible to the requesting member and keeps sender identity public-safe.
create or replace function public.list_mtu_shared_files(p_conversation_id uuid)
returns table (
  message_id uuid,
  sender_id uuid,
  attachment_url text,
  attachment_path text,
  attachment_mime text,
  body text,
  created_at timestamptz
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select message.id, message.sender_id, message.attachment_url, message.attachment_path,
    message.attachment_mime, message.body, message.created_at
  from public.messages message
  where public.is_mtu_account()
    and message.conversation_id = p_conversation_id
    and message.attachment_url is not null
    and exists (select 1 from public.conversation_members member where member.conversation_id = message.conversation_id and member.user_id = auth.uid())
  order by message.created_at desc;
$$;

drop function if exists public.create_mtu_group_conversation(text, text, uuid[]);
create function public.create_mtu_group_conversation(
  p_title text,
  p_category text,
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Only verified MTU students can create groups'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'Group names must be between 2 and 80 characters'; end if;
  if p_category not in ('academic','social','sports','technology','business','arts','club','project','code_tech','cruise') then raise exception 'Choose a valid group category'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.profiles profile where profile.id = member_id)) then raise exception 'Every group member must have an MTU profile'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests request where request.status = 'accepted' and ((request.requester_id = auth.uid() and request.recipient_id = member_id) or (request.requester_id = member_id and request.recipient_id = auth.uid())))) then raise exception 'Group members must be accepted MTU connections'; end if;
  insert into public.conversations(kind, title, group_category) values ('group', trim(p_title), p_category) returning id into result_id;
  insert into public.conversation_members(conversation_id, user_id, group_role) values (result_id, auth.uid(), 'owner');
  insert into public.conversation_members(conversation_id, user_id, group_role) select result_id, member_id, 'member' from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() on conflict (conversation_id, user_id) do nothing;
  insert into public.group_permissions(conversation_id) values (result_id) on conflict (conversation_id) do nothing;
  return result_id;
end;
$$;
revoke execute on function public.create_mtu_group_conversation(text, text, uuid[]) from public, anon;
grant execute on function public.create_mtu_group_conversation(text, text, uuid[]) to authenticated;

revoke execute on function public.touch_mtu_last_seen(), public.create_mtu_group_conversation(text,text,uuid[]), public.search_mtu_groups(text,text), public.request_mtu_group_join(uuid), public.list_mtu_my_group_join_requests(), public.end_mtu_group(uuid), public.delete_mtu_group_message(uuid), public.list_mtu_shared_files(uuid) from public, anon;
grant execute on function public.touch_mtu_last_seen(), public.create_mtu_group_conversation(text,text,uuid[]), public.search_mtu_groups(text,text), public.request_mtu_group_join(uuid), public.list_mtu_my_group_join_requests(), public.end_mtu_group(uuid), public.delete_mtu_group_message(uuid), public.list_mtu_shared_files(uuid) to authenticated;
revoke all on function public.set_mtu_group_privacy(uuid, boolean) from public, anon;
grant execute on function public.set_mtu_group_privacy(uuid, boolean) to authenticated;

-- 8) Conversation rail data with privacy-safe public activity metadata.
-- This is a new RPC name because PostgreSQL cannot change an existing function's
-- RETURNS TABLE shape with CREATE OR REPLACE.
create or replace function public.list_mtu_conversations_v3()
returns table(
  id uuid, kind text, title text, counterpart_id uuid, group_image_url text,
  group_category text, ended_at timestamptz, counterpart_last_seen_at timestamptz,
  updated_at timestamptz, last_message text, last_message_at timestamptz,
  unread_count bigint, is_pinned boolean, is_archived boolean, muted_until timestamptz,
  draft_body text, is_marked_unread boolean
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select conversation.id, conversation.kind,
    coalesce(preference.private_label, case when conversation.kind = 'direct' then coalesce(other_member.display_name, 'MTU connection') else conversation.title end),
    other_member.user_id, conversation.group_image_url, conversation.group_category, conversation.ended_at,
    other_member.last_seen_at, conversation.updated_at, last_message.body, last_message.created_at,
    coalesce((select count(*) from public.messages unread where unread.conversation_id = conversation.id and unread.sender_id <> auth.uid() and unread.delivery_state <> 'blocked' and not exists (select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())), 0),
    coalesce(preference.is_pinned, false), coalesce(preference.is_archived, false), preference.muted_until,
    preference.draft_body, coalesce(preference.is_marked_unread, false)
  from public.conversations conversation
  join public.conversation_members me on me.conversation_id = conversation.id and me.user_id = auth.uid()
  left join public.conversation_member_preferences preference on preference.conversation_id = conversation.id and preference.user_id = auth.uid()
  left join lateral (
    select member.user_id, profile.display_name, profile.last_seen_at
    from public.conversation_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = conversation.id and member.user_id <> auth.uid()
    limit 1
  ) other_member on conversation.kind = 'direct'
  left join lateral (
    select message.body, message.created_at
    from public.messages message
    where message.conversation_id = conversation.id and (message.delivery_state <> 'blocked' or message.sender_id = auth.uid())
    order by message.created_at desc limit 1
  ) last_message on true
  where public.is_mtu_account()
  order by coalesce(preference.is_pinned, false) desc, conversation.updated_at desc;
$$;
revoke execute on function public.list_mtu_conversations_v3() from public, anon;
grant execute on function public.list_mtu_conversations_v3() to authenticated;

-- 9) Make task creation visible in the group conversation as a persisted message.
-- Run after messaging-community-utilities.sql has created the original function.
create or replace function public.create_mtu_group_task(
  p_conversation_id uuid,
  p_title text,
  p_assignee_id uuid default null,
  p_due_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; task_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create a task'; end if;
  select member.group_role into role_value
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  if role_value not in ('owner','admin') and exists (
    select 1 from public.group_permissions permissions
    where permissions.conversation_id = p_conversation_id
      and permissions.allow_member_messages = false
  ) then raise exception 'Only group admins can create tasks in this group'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'A task must be between 1 and 240 characters'; end if;
  if p_due_at is not null and p_due_at <= now() then raise exception 'Choose a future task deadline'; end if;
  if p_assignee_id is not null and not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = p_assignee_id) then raise exception 'Assign tasks only to current group members'; end if;
  insert into public.group_tasks (conversation_id, created_by, assignee_id, title, due_at)
  values (p_conversation_id, auth.uid(), p_assignee_id, trim(p_title), p_due_at)
  returning id into task_id;
  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, auth.uid(), 'Task: ' || trim(p_title));
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return task_id;
end;
$$;
revoke execute on function public.create_mtu_group_task(uuid,text,uuid,timestamptz) from public, anon;
grant execute on function public.create_mtu_group_task(uuid,text,uuid,timestamptz) to authenticated;


-- ===== CONSOLIDATED: convo-calls-gemini.sql =====
create table if not exists public.mtu_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('voice','video')),
  room_name text not null unique,
  status text not null default 'ringing' check (status in ('ringing','answered','declined','ended','failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration integer,
  created_at timestamptz not null default now()
);
alter table public.mtu_calls alter column callee_id drop not null;

create table if not exists public.mtu_call_participants (
  call_id uuid not null references public.mtu_calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing','joined','declined','left','missed')),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index if not exists mtu_call_participants_user_idx on public.mtu_call_participants(user_id, call_id);
alter table public.mtu_call_participants enable row level security;
grant select on public.mtu_call_participants to authenticated;
create or replace function public.is_mtu_call_participant(p_call_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null and exists (
    select 1 from public.mtu_call_participants
    where call_id = p_call_id and user_id = auth.uid()
  );
$$;
revoke execute on function public.is_mtu_call_participant(uuid) from public, anon;
grant execute on function public.is_mtu_call_participant(uuid) to authenticated;
drop policy if exists mtu_call_participants_access on public.mtu_call_participants;
create policy mtu_call_participants_access on public.mtu_call_participants for select to authenticated using (
  public.is_mtu_account() and public.is_mtu_call_participant(call_id)
);
insert into public.mtu_call_participants (call_id, user_id)
select id, participant_id
from public.mtu_calls cross join lateral unnest(array_remove(array[caller_id, callee_id], null::uuid)) participant_id
on conflict (call_id, user_id) do nothing;
create index if not exists mtu_calls_participants_idx on public.mtu_calls(caller_id, callee_id, created_at desc);
alter table public.mtu_calls enable row level security;
grant select on public.mtu_calls to authenticated;
drop policy if exists mtu_calls_participants on public.mtu_calls;
create policy mtu_calls_participants on public.mtu_calls for select to authenticated using (
  public.is_mtu_account() and exists (
    select 1 from public.mtu_call_participants p
    where p.call_id = mtu_calls.id and p.user_id = auth.uid()
  )
);

drop function if exists public.create_mtu_call(uuid, uuid, text, text);
create or replace function public.create_mtu_call(p_conversation_id uuid, p_callee_id uuid default null, p_call_type text default 'voice', p_room_name text default null)
returns public.mtu_calls language plpgsql security definer set search_path = public as $$
declare result public.mtu_calls; callee_policy text; conversation_kind text;
begin
  if auth.uid() is null or not exists (select 1 from conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'Invalid caller' using errcode = '42501'; end if;
  select kind into conversation_kind from conversations where id = p_conversation_id;
  if conversation_kind = 'group' then
    if (select count(*) from conversation_members where conversation_id = p_conversation_id) < 2 then raise exception 'A group call needs at least two members' using errcode = '42501'; end if;
  else
    if p_callee_id is null or p_callee_id = auth.uid() or not exists (select 1 from conversation_members where conversation_id = p_conversation_id and user_id = p_callee_id) then raise exception 'Students are not in this conversation' using errcode = '42501'; end if;
    select coalesce(allow_calls, 'everyone') into callee_policy from mtu_privacy_settings where user_id = p_callee_id;
    if callee_policy = 'nobody' then raise exception 'This student is not accepting calls' using errcode = '42501'; end if;
    if callee_policy = 'connections' and not exists (select 1 from connection_requests where status = 'accepted' and ((requester_id = auth.uid() and recipient_id = p_callee_id) or (requester_id = p_callee_id and recipient_id = auth.uid()))) then raise exception 'Calls are limited to connections' using errcode = '42501'; end if;
  end if;
  if exists (select 1 from mtu_call_participants where user_id = auth.uid() and call_id in (select id from mtu_calls where status in ('ringing','answered'))) then raise exception 'You already have an active call' using errcode = '42501'; end if;
  insert into mtu_calls(conversation_id, caller_id, callee_id, call_type, room_name) values (p_conversation_id, auth.uid(), case when conversation_kind = 'group' then null else p_callee_id end, p_call_type, p_room_name) returning * into result;
  insert into mtu_call_participants (call_id, user_id) select result.id, user_id from conversation_members where conversation_id = p_conversation_id;
  return result;
end; $$;
grant execute on function public.create_mtu_call(uuid, uuid, text, text) to authenticated;

drop function if exists public.update_mtu_call_status(uuid, text);
create or replace function public.update_mtu_call_status(p_call_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare caller uuid; callee uuid; current_status text;
begin
  if p_status not in ('ringing','answered','declined','ended','failed') then raise exception 'Invalid call status' using errcode = '22023'; end if;
  select caller_id, callee_id, status into caller, callee, current_status from mtu_calls where id = p_call_id;
  if not exists (select 1 from mtu_call_participants where call_id = p_call_id and user_id = auth.uid()) then raise exception 'Not a call participant' using errcode = '42501'; end if;
  if not ((current_status = 'ringing' and p_status in ('answered','declined','ended','failed')) or (current_status = 'answered' and p_status in ('ended','failed')) or current_status = p_status) then raise exception 'Invalid call status transition' using errcode = '42501'; end if;
  update mtu_calls set status = p_status, answered_at = case when p_status = 'answered' then coalesce(answered_at, now()) else answered_at end, ended_at = case when p_status in ('ended','declined','failed') then coalesce(ended_at, now()) else ended_at end, duration = case when p_status = 'ended' and answered_at is not null then greatest(0, extract(epoch from (now() - answered_at))::integer) else duration end where id = p_call_id;
  return true;
end; $$;
grant execute on function public.update_mtu_call_status(uuid, text) to authenticated;

-- Private conversation attachments: apply this section in the same migration.
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do update set public = false;
drop policy if exists "message attachments read" on storage.objects;
create policy "message attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'message-attachments' and exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.attachment_path = storage.objects.name and cm.user_id = auth.uid()
  )
);
drop policy if exists "message attachments upload" on storage.objects;
create policy "message attachments upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "message attachments delete" on storage.objects;
create policy "message attachments delete" on storage.objects for delete to authenticated using (
  bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text
);


-- ===== CONSOLIDATED: messaging-blocked-students-management.sql =====
-- Run in Supabase Dashboard â†’ SQL Editor after messaging-safety-and-identity.sql.
-- This exposes only the current student's own block list and permits only that student to remove their own block.

create or replace function public.list_mtu_blocked_students()
returns table(
  blocked_id uuid,
  display_name text,
  nickname text,
  student_id text,
  avatar_url text,
  blocked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU students can view blocked students';
  end if;

  return query
  select
    block.blocked_id,
    profile.display_name,
    profile.display_name,
    profile.student_id,
    profile.avatar_url,
    block.created_at
  from public.student_blocks block
  join public.profiles profile on profile.id = block.blocked_id
  where block.blocker_id = auth.uid()
  order by block.created_at desc;
end;
$$;

create or replace function public.unblock_mtu_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can unblock a student';
  end if;

  delete from public.student_blocks
  where blocker_id = auth.uid()
    and blocked_id = p_student_id;

  -- Clear the prior local block status; neither student becomes connected automatically.
  update public.connection_requests
  set status = 'declined', updated_at = now()
  where status = 'blocked'
    and ((requester_id = auth.uid() and recipient_id = p_student_id)
      or (requester_id = p_student_id and recipient_id = auth.uid()));

  return true;
end;
$$;

revoke execute on function public.list_mtu_blocked_students(), public.unblock_mtu_student(uuid) from public, anon;
grant execute on function public.list_mtu_blocked_students(), public.unblock_mtu_student(uuid) to authenticated;


-- ===== FINAL CANONICAL HARDENING =====

-- Allow a sender to create a signed URL immediately after upload.
-- The message row does not exist until after the upload completes.
-- Safe to rerun in the Supabase SQL editor.

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do update set public = false;

grant select, insert on storage.objects to authenticated;

drop policy if exists "message attachments read" on storage.objects;
create policy "message attachments read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'message-attachments'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.messages message
      join public.conversation_members member
        on member.conversation_id = message.conversation_id
      where message.attachment_path = storage.objects.name
        and member.user_id = auth.uid()
    )
  )
);

drop policy if exists "message attachments upload" on storage.objects;
create policy "message attachments upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'message-attachments'
  and public.is_mtu_account()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Repair permissions for sending text and file messages.
-- Safe to rerun in the Supabase SQL editor.

alter table public.messages enable row level security;

grant select, insert, update on public.messages to authenticated;
grant update on public.conversations to authenticated;

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
on public.messages for insert
to authenticated
with check (
  public.is_mtu_account()
  and sender_id = auth.uid()
  and exists (
    select 1
    from public.conversation_members member
    where member.conversation_id = messages.conversation_id
      and member.user_id = auth.uid()
  )
);

-- Keep only the current reply/attachment-aware RPC signature.
drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  attachment_url text,
  attachment_path text,
  attachment_mime text,
  edited_at timestamptz,
  deleted_at timestamptz,
  delivery_state text,
  reply_to_id uuid,
  reply_body text,
  reply_sender_id uuid
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    max(read_receipt.read_at) filter (where read_receipt.user_id <> m.sender_id),
    m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at, m.delivery_state,
    m.reply_to_id, reply_message.body, reply_message.sender_id
  from public.messages m
  left join public.message_reads read_receipt on read_receipt.message_id = m.id
  left join public.messages reply_message on reply_message.id = m.reply_to_id
  where public.is_mtu_account()
    and m.conversation_id = p_conversation_id
    and (m.delivery_state <> 'blocked' or m.sender_id = auth.uid())
    and exists (select 1 from public.conversation_members member where member.conversation_id = m.conversation_id and member.user_id = auth.uid())
  group by m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at, m.delivery_state, m.reply_to_id, reply_message.body, reply_message.sender_id
  order by m.created_at asc;
$$;
revoke execute on function public.list_mtu_messages(uuid) from public, anon;
grant execute on function public.list_mtu_messages(uuid) to authenticated;

drop function if exists public.send_mtu_message(uuid, text, text, text);
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid);
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid, text);
create function public.send_mtu_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_path text default null,
  p_reply_to_id uuid default null,
  p_attachment_mime text default null
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result public.messages;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if exists (
    select 1
    from public.conversations conversation
    join public.conversation_members member
      on member.conversation_id = conversation.id
      and member.user_id = auth.uid()
    join public.group_permissions permissions
      on permissions.conversation_id = conversation.id
    where conversation.id = p_conversation_id
      and conversation.kind = 'group'
      and member.group_role not in ('owner', 'admin')
      and permissions.allow_member_messages = false
  ) then raise exception 'Only group admins can send messages in this group'; end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then raise exception 'Add a message or attachment before sending'; end if;
  if p_attachment_url is null and p_attachment_mime is not null then raise exception 'Attachment metadata requires an attachment'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path, reply_to_id, attachment_mime, delivery_state)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path, p_reply_to_id, p_attachment_mime,
    case when exists (
      select 1 from public.conversations conversation
      join public.conversation_members other_member on other_member.conversation_id = conversation.id and other_member.user_id <> auth.uid()
      join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id) or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
      where conversation.id = p_conversation_id and conversation.kind = 'direct'
    ) then 'blocked' else 'delivered' end)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;
alter function public.send_mtu_message(uuid, text, text, text, uuid, text) security definer;
grant execute on function public.send_mtu_message(uuid, text, text, text, uuid, text) to authenticated;

-- Auth metadata updates (including avatar_url) invoke the existing
-- sync_convo_profile_from_auth trigger on auth.users. Keep that trigger's
-- profile upsert tolerant of incomplete onboarding metadata so an avatar-only
-- update cannot make Supabase Auth return HTTP 500.
create or replace function public.sync_convo_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  profile_name text;
  profile_student_id text;
  profile_level text;
  profile_department text;
  profile_programme text;
  profile_avatar_url text;
  profile_bio text;
begin
  profile_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  profile_student_id := nullif(trim(coalesce(metadata ->> 'student_id', '')), '');
  profile_level := nullif(trim(coalesce(metadata ->> 'level', '')), '');
  profile_department := nullif(trim(coalesce(metadata ->> 'college', metadata ->> 'department', '')), '');
  profile_programme := nullif(trim(coalesce(metadata ->> 'programme', metadata ->> 'major', '')), '');
  profile_avatar_url := nullif(trim(coalesce(metadata ->> 'avatar_url', '')), '');
  profile_bio := nullif(trim(coalesce(metadata ->> 'bio', '')), '');

  insert into public.profiles (id, display_name, student_id, level, department, programme, avatar_url, bio)
  values (
    new.id,
    coalesce(profile_name, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'MTU student'),
    coalesce(profile_student_id, 'MTU-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))),
    profile_level, profile_department, profile_programme, profile_avatar_url, profile_bio
  )
  on conflict (id) do update set
    display_name = coalesce(profile_name, public.profiles.display_name),
    student_id = coalesce(profile_student_id, public.profiles.student_id),
    level = coalesce(profile_level, public.profiles.level),
    department = coalesce(profile_department, public.profiles.department),
    programme = coalesce(profile_programme, public.profiles.programme),
    avatar_url = coalesce(profile_avatar_url, public.profiles.avatar_url),
    bio = coalesce(profile_bio, public.profiles.bio);

  return new;
end;
$$;


create table if not exists public.mtu_public_profile_updates (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  student_id text,
  level text,
  department text,
  programme text,
  avatar_url text,
  updated_at timestamptz not null default now()
);
-- Existing projects may have an earlier, narrower version of this table.
-- Add every column used by the publication trigger before recreating it.
alter table public.mtu_public_profile_updates add column if not exists display_name text;
alter table public.mtu_public_profile_updates add column if not exists student_id text;
alter table public.mtu_public_profile_updates add column if not exists level text;
alter table public.mtu_public_profile_updates add column if not exists department text;
alter table public.mtu_public_profile_updates add column if not exists programme text;
alter table public.mtu_public_profile_updates add column if not exists avatar_url text;
alter table public.mtu_public_profile_updates add column if not exists updated_at timestamptz not null default now();
alter table public.mtu_public_profile_updates enable row level security;
revoke all on public.mtu_public_profile_updates from anon, authenticated;
-- Drop the dependent trigger before replacing its function so the complete
-- setup remains safe to re-run after a previous successful execution.
drop trigger if exists publish_mtu_public_profile_update on public.profiles;
drop function if exists public.publish_mtu_public_profile_update();
create function public.publish_mtu_public_profile_update()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  insert into public.mtu_public_profile_updates (id, display_name, student_id, level, department, programme, avatar_url, updated_at)
  values (new.id, new.display_name, new.student_id, new.level, new.department, new.programme, new.avatar_url, now())
  on conflict (id) do update set display_name = excluded.display_name, student_id = excluded.student_id, level = excluded.level, department = excluded.department, programme = excluded.programme, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at;
  return new;
end;
$$;
create trigger publish_mtu_public_profile_update
after insert or update of display_name, student_id, level, department, programme, avatar_url on public.profiles
for each row execute function public.publish_mtu_public_profile_update();

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','mtu_public_profile_updates','campus_posts','campus_groups','campus_group_memberships','connection_requests','messages','message_reads','group_polls','group_poll_options','group_poll_votes','group_tasks','group_events','group_event_attendees','group_announcements'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', table_name); exception when duplicate_object then null; end;
  end loop;
end;
$$;

-- ===== Focus Hour =====
create table if not exists public.mtu_focus_hours (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (30, 45, 60)),
  active boolean not null default true,
  ended_at timestamptz,
  check (ends_at > started_at)
);
create index if not exists mtu_focus_hours_active_idx on public.mtu_focus_hours (ends_at) where active and ended_at is null;
alter table public.mtu_focus_hours enable row level security;
create policy "focus hours own row" on public.mtu_focus_hours for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "focus hours eligible rows" on public.mtu_focus_hours for select using (
  auth.uid() is not null and public.is_mtu_account() and active and ended_at is null and ends_at > now()
  and exists (select 1 from public.profiles p where p.id = user_id and coalesce((p.profile_visibility ->> 'programme')::boolean, true) and coalesce((p.profile_visibility ->> 'focus_hour')::boolean, false))
  and not exists (select 1 from public.student_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = user_id) or (b.blocker_id = user_id and b.blocked_id = auth.uid()))
);
create or replace function public.start_mtu_focus_hour(p_minutes integer) returns public.mtu_focus_hours language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare result public.mtu_focus_hours;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to start a focus hour'; end if;
  if p_minutes not in (30, 45, 60) then raise exception 'Choose 30, 45, or 60 minutes'; end if;
  insert into public.mtu_focus_hours(user_id, started_at, ends_at, duration_minutes, active, ended_at)
  values (auth.uid(), now(), now() + make_interval(mins => p_minutes), p_minutes, true, null)
  on conflict (user_id) do update set started_at = excluded.started_at, ends_at = excluded.ends_at, duration_minutes = excluded.duration_minutes, active = true, ended_at = null
  returning * into result;
  return result;
end;
$$;
create or replace function public.end_mtu_focus_hour() returns public.mtu_focus_hours language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare result public.mtu_focus_hours;
begin
  update public.mtu_focus_hours set ended_at = now(), active = false where user_id = auth.uid() and active and ended_at is null and ends_at > now() returning * into result;
  return result;
end;
$$;
create or replace function public.get_my_mtu_focus_hour() returns public.mtu_focus_hours language sql security definer set search_path = pg_catalog, public, auth as $$
  select * from public.mtu_focus_hours where user_id = auth.uid() and active and ended_at is null and ends_at > now();
$$;
create or replace function public.list_mtu_focus_hours() returns table (user_id uuid, display_name text, avatar_url text, programme text, level text, started_at timestamptz, ends_at timestamptz) language sql security definer set search_path = pg_catalog, public, auth as $$
  select f.user_id, p.display_name, p.avatar_url, p.programme, p.level, f.started_at, f.ends_at
  from public.mtu_focus_hours f join public.profiles p on p.id = f.user_id
  where auth.uid() is not null and public.is_mtu_account() and f.active and f.ended_at is null and f.ends_at > now() and f.user_id <> auth.uid()
    and coalesce((p.profile_visibility ->> 'programme')::boolean, true) and coalesce((p.profile_visibility ->> 'focus_hour')::boolean, false)
    and not exists (select 1 from public.student_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = f.user_id) or (b.blocker_id = f.user_id and b.blocked_id = auth.uid()))
  order by f.started_at desc;
$$;
revoke all on public.mtu_focus_hours from anon, authenticated;
grant select on public.mtu_focus_hours to authenticated;
revoke all on function public.start_mtu_focus_hour(integer), public.end_mtu_focus_hour(), public.get_my_mtu_focus_hour(), public.list_mtu_focus_hours() from public, anon;
grant execute on function public.start_mtu_focus_hour(integer), public.end_mtu_focus_hour(), public.get_my_mtu_focus_hour(), public.list_mtu_focus_hours() to authenticated;
do $$ begin alter publication supabase_realtime add table public.mtu_focus_hours; exception when duplicate_object then null; end $$;
