create table if not exists public.mtu_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  notification_type text not null check (notification_type in ('message','connection','group','call','poll','task','event','announcement')),
  title text not null,
  body text not null default '',
  conversation_id uuid references public.conversations(id) on delete cascade,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists mtu_notifications_recipient_created_idx
  on public.mtu_notifications (recipient_id, created_at desc);
create index if not exists mtu_notifications_unread_idx
  on public.mtu_notifications (recipient_id, read_at)
  where read_at is null;

alter table public.mtu_notifications enable row level security;
drop policy if exists "Users can read their notifications" on public.mtu_notifications;
create policy "Users can read their notifications"
  on public.mtu_notifications for select to authenticated
  using (recipient_id = auth.uid());
drop policy if exists "Users can update their notifications" on public.mtu_notifications;
create policy "Users can update their notifications"
  on public.mtu_notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
drop policy if exists "Users can delete their notifications" on public.mtu_notifications;
create policy "Users can delete their notifications"
  on public.mtu_notifications for delete to authenticated
  using (recipient_id = auth.uid());

create or replace function public.notify_mtu_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.mtu_notifications (
    recipient_id, actor_id, notification_type, title, body,
    conversation_id, entity_id, payload
  )
  select cm.user_id, new.sender_id, 'message',
    coalesce(p.display_name, 'New message'),
    case when nullif(trim(new.body), '') is null then 'Sent an attachment' else left(new.body, 280) end,
    new.conversation_id, new.id,
    jsonb_build_object('message_id', new.id, 'sender_id', new.sender_id)
  from public.conversation_members cm
  left join public.profiles p on p.id = new.sender_id
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists messages_create_mtu_notification on public.messages;
create trigger messages_create_mtu_notification
  after insert on public.messages
  for each row execute function public.notify_mtu_message();

create or replace function public.notify_mtu_connection_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'pending' then
    insert into public.mtu_notifications (recipient_id, actor_id, notification_type, title, body, entity_id, payload)
    select new.recipient_id, new.requester_id, 'connection',
      coalesce(p.display_name, 'An MTU student') || ' wants to connect',
      'Connection request',
      new.id, jsonb_build_object('request_id', new.id)
    from public.profiles p
    where p.id = new.requester_id;
  end if;
  return new;
end;
$$;
drop trigger if exists connection_requests_create_mtu_notification on public.connection_requests;
create trigger connection_requests_create_mtu_notification
  after insert on public.connection_requests
  for each row execute function public.notify_mtu_connection_request();

create or replace function public.notify_mtu_group_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  row_data jsonb := to_jsonb(new);
  target_conversation_id uuid := nullif(row_data->>'conversation_id', '')::uuid;
  actor_user_id uuid := nullif(coalesce(row_data->>'created_by', row_data->>'created_by_id'), '')::uuid;
  target_entity_id uuid := nullif(row_data->>'id', '')::uuid;
  activity_type text := case tg_table_name
    when 'group_polls' then 'poll'
    when 'group_tasks' then 'task'
    when 'group_events' then 'event'
    else 'announcement'
  end;
  activity_title text := case tg_table_name
    when 'group_polls' then 'New group poll'
    when 'group_tasks' then 'New group task'
    when 'group_events' then 'New group event'
    else 'New group announcement'
  end;
  activity_body text := coalesce(row_data->>'question', row_data->>'title', 'New group activity');
begin
  -- Membership is evaluated from the authoritative group conversation.
  insert into public.mtu_notifications (recipient_id, actor_id, notification_type, title, body, conversation_id, entity_id, payload)
  select cm.user_id, actor_user_id, activity_type, activity_title, left(activity_body, 280), target_conversation_id, target_entity_id, row_data
  from public.conversation_members cm
  where cm.conversation_id = target_conversation_id and cm.user_id <> actor_user_id;
  return new;
end;
$$;

drop trigger if exists group_polls_create_mtu_notification on public.group_polls;
create trigger group_polls_create_mtu_notification after insert on public.group_polls for each row execute function public.notify_mtu_group_activity();
drop trigger if exists group_tasks_create_mtu_notification on public.group_tasks;
create trigger group_tasks_create_mtu_notification after insert on public.group_tasks for each row execute function public.notify_mtu_group_activity();
drop trigger if exists group_events_create_mtu_notification on public.group_events;
create trigger group_events_create_mtu_notification after insert on public.group_events for each row execute function public.notify_mtu_group_activity();
drop trigger if exists group_announcements_create_mtu_notification on public.group_announcements;
create trigger group_announcements_create_mtu_notification after insert on public.group_announcements for each row execute function public.notify_mtu_group_activity();

create or replace function public.notify_mtu_call()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.mtu_notifications (recipient_id, actor_id, notification_type, title, body, conversation_id, entity_id, payload)
  select cm.user_id, new.caller_id, 'call', 'Incoming Convo call', initcap(new.call_type) || ' call', new.conversation_id, new.id, jsonb_build_object('call_id', new.id, 'call_type', new.call_type)
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.caller_id
    and (new.callee_id is null or cm.user_id = new.callee_id);
  return new;
end;
$$;
drop trigger if exists mtu_calls_create_mtu_notification on public.mtu_calls;
create trigger mtu_calls_create_mtu_notification after insert on public.mtu_calls for each row execute function public.notify_mtu_call();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mtu_notifications'
    ) then
    alter publication supabase_realtime add table public.mtu_notifications;
  end if;
end $$;

grant select, update, delete on public.mtu_notifications to authenticated;
revoke all on public.mtu_notifications from anon;
