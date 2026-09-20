-- CONVO privacy enforcement for new direct conversations
-- Run after messaging-privacy-settings.sql and the live messaging upgrade. Safe to rerun.

create or replace function public.start_mtu_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result_id uuid;
  recipient_policy text;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_other_user_id then
    raise exception 'Only verified MTU students can start conversations';
  end if;
  if exists (
    select 1 from public.student_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = p_other_user_id)
       or (block.blocker_id = p_other_user_id and block.blocked_id = auth.uid())
  ) then
    raise exception 'This conversation is unavailable';
  end if;
  select coalesce(settings.allow_messages, 'everyone') into recipient_policy
  from public.mtu_privacy_settings settings
  where settings.user_id = p_other_user_id;
  if recipient_policy = 'nobody' then
    raise exception 'This student is not accepting new messages';
  end if;
  if not exists (
    select 1 from public.connection_requests request
    where request.status = 'accepted'
      and ((request.requester_id = auth.uid() and request.recipient_id = p_other_user_id)
        or (request.requester_id = p_other_user_id and request.recipient_id = auth.uid()))
  ) then
    raise exception 'Accept the connection request before messaging this student';
  end if;
  select conversation.id into result_id
  from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (select 1 from public.conversation_members member where member.conversation_id = conversation.id and member.user_id = auth.uid())
    and exists (select 1 from public.conversation_members member where member.conversation_id = conversation.id and member.user_id = p_other_user_id)
    and (select count(*) from public.conversation_members member where member.conversation_id = conversation.id) = 2
  limit 1;
  if result_id is null then
    insert into public.conversations (kind) values ('direct') returning id into result_id;
    insert into public.conversation_members (conversation_id, user_id) values (result_id, auth.uid()), (result_id, p_other_user_id);
  end if;
  return result_id;
end;
$$;

revoke execute on function public.start_mtu_direct_conversation(uuid) from public, anon;
grant execute on function public.start_mtu_direct_conversation(uuid) to authenticated;
