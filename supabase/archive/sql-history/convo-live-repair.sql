-- CONVO LIVE REPAIR — AUGUST 2026
-- Paste this entire file into Supabase SQL Editor and click Run.
-- Prerequisite: convo-complete-supabase-setup.sql has already been run.
-- This is rerun-safe and repairs the live RPC/storage contracts used by the
-- current Convo interface. It exposes no legal names or email addresses.

-- 1) Complete attachment contract: image, video, voice, documents and ZIP.
alter table public.messages add column if not exists attachment_mime text;
alter table public.messages drop constraint if exists messages_attachment_mime_check;
alter table public.messages add constraint messages_attachment_mime_check check (
  attachment_mime is null or attachment_mime in (
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments','message-attachments',true,26214400,array[
  'image/png','image/jpeg','image/webp','image/gif',
  'video/mp4','video/webm','video/quicktime',
  'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg',
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]) on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Convo members upload their own attachments" on storage.objects;
create policy "Convo members upload their own attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Convo members update their own attachments" on storage.objects;
create policy "Convo members update their own attachments" on storage.objects for update to authenticated
using (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Convo members delete their own attachments" on storage.objects;
create policy "Convo members delete their own attachments" on storage.objects for delete to authenticated
using (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop function if exists public.send_mtu_message(uuid,text,text,text,uuid,text);
create function public.send_mtu_message(
  p_conversation_id uuid, p_body text, p_attachment_url text default null,
  p_attachment_path text default null, p_reply_to_id uuid default null,
  p_attachment_mime text default null
) returns public.messages
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare result public.messages;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if char_length(trim(coalesce(p_body,''))) > 4000 then raise exception 'Messages must be 4,000 characters or fewer'; end if;
  if char_length(trim(coalesce(p_body,''))) = 0 and p_attachment_url is null then raise exception 'Add a message or attachment before sending'; end if;
  if p_attachment_url is null and p_attachment_mime is not null then raise exception 'Attachment metadata requires an attachment'; end if;
  if p_attachment_mime is not null and p_attachment_mime not in (
    'image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
    'audio/webm','audio/mp4','audio/m4a','audio/ogg','audio/mpeg','application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/zip'
  ) then raise exception 'This attachment type is not supported'; end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_id and conversation_id = p_conversation_id
  ) then raise exception 'Replies must refer to a message in this conversation'; end if;
  insert into public.messages(conversation_id,sender_id,body,attachment_url,attachment_path,reply_to_id,attachment_mime)
  values(p_conversation_id,auth.uid(),trim(coalesce(p_body,'')),p_attachment_url,p_attachment_path,p_reply_to_id,p_attachment_mime)
  returning * into result;
  update public.conversations set updated_at = now() where id = p_conversation_id;
  return result;
end;
$$;
revoke execute on function public.send_mtu_message(uuid,text,text,text,uuid,text) from public, anon;
grant execute on function public.send_mtu_message(uuid,text,text,text,uuid,text) to authenticated;

-- 2) Personal rail state, archive, pin, drafts and unread markers.
alter table public.conversation_member_preferences
  add column if not exists is_pinned boolean not null default false,
  add column if not exists is_marked_unread boolean not null default false,
  add column if not exists draft_body text,
  add column if not exists chat_theme text not null default 'convo',
  add column if not exists wallpaper_variant text not null default 'plain';

