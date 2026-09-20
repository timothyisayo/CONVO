-- Allow a sender to create a signed URL immediately after upload.
-- The message row does not exist until after the upload completes.
-- Safe to rerun in the Supabase SQL editor.

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do update set public = false;

grant select, insert on storage.objects to authenticated;

drop policy if exists "message attachments read" on storage.objects;
create policy "message attachments read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'message-attachments'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.messages message
      join public.conversation_members member
        on member.conversation_id = message.conversation_id
      where message.attachment_path = storage.objects.name
        and member.user_id = auth.uid()
    )
  )
);

drop policy if exists "message attachments upload" on storage.objects;
create policy "message attachments upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'message-attachments'
  and public.is_mtu_account()
  and (storage.foldername(name))[1] = auth.uid()::text
);
