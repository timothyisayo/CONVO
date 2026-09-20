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