drop function if exists public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean);
create function public.set_mtu_conversation_rail_state(
  p_conversation_id uuid, p_pinned boolean default null, p_archived boolean default null,
  p_draft_body text default null, p_mark_unread boolean default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare state_record public.conversation_member_preferences;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this conversation'; end if;
  if p_draft_body is not null and char_length(p_draft_body) > 4000 then raise exception 'Drafts must be 4,000 characters or fewer'; end if;
  insert into public.conversation_member_preferences(conversation_id,user_id,is_pinned,is_archived,draft_body,is_marked_unread)
  values(p_conversation_id,auth.uid(),coalesce(p_pinned,false),coalesce(p_archived,false),p_draft_body,coalesce(p_mark_unread,false))
  on conflict(conversation_id,user_id) do update set
    is_pinned = case when p_pinned is null then public.conversation_member_preferences.is_pinned else p_pinned end,
    is_archived = case when p_archived is null then public.conversation_member_preferences.is_archived else p_archived end,
    draft_body = case when p_draft_body is null then public.conversation_member_preferences.draft_body else p_draft_body end,
    is_marked_unread = case when p_mark_unread is null then public.conversation_member_preferences.is_marked_unread else p_mark_unread end,
    updated_at = now();
  select * into state_record from public.conversation_member_preferences where conversation_id = p_conversation_id and user_id = auth.uid();
  return jsonb_build_object('is_pinned',state_record.is_pinned,'is_archived',state_record.is_archived,'draft_body',state_record.draft_body,'is_marked_unread',state_record.is_marked_unread);
end;
$$;
revoke execute on function public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) from public, anon;
grant execute on function public.set_mtu_conversation_rail_state(uuid,boolean,boolean,text,boolean) to authenticated;

-- Return persisted group artwork during inbox hydration.
drop function if exists public.list_mtu_conversations_v2();
create function public.list_mtu_conversations_v2()
returns table(id uuid,kind text,title text,counterpart_id uuid,group_image_url text,updated_at timestamptz,last_message text,last_message_at timestamptz,unread_count bigint,is_pinned boolean,is_archived boolean,muted_until timestamptz,draft_body text,is_marked_unread boolean)
language sql security definer stable set search_path=pg_catalog,public,auth as $$
  select c.id,c.kind,coalesce(pref.private_label,case when c.kind='direct' then coalesce(other_member.display_name,'MTU connection') else c.title end),other_member.user_id,c.group_image_url,c.updated_at,last_message.body,last_message.created_at,
    case when coalesce(pref.is_marked_unread,false) then greatest(coalesce((select count(*) from public.messages unread where unread.conversation_id=c.id and unread.sender_id<>auth.uid() and not exists(select 1 from public.message_reads receipt where receipt.message_id=unread.id and receipt.user_id=auth.uid())),0),1) else coalesce((select count(*) from public.messages unread where unread.conversation_id=c.id and unread.sender_id<>auth.uid() and not exists(select 1 from public.message_reads receipt where receipt.message_id=unread.id and receipt.user_id=auth.uid())),0) end,
    coalesce(pref.is_pinned,false),coalesce(pref.is_archived,false),pref.muted_until,pref.draft_body,coalesce(pref.is_marked_unread,false)
  from public.conversations c join public.conversation_members me on me.conversation_id=c.id and me.user_id=auth.uid()
  left join public.conversation_member_preferences pref on pref.conversation_id=c.id and pref.user_id=auth.uid()
  left join lateral(select member.user_id,profile.display_name from public.conversation_members member left join public.profiles profile on profile.id=member.user_id where member.conversation_id=c.id and member.user_id<>auth.uid() limit 1) other_member on c.kind='direct'
  left join lateral(select message.body,message.created_at from public.messages message where message.conversation_id=c.id order by message.created_at desc limit 1) last_message on true
  where public.is_mtu_account() and (c.kind<>'direct' or not exists(select 1 from public.student_blocks block where (block.blocker_id=auth.uid() and block.blocked_id=other_member.user_id) or (block.blocker_id=other_member.user_id and block.blocked_id=auth.uid())))
  order by coalesce(pref.is_pinned,false) desc,c.updated_at desc
$$;
revoke execute on function public.list_mtu_conversations_v2() from public,anon;
grant execute on function public.list_mtu_conversations_v2() to authenticated;

create table if not exists public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id,message_id,pinned_by)
);
alter table public.pinned_messages enable row level security;
drop policy if exists "No direct Convo pinned message access" on public.pinned_messages;
create policy "No direct Convo pinned message access" on public.pinned_messages for all to authenticated using(false) with check(false);
create or replace function public.toggle_mtu_pinned_message(p_conversation_id uuid,p_message_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()) or not exists (select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id) then raise exception 'You cannot pin this message'; end if;
  if exists(select 1 from public.pinned_messages where conversation_id=p_conversation_id and message_id=p_message_id and pinned_by=auth.uid()) then
    delete from public.pinned_messages where conversation_id=p_conversation_id and message_id=p_message_id and pinned_by=auth.uid(); return false;
  end if;
  insert into public.pinned_messages(conversation_id,message_id,pinned_by) values(p_conversation_id,p_message_id,auth.uid()); return true;
