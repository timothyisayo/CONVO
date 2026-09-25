-- Safely remove the previously applied Focus Hour feature.
-- Run this migration after 20260922190000_focus_hours.sql.

drop function if exists public.start_mtu_focus_hour(integer);
drop function if exists public.end_mtu_focus_hour();
drop function if exists public.get_my_mtu_focus_hour();
drop function if exists public.list_mtu_focus_hours();

do $$
begin
  if to_regclass('public.mtu_focus_hours') is not null then
    drop policy if exists "focus hours own row" on public.mtu_focus_hours;
    drop policy if exists "focus hours eligible rows" on public.mtu_focus_hours;
  end if;
end
$$;

do $$
begin
  begin
    alter publication supabase_realtime drop table public.mtu_focus_hours;
  exception
    when undefined_table then null;
    when undefined_object then null;
  end;
end
$$;

drop index if exists public.mtu_focus_hours_active_idx;
drop table if exists public.mtu_focus_hours;

-- Remove only the Focus Hour key while preserving all other profile visibility settings.
update public.profiles
set profile_visibility = profile_visibility - 'focus_hour'
where profile_visibility ? 'focus_hour';
