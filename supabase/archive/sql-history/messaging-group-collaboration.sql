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
