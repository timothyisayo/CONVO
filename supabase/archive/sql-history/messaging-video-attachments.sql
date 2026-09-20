-- CONVO supported video-message extension.
-- Run after messaging-replies-and-labels.sql.
-- Supports stored MP4, WebM, and MOV attachments up to 25 MB; calls remain provider-gated.

alter table public.messages add column if not exists attachment_mime text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachment_mime_check') then
    alter table public.messages add constraint messages_attachment_mime_check check (
      attachment_mime is null or attachment_mime in (
        'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime'
      )
    );
  end if;
end;
$$;

-- Existing projects should already have this bucket. This changes only its media limits.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
where id = 'message-attachments';

drop function if exists public.send_mtu_message(uuid, text, text, text, uuid);
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
declare result public.messages;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) then raise exception 'You are not a member of this conversation'; end if;
  if char_length(trim(coalesce(p_body, ''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 and p_attachment_url is null then raise exception 'Add a message or attachment before sending'; end if;
  if p_attachment_url is null and p_attachment_mime is not null then raise exception 'Attachment metadata requires an attachment'; end if;
  if p_attachment_mime is not null and p_attachment_mime not in ('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime') then raise exception 'This attachment type is not supported'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path, reply_to_id, attachment_mime)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path, p_reply_to_id, p_attachment_mime)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;

drop function if exists public.list_mtu_messages(uuid);
create function public.list_mtu_messages(p_conversation_id uuid)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz,
  attachment_url text, attachment_path text, attachment_mime text, edited_at timestamptz, deleted_at timestamptz,
  reply_to_id uuid, reply_body text, reply_sender_id uuid
)
language sql security definer stable set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at,
    max(mr.read_at) filter (where mr.user_id <> m.sender_id) as read_at,
    m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at,
    m.reply_to_id, reply.body, reply.sender_id
  from public.messages m
  left join public.message_reads mr on mr.message_id = m.id
  left join public.messages reply on reply.id = m.reply_to_id
  where public.is_mtu_account() and m.conversation_id = p_conversation_id
    and exists (select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid())
  group by m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.attachment_url, m.attachment_path, m.attachment_mime, m.edited_at, m.deleted_at, m.reply_to_id, reply.body, reply.sender_id
  order by m.created_at asc;
$$;

revoke execute on function public.send_mtu_message(uuid, text, text, text, uuid, text), public.list_mtu_messages(uuid) from public, anon;
grant execute on function public.send_mtu_message(uuid, text, text, text, uuid, text), public.list_mtu_messages(uuid) to authenticated;