end;
$$;
revoke execute on function public.toggle_mtu_pinned_message(uuid,uuid) from public, anon;
grant execute on function public.toggle_mtu_pinned_message(uuid,uuid) to authenticated;

-- 3) Per-member chat appearance.
alter table public.conversation_member_preferences drop constraint if exists conversation_member_preferences_chat_theme_check;
alter table public.conversation_member_preferences add constraint conversation_member_preferences_chat_theme_check check(chat_theme in ('convo','cream','peach','sage','lavender','midnight'));
alter table public.conversation_member_preferences drop constraint if exists conversation_member_preferences_wallpaper_variant_check;
alter table public.conversation_member_preferences add constraint conversation_member_preferences_wallpaper_variant_check check(wallpaper_variant in ('plain','organic','campus','gradient'));
create or replace function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table(chat_theme text,wallpaper_variant text) language sql security definer stable set search_path = pg_catalog, public, auth as $$
  select coalesce(pref.chat_theme,'convo'),coalesce(pref.wallpaper_variant,'plain') from (select 1) anchor
  left join public.conversation_member_preferences pref on pref.conversation_id=p_conversation_id and pref.user_id=auth.uid()
  where auth.uid() is not null and public.is_mtu_account() and exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid())
$$;
create or replace function public.set_mtu_conversation_appearance(p_conversation_id uuid,p_chat_theme text,p_wallpaper_variant text)
returns table(chat_theme text,wallpaper_variant text) language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'You cannot change this conversation appearance'; end if;
  if p_chat_theme not in ('convo','cream','peach','sage','lavender','midnight') or p_wallpaper_variant not in ('plain','organic','campus','gradient') then raise exception 'Unsupported appearance option'; end if;
  insert into public.conversation_member_preferences(conversation_id,user_id,chat_theme,wallpaper_variant,updated_at) values(p_conversation_id,auth.uid(),p_chat_theme,p_wallpaper_variant,now())
  on conflict(conversation_id,user_id) do update set chat_theme=excluded.chat_theme,wallpaper_variant=excluded.wallpaper_variant,updated_at=now();
  return query select p_chat_theme,p_wallpaper_variant;
end;
$$;
revoke execute on function public.get_mtu_conversation_appearance(uuid),public.set_mtu_conversation_appearance(uuid,text,text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid),public.set_mtu_conversation_appearance(uuid,text,text) to authenticated;

-- 4) Group notes and announcements.
create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,updated_by uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 1 and 160),body text not null default '' check(char_length(body)<=12000),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,title text not null check(char_length(trim(title)) between 1 and 160),
  body text not null check(char_length(trim(body)) between 1 and 4000),publish_at timestamptz not null default now(),expires_at timestamptz,created_at timestamptz not null default now(),check(expires_at is null or expires_at > publish_at)
);
alter table public.group_notes enable row level security;
alter table public.group_announcements enable row level security;
drop policy if exists "No direct Convo note access" on public.group_notes;
create policy "No direct Convo note access" on public.group_notes for all to authenticated using(false) with check(false);
drop policy if exists "No direct Convo announcement access" on public.group_announcements;
create policy "No direct Convo announcement access" on public.group_announcements for all to authenticated using(false) with check(false);
create or replace function public.create_mtu_group_note(p_conversation_id uuid,p_title text,p_body text default '') returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare result_id uuid; begin
 if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member join public.conversations conversation on conversation.id=member.conversation_id and conversation.kind='group' where member.conversation_id=p_conversation_id and member.user_id=auth.uid()) then raise exception 'You are not a member of this group'; end if;
 insert into public.group_notes(conversation_id,created_by,updated_by,title,body) values(p_conversation_id,auth.uid(),auth.uid(),trim(p_title),coalesce(p_body,'')) returning id into result_id; return result_id;
