-- Repair permissions for sending text and file messages.
-- Safe to rerun in the Supabase SQL editor.

alter table public.messages enable row level security;

grant select, insert, update on public.messages to authenticated;
grant update on public.conversations to authenticated;

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
on public.messages for insert
to authenticated
with check (
  public.is_mtu_account()
  and sender_id = auth.uid()
  and exists (
    select 1
    from public.conversation_members member
    where member.conversation_id = messages.conversation_id
      and member.user_id = auth.uid()
  )
);

-- Keep only the current reply/attachment-aware RPC signature.
drop function if exists public.send_mtu_message(uuid, text, text, text);
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid);
alter function public.send_mtu_message(uuid, text, text, text, uuid, text) security definer;
grant execute on function public.send_mtu_message(uuid, text, text, text, uuid, text) to authenticated;
