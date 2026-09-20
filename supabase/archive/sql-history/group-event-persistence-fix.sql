-- Keep group events visible until their start time, with explicit cancellation.
create or replace function public.list_mtu_group_events(p_conversation_id uuid)
returns table (id uuid, title text, description text, starts_at timestamptz, location text, created_by uuid, going_count bigint, my_response text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select event.id, event.title, event.description, event.starts_at, event.location, event.created_by,
    (select count(*) from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.response = 'going'),
    (select attendee.response from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.user_id = auth.uid())
  from public.group_events event
  where public.is_mtu_account()
    and event.starts_at > now()
    and exists (select 1 from public.conversation_members member where member.conversation_id = event.conversation_id and member.user_id = auth.uid())
    and event.conversation_id = p_conversation_id
  order by event.starts_at asc;
$$;

create or replace function public.cancel_mtu_group_event(p_event_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare event_conversation_id uuid;
begin
  select conversation_id into event_conversation_id
  from public.group_events
  where id = p_event_id and starts_at > now();
  if event_conversation_id is null then
    raise exception 'This event has already started or does not exist';
  end if;
  if not exists (
    select 1 from public.conversation_members member
    where member.conversation_id = event_conversation_id
      and member.user_id = auth.uid()
      and member.group_role in ('owner', 'admin')
  ) then
    raise exception 'Only group admins can cancel events';
  end if;
  delete from public.group_events where id = p_event_id;
  return true;
end;
$$;

grant execute on function public.list_mtu_group_events(uuid) to authenticated;
grant execute on function public.cancel_mtu_group_event(uuid) to authenticated;
