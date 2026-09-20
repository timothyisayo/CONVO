-- MTU Campus Universe: required group/event/community database repair
-- Run in Supabase SQL Editor after the project base messaging migrations are installed.
-- Order: community utilities -> collaboration/events -> full-scope repair.
-- Safe to rerun where the source migrations are marked rerun-safe.

-- ===== messaging-community-utilities.sql =====
-- CONVO COMMUNITY MESSAGING UTILITIES
-- Run AFTER convo-messaging-live-upgrade.sql and messaging-group-invites-and-permissions.sql.
-- Safe to rerun. All raw tables are closed behind SECURITY DEFINER RPCs.
-- This migration adds: group polls, group tasks, saved-message retrieval, per-chat mute,
-- private invite rotation/revocation, and scoped in-thread message search.

alter table public.conversation_member_preferences
  add column if not exists muted_until timestamptz;

create table if not exists public.group_polls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 240),
  closes_at timestamptz,
  anonymous_voters boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.group_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.group_polls(id) on delete cascade,
  position smallint not null check (position between 1 and 8),
  label text not null check (char_length(trim(label)) between 1 and 100),
  unique (poll_id, position)
);

create table if not exists public.group_poll_votes (
  poll_id uuid not null references public.group_polls(id) on delete cascade,
  option_id uuid not null references public.group_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_polls_conversation_idx on public.group_polls(conversation_id, created_at desc);
create index if not exists group_poll_options_poll_idx on public.group_poll_options(poll_id, position);
create index if not exists group_poll_votes_poll_idx on public.group_poll_votes(poll_id, option_id);
create index if not exists group_tasks_conversation_idx on public.group_tasks(conversation_id, completed_at, due_at);
create index if not exists saved_messages_user_idx on public.saved_messages(user_id, created_at desc);
create index if not exists messages_conversation_body_idx on public.messages(conversation_id, created_at desc);

alter table public.group_polls enable row level security;
alter table public.group_poll_options enable row level security;
alter table public.group_poll_votes enable row level security;
alter table public.group_tasks enable row level security;

drop policy if exists "No direct Convo poll access" on public.group_polls;
create policy "No direct Convo poll access" on public.group_polls for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo poll option access" on public.group_poll_options;
create policy "No direct Convo poll option access" on public.group_poll_options for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo poll vote access" on public.group_poll_votes;
create policy "No direct Convo poll vote access" on public.group_poll_votes for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo task access" on public.group_tasks;
create policy "No direct Convo task access" on public.group_tasks for all to authenticated using (false) with check (false);

create or replace function public.get_mtu_conversation_notification_preference(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare muted_value timestamptz;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  select muted_until into muted_value from public.conversation_member_preferences
  where conversation_id = p_conversation_id and user_id = auth.uid();
  return jsonb_build_object(
    'muted_until', case when muted_value = 'infinity'::timestamptz then null else muted_value end,
    'is_muted', muted_value is not null and muted_value > now()
  );
end;
$$;

create or replace function public.set_mtu_conversation_notification_preference(
  p_conversation_id uuid,
  p_muted boolean,
  p_muted_until timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare muted_value timestamptz;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if p_muted and p_muted_until is not null and p_muted_until <= now() then
    raise exception 'Choose a future mute time';
  end if;
  muted_value := case when p_muted then coalesce(p_muted_until, 'infinity'::timestamptz) else null end;
  insert into public.conversation_member_preferences (conversation_id, user_id, muted_until)
  values (p_conversation_id, auth.uid(), muted_value)
  on conflict (conversation_id, user_id) do update set muted_until = excluded.muted_until;
  return jsonb_build_object('muted_until', case when muted_value = 'infinity'::timestamptz then null else muted_value end, 'is_muted', p_muted);
end;
$$;

create or replace function public.list_mtu_saved_messages(p_limit integer default 100)
returns table (
  message_id uuid, conversation_id uuid, conversation_title text, sender_id uuid,
  sender_display_name text, body text, created_at timestamptz,
  attachment_url text, attachment_mime text
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select m.id, m.conversation_id,
    coalesce(pref.private_label, case when c.kind = 'direct' then coalesce(other_profile.display_name, 'MTU connection') else c.title end),
    m.sender_id, coalesce(sender_profile.display_name, 'MTU connection'), m.body, m.created_at,
    m.attachment_url, m.attachment_mime
  from public.saved_messages saved
  join public.messages m on m.id = saved.message_id and m.deleted_at is null
  join public.conversations c on c.id = m.conversation_id
  join public.conversation_members member on member.conversation_id = c.id and member.user_id = auth.uid()
  left join public.conversation_member_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid()
  left join lateral (
    select profile.display_name from public.conversation_members counterpart
    join public.profiles profile on profile.id = counterpart.user_id
    where counterpart.conversation_id = c.id and counterpart.user_id <> auth.uid() limit 1
  ) other_profile on c.kind = 'direct'
  left join public.profiles sender_profile on sender_profile.id = m.sender_id
  where saved.user_id = auth.uid() and public.is_mtu_account()
    and not exists (
      select 1 from public.conversations direct_conversation
      join public.conversation_members counterpart on counterpart.conversation_id = direct_conversation.id and counterpart.user_id <> auth.uid()
      join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = counterpart.user_id) or (block.blocker_id = counterpart.user_id and block.blocked_id = auth.uid())
      where direct_conversation.id = c.id and direct_conversation.kind = 'direct'
    )
  order by saved.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

create or replace function public.search_mtu_conversation_messages(p_conversation_id uuid, p_query text)
returns table (
  id uuid, sender_id uuid, sender_display_name text, body text, created_at timestamptz,
  attachment_url text, attachment_mime text, reply_to_id uuid
)
language plpgsql security definer stable set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or char_length(trim(coalesce(p_query, ''))) < 2 then
    raise exception 'Enter at least two characters to search this conversation';
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'You are not a member of this conversation';
  end if;
  if exists (
    select 1 from public.conversations c
    join public.conversation_members counterpart on counterpart.conversation_id = c.id and counterpart.user_id <> auth.uid()
    join public.student_blocks block on (block.blocker_id = auth.uid() and block.blocked_id = counterpart.user_id) or (block.blocker_id = counterpart.user_id and block.blocked_id = auth.uid())
    where c.id = p_conversation_id and c.kind = 'direct'
  ) then raise exception 'This conversation is unavailable'; end if;
  return query
    select m.id, m.sender_id, coalesce(profile.display_name, 'MTU connection'), m.body, m.created_at,
      m.attachment_url, m.attachment_mime, m.reply_to_id
    from public.messages m
    left join public.profiles profile on profile.id = m.sender_id
    where m.conversation_id = p_conversation_id and m.deleted_at is null
      and m.body ilike '%' || trim(p_query) || '%'
    order by m.created_at desc
    limit 60;
end;
$$;

create or replace function public.create_mtu_group_poll(
  p_conversation_id uuid,
  p_question text,
  p_options text[],
  p_closes_at timestamptz default null,
  p_anonymous_voters boolean default false
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; member_messages boolean; message_record public.messages; poll_record public.group_polls; option_text text; option_position integer := 0;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create a poll'; end if;
  select member.group_role into role_value from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  select coalesce(permissions.allow_member_messages, true) into member_messages from public.group_permissions permissions where permissions.conversation_id = p_conversation_id;
  if role_value not in ('owner','admin') and coalesce(member_messages, true) = false then raise exception 'Only group admins can create polls in this group'; end if;
  if char_length(trim(coalesce(p_question, ''))) not between 1 and 240 then raise exception 'A poll question must be between 1 and 240 characters'; end if;
  if coalesce(array_length(p_options, 1), 0) < 2 or coalesce(array_length(p_options, 1), 0) > 8 then raise exception 'A poll needs between 2 and 8 options'; end if;
  if exists (select 1 from unnest(p_options) option_value where char_length(trim(coalesce(option_value, ''))) not between 1 and 100) then raise exception 'Each poll option must be between 1 and 100 characters'; end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'Choose a future poll deadline'; end if;
  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, auth.uid(), 'Poll: ' || trim(p_question)) returning * into message_record;
  insert into public.group_polls (conversation_id, message_id, created_by, question, closes_at, anonymous_voters)
  values (p_conversation_id, message_record.id, auth.uid(), trim(p_question), p_closes_at, coalesce(p_anonymous_voters, false)) returning * into poll_record;
  foreach option_text in array p_options loop
    option_position := option_position + 1;
    insert into public.group_poll_options (poll_id, position, label) values (poll_record.id, option_position, trim(option_text));
  end loop;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return jsonb_build_object('poll_id', poll_record.id, 'message_id', message_record.id);
end;
$$;

create or replace function public.list_mtu_group_polls(p_conversation_id uuid)
returns table (
  poll_id uuid, message_id uuid, question text, closes_at timestamptz, is_closed boolean,
  anonymous_voters boolean, created_by uuid, option_id uuid, option_label text,
  option_position smallint, vote_count bigint, selected_by_me boolean
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select poll.id, poll.message_id, poll.question, poll.closes_at,
    poll.closes_at is not null and poll.closes_at <= now(), poll.anonymous_voters, poll.created_by,
    option_row.id, option_row.label, option_row.position,
    count(vote.user_id)::bigint, coalesce(bool_or(vote.user_id = auth.uid()), false)
  from public.group_polls poll
  join public.conversations conversation on conversation.id = poll.conversation_id and conversation.kind = 'group'
  join public.conversation_members member on member.conversation_id = poll.conversation_id and member.user_id = auth.uid()
  join public.group_poll_options option_row on option_row.poll_id = poll.id
  left join public.group_poll_votes vote on vote.poll_id = poll.id and vote.option_id = option_row.id
  where poll.conversation_id = p_conversation_id and public.is_mtu_account()
  group by poll.id, poll.message_id, poll.question, poll.closes_at, poll.anonymous_voters, poll.created_by, option_row.id, option_row.label, option_row.position
  order by poll.created_at desc, option_row.position asc;
$$;

create or replace function public.cast_mtu_group_poll_vote(p_poll_id uuid, p_option_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare poll_record public.group_polls;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to vote'; end if;
  select * into poll_record from public.group_polls where id = p_poll_id;
  if poll_record.id is null then raise exception 'This poll is unavailable'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = poll_record.conversation_id and user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  if poll_record.closes_at is not null and poll_record.closes_at <= now() then raise exception 'Voting has closed'; end if;
  if not exists (select 1 from public.group_poll_options where id = p_option_id and poll_id = p_poll_id) then raise exception 'That option does not belong to this poll'; end if;
  delete from public.group_poll_votes where poll_id = p_poll_id and user_id = auth.uid();
  insert into public.group_poll_votes (poll_id, option_id, user_id) values (p_poll_id, p_option_id, auth.uid());
  return jsonb_build_object('poll_id', p_poll_id, 'option_id', p_option_id);
end;
$$;

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
  select member.group_role into role_value from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'A task must be between 1 and 240 characters'; end if;
  if p_due_at is not null and p_due_at <= now() then raise exception 'Choose a future task deadline'; end if;
  if p_assignee_id is not null and not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = p_assignee_id) then raise exception 'Assign tasks only to current group members'; end if;
  insert into public.group_tasks (conversation_id, created_by, assignee_id, title, due_at)
  values (p_conversation_id, auth.uid(), p_assignee_id, trim(p_title), p_due_at) returning id into task_id;
  return task_id;
end;
$$;

create or replace function public.list_mtu_group_tasks(p_conversation_id uuid)
returns table (
  task_id uuid, title text, due_at timestamptz, completed_at timestamptz,
  created_by uuid, assignee_id uuid, assignee_display_name text, completed_by uuid, created_at timestamptz
)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select task.id, task.title, task.due_at, task.completed_at, task.created_by, task.assignee_id,
    assignee.display_name, task.completed_by, task.created_at
  from public.group_tasks task
  join public.conversations conversation on conversation.id = task.conversation_id and conversation.kind = 'group'
  join public.conversation_members member on member.conversation_id = task.conversation_id and member.user_id = auth.uid()
  left join public.profiles assignee on assignee.id = task.assignee_id
  where task.conversation_id = p_conversation_id and public.is_mtu_account()
  order by task.completed_at nulls first, task.due_at nulls last, task.created_at desc;
$$;

create or replace function public.set_mtu_group_task_completed(p_task_id uuid, p_completed boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare task_record public.group_tasks; role_value text;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to update a task'; end if;
  select * into task_record from public.group_tasks where id = p_task_id;
  if task_record.id is null then raise exception 'This task is unavailable'; end if;
  select group_role into role_value from public.conversation_members where conversation_id = task_record.conversation_id and user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  if role_value not in ('owner','admin') and task_record.created_by <> auth.uid() and coalesce(task_record.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() then
    raise exception 'Only the assignee, creator, or a group admin can complete this task';
  end if;
  update public.group_tasks
  set completed_at = case when p_completed then now() else null end,
      completed_by = case when p_completed then auth.uid() else null end,
      updated_at = now()
  where id = p_task_id;
  return p_completed;
end;
$$;

create or replace function public.revoke_mtu_group_invite(p_conversation_id uuid, p_token text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can revoke invitation links'; end if;
  update public.group_invites set revoked_at = now()
  where conversation_id = p_conversation_id and token = p_token::uuid and revoked_at is null;
  return found;
end;
$$;

create or replace function public.rotate_mtu_group_invite(p_conversation_id uuid)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare token_value uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can rotate invitation links'; end if;
  update public.group_invites set revoked_at = now() where conversation_id = p_conversation_id and revoked_at is null;
  insert into public.group_invites (conversation_id, created_by) values (p_conversation_id, auth.uid()) returning token into token_value;
  return token_value::text;
end;
$$;

revoke execute on function public.get_mtu_conversation_notification_preference(uuid), public.set_mtu_conversation_notification_preference(uuid,boolean,timestamptz), public.list_mtu_saved_messages(integer), public.search_mtu_conversation_messages(uuid,text), public.create_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.list_mtu_group_polls(uuid), public.cast_mtu_group_poll_vote(uuid,uuid), public.create_mtu_group_task(uuid,text,uuid,timestamptz), public.list_mtu_group_tasks(uuid), public.set_mtu_group_task_completed(uuid,boolean), public.revoke_mtu_group_invite(uuid,text), public.rotate_mtu_group_invite(uuid) from public, anon;
grant execute on function public.get_mtu_conversation_notification_preference(uuid), public.set_mtu_conversation_notification_preference(uuid,boolean,timestamptz), public.list_mtu_saved_messages(integer), public.search_mtu_conversation_messages(uuid,text), public.create_mtu_group_poll(uuid,text,text[],timestamptz,boolean), public.list_mtu_group_polls(uuid), public.cast_mtu_group_poll_vote(uuid,uuid), public.create_mtu_group_task(uuid,text,uuid,timestamptz), public.list_mtu_group_tasks(uuid), public.set_mtu_group_task_completed(uuid,boolean), public.revoke_mtu_group_invite(uuid,text), public.rotate_mtu_group_invite(uuid) to authenticated;

-- ===== messaging-group-collaboration.sql =====
-- CONVO group collaboration extensions
-- Run after messaging-community-utilities.sql.
-- Safe to rerun. Tables are private and all access is through member-checked RPCs.

create table if not exists public.group_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 240),
  created_at timestamptz not null default now()
);

create table if not exists public.group_event_attendees (
  event_id uuid not null references public.group_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  response text not null default 'going' check (response in ('going','maybe','declined')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null default '' check (char_length(body) <= 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > publish_at)
);

create index if not exists group_events_conversation_idx on public.group_events(conversation_id, starts_at);
create index if not exists group_event_attendees_event_idx on public.group_event_attendees(event_id, response);
create index if not exists group_notes_conversation_idx on public.group_notes(conversation_id, updated_at desc);
create index if not exists group_announcements_conversation_idx on public.group_announcements(conversation_id, publish_at desc);

alter table public.group_events enable row level security;
alter table public.group_event_attendees enable row level security;
alter table public.group_notes enable row level security;
alter table public.group_announcements enable row level security;

drop policy if exists "No direct Convo event access" on public.group_events;
create policy "No direct Convo event access" on public.group_events for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo event attendee access" on public.group_event_attendees;
create policy "No direct Convo event attendee access" on public.group_event_attendees for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo note access" on public.group_notes;
create policy "No direct Convo note access" on public.group_notes for all to authenticated using (false) with check (false);
drop policy if exists "No direct Convo announcement access" on public.group_announcements;
create policy "No direct Convo announcement access" on public.group_announcements for all to authenticated using (false) with check (false);

create or replace function public.create_mtu_group_event(
  p_conversation_id uuid,
  p_title text,
  p_description text default '',
  p_starts_at timestamptz default null,
  p_location text default ''
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create an event'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a future event time'; end if;
  if not exists (select 1 from public.conversation_members member join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group' where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can create events'; end if;
  insert into public.group_events(conversation_id, created_by, title, description, starts_at, location)
  values (p_conversation_id, auth.uid(), trim(p_title), trim(coalesce(p_description,'')), p_starts_at, trim(coalesce(p_location,''))) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.list_mtu_group_events(p_conversation_id uuid)
returns table (id uuid, title text, description text, starts_at timestamptz, location text, created_by uuid, going_count bigint, my_response text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select event.id, event.title, event.description, event.starts_at, event.location, event.created_by,
    (select count(*) from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.response = 'going'),
    (select attendee.response from public.group_event_attendees attendee where attendee.event_id = event.id and attendee.user_id = auth.uid())
  from public.group_events event
  where public.is_mtu_account() and exists (select 1 from public.conversation_members member where member.conversation_id = event.conversation_id and member.user_id = auth.uid())
    and event.conversation_id = p_conversation_id
  order by event.starts_at asc;
$$;

create or replace function public.set_mtu_group_event_response(p_event_id uuid, p_response text)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare conversation_id_value uuid;
begin
  if p_response not in ('going','maybe','declined') then raise exception 'Choose going, maybe, or declined'; end if;
  select event.conversation_id into conversation_id_value from public.group_events event where event.id = p_event_id;
  if conversation_id_value is null or not exists (select 1 from public.conversation_members member where member.conversation_id = conversation_id_value and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_event_attendees(event_id, user_id, response) values (p_event_id, auth.uid(), p_response)
  on conflict (event_id, user_id) do update set response = excluded.response, updated_at = now();
  return p_response;
end;
$$;

create or replace function public.create_mtu_group_note(p_conversation_id uuid, p_title text, p_body text default '')
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group' where member.conversation_id = p_conversation_id and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_notes(conversation_id, created_by, updated_by, title, body) values (p_conversation_id, auth.uid(), auth.uid(), trim(p_title), coalesce(p_body,'')) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.update_mtu_group_note(p_note_id uuid, p_title text, p_body text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare conversation_id_value uuid;
begin
  select note.conversation_id into conversation_id_value from public.group_notes note where note.id = p_note_id;
  if conversation_id_value is null or not exists (select 1 from public.conversation_members member where member.conversation_id = conversation_id_value and member.user_id = auth.uid()) then raise exception 'You are not a member of this group'; end if;
  if not exists (select 1 from public.group_notes note where note.id = p_note_id and (note.created_by = auth.uid() or exists (select 1 from public.conversation_members member where member.conversation_id = note.conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')))) then raise exception 'Only the note author or a group admin can edit this note'; end if;
  update public.group_notes set title = trim(p_title), body = p_body, updated_by = auth.uid(), updated_at = now() where id = p_note_id;
  return found;
end;
$$;

create or replace function public.list_mtu_group_notes(p_conversation_id uuid)
returns table (id uuid, title text, body text, created_by uuid, updated_by uuid, created_at timestamptz, updated_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select note.id, note.title, note.body, note.created_by, note.updated_by, note.created_at, note.updated_at from public.group_notes note
  where public.is_mtu_account() and note.conversation_id = p_conversation_id and exists (select 1 from public.conversation_members member where member.conversation_id = note.conversation_id and member.user_id = auth.uid())
  order by note.updated_at desc;
$$;

create or replace function public.create_mtu_group_announcement(p_conversation_id uuid, p_title text, p_body text, p_expires_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can publish announcements'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Announcement expiry must be in the future'; end if;
  insert into public.group_announcements(conversation_id, created_by, title, body, expires_at) values (p_conversation_id, auth.uid(), trim(p_title), trim(p_body), p_expires_at) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.list_mtu_group_announcements(p_conversation_id uuid)
returns table (id uuid, title text, body text, created_by uuid, publish_at timestamptz, expires_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select announcement.id, announcement.title, announcement.body, announcement.created_by, announcement.publish_at, announcement.expires_at from public.group_announcements announcement
  where public.is_mtu_account() and announcement.conversation_id = p_conversation_id and announcement.publish_at <= now() and (announcement.expires_at is null or announcement.expires_at > now()) and exists (select 1 from public.conversation_members member where member.conversation_id = announcement.conversation_id and member.user_id = auth.uid())
  order by announcement.publish_at desc;
$$;

revoke execute on function public.create_mtu_group_event(uuid,text,text,timestamptz,text), public.list_mtu_group_events(uuid), public.set_mtu_group_event_response(uuid,text), public.create_mtu_group_note(uuid,text,text), public.update_mtu_group_note(uuid,text,text), public.list_mtu_group_notes(uuid), public.create_mtu_group_announcement(uuid,text,text,timestamptz), public.list_mtu_group_announcements(uuid) from public, anon;
grant execute on function public.create_mtu_group_event(uuid,text,text,timestamptz,text), public.list_mtu_group_events(uuid), public.set_mtu_group_event_response(uuid,text), public.create_mtu_group_note(uuid,text,text), public.update_mtu_group_note(uuid,text,text), public.list_mtu_group_notes(uuid), public.create_mtu_group_announcement(uuid,text,text,timestamptz), public.list_mtu_group_announcements(uuid) to authenticated;

-- ===== convo-full-scope-repair.sql =====
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
