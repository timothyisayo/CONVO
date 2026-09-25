create or replace function public.create_mtu_call(
  p_conversation_id uuid,
  p_callee_id uuid default null,
  p_call_type text default 'voice',
  p_room_name text default null
)
returns public.mtu_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.mtu_calls;
  callee_policy text;
  conversation_kind text;
begin
  if auth.uid() is null
    or not exists (
      select 1 from public.conversation_members
      where conversation_id = p_conversation_id and user_id = auth.uid()
    ) then
    raise exception 'Invalid caller' using errcode = '42501';
  end if;

  update public.mtu_calls
  set status = 'failed', ended_at = coalesce(ended_at, now())
  where status = 'ringing'
    and created_at < now() - interval '2 minutes';

  select kind into conversation_kind from public.conversations where id = p_conversation_id;
  if conversation_kind = 'group' then
    if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) < 2 then
      raise exception 'A group call needs at least two members' using errcode = '42501';
    end if;
  else
    if p_callee_id is null or p_callee_id = auth.uid()
      or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = p_callee_id) then
      raise exception 'Students are not in this conversation' using errcode = '42501';
    end if;
    select allow_calls into callee_policy from public.mtu_privacy_settings where user_id = p_callee_id;
    if callee_policy = 'nobody' then
      raise exception 'This student is not accepting calls' using errcode = '42501';
    end if;
    if callee_policy = 'connections' and not exists (
      select 1 from public.connection_requests
      where status = 'accepted'
        and ((requester_id = auth.uid() and recipient_id = p_callee_id)
          or (requester_id = p_callee_id and recipient_id = auth.uid()))
    ) then
      raise exception 'Calls are limited to connections' using errcode = '42501';
    end if;
  end if;

  if exists (
    select 1 from public.mtu_call_participants
    where user_id = auth.uid()
      and call_id in (select id from public.mtu_calls where status in ('ringing', 'answered'))
  ) then
    raise exception 'You already have an active call' using errcode = '42501';
  end if;

  insert into public.mtu_calls(conversation_id, caller_id, callee_id, call_type, room_name)
  values (p_conversation_id, auth.uid(), case when conversation_kind = 'group' then null else p_callee_id end, p_call_type, p_room_name)
  returning * into result;

  insert into public.mtu_call_participants(call_id, user_id)
  select result.id, user_id from public.conversation_members where conversation_id = p_conversation_id;
  return result;
end;
$$;

revoke execute on function public.create_mtu_call(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_mtu_call(uuid, uuid, text, text) to authenticated;
