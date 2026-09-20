create table if not exists public.mtu_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('voice','video')),
  room_name text not null unique,
  status text not null default 'ringing' check (status in ('ringing','answered','declined','ended','failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration integer,
  created_at timestamptz not null default now()
);
create index if not exists mtu_calls_participants_idx on public.mtu_calls(caller_id, callee_id, created_at desc);
alter table public.mtu_calls enable row level security;
drop policy if exists mtu_calls_participants on public.mtu_calls;
create policy mtu_calls_participants on public.mtu_calls for select to authenticated using (auth.uid() in (caller_id, callee_id));

drop function if exists public.create_mtu_call(uuid, uuid, text, text);
create or replace function public.create_mtu_call(p_conversation_id uuid, p_callee_id uuid, p_call_type text, p_room_name text)
returns public.mtu_calls language plpgsql security definer set search_path = public as $$
declare result public.mtu_calls; callee_policy text;
begin
  if auth.uid() is null or p_callee_id = auth.uid() then raise exception 'Invalid caller' using errcode = '42501'; end if;
  if not exists (select 1 from conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) or not exists (select 1 from conversation_members where conversation_id = p_conversation_id and user_id = p_callee_id) then raise exception 'Students are not in this conversation' using errcode = '42501'; end if;
  select coalesce(allow_calls, 'everyone') into callee_policy from mtu_privacy_settings where user_id = p_callee_id;
  if callee_policy = 'nobody' then raise exception 'This student is not accepting calls' using errcode = '42501'; end if;
  if callee_policy = 'connections' and not exists (select 1 from connection_requests where status = 'accepted' and ((requester_id = auth.uid() and recipient_id = p_callee_id) or (requester_id = p_callee_id and recipient_id = auth.uid()))) then raise exception 'Calls are limited to connections' using errcode = '42501'; end if;
  if exists (select 1 from mtu_calls where caller_id = auth.uid() and status in ('ringing','answered')) or exists (select 1 from mtu_calls where callee_id = auth.uid() and status in ('ringing','answered')) then raise exception 'You already have an active call' using errcode = '42501'; end if;
  insert into mtu_calls(conversation_id, caller_id, callee_id, call_type, room_name) values (p_conversation_id, auth.uid(), p_callee_id, p_call_type, p_room_name) returning * into result;
  return result;
end; $$;
grant execute on function public.create_mtu_call(uuid, uuid, text, text) to authenticated;

drop function if exists public.update_mtu_call_status(uuid, text);
create or replace function public.update_mtu_call_status(p_call_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare caller uuid; callee uuid; current_status text;
begin
  if p_status not in ('ringing','answered','declined','ended','failed') then raise exception 'Invalid call status' using errcode = '22023'; end if;
  select caller_id, callee_id, status into caller, callee, current_status from mtu_calls where id = p_call_id;
  if auth.uid() not in (caller, callee) then raise exception 'Not a call participant' using errcode = '42501'; end if;
  if not ((current_status = 'ringing' and p_status in ('answered','declined','ended','failed')) or (current_status = 'answered' and p_status in ('ended','failed')) or current_status = p_status) then raise exception 'Invalid call status transition' using errcode = '42501'; end if;
  update mtu_calls set status = p_status, answered_at = case when p_status = 'answered' then coalesce(answered_at, now()) else answered_at end, ended_at = case when p_status in ('ended','declined','failed') then coalesce(ended_at, now()) else ended_at end, duration = case when p_status = 'ended' and answered_at is not null then greatest(0, extract(epoch from (now() - answered_at))::integer) else duration end where id = p_call_id;
  return true;
end; $$;
grant execute on function public.update_mtu_call_status(uuid, text) to authenticated;

-- Private conversation attachments: apply this section in the same migration.
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do update set public = false;
drop policy if exists "message attachments read" on storage.objects;
create policy "message attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'message-attachments' and exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.attachment_path = storage.objects.name and cm.user_id = auth.uid()
  )
);
drop policy if exists "message attachments upload" on storage.objects;
create policy "message attachments upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "message attachments delete" on storage.objects;
create policy "message attachments delete" on storage.objects for delete to authenticated using (
  bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text
);
