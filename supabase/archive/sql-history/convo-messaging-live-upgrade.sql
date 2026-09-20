-- CONVO LIVE MESSAGING UPGRADE
-- Paste this entire script into Supabase Dashboard -> SQL Editor and click Run ONCE.
-- Prerequisite: the original Convo messaging foundation (conversations, conversation_members,
-- messages, message_reads, connection_requests, profiles, is_mtu_account) already exists.
-- Do NOT call the RPC functions manually in SQL Editor: they require a signed-in student auth.uid().
-- This script is safe to rerun. It only exposes public nickname/student ID, never legal name or email.

-- 1) Connection-request public identity.
drop function if exists public.list_mtu_connection_requests();
create function public.list_mtu_connection_requests()
returns table (id uuid, requester_id uuid, recipient_id uuid, status text, direction text, updated_at timestamptz, requester_display_name text, requester_student_id text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select r.id, r.requester_id, r.recipient_id, r.status,
    case when r.requester_id = auth.uid() then 'sent' else 'received' end,
    r.updated_at, p.display_name, p.student_id
  from public.connection_requests r
  left join public.profiles p on p.id = r.requester_id
  where r.requester_id = auth.uid() or r.recipient_id = auth.uid()
  order by r.updated_at desc;
$$;
revoke execute on function public.list_mtu_connection_requests() from public, anon;
grant execute on function public.list_mtu_connection_requests() to authenticated;

-- 2) Direct-chat safety: block and report are private to the reporter/blocker.
create table if not exists public.student_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create table if not exists public.student_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 600),
  created_at timestamptz not null default now(), check (reporter_id <> reported_id)
);
alter table public.student_blocks enable row level security;
alter table public.student_reports enable row level security;
drop policy if exists "Students manage their own blocks" on public.student_blocks;
create policy "Students manage their own blocks" on public.student_blocks for all to authenticated
  using (blocker_id = auth.uid() and public.is_mtu_account())
  with check (blocker_id = auth.uid() and public.is_mtu_account());
drop policy if exists "Students create own reports" on public.student_reports;
create policy "Students create own reports" on public.student_reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_mtu_account());

create or replace function public.block_mtu_student(p_student_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then raise exception 'Only verified MTU students can block another student'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then raise exception 'Student profile not found'; end if;
  insert into public.student_blocks (blocker_id, blocked_id) values (auth.uid(), p_student_id) on conflict do nothing;
  update public.connection_requests set status = 'blocked', updated_at = now()
  where (requester_id = auth.uid() and recipient_id = p_student_id) or (requester_id = p_student_id and recipient_id = auth.uid());
  return true;
end;
$$;
create or replace function public.report_mtu_student(p_student_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare report_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then raise exception 'Only verified MTU students can submit this report'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then raise exception 'Student profile not found'; end if;
  insert into public.student_reports (reporter_id, reported_id, reason) values (auth.uid(), p_student_id, trim(p_reason)) returning id into report_id;
  return report_id;
end;
$$;
create or replace function public.start_mtu_direct_conversation(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_other_user_id then raise exception 'Only verified MTU students can start conversations'; end if;
  if exists (select 1 from public.student_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p_other_user_id) or (b.blocker_id = p_other_user_id and b.blocked_id = auth.uid())) then raise exception 'This conversation is unavailable'; end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then raise exception 'Student profile not found'; end if;
  if not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = p_other_user_id) or (r.requester_id = p_other_user_id and r.recipient_id = auth.uid()))) then raise exception 'Accept the connection request before messaging this student'; end if;
  select c.id into result_id from public.conversations c where c.kind = 'direct'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other_user_id)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2 limit 1;
  if result_id is null then
    insert into public.conversations (kind) values ('direct') returning id into result_id;
    insert into public.conversation_members (conversation_id, user_id) values (result_id, auth.uid()), (result_id, p_other_user_id);
  end if;
  return result_id;
