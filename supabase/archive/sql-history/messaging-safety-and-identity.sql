-- CONVO direct-message safety and identity update.
-- Run in Supabase Dashboard → SQL Editor after the existing messaging setup.

create table if not exists public.student_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.student_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 600),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

alter table public.student_blocks enable row level security;
alter table public.student_reports enable row level security;

drop policy if exists "Students manage their own blocks" on public.student_blocks;
create policy "Students manage their own blocks"
on public.student_blocks for all to authenticated
using (blocker_id = auth.uid() and public.is_mtu_account())
with check (blocker_id = auth.uid() and public.is_mtu_account());

drop policy if exists "Students create own reports" on public.student_reports;
create policy "Students create own reports"
on public.student_reports for insert to authenticated
with check (reporter_id = auth.uid() and public.is_mtu_account());

create or replace function public.block_mtu_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can block another student';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Student profile not found';
  end if;

  insert into public.student_blocks (blocker_id, blocked_id)
  values (auth.uid(), p_student_id)
  on conflict do nothing;

  update public.connection_requests
  set status = 'blocked', updated_at = now()
  where (requester_id = auth.uid() and recipient_id = p_student_id)
     or (requester_id = p_student_id and recipient_id = auth.uid());
  return true;
end;
$$;

create or replace function public.report_mtu_student(p_student_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare report_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can submit this report';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'Student profile not found';
  end if;
  insert into public.student_reports (reporter_id, reported_id, reason)
  values (auth.uid(), p_student_id, trim(p_reason))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.start_mtu_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result_id uuid;
begin
  if not public.is_mtu_account() or auth.uid() is null or auth.uid() = p_other_user_id then
    raise exception 'Only verified MTU students can start conversations';
  end if;
  if exists (select 1 from public.student_blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p_other_user_id) or (b.blocker_id = p_other_user_id and b.blocked_id = auth.uid())) then
    raise exception 'This conversation is unavailable';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'Student profile not found';
  end if;
  if not exists (select 1 from public.connection_requests r where r.status = 'accepted' and ((r.requester_id = auth.uid() and r.recipient_id = p_other_user_id) or (r.requester_id = p_other_user_id and r.recipient_id = auth.uid()))) then
    raise exception 'Accept the connection request before messaging this student';
  end if;
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

create or replace function public.send_mtu_message(p_conversation_id uuid, p_body text, p_attachment_url text default null, p_attachment_path text default null)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result public.messages;
begin
  if not public.is_mtu_account() or auth.uid() is null or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then
    raise exception 'You are not a member of this conversation';
  end if;
  if exists (
    select 1 from public.conversations c
    join public.conversation_members other_member on other_member.conversation_id = c.id and other_member.user_id <> auth.uid()
    join public.student_blocks b on (b.blocker_id = auth.uid() and b.blocked_id = other_member.user_id) or (b.blocker_id = other_member.user_id and b.blocked_id = auth.uid())
    where c.id = p_conversation_id and c.kind = 'direct'
  ) then
    raise exception 'This conversation is unavailable';
  end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then raise exception 'Add a message or image before sending'; end if;
  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;

revoke execute on function public.block_mtu_student(uuid), public.report_mtu_student(uuid, text) from public, anon;
grant execute on function public.block_mtu_student(uuid), public.report_mtu_student(uuid), public.start_mtu_direct_conversation(uuid), public.send_mtu_message(uuid, text, text, text) to authenticated;

drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table (
  id uuid,
  kind text,
  title text,
  updated_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    c.id,
    c.kind,
    case
      when c.kind = 'direct' then coalesce(other_profile.display_name, 'MTU connection')
      else c.title
    end as title,
    c.updated_at,
    last_message.body,
    last_message.created_at,
    coalesce((
      select count(*) from public.messages unread
      where unread.conversation_id = c.id
        and unread.sender_id <> auth.uid()
        and not exists (
          select 1 from public.message_reads receipt
          where receipt.message_id = unread.id and receipt.user_id = auth.uid()
        )
    ), 0) as unread_count
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select profile.display_name
    from public.conversation_members member
    join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = c.id and member.user_id <> auth.uid()
    limit 1
  ) other_profile on c.kind = 'direct'
  left join lateral (
    select message.body, message.created_at
    from public.messages message
    where message.conversation_id = c.id
    order by message.created_at desc
    limit 1
  ) last_message on true
  where public.is_mtu_account()
  order by c.updated_at desc;
$$;

revoke execute on function public.list_mtu_conversations_v2() from public, anon;
grant execute on function public.list_mtu_conversations_v2() to authenticated;