end; $$;
create or replace function public.list_mtu_group_notes(p_conversation_id uuid) returns table(id uuid,title text,body text,created_by uuid,updated_by uuid,created_at timestamptz,updated_at timestamptz) language sql security definer stable set search_path=pg_catalog,public,auth as $$
 select note.id,note.title,note.body,note.created_by,note.updated_by,note.created_at,note.updated_at from public.group_notes note where public.is_mtu_account() and note.conversation_id=p_conversation_id and exists(select 1 from public.conversation_members member where member.conversation_id=note.conversation_id and member.user_id=auth.uid()) order by note.updated_at desc
$$;
create or replace function public.create_mtu_group_announcement(p_conversation_id uuid,p_title text,p_body text,p_expires_at timestamptz default null) returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare result_id uuid; begin
 if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member where member.conversation_id=p_conversation_id and member.user_id=auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can publish announcements'; end if;
 if p_expires_at is not null and p_expires_at <= now() then raise exception 'Announcement expiry must be in the future'; end if;
 insert into public.group_announcements(conversation_id,created_by,title,body,expires_at) values(p_conversation_id,auth.uid(),trim(p_title),trim(p_body),p_expires_at) returning id into result_id; return result_id;
end; $$;
create or replace function public.list_mtu_group_announcements(p_conversation_id uuid) returns table(id uuid,title text,body text,created_by uuid,publish_at timestamptz,expires_at timestamptz) language sql security definer stable set search_path=pg_catalog,public,auth as $$
 select announcement.id,announcement.title,announcement.body,announcement.created_by,announcement.publish_at,announcement.expires_at from public.group_announcements announcement where public.is_mtu_account() and announcement.conversation_id=p_conversation_id and announcement.publish_at<=now() and (announcement.expires_at is null or announcement.expires_at>now()) and exists(select 1 from public.conversation_members member where member.conversation_id=announcement.conversation_id and member.user_id=auth.uid()) order by announcement.publish_at desc
$$;
revoke execute on function public.create_mtu_group_note(uuid,text,text),public.list_mtu_group_notes(uuid),public.create_mtu_group_announcement(uuid,text,text,timestamptz),public.list_mtu_group_announcements(uuid) from public, anon;
grant execute on function public.create_mtu_group_note(uuid,text,text),public.list_mtu_group_notes(uuid),public.create_mtu_group_announcement(uuid,text,text,timestamptz),public.list_mtu_group_announcements(uuid) to authenticated;

-- 5) Persisted group images; only a group owner or admin can replace one.
alter table public.conversations add column if not exists group_image_url text;
alter table public.conversations add column if not exists group_image_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('group-images','group-images',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Convo group admins upload images" on storage.objects;
create policy "Convo group admins upload images" on storage.objects for insert to authenticated with check (
  bucket_id='group-images' and (storage.foldername(name))[1]=auth.uid()::text and exists(
    select 1 from public.conversation_members member where member.conversation_id=((storage.foldername(name))[2])::uuid and member.user_id=auth.uid() and member.group_role in ('owner','admin')
  )
);
drop policy if exists "Convo group admins delete images" on storage.objects;
create policy "Convo group admins delete images" on storage.objects for delete to authenticated using (
  bucket_id='group-images' and (storage.foldername(name))[1]=auth.uid()::text
);
create or replace function public.set_mtu_group_image(p_conversation_id uuid,p_image_url text,p_image_path text) returns text language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists(select 1 from public.conversation_members member join public.conversations conversation on conversation.id=member.conversation_id and conversation.kind='group' where member.conversation_id=p_conversation_id and member.user_id=auth.uid() and member.group_role in ('owner','admin')) then raise exception 'Only group admins can update the group image'; end if;
  if p_image_path not like auth.uid()::text || '/' || p_conversation_id::text || '/%' then raise exception 'Invalid group image path'; end if;
  update public.conversations set group_image_url=p_image_url,group_image_path=p_image_path,updated_at=now() where id=p_conversation_id;
  return p_image_url;
end; $$;
revoke execute on function public.set_mtu_group_image(uuid,text,text) from public, anon;
grant execute on function public.set_mtu_group_image(uuid,text,text) to authenticated;

-- Refresh PostgREST's schema cache after the new RPCs are created.
notify pgrst, 'reload schema';