end;
$$;

-- 3) Reactions, saved messages, pins, replies, private labels, and bounded media metadata.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(), primary key (message_id, user_id, emoji)
);
create table if not exists public.saved_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, message_id)
);
create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (conversation_id, message_id)
);
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists attachment_mime text;
create index if not exists messages_reply_to_id_idx on public.messages(reply_to_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachment_mime_check') then
    alter table public.messages add constraint messages_attachment_mime_check check (attachment_mime is null or attachment_mime in ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime'));
  end if;
end $$;
create table if not exists public.conversation_member_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  private_label text, is_archived boolean not null default false, updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id), constraint conversation_member_preferences_label_length check (private_label is null or char_length(trim(private_label)) between 1 and 80)
);
alter table public.message_reactions enable row level security;
alter table public.saved_messages enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.conversation_member_preferences enable row level security;
drop policy if exists "Members can view message reactions" on public.message_reactions;
create policy "Members can view message reactions" on public.message_reactions for select to authenticated using (public.is_mtu_account() and exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = message_reactions.message_id and cm.user_id = auth.uid()));
drop policy if exists "Members manage own message reactions" on public.message_reactions;
create policy "Members manage own message reactions" on public.message_reactions for all to authenticated using (user_id = auth.uid() and public.is_mtu_account()) with check (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = message_reactions.message_id and cm.user_id = auth.uid()));
drop policy if exists "Students manage their own saved messages" on public.saved_messages;
create policy "Students manage their own saved messages" on public.saved_messages for all to authenticated using (user_id = auth.uid() and public.is_mtu_account()) with check (user_id = auth.uid() and public.is_mtu_account());
drop policy if exists "Members can view pinned messages" on public.pinned_messages;
create policy "Members can view pinned messages" on public.pinned_messages for select to authenticated using (public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = pinned_messages.conversation_id and cm.user_id = auth.uid()));
drop policy if exists "Members can pin messages" on public.pinned_messages;
create policy "Members can pin messages" on public.pinned_messages for insert to authenticated with check (pinned_by = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = pinned_messages.conversation_id and cm.user_id = auth.uid()));
drop policy if exists "Pinners can unpin messages" on public.pinned_messages;
create policy "Pinners can unpin messages" on public.pinned_messages for delete to authenticated using (pinned_by = auth.uid() and public.is_mtu_account());
drop policy if exists "Members manage their own conversation preferences" on public.conversation_member_preferences;
create policy "Members manage their own conversation preferences" on public.conversation_member_preferences for all to authenticated using (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_member_preferences.conversation_id and cm.user_id = auth.uid())) with check (user_id = auth.uid() and public.is_mtu_account() and exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_member_preferences.conversation_id and cm.user_id = auth.uid()));

create or replace function public.toggle_mtu_message_reaction(p_message_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = p_message_id and cm.user_id = auth.uid()) then raise exception 'You cannot react to this message'; end if;
  if exists (select 1 from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji) then delete from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji; return false; end if;
  insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, auth.uid(), p_emoji); return true;
end $$;
create or replace function public.toggle_mtu_saved_message(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id where m.id = p_message_id and cm.user_id = auth.uid()) then raise exception 'You cannot save this message'; end if;
  if exists (select 1 from public.saved_messages where user_id = auth.uid() and message_id = p_message_id) then delete from public.saved_messages where user_id = auth.uid() and message_id = p_message_id; return false; end if;
  insert into public.saved_messages (user_id, message_id) values (auth.uid(), p_message_id); return true;
end $$;
create or replace function public.toggle_mtu_pinned_message(p_conversation_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) or not exists (select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id) then raise exception 'You cannot pin this message'; end if;
  if exists (select 1 from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid()) then delete from public.pinned_messages where conversation_id = p_conversation_id and message_id = p_message_id and pinned_by = auth.uid(); return false; end if;
  insert into public.pinned_messages (conversation_id, message_id, pinned_by) values (p_conversation_id, p_message_id, auth.uid()); return true;
