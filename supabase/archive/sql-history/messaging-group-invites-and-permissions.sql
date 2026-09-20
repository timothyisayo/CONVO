-- CONVO GROUP INVITES + PERMISSIONS
-- Run this AFTER convo-messaging-live-upgrade.sql in Supabase SQL Editor.
-- Safe to rerun. It adds private group invitations, owner controls, join review,
-- and admins-only posting without exposing message history to non-members.

create table if not exists public.group_permissions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  allow_member_messages boolean not null default true,
  allow_member_invites boolean not null default false,
  require_join_approval boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.group_invites (
  token uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists group_invites_conversation_idx on public.group_invites(conversation_id);

create table if not exists public.group_join_requests (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.group_permissions enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_join_requests enable row level security;

-- RPCs below are the only access path. No raw invite records or pending requests
-- are readable by ordinary members outside the requested operation.
drop policy if exists "No direct group permission access" on public.group_permissions;
create policy "No direct group permission access" on public.group_permissions for select to authenticated using (false);
drop policy if exists "No direct group invite access" on public.group_invites;
create policy "No direct group invite access" on public.group_invites for select to authenticated using (false);
drop policy if exists "Requesters view their join requests" on public.group_join_requests;
create policy "Requesters view their join requests" on public.group_join_requests for select to authenticated using (user_id = auth.uid() and public.is_mtu_account());

-- Ensure every existing group has conservative invite defaults while preserving open posting.
insert into public.group_permissions (conversation_id)
select id from public.conversations where kind = 'group'
on conflict (conversation_id) do nothing;

create or replace function public.get_mtu_group_permissions(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.group_permissions;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this group'; end if;
  insert into public.group_permissions (conversation_id) values (p_conversation_id) on conflict do nothing;
  select * into result from public.group_permissions where conversation_id = p_conversation_id;
  return jsonb_build_object(
    'allow_member_messages', result.allow_member_messages,
    'allow_member_invites', result.allow_member_invites,
    'require_join_approval', result.require_join_approval
  );
end;
$$;

create or replace function public.set_mtu_group_permissions(
  p_conversation_id uuid,
  p_allow_member_messages boolean,
  p_allow_member_invites boolean,
  p_require_join_approval boolean
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.group_permissions;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role = 'owner'
  ) then raise exception 'Only the group owner can change permissions'; end if;
  insert into public.group_permissions (conversation_id, allow_member_messages, allow_member_invites, require_join_approval, updated_by, updated_at)
  values (p_conversation_id, p_allow_member_messages, p_allow_member_invites, p_require_join_approval, auth.uid(), now())
  on conflict (conversation_id) do update set
    allow_member_messages = excluded.allow_member_messages,
    allow_member_invites = excluded.allow_member_invites,
    require_join_approval = excluded.require_join_approval,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into result;
  return jsonb_build_object(
    'allow_member_messages', result.allow_member_messages,
    'allow_member_invites', result.allow_member_invites,
    'require_join_approval', result.require_join_approval
  );
end;
$$;

create or replace function public.create_mtu_group_invite(p_conversation_id uuid)
returns text
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare role_value text; can_invite boolean; invite_token uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in to create an invite'; end if;
  select member.group_role into role_value
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'group'
  where member.conversation_id = p_conversation_id and member.user_id = auth.uid();
  if role_value is null then raise exception 'You are not a member of this group'; end if;
  insert into public.group_permissions (conversation_id) values (p_conversation_id) on conflict do nothing;
  select allow_member_invites into can_invite from public.group_permissions where conversation_id = p_conversation_id;
  if role_value not in ('owner', 'admin') and not can_invite then raise exception 'Only group admins can create invite links'; end if;
  insert into public.group_invites (conversation_id, created_by) values (p_conversation_id, auth.uid()) returning token into invite_token;
  return invite_token::text;
end;
$$;

create or replace function public.join_mtu_group_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare invite_record public.group_invites; permissions public.group_permissions; title_value text;
begin
  if auth.uid() is null or not public.is_mtu_account() then raise exception 'Sign in with your MTU account to open this invitation'; end if;
  select invite.* into invite_record
  from public.group_invites invite join public.conversations conversation on conversation.id = invite.conversation_id and conversation.kind = 'group'
  where invite.token = p_token::uuid and invite.revoked_at is null and invite.expires_at > now();
  if invite_record.token is null then raise exception 'This group invitation has expired or is unavailable'; end if;
  select title into title_value from public.conversations where id = invite_record.conversation_id;
  if exists (select 1 from public.conversation_members where conversation_id = invite_record.conversation_id and user_id = auth.uid()) then
    return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', true, 'pending', false);
  end if;
  insert into public.group_permissions (conversation_id) values (invite_record.conversation_id) on conflict do nothing;
  select * into permissions from public.group_permissions where conversation_id = invite_record.conversation_id;
  if permissions.require_join_approval then
    insert into public.group_join_requests (conversation_id, user_id, status, reviewed_by, reviewed_at)
    values (invite_record.conversation_id, auth.uid(), 'pending', null, null)
    on conflict (conversation_id, user_id) do update set status = 'pending', reviewed_by = null, reviewed_at = null;
    return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', false, 'pending', true);
  end if;
  insert into public.conversation_members (conversation_id, user_id, group_role)
  values (invite_record.conversation_id, auth.uid(), 'member') on conflict do nothing;
  return jsonb_build_object('conversation_id', invite_record.conversation_id, 'group_title', title_value, 'joined', true, 'pending', false);
end;
$$;

create or replace function public.list_mtu_group_join_requests(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, created_at timestamptz)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select request.user_id, profile.display_name, profile.student_id, request.created_at
  from public.group_join_requests request
  join public.conversation_members actor on actor.conversation_id = request.conversation_id and actor.user_id = auth.uid() and actor.group_role in ('owner','admin')
  join public.profiles profile on profile.id = request.user_id
  where request.conversation_id = p_conversation_id and request.status = 'pending' and public.is_mtu_account()
  order by request.created_at asc;
$$;

create or replace function public.review_mtu_group_join_request(p_conversation_id uuid, p_user_id uuid, p_approve boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid() and member.group_role in ('owner','admin')
  ) then raise exception 'Only group admins can review join requests'; end if;
  update public.group_join_requests set status = case when p_approve then 'approved' else 'declined' end, reviewed_by = auth.uid(), reviewed_at = now()
  where conversation_id = p_conversation_id and user_id = p_user_id and status = 'pending';
  if not found then raise exception 'No pending join request was found'; end if;
  if p_approve then insert into public.conversation_members (conversation_id, user_id, group_role) values (p_conversation_id, p_user_id, 'member') on conflict do nothing; end if;
  return p_approve;
end;
$$;

-- Replace the six-argument send function so admins can make announcement-only groups.
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid, text);
create function public.send_mtu_message(
  p_conversation_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_path text default null,
  p_reply_to_id uuid default null,
  p_attachment_mime text default null
)
returns public.messages
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.messages; conversation_kind text; sender_role text; member_messages boolean;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You are not a member of this conversation'; end if;
  select kind into conversation_kind from public.conversations where id = p_conversation_id;
  if conversation_kind = 'group' then
    select group_role into sender_role from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid();
    select coalesce(allow_member_messages, true) into member_messages from public.group_permissions where conversation_id = p_conversation_id;
    if sender_role not in ('owner','admin') and coalesce(member_messages, true) = false then raise exception 'Only group admins can send messages in this group'; end if;
  end if;
  if exists (select 1 from public.conversations c join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid() join public.student_blocks b on (b.blocker_id = auth.uid() and b.blocked_id = other_member.user_id) or (b.blocker_id = other_member.user_id and b.blocked_id = auth.uid()) where c.id = p_conversation_id and c.kind = 'direct') then raise exception 'This conversation is unavailable'; end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then raise exception 'Add a message or attachment before sending'; end if;
  if p_attachment_url is null and p_attachment_mime is not null then raise exception 'Attachment metadata requires an attachment'; end if;
  if p_attachment_mime is not null and p_attachment_mime not in ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime') then raise exception 'This attachment type is not supported'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id,sender_id,body,attachment_url,attachment_path,reply_to_id,attachment_mime)
  values (p_conversation_id,auth.uid(),trim(coalesce(p_body,'')),p_attachment_url,p_attachment_path,p_reply_to_id,p_attachment_mime)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;

revoke execute on function public.get_mtu_group_permissions(uuid), public.set_mtu_group_permissions(uuid,boolean,boolean,boolean), public.create_mtu_group_invite(uuid), public.join_mtu_group_invite(text), public.list_mtu_group_join_requests(uuid), public.review_mtu_group_join_request(uuid,uuid,boolean), public.send_mtu_message(uuid,text,text,text,uuid,text) from public, anon;
grant execute on function public.get_mtu_group_permissions(uuid), public.set_mtu_group_permissions(uuid,boolean,boolean,boolean), public.create_mtu_group_invite(uuid), public.join_mtu_group_invite(text), public.list_mtu_group_join_requests(uuid), public.review_mtu_group_join_request(uuid,uuid,boolean), public.send_mtu_message(uuid,text,text,text,uuid,text) to authenticated;
