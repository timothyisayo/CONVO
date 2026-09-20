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

drop function if exists public.send_mtu_message(uuid,text,text,text,uuid,text);
create function public.send_mtu_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_path text default null,
  p_reply_to_id uuid default null,
  p_attachment_mime text default null
) returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result public.messages;
  conversation_kind text;
  other_user_id uuid;
  receiver_has_blocked_sender boolean := false;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this conversation';
  end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then
    raise exception 'Messages must be 4,000 characters or fewer';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then
    raise exception 'Add a message or attachment before sending';
  end if;
  if p_attachment_url is null and p_attachment_mime is not null then
    raise exception 'Attachment metadata requires an attachment';
  end if;
  if p_attachment_mime is not null and p_attachment_mime not in (
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ) then
    raise exception 'This attachment type is not supported';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id
  ) then
    raise exception 'Replies must refer to a message in this conversation';
  end if;

  select kind into conversation_kind from public.conversations where id = p_conversation_id;
  if conversation_kind = 'direct' then
    select member.user_id into other_user_id
    from public.conversation_members member
    where member.conversation_id = p_conversation_id
      and member.user_id <> auth.uid()
    limit 1;

    if exists (
      select 1 from public.student_blocks block
      where block.blocker_id = auth.uid() and block.blocked_id = other_user_id
    ) then
      raise exception 'You have blocked this student. Unblock them before sending a new message.';
    end if;

    receiver_has_blocked_sender := exists (
      select 1 from public.student_blocks block
      where block.blocker_id = other_user_id and block.blocked_id = auth.uid()
    );
  end if;

  insert into public.messages(
    conversation_id, sender_id, body, attachment_url, attachment_path,
    reply_to_id, attachment_mime, delivery_state
  ) values (
    p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url,
    p_attachment_path, p_reply_to_id, p_attachment_mime,
    case when receiver_has_blocked_sender then 'blocked' else 'delivered' end
  ) returning * into result;

  -- A blocked-period message must not reorder the other participant's inbox.
  if not receiver_has_blocked_sender then
    update public.conversations set updated_at = now() where id = p_conversation_id;
  end if;

  return result;
end;
$$;

drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table(
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz,
  read_at timestamptz, attachment_url text, attachment_path text, attachment_mime text,
  edited_at timestamptz, deleted_at timestamptz, reply_to_id uuid, reply_body text,
  reply_sender_id uuid, delivery_state text
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    max(receipt.read_at) filter (where receipt.user_id <> message.sender_id),
    message.attachment_url, message.attachment_path, message.attachment_mime,
    message.edited_at, message.deleted_at, message.reply_to_id, reply.body, reply.sender_id,
    message.delivery_state
  from public.messages message
  left join public.message_reads receipt on receipt.message_id = message.id
  left join public.messages reply on reply.id = message.reply_to_id
  where public.is_mtu_account()
    and message.conversation_id = p_conversation_id
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = message.conversation_id and member.user_id = auth.uid()
    )
    and (message.delivery_state <> 'blocked' or message.sender_id = auth.uid())
  group by
    message.id, message.conversation_id, message.sender_id, message.body, message.created_at,
    message.attachment_url, message.attachment_path, message.attachment_mime,
    message.edited_at, message.deleted_at, message.reply_to_id, reply.body, reply.sender_id,
    message.delivery_state
  order by message.created_at asc;
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

drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table(
  id uuid, kind text, title text, counterpart_id uuid, group_image_url text,
  updated_at timestamptz, last_message text, last_message_at timestamptz,
  unread_count bigint, is_pinned boolean, is_archived boolean, muted_until timestamptz,
  draft_body text, is_marked_unread boolean
)
language sql security definer stable set search_path=pg_catalog,public,auth as $$
  select
    conversation.id, conversation.kind,
    coalesce(preference.private_label, case when conversation.kind='direct' then coalesce(other_member.display_name,'MTU connection') else conversation.title end),
    other_member.user_id, conversation.group_image_url, conversation.updated_at,
    last_message.body, last_message.created_at,
    case when coalesce(preference.is_marked_unread,false) then greatest(coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id=conversation.id and unread.sender_id<>auth.uid()
        and unread.delivery_state <> 'blocked'
        and not exists(select 1 from public.message_reads receipt where receipt.message_id=unread.id and receipt.user_id=auth.uid())
    ),0),1) else coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id=conversation.id and unread.sender_id<>auth.uid()
        and unread.delivery_state <> 'blocked'
        and not exists(select 1 from public.message_reads receipt where receipt.message_id=unread.id and receipt.user_id=auth.uid())
    ),0) end,
    coalesce(preference.is_pinned,false), coalesce(preference.is_archived,false), preference.muted_until,
    preference.draft_body, coalesce(preference.is_marked_unread,false)
  from public.conversations conversation
  join public.conversation_members me on me.conversation_id=conversation.id and me.user_id=auth.uid()
  left join public.conversation_member_preferences preference on preference.conversation_id=conversation.id and preference.user_id=auth.uid()
  left join lateral(
    select member.user_id,profile.display_name
    from public.conversation_members member left join public.profiles profile on profile.id=member.user_id
    where member.conversation_id=conversation.id and member.user_id<>auth.uid() limit 1
  ) other_member on conversation.kind='direct'
  left join lateral(
    select message.body,message.created_at
    from public.messages message
    where message.conversation_id=conversation.id
      and (message.delivery_state <> 'blocked' or message.sender_id=auth.uid())
    order by message.created_at desc limit 1
  ) last_message on true
  where public.is_mtu_account()
  order by coalesce(preference.is_pinned,false) desc,conversation.updated_at desc;
$$;

revoke execute on function public.list_mtu_blocked_students(), public.block_mtu_student(uuid), public.unblock_mtu_student(uuid), public.send_mtu_message(uuid,text,text,text,uuid,text), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.list_mtu_conversations_v2() from public, anon;
grant execute on function public.list_mtu_blocked_students(), public.block_mtu_student(uuid), public.unblock_mtu_student(uuid), public.send_mtu_message(uuid,text,text,text,uuid,text), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.list_mtu_conversations_v2() to authenticated;

notify pgrst, 'reload schema';