end $$;
create or replace function public.set_mtu_conversation_preference(p_conversation_id uuid, p_private_label text default null, p_is_archived boolean default false)
returns public.conversation_member_preferences language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare result public.conversation_member_preferences; begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You cannot update this conversation'; end if;
  insert into public.conversation_member_preferences (conversation_id, user_id, private_label, is_archived, updated_at) values (p_conversation_id, auth.uid(), nullif(trim(p_private_label), ''), p_is_archived, now()) on conflict (conversation_id, user_id) do update set private_label = excluded.private_label, is_archived = excluded.is_archived, updated_at = now() returning * into result; return result;
end $$;

-- 4) Group ownership, selected members, administrators, and @mention membership source.
alter table public.conversation_members add column if not exists group_role text not null default 'member';
do $$ begin if not exists (select 1 from pg_constraint where conname = 'conversation_members_group_role_check') then alter table public.conversation_members add constraint conversation_members_group_role_check check (group_role in ('owner','admin','member')); end if; end $$;
with first_group_member as (
  select distinct on (cm.conversation_id) cm.conversation_id, cm.user_id from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id and c.kind = 'group' order by cm.conversation_id, cm.user_id
)
update public.conversation_members cm set group_role = 'owner' from first_group_member first_member where cm.conversation_id = first_member.conversation_id and cm.user_id = first_member.user_id and not exists (select 1 from public.conversation_members owner_member where owner_member.conversation_id = cm.conversation_id and owner_member.group_role = 'owner');
drop function if exists public.create_mtu_group_conversation(text, uuid[]);
create function public.create_mtu_group_conversation(p_title text, p_member_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare result_id uuid; begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Only verified MTU students can create groups'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 2 and 80 then raise exception 'Group names must be between 2 and 80 characters'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.profiles p where p.id = member_id)) then raise exception 'Every group member must have an MTU profile'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = member_id) or (r.requester_id = member_id and r.recipient_id = auth.uid())))) then raise exception 'Group members must be accepted MTU connections'; end if;
  insert into public.conversations (kind,title) values ('group',trim(p_title)) returning id into result_id;
  insert into public.conversation_members (conversation_id,user_id,group_role) values (result_id,auth.uid(),'owner');
  insert into public.conversation_members (conversation_id,user_id,group_role) select result_id,member_id,'member' from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() on conflict (conversation_id,user_id) do nothing;
  return result_id;
end $$;
create or replace function public.list_mtu_group_members(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, group_role text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$ select cm.user_id,p.display_name,p.student_id,cm.group_role from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id and c.kind = 'group' join public.profiles p on p.id = cm.user_id where cm.conversation_id = p_conversation_id and public.is_mtu_account() and exists (select 1 from public.conversation_members me where me.conversation_id = p_conversation_id and me.user_id = auth.uid()) order by case cm.group_role when 'owner' then 0 when 'admin' then 1 else 2 end,p.display_name $$;
create or replace function public.add_mtu_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare added integer; begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members actor join public.conversations c on c.id = actor.conversation_id and c.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner','admin')) then raise exception 'Only group owners and admins can add members'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = member_id) or (r.requester_id = member_id and r.recipient_id = auth.uid())))) then raise exception 'New members must be accepted MTU connections'; end if;
  insert into public.conversation_members (conversation_id,user_id,group_role) select p_conversation_id,member_id,'member' from unnest(coalesce(p_member_ids,'{}')) member_id where member_id <> auth.uid() on conflict (conversation_id,user_id) do nothing; get diagnostics added = row_count; return added;
end $$;
create or replace function public.set_mtu_group_member_role(p_conversation_id uuid,p_member_id uuid,p_group_role text)
returns text language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if p_group_role not in ('admin','member') then raise exception 'Choose admin or member'; end if;
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members actor join public.conversations c on c.id = actor.conversation_id and c.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role = 'owner') then raise exception 'Only the group owner can change admin roles'; end if;
  update public.conversation_members set group_role = p_group_role where conversation_id = p_conversation_id and user_id = p_member_id and group_role <> 'owner'; if not found then raise exception 'That member cannot have their role changed'; end if; return p_group_role;
end $$;
create or replace function public.remove_mtu_group_member(p_conversation_id uuid,p_member_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to manage this group'; end if;
  if not exists (select 1 from public.conversation_members target join public.conversations c on c.id = target.conversation_id and c.kind = 'group' where target.conversation_id = p_conversation_id and target.user_id = p_member_id and target.group_role <> 'owner') then raise exception 'The owner cannot be removed'; end if;
  if p_member_id <> auth.uid() and not exists (select 1 from public.conversation_members actor where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner','admin')) then raise exception 'Only owners and admins can remove other members'; end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_member_id; return found;
end $$;

-- 5) Final live message/send/list contracts. This version retains safety checks AND reply/video support.
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime'] where id = 'message-attachments';
drop function if exists public.send_mtu_message(uuid,text,text,text);
drop function if exists public.send_mtu_message(uuid,text,text,text,uuid);
drop function if exists public.send_mtu_message(uuid,text,text,text,uuid,text);
create function public.send_mtu_message(p_conversation_id uuid,p_body text,p_attachment_url text default null,p_attachment_path text default null,p_reply_to_id uuid default null,p_attachment_mime text default null)
returns public.messages language plpgsql security definer set search_path = pg_catalog, public, auth
as $$ declare result public.messages; begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You are not a member of this conversation'; end if;
  if exists (select 1 from public.conversations c join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid() join public.student_blocks b on (b.blocker_id = auth.uid() and b.blocked_id = other_member.user_id) or (b.blocker_id = other_member.user_id and b.blocked_id = auth.uid()) where c.id = p_conversation_id and c.kind = 'direct') then raise exception 'This conversation is unavailable'; end if;
  if char_length(trim(coalesce(p_body,''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body,''))) = 0 and p_attachment_url is null then raise exception 'Add a message or attachment before sending'; end if;
  if p_attachment_url is null and p_attachment_mime is not null then raise exception 'Attachment metadata requires an attachment'; end if;
  if p_attachment_mime is not null and p_attachment_mime not in ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime') then raise exception 'This attachment type is not supported'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id,sender_id,body,attachment_url,attachment_path,reply_to_id,attachment_mime) values (p_conversation_id,auth.uid(),trim(coalesce(p_body,'')),p_attachment_url,p_attachment_path,p_reply_to_id,p_attachment_mime) returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id; return result;
end $$;
drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table (id uuid,conversation_id uuid,sender_id uuid,body text,created_at timestamptz,read_at timestamptz,attachment_url text,attachment_path text,attachment_mime text,edited_at timestamptz,deleted_at timestamptz,reply_to_id uuid,reply_body text,reply_sender_id uuid)
language sql security definer stable set search_path = public
as $$ select m.id,m.conversation_id,m.sender_id,m.body,m.created_at,max(mr.read_at) filter (where mr.user_id <> m.sender_id),m.attachment_url,m.attachment_path,m.attachment_mime,m.edited_at,m.deleted_at,m.reply_to_id,reply.body,reply.sender_id from public.messages m left join public.message_reads mr on mr.message_id = m.id left join public.messages reply on reply.id = m.reply_to_id where public.is_mtu_account() and m.conversation_id = p_conversation_id and exists (select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()) group by m.id,m.conversation_id,m.sender_id,m.body,m.created_at,m.attachment_url,m.attachment_path,m.attachment_mime,m.edited_at,m.deleted_at,m.reply_to_id,reply.body,reply.sender_id order by m.created_at asc $$;
create or replace function public.list_mtu_message_interactions(p_conversation_id uuid)
returns table (message_id uuid,emoji text,reaction_count bigint,reacted_by_me boolean,saved_by_me boolean,pinned_by_me boolean)
language sql security definer stable set search_path = public
as $$ select m.id,reaction.emoji,coalesce(reaction.reaction_count,0),coalesce(reaction.reacted_by_me,false),exists(select 1 from public.saved_messages s where s.message_id = m.id and s.user_id = auth.uid()),exists(select 1 from public.pinned_messages p where p.message_id = m.id and p.conversation_id = m.conversation_id and p.pinned_by = auth.uid()) from public.messages m left join lateral (select mr.emoji,count(*)::bigint reaction_count,bool_or(mr.user_id = auth.uid()) reacted_by_me from public.message_reactions mr where mr.message_id = m.id group by mr.emoji) reaction on true where m.conversation_id = p_conversation_id and public.is_mtu_account() and exists(select 1 from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id = auth.uid()) $$;
drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table (id uuid,kind text,title text,counterpart_id uuid,updated_at timestamptz,last_message text,last_message_at timestamptz,unread_count bigint)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$ select c.id,c.kind,coalesce(pref.private_label,case when c.kind = 'direct' then coalesce(other_member.display_name,'MTU connection') else c.title end),other_member.user_id,c.updated_at,last_message.body,last_message.created_at,coalesce((select count(*) from public.messages unread where unread.conversation_id = c.id and unread.sender_id <> auth.uid() and not exists(select 1 from public.message_reads receipt where receipt.message_id = unread.id and receipt.user_id = auth.uid())),0) from public.conversations c join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid() left join public.conversation_member_preferences pref on pref.conversation_id = c.id and pref.user_id = auth.uid() left join lateral (select cm.user_id,p.display_name from public.conversation_members cm left join public.profiles p on p.id = cm.user_id where cm.conversation_id = c.id and cm.user_id <> auth.uid() limit 1) other_member on c.kind = 'direct' left join lateral (select m.body,m.created_at from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1) last_message on true where public.is_mtu_account() and coalesce(pref.is_archived,false) = false order by c.updated_at desc $$;

-- 6) Lock down execution to signed-in MTU sessions only.
revoke execute on function public.block_mtu_student(uuid),public.report_mtu_student(uuid,text),public.start_mtu_direct_conversation(uuid),public.send_mtu_message(uuid,text,text,text,uuid,text),public.list_mtu_messages(uuid),public.list_mtu_message_interactions(uuid),public.toggle_mtu_message_reaction(uuid,text),public.toggle_mtu_saved_message(uuid),public.toggle_mtu_pinned_message(uuid,uuid),public.set_mtu_conversation_preference(uuid,text,boolean),public.list_mtu_conversations_v2(),public.create_mtu_group_conversation(text,uuid[]),public.list_mtu_group_members(uuid),public.add_mtu_group_members(uuid,uuid[]),public.set_mtu_group_member_role(uuid,uuid,text),public.remove_mtu_group_member(uuid,uuid) from public,anon;
grant execute on function public.block_mtu_student(uuid),public.report_mtu_student(uuid,text),public.start_mtu_direct_conversation(uuid),public.send_mtu_message(uuid,text,text,text,uuid,text),public.list_mtu_messages(uuid),public.list_mtu_message_interactions(uuid),public.toggle_mtu_message_reaction(uuid,text),public.toggle_mtu_saved_message(uuid),public.toggle_mtu_pinned_message(uuid,uuid),public.set_mtu_conversation_preference(uuid,text,boolean),public.list_mtu_conversations_v2(),public.create_mtu_group_conversation(text,uuid[]),public.list_mtu_group_members(uuid),public.add_mtu_group_members(uuid,uuid[]),public.set_mtu_group_member_role(uuid,uuid,text),public.remove_mtu_group_member(uuid,uuid) to authenticated;
