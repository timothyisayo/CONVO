-- CONVO message replies, interaction reads, and private chat labels.
-- Run after the existing messaging, safety, and interaction SQL scripts.
-- This script is rerun-safe and never exposes legal names or email addresses.

alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
create index if not exists messages_reply_to_id_idx on public.messages(reply_to_id);

create table if not exists public.conversation_member_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  private_label text,
  is_archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_member_preferences_label_length check (private_label is null or char_length(trim(private_label)) between 1 and 80)
);

alter table public.conversation_member_preferences enable row level security;
drop policy if exists "Members manage their own conversation preferences" on public.conversation_member_preferences;
create policy "Members manage their own conversation preferences"
on public.conversation_member_preferences for all to authenticated
using (user_id = auth.uid() and public.is_mtu_account() and exists (
  select 1 from public.conversation_members member
  where member.conversation_id = conversation_member_preferences.conversation_id
    and member.user_id = auth.uid()
))
with check (user_id = auth.uid() and public.is_mtu_account() and exists (
  select 1 from public.conversation_members member
  where member.conversation_id = conversation_member_preferences.conversation_id
    and member.user_id = auth.uid()
));

drop function if exists public.send_mtu_message(uuid, text, text, text);
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid);
create function public.send_mtu_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_path text default null,
  p_reply_to_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result public.messages;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then raise exception 'Add a message or image before sending'; end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id
  ) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path, reply_to_id)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path, p_reply_to_id)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;

drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  attachment_url text,
  attachment_path text,
  edited_at timestamptz,
  deleted_at timestamptz,
  reply_to_id uuid,
  reply_body text,
  reply_sender_id uuid
)
language sql security definer stable set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    max(mr.read_at) filter (where mr.user_id <> m.sender_id) as read_at,
    m.attachment_url, m.attachment_path, m.edited_at, m.deleted_at,
    m.reply_to_id, reply.body, reply.sender_id
  from public.messages m
  left join public.message_reads mr on mr.message_id = m.id
  left join public.messages reply on reply.id = m.reply_to_id
  where public.is_mtu_account()
    and m.conversation_id = p_conversation_id
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid())
  group by m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_path, m.edited_at, m.deleted_at, m.reply_to_id, reply.body, reply.sender_id
  order by m.created_at asc;
$$;

create or replace function public.list_mtu_message_interactions(p_conversation_id uuid)
returns table (message_id uuid, emoji text, reaction_count bigint, reacted_by_me boolean, saved_by_me boolean, pinned_by_me boolean)
language sql security definer stable set search_path = public
as $$
  select m.id, reaction.emoji, coalesce(reaction.reaction_count, 0), coalesce(reaction.reacted_by_me, false),
    exists (select 1 from public.saved_messages save where save.message_id = m.id and save.user_id = auth.uid()),
    exists (select 1 from public.pinned_messages pin where pin.message_id = m.id and pin.conversation_id = m.conversation_id and pin.pinned_by = auth.uid())
  from public.messages m
  left join lateral (
    select mr.emoji, count(*)::bigint as reaction_count, bool_or(mr.user_id = auth.uid()) as reacted_by_me
    from public.message_reactions mr where mr.message_id = m.id group by mr.emoji
  ) reaction on true
  where m.conversation_id = p_conversation_id
    and public.is_mtu_account()
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid());
$$;

create or replace function public.toggle_mtu_pinned_message(p_conversation_id uuid, p_message_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) or not exists (select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id) then raise exception 'You cannot pin this message'; end if;
  if exists (select 1 from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid()) then
    delete from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid(); return false;
  end if;
  insert into public.pinned_messages (conversation_id, message_id, pinned_by) values (p_conversation_id, p_message_id, auth.uid()); return true;
end;
$$;

create or replace function public.set_mtu_conversation_preference(p_conversation_id uuid, p_private_label text default null, p_is_archived boolean default false)
returns public.conversation_member_preferences
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.conversation_member_preferences;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You cannot update this conversation'; end if;
  insert into public.conversation_member_preferences (conversation_id, user_id, private_label, is_archived, updated_at)
  values (p_conversation_id, auth.uid(), nullif(trim(p_private_label), ''), p_is_archived, now())
  on conflict (conversation_id, user_id) do update set private_label = excluded.private_label, is_archived = excluded.is_archived, updated_at = now()
  returning * into result;
  return result;
end;
$$;

drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table (id uuid, kind text, title text, counterpart_id uuid, updated_at timestamptz, last_message text, last_message_at timestamptz, unread_count bigint)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select c.id, c.kind,
    coalesce(preference.private_label, case when c.kind = 'direct' then coalesce(other_member.display_name, 'MTU connection') else c.title end) as title,
    other_member.user_id as counterpart_id,
    c.updated_at, last_message.body, last_message.created_at,
    coalesce((select count(*) from public.messages unread where unread.conversation_id = c.id and unread.sender_id <> auth.uid() and not exists (select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())), 0) as unread_count
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.conversation_member_preferences preference on preference.conversation_id = c.id and preference.user_id = auth.uid()
  left join lateral (
    select member.user_id, profile.display_name from public.conversation_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = c.id and member.user_id <> auth.uid() limit 1
  ) other_member on c.kind = 'direct'
  left join lateral (select message.body, message.created_at from public.messages message where message.conversation_id = c.id order by message.created_at desc limit 1) last_message on true
  where public.is_mtu_account() and coalesce(preference.is_archived, false) = false
  order by c.updated_at desc;
$$;

revoke execute on function public.send_mtu_message(uuid, text, text, text, uuid), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.toggle_mtu_pinned_message(uuid, uuid), public.set_mtu_conversation_preference(uuid, text, boolean), public.list_mtu_conversations_v2() from public, anon;
grant execute on function public.send_mtu_message(uuid, text, text, text, uuid), public.list_mtu_messages(uuid), public.list_mtu_message_interactions(uuid), public.toggle_mtu_pinned_message(uuid, uuid), public.set_mtu_conversation_preference(uuid, text, boolean), public.list_mtu_conversations_v2() to authenticated;
