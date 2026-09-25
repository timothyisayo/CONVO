drop function if exists public.list_mtu_conversations_v3();

create function public.list_mtu_conversations_v3()
returns table(
  id uuid, kind text, title text, counterpart_id uuid, counterpart_avatar_url text,
  group_image_url text, group_category text, ended_at timestamptz,
  counterpart_last_seen_at timestamptz, updated_at timestamptz, last_message text,
  last_message_at timestamptz, unread_count bigint, is_pinned boolean,
  is_archived boolean, muted_until timestamptz, draft_body text,
  is_marked_unread boolean
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select conversation.id, conversation.kind,
    coalesce(preference.private_label, case when conversation.kind = 'direct' then coalesce(other_member.display_name, 'MTU connection') else conversation.title end),
    other_member.user_id, other_member.avatar_url, conversation.group_image_url,
    conversation.group_category, conversation.ended_at, other_member.last_seen_at,
    conversation.updated_at, last_message.body, last_message.created_at,
    coalesce((select count(*) from public.messages unread
      where unread.conversation_id = conversation.id
        and unread.sender_id <> auth.uid()
        and unread.delivery_state <> 'blocked'
        and not exists (
          select 1 from public.message_reads receipt
          where receipt.message_id = unread.id and receipt.user_id = auth.uid()
        )), 0),
    coalesce(preference.is_pinned, false), coalesce(preference.is_archived, false),
    preference.muted_until, preference.draft_body,
    coalesce(preference.is_marked_unread, false)
  from public.conversations conversation
  join public.conversation_members me
    on me.conversation_id = conversation.id and me.user_id = auth.uid()
  left join public.conversation_member_preferences preference
    on preference.conversation_id = conversation.id and preference.user_id = auth.uid()
  left join lateral (
    select member.user_id, profile.display_name, profile.avatar_url, profile.last_seen_at
    from public.conversation_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = conversation.id and member.user_id <> auth.uid()
    limit 1
  ) other_member on conversation.kind = 'direct'
  left join lateral (
    select message.body, message.created_at
    from public.messages message
    where message.conversation_id = conversation.id
      and (message.delivery_state <> 'blocked' or message.sender_id = auth.uid())
    order by message.created_at desc
    limit 1
  ) last_message on true
  where public.is_mtu_account()
  order by coalesce(preference.is_pinned, false) desc, conversation.updated_at desc;
$$;

revoke execute on function public.list_mtu_conversations_v3() from public, anon;
grant execute on function public.list_mtu_conversations_v3() to authenticated;
