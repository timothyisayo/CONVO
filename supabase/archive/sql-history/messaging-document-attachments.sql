-- CONVO bounded document attachments
-- Run after messaging-video-attachments.sql. Safe to rerun.

alter table public.messages drop constraint if exists messages_attachment_mime_check;
alter table public.messages add constraint messages_attachment_mime_check check (
  attachment_mime is null or attachment_mime in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  )
);

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/png','image/jpeg','image/webp','image/gif',
      'video/mp4','video/webm','video/quicktime',
      'application/pdf','text/plain','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip'
    ]
where id = 'message-attachments';

-- Keep the live bucket aligned when an earlier migration narrowed its allowlist.
update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','image/gif',
  'video/mp4','video/webm','video/quicktime',
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]
where id = 'message-attachments';

drop function if exists public.send_mtu_message(uuid, text, text, text, uuid, text);
create or replace function public.send_mtu_message(
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
  if p_attachment_mime is not null and p_attachment_mime not in (
    'image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
    'application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip'
  ) then raise exception 'This attachment type is not supported'; end if;
  if p_reply_to_id is not null and not exists (select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages (conversation_id, sender_id, body, attachment_url, attachment_path, reply_to_id, attachment_mime)
  values (p_conversation_id, auth.uid(), trim(coalesce(p_body, '')), p_attachment_url, p_attachment_path, p_reply_to_id, p_attachment_mime)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;

revoke execute on function public.send_mtu_message(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.send_mtu_message(uuid, text, text, text, uuid, text) to authenticated;
