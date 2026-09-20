-- CONVO core message interactions: reactions, saved messages, and pins.
-- Run after the existing messaging SQL bundle.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.saved_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

alter table public.message_reactions enable row level security;
alter table public.saved_messages enable row level security;
alter table public.pinned_messages enable row level security;

drop policy if exists "Members can view message reactions" on public.message_reactions;
create policy "Members can view message reactions"
on public.message_reactions for select to authenticated
using (public.is_mtu_account() and exists (
  select 1 from public.messages message
  join public.conversation_members member on member.conversation_id = message.conversation_id
  where message.id = message_reactions.message_id and member.user_id = auth.uid()
));

drop policy if exists "Members manage own message reactions" on public.message_reactions;
create policy "Members manage own message reactions"
on public.message_reactions for all to authenticated
using (user_id = auth.uid() and public.is_mtu_account())
with check (user_id = auth.uid() and public.is_mtu_account() and exists (
  select 1 from public.messages message
  join public.conversation_members member on member.conversation_id = message.conversation_id
  where message.id = message_reactions.message_id and member.user_id = auth.uid()
));

drop policy if exists "Students manage their own saved messages" on public.saved_messages;
create policy "Students manage their own saved messages"
on public.saved_messages for all to authenticated
using (user_id = auth.uid() and public.is_mtu_account())
with check (user_id = auth.uid() and public.is_mtu_account());

drop policy if exists "Members can view pinned messages" on public.pinned_messages;
create policy "Members can view pinned messages"
on public.pinned_messages for select to authenticated
using (public.is_mtu_account() and exists (
  select 1 from public.conversation_members member
  where member.conversation_id = pinned_messages.conversation_id and member.user_id = auth.uid()
));

drop policy if exists "Members can pin messages" on public.pinned_messages;
create policy "Members can pin messages"
on public.pinned_messages for insert to authenticated
with check (pinned_by = auth.uid() and public.is_mtu_account() and exists (
  select 1 from public.conversation_members member
  where member.conversation_id = pinned_messages.conversation_id and member.user_id = auth.uid()
));

drop policy if exists "Pinners can unpin messages" on public.pinned_messages;
create policy "Pinners can unpin messages"
on public.pinned_messages for delete to authenticated
using (pinned_by = auth.uid() and public.is_mtu_account());

create or replace function public.toggle_mtu_message_reaction(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.messages message
    join public.conversation_members member on member.conversation_id = message.conversation_id
    where message.id = p_message_id and member.user_id = auth.uid()
  ) then raise exception 'You cannot react to this message'; end if;
  if exists (select 1 from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji) then
    delete from public.message_reactions where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji;
    return false;
  end if;
  insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, auth.uid(), p_emoji);
  return true;
end;
$$;

create or replace function public.toggle_mtu_saved_message(p_message_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.messages message
    join public.conversation_members member on member.conversation_id = message.conversation_id
    where message.id = p_message_id and member.user_id = auth.uid()
  ) then raise exception 'You cannot save this message'; end if;
  if exists (select 1 from public.saved_messages where user_id = auth.uid() and message_id = p_message_id) then
    delete from public.saved_messages where user_id = auth.uid() and message_id = p_message_id;
    return false;
  end if;
  insert into public.saved_messages (user_id, message_id) values (auth.uid(), p_message_id);
  return true;
end;
$$;

revoke execute on function public.toggle_mtu_message_reaction(uuid, text), public.toggle_mtu_saved_message(uuid) from public, anon;
grant execute on function public.toggle_mtu_message_reaction(uuid, text), public.toggle_mtu_saved_message(uuid) to authenticated;
