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
create function public.create_mtu_group_conversation(
  p_title text,
  p_category text,
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU students can create groups';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 80 then
    raise exception 'Group names must be between 2 and 80 characters';
  end if;
  if p_category not in ('academic','social','sports','technology','business','arts','club','project','code_tech','cruise') then
    raise exception 'Choose a valid group category';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_member_ids, '{}')) member_id
    where member_id <> auth.uid()
      and not exists (select 1 from public.profiles profile where profile.id = member_id)
  ) then
    raise exception 'Every group member must have an MTU profile';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_member_ids, '{}')) member_id
    where member_id <> auth.uid()
      and not exists (
        select 1 from public.connection_requests request
        where request.status = 'accepted'
          and ((request.requester_id = auth.uid() and request.recipient_id = member_id)
            or (request.requester_id = member_id and request.recipient_id = auth.uid()))
      )
  ) then
    raise exception 'Group members must be accepted MTU connections';
  end if;
  insert into public.conversations(kind, title, group_category)
    values ('group', trim(p_title), p_category)
    returning id into result_id;
  insert into public.conversation_members(conversation_id, user_id, group_role)
    values (result_id, auth.uid(), 'owner');
  insert into public.conversation_members(conversation_id, user_id, group_role)
    select result_id, member_id, 'member'
    from unnest(coalesce(p_member_ids, '{}')) member_id
    where member_id <> auth.uid()
    on conflict (conversation_id, user_id) do nothing;
  insert into public.group_permissions(conversation_id)
    values (result_id)
    on conflict (conversation_id) do nothing;
  return result_id;
end;
$$;

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

-- 7) Optional helper for the client’s shared-files page. It exposes only messages
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

revoke execute on function public.touch_mtu_last_seen(), public.create_mtu_group_conversation(text,text,uuid[]), public.search_mtu_groups(text,text), public.request_mtu_group_join(uuid), public.list_mtu_my_group_join_requests(), public.end_mtu_group(uuid), public.delete_mtu_group_message(uuid), public.list_mtu_shared_files(uuid) from public, anon;
grant execute on function public.touch_mtu_last_seen(), public.create_mtu_group_conversation(text,text,uuid[]), public.search_mtu_groups(text,text), public.request_mtu_group_join(uuid), public.list_mtu_my_group_join_requests(), public.end_mtu_group(uuid), public.delete_mtu_group_message(uuid), public.list_mtu_shared_files(uuid) to authenticated;

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
