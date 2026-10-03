create table if not exists public.conversation_appearance_settings (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  background_image_path text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.conversation_appearance_settings enable row level security;
drop policy if exists "Conversation members can read shared appearance" on public.conversation_appearance_settings;
create policy "Conversation members can read shared appearance"
  on public.conversation_appearance_settings for select to authenticated
  using (
    public.is_mtu_account()
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation_appearance_settings.conversation_id
        and member.user_id = auth.uid()
    )
  );
revoke all on public.conversation_appearance_settings from anon, authenticated;
grant select on public.conversation_appearance_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversation-backgrounds', 'conversation-backgrounds', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
grant insert, delete on storage.objects to authenticated;

drop policy if exists "Conversation members can upload chat backgrounds" on storage.objects;
create policy "Conversation members can upload chat backgrounds"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'conversation-backgrounds'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id::text = (storage.foldername(name))[1]
        and member.user_id = auth.uid()
    )
  );
drop policy if exists "Users can delete their own chat backgrounds" on storage.objects;
create policy "Users can delete their own chat backgrounds"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'conversation-backgrounds'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop function if exists public.get_mtu_conversation_appearance(uuid);
drop function if exists public.set_mtu_conversation_appearance(uuid, text, text);
drop function if exists public.set_mtu_conversation_appearance(uuid, text);

create function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table (background_image_path text)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select setting.background_image_path
  from (select 1) anchor
  left join public.conversation_appearance_settings setting
    on setting.conversation_id = p_conversation_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.user_id = auth.uid()
    )
$$;

create function public.set_mtu_conversation_appearance(
  p_conversation_id uuid,
  p_background_image_path text
)
returns table (background_image_path text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
declare
  previous_path text;
begin
  if auth.uid() is null
    or not public.is_mtu_account()
    or not exists (
      select 1 from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.user_id = auth.uid()
    )
  then
    raise exception 'You cannot change this conversation background';
  end if;

  perform 1 from public.conversations conversation
  where conversation.id = p_conversation_id
  for update;

  if p_background_image_path is not null then
    if p_background_image_path not like p_conversation_id::text || '/' || auth.uid()::text || '/%'
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'conversation-backgrounds'
          and object.name = p_background_image_path
      )
    then
      raise exception 'Invalid conversation background image';
    end if;
  end if;

  select setting.background_image_path into previous_path
  from public.conversation_appearance_settings setting
  where setting.conversation_id = p_conversation_id;

  insert into public.conversation_appearance_settings (
    conversation_id, background_image_path, updated_by, updated_at
  )
  values (p_conversation_id, p_background_image_path, auth.uid(), now())
  on conflict (conversation_id) do update
    set background_image_path = excluded.background_image_path,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  if previous_path is not null and previous_path is distinct from p_background_image_path then
    delete from storage.objects
    where bucket_id = 'conversation-backgrounds'
      and name = previous_path;
  end if;

  return query select p_background_image_path;
end;
$$;

revoke execute on function public.get_mtu_conversation_appearance(uuid),
  public.set_mtu_conversation_appearance(uuid, text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid),
  public.set_mtu_conversation_appearance(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'conversation_appearance_settings'
    )
  then
    alter publication supabase_realtime add table public.conversation_appearance_settings;
  end if;
end
$$;
