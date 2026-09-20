-- CONVO per-conversation appearance preferences
-- Run after messaging-rail-state.sql. Safe to rerun.

alter table public.conversation_member_preferences
  add column if not exists chat_theme text not null default 'convo',
  add column if not exists wallpaper_variant text not null default 'plain';

alter table public.conversation_member_preferences
  drop constraint if exists conversation_member_preferences_chat_theme_check;
alter table public.conversation_member_preferences
  add constraint conversation_member_preferences_chat_theme_check
  check (chat_theme in ('convo', 'cream', 'peach', 'sage', 'lavender', 'midnight'));

alter table public.conversation_member_preferences
  drop constraint if exists conversation_member_preferences_wallpaper_variant_check;
alter table public.conversation_member_preferences
  add constraint conversation_member_preferences_wallpaper_variant_check
  check (wallpaper_variant in ('plain', 'organic', 'campus', 'gradient'));

create or replace function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table (chat_theme text, wallpaper_variant text)
language sql
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(preference.chat_theme, 'convo'), coalesce(preference.wallpaper_variant, 'plain')
  from (select 1) anchor
  left join public.conversation_member_preferences preference
    on preference.conversation_id = p_conversation_id
   and preference.user_id = auth.uid()
  where auth.uid() is not null
    and public.is_mtu_account()
    and exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid())
$$;

create or replace function public.set_mtu_conversation_appearance(
  p_conversation_id uuid,
  p_chat_theme text,
  p_wallpaper_variant text
)
returns table (chat_theme text, wallpaper_variant text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result_record record;
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (select 1 from public.conversation_members member where member.conversation_id = p_conversation_id and member.user_id = auth.uid()) then
    raise exception 'You cannot change this conversation appearance';
  end if;
  if p_chat_theme not in ('convo', 'cream', 'peach', 'sage', 'lavender', 'midnight') then raise exception 'Unsupported conversation theme'; end if;
  if p_wallpaper_variant not in ('plain', 'organic', 'campus', 'gradient') then raise exception 'Unsupported wallpaper'; end if;
  insert into public.conversation_member_preferences(conversation_id, user_id, chat_theme, wallpaper_variant, updated_at)
  values (p_conversation_id, auth.uid(), p_chat_theme, p_wallpaper_variant, now())
  on conflict (conversation_id, user_id) do update set chat_theme = excluded.chat_theme, wallpaper_variant = excluded.wallpaper_variant, updated_at = now()
  returning conversation_member_preferences.chat_theme, conversation_member_preferences.wallpaper_variant into result_record;
  return query select result_record.chat_theme, result_record.wallpaper_variant;
end;
$$;

revoke execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid,text,text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid,text,text) to authenticated;
