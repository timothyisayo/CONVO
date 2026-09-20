-- Remove legacy send_mtu_message overloads that conflict with the current
-- reply and attachment-metadata function.
-- Safe to rerun in the Supabase SQL editor.

drop function if exists public.send_mtu_message(uuid, text, text, text);
drop function if exists public.send_mtu_message(uuid, text, text, text, uuid);

grant execute on function public.send_mtu_message(uuid, text, text, text, uuid, text) to authenticated;
