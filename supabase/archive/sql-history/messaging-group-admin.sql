-- CONVO group roles and member management.
-- Run after the core messaging, safety, interaction, and reply migrations.
-- All group identity returned here is the public nickname from profiles.display_name.

alter table public.conversation_members add column if not exists group_role text not null default 'member';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_members_group_role_check') then
    alter table public.conversation_members add constraint conversation_members_group_role_check check (group_role in ('owner', 'admin', 'member'));
  end if;
end;
$$;

-- Backfill one owner for existing groups without changing direct-message membership.
with first_group_member as (
  select distinct on (member.conversation_id) member.conversation_id, member.user_id
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  order by member.conversation_id, member.user_id
)
update public.conversation_members member
set group_role = 'owner'
from first_group_member first_member
where member.conversation_id = first_member.conversation_id
  and member.user_id = first_member.user_id
  and not exists (select 1 from public.conversation_members owner_member where owner_member.conversation_id = member.conversation_id and owner_member.group_role = 'owner');

drop function if exists public.create_mtu_group_conversation(text, uuid[]);
create function public.create_mtu_group_conversation(p_title text, p_member_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Only verified MTU students can create groups'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'Group names must be between 2 and 80 characters'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.profiles profile where profile.id = member_id)) then raise exception 'Every group member must have an MTU profile'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests request where request.status = 'accepted' and ((request.requester_id = auth.uid() and request.recipient_id = member_id) or (request.requester_id = member_id and request.recipient_id = auth.uid())))) then raise exception 'Group members must be accepted MTU connections'; end if;
  insert into public.conversations (kind, title) values ('group', trim(p_title)) returning id into result_id;
  insert into public.conversation_members (conversation_id, user_id, group_role) values (result_id, auth.uid(), 'owner');
  insert into public.conversation_members (conversation_id, user_id, group_role)
  select result_id, member_id, 'member' from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid()
  on conflict (conversation_id, user_id) do nothing;
  return result_id;
end;
$$;

create or replace function public.list_mtu_group_members(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, group_role text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select member.user_id, profile.display_name, profile.student_id, member.group_role
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  join public.profiles profile on profile.id = member.user_id
  where member.conversation_id = p_conversation_id
    and public.is_mtu_account()
    and exists (select 1 from public.conversation_members me where me.conversation_id = p_conversation_id and me.user_id = auth.uid())
  order by case member.group_role when 'owner' then 0 when 'admin' then 1 else 2 end, profile.display_name;
$$;

create or replace function public.add_mtu_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare added integer;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members actor join public.conversations conversation on conversation.id = actor.conversation_id and conversation.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner', 'admin')) then raise exception 'Only group owners and admins can add members'; end if;
  if exists (select 1 from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid() and not exists (select 1 from public.connection_requests request where request.status = 'accepted' and ((request.requester_id = auth.uid() and request.recipient_id = member_id) or (request.requester_id = member_id and request.recipient_id = auth.uid())))) then raise exception 'New members must be accepted MTU connections'; end if;
  insert into public.conversation_members (conversation_id, user_id, group_role)
  select p_conversation_id, member_id, 'member' from unnest(coalesce(p_member_ids, '{}')) member_id where member_id <> auth.uid()
  on conflict (conversation_id, user_id) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

create or replace function public.set_mtu_group_member_role(p_conversation_id uuid, p_member_id uuid, p_group_role text)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if p_group_role not in ('admin', 'member') then raise exception 'Choose admin or member'; end if;
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members actor join public.conversations conversation on conversation.id = actor.conversation_id and conversation.kind = 'group' where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role = 'owner') then raise exception 'Only the group owner can change admin roles'; end if;
  update public.conversation_members set group_role = p_group_role where conversation_id = p_conversation_id and user_id = p_member_id and group_role <> 'owner';
  if not found then raise exception 'That member cannot have their role changed'; end if;
  return p_group_role;
end;
$$;

create or replace function public.remove_mtu_group_member(p_conversation_id uuid, p_member_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to manage this group'; end if;
  if not exists (select 1 from public.conversation_members target join public.conversations conversation on conversation.id = target.conversation_id and conversation.kind = 'group' where target.conversation_id = p_conversation_id and target.user_id = p_member_id and target.group_role <> 'owner') then raise exception 'The owner cannot be removed'; end if;
  if p_member_id <> auth.uid() and not exists (select 1 from public.conversation_members actor where actor.conversation_id = p_conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner', 'admin')) then raise exception 'Only owners and admins can remove other members'; end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_member_id;
  return found;
end;
$$;

revoke execute on function public.create_mtu_group_conversation(text, uuid[]), public.list_mtu_group_members(uuid), public.add_mtu_group_members(uuid, uuid[]), public.set_mtu_group_member_role(uuid, uuid, text), public.remove_mtu_group_member(uuid, uuid) from public, anon;
grant execute on function public.create_mtu_group_conversation(text, uuid[]), public.list_mtu_group_members(uuid), public.add_mtu_group_members(uuid, uuid[]), public.set_mtu_group_member_role(uuid, uuid, text), public.remove_mtu_group_member(uuid, uuid) to authenticated;
