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
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) ~* '@mtu\\.edu\\.ng$'
$$;

alter table public.profiles enable row level security;
drop policy if exists "MTU users can read profiles" on public.profiles;
create policy "MTU users can read profiles"
on public.profiles for select to authenticated
using (public.is_mtu_account());

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

create or replace function public.list_mtu_connection_requests()
returns table (
  id uuid,
  requester_id uuid,
  recipient_id uuid,
  status text,
  direction text,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select r.id, r.requester_id, r.recipient_id, r.status,
    case when r.requester_id = auth.uid() then 'sent' else 'received' end,
    r.updated_at
  from public.connection_requests r
  where public.is_mtu_account()
    and (r.requester_id = auth.uid() or r.recipient_id = auth.uid())
  order by r.updated_at desc;
$$;

grant execute on function public.list_mtu_connection_requests() to authenticated;

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
