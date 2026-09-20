-- CONVO direct conversation name repair.
-- Makes list_mtu_conversations_v2 return the OTHER student's public nickname.

drop function if exists public.list_mtu_conversations_v2();

create function public.list_mtu_conversations_v2()
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
set search_path = pg_catalog, public, auth
as $$
  select
    conversation.id,
    conversation.kind,
    case
      when conversation.kind = 'direct'
        then coalesce(other_profile.display_name, 'MTU connection')
      else coalesce(conversation.title, 'MTU circle')
    end as title,
    conversation.updated_at,
    last_message.body,
    last_message.created_at,
    coalesce((
      select count(*)
      from public.messages unread
      where unread.conversation_id = conversation.id
        and unread.sender_id <> auth.uid()
        and not exists (
          select 1
          from public.message_reads receipt
          where receipt.message_id = unread.id
            and receipt.user_id = auth.uid()
        )
    ), 0) as unread_count
  from public.conversations conversation
  join public.conversation_members me
    on me.conversation_id = conversation.id
    and me.user_id = auth.uid()
  left join lateral (
    select profile.display_name
    from public.conversation_members member
    join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = conversation.id
      and member.user_id <> auth.uid()
    limit 1
  ) other_profile on conversation.kind = 'direct'
  left join lateral (
    select message.body, message.created_at
    from public.messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) last_message on true
  where public.is_mtu_account()
  order by conversation.updated_at desc;
$$;

revoke execute on function public.list_mtu_conversations_v2() from public, anon;
grant execute on function public.list_mtu_conversations_v2() to authenticated;
