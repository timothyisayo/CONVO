-- CONVO CONVERSATION RAIL STATE
-- Run after convo-messaging-live-upgrade.sql and messaging-block-persistence-fix.sql.
-- Safe to rerun. Keeps rail state private to the authenticated member.

alter table public.conversation_member_preferences
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_marked_unread boolean not null default false,
  add column if not exists draft_body text;

drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table (
  id uuid, kind text, title text, counterpart_id uuid, updated_at timestamptz,
  last_message text, last_message_at timestamptz, unread_count bigint,
  is_pinned boolean, is_archived boolean, muted_until timestamptz, draft_body text, is_marked_unread boolean
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
    case when coalesce(pref.is_marked_unread, false) then greatest(coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id = c.id and unread.sender_id <> auth.uid()
        and not exists (select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())
    ), 0), 1) else coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id = c.id and unread.sender_id <> auth.uid()
        and not exists (select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())
    ), 0) end as unread_count,
    coalesce(pref.is_pinned, false),
    coalesce(pref.is_archived, false),
    pref.muted_until,
    pref.draft_body,
    coalesce(pref.is_marked_unread, false)
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
    and (
      c.kind <> 'direct' or not exists (
        select 1 from public.student_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id)
           or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
      )
    )
  order by coalesce(pref.is_pinned, false) desc, c.updated_at desc;
$$;

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
