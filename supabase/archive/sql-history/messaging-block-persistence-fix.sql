-- CONVO PERSISTENT BLOCK-STATE REPAIR
-- Run AFTER convo-messaging-live-upgrade.sql and messaging-group-invites-and-permissions.sql.
-- This makes blocking server-enforced on every conversation, thread, interaction,
-- and directory reload. A blocked relationship never relies on browser-only state.

drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table (
  id uuid, kind text, title text, counterpart_id uuid, updated_at timestamptz,
  last_message text, last_message_at timestamptz, unread_count bigint
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select
    c.id,
    c.kind,
    coalesce(pref.private_label, case when c.kind = 'direct' then coalesce(other_member.display_name, 'MTU connection') else c.title end) as title,
    other_member.user_id as counterpart_id,
    c.updated_at,
    last_message.body,
    last_message.created_at,
    coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id = c.id and unread.sender_id <> auth.uid()
        and not exists (select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())
    ), 0) as unread_count
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_member_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid()
  left join lateral (
    select member.user_id, profile.display_name
    from public.conversation_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = c.id and member.user_id <> auth.uid()
    limit 1
  ) other_member on c.kind = 'direct'
  left join lateral (
    select message.body, message.created_at from public.messages message
    where message.conversation_id = c.id order by message.created_at desc limit 1
  ) last_message on true
  where public.is_mtu_account()
    and coalesce(pref.is_archived, false) = false
    and (
      c.kind <> 'direct' or not exists (
        select 1 from public.student_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id)
           or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
      )
    )
  order by c.updated_at desc;
$$;

drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  attachment_url text, attachment_path text, attachment_mime text, edited_at timestamptz, deleted_at timestamptz,
  reply_to_id uuid, reply_body text, reply_sender_id uuid
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    max(receipt.read_at) filter (where receipt.user_id <> m.sender_id) as read_at,
    m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at,
    m.reply_to_id, reply.body, reply.sender_id
  from public.messages m
  left join public.message_reads receipt on receipt.message_id = m.id
  left join public.messages reply on reply.id = m.reply_to_id
  where public.is_mtu_account()
    and m.conversation_id = p_conversation_id
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid())
    and not exists (
      select 1 from public.conversations c
      join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
      join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id) or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
      where c.id = p_conversation_id and c.kind = 'direct'
    )
  group by m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at, m.reply_to_id, reply.body, reply.sender_id
  order by m.created_at asc;
$$;

create or replace function public.list_mtu_message_interactions(p_conversation_id uuid)
returns table (message_id uuid, emoji text, reaction_count bigint, reacted_by_me boolean, saved_by_me boolean, pinned_by_me boolean)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select m.id, reaction.emoji, coalesce(reaction.reaction_count, 0), coalesce(reaction.reacted_by_me, false),
    exists (select 1 from public.saved_messages saved where saved.message_id = m.id and saved.user_id = auth.uid()),
    exists (select 1 from public.pinned_messages pin where pin.message_id = m.id and pin.conversation_id = m.conversation_id and pin.pinned_by = auth.uid())
  from public.messages m
  left join lateral (
    select mr.emoji, count(*)::bigint as reaction_count, bool_or(mr.user_id = auth.uid()) as reacted_by_me
    from public.message_reactions mr where mr.message_id = m.id group by mr.emoji
  ) reaction on true
  where m.conversation_id = p_conversation_id and public.is_mtu_account()
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid())
    and not exists (
      select 1 from public.conversations c
      join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
      join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id) or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
      where c.id = p_conversation_id and c.kind = 'direct'
    );
$$;

drop function if exists public.search_mtu_students(text);
create function public.search_mtu_students(p_query text default '')
returns table (
  id uuid, display_name text, student_id text, is_self boolean,
  level text, department text, programme text, avatar_url text,
  bio text, status_text text
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  with requester as (
    select level, programme from public.profiles where id = auth.uid()
  )
  select
    p.id, p.display_name, p.student_id, p.id = auth.uid(),
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'level')::boolean, true) then p.level else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'college')::boolean, true) then p.department else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'programme')::boolean, true) then p.programme else null end,
    p.avatar_url,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'bio')::boolean, true) then p.bio else null end,
    p.status_text
  from public.profiles p cross join requester me
  where public.is_mtu_account()
    and (p.id = auth.uid() or not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = p.id)
         or (block.blocker_id = p.id and block.blocked_id = auth.uid())
    ))
    and (
      lower(trim(coalesce(p.student_id, ''))) = lower(trim(p_query))
      or (p.programme = me.programme and p.level = me.level and (
        nullif(trim(p_query), '') is null
        or p.display_name ilike '%' || trim(p_query) || '%'
        or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
        or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%'
        or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
      ))
    )
  order by (p.id = auth.uid()) desc, p.display_name asc
  limit 48;
$$;

revoke execute on function public.list_mtu_conversations_v2(), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.search_mtu_students(text) from public, anon;
grant execute on function public.list_mtu_conversations_v2(), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.search_mtu_students(text) to authenticated;
